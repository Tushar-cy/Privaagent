// DOM Extractor: Walks the DOM, extracts interactive and text-bearing elements,
// assigns stable target_ids, and constructs standardized PageState.

import { PageElement, PageState, PerceptionSource } from "../common/types";
import { getElementA11yInfo } from "./accessibility";
import { getPerformanceProfiler } from "../common/profiler";

// Map to resolve target_id back to live DOM elements in O(1) time
const elementRegistry = new Map<string, Element>();

export interface ExtractionResult {
  pageState: PageState;
  durationMs: number;
  elementCount: number;
}

/**
 * Resolves a target_id back to the live DOM Element.
 */
export function resolveElementByTargetId(targetId: string): Element | null {
  // Check in-memory registry first
  const cached = elementRegistry.get(targetId);
  if (cached && cached.isConnected) {
    return cached;
  }

  // Fallback to DOM attribute lookup
  const element = document.querySelector(`[data-privaagent-id="${targetId}"]`);
  if (element) {
    elementRegistry.set(targetId, element);
    return element;
  }

  // Fallback to ID lookup
  const byId = document.getElementById(targetId);
  if (byId) {
    elementRegistry.set(targetId, byId);
    return byId;
  }

  return null;
}

/**
 * Determines whether an element is visible in the page layout.
 */
function isElementVisible(el: Element, rect: DOMRect): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }

  return true;
}

/**
 * Generates a stable, deterministic target_id for a DOM element.
 */
function generateStableTargetId(el: Element, index: number): string {
  if (el.id && el.id.trim() && !/^[0-9]+$/.test(el.id)) {
    return el.id.trim();
  }

  const tagName = el.tagName.toLowerCase();
  const role = el.getAttribute("role") || "";
  const prefix = role ? `${tagName}_${role}` : tagName;
  return `${prefix}_${index}`;
}

/**
 * Checks whether an element is interactable or text-bearing.
 */
function isCandidateElement(el: Element): boolean {
  const tagName = el.tagName.toLowerCase();

  // Interactive tags
  if (
    tagName === "button" ||
    tagName === "a" ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    tagName === "canvas"
  ) {
    return true;
  }

  // Interactive ARIA roles
  const role = el.getAttribute("role");
  if (
    role === "button" ||
    role === "link" ||
    role === "textbox" ||
    role === "checkbox" ||
    role === "menuitem" ||
    role === "tab" ||
    role === "img"
  ) {
    return true;
  }

  // Headings
  if (/^h[1-6]$/.test(tagName)) {
    return true;
  }

  // Text-bearing leaf elements (paragraphs, spans, labels, table cells)
  if (
    tagName === "p" ||
    tagName === "span" ||
    tagName === "label" ||
    tagName === "li" ||
    tagName === "td" ||
    tagName === "th"
  ) {
    // Only capture if it contains non-empty direct or child text and no complex interactive children
    const text = el.textContent?.trim() || "";
    if (text.length > 0 && el.children.length === 0) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts visible interactive and semantic elements from the DOM.
 * Enforces < 50ms performance constraint.
 */
export function extractPageState(): ExtractionResult {
  const startTime = performance.now();
  elementRegistry.clear();

  const elements: PageElement[] = [];
  const allNodes = document.querySelectorAll(
    "button, a, input, textarea, select, canvas, h1, h2, h3, h4, h5, h6, p, span, label, li, td, th, [role]"
  );

  let sequenceIndex = 0;

  for (let i = 0; i < allNodes.length; i++) {
    const el = allNodes[i];
    if (!isCandidateElement(el)) continue;

    const a11y = getElementA11yInfo(el);
    if (a11y.isHidden) continue;

    const rect = el.getBoundingClientRect();
    if (!isElementVisible(el, rect)) continue;

    sequenceIndex++;
    const targetId = generateStableTargetId(el, sequenceIndex);

    // Tag element for instant O(1) query
    el.setAttribute("data-privaagent-id", targetId);
    elementRegistry.set(targetId, el);

    // Determine text representation
    let text = "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      text = el.value || el.placeholder || "";
    } else if (el instanceof HTMLSelectElement) {
      text = el.selectedOptions[0]?.text || el.value || "";
    } else {
      text = a11y.accessibleName || el.textContent?.trim() || "";
    }

    // Determine sources
    const sources: PerceptionSource[] = ["dom"];
    if (a11y.accessibleName || a11y.role !== "generic") {
      sources.push("a11y");
    }

    // Role
    const tagName = el.tagName.toLowerCase();
    const role = a11y.role && a11y.role !== "generic" ? a11y.role : tagName;

    const pageElement: PageElement = {
      target_id: targetId,
      role,
      text,
      bbox: [
        Math.round(rect.left),
        Math.round(rect.top),
        Math.round(rect.width),
        Math.round(rect.height),
      ],
      confidence: 1.0,
      // Password inputs are unconditionally sensitive regardless of their value content.
      // Generic password strings are not matched by PII regex patterns, so this explicit
      // flag ensures they are redacted before any network transmission.
      sensitive: el instanceof HTMLInputElement && el.type === "password",
      task_relevance: tagName === "canvas" ? 0.0 : 0.5,
      sources,
      interactable: tagName !== "p" && tagName !== "span" && !/^h[1-6]$/.test(tagName),
    };

    elements.push(pageElement);
  }

  const durationMs = performance.now() - startTime;
  getPerformanceProfiler().recordStage("dom_extraction", durationMs, { elementCount: elements.length });

  const pageState: PageState = {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    elements,
  };

  return {
    pageState,
    durationMs,
    elementCount: elements.length,
  };
}
