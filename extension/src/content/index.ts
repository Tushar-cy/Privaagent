// Privaagent Content Script (Main Injected Script)
// Implements on-device DOM perception, privacy annotation, visual redaction HUD,
// pre-execution action validation, and agent task dispatch.

import { DisclosureLevel, PageState } from "../common/types";
import { extractPageState } from "../semantic/dom-extractor";
import { startObservingDOM, stopObservingDOM } from "../semantic/mutation-observer";
import { annotatePageStateSensitivity } from "../privacy/sensitivity";
import { executeAction, ExecutionResult } from "../execution";
import { OverlayManager } from "./overlay-manager";
import { resolveTaskAction, AgentResolutionResult } from "../agent/target-resolver";
import { validateAction, ValidationResult } from "../validator/action-validator";
import { runMultiTurnAgent, resumeMultiTurnAgent, MultiTurnGoalResult } from "../agent/agent-loop";
import { AgentPrivacyBudget, BudgetStatus } from "../agent/privacy-budget";
import { PrivacyAuditVault, PrivacyAuditSummary } from "../privacy/audit-vault";
import { parseTask } from "../agent/task-parser";

function safeSendBackgroundMessage(message: any): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime?.lastError;
    });
  } catch {
    // Non-blocking
  }
}

let latestPageState: PageState | null = null;
let latestDurationMs: number = 0;
let shieldEnabled: boolean = true; // Runtime state; restored from storage on init
const overlayManager = new OverlayManager();

function normalizeDisclosureLevel(value: unknown): DisclosureLevel {
  return value === "L0" || value === "L1" || value === "L2" || value === "L3"
    ? value
    : "L0";
}

class TabSessionPrivacyBudget implements AgentPrivacyBudget {
  private status: BudgetStatus = {
    exceeded: false,
    cumulativeBytesSent: 0,
    remoteCallsMade: 0,
    stepsExecuted: 0,
  };
  private readonly maxSteps = 8;

  async initialize(): Promise<void> {
    await this.request({ type: "GET_PRIVACY_BUDGET" });
  }

  canExecuteNextStep(): boolean { return this.status.stepsExecuted < this.maxSteps; }
  getSteps(): number { return this.status.stepsExecuted; }
  getMaxSteps(): number { return this.maxSteps; }
  getStatus(): BudgetStatus { return { ...this.status }; }

  async reserveStep(): Promise<boolean> {
    const response = await this.request({ type: "RESERVE_PRIVACY_STEP" });
    return response?.allowed === true;
  }

  async reserveRemote(estimatedBytes: number): Promise<boolean> {
    const response = await this.request({ type: "RESERVE_PRIVACY_REMOTE", estimatedBytes });
    return response?.allowed === true;
  }

  private async request(message: Record<string, unknown>): Promise<any> {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) throw new Error("Extension budget service unavailable.");
      const response = await chrome.runtime.sendMessage(message);
      if (response?.budget) {
        this.status = {
          exceeded: Boolean(response.budget.exceeded),
          cumulativeBytesSent: Number(response.budget.cumulativeBytesSent) || 0,
          remoteCallsMade: Number(response.budget.remoteCallsMade) || 0,
          stepsExecuted: Number(response.budget.stepsExecuted) || 0,
          reason: typeof response.budget.reason === "string" ? response.budget.reason : undefined,
        };
      } else {
        this.status = { ...this.status, exceeded: true, reason: response?.error || "Privacy budget service unavailable; request was not sent." };
      }
      return response;
    } catch {
      this.status = { ...this.status, exceeded: true, reason: "Privacy budget service unavailable; request was not sent." };
      return { allowed: false, error: this.status.reason };
    }
  }
}
if (typeof window !== "undefined") {
  // Listen for OCR lazy-loading events to display honest loading states
  window.addEventListener("PRIVAAGENT_OCR_INIT_START", () => {
    overlayManager.updateHUD("Loading", "Initializing Vision Engine (~4MB)...");
  });

  window.addEventListener("PRIVAAGENT_OCR_INIT_END", () => {
    overlayManager.updateHUD("Loaded", "Vision Engine Ready");
  });

  window.addEventListener("PRIVAAGENT_OCR_INIT_ERROR", () => {
    overlayManager.updateHUD("BLOCKED", "Vision OCR unavailable; visual disclosure blocked");
  });
}

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

  if (shieldEnabled) {
    overlayManager.renderRedactionOverlays(latestPageState);
    overlayManager.updateHUD("L0", "Privacy Shield Active");

    // Update badge with PII count safely
    const piiCount = latestPageState.elements.filter((e) => e.sensitive).length;
    safeSendBackgroundMessage({
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

/**
 * Mandatory Execution Gatekeeper:
 * Enforces local validation before allowing any action to reach the browser execution engine.
 * Unvalidated or blocked actions cannot bypass the security validator.
 */
export async function requestValidatedExecution(
  action: any,
  options?: { userConfirmed?: boolean }
): Promise<ExecutionResult> {
  const pageState = runPerception();
  const valResult = validateAction(action, pageState, document);
  if (!valResult.valid || valResult.verdict === "BLOCK") {
    return {
      success: false,
      target_id: action.target_id || "unknown",
      error: `Execution strictly BLOCKED by security validator: ${valResult.error || "Policy violation"}`,
    };
  }
  if (valResult.verdict === "CONFIRM" && options?.userConfirmed !== true && action.user_confirmed !== true) {
    return {
      success: false,
      target_id: action.target_id || "unknown",
      error: `Execution paused: Confirmation required (${valResult.policyResult?.requiredUserConfirmation || "User approval required"})`,
    };
  }
  return executeAction(action, {
    pageState,
    doc: document,
    userConfirmed: options?.userConfirmed,
  });
}

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
    safeSendBackgroundMessage({ type: "UPDATE_BADGE", level: "L0", text: "ON" });
  } else {
    overlayManager.setVisible(false);
    // Clear overlays by re-rendering with visible=false
    overlayManager.updateHUD("OFF", "Visual Shield OFF · Action Security ACTIVE");
    safeSendBackgroundMessage({ type: "UPDATE_BADGE", level: "BLOCKED", text: "OFF" });
  }
  overlayManager.setVisible(enabled);
}

// Initialize on page load
function initialize(): void {
  // Restore shield state, redaction mode, AND audit ledger from chrome.storage
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(
    ["privaagent_shield_enabled", "privaagent_redaction_mode", "privaagent_audit_ledger"],
      (result) => {
        const stored = result?.privaagent_shield_enabled;
        shieldEnabled = stored === undefined ? true : Boolean(stored);
        const storedMode = result?.privaagent_redaction_mode || "BLUR";
        overlayManager.setMode(storedMode as any);
        overlayManager.setVisible(shieldEnabled);

        // Auto-restore audit vault from persistent storage (P1 invariant)
        const storedLedger = result?.privaagent_audit_ledger;
        if (Array.isArray(storedLedger) && storedLedger.length > 0) {
          const restoreResult = PrivacyAuditVault.getInstance().loadFromStorage(storedLedger);
          console.log(
            `[Privaagent] Audit ledger restored: ${restoreResult.loaded} records, integrity=${restoreResult.valid ? "VERIFIED" : "COMPROMISED"}`
          );
        }

        runPerception();
      }
    );
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

  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    stopObservingDOM();
    overlayManager.destroy();
    if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
    window.removeEventListener("scroll", debouncedRerender);
    window.removeEventListener("resize", debouncedRerender);
  });
}

// Chrome Extension Runtime Message Listener
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const privilegedMessageTypes = new Set(["EXECUTE_ACTION", "RUN_TASK", "RUN_GOAL", "RESUME_GOAL"]);
  if (privilegedMessageTypes.has(message?.type) && sender?.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: "Privileged agent messages are accepted only from this extension." });
    return false;
  }

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
      actionSecurityEnabled: true,
      redactionMode: overlayManager.getMode(),
      threatFeed,
      url: window.location.href,
      title: document.title,
    });
    return false;
  }

  if (message?.type === "TOGGLE_OVERLAYS") {
    setShieldEnabled(Boolean(message.visible));
    sendResponse({ ok: true, visible: message.visible });
    return false;
  }

  if (message?.type === "SET_REDACTION_MODE") {
    const mode = message.mode || "BLUR";
    overlayManager.setMode(mode);
    chrome.storage?.local?.set({ privaagent_redaction_mode: mode });
    sendResponse({ ok: true, mode });
    return false;
  }

  if (message?.type === "EXECUTE_ACTION") {
    const explicitlyConfirmed = message.userConfirmed === true;
    requestValidatedExecution(message.action, { userConfirmed: explicitlyConfirmed }).then((res) => {
      if (explicitlyConfirmed) {
        const action = message.action || {};
        PrivacyAuditVault.getInstance().record({
          goal: "User-approved action",
          subtask: "Approved action revalidated against current page state",
          disclosureLevel: normalizeDisclosureLevel(message.disclosureLevel),
          entitiesMasked: extractSensitiveEntityTypes(latestPageState),
          outboundBytes: 0,
          action: String(action.action || "unknown"),
          targetId: String(action.target_id || "unknown"),
          riskVerdict: res.success ? "CONFIRM" : "BLOCK",
          policyApplied: res.success ? "User approved; current-state validation passed" : (res.error || "Current-state validation blocked the action"),
          isLocal: true,
        });
      }
      sendResponse(res);
    }).catch((err) => sendResponse({
      success: false,
      target_id: message.action?.target_id || "unknown",
      error: err?.message || "Approved action could not be executed.",
    }));
    return true;
  }

  if (message?.type === "RUN_TASK") {
    handleRunTaskMessage(message.task, normalizeDisclosureLevel(message.maxLevel ?? "L2"), message.simulateUnsafeSanitization)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message?.type === "OCR_WORKER_STATUS") {
    if (message.status === "loading") overlayManager.updateHUD("Loading", "Initializing Vision Engine locally...");
    else if (message.status === "ready") overlayManager.updateHUD("Loaded", "Vision Engine Ready");
    else overlayManager.updateHUD("BLOCKED", "Vision OCR unavailable; visual disclosure blocked");
    return false;
  }

  if (message?.type === "RUN_GOAL") {
    handleRunGoalMessage(message.goal, message.budgetLimits, normalizeDisclosureLevel(message.maxLevel ?? "L2"))
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message?.type === "RESUME_GOAL") {
    const continuationId = typeof message.continuationId === "string" ? message.continuationId : "";
    resumeMultiTurnAgent(continuationId, message.approved === true)
      .then((res) => {
        overlayManager.updateHUD(res.status, `${res.totalSteps} steps | ${res.cumulativeBytesSent} B`);
        sendResponse(res);
      })
      .catch((err) => sendResponse({ status: "FAILED", success: false, error: err?.message || "Could not resume the approved goal." }));
    return true;
  }

  if (message?.type === "GET_PRIVACY_AUDIT_SUMMARY") {
    sendResponse(PrivacyAuditVault.getInstance().generatePrivacyAuditSummary());
    return false;
  }

  if (message?.type === "CLEAR_AUDIT_VAULT") {
    PrivacyAuditVault.getInstance().clear();
    sendResponse({ ok: true });
    return false;
  }

  // Background broadcasts this on browser startup after loading from storage.
  // Content scripts re-seed the in-memory AuditVault from persisted records.
  if (message?.type === "RESTORE_AUDIT_LEDGER" && Array.isArray(message.ledger)) {
    const restoreResult = PrivacyAuditVault.getInstance().loadFromStorage(message.ledger);
    console.log(
      `[Privaagent] Startup audit restore: ${restoreResult.loaded} records, integrity=${restoreResult.valid ? "VERIFIED" : "COMPROMISED"}`
    );
    sendResponse({ ok: true, loaded: restoreResult.loaded, valid: restoreResult.valid });
    return false;
  }

  return false;
});
}

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
  maxLevel: DisclosureLevel = "L2"
): Promise<MultiTurnGoalResult> {
  const sessionBudget = new TabSessionPrivacyBudget();
  await sessionBudget.initialize();
  const initialState = runPerception();
  overlayManager.updateHUD("Multi-Turn", `Decomposing: "${goalStr.slice(0, 20)}..."`);

  const result = await runMultiTurnAgent(goalStr, initialState, {
    budgetLimits,
    sessionBudget,
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
  maxLevel: DisclosureLevel = "L2",
  simulateUnsafeSanitization: boolean = false
): Promise<{
  success: boolean;
  resolution?: AgentResolutionResult;
  validation?: ValidationResult;
  execution?: ExecutionResult;
  error?: string;
}> {
  const sessionBudget = new TabSessionPrivacyBudget();
  await sessionBudget.initialize();
  if (!await sessionBudget.reserveStep()) {
    const reason = sessionBudget.getStatus().reason || "The tab session has reached its action-step limit.";
    return { success: false, error: reason };
  }

  const pageState = runPerception();
  if (!pageState) throw new Error("Unable to capture page state.");

  // Start OCR setup while the local solver and visual capture checks run. The
  // first visual task then waits only for any remaining worker warmup.
  if (parseTask(taskStr).requiresVision) safeSendBackgroundMessage({ type: "OCR_WARMUP" });

  overlayManager.updateHUD("Thinking...", `Reasoning: "${taskStr.slice(0, 20)}..."`);
  const resolution = await resolveTaskAction(taskStr, pageState, {
    simulateUnsafeSanitization,
    maxDisclosureLevel: maxLevel,
    beforeRemoteRequest: (_disclosure, outboundBytes) => sessionBudget.reserveRemote(outboundBytes),
  });

  // Check if Pre-Flight Privacy Guard blocked the request
  if (resolution.processingPath === "BLOCKED") {
    overlayManager.updateHUD(
      "BLOCKED",
      resolution.ceilingExceeded ? "Disclosure ceiling blocked request" :
        resolution.budgetExceeded ? "Privacy budget blocked request" : "Pre-flight privacy guard triggered"
    );
    PrivacyAuditVault.getInstance().record({
      goal: taskStr,
      subtask: taskStr,
      disclosureLevel: resolution.disclosure.level,
      entitiesMasked: extractSensitiveEntityTypes(pageState),
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

  const validation = validateAction(resolution.action, pageState, document);

  if (!validation.valid || validation.verdict === "BLOCK") {
    overlayManager.updateHUD("BLOCKED", "Action blocked by safety policy");
    PrivacyAuditVault.getInstance().record({
      goal: taskStr, subtask: taskStr, disclosureLevel: resolution.disclosure.level,
      entitiesMasked: extractSensitiveEntityTypes(pageState), outboundBytes: resolution.networkBytesSent,
      action: resolution.action.action, targetId: resolution.action.target_id,
      riskVerdict: "BLOCK", policyApplied: validation.error || "Blocked by security policy", isLocal: resolution.isLocal,
    });
    return { success: false, resolution, validation, error: validation.error || "Action blocked by security policy." };
  }

  if (validation.verdict === "CONFIRM") {
    overlayManager.updateHUD("CONFIRM", "User confirmation required");
    PrivacyAuditVault.getInstance().record({
      goal: taskStr, subtask: taskStr, disclosureLevel: resolution.disclosure.level,
      entitiesMasked: extractSensitiveEntityTypes(pageState), outboundBytes: resolution.networkBytesSent,
      action: resolution.action.action, targetId: resolution.action.target_id,
      riskVerdict: "CONFIRM", policyApplied: validation.policyResult?.requiredUserConfirmation || "High-risk action", isLocal: resolution.isLocal,
    });
    return { success: false, resolution, validation, error: `Requires confirmation: ${validation.policyResult?.requiredUserConfirmation || "High-risk action"}` };
  }

  overlayManager.updateHUD(resolution.disclosure.level, `Executing ${resolution.action.action}`);
  const execution = await executeAction(resolution.action, {
    pageState,
    doc: document,
  });
  overlayManager.updateHUD(resolution.disclosure.level, execution.success ? "Done" : "Execution failed");

  PrivacyAuditVault.getInstance().record({
    goal: taskStr, subtask: taskStr, disclosureLevel: resolution.disclosure.level,
    entitiesMasked: extractSensitiveEntityTypes(pageState), outboundBytes: resolution.networkBytesSent,
    action: resolution.action.action, targetId: resolution.action.target_id,
    riskVerdict: validation.verdict, policyApplied: execution.error || "Executed successfully", isLocal: resolution.isLocal,
  });

  return { success: execution.success, resolution, validation, execution, error: execution.error };
}
