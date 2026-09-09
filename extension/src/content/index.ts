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
import { PrivacyAuditVault, DPDPComplianceReport } from "../privacy/audit-vault";

declare global {
  interface Window {
    __privaagent_page_state?: PageState;
    __privaagent_extraction_time_ms?: number;
    __privaagent_extract?: () => { pageState: PageState; durationMs: number };
    __privaagent_execute_action?: (action: any) => Promise<ExecutionResult>;
    __privaagent_resolve_element?: (targetId: string) => Element | null;
    __privaagent_overlay_manager?: OverlayManager;
    __privaagent_run_goal?: (goal: string, options?: AgentLoopOptions) => Promise<MultiTurnGoalResult>;
    __privaagent_audit_vault?: PrivacyAuditVault;
  }
}

let latestPageState: PageState | null = null;
let latestDurationMs: number = 0;
let shieldEnabled: boolean = true; // Runtime state; restored from storage on init
const overlayManager = new OverlayManager();
window.__privaagent_overlay_manager = overlayManager;

function extractSensitiveEntityTypes(state: PageState | null): string[] {
  if (!state) return [];
  return state.elements
    .filter((e) => e.sensitive)
    .flatMap((e) => {
      const dets = (e.metadata?.sensitive_detections as any[]) || [];
      return dets.length > 0 ? dets.map((d) => String(d.type)) : ["SENSITIVE"];
    });
}

/**
 * Runs complete on-device perception pass, annotates privacy, and updates overlays.
 * Skips overlay rendering when shield is disabled.
 */
function runPerception(): PageState {
  const result = extractPageState();
  const sensitiveState = annotatePageStateSensitivity(result.pageState);
  latestPageState = sensitiveState;
  latestDurationMs = result.durationMs;

  window.__privaagent_page_state = latestPageState;
  window.__privaagent_extraction_time_ms = latestDurationMs;

  if (shieldEnabled) {
    overlayManager.renderRedactionOverlays(latestPageState);
    overlayManager.updateHUD("L0", "Privacy Shield Active");

    // Update badge with PII count
    const piiCount = latestPageState.elements.filter((e) => e.sensitive).length;
    chrome.runtime?.sendMessage?.({
      type: "UPDATE_BADGE",
      level: "L0",
      text: piiCount > 0 ? `${piiCount}` : "0B",
    });
  }

  console.log(
    `[Privaagent] Extracted & annotated ${result.elementCount} elements in ${result.durationMs.toFixed(2)}ms`
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
  if (!latestPageState) runPerception();
  return runMultiTurnAgent(goal, latestPageState || undefined, {
    doc: document,
    delayBetweenStepsMs: 250,
    ...options,
  });
};
window.__privaagent_audit_vault = PrivacyAuditVault.getInstance();

// ─── Scroll & Resize Re-render ─────────────────────────────────────────────
// position: fixed overlays use viewport coords from getBoundingClientRect().
// We must re-query getBoundingClientRect() after scroll/resize to keep overlays
// correctly positioned. Bug 8 fix: removed capture:true — window scroll (bubbled)
// is sufficient for top-level viewport scroll without intercepting inner modals.

let scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SCROLL_DEBOUNCE_MS = 30;

function debouncedRerender(): void {
  if (!shieldEnabled) return;
  if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
  scrollDebounceTimer = setTimeout(() => {
    overlayManager.rerender();
    scrollDebounceTimer = null;
  }, SCROLL_DEBOUNCE_MS);
}

/**
 * Enables/disables the privacy shield at runtime and persists the state.
 */
function setShieldEnabled(enabled: boolean): void {
  shieldEnabled = enabled;
  chrome.storage?.local?.set({ privaagent_shield_enabled: enabled });

  if (enabled) {
    if (latestPageState) {
      overlayManager.renderRedactionOverlays(latestPageState);
    }
    overlayManager.updateHUD("L0", "Privacy Shield Active");
    chrome.runtime?.sendMessage?.({ type: "UPDATE_BADGE", level: "L0", text: "ON" });
  } else {
    overlayManager.setVisible(false);
    // Clear overlays by re-rendering with visible=false
    overlayManager.updateHUD("OFF", "Shield Disabled");
    chrome.runtime?.sendMessage?.({ type: "UPDATE_BADGE", level: "BLOCKED", text: "OFF" });
  }
  overlayManager.setVisible(enabled);
}

// Initialize on page load
function initialize(): void {
  // Restore shield state and redaction mode from chrome.storage
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["privaagent_shield_enabled", "privaagent_redaction_mode"], (result) => {
      const stored = result?.privaagent_shield_enabled;
      shieldEnabled = stored === undefined ? true : Boolean(stored);
      const storedMode = result?.privaagent_redaction_mode || "BLUR";
      overlayManager.setMode(storedMode as any);
      overlayManager.setVisible(shieldEnabled);
      runPerception();
    });
  } else {
    runPerception();
  }

  // Window scroll without capture is correct for viewport
  window.addEventListener("scroll", debouncedRerender, { passive: true });
  window.addEventListener("resize", debouncedRerender, { passive: true });

  // Begin watching for DOM mutations
  startObservingDOM((updatedState, durationMs) => {
    const sensitive = annotatePageStateSensitivity(updatedState);
    latestPageState = sensitive;
    latestDurationMs = durationMs;

    if (shieldEnabled) {
      overlayManager.renderRedactionOverlays(latestPageState);
    }

    window.__privaagent_page_state = latestPageState;
    window.__privaagent_extraction_time_ms = latestDurationMs;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

window.addEventListener("beforeunload", () => {
  stopObservingDOM();
  overlayManager.destroy();
  if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
  window.removeEventListener("scroll", debouncedRerender);
  window.removeEventListener("resize", debouncedRerender);
});

// Chrome Extension Runtime Message Listener
chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PAGE_STATE") {
    if (!latestPageState) runPerception();
    const sensitiveElementsCount = latestPageState?.elements.filter((e) => e.sensitive).length || 0;

    // Build live threat feed: partial masks of actual detected values
    const threatFeed = (latestPageState?.elements || [])
      .filter((e) => e.sensitive && e.metadata?.sensitive_detections)
      .flatMap((e) => {
        const dets = (e.metadata?.sensitive_detections as any[]) || [];
        return dets.map((d) => ({
          type: d.type as string,
          maskedValue: maskValue(d.text as string, d.type as string),
        }));
      })
      .slice(0, 16); // Limit feed to 16 items

    sendResponse({
      pageState: latestPageState,
      durationMs: latestDurationMs,
      underConstraint: latestDurationMs < 50,
      sensitiveElementsCount,
      shieldEnabled,
      redactionMode: overlayManager.getMode(),
      threatFeed,
      url: window.location.href,
      title: document.title,
    });
    return true;
  }

  if (message?.type === "TOGGLE_OVERLAYS") {
    setShieldEnabled(Boolean(message.visible));
    sendResponse({ ok: true, visible: message.visible });
    return true;
  }

  if (message?.type === "SET_REDACTION_MODE") {
    const mode = message.mode || "BLUR";
    overlayManager.setMode(mode);
    chrome.storage?.local?.set({ privaagent_redaction_mode: mode });
    sendResponse({ ok: true, mode });
    return true;
  }

  if (message?.type === "EXECUTE_ACTION") {
    executeAction(message.action).then((res) => sendResponse(res));
    return true;
  }

  if (message?.type === "RUN_TASK") {
    handleRunTaskMessage(message.task, message.maxLevel, message.simulateUnsafeSanitization)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message?.type === "RUN_GOAL") {
    handleRunGoalMessage(message.goal, message.budgetLimits, message.maxLevel)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message?.type === "GET_COMPLIANCE_REPORT") {
    sendResponse(PrivacyAuditVault.getInstance().generateComplianceReport());
    return true;
  }

  if (message?.type === "CLEAR_AUDIT_VAULT") {
    PrivacyAuditVault.getInstance().clear();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

/**
 * Produces a partially masked display version of a detected PII value.
 * e.g. "ayashmuthal@gmail.com" → "ayash****@gmail.com"
 *      "981652472" → "981XXXXX2"
 *      "sk-abc123def456" → "sk-abc***456"
 */
function maskValue(raw: string, type: string): string {
  if (!raw) return "***";
  const s = raw.trim();

  if (type === "EMAIL") {
    const at = s.indexOf("@");
    if (at > 3) {
      return s.slice(0, Math.min(5, at - 1)) + "****" + s.slice(at);
    }
    return s.slice(0, 2) + "****";
  }

  if (type === "PHONE") {
    const digits = s.replace(/\D/g, "");
    return digits.slice(0, 3) + "XXXXX" + digits.slice(-2);
  }

  if (type === "SECRET_KEY") {
    if (s.length > 12) return s.slice(0, 6) + "***" + s.slice(-4);
    return s.slice(0, 3) + "***";
  }

  if (type === "AADHAAR") {
    return "XXXX XXXX " + s.replace(/\D/g, "").slice(-4);
  }

  if (type === "PAN") {
    return s.slice(0, 3) + "XX" + s.slice(5, 6) + "XXXX" + s.slice(-1);
  }

  if (type === "CREDIT_CARD") {
    return "**** **** **** " + s.replace(/\D/g, "").slice(-4);
  }

  if (type === "GSTIN") {
    return s.slice(0, 2) + "******" + s.slice(-3);
  }

  if (type === "DRIVING_LICENSE") {
    return s.slice(0, 4) + "******" + s.slice(-3);
  }

  if (type === "BANK_ACCOUNT") {
    return "A/C *******" + s.slice(-4);
  }

  if (type === "DOB") {
    return "**/**/" + s.slice(-4);
  }

  if (type === "VEHICLE_RC") {
    return s.slice(0, 4) + "-**-" + s.slice(-4);
  }

  // Default: show first 3, mask the rest
  if (s.length > 6) return s.slice(0, 3) + "***" + s.slice(-2);
  return s.slice(0, 2) + "***";
}

async function handleRunGoalMessage(
  goalStr: string,
  budgetLimits?: any,
  maxLevel: string = "L2"
): Promise<MultiTurnGoalResult> {
  if (!latestPageState) runPerception();
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

async function handleRunTaskMessage(
  taskStr: string,
  maxLevel: string = "L2",
  simulateUnsafeSanitization: boolean = false
): Promise<{
  success: boolean;
  resolution?: AgentResolutionResult;
  validation?: ValidationResult;
  execution?: ExecutionResult;
  error?: string;
}> {
  if (!latestPageState) runPerception();
  if (!latestPageState) throw new Error("Unable to capture page state.");

  overlayManager.updateHUD("Thinking...", `Reasoning: "${taskStr.slice(0, 20)}..."`);
  const resolution = await resolveTaskAction(taskStr, latestPageState, {
    simulateUnsafeSanitization,
  });

  // Check if Pre-Flight Privacy Guard blocked the request
  if (resolution.processingPath === "BLOCKED") {
    overlayManager.updateHUD("BLOCKED", "Pre-flight privacy guard triggered");
    PrivacyAuditVault.getInstance().record({
      goal: taskStr,
      subtask: taskStr,
      disclosureLevel: resolution.disclosure.level,
      entitiesMasked: extractSensitiveEntityTypes(latestPageState),
      outboundBytes: 0,
      action: "block",
      targetId: "none",
      riskVerdict: "BLOCK",
      policyApplied: resolution.blockReason || "Pre-flight privacy audit failed",
      isLocal: true,
    });
    return {
      success: false,
      resolution,
      error: resolution.blockReason || "Pre-flight privacy audit failed: request blocked.",
    };
  }

  const levelOrder = { L0: 0, L1: 1, L2: 2, L3: 3 };
  const requestedLevel = resolution.disclosure.level as keyof typeof levelOrder;
  const ceiling = maxLevel as keyof typeof levelOrder;
  if ((levelOrder[requestedLevel] ?? 0) > (levelOrder[ceiling] ?? 2)) {
    overlayManager.updateHUD("BLOCKED", "Policy ceiling exceeded");
    return { success: false, resolution, error: `Policy ceiling violation: requires ${requestedLevel}, ceiling is ${ceiling}.` };
  }

  const validation = validateAction(resolution.action, latestPageState, document);

  if (!validation.valid || validation.verdict === "BLOCK") {
    overlayManager.updateHUD("BLOCKED", "Action blocked by safety policy");
    PrivacyAuditVault.getInstance().record({
      goal: taskStr, subtask: taskStr, disclosureLevel: resolution.disclosure.level,
      entitiesMasked: extractSensitiveEntityTypes(latestPageState), outboundBytes: resolution.networkBytesSent,
      action: resolution.action.action, targetId: resolution.action.target_id,
      riskVerdict: "BLOCK", policyApplied: validation.error || "Blocked by security policy", isLocal: resolution.isLocal,
    });
    return { success: false, resolution, validation, error: validation.error || "Action blocked by security policy." };
  }

  if (validation.verdict === "CONFIRM") {
    overlayManager.updateHUD("CONFIRM", "User confirmation required");
    PrivacyAuditVault.getInstance().record({
      goal: taskStr, subtask: taskStr, disclosureLevel: resolution.disclosure.level,
      entitiesMasked: extractSensitiveEntityTypes(latestPageState), outboundBytes: resolution.networkBytesSent,
      action: resolution.action.action, targetId: resolution.action.target_id,
      riskVerdict: "CONFIRM", policyApplied: validation.policyResult?.requiredUserConfirmation || "High-risk action", isLocal: resolution.isLocal,
    });
    return { success: false, resolution, validation, error: `Requires confirmation: ${validation.policyResult?.requiredUserConfirmation || "High-risk action"}` };
  }

  overlayManager.updateHUD(resolution.disclosure.level, `Executing ${resolution.action.action}`);
  const execution = await executeAction(resolution.action);
  overlayManager.updateHUD(resolution.disclosure.level, execution.success ? "Done" : "Execution failed");

  PrivacyAuditVault.getInstance().record({
    goal: taskStr, subtask: taskStr, disclosureLevel: resolution.disclosure.level,
    entitiesMasked: extractSensitiveEntityTypes(latestPageState), outboundBytes: resolution.networkBytesSent,
    action: resolution.action.action, targetId: resolution.action.target_id,
    riskVerdict: validation.verdict, policyApplied: execution.error || "Executed successfully", isLocal: resolution.isLocal,
  });

  return { success: execution.success, resolution, validation, execution, error: execution.error };
}
