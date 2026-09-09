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
}

export interface ValidatorOptions {
  currentOrigin?: string;
  allowedDriftPx?: number; // Maximum allowed pixel shift before requiring replan
}

/**
 * Re-locates the target element on the current live DOM using multiple strategies.
 */
function locateLiveElement(targetId: string, doc: Document = document): Element | null {
  // Strategy 1: Direct ID lookup
  const byId = doc.getElementById(targetId);
  if (byId) return byId;

  // Strategy 2: data-privaagent-id attribute (written by dom-extractor on every scanned element)
  const byPrivaId = doc.querySelector(`[data-privaagent-id="${targetId}"]`);
  if (byPrivaId) return byPrivaId;

  // Strategy 3: data-target-id attribute (legacy fallback)
  const byAttr = doc.querySelector(`[data-target-id="${targetId}"]`);
  if (byAttr) return byAttr;

  // Strategy 4: Derived chart bar or visual sub-element lookup
  // E.g., if target_id is "revenue-chart_bar_4", the canvas is "revenue-chart"
  if (targetId.includes("_bar_")) {
    const parentId = targetId.split("_bar_")[0];
    const parent = doc.getElementById(parentId);
    if (parent) return parent;
  }

  return null;
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

  // 1. Locate element on live DOM
  const liveEl = locateLiveElement(action.target_id, doc);
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
  const isZeroSize = rect.width === 0 && rect.height === 0;

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

  // 4. Check for layout drift if original PageState metadata is provided
  if (pageState) {
    const recordedEl = pageState.elements.find((el) => el.target_id === action.target_id);
    if (recordedEl && recordedEl.bbox) {
      const [origX, origY] = recordedEl.bbox;
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
  const candidateMeta: PageElement = {
    target_id: action.target_id,
    role: (liveEl.getAttribute("role") || liveEl.tagName.toLowerCase()) as any,
    text: liveEl.textContent?.trim() || "",
    bbox: [rect.left, rect.top, rect.width, rect.height],
    confidence: 1.0,
    sensitive: false,
    task_relevance: 1.0,
    sources: ["dom"],
    interactable: true,
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
  };
}
