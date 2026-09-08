// Automated Local Vision & Evidence Fusion Benchmark Test
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

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

// Initialize JSDOM environment
const dom = new JSDOM(htmlContent, {
  url: "http://localhost:8000/benchmark/pages/test-page-1.html",
  runScripts: "dangerously",
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      return {
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        fillRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillText: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(400 * 250 * 4), width: 400, height: 250 }),
      };
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

// Verify all 4 quarterly bars are identified
const qBars = ["Q1", "Q2", "Q3", "Q4"];
for (const q of qBars) {
  const bar = visionRes.detections.find((d) => d.text.includes(q) && d.role === "chart_bar");
  if (!bar) {
    throw new Error(`Bar for ${q} was not identified by Florence-2!`);
  }
  console.log(`  ✓ Identified ${q} bar at bbox: [${bar.bbox.join(", ")}] (conf: ${bar.confidence})`);
}

// ----------------------------------------------------
// TEST 4: Tesseract.js Fallback OCR & Cross-Check
// ----------------------------------------------------
console.log("\n[TEST 4] Running Tesseract.js Fallback OCR & Cross-Checking...");
const ocrRes = await runFallbackOCR("revenue-chart", crop);
console.log(`[TIMING] OCR Inference Time: ${ocrRes.inferenceTimeMs.toFixed(3)} ms`);
console.log(`[OCR] Detected text spans: ${ocrRes.spans.map((s) => s.text).join(", ")}`);

// Verify labels
for (const q of qBars) {
  const label = ocrRes.spans.find((s) => s.text === q);
  if (!label) {
    throw new Error(`OCR span for ${q} not found!`);
  }
}
console.log("✓ Fallback OCR successfully verified all 4 quarterly bar labels.");

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
console.log(`  ✓ Face detected at bbox: [${face.bbox.join(", ")}] (conf: ${face.confidence})`);
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
