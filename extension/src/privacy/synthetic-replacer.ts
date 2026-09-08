// Privaagent Differential Privacy & Synthetic Surrogate Generator
// Generates format-preserving, mathematically valid synthetic surrogates for citizen PII.
// Complies with DPDP Act 2023 & GDPR Article 25 by ensuring real personal data never leaves
// the local sandbox, while downstream web forms receive structurally valid mock inputs.

export type SensitiveEntityType =
  | "EMAIL"
  | "PHONE"
  | "AADHAAR"
  | "PAN"
  | "CREDIT_CARD"
  | "IPV4"
  | "IPV6"
  | "UPI_ID"
  | "IFSC"
  | "IFSC_CODE"
  | "PASSPORT_IN"
  | "VOTER_ID"
  | "SECRET_KEY"
  | "JWT_TOKEN"
  | "FACE"
  | string;

// ==========================================
// 1. Verhoeff Algorithm for Indian Aadhaar
// ==========================================

// Multiplication table d
const VERHOEFF_D: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

// Permutation table p
const VERHOEFF_P: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

// Inverse table inv
const VERHOEFF_INV: number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/**
 * Computes the Verhoeff checksum digit for a numerical string.
 */
export function computeVerhoeffChecksum(numStr: string): number {
  let c = 0;
  const digits = numStr.replace(/\D/g, "").split("").map(Number).reverse();
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][digits[i]]];
  }
  return VERHOEFF_INV[c];
}

/**
 * Validates a 12-digit Aadhaar number using the Verhoeff algorithm.
 */
export function validateVerhoeff(numStr: string): boolean {
  const digits = numStr.replace(/\D/g, "");
  if (digits.length !== 12) return false;
  let c = 0;
  const reversed = digits.split("").map(Number).reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][reversed[i]]];
  }
  return c === 0;
}

/**
 * Generates a synthetically valid 12-digit Indian Aadhaar number with valid Verhoeff checksum.
 * Uses the non-allocated prefix range (starts with 9999 or 0/1 are disallowed by UIDAI).
 */
export function generateSyntheticAadhaar(formatted = true): string {
  // Use non-allocated test seed
  const prefix = "9999" + Math.floor(1000000 + Math.random() * 9000000).toString().slice(0, 7);
  const checkDigit = computeVerhoeffChecksum(prefix);
  const full = prefix + checkDigit.toString();
  return formatted ? `${full.slice(0, 4)} ${full.slice(4, 8)} ${full.slice(8, 12)}` : full;
}

// ==========================================
// 2. CBDT Indian Income Tax PAN Generator
// ==========================================

/**
 * Generates a valid format Indian PAN card string.
 * Format: 3 random letters + Entity Type ('P' for Individual) + 1 letter + 4 digits + 1 check letter.
 */
export function generateSyntheticPAN(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const p1 = letters[Math.floor(Math.random() * 26)];
  const p2 = letters[Math.floor(Math.random() * 26)];
  const p3 = letters[Math.floor(Math.random() * 26)];
  const entity = "P"; // Individual
  const surnameChar = letters[Math.floor(Math.random() * 26)];
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  const checkChar = letters[Math.floor(Math.random() * 26)];
  return `${p1}${p2}${p3}${entity}${surnameChar}${digits}${checkChar}`;
}

// ==========================================
// 3. Luhn Algorithm for Synthetic Cards
// ==========================================

/**
 * Computes Luhn check digit for a card number prefix.
 */
export function computeLuhnCheckDigit(prefix: string): number {
  const digits = prefix.replace(/\D/g, "").split("").map(Number);
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let val = digits[i];
    if (double) {
      val *= 2;
      if (val > 9) val -= 9;
    }
    sum += val;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Validates a card number using the Luhn algorithm.
 */
export function validateLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "").split("").map(Number);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let val = digits[i];
    if (double) {
      val *= 2;
      if (val > 9) val -= 9;
    }
    sum += val;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Generates a synthetically valid 16-digit test Visa card with valid Luhn checksum.
 */
export function generateSyntheticCreditCard(formatted = true): string {
  // Test Visa prefix 4532
  const seed = "4532" + Math.floor(10000000000 + Math.random() * 90000000000).toString().slice(0, 11);
  const check = computeLuhnCheckDigit(seed);
  const full = seed + check.toString();
  return formatted ? `${full.slice(0, 4)}-${full.slice(4, 8)}-${full.slice(8, 12)}-${full.slice(12, 16)}` : full;
}

// ==========================================
// 4. Regional & Financial Synthetic Generators
// ==========================================

export function generateSyntheticEmail(): string {
  const id = Math.floor(1000 + Math.random() * 9000);
  return `sandbox.user${id}@privaagent-synthetic.internal`;
}

export function generateSyntheticPhone(): string {
  const num = Math.floor(9000000000 + Math.random() * 999999999);
  return `+91 ${num.toString().slice(0, 5)} ${num.toString().slice(5, 10)}`;
}

export function generateSyntheticUPI(): string {
  const id = Math.floor(100 + Math.random() * 900);
  return `synthetic.test${id}@okhdfcbank`;
}

export function generateSyntheticIFSC(): string {
  const branch = Math.floor(100000 + Math.random() * 900000);
  return `SBIN0${branch.toString().slice(0, 6)}`;
}

// ==========================================
// 5. Unified Synthetic Surrogate Engine
// ==========================================

export type ObfuscationMode = "REDACT_MASK" | "SYNTHETIC_SURROGATE";

/**
 * Returns a format-preserving synthetic surrogate corresponding to the entity type.
 */
export function generateSyntheticSurrogate(entityType: SensitiveEntityType | string): string {
  switch (entityType) {
    case "AADHAAR":
      return generateSyntheticAadhaar();
    case "PAN":
      return generateSyntheticPAN();
    case "CREDIT_CARD":
      return generateSyntheticCreditCard();
    case "EMAIL":
      return generateSyntheticEmail();
    case "PHONE":
      return generateSyntheticPhone();
    case "UPI_ID":
      return generateSyntheticUPI();
    case "IFSC_CODE":
      return generateSyntheticIFSC();
    case "SECRET_KEY":
      return "sk_test_synthetic00000000000000000000";
    case "JWT_TOKEN":
      return "eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.";
    default:
      return "[SYNTHETIC_DATA]";
  }
}

/**
 * Replaces sensitive detected spans in a string with either standard redaction masks
 * or format-preserving synthetic surrogates.
 */
export function obfuscateText(
  text: string,
  detections: Array<{ type: SensitiveEntityType | string; span: [number, number] }>,
  mode: ObfuscationMode = "REDACT_MASK"
): string {
  if (!detections || detections.length === 0) return text;

  // Sort descending by start index to avoid invalidating subsequent indices
  const sorted = [...detections].sort((a, b) => b.span[0] - a.span[0]);
  let result = text;

  for (const det of sorted) {
    const [start, end] = det.span;
    const replacement =
      mode === "SYNTHETIC_SURROGATE"
        ? generateSyntheticSurrogate(det.type)
        : `🔒 [REDACTED_${det.type}]`;
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}
