// Type Executor: Injects text into input or textarea elements.

import { resolveElementByTargetId } from "../semantic/dom-extractor";
import { ExecutionResult } from "./click";

export function executeType(targetId: string, text: string, verifiedElement?: Element | null): ExecutionResult {
  const element = verifiedElement || resolveElementByTargetId(targetId);

  if (!element) {
    return {
      success: false,
      target_id: targetId,
      error: `Target element "${targetId}" not found in current DOM.`,
    };
  }

  if (!element.isConnected) {
    return {
      success: false,
      target_id: targetId,
      error: `Target element "${targetId}" is detached from the active document.`,
    };
  }

  const tagName = element.tagName.toLowerCase();
  const isInput = tagName === "input";
  const isTextArea = tagName === "textarea";
  const editableAttribute = element.getAttribute("contenteditable");
  const isContentEditable = (editableAttribute !== null && editableAttribute.toLowerCase() !== "false") ||
    (element as HTMLElement).isContentEditable === true;
  const inputType = isInput ? ((element as HTMLInputElement).type || "text").toLowerCase() : "";

  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
    return { success: false, target_id: targetId, error: `Element "${targetId}" is disabled.` };
  }

  if (element.hasAttribute("readonly") || element.getAttribute("aria-readonly") === "true") {
    return { success: false, target_id: targetId, error: `Element "${targetId}" is read-only.` };
  }

  if ((!isInput && !isTextArea && !isContentEditable) ||
      (isInput && ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(inputType))) {
    return {
      success: false,
      target_id: targetId,
      error: `Element "${targetId}" (${element.tagName}) does not accept text input.`,
    };
  }

  // Scroll into view & focus if available
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
  }
  if (typeof (element as HTMLElement).focus === "function") {
    (element as HTMLElement).focus();
  }

  if (isInput || isTextArea) {
    const inputElement = element as HTMLInputElement | HTMLTextAreaElement;

    // React/Framework synthetic event compatibility setter
    const win = element.ownerDocument.defaultView;
    const prototype = isInput
      ? win?.HTMLInputElement?.prototype
      : win?.HTMLTextAreaElement?.prototype;
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : undefined;

    if (descriptor && descriptor.set) {
      descriptor.set.call(inputElement, text);
    } else {
      inputElement.value = text;
    }

    const EventCtor = (win as any)?.Event || Event;

    // Trigger input and change events
    inputElement.dispatchEvent(new EventCtor("input", { bubbles: true, cancelable: true }));
    inputElement.dispatchEvent(new EventCtor("change", { bubbles: true, cancelable: true }));
    if (inputElement.value !== text) {
      return { success: false, target_id: targetId, error: "The input value did not accept the requested text." };
    }
  } else if (isContentEditable) {
    (element as HTMLElement).textContent = text;
    const win = element.ownerDocument.defaultView || (typeof window !== "undefined" ? window : globalThis);
    const EventCtor = (win as any).Event || Event;
    element.dispatchEvent(new EventCtor("input", { bubbles: true, cancelable: true }));
    if (element.textContent !== text) {
      return { success: false, target_id: targetId, error: "The editable element did not accept the requested text." };
    }
  }

  return {
    success: true,
    target_id: targetId,
  };
}
