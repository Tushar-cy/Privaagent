// Automated DOM Perception & Action Execution Benchmark Test
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "../benchmark/pages/test-page-1.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");

console.log("[TEST] Initializing JSDOM test environment for test-page-1.html...");

const dom = new JSDOM(htmlContent, {
  url: "http://localhost:8000/benchmark/pages/test-page-1.html",
  runScripts: "dangerously",
  beforeParse(window) {
    // Mock HTMLCanvasElement.getContext
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
      };
    };
  },
});

// Polyfill globals on dom.window
dom.window.chrome = {
  runtime: {
    onMessage: {
      addListener: () => {},
    },
  },
};

// Polyfill getBoundingClientRect for layout
dom.window.Element.prototype.getBoundingClientRect = function () {
  const id = this.id || "";
  if (id === "btn-open-invoice") {
    return { left: 24, top: 280, width: 340, height: 42, right: 364, bottom: 322 };
  }
  if (id === "revenue-chart") {
    return { left: 450, top: 80, width: 380, height: 220, right: 830, bottom: 300 };
  }
  return { left: 24, top: 100, width: 200, height: 24, right: 224, bottom: 124 };
};

// Polyfill window.getComputedStyle
dom.window.getComputedStyle = function () {
  return {
    display: "block",
    visibility: "visible",
    opacity: "1",
  };
};

dom.window.Element.prototype.scrollIntoView = function () {};
dom.window.Element.prototype.scrollBy = function () {};
dom.window.scrollBy = function () {};


// Load and evaluate the extension bundle
const bundlePath = path.resolve(__dirname, "../extension/dist/src/content/index.js");
const bundleCode = fs.readFileSync(bundlePath, "utf-8");

console.log("[TEST] Evaluating extension content script bundle...");
dom.window.eval(bundleCode);

// Verify window.__privaagent_extract exists and call it
const extraction = dom.window.eval("window.__privaagent_extract ? window.__privaagent_extract() : null");
if (!extraction) {
  throw new Error("window.__privaagent_extract was not initialized on window!");
}
const { pageState, durationMs } = extraction;

console.log("--------------------------------------------------");
console.log(`[PERFORMANCE] DOM Extraction Time: ${durationMs.toFixed(3)} ms`);
console.log(`[PERFORMANCE] Performance Constraint (< 50ms): ${durationMs < 50 ? "PASSED" : "FAILED"}`);
console.log(`[PERCEPTION] Total Extracted Elements: ${pageState.elements.length}`);
console.log("--------------------------------------------------");

// Assertion 1: Performance constraint
if (durationMs >= 50) {
  throw new Error(`Extraction exceeded 50ms constraint: took ${durationMs}ms`);
}

// Assertion 2: Find invoice button
const invoiceBtn = pageState.elements.find((el) => el.target_id === "btn-open-invoice");
if (!invoiceBtn) {
  throw new Error('Target element "btn-open-invoice" not found in extracted PageState!');
}
console.log(`[VERIFIED] Invoice button found:`, {
  id: invoiceBtn.target_id,
  role: invoiceBtn.role,
  text: invoiceBtn.text,
  bbox: invoiceBtn.bbox,
  sources: invoiceBtn.sources,
});

// Assertion 3: Find canvas chart
const canvasEl = pageState.elements.find((el) => el.target_id === "revenue-chart");
if (!canvasEl) {
  throw new Error('Canvas element "revenue-chart" not found in extracted PageState!');
}
console.log(`[VERIFIED] Canvas chart found:`, {
  id: canvasEl.target_id,
  role: canvasEl.role,
  sources: canvasEl.sources,
  task_relevance: canvasEl.task_relevance,
});

// Assertion 4: Find PII name & email
const nameEl = pageState.elements.find((el) => el.target_id === "user-name");
const emailEl = pageState.elements.find((el) => el.target_id === "user-email");
if (!nameEl || nameEl.text !== "Rahul Sharma") {
  throw new Error(`User name element not properly extracted! text=${nameEl?.text}`);
}
if (!emailEl || emailEl.text !== "rahul.sharma@example.com") {
  throw new Error(`Email element not properly extracted! text=${emailEl?.text}`);
}
console.log(`[VERIFIED] User profile PII elements extracted correctly.`);

// Assertion 5: Test action execution - Click "Open Rahul's invoice"
console.log("[TEST] Dispatching click action to 'btn-open-invoice'...");
const actionResult = await dom.window.eval(
  "window.__privaagent_execute_action({ action: 'click', target_id: 'btn-open-invoice', reason: 'Open Rahul invoice' })"
);

if (!actionResult.success) {
  throw new Error(`Click action failed: ${actionResult.error}`);
}
console.log(`[ACTION SUCCESS] Click executed successfully on ${actionResult.target_id}`);

// Verify DOM reacted to the click
const modalText = dom.window.eval(
  "document.getElementById('invoice-modal-status') ? document.getElementById('invoice-modal-status').textContent : null"
);
if (!modalText || !modalText.includes("Invoice INV-2024-9042 successfully opened")) {
  throw new Error(`Page did not react to synthetic click action! modalText=${modalText}`);
}
console.log(`[DOM REACTED] Modal text: "${modalText}"`);
console.log("--------------------------------------------------");
console.log("[ALL TESTS PASSED] Prompt 1 DOM/A11y Perception & Execution Engine verified successfully!");
