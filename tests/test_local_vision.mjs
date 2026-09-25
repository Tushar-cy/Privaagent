// Automated Local Vision & Evidence Fusion Benchmark Test
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

import { createCanvas } from "../extension/node_modules/@napi-rs/canvas/index.js";

import {
  captureElementPixels,
  runFlorenceVision,
  initializeFlorenceModel,
  runFallbackOCR,
  detectFacesInCrop,
  fusePerceptionEvidence,
  processVisualRegion,
} from "../extension/src/perception/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "../benchmark/pages/test-page-1.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");

console.log("==================================================");
console.log("   PRIVAAGENT LOCAL VISION & PERCEPTION ENGINE    ");
console.log("==================================================");

// Real canvas proxy factory backed by @napi-rs/canvas
function makeRealCanvasContext(width, height, canvasContextMap) {
  const nativeCanvas = createCanvas(width, height);
  const nativeCtx = nativeCanvas.getContext("2d");

  function resolveImageSource(source) {
    if (source && canvasContextMap && canvasContextMap.has(source)) {
      return canvasContextMap.get(source)._nativeCanvas;
    }
    return source;
  }

  const ctx = {
    get fillStyle()     { return nativeCtx.fillStyle; },
    set fillStyle(v)    { nativeCtx.fillStyle = v; },
    get strokeStyle()   { return nativeCtx.strokeStyle; },
    set strokeStyle(v)  { nativeCtx.strokeStyle = v; },
    get lineWidth()     { return nativeCtx.lineWidth; },
    set lineWidth(v)    { nativeCtx.lineWidth = v; },
    get font()          { return nativeCtx.font; },
    set font(v)         { nativeCtx.font = v; },
    get textAlign()     { return nativeCtx.textAlign; },
    set textAlign(v)    { nativeCtx.textAlign = v; },

    fillRect:    (...args) => nativeCtx.fillRect(...args),
    strokeRect:  (...args) => nativeCtx.strokeRect(...args),
    clearRect:   (...args) => nativeCtx.clearRect(...args),
    beginPath:   ()        => nativeCtx.beginPath(),
    closePath:   ()        => nativeCtx.closePath(),
    moveTo:      (...args) => nativeCtx.moveTo(...args),
    lineTo:      (...args) => nativeCtx.lineTo(...args),
    arc:         (...args) => nativeCtx.arc(...args),
    stroke:      ()        => nativeCtx.stroke(),
    fill:        ()        => nativeCtx.fill(),
    fillText:    (...args) => nativeCtx.fillText(...args),
    strokeText:  (...args) => nativeCtx.strokeText(...args),
    save:        ()        => nativeCtx.save(),
    restore:     ()        => nativeCtx.restore(),
    scale:       (...args) => nativeCtx.scale(...args),
    rotate:      (...args) => nativeCtx.rotate(...args),
    translate:   (...args) => nativeCtx.translate(...args),
    setTransform:(...args) => nativeCtx.setTransform(...args),
    clip:        (...args) => nativeCtx.clip(...args),
    measureText: (t)       => nativeCtx.measureText(t),

    drawImage: (source, ...rest) => {
      const resolved = resolveImageSource(source);
      nativeCtx.drawImage(resolved, ...rest);
    },

    getImageData: (sx, sy, sw, sh) => {
      const raw = nativeCtx.getImageData(sx, sy, sw, sh);
      return {
        data: new Uint8ClampedArray(raw.data.buffer ?? raw.data),
        width:  raw.width,
        height: raw.height,
      };
    },
    putImageData: (...args) => nativeCtx.putImageData(...args),

    _toDataURL: (type = "image/png") => nativeCanvas.toDataURL(type),
    _nativeCanvas: nativeCanvas,
  };

  return ctx;
}

// Initialize JSDOM environment with real pixel rendering
const canvasContextMap = new WeakMap();
const dom = new JSDOM(htmlContent, {
  url: "http://localhost:8000/benchmark/pages/test-page-1.html",
  runScripts: "dangerously",
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function (contextType) {
      if (contextType !== "2d") return null;
      if (canvasContextMap.has(this)) return canvasContextMap.get(this);
      const w = this.width || 380;
      const h = this.height || 220;
      const ctx = makeRealCanvasContext(w, h, canvasContextMap);
      canvasContextMap.set(this, ctx);
      return ctx;
    };
    window.HTMLCanvasElement.prototype.toDataURL = function (type = "image/png") {
      const ctx = canvasContextMap.get(this);
      if (ctx && ctx._toDataURL) return ctx._toDataURL(type);
      return "data:,";
    };
  },
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.SVGElement = dom.window.SVGElement;
global.XMLSerializer = dom.window.XMLSerializer;
global.performance = globalThis.performance;

// Polyfill element bounding boxes
dom.window.Element.prototype.getBoundingClientRect = function () {
  const id = this.id || "";
  if (id === "revenue-chart") {
    return { left: 450, top: 80, width: 380, height: 220, right: 830, bottom: 300 };
  }
  if (id === "user-avatar") {
    return { left: 340, top: 20, width: 48, height: 48, right: 388, bottom: 68 };
  }
  return { left: 24, top: 100, width: 200, height: 24, right: 224, bottom: 124 };
};

const doc = dom.window.document;

// ----------------------------------------------------
// TEST 1: Model Initialization vs Per-Call Latency
// ----------------------------------------------------
console.log("\n[TEST 1] Measuring Model Initialization vs Inference Latency...");
const initTimeMs = await initializeFlorenceModel();
console.log(`[TIMING] Florence-2 First-Load Model Download/Init: ${initTimeMs.toFixed(3)} ms`);

// ----------------------------------------------------
// TEST 2: Pixel Cropping from Non-DOM Elements (<canvas>)
// ----------------------------------------------------
console.log("\n[TEST 2] Testing Pixel Crop from Canvas Element...");
const canvasEl = doc.getElementById("revenue-chart");
if (!canvasEl) throw new Error("Canvas element not found in test fixture!");

const crop = await captureElementPixels(canvasEl);
console.log(`[CROP] Cropped canvas bounding box: [${crop.boundingBox.join(", ")}]`);
console.log(`[CROP] Crop dimensions: ${crop.width}x${crop.height}`);

if (crop.width !== 380 || crop.height !== 220) {
  throw new Error(`Crop dimensions incorrect: expected 380x220, got ${crop.width}x${crop.height}`);
}
console.log("✓ Canvas pixel buffer successfully isolated to exact DOM bounding box.");

// ----------------------------------------------------
// TEST 3: Florence-2 <OD> and <OCR> Detection on Chart Bars
// ----------------------------------------------------
console.log("\n[TEST 3] Running Florence-2 <OD> and <OCR> on Canvas Chart...");
const visionRes = await runFlorenceVision("revenue-chart", crop, "<OD>");
console.log(`[TIMING] Florence-2 Inference Time: ${visionRes.inferenceTimeMs.toFixed(3)} ms (Device: ${visionRes.device})`);
console.log(`[DETECTION] Total detected visual elements: ${visionRes.detections.length}`);

// Verify quarterly chart bars are identified
const chartBars = visionRes.detections.filter((d) => d.role === "chart_bar");
if (chartBars.length < 4) {
  throw new Error(`Expected at least 4 chart bars from visual analysis, found: ${chartBars.length}`);
}
chartBars.forEach((bar, idx) => {
  console.log(`  ✓ Identified chart bar ${idx + 1} at bbox: [${bar.bbox.join(", ")}] (score: ${bar.score})`);
});

// ----------------------------------------------------
// TEST 4: Tesseract.js Fallback OCR & Cross-Check
// ----------------------------------------------------
console.log("\n[TEST 4] Running Tesseract.js Fallback OCR & Cross-Checking...");
const ocrRes = await runFallbackOCR("revenue-chart", crop);
console.log(`[TIMING] OCR Inference Time: ${ocrRes.inferenceTimeMs.toFixed(3)} ms`);
console.log(`[OCR] Detected text spans: ${ocrRes.spans.map((s) => s.text).join(", ")}`);

// Verify OCR execution and spans
if (!ocrRes || typeof ocrRes.inferenceTimeMs !== "number" || !Array.isArray(ocrRes.spans)) {
  throw new Error("OCR did not return valid result structure");
}
console.log(`✓ Fallback OCR successfully executed: ${ocrRes.spans.length} text spans detected in ${ocrRes.inferenceTimeMs.toFixed(1)} ms.`);

// ----------------------------------------------------
// TEST 5: BlazeFace Specialist Face Detection on Avatar
// ----------------------------------------------------
console.log("\n[TEST 5] Testing BlazeFace Specialist on Customer Avatar...");
const avatarEl = doc.getElementById("user-avatar");
if (!avatarEl) throw new Error("Avatar element not found in test fixture!");

const avatarCrop = await captureElementPixels(avatarEl);
const faceRes = await detectFacesInCrop(avatarCrop, avatarEl);
console.log(`[TIMING] BlazeFace Face Inference Time: ${faceRes.inferenceTimeMs.toFixed(3)} ms`);
console.log(`[FACE] Detected faces: ${faceRes.faces.length}`);

if (faceRes.faces.length !== 1) {
  throw new Error(`Expected exactly 1 face on user avatar, found ${faceRes.faces.length}`);
}

const face = faceRes.faces[0];
console.log(`  ✓ Face detected at bbox: [${face.bbox.join(", ")}] (score: ${face.score})`);
console.log(`  ✓ Facial landmarks mapped: ${face.landmarks?.length} points`);

// ----------------------------------------------------
// TEST 6: Unified Evidence Fusion into PageState
// ----------------------------------------------------
console.log("\n[TEST 6] Testing Evidence Fusion into Standard PageState...");
const basePageState = {
  url: "http://localhost:8000/benchmark/pages/test-page-1.html",
  title: "Test Page",
  timestamp: Date.now(),
  elements: [
    {
      target_id: "revenue-chart",
      role: "canvas",
      text: "Revenue Chart Container",
      bbox: [450, 80, 380, 220],
      confidence: 1.0,
      sensitive: false,
      task_relevance: 0.0,
      sources: ["dom"],
    },
  ],
};

const fusionResult = fusePerceptionEvidence(
  basePageState,
  "revenue-chart",
  visionRes,
  ocrRes,
  faceRes
);

console.log(`[FUSION] Total PageState elements after fusion: ${fusionResult.pageState.elements.length}`);
console.log(`[FUSION] Newly fused vision/ocr/cv elements: ${fusionResult.fusedElements.length}`);
console.log(`[TIMING] Total Fusion Latency: ${fusionResult.timing.totalFusionMs.toFixed(3)} ms`);

// Verify provenance
const visionElement = fusionResult.pageState.elements.find((el) => el.target_id === "revenue-chart_bar_4");
if (!visionElement || !visionElement.sources.includes("vision")) {
  throw new Error("Fused element missing 'vision' provenance!");
}
console.log(`✓ Q4 Bar provenance verified: sources=[${visionElement.sources.join(", ")}], conf=${visionElement.confidence}`);

const faceElement = fusionResult.pageState.elements.find((el) => el.role === "face");
if (!faceElement || !faceElement.sensitive || !faceElement.sources.includes("cv")) {
  throw new Error("Fused face element not properly tagged sensitive with source 'cv'!");
}
console.log(`✓ Face element provenance verified: role="${faceElement.role}", sensitive=${faceElement.sensitive}, source=[${faceElement.sources.join(", ")}]`);

console.log("--------------------------------------------------");
console.log("[ALL TESTS PASSED] Prompt 3 Local Vision & Perception Engine successfully verified!");
process.exit(0);
