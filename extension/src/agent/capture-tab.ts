// Screenshot Capture & Visual Redaction Pipeline (MV3 Compliant)
// Captures viewport screenshots via background service worker, then applies
// on-device pixel blackouts over detected sensitive bounding boxes before a
// visual payload is dispatched.

import { BoundingBox, VisualRedactionManifest } from "../common/types";
import { runFallbackOCR, OCRSpan } from "../perception/ocr";
import { PixelCrop } from "../perception/browser-state";
import { detectSensitiveSpans } from "../privacy/sensitivity";

export interface TabCaptureResult {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

/**
 * Structured result of a sanitization pass.
 * The manifest summarizes the detected boxes considered during this redaction
 * pass. It is checked by the client and backend, but is not proof of detection completeness.
 */
export interface SanitizeResult {
  /** Empty string on fail-closed; non-empty base64 PNG otherwise. */
  dataUrl: string;
  manifest: VisualRedactionManifest;
}

/**
 * Captures the current tab and returns both the sanitized screenshot and its
 * redaction manifest so callers can attach the manifest to outbound disclosures.
 */
export interface CaptureAndSanitizeResult {
  dataUrl?: string;
  manifest?: VisualRedactionManifest;
}

/**
 * Requests the background service worker to capture the visible tab as a PNG data URL.
 * Only the background script has permission to call `chrome.tabs.captureVisibleTab()`.
 */
export async function captureRawTab(): Promise<TabCaptureResult> {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const response = await new Promise<TabCaptureResult>((resolve) => {
        chrome.runtime.sendMessage({ type: "CAPTURE_TAB" }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message || "Failed to communicate with background worker",
            });
          } else {
            resolve(res || { success: false, error: "Empty response from background worker" });
          }
        });
      });
      return response;
    } catch (err: any) {
      return { success: false, error: err.message || "Runtime exception during capture" };
    }
  }

  // Graceful fallback for test/node environments
  return {
    success: false,
    error: "chrome.runtime.sendMessage not available in current environment",
  };
}

/**
 * Loads an image from a Data URL asynchronously.
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error("Failed to load screenshot image: " + err));
    img.src = dataUrl;
  });
}

async function makeScreenshotOCRCrop(
  dataUrl: string,
  cropBox: BoundingBox | undefined,
  viewport: { width: number; height: number }
): Promise<PixelCrop | null> {
  const image = await loadImage(dataUrl);
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  if (imageWidth <= 0 || imageHeight <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;

  const [x, y, width, height] = cropBox || [0, 0, viewport.width, viewport.height];
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(viewport.width, x + width);
  const bottom = Math.min(viewport.height, y + height);
  if (right <= left || bottom <= top) return null;

  const scaleX = imageWidth / viewport.width;
  const scaleY = imageHeight / viewport.height;
  const sourceX = Math.max(0, Math.floor(left * scaleX));
  const sourceY = Math.max(0, Math.floor(top * scaleY));
  const sourceRight = Math.min(imageWidth, Math.ceil(right * scaleX));
  const sourceBottom = Math.min(imageHeight, Math.ceil(bottom * scaleY));
  const canvas = document.createElement("canvas");
  canvas.width = sourceRight - sourceX;
  canvas.height = sourceBottom - sourceY;
  const context = canvas.getContext("2d");
  if (!context || canvas.width <= 0 || canvas.height <= 0) return null;
  context.drawImage(image, sourceX, sourceY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const boundingBox: BoundingBox = [
    left,
    top,
    canvas.width / scaleX,
    canvas.height / scaleY,
  ];
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    boundingBox,
    toDataURL: (type) => canvas.toDataURL(type),
    getImageData: () => {
      try { return context.getImageData(0, 0, canvas.width, canvas.height); } catch { return null; }
    },
  };
}

function findOCRSensitiveBoxes(spans: OCRSpan[]): BoundingBox[] {
  let combinedText = "";
  const indexedSpans = spans.map((span) => {
    const start = combinedText.length;
    combinedText += span.text;
    const end = combinedText.length;
    combinedText += " ";
    return { span, start, end };
  });

  const boxes: BoundingBox[] = [];
  for (const detection of detectSensitiveSpans(combinedText)) {
    const matches = indexedSpans.filter((indexed) =>
      Math.max(indexed.start, detection.span[0]) < Math.min(indexed.end, detection.span[1]));
    if (matches.length === 0) continue;
    const left = Math.min(...matches.map(({ span }) => span.bbox[0]));
    const top = Math.min(...matches.map(({ span }) => span.bbox[1]));
    const right = Math.max(...matches.map(({ span }) => span.bbox[0] + span.bbox[2]));
    const bottom = Math.max(...matches.map(({ span }) => span.bbox[1] + span.bbox[3]));
    const pad = 3;
    boxes.push([
      Math.max(0, left - pad),
      Math.max(0, top - pad),
      right - left + pad * 2,
      bottom - top + pad * 2,
    ]);
  }
  return boxes;
}

/**
 * Redacts sensitive bounding boxes by burning opaque blackout rectangles with
 * cryptographic privacy badges onto the canvas pixels.
 *
 * If cropBox is provided (L2), only the cropped ROI is retained and returned.
 * If cropBox is omitted (L3), the entire viewport is returned with detected sensitive areas masked.
 *
 * Returns a `SanitizeResult` containing the sanitized PNG data URL AND a
 * `VisualRedactionManifest` that formally records which boxes were evaluated and burned.
 * Callers MUST attach this manifest to any outbound disclosure (Strict Visual Contract).
 */
export async function sanitizeScreenshot(
  rawScreenshotDataUrl: string,
  sensitiveBoxes: BoundingBox[],
  cropBox?: BoundingBox,
  viewport?: { width: number; height: number }
): Promise<SanitizeResult> {
  const failClosed: SanitizeResult = {
    dataUrl: "",
    manifest: {
      sourceSensitiveBoxCount: sensitiveBoxes.length,
      intersectingBoxCount: 0,
      redactedBoxCount: 0,
      redactedBoxes: [],
      sanitizationTimestamp: Date.now(),
    },
  };

  if (typeof document === "undefined") {
    // Fail-closed in headless/non-DOM environments without canvas: NEVER return raw screenshot
    console.error("[SanitizeScreenshot] Document not defined. Failing closed: 0 bytes dispatched.");
    return failClosed;
  }

  try {
    const img = await loadImage(rawScreenshotDataUrl);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("[SanitizeScreenshot] Canvas 2D context unavailable. Failing closed: 0 bytes dispatched.");
      return failClosed;
    }

    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    // Calculate scaling factor between CSS coordinates (used by DOM element bounding boxes)
    // and device pixels (captured by chrome.tabs.captureVisibleTab at high-DPI scaling)
    const viewportW =
      viewport?.width ||
      (typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 0) ||
      imgW;
    const viewportH =
      viewport?.height ||
      (typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : 0) ||
      imgH;

    const scaleX = viewportW > 0 ? imgW / viewportW : 1.0;
    const scaleY = viewportH > 0 ? imgH / viewportH : 1.0;

    // Track which boxes were actually burned
    const burnedBoxes: BoundingBox[] = [];

    if (cropBox) {
      // L2: Crop to ROI with DPR scaling
      const [cropX, cropY, cropW, cropH] = cropBox;
      const sCropX = Math.round(cropX * scaleX);
      const sCropY = Math.round(cropY * scaleY);
      const sCropW = Math.max(1, Math.round(cropW * scaleX));
      const sCropH = Math.max(1, Math.round(cropH * scaleY));

      canvas.width = sCropW;
      canvas.height = sCropH;

      // Draw cropped region from the source image
      ctx.drawImage(
        img,
        sCropX,
        sCropY,
        sCropW,
        sCropH,
        0,
        0,
        canvas.width,
        canvas.height
      );

      // Mask sensitive boxes that intersect with the crop, scaled to device pixels
      for (const box of sensitiveBoxes) {
        const [bx, by, bw, bh] = box;
        const sbx = Math.round(bx * scaleX);
        const sby = Math.round(by * scaleY);
        const sbw = Math.round(bw * scaleX);
        const sbh = Math.round(bh * scaleY);

        // Compute relative coords within crop
        const relX = sbx - sCropX;
        const relY = sby - sCropY;

        // Check intersection
        if (
          relX + sbw > 0 &&
          relX < canvas.width &&
          relY + sbh > 0 &&
          relY < canvas.height
        ) {
          const drawX = Math.max(0, relX);
          const drawY = Math.max(0, relY);
          const drawW = Math.min(canvas.width - drawX, sbw);
          const drawH = Math.min(canvas.height - drawY, sbh);

          ctx.fillStyle = "#0f172a"; // Deep slate blackout
          ctx.fillRect(drawX, drawY, drawW, drawH);

          // Redaction watermark
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2;
          ctx.strokeRect(drawX, drawY, drawW, drawH);

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 11px sans-serif";
          ctx.fillText("[REDACTED PII]", drawX + 4, drawY + Math.min(drawH / 2 + 4, drawH - 4));

          burnedBoxes.push(box);
        }
      }
    } else {
      // L3: Full Viewport Screenshot with DPR scaling
      canvas.width = imgW;
      canvas.height = imgH;

      ctx.drawImage(img, 0, 0);

      // Mask all detected sensitive boxes across the viewport, scaled to device pixels
      for (const box of sensitiveBoxes) {
        const [bx, by, bw, bh] = box;
        const sbx = Math.round(bx * scaleX);
        const sby = Math.round(by * scaleY);
        const sbw = Math.round(bw * scaleX);
        const sbh = Math.round(bh * scaleY);

        ctx.fillStyle = "#0f172a";
        ctx.fillRect(sbx, sby, sbw, sbh);

        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.strokeRect(sbx, sby, sbw, sbh);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText("[REDACTED PII]", sbx + 4, sby + Math.min(sbh / 2 + 4, sbh - 4));

        burnedBoxes.push(box);
      }
    }

    const manifest: VisualRedactionManifest = {
      sourceSensitiveBoxCount: sensitiveBoxes.length,
      intersectingBoxCount: burnedBoxes.length,
      redactedBoxCount: burnedBoxes.length,
      redactedBoxes: burnedBoxes,
      sanitizationTimestamp: Date.now(),
    };

    return { dataUrl: canvas.toDataURL("image/png"), manifest };
  } catch (err) {
    console.error("[SanitizeScreenshot] Error processing image, strictly failing closed (0 bytes):", err);
    return failClosed;
  }
}

/**
 * High-level orchestration: captures the current tab and sanitizes detected sensitive areas.
 */
import { detectVisualSensitivity } from "../perception/visual-sensitivity";

/**
 * High-level orchestration: captures the current tab, runs visual detection
 * and on-device OCR, then sanitizes every detected sensitive region.
 *
 * Returns the screenshot and its `VisualRedactionManifest`. Callers must attach
 * the manifest to any outbound L2/L3 disclosure payload; backend validation
 * checks the manifest contract independently.
 */
export async function captureAndSanitizeTab(
  pageState: any,
  cropBox?: BoundingBox
): Promise<CaptureAndSanitizeResult> {
  const result = await captureRawTab();
  if (!result.success || !result.dataUrl) {
    return {};
  }

  // Keep per-frame pixel classification within its 150ms budget.
  // GENERIC entries are produced by the previous visual pass. Drop them before
  // analyzing this screenshot so a former face/photo classification cannot
  // stick to a changed page merely because the PageState object was reused.
  let sensitiveBoxes: BoundingBox[] = [];
  for (const el of pageState.elements as any[]) {
    const metadata = el.metadata || {};
    const detections = Array.isArray(metadata.sensitive_detections)
      ? metadata.sensitive_detections
      : [];
    const semanticDetections = detections.filter((detection: any) => detection?.type !== "GENERIC");
    const unconditionalSensitive = metadata.isPassword === true || el.role === "password";
    const hadVisualOnlyClassification = detections.length > 0 &&
      semanticDetections.length === 0 && !unconditionalSensitive;
    if (hadVisualOnlyClassification) {
      delete metadata.sensitive_detections;
      el.sensitive = false;
    } else if (detections.length > semanticDetections.length) {
      metadata.sensitive_detections = semanticDetections;
    }

    // Preserve semantic detections and unconditional sensitive controls such
    // as password inputs, but do not carry forward visual-only flags.
    if (el.sensitive && !hadVisualOnlyClassification && el.bbox) {
      sensitiveBoxes.push(el.bbox);
    }
  }
  
  try {
    const start = performance.now();
    const visualResults = await detectVisualSensitivity(pageState, result.dataUrl, cropBox);
    const duration = performance.now() - start;

    if (duration > 150) {
      console.warn(`[VisualSensitivity] Detection exceeded 150ms budget (${duration.toFixed(2)}ms). Blocking visual disclosure.`);
      return {};
    }

    // Any incomplete visual pass fails closed. The manifest cannot claim that
    // an image was sanitized when pixels could not be inspected.
    if (Array.from(visualResults.values()).some((result) =>
      result.source === "analysis-timeout" || result.source === "no-pixels" || result.source === "crop-failed")) {
      return {};
    }

    // Merge visually flagged elements into sensitiveBoxes and update pageState for overlays
    for (const [targetId, res] of visualResults.entries()) {
      if (res.kind === "photo-region" || res.kind === "image") {
        const el = pageState.elements.find((e: any) => e.target_id === targetId);
        if (el) {
          el.sensitive = true;
          // Format for overlay manager to pick up
          el.metadata = el.metadata || {};
          el.metadata.sensitive_detections = el.metadata.sensitive_detections || [];
          el.metadata.sensitive_detections = el.metadata.sensitive_detections.filter(
            (detection: any) => detection?.type !== "GENERIC"
          );
          el.metadata.sensitive_detections.push({
            type: "GENERIC", // overlay manager computes generic label
            span: [0, 0],
            text: res.reason || res.kind,
            confidence: res.confidence || 1
          });
          if (el.bbox) {
            sensitiveBoxes.push(el.bbox);
          }
        }
      }
    }
  } catch (err) {
    console.error("[VisualSensitivity] Engine failed. Blocking visual disclosure:", err);
    return {};
  }

  // OCR the exact pixels that may leave the device. DOM scanning cannot see
  // identifiers rendered into canvas, video, or image pixels.
  const viewport = pageState?.viewport || {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  let ocrCrop: PixelCrop | null;
  try {
    ocrCrop = await makeScreenshotOCRCrop(result.dataUrl, cropBox, viewport);
  } catch (_) {
    return {};
  }
  if (!ocrCrop) return {};

  let ocrTimeout: ReturnType<typeof setTimeout> | undefined;
  let ocrResult: Awaited<ReturnType<typeof runFallbackOCR>> | null;
  try {
    const timeout = new Promise<null>((resolve) => {
      ocrTimeout = setTimeout(() => resolve(null), 6000);
    });
    ocrResult = await Promise.race([runFallbackOCR("screenshot", ocrCrop), timeout]);
  } catch (_) {
    return {};
  } finally {
    if (ocrTimeout !== undefined) clearTimeout(ocrTimeout);
  }
  if (!ocrResult || ocrResult.complete !== true) {
    console.warn("[ScreenshotOCR] OCR was incomplete. Blocking visual disclosure.");
    return {};
  }
  sensitiveBoxes.push(...findOCRSensitiveBoxes(ocrResult.spans));

  const sanitizeResult = await sanitizeScreenshot(result.dataUrl, sensitiveBoxes, cropBox, pageState?.viewport);
  if (!sanitizeResult.dataUrl) {
    console.error("[CaptureTab] Screenshot sanitization failed — strictly failing closed (0 bytes sent).");
    return {};
  }

  return {
    dataUrl: sanitizeResult.dataUrl,
    manifest: sanitizeResult.manifest,
  };
}
