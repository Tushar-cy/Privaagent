// Minimum Disclosure Planner: Implements the L0-L3 ladder to select
// the least disclosing payload required to resolve the user task.

import { Disclosure, DisclosureLevel, PageState, VisualRedactionManifest } from "../common/types";
import { maskPageStateForDisclosure } from "./semantic-masker";
import { sanitizeTaskString } from "../privacy/redactor";

export interface DisclosurePlanningOptions {
  isSolvableLocally: boolean;
  requiresVision: boolean;
  targetCropTargetId?: string;
  sanitizedScreenshotBase64?: string;
  sanitizedScreenshotManifest?: VisualRedactionManifest;
  resolveLiveElement?: (targetId: string) => Element | null;
  forceLevel?: DisclosureLevel;
  taskKeywords?: string[];
  targetRoleHint?: string;
}

const L1_MAX_CANDIDATES = 8;
const L1_FALLBACK_ACTION_CANDIDATES = 3;
const TASK_STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "is", "it",
  "please", "can", "you", "me", "my", "this", "that", "into", "from", "with", "by", "as",
  "open", "click", "tap", "press", "view", "show", "expand", "select", "choose", "pick",
  "type", "enter", "input", "write", "fill", "scroll", "navigate", "goto", "visit",
]);

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function selectL1Candidates(
  task: string,
  pageState: PageState,
  options: DisclosurePlanningOptions
): PageState {
  const keywords = [...new Set((options.taskKeywords?.length ? options.taskKeywords : words(task))
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 1 && !TASK_STOPWORDS.has(word)))];

  const ranked = pageState.elements.map((element, index) => {
    const metadata = element.metadata as Record<string, unknown> | undefined;
    const selectOptionText = Array.isArray(metadata?.selectOptions)
      ? (metadata.selectOptions as Array<{ label?: string; disabled?: boolean }>)
          .filter((option) => !option.disabled)
          .map((option) => option.label || "")
          .join(" ")
      : "";
    const searchable = new Set(words([
      element.text || "",
      element.role || "",
      String(metadata?.accessibleName || ""),
      String(metadata?.tagName || ""),
      selectOptionText,
    ].join(" ")));
    const lexicalMatches = keywords.filter((keyword) => searchable.has(keyword)).length;
    const roleMatch = Boolean(options.targetRoleHint &&
      element.role.toLowerCase() === options.targetRoleHint.toLowerCase());
    const score = lexicalMatches * 4 + (roleMatch ? 2 : 0) +
      Math.max(0, Math.min(1, element.task_relevance || 0)) * 0.5 +
      Math.max(0, Math.min(1, element.confidence || 0)) * 0.1;
    return { element, index, score, lexicalMatches, roleMatch };
  });

  const matched = ranked
    .filter((candidate) => candidate.lexicalMatches > 0 || candidate.roleMatch)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, L1_MAX_CANDIDATES);

  // If the task has no useful words (for example, "continue" on a generic
  // page), send at most a few actionable candidates rather than the full DOM.
  const selected = matched.length > 0 ? matched : ranked
    .filter(({ element }) => element.interactable ||
      ["button", "link", "checkbox", "menuitem", "tab", "textbox"].includes(element.role.toLowerCase()))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, L1_FALLBACK_ACTION_CANDIDATES);

  return { ...pageState, elements: selected.map(({ element }) => element) };
}

/**
 * Plans the minimal disclosure payload required to solve the task.
 */
export function planDisclosure(
  task: string,
  pageState: PageState,
  options: DisclosurePlanningOptions
): Disclosure {
  // Explicit Force Level Handling
  if (options.forceLevel === "L0") {
    return {
      level: "L0",
      reason: "Forced L0 disclosure: strict local on-device resolution requested.",
      task: sanitizeTaskString(task),
      elements: [],
      redacted_token_count: 0,
    };
  }

  if (options.forceLevel === "L3" || (options.requiresVision && !options.targetCropTargetId && !options.forceLevel)) {
    const { disclosedElements, totalRedactedTokens } = maskPageStateForDisclosure(
      pageState,
      options.resolveLiveElement
    );

    return {
      level: "L3",
      reason: "Task requires page-wide visual context without a localized crop; transmitting a viewport screenshot with detected sensitive regions masked.",
      task: sanitizeTaskString(task),
      elements: disclosedElements,
      crop_box: undefined,
      screenshot_data: options.sanitizedScreenshotBase64,
      redacted_token_count: totalRedactedTokens,
      redaction_manifest: options.sanitizedScreenshotManifest,
    };
  }

  // L0: Local Only
  // If the local task solver can resolve the action safely, zero network transmission occurs.
  if (options.isSolvableLocally && !options.forceLevel) {
    return {
      level: "L0",
      reason: "Task is safely solvable on-device via local DOM heuristics; zero network bytes transmitted.",
      task,
      elements: [],
      redacted_token_count: 0,
    };
  }

  // L2: Sanitized Visual Crop
  // Required when task relies on non-DOM visual regions (canvas, charts, images)
  if (options.requiresVision && options.targetCropTargetId) {
    const targetElement = pageState.elements.find(
      (el) => el.target_id === options.targetCropTargetId
    );
    const cropElements = pageState.elements.filter((element) =>
      element.target_id === options.targetCropTargetId ||
      (element.metadata as any)?.derived_from === options.targetCropTargetId);

    const { disclosedElements, totalRedactedTokens } = maskPageStateForDisclosure(
      { ...pageState, elements: cropElements },
      options.resolveLiveElement
    );

    return {
      level: "L2",
      reason: `Target element "${options.targetCropTargetId}" requires visual reasoning; transmitting sanitized visual crop ROI only.`,
      task: sanitizeTaskString(task),
      elements: disclosedElements,
      crop_box: targetElement?.bbox,
      screenshot_data: options.sanitizedScreenshotBase64,
      redacted_token_count: totalRedactedTokens,
      redaction_manifest: options.sanitizedScreenshotManifest,
    };
  }

  // L3: Sanitized Full Viewport Screenshot
  // Triggered when visual reasoning is required across the page without a single localized crop ROI.
  // Transmits filtered element data plus a screenshot with detected sensitive regions masked.
  if (options.requiresVision && !options.targetCropTargetId) {
    const { disclosedElements, totalRedactedTokens } = maskPageStateForDisclosure(
      pageState,
      options.resolveLiveElement
    );

    return {
      level: "L3",
      reason: "Task requires page-wide visual context without a localized crop; transmitting a viewport screenshot with detected sensitive regions masked.",
      task: sanitizeTaskString(task),
      elements: disclosedElements,
      crop_box: undefined,
      screenshot_data: options.sanitizedScreenshotBase64,
      redacted_token_count: totalRedactedTokens,
      redaction_manifest: options.sanitizedScreenshotManifest,
    };
  }

  // L1: Structured Semantic Context
  // Solvable via text/form/table reasoning; only tokenized, anonymized metadata leaves device.
  const relevantPageState = selectL1Candidates(task, pageState, options);
  const { disclosedElements, totalRedactedTokens } = maskPageStateForDisclosure(
    relevantPageState,
    options.resolveLiveElement
  );

  return {
    level: "L1",
    reason: "Local solver requires remote reasoning over structured page data; detected sensitive spans are replaced with tokens.",
    task: sanitizeTaskString(task),
    elements: disclosedElements,
    redacted_token_count: totalRedactedTokens,
  };

}
