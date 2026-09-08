// Structured PII Detector: Zero-network deterministic regex & algorithmic detectors
// Returns exact character spans and types.

export interface PIISpan {
  type: "EMAIL" | "PHONE" | "AADHAAR" | "PAN" | "CREDIT_CARD" | "IPV4" | "IPV6";
  start: number;
  end: number;
  text: string;
  confidence: number;
}

// Luhn Algorithm to validate credit card numbers and eliminate false positives
export function isValidLuhn(digits: string): boolean {
  const clean = digits.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(clean)) return false;

  let sum = 0;
  let shouldDouble = false;

  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

// Regex Patterns
const PATTERNS: Array<{
  type: PIISpan["type"];
  regex: RegExp;
  validate?: (match: string, fullText: string, start: number) => boolean;
  confidence: number;
}> = [
  // 1. Email
  {
    type: "EMAIL",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: 0.99,
  },
  // 2. Indian Phone: +91 with space/dash or bare 10-digit starting with 6,7,8,9
  {
    type: "PHONE",
    regex: /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g,
    validate: (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length === 10 || (digits.length === 12 && digits.startsWith("91"));
    },
    confidence: 0.95,
  },
  // 3. Indian Aadhaar: 12 digits, cannot start with 0 or 1, optionally 4-4-4 grouped
  {
    type: "AADHAAR",
    regex: /(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g,
    validate: (m, fullText, start) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length !== 12 || /^(\d)\1{11}$/.test(digits)) return false;

      // Reject if immediately adjacent to surrounding space-separated digit blocks (e.g. 16-digit cards)
      const prefix = fullText.slice(Math.max(0, start - 6), start);
      if (/\d+[\s-]*$/.test(prefix)) return false;
      const suffix = fullText.slice(start + m.length, start + m.length + 6);
      if (/^[\s-]*\d+/.test(suffix)) return false;

      return true;
    },
    confidence: 0.92,
  },
  // 4. Indian PAN: 5 uppercase letters + 4 digits + 1 uppercase letter (e.g. ABCDE1234F)
  {
    type: "PAN",
    regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
    confidence: 0.98,
  },
  // 5. Credit Card (13-19 digits, optionally spaced or hyphenated) with Luhn validation
  {
    type: "CREDIT_CARD",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => isValidLuhn(m),
    confidence: 0.99,
  },
  // 6. IPv4 Address
  {
    type: "IPV4",
    regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: 0.95,
  },
  // 7. IPv6 Address
  {
    type: "IPV6",
    regex: /\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b/g,
    confidence: 0.95,
  },
];

/**
 * Detects all structured PII spans in a given string.
 */
export function detectStructuredPII(text: string): PIISpan[] {
  if (!text || text.trim().length === 0) return [];

  const results: PIISpan[] = [];

  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(text)) !== null) {
      const matchedText = match[0];
      const start = match.index;
      const end = start + matchedText.length;

      // Run additional algorithmic validator if specified
      if (pattern.validate && !pattern.validate(matchedText, text, start)) {
        continue;
      }

      results.push({
        type: pattern.type,
        start,
        end,
        text: matchedText,
        confidence: pattern.confidence,
      });
    }
  }

  // Sort by start index and filter overlaps (longest match wins)
  results.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const deduplicated: PIISpan[] = [];
  let lastEnd = -1;

  for (const span of results) {
    if (span.start >= lastEnd) {
      deduplicated.push(span);
      lastEnd = span.end;
    }
  }

  return deduplicated;
}
