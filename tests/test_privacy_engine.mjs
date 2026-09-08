// Privacy Engine & Minimum Disclosure Benchmark Test Suite
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "../extension/node_modules/jsdom/lib/api.js";

// Import compiled or source modules
import { detectStructuredPII, isValidLuhn } from "../extension/src/privacy/pii-detector.ts";
import { detectSecrets, calculateShannonEntropy } from "../extension/src/privacy/secret-detector.ts";
import { detectNamedEntities, passesNERPreFilter } from "../extension/src/privacy/ner-detector.ts";
import { annotateElementSensitivity, annotatePageStateSensitivity } from "../extension/src/privacy/sensitivity.ts";
import { redactElementText, getSubStringBoundingBox, sessionTokens } from "../extension/src/privacy/redactor.ts";
import { planDisclosure } from "../extension/src/disclosure/disclosure-planner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("==================================================");
console.log("   PRIVAAGENT LOCAL PRIVACY ENGINE BENCHMARK      ");
console.log("==================================================");

// ----------------------------------------------------
// TEST 1: Luhn Credit Card Check
// ----------------------------------------------------
console.log("\n[TEST 1] Testing Luhn Algorithm Validity...");
const validCard = "4532015000000007";
const invalidCard = "1234567890123456";
if (!isValidLuhn(validCard)) throw new Error("Valid Luhn card failed check!");
if (isValidLuhn(invalidCard)) throw new Error("Invalid Luhn card passed check!");
console.log("✓ Luhn algorithm correctly distinguishes valid vs invalid credit card checksums.");

// ----------------------------------------------------
// TEST 2: Shannon Entropy on API Keys
// ----------------------------------------------------
console.log("\n[TEST 2] Testing Shannon Entropy on Secrets...");
const apiKey = "sk-proj-7a8b9c0d1e2f3g4h5i6j7k8l9m0n1o2p3q4r5s6t";
const regularText = "Invoice number generated today";
const keyEntropy = calculateShannonEntropy(apiKey);
const textEntropy = calculateShannonEntropy(regularText);

console.log(`API Key Entropy: ${keyEntropy.toFixed(3)} bits/char`);
console.log(`Regular Text Entropy: ${textEntropy.toFixed(3)} bits/char`);

const detectedSecrets = detectSecrets(apiKey);
if (detectedSecrets.length !== 1 || detectedSecrets[0].type !== "SECRET_KEY") {
  throw new Error("API Key was not detected by secret detector!");
}
console.log("✓ API Key detected with high confidence via entropy + prefix signal.");

// ----------------------------------------------------
// TEST 3: Verification on test-page-1.html
// ----------------------------------------------------
console.log("\n[TEST 3] Running Privacy Detectors on test-page-1.html Fixture...");
const htmlPath = path.resolve(__dirname, "../benchmark/pages/test-page-1.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");
const dom = new JSDOM(htmlContent);
const doc = dom.window.document;
dom.window.Range.prototype.getBoundingClientRect = function () {
  return { left: 24, top: 100, width: 120, height: 20, right: 144, bottom: 120 };
};

const testItems = [
  { id: "user-name", text: "Rahul Sharma", expectedType: "PERSON" },
  { id: "user-email", text: "rahul.sharma@example.com", expectedType: "EMAIL" },
  { id: "user-phone", text: "+91 98765 43210", expectedType: "PHONE" },
  { id: "user-pan", text: "ABCDE1234F", expectedType: "PAN" },
  { id: "user-aadhaar", text: "9876 5432 1098", expectedType: "AADHAAR" },
  { id: "secret-key", text: "sk-proj-7a8b9c0d1e2f3g4h5i6j7k8l9m0n1o2p3q4r5s6t", expectedType: "SECRET_KEY" },
  { id: "internal-ip", text: "192.168.1.145", expectedType: "IPV4" },
];

for (const item of testItems) {
  const el = doc.getElementById(item.id);
  const elementObj = {
    target_id: item.id,
    role: "text",
    text: item.text,
    bbox: [10, 10, 100, 20],
    confidence: 1.0,
    sensitive: false,
    task_relevance: 0.5,
    sources: ["dom"],
  };

  const annotated = annotateElementSensitivity(elementObj);
  if (!annotated.sensitive) {
    throw new Error(`Element ${item.id} ("${item.text}") was NOT flagged as sensitive!`);
  }
  const detections = annotated.metadata.sensitive_detections;
  const match = detections.find((d) => d.type === item.expectedType);
  if (!match) {
    throw new Error(`Expected detection type ${item.expectedType} for ${item.id}, got: ${JSON.stringify(detections)}`);
  }
  console.log(`✓ [MATCHED] ${item.id} -> ${match.type}: "${match.text}" (conf: ${match.confidence})`);
}

// Check False Positive Resistance on test-page-1 non-PII elements
const nonPIIItems = [
  { text: "INV-2024-9042", label: "Invoice Number" },
  { text: "15-Oct-2026", label: "Date" },
  { text: "₹ 45,200.00", label: "Currency Amount" },
  { text: "Open Rahul's invoice", label: "Button Label" }, // Button itself has no secret/phone/pan
];

for (const nonPII of nonPIIItems) {
  const piiMatches = detectStructuredPII(nonPII.text);
  const secretMatches = detectSecrets(nonPII.text);
  if (piiMatches.length > 0 || secretMatches.length > 0) {
    throw new Error(`FALSE POSITIVE detected on non-PII text: "${nonPII.text}" (${nonPII.label})`);
  }
}
console.log("✓ Zero false positives on surrounding non-PII text (invoices, dates, currency).");

// ----------------------------------------------------
// TEST 4: Range-Based Redactor & Stable Session Tokens
// ----------------------------------------------------
console.log("\n[TEST 4] Testing Redaction & Stable Session Tokens...");
const dummyElement = doc.getElementById("user-name");
const redacted = redactElementText("user-name", dummyElement, "Rahul Sharma", [
  { type: "PERSON", span: [0, 12], text: "Rahul Sharma", confidence: 0.9 },
]);

console.log(`Original Text: "${redacted.originalText}"`);
console.log(`Sanitized Text: "${redacted.sanitizedText}"`);
console.log(`Overlay Spec:`, redacted.overlays[0]);

if (redacted.sanitizedText !== "[PERSON_1]") {
  throw new Error(`Expected [PERSON_1] token, got "${redacted.sanitizedText}"`);
}
// Check stable token reuse
const token2 = sessionTokens.getToken("Rahul Sharma", "PERSON");
if (token2 !== "[PERSON_1]") {
  throw new Error(`Session token stability failed: got ${token2}`);
}
console.log("✓ Redactor successfully generated overlay spec and stable session token [PERSON_1].");

// ----------------------------------------------------
// TEST 5: Minimum Disclosure Ladder (L0 -> L1 -> L2)
// ----------------------------------------------------
console.log("\n[TEST 5] Testing Minimum Disclosure Ladder...");

const samplePageState = {
  url: "http://localhost:8000/benchmark/pages/test-page-1.html",
  title: "Test Fixture",
  timestamp: Date.now(),
  elements: [
    {
      target_id: "btn-open-invoice",
      role: "button",
      text: "Open Rahul's invoice",
      bbox: [24, 280, 340, 42],
      confidence: 1.0,
      sensitive: false,
      task_relevance: 0.95,
      sources: ["dom"],
    },
    {
      target_id: "revenue-chart",
      role: "canvas",
      text: "",
      bbox: [450, 80, 380, 220],
      confidence: 1.0,
      sensitive: false,
      task_relevance: 0.0,
      sources: ["dom"],
    },
    {
      target_id: "user-name",
      role: "text",
      text: "Rahul Sharma",
      bbox: [24, 100, 150, 24],
      confidence: 1.0,
      sensitive: true,
      task_relevance: 0.5,
      sources: ["dom"],
      metadata: {
        sensitive_detections: [{ type: "PERSON", span: [0, 12], text: "Rahul Sharma", confidence: 0.9 }],
      },
    },
  ],
};

// Case A: Local Solvable Task -> L0
const l0Disclosure = planDisclosure("Open Rahul's invoice", samplePageState, {
  isSolvableLocally: true,
  requiresVision: false,
});
if (l0Disclosure.level !== "L0" || l0Disclosure.elements.length !== 0) {
  throw new Error("L0 disclosure failed: should be 0 elements, 0 bytes.");
}
console.log("✓ L0 Escalation: Local solvable task emits 0 elements across network.");

// Case B: Semantic Fallback -> L1
const l1Disclosure = planDisclosure("Find customer account status", samplePageState, {
  isSolvableLocally: false,
  requiresVision: false,
});
if (l1Disclosure.level !== "L1") {
  throw new Error("L1 disclosure failed!");
}
const disclosedUser = l1Disclosure.elements.find((el) => el.target_id === "user-name");
if (!disclosedUser || disclosedUser.label.includes("Rahul Sharma")) {
  throw new Error(`L1 disclosure leaked raw PII: ${disclosedUser?.label}`);
}
console.log(`✓ L1 Escalation: Emits masked JSON without raw PII: "${disclosedUser.label}"`);

// Case C: Vision Required on Canvas -> L2
const l2Disclosure = planDisclosure("Click Q4 revenue bar", samplePageState, {
  isSolvableLocally: false,
  requiresVision: true,
  targetCropTargetId: "revenue-chart",
  sanitizedScreenshotBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
});
if (l2Disclosure.level !== "L2" || !l2Disclosure.crop_box) {
  throw new Error("L2 disclosure failed: missing visual crop!");
}
console.log(`✓ L2 Escalation: Transmits sanitized visual crop ROI only: ${JSON.stringify(l2Disclosure.crop_box)}`);

// ----------------------------------------------------
// TEST 6: Precision & Recall on 22 Labeled Snippets
// ----------------------------------------------------
console.log("\n[TEST 6] Evaluating Precision & Recall on 22 Labeled Snippets...");
const snippetsPath = path.resolve(__dirname, "../benchmark/pii/labeled-snippets.json");
const snippets = JSON.parse(fs.readFileSync(snippetsPath, "utf-8"));

let truePositives = 0;
let falsePositives = 0;
let falseNegatives = 0;

for (const item of snippets) {
  const structMatches = detectStructuredPII(item.text);
  const secretMatches = detectSecrets(item.text);
  const nerMatches = detectNamedEntities(item.text);

  const detected = [
    ...structMatches.map((m) => ({ type: m.type, text: m.text })),
    ...secretMatches.map((m) => ({ type: m.type, text: m.text })),
    ...nerMatches.map((m) => ({ type: m.type, text: m.text })),
  ];

  const groundTruth = item.ground_truth;

  // Check each ground truth item
  for (const gt of groundTruth) {
    const found = detected.some(
      (d) => d.type === gt.type && (d.text.includes(gt.text) || gt.text.includes(d.text))
    );
    if (found) {
      truePositives++;
    } else {
      falseNegatives++;
      console.warn(`  [FN MISSED] in snippet ${item.id}: Expected ${gt.type} "${gt.text}"`);
    }
  }

  // Check for false positives
  for (const d of detected) {
    const isGroundTruth = groundTruth.some(
      (gt) => gt.type === d.type && (d.text.includes(gt.text) || gt.text.includes(d.text))
    );
    if (!isGroundTruth) {
      falsePositives++;
      console.warn(`  [FP EXTRA] in snippet ${item.id}: Unwarranted detection ${d.type} "${d.text}"`);
    }
  }
}

const precision = truePositives / (truePositives + falsePositives || 1);
const recall = truePositives / (truePositives + falseNegatives || 1);
const f1 = (2 * precision * recall) / (precision + recall || 1);

console.log("--------------------------------------------------");
console.log(`True Positives (TP):  ${truePositives}`);
console.log(`False Positives (FP): ${falsePositives}`);
console.log(`False Negatives (FN): ${falseNegatives}`);
console.log(`Precision:            ${(precision * 100).toFixed(2)}% (Target: > 95%)`);
console.log(`Recall:               ${(recall * 100).toFixed(2)}% (Target: > 90%)`);
console.log(`F1 Score:             ${(f1 * 100).toFixed(2)}%`);
console.log("--------------------------------------------------");

if (precision < 0.95 || recall < 0.9) {
  throw new Error(`Privacy benchmark failed target thresholds! Precision: ${precision}, Recall: ${recall}`);
}

console.log("\n[ALL TESTS PASSED] Prompt 2 Local Privacy Engine completely verified!");
