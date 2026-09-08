# Threat Model & Security Policy

## 1. Threat Landscape
In an autonomous or semi-autonomous browser agent, threats originate from two distinct vectors:
1. **Adversarial Web Content**: Untrusted websites embedding hidden prompt injection, misleading labels, or off-screen malicious triggers.
2. **Untrusted Remote Reasoning Engine**: The server-side VLM is treated as an untrusted third-party component that must never receive unredacted sensitive user context and whose output actions must never be trusted without local verification.

## 2. Security Boundaries & Invariants

### Invariant 1: Zero Unsanitized Data Across Network
- No raw PII (Aadhaar, PAN, emails, phone numbers, auth tokens, passwords, faces) may ever cross the trust boundary into the remote server.
- The Minimum Disclosure Ladder enforces `L0` (Local Only) as the default. If `L1` or `L2` is needed, all spans must be replaced by stable session tokens (`[PERSON_1]`, `[SECRET_KEY]`), and any visual crop must be redacted on an off-screen canvas prior to transmission.

### Invariant 2: No Free-Form Script Execution
- Remote models are strictly restricted to structured Action schemas (`click`, `type`, `scroll`, `select`, `navigate`).
- Arbitrary JavaScript evaluation (`eval()`, `chrome.tabs.executeScript` with raw code strings) is strictly banned in the architecture.

### Invariant 3: Pre-Execution Action Validation
Before any action returned by the remote server is dispatched to the browser runtime, the **Local Action Validator** must:
- Re-resolve `target_id` against the current, live DOM snapshot.
- Verify the element is visible, non-zero-sized, and not obscured by overlay attacks.
- Verify element text has not mutated into an injection attack since the disclosure was sent.
- Enforce the Risk Policy:
  - `ALLOW`: Safe reads, scrolls, non-destructive navigation.
  - `CONFIRM`: Destructive actions (submit, delete, pay, transfer funds) trigger a user confirmation dialog.
  - `BLOCK`: Malformed actions, unknown targets, detected prompt injections.
