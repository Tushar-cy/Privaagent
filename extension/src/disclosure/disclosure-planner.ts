// Minimum Disclosure Planner: Implements the L0-L3 ladder to select
// the least disclosing payload required to resolve the user task.

import { Disclosure, DisclosureLevel, PageState } from "../common/types";
import { maskPageStateForDisclosure } from "./semantic-masker";

export interface DisclosurePlanningOptions {
  isSolvableLocally: boolean;
  requiresVision: boolean;
  targetCropTargetId?: string;
  sanitizedScreenshotBase64?: string;
  resolveLiveElement?: (targetId: string) => Element | null;
}

/**
 * Plans the minimal disclosure payload required to solve the task.
 */
export function planDisclosure(
  task: string,
  pageState: PageState,
  options: DisclosurePlanningOptions
): Disclosure {
  // L0: Local Only
  // If the local task solver can resolve the action safely, zero network transmission occurs.
  if (options.isSolvableLocally) {
    return {
      level: "L0",
      reason: "Task is safely solvable on-device via local DOM heuristics; zero network bytes transmitted.",
      task,
      elements: [],
      redacted_token_count: 0,
    };
  }

  // L2: Sanitized Visual Crop
  // Required when task relies on non-DOM visual regions (canvas, charts, images)
  if (options.requiresVision && options.targetCropTargetId) {
    const targetElement = pageState.elements.find(
      (el) => el.target_id === options.targetCropTargetId
    );

    const { disclosedElements, totalRedactedTokens } = maskPageStateForDisclosure(
      pageState,
      options.resolveLiveElement
    );

    return {
      level: "L2",
      reason: `Target element "${options.targetCropTargetId}" requires visual reasoning; transmitting sanitized visual crop ROI only.`,
      task,
      elements: disclosedElements.filter((el) => {
        if (el.target_id === options.targetCropTargetId) return true;
        const originalEl = pageState.elements.find((orig) => orig.target_id === el.target_id);
        return originalEl && (originalEl.metadata as any)?.derived_from === options.targetCropTargetId;
      }),
      crop_box: targetElement?.bbox,
      screenshot_data: options.sanitizedScreenshotBase64,
      redacted_token_count: totalRedactedTokens,
    };
  }

  // L1: Structured Semantic Context
  // Solvable via text/form/table reasoning; only tokenized, anonymized metadata leaves device.
  const { disclosedElements, totalRedactedTokens } = maskPageStateForDisclosure(
    pageState,
    options.resolveLiveElement
  );

  return {
    level: "L1",
    reason: "Local solver requires remote VLM reasoning over structured semantic element tree; all sensitive spans replaced with tokens.",
    task,
    elements: disclosedElements,
    redacted_token_count: totalRedactedTokens,
  };
}
