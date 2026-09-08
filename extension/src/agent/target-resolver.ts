// Target Resolver: High-level reasoning orchestrator deciding whether a task
// can be solved on-device (fast path) or must escalate to the remote VLM.

import { Action, Disclosure, PageState } from "../common/types";
import { planDisclosure } from "../disclosure/disclosure-planner";
import { parseTask, ParsedTask } from "./task-parser";
import { solveTaskLocally, LocalSolveResult } from "./local-solver";
import { requestRemoteAction, RemoteResolutionOptions } from "./action-planner";
import { captureAndSanitizeTab } from "./capture-tab";
import { getPerformanceProfiler } from "../common/profiler";

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
    const latencyMs = performance.now() - startTime;
    const l0Disclosure: Disclosure = {
      level: "L0",
      reason: "Task solved locally on-device with zero network transmission.",
      task: taskStr,
      elements: [],
      redacted_token_count: 0,
    };

    getPerformanceProfiler().recordStage("local_solver", latencyMs);
    getPerformanceProfiler().recordStage("e2e_task_resolution", latencyMs);
    getPerformanceProfiler().recordBandwidth(1200000, 0, 0);

    return {
      action: localResult.action,
      isLocal: true,
      disclosure: l0Disclosure,
      parsedTask,
      networkBytesSent: 0,
      latencyMs,
    };
  }

  // 2. FALLBACK PATH: Escalation through Minimum Disclosure Ladder
  const isVisualEscalation =
    (parsedTask.requiresVision ||
      options.forceEscalationLevel === "L2" ||
      options.forceEscalationLevel === "L3") &&
    options.forceEscalationLevel !== "L1";

  let targetCropId: string | undefined = undefined;
  if (isVisualEscalation && options.forceEscalationLevel !== "L3") {
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

  // Automatic on-device screenshot capture and redaction if not supplied
  let screenshotData = options.sanitizedScreenshotBase64;
  if (isVisualEscalation && !screenshotData) {
    try {
      const sensitiveBoxes = pageState.elements
        .filter((el) => el.sensitive)
        .map((el) => el.bbox);
      const targetEl = targetCropId
        ? pageState.elements.find((el) => el.target_id === targetCropId)
        : undefined;
      const cropBox = options.forceEscalationLevel === "L3" ? undefined : targetEl?.bbox;
      screenshotData = await captureAndSanitizeTab(sensitiveBoxes, cropBox);
    } catch (_) {
      // Graceful fallback if tab capture is unavailable in current context
    }
  }

  const disclosure = planDisclosure(taskStr, pageState, {
    isSolvableLocally: false,
    requiresVision: isVisualEscalation,
    targetCropTargetId: options.forceEscalationLevel === "L3" ? undefined : targetCropId,
    sanitizedScreenshotBase64: screenshotData,
    resolveLiveElement: options.resolveLiveElement,
    forceLevel: options.forceEscalationLevel,
  });


  // Calculate outbound payload size
  const outboundBytes = JSON.stringify(disclosure).length;

  // Dispatch sanitized payload across the HTTPS boundary
  const remoteStart = performance.now();
  const remoteAction = await requestRemoteAction(disclosure, options);
  const remoteLatency = performance.now() - remoteStart;
  const totalLatency = performance.now() - startTime;

  getPerformanceProfiler().recordStage("vlm_network_call", remoteLatency);
  getPerformanceProfiler().recordStage("e2e_task_resolution", totalLatency);
  getPerformanceProfiler().recordBandwidth(1200000, outboundBytes, disclosure.redacted_token_count || 0);

  return {
    action: remoteAction,
    isLocal: false,
    disclosure,
    parsedTask,
    networkBytesSent: outboundBytes,
    latencyMs: totalLatency,
  };
}
