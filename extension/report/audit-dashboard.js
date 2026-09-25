// Audit history is read only from the extension's persisted ledger. The empty
// state never substitutes example transactions for real user activity.

const GENESIS_PREVIOUS_HASH = "0".repeat(64);
let currentRecords = [];
let lastVerification = null;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalRecord(record) {
  const sortedEntities = (Array.isArray(record.entitiesMasked) ? record.entitiesMasked : [])
    .slice()
    .sort()
    .join(",");
  return [
    record.previousHash,
    record.timestamp,
    record.goal,
    record.subtask,
    record.targetId,
    record.action,
    record.outboundBytes,
    record.riskVerdict,
    sortedEntities,
    record.policyApplied || "",
    record.isLocal ? "1" : "0",
    record.disclosureLevel,
  ].join("|");
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable in this context.");
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Recomputes each SHA-256 payload hash and verifies each previous-hash link. */
export async function verifyAuditLedger(records) {
  if (!Array.isArray(records)) {
    return { valid: false, chainLength: 0, rootHash: GENESIS_PREVIOUS_HASH, tamperedIndex: 0, error: "Ledger is not an array." };
  }
  if (records.length === 0) {
    return { valid: true, chainLength: 0, rootHash: GENESIS_PREVIOUS_HASH };
  }

  let expectedPreviousHash = GENESIS_PREVIOUS_HASH;
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || typeof record !== "object" || record.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        chainLength: records.length,
        rootHash: record?.payloadHash || expectedPreviousHash,
        tamperedIndex: index,
        error: `Broken previous-hash link at record ${index + 1}.`,
      };
    }

    let calculatedHash;
    try {
      calculatedHash = await sha256Hex(canonicalRecord(record));
    } catch (error) {
      return {
        valid: false,
        chainLength: records.length,
        rootHash: record.payloadHash || expectedPreviousHash,
        tamperedIndex: index,
        error: error instanceof Error ? error.message : "Hash verification failed.",
      };
    }

    if (record.payloadHash !== calculatedHash) {
      return {
        valid: false,
        chainLength: records.length,
        rootHash: record.payloadHash || expectedPreviousHash,
        tamperedIndex: index,
        error: `Payload hash mismatch at record ${index + 1}.`,
      };
    }
    expectedPreviousHash = record.payloadHash;
  }

  return { valid: true, chainLength: records.length, rootHash: expectedPreviousHash };
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function tableCell(value, className) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = String(value ?? "—");
  return cell;
}

function renderDashboard() {
  const tbody = document.getElementById("ledger-body");
  if (!tbody) return;
  tbody.replaceChildren();

  let totalBytes = 0;
  let localCount = 0;
  let totalMasked = 0;
  let possibleLeakIndicators = 0;

  if (currentRecords.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-ledger";
    cell.colSpan = 7;
    cell.textContent = "No audit transactions recorded yet. Run a Privaagent task to generate the first record.";
    row.appendChild(cell);
    tbody.appendChild(row);
  }

  for (const record of currentRecords) {
    const bytes = safeNumber(record.outboundBytes);
    const entities = Array.isArray(record.entitiesMasked) ? record.entitiesMasked : [];
    totalBytes += bytes;
    if (bytes === 0) localCount++;
    totalMasked += entities.length;
    if (bytes > 0 && entities.length === 0) possibleLeakIndicators++;

    const row = document.createElement("tr");
    const levelClass = ({ L0: "badge-l0", L1: "badge-l1", L2: "badge-l2", L3: "badge-l2" })[record.disclosureLevel] || "";
    const verdictClass = ({ ALLOW: "badge-allow", CONFIRM: "badge-confirm", BLOCK: "badge-block" })[record.riskVerdict] || "";

    row.appendChild(tableCell(String(record.id || "").slice(0, 16), "mono-cell"));
    row.appendChild(tableCell(record.subtask || record.goal || "—"));

    const levelCell = document.createElement("td");
    const level = document.createElement("span");
    level.className = `badge ${levelClass}`.trim();
    level.textContent = String(record.disclosureLevel || "—");
    levelCell.appendChild(level);
    row.appendChild(levelCell);

    row.appendChild(tableCell(record.targetId || "—", "mono-cell"));

    const verdictCell = document.createElement("td");
    const verdict = document.createElement("span");
    verdict.className = `badge ${verdictClass}`.trim();
    verdict.textContent = String(record.riskVerdict || "—");
    verdictCell.appendChild(verdict);
    row.appendChild(verdictCell);
    row.appendChild(tableCell(`${bytes} B`));
    row.appendChild(tableCell(`${String(record.previousHash || "").slice(0, 8)} → ${String(record.payloadHash || "").slice(0, 8)}`, "hash-cell"));
    tbody.appendChild(row);
  }

  if (currentRecords.length === 0) {
    setText("kpi-local-ratio", "—");
    setText("kpi-bandwidth-saved", "—");
    setText("kpi-entities-masked", "—");
    setText("kpi-leaks", "—");
    setText("root-hash", "No ledger records");
  } else {
    const total = currentRecords.length;
    const ratio = ((localCount / total) * 100).toFixed(1);
    const baseline = total * 1200 * 1024;
    const saved = Math.max(0, 100 - (totalBytes / baseline) * 100).toFixed(2);
    setText("kpi-local-ratio", `${ratio}%`);
    setText("kpi-bandwidth-saved", `${saved}%`);
    setText("kpi-entities-masked", String(totalMasked));
    setText("kpi-leaks", String(possibleLeakIndicators));
    setText("root-hash", currentRecords[currentRecords.length - 1].payloadHash || "Invalid hash");
  }
  setText("records-count", `${currentRecords.length} record${currentRecords.length === 1 ? "" : "s"}`);
}

function initLedger() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["privaagent_audit_ledger"], (result) => {
      const error = chrome.runtime?.lastError;
      currentRecords = !error && Array.isArray(result.privaagent_audit_ledger)
        ? result.privaagent_audit_ledger
        : [];
      renderDashboard();
      void reverifyChain();
    });
  } else {
    currentRecords = [];
    renderDashboard();
    void reverifyChain();
  }
}

async function reverifyChain() {
  const feedback = document.getElementById("verify-feedback");
  const status = document.getElementById("chain-status");
  const result = await verifyAuditLedger(currentRecords);
  lastVerification = result;

  if (currentRecords.length === 0) {
    if (feedback) feedback.textContent = "No audit transactions recorded yet.";
    if (status) {
      status.textContent = "NO RECORDS";
      status.className = "meta-val integrity-neutral";
    }
    return result;
  }

  if (result.valid) {
    if (feedback) feedback.textContent = `Cryptographic integrity verified. Records checked: ${result.chainLength}; hash mismatches: 0.`;
    if (status) {
      status.textContent = "VERIFIED";
      status.className = "meta-val integrity-good";
    }
  } else {
    if (feedback) feedback.textContent = result.error || "Ledger integrity verification failed.";
    if (status) {
      status.textContent = "COMPROMISED";
      status.className = "meta-val integrity-bad";
    }
  }
  return result;
}

function generateSyntheticPreview() {
  const fakeAadhaar = "9999 0000 0016";
  const fakePAN = `ABCPE${Math.floor(1000 + Math.random() * 9000)}Z`;
  setText("synthetic-demo-val", `Synthetic example only · ${fakeAadhaar} · ${fakePAN}`);
}

async function exportSignedJSON() {
  const verification = await verifyAuditLedger(currentRecords);
  const data = {
    generatedAt: new Date().toISOString(),
    integrity: verification,
    totalRecords: currentRecords.length,
    ledger: currentRecords,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `privaagent_privacy_audit_${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-print")?.addEventListener("click", () => window.print());
    document.getElementById("btn-export")?.addEventListener("click", () => void exportSignedJSON());
    document.getElementById("btn-verify")?.addEventListener("click", () => void reverifyChain());
    generateSyntheticPreview();
    initLedger();
  });
}
