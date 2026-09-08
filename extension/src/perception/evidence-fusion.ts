// Evidence Fusion Engine: Merges vision.ts + ocr.ts + face detection outputs
// into standard PageElement objects with calibrated confidence and provenance.

import { PageElement, PageState, PerceptionSource } from "../common/types";
import { VisionResult } from "./vision";
import { OCRResult, crossCheckOCR } from "./ocr";
import { FaceDetectionResult } from "./face-detector";

export interface FusionResult {
  pageState: PageState;
  fusedElements: PageElement[];
  timing: {
    visionInferenceMs: number;
    ocrInferenceMs: number;
    faceInferenceMs: number;
    totalFusionMs: number;
  };
}

/**
 * Fuses multi-modal evidence from Florence-2, Tesseract OCR, and BlazeFace
 * directly into the PageState.
 */
export function fusePerceptionEvidence(
  pageState: PageState,
  targetId: string,
  visionRes: VisionResult,
  ocrRes: OCRResult,
  faceRes: FaceDetectionResult
): FusionResult {
  const start = performance.now();
  const fusedElements: PageElement[] = [];

  // 1. Process Vision Detections (<OD> and <OCR>)
  for (const vDet of visionRes.detections) {
    const sources: PerceptionSource[] = ["vision"];
    let finalConfidence = vDet.confidence;
    let finalText = vDet.text;

    // Cross-check with OCR spans
    const matchingOcr = ocrRes.spans.find((s) => {
      const xDiff = Math.abs(s.bbox[0] - vDet.bbox[0]);
      const yDiff = Math.abs(s.bbox[1] - vDet.bbox[1]);
      return xDiff < 30 && yDiff < 30;
    });

    if (matchingOcr) {
      sources.push("ocr");
      finalConfidence = crossCheckOCR(vDet.text, matchingOcr.text, vDet.confidence);
      if (vDet.task === "<OCR>") {
        finalText = matchingOcr.text;
      }
    }

    const pageElement: PageElement = {
      target_id: vDet.target_id,
      role: vDet.role,
      text: finalText,
      bbox: vDet.bbox,
      confidence: finalConfidence,
      sensitive: false,
      task_relevance: vDet.role === "chart_bar" ? 0.95 : 0.7,
      sources,
      interactable: true,
      metadata: {
        task_token: vDet.task,
        derived_from: targetId,
      },
    };

    fusedElements.push(pageElement);
  }

  // 2. Process Face Detections (tagged as sensitive for visual redaction)
  for (let i = 0; i < faceRes.faces.length; i++) {
    const face = faceRes.faces[i];
    const faceElement: PageElement = {
      target_id: `${targetId}_face_${i + 1}`,
      role: "face",
      text: "Customer Portrait Face",
      bbox: face.bbox,
      confidence: face.confidence,
      sensitive: true, // Requires immediate redaction / blurring before disclosure
      task_relevance: 0.2,
      sources: ["cv"],
      interactable: false,
      metadata: {
        landmarks: face.landmarks,
        derived_from: targetId,
      },
    };

    fusedElements.push(faceElement);
  }

  // 3. Integrate into PageState without modifying original DOM ground truth
  const updatedElements = [...pageState.elements, ...fusedElements];

  const totalFusionMs = performance.now() - start;

  return {
    pageState: {
      ...pageState,
      elements: updatedElements,
    },
    fusedElements,
    timing: {
      visionInferenceMs: visionRes.inferenceTimeMs,
      ocrInferenceMs: ocrRes.inferenceTimeMs,
      faceInferenceMs: faceRes.inferenceTimeMs,
      totalFusionMs,
    },
  };
}
