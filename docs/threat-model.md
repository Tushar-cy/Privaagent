# Threat Model & Security Policy

## 1. Threat Landscape
In an autonomous or semi-autonomous browser agent, threats originate from two distinct vectors:
1. **Adversarial Web Content**: Untrusted websites embedding hidden prompt injection, misleading labels, or off-screen malicious triggers.
2. **Untrusted Remote Reasoning Engine**: The server-side VLM may receive filtered context when remote reasoning is needed. Its output is untrusted and must pass local validation before execution.

## 2. Security Boundaries & Invariants

### Goal 1: Minimize and check outbound data
- `L0` sends no task request. For `L1`–`L3`, the client filters supported text patterns and redacts detected sensitive image regions before dispatch.
- The client checks the prepared disclosure before sending; the backend repeats schema, sensitive-text, image, size, and visual-manifest checks.
- These checks reduce risk but are not proof that every sensitive value or image region was detected.

### Invariant 2: No Free-Form Script Execution
- Remote models are strictly restricted to structured Action schemas (`click`, `type`, `scroll`, `select`, `navigate`).
- Arbitrary JavaScript evaluation (`eval()`, `chrome.tabs.executeScript` with raw code strings) is strictly banned in the architecture.

### Goal 3: Check candidate content and validate actions
- **Candidate scan**: The resolver scans candidate elements for concealed prompt-injection patterns. This scanner is heuristic and does not cover every possible attack.
- After an action is resolved, the **Local Action Validator** must still:
  - Re-resolve `target_id` against the current, live DOM snapshot.
  - Verify the element is visible, non-zero-sized, and not obscured by overlay attacks.
  - Enforce the Risk Policy:
    - `ALLOW`: Safe reads, scrolls, non-destructive navigation.
    - `CONFIRM`: Destructive actions (submit, delete, pay, transfer funds) trigger a user confirmation dialog.
    - `BLOCK`: Malformed actions, unknown targets, detected prompt injections.
