// Click Executor: Dispatches click events to a verified live DOM element.

import { resolveElementByTargetId } from "../semantic/dom-extractor";

export interface ExecutionResult {
  success: boolean;
  target_id: string;
  error?: string;
}

export function executeClick(targetId: string): ExecutionResult {
  const element = resolveElementByTargetId(targetId);

  if (!element) {
    return {
      success: false,
      target_id: targetId,
      error: `Target element "${targetId}" not found in current DOM.`,
    };
  }

  // Pre-action re-verification: attached and visible
  if (!element.isConnected) {
    return {
      success: false,
      target_id: targetId,
      error: `Target element "${targetId}" is detached from the active document.`,
    };
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0" ||
    rect.width === 0 ||
    rect.height === 0
  ) {
    return {
      success: false,
      target_id: targetId,
      error: `Target element "${targetId}" is not visible or has zero dimensions.`,
    };
  }

  // Scroll into view if off-screen
  element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });

  // Synthesize realistic user interaction sequence
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
  };

  element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
  element.dispatchEvent(new MouseEvent("mousedown", eventInit));
  element.dispatchEvent(new PointerEvent("pointerup", eventInit));
  element.dispatchEvent(new MouseEvent("mouseup", eventInit));

  if (element instanceof HTMLElement) {
    element.click();
    element.focus();
  } else {
    element.dispatchEvent(new MouseEvent("click", eventInit));
  }

  return {
    success: true,
    target_id: targetId,
  };
}
