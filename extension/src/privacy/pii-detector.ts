// Structured PII Detector: Zero-network deterministic regex & algorithmic detectors
// Returns exact character spans and types.

export interface PIISpan {
  type:
    | "EMAIL"
    | "PHONE"
    | "AADHAAR"
    | "PAN"
    | "CREDIT_CARD"
    | "IPV4"
    | "IPV6"
    | "UPI_ID"
    | "IFSC"
    | "PASSPORT_IN"
    | "VOTER_ID"
    | "GSTIN"
    | "DRIVING_LICENSE"
    | "BANK_ACCOUNT"
    | "DOB"
    | "VEHICLE_RC";
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
  // 2. Phone: Indian (+91, 0, or bare 9-10 digits starting with 6-9) & International format
  {
    type: "PHONE",
    regex: /(?<!\d)(?:(?:\+91|0)[\s-]?)?[6-9](?:[\s-]?\d){8,9}\b|\+[1-9]\d{0,2}[\s-]?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b/g,
    validate: (m, fullText, start) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 14) return false;
      if (fullText && typeof start === "number") {
        const prefix = fullText.slice(Math.max(0, start - 4), start);
        if (/\d+[\s-]*$/.test(prefix)) return false;
        const suffix = fullText.slice(start + m.length, start + m.length + 4);
        if (/^[\s-]*\d+/.test(suffix)) return false;
      }
      return true;
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
  // 6. Indian GSTIN (15-character Goods & Services Tax Identification Number)
  {
    type: "GSTIN",
    regex: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g,
    confidence: 0.98,
  },
  // 7. Indian Driving License (DL)
  {
    type: "DRIVING_LICENSE",
    regex: /\b[A-Z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}\b|\b[A-Z]{2}[0-9]{13,15}\b/g,
    confidence: 0.96,
  },
  // 8. Indian Bank Account Number (context-aware: preceded by A/C, Account, etc.)
  {
    type: "BANK_ACCOUNT",
    regex: /(?:\b(?:A\/C|Account|Acc|Bank\s+Account|Account\s+No|A\/C\s+No)\s*(?:No\.?|Number|#)?\s*[:=-]?\s*)(\d{9,18})\b/gi,
    confidence: 0.94,
  },
  // 9. Date of Birth (DOB) / Sensitive Birth Dates
  {
    type: "DOB",
    regex: /(?:\b(?:DOB|Date\s+of\s+Birth|Birth\s+Date|Born\s+on)\s*[:=-]?\s*)(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/gi,
    confidence: 0.92,
  },
  // 10. Indian Vehicle Registration (RC Number Plate)
  {
    type: "VEHICLE_RC",
    regex: /\b[A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}[-\s]?[0-9]{4}\b/g,
    confidence: 0.91,
  },
  // 11. IPv4 Address
  {
    type: "IPV4",
    regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: 0.95,
  },
  // 12. IPv6 Address
  {
    type: "IPV6",
    regex: /\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b/g,
    confidence: 0.95,
  },
  // 13. Indian UPI VPA ID (e.g. user@okhdfcbank, rahul@paytm, 9876543210@upi)
  {
    type: "UPI_ID",
    regex: /\b[a-zA-Z0-9.\-_]{2,64}@(okhdfcbank|okaxis|oksbi|paytm|upi|ybl|axl|ibl|apl|icici|kotak|barodampay|postbank|axisbank|sbi|hdfcbank)\b/gi,
    confidence: 0.98,
  },
  // 14. Indian Financial System Code (IFSC): 4 letters + 0 + 6 alphanumeric
  {
    type: "IFSC",
    regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
    confidence: 0.98,
  },
  // 15. Indian Passport: 1 uppercase letter followed by 7 digits
  {
    type: "PASSPORT_IN",
    regex: /\b[A-Z][1-9][0-9]{6}\b/g,
    confidence: 0.94,
  },
  // 16. Indian Voter ID / EPIC: 3 uppercase letters followed by 7 digits
  {
    type: "VOTER_ID",
    regex: /\b[A-Z]{3}[0-9]{7}\b/g,
    confidence: 0.96,
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
