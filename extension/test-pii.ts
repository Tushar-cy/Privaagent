// Privaagent Core Precision Verification Suite (Grand Finale SIH Standard)
import { detectStructuredPII } from "./src/privacy/pii-detector";
import { detectSecrets } from "./src/privacy/secret-detector";
import { detectNamedEntities } from "./src/privacy/ner-detector";

console.log("=========================================");
console.log("  PRIVAAGENT PRIVACY DETECTOR BENCHMARK  ");
console.log("=========================================\n");

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? " -> " + detail : ""}`);
    failed++;
  }
}

// 1. Email Detection
const emailSample = "Contact me at ayashmuthal@gmail.com for billing inquiries or support@privaagent.io";
const emails = detectStructuredPII(emailSample);
assert(emails.length === 2, "Email Detection Count");
assert(emails.some(e => e.text === "ayashmuthal@gmail.com"), "Captures ayashmuthal@gmail.com");
assert(emails.some(e => e.text === "support@privaagent.io"), "Captures support@privaagent.io");

// 2. Phone Detection (9-digit, 10-digit, spaced, +91, dashed)
const phoneSamples = [
  "My mobile is 981652472",                 // 9-digit from screenshot
  "Call +91 98165 24721",                  // +91 spaced
  "Contact: 98165-24721 immediately",      // dashed
  "Phone 09816524721",                     // with leading 0
  "Direct: 9876543210",                    // standard 10-digit
];

for (const sample of phoneSamples) {
  const phones = detectStructuredPII(sample);
  assert(phones.length >= 1 && phones[0].type === "PHONE", `Phone Match: "${sample}"`, `Found: ${JSON.stringify(phones)}`);
}

// 3. Indian Aadhaar Detection
const aadhaarSample = "Aadhaar Card: 9999 2345 6789 verified.";
const aadhaar = detectStructuredPII(aadhaarSample);
assert(aadhaar.some(a => a.type === "AADHAAR"), "Indian Aadhaar Match");

// 4. Indian PAN Detection
const panSample = "Tax ID: ABCDE1234F recorded on form.";
const pan = detectStructuredPII(panSample);
assert(pan.some(p => p.type === "PAN" && p.text === "ABCDE1234F"), "Indian PAN Match");

// 5. Indian GSTIN Detection
const gstinSample = "GST Invoice: 27ABCDE1234F1Z5 issued by seller.";
const gstin = detectStructuredPII(gstinSample);
assert(gstin.some(g => g.type === "GSTIN" && g.text === "27ABCDE1234F1Z5"), "Indian GSTIN Match");

// 6. Indian Driving License Detection
const dlSample = "License Number: DL-1420180123456 verified at checkpoint.";
const dl = detectStructuredPII(dlSample);
assert(dl.some(d => d.type === "DRIVING_LICENSE"), "Indian Driving License Match");

// 7. Indian Bank Account Detection
const bankSample = "Send refund to A/C 123456789012 via IMPS.";
const bank = detectStructuredPII(bankSample);
assert(bank.some(b => b.type === "BANK_ACCOUNT"), "Indian Bank Account Match");

// 8. Date of Birth Detection
const dobSample = "Applicant Profile: DOB: 14/08/1998 enrolled.";
const dob = detectStructuredPII(dobSample);
assert(dob.some(d => d.type === "DOB"), "Date of Birth (DOB) Match");

// 9. Indian Vehicle Registration Number (RC)
const rcSample = "Registered vehicle: MH-12-AB-1234 parked outside.";
const rc = detectStructuredPII(rcSample);
assert(rc.some(r => r.type === "VEHICLE_RC"), "Vehicle RC Number Match");

// 10. Secret / API Key Detection
const secretSamples = [
  "Authorization: Bearer sk-ant-api03-abcdef1234567890abcdef",
  "Google Cloud: AIzaSyD3x94jKlw-z8x9039klw-ABCD1234",
  "GitHub Token: ghp_1234567890abcdefghijklmnopqrstuvwx",
  'const config = { "api_key": "sk-1234567890abcdef1234567890" };',
  "OpenAI Key: sk-live9876543210abcdef9876543210",
];

for (const sample of secretSamples) {
  const secrets = detectSecrets(sample);
  assert(secrets.length >= 1 && secrets[0].type === "SECRET_KEY", `Secret Match: "${sample.slice(0, 35)}..."`);
}

// 11. Named Entity Recognition
const nerSample = "Invoice approved by Rahul Sharma on Tuesday.";
const ners = detectNamedEntities(nerSample);
assert(ners.some(n => n.type === "PERSON" && n.text === "Rahul Sharma"), "Named Entity: Person");

// 12. Pre-Flight Privacy Guard Verification (Layer 2 Safety)
import { verifyOutgoingDisclosure } from "./src/privacy/privacy-guard";
import { Disclosure } from "./src/common/types";

const safeDisclosure: Disclosure = {
  level: "L2",
  reason: "Visual ROI crop for chart analysis",
  task: "Click the bar representing Q4",
  elements: [
    { target_id: "el_1", role: "text", label: "Customer Name: [PERSON_1]" },
    { target_id: "el_2", role: "text", label: "Email: [EMAIL_1]" },
    { target_id: "el_3", role: "text", label: "Phone: [PHONE_1]" },
    { target_id: "el_4", role: "text", label: "Tax ID: [PAN_1]" },
  ],
  redacted_token_count: 4,
};

const safeAudit = verifyOutgoingDisclosure(safeDisclosure);
assert(safeAudit.passed === true, "Pre-Flight Guard: Clean Sanitized Payload PASSES");
assert(safeAudit.detectedLeaks.length === 0, "Pre-Flight Guard: Zero Leaks in Sanitized Payload");

const leakyDisclosure: Disclosure = {
  level: "L2",
  reason: "Unsafe disclosure attempt",
  task: "Click Q4 bar",
  elements: [
    { target_id: "el_leak_1", role: "text", label: "Raw Customer Email: leaked.citizen@gmail.com" },
    { target_id: "el_leak_2", role: "text", label: "Raw Aadhaar: 9999 2345 6789" },
  ],
  redacted_token_count: 0,
};

const leakyAudit = verifyOutgoingDisclosure(leakyDisclosure);
assert(leakyAudit.passed === false, "Pre-Flight Guard: Leaky Payload is STRICTLY BLOCKED");
assert(leakyAudit.detectedLeaks.length >= 2, "Pre-Flight Guard: Catches Both Leaks (Email + Aadhaar)");

console.log("\n=========================================");
console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=========================================\n");

if (failed > 0) process.exit(1);
