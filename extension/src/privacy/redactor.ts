// Text Range Redactor: Computes pixel-exact sub-string bounding boxes via Range API
// and maintains stable session token replacement without mutating the live DOM.

import { BoundingBox } from "../common/types";
import { SensitiveDetection, detectSensitiveSpans } from "./sensitivity";

export interface RedactionOverlaySpec {
  id: string;
  target_id: string;
  bbox: BoundingBox;
  style: "blur" | "blackout";
  token: string;
  type: string;
}

export interface RedactionResult {
  originalText: string;
  sanitizedText: string;
  overlays: RedactionOverlaySpec[];
}

// Session-stable token mapping (e.g. "Rahul Sharma" -> "[PERSON_1]")
class SessionTokenMap {
  private rawToToken = new Map<string, string>();
  private typeCounters = new Map<string, number>();

  public getToken(rawText: string, type: string): string {
    const key = `${type}:::${rawText.trim()}`;
    const existing = this.rawToToken.get(key);
    if (existing) {
      return existing;
    }

    const count = (this.typeCounters.get(type) || 0) + 1;
    this.typeCounters.set(type, count);

    const token = `[${type}_${count}]`;
    this.rawToToken.set(key, token);
    return token;
  }

  public clear(): void {
    this.rawToToken.clear();
    this.typeCounters.clear();
  }
}

export const sessionTokens = new SessionTokenMap();

/**
 * Computes exact sub-string bounding box within a DOM node using Range API.
 * When exactText is provided, searches for the exact substring in the node's
 * text content to avoid index drift from leading/trailing whitespace or indentation.
 */
export function getSubStringBoundingBox(
  element: Element,
  startChar: number,
  endChar: number,
  exactText?: string
): BoundingBox | null {
  try {
    const doc = element.ownerDocument || document;
    const fullText = element.textContent || "";

    // Preserve the detector's span when it already identifies this occurrence.
    // Searching from the start of the node for exactText alone is incorrect for
    // repeated values (for example, two identical names in one text node).
    let trueStart = startChar;
    let trueEnd = endChar;
    if (exactText && exactText.length > 0 && fullText.slice(startChar, endChar) !== exactText) {
      let nearestIndex = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      let searchFrom = 0;
      while (searchFrom <= fullText.length - exactText.length) {
        const foundIdx = fullText.indexOf(exactText, searchFrom);
        if (foundIdx === -1) break;
        const distance = Math.abs(foundIdx - startChar);
        if (distance < nearestDistance) {
          nearestIndex = foundIdx;
          nearestDistance = distance;
        }
        searchFrom = foundIdx + 1;
      }
      if (nearestIndex !== -1) {
        trueStart = nearestIndex;
        trueEnd = nearestIndex + exactText.length;
      }
    }

    const whatToShow = typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4;
    const walker = doc.createTreeWalker(element, whatToShow, null);

    let currentNode = walker.nextNode();
    let currentOffset = 0;

    let startNode: Node | null = null;
    let startNodeOffset = 0;
    let endNode: Node | null = null;
    let endNodeOffset = 0;

    while (currentNode) {
      const textLen = currentNode.textContent?.length || 0;
      const nextOffset = currentOffset + textLen;

      if (!startNode && trueStart >= currentOffset && trueStart <= nextOffset) {
        startNode = currentNode;
        startNodeOffset = trueStart - currentOffset;
      }

      if (trueEnd >= currentOffset && trueEnd <= nextOffset) {
        endNode = currentNode;
        endNodeOffset = trueEnd - currentOffset;
        break;
      }

      currentOffset = nextOffset;
      currentNode = walker.nextNode();
    }

    if (startNode && endNode) {
      const range = doc.createRange();
      range.setStart(startNode, Math.min(startNodeOffset, startNode.textContent?.length || 0));
      range.setEnd(endNode, Math.min(endNodeOffset, endNode.textContent?.length || 0));

      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return [
          Math.round(rect.left),
          Math.round(rect.top),
          Math.round(rect.width),
          Math.round(rect.height),
        ];
      }
    }
  } catch (err) {
    console.warn("[Privaagent Redactor] Range bbox calculation fallback:", err);
  }

  // Fallback to element's bounding box if range calculation fails
  const elemRect = element.getBoundingClientRect();
  return [
    Math.round(elemRect.left),
    Math.round(elemRect.top),
    Math.round(elemRect.width),
    Math.round(elemRect.height),
  ];
}

/**
 * Redacts an element's text and generates overlay specs without mutating DOM.
 */
export function redactElementText(
  targetId: string,
  element: Element | null,
  text: string,
  detections: SensitiveDetection[]
): RedactionResult {
  if (!detections || detections.length === 0) {
    return {
      originalText: text,
      sanitizedText: text,
      overlays: [],
    };
  }

  // Sort detections descending by start index to replace backwards safely
  const sortedDetections = [...detections].sort((a, b) => b.span[0] - a.span[0]);

  let sanitized = text;
  const overlays: RedactionOverlaySpec[] = [];

  for (let i = 0; i < sortedDetections.length; i++) {
    const d = sortedDetections[i];
    const token = sessionTokens.getToken(d.text, d.type);

    // Compute pixel-exact box if element is provided
    let bbox: BoundingBox = [0, 0, 0, 0];
    if (element) {
      const calculatedBox = getSubStringBoundingBox(element, d.span[0], d.span[1], d.text);
      if (calculatedBox) {
        bbox = calculatedBox;
      }
    }

    overlays.push({
      id: `redact_${targetId}_${i}`,
      target_id: targetId,
      bbox,
      style: d.type === "SECRET_KEY" ? "blackout" : "blur",
      token,
      type: d.type,
    });

    // Replace span in outbound text representation
    sanitized =
      sanitized.slice(0, d.span[0]) + token + sanitized.slice(d.span[1]);
  }

  return {
    originalText: text,
    sanitizedText: sanitized,
    overlays,
  };
}

/**
 * Sanitizes a raw string (e.g., user task) using the same session tokens.
 */
export function sanitizeTaskString(task: string): string {
  const detections = detectSensitiveSpans(task);
  if (!detections || detections.length === 0) return task;

  const sorted = [...detections].sort((a, b) => b.span[0] - a.span[0]);
  let sanitized = task;
  for (const d of sorted) {
    const token = sessionTokens.getToken(d.text, d.type);
    sanitized = sanitized.slice(0, d.span[0]) + token + sanitized.slice(d.span[1]);
  }
  return sanitized;
}
