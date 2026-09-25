// Multi-Turn Autonomous Agent Loop
// Decomposes compound procedural goals, coordinates step-by-step perception and execution,
// enforces the session privacy budget, and halts upon security risk.

import { Action, DisclosureLevel, PageState, VisualRedactionManifest } from "../common/types";
import { decomposeGoal, DecomposedGoal } from "./goal-decomposer";
import { SessionPrivacyBudget, BudgetLimits, AgentPrivacyBudget } from "./privacy-budget";
import { resolveTaskAction, AgentResolutionResult, perceptionStillMatchesLiveDom } from "./target-resolver";
import { validateAction, ValidationResult } from "../validator/action-validator";
import { executeAction, ExecutionResult } from "../execution";
import { extractPageState } from "../semantic/dom-extractor";
import { annotatePageStateSensitivity } from "../privacy/sensitivity";
import { PrivacyAuditVault } from "../privacy/audit-vault";

export interface StepRecord {
  stepIndex: number;
  subtask: string;
  action: Action;
  isLocal: boolean;
  level: string;
  bytesSent: number;
  latencyMs: number;
  success: boolean;
  verdict: string;
  error?: string;
  visualTrace?: {
    level: "L2" | "L3";
    targetRoi?: number[];
    sourceSensitiveBoxCount: number;
    redactedBoxCount: number;
    redactedBoxes: number[][];
  };
}

function visualDisclosureTrace(resolution: AgentResolutionResult): StepRecord["visualTrace"] {
  const disclosure = resolution.disclosure;
  if (disclosure.level !== "L2" && disclosure.level !== "L3") return undefined;
  const manifest = disclosure.redaction_manifest;
  return {
    level: disclosure.level,
    targetRoi: disclosure.crop_box ? [...disclosure.crop_box] : undefined,
    sourceSensitiveBoxCount: manifest?.sourceSensitiveBoxCount || 0,
    redactedBoxCount: manifest?.redactedBoxCount || 0,
    redactedBoxes: (manifest?.redactedBoxes || []).map((box) => [...box]),
  };
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

function extractAnnotatedPageState(): PageState {
  return annotatePageStateSensitivity(extractPageState().pageState);
}

export interface MultiTurnGoalResult {
  goal: string;
  decomposed: DecomposedGoal;
  status: "SUCCESS" | "FAILED" | "CANCELLED" | "PAUSED_CONFIRMATION" | "BUDGET_EXCEEDED" | "NAVIGATION_PENDING";
  totalSteps: number;
  cumulativeBytesSent: number;
  history: StepRecord[];
  error?: string;
  continuationId?: string;
}

export interface AgentLoopOptions {
  budgetLimits?: BudgetLimits;
  maxDisclosureLevel?: DisclosureLevel;
  doc?: Document;
  delayBetweenStepsMs?: number;
  fetchFn?: typeof fetch;
  sanitizedScreenshotBase64?: string;
  sanitizedScreenshotManifest?: VisualRedactionManifest;
  resolveLiveElement?: (targetId: string) => Element | null;
  sessionBudget?: AgentPrivacyBudget;
}

interface AgentRunContext {
  decomposed: DecomposedGoal;
  history: StepRecord[];
  budget: AgentPrivacyBudget;
  startIndex: number;
}

interface PendingAgentContinuation {
  goal: string;
  options: AgentLoopOptions;
  runContext: AgentRunContext;
  pageState: PageState;
  resolution: AgentResolutionResult;
  stepIndex: number;
  expiresAt: number;
}

const pendingContinuations = new Map<string, PendingAgentContinuation>();
const CONTINUATION_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_CONTINUATIONS = 32;

function newContinuationId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function prunePendingContinuations(): void {
  const now = Date.now();
  for (const [id, pending] of pendingContinuations) {
    if (pending.expiresAt <= now) pendingContinuations.delete(id);
  }
  while (pendingContinuations.size >= MAX_PENDING_CONTINUATIONS) {
    const oldestId = pendingContinuations.keys().next().value as string | undefined;
    if (!oldestId) break;
    pendingContinuations.delete(oldestId);
  }
}

/**
 * Runs an end-to-end multi-turn autonomous goal execution loop.
 */
export async function runMultiTurnAgent(
  goalStr: string,
  initialPageState?: PageState,
  options: AgentLoopOptions = {}
): Promise<MultiTurnGoalResult> {
  return runAgentLoop(goalStr, initialPageState, options);
}

/** Consumes a one-use approval continuation, revalidates the retained target, then resumes the goal. */
export async function resumeMultiTurnAgent(
  continuationId: string,
  approved: boolean
): Promise<MultiTurnGoalResult> {
  const pending = pendingContinuations.get(continuationId);
  pendingContinuations.delete(continuationId);
  if (!pending || pending.expiresAt <= Date.now()) {
    return {
      goal: "",
      decomposed: decomposeGoal(""),
      status: "FAILED",
      totalSteps: 0,
      cumulativeBytesSent: 0,
      history: [],
      error: "This approval expired or was already used. Run the goal again.",
    };
  }

  const { goal, options, runContext, pageState, resolution, stepIndex } = pending;
  const lastStep = runContext.history[runContext.history.length - 1];
  const finish = (status: MultiTurnGoalResult["status"], error: string): MultiTurnGoalResult => {
    if (lastStep?.stepIndex === stepIndex + 1) {
      lastStep.success = false;
      lastStep.error = error;
      if (status === "CANCELLED") lastStep.verdict = "CANCELLED";
    }
    return {
      goal,
      decomposed: runContext.decomposed,
      status,
      totalSteps: runContext.history.length,
      cumulativeBytesSent: runContext.budget.getStatus().cumulativeBytesSent,
      history: runContext.history,
      error,
    };
  };

  if (!approved) {
    PrivacyAuditVault.getInstance().record({
      goal,
      subtask: runContext.decomposed.subtasks[stepIndex],
      disclosureLevel: resolution.disclosure.level,
      entitiesMasked: extractSensitiveEntityTypes(pageState),
      outboundBytes: 0,
      action: resolution.action.action,
      targetId: resolution.action.target_id,
      riskVerdict: "CANCELLED",
      policyApplied: "User declined the pending confirmation; action was not executed.",
      isLocal: true,
    });
    return finish("CANCELLED", "Cancelled. The pending action was not executed.");
  }

  const doc = options.doc || (typeof document !== "undefined" ? document : null);
  if (!doc || !perceptionStillMatchesLiveDom(pageState)) {
    return finish("FAILED", "The page or target changed while approval was pending. The action was not executed; run the goal again.");
  }

  const validation: ValidationResult = validateAction(resolution.action, pageState, doc);
  if (!validation.valid || validation.verdict === "BLOCK") {
    return finish("FAILED", validation.error || "The approved action no longer passes validation.");
  }

  const subtask = runContext.decomposed.subtasks[stepIndex];
  const execution = await executeAction(resolution.action, {
    pageState,
    doc,
    userConfirmed: true,
  });

  if (lastStep?.stepIndex === stepIndex + 1) {
    lastStep.success = execution.success;
    lastStep.error = execution.error;
  }
  PrivacyAuditVault.getInstance().record({
    goal,
    subtask,
    disclosureLevel: resolution.disclosure.level,
    entitiesMasked: extractSensitiveEntityTypes(pageState),
    outboundBytes: 0,
    action: resolution.action.action,
    targetId: resolution.action.target_id,
    riskVerdict: execution.success ? "CONFIRM" : "BLOCK",
    policyApplied: execution.success
      ? "User approved; the exact retained target passed live-page revalidation and executed."
      : execution.error || "The approved action failed during execution.",
    isLocal: true,
  });

  if (!execution.success) {
    return finish("FAILED", `Approved action failed: ${execution.error || "Unknown execution error"}`);
  }
  if (execution.navigationPending && stepIndex + 1 < runContext.decomposed.subtasks.length) {
    return {
      goal,
      decomposed: runContext.decomposed,
      status: "NAVIGATION_PENDING",
      totalSteps: runContext.history.length,
      cumulativeBytesSent: runContext.budget.getStatus().cumulativeBytesSent,
      history: runContext.history,
      error: "Navigation started. Remaining steps need fresh perception after the destination page loads.",
    };
  }

  if (options.delayBetweenStepsMs && options.delayBetweenStepsMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, options.delayBetweenStepsMs));
  }
  const nextPageState = doc === (typeof document !== "undefined" ? document : null)
    ? extractAnnotatedPageState()
    : pageState;
  return runAgentLoop(goal, nextPageState, options, {
    ...runContext,
    startIndex: stepIndex + 1,
  });
}

async function runAgentLoop(
  goalStr: string,
  initialPageState: PageState | undefined,
  options: AgentLoopOptions,
  resumedContext?: AgentRunContext
): Promise<MultiTurnGoalResult> {
  const doc = options.doc || (typeof document !== "undefined" ? document : null);
  const decomposed = resumedContext?.decomposed || decomposeGoal(goalStr);
  const budget = resumedContext?.budget || options.sessionBudget || new SessionPrivacyBudget(options.budgetLimits);
  const history = resumedContext?.history || [];

  let currentState: PageState | null = initialPageState
    ? annotatePageStateSensitivity(initialPageState)
    : doc
      ? extractAnnotatedPageState()
      : null;

  for (let i = resumedContext?.startIndex || 0; i < decomposed.subtasks.length; i++) {
    const subtask = decomposed.subtasks[i];
    const stepNum = i + 1;

    // 1. Budget verification
    if (!await budget.reserveStep()) {
      const budgetStatus = budget.getStatus();
      return {
        goal: goalStr,
        decomposed,
        status: "BUDGET_EXCEEDED",
        totalSteps: history.length,
        cumulativeBytesSent: budgetStatus.cumulativeBytesSent,
        history,
        error: `Maximum step limit reached (${budget.getSteps()} >= ${budget.getMaxSteps()}). Halting loop.`,
      };
    }

    const budgetStatus = budget.getStatus();
    if (budgetStatus.exceeded) {
      return {
        goal: goalStr,
        decomposed,
        status: "BUDGET_EXCEEDED",
        totalSteps: history.length,
        cumulativeBytesSent: budgetStatus.cumulativeBytesSent,
        history,
        error: budgetStatus.reason,
      };
    }

    // 2. Perceive from the live DOM at the start of every step. The mutation
    // observer's latest value can lag while asynchronous resolution is pending.
    if (doc && typeof document !== "undefined" && doc === document) {
      currentState = extractAnnotatedPageState();
    }
    if (!currentState) {
      return {
        goal: goalStr,
        decomposed,
        status: "FAILED",
        totalSteps: history.length,
        cumulativeBytesSent: budgetStatus.cumulativeBytesSent,
        history,
        error: "Unable to perceive current DOM state.",
      };
    }

    // 3. Resolve action for current subtask
    const resolution: AgentResolutionResult = await resolveTaskAction(subtask, currentState, {
      fetchFn: options.fetchFn,
      sanitizedScreenshotBase64: options.sanitizedScreenshotBase64,
      sanitizedScreenshotManifest: options.sanitizedScreenshotManifest,
      resolveLiveElement: options.resolveLiveElement,
      maxDisclosureLevel: options.maxDisclosureLevel,
      beforeRemoteRequest: (_disclosure, outboundBytes) => budget.reserveRemote(outboundBytes),
    });

    // The resolver checks byte and call limits before sending. A rejected
    // request must stop here so it cannot be misreported as a privacy BLOCK.
    if (resolution.budgetExceeded) {
      const blockReason = resolution.blockReason || "Session privacy budget is exhausted; outbound request was not sent.";
      PrivacyAuditVault.getInstance().record({
        goal: goalStr,
        subtask,
        disclosureLevel: resolution.disclosure.level,
        entitiesMasked: extractSensitiveEntityTypes(currentState),
        outboundBytes: 0,
        action: "block",
        targetId: "none",
        riskVerdict: "BLOCK",
        policyApplied: blockReason,
        isLocal: true,
      });
      return {
        goal: goalStr,
        decomposed,
        status: "BUDGET_EXCEEDED",
        totalSteps: history.length,
        cumulativeBytesSent: budget.getStatus().cumulativeBytesSent,
        history,
        error: blockReason,
      };
    }

    // Step and remote-disclosure limits are reserved before work begins, so
    // they also cover failed requests and survive a page navigation.
    const postResolutionBudget = budget.getStatus();

    // 3b. Pre-flight Security Block Check (e.g., global prompt injection detected)
    if (resolution.processingPath === "BLOCKED") {
      const blockMsg = resolution.blockReason || "Action resolution blocked by security policy.";
      history.push({
        stepIndex: stepNum,
        subtask,
        action: resolution.action,
        isLocal: resolution.isLocal,
        level: resolution.disclosure?.level || "L0",
        bytesSent: resolution.reservedOutboundBytes,
        latencyMs: resolution.latencyMs,
        success: false,
        verdict: "BLOCK",
        error: blockMsg,
        visualTrace: visualDisclosureTrace(resolution),
      });

      PrivacyAuditVault.getInstance().record({
        goal: goalStr,
        subtask,
        disclosureLevel: resolution.disclosure?.level || "L0",
        entitiesMasked: extractSensitiveEntityTypes(currentState),
        outboundBytes: resolution.reservedOutboundBytes,
        action: resolution.action.action,
        targetId: resolution.action.target_id,
        riskVerdict: "BLOCK",
        policyApplied: blockMsg,
        isLocal: resolution.isLocal,
      });

      return {
        goal: goalStr,
        decomposed,
        status: "FAILED",
        totalSteps: history.length,
        cumulativeBytesSent: postResolutionBudget.cumulativeBytesSent,
        history,
        error: `Security Policy BLOCKED subtask "${subtask}": ${blockMsg}`,
      };
    }

    // 4. Pre-execution Safety Validation
    const validation: ValidationResult = doc
      ? validateAction(resolution.action, currentState, doc)
      : { valid: true, verdict: "ALLOW", element: null };

    if (!validation.valid || validation.verdict === "BLOCK") {
      history.push({
        stepIndex: stepNum,
        subtask,
        action: resolution.action,
        isLocal: resolution.isLocal,
        level: resolution.disclosure.level,
        bytesSent: resolution.reservedOutboundBytes,
        latencyMs: resolution.latencyMs,
        success: false,
        verdict: validation.verdict,
        error: validation.error,
        visualTrace: visualDisclosureTrace(resolution),
      });

      PrivacyAuditVault.getInstance().record({
        goal: goalStr,
        subtask,
        disclosureLevel: resolution.disclosure.level,
        entitiesMasked: extractSensitiveEntityTypes(currentState),
        outboundBytes: resolution.reservedOutboundBytes,
        action: resolution.action.action,
        targetId: resolution.action.target_id,
        riskVerdict: "BLOCK",
        policyApplied: validation.error || "Blocked by security policy",
        isLocal: resolution.isLocal,
      });

      return {
        goal: goalStr,
        decomposed,
        status: "FAILED",
        totalSteps: history.length,
        cumulativeBytesSent: postResolutionBudget.cumulativeBytesSent,
        history,
        error: `Security Policy BLOCKED subtask "${subtask}": ${validation.error}`,
      };
    }

    if (validation.verdict === "CONFIRM") {
      history.push({
        stepIndex: stepNum,
        subtask,
        action: resolution.action,
        isLocal: resolution.isLocal,
        level: resolution.disclosure.level,
        bytesSent: resolution.reservedOutboundBytes,
        latencyMs: resolution.latencyMs,
        success: false,
        verdict: "CONFIRM",
        error: validation.policyResult?.requiredUserConfirmation || "Action requires user confirmation.",
        visualTrace: visualDisclosureTrace(resolution),
      });

      PrivacyAuditVault.getInstance().record({
        goal: goalStr,
        subtask,
        disclosureLevel: resolution.disclosure.level,
        entitiesMasked: extractSensitiveEntityTypes(currentState),
        outboundBytes: resolution.reservedOutboundBytes,
        action: resolution.action.action,
        targetId: resolution.action.target_id,
        riskVerdict: "CONFIRM",
        policyApplied: validation.policyResult?.requiredUserConfirmation || "Action requires user confirmation.",
        isLocal: resolution.isLocal,
      });

      prunePendingContinuations();
      const continuationId = newContinuationId();
      pendingContinuations.set(continuationId, {
        goal: goalStr,
        options,
        runContext: { decomposed, history, budget, startIndex: i },
        pageState: currentState,
        resolution,
        stepIndex: i,
        expiresAt: Date.now() + CONTINUATION_TTL_MS,
      });

      return {
        goal: goalStr,
        decomposed,
        status: "PAUSED_CONFIRMATION",
        totalSteps: history.length,
        cumulativeBytesSent: postResolutionBudget.cumulativeBytesSent,
        history,
        error: validation.policyResult?.requiredUserConfirmation || "Action requires user confirmation.",
        continuationId,
      };
    }

    // 5. Execute Action via Universal Execution Gate
    const execution: ExecutionResult = doc
      ? await executeAction(resolution.action, { pageState: currentState, doc, userConfirmed: false })
      : { success: true, target_id: resolution.action.target_id };

    // Record the action trajectory; network accounting was finalized directly
    // after resolution so rejected/confirmation-paused remote calls count too.
    history.push({
      stepIndex: stepNum,
      subtask,
      action: resolution.action,
      isLocal: resolution.isLocal,
      level: resolution.disclosure.level,
      bytesSent: resolution.reservedOutboundBytes,
      latencyMs: resolution.latencyMs,
      success: execution.success,
      verdict: validation.verdict,
      error: execution.error,
      visualTrace: visualDisclosureTrace(resolution),
    });

    PrivacyAuditVault.getInstance().record({
      goal: goalStr,
      subtask,
      disclosureLevel: resolution.disclosure.level,
      entitiesMasked: extractSensitiveEntityTypes(currentState),
      outboundBytes: resolution.reservedOutboundBytes,
      action: resolution.action.action,
      targetId: resolution.action.target_id,
      riskVerdict: validation.verdict,
      policyApplied: execution.error || "Execution completed",
      isLocal: resolution.isLocal,
    });

    const postStepBudget = budget.getStatus();
    if (postStepBudget.exceeded) {
      return {
        goal: goalStr,
        decomposed,
        status: "BUDGET_EXCEEDED",
        totalSteps: history.length,
        cumulativeBytesSent: postStepBudget.cumulativeBytesSent,
        history,
        error: postStepBudget.reason,
      };
    }

    if (!execution.success) {
      return {
        goal: goalStr,
        decomposed,
        status: "FAILED",
        totalSteps: history.length,
        cumulativeBytesSent: budget.getStatus().cumulativeBytesSent,
        history,
        error: `Execution failure in subtask "${subtask}": ${execution.error}`,
      };
    }

    if (execution.navigationPending && i + 1 < decomposed.subtasks.length) {
      return {
        goal: goalStr,
        decomposed,
        status: "NAVIGATION_PENDING",
        totalSteps: history.length,
        cumulativeBytesSent: budget.getStatus().cumulativeBytesSent,
        history,
        error: "Navigation started. Remaining steps need fresh perception after the destination page loads.",
      };
    }

    // 6. Stabilize DOM and prepare fresh perception for next step
    if (options.delayBetweenStepsMs && options.delayBetweenStepsMs > 0) {
      await new Promise((r) => setTimeout(r, options.delayBetweenStepsMs));
    }
    if (doc) {
      currentState = extractAnnotatedPageState();
    }
  }

  return {
    goal: goalStr,
    decomposed,
    status: "SUCCESS",
    totalSteps: history.length,
    cumulativeBytesSent: budget.getStatus().cumulativeBytesSent,
    history,
  };
}
