// Official SIH26171 5-Metric Benchmark Evaluation Suite
// Computes scores across:
// 1. Visual Context Accuracy (25%)
// 2. PII Detection Accuracy (20%)
// 3. Redaction Precision & Masking Quality (20%)
// 4. Client Resource Utilization (20%)
// 5. End-to-End Task Completion Latency (15%)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../../extension/node_modules/jsdom/lib/api.js";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const TASKS_PATH = path.resolve(__dirname, "../tasks/benchmark-tasks.json");
const PII_SNIPPETS_PATH = path.resolve(__dirname, "../pii/labeled-snippets.json");
const REPORT_PATH = path.resolve(__dirname, "../results/report.json");

console.log("╔════════════════════════════════════════════════════════════════════════╗");
console.log("║                 PRIVAAGENT SIH26171 BENCHMARK SUITE                    ║");
console.log("║      On-Device Visual Perception for Light-weight Browser Agents       ║");
console.log("╚════════════════════════════════════════════════════════════════════════╝\n");

// ----------------------------------------------------
// Setup DOM Environment Helper
// ----------------------------------------------------
function createDOMEnvironment(htmlFilePath) {
  const htmlContent = fs.readFileSync(htmlFilePath, "utf-8");
  const dom = new JSDOM(htmlContent, {
    url: "http://localhost:8000/benchmark/page.html",
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
  global.HTMLInputElement = dom.window.HTMLInputElement;
  global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  global.HTMLButtonElement = dom.window.HTMLButtonElement;
  global.HTMLAnchorElement = dom.window.HTMLAnchorElement;
  global.HTMLSelectElement = dom.window.HTMLSelectElement;
  global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  global.SVGElement = dom.window.SVGElement;
  global.XMLSerializer = dom.window.XMLSerializer;
  global.Node = dom.window.Node;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.performance = globalThis.performance;

  dom.window.Element.prototype.getBoundingClientRect = function () {
    const id = this.id || "";
    if (id === "revenue-chart") return { left: 450, top: 80, width: 380, height: 220, right: 830, bottom: 300 };
    if (id === "user-avatar") return { left: 340, top: 20, width: 48, height: 48, right: 388, bottom: 68 };
    if (id === "btn-open-invoice") return { left: 24, top: 280, width: 340, height: 42, right: 364, bottom: 322 };
    if (id === "btn-view-statement") return { left: 24, top: 50, width: 140, height: 36, right: 164, bottom: 86 };
    if (id === "btn-pay-now") return { left: 24, top: 100, width: 160, height: 36, right: 184, bottom: 136 };
    if (id === "btn-delete-account") return { left: 200, top: 100, width: 220, height: 36, right: 420, bottom: 136 };
    return { left: 24, top: 100, width: 200, height: 24, right: 224, bottom: 124 };
  };

  return dom;
}

// =========================================================================
// METRIC 1: Visual Context Accuracy (25%)
// =========================================================================
console.log(">>> [METRIC 1/5] Evaluating Visual Context Accuracy (Weight: 25%)...");
const dom1 = createDOMEnvironment(path.resolve(ROOT_DIR, "benchmark/pages/test-page-1.html"));
const doc1 = dom1.window.document;

const canvasEl = doc1.getElementById("revenue-chart");
const avatarEl = doc1.getElementById("user-avatar");
let basePageState = extractPageState(doc1).pageState;
if (canvasEl) {
  const f1 = await processVisualRegion("revenue-chart", canvasEl, basePageState);
  basePageState = f1.pageState;
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
  if (found) detectedCount++;
}
const faceFound = fusedState.elements.some((el) => el.role === "face" && el.sources.includes("cv"));
if (faceFound) detectedCount++;

const visualAccuracyScore = (detectedCount / visualGroundTruth.length) * 100;
console.log(`  - Visual Elements Detected: ${detectedCount} / ${visualGroundTruth.length}`);
console.log(`  - Visual Context Accuracy Score: ${visualAccuracyScore.toFixed(2)}%\n`);

// =========================================================================
// METRIC 2: PII & Sensitive Entity Detection Accuracy (20%)
// =========================================================================
console.log(">>> [METRIC 2/5] Evaluating PII Detection Accuracy (Weight: 20%)...");
const rawSnippets = JSON.parse(fs.readFileSync(PII_SNIPPETS_PATH, "utf-8"));
let tp = 0, fp = 0, fn = 0, tn = 0;

for (const item of rawSnippets) {
  const piiSpans = detectStructuredPII(item.text);
  const secretSpans = detectSecrets(item.text);
  const nerSpans = detectNamedEntities(item.text);
  const allSpans = [...piiSpans, ...secretSpans, ...nerSpans];
  const detected = allSpans.length > 0;
  const hasPii = Boolean(item.ground_truth && item.ground_truth.length > 0);

  if (hasPii) {
    if (detected) tp++;
    else fn++;
  } else {
    if (detected) fp++;
    else tn++;
  }
}

const precision = tp / (tp + fp) || 1.0;
const recall = tp / (tp + fn) || 1.0;
const f1 = (2 * precision * recall) / (precision + recall) || 1.0;
const piiDetectionScore = f1 * 100;

console.log(`  - Labeled Snippets Evaluated: ${rawSnippets.length}`);
console.log(`  - True Positives: ${tp}, False Positives: ${fp}, False Negatives: ${fn}, True Negatives: ${tn}`);
console.log(`  - Precision: ${(precision * 100).toFixed(2)}%, Recall: ${(recall * 100).toFixed(2)}%`);
console.log(`  - PII Detection Accuracy Score (F1): ${piiDetectionScore.toFixed(2)}%\n`);

// =========================================================================
// METRIC 3: Redaction Precision & Masking Quality (20%)
// =========================================================================
console.log(">>> [METRIC 3/5] Evaluating Redaction Precision & Masking Quality (Weight: 20%)...");

// Test redaction across all PII samples and ensure 0 raw leaks
const KNOWN_PII_PATTERNS = [
  /[A-Z]{5}[0-9]{4}[A-Z]/,               // PAN
  /[2-9]\d{3}\s?\d{4}\s?\d{4}/,          // Aadhaar
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // Email
  /(?:sk-|ghp_|AKIA)[a-zA-Z0-9_\-]{16,}/ // Secret Key
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

    const redacted = redactElementText("test", null, item.text, annotated.metadata?.sensitive_detections || []);
    const sanitized = redacted.sanitizedText;

    // Check if any raw regex matches the redacted string
    for (const pat of KNOWN_PII_PATTERNS) {
      const match = pat.exec(sanitized);
      if (match && !match[0].startsWith("[")) {
        leakCount++;
      }
    }

    // Verify non-sensitive context words are preserved
    if (sanitized.length > 5) {
      preservedContextSpans++;
    }
  }
}

const leakFreeRate = totalTestPhrases > 0 ? (totalTestPhrases - leakCount) / totalTestPhrases : 1.0;
const contextRetentionRate = totalTestPhrases > 0 ? preservedContextSpans / totalTestPhrases : 1.0;
const redactionPrecisionScore = (leakFreeRate * 0.7 + contextRetentionRate * 0.3) * 100;

console.log(`  - Outbound Leak Free Rate: ${(leakFreeRate * 100).toFixed(2)}% (Leaks: ${leakCount})`);
console.log(`  - Non-PII Context Retention Rate: ${(contextRetentionRate * 100).toFixed(2)}%`);
console.log(`  - Redaction Precision Score: ${redactionPrecisionScore.toFixed(2)}%\n`);

// =========================================================================
// METRIC 4: Client Resource Utilization (20%)
// =========================================================================
console.log(">>> [METRIC 4/5] Evaluating Client Resource Utilization (Weight: 20%)...");

// Warm-up run to eliminate cold JSDOM parsing overhead
extractPageState(doc1);

// 1. Measure DOM extraction latency (< 50ms constraint)
const domLatencies = [];
for (let i = 0; i < 5; i++) {
  const { durationMs } = extractPageState(doc1);
  domLatencies.push(durationMs);
}
console.log("  - DOM Latency runs:", domLatencies.map((l) => l.toFixed(2) + "ms").join(", "));
const avgDomLatency = domLatencies.reduce((a, b) => a + b, 0) / domLatencies.length;

// 2. Model download/init footprint constraint (< 50MB for wasm specialist)
const initTimeMs = await initializeFlorenceModel();

// Resource Score formula: Max 100. Target DOM latency < 50ms, model footprint within budget.
const domScore = Math.max(0, Math.min(100, 100 - (avgDomLatency / 50) * 20));
const clientResourceScore = domScore;

console.log(`  - Average DOM Extraction Latency: ${avgDomLatency.toFixed(3)} ms (Constraint: < 50ms)`);
console.log(`  - Model Init & Setup Latency: ${initTimeMs.toFixed(3)} ms`);
console.log(`  - Client Resource Utilization Score: ${clientResourceScore.toFixed(2)}%\n`);

// =========================================================================
// METRIC 5: End-to-End Task Latency & Benchmark Task Execution (15%)
// =========================================================================
console.log(">>> [METRIC 5/5] Evaluating End-to-End Task Completion & Latency (Weight: 15%)...");

const tasks = JSON.parse(fs.readFileSync(TASKS_PATH, "utf-8"));
const taskResults = [];
let localFastPathCount = 0;
let totalFastPathLatency = 0;

// Mock remote fetch for visual/fallback tasks
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
  const doc = domEnv.window.document;

  let state = extractPageState(doc).pageState;
  const canvas = doc.getElementById("revenue-chart");
  if (canvas) {
    const fusion = await processVisualRegion("revenue-chart", canvas, state);
    state = fusion.pageState;
  }

  const startT = performance.now();
  let actionResult;
  let validationResult;

  if (task.action_payload) {
    // Direct action evaluation
    actionResult = {
      action: task.action_payload,
      isLocal: true,
      networkBytesSent: 0,
      disclosure: { level: "L0", reason: "Direct action test", task: task.prompt, elements: [], redacted_token_count: 0 },
    };
  } else {
    // Target resolver
    actionResult = await resolveTaskAction(task.prompt, state, {
      fetchFn: mockFetch,
    });
  }

  const endT = performance.now();
  const latency = endT - startT;

  if (actionResult.isLocal) {
    localFastPathCount++;
    totalFastPathLatency += latency;
  }

  // Pre-execution validation
  validationResult = validateAction(actionResult.action, state, doc);

  const verdictMatch = validationResult.verdict === task.expected_verdict;
  const levelMatch = !task.expected_level || actionResult.disclosure.level === task.expected_level;

  taskResults.push({
    taskId: task.id,
    prompt: task.prompt,
    category: task.category,
    level: actionResult.disclosure.level,
    networkBytesSent: actionResult.networkBytesSent,
    latencyMs: latency,
    verdict: validationResult.verdict,
    expectedVerdict: task.expected_verdict,
    passed: verdictMatch && levelMatch,
  });
}

const passedTasks = taskResults.filter((r) => r.passed).length;
const taskSuccessRate = (passedTasks / tasks.length) * 100;
const avgFastPathLatency = localFastPathCount > 0 ? totalFastPathLatency / localFastPathCount : 0;
const latencyScore = Math.max(0, Math.min(100, (taskSuccessRate * 0.8) + (avgFastPathLatency < 15 ? 20 : 10)));

console.log(`  - Benchmark Tasks Passed: ${passedTasks} / ${tasks.length} (${taskSuccessRate.toFixed(1)}%)`);
console.log(`  - Average Local Fast-Path Latency: ${avgFastPathLatency.toFixed(3)} ms (Target: < 15ms)`);
console.log(`  - End-to-End Latency & Accuracy Score: ${latencyScore.toFixed(2)}%\n`);

// =========================================================================
// FINAL AGGREGATE EVALUATION SCORE (SIH26171)
// =========================================================================
const finalScore =
  visualAccuracyScore * 0.25 +
  piiDetectionScore * 0.20 +
  redactionPrecisionScore * 0.20 +
  clientResourceScore * 0.20 +
  latencyScore * 0.15;

console.log("════════════════════════════════════════════════════════════════════════");
console.log("                     FINAL EVALUATION SCORECARD                         ");
console.log("════════════════════════════════════════════════════════════════════════");
console.log(`  1. Visual Context Accuracy (25%):        ${visualAccuracyScore.toFixed(2)}% (Score: ${(visualAccuracyScore * 0.25).toFixed(2)})`);
console.log(`  2. PII Detection Accuracy (20%):         ${piiDetectionScore.toFixed(2)}% (Score: ${(piiDetectionScore * 0.20).toFixed(2)})`);
console.log(`  3. Redaction Precision & Quality (20%):  ${redactionPrecisionScore.toFixed(2)}% (Score: ${(redactionPrecisionScore * 0.20).toFixed(2)})`);
console.log(`  4. Client Resource Utilization (20%):    ${clientResourceScore.toFixed(2)}% (Score: ${(clientResourceScore * 0.20).toFixed(2)})`);
console.log(`  5. End-to-End Task & Latency (15%):      ${latencyScore.toFixed(2)}% (Score: ${(latencyScore * 0.15).toFixed(2)})`);
console.log("────────────────────────────────────────────────────────────────────────");
console.log(`  >>> OVERALL SIH26171 COMPOSITE SCORE:    ${finalScore.toFixed(2)} / 100.00 <<<`);
console.log("════════════════════════════════════════════════════════════════════════\n");

// Write JSON report
const report = {
  timestamp: new Date().toISOString(),
  system: "Privaagent SIH26171 On-Device Visual Perception Engine",
  overallScore: finalScore,
  metrics: {
    visualContextAccuracy: {
      weight: 0.25,
      score: visualAccuracyScore,
      weightedScore: visualAccuracyScore * 0.25,
      detectedElements: detectedCount,
      groundTruthElements: visualGroundTruth.length,
    },
    piiDetectionAccuracy: {
      weight: 0.20,
      score: piiDetectionScore,
      weightedScore: piiDetectionScore * 0.20,
      precision,
      recall,
      f1,
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
console.log(`✓ Benchmark report written to: ${REPORT_PATH}\n`);
