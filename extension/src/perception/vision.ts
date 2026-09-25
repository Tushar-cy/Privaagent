// On-Device Visual Perception Engine
// Primary path: Classical pixel-CV (cv-analyzer.ts) + Tesseract OCR (ocr.ts)
// Optional neural path: Florence-2 via @xenova/transformers (see KNOWN LIMITATION below)
//
// KNOWN LIMITATION — Florence-2 neural path:
//   Florence-2 requires task-token-conditioned decoding: the task prefix (<OD>, <OCR>, etc.)
//   must be injected as a special input token AND the output (e.g. "<loc_0120><loc_0210>...") 
//   must be post-processed by a Florence-specific decoder. The stock @xenova/transformers
//   "image-to-text" pipeline does NOT implement this — it uses greedy autoregressive decoding
//   with no task-token injection and no Florence output parser.
//   Result in practice: the pipeline either throws or produces garbled token sequences,
//   and the catch-block silently returns [] which routes to the classical CV fast path.
//
//   Setting VISION_MODE = "florence2" activates the experimental neural path for
//   environments where a proper Florence-2 inference server is available.
//   The default is "lightweight" (classical CV + OCR only).

import { BoundingBox } from "../common/types";
import { PixelCrop } from "./browser-state";
import { analyzeCanvasPixels } from "./cv-analyzer";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Controls which vision backend is used.
 *   "lightweight" — classical pixel CV + Tesseract OCR (default, verified working)
 *   "florence2"   — experimental neural path (requires task-conditioned pipeline; see KNOWN LIMITATION)
 */
export const VISION_MODE: "lightweight" | "florence2" =
  (typeof process !== "undefined" && process.env?.VISION_MODE === "florence2")
    ? "florence2"
    : "lightweight";

export type FlorenceTask = "<OCR>" | "<OD>" | "<DENSE_REGION_CAPTION>";

export interface VisionDetection {
  target_id: string;
  role: string;
  text: string;
  bbox: BoundingBox; // Absolute viewport coordinates [x, y, w, h]
  confidence: number;
  task: FlorenceTask;
}

export interface VisionResult {
  detections: VisionDetection[];
  initTimeMs: number;
  inferenceTimeMs: number;
  device: "webgpu" | "wasm" | "cpu";
}

// ---------------------------------------------------------------------------
// Singleton model pipeline — only loaded when VISION_MODE = "florence2"
// ---------------------------------------------------------------------------

const PINNED_MODEL_ID = "onnx-community/Florence-2-base-ft";
let _pipelinePromise: Promise<any> | null = null;
let _modelInitMs = 0;
let _isModelLoaded = false;

/**
 * Returns (and lazily initializes) the Florence-2 pipeline.
 * Only called when VISION_MODE = "florence2".
 * NOTE: See module-level KNOWN LIMITATION comment before enabling.
 */
async function getFlorencePipeline(): Promise<any> {
  if (_pipelinePromise) return _pipelinePromise;

  _pipelinePromise = (async () => {
    const initStart = performance.now();
    const { pipeline, env } = await import("@xenova/transformers");

    const hasWebGPU =
      typeof navigator !== "undefined" &&
      "gpu" in navigator &&
      Boolean((navigator as any).gpu);
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.numThreads = 1;

    console.log(
      `[Vision] Loading Florence-2 (EXPERIMENTAL) on [${hasWebGPU ? "webgpu" : "wasm"}]. ` +
      `See KNOWN LIMITATION in vision.ts — this pipeline may not produce valid output.`
    );

    const pipe = await (pipeline as any)("image-to-text", PINNED_MODEL_ID, {
      dtype: "fp32",
      device: hasWebGPU ? "webgpu" : "wasm",
    });

    _modelInitMs = performance.now() - initStart;
    _isModelLoaded = true;
    console.log(`[Vision] Florence-2 pipeline ready in ${_modelInitMs.toFixed(0)}ms (task-conditioned decoding NOT guaranteed)`);
    return pipe;
  })();

  return _pipelinePromise;
}

/**
 * Initializes the Florence-2 model (downloads + warm-up).
 * Returns 0 immediately when VISION_MODE = "lightweight" (the default).
 */
export async function initializeFlorenceModel(): Promise<number> {
  if (VISION_MODE !== "florence2") {
    console.log(`[Vision] VISION_MODE="${VISION_MODE}" — skipping Florence-2 init. Classical CV is primary.`);
    return 0;
  }
  if (_isModelLoaded) return 0;
  const start = performance.now();
  try {
    await getFlorencePipeline();
  } catch (err: any) {
    console.warn(
      `[Vision] Florence-2 pipeline init failed: ${err?.message || err}. ` +
      `Classical CV fast-path will be used.`
    );
    _isModelLoaded = true;
  }
  return performance.now() - start;
}

// ---------------------------------------------------------------------------
// Primary lightweight path: classical pixel CV
// ---------------------------------------------------------------------------

/**
 * Runs the lightweight classical CV path on a cropped visual region.
 * Uses luminance-contrast column segmentation (cv-analyzer.ts).
 * This is the default, verified path for "lightweight browser agent" deployment.
 */
export function runLightweightVision(
  targetId: string,
  crop: PixelCrop,
  task: FlorenceTask = "<OD>"
): VisionResult {
  const start = performance.now();
  const detections: VisionDetection[] = [];
  const [cropX, cropY, cropW, cropH] = crop.boundingBox;

  const dynamicComponents = analyzeCanvasPixels(crop.canvas, {
    viewportOffset: [cropX, cropY],
  });

  if (dynamicComponents.length > 0) {
    console.log(`[Vision] Classical CV detected ${dynamicComponents.length} components in "${targetId}"`);
    dynamicComponents.forEach((comp, idx) => {
      detections.push({
        target_id: `${targetId}_bar_${idx + 1}`,
        role: comp.role,
        text: comp.label,
        bbox: comp.bbox,
        confidence: comp.score,
        task,
      });
    });
  } else {
    // No contrast found — canvas may be blank, cross-origin tainted, or unsupported.
    // Log explicitly rather than fabricating output; callers can check detections.length === 0.
    console.warn(
      `[Vision] Classical CV found 0 components in "${targetId}" ` +
      `(canvas ${crop.width}×${crop.height}). ` +
      `Possible causes: blank canvas, all-same-color pixels, cross-origin taint, or JSDOM stub.`
    );
  }

  return {
    detections,
    initTimeMs: 0,
    inferenceTimeMs: performance.now() - start,
    device: "wasm",
  };
}

// ---------------------------------------------------------------------------
// Optional experimental Florence-2 path
// ---------------------------------------------------------------------------

/**
 * Runs the Florence-2 EXPERIMENTAL neural inference path.
 * Only used when VISION_MODE = "florence2".
 * See module-level KNOWN LIMITATION comment — output is not guaranteed to be valid.
 */
export async function runFlorenceVision(
  targetId: string,
  crop: PixelCrop,
  task: FlorenceTask = "<OCR>"
): Promise<VisionResult> {
  // Default to lightweight unless explicitly opted into Florence-2
  if (VISION_MODE !== "florence2") {
    return runLightweightVision(targetId, crop, task);
  }

  const initStart = performance.now();
  const detections: VisionDetection[] = [];
  const hasWebGPU =
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    Boolean((navigator as any).gpu);
  const device: "webgpu" | "wasm" | "cpu" = hasWebGPU ? "webgpu" : "wasm";

  try {
    const imageDataUrl = crop.toDataURL("image/png");

    let pipe: any = null;
    try {
      pipe = await getFlorencePipeline();
    } catch (_) {
      // Florence-2 load failed — fall through to classical CV
    }

    if (!pipe || !imageDataUrl || imageDataUrl === "data:," || imageDataUrl.length < 100) {
      // Neural pipeline unavailable — route to classical CV
      console.log(`[Vision] Florence-2 unavailable for "${targetId}" — routing to classical CV.`);
      return runLightweightVision(targetId, crop, task);
    }

    const initTimeMs = _isModelLoaded ? _modelInitMs : 0;
    const inferenceStart = performance.now();

    // NOTE: "image-to-text" pipeline does not support Florence-2 task tokens.
    // This call may produce garbled output or throw. See KNOWN LIMITATION.
    const result = await pipe(imageDataUrl, { text_input: task });

    const inferenceTimeMs = performance.now() - inferenceStart;
    const [cropX, cropY, cropW, cropH] = crop.boundingBox;

    const rawResults: any[] = Array.isArray(result) ? result : [result];
    let detIdx = 0;

    for (const item of rawResults) {
      // Object Detection bboxes (Florence-2 <OD> format: normalized 0-1000)
      if (item.bboxes && Array.isArray(item.bboxes)) {
        for (let i = 0; i < item.bboxes.length; i++) {
          const [nx1, ny1, nx2, ny2] = item.bboxes[i];
          const absX = Math.round(cropX + (nx1 / 1000) * cropW);
          const absY = Math.round(cropY + (ny1 / 1000) * cropH);
          const absW = Math.round(((nx2 - nx1) / 1000) * cropW);
          const absH = Math.round(((ny2 - ny1) / 1000) * cropH);
          const label = item.labels?.[i] ?? `obj_${detIdx}`;
          detections.push({
            target_id: `${targetId}_od_${detIdx++}`,
            role: "visual_object",
            text: label,
            bbox: [absX, absY, absW, absH],
            confidence: 0.90,
            task: "<OD>",
          });
        }
      }

      // OCR text + quad boxes (Florence-2 <OCR> format)
      if (item.text && item.quad_boxes && Array.isArray(item.quad_boxes)) {
        const texts: string[] = Array.isArray(item.text) ? item.text : [item.text];
        for (let i = 0; i < Math.min(texts.length, item.quad_boxes.length); i++) {
          const qb = item.quad_boxes[i];
          if (!qb || qb.length < 4) continue;
          const nx1 = qb[0], ny1 = qb[1], nx2 = qb[4] ?? qb[2], ny2 = qb[5] ?? qb[3];
          const absX = Math.round(cropX + (nx1 / 1000) * cropW);
          const absY = Math.round(cropY + (ny1 / 1000) * cropH);
          const absW = Math.round(((nx2 - nx1) / 1000) * cropW);
          const absH = Math.round(((ny2 - ny1) / 1000) * cropH);
          detections.push({
            target_id: `${targetId}_ocr_${detIdx++}`,
            role: "text",
            text: texts[i],
            bbox: [absX, absY, absW, absH],
            confidence: 0.88,
            task: "<OCR>",
          });
        }
      }

      // Dense caption fallback (no structured bbox)
      if (!item.bboxes && !item.quad_boxes && item.generated_text) {
        detections.push({
          target_id: `${targetId}_cap_0`,
          role: "text",
          text: item.generated_text,
          bbox: [cropX, cropY, cropW, cropH],
          confidence: 0.75,
          task,
        });
      }
    }

    console.log(
      `[Vision] Florence-2 task=${task} | detections=${detections.length} | inference=${inferenceTimeMs.toFixed(0)}ms`
    );

    return { detections, initTimeMs, inferenceTimeMs, device };
  } catch (err) {
    console.error("[Vision] Florence-2 inference error:", err);
    // Graceful fallback to classical CV
    return runLightweightVision(targetId, crop, task);
  }
}
