// Target Resolver: High-level reasoning orchestrator deciding whether a task
// can be solved on-device (fast path) or must escalate to the remote VLM.

import { Action, Disclosure, PageState } from "../common/types";
import { planDisclosure } from "../disclosure/disclosure-planner";
import { parseTask, ParsedTask } from "./task-parser";
import { solveTaskLocally, LocalSolveResult } from "./local-solver";
import { requestRemoteAction, RemoteResolutionOptions } from "./action-planner";

export interface AgentResolutionResult {
  action: Action;
  isLocal: boolean;
  disclosure: Disclosure;
  parsedTask: ParsedTask;
  networkBytesSent: number;
  latencyMs: number;
}

export interface ResolverOptions extends RemoteResolutionOptions {
  forceEscalationLevel?: "L0" | "L1" | "L2" | "L3";
  sanitizedScreenshotBase64?: string;
  resolveLiveElement?: (targetId: string) => Element | null;
}

/**
 * Resolves a natural-language task into a validated browser Action.
 */
export async function resolveTaskAction(
  taskStr: string,
  pageState: PageState,
  options: ResolverOptions = {}
): Promise<AgentResolutionResult> {
  const startTime = performance.now();
  const parsedTask = parseTask(taskStr);

  // 1. FAST PATH: Attempt on-device local solving
  const localResult: LocalSolveResult = solveTaskLocally(pageState, parsedTask);

  if (localResult.action && !options.forceEscalationLevel && !parsedTask.requiresVision) {
    const l0Disclosure: Disclosure = {
      level: "L0",
      reason: "Task solved locally on-device with zero network transmission.",
      task: taskStr,
      elements: [],
      redacted_token_count: 0,
    };

    return {
      action: localResult.action,
      isLocal: true,
      disclosure: l0Disclosure,
      parsedTask,
      networkBytesSent: 0,
      latencyMs: performance.now() - startTime,
    };
  }

  // 2. FALLBACK PATH: Escalation through Minimum Disclosure Ladder
  let targetCropId: string | undefined = undefined;
  if (parsedTask.requiresVision) {
    const matchingEl = pageState.elements.find((el) => {
      const matchesRole = Boolean(parsedTask.targetRoleHint && el.role === parsedTask.targetRoleHint);
      const matchesKw = parsedTask.keywords.some(
        (kw) =>
          el.target_id.toLowerCase().includes(kw) ||
          (el.text && el.text.toLowerCase().includes(kw))
      );
      const isVisualRole =
        el.role === "canvas" ||
        el.role === "img" ||
        el.role === "chart_bar" ||
        el.sources.includes("vision");
      return (matchesRole || matchesKw) && isVisualRole;
    });

    if (matchingEl) {
      targetCropId =
        ((matchingEl.metadata as Record<string, unknown> | undefined)?.derived_from as string) ||
        matchingEl.target_id;
    } else {
      targetCropId = pageState.elements.find(
        (el) => el.role === "canvas" || el.role === "img"
      )?.target_id;
    }
  }

  const disclosure = planDisclosure(taskStr, pageState, {
    isSolvableLocally: false,
    requiresVision: parsedTask.requiresVision,
    targetCropTargetId: targetCropId,
    sanitizedScreenshotBase64: options.sanitizedScreenshotBase64,
    resolveLiveElement: options.resolveLiveElement,
  });

  // Calculate outbound payload size
  const outboundBytes = JSON.stringify(disclosure).length;

  // Dispatch sanitized payload across the HTTPS boundary
  const remoteAction = await requestRemoteAction(disclosure, options);

  return {
    action: remoteAction,
    isLocal: false,
    disclosure,
    parsedTask,
    networkBytesSent: outboundBytes,
    latencyMs: performance.now() - startTime,
  };
}
