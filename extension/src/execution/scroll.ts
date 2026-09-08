// Scroll Executor: Handles viewport or element-specific scrolling.

import { resolveElementByTargetId } from "../semantic/dom-extractor";
import { ExecutionResult } from "./click";

export function executeScroll(
  targetId: string,
  delta?: { x: number; y: number }
): ExecutionResult {
  const dx = delta?.x ?? 0;
  const dy = delta?.y ?? 0;

  // Viewport scroll if target_id is window or body
  if (targetId === "window" || targetId === "body" || targetId === "viewport") {
    window.scrollBy({
      left: dx,
      top: dy,
      behavior: "smooth",
    });
    return { success: true, target_id: targetId };
  }

  const element = resolveElementByTargetId(targetId);
  if (!element) {
    return {
      success: false,
      target_id: targetId,
      error: `Target element "${targetId}" not found for scrolling.`,
    };
  }

  if (dx !== 0 || dy !== 0) {
    element.scrollBy({
      left: dx,
      top: dy,
      behavior: "smooth",
    });
  } else {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }

  return { success: true, target_id: targetId };
}
