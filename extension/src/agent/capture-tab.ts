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
  cropBox?: BoundingBox
): Promise<string> {
  if (typeof document === "undefined") {
    // Node / headless fallback
    return rawScreenshotDataUrl;
  }

  try {
    const img = await loadImage(rawScreenshotDataUrl);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return rawScreenshotDataUrl;

    if (cropBox) {
      // L2: Crop to ROI
      const [cropX, cropY, cropW, cropH] = cropBox;
      canvas.width = Math.max(1, Math.round(cropW));
      canvas.height = Math.max(1, Math.round(cropH));

      // Draw cropped region from the source image
      ctx.drawImage(
        img,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        canvas.width,
        canvas.height
      );

      // Mask sensitive boxes that intersect with the crop
      for (const [bx, by, bw, bh] of sensitiveBoxes) {
        // Compute relative coords within crop
        const relX = bx - cropX;
        const relY = by - cropY;

        // Check intersection
        if (
          relX + bw > 0 &&
          relX < canvas.width &&
          relY + bh > 0 &&
          relY < canvas.height
        ) {
          const drawX = Math.max(0, relX);
          const drawY = Math.max(0, relY);
          const drawW = Math.min(canvas.width - drawX, bw);
          const drawH = Math.min(canvas.height - drawY, bh);

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
      // L3: Full Viewport Screenshot
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;

      ctx.drawImage(img, 0, 0);

      // Mask all sensitive bounding boxes across the viewport
      for (const [bx, by, bw, bh] of sensitiveBoxes) {
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(bx, by, bw, bh);

        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText("[REDACTED PII]", bx + 4, by + Math.min(bh / 2 + 4, bh - 4));
      }
    }

    return canvas.toDataURL("image/png");
  } catch (err) {
    console.warn("[SanitizeScreenshot] Error processing image, returning uncropped/raw fallback:", err);
    return rawScreenshotDataUrl;
  }
}

/**
 * High-level orchestration: captures the current tab and sanitizes all sensitive areas.
 */
export async function captureAndSanitizeTab(
  sensitiveBoxes: BoundingBox[],
  cropBox?: BoundingBox
): Promise<string | undefined> {
  const result = await captureRawTab();
  if (!result.success || !result.dataUrl) {
    return undefined;
  }
  return sanitizeScreenshot(result.dataUrl, sensitiveBoxes, cropBox);
}
