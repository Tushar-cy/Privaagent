// Pre-Flight Privacy Guard: Final local gatekeeper before any network transmission.
// Scans the fully assembled outbound Disclosure payload to ensure NO raw sensitive
// information ever crosses the device boundary. If any unredacted pattern is found,
// the request is STRICTLY BLOCKED on-device.

import { Disclosure } from "../common/types";
import { isValidLuhn } from "./pii-detector";
import { computePayloadHash } from "./audit-vault";

export interface PrivacyGuardResult {
  passed: boolean;
  sanitizationTimeMs: number;
  detectedLeaks: Array<{ type: string; snippet: string; field: string }>;
  verifiedPayloadHash: string;
  blockedReason?: string;
}

// Regex patterns to check for unredacted raw personal data in outgoing JSON
const PREFLIGHT_PII_PATTERNS: Array<{
  type: string;
  regex: RegExp;
  validate?: (match: string) => boolean;
}> = [
  // 1. Raw Email (must not be e.g. rahul@example.com)
  {
    type: "EMAIL",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  // 2. Raw Phone (Indian & International)
  {
    type: "PHONE",
    regex: /(?:(?:\+91|0)[\s-]?)?[6-9](?:[\s-]?\d){8,9}\b|\+[1-9]\d{0,2}[\s-]?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b/g,
    validate: (m) => {
      const d = m.replace(/\D/g, "");
      return d.length >= 9 && d.length <= 14;
    },
  },
  // 3. Raw Indian Aadhaar
  {
    type: "AADHAAR",
    regex: /(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g,
    validate: (m) => {
      const d = m.replace(/\D/g, "");
      return d.length === 12 && !/^(\d)\1{11}$/.test(d);
    },
  },
  // 4. Raw Indian PAN
  {
    type: "PAN",
    regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
  },
  // 5. Raw Indian GSTIN
  {
    type: "GSTIN",
    regex: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g,
  },
  // 6. Raw Indian Driving License
  {
    type: "DRIVING_LICENSE",
    regex: /\b[A-Z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}\b|\b[A-Z]{2}[0-9]{13,15}\b/g,
  },
  // 7. Raw Credit Card (Luhn checked)
  {
    type: "CREDIT_CARD",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => isValidLuhn(m),
  },
  // 8. Raw Secrets & API Keys
  {
    type: "SECRET_KEY",
    regex: /\b(?:sk-|ghp_|ya29\.|AIzaSy|AKIA|npm_|hf_|sk-ant-)[a-zA-Z0-9_\-]{14,}\b/g,
  },
  // 9. Raw Indian Bank Account
  {
    type: "BANK_ACCOUNT",
    regex: /(?:\b(?:A\/C|Account|Acc|Bank\s+Account|Account\s+No|A\/C\s+No)\s*(?:No\.?|Number|#)?\s*[:=-]?\s*)(\d{9,18})\b/gi,
  },
];

// Legitimate anonymized placeholders that are EXPECTED in a sanitized payload
const LEGITIMATE_PLACEHOLDER_REGEX = /^\[(?:PERSON|EMAIL|PHONE|AADHAAR|PAN|GSTIN|DRIVING_LICENSE|BANK_ACCOUNT|DOB|VEHICLE_RC|CREDIT_CARD|SECRET_KEY|UPI_ID|IFSC|PASSPORT_IN|VOTER_ID|IPV4|IPV6|PASSWORD|LOCATION|ORG)_[0-9]+\]$/;

/**
 * Checks if a string is a legitimate anonymized token placeholder (e.g. [EMAIL_1]).
 */
function isAnonymizedToken(str: string): boolean {
  return LEGITIMATE_PLACEHOLDER_REGEX.test(str.trim());
}

/**
 * Performs a rigorous pre-flight privacy audit on an outgoing Disclosure payload.
 * Runs completely on-device before any network packet is permitted to leave.
 */
export function verifyOutgoingDisclosure(disclosure: Disclosure): PrivacyGuardResult {
  const startTime = performance.now();
  const detectedLeaks: Array<{ type: string; snippet: string; field: string }> = [];

  // 1. Text elements to scan
  const targetsToCheck: Array<{ field: string; text: string }> = [];

  if (disclosure.task) {
    targetsToCheck.push({ field: "task", text: disclosure.task });
  }
  if (disclosure.reason) {
    targetsToCheck.push({ field: "reason", text: disclosure.reason });
  }

  for (const el of disclosure.elements) {
    if (el.label) {
      targetsToCheck.push({ field: `element:${el.target_id}:label`, text: el.label });
    }
  }

  // 2. Scan each field for unredacted raw patterns
  for (const target of targetsToCheck) {
    // If the entire field is an anonymized placeholder, it is safe
    if (isAnonymizedToken(target.text)) {
      continue;
    }

    for (const pattern of PREFLIGHT_PII_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.regex.exec(target.text)) !== null) {
        const rawMatch = match[0];

        // Skip if this specific match is an anonymized placeholder token
        if (isAnonymizedToken(rawMatch)) {
          continue;
        }

        // Run algorithmic validator if defined
        if (pattern.validate && !pattern.validate(rawMatch)) {
          continue;
        }

        // LEAK DETECTED: This is raw unredacted personal data!
        detectedLeaks.push({
          type: pattern.type,
          snippet: rawMatch.length > 8 ? `${rawMatch.slice(0, 4)}...${rawMatch.slice(-3)}` : "***",
          field: target.field,
        });
      }
    }
  }

  const durationMs = performance.now() - startTime;
  const serialized = JSON.stringify(disclosure);
  const verifiedPayloadHash = computePayloadHash(serialized);

  const passed = detectedLeaks.length === 0;

  return {
    passed,
    sanitizationTimeMs: durationMs,
    detectedLeaks,
    verifiedPayloadHash,
    blockedReason: passed
      ? undefined
      : `Pre-Flight Privacy Audit FAILED: Detected ${detectedLeaks.length} unredacted sensitive entity leak(s) [${detectedLeaks.map((l) => `${l.type} in ${l.field}`).join(", ")}]. Network request strictly BLOCKED on-device.`,
  };
}
