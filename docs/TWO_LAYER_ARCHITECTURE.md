# PrivaAgent — Two-Layer Architecture

## 1. Architectural Overview

PrivaAgent is built around a simple principle: **Data should remain on the device whenever possible.**

The architecture implements two distinct processing layers:

1. **Layer 1: On-Device Local Solver**: Parses the task and inspects the local DOM and accessibility tree. If the task can be safely resolved using text or basic heuristics (e.g., clicking a clearly labeled button), it is executed immediately on-device. This path transmits 0 bytes over the network.
2. **Layer 2: Remote reasoning when needed**: If local resolution is insufficient, the extension prepares a disclosure at the lowest suitable level. For localized visual tasks it attempts to crop the target; detected sensitive text and image regions are masked before the request is sent to the configured VLM.

## 2. Layer 1 — Local Processing Engine

### A. Solved Tasks
- **Semantic Target Matching**: Matching text labels to interactive elements (e.g., *"Open Rahul's invoice"*).
- **Role Affinity**: Pairing verbs with element roles (`type` &rarr; `<input>`; `click` &rarr; `<button>`).
- **Shadow DOM**: Resolving elements within open shadow roots.

### B. Internal Evaluation Snapshot
The saved project-owned report (`benchmark/results/report.json`, dated 2026-09-25) records:
- **DOM Extraction Latency**: ~3.06 ms.
- **Local Fast-Path Resolution Latency**: ~2.92 ms.
- **Memory Footprint**: ~70.51 MB heap.
- **Redaction fixture**: 0 raw-pattern matches in the tested outbound payloads.

These are measurements from the internal fixtures, not general performance guarantees. The same report detected only 1 of 5 visual elements; see [Known limitations](KNOWN_LIMITATIONS.md).

## 3. Layer 2 — Sanitized VLM Fallback

When a task involves ambiguous targets or raster graphics (like an HTML5 Canvas), PrivaAgent escalates to Layer 2. 

### Pre-Flight Sanitization Sequence
1. **Local Extraction**: The DOM tree and target bounding box are extracted.
2. **Sensitive-data detection**: Local heuristics (patterns, NER, and checksums) scan for supported formats such as PAN, Aadhaar, and email.
3. **In-Browser tokenization**: Values flagged by the detector are replaced with tokens (`[PERSON_1]`, `[PAN_1]`). The token mapping is kept in browser memory.
4. **Visual redaction**: Detected sensitive boxes that overlap the disclosed image are painted over before dispatch.
5. **Pre-send checks**: The client scans the prepared payload and checks the screenshot manifest. If a check fails, it aborts the request.
6. **VLM Invocation**: The sanitized payload is transmitted to the configured VLM (e.g., Qwen2.5-VL via Ollama).

## 4. Live Verification Workflow

1. Open a test page containing PII and a canvas chart.
2. Provide a local task (e.g., *"Click Submit"*). Observe 0 network requests in DevTools.
3. Provide a visual task (e.g., *"Click Q4 in the chart"*). Inspect the request and manifest in DevTools for that run. The detector can miss sensitive content; a passing check is not proof that a payload contains no sensitive data.
4. Review the Privacy Audit Ledger to see the SHA-256 hash-chained history of disclosures.
