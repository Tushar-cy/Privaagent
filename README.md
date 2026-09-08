# 🛡️ Privaagent

> **Adaptive Minimum-Disclosure Browser Agent (SIH26171)**  
> *On-device Visual Perception for Light-weight Browser Agents*

[![Chrome MV3](https://img.shields.io/badge/Chrome_Extension-MV3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI_0.115-green.svg)](https://fastapi.tiangolo.com/)
[![ONNX Runtime](https://img.shields.io/badge/Vision-Florence--2_ONNX-orange.svg)](https://huggingface.co/onnx-community/Florence-2-base-ft)
[![SIH26171 Score](https://img.shields.io/badge/SIH26171_Score-96.60%2F100-brightgreen.svg)](#-official-benchmark-scorecard)
[![Zero DOM Mutation](https://img.shields.io/badge/DOM_Mutation-0%25_Guaranteed-success.svg)](#)

---

## 📖 Overview & The "85% Rule"

Frontier browser agents (e.g. standard multi-modal LLM web agents) suffer from severe privacy and bandwidth flaws: they capture full desktop or viewport screenshots and transmit unredacted citizen PAN cards, Aadhaar IDs, banking secrets, and personal photos to remote cloud APIs on every action loop.

**Privaagent fundamentally upends this paradigm through the "85% Rule":**
> **85% of evaluation criteria and browser tasks never leave the client device.**

```
                               ┌──────────────────────┐
                               │      USER TASK       │
                               │ "Open Rahul's        │
                               │  invoice"            │
                               └──────────┬───────────┘
                                          │
                                          ▼
                    ╔══════════════════════════════════════╗
                    ║       LOCAL TRUST & POLICY CORE      ║
                    ║                                      ║
                    ║ User Intent + Privacy Policy         ║
                    ║ Action Risk + Security Rules         ║
                    ╚══════════════════╤═══════════════════╝
                                       │
                                       ▼
                    ╔══════════════════════════════════════╗
                    ║      LOCAL PERCEPTION ENGINE         ║
                    ║                                      ║
                    ║  DOM Tree (0ms)    A11y Tree (0ms)   ║
                    ║  Florence-2 Vision BlazeFace CV      ║
                    ╚══════════════════╤═══════════════════╝
                                       │
                                       ▼
                    ╔══════════════════════════════════════╗
                    ║         SEMANTIC PAGE STATE          ║
                    ║                                      ║
                    ║ Layout Geometry   Role & Text        ║
                    ║ Visual Elements   Sensitivity Map    ║
                    ╚══════════════════╤═══════════════════╝
                                       │
                                       ▼
                    ╔══════════════════════════════════════╗
                    ║       LOCAL TASK REASONING           ║
                    ║                                      ║
                    ║ Exact / fuzzy matching               ║
                    ║ Role + structure matching            ║
                    ║ Spatial & entity reasoning           ║
                    ╚══════════════════╤═══════════════════╝
                                       │
                     ┌─────────────────┴─────────────────┐
                     │                                   │
              SAFE + SOLVABLE                      NOT SOLVABLE
                     │                                   │
                     ▼                                   ▼
             ┌──────────────┐                  ╔═══════════════════╗
             │ LOCAL ACTION │                  ║ MINIMUM DISCLOSURE║
             │  (0 Bytes)   │                  ║      PLANNER      ║
             └──────────────┘                  ╚═════════╤═════════╝
                     │                                   │
                     │                                   ▼
                     │                         ╔═══════════════════╗
                     │                         ║ DISCLOSURE LEVEL  ║
                     │                         ║ L0 Local Only     ║
                     │                         ║ L1 Structured JSON║
                     │                         ║ L2 Sanitized Crop ║
                     │                         ║ L3 Screen ROI     ║
                     │                         ╚═════════╤═════════╝
                     │                                   │
                     │                                   ▼
                     │                         ╔═══════════════════╗
                     │                         ║   LOCAL PRIVACY   ║
                     │                         ║      ENGINE       ║
                     │                         ║ PII / Secret Scan ║
                     │                         ║ Range Redactor    ║
                     │                         ║ Zero DOM Mutation ║
                     │                         ╚═════════╤═════════╝
                     │                                   │
                     │                           TRUST BOUNDARY (HTTPS)
                     │                                   │
                     │                                   ▼
                     │                         ╔═══════════════════╗
                     │                         ║  REMOTE VLM / LLM ║
                     │                         ║ (Untrusted Engine)║
                     │                         ║ Receives ONLY     ║
                     │                         ║ sanitized context ║
                     │                         ║ Returns Action    ║
                     │                         ╚═════════╤═════════╝
                     │                                   │
                     │                                   ▼
                     │                         ╔═══════════════════╗
                     │                         ║ PRE-EXECUTION     ║
                     │                         ║ VALIDATOR         ║
                     │                         ║ Re-resolve Target ║
                     │                         ║ Risk Policy Guard ║
                     │                         ║ Prompt Injection  ║
                     │                         ╚═════════╤═════════╝
                     │                                   │
                     │                         ┌─────────┴─────────┐
                     │                         │         │         │
                     │                       ALLOW    CONFIRM    BLOCK
                     │                         │         │
                     └─────────────────────────┼─────────┘
                                               │
                                               ▼
                                     ╔═══════════════════╗
                                     ║   SAFE BROWSER    ║
                                     ║     EXECUTION     ║
                                     ║ Click/Type/Scroll ║
                                     ╚═══════════════════╝
```

---

## 🏆 Official Benchmark Scorecard (SIH26171)

Results automatically evaluated via `benchmark/scripts/run-benchmark.mjs` against labeled ground-truth fixtures:

| # | Evaluation Dimension | SIH Weight | Score Achieved | Weighted Contribution | Benchmark Verdict |
| :-: | :--- | :-: | :-: | :-: | :-: |
| **1** | **Visual Context Accuracy** | **25%** | **100.00%** | **25.00 / 25.00** | **PERFECT** |
| **2** | **PII Detection Accuracy (F1)** | **20%** | **100.00%** | **20.00 / 20.00** | **PERFECT (100% Prec/Rec)** |
| **3** | **Redaction Precision & Quality** | **20%** | **100.00%** | **20.00 / 20.00** | **PERFECT (0 Raw Leaks)** |
| **4** | **Client Resource Utilization** | **20%** | **83.01%** | **16.60 / 20.00** | **PASSED (< 50ms constraint)** |
| **5** | **End-to-End Task & Latency** | **15%** | **100.00%** | **15.00 / 15.00** | **PERFECT (10/10 Tasks)** |
| ─── | ──────────────────────────── | ───── | ───────── | ───────────────────── | ───────── |
| **★** | **OVERALL SIH26171 COMPOSITE SCORE** | **100%** | **96.60%** | **96.60 / 100.00** | **EXEMPLARY** |

---

## 🪜 Minimum Disclosure Ladder

| Level | Name | When Used | Transmitted Payload | Bandwidth Overhead |
| :---: | :--- | :--- | :--- | :---: |
| **L0** | **Local Only** | Task solvable from DOM semantics (`"Open Rahul's invoice"`) | **Nothing (0 network calls)** | **0 Bytes (100% Saved)** |
| **L1** | **Structured Semantic Context** | Complex form/table reasoning required | Tokenized, anonymized metadata tree (`[PERSON_1]`, `[PAN_1]`) | **< 2 KB** |
| **L2** | **Sanitized Visual Crop** | Graphical/chart non-DOM region (`"Click Q4 bar"`) | Bounded pixel crop of target element ROI only | **< 25 KB** |
| **L3** | **Sanitized Screen Viewport** | Full visual layout reasoning required | Anonymized, blurred viewport with all PII blacked out | **< 150 KB** |

---

## 📁 Repository Structure

```
Privaagent/
├── shared/                             # Locked JSON Schema Data Contracts
│   ├── page-state-schema.json          # Multimodal PageState ground truth
│   ├── action-schema.json              # Structured Browser Action contract
│   └── disclosure-schema.json          # Sanitized Minimum Disclosure contract
├── extension/                          # Chrome Extension (MV3 + Vite + TypeScript)
│   ├── src/
│   │   ├── common/types.ts             # Zod contract schemas & TypeScript types
│   │   ├── semantic/                   # DOM tree walker & A11y perception (<50ms)
│   │   ├── privacy/                    # Zero-network PII, Shannon entropy, NER & Redactor
│   │   ├── perception/                 # Florence-2 ONNX, Tesseract OCR, BlazeFace CV
│   │   ├── disclosure/                 # Minimum Disclosure Planner & Semantic Masker
│   │   ├── agent/                      # Task parser, Local solver (fast-path), Target resolver
│   │   ├── validator/                  # Action validator, Risk policy (ALLOW/CONFIRM/BLOCK)
│   │   ├── execution/                  # Human-like click, type, scroll, navigate executors
│   │   └── content/                    # Content script & zero-mutation overlay manager
│   ├── popup/                          # Mission Control & Privacy Ledger popup UI
│   └── dist/                           # Compiled production Chrome MV3 bundle
├── server/                             # Untrusted VLM Fallback Server (FastAPI + Pydantic v2)
│   └── app/
│       ├── api/routes.py               # POST /api/resolve-action with defense-in-depth checks
│       ├── security/sanitizer_check.py # Server-side regex scanner rejecting leaked raw PII
│       └── vlm/client.py               # Qwen2-VL-7B-Instruct / LLaVA-OneVision integration
├── benchmark/                          # Official SIH26171 Benchmark & Fixtures
│   ├── pages/test-page-1.html          # Benchmark fixture with PII, secrets, and canvas
│   ├── adversarial/                    # Prompt injection attacks and malicious testbed
│   ├── pii/labeled-snippets.json       # 22 labeled Indian & international PII ground truth
│   ├── tasks/benchmark-tasks.json      # Standardized evaluation task suite
│   ├── results/report.json             # Automated scoring report
│   └── scripts/run-benchmark.mjs       # Official 5-metric benchmark runner
├── demo/                               # Interactive Showcase Web Application
│   └── index.html                      # Multi-tab interactive demo with simulator
├── tests/                              # Automated Unit & Integration Test Suites
│   ├── test_contracts.py               # Python Pydantic contract validation
│   ├── test_dom_perception.mjs         # DOM perception & action execution benchmark
│   ├── test_privacy_engine.mjs         # PII detection precision & recall benchmark
│   ├── test_local_vision.mjs           # Local vision & evidence fusion benchmark
│   ├── test_agent_and_backend.mjs      # Local task solver fast-path vs visual fallback
│   ├── test_backend_api.py             # FastAPI API routes & defense-in-depth PII rejection
│   ├── test_validator.mjs              # Prompt injection detection & risk policy benchmark
│   └── test_ui_and_overlays.mjs        # Viewport overlay & policy ceiling test suite
├── docs/                               # Architecture & Security Documentation
│   ├── architecture.md                 # Complete system architecture specification
│   ├── contracts.md                    # Data schemas and boundary definitions
│   ├── threat-model.md                 # Security boundaries and risk mitigation
│   ├── evaluation-plan.md              # SIH scoring methodology & metrics
│   └── demo-guide.md                   # Live presentation script for judges
├── start-demo.ps1 / start-demo.bat     # One-click demo launcher
└── privaagent-extension.zip            # Packaged distributable extension archive
```

---

## ⚡ Quickstart & Setup

### Prerequisites
- **Node.js**: `v20+` or `v24+`
- **Python**: `3.10+` or `3.12+`

### Option 1: One-Click Demonstration Launcher (Windows)
Double-click `start-demo.bat` or run:
```powershell
.\start-demo.ps1
```
This automatically compiles the extension, packages `privaagent-extension.zip`, boots the FastAPI core server, and opens `http://127.0.0.1:8000/demo/index.html` in your browser.

---

### Option 2: Manual Step-by-Step Setup

#### 1. Build Chrome MV3 Extension
```bash
cd extension
npm install
npm run build
```
The compiled extension will be output to `extension/dist/`.

#### 2. Load Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `extension/dist/` directory.

#### 3. Start FastAPI Core Server
```bash
cd server
# Create & activate venv
python -m venv venv
.\venv\Scripts\activate       # On Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Confirm server health at `http://127.0.0.1:8000/health`.

---

## 🧪 Running the Verification & Benchmark Suite

Execute the complete automated test harness:

```powershell
# Run all 6 TypeScript test suites
cd extension
npx.cmd tsx ../tests/test_dom_perception.mjs
npx.cmd tsx ../tests/test_privacy_engine.mjs
npx.cmd tsx ../tests/test_local_vision.mjs
npx.cmd tsx ../tests/test_agent_and_backend.mjs
npx.cmd tsx ../tests/test_validator.mjs
npx.cmd tsx ../tests/test_ui_and_overlays.mjs

# Run the official SIH26171 5-metric benchmark evaluation
npx.cmd tsx ../benchmark/scripts/run-benchmark.mjs

# Run Python FastAPI unit tests
cd ..
& "server/venv/Scripts/pytest.exe"
```

---

## 🛡️ Security & Privacy Guarantees

1. **Zero DOM Mutation**: The live web page's text nodes and `innerHTML` are **never altered**, preventing application crashes or form validation corruption. Overlays are projected purely via non-intrusive viewport `backdrop-filter: blur(8px)` layers.
2. **Defense-in-Depth Sanitization**: Even if an on-device detector experiences a false negative, the server's independent scanner strictly rejects any payload containing unredacted PAN, Aadhaar, email, or API secret patterns with HTTP `422 Unprocessable Entity`.
3. **Prompt Injection Neutralization**: Concealed instructions in zero-opacity elements (`opacity: 0`, `display: none`) or malicious override commands are flagged and blocked prior to execution.
4. **Financial Safeguard Guardrails**: Financial payments (`"Pay Now $5,000"`) and destructive operations (`"Delete Account"`) trigger a mandatory user approval dialog (`CONFIRM`).

---

## 👥 Team & Problem Statement
- **Problem Statement ID**: SIH26171
- **Domain**: Artificial Intelligence / On-Device Perception / Cybersecurity
- **Architecture**: Adaptive Minimum-Disclosure Client-First Browser Agent
