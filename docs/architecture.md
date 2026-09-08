# Privaagent Architecture Overview

**SIH26171 — On-device Visual Perception for Light-weight Browser Agents**

## 1. System Overview
Privaagent is an adaptive, minimum-disclosure browser agent built upon the fundamental principle that **85% of scoring metrics are determined on-device**. Rather than streaming raw screen recordings or entire DOM trees to proprietary remote models, Privaagent solves tasks on-device using multi-modal perception and escalates to an untrusted, open-weight VLM server only when necessary via a strictly enforced disclosure ladder.

```
+-------------------------------------------------------------------------+
|                           BROWSER CLIENT (MV3)                          |
|                                                                         |
|  [ User Task ]                                                          |
|        │                                                                |
|        ▼                                                                |
|  [ Local Perception ] ──► [ DOM + A11y + Florence-2 / OCR / CV ]        |
|        │                                                                |
|        ▼                                                                |
|  [ Semantic Page State ]                                                |
|        │                                                                |
|        ├───────────────► [ Solvable locally? ]                          |
|        │                        │                                       |
|        │                   YES  ▼                                       |
|        │             [ Local Action ] ──► [ Browser Execution ]         |
|        │                        │                                       |
|        ▼                   NO   ▼                                       |
|  [ Minimum Disclosure Planner ] (L0 ──► L1 ──► L2 ──► L3)              |
|        │                                                                |
|        ▼                                                                |
|  [ Local Privacy Engine ] ──► (Regex + Shannon Entropy + BERT-NER)      |
|        │                  ──► Live Visual Redaction Overlay             |
+────────┼────────────────────────────────────────────────────────────────+
         │ HTTPS (Sanitized Context Only: Tokens / Masked Pixels)
         ▼
+────────────────────────────────────────────────────────────────---------+
|                      REMOTE UNTRUSTED SERVER                            |
|                                                                         |
|  [ FastAPI Backend ] ──► Defense-in-depth Schema & PII validation      |
|  [ Open-Weight VLM ] ──► Qwen2-VL-7B-Instruct / LLaVA-OneVision         |
|  [ Action Predictor] ──► Emits strict JSON {action, target_id, reason}  |
+────────┬────────────────────────────────────────────────────────────────+
         │
         ▼
+────────────────────────────────────────────────────────────────---------+
|                           LOCAL CLIENT                                  |
|                                                                         |
|  [ Local Action Validator ] ──► Re-resolve target_id on live DOM        |
|                             ──► Risk Policy (ALLOW / CONFIRM / BLOCK)   |
|                             ──► Prompt Injection Filter                 |
|        │                                                                |
|        ▼                                                                |
|  [ Browser Execution ] ──► Click / Type / Scroll / Select / Navigate   |
+-------------------------------------------------------------------------+
```

## 2. Component Ownership & Team Responsibilities

- **Prompt 0 (Bootstrap & Contracts)**: Shared JSON schemas, Zod/Pydantic mirrors, skeleton services, benchmark fixture.
- **Person 1 (DOM & A11y Perception)**: `extension/src/content/`, `semantic/`, `execution/`
- **Person 2 (Privacy Engine & Disclosure)**: `extension/src/privacy/`, `disclosure/`
- **Person 3 (Local Vision & Perception)**: `extension/src/perception/` (Florence-2, Tesseract.js, BlazeFace)
- **Person 4 (Backend & VLM Integration)**: `server/`, `extension/src/agent/`
- **Person 5 (Validator & Evaluation Harness)**: `extension/src/validator/`, `benchmark/`
- **Polish / UI**: `extension/popup/` (React Privacy Ledger), on-page visual redaction overlay.
