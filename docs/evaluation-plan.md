# Evaluation & Benchmark Plan

The SIH26171 evaluation criteria allocate 100% of score across five specific dimensions:

## 1. Metrics & Formulas

| Metric | Official Weight | Target Benchmark | Measurement Strategy |
| :--- | :--- | :--- | :--- |
| **Visual context accuracy from screen** | 25% | > 92% IoU / Text Acc | Compare OCR/OD bounding boxes on canvas elements against ground truth annotations in `benchmark/pages/` |
| **Recall/precision of sensitive PII detection** | 20% | Precision > 98%, Recall > 95% | Run detectors over labeled HTML snippets (`benchmark/pii/`). Compute $TP / (TP + FP)$ and $TP / (TP + FN)$ |
| **Precision of redaction** | 20% | IoU > 0.85 on sensitive spans | Compute exact IoU between computed redaction boxes and ground-truth text range boxes |
| **Client-side resource utilization** | 20% | < 150MB RAM, < 15% CPU avg | Log `performance.memory` and CPU usage via `chrome.system.cpu` during idle vs active perception cycles |
| **End-to-end task latency** | 15% | Local: < 80ms; Escalated: < 1.5s | Timestamped instrumentation at each phase: DOM walk, PII scan, Local solve, Escalation, Validation |

## 2. Benchmark Artifacts
- `benchmark/pages/test-page-1.html`: Base customer dashboard fixture with PII, invoice, API key, and Canvas chart.
- `benchmark/scripts/run_benchmarks.py`: Automated test runner aggregating per-stage timing and precision numbers into `benchmark/results/report.json`.
