# Shared Architectural Contracts

This document explains the three core data contracts governing the Privaagent system in plain English. All modules (Extension, Privacy Engine, Vision Engine, Local Solver, Remote VLM Server, and Validator) must strictly conform to these specifications.

---

## 1. PageState Contract (`shared/page-state-schema.json`)

### Purpose
The `PageState` object represents the normalized, multi-modal representation of the active browser viewport at an exact point in time. It is generated on the client by fusing DOM, Accessibility Tree, and local computer vision outputs.

### Schema Structure
```json
{
  "url": "https://example.com/portal",
  "title": "Account Dashboard",
  "timestamp": 1725800000000,
  "viewport": {
    "width": 1280,
    "height": 720,
    "scrollX": 0,
    "scrollY": 0
  },
  "elements": [
    {
      "target_id": "btn_open_invoice",
      "role": "button",
      "text": "Open Rahul's invoice",
      "bbox": [240, 360, 180, 42],
      "confidence": 1.0,
      "sensitive": false,
      "task_relevance": 0.95,
      "sources": ["dom", "a11y"]
    }
  ]
}
```

### Invariants & Rules:
1. **`target_id` stability**: Must uniquely identify an interactive or semantic element within the current snapshot.
2. **`bbox` standard**: Bounding boxes are four floats `[x, y, width, height]` relative to the current viewport coordinate space.
3. **Ground Truth Confidence**: DOM-derived elements receive a confidence of `1.0`. Vision/OCR derived elements receive model probability scores (`0.0` to `1.0`).
4. **`sensitive` flag**: Set to `true` whenever the local privacy engine matches PII, API tokens, or credentials within this element's text span or image region.
5. **Multi-source provenance**: `sources` array tracks which perception engines contributed evidence (`"dom"`, `"a11y"`, `"vision"`, `"ocr"`, `"cv"`).

---

## 2. Action Contract (`shared/action-schema.json`)

### Purpose
Represents a concrete primitive browser interaction to be executed. Produced either by the **Local Task Solver** (fast path) or the **Remote Open-Weight VLM** (fallback path).

### Schema Structure
```json
{
  "action": "click",
  "target_id": "btn_open_invoice",
  "value": null,
  "delta": null,
  "url": null,
  "reason": "Directly matches user intent to open Rahul's invoice",
  "confidence": 0.95
}
```

### Action Types & Invariants:
- `click`: Requires valid `target_id`. Triggers browser click event on resolved node.
- `type`: Requires `target_id` and `value` (string to enter).
- `select`: Requires `target_id` and `value` (option value).
- `scroll`: Requires `delta: { "x": number, "y": number }`.
- `navigate`: Requires `url` (valid URI).
- **CRITICAL CONSTRAINT**: The action MUST specify an existing `target_id` from the current `PageState`. The remote model is strictly forbidden from returning arbitrary JavaScript strings.

---

## 3. Disclosure Contract (`shared/disclosure-schema.json`)

### Purpose
The Minimum Disclosure ladder dictates the minimal amount of information permitted to leave the client device when local solving is not possible.

### Disclosure Levels:
- **`L0` (Local Only)**: No data leaves the browser. Zero network transmission. Default for all solvable DOM interactions.
- **`L1` (Structured Semantic Context)**: Anonymized JSON list of element descriptors. All detected PII spans are replaced with typed placeholder tokens (`[PERSON_1]`, `[EMAIL]`, `[PHONE]`, `[SECRET_KEY]`). No raw pixels.
- **`L2` (Sanitized Visual Crop)**: Used only when DOM context is insufficient (e.g. `<canvas>` charts). Only the bounding box crop of the target region is transmitted, with faces, PII, and credentials blurred/redacted on an offscreen canvas before transmission.
- **`L3` (Sanitized Full Screen)**: Absolute last resort. Full page screenshot with all sensitive regions redacted.

### Schema Structure
```json
{
  "level": "L1",
  "reason": "Local solver requires semantic reasoning over masked table elements",
  "task": "Find the status of Rahul's invoice",
  "elements": [
    {
      "target_id": "btn_open_invoice",
      "role": "button",
      "label": "Open [PERSON_1]'s invoice",
      "bbox": [240, 360, 180, 42]
    }
  ],
  "crop_box": null,
  "screenshot_data": null,
  "redacted_token_count": 1
}
```

---

## Code Implementations
- **JSON Schemas**: `shared/page-state-schema.json`, `shared/action-schema.json`, `shared/disclosure-schema.json`
- **TypeScript / Zod**: `extension/src/common/types.ts`
- **Python / Pydantic v2**: `server/app/schemas/page_state.py`, `server/app/schemas/action.py`, `server/app/schemas/disclosure.py`
