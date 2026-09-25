import assert from "node:assert/strict";
import { GENESIS_PREVIOUS_HASH, PrivacyAuditVault } from "../extension/src/privacy/audit-vault.ts";
import { verifyAuditLedger } from "../extension/report/audit-dashboard.js";

const vault = new PrivacyAuditVault();
const record = vault.record({
  goal: "Open a sample report",
  subtask: "Click report link",
  targetId: "el_0002",
  action: "click",
  outboundBytes: 0,
  riskVerdict: "ALLOW",
  entitiesMasked: ["EMAIL"],
  policyApplied: "Local action validation",
  isLocal: true,
  disclosureLevel: "L0",
});

assert.equal(record.previousHash, GENESIS_PREVIOUS_HASH);
const valid = await verifyAuditLedger([record]);
assert.equal(valid.valid, true, "Dashboard must verify a valid record payload hash and chain link");
assert.equal(valid.chainLength, 1);

const payloadTamper = { ...record, goal: "Changed after recording" };
const payloadResult = await verifyAuditLedger([payloadTamper]);
assert.equal(payloadResult.valid, false, "Dashboard must detect changed payload content");
assert.equal(payloadResult.tamperedIndex, 0);

const linkTamper = { ...record, previousHash: "f".repeat(64) };
const linkResult = await verifyAuditLedger([linkTamper]);
assert.equal(linkResult.valid, false, "Dashboard must detect a broken previous-hash link");

const empty = await verifyAuditLedger([]);
assert.equal(empty.valid, true);
assert.equal(empty.chainLength, 0);

console.log("[PASS] Audit dashboard verifies SHA-256 payload content and chain links; empty ledgers stay empty.");
