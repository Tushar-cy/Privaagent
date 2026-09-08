// Unified Action Execution Engine

import { Action, ActionSchema } from "../common/types";
import { executeClick, ExecutionResult } from "./click";
import { executeType } from "./type";
import { executeScroll } from "./scroll";
import { executeNavigate } from "./navigate";

export { executeClick, executeType, executeScroll, executeNavigate };
export type { ExecutionResult };

/**
 * Dispatches an action to the corresponding low-level executor.
 */
export async function executeAction(action: Action): Promise<ExecutionResult> {
  const parseResult = ActionSchema.safeParse(action);
  if (!parseResult.success) {
    return {
      success: false,
      target_id: action.target_id || "unknown",
      error: `Invalid action schema: ${parseResult.error.message}`,
    };
  }

  const validAction = parseResult.data;

  switch (validAction.action) {
    case "click":
      return executeClick(validAction.target_id);

    case "type":
      return executeType(validAction.target_id, validAction.value ?? "");

    case "scroll":
      return executeScroll(validAction.target_id, validAction.delta);

    case "navigate":
      return executeNavigate(validAction.url);

    case "select": {
      // Select is handled by setting select.value and triggering change
      const el = document.querySelector(`[data-privaagent-id="${validAction.target_id}"]`);
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
