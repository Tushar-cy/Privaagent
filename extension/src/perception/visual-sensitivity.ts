// Visual Sensitivity Detection (New Module)
// Identifies visual-only sensitive elements (faces, charts) on-device without cloud VLM.

import { PageState, PageElement } from "../common/types";
import { detectFacesInCrop } from "./face-detector";
import { analyzeCanvasPixels } from "./cv-analyzer";
import { PixelCrop } from "./browser-state";
import { resolvePerceivedElement } from "../semantic/dom-extractor";

export interface VisualSensitivityResult {
  kind: "photo-region" | "chart" | "image" | "unknown";
  confidence?: number;
  source: string;
  reason?: string;
}

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
  screenshotDataUrl?: string,
  analysisBox?: [number, number, number, number]
): Promise<Map<string, VisualSensitivityResult>> {
  const results = new Map<string, VisualSensitivityResult>();

  // 1. Identify candidate elements
  const candidates: PageElement[] = [];
  const semanticMatches = new Map<PageElement, boolean>();
  const keywordRegex = /avatar|photo|profile|face|portrait/i;

  for (const el of pageState.elements) {
    if (!el.bbox || el.bbox[2] < 16 || el.bbox[3] < 16) continue; // Skip tiny/invisible
    if (analysisBox) {
      const [x, y, width, height] = el.bbox;
      const [cropX, cropY, cropWidth, cropHeight] = analysisBox;
      if (x + width <= cropX || x >= cropX + cropWidth ||
          y + height <= cropY || y >= cropY + cropHeight) continue;
    }

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

    const domEl = resolvePerceivedElement(el);
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
      semanticMatches.set(el, hasSemanticMatch);
    }
  }

  // Prioritize likely personal imagery and task-relevant visuals before applying
  // the per-frame cap; DOM order alone routinely starves later candidates.
  const rolePriority = (element: PageElement) =>
    element.role === "img" ? 3 : element.role === "canvas" ? 2 : 1;
  const rankedCandidates = candidates
    .sort((a, b) => Number(semanticMatches.get(b) === true) - Number(semanticMatches.get(a) === true) ||
      rolePriority(b) - rolePriority(a) || (b.task_relevance || 0) - (a.task_relevance || 0) ||
      (b.confidence || 0) - (a.confidence || 0));
  const topCandidates = rankedCandidates.slice(0, 20);
  // The screenshot includes every candidate, so uninspected regions are
  // blacked out instead of implicitly treated as clean.
  for (const el of rankedCandidates.slice(20)) {
    results.set(el.target_id, {
      kind: "image",
      source: "candidate-cap-conservative",
      reason: "visual:uninspected-region",
    });
  }
  if (topCandidates.length === 0) return results;

  let sourceImg: ImageBitmap | null = null;
  if (screenshotDataUrl) {
    try {
      sourceImg = await loadImage(screenshotDataUrl);
    } catch (_) {}
  }

  const analysisStart = performance.now();
  try {
  for (const el of topCandidates) {
    const [bx, by, bw, bh] = el.bbox!;
    const hasSemanticMatch = semanticMatches.get(el) === true;

    if (!sourceImg || !pageState.viewport) {
      // Without screenshot pixels, we must fail closed on semantic matches.
      const res: VisualSensitivityResult = hasSemanticMatch
        ? { kind: "image", source: "semantic-label", reason: "visual:semantic-photo" }
        : { kind: "unknown", source: "no-pixels" };
      results.set(el.target_id, res);
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
      
      // Bound per-candidate pixel work while preserving aspect ratio. These
      // checks only need classification, not source-resolution coordinates.
      const scale = Math.min(1, 512 / Math.max(clampedBw, clampedBh));
      const analysisWidth = Math.max(1, Math.round(clampedBw * scale));
      const analysisHeight = Math.max(1, Math.round(clampedBh * scale));
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = analysisWidth;
      cropCanvas.height = analysisHeight;
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
        analysisWidth,
        analysisHeight
      );

      const pixelCrop: PixelCrop = {
        canvas: cropCanvas,
        width: analysisWidth,
        height: analysisHeight,
        boundingBox: [clampedBx, clampedBy, clampedBw, clampedBh],
        toDataURL: (type) => cropCanvas.toDataURL(type),
        getImageData: () => {
          try {
          return ctx.getImageData(0, 0, analysisWidth, analysisHeight);
          } catch {
            return null;
          }
        },
      };

      const remainingBudget = 150 - (performance.now() - analysisStart);
      if (remainingBudget <= 0) {
        results.set(el.target_id, { kind: "unknown", source: "analysis-timeout" });
        continue;
      }
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<null>((resolve) =>
        timeoutHandle = setTimeout(() => resolve(null), Math.min(100, remainingBudget)));

      const facePromise = detectFacesInCrop(pixelCrop, resolvePerceivedElement(el) || undefined);
      let faceRes: Awaited<ReturnType<typeof detectFacesInCrop>> | null;
      try {
        faceRes = await Promise.race([facePromise, timeoutPromise]);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }

      if (!faceRes && performance.now() - analysisStart >= 150) {
        results.set(el.target_id, { kind: "unknown", source: "analysis-timeout" });
        continue;
      }

      if (faceRes && faceRes.faces.length > 0) {
        const res: VisualSensitivityResult = {
          kind: "photo-region",
          source: "face-detector",
          reason: "visual:skin-tone-region",
        };
        results.set(el.target_id, res);
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
        continue;
      }

      const res: VisualSensitivityResult = {
        kind: "unknown",
        source: "pixels-analyzed-clean",
      };
      results.set(el.target_id, res);
    } catch (_) {
      const res: VisualSensitivityResult = hasSemanticMatch
        ? { kind: "image", source: "semantic-label", reason: "visual:semantic-photo" }
        : { kind: "unknown", source: "crop-failed" };
      results.set(el.target_id, res);
    }
  }

  return results;
  } finally {
    sourceImg?.close();
  }
}
