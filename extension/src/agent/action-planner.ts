// Action Planner: Communicates across the trust boundary with the remote VLM backend
// transmitting ONLY sanitized Disclosure context and validating returned Actions.

import { Action, ActionSchema, Disclosure } from "../common/types";

export interface RemoteResolutionOptions {
  serverBaseUrl?: string;
  fetchFn?: typeof fetch;
  sessionToken?: string;
}

export function buildResolverEndpoint(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Remote resolver URL must be an absolute HTTP(S) URL.");
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback = host === "localhost" || host.endsWith(".localhost") || host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Remote resolver URL cannot contain credentials, a query, or a fragment.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw new Error("Remote resolver connections require HTTPS; plain HTTP is allowed only for loopback development servers.");
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/api/resolve-action`;
}

/**
 * Sends a sanitized Disclosure payload across the network to the VLM fallback API.
 */
export async function requestRemoteAction(
  disclosure: Disclosure,
  options: RemoteResolutionOptions = {}
): Promise<Action> {
  const serverBaseUrl = options.serverBaseUrl || "http://127.0.0.1:8000";
  const fetchClient = options.fetchFn || fetch;
  const sessionToken =
    options.sessionToken ||
    (typeof window !== "undefined" ? (window as any).__privaagent_session_token : undefined);

  const endpoint = buildResolverEndpoint(serverBaseUrl);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionToken) {
    headers["X-Privaagent-Session-Token"] = sessionToken;
  }

  const response = await fetchClient(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(disclosure),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Remote VLM server returned error (${response.status}): ${errorText}`
    );
  }

  const rawJson = await response.json();

  // Validate response strictly against Action schema
  const parsedAction = ActionSchema.parse(rawJson);
  return parsedAction;
}
