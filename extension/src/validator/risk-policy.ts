// Risk Policy Engine: Classifies actions into ALLOW, CONFIRM, or BLOCK
// to safeguard user privacy, credentials, financial assets, and system integrity.

import { Action, PageElement } from "../common/types";
import { scanTextForInjection, InjectionCheckResult } from "./prompt-injection";

export type PolicyVerdict = "ALLOW" | "CONFIRM" | "BLOCK";

export interface PolicyEvaluationResult {
  verdict: PolicyVerdict;
  policyReason: string;
  matchedRules: string[];
  requiredUserConfirmation?: string;
  injectionCheck?: InjectionCheckResult;
}

// Financial and transactional keywords requiring explicit user confirmation
const FINANCIAL_KEYWORDS = [
  "pay", "payment", "buy now", "purchase", "checkout", "transfer funds", "send money",
  "place order", "subscribe", "deposit", "withdraw"
];

// Destructive keywords requiring explicit confirmation
const DESTRUCTIVE_KEYWORDS = [
  "delete", "remove all", "erase", "format", "terminate", "destroy", "drop", "reset to default"
];

// Dangerous file extensions and protocols that are strictly blocked
const BLOCKED_SCHEMES = ["javascript:", "data:text/html", "vbscript:", "file:"];
const DANGEROUS_EXTENSIONS = [".exe", ".bat", ".cmd", ".sh", ".ps1", ".vbs", ".msi", ".scr"];

/**
 * Evaluates an Action against security policies and returns a verdict.
 */
export function evaluateActionRisk(
  action: Action,
  targetElement?: PageElement | null,
  currentOrigin?: string
): PolicyEvaluationResult {
  const matchedRules: string[] = [];

  // 1. Check prompt injection in Action reason, value, or target element text
  const textToCheck = [
    action.reason || "",
    action.value || "",
    targetElement?.text || "",
    targetElement?.target_id || "",
  ].join(" ");

  const injectionCheck = scanTextForInjection(textToCheck);
  if (injectionCheck.isInjection) {
    matchedRules.push("PROMPT_INJECTION_DETECTED");
    return {
      verdict: "BLOCK",
      policyReason: `Action strictly BLOCKED due to detected prompt injection: ${injectionCheck.reason}`,
      matchedRules,
      injectionCheck,
    };
  }

  // 2. Navigation security checks
  if (action.action === "navigate") {
    const targetUrl = (action.value || "").toLowerCase();

    // Block dangerous URI schemes
    for (const scheme of BLOCKED_SCHEMES) {
      if (targetUrl.startsWith(scheme)) {
        matchedRules.push("DANGEROUS_URI_SCHEME");
        return {
          verdict: "BLOCK",
          policyReason: `Navigation strictly BLOCKED: prohibited URI scheme "${scheme}"`,
          matchedRules,
        };
      }
    }

    // Block executable file downloads
    for (const ext of DANGEROUS_EXTENSIONS) {
      if (targetUrl.endsWith(ext) || targetUrl.includes(`${ext}?`)) {
        matchedRules.push("DANGEROUS_FILE_DOWNLOAD");
        return {
          verdict: "BLOCK",
          policyReason: `Navigation strictly BLOCKED: prohibited download of executable binary "${ext}"`,
          matchedRules,
        };
      }
    }

    // Cross-origin navigation requires confirmation
    if (currentOrigin && targetUrl.startsWith("http")) {
      try {
        const destOrigin = new URL(targetUrl).origin;
        if (destOrigin !== currentOrigin) {
          matchedRules.push("CROSS_ORIGIN_NAVIGATION");
          return {
            verdict: "CONFIRM",
            policyReason: `Navigation moves from ${currentOrigin} to external origin ${destOrigin}. User confirmation required.`,
            matchedRules,
            requiredUserConfirmation: `Allow navigation to external site: ${destOrigin}?`,
          };
        }
      } catch {
        // Invalid URL format
      }
    }
  }

  // 3. Typing security checks
  if (action.action === "type") {
    const typedValue = action.value || "";

    // Check for script injection attempts
    if (/<script|onerror\s*=|eval\s*\(|document\.cookie/i.test(typedValue)) {
      matchedRules.push("SCRIPT_INJECTION_PAYLOAD");
      return {
        verdict: "BLOCK",
        policyReason: "Typing action strictly BLOCKED: payload contains potential XSS/script injection code.",
        matchedRules,
      };
    }
  }

  // 4. Financial transaction checks
  const targetLabelLower = [
    targetElement?.text || "",
    targetElement?.target_id || "",
    action.value || "",
    action.reason || "",
  ].join(" ").toLowerCase();

  for (const kw of FINANCIAL_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`, "i").test(targetLabelLower)) {
      matchedRules.push("FINANCIAL_TRANSACTION");
      return {
        verdict: "CONFIRM",
        policyReason: `Action triggers a financial transaction or payment ("${kw}"). Explicit user authorization required.`,
        matchedRules,
        requiredUserConfirmation: `Privaagent is about to execute a payment action (${kw}). Do you approve?`,
      };
    }
  }

  // 5. Destructive operations check
  for (const kw of DESTRUCTIVE_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`, "i").test(targetLabelLower)) {
      matchedRules.push("DESTRUCTIVE_OPERATION");
      return {
        verdict: "CONFIRM",
        policyReason: `Action appears to perform an irreversible destructive change ("${kw}"). User confirmation required.`,
        matchedRules,
        requiredUserConfirmation: `Are you sure you want to execute destructive action (${kw})?`,
      };
    }
  }

  // 6. Confidence threshold check
  if (action.confidence !== undefined && action.confidence < 0.6) {
    matchedRules.push("LOW_CONFIDENCE_THRESHOLD");
    return {
      verdict: "CONFIRM",
      policyReason: `Action confidence (${(action.confidence * 100).toFixed(0)}%) is below autonomous threshold (60%). Confirmation requested.`,
      matchedRules,
      requiredUserConfirmation: `Privaagent is uncertain about action '${action.action}' on '${action.target_id}'. Please confirm execution.`,
    };
  }

  // 7. Safe routine action
  return {
    verdict: "ALLOW",
    policyReason: "Action verified safe under local security policy.",
    matchedRules: ["POLICY_PASSED_SAFE"],
  };
}
