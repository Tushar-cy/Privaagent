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

  // Scroll into view if off-screen and method exists
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
  }

  const win = element.ownerDocument.defaultView || (typeof window !== "undefined" ? window : globalThis);
  const MouseEventCtor = (win as any).MouseEvent || MouseEvent;
  const PointerEventCtor = (win as any).PointerEvent || null;

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: win as any,
    clientX: centerX,
    clientY: centerY,
  };

  if (PointerEventCtor) {
    try {
      element.dispatchEvent(new PointerEventCtor("pointerdown", eventInit));
    } catch (_) {}
  }
  element.dispatchEvent(new MouseEventCtor("mousedown", eventInit));
  if (PointerEventCtor) {
    try {
      element.dispatchEvent(new PointerEventCtor("pointerup", eventInit));
    } catch (_) {}
  }
  element.dispatchEvent(new MouseEventCtor("mouseup", eventInit));

  if (element instanceof HTMLElement) {
    element.click();
    if (typeof element.focus === "function") element.focus();
  } else {
    element.dispatchEvent(new MouseEventCtor("click", eventInit));
  }

  return {
    success: true,
    target_id: targetId,
  };
}
