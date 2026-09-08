// Automated Multi-Turn Autonomous Agent & Privacy Budget Test Suite
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

import {
  decomposeGoal,
  SessionPrivacyBudget,
  runMultiTurnAgent,
} from "../extension/src/agent/index.ts";
import { extractPageState } from "../extension/src/semantic/dom-extractor.ts";
import { processVisualRegion } from "../extension/src/perception/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page1Path = path.resolve(__dirname, "../benchmark/pages/test-page-1.html");
const injectionPagePath = path.resolve(__dirname, "../benchmark/adversarial/prompt-injection-page.html");

console.log("==================================================");
console.log("   PRIVAAGENT MULTI-TURN AGENT & BUDGET TESTS     ");
console.log("==================================================");

// ----------------------------------------------------
// TEST 1: Goal Decomposition Engine
// ----------------------------------------------------
console.log("\n[TEST 1] Testing Goal Decomposition Engine...");

const testGoals = [
  {
    input: "Search for statement then open invoice",
    expectedSteps: 2,
    expectedSubtasks: ["Search for statement", "open invoice"],
  },
  {
    input: "Click the avatar after that click the bar representing Q4",
    expectedSteps: 2,
    expectedSubtasks: ["Click the avatar", "click the bar representing Q4"],
  },
  {
    input: "Open Rahul's invoice; submit the form",
    expectedSteps: 2,
    expectedSubtasks: ["Open Rahul's invoice", "submit the form"],
  },
  {
    input: "Open Rahul's invoice",
    expectedSteps: 1,
    expectedSubtasks: ["Open Rahul's invoice"],
  },
];

for (const tg of testGoals) {
  const result = decomposeGoal(tg.input);
  if (result.subtasks.length !== tg.expectedSteps) {
    throw new Error(
      `Decomposition mismatch for "${tg.input}": expected ${tg.expectedSteps} subtasks, got ${result.subtasks.length}`
    );
  }
  console.log(`✓ "${tg.input}" -> [${result.subtasks.map((s) => `"${s}"`).join(", ")}]`);
}

// ----------------------------------------------------
// TEST 2: Session Privacy Budget Bounds
// ----------------------------------------------------
console.log("\n[TEST 2] Testing Session Privacy Budget Bounds...");

const budget = new SessionPrivacyBudget({
  maxCumulativeBytes: 2000,
  maxRemoteCalls: 2,
  maxSteps: 3,
});

if (budget.getStatus().exceeded) {
  throw new Error("Budget should initially not be exceeded.");
}

// Step 1: Local execution (0 bytes, local)
budget.recordStep(0, false);
if (budget.getStatus().exceeded) throw new Error("Step 1 local should not breach budget.");

// Step 2: Remote escalation (1200 bytes)
if (!budget.canEscalate(1200)) throw new Error("Should allow 1200 B escalation under 2000 B ceiling.");
budget.recordStep(1200, true);
if (budget.getStatus().exceeded) throw new Error("Step 2 should not breach budget yet.");

// Step 3: Check remote limit escalation
if (!budget.canEscalate(500)) throw new Error("Should allow 500 B escalation under 2000 B ceiling.");
budget.recordStep(500, true); // Now 1700 B, 2 remote calls
if (budget.getStatus().exceeded) throw new Error("Step 3 should not breach limits yet.");

// Now remote calls = 2 (maxRemoteCalls = 2). canEscalate should return false
if (budget.canEscalate(100)) {
  throw new Error("canEscalate should be false when maxRemoteCalls reached.");
}

// Step 4: Exceed maxSteps (3)
budget.recordStep(0, false); // steps = 4 > maxSteps (3)
const breachedStatus = budget.getStatus();
if (!breachedStatus.exceeded) {
  throw new Error("Budget status should be EXCEEDED after 4 steps with maxSteps=3.");
}
console.log(`✓ Budget breached successfully caught: "${breachedStatus.reason}"`);

// ----------------------------------------------------
// Helper: Setup DOM Environment
// ----------------------------------------------------
function setupDOM(htmlFilePath) {
  const content = fs.readFileSync(htmlFilePath, "utf-8");
  const dom = new JSDOM(content, {
    url: "http://localhost:8000/test.html",
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
  global.Event = dom.window.Event;
  global.MouseEvent = dom.window.MouseEvent;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
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
      return { left: 50, top: 120, width: 140, height: 35, right: 190, bottom: 155 };
    }
    return { left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40 };
  };

  return dom;
}

// ----------------------------------------------------
// TEST 3: Pure On-Device Multi-Turn Autonomous Execution
// ----------------------------------------------------
console.log("\n[TEST 3] Testing Pure On-Device Multi-Turn Execution on adversarial fixture...");
const domInj = setupDOM(injectionPagePath);
const injExtraction = extractPageState();

const localCompoundGoal = "Type 2026 into search then click view statement";
const localRunResult = await runMultiTurnAgent(localCompoundGoal, injExtraction.pageState, {
  doc: domInj.window.document,
  budgetLimits: { maxCumulativeBytes: 50000, maxSteps: 5, maxRemoteCalls: 3 },
});

console.log(`Status: ${localRunResult.status}`);
console.log(`Total Steps Executed: ${localRunResult.totalSteps}`);
console.log(`Cumulative Bytes Transmitted: ${localRunResult.cumulativeBytesSent}`);

if (localRunResult.status !== "SUCCESS") {
  throw new Error(`Expected SUCCESS for pure on-device compound goal, got: ${localRunResult.status} (${localRunResult.error})`);
}
if (localRunResult.totalSteps !== 2) {
  throw new Error(`Expected 2 steps executed, got: ${localRunResult.totalSteps}`);
}
if (localRunResult.cumulativeBytesSent !== 0) {
  throw new Error(`Expected 0 network bytes (pure local on-device), got: ${localRunResult.cumulativeBytesSent}`);
}

localRunResult.history.forEach((step, idx) => {
  console.log(
    `  Step ${idx + 1}: Subtask="${step.subtask}" -> Action=${step.action.action} on "${step.action.target_id}" (Local: ${step.isLocal}, Level: ${step.level}, Verdict: ${step.verdict})`
  );
});
console.log("✓ Pure on-device multi-turn goal completed with 0 network leakage!");

// ----------------------------------------------------
// TEST 4: Mixed Multi-Turn Goal (Step 1 Local + Step 2 Remote Fallback)
// ----------------------------------------------------
console.log("\n[TEST 4] Testing Hybrid Multi-Turn Goal on test-page-1 (Step 1 Local + Step 2 Remote Fallback)...");
const domPage1 = setupDOM(page1Path);
const page1Extraction = extractPageState();
let page1CombinedState = page1Extraction.pageState;

const canvasEl = domPage1.window.document.getElementById("revenue-chart");
if (canvasEl) {
  const fusion = await processVisualRegion("revenue-chart", canvasEl, page1Extraction.pageState);
  page1CombinedState = fusion.updatedState;
}

// Mock remote VLM fetch
let mockVlmCalled = false;
const mockFetch = async (url, options) => {
  mockVlmCalled = true;
  const payload = JSON.parse(options.body);
  const candidateIds = payload.elements.map((el) => el.target_id);
  const q4Id = candidateIds.find((id) => id.includes("q4") || id.includes("bar_4")) || candidateIds[0];

  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      action: "click",
      target_id: q4Id,
      reason: "Remote VLM identified Q4 bar from minimum-disclosure visual crop ROI.",
      confidence: 0.95,
    }),
  };
};

const hybridGoal = "Open Rahul's invoice then click the bar representing Q4";
const hybridResult = await runMultiTurnAgent(hybridGoal, page1CombinedState, {
  doc: domPage1.window.document,
  fetchFn: mockFetch,
  budgetLimits: { maxCumulativeBytes: 50000, maxSteps: 5, maxRemoteCalls: 3 },
});

console.log(`Status: ${hybridResult.status}`);
console.log(`Total Steps Executed: ${hybridResult.totalSteps}`);
console.log(`Cumulative Bytes Transmitted: ${hybridResult.cumulativeBytesSent}`);

if (hybridResult.status !== "SUCCESS") {
  throw new Error(`Expected SUCCESS for hybrid goal, got: ${hybridResult.status} (${hybridResult.error})`);
}
if (hybridResult.totalSteps !== 2) {
  throw new Error(`Expected 2 steps executed, got: ${hybridResult.totalSteps}`);
}
if (!hybridResult.history[0].isLocal || hybridResult.history[0].bytesSent !== 0) {
  throw new Error("Step 1 should be 100% local on-device with 0 network bytes.");
}
if (hybridResult.history[1].isLocal || hybridResult.history[1].bytesSent === 0) {
  throw new Error("Step 2 should be remote fallback escalation with bounded bytes.");
}
if (!mockVlmCalled) {
  throw new Error("Expected mock VLM fetch to be invoked for step 2 visual task.");
}

hybridResult.history.forEach((step, idx) => {
  console.log(
    `  Step ${idx + 1}: Subtask="${step.subtask}" -> Action=${step.action.action} on "${step.action.target_id}" (Local: ${step.isLocal}, Level: ${step.level}, Bytes: ${step.bytesSent} B)`
  );
});
console.log("✓ Hybrid multi-turn goal succeeded with exact disclosure ladder tracking!");

// ----------------------------------------------------
// TEST 5: Security Confirmation Pause on High-Risk Action
// ----------------------------------------------------
console.log("\n[TEST 5] Testing Security Policy Pause on High-Risk Financial Action...");
setupDOM(injectionPagePath);
const injExtraction2 = extractPageState();

const highRiskGoal = "Click view statement then pay now $5,000";
const riskResult = await runMultiTurnAgent(highRiskGoal, injExtraction2.pageState, {
  doc: global.document,
});

console.log(`Status: ${riskResult.status}`);
console.log(`Total Steps: ${riskResult.totalSteps}`);
console.log(`Pause Reason: ${riskResult.error}`);

if (riskResult.status !== "PAUSED_CONFIRMATION") {
  throw new Error(`Expected PAUSED_CONFIRMATION for financial task, got: ${riskResult.status}`);
}
if (riskResult.history.length !== 2) {
  throw new Error(`Expected 2 steps recorded in history, got: ${riskResult.history.length}`);
}
if (riskResult.history[0].verdict !== "ALLOW" || !riskResult.history[0].success) {
  throw new Error("Step 1 should be safely ALLOWed and executed.");
}
if (riskResult.history[1].verdict !== "CONFIRM") {
  throw new Error(`Step 2 verdict should be CONFIRM, got ${riskResult.history[1].verdict}`);
}
console.log("✓ Security Risk Engine halted dangerous action requiring user confirmation.");

// ----------------------------------------------------
// TEST 6: Privacy Budget Exhaustion Protection
// ----------------------------------------------------
console.log("\n[TEST 6] Testing Privacy Budget Exhaustion Protection...");
setupDOM(injectionPagePath);
const injExtraction3 = extractPageState();

const tightBudgetGoal = "Type 2026 into search then click view statement";
const budgetExhaustResult = await runMultiTurnAgent(tightBudgetGoal, injExtraction3.pageState, {
  doc: global.document,
  budgetLimits: { maxSteps: 1 }, // Only 1 step allowed
});

console.log(`Status: ${budgetExhaustResult.status}`);
console.log(`Steps Completed: ${budgetExhaustResult.totalSteps}`);
console.log(`Reason: ${budgetExhaustResult.error}`);

if (budgetExhaustResult.status !== "BUDGET_EXCEEDED") {
  throw new Error(`Expected BUDGET_EXCEEDED with tight step budget, got: ${budgetExhaustResult.status}`);
}
console.log("✓ Budget tracker successfully prevented runaway step iteration.");

console.log("\n--------------------------------------------------");
console.log("[ALL TESTS PASSED] Phase 8 Multi-Turn Autonomous Agent & Privacy Budget Verified!");
console.log("==================================================\n");
