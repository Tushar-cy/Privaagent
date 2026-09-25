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
|  [ Local Perception ] ──► [ DOM + A11y + OCR (Tesseract) / Classical CV ]  |
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

## 2. Module Layout

| Top-level folder | Responsibility |
| :--- | :--- |
| `extension/src/content/` | DOM walking, `MutationObserver` wiring, content-script entry point |
| `extension/src/semantic/` | DOM extraction, page-state serialisation, A11y-tree traversal |
| `extension/src/privacy/` | PII detection (regex + NER), redaction, synthetic surrogate generation, audit vault |
| `extension/src/perception/` | Visual perception pipeline — classical CV (luminance/contrast) + Tesseract.js OCR are the active paths; the Florence-2 integration is a documented no-op in this environment (see README Known Limitations) |
| `extension/src/agent/` | Task parsing, local solver, two-layer resolver (local → sanitised VLM fallback), disclosure planner |
| `extension/src/disclosure/` | Minimum-disclosure ladder (L0–L3), placeholder tokenisation, outgoing payload auditing |
| `extension/src/validator/` | Pre-execution action validation, prompt-injection scanner, risk policy engine |
| `server/` | FastAPI backend: schema validation, open-weight VLM gateway (Qwen2-VL / LLaVA-OneVision), action emission |
| `extension/src/common/` | Shared TypeScript types, profiler, utility helpers |
| `extension/src/background/` | MV3 service-worker entry, chrome.storage bridge, message routing |
