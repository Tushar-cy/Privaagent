// Secret Detector: Identifies API keys, tokens, and credentials via Shannon entropy
// and known provider prefix heuristics.

export interface SecretSpan {
  type: "SECRET_KEY";
  start: number;
  end: number;
  text: string;
  confidence: number;
  entropy: number;
}

// Known high-confidence token prefixes — sorted longest-first to avoid prefix collisions
const SECRET_PREFIXES: Array<{ prefix: string; minLen: number; confidence: number }> = [
  // OpenAI / Stripe (sk- followed by random string)
  { prefix: "sk-", minLen: 16, confidence: 0.99 },
  // GitHub Personal Access Token (new format)
  { prefix: "ghp_", minLen: 16, confidence: 0.99 },
  // GitHub OAuth Token
  { prefix: "gho_", minLen: 16, confidence: 0.99 },
  // GitHub Actions Token
  { prefix: "ghs_", minLen: 16, confidence: 0.99 },
  // GitHub Refresh Token
  { prefix: "ghr_", minLen: 16, confidence: 0.99 },
  // GitLab Personal Access Token
  { prefix: "glpat-", minLen: 16, confidence: 0.99 },
  // AWS Access Key ID
  { prefix: "AKIA", minLen: 20, confidence: 0.99 },
  // AWS Secret Access Key alternative prefix
  { prefix: "ASIA", minLen: 20, confidence: 0.98 },
  // Slack Bot Token
  { prefix: "xoxb-", minLen: 16, confidence: 0.99 },
  // Slack User Token
  { prefix: "xoxp-", minLen: 16, confidence: 0.99 },
  // Slack App-Level Token
  { prefix: "xapp-", minLen: 16, confidence: 0.99 },
  // Google API Keys (AIzaSy...)
  { prefix: "AIza", minLen: 20, confidence: 0.99 },
  // Google OAuth 2.0 Access Tokens
  { prefix: "ya29.", minLen: 20, confidence: 0.98 },
  // JWT tokens (starts with base64-encoded {"alg":...})
  { prefix: "eyJ", minLen: 50, confidence: 0.97 },
  // Firebase / GCP service account tokens
  { prefix: "ya29.", minLen: 20, confidence: 0.98 },
  // npm auth tokens
  { prefix: "npm_", minLen: 36, confidence: 0.99 },
  // Twilio auth tokens
  { prefix: "AC", minLen: 32, confidence: 0.92 },
  // Stripe publishable key
  { prefix: "pk_", minLen: 16, confidence: 0.97 },
  // Stripe restricted key
  { prefix: "rk_", minLen: 16, confidence: 0.97 },
  // Anthropic API key
  { prefix: "sk-ant-", minLen: 20, confidence: 0.99 },
  // HuggingFace token
  { prefix: "hf_", minLen: 16, confidence: 0.98 },
  // Bearer auth header value
  { prefix: "bearer ", minLen: 20, confidence: 0.90 },
];

// Patterns for key=value style inline secrets (e.g. API_KEY=abc123xyz, token: abc123xyz)
const KEY_VALUE_PATTERNS: RegExp[] = [
  // api_key=VALUE or apikey=VALUE (URL params, form fields)
  /(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|private[_-]?key)\s*[=:]\s*([A-Za-z0-9_\-\.]{16,})/gi,
  // Authorization: Bearer VALUE or header bearer VALUE
  /(?:Authorization\s*:\s*)?(?:Bearer|Token)\s+([A-Za-z0-9_\-\.]{16,})/gi,
  // "key": "VALUE" or 'key': 'VALUE' JSON-style
  /"(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret)"\s*:\s*"([A-Za-z0-9_\-\.]{16,})"/gi,
];

/**
 * Calculates Shannon Entropy H(X) = -sum(p(x) * log2(p(x))) of a string.
 */
export function calculateShannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;

  const charFrequencies: Record<string, number> = {};
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    charFrequencies[char] = (charFrequencies[char] || 0) + 1;
  }

  const length = str.length;
  let entropy = 0;

  for (const char in charFrequencies) {
    const p = charFrequencies[char] / length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Detects secrets and API keys in a text string.
 * @param text The input string to scan.
 * @param entropyThreshold Minimum entropy threshold (default: 3.3 for long tokens).
 */
export function detectSecrets(text: string, entropyThreshold: number = 3.3): SecretSpan[] {
  if (!text || text.length < 8) return [];

  const results: SecretSpan[] = [];
  const seenRanges = new Set<string>();

  function addResult(start: number, end: number, tokenText: string, confidence: number, entropy: number): void {
    const key = `${start}:${end}`;
    if (!seenRanges.has(key)) {
      seenRanges.add(key);
      results.push({ type: "SECRET_KEY", start, end, text: tokenText, confidence, entropy });
    }
  }

  // ── Pass 1: Key=Value pattern matches (highest confidence) ──────────────
  for (const pattern of KEY_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[1];
      const valueStart = match.index + match[0].indexOf(value);
      const valueEnd = valueStart + value.length;
      const entropy = calculateShannonEntropy(value);
      addResult(valueStart, valueEnd, value, 0.99, entropy);
    }
  }

  // ── Pass 2: Known prefix heuristics ─────────────────────────────────────
  const tokenRegex = /[A-Za-z0-9_\-\.]{8,}/g;
  let match: RegExpExecArray | null;
  tokenRegex.lastIndex = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;

    const tokenLower = token.toLowerCase();
    const entropy = calculateShannonEntropy(token);

    // Check known prefixes
    for (const prefixDef of SECRET_PREFIXES) {
      if (tokenLower.startsWith(prefixDef.prefix.toLowerCase()) && token.length >= prefixDef.minLen) {
        addResult(start, end, token, prefixDef.confidence, entropy);
        break;
      }
    }
  }

  // ── Pass 3: High Shannon entropy on long tokens (general secret detection) ──
  tokenRegex.lastIndex = 0;
  while ((match = tokenRegex.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    const key = `${start}:${end}`;

    // Skip already captured
    if (seenRanges.has(key)) continue;

    const entropy = calculateShannonEntropy(token);
    const hasNumbers = /\d/.test(token);
    const hasLetters = /[a-zA-Z]/.test(token);
    const hasMixed = /[a-z]/.test(token) && /[A-Z]/.test(token);
    const isHexToken = /^[0-9a-fA-F]{32,}$/.test(token);

    // High entropy random-looking string (cryptographic key material, hex tokens, long API keys)
    if (entropy >= entropyThreshold && token.length >= 24 && hasNumbers && hasLetters && (hasMixed || isHexToken || token.length >= 32)) {
      addResult(start, end, token, Math.min(0.95, 0.7 + (entropy - 3.0) * 0.2), entropy);
    }
  }

  // Sort by start position
  results.sort((a, b) => a.start - b.start);

  return results;
}
