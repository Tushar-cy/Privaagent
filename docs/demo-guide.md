# Privaagent walkthrough

This guide is for presenting the project. The preset buttons in `demo/index.html` run scripted scenarios and print illustrative logs; they do not exercise the extension's request path. For evidence about implementation behavior, use the automated test suite. For an interactive extension run, load `privaagent-extension/` and submit a task through the extension popup on a test page.

## A short presentation

Show one local action and one blocked action, then explain the request boundary:

```text
Task → local attempt → filtered disclosure if needed → backend checks
     → proposed action → live target check → approval or block
```

Keep the explanation tied to the behavior being demonstrated. L0–L3 describe what level of page context may be sent; they are not a guarantee that every sensitive value is detected.

## Suggested sequence

### 1. Local action

Use a simple task on the fixture page, such as opening the invoice. When using the extension popup, inspect the Network panel to verify whether a request was made for that run. The scripted preset only illustrates an L0 outcome.

### 2. Visual task

Keep the Privaagent popup open while a visual task runs; it initializes the local OCR worker and loads its bundled language data on first use. Then use a chart task on a page with a canvas. The extension attempts to localize the target and prepare an L2 crop; the backend requires screenshot data and a matching redaction manifest. OCR and chart localization may fail on small labels or unusual layouts. The saved internal benchmark's chart fixture detected 1 of 5 visual elements; see [Known limitations](KNOWN_LIMITATIONS.md).

### 3. Risky action

On a test page, request an action that the risk policy classifies as `CONFIRM`. Show the Approve/Cancel prompt. Approval sends an explicit boolean and the extension checks the target again against current page state before execution. Do not use a real payment or account-deletion page for a demo.

### 4. Prompt-injection case

Use a fixture with a hidden instruction. The intended defense is for the local prompt-injection scanner or action validator to reject the unsafe path before execution. The red-team and validator suites exercise these checks.

## Showing the scripted page

The launcher opens the showcase page at `http://127.0.0.1:8000/demo/index.html`. Its task logs and sample ledger are hard-coded walkthrough output. The page includes example customer-like fixture values, so keep it local and do not present the displayed logs as measurements or proof of a live request.

For the current audit dashboard, open `privaagent-extension/report/audit-dashboard.html`. The dashboard presents local audit data; it is not a compliance certificate or an independent tamper-proof record.

## Reproduce implementation checks

From the repository root, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-all-tests.ps1
```

The runner includes the client visual tests, backend visual-contract tests, request-size checks, HTTP trust-boundary integration, and an internal benchmark smoke test. See [DECISIONS.md](DECISIONS.md) for the design trade-offs and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for evaluation scope.
