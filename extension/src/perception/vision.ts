// Local visual component detection.
// Text recognition is performed separately by the on-device Tesseract OCR worker.

import { BoundingBox } from "../common/types";
import { PixelCrop } from "./browser-state";
import { analyzeCanvasPixels } from "./cv-analyzer";

/**
 * Florence-2 was experimental and relied on a task-conditioned API that the
 * selected Transformers pipeline did not implement. Keep the legacy export
 * names for callers, but use the supported local classical CV path only.
 */
export const VISION_MODE = "lightweight" as const;
export type FlorenceTask = "<OCR>" | "<OD>" | "<DENSE_REGION_CAPTION>";

export interface VisionDetection {
  target_id: string;
  role: string;
  text: string;
  bbox: BoundingBox;
  confidence: number;
  task: FlorenceTask;
}

export interface VisionResult {
  detections: VisionDetection[];
  initTimeMs: number;
  inferenceTimeMs: number;
  device: "webgpu" | "wasm" | "cpu";
}

/** Classical contrast and column segmentation over a local pixel crop. */
export function runLightweightVision(
  targetId: string,
  crop: PixelCrop,
  task: FlorenceTask = "<OD>"
): VisionResult {
  const start = performance.now();
  const [cropX, cropY] = crop.boundingBox;
  const detections: VisionDetection[] = analyzeCanvasPixels(crop.canvas, {
    viewportOffset: [cropX, cropY],
  }).map((component, index) => ({
    target_id: `${targetId}_bar_${index + 1}`,
    role: component.role,
    text: component.label,
    bbox: component.bbox,
    confidence: component.score,
    task,
  }));

  if (detections.length === 0) {
    console.warn(
      `[Vision] Classical CV found 0 components in "${targetId}" ` +
      `(canvas ${crop.width}×${crop.height}). The region may be blank, uniform, cross-origin tainted, or unsupported.`
    );
  }

  return {
    detections,
    initTimeMs: 0,
    inferenceTimeMs: performance.now() - start,
    device: "cpu",
  };
}

/** No neural model is downloaded or initialized in the supported path. */
export async function initializeFlorenceModel(): Promise<number> {
  return 0;
}

/** @deprecated Use runLightweightVision; this compatibility export does not load Florence-2. */
export async function runFlorenceVision(
  targetId: string,
  crop: PixelCrop,
  task: FlorenceTask = "<OCR>"
): Promise<VisionResult> {
  return runLightweightVision(targetId, crop, task);
}
