// Navigate Executor: Directs browser navigation to target URL.

import { ExecutionResult } from "./click";

export function executeNavigate(url?: string): ExecutionResult {
  if (!url) {
    return {
      success: false,
      target_id: "window",
      error: "No destination URL provided for navigate action.",
    };
  }

  try {
    const parsed = new URL(url, window.location.href);
    window.location.href = parsed.href;
    return {
      success: true,
      target_id: "window",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      target_id: "window",
      error: `Invalid navigation URL "${url}": ${message}`,
    };
  }
}
