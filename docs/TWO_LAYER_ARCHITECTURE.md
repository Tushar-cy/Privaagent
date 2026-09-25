# PrivaAgent — Two-Layer Architecture

## 1. Architectural Overview

PrivaAgent is built around a simple principle: **Data should remain on the device whenever possible.**

The architecture implements two distinct processing layers:

1. **Layer 1: On-Device Local Solver**: Parses the task and inspects the local DOM and accessibility tree. If the task can be safely resolved using text or basic heuristics (e.g., clicking a clearly labeled button), it is executed immediately on-device. This path transmits 0 bytes over the network.
2. **Layer 2: Minimum Disclosure VLM Escalation**: If the task requires complex reasoning or visual perception (e.g., interacting with a `<canvas>` chart), the system isolates the specific region of interest, tokenizes/redacts all sensitive PII within it, and sends only this minimal, sanitized payload to a remote VLM.

## 2. Layer 1 — Local Processing Engine

### A. Solved Tasks
- **Semantic Target Matching**: Matching text labels to interactive elements (e.g., *"Open Rahul's invoice"*).
- **Role Affinity**: Pairing verbs with element roles (`type` &rarr; `<input>`; `click` &rarr; `<button>`).
- **Shadow DOM**: Resolving elements within open shadow roots.

### B. Execution Metrics
Based on our reproducible 5-metric benchmark suite:
- **DOM Extraction Latency**: ~1.95 ms.
- **Local Fast-Path Resolution Latency**: ~2.80 ms.
- **Memory Footprint**: ~103.25 MB heap.
- **Redaction Precision & Quality**: 100%.

## 3. Layer 2 — Sanitized VLM Fallback

When a task involves ambiguous targets or raster graphics (like an HTML5 Canvas), PrivaAgent escalates to Layer 2. 

### Pre-Flight Sanitization Sequence
1. **Local Extraction**: The DOM tree and target bounding box are extracted.
2. **Deterministic Detection**: Local heuristics (Regex, NER, Checksums) scan for known patterns (PAN, Aadhaar, Email, etc.).
3. **In-Browser Tokenization**: Raw values are replaced with tokens (`[PERSON_1]`, `[PAN_1]`). The mapping remains exclusively in the browser's memory.
4. **Visual Redaction**: Sensitive bounding boxes are painted over before any screenshots are taken.
5. **Pre-Flight Guard**: The final JSON payload is scanned. If unredacted PII is found, the outgoing request is aborted.
6. **VLM Invocation**: The sanitized payload is transmitted to the configured VLM (e.g., Qwen2.5-VL via Ollama).

## 4. Live Verification Workflow

1. Open a test page containing PII and a canvas chart.
2. Provide a local task (e.g., *"Click Submit"*). Observe 0 network requests in DevTools.
3. Provide a visual task (e.g., *"Click Q4 in the chart"*). Observe the payload in DevTools: all PII will be replaced with tokens (e.g., `[EMAIL_1]`).
4. Review the Privacy Audit Ledger to see the SHA-256 hash-chained history of disclosures.
