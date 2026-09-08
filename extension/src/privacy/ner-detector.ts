// Unstructured PII / Named Entity Recognition (NER) Detector
// Two-stage architecture: cheap heuristic pre-filter + entity classifier.

export interface NERSpan {
  type: "PERSON" | "ORG" | "LOCATION";
  start: number;
  end: number;
  text: string;
  confidence: number;
}

// Common honorifics & titles indicating person names
const PERSON_PREFIXES = ["mr.", "ms.", "mrs.", "dr.", "prof.", "shri", "smt.", "er."];

// Common organizational indicators
const ORG_SUFFIXES = ["ltd", "limited", "corp", "corporation", "inc", "pvt", "llc", "gmbh", "bank", "technologies", "services"];

/**
 * Cheap heuristic pre-filter: Returns true only if text contains
 * multi-word capitalized sequences or known name honorifics.
 * Runs in < 0.1ms to protect client CPU / battery budget.
 */
export function passesNERPreFilter(text: string): boolean {
  if (!text || text.length < 3 || text.length > 500) return false;

  const trimmed = text.trim();

  // Check honorific prefixes
  const lower = trimmed.toLowerCase();
  for (const prefix of PERSON_PREFIXES) {
    if (lower.startsWith(prefix) || lower.includes(" " + prefix)) {
      return true;
    }
  }

  // Regex check for capitalized multi-word sequences (e.g. "Rahul Sharma", "Tata Consultancy Services")
  const capitalizedSeqRegex = /\b[A-Z][a-z]{1,25}(?:\s+[A-Z][a-z]{1,25})+\b/;
  return capitalizedSeqRegex.test(trimmed);
}

/**
 * Detects named entities in pre-filtered text blocks.
 */
export function detectNamedEntities(text: string): NERSpan[] {
  // Step 1: Resource protection check
  if (!passesNERPreFilter(text)) {
    return [];
  }

  const results: NERSpan[] = [];

  // Match capitalized sequences
  const seqRegex = /\b([A-Z][a-z]{1,25}(?:\s+[A-Z][a-z]{1,25})+)\b/g;
  let match: RegExpExecArray | null;

  while ((match = seqRegex.exec(text)) !== null) {
    const candidate = match[0];
    const start = match.index;
    const end = start + candidate.length;
    const lower = candidate.toLowerCase();
    // Ignore common UI button / heading phrases that happen to be Title Cased
    const commonUIWords = [
      "Open Invoice",
      "Customer Profile",
      "Quarterly Revenue",
      "Account Dashboard",
      "Pending Billing",
      "Download Report",
      "Sign In",
      "Log Out",
      "Submit Order",
    ];

    if (commonUIWords.includes(candidate)) {
      continue;
    }

    // Common non-name words (determiners, financial/document terms, adjectives)
    const nonNameWords = new Set([
      "your", "our", "their", "this", "that", "these", "those", "the", "a", "an",
      "permanent", "customer", "valid", "invalid", "estimated", "total", "subtotal",
      "account", "card", "number", "tax", "status", "order", "confirmation",
      "secondary", "emergency", "primary", "mobile", "identity", "contact",
      "billing", "invoice", "indian", "visa", "mastercard", "amex", "rupay",
      "statement", "amount", "due", "paid", "date", "period"
    ]);

    const words = candidate.split(/\s+/).map((w) => w.toLowerCase());
    const containsNonNameWord = words.some((w) => nonNameWords.has(w));

    // Classify ORG vs PERSON
    const isOrg = ORG_SUFFIXES.some((s) => lower.endsWith(" " + s) || lower.endsWith("." + s));

    if (isOrg) {
      results.push({
        type: "ORG",
        start,
        end,
        text: candidate,
        confidence: 0.9,
      });
    } else if (!containsNonNameWord) {
      // High probability Person Name (e.g., "Rahul Sharma")
      results.push({
        type: "PERSON",
        start,
        end,
        text: candidate,
        confidence: 0.88,
      });
    }
  }

  return results;
}
