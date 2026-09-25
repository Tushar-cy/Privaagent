// Internal Self-Evaluation Harness — Privaagent SIH26171
// Computes scores across 5 metrics:
//   1. Visual Context Accuracy (25%)
//   2. PII Detection Accuracy (20%)
//   3. Redaction Precision & Masking Quality (20%)
//   4. Client Resource Utilization (20%)
//   5. End-to-End Task Completion Latency (15%)
//
// Run from the extension/ directory:
//   npx tsx ../benchmark/scripts/run-benchmark.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import { JSDOM } from "../../extension/node_modules/jsdom/lib/api.js";

// @napi-rs/canvas is installed in extension/node_modules.
// The benchmark script lives in benchmark/scripts/, so we must resolve it
// explicitly from the extension directory — Node won't walk up to find it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(
  pathToFileURL(path.resolve(__dirname, "../../extension/package.json"))
);
const { createCanvas } = _require("@napi-rs/canvas");

// Import Privaagent perception, privacy, agent, and validator engines
import { extractPageState } from "../../extension/src/semantic/dom-extractor.ts";
import { processVisualRegion, initializeFlorenceModel } from "../../extension/src/perception/index.ts";
import { detectStructuredPII } from "../../extension/src/privacy/pii-detector.ts";
import { detectSecrets } from "../../extension/src/privacy/secret-detector.ts";
import { detectNamedEntities } from "../../extension/src/privacy/ner-detector.ts";
import { annotateElementSensitivity } from "../../extension/src/privacy/sensitivity.ts";
import { redactElementText } from "../../extension/src/privacy/redactor.ts";
import { resolveTaskAction } from "../../extension/src/agent/target-resolver.ts";
import { validateAction } from "../../extension/src/validator/action-validator.ts";
import { scanTextForInjection } from "../../extension/src/validator/prompt-injection.ts";

const ROOT_DIR = path.resolve(__dirname, "../.."); 
const TASKS_PATH = path.resolve(__dirname, "../tasks/benchmark-tasks.json");
const COMPREHENSIVE_PII_PATH = path.resolve(__dirname, "../pii/comprehensive-pii-dataset.json");
const PII_SNIPPETS_PATH = fs.existsSync(COMPREHENSIVE_PII_PATH)
  ? COMPREHENSIVE_PII_PATH
  : path.resolve(__dirname, "../pii/labeled-snippets.json");
const REPORT_PATH = path.resolve(__dirname, "../results/report.json");

console.log("╔════════════════════════════════════════════════════════════════════════╗");
console.log("║            PRIVAAGENT INTERNAL SELF-EVALUATION HARNESS                ║");
console.log("║      On-Device Visual Perception for Light-weight Browser Agents       ║");
console.log("╚════════════════════════════════════════════════════════════════════════╝\n");
console.log("  NOTE: This is an internal self-evaluation harness, not an official");
console.log("  SIH benchmark. Run `npx tsx benchmark/scripts/run-benchmark.mjs`");
console.log("  to reproduce. Results depend on whether Tesseract.js can run in");
console.log("  the Node/JSDOM environment (WASM worker path — may not be available).\n");

// ---------------------------------------------------------------------------
// Real canvas factory backed by @napi-rs/canvas
// ---------------------------------------------------------------------------
/**
 * Creates a real @napi-rs/canvas backed context for a given width/height.
 *
 * canvasContextMap: the per-DOM WeakMap from JSDOM canvas elements → their
 * real contexts. Passed in so drawImage can resolve JSDOM canvas sources to
 * their backing napi-rs native canvas — @napi-rs/canvas only accepts its own
 * native Canvas type, not arbitrary JSDOM element objects.
 *
 * This replaces the former all-zero stub: getImageData() and toDataURL()
 * now return actual rendered pixel data from the page's own drawBarChart() IIFE.
 */
function makeRealCanvasContext(width, height, canvasContextMap) {
  const nativeCanvas = createCanvas(width, height);
  const nativeCtx = nativeCanvas.getContext("2d");

  /**
   * Resolve a drawImage source to something @napi-rs/canvas accepts.
   * If it's a JSDOM canvas element, look up its backing napi-rs canvas.
   * Otherwise pass it through as-is (Image, etc).
   */
  function resolveImageSource(source) {
    if (source && canvasContextMap && canvasContextMap.has(source)) {
      // This is a JSDOM canvas element — return the napi-rs native canvas backing it
      return canvasContextMap.get(source)._nativeCanvas;
    }
    return source;
  }

  const ctx = {
    // ---- drawing ops (proxied to real canvas) ----
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

    // drawImage: resolve JSDOM canvas sources to their napi-rs native backing
    drawImage: (source, ...rest) => {
      const resolved = resolveImageSource(source);
      nativeCtx.drawImage(resolved, ...rest);
    },

    // ---- pixel readback (previously stubbed as all-zero) ----
    getImageData: (sx, sy, sw, sh) => {
      const raw = nativeCtx.getImageData(sx, sy, sw, sh);
      return {
        data: new Uint8ClampedArray(raw.data.buffer ?? raw.data),
        width:  raw.width,
        height: raw.height,
      };
    },
    putImageData: (...args) => nativeCtx.putImageData(...args),

    // ---- data URL export (previously returning "data:,") ----
    _toDataURL: (type = "image/png") => nativeCanvas.toDataURL(type),
    _nativeCanvas: nativeCanvas,
  };

  return ctx;
}

// ---------------------------------------------------------------------------
// Setup DOM Environment Helper
// ---------------------------------------------------------------------------
function createDOMEnvironment(htmlFilePath) {
  const htmlContent = fs.readFileSync(htmlFilePath, "utf-8");

  // Registry: maps each JSDOM canvas element (by identity) to its real context
  const canvasContextMap = new WeakMap();

  const dom = new JSDOM(htmlContent, {
    url: "http://localhost:8000/benchmark/page.html",
    runScripts: "dangerously",
    beforeParse(window) {
      // Intercept getContext on ALL canvas elements and back them with real rendering.
      // This applies both to canvases in the page HTML and to any created by document.createElement.
      window.HTMLCanvasElement.prototype.getContext = function (contextType) {
        if (contextType !== "2d") return null;

        // Reuse the same real context for the same JSDOM canvas element
        if (canvasContextMap.has(this)) {
          return canvasContextMap.get(this);
        }

        const w = this.width  || 300;
        const h = this.height || 150;
        const ctx = makeRealCanvasContext(w, h, canvasContextMap);
        canvasContextMap.set(this, ctx);
        return ctx;
      };

      // Wire toDataURL on the canvas element to the real native canvas
      window.HTMLCanvasElement.prototype.toDataURL = function (type = "image/png") {
        const ctx = canvasContextMap.get(this);
        if (ctx && ctx._toDataURL) return ctx._toDataURL(type);
        return "data:,"; // Honest empty signal if context was never obtained
      };
    },
  });

  global.window   = dom.window;
  global.document = dom.window.document;
  global.Element              = dom.window.Element;
  global.HTMLElement          = dom.window.HTMLElement;
  global.HTMLInputElement     = dom.window.HTMLInputElement;
  global.HTMLTextAreaElement  = dom.window.HTMLTextAreaElement;
  global.HTMLButtonElement    = dom.window.HTMLButtonElement;
  global.HTMLAnchorElement    = dom.window.HTMLAnchorElement;
  global.HTMLSelectElement    = dom.window.HTMLSelectElement;
  global.HTMLCanvasElement    = dom.window.HTMLCanvasElement;
  global.SVGElement           = dom.window.SVGElement;
  global.XMLSerializer        = dom.window.XMLSerializer;
  global.Node                 = dom.window.Node;
  global.performance          = globalThis.performance;

  const origGetComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  const styleCache = new WeakMap();
  dom.window.getComputedStyle = function (el) {
    if (el && styleCache.has(el)) return styleCache.get(el);
    const s = origGetComputedStyle(el);
    if (el) styleCache.set(el, s);
    return s;
  };
  global.getComputedStyle = dom.window.getComputedStyle;

  dom.window.Element.prototype.getBoundingClientRect = function () {
    const id = this.id || "";
    if (id === "revenue-chart")    return { left: 450, top: 80,  width: 380, height: 220, right: 830, bottom: 300 };
    if (id === "user-avatar")      return { left: 340, top: 20,  width:  48, height:  48, right: 388, bottom:  68 };
    if (id === "btn-open-invoice") return { left:  24, top: 280, width: 340, height:  42, right: 364, bottom: 322 };
    if (id === "btn-view-statement") return { left: 24, top: 50,  width: 140, height:  36, right: 164, bottom:  86 };
    if (id === "btn-pay-now")      return { left:  24, top: 100, width: 160, height:  36, right: 184, bottom: 136 };
    if (id === "btn-delete-account") return { left: 200, top: 100, width: 220, height: 36, right: 420, bottom: 136 };
    return { left: 24, top: 100, width: 200, height: 24, right: 224, bottom: 124 };
  };

  return dom;
}

// =========================================================================
// METRIC 1: Visual Context Accuracy (25%)
// =========================================================================
console.log(">>> [METRIC 1/5] Evaluating Visual Context Accuracy (Weight: 25%)...");
console.log("  Canvas backend: @napi-rs/canvas (real pixel rendering)");
console.log("  Test page's drawBarChart() IIFE will paint real pixels via getContext('2d').");
console.log("  cv-analyzer.ts luminance-contrast detection runs on real pixel buffer.\n");

const dom1 = createDOMEnvironment(path.resolve(ROOT_DIR, "benchmark/pages/test-page-1.html"));
const doc1 = dom1.window.document;

const canvasEl = doc1.getElementById("revenue-chart");
const avatarEl = doc1.getElementById("user-avatar");
let basePageState = extractPageState(doc1).pageState;

if (canvasEl) {
  console.log(`  Canvas element found: #revenue-chart (${canvasEl.width}x${canvasEl.height})`);

  // Verify toDataURL produces a real non-trivial result
  const dataUrl = canvasEl.toDataURL("image/png");
  const isRealPixels = dataUrl && dataUrl !== "data:," && dataUrl.length > 100;
  console.log(`  toDataURL check: ${isRealPixels ? "✓ real pixel data (" + dataUrl.length + " chars)" : "✗ still returning empty/stub"}`);

  if (!isRealPixels) {
    console.warn("  WARNING: toDataURL still returns empty/stub. OCR fast-path will not fire.");
    console.warn("  Classical CV (cv-analyzer) will be the only active detection path.");
  }

  const f1 = await processVisualRegion("revenue-chart", canvasEl, basePageState);
  basePageState = f1.pageState;
  console.log(`  Perception pipeline ran. Fused elements from canvas: ${f1.fusedElements.length}`);
}
if (avatarEl) {
  const f2 = await processVisualRegion("user-avatar", avatarEl, basePageState);
  basePageState = f2.pageState;
}
const fusedState = basePageState;

// Ground truth expected visual elements: 4 chart bars + 1 face
const visualGroundTruth = ["Q1", "Q2", "Q3", "Q4", "face"];
let detectedCount = 0;

for (const label of ["Q1", "Q2", "Q3", "Q4"]) {
  const found = fusedState.elements.some((el) => el.text?.includes(label) && el.sources.includes("vision"));
  console.log(`  Label "${label}": ${found ? "✓ DETECTED (sources include vision/cv)" : "✗ not found in fused elements"}`);
  if (found) detectedCount++;
}
const faceFound = fusedState.elements.some((el) => el.role === "face" && el.sources.includes("cv"));
console.log(`  Label "face": ${faceFound ? "✓ DETECTED" : "✗ not found"}`);
if (faceFound) detectedCount++;

const visualAccuracyScore = (detectedCount / visualGroundTruth.length) * 100;
console.log(`\n  → Visual Elements Detected: ${detectedCount} / ${visualGroundTruth.length}`);
console.log(`  → Visual Context Accuracy Score: ${visualAccuracyScore.toFixed(2)}%`);

if (detectedCount === 0) {
  console.log("  NOTE: 0/5 is an honest result if neither classical CV nor OCR could");
  console.log("  run in this Node/JSDOM environment. See Known Limitations in README.");
}
console.log();

// =========================================================================
// METRIC 2: PII & Sensitive Entity Detection Accuracy (20%)
// =========================================================================
console.log(">>> [METRIC 2/5] Evaluating PII Detection Accuracy (Weight: 20%)...");
const rawSnippets = JSON.parse(fs.readFileSync(PII_SNIPPETS_PATH, "utf-8"));
let tp = 0, fp = 0, fn = 0, tn = 0;

for (const item of rawSnippets) {
  const piiSpans    = detectStructuredPII(item.text);
  const secretSpans = detectSecrets(item.text);
  const nerSpans    = detectNamedEntities(item.text);
  const allSpans    = [...piiSpans, ...secretSpans, ...nerSpans];
  const detected    = allSpans.length > 0;
  const hasPii      = Boolean(item.ground_truth && item.ground_truth.length > 0);

  if (hasPii) {
    if (detected) tp++;
    else          fn++;
  } else {
    if (detected) fp++;
    else          tn++;
  }
}

const precision        = tp / (tp + fp) || 1.0;
const recall           = tp / (tp + fn) || 1.0;
const f1Score          = (2 * precision * recall) / (precision + recall) || 1.0;
const piiDetectionScore = f1Score * 100;

console.log(`  - Labeled Snippets Evaluated: ${rawSnippets.length}`);
console.log(`  - True Positives: ${tp}, False Positives: ${fp}, False Negatives: ${fn}, True Negatives: ${tn}`);
console.log(`  - Precision: ${(precision * 100).toFixed(2)}%, Recall: ${(recall * 100).toFixed(2)}%`);
console.log(`  - PII Detection Accuracy Score (F1): ${piiDetectionScore.toFixed(2)}%\n`);

// =========================================================================
// METRIC 3: Redaction Precision & Masking Quality (20%)
// =========================================================================
console.log(">>> [METRIC 3/5] Evaluating Redaction Precision & Masking Quality (Weight: 20%)...");

const KNOWN_PII_PATTERNS = [
  /[A-Z]{5}[0-9]{4}[A-Z]/,
  /[2-9]\d{3}\s?\d{4}\s?\d{4}/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(?:sk-|ghp_|AKIA)[a-zA-Z0-9_\-]{16,}/,
  /[a-zA-Z0-9.\-_]{2,64}@(okhdfcbank|okaxis|oksbi|paytm|upi|ybl|axl|ibl|apl|icici|kotak)/i,
  /[A-Z]{4}0[A-Z0-9]{6}/,
  /[A-Z][1-9][0-9]{6}/,
  /[A-Z]{3}[0-9]{7}/,
];

let leakCount = 0;
let preservedContextSpans = 0;
let totalTestPhrases = 0;

for (const item of rawSnippets) {
  const hasPii = Boolean(item.ground_truth && item.ground_truth.length > 0);
  if (hasPii) {
    totalTestPhrases++;
    const annotated = annotateElementSensitivity({
      target_id: "test",
      role: "text",
      text: item.text,
      bbox: [0, 0, 0, 0],
      confidence: 1,
      sensitive: false,
      task_relevance: 1,
      sources: ["dom"],
      interactable: false,
    });

    const redacted  = redactElementText("test", null, item.text, annotated.metadata?.sensitive_detections || []);
    const sanitized = redacted.sanitizedText;

    for (const pat of KNOWN_PII_PATTERNS) {
      const match = pat.exec(sanitized);
      if (match && !match[0].startsWith("[")) {
        leakCount++;
      }
    }

    if (sanitized.length > 5) {
      preservedContextSpans++;
    }
  }
}

const leakFreeRate         = totalTestPhrases > 0 ? (totalTestPhrases - leakCount) / totalTestPhrases : 1.0;
const contextRetentionRate = totalTestPhrases > 0 ? preservedContextSpans / totalTestPhrases : 1.0;
const redactionPrecisionScore = (leakFreeRate * 0.7 + contextRetentionRate * 0.3) * 100;

console.log(`  - Outbound Leak Free Rate: ${(leakFreeRate * 100).toFixed(2)}% (Leaks: ${leakCount})`);
console.log(`  - Non-PII Context Retention Rate: ${(contextRetentionRate * 100).toFixed(2)}%`);
console.log(`  - Redaction Precision Score: ${redactionPrecisionScore.toFixed(2)}%\n`);

// =========================================================================
// METRIC 4: Client Resource Utilization (20%)
// =========================================================================
console.log(">>> [METRIC 4/5] Evaluating Client Resource Utilization (Weight: 20%)...");

const memBefore = process.memoryUsage();

const benchDom = createDOMEnvironment(path.resolve(ROOT_DIR, "benchmark/pages/test-page-1.html"));
const benchDoc = benchDom.window.document;
// Warmup pass for V8 engine optimization
extractPageState(benchDoc);

const domLatencies = [];
for (let i = 0; i < 3; i++) {
  const { durationMs } = extractPageState(benchDoc);
  domLatencies.push(durationMs);
}
console.log("  - DOM Latency runs:", domLatencies.map((l) => l.toFixed(2) + "ms").join(", "));
const avgDomLatency = domLatencies.reduce((a, b) => a + b, 0) / domLatencies.length;

const initTimeMs = await initializeFlorenceModel();

const memAfter  = process.memoryUsage();
const heapUsedMB  = memAfter.heapUsed / (1024 * 1024);
const heapDeltaMB = Math.max(0, (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024));
const rssMB       = memAfter.rss / (1024 * 1024);

const domScore      = Math.max(0, Math.min(100, 100 - (avgDomLatency / 50) * 20));
const memoryScore   = Math.max(0, Math.min(100, 100 - (heapUsedMB / 150) * 10));
const clientResourceScore = domScore * 0.7 + memoryScore * 0.3;

console.log(`  - Average DOM Extraction Latency: ${avgDomLatency.toFixed(3)} ms (Constraint: < 50ms)`);
console.log(`  - Model Init & Setup Latency: ${initTimeMs.toFixed(3)} ms`);
console.log(`  - Heap Memory Allocated: ${heapUsedMB.toFixed(2)} MB (Delta: ${heapDeltaMB.toFixed(2)} MB, RSS: ${rssMB.toFixed(2)} MB)`);
console.log(`  - Client Resource Utilization Score: ${clientResourceScore.toFixed(2)}%\n`);

// =========================================================================
// METRIC 5: End-to-End Task Latency & Benchmark Task Execution (15%)
// =========================================================================
console.log(">>> [METRIC 5/5] Evaluating End-to-End Task Completion & Latency (Weight: 15%)...");

const tasks = JSON.parse(fs.readFileSync(TASKS_PATH, "utf-8"));
const taskResults = [];
let localFastPathCount = 0;
let totalFastPathLatency = 0;

const mockFetch = async (url, options) => {
  const body = JSON.parse(options.body);
  const candidateIds = body.elements.map((el) => el.target_id);
  const qBar = candidateIds.find((id) => id.includes("bar_")) || candidateIds[0] || "target";
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      action: "click",
      target_id: qBar,
      reason: `Mock remote VLM resolved task: ${body.task}`,
      confidence: 0.95,
    }),
  };
};

for (const task of tasks) {
  const taskFixturePath = path.resolve(ROOT_DIR, task.fixture);
  const domEnv = createDOMEnvironment(taskFixturePath);
  const doc    = domEnv.window.document;

  let state  = extractPageState(doc).pageState;
  const canvas = doc.getElementById("revenue-chart");
  if (canvas) {
    const fusion = await processVisualRegion("revenue-chart", canvas, state);
    state = fusion.pageState;
  }

  const startT = performance.now();
  let actionResult;
  let validationResult;

  // Tasks with target_element_id exercise the injection-detection path of the
  // real action-validator pipeline.  A synthetic "click" action targeting that
  // element is fed through validateAction, which calls inspectElementForHiddenInjection
  // → scanTextForInjection on the element's textContent.  Injection patterns in
  // the element text produce BLOCK via the real defense code — no bypass shortcut.
  if (task.target_element_id) {
    const syntheticAction = {
      action: "click",
      target_id: task.target_element_id,
      reason: `Benchmark probe: ${task.prompt}`,
      confidence: 1.0,
    };
    validationResult = validateAction(syntheticAction, state, doc);
    const endT   = performance.now();
    const latency = endT - startT;
    localFastPathCount++;
    totalFastPathLatency += latency;

    taskResults.push({
      taskId:          task.id,
      prompt:          task.prompt,
      category:        task.category,
      level:           "L1",
      networkBytesSent: 0,
      latencyMs:       latency,
      verdict:         validationResult.verdict,
      expectedVerdict: task.expected_verdict,
      passed:          validationResult.verdict === task.expected_verdict,
    });
    continue;
  }

  if (task.action_payload) {
    actionResult = {
      action: task.action_payload,
      isLocal: true,
      networkBytesSent: 0,
      disclosure: { level: "L0", reason: "Direct action test", task: task.prompt, elements: [], redacted_token_count: 0 },
    };
  } else {
    actionResult = await resolveTaskAction(task.prompt, state, { fetchFn: mockFetch });
  }

  const endT    = performance.now();
  const latency = endT - startT;

  if (actionResult.isLocal) {
    localFastPathCount++;
    totalFastPathLatency += latency;
  }

  validationResult = validateAction(actionResult.action, state, doc);

  const verdictMatch = validationResult.verdict === task.expected_verdict;
  const levelMatch   = !task.expected_level || actionResult.disclosure.level === task.expected_level;

  taskResults.push({
    taskId:          task.id,
    prompt:          task.prompt,
    category:        task.category,
    level:           actionResult.disclosure.level,
    networkBytesSent: actionResult.networkBytesSent,
    latencyMs:       latency,
    verdict:         validationResult.verdict,
    expectedVerdict: task.expected_verdict,
    passed:          verdictMatch && levelMatch,
  });
}

const passedTasks        = taskResults.filter((r) => r.passed).length;
const taskSuccessRate    = (passedTasks / tasks.length) * 100;
const avgFastPathLatency = localFastPathCount > 0 ? totalFastPathLatency / localFastPathCount : 0;
const latencyScore       = Math.max(0, Math.min(100, taskSuccessRate * 0.8 + (avgFastPathLatency < 15 ? 20 : 10)));

console.log(`  - Benchmark Tasks Passed: ${passedTasks} / ${tasks.length} (${taskSuccessRate.toFixed(1)}%)`);
console.log(`  - Average Local Fast-Path Latency: ${avgFastPathLatency.toFixed(3)} ms (Target: < 15ms)`);
console.log(`  - End-to-End Latency & Accuracy Score: ${latencyScore.toFixed(2)}%\n`);

// =========================================================================
// FINAL AGGREGATE SCORE
// =========================================================================
const finalScore =
  visualAccuracyScore    * 0.25 +
  piiDetectionScore      * 0.20 +
  redactionPrecisionScore * 0.20 +
  clientResourceScore    * 0.20 +
  latencyScore           * 0.15;

console.log("════════════════════════════════════════════════════════════════════════");
console.log("                INTERNAL SELF-EVALUATION SCORECARD                     ");
console.log("════════════════════════════════════════════════════════════════════════");
console.log(`  1. Visual Context Accuracy (25%):        ${visualAccuracyScore.toFixed(2)}% (Score: ${(visualAccuracyScore * 0.25).toFixed(2)})`);
console.log(`  2. PII Detection Accuracy (20%):         ${piiDetectionScore.toFixed(2)}% (Score: ${(piiDetectionScore * 0.20).toFixed(2)})`);
console.log(`  3. Redaction Precision & Quality (20%):  ${redactionPrecisionScore.toFixed(2)}% (Score: ${(redactionPrecisionScore * 0.20).toFixed(2)})`);
console.log(`  4. Client Resource Utilization (20%):    ${clientResourceScore.toFixed(2)}% (Score: ${(clientResourceScore * 0.20).toFixed(2)})`);
console.log(`  5. End-to-End Task & Latency (15%):      ${latencyScore.toFixed(2)}% (Score: ${(latencyScore * 0.15).toFixed(2)})`);
console.log("────────────────────────────────────────────────────────────────────────");
console.log(`  >>> COMPOSITE SCORE:    ${finalScore.toFixed(2)} / 100.00 <<<`);
console.log("════════════════════════════════════════════════════════════════════════\n");
console.log("  To reproduce: cd extension && npx tsx ../benchmark/scripts/run-benchmark.mjs");
console.log("  Canvas backend: @napi-rs/canvas (real rendering)");
console.log("  Vision backend: classical CV (VISION_MODE=lightweight)\n");

// Write JSON report
const report = {
  timestamp: new Date().toISOString(),
  system: "Privaagent On-Device Visual Perception Engine",
  harness: "internal-self-evaluation",
  canvasBackend: "@napi-rs/canvas (real pixel rendering)",
  visionBackend: "classical-cv-lightweight",
  overallScore: finalScore,
  metrics: {
    visualContextAccuracy: {
      weight: 0.25,
      score: visualAccuracyScore,
      weightedScore: visualAccuracyScore * 0.25,
      detectedElements: detectedCount,
      groundTruthElements: visualGroundTruth.length,
      note: "cv-analyzer.ts luminance-contrast detection on real @napi-rs/canvas pixel buffer",
    },
    piiDetectionAccuracy: {
      weight: 0.20,
      score: piiDetectionScore,
      weightedScore: piiDetectionScore * 0.20,
      precision,
      recall,
      f1: f1Score,
      totalEvaluatedSnippets: rawSnippets.length,
    },
    redactionPrecision: {
      weight: 0.20,
      score: redactionPrecisionScore,
      weightedScore: redactionPrecisionScore * 0.20,
      leakCount,
      leakFreeRate,
      contextRetentionRate,
    },
    clientResourceUtilization: {
      weight: 0.20,
      score: clientResourceScore,
      weightedScore: clientResourceScore * 0.20,
      avgDomExtractionLatencyMs: avgDomLatency,
      modelSetupLatencyMs: initTimeMs,
      heapUsedMB,
      heapDeltaMB,
      rssMB,
      memoryBudgetMet: heapUsedMB < 150,
      performanceConstraintMet: avgDomLatency < 50,
    },
    endToEndLatency: {
      weight: 0.15,
      score: latencyScore,
      weightedScore: latencyScore * 0.15,
      benchmarkTasksPassed: passedTasks,
      totalBenchmarkTasks: tasks.length,
      avgLocalFastPathLatencyMs: avgFastPathLatency,
    },
  },
  taskResults,
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
console.log(`✓ Report written to: ${REPORT_PATH}\n`);
process.exit(0);
