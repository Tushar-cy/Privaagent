// Unified Action Execution Engine — Single Universal Gate
// Enforces mandatory pre-execution validation across ALL action invocation paths.

import { Action, ActionSchema, PageState } from "../common/types";
import { validateAction } from "../validator/action-validator";
import { executeClick, ExecutionResult } from "./click";
import { executeType } from "./type";
import { executeScroll } from "./scroll";
import { executeNavigate } from "./navigate";

export type { ExecutionResult };

export interface ActionExecutionContext {
  pageState?: PageState;
  doc?: Document;
  userConfirmed?: boolean;
}

/**
 * Low-level DOM event dispatcher. PRIVATE to this module: cannot be invoked directly
 * from outside without passing through executeAction.
 */
async function dispatchLowLevelAction(
  validAction: Action,
  verifiedElement: Element | null,
  clickPoint?: { x: number; y: number }
): Promise<ExecutionResult> {
  switch (validAction.action) {
    case "click":
      return executeClick(validAction.target_id, verifiedElement, clickPoint);

    case "type":
      return executeType(validAction.target_id, validAction.value ?? "", verifiedElement);

    case "scroll":
      return executeScroll(validAction.target_id, validAction.delta, verifiedElement);

    case "navigate":
      return executeNavigate(validAction.url || validAction.value);

    case "select": {
      const el = verifiedElement;
      if (el instanceof HTMLSelectElement) {
        el.value = validAction.value ?? "";
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true, target_id: validAction.target_id };
      }
      return {
        success: false,
        target_id: validAction.target_id,
        error: `Element "${validAction.target_id}" is not an HTMLSelectElement.`,
      };
    }

    default:
      return {
        success: false,
        target_id: validAction.target_id,
        error: `Unsupported action type: ${(validAction as Action).action}`,
      };
  }
}

/**
 * UNIVERSAL EXECUTION GATE:
 * The single, mandatory gatekeeper through which EVERY browser agent action must pass.
 * Validates action schema, verifies DOM attachment and semantic binding, enforces
 * risk policies (ALLOW/CONFIRM/BLOCK), and prevents any unvalidated execution bypass.
 */
export async function executeAction(
  action: Action,
  context?: ActionExecutionContext
): Promise<ExecutionResult> {
  const parseResult = ActionSchema.safeParse(action);
  if (!parseResult.success) {
    return {
      success: false,
      target_id: action.target_id || "unknown",
      error: `Invalid action schema: ${parseResult.error.message}`,
    };
  }

  const validAction = parseResult.data;

  // Enforce mandatory security and semantic validation
  const doc = context?.doc || (typeof document !== "undefined" ? document : undefined);
  const pageState = context?.pageState || (typeof window !== "undefined" ? (window as any).__privaagent_page_state : undefined);
  const valResult = validateAction(validAction, pageState, doc);

  if (!valResult.valid || valResult.verdict === "BLOCK") {
    return {
      success: false,
      target_id: validAction.target_id,
      error: `Action BLOCKED by security validator: ${valResult.error || "Policy violation"}`,
    };
  }

  if (valResult.verdict === "CONFIRM" && context?.userConfirmed !== true && (validAction as any).user_confirmed !== true) {
    return {
      success: false,
      target_id: validAction.target_id,
      error: `Execution paused: Confirmation required (${valResult.policyResult?.requiredUserConfirmation || "User approval required"})`,
    };
  }

  return dispatchLowLevelAction(validAction, valResult.element, valResult.clickPoint);
}
