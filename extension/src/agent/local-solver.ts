// Zero-Network Local Task Solver: Resolves standard DOM tasks entirely on-device
// without sending any data over the network (0 network bytes, 0 latency overhead).

import { Action, PageElement, PageState } from "../common/types";
import { ParsedTask } from "./task-parser";

export interface LocalSolveResult {
  action: Action | null;
  confidence: number;
  candidateElement?: PageElement;
  networkCallsMade: number; // Always 0 for local solver
}

interface SelectOptionRecord {
  label?: string;
  value?: string;
  disabled?: boolean;
}

function matchingSelectOption(el: PageElement, task: ParsedTask): SelectOptionRecord | null {
  if (task.actionType !== "select" || !task.typeValue) return null;
  const metadata = el.metadata as Record<string, unknown> | undefined;
  const options = Array.isArray(metadata?.selectOptions)
    ? metadata.selectOptions as SelectOptionRecord[]
    : [];
  const wanted = task.typeValue.trim().toLowerCase();
  const matches = options.filter((option) => !option.disabled &&
    [option.label, option.value].some((candidate) =>
      typeof candidate === "string" && candidate.trim().toLowerCase() === wanted));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Computes semantic relevance score between a task and a candidate DOM element.
 */
function scoreElementMatch(el: PageElement, task: ParsedTask, pageState?: PageState): number {
  const metadata = el.metadata as Record<string, unknown> | undefined;
  const accessibleName = String(metadata?.accessibleName || "");
  if (!el.text && !accessibleName) return 0;

  const tagName = String(metadata?.tagName || "").toLowerCase();
  const disabled = metadata?.disabled === true;
  const readOnly = metadata?.readOnly === true;
  const role = el.role.toLowerCase();
  const optionMatch = matchingSelectOption(el, task);
  const compatible = task.actionType === "click"
    ? !disabled && (el.interactable === true || ["button", "link", "checkbox", "menuitem", "tab", "canvas", "img"].includes(role))
    : task.actionType === "type"
      ? !disabled && !readOnly && (["textbox", "searchbox", "input"].includes(role) || ["input", "textarea"].includes(tagName))
      : task.actionType === "select"
        ? !disabled && tagName === "select" && optionMatch !== null
        : task.actionType === "scroll"
          ? true
          : false;
  if (!compatible) return 0;

  const optionLabels = Array.isArray(metadata?.selectOptions)
    ? (metadata.selectOptions as SelectOptionRecord[]).map((option) => option.label || "").join(" ")
    : "";
  const elTextLower = [el.text || "", accessibleName, optionLabels].join(" ").toLowerCase();
  const taskRawLower = task.raw.toLowerCase();

  let score = 0;

  // 1. Direct text inclusion
  if (elTextLower.length > 0 && taskRawLower.includes(elTextLower)) {
    score += 0.5;
  }
  if (elTextLower.length > 0 && elTextLower.includes(task.raw.toLowerCase())) {
    score += 0.6;
  }
  // 2. Keyword overlap
  let matchedKeywords = 0;
  for (const kw of task.keywords) {
    if (elTextLower.includes(kw)) {
      matchedKeywords++;
    }
  }

  if (task.keywords.length > 0) {
    const keywordRatio = matchedKeywords / task.keywords.length;
    score += keywordRatio * 0.45;
    if (keywordRatio === 1.0) {
      score += 0.05; // Full keyword match bonus
    }
  }

  // 3. Role affinity
  if (task.actionType === "click") {
    if (el.role === "button" || el.role === "link") {
      score += 0.20;
    }
  } else if (task.actionType === "type") {
    if (el.role === "textbox" || el.role === "input") {
      score += 0.25;
    }
  } else if (task.actionType === "select" && optionMatch) {
    score += 0.75;
  }

  // 4. Boost for interactable elements
  if (el.interactable) {
    score += 0.05;
  }

  // 5. If task explicitly requires vision and element is plain DOM, penalize
  if (task.requiresVision && !el.sources.includes("vision") && !el.sources.includes("ocr")) {
    score *= 0.4;
  }

  // 6. Spatial proximity heuristic (below, under, above)
  if (pageState && el.bbox) {
    const rawLower = task.raw.toLowerCase();
    const spatialMatch = rawLower.match(/\b(below|under|above|near)\s+([a-zA-Z0-9_\-\s]+)/i);
    if (spatialMatch) {
      const relation = spatialMatch[1].toLowerCase();
      const anchorKw = spatialMatch[2].trim().toLowerCase();

      const anchorEl = pageState.elements.find(
        (a) =>
          a.target_id !== el.target_id &&
          ((a.text && a.text.toLowerCase().includes(anchorKw)) ||
            String((a.metadata as Record<string, unknown> | undefined)?.accessibleName || "").toLowerCase().includes(anchorKw))
      );

      if (anchorEl && anchorEl.bbox) {
        const [, anchorY, , anchorH] = anchorEl.bbox;
        const [, elY] = el.bbox;
        if ((relation === "below" || relation === "under") && elY >= anchorY) {
          score += 0.25;
        } else if (relation === "above" && elY <= anchorY) {
          score += 0.25;
        }
      }
    }
  }

  return Math.min(1.0, score);
}

/**
 * Attempts to solve a task locally using on-device PageState data.
 */
export function solveTaskLocally(pageState: PageState, task: ParsedTask): LocalSolveResult {
  const ranked: Array<{ element: PageElement; score: number }> = [];
  let bestCandidate: PageElement | null = null;
  let bestScore = 0;

  for (const element of pageState.elements) {
    const score = scoreElementMatch(element, task, pageState);
    if (score > 0) ranked.push({ element, score });
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = element;
    }
  }

  ranked.sort((a, b) => b.score - a.score);

  // High-confidence local threshold
  const SOLVE_THRESHOLD = 0.75;
  // Heuristic overlap scores are not probabilities. Require a clear lead over
  // the runner-up before taking an autonomous action.
  const MINIMUM_SCORE_MARGIN = 0.15;
  const secondBestScore = ranked[1]?.score ?? 0;

  if (bestScore >= SOLVE_THRESHOLD && bestCandidate &&
      bestScore - secondBestScore >= MINIMUM_SCORE_MARGIN) {
    const localAction: Action = {
      action: task.actionType,
      target_id: bestCandidate.target_id,
      value: task.actionType === "select"
        ? matchingSelectOption(bestCandidate, task)?.value
        : task.typeValue,
      reason: `Directly resolved on-device: element "${bestCandidate.target_id}" matches task keywords [${task.keywords.join(", ")}] with ${(bestScore * 100).toFixed(0)}% confidence.`,
      confidence: bestScore,
    };

    return {
      action: localAction,
      confidence: bestScore,
      candidateElement: bestCandidate,
      networkCallsMade: 0,
    };
  }

  return {
    action: null,
    confidence: bestScore,
    candidateElement: bestCandidate || undefined,
    networkCallsMade: 0,
  };
}
