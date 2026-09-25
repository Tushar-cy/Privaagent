# Privaagent

Privaagent is a browser-agent prototype built for Smart India Hackathon problem SIH26171. A Chrome extension tries to resolve browser tasks locally first. When a task needs remote reasoning, it prepares a disclosure at one of four levels and checks it before sending it to a configurable backend.

This project uses local-first processing and data-minimization ideas associated with privacy engineering. It has not been assessed or certified for compliance with the DPDP Act or GDPR.

## What we built

- **Chrome extension:** TypeScript and Vite code for page perception, task resolution, privacy checks, and action validation.
- **Optional backend:** A FastAPI service that validates incoming disclosures and sends permitted requests to a configured vision-language model (VLM).
- **Disclosure levels:** The extension selects a level based on the task and its configured ceiling.
- **Local safeguards:** Supported PII patterns are masked or tokenized; visual requests include a redaction manifest. The extension and backend both check the visual contract.
- **Action checks:** The extension resolves opaque target IDs against the current page, checks the live element and risk policy, and asks for approval before actions classified as `CONFIRM`.
- **Synthetic replacements:** A utility generates format-compatible example values for testing. It does not implement differential privacy and is not a formal anonymization method.

## How it works

1. The extension extracts candidate elements from the page's DOM and accessibility information.
2. It tries the local solver. A successful `L0` action does not send a task request to the backend.
3. If local resolution is insufficient, the disclosure planner prepares the lowest supported level for the task:

   | Level | Payload | Typical use |
   |:---:|---|---|
   | `L0` | No remote payload | A task resolved locally |
   | `L1` | Structured, filtered page information | Text or form reasoning |
   | `L2` | A target crop, screenshot, and redaction manifest | A localized chart or image |
   | `L3` | A sanitized viewport screenshot and manifest | Visual context across multiple regions |

4. Before a remote request, the extension checks the disclosure policy, tab-scoped privacy budget, and outgoing payload. The tab-scoped privacy budget strictly governs autonomous agent operations (multi-turn tasks). Independently, the mandatory `requestValidatedExecution` gatekeeper governs the execution safety of any proposed action. The backend applies its own request-size, schema, image, manifest, and sensitive-data checks. A default tab-scoped budget of 50 KiB, 4 remote calls, and 8 task steps is reserved in extension session storage per browser tab and survives page navigation in that tab. This is explicitly not a global browser-session budget.
5. The backend returns a proposed action. The extension checks the target against the current page and evaluates the action risk. `CONFIRM` actions wait for an explicit user approval, then undergo live validation again.

Compound goals keep a one-use, short-lived continuation while confirmation is pending. Approval revalidates the original page-bound target, executes that exact step, and continues the remaining goal. The popup's task ledger shows detected visual ROI coordinates, redacted box coordinates, and the L2 crop or L3 viewport sent for reasoning.

The visual detector, sensitive-data detector, and prompt-injection scanner are heuristic. Detection and action validation reduce risk but cannot prove that all adversarial instructions or sensitive regions were found; see [Known limitations](docs/KNOWN_LIMITATIONS.md).

## What we tested

The local master runner currently contains **15 suites**. It covers DOM perception, privacy and PII detection, pixel-based screenshot redaction, action validation, the popup and overlays, multi-turn budgets, backend visual contracts, request-size limits, HTTP authentication, audit records, and the internal benchmark harness.

Run the suite with:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-all-tests.ps1
```

The GitHub Actions workflow type-checks and builds the extension before running integration tests. It uses Node.js 22 and Python 3.12. The benchmark is an internal evaluation on project-owned fixtures, not an industry benchmark or independent assessment. Its recorded visual-context result is limited; details are in [Known limitations](docs/KNOWN_LIMITATIONS.md).

## Current limitations

- The default visual path uses classical pixel contrast analysis and Tesseract OCR. It is not a general-purpose visual understanding model; the Florence-2 path is experimental.
- OCR can miss small or low-contrast text. Crop selection depends on target localization; ambiguous pages with multiple visual candidates use the wider L3 viewport only when the disclosure ceiling permits it.
- Prompt-injection scanning recognizes known patterns and normalizes some obfuscation. It is not a complete detector or a guarantee that page content is safe.
- PII detection combines patterns, checksums, entropy heuristics, and heuristic name detection. It can miss values outside its supported patterns and languages.
- Tasks that need broader visual or semantic reasoning require a configured backend and VLM provider. The extension does not include model credentials.
- The included showcase page uses scripted scenario logs. Those logs are not measurements of the live extension/backend path.
- This is a prototype, not a legal compliance assessment or production deployment guide.

See [Known limitations](docs/KNOWN_LIMITATIONS.md) for the evaluation snapshot and more detail. Engineering rationale is documented in [DECISIONS.md](docs/DECISIONS.md).

## How to run

### Prerequisites

- Node.js 22.x (the version used in CI)
- Python 3.12
- Chrome or another Chromium browser that supports unpacked Manifest V3 extensions

### Build and load the extension

```powershell
cd extension
npm ci
npm run build
```

`extension/` is the canonical source tree. The build is written to `extension/dist/` and mirrored to the generated root `privaagent-extension/` folder; edit source files in `extension/` and do not hand-edit the generated copy. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `privaagent-extension/`.

The prototype declares `<all_urls>` host access so it can inspect and protect arbitrary pages during evaluation. This is broad access. A production distribution should request narrower site access or use optional host permissions.

### Start the backend

```powershell
cd ..\server
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pip install pytest pytest-asyncio httpx httpx2
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The sample `.env` uses a demo sentinel and leaves `ALLOWED_EXTENSION_ID` empty. This is for local evaluation only: keep the service bound to loopback and do not expose it to an untrusted network. For a deployment, configure a unique session token, the exact extension ID, appropriate origins, and a trusted VLM endpoint.

The included `start-privaagent.bat` / `start-privaagent.ps1` launch the service and open the showcase page. **The showcase task logs are scripted.** Use the automated suites above to verify code paths; do not treat a displayed demo log as a live network or model result.

### Run the internal benchmark by itself

```powershell
cd extension
npx.cmd tsx ..\benchmark\scripts\run-benchmark.mjs
```

## Project map

```text
extension/                Canonical Chrome extension source (TypeScript)
privaagent-extension/     Generated unpacked build for local loading; do not edit
server/                   FastAPI API, schemas, and VLM client
demo/                     Scripted showcase page and sample scenarios
tests/                    Extension, backend, security, and integration tests
benchmark/                Internal fixtures and evaluation harness
docs/DECISIONS.md         Engineering decisions and trade-offs
docs/KNOWN_LIMITATIONS.md Evaluation limits and known gaps
```

## Project

Developed by Tushar ([@Tushar-cy](https://github.com/Tushar-cy)) for Smart India Hackathon 2026, problem SIH26171, Department of Space / ISRO.
