// Privaagent Content Script (Main Injected Script)

import { PageState } from "../common/types";
import { extractPageState, resolveElementByTargetId } from "../semantic/dom-extractor";
import { startObservingDOM, stopObservingDOM } from "../semantic/mutation-observer";
import { executeAction, ExecutionResult } from "../execution";

declare global {
  interface Window {
    __privaagent_page_state?: PageState;
    __privaagent_extraction_time_ms?: number;
    __privaagent_extract?: () => { pageState: PageState; durationMs: number };
    __privaagent_execute_action?: (action: any) => Promise<ExecutionResult>;
    __privaagent_resolve_element?: (targetId: string) => Element | null;
  }
}

let latestPageState: PageState | null = null;
let latestDurationMs: number = 0;

/**
 * Runs perception pass and updates global state.
 */
function runPerception(): PageState {
  const result = extractPageState();
  latestPageState = result.pageState;
  latestDurationMs = result.durationMs;

  // Expose on window for programmatic benchmark harness access
  window.__privaagent_page_state = latestPageState;
  window.__privaagent_extraction_time_ms = latestDurationMs;

  console.log(
    `[Privaagent Perception] Extracted ${result.elementCount} elements in ${result.durationMs.toFixed(2)}ms (Constraint: <50ms, Passed: ${result.durationMs < 50})`
  );

  return latestPageState;
}

// Register global helpers
window.__privaagent_extract = () => {
  const state = runPerception();
  return { pageState: state, durationMs: latestDurationMs };
};

window.__privaagent_execute_action = (action: any) => executeAction(action);
window.__privaagent_resolve_element = (targetId: string) => resolveElementByTargetId(targetId);

// Initialize on page load
function initialize(): void {
  runPerception();

  // Begin watching for DOM mutations
  startObservingDOM((updatedState, durationMs) => {
    latestPageState = updatedState;
    latestDurationMs = durationMs;
    window.__privaagent_page_state = latestPageState;
    window.__privaagent_extraction_time_ms = latestDurationMs;
    console.log(
      `[Privaagent Perception] Incremental update: ${updatedState.elements.length} elements in ${durationMs.toFixed(2)}ms`
    );
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

// Clean up when unloading
window.addEventListener("beforeunload", () => {
  stopObservingDOM();
});

// Chrome Extension Runtime Message Listener
chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PAGE_STATE") {
    if (!latestPageState) {
      runPerception();
    }
    sendResponse({
      pageState: latestPageState,
      durationMs: latestDurationMs,
      underConstraint: latestDurationMs < 50,
    });
    return true;
  }

  if (message?.type === "EXECUTE_ACTION") {
    executeAction(message.action).then((res) => {
      sendResponse(res);
    });
    return true;
  }

  return false;
});
