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

/**
 * Computes semantic relevance score between a task and a candidate DOM element.
 */
function scoreElementMatch(el: PageElement, task: ParsedTask): number {
  if (!el.text && !el.target_id) return 0;

  const elTextLower = (el.text || "").toLowerCase();
  const elIdLower = el.target_id.toLowerCase();
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
    if (elTextLower.includes(kw) || elIdLower.includes(kw)) {
      matchedKeywords++;
    }
  }

  if (task.keywords.length > 0) {
    const keywordRatio = matchedKeywords / task.keywords.length;
    score += keywordRatio * 0.45;
  }

  // 3. Role affinity
  if (task.actionType === "click") {
    if (el.role === "button" || el.role === "link") {
      score += 0.15;
    }
  } else if (task.actionType === "type") {
    if (el.role === "textbox" || el.role === "input") {
      score += 0.2;
    }
  }

  // 4. Boost for interactable elements
  if (el.interactable) {
    score += 0.05;
  }

  // 5. If task explicitly requires vision and element is plain DOM, penalize
  if (task.requiresVision && !el.sources.includes("vision") && !el.sources.includes("ocr")) {
    score *= 0.4;
  }

  return Math.min(1.0, score);
}

/**
 * Attempts to solve a task locally using on-device PageState data.
 */
export function solveTaskLocally(pageState: PageState, task: ParsedTask): LocalSolveResult {
  let bestScore = 0;
  let bestCandidate: PageElement | null = null;

  for (const element of pageState.elements) {
    const score = scoreElementMatch(element, task);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = element;
    }
  }

  // High-confidence local threshold
  const SOLVE_THRESHOLD = 0.75;

  if (bestScore >= SOLVE_THRESHOLD && bestCandidate) {
    const localAction: Action = {
      action: task.actionType,
      target_id: bestCandidate.target_id,
      value: task.typeValue,
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
