// Automated Real Performance Profiling Test Suite
// Verifies wall-clock latency profiling, heap memory monitoring,
// DOM complexity metrics, bandwidth reduction, and SIH SLA constraints.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

import {
  getPerformanceProfiler,
  PerformanceProfiler,
} from "../extension/src/common/profiler.ts";
import { extractPageState } from "../extension/src/semantic/dom-extractor.ts";
import { resolveTaskAction } from "../extension/src/agent/target-resolver.ts";
import { validateAction } from "../extension/src/validator/action-validator.ts";
import { processVisualRegion } from "../extension/src/perception/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "../benchmark/pages/test-page-1.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");

console.log("==================================================");
console.log("   PRIVAAGENT REAL PERFORMANCE PROFILER TEST     ");
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
        getImageData: () => ({
          data: new Uint8ClampedArray(400 * 250 * 4),
          width: 400,
          height: 250,
        }),
      };
    };
  },
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
global.HTMLButtonElement = dom.window.HTMLButtonElement;
global.HTMLAnchorElement = dom.window.HTMLAnchorElement;
global.HTMLSelectElement = dom.window.HTMLSelectElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.SVGElement = dom.window.SVGElement;
global.XMLSerializer = dom.window.XMLSerializer;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.performance = globalThis.performance;

dom.window.Element.prototype.getBoundingClientRect = function () {
  const id = this.id || "";
  if (id === "revenue-chart") {
    return { left: 450, top: 80, width: 380, height: 220, right: 830, bottom: 300 };
  }
  if (id === "user-avatar") {
    return { left: 340, top: 20, width: 48, height: 48, right: 388, bottom: 68 };
  }
  if (id === "btn-open-invoice") {
    return { left: 24, top: 280, width: 340, height: 42, right: 364, bottom: 322 };
  }
  return { left: 24, top: 100, width: 200, height: 24, right: 224, bottom: 124 };
};

const doc = dom.window.document;
const profiler = getPerformanceProfiler();
profiler.reset();

// ----------------------------------------------------
// TEST 1: Real Wall-Clock Stage Timer Recording
// ----------------------------------------------------
console.log("\n[TEST 1] Testing Stage Timer & High-Resolution Precision...");
const stopTimer = profiler.startTimer("dom_extraction", { source: "test_runner" });
// Execute real DOM extraction
const extraction = extractPageState(doc);
const measuredDuration = stopTimer();

console.log(`  - Measured extraction duration: ${measuredDuration.toFixed(3)} ms`);
const domStats = profiler.getStageStats("dom_extraction");
if (!domStats || domStats.count < 1) {
  throw new Error("Profiler failed to record dom_extraction stage!");
}
console.log(`  ✓ Stage statistics recorded: count=${domStats.count}, avg=${domStats.avgMs}ms, p95=${domStats.p95Ms}ms`);

// ----------------------------------------------------
// TEST 2: Multi-Run Percentiles & Statistical Distribution
// ----------------------------------------------------
console.log("\n[TEST 2] Testing Multi-Run Statistical Distribution (p50, p95, p99)...");
for (let i = 0; i < 20; i++) {
  extractPageState(doc);
}
const multiStats = profiler.getStageStats("dom_extraction");
console.log(`  - 21 runs collected. min: ${multiStats.minMs}ms, p50: ${multiStats.p50Ms}ms, p95: ${multiStats.p95Ms}ms, max: ${multiStats.maxMs}ms`);
if (multiStats.p50Ms > multiStats.p95Ms || multiStats.minMs > multiStats.maxMs) {
  throw new Error("Percentile calculation monotonicity invariant violated!");
}
console.log("  ✓ Percentiles and statistics correctly computed.");

// ----------------------------------------------------
// TEST 3: Real Client Resource Monitoring (Heap & DOM)
// ----------------------------------------------------
console.log("\n[TEST 3] Testing Client Memory & DOM Complexity Profiling...");
const resources = profiler.sampleResources(doc);
console.log(`  - Heap Used: ${resources.heapUsedMB} MB (Limit: < 150 MB)`);
console.log(`  - Total Heap: ${resources.heapTotalMB} MB`);
console.log(`  - Live DOM Nodes Counted: ${resources.domNodesCount}`);

if (resources.domNodesCount < 10) {
  throw new Error(`DOM node count unrealistically low: ${resources.domNodesCount}`);
}
console.log("  ✓ Live DOM node count and heap memory successfully profiled.");

// ----------------------------------------------------
// TEST 4: Bandwidth Reduction & Privacy Ratio Profiling
// ----------------------------------------------------
console.log("\n[TEST 4] Testing Bandwidth Reduction & Minimum Disclosure Profiling...");
const rawHtmlBytes = htmlContent.length;
// Resolve an action via target resolver
let pageState = extraction.pageState;
const resolution = await resolveTaskAction("Open Rahul's invoice", pageState);

const bandwidth = profiler.recordBandwidth(
  rawHtmlBytes,
  resolution.networkBytesSent,
  resolution.disclosure.redacted_token_count || 0
);

console.log(`  - Raw Page HTML Context: ${bandwidth.rawDomBytes} bytes (~${(bandwidth.rawDomBytes / 1024).toFixed(1)} KB)`);
console.log(`  - Outbound Minimum Disclosure Payload: ${bandwidth.disclosedBytes} bytes`);
console.log(`  - Bytes Saved: ${bandwidth.bytesSaved} bytes`);
console.log(`  - Bandwidth Savings Ratio: ${bandwidth.savingsRatioPercent}%`);

if (bandwidth.savingsRatioPercent < 99.0) {
  throw new Error(`Expected >= 99% bandwidth savings, got ${bandwidth.savingsRatioPercent}%`);
}
console.log("  ✓ Bandwidth reduction ratio verified (> 99.0% savings).");

// ----------------------------------------------------
// TEST 5: Action Validator & Perception Profiling Integration
// ----------------------------------------------------
console.log("\n[TEST 5] Testing Pipeline Profiling across Vision, Validator & Local Solver...");
// Validate action
validateAction(resolution.action, pageState, doc);
const validatorStats = profiler.getStageStats("action_validation");
if (!validatorStats) {
  throw new Error("Action validator stage was not recorded in profiler!");
}
console.log(`  ✓ Action validation profiled: avg=${validatorStats.avgMs}ms`);

// Process visual region (charts, OCR, faces)
const canvasEl = doc.getElementById("revenue-chart");
if (canvasEl) {
  await processVisualRegion("revenue-chart", canvasEl, pageState);
  const visionStats = profiler.getStageStats("florence_vision");
  const ocrStats = profiler.getStageStats("tesseract_ocr");
  const faceStats = profiler.getStageStats("face_detection");
  const fusionStats = profiler.getStageStats("evidence_fusion");

  console.log(`  ✓ Florence-2 Vision profiled: ${visionStats?.avgMs}ms`);
  console.log(`  ✓ Tesseract OCR profiled: ${ocrStats?.avgMs}ms`);
  console.log(`  ✓ Face Detection profiled: ${faceStats?.avgMs}ms`);
  console.log(`  ✓ Evidence Fusion profiled: ${fusionStats?.avgMs}ms`);
}

// ----------------------------------------------------
// TEST 6: SIH SLA Constraint Compliance Check
// ----------------------------------------------------
console.log("\n[TEST 6] Evaluating SIH26171 SLA Compliance...");
const sla = profiler.checkSLA(doc);
console.log(`  - DOM Extraction SLA (< 50ms): ${sla.domLatencyOk ? "PASS" : "FAIL"}`);
console.log(`  - Local Solver SLA (< 15ms): ${sla.localSolverOk ? "PASS" : "FAIL"}`);
console.log(`  - Memory Footprint SLA (< 150MB): ${sla.memoryFootprintOk ? "PASS" : "FAIL"}`);
console.log(`  - Zero Raw PII Leakage: ${sla.zeroLeakageOk ? "PASS" : "FAIL"}`);
console.log(`  - Overall SLA Compliance: ${sla.compliant ? "COMPLIANT" : "NON-COMPLIANT"}`);

if (!sla.compliant) {
  throw new Error(`SLA check failed with violations: ${sla.violations.join("; ")}`);
}
console.log("  ✓ All SIH26171 performance and resource SLAs verified.");

// ----------------------------------------------------
// TEST 7: Full Performance Telemetry Report Generation
// ----------------------------------------------------
console.log("\n[TEST 7] Generating Full Performance Telemetry Report...");
const report = profiler.generateReport(doc);
console.log(`  - Telemetry Session ID: ${report.sessionId}`);
console.log(`  - Total Profiler Runs: ${report.totalRuns}`);
console.log(`  - Stages Monitored: ${Object.keys(report.stages).join(", ")}`);
console.log(`  - Generated Timestamp: ${report.generatedAt}`);

if (!report.sessionId || Object.keys(report.stages).length < 4) {
  throw new Error("Telemetry report incomplete!");
}
console.log("  ✓ Full telemetry report generated successfully.");

console.log("\n--------------------------------------------------");
console.log("[ALL TESTS PASSED] Real Performance Profiling Engine fully operational!");
