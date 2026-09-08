// Type Executor: Injects text into input or textarea elements.

import { resolveElementByTargetId } from "../semantic/dom-extractor";
import { ExecutionResult } from "./click";

export function executeType(targetId: string, text: string): ExecutionResult {
  const element = resolveElementByTargetId(targetId);

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

  const isInput = element instanceof HTMLInputElement;
  const isTextArea = element instanceof HTMLTextAreaElement;
  const isContentEditable = (element as HTMLElement).isContentEditable;

  if (!isInput && !isTextArea && !isContentEditable) {
    return {
      success: false,
      target_id: targetId,
      error: `Element "${targetId}" (${element.tagName}) does not accept text input.`,
    };
  }

  // Scroll into view & focus
  element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
  (element as HTMLElement).focus();

  if (isInput || isTextArea) {
    const inputElement = element as HTMLInputElement | HTMLTextAreaElement;

    // React/Framework synthetic event compatibility setter
    const prototype = isInput
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(inputElement, text);
    } else {
      inputElement.value = text;
    }

    // Trigger input and change events
    inputElement.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    inputElement.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  } else if (isContentEditable) {
    (element as HTMLElement).textContent = text;
    element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  }

  return {
    success: true,
    target_id: targetId,
  };
}
