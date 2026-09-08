// Browser State: Captures and crops pixels from canvas, image, video, or SVG elements
// into an isolated offscreen canvas buffer for on-device model inference.

import { BoundingBox } from "../common/types";

export interface PixelCrop {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  boundingBox: BoundingBox;
  toDataURL: (type?: string) => string;
  getImageData: () => ImageData | null;
}

/**
 * Captures pixel data of a target visual element into an offscreen canvas.
 * Crops strictly to the target DOM element's bounding box.
 */
export async function captureElementPixels(element: Element): Promise<PixelCrop> {
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext("2d");

  const boundingBox: BoundingBox = [
    Math.round(rect.left),
    Math.round(rect.top),
    width,
    height,
  ];

  if (!ctx) {
    return {
      canvas: offscreen,
      width,
      height,
      boundingBox,
      toDataURL: () => "",
      getImageData: () => null,
    };
  }

  // Clear background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const tagName = element.tagName.toLowerCase();

  // Case 1: HTMLCanvasElement
  if (
    tagName === "canvas" ||
    (typeof HTMLCanvasElement !== "undefined" && element instanceof HTMLCanvasElement)
  ) {
    ctx.drawImage(element as CanvasImageSource, 0, 0, width, height);
  }
  // Case 2: HTMLImageElement
  else if (
    tagName === "img" ||
    (typeof HTMLImageElement !== "undefined" && element instanceof HTMLImageElement)
  ) {
    const imgEl = element as HTMLImageElement;
    if (imgEl.complete && imgEl.naturalWidth > 0) {
      ctx.drawImage(imgEl, 0, 0, width, height);
    }
  }
  // Case 3: SVG Element
  else if (tagName === "svg" || element instanceof SVGElement) {
    try {
      const xml = new XMLSerializer().serializeToString(element);
      const svg64 = btoa(unescape(encodeURIComponent(xml)));
      const image64 = "data:image/svg+xml;base64," + svg64;

      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, width, height);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = image64;
      });
    } catch {
      // Fallback
    }
  }

  return {
    canvas: offscreen,
    width,
    height,
    boundingBox,
    toDataURL: (type = "image/png") => offscreen.toDataURL(type),
    getImageData: () => {
      try {
        return ctx.getImageData(0, 0, width, height);
      } catch {
        return null;
      }
    },
  };
}
