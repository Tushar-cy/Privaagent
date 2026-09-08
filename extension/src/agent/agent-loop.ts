// Multi-Turn Autonomous Agent Loop
// Decomposes compound procedural goals, coordinates step-by-step perception and execution,
// enforces the session privacy budget, and halts upon security risk.

import { Action, PageState } from "../common/types";
import { decomposeGoal, DecomposedGoal } from "./goal-decomposer";
import { SessionPrivacyBudget, BudgetLimits } from "./privacy-budget";
import { resolveTaskAction, AgentResolutionResult } from "./target-resolver";
import { validateAction, ValidationResult } from "../validator/action-validator";
import { executeAction, ExecutionResult } from "../execution";
import { extractPageState } from "../semantic/dom-extractor";

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

export interface MultiTurnGoalResult {
  goal: string;
  decomposed: DecomposedGoal;
  status: "SUCCESS" | "FAILED" | "PAUSED_CONFIRMATION" | "BUDGET_EXCEEDED";
  totalSteps: number;
  cumulativeBytesSent: number;
  history: StepRecord[];
  error?: string;
}

export interface AgentLoopOptions {
  budgetLimits?: BudgetLimits;
  maxDisclosureLevel?: string;
  doc?: Document;
  delayBetweenStepsMs?: number;
  fetchFn?: typeof fetch;
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

  let currentState: PageState | null = initialPageState || (doc ? extractPageState().pageState : null);

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

    // 2. Refresh page state if needed
    if (!currentState && doc) {
      currentState = extractPageState().pageState;
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
    });

    // Enforce budget on remote calls
    if (!resolution.isLocal && !budget.canEscalate(resolution.networkBytesSent)) {
      return {
        goal: goalStr,
        decomposed,
        status: "BUDGET_EXCEEDED",
        totalSteps: history.length,
        cumulativeBytesSent: budgetStatus.cumulativeBytesSent,
        history,
        error: `Subtask "${subtask}" requires remote escalation, but session privacy budget is exhausted.`,
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

      return {
        goal: goalStr,
        decomposed,
        status: "FAILED",
        totalSteps: history.length,
        cumulativeBytesSent: budgetStatus.cumulativeBytesSent,
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

      return {
        goal: goalStr,
        decomposed,
        status: "PAUSED_CONFIRMATION",
        totalSteps: history.length,
        cumulativeBytesSent: budgetStatus.cumulativeBytesSent,
        history,
        error: validation.policyResult?.requiredUserConfirmation || "Action requires user confirmation.",
      };
    }

    // 5. Execute Action
    const execution: ExecutionResult = doc
      ? await executeAction(resolution.action)
      : { success: true, target_id: resolution.action.target_id };

    // Record in budget and trajectory
    budget.recordStep(resolution.networkBytesSent, !resolution.isLocal);

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

    // 6. Stabilize DOM and prepare fresh perception for next step
    if (options.delayBetweenStepsMs && options.delayBetweenStepsMs > 0) {
      await new Promise((r) => setTimeout(r, options.delayBetweenStepsMs));
    }
    if (doc) {
      currentState = extractPageState().pageState;
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
