// Semantic Masker: Masks and sanitizes PageState into DisclosedElement structures.

import { DisclosedElement, PageState } from "../common/types";
import { redactElementText } from "../privacy/redactor";
import { detectSensitiveSpans, SensitiveDetection } from "../privacy/sensitivity";

/**
 * Transforms an array of PageElements into a sanitized DisclosedElement array
 * where detected sensitive text spans are converted to placeholder tokens.
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
    const metadata = el.metadata as Record<string, unknown> | undefined;
    const rawDetections: SensitiveDetection[] =
      (el.metadata?.sensitive_detections as SensitiveDetection[]) || [];
    const isVisualSensitive = rawDetections.some((detection) => String(detection.type) === "GENERIC");
    const isSelect = String(metadata?.tagName || "").toLowerCase() === "select";
    const options = isSelect && Array.isArray(metadata?.selectOptions)
      ? (metadata.selectOptions as Array<{ label?: string; disabled?: boolean }>)
          .filter((option) => !option.disabled)
      : [];
    const optionLabels = options.slice(0, 30).map((option) => option.label || "").filter(Boolean);
    if (options.length > optionLabels.length) optionLabels.push(`${options.length - optionLabels.length} more options`);
    const label = isSelect
      ? [
          metadata?.accessibleName ? `Control: ${String(metadata.accessibleName)}` : "Select control",
          el.text ? `Selected: ${el.text}` : "",
          optionLabels.length > 0 ? `Options: ${optionLabels.join(", ")}` : "",
        ].filter(Boolean).join(" | ")
      : el.text;
    const textDetections = isSelect
      ? detectSensitiveSpans(label)
      : rawDetections.filter((detection) => String(detection.type) !== "GENERIC");

    if (isVisualSensitive) {
      // GENERIC marks pixel-level sensitivity and has no valid text span. Never
      // let a visual-only label/alt string pass through as if it were redacted.
      totalRedactedTokens += Math.max(1, textDetections.length);
      disclosedElements.push({
        target_id: el.target_id,
        role: el.role,
        label: "[SENSITIVE_VISUAL]",
        bbox: el.bbox,
      });
    } else if (textDetections.length > 0) {
      const redacted = redactElementText(el.target_id, isSelect ? null : liveEl, label, textDetections);
      totalRedactedTokens += textDetections.length;

      disclosedElements.push({
        target_id: el.target_id,
        role: el.role,
        label: redacted.sanitizedText,
        bbox: el.bbox,
      });
    } else if (el.sensitive) {
      // Unconditional redaction for items flagged as sensitive (e.g. passwords)
      // without specific regex span detections.
      totalRedactedTokens += 1;
      disclosedElements.push({
        target_id: el.target_id,
        role: el.role,
        label: "[PASSWORD]",
        bbox: el.bbox,
      });
    } else {
      disclosedElements.push({
        target_id: el.target_id,
        role: el.role,
        label,
        bbox: el.bbox,
      });
    }
  }

  return {
    disclosedElements,
    totalRedactedTokens,
  };
}
