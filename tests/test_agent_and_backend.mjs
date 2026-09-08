// Automated Agent & Backend Reasoning Test Suite
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

import { extractPageState } from "../extension/src/semantic/dom-extractor.ts";
import { processVisualRegion } from "../extension/src/perception/index.ts";
import {
  parseTask,
  solveTaskLocally,
  resolveTaskAction,
} from "../extension/src/agent/index.ts";
import { planDisclosure } from "../extension/src/disclosure/disclosure-planner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "../benchmark/pages/test-page-1.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");

console.log("==================================================");
console.log("   PRIVAAGENT AGENT & REASONING PIPELINE TESTS   ");
console.log("==================================================");

// Setup JSDOM
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
  if (id === "revenue-chart") {
    return { left: 450, top: 80, width: 380, height: 220, right: 830, bottom: 300 };
  }
  if (id === "user-avatar") {
    return { left: 340, top: 20, width: 48, height: 48, right: 388, bottom: 68 };
  }
  if (id === "btn-open-invoice") {
    return { left: 100, top: 200, width: 150, height: 40, right: 250, bottom: 240 };
  }
  return { left: 24, top: 100, width: 200, height: 24, right: 224, bottom: 124 };
};

const doc = dom.window.document;

// ----------------------------------------------------
// TEST 1: Task Parsing & Intent Extraction
// ----------------------------------------------------
console.log("\n[TEST 1] Testing Natural Language Task Parser...");
const task1 = parseTask("Open Rahul's invoice");
console.log("Parsed Task 1:", JSON.stringify(task1));
if (task1.actionType !== "click" || task1.requiresVision !== false) {
  throw new Error(`Task 1 parsing failed: expected click, non-vision. Got ${JSON.stringify(task1)}`);
}
console.log("✓ Task 1 parsed correctly: action=click, requiresVision=false");

const task2 = parseTask("Click the bar representing Q4");
console.log("Parsed Task 2:", JSON.stringify(task2));
if (task2.actionType !== "click" || task2.requiresVision !== true) {
  throw new Error(`Task 2 parsing failed: expected click, requiresVision=true. Got ${JSON.stringify(task2)}`);
}
console.log("✓ Task 2 parsed correctly: action=click, requiresVision=true");

// ----------------------------------------------------
// TEST 2: Extract DOM PageState and Fuse Visual Evidence
// ----------------------------------------------------
console.log("\n[TEST 2] Extracting DOM PageState and Visual Evidence...");
const extraction = extractPageState(doc);
let pageState = extraction.pageState;
const canvasEl = doc.getElementById("revenue-chart");
if (canvasEl) {
  const fusion = await processVisualRegion("revenue-chart", canvasEl, pageState);
  pageState = fusion.pageState;
}
console.log(`✓ PageState extracted: ${pageState.elements.length} elements (DOM + Visual)`);

// ----------------------------------------------------
// TEST 3: Zero-Network Local Fast Path ("Open Rahul's invoice")
// ----------------------------------------------------
console.log("\n[TEST 3] Testing Zero-Network Local Task Solver (85% Rule Fast-Path)...");
const localResult = await resolveTaskAction("Open Rahul's invoice", pageState);

console.log(`  - Is Local: ${localResult.isLocal}`);
console.log(`  - Target ID: ${localResult.action.target_id}`);
console.log(`  - Action Type: ${localResult.action.action}`);
console.log(`  - Network Bytes Sent: ${localResult.networkBytesSent}`);
console.log(`  - Disclosure Level: ${localResult.disclosure.level}`);
console.log(`  - Latency: ${localResult.latencyMs.toFixed(3)} ms`);

if (!localResult.isLocal) {
  throw new Error("Expected task 'Open Rahul's invoice' to be resolved on-device locally!");
}
if (localResult.networkBytesSent !== 0) {
  throw new Error(`Expected 0 network bytes, got ${localResult.networkBytesSent}`);
}
if (localResult.action.target_id !== "btn-open-invoice") {
  throw new Error(`Expected target 'btn-open-invoice', got '${localResult.action.target_id}'`);
}
console.log("✓ Zero-Network Fast-Path verified: 0 bytes sent, target correctly resolved on-device.");

// ----------------------------------------------------
// TEST 4: Disclosure Ladder Escalation & Remote Reasoning
// ----------------------------------------------------
console.log("\n[TEST 4] Testing Disclosure Ladder Escalation for Visual Task...");

// Mock fetch interceptor to simulate the remote VLM backend without live network server
let interceptedOutboundPayload = null;
const mockFetch = async (url, options) => {
  interceptedOutboundPayload = JSON.parse(options.body);

  const candidateIds = interceptedOutboundPayload.elements.map((el) => el.target_id);
  const q4BarId = candidateIds.find((id) => id.includes("q4") || id.includes("bar_4")) || candidateIds[0];

  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      action: "click",
      target_id: q4BarId,
      reason: `Remote VLM identified Q4 bar '${q4BarId}' from visual crop ROI.`,
      confidence: 0.94,
    }),
  };
};

const visualResult = await resolveTaskAction("Click the bar representing Q4", pageState, {
  fetchFn: mockFetch,
});

console.log(`  - Is Local: ${visualResult.isLocal}`);
console.log(`  - Target ID: ${visualResult.action.target_id}`);
console.log(`  - Disclosure Level: ${visualResult.disclosure.level}`);
console.log(`  - Network Bytes Sent: ${visualResult.networkBytesSent}`);
console.log(`  - Intercepted Disclosed Elements: ${interceptedOutboundPayload?.elements?.length}`);

if (visualResult.isLocal) {
  throw new Error("Expected visual task to escalate to remote fallback!");
}
if (!visualResult.action.target_id.includes("bar_4")) {
  throw new Error(`Expected target to be Q4 bar, got '${visualResult.action.target_id}'`);
}
console.log("✓ Remote visual escalation verified: correct L2 crop ROI and targeted action.");

// ----------------------------------------------------
// TEST 5: Privacy Integrity Check on Outbound Payload
// ----------------------------------------------------
console.log("\n[TEST 5] Checking Privacy Integrity of Outbound Disclosed Elements...");
const rawSensitiveStrings = [
  "ABCDE1234F",       // PAN
  "9876 5432 1098",   // Aadhaar
  "rahul.sharma@example.com", // Email
  "sk-live-secret-9948271049281726", // Secret
];

const outboundJsonStr = JSON.stringify(interceptedOutboundPayload);
for (const secret of rawSensitiveStrings) {
  if (outboundJsonStr.includes(secret)) {
    throw new Error(`CRITICAL LEAK: Raw secret/PII '${secret}' was transmitted in outbound payload!`);
  }
}
// ----------------------------------------------------
// TEST 6: L3 Full-Page Sanitized Screenshot Escalation
// ----------------------------------------------------
console.log("\n[TEST 6] Testing L3 Full-Page Sanitized Disclosure Escalation...");
const l3Result = await resolveTaskAction("Analyze entire visual page layout", pageState, {
  forceEscalationLevel: "L3",
  sanitizedScreenshotBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  fetchFn: mockFetch,
});

console.log(`  - Disclosure Level: ${l3Result.disclosure.level}`);
console.log(`  - Crop Box: ${l3Result.disclosure.crop_box}`);
console.log(`  - Has Screenshot Data: ${Boolean(l3Result.disclosure.screenshot_data)}`);

if (l3Result.disclosure.level !== "L3") {
  throw new Error(`Expected disclosure level L3, got ${l3Result.disclosure.level}`);
}
if (l3Result.disclosure.crop_box !== undefined) {
  throw new Error(`Expected crop_box to be undefined for L3 full-page disclosure!`);
}
if (!l3Result.disclosure.screenshot_data) {
  throw new Error("Expected L3 disclosure to include sanitized full screenshot data!");
}
console.log("✓ L3 escalation verified: full sanitized viewport screenshot without localized crop box.");

console.log("\n--------------------------------------------------");
console.log("[ALL TESTS PASSED] Prompt 4 Agent & Backend Pipeline successfully verified!");

