// Privaagent Phase 11 Enterprise Test Suite
// Verifies Differential Privacy synthetic surrogates (Verhoeff, CBDT, Luhn),
// cryptographic hash chaining, tamper detection, and signed compliance certificates.

import assert from "node:assert";
import {
  computeVerhoeffChecksum,
  validateVerhoeff,
  generateSyntheticAadhaar,
  generateSyntheticPAN,
  computeLuhnCheckDigit,
  validateLuhn,
  generateSyntheticCreditCard,
  generateSyntheticEmail,
  generateSyntheticUPI,
  generateSyntheticIFSC,
  obfuscateText,
  generateSyntheticSurrogate,
} from "../extension/src/privacy/synthetic-replacer.ts";

import {
  PrivacyAuditVault,
  computePayloadHash,
} from "../extension/src/privacy/audit-vault.ts";

console.log("==================================================");
console.log("   PRIVAAGENT PHASE 11 ENTERPRISE & AUDIT SUITE   ");
console.log("==================================================\n");

// [TEST 1] Testing Verhoeff Checksum Algorithm & Synthetic Aadhaar Generation
console.log("[TEST 1] Testing Verhoeff Algorithm & Synthetic Aadhaar Generation...");
const sampleAadhaar = generateSyntheticAadhaar(false);
assert.strictEqual(sampleAadhaar.length, 12, "Synthetic Aadhaar must be 12 digits");
assert.ok(validateVerhoeff(sampleAadhaar), `Synthetic Aadhaar ${sampleAadhaar} must pass Verhoeff validation`);

// Verify that tampering a single digit causes failure
const tamperedDigit = (parseInt(sampleAadhaar[11], 10) + 1) % 10;
const corruptedAadhaar = sampleAadhaar.slice(0, 11) + tamperedDigit.toString();
assert.strictEqual(
  validateVerhoeff(corruptedAadhaar),
  false,
  "Corrupted Aadhaar must fail Verhoeff validation"
);

const formattedAadhaar = generateSyntheticAadhaar(true);
assert.ok(/^\d{4} \d{4} \d{4}$/.test(formattedAadhaar), "Formatted Aadhaar matches 'XXXX XXXX XXXX'");
console.log(`✓ Verhoeff Validation verified: ${sampleAadhaar} (valid), ${corruptedAadhaar} (rejected)`);
console.log(`✓ Formatted synthetic Aadhaar generated: ${formattedAadhaar}\n`);

// [TEST 2] Testing CBDT Indian PAN Generation & Validation
console.log("[TEST 2] Testing CBDT Indian PAN Generation & Validation...");
for (let i = 0; i < 5; i++) {
  const pan = generateSyntheticPAN();
  const panRegex = /^[A-Z]{3}P[A-Z]\d{4}[A-Z]$/;
  assert.ok(panRegex.test(pan), `Generated PAN ${pan} must match CBDT Individual PAN regex`);
}
console.log(`✓ Generated 5 valid CBDT Individual PAN surrogates (e.g. ${generateSyntheticPAN()})\n`);

// [TEST 3] Testing Luhn Algorithm & Synthetic Credit Card Generation
console.log("[TEST 3] Testing Luhn Algorithm & Synthetic Credit Cards...");
const fakeCard = generateSyntheticCreditCard(false);
assert.strictEqual(fakeCard.length, 16, "Synthetic card must be 16 digits");
assert.ok(validateLuhn(fakeCard), `Synthetic card ${fakeCard} must pass Luhn validation`);

// Corrupt a digit
const corruptedCard = fakeCard.slice(0, 15) + ((parseInt(fakeCard[15], 10) + 1) % 10).toString();
assert.strictEqual(validateLuhn(corruptedCard), false, "Corrupted card must fail Luhn check");

const formattedCard = generateSyntheticCreditCard(true);
assert.ok(/^\d{4}-\d{4}-\d{4}-\d{4}$/.test(formattedCard), "Formatted card matches XXXX-XXXX-XXXX-XXXX");
console.log(`✓ Luhn Validation verified: ${fakeCard} (valid), ${corruptedCard} (rejected)`);
console.log(`✓ Formatted synthetic test card: ${formattedCard}\n`);

// [TEST 4] Testing Differential Privacy Obfuscation vs Redaction
console.log("[TEST 4] Testing Differential Privacy Obfuscation vs Redaction...");
const testDoc = "Citizen Rahul Sharma Aadhaar 987654321098 PAN ABCDE1234F";
const detections = [
  { type: "AADHAAR", span: [29, 41] },
  { type: "PAN", span: [46, 56] },
];

const maskedDoc = obfuscateText(testDoc, detections, "REDACT_MASK");
assert.ok(maskedDoc.includes("🔒 [REDACTED_AADHAAR]"), "Mask mode must inject redact token");
assert.ok(maskedDoc.includes("🔒 [REDACTED_PAN]"), "Mask mode must inject redact token");
assert.ok(!maskedDoc.includes("987654321098"), "Raw Aadhaar must be completely removed");
assert.ok(!maskedDoc.includes("ABCDE1234F"), "Raw PAN must be completely removed");

const surrogateDoc = obfuscateText(testDoc, detections, "SYNTHETIC_SURROGATE");
assert.ok(!surrogateDoc.includes("987654321098"), "Raw Aadhaar must not exist in surrogate text");
assert.ok(!surrogateDoc.includes("ABCDE1234F"), "Raw PAN must not exist in surrogate text");
console.log(`✓ Redaction Mask output: "${maskedDoc}"`);
console.log(`✓ Synthetic Surrogate output: "${surrogateDoc}"\n`);

// [TEST 5] Testing Cryptographic Hash Chaining & Tamper Detection
console.log("[TEST 5] Testing Cryptographic Hash-Chained Audit Ledger...");
const vault = PrivacyAuditVault.getInstance();
vault.clear();

const r1 = vault.record({
  goal: "Search for statement then open invoice",
  subtask: "Type 2026 into search",
  disclosureLevel: "L0",
  entitiesMasked: [],
  outboundBytes: 0,
  action: "type",
  targetId: "search-input",
  riskVerdict: "ALLOW",
  isLocal: true,
});
assert.strictEqual(r1.previousHash, "0".repeat(64), "Genesis record must point to 64 zeroes");

const r2 = vault.record({
  goal: "Search for statement then open invoice",
  subtask: "click view statement",
  disclosureLevel: "L0",
  entitiesMasked: ["PAN", "AADHAAR"],
  outboundBytes: 0,
  action: "click",
  targetId: "btn-view-statement",
  riskVerdict: "ALLOW",
  isLocal: true,
});
assert.strictEqual(r2.previousHash, r1.payloadHash, "Block 2 previousHash must link to Block 1 payloadHash");

const r3 = vault.record({
  goal: "Click the bar representing Q4",
  subtask: "click the bar representing Q4",
  disclosureLevel: "L2",
  entitiesMasked: ["AADHAAR", "PAN", "EMAIL"],
  outboundBytes: 340,
  action: "click",
  targetId: "revenue-chart_bar_4",
  riskVerdict: "ALLOW",
  isLocal: false,
});
assert.strictEqual(r3.previousHash, r2.payloadHash, "Block 3 previousHash must link to Block 2 payloadHash");

const integrityCheck = vault.verifyLedgerIntegrity();
assert.strictEqual(integrityCheck.valid, true, "Untampered ledger must verify successfully");
assert.strictEqual(integrityCheck.chainLength, 3, "Chain length must be 3");
console.log(`✓ Verified 3 sequential blocks chained cryptographically: Root Hash = ${integrityCheck.rootHash}`);

// Tamper simulation: Attacker modifies an action in Block 1
const records = vault.getRecords();
records[1].previousHash = "deadbeef".repeat(8); // Broken link (64 chars)
const tamperedCheck = vault.verifyLedgerIntegrity();
// Note that records was a shallow copy; let's directly mutate internal record for strict tamper test
vault["records"][1].previousHash = "deadbeef".repeat(8);
const detectedTamper = vault.verifyLedgerIntegrity();
assert.strictEqual(detectedTamper.valid, false, "Tampered chain must be detected as invalid");
assert.strictEqual(detectedTamper.tamperedIndex, 1, "Must report tampered index 1");
console.log(`✓ Tamper detection verified: Caught broken hash chain at block index ${detectedTamper.tamperedIndex}: "${detectedTamper.error}"\n`);

// Restore valid record
vault["records"][1].previousHash = r1.payloadHash;

// [TEST 6] Testing Signed Compliance Certificate Export
console.log("[TEST 6] Testing Signed Compliance Certificate Export...");
const cert = vault.exportSignedCertificate();
assert.ok(cert.certificateId.startsWith("PRIVAAGENT-DPDP-"), "Certificate ID prefix valid");
assert.strictEqual(cert.status, "CERTIFIED_ZERO_NETWORK_LEAK");
assert.strictEqual(cert.report.complianceStatus, "FULLY_COMPLIANT");
assert.strictEqual(cert.report.unredactedLeaksDetected, 0);
assert.strictEqual(cert.verificationHash.length, 64);

console.log(`✓ Exported Signed Certificate: ID = ${cert.certificateId}`);
console.log(`  - Standard: ${cert.report.standard}`);
console.log(`  - Status: ${cert.status}`);
console.log(`  - Verification Digest: ${cert.verificationHash}`);
console.log(`  - Bandwidth Saved: ${cert.report.bandwidthSavedPercentage}%`);

console.log("\n--------------------------------------------------");
console.log("[ALL TESTS PASSED] Phase 11 Enterprise Suite Fully Verified!");
console.log("==================================================\n");
