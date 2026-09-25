// Pre-Execution Action & DOM Validator
// Verifies element presence, visibility, stability, and safety before execution.

import { Action, PageElement, PageState } from "../common/types";
import { inspectElementForHiddenInjection } from "./prompt-injection";
import { evaluateActionRisk, PolicyEvaluationResult, PolicyVerdict } from "./risk-policy";
import { getPerformanceProfiler } from "../common/profiler";

export interface ValidationResult {
  valid: boolean;
  verdict: PolicyVerdict;
  element: Element | null;
  error?: string;
  policyResult?: PolicyEvaluationResult;
  requiresReplan?: boolean;
  clickPoint?: { x: number; y: number };
}

export interface ValidatorOptions {
  currentOrigin?: string;
  allowedDriftPx?: number; // Maximum allowed pixel shift before requiring replan
}

function findElementByAgentId(targetId: string, doc: Document): Element | null {
  const roots: Array<Document | ShadowRoot> = [doc];
  let match: Element | null = null;
  while (roots.length > 0) {
    const root = roots.pop()!;
    for (const element of Array.from(root.querySelectorAll("[data-privaagent-id]"))) {
      if (element.getAttribute("data-privaagent-id") === targetId) {
        if (match) return null;
        match = element;
      }
    }
    for (const host of Array.from(root.querySelectorAll("*"))) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
  }
  return match;
}

/**
 * Resolves only opaque IDs that were assigned during perception. Derived visual
 * targets resolve to their recorded canvas/DOM parent, never to a page DOM ID.
 */
export function locateLiveElement(
  targetId: string,
  doc: Document = document,
  pageState?: PageState
): Element | null {
  const recordedTarget = pageState?.elements.find((element) => element.target_id === targetId);
  const derivedFrom = recordedTarget?.metadata?.derived_from;
  if (typeof derivedFrom === "string") {
    return findElementByAgentId(derivedFrom, doc);
  }
  return findElementByAgentId(targetId, doc);
}

function isSensitiveLiveTarget(element: Element, recorded?: PageElement): boolean {
  if (recorded?.sensitive) return true;

  const inputType = (element.getAttribute("type") || "").toLowerCase();
  if (["password", "email", "tel"].includes(inputType)) return true;
  if (element.hasAttribute("data-sensitive") || element.getAttribute("aria-sensitive") === "true") return true;

  const autocomplete = element.getAttribute("autocomplete") || "";
  const attributes = [
    element.id,
    element.getAttribute("name") || "",
    element.getAttribute("placeholder") || "",
    element.getAttribute("aria-label") || "",
    element.getAttribute("aria-labelledby") || "",
    autocomplete,
    element.closest("label")?.textContent || "",
  ].join(" ").toLowerCase();
  const sensitiveFieldPattern = /\b(?:pass(?:word|code)?|credential|secret|token|api[\s_-]?key|access[\s_-]?key|auth|user(?:name)?|account|bank|iban|routing|swift|ssn|aadhaar|pan|credit[\s_-]?card|card[\s_-]?number|cvv|cvc|otp|one[\s_-]?time[\s_-]?code|pin|tax|passport|email|phone|mobile|address|birth|dob|national[\s_-]?id|social[\s_-]?security)\b/i;
  const sensitiveAutocompletePattern = /(?:current-password|new-password|cc-number|cc-exp|cc-csc|cc-name|one-time-code|username|given-name|family-name|email|tel|address|postal-code|bday|birth|organization)/i;
  return sensitiveFieldPattern.test(attributes) || sensitiveAutocompletePattern.test(autocomplete);
}

/**
 * Validates that an Action can be safely executed against the current live DOM state.
 */
export function validateAction(
  action: Action,
  pageState?: PageState,
  doc: Document = document,
  options: ValidatorOptions = {}
): ValidationResult {
  const startTime = performance.now();
  const allowedDrift = options.allowedDriftPx || 150;

  // Pure navigation actions do not require an existing target element
  if (action.action === "navigate") {
    const policyResult = evaluateActionRisk(action, null, options.currentOrigin || (typeof window !== "undefined" ? window.location.origin : undefined));
    getPerformanceProfiler().recordStage("action_validation", performance.now() - startTime);
    return {
      valid: policyResult.verdict !== "BLOCK",
      verdict: policyResult.verdict,
      element: null,
      error: policyResult.verdict === "BLOCK" ? policyResult.policyReason : undefined,
      policyResult,
    };
  }

  if (!pageState) {
    return {
      valid: false,
      verdict: "BLOCK",
      element: null,
      error: "Pre-execution validation failed: current PageState is required to authorize an action target.",
      requiresReplan: true,
    };
  }

  const recordedEl = pageState.elements.find((element) => element.target_id === action.target_id);
  if (!recordedEl) {
    return {
      valid: false,
      verdict: "BLOCK",
      element: null,
      error: `Pre-execution validation failed: target element "${action.target_id}" is not in the current PageState.`,
      requiresReplan: true,
    };
  }

  const derivedFrom = recordedEl.metadata?.derived_from;
  const isDerivedTarget = typeof derivedFrom === "string";
  const referenceEl = isDerivedTarget
    ? pageState.elements.find((element) => element.target_id === derivedFrom)
    : recordedEl;
  if (!referenceEl || (isDerivedTarget && action.action !== "click")) {
    return {
      valid: false,
      verdict: "BLOCK",
      element: null,
      error: isDerivedTarget
        ? "Pre-execution validation failed: derived visual target has no current parent target or is not a click action."
        : "Pre-execution validation failed: target has no current semantic record.",
      requiresReplan: true,
    };
  }

  // 1. Locate element on live DOM
  const liveEl = locateLiveElement(action.target_id, doc, pageState);
  if (!liveEl) {
    return {
      valid: false,
      verdict: "BLOCK",
      element: null,
      error: `Pre-execution validation failed: target element "${action.target_id}" not found in current DOM.`,
      requiresReplan: true,
    };
  }

  // 2. Check DOM connectivity / detachment
  if (!liveEl.isConnected) {
    return {
      valid: false,
      verdict: "BLOCK",
      element: liveEl,
      error: `Pre-execution validation failed: target element "${action.target_id}" is detached from the document.`,
      requiresReplan: true,
    };
  }

  // 3. Check visibility and layout state
  const rect = liveEl.getBoundingClientRect();
  const isZeroSize = rect.width <= 0 || rect.height <= 0;
  if (isZeroSize) {
    return {
      valid: false,
      verdict: "BLOCK",
      element: liveEl,
      error: `Pre-execution validation failed: target element "${action.target_id}" has no visible layout area.`,
      requiresReplan: true,
    };
  }

  if (typeof window !== "undefined" && window.getComputedStyle) {
    const style = window.getComputedStyle(liveEl as HTMLElement);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return {
        valid: false,
        verdict: "BLOCK",
        element: liveEl,
        error: `Pre-execution validation failed: target element "${action.target_id}" is hidden from view (${style.display}, ${style.visibility}).`,
        requiresReplan: true,
      };
    }
  }

  // 4. Check for layout and semantic drift against the current PageState record.
  // 4a. Structural role / tag verification
  const liveTag = liveEl.tagName.toLowerCase();
  const recordedTag = (referenceEl.metadata?.tagName as string)?.toLowerCase();
  if (recordedTag && recordedTag !== liveTag) {
    return {
      valid: false,
      verdict: "BLOCK",
      element: liveEl,
      error: `Pre-execution semantic validation failed: element tag changed from <${recordedTag}> to <${liveTag}> (possible DOM manipulation/bait-and-switch).`,
      requiresReplan: true,
    };
  }

  // 4b. ARIA role binding verification (prevent role spoofing, e.g. button -> link)
  const liveRole = (liveEl.getAttribute("role") || "").toLowerCase().trim();
  const recordedRole = ((referenceEl.metadata?.ariaRole as string) || "").toLowerCase().trim();
  if (recordedRole && liveRole && recordedRole !== liveRole && recordedRole !== "generic" && liveRole !== "generic") {
    return {
      valid: false,
      verdict: "BLOCK",
      element: liveEl,
      error: `Pre-execution semantic validation failed: ARIA role changed from "${recordedRole}" to "${liveRole}" (possible role spoofing/bait-and-switch).`,
      requiresReplan: true,
    };
  }

  // 4c. Text identity verification (prevent target swap / bait-and-switch)
  const liveText = (liveEl.textContent?.trim() || "").toLowerCase();
  const recordedText = (referenceEl.text || "").trim().toLowerCase();
  if (
    recordedText.length > 3 &&
    liveText.length > 0 &&
    !liveText.includes(recordedText) &&
    !recordedText.includes(liveText) &&
    recordedText !== "[password]"
  ) {
    return {
      valid: false,
      verdict: "BLOCK",
      element: liveEl,
      error: `Pre-execution semantic drift alert: element text changed from "${referenceEl.text}" to "${liveEl.textContent?.trim()}" (possible target mutation).`,
      requiresReplan: true,
    };
  }

  // 4d. Spatial layout drift
  if (referenceEl.bbox) {
    const [origX, origY] = referenceEl.bbox;
    const driftX = Math.abs(rect.left - origX);
    const driftY = Math.abs(rect.top - origY);

    if (driftX > allowedDrift || driftY > allowedDrift) {
      return {
        valid: false,
        verdict: "BLOCK",
        element: liveEl,
        error: `Pre-execution drift alert: element shifted by (${driftX.toFixed(0)}px, ${driftY.toFixed(0)}px) exceeding threshold (${allowedDrift}px).`,
        requiresReplan: true,
      };
    }
  }
  // 5. Inspect for adversarial prompt injection
  const injectionCheck = inspectElementForHiddenInjection(liveEl);
  if (injectionCheck.isInjection) {
    return {
      valid: false,
      verdict: "BLOCK",
      element: liveEl,
      error: `Pre-execution validation BLOCKED: ${injectionCheck.reason}`,
      requiresReplan: true,
    };
  }

  // 6. Security Risk Policy check
  let clickPoint: { x: number; y: number } | undefined;
  if (isDerivedTarget) {
    const [parentX, parentY, parentWidth, parentHeight] = referenceEl.bbox || [];
    const [regionX, regionY, regionWidth, regionHeight] = recordedEl.bbox || [];
    const tolerance = 2;
    if (
      !recordedEl.bbox || !referenceEl.bbox || parentWidth <= 0 || parentHeight <= 0 || regionWidth <= 0 || regionHeight <= 0 ||
      regionX < parentX - tolerance || regionY < parentY - tolerance ||
      regionX + regionWidth > parentX + parentWidth + tolerance ||
      regionY + regionHeight > parentY + parentHeight + tolerance
    ) {
      return {
        valid: false,
        verdict: "BLOCK",
        element: liveEl,
        error: "Pre-execution validation failed: derived visual target lies outside its recorded parent bounds.",
        requiresReplan: true,
      };
    }
    clickPoint = {
      x: rect.left + ((regionX + regionWidth / 2 - parentX) / parentWidth) * rect.width,
      y: rect.top + ((regionY + regionHeight / 2 - parentY) / parentHeight) * rect.height,
    };
  }

  const candidateMeta: PageElement = {
    target_id: action.target_id,
    role: recordedEl.role,
    text: recordedEl.text,
    bbox: recordedEl.bbox,
    confidence: recordedEl.confidence,
    sensitive: Boolean(recordedEl.sensitive || isSensitiveLiveTarget(liveEl, referenceEl)),
    task_relevance: recordedEl.task_relevance,
    sources: recordedEl.sources,
    interactable: recordedEl.interactable,
  };

  const policyResult = evaluateActionRisk(
    action,
    candidateMeta,
    options.currentOrigin || (typeof window !== "undefined" ? window.location.origin : undefined)
  );

  const duration = performance.now() - startTime;
  getPerformanceProfiler().recordStage("action_validation", duration);

  return {
    valid: policyResult.verdict !== "BLOCK",
    verdict: policyResult.verdict,
    element: liveEl,
    error: policyResult.verdict === "BLOCK" ? policyResult.policyReason : undefined,
    policyResult,
    clickPoint,
  };
}
