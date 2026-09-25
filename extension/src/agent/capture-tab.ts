// Screenshot Capture & Visual Redaction Pipeline (MV3 Compliant)
// Captures viewport screenshots via background service worker, then applies
// on-device irreversible pixel blackouts/redactions over all sensitive bounding boxes
// BEFORE visual payloads leave the device.

import { BoundingBox } from "../common/types";

export interface TabCaptureResult {
  success: boolean;
  dataUrl?: string;
  error?: string;
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

/**
 * Redacts sensitive bounding boxes by burning opaque blackout rectangles with
 * cryptographic privacy badges onto the canvas pixels.
 *
 * If cropBox is provided (L2), only the cropped ROI is retained and returned.
 * If cropBox is omitted (L3), the entire viewport is returned with all sensitive areas masked.
 */
export async function sanitizeScreenshot(
  rawScreenshotDataUrl: string,
  sensitiveBoxes: BoundingBox[],
  cropBox?: BoundingBox,
  viewport?: { width: number; height: number }
): Promise<string> {
  if (typeof document === "undefined") {
    // Fail-closed in headless/non-DOM environments without canvas: NEVER return raw screenshot
    console.error("[SanitizeScreenshot] Document not defined. Failing closed: 0 bytes dispatched.");
    return "";
  }

  try {
    const img = await loadImage(rawScreenshotDataUrl);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("[SanitizeScreenshot] Canvas 2D context unavailable. Failing closed: 0 bytes dispatched.");
      return "";
    }

    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    // Calculate scaling factor between CSS coordinates (used by DOM element bounding boxes)
    // and device pixels (captured by chrome.tabs.captureVisibleTab at high-DPI scaling)
    const viewportW =
      (typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 0) ||
      viewport?.width ||
      imgW;
    const viewportH =
      (typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : 0) ||
      viewport?.height ||
      imgH;

    const scaleX = viewportW > 0 ? imgW / viewportW : 1.0;
    const scaleY = viewportH > 0 ? imgH / viewportH : 1.0;

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
      for (const [bx, by, bw, bh] of sensitiveBoxes) {
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
        }
      }
    } else {
      // L3: Full Viewport Screenshot with DPR scaling
      canvas.width = imgW;
      canvas.height = imgH;

      ctx.drawImage(img, 0, 0);

      // Mask all sensitive bounding boxes across the viewport scaled to device pixels
      for (const [bx, by, bw, bh] of sensitiveBoxes) {
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
      }
    }

    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("[SanitizeScreenshot] Error processing image, strictly failing closed (0 bytes):", err);
    return "";
  }
}

/**
 * High-level orchestration: captures the current tab and sanitizes all sensitive areas.
 */
import { detectVisualSensitivity } from "../perception/visual-sensitivity";

/**
 * High-level orchestration: captures the current tab, runs visual detection,
 * merges sensitive regions, and sanitizes all sensitive areas.
 */
export async function captureAndSanitizeTab(
  pageState: any,
  cropBox?: BoundingBox
): Promise<string | undefined> {
  const result = await captureRawTab();
  if (!result.success || !result.dataUrl) {
    return undefined;
  }

  // Time budget: detect visual sensitivity with 150ms timeout
  let sensitiveBoxes: BoundingBox[] = pageState.elements.filter((e: any) => e.sensitive).map((e: any) => e.bbox);
  
  try {
    const start = performance.now();
    const visualResults = await detectVisualSensitivity(pageState, result.dataUrl);
    const duration = performance.now() - start;

    if (duration > 150) {
      console.warn(`[VisualSensitivity] Detection exceeded 150ms budget (${duration.toFixed(2)}ms). Falling back to semantic-only for remaining.`);
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
    console.error("[VisualSensitivity] Engine failed, falling back:", err);
  }

  const sanitized = await sanitizeScreenshot(result.dataUrl, sensitiveBoxes, cropBox, pageState?.viewport);
  if (!sanitized) {
    console.error("[CaptureTab] Screenshot sanitization failed — strictly failing closed (0 bytes sent).");
    return undefined;
  }
  return sanitized;
}
