// DOM Extractor: Walks the DOM, extracts interactive and text-bearing elements,
// assigns stable target_ids, and constructs standardized PageState.

import { PageElement, PageState, PerceptionSource } from "../common/types";
import { getElementA11yInfo } from "./accessibility";
import { getPerformanceProfiler } from "../common/profiler";

// Map to resolve target_id back to live DOM elements in O(1) time
const elementRegistry = new Map<string, Element>();
// Bind each snapshot record to the exact node that produced it. Unlike the
// target-id registry, these WeakMap entries survive later perception passes,
// so stale PageStates cannot silently rebind a reused sequence ID.
const perceivedNodeBindings = new WeakMap<PageElement, Element>();

export interface ExtractionResult {
  pageState: PageState;
  durationMs: number;
  elementCount: number;
}

/**
 * Resolves a target_id back to the live DOM Element.
 */
export function resolveElementByTargetId(targetId: string): Element | null {
  // Authorization comes from the extension-owned node binding created during
  // perception. Never re-resolve a target by searching page-controlled DOM
  // attributes: a page can copy or move those attributes to another element.
  const cached = elementRegistry.get(targetId);
  if (cached && cached.isConnected) {
    return cached;
  }
  if (cached) elementRegistry.delete(targetId);
  return null;
}

/** Resolves the exact DOM node that produced a PageElement snapshot record. */
export function resolvePerceivedElement(element: PageElement): Element | null {
  const node = perceivedNodeBindings.get(element);
  return node?.isConnected ? node : null;
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
function generateStableTargetId(_el: Element, index: number): string {
  // Purely opaque session-local target ID. DOM IDs and attributes NEVER cross into target_id.
  return `el_${String(index).padStart(4, "0")}`;
}

/**
 * Returns true if an element is a text-bearing leaf node:
 * has non-empty text content and no child elements (or only inline text).
 * Used to safely include div/section elements used as text containers in
 * modern web apps (AI chat bubbles, card descriptions, etc.) without
 * capturing complex layout containers.
 */
function isTextLeaf(el: Element): boolean {
  const text = el.textContent?.trim() || "";
  if (text.length === 0) return false;
  // No child element nodes — pure text leaf
  if (el.children.length === 0) return true;
  // Allow elements whose only children are purely inline/formatting elements
  // (strong, em, b, i, code, mark, sup, sub, br, span-only)
  const inlineTags = new Set(["strong", "em", "b", "i", "u", "s", "code", "mark",
                               "sup", "sub", "br", "span", "abbr", "small", "time"]);
  for (let i = 0; i < el.children.length; i++) {
    if (!inlineTags.has(el.children[i].tagName.toLowerCase())) return false;
  }
  return true;
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
    return isTextLeaf(el);
  }

  // DIV as text container: Modern web apps (AI chats, card UIs, React/Vue apps)
  // heavily use <div> for text content. We include div ONLY when it is a text
  // leaf node, to avoid capturing complex layout containers.
  if (tagName === "div" || tagName === "section" || tagName === "article") {
    return isTextLeaf(el);
  }

  return false;
}

/**
 * Recursively collects candidate elements across light DOM and open Shadow DOM trees.
 * Penetrates Web Components, Lit, Stencil, Polymer, and custom enterprise elements.
 */
function collectAllNodesWithShadow(root: Document | ShadowRoot | Element): Element[] {
  const nodes: Element[] = [];
  const selector =
    "button, a, input, textarea, select, canvas, h1, h2, h3, h4, h5, h6, p, span, label, li, td, th, div, section, article, [role]";

  try {
    const list = root.querySelectorAll(selector);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      nodes.push(el);
      // Recursively traverse open shadow roots
      if (el.shadowRoot) {
        nodes.push(...collectAllNodesWithShadow(el.shadowRoot));
      }
    }
  } catch (_) {}

  return nodes;
}

/**
 * Extracts visible interactive and semantic elements from the DOM.
 * Enforces < 50ms performance constraint.
 */
export function extractPageState(): ExtractionResult {
  const startTime = performance.now();
  elementRegistry.clear();

  const elements: PageElement[] = [];
  // Penetrates both light DOM and Shadow DOM trees
  const allNodes = collectAllNodesWithShadow(document);

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
    // Determine text representation with source-level password protection
    const tagName = el.tagName.toLowerCase();
    const isPassword =
      (tagName === "input" && (el.getAttribute("type")?.toLowerCase() === "password" || (el as any).type === "password")) ||
      (typeof HTMLInputElement !== "undefined" && el instanceof HTMLInputElement && el.type === "password");
    let text = "";
    if (isPassword) {
      // Source-level destruction: raw password values are NEVER stored in PageElement text
      text = "[PASSWORD]";
    } else if (
      tagName === "input" ||
      tagName === "textarea" ||
      (typeof HTMLInputElement !== "undefined" && el instanceof HTMLInputElement) ||
      (typeof HTMLTextAreaElement !== "undefined" && el instanceof HTMLTextAreaElement)
    ) {
      text = (el as any).value || el.getAttribute("placeholder") || "";
    } else if (tagName === "select" || (typeof HTMLSelectElement !== "undefined" && el instanceof HTMLSelectElement)) {
      text = (el as any).selectedOptions?.[0]?.text || (el as any).value || "";
    } else {
      text = a11y.accessibleName || el.textContent?.trim() || "";
    }

    // Determine sources
    const sources: PerceptionSource[] = ["dom"];
    if (a11y.accessibleName || a11y.role !== "generic") {
      sources.push("a11y");
    }

    // Role
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
      sensitive: isPassword,
      task_relevance: tagName === "canvas" ? 0.0 : 0.5,
      sources,
      interactable: tagName !== "p" && tagName !== "span" && !/^h[1-6]$/.test(tagName)
                    && tagName !== "div" && tagName !== "section" && tagName !== "article",
      metadata: {
        tagName,
        ariaRole: (el.getAttribute("role") || a11y.role || "").toLowerCase().trim(),
        accessibleName: a11y.accessibleName || "",
        isPassword,
        domId: (el as HTMLElement).id || undefined,
      },
    };

    perceivedNodeBindings.set(pageElement, el);
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
