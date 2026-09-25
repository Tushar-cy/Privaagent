// Unstructured PII / Named Entity Recognition (NER) Detector
// Two-stage architecture: cheap heuristic pre-filter + entity classifier.
//
// KNOWN LIMITATION (documented in README):
//   This is a heuristic detector based on capitalized-sequence matching.
//   It will miss names in ALL-CAPS government form text unless the ALL-CAPS
//   pre-filter path is active, and may false-positive on uncommon Title Case
//   UI phrases not covered by the stopword set below.
//   Single-token names without a preceding honorific are not detected to avoid
//   false positives on common capitalized words.  Single-token ORGs are only
//   detected when they appear in the curated KNOWN_SINGLE_TOKEN_ORGS list.

export interface NERSpan {
  type: "PERSON" | "ORG" | "LOCATION";
  start: number;
  end: number;
  text: string;
  confidence: number;
}

// Common honorifics & titles indicating person names (English + Indian)
const PERSON_PREFIXES = [
  "mr.", "ms.", "mrs.", "dr.", "prof.", "rev.",
  "shri", "smt.", "shrimati", "er.", "adv.", "ca.", "cs.",
  "col.", "maj.", "brig.", "lt.", "capt.", "sgt.",
];

// Common organizational indicators
const ORG_SUFFIXES = [
  "ltd", "limited", "corp", "corporation", "inc", "pvt", "llc",
  "gmbh", "bank", "technologies", "services", "solutions", "systems",
  "enterprises", "group", "holdings", "foundation", "trust", "institute",
];

/**
 * Curated list of well-known single-token organization names.
 * Used in Path D to catch common ORGs that the multi-token regex misses.
 * Only include names that are unambiguously organizations when standalone
 * (i.e., they would never appear as a common English word in UI text).
 */
const KNOWN_SINGLE_TOKEN_ORGS = new Set([
  // Indian space / defence
  "ISRO", "DRDO", "NASSCOM", "SEBI", "UIDAI", "NPCI",
  // Indian tech industry
  "Infosys", "Wipro", "TCS", "HCL", "Cognizant",
  // Global tech
  "Google", "Alphabet", "Microsoft", "Apple", "Meta", "Amazon",
  "Netflix", "Uber", "Airbnb", "Stripe", "Salesforce", "Oracle",
  "Adobe", "Intel", "Nvidia", "Qualcomm", "Samsung",
  // Indian finance
  "HDFC", "ICICI", "SBI", "Zerodha", "Paytm",
]);

/**
 * General UI and document vocabulary stopwords.
 * Covers common Title Case phrases that appear on any real webpage —
 * navigation labels, action buttons, form headings, status indicators.
 * NOT tied to any specific demo fixture.
 */
const UI_PHRASE_BLOCKLIST = new Set([
  // Navigation & actions
  "Sign In", "Sign Up", "Log In", "Log Out", "Sign Out",
  "Get Started", "Learn More", "Read More", "View More", "See More",
  "Find Out", "Click Here", "Go Back", "Go Home", "Back To",
  "Next Step", "Previous Step", "Skip This",
  // Common form / page headings
  "My Account", "My Profile", "My Orders", "My Dashboard",
  "Account Settings", "User Settings", "Privacy Settings",
  "Contact Us", "About Us", "Help Center", "Support Center",
  "Terms Of Service", "Privacy Policy", "Cookie Policy",
  "Frequently Asked", "Quick Start", "Getting Started",
  // Document / finance labels
  "Invoice Number", "Order Number", "Reference Number",
  "Due Date", "Issue Date", "Expiry Date", "Valid Until",
  "Total Amount", "Grand Total", "Sub Total", "Net Amount",
  "Tax Invoice", "Billing Address", "Shipping Address",
  "Payment Method", "Credit Card", "Debit Card",
  // Status labels
  "In Progress", "In Review", "Under Review", "On Hold",
  "Coming Soon", "Out Of", "Sold Out",
  // Generic dashboard / portal headings
  "Overview", "Summary", "Details", "History", "Activity",
  "Recent Activity", "Recent Orders", "Pending Actions",
]);

/**
 * Single-word non-name stopwords (determiners, financial/document/adjective terms).
 * Prevents false positives on common capitalized single words.
 */
const SINGLE_WORD_STOPWORDS = new Set([
  "your", "our", "their", "this", "that", "these", "those", "the", "a", "an",
  "and", "or", "but", "for", "with", "from", "into", "onto", "upon",
  "please", "note", "important", "attention", "warning", "error", "success",
  "permanent", "customer", "valid", "invalid", "estimated", "total", "subtotal",
  "account", "card", "number", "tax", "status", "order", "confirmation",
  "secondary", "emergency", "primary", "mobile", "identity", "contact",
  "billing", "invoice", "indian", "visa", "mastercard", "amex", "rupay",
  "statement", "amount", "due", "paid", "date", "period", "balance",
  "service", "product", "item", "category", "type", "code", "reference",
  "address", "street", "city", "state", "country", "district", "pincode",
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "first", "second", "third", "fourth", "fifth", "last", "next", "previous",
  "new", "old", "current", "previous", "updated", "latest", "pending",
  "active", "inactive", "enabled", "disabled", "verified", "unverified",
]);

/**
 * Cheap heuristic pre-filter: Returns true only if text contains
 * multi-word capitalized sequences (Title Case or ALL-CAPS) or known
 * name honorifics. Runs in < 0.1ms to protect client CPU / battery budget.
 *
 * Also catches ALL-CAPS multi-token sequences common in Indian government
 * forms (e.g., "RAHUL KUMAR SHARMA" on an Aadhaar or PAN letter).
 */
export function passesNERPreFilter(text: string): boolean {
  if (!text || text.length < 3 || text.length > 500) return false;

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Check honorific prefixes — single name after honorific is valid
  for (const prefix of PERSON_PREFIXES) {
    if (lower.startsWith(prefix) || lower.includes(" " + prefix)) {
      return true;
    }
  }

  // Title Case: "Rahul Sharma", "Tata Consultancy Services"
  const titleCaseRegex = /\b[A-Z][a-z]{1,25}(?:\s+[A-Z][a-z]{1,25})+\b/;
  if (titleCaseRegex.test(trimmed)) return true;

  // ALL-CAPS multi-token: "RAHUL KUMAR SHARMA" (Indian govt forms)
  const allCapsRegex = /\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\b/;
  if (allCapsRegex.test(trimmed)) return true;

  return false;
}

/**
 * Detects named entities in pre-filtered text blocks.
 * Returns spans for PERSON, ORG, and LOCATION entity types.
 */
export function detectNamedEntities(text: string): NERSpan[] {
  if (!passesNERPreFilter(text)) {
    return [];
  }

  const results: NERSpan[] = [];

  // -----------------------------------------------------------------------
  // Path A: Title Case sequences ("Rahul Sharma", "Tata Consultancy")
  // -----------------------------------------------------------------------
  const titleCaseRegex = /\b([A-Z][a-z]{1,25}(?:\s+[A-Z][a-z]{1,25})+)\b/g;
  let match: RegExpExecArray | null;

  while ((match = titleCaseRegex.exec(text)) !== null) {
    const candidate = match[0];
    const start = match.index;
    const end = start + candidate.length;
    const lower = candidate.toLowerCase();

    // Skip general UI phrases
    if (UI_PHRASE_BLOCKLIST.has(candidate)) continue;

    const words = candidate.split(/\s+/);
    const wordCount = words.length;

    // Skip if any token is a known stopword
    const containsStopword = words.some((w) => SINGLE_WORD_STOPWORDS.has(w.toLowerCase()));
    if (containsStopword) continue;

    // Classify ORG vs PERSON
    const isOrg = ORG_SUFFIXES.some(
      (s) => lower.endsWith(" " + s) || lower.endsWith("." + s)
    );

    if (isOrg) {
      results.push({ type: "ORG", start, end, text: candidate, confidence: 0.90 });
    } else if (wordCount >= 2) {
      // High-probability person name (requires >= 2 tokens to avoid single-word FP)
      results.push({ type: "PERSON", start, end, text: candidate, confidence: 0.82 });
    }
  }

  // -----------------------------------------------------------------------
  // Path B: ALL-CAPS multi-token sequences (Indian government documents)
  // e.g., "RAHUL KUMAR SHARMA", "PRIYA NAIR"
  // Only fires if not already covered by a Title Case match above.
  // -----------------------------------------------------------------------
  const allCapsRegex = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\b/g;

  while ((match = allCapsRegex.exec(text)) !== null) {
    const candidate = match[0];
    const start = match.index;
    const end = start + candidate.length;

    // Skip if already detected via Title Case path (overlap check)
    const alreadyFound = results.some((r) => r.start <= start && r.end >= end);
    if (alreadyFound) continue;

    // Skip known acronyms / non-name all-caps (short 2-3 letter codes)
    const words = candidate.split(/\s+/);
    const hasShortCode = words.some((w) => w.length <= 3);
    if (hasShortCode) continue;

    // Skip if any word is a known stopword (case-insensitive)
    const containsStopword = words.some((w) =>
      SINGLE_WORD_STOPWORDS.has(w.toLowerCase())
    );
    if (containsStopword) continue;

    // ALL-CAPS multi-word with long tokens → likely a person name on a govt form
    results.push({
      type: "PERSON",
      start,
      end,
      text: candidate,
      confidence: 0.75,
    });
  }

  // -----------------------------------------------------------------------
  // Path C: Honorific-prefixed single names ("Mr. Suresh", "Dr. Lakshmi")
  // Handles single-token names common in South Indian naming conventions.
  // -----------------------------------------------------------------------
  for (const prefix of PERSON_PREFIXES) {
    // Build pattern: honorific followed by a capitalized word
    const escapedPrefix = prefix.replace(".", "\\.");
    const honorificRegex = new RegExp(
      `(?:^|\\s)${escapedPrefix}\\s+([A-Z][a-zA-Z]{1,30})`,
      "gi"
    );
    let hMatch: RegExpExecArray | null;
    while ((hMatch = honorificRegex.exec(text)) !== null) {
      const fullMatch = hMatch[0].trim();
      const nameToken = hMatch[1];
      const start = hMatch.index + hMatch[0].indexOf(nameToken);
      const end = start + nameToken.length;

      // Skip if already captured
      const alreadyFound = results.some((r) => r.start <= start && r.end >= end);
      if (alreadyFound) continue;

      results.push({
        type: "PERSON",
        start: hMatch.index + (hMatch[0].length - fullMatch.length),
        end: hMatch.index + hMatch[0].length,
        text: fullMatch,
        confidence: 0.88,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Path D: Well-known single-token ORGs (e.g., "Google", "ISRO", "DRDO")
  // Only fires for entries in the curated KNOWN_SINGLE_TOKEN_ORGS list,
  // so precision is not degraded.
  // -----------------------------------------------------------------------
  const singleTokenOrgRegex = /\b([A-Za-z][A-Za-z0-9]{1,20})\b/g;
  while ((match = singleTokenOrgRegex.exec(text)) !== null) {
    const candidate = match[0];
    if (!KNOWN_SINGLE_TOKEN_ORGS.has(candidate)) continue;

    const start = match.index;
    const end   = start + candidate.length;

    // Skip if already covered
    const alreadyFound = results.some((r) => r.start <= start && r.end >= end);
    if (alreadyFound) continue;

    results.push({
      type: "ORG",
      start,
      end,
      text: candidate,
      confidence: 0.92,
    });
  }

  return results;
}
