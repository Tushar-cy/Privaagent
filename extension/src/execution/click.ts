// Click Executor: Dispatches click events to a verified live DOM element.

import { resolveElementByTargetId } from "../semantic/dom-extractor";

export interface ExecutionResult {
  success: boolean;
  target_id: string;
  error?: string;
  navigationPending?: boolean;
}

export function executeClick(
  targetId: string,
  verifiedElement?: Element | null,
  clickPoint?: { x: number; y: number }
): ExecutionResult {
  const element = verifiedElement || resolveElementByTargetId(targetId);

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

  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
    return { success: false, target_id: targetId, error: `Target element "${targetId}" is disabled.` };
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

  // Preserve the intended relative point for derived chart/canvas targets,
  // because scrolling can change the element's viewport coordinates.
  const pointRatio = clickPoint && rect.width > 0 && rect.height > 0
    ? { x: (clickPoint.x - rect.left) / rect.width, y: (clickPoint.y - rect.top) / rect.height }
    : undefined;

  // Scroll into view before calculating the final click coordinates.
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
  }

  const win = element.ownerDocument.defaultView || (typeof window !== "undefined" ? window : globalThis);
  const MouseEventCtor = (win as any).MouseEvent || MouseEvent;
  const PointerEventCtor = (win as any).PointerEvent || null;
  const currentRect = element.getBoundingClientRect();
  if (currentRect.width <= 0 || currentRect.height <= 0) {
    return { success: false, target_id: targetId, error: "Target element became non-visible while scrolling into view." };
  }

  const centerX = pointRatio
    ? currentRect.left + Math.max(0, Math.min(1, pointRatio.x)) * currentRect.width
    : currentRect.left + currentRect.width / 2;
  const centerY = pointRatio
    ? currentRect.top + Math.max(0, Math.min(1, pointRatio.y)) * currentRect.height
    : currentRect.top + currentRect.height / 2;

  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: win as any,
    clientX: centerX,
    clientY: centerY,
  };

  if (PointerEventCtor) {
    try {
      element.dispatchEvent(new PointerEventCtor("pointerdown", { ...eventInit, button: 0, buttons: 1, pointerType: "mouse", isPrimary: true }));
    } catch (_) {}
  }
  element.dispatchEvent(new MouseEventCtor("mousedown", { ...eventInit, button: 0, buttons: 1 }));
  if (PointerEventCtor) {
    try {
      element.dispatchEvent(new PointerEventCtor("pointerup", { ...eventInit, button: 0, buttons: 0, pointerType: "mouse", isPrimary: true }));
    } catch (_) {}
  }
  element.dispatchEvent(new MouseEventCtor("mouseup", { ...eventInit, button: 0, buttons: 0 }));

  if (clickPoint) {
    // A visual target is a coordinate on a canvas/chart. HTMLElement.click()
    // discards that coordinate and fires an additional center click.
    element.dispatchEvent(new MouseEventCtor("click", { ...eventInit, button: 0, buttons: 0 }));
  } else if ((win as any).HTMLElement && element instanceof (win as any).HTMLElement) {
    if (typeof (element as HTMLElement).focus === "function") (element as HTMLElement).focus();
    element.click();
  } else {
    element.dispatchEvent(new MouseEventCtor("click", { ...eventInit, button: 0, buttons: 0 }));
  }

  return {
    success: true,
    target_id: targetId,
  };
}
