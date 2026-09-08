// Local Vision & Perception Pipeline Entrypoint

import { PageState } from "../common/types";
import { captureElementPixels } from "./browser-state";
import { runFlorenceVision, initializeFlorenceModel, VisionResult } from "./vision";
import { runFallbackOCR, OCRResult } from "./ocr";
import { detectFacesInCrop, FaceDetectionResult } from "./face-detector";
import { fusePerceptionEvidence, FusionResult } from "./evidence-fusion";
import { getPerformanceProfiler } from "../common/profiler";

export {
  captureElementPixels,
  runFlorenceVision,
  initializeFlorenceModel,
  runFallbackOCR,
  detectFacesInCrop,
  fusePerceptionEvidence,
};
export type { VisionResult, OCRResult, FaceDetectionResult, FusionResult };

/**
 * Runs the complete on-device visual perception pipeline on a target non-DOM region.
 * Adheres strictly to the crop-only resource budget constraint.
 */
export async function processVisualRegion(
  targetId: string,
  element: Element,
  basePageState: PageState
): Promise<FusionResult> {
  // 1. Crop pixels to offscreen canvas
  const crop = await captureElementPixels(element);

  // 2. Run Florence-2 Vision (<OD> + <OCR>)
  const visionRes = await runFlorenceVision(targetId, crop, "<OD>");
  getPerformanceProfiler().recordStage("florence_vision", visionRes.inferenceTimeMs);

  // 3. Run Fallback / Cross-check OCR
  const ocrRes = await runFallbackOCR(targetId, crop);
  getPerformanceProfiler().recordStage("tesseract_ocr", ocrRes.inferenceTimeMs);

  // 4. Run Dedicated BlazeFace Specialist
  const faceRes = await detectFacesInCrop(crop, element);
  getPerformanceProfiler().recordStage("face_detection", faceRes.inferenceTimeMs);

  // 5. Evidence Fusion
  const fusionStart = performance.now();
  const result = fusePerceptionEvidence(
    basePageState,
    targetId,
    visionRes,
    ocrRes,
    faceRes
  );
  getPerformanceProfiler().recordStage("evidence_fusion", performance.now() - fusionStart);

  return result;
}
