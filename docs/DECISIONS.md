# Engineering decisions

This log records design choices visible in the current implementation. “Alternatives considered” describes plausible options, not claims that an earlier version of the project used them.

## 1. Try local resolution before contacting a model

**Problem**  Common browser tasks such as clicking a clearly labeled button do not need a remote model. Sending page context for every task would add latency and disclose more information.

**Alternatives considered**  Send every task to a VLM; or resolve clear DOM-based tasks locally and use the VLM only when the local path is insufficient.

**Decision**  Run the local task solver first. A sufficiently confident local result uses `L0` and does not make a task request. Visual or low-confidence tasks continue to disclosure planning.

**Why**  A browser already exposes useful semantic information through the DOM and accessibility tree. Using it can avoid an unnecessary network round trip.

**Trade-off**  Local matching is heuristic. Ambiguous labels, canvas content, and other visual tasks may need remote reasoning or may remain unresolved.

## 2. Use extension-generated target IDs

**Problem**  DOM IDs, names, and selectors are chosen by the page. They may contain private text, change between renders, or point to a different element when the page changes.

**Alternatives considered**  Send page DOM IDs or CSS selectors to the model; or assign short IDs in the extension and resolve those IDs locally.

**Decision**  The extension assigns opaque IDs such as `el_0004`. The action validator accepts a target only if it exists in the current page state and resolves through the extension's agent-owned element registry.

**Why**  The model can refer to a candidate without receiving its page-controlled identifier. Before execution, the extension checks the live element again.

**Trade-off**  An ID is meaningful only for the current extracted page state. It must be refreshed after relevant navigation or DOM changes, and live validation can reject stale model output.

## 3. Check disclosure ceilings and byte budgets before the request

**Problem**  Enforcing a session budget after a remote call would detect excess only after the disclosure had already left the browser.

**Alternatives considered**  Account for payloads after each response; or calculate the serialized request size and ask the session budget before dispatch.

**Decision**  The resolver checks the disclosure ceiling and estimated serialized body size before calling the remote request function. A denied request returns locally with zero network bytes recorded.

**Why**  A limit is useful as a privacy control only if it can stop the request that would exceed it.

**Trade-off**  A task can stop before completion when its next required disclosure exceeds the configured ceiling or budget. The request estimate must stay aligned with the serialization used by the HTTP client.

## 4. Send an L2 crop when one visual target is enough

**Problem**  A full viewport can include unrelated content when the task only asks about one chart, image, or visual element.

**Alternatives considered**  Send a whole viewport for every visual task; or crop to a localized target and reserve L3 for tasks needing broader visual context.

**Decision**  Use `L2` for a localized target and `L3` when the task requires wider context. The screenshot's manifest records source sensitive boxes, boxes intersecting the disclosed image, and redacted boxes. The contract requires each intersecting sensitive box to be redacted.

**Why**  This keeps the crop contract aligned with the pixels actually disclosed, including when sensitive content is outside the crop.

**Trade-off**  Crop usefulness and safety depend on target localization and sensitive-region detection. A wrong crop can make the task unsolvable, and missed detections remain a limitation.

## 5. Pause risky actions for explicit approval

**Problem**  A model suggestion should not be enough to trigger a payment, deletion, or other action the risk policy classifies as requiring confirmation.

**Alternatives considered**  Execute after model output; or stop and ask the user to approve the pending action.

**Decision**  `CONFIRM` opens an Approve/Cancel UI. Approval is sent as the literal boolean `true`; the content script validates the action again against the current page before dispatch.

**Why**  The page may have changed while the approval panel was open, and a forged truthy value should not count as user approval.

**Trade-off**  Confirmation adds a user step and interrupts unattended task execution. It also does not replace the live target and risk checks.

## 6. Treat the backend as a separate trust boundary

**Problem**  The browser client is not the only way to call the API. A direct caller can skip the extension's local privacy checks.

**Alternatives considered**  Trust the extension to send valid payloads; or repeat the relevant request checks at the API boundary.

**Decision**  The backend independently checks request size, disclosure schema, sensitive-data patterns, PNG structure, and the L2/L3 redaction manifest before passing data to the configured VLM.

**Why**  Client-side checks protect the normal extension path; server-side checks reduce the impact of a malformed or direct request.

**Trade-off**  Rules exist in more than one layer and need regression tests to prevent drift. Pattern checks and image validation still cannot prove that all sensitive content has been found.

## 7. Use SVG icons for rendered privacy labels

**Convention**  Rendered labels and badges use the SVG icon set from `design-tokens.css`; emoji are not used in UI output.

**Why**  SVG icons have consistent rendering and sizing across browsers, while emoji appearance varies by platform and can make privacy labels harder to scan.
