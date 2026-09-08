// Semantic Masker: Masks and sanitizes PageState into DisclosedElement structures.

import { DisclosedElement, PageState } from "../common/types";
import { redactElementText } from "../privacy/redactor";
import { SensitiveDetection } from "../privacy/sensitivity";

/**
 * Transforms an array of PageElements into a sanitized DisclosedElement array
 * where all sensitive text spans are converted to anonymized tokens.
 */
export function maskPageStateForDisclosure(
  pageState: PageState,
  resolveLiveElement?: (targetId: string) => Element | null
): {
  disclosedElements: DisclosedElement[];
  totalRedactedTokens: number;
} {
  const disclosedElements: DisclosedElement[] = [];
  let totalRedactedTokens = 0;

  for (const el of pageState.elements) {
    const liveEl = resolveLiveElement ? resolveLiveElement(el.target_id) : null;
    const detections: SensitiveDetection[] =
      (el.metadata?.sensitive_detections as SensitiveDetection[]) || [];

    if (detections.length > 0) {
      const redacted = redactElementText(el.target_id, liveEl, el.text, detections);
      totalRedactedTokens += detections.length;

      disclosedElements.push({
        target_id: el.target_id,
        role: el.role,
        label: redacted.sanitizedText,
        bbox: el.bbox,
      });
    } else {
      disclosedElements.push({
        target_id: el.target_id,
        role: el.role,
        label: el.text,
        bbox: el.bbox,
      });
    }
  }

  return {
    disclosedElements,
    totalRedactedTokens,
  };
}
