import assert from "node:assert/strict";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

import { resolveTaskAction } from "../extension/src/agent/target-resolver.ts";
import { planDisclosure } from "../extension/src/disclosure/disclosure-planner.ts";
import { extractPageState } from "../extension/src/semantic/dom-extractor.ts";
import { validateAction } from "../extension/src/validator/action-validator.ts";
import { getSubStringBoundingBox } from "../extension/src/privacy/redactor.ts";
import { detectVisualSensitivity } from "../extension/src/perception/visual-sensitivity.ts";

console.log("[Security regressions] Running focused trust-boundary checks...");

// A forced L0 request may resolve locally or block, but it must never call fetch.
const forcedL0State = {
  url: "https://example.test/",
  title: "Dashboard",
  timestamp: Date.now(),
  elements: [{
    target_id: "chart",
    role: "canvas",
    text: "Q4 revenue chart",
    bbox: [0, 0, 100, 100],
    confidence: 1,
    sensitive: false,
    task_relevance: 0,
    sources: ["dom"],
    interactable: true,
  }],
};
let forcedL0NetworkCalls = 0;
const forcedL0 = await resolveTaskAction("Click the bar representing Q4", forcedL0State, {
  forceEscalationLevel: "L0",
  fetchFn: async () => {
    forcedL0NetworkCalls++;
    throw new Error("L0 must not call the remote resolver");
  },
});
assert.equal(forcedL0.processingPath, "BLOCKED");
assert.equal(forcedL0.disclosure.level, "L0");
assert.equal(forcedL0.networkBytesSent, 0);
assert.equal(forcedL0.externalRequestMade, false);
assert.equal(forcedL0NetworkCalls, 0);
console.log("  ✓ Forced L0 blocks unresolved tasks without network access.");

// L1 sends only task-relevant candidates, with sensitive matching text masked.
const l1State = {
  url: "https://example.test/",
  title: "Finance portal",
  timestamp: Date.now(),
  elements: [
    { target_id: "invoice-button", role: "button", text: "Open invoice", bbox: [0, 0, 90, 24], confidence: 1, sensitive: false, task_relevance: 0.8, sources: ["dom"], interactable: true },
    { target_id: "invoice-heading", role: "heading", text: "Invoice history", bbox: [0, 30, 120, 24], confidence: 1, sensitive: false, task_relevance: 0.5, sources: ["dom"], interactable: false },
    { target_id: "unrelated-person", role: "text", text: "Rahul Sharma", bbox: [0, 60, 120, 24], confidence: 1, sensitive: true, task_relevance: 0.5, sources: ["dom"], metadata: { sensitive_detections: [{ type: "PERSON", span: [0, 12], text: "Rahul Sharma", confidence: 0.9 }] } },
    { target_id: "unrelated-revenue", role: "text", text: "Secret project revenue ₹84 crore", bbox: [0, 90, 200, 24], confidence: 1, sensitive: false, task_relevance: 0.5, sources: ["dom"] },
  ],
};
const l1 = planDisclosure("Open invoice", l1State, {
  isSolvableLocally: false,
  requiresVision: false,
  taskKeywords: ["invoice"],
});
assert.deepEqual(l1.elements.map((element) => element.target_id), ["invoice-button", "invoice-heading"]);
assert.ok(!JSON.stringify(l1).includes("Rahul Sharma"));
assert.ok(!JSON.stringify(l1).includes("Secret project revenue"));
console.log("  ✓ L1 sends a bounded, task-matched subset and excludes unrelated page data.");

// Bind a target through perception, then prove page attribute changes cannot
// re-point the action to an attacker-controlled clone.
const dom = new JSDOM("<!doctype html><html><body><button id='original'>Open dashboard</button></body></html>", {
  url: "https://example.test/",
});
global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.Element.prototype.getBoundingClientRect = function () {
  return { left: 20, top: 30, width: 120, height: 32, right: 140, bottom: 62 };
};
const original = dom.window.document.getElementById("original");
const perceivedState = extractPageState().pageState;
const perceived = perceivedState.elements.find((element) => element.metadata?.domId === "original");
assert.ok(perceived, "Perception should register the test button");
const duplicate = dom.window.document.createElement("button");
duplicate.textContent = "Open dashboard";
duplicate.setAttribute("data-privaagent-id", perceived.target_id);
dom.window.document.body.insertBefore(duplicate, original);
// A later pass reuses el_0001 for the node that moved to the first position.
// The old PageState must retain its exact node binding despite that reuse.
extractPageState();
original.setAttribute("data-privaagent-id", "page-mutated-id");
const targetValidation = validateAction(
  { action: "click", target_id: perceived.target_id, reason: "Open dashboard", confidence: 1 },
  perceivedState,
  dom.window.document,
);
assert.equal(targetValidation.element, original);
assert.notEqual(targetValidation.element, duplicate);
assert.equal(targetValidation.valid, true, targetValidation.error);
console.log("  ✓ Target authorization remains bound to the exact perceived DOM node.");

// A task may take long enough for page content to change after disclosure
// preparation. Prove the final freshness gate prevents the first network call.
const freshnessDom = new JSDOM("<!doctype html><html><body><button>Open dashboard</button></body></html>", {
  url: "https://example.test/freshness/",
});
global.window = freshnessDom.window;
global.document = freshnessDom.window.document;
global.Element = freshnessDom.window.Element;
global.HTMLElement = freshnessDom.window.HTMLElement;
global.Node = freshnessDom.window.Node;
global.getComputedStyle = freshnessDom.window.getComputedStyle.bind(freshnessDom.window);
freshnessDom.window.Element.prototype.getBoundingClientRect = () => ({
  left: 10, top: 10, width: 120, height: 32, right: 130, bottom: 42,
});
const freshnessPageState = extractPageState().pageState;
const freshnessButton = freshnessDom.window.document.querySelector("button");
let freshnessNetworkCalls = 0;
const staleResolution = await resolveTaskAction("Find the quarterly revenue trend", freshnessPageState, {
  forceEscalationLevel: "L1",
  beforeRemoteRequest: () => {
    freshnessButton.textContent = "Changed after disclosure preparation";
    return true;
  },
  fetchFn: async () => {
    freshnessNetworkCalls++;
    throw new Error("Stale disclosure must not reach fetch");
  },
});
assert.equal(staleResolution.processingPath, "BLOCKED");
assert.match(staleResolution.blockReason || "", /Page content changed/);
assert.equal(staleResolution.networkBytesSent, 0);
assert.equal(staleResolution.externalRequestMade, false);
assert.equal(freshnessNetworkCalls, 0);
console.log("  ✓ A DOM mutation at the outbound boundary blocks disclosure with zero network calls.");

// Unrelated insertions can renumber opaque sequence IDs, but must not block a
// disclosure when every node from the original snapshot is still unchanged.
const benignMutationDom = new JSDOM("<!doctype html><html><body><button>Open dashboard</button></body></html>", {
  url: "https://example.test/benign-mutation/",
});
global.window = benignMutationDom.window;
global.document = benignMutationDom.window.document;
global.Element = benignMutationDom.window.Element;
global.HTMLElement = benignMutationDom.window.HTMLElement;
global.Node = benignMutationDom.window.Node;
global.getComputedStyle = benignMutationDom.window.getComputedStyle.bind(benignMutationDom.window);
benignMutationDom.window.Element.prototype.getBoundingClientRect = () => ({
  left: 10, top: 10, width: 120, height: 32, right: 130, bottom: 42,
});
const benignMutationState = extractPageState().pageState;
const originalButton = benignMutationDom.window.document.querySelector("button");
let benignMutationNetworkCalls = 0;
const benignMutationResolution = await resolveTaskAction("Find the quarterly revenue trend", benignMutationState, {
  forceEscalationLevel: "L1",
  beforeRemoteRequest: () => {
    const unrelated = benignMutationDom.window.document.createElement("button");
    unrelated.textContent = "New unrelated notification";
    benignMutationDom.window.document.body.insertBefore(unrelated, originalButton);
    return true;
  },
  fetchFn: async (_url, request) => {
    benignMutationNetworkCalls++;
    const requestBody = JSON.parse(request.body);
    const target = requestBody.elements[0]?.target_id;
    return {
      ok: true,
      status: 200,
      json: async () => ({ action: "click", target_id: target, reason: "Benign DOM mutation test", confidence: 0.9 }),
      text: async () => "",
    };
  },
});
assert.equal(benignMutationResolution.processingPath, "SANITIZED_VLM");
assert.equal(benignMutationNetworkCalls, 1);
assert.equal(originalButton.textContent, "Open dashboard");
console.log("  ✓ Unrelated DOM insertion and opaque-ID renumbering do not block a fresh disclosure.");

// A repeated sensitive substring should use the detector's second span rather
// than the first same-text occurrence when computing its pixel box.
const repeated = dom.window.document.createElement("p");
repeated.textContent = "Rahul Sharma / Rahul Sharma";
dom.window.document.body.appendChild(repeated);
dom.window.Range.prototype.getBoundingClientRect = function () {
  return { left: this.startOffset * 5, top: 1, width: (this.endOffset - this.startOffset) * 5, height: 18, right: 0, bottom: 0 };
};
const secondOccurrenceBox = getSubStringBoundingBox(repeated, 15, 27, "Rahul Sharma");
assert.deepEqual(secondOccurrenceBox, [75, 1, 60, 18]);
console.log("  ✓ Repeated text redaction geometry tracks the detector span occurrence.");

// The same target and box must be re-evaluated when semantic labels/content
// change; a prior visual result is not reused as a cache hit.
const visualState = {
  url: "https://example.test/",
  title: "Visual cache regression",
  timestamp: Date.now(),
  viewport: { width: 300, height: 200, scrollX: 0, scrollY: 0 },
  elements: [{
    target_id: "visual-cache-regression",
    role: "canvas",
    text: "profile photo",
    bbox: [10, 10, 80, 80],
    confidence: 1,
    sensitive: false,
    task_relevance: 0,
    sources: ["dom"],
    metadata: { tagName: "canvas" },
  }],
};
const firstVisualPass = await detectVisualSensitivity(visualState);
assert.equal(firstVisualPass.get("visual-cache-regression")?.kind, "image");
visualState.elements[0].text = "quarterly chart";
const secondVisualPass = await detectVisualSensitivity(visualState);
assert.equal(secondVisualPass.get("visual-cache-regression")?.kind, "unknown");
console.log("  ✓ Visual sensitivity is recalculated instead of reusing a stale target/box result.");

console.log("[Security regressions] All focused checks passed.");
