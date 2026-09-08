// Privaagent Content Script (Main Injected Script)
// Implements on-device DOM perception, privacy annotation, visual redaction HUD,
// pre-execution action validation, and agent task dispatch.

import { PageState } from "../common/types";
import { extractPageState, resolveElementByTargetId } from "../semantic/dom-extractor";
import { startObservingDOM, stopObservingDOM } from "../semantic/mutation-observer";
import { annotatePageStateSensitivity } from "../privacy/sensitivity";
import { executeAction, ExecutionResult } from "../execution";
import { OverlayManager } from "./overlay-manager";
import { resolveTaskAction, AgentResolutionResult } from "../agent/target-resolver";
import { validateAction, ValidationResult } from "../validator/action-validator";
import { runMultiTurnAgent, MultiTurnGoalResult, AgentLoopOptions } from "../agent/agent-loop";

declare global {
  interface Window {
    __privaagent_page_state?: PageState;
    __privaagent_extraction_time_ms?: number;
    __privaagent_extract?: () => { pageState: PageState; durationMs: number };
    __privaagent_execute_action?: (action: any) => Promise<ExecutionResult>;
    __privaagent_resolve_element?: (targetId: string) => Element | null;
    __privaagent_overlay_manager?: OverlayManager;
    __privaagent_run_goal?: (goal: string, options?: AgentLoopOptions) => Promise<MultiTurnGoalResult>;
  }
}

let latestPageState: PageState | null = null;
let latestDurationMs: number = 0;
const overlayManager = new OverlayManager();
window.__privaagent_overlay_manager = overlayManager;

/**
 * Runs complete on-device perception pass, annotates privacy, and updates overlays.
 */
function runPerception(): PageState {
  const result = extractPageState();
  // Annotate sensitive entities
  const sensitiveState = annotatePageStateSensitivity(result.pageState);
  latestPageState = sensitiveState;
  latestDurationMs = result.durationMs;

  // Render on-page redaction overlays without mutating DOM
  overlayManager.renderRedactionOverlays(latestPageState);
  overlayManager.updateHUD("L0", "Privacy Shield Active");

  // Expose on window for programmatic benchmark harness access
  window.__privaagent_page_state = latestPageState;
  window.__privaagent_extraction_time_ms = latestDurationMs;

  console.log(
    `[Privaagent Perception] Extracted & annotated ${result.elementCount} elements in ${result.durationMs.toFixed(2)}ms (Constraint: <50ms, Passed: ${result.durationMs < 50})`
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
window.__privaagent_run_goal = (goal: string, options?: AgentLoopOptions) => {
  if (!latestPageState) {
    runPerception();
  }
  return runMultiTurnAgent(goal, latestPageState || undefined, {
    doc: document,
    delayBetweenStepsMs: 250,
    ...options,
  });
};

// Initialize on page load
function initialize(): void {
  runPerception();

  // Begin watching for DOM mutations
  startObservingDOM((updatedState, durationMs) => {
    const sensitive = annotatePageStateSensitivity(updatedState);
    latestPageState = sensitive;
    latestDurationMs = durationMs;
    overlayManager.renderRedactionOverlays(latestPageState);

    window.__privaagent_page_state = latestPageState;
    window.__privaagent_extraction_time_ms = latestDurationMs;
    console.log(
      `[Privaagent Perception] Incremental update: ${sensitive.elements.length} elements in ${durationMs.toFixed(2)}ms`
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
  overlayManager.destroy();
});

// Chrome Extension Runtime Message Listener
chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PAGE_STATE") {
    if (!latestPageState) {
      runPerception();
    }
    const sensitiveElementsCount = latestPageState?.elements.filter((e) => e.sensitive).length || 0;
    sendResponse({
      pageState: latestPageState,
      durationMs: latestDurationMs,
      underConstraint: latestDurationMs < 50,
      sensitiveElementsCount,
      url: window.location.href,
      title: document.title,
    });
    return true;
  }

  if (message?.type === "TOGGLE_OVERLAYS") {
    overlayManager.setVisible(Boolean(message.visible));
    sendResponse({ ok: true, visible: message.visible });
    return true;
  }

  if (message?.type === "EXECUTE_ACTION") {
    executeAction(message.action).then((res) => {
      sendResponse(res);
    });
    return true;
  }

  if (message?.type === "RUN_TASK") {
    handleRunTaskMessage(message.task, message.maxLevel)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message?.type === "RUN_GOAL") {
    handleRunGoalMessage(message.goal, message.budgetLimits, message.maxLevel)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

/**
 * Orchestrates multi-turn compound goal reasoning and execution.
 */
async function handleRunGoalMessage(
  goalStr: string,
  budgetLimits?: any,
  maxLevel: string = "L2"
): Promise<MultiTurnGoalResult> {
  if (!latestPageState) {
    runPerception();
  }

  overlayManager.updateHUD("Multi-Turn", `Decomposing: "${goalStr.slice(0, 20)}..."`);

  const result = await runMultiTurnAgent(goalStr, latestPageState || undefined, {
    budgetLimits,
    maxDisclosureLevel: maxLevel,
    doc: document,
    delayBetweenStepsMs: 250,
  });

  overlayManager.updateHUD(
    result.status === "SUCCESS" ? "Completed" : result.status,
    `${result.totalSteps} steps | ${result.cumulativeBytesSent} B`
  );

  return result;
}

/**
 * Orchestrates task reasoning, risk validation, and execution.
 */
async function handleRunTaskMessage(taskStr: string, maxLevel: string = "L2"): Promise<{
  success: boolean;
  resolution?: AgentResolutionResult;
  validation?: ValidationResult;
  execution?: ExecutionResult;
  error?: string;
}> {
  if (!latestPageState) {
    runPerception();
  }
  if (!latestPageState) {
    throw new Error("Unable to capture page state.");
  }

  overlayManager.updateHUD("Thinking...", `Reasoning: "${taskStr.slice(0, 20)}..."`);

  // 1. Resolve action via Minimum Disclosure Ladder
  const resolution = await resolveTaskAction(taskStr, latestPageState);

  // Enforce user policy ceiling if escalated level exceeds user limit
  const levelOrder = { L0: 0, L1: 1, L2: 2, L3: 3 };
  const requestedLevel = resolution.disclosure.level as keyof typeof levelOrder;
  const ceiling = maxLevel as keyof typeof levelOrder;
  if ((levelOrder[requestedLevel] ?? 0) > (levelOrder[ceiling] ?? 2)) {
    overlayManager.updateHUD("BLOCKED", "Policy ceiling exceeded");
    return {
      success: false,
      resolution,
      error: `Policy ceiling violation: Task requires ${requestedLevel} disclosure, but user policy ceiling is set to ${ceiling}.`,
    };
  }

  // 2. Validate action with Pre-Execution Validator & Risk Policy
  const validation = validateAction(resolution.action, latestPageState, document);

  if (!validation.valid || validation.verdict === "BLOCK") {
    overlayManager.updateHUD("BLOCKED", "Action blocked by safety policy");
    return {
      success: false,
      resolution,
      validation,
      error: validation.error || "Action blocked by security policy.",
    };
  }

  if (validation.verdict === "CONFIRM") {
    overlayManager.updateHUD("CONFIRM", "User confirmation required");
    return {
      success: false,
      resolution,
      validation,
      error: `Action requires user confirmation: ${validation.policyResult?.requiredUserConfirmation || "High-risk action"}`,
    };
  }

  // 3. Dispatch safe execution
  overlayManager.updateHUD(resolution.disclosure.level, `Executing ${resolution.action.action}`);
  const execution = await executeAction(resolution.action);

  overlayManager.updateHUD(resolution.disclosure.level, execution.success ? "Done" : "Execution failed");

  return {
    success: execution.success,
    resolution,
    validation,
    execution,
    error: execution.error,
  };
}
