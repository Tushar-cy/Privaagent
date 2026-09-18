// Diagnostic script: dump revenue-chart canvas crop to PNG, then test
// Tesseract with 2x upscaling and PSM 11 (sparse text) to see if Q1-Q4 labels
// become legible. Run from extension/ dir:
//   npx tsx ../benchmark/scripts/diagnose-metric1.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import { JSDOM } from "../../extension/node_modules/jsdom/lib/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR  = path.resolve(__dirname, "../..");

const _require = createRequire(
  pathToFileURL(path.resolve(ROOT_DIR, "extension/package.json"))
);
const { createCanvas, createImageData } = _require("@napi-rs/canvas");

// ---- replicate the exact canvas setup from run-benchmark.mjs ----
function makeRealCanvasContext(width, height, canvasContextMap) {
  const nativeCanvas = createCanvas(width, height);
  const nativeCtx = nativeCanvas.getContext("2d");

  function resolveImageSource(source) {
    if (source && canvasContextMap && canvasContextMap.has(source)) {
      return canvasContextMap.get(source)._nativeCanvas;
    }
    return source;
  }

  return {
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
    fillRect: (...a)    => nativeCtx.fillRect(...a),
    beginPath: ()       => nativeCtx.beginPath(),
    moveTo: (...a)      => nativeCtx.moveTo(...a),
    lineTo: (...a)      => nativeCtx.lineTo(...a),
    stroke: ()          => nativeCtx.stroke(),
    fillText: (...a)    => nativeCtx.fillText(...a),
    drawImage: (src, ...rest) => nativeCtx.drawImage(resolveImageSource(src), ...rest),
    getImageData: (sx, sy, sw, sh) => {
      const raw = nativeCtx.getImageData(sx, sy, sw, sh);
      return { data: new Uint8ClampedArray(raw.data.buffer ?? raw.data), width: raw.width, height: raw.height };
    },
    _toDataURL: (type = "image/png") => nativeCanvas.toDataURL(type),
    _nativeCanvas: nativeCanvas,
  };
}

function createDOMEnvironment(htmlFilePath) {
  const htmlContent = fs.readFileSync(htmlFilePath, "utf-8");
  const canvasContextMap = new WeakMap();
  const dom = new JSDOM(htmlContent, {
    url: "http://localhost:8000/benchmark/page.html",
    runScripts: "dangerously",
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = function (type) {
        if (type !== "2d") return null;
        if (canvasContextMap.has(this)) return canvasContextMap.get(this);
        const ctx = makeRealCanvasContext(this.width || 300, this.height || 150, canvasContextMap);
        canvasContextMap.set(this, ctx);
        return ctx;
      };
      window.HTMLCanvasElement.prototype.toDataURL = function (type = "image/png") {
        const ctx = canvasContextMap.get(this);
        return ctx?._toDataURL(type) ?? "data:,";
      };
    },
  });
  dom.window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === "revenue-chart") return { left: 450, top: 80, width: 380, height: 220 };
    return { left: 0, top: 0, width: 100, height: 100 };
  };
  global.window   = dom.window;
  global.document = dom.window.document;
  global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  global.performance = globalThis.performance;
  return { dom, canvasContextMap };
}

const { dom } = createDOMEnvironment(
  path.resolve(ROOT_DIR, "benchmark/pages/test-page-1.html")
);
const doc = dom.window.document;
const canvasEl = doc.getElementById("revenue-chart");

if (!canvasEl) {
  console.error("Could not find #revenue-chart");
  process.exit(1);
}

// Get the data URL of the rendered chart
const dataUrl = canvasEl.toDataURL("image/png");
console.log(`toDataURL length: ${dataUrl.length} chars`);
console.log(`Is real data: ${dataUrl.length > 100 && dataUrl !== "data:,"}`);

// Save the raw crop PNG
const b64 = dataUrl.replace("data:image/png;base64,", "");
const cropPath = path.resolve(ROOT_DIR, "benchmark/results/revenue-chart-crop.png");
fs.writeFileSync(cropPath, Buffer.from(b64, "base64"));
console.log(`\nCrop saved to: ${cropPath}`);
console.log(`Crop dimensions: ${canvasEl.width}x${canvasEl.height}px`);

// Now produce a 2x upscaled version
const upscaledCanvas = createCanvas(canvasEl.width * 2, canvasEl.height * 2);
const upCtx = upscaledCanvas.getContext("2d");
upCtx.imageSmoothingEnabled = false;

// Draw the original into the 2x canvas
const origCanvas = canvasEl.getContext("2d")._nativeCanvas;
upCtx.drawImage(origCanvas, 0, 0, canvasEl.width * 2, canvasEl.height * 2);

const upscaledDataUrl = upscaledCanvas.toDataURL("image/png");
const upscaledPath = path.resolve(ROOT_DIR, "benchmark/results/revenue-chart-crop-2x.png");
fs.writeFileSync(upscaledPath, Buffer.from(upscaledDataUrl.replace("data:image/png;base64,", ""), "base64"));
console.log(`2x upscaled crop saved to: ${upscaledPath}`);

// Run Tesseract on original and 2x versions with different PSM modes
const Tesseract = _require("tesseract.js");

async function runOCR(imageDataUrl, label, psm) {
  const worker = await Tesseract.createWorker("eng", 1, { logger: () => {} });
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(imageDataUrl);
  await worker.terminate();
  const words = data.words.filter(w => w.text.trim() && w.confidence > 20);
  console.log(`\n${label} (PSM ${psm}):`);
  console.log(`  Words recognized: ${words.length}`);
  words.forEach(w => console.log(`    "${w.text}" conf=${w.confidence.toFixed(0)} bbox=[${w.bbox.x0},${w.bbox.y0}]`));
  return words;
}

console.log("\n--- OCR Test Results ---");
const orig1x   = await runOCR(dataUrl,          "Original 1x",   6);  // PSM 6: uniform block
const orig11   = await runOCR(dataUrl,          "Original 1x",  11);  // PSM 11: sparse text
const up2x6    = await runOCR(upscaledDataUrl,  "Upscaled 2x",   6);
const up2x11   = await runOCR(upscaledDataUrl,  "Upscaled 2x",  11);

// Check which run found Q1/Q2/Q3/Q4
function hasQuarterLabels(words) {
  const texts = words.map(w => w.text.toUpperCase());
  const found = ["Q1","Q2","Q3","Q4"].filter(q => texts.some(t => t.includes(q)));
  return found;
}

console.log("\n--- Quarter Label Detection Summary ---");
console.log(`Original 1x  PSM 6:  ${hasQuarterLabels(orig1x).join(", ") || "NONE FOUND"}`);
console.log(`Original 1x  PSM 11: ${hasQuarterLabels(orig11).join(", ") || "NONE FOUND"}`);
console.log(`Upscaled 2x  PSM 6:  ${hasQuarterLabels(up2x6).join(", ") || "NONE FOUND"}`);
console.log(`Upscaled 2x  PSM 11: ${hasQuarterLabels(up2x11).join(", ") || "NONE FOUND"}`);

const bestResult = [...up2x6, ...up2x11, ...orig11];
const quarterCount = hasQuarterLabels(bestResult).length;
console.log(`\nBest case: ${quarterCount}/4 quarter labels detectable by OCR`);
console.log(`Metric 1 with OCR labels: ${Math.min(5, 1 + quarterCount)}/5 = ${Math.min(100, 20 + quarterCount*20).toFixed(0)}%`);
