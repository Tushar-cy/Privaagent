// Sensitivity Aggregator: Fuses all detectors (regex, entropy, NER)
// and tags PageState elements with exact sensitivity metadata.

import { PageElement, PageState } from "../common/types";
import { detectStructuredPII, PIISpan } from "./pii-detector";
import { detectSecrets, SecretSpan } from "./secret-detector";
import { detectNamedEntities, NERSpan } from "./ner-detector";

export interface SensitiveDetection {
  type: PIISpan["type"] | SecretSpan["type"] | NERSpan["type"];
  span: [number, number]; // [start, end]
  text: string;
  confidence: number;
}

/**
 * Analyzes a single page element and attaches sensitivity metadata.
 */
export function annotateElementSensitivity(element: PageElement): PageElement {
  const text = element.text;
  if (!text || text.trim().length === 0) {
    return element;
  }

  const detections: SensitiveDetection[] = [];

  // 1. Structured PII
  const piiSpans = detectStructuredPII(text);
  for (const span of piiSpans) {
    detections.push({
      type: span.type,
      span: [span.start, span.end],
      text: span.text,
      confidence: span.confidence,
    });
  }

  // 2. Secret & API Key detection
  const secretSpans = detectSecrets(text);
  for (const span of secretSpans) {
    detections.push({
      type: span.type,
      span: [span.start, span.end],
      text: span.text,
      confidence: span.confidence,
    });
  }

  // 3. Named Entity Recognition (for non-code, natural text)
  const nerSpans = detectNamedEntities(text);
  for (const span of nerSpans) {
    // Avoid duplicate overlaps with structured PII
    const overlaps = detections.some(
      (d) => Math.max(d.span[0], span.start) < Math.min(d.span[1], span.end)
    );
    if (!overlaps) {
      detections.push({
        type: span.type,
        span: [span.start, span.end],
        text: span.text,
        confidence: span.confidence,
      });
    }
  }

  if (detections.length > 0) {
    element.sensitive = true;
    element.metadata = {
      ...(element.metadata || {}),
      sensitive_detections: detections,
    };
  }

  return element;
}

/**
 * Analyzes an entire PageState and annotates all elements.
 */
export function annotatePageStateSensitivity(pageState: PageState): PageState {
  pageState.elements = pageState.elements.map((el) => annotateElementSensitivity(el));
  return pageState;
}
