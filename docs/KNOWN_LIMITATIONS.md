# Known limitations

Privaagent is a prototype. The controls below reduce some risks in the tested paths; they do not prove that every page, disclosure, or action is safe.

## Perception and localization

- **Visual recognition is narrow.** The default path uses contrast-based pixel segmentation for visual components and Tesseract for OCR. The saved internal evaluation report detected **1 of 5** visual elements in its chart fixture. Unusual charts, layouts, colors, or backgrounds may perform worse.
- **Small or low-contrast text can be missed.** OCR confidence varies with size, contrast, font, and image quality. The demo chart's small axis labels were below the reliable OCR threshold in the documented evaluation.
- **The L2 crop depends on localization.** If the target bounding box is wrong, the crop may omit the information needed for the task. The redaction manifest checks the boxes reported by the detector; it cannot prove that the detector found every sensitive region.
- **Florence-2 is experimental.** `extension/src/perception/vision.ts` defaults to classical CV plus Tesseract. Its optional Florence-2 route uses a generic image-to-text pipeline without Florence-specific task-token decoding and output parsing, so its results are not dependable.

## Sensitive-data handling

- PII and secret detection combine known patterns, checksum checks, entropy heuristics, and heuristic name detection. Unsupported formats, languages, misspellings, and context-dependent values can be missed; ordinary text can also be flagged by mistake.
- The client and backend validate outgoing text and visual contracts, but detection is not exhaustive. A successful validation is not proof that a payload contains no sensitive information.
- Synthetic replacements are format-compatible examples for testing. The project does **not** implement differential privacy or an epsilon/delta privacy guarantee. These values should not be treated as anonymized real data or as production identities.
- The audit hash chain helps identify edits to a recorded chain. It is stored with the local application state; it is not a remote signature, trusted timestamp, or protection against a compromised device or extension.

## Remote reasoning and deployment

- Tasks that the local solver cannot handle may send a filtered request to the configured backend and VLM provider. Disclosure levels and budgets limit what the client is allowed to send, but remote reasoning still involves sending data outside the browser.
- L2/L3 requests require valid screenshot data and a manifest. Image and manifest validation enforce structure and count consistency; they do not establish that all pixels were classified correctly.
- The sample backend environment uses a demo sentinel and leaves the extension-origin allowlist empty. This is intended for local evaluation on loopback, not for exposure to untrusted networks. Production deployment requires operator-managed tokens, origins, extension ID, model endpoint, and monitoring.

## Evaluation and demo

- `benchmark/results/report.json` is a project-owned snapshot dated **2026-09-25**. It reports a composite score of **79.5467/100**, including **1/5 visual elements detected**. The dataset, fixtures, and scoring rubric are maintained by the project; this is an internal self-evaluation, not an industry benchmark or independent result.
- The benchmark's 265 labeled text snippets and 10 task fixtures are small compared with real-world browser content. Its results should not be generalized to arbitrary sites or users.
- The showcase page in `demo/index.html` uses scripted task logs. It is useful for a walkthrough, but those logs are not output from a live extension, backend, or VLM run.
- The repository has not undergone a legal compliance assessment. It is designed with privacy principles such as data minimization in mind, but this does not establish DPDP Act or GDPR compliance.
