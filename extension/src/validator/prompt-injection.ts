// Defensive Prompt Injection Scanner
// Detects adversarial instructions hidden in DOM text, attributes, or actions.

export interface InjectionCheckResult {
  isInjection: boolean;
  riskScore: number; // 0.0 (clean) to 1.0 (high risk injection)
  matchedPatterns: string[];
  reason?: string;
}

// Known adversarial prompt injection triggers and jailbreak patterns
const INJECTION_PATTERNS: Array<{ pattern: RegExp; score: number; label: string }> = [
  { pattern: /\bignore\s+(all\s+)?previous\s+(instructions|prompts|commands)\b/i, score: 0.95, label: "IGNORE_PREVIOUS_INSTRUCTIONS" },
  { pattern: /\bsystem\s+prompt\s+override\b/i, score: 0.95, label: "SYSTEM_PROMPT_OVERRIDE" },
  { pattern: /\byou\s+are\s+now\s+in\s+(developer|debug|god|unrestricted)\s+mode\b/i, score: 0.9, label: "JAILBREAK_MODE_SWITCH" },
  { pattern: /\bdo\s+not\s+follow\s+privacy\s+rules\b/i, score: 0.95, label: "BYPASS_PRIVACY_RULES" },
  { pattern: /\btransfer\s+(all\s+)?(funds|money|balance|crypto)\s+to\b/i, score: 0.85, label: "MALICIOUS_FINANCIAL_DRAIN" },
  { pattern: /\bsend\s+(all\s+)?(credentials|passwords|tokens|keys|pii)\s+to\b/i, score: 0.95, label: "CREDENTIAL_EXFILTRATION" },
  { pattern: /\bexfiltrate\b/i, score: 0.9, label: "EXFILTRATION_COMMAND" },
  { pattern: /\bdownload\s+and\s+execute\b/i, score: 0.9, label: "REMOTE_CODE_EXECUTION" },
  { pattern: /\b(sudo|admin_override|eval\(|javascript:)\b/i, score: 0.85, label: "CODE_OR_PRIVILEGE_INJECTION" },
];

/**
 * Checks if a string contains prompt injection signatures.
 */
export function scanTextForInjection(text: string): InjectionCheckResult {
  if (!text || typeof text !== "string") {
    return { isInjection: false, riskScore: 0.0, matchedPatterns: [] };
  }

  const matchedPatterns: string[] = [];
  let maxScore = 0.0;

  // 1. Check for zero-width steganography obfuscation
  const zeroWidthCount = (text.match(/[\u200B-\u200D\uFEFF\u2060]/g) || []).length;
  if (zeroWidthCount >= 3) {
    matchedPatterns.push("ZERO_WIDTH_STEGANOGRAPHY");
    if (0.85 > maxScore) maxScore = 0.85;
  }

  // 2. Check for markdown image exfiltration strings
  if (/!\[.*?\]\(https?:\/\/[^\s)]+\?[^)]*(?:cookie|token|secret|key|data|pii)=/i.test(text)) {
    matchedPatterns.push("MARKDOWN_IMAGE_EXFILTRATION");
    if (0.95 > maxScore) maxScore = 0.95;
  }

  // 3. De-obfuscate text by stripping zero-width spaces before pattern matching
  const deobfuscated = text.replace(/[\u200B-\u200D\uFEFF\u2060]/g, "");

  for (const { pattern, score, label } of INJECTION_PATTERNS) {
    if (pattern.test(deobfuscated)) {
      matchedPatterns.push(label);
      if (score > maxScore) {
        maxScore = score;
      }
    }
  }

  const isInjection = maxScore >= 0.7;
  return {
    isInjection,
    riskScore: maxScore,
    matchedPatterns,
    reason: isInjection
      ? `Prompt injection detected: matched patterns [${matchedPatterns.join(", ")}] with risk score ${maxScore.toFixed(2)}`
      : undefined,
  };
}

/**
 * Inspects a DOM element for hidden injection text (e.g. text styled with opacity: 0,
 * font-size: 0, offscreen placement, or display: none).
 */
export function inspectElementForHiddenInjection(element: Element): InjectionCheckResult {
  const texts: string[] = [];

  // Check textContent
  if (element.textContent) {
    texts.push(element.textContent);
  }

  // Check attributes
  const attrs = ["aria-label", "title", "placeholder", "alt", "data-instruction", "data-prompt"];
  for (const attr of attrs) {
    const val = element.getAttribute(attr);
    if (val) texts.push(val);
  }

  const combinedText = texts.join(" ");
  const basicScan = scanTextForInjection(combinedText);

  // If text contains injection signatures, check if element is visually concealed
  if (basicScan.matchedPatterns.length > 0 && typeof window !== "undefined" && window.getComputedStyle) {
    const style = window.getComputedStyle(element as HTMLElement);
    const isHidden =
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      style.fontSize === "0px" ||
      style.position === "absolute" && (parseInt(style.left || "0") < -1000 || parseInt(style.top || "0") < -1000);

    if (isHidden) {
      // Concealed prompt injection is exceptionally dangerous
      return {
        isInjection: true,
        riskScore: Math.min(1.0, basicScan.riskScore + 0.2),
        matchedPatterns: [...basicScan.matchedPatterns, "CONCEALED_IN_HIDDEN_DOM_NODE"],
        reason: `CRITICAL: Concealed prompt injection detected in hidden element [${basicScan.matchedPatterns.join(", ")}]`,
      };
    }
  }

  return basicScan;
}
