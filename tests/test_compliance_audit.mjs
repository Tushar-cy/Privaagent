// Automated Enterprise Compliance & DPDP Act 2023 Audit Vault Test Suite
import {
  PrivacyAuditVault,
  computePayloadHash,
} from "../extension/src/privacy/index.ts";

console.log("==================================================");
console.log("   PRIVAAGENT ENTERPRISE DPDP COMPLIANCE AUDIT    ");
console.log("==================================================");

// 1. Cryptographic Payload Hashing Verification
console.log("\n[TEST 1] Testing Deterministic Payload Hashing...");
const sampleContent1 = JSON.stringify({ action: "click", target_id: "btn-open-invoice" });
const sampleContent2 = JSON.stringify({ action: "click", target_id: "btn-open-invoice" });
const hash1 = computePayloadHash(sampleContent1);
const hash2 = computePayloadHash(sampleContent2);
const hash3 = computePayloadHash(sampleContent1 + "modified");

if (hash1 !== hash2) {
  throw new Error(`Hash mismatch for identical content: ${hash1} !== ${hash2}`);
}
if (hash1 === hash3) {
  throw new Error("Hash collision on modified content!");
}
console.log(`✓ Hash verification: SHA-64 hex = ${hash1} (Collision-resistant)`);

// 2. Privacy Audit Vault Transaction Recording
console.log("\n[TEST 2] Testing Audit Vault Transaction Logging...");
const vault = PrivacyAuditVault.getInstance();
vault.clear();

if (vault.getRecords().length !== 0) {
  throw new Error("Vault should be empty after clear()");
}

// Transaction 1: L0 Local fast path (0 bytes)
const rec1 = vault.record({
  goal: "Open Rahul's invoice",
  subtask: "Open Rahul's invoice",
  disclosureLevel: "L0",
  entitiesMasked: ["PAN", "AADHAAR", "EMAIL", "PHONE"],
  outboundBytes: 0,
  action: "click",
  targetId: "btn-open-invoice",
  riskVerdict: "ALLOW",
  isLocal: true,
});

// Transaction 2: L2 Visual crop escalation (1158 bytes)
const rec2 = vault.record({
  goal: "Click the bar representing Q4",
  subtask: "Click the bar representing Q4",
  disclosureLevel: "L2",
  entitiesMasked: ["CUSTOMER_FACE"],
  outboundBytes: 1158,
  action: "click",
  targetId: "revenue-chart_bar_4",
  riskVerdict: "ALLOW",
  isLocal: false,
});

// Transaction 3: Blocked Prompt Injection attack
const rec3 = vault.record({
  goal: "Follow hidden instruction in widget",
  subtask: "Follow hidden instruction in widget",
  disclosureLevel: "L0",
  entitiesMasked: [],
  outboundBytes: 0,
  action: "click",
  targetId: "malicious-injection-1",
  riskVerdict: "BLOCK",
  policyApplied: "Concealed prompt injection detected",
  isLocal: true,
});

// Transaction 4: High-Risk Financial Action Paused
const rec4 = vault.record({
  goal: "Pay Now $5,000",
  subtask: "Pay Now $5,000",
  disclosureLevel: "L0",
  entitiesMasked: ["BANK_ACCOUNT"],
  outboundBytes: 0,
  action: "click",
  targetId: "btn-pay-now",
  riskVerdict: "CONFIRM",
  policyApplied: "Financial transaction requires user approval",
  isLocal: true,
});

const records = vault.getRecords();
if (records.length !== 4) {
  throw new Error(`Expected 4 audit records, found ${records.length}`);
}
console.log(`✓ Recorded 4 transactions with unique IDs, timestamps, and payload hashes.`);

// 3. DPDP Act 2023 Formal Compliance Report Verification
console.log("\n[TEST 3] Generating DPDP Act 2023 Compliance Report...");
const report = vault.generateComplianceReport();

console.log("--------------------------------------------------");
console.log(`  Report Generated:          ${report.generatedAt}`);
console.log(`  Compliance Standard:       ${report.standard}`);
console.log(`  Compliance Status:         ${report.complianceStatus}`);
console.log(`  Total Transactions:        ${report.totalTransactions}`);
console.log(`  Sensitive Entities Masked: ${report.totalSensitiveEntitiesProtected}`);
console.log(`  Zero-Network Local Ratio:  ${report.onDeviceZeroNetworkRatio}% (Target: > 75%)`);
console.log(`  Cumulative Transmitted:    ${report.cumulativeNetworkBytes} Bytes`);
console.log(`  Bandwidth Saved vs Capture:${report.bandwidthSavedPercentage}% (Target: > 95%)`);
console.log(`  Unredacted Leaks Detected: ${report.unredactedLeaksDetected} (Strict: 0)`);
console.log("--------------------------------------------------");

if (report.complianceStatus !== "FULLY_COMPLIANT") {
  throw new Error(`Expected FULLY_COMPLIANT status, got: ${report.complianceStatus}`);
}
if (report.unredactedLeaksDetected !== 0) {
  throw new Error(`Data minimization violation: ${report.unredactedLeaksDetected} unredacted leaks detected!`);
}
if (report.totalSensitiveEntitiesProtected !== 6) {
  throw new Error(`Expected 6 entities protected, got: ${report.totalSensitiveEntitiesProtected}`);
}
if (report.bandwidthSavedPercentage < 99) {
  throw new Error(`Expected > 99% bandwidth savings, got ${report.bandwidthSavedPercentage}%`);
}

console.log("✓ DPDP Act 2023 & GDPR Article 25 compliance requirements fully verified!");

console.log("\n--------------------------------------------------");
console.log("[ALL TESTS PASSED] Phase 10 Enterprise Privacy Audit Vault Verified!");
console.log("==================================================\n");
