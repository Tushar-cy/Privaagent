// Multi-Turn Autonomous Agent Loop
// Decomposes compound procedural goals, coordinates step-by-step perception and execution,
// enforces the session privacy budget, and halts upon security risk.

import { Action, DisclosureLevel, PageState, VisualRedactionManifest } from "../common/types";
import { decomposeGoal, DecomposedGoal } from "./goal-decomposer";
import { SessionPrivacyBudget, BudgetLimits } from "./privacy-budget";
import { resolveTaskAction, AgentResolutionResult } from "./target-resolver";
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
  status: "SUCCESS" | "FAILED" | "PAUSED_CONFIRMATION" | "BUDGET_EXCEEDED" | "NAVIGATION_PENDING";
  totalSteps: number;
  cumulativeBytesSent: number;
  history: StepRecord[];
  error?: string;
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
}

/**
 * Runs an end-to-end multi-turn autonomous goal execution loop.
 */
export async function runMultiTurnAgent(
  goalStr: string,
  initialPageState?: PageState,
  options: AgentLoopOptions = {}
): Promise<MultiTurnGoalResult> {
  const doc = options.doc || (typeof document !== "undefined" ? document : null);
  const decomposed = decomposeGoal(goalStr);
  const budget = new SessionPrivacyBudget(options.budgetLimits);
  const history: StepRecord[] = [];

  let currentState: PageState | null = initialPageState
    ? annotatePageStateSensitivity(initialPageState)
    : doc
      ? extractAnnotatedPageState()
      : null;

  for (let i = 0; i < decomposed.subtasks.length; i++) {
    const subtask = decomposed.subtasks[i];
    const stepNum = i + 1;

    // 1. Budget verification
    if (!budget.canExecuteNextStep()) {
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
      beforeRemoteRequest: (_disclosure, outboundBytes) => budget.canEscalate(outboundBytes),
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

    // Account for the request immediately after it returns, including remote
    // responses that are later paused or rejected by action validation.
    budget.recordStep(
      resolution.externalRequestMade ? resolution.networkBytesSent : 0,
      resolution.externalRequestMade
    );
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
        bytesSent: resolution.networkBytesSent,
        latencyMs: resolution.latencyMs,
        success: false,
        verdict: "BLOCK",
        error: blockMsg,
      });

      PrivacyAuditVault.getInstance().record({
        goal: goalStr,
        subtask,
        disclosureLevel: resolution.disclosure?.level || "L0",
        entitiesMasked: extractSensitiveEntityTypes(currentState),
        outboundBytes: resolution.networkBytesSent,
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
        bytesSent: resolution.networkBytesSent,
        latencyMs: resolution.latencyMs,
        success: false,
        verdict: validation.verdict,
        error: validation.error,
      });

      PrivacyAuditVault.getInstance().record({
        goal: goalStr,
        subtask,
        disclosureLevel: resolution.disclosure.level,
        entitiesMasked: extractSensitiveEntityTypes(currentState),
        outboundBytes: resolution.networkBytesSent,
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
        bytesSent: resolution.networkBytesSent,
        latencyMs: resolution.latencyMs,
        success: false,
        verdict: "CONFIRM",
        error: validation.policyResult?.requiredUserConfirmation || "Action requires user confirmation.",
      });

      PrivacyAuditVault.getInstance().record({
        goal: goalStr,
        subtask,
        disclosureLevel: resolution.disclosure.level,
        entitiesMasked: extractSensitiveEntityTypes(currentState),
        outboundBytes: resolution.networkBytesSent,
        action: resolution.action.action,
        targetId: resolution.action.target_id,
        riskVerdict: "CONFIRM",
        policyApplied: validation.policyResult?.requiredUserConfirmation || "Action requires user confirmation.",
        isLocal: resolution.isLocal,
      });

      return {
        goal: goalStr,
        decomposed,
        status: "PAUSED_CONFIRMATION",
        totalSteps: history.length,
        cumulativeBytesSent: postResolutionBudget.cumulativeBytesSent,
        history,
        error: validation.policyResult?.requiredUserConfirmation || "Action requires user confirmation.",
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
      bytesSent: resolution.networkBytesSent,
      latencyMs: resolution.latencyMs,
      success: execution.success,
      verdict: validation.verdict,
      error: execution.error,
    });

    PrivacyAuditVault.getInstance().record({
      goal: goalStr,
      subtask,
      disclosureLevel: resolution.disclosure.level,
      entitiesMasked: extractSensitiveEntityTypes(currentState),
      outboundBytes: resolution.networkBytesSent,
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
