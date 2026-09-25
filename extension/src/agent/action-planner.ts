// Action Planner: Communicates across the trust boundary with the remote VLM backend
// transmitting ONLY sanitized Disclosure context and validating returned Actions.

import { Action, ActionSchema, Disclosure } from "../common/types";

export interface RemoteResolutionOptions {
  serverBaseUrl?: string;
  fetchFn?: typeof fetch;
  sessionToken?: string;
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

  const endpoint = `${serverBaseUrl}/api/resolve-action`;

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
