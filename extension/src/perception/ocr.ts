// Tesseract.js WASM OCR Engine — Real On-Device Inference
// Replaces the former hardcoded fixture stub with actual Tesseract.js recognition.
// Worker is initialized once (singleton) and reused across calls to minimize latency.
// Falls back gracefully to empty spans if Tesseract fails (e.g., JSDOM test env).

import { BoundingBox } from "../common/types";
import { PixelCrop } from "./browser-state";

export interface OCRSpan {
  text: string;
  bbox: BoundingBox;
  confidence: number;
}

export interface OCRResult {
  spans: OCRSpan[];
  inferenceTimeMs: number;
  complete?: boolean;
}

// ---------------------------------------------------------------------------
// Singleton Tesseract worker — initialized once, reused across all OCR calls
// ---------------------------------------------------------------------------

let _workerPromise: Promise<any> | null = null;

function dispatchOCREvent(name: string): void {
  if (typeof window === "undefined" || typeof window.CustomEvent === "undefined") return;
  try {
    window.dispatchEvent(new window.CustomEvent(name));
  } catch (_) {}
}

async function importTesseract(): Promise<any> {
  const isNodeRuntime = typeof process !== "undefined" && Boolean(process.versions?.node);
  const host = globalThis as any;
  if (!isNodeRuntime || typeof host.document === "undefined") return import("tesseract.js");

  // JSDOM exposes window/document in Node. Tesseract detects those globals as
  // a browser and turns its absolute Node worker path into an HTTP URL, which
  // worker_threads rejects with ERR_WORKER_PATH. Load it once with browser
  // globals hidden so it selects its Node worker implementation.
  const windowDescriptor = Object.getOwnPropertyDescriptor(host, "window");
  const documentDescriptor = Object.getOwnPropertyDescriptor(host, "document");
  try {
    delete host.window;
    delete host.document;
    return await import("tesseract.js");
  } finally {
    if (windowDescriptor) Object.defineProperty(host, "window", windowDescriptor);
    if (documentDescriptor) Object.defineProperty(host, "document", documentDescriptor);
  }
}

function requestExtensionOCR(imageDataUrl: string): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "OCR_RECOGNIZE", imageDataUrl },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || "Extension popup OCR request failed"));
        else if (!response?.complete || !Array.isArray(response.words)) {
          reject(new Error(response?.error || "Extension popup OCR returned an incomplete result"));
        } else resolve(response);
      },
    );
  });
}

/**
 * Returns (and lazily initializes) the shared Tesseract worker.
 * Uses English language data only (~4 MB WASM, cached in browser after first load).
 */
async function getTesseractWorker(): Promise<any> {
  if (_workerPromise) return _workerPromise;

  const initialization = (async () => {
    // Notify UI that a heavy lazy-load operation is starting
    dispatchOCREvent("PRIVAAGENT_OCR_INIT_START");

    // Dynamic import so the extension bundle only loads Tesseract when first needed
    const Tesseract = await importTesseract();
    const extensionOCRPaths = typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? {
          workerPath: chrome.runtime.getURL("assets/ocr/worker.min.js"),
          workerBlobURL: false,
          corePath: chrome.runtime.getURL("assets/ocr"),
          langPath: chrome.runtime.getURL("assets/ocr/lang"),
          gzip: true,
        }
      : {};
    const worker = await Tesseract.createWorker("eng", 1, {
      ...extensionOCRPaths,
      // Suppress verbose logging in production
      logger: (m: any) => {
        if (m.status === "recognizing text") {
          console.debug(`[OCR] Progress: ${(m.progress * 100).toFixed(0)}%`);
        }
      },
    });
    console.log("[OCR] Tesseract.js WASM worker initialized (eng)");

    // Notify UI that initialization is complete
    dispatchOCREvent("PRIVAAGENT_OCR_INIT_END");

    return worker;
  })();

  _workerPromise = initialization.catch((error) => {
    _workerPromise = null;
    dispatchOCREvent("PRIVAAGENT_OCR_INIT_ERROR");
    throw error;
  });
  return _workerPromise;
}

/** Runs local OCR in the extension popup's shared worker. */
export async function recognizeOCRImage(imageDataUrl: string): Promise<any[]> {
  if (!imageDataUrl.startsWith("data:image/") || imageDataUrl.length < 100) {
    throw new Error("OCR received an invalid or empty image");
  }
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(imageDataUrl);
  if (!Array.isArray(data.words)) throw new Error("OCR engine returned an invalid word list");
  return data.words;
}

/** Starts the shared OCR worker without running recognition. */
export async function initializeOCRWorker(): Promise<void> {
  await getTesseractWorker();
}

/**
 * Runs real Tesseract.js WASM OCR on a cropped canvas/image region.
 * Returns word-level spans with absolute viewport coordinates and confidence scores.
 */
export async function runFallbackOCR(
  _targetId: string,
  crop: PixelCrop
): Promise<OCRResult> {
  const start = performance.now();
  const spans: OCRSpan[] = [];
  let complete = false;

  try {
    // Obtain the pixel data as a data URL from the offscreen canvas
    const imageDataUrl = crop.toDataURL("image/png");

    // If there are no real pixels (JSDOM / headless without @napi-rs/canvas backing),
    // return empty spans and log a diagnostic — do NOT fabricate text.
    // The benchmark harness uses @napi-rs/canvas so this guard should not fire there.
    if (!imageDataUrl || imageDataUrl === "data:," || imageDataUrl.length < 100) {
      console.warn(
        `[OCR] Empty/stub data URL for "${_targetId}" — no real canvas pixels available. ` +
        `Returning 0 spans. If running the benchmark, ensure @napi-rs/canvas is backing JSDOM.`
      );
      return { spans, inferenceTimeMs: performance.now() - start, complete: false };
    }


    // Content-script Workers inherit the page's origin. Ask the extension
    // background to broker OCR to the extension popup's local worker instead.
    const useOffscreenDocument = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id) &&
      typeof window !== "undefined" && window.location.protocol !== "chrome-extension:";
    let words: any[];
    if (useOffscreenDocument) {
      const response = await requestExtensionOCR(imageDataUrl);
      words = response.words;
    } else {
      const worker = await getTesseractWorker();
      const { data } = await worker.recognize(imageDataUrl);
      words = data.words;
    }
    if (!Array.isArray(words)) throw new Error("OCR engine returned an invalid word list");
    complete = true;

    const [cropX, cropY, cropW, cropH] = crop.boundingBox;

    // Tesseract bbox coords are relative to the cropped image
    for (const word of words) {
      if (!word.text.trim() || word.confidence < 30) continue;

      const { x0, y0, x1, y1 } = word.bbox;
      const scaleX = cropW / (crop.width || cropW);
      const scaleY = cropH / (crop.height || cropH);

      spans.push({
        text: word.text.trim(),
        bbox: [
          Math.round(cropX + x0 * scaleX),
          Math.round(cropY + y0 * scaleY),
          Math.round((x1 - x0) * scaleX),
          Math.round((y1 - y0) * scaleY),
        ],
        confidence: word.confidence / 100, // Tesseract returns 0-100
      });
    }

    console.log(
      `[OCR] Tesseract recognized ${spans.length} words in ${(performance.now() - start).toFixed(0)}ms`
    );
  } catch (err) {
    // Non-fatal: log and return empty spans — DOM perception still works
    console.error("[OCR] Tesseract inference failed:", err);
    dispatchOCREvent("PRIVAAGENT_OCR_INIT_ERROR");
    complete = false;
  }

  return {
    spans,
    inferenceTimeMs: performance.now() - start,
    complete,
  };
}

/**
 * Cross-checks Florence-2 OCR text against Tesseract text to boost confidence.
 * If both independent models agree, confidence is bumped by +8%.
 */
export function crossCheckOCR(
  visionText: string,
  ocrText: string,
  currentConfidence: number
): number {
  if (visionText.trim().toLowerCase() === ocrText.trim().toLowerCase()) {
    return Math.min(0.99, currentConfidence + 0.08);
  }
  return currentConfidence;
}

/**
 * Terminates the shared Tesseract worker (call on extension unload).
 */
export async function terminateOCRWorker(): Promise<void> {
  if (_workerPromise) {
    try {
      const worker = await _workerPromise;
      await worker.terminate();
    } catch (_) {}
    _workerPromise = null;
  }
}
