// Visual Sensitivity Detection (New Module)
// Identifies visual-only sensitive elements (faces, charts) on-device without cloud VLM.

import { PageState, PageElement } from "../common/types";
import { detectFacesInCrop } from "./face-detector";
import { analyzeCanvasPixels } from "./cv-analyzer";
import { PixelCrop } from "./browser-state";
import { resolveElementByTargetId } from "../semantic/dom-extractor";

export interface VisualSensitivityResult {
  kind: "photo-region" | "chart" | "image" | "unknown";
  confidence?: number;
  source: string;
  reason?: string;
}

const VISUAL_CACHE = new Map<string, VisualSensitivityResult>();


async function loadImage(dataUrl: string): Promise<ImageBitmap> {
  const base64Match = dataUrl.match(/^data:image\/[a-z]+;base64,(.+)$/);
  if (!base64Match) throw new Error("Invalid data URL");
  
  const binaryStr = atob(base64Match[1]);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  
  const blob = new Blob([bytes], { type: "image/png" });
  return await createImageBitmap(blob);
}

/**
 * Detects visual sensitivity in a given page state using a full-page screenshot.
 */
export async function detectVisualSensitivity(
  pageState: PageState,
  screenshotDataUrl?: string
): Promise<Map<string, VisualSensitivityResult>> {
  const results = new Map<string, VisualSensitivityResult>();

  // 1. Identify candidate elements
  const candidates: PageElement[] = [];
  const keywordRegex = /avatar|photo|profile|face|portrait/i;

  for (const el of pageState.elements) {
    if (!el.bbox || el.bbox[2] < 16 || el.bbox[3] < 16) continue; // Skip tiny/invisible

    const isVisualTag =
      el.role === "img" ||
      el.role === "canvas" ||
      el.role === "video" ||
      el.role === "svg" ||
      (el.metadata as any)?.tagName === "img" ||
      (el.metadata as any)?.tagName === "canvas";

    let hasSemanticMatch =
      keywordRegex.test(el.text || "") ||
      keywordRegex.test(el.target_id || "");

    const domEl = resolveElementByTargetId(el.target_id);
    if (domEl) {
      const ariaLabel = domEl.getAttribute("aria-label") || "";
      const alt = domEl.getAttribute("alt") || "";
      const title = domEl.getAttribute("title") || "";
      const className = domEl.className;
      const classStr = typeof className === "string" ? className : (className as any)?.baseVal || "";

      if (
        keywordRegex.test(ariaLabel) ||
        keywordRegex.test(alt) ||
        keywordRegex.test(title) ||
        keywordRegex.test(classStr)
      ) {
        hasSemanticMatch = true;
      }
    }

    if (isVisualTag || hasSemanticMatch) {
      candidates.push(el);
      // Temporarily stash semantic match state in metadata so we don't recalculate
      if (!el.metadata) el.metadata = {};
      (el.metadata as any)._hasSemanticMatch = hasSemanticMatch;
    }
  }

  // Cap at ~20 candidates to respect performance budget
  const topCandidates = candidates.slice(0, 20);
  if (topCandidates.length === 0) return results;

  let sourceImg: ImageBitmap | null = null;
  if (screenshotDataUrl) {
    try {
      sourceImg = await loadImage(screenshotDataUrl);
    } catch (_) {}
  }

  for (const el of topCandidates) {
    const cacheKey = `${el.target_id}_${el.bbox!.join(",")}`;
    if (VISUAL_CACHE.has(cacheKey)) {
      results.set(el.target_id, VISUAL_CACHE.get(cacheKey)!);
      continue;
    }

    const [bx, by, bw, bh] = el.bbox!;
    const hasSemanticMatch = (el.metadata as any)._hasSemanticMatch;

    if (!sourceImg || !pageState.viewport) {
      // Without screenshot pixels, we must fail closed on semantic matches.
      const res: VisualSensitivityResult = hasSemanticMatch
        ? { kind: "image", source: "semantic-label", reason: "visual:semantic-photo" }
        : { kind: "unknown", source: "no-pixels" };
      results.set(el.target_id, res);
      VISUAL_CACHE.set(cacheKey, res);
      continue;
    }

    // Clamp to viewport bounds to avoid off-screen errors
    const clampedBx = Math.max(0, bx);
    const clampedBy = Math.max(0, by);
    const clampedBw = Math.min(pageState.viewport.width - clampedBx, bw - (clampedBx - bx));
    const clampedBh = Math.min(pageState.viewport.height - clampedBy, bh - (clampedBy - by));

    if (clampedBw < 10 || clampedBh < 10) {
      results.set(el.target_id, { kind: "unknown", source: "offscreen-or-too-small" });
      continue;
    }

    // Crop from screenshot using precise scale matching rather than assumed DPR
    try {
      const scaleX = sourceImg.width / pageState.viewport.width;
      const scaleY = sourceImg.height / pageState.viewport.height;
      
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = clampedBw;
      cropCanvas.height = clampedBh;
      const ctx = cropCanvas.getContext("2d");
      
      if (!ctx) {
        throw new Error("No 2d context");
      }

      ctx.drawImage(
        sourceImg,
        clampedBx * scaleX,
        clampedBy * scaleY,
        clampedBw * scaleX,
        clampedBh * scaleY,
        0,
        0,
        clampedBw,
        clampedBh
      );

      const pixelCrop: PixelCrop = {
        canvas: cropCanvas,
        width: clampedBw,
        height: clampedBh,
        boundingBox: [clampedBx, clampedBy, clampedBw, clampedBh],
        toDataURL: (type) => cropCanvas.toDataURL(type),
        getImageData: () => {
          try {
            return ctx.getImageData(0, 0, clampedBw, clampedBh);
          } catch {
            return null;
          }
        },
      };

      // Create a timeout promise to enforce budget
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 100));

      const facePromise = detectFacesInCrop(pixelCrop, undefined);
      const faceRes = await Promise.race([facePromise, timeoutPromise]);

      if (faceRes && faceRes.faces.length > 0) {
        const res: VisualSensitivityResult = {
          kind: "photo-region",
          source: "face-detector",
          reason: "visual:skin-tone-region",
        };
        results.set(el.target_id, res);
        VISUAL_CACHE.set(cacheKey, res);
        continue;
      }

      const cvComps = analyzeCanvasPixels(cropCanvas, {
        viewportOffset: [bx, by],
        minComponentWidth: 10,
        minComponentHeight: 10,
      });

      if (cvComps.length > 0) {
        const res: VisualSensitivityResult = {
          kind: "chart",
          source: "cv-analyzer",
          reason: "visual:chart",
        };
        results.set(el.target_id, res);
        VISUAL_CACHE.set(cacheKey, res);
        continue;
      }

      // If nothing detected but semantic label matches, fail closed.
      if (hasSemanticMatch) {
        const res: VisualSensitivityResult = {
          kind: "image",
          source: "semantic-label",
          reason: "visual:semantic-photo",
        };
        results.set(el.target_id, res);
        VISUAL_CACHE.set(cacheKey, res);
        continue;
      }

      const res: VisualSensitivityResult = {
        kind: "unknown",
        source: "pixels-analyzed-clean",
      };
      results.set(el.target_id, res);
      VISUAL_CACHE.set(cacheKey, res);
    } catch (_) {
      const res: VisualSensitivityResult = hasSemanticMatch
        ? { kind: "image", source: "semantic-label", reason: "visual:semantic-photo" }
        : { kind: "unknown", source: "crop-failed" };
      results.set(el.target_id, res);
      VISUAL_CACHE.set(cacheKey, res);
    }
  }

  return results;
}
