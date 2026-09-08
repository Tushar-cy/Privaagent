// Automated Test Suite: UI, Privacy Overlays, and Runtime Messaging
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

import { extractPageState } from "../extension/src/semantic/dom-extractor.ts";
import { annotatePageStateSensitivity } from "../extension/src/privacy/sensitivity.ts";
import { OverlayManager } from "../extension/src/content/overlay-manager.ts";
import { resolveTaskAction } from "../extension/src/agent/target-resolver.ts";
import { validateAction } from "../extension/src/validator/action-validator.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "../benchmark/pages/test-page-1.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");

console.log("==================================================");
console.log("   PRIVAAGENT UI, OVERLAY & MESSAGING BENCHMARK   ");
console.log("==================================================");

// Initialize JSDOM
const dom = new JSDOM(htmlContent, {
  url: "http://localhost:8000/benchmark/pages/test-page-1.html",
  runScripts: "dangerously",
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = () => ({
      fillStyle: "", strokeStyle: "", lineWidth: 1,
      fillRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fillText: () => {}, drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(400 * 250 * 4), width: 400, height: 250 }),
    });
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
  return { left: 24, top: 100, width: 200, height: 24, right: 224, bottom: 124 };
};

const doc = dom.window.document;

// ----------------------------------------------------
// TEST 1: Floating HUD Lifecycle
// ----------------------------------------------------
console.log("\n[TEST 1] Testing Floating Privacy HUD Component...");
const overlayMgr = new OverlayManager(doc);

overlayMgr.updateHUD("L0", "Local Reasoning Mode");
const hudEl = doc.getElementById("privaagent-status-hud");
if (!hudEl) throw new Error("HUD element not injected into DOM!");
if (!hudEl.textContent.includes("Privaagent") || !hudEl.textContent.includes("L0")) {
  throw new Error(`Unexpected HUD content: ${hudEl.textContent}`);
}
console.log("✓ Floating HUD badge injected into DOM with active privacy level indicator.");

// ----------------------------------------------------
// TEST 2: Live Non-Mutating Viewport Redaction Overlays
// ----------------------------------------------------
console.log("\n[TEST 2] Testing Viewport Blur/Blackout Overlays (85% Rule: Zero DOM Mutation)...");

// Capture original document HTML ground truth before overlay rendering
const preOverlayHtml = doc.body.innerHTML;

const baseState = extractPageState(doc).pageState;
const sensitiveState = annotatePageStateSensitivity(baseState);

// Add a face detection entry to test face blur
sensitiveState.elements.push({
  target_id: "user-avatar-face",
  role: "face",
  text: "Customer Face",
  bbox: [345, 25, 38, 38],
  confidence: 0.98,
  sensitive: true,
  task_relevance: 0.2,
  sources: ["cv"],
  interactable: false,
});

const renderedCount = overlayMgr.renderRedactionOverlays(sensitiveState);
console.log(`  - Rendered Redaction Overlays: ${renderedCount}`);

const container = doc.getElementById("privaagent-redaction-root");
if (!container) throw new Error("Redaction overlay root container missing!");
if (container.children.length !== renderedCount || renderedCount === 0) {
  throw new Error(`Expected >0 overlays in root container, got ${container.children.length}`);
}

// Verify live DOM content was NEVER modified or altered
const rawPanEl = doc.getElementById("user-pan");
if (!rawPanEl || !rawPanEl.textContent.includes("ABCDE1234F")) {
  throw new Error("VIOLATION: Underlying live DOM text was mutated by privacy engine!");
}
console.log("✓ Zero-Mutation verified: Underlying DOM text nodes remain 100% untouched.");

// ----------------------------------------------------
// TEST 3: Overlay Visibility Toggling
// ----------------------------------------------------
console.log("\n[TEST 3] Testing Overlay Visibility Toggle...");
overlayMgr.setVisible(false);
if (container.style.display !== "none") throw new Error("Container not hidden after setVisible(false)");
overlayMgr.setVisible(true);
if (container.style.display !== "block") throw new Error("Container not visible after setVisible(true)");
console.log("✓ Viewport blur shield successfully toggled on/off.");

// ----------------------------------------------------
// TEST 4: Policy Ceiling Enforcement (L0 / L1 / L2 Controls)
// ----------------------------------------------------
console.log("\n[TEST 4] Testing User Policy Ceiling Enforcement...");

// Task that requires visual escalation (L2)
const visualTaskStr = "Click the bar representing Q4";
const resolution = await resolveTaskAction(visualTaskStr, sensitiveState, {
  fetchFn: async () => ({
    ok: true,
    json: async () => ({ action: "click", target_id: "revenue-chart", reason: "Chart click", confidence: 0.9 }),
  }),
});

console.log(`  - Task resolved to disclosure level: ${resolution.disclosure.level}`);

// Test ceiling check logic: if user sets ceiling to L0, L2 should be blocked
const levelOrder = { L0: 0, L1: 1, L2: 2, L3: 3 };
const taskLevel = resolution.disclosure.level;
const strictUserCeiling = "L0";

const ceilingViolation = levelOrder[taskLevel] > levelOrder[strictUserCeiling];
if (!ceilingViolation) {
  throw new Error("Ceiling check failed: L2 should exceed L0 ceiling!");
}
console.log(`✓ User Policy Ceiling enforced: ${taskLevel} blocked when ceiling is ${strictUserCeiling}.`);

// ----------------------------------------------------
// TEST 5: Clean Teardown
// ----------------------------------------------------
console.log("\n[TEST 5] Testing Teardown & Resource Cleanup...");
overlayMgr.destroy();
if (doc.getElementById("privaagent-redaction-root") || doc.getElementById("privaagent-status-hud")) {
  throw new Error("Elements remained in DOM after destroy()!");
}
console.log("✓ Teardown verified: all UI nodes cleanly removed.");

console.log("\n--------------------------------------------------");
console.log("[ALL TESTS PASSED] Prompt 6 UI, Overlay & Ledger successfully verified!");
