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

// Known high-confidence token prefixes
const SECRET_PREFIXES = [
  "sk-",      // OpenAI, Stripe
  "ghp_",     // GitHub Personal Access Token
  "gho_",     // GitHub OAuth
  "glpat-",   // GitLab Personal Access Token
  "AKIA",     // AWS Access Key ID
  "xoxb-",    // Slack Bot Token
  "xoxp-",    // Slack User Token
  "bearer ",  // Auth Bearer token
  "eyJ",      // JWT token start
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
  if (!text || text.length < 16) return [];

  const results: SecretSpan[] = [];
  // Match contiguous token-shaped strings (no whitespace, length >= 16)
  const tokenRegex = /[A-Za-z0-9_\-\.]{16,}/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;

    // Check known prefix
    const hasKnownPrefix = SECRET_PREFIXES.some((prefix) =>
      token.toLowerCase().startsWith(prefix.toLowerCase())
    );

    const entropy = calculateShannonEntropy(token);

    // Rule 1: Known prefix + reasonable length -> High confidence
    if (hasKnownPrefix && token.length >= 20) {
      results.push({
        type: "SECRET_KEY",
        start,
        end,
        text: token,
        confidence: 0.99,
        entropy,
      });
      continue;
    }

    // Rule 2: High Shannon entropy on token > 18 chars (random / cryptographic strings)
    // Avoid pure single-character or repeated patterns
    const hasNumbers = /\d/.test(token);
    const hasLetters = /[a-zA-Z]/.test(token);

    if (entropy >= entropyThreshold && token.length >= 24 && hasNumbers && hasLetters) {
      results.push({
        type: "SECRET_KEY",
        start,
        end,
        text: token,
        confidence: Math.min(0.95, 0.7 + (entropy - 3.0) * 0.2),
        entropy,
      });
    }
  }

  return results;
}
