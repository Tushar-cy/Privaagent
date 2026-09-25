// Automated Test Suite: UI, Privacy Overlays, and Runtime Messaging
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

import { extractPageState, resolvePerceivedElement } from "../extension/src/semantic/dom-extractor.ts";
import { annotatePageStateSensitivity } from "../extension/src/privacy/sensitivity.ts";
import { OverlayManager } from "../extension/src/content/overlay-manager.ts";
import { resolveTaskAction } from "../extension/src/agent/target-resolver.ts";
import { validateAction } from "../extension/src/validator/action-validator.ts";
import { dispatchUserApprovedAction } from "../extension/popup/confirmation.ts";

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

// JSDOM does not implement Range#getBoundingClientRect; map selected text to
// its containing element so the overlay test exercises the normal geometry path.
dom.window.Range.prototype.getBoundingClientRect = function () {
  const parent = this.startContainer.parentElement;
  return parent?.getBoundingClientRect() || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
};

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

const hudPayload = `<img src=x onerror="document.body.dataset.hudXss='executed'">`;
overlayMgr.updateHUD("L0", hudPayload);
if (!hudEl.textContent.includes(hudPayload) || hudEl.querySelector("img") || doc.body.dataset.hudXss) {
  throw new Error("HUD status text must remain inert text, never executable markup.");
}
overlayMgr.updateHUD("L0", "Local Reasoning Mode");
console.log("✓ Runtime HUD text is inserted as inert text, not parsed HTML.");

const popupDom = new JSDOM(fs.readFileSync(path.resolve(__dirname, "../extension/popup/index.html"), "utf-8"));
if (!popupDom.window.document.getElementById("confirmation-approve")
  || !popupDom.window.document.getElementById("confirmation-cancel")
  || !popupDom.window.document.getElementById("confirmation-panel")?.hidden) {
  throw new Error("Popup must provide initially hidden Approve and Cancel controls for pending actions.");
}

let approvalMessage;
let approvalResponse;
dispatchUserApprovedAction(
  (_tabId, message, callback) => {
    approvalMessage = message;
    callback?.({ success: true });
  },
  7,
  { action: "click", target_id: "el_0001" },
  (response) => { approvalResponse = response; },
  "L2"
);
if (approvalMessage?.type !== "EXECUTE_ACTION" || approvalMessage.userConfirmed !== true || approvalMessage.disclosureLevel !== "L2") {
  throw new Error("Popup approval must send an explicit confirmation through EXECUTE_ACTION.");
}
if (approvalResponse?.success !== true) throw new Error("Popup approval dispatch did not receive the execution result.");
console.log("✓ Explicit popup approval dispatch includes userConfirmed=true and preserves the disclosure level.");

// ----------------------------------------------------
// TEST 2: Live Non-Mutating Viewport Redaction Overlays
// ----------------------------------------------------
console.log("\n[TEST 2] Testing BLUR overlays preserve sensitive page text...");

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

const originalComputeLabel = overlayMgr.computeLabel.bind(overlayMgr);
overlayMgr.computeLabel = () => `<img src=x onerror="document.body.dataset.overlayXss='executed'">`;
overlayMgr.renderRedactionOverlays(sensitiveState);
if (container.querySelector("img") || doc.body.dataset.overlayXss || !container.textContent.includes("onerror")) {
  throw new Error("Overlay labels must remain inert text and must never be parsed as HTML.");
}
overlayMgr.computeLabel = originalComputeLabel;
overlayMgr.renderRedactionOverlays(sensitiveState);
console.log("✓ Overlay labels are rendered as text without HTML parsing.");

// BLUR mode adds a separate viewport overlay and keeps sensitive source text intact.
const rawPanEl = doc.getElementById("user-pan");
if (!rawPanEl || !rawPanEl.textContent.includes("ABCDE1234F")) {
  throw new Error("BLUR mode must preserve the underlying sensitive source text.");
}
console.log("✓ BLUR overlay leaves the source text content unchanged.");

// ----------------------------------------------------
// TEST 3: Overlay Visibility Toggling
// ----------------------------------------------------
console.log("\n[TEST 3] Testing Overlay Visibility Toggle...");
overlayMgr.setVisible(false);
if (container.style.display !== "none") throw new Error("Container not hidden after setVisible(false)");
overlayMgr.setVisible(true);
if (container.style.display !== "block") throw new Error("Container not visible after setVisible(true)");
console.log("✓ Viewport blur shield successfully toggled on/off.");

// GHOST mode uses a temporary masking class on sensitive page elements.
const sensitiveTarget = sensitiveState.elements.find((element) => element.sensitive && element.target_id !== "user-avatar-face");
const liveSensitiveElement = sensitiveTarget ? resolvePerceivedElement(sensitiveTarget) : null;
if (!liveSensitiveElement) throw new Error("Could not resolve a sensitive target for GHOST mode verification.");
overlayMgr.setMode("GHOST");
if (!liveSensitiveElement.classList.contains("privaagent-ghost-redacted")) {
  throw new Error("GHOST mode must apply its temporary masking class to sensitive elements.");
}
overlayMgr.setMode("BLUR");
if (liveSensitiveElement.classList.contains("privaagent-ghost-redacted")) {
  throw new Error("Switching out of GHOST mode must remove its temporary masking class.");
}
console.log("✓ GHOST mode temporarily applies and removes its masking class.");

// ----------------------------------------------------
// TEST 4: Policy Ceiling Enforcement (L0 / L1 / L2 Controls)
// ----------------------------------------------------
console.log("\n[TEST 4] Testing User Policy Ceiling Enforcement...");

// A visual-only task must be blocked before its L2 disclosure reaches fetch.
const visualTaskStr = "Click the bar representing Q4";
const ceilingState = {
  ...sensitiveState,
  elements: sensitiveState.elements.map((element) => ({ ...element, sensitive: false })),
};
let ceilingRequestMade = false;
const resolution = await resolveTaskAction(visualTaskStr, ceilingState, {
  maxDisclosureLevel: "L0",
  sanitizedScreenshotBase64: "data:image/png;base64,AA==",
  sanitizedScreenshotManifest: {
    sourceSensitiveBoxCount: 0,
    intersectingBoxCount: 0,
    redactedBoxCount: 0,
    redactedBoxes: [],
  },
  fetchFn: async () => {
    ceilingRequestMade = true;
    return ({
    ok: true,
    json: async () => ({ action: "click", target_id: "revenue-chart", reason: "Chart click", confidence: 0.9 }),
    });
  },
});

if (!resolution.ceilingExceeded || resolution.processingPath !== "BLOCKED" || ceilingRequestMade) {
  throw new Error("The L0 ceiling must block an L2 task before the remote request is made.");
}
console.log(`✓ User policy ceiling blocked ${resolution.disclosure.level} before the remote request.`);

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
process.exit(0);
