// Target Resolver: Two-Layer Privacy-First AI Architecture Orchestrator
//
// LAYER 1: On-Device Local Processing (Zero Network, WASM/DOM Semantic Engine)
//   - Solves text/semantic tasks directly in-browser in < 2ms without network calls.
//   - Conditions when insufficient: requiresVision=true, low confidence (<0.75), canvas/charts.
//
// LAYER 2: Sanitized VLM Fallback Pipeline
//   - Triggered ONLY when local processing is insufficient.
//   - Pipeline: Raw Data -> Local Extraction -> PII Detection -> Sanitization ([EMAIL_1], [PHONE_1])
//     -> In-Browser Mapping Isolation -> Pre-Flight Privacy Audit -> Outbound VLM Request.
//   - Pre-flight privacy check strictly BLOCKS request if any unredacted PII remains.

import { Action, Disclosure, PageState } from "../common/types";
import { planDisclosure } from "../disclosure/disclosure-planner";
import { parseTask, ParsedTask } from "./task-parser";
import { solveTaskLocally, LocalSolveResult } from "./local-solver";
import { requestRemoteAction, RemoteResolutionOptions } from "./action-planner";
import { captureAndSanitizeTab } from "./capture-tab";
import { getPerformanceProfiler } from "../common/profiler";
import { verifyOutgoingDisclosure, PrivacyGuardResult } from "../privacy/privacy-guard";

export type ProcessingPath = "LOCAL" | "SANITIZED_VLM" | "BLOCKED";

export interface AgentResolutionResult {
  action: Action;
  processingPath: ProcessingPath;
  modelUsed: string;
  executionBackend: string;
  localLatencyMs: number;
  sanitizationLatencyMs: number;
  vlmLatencyMs: number;
  totalLatencyMs: number;
  latencyMs: number;
  isLocal: boolean;
  disclosure: Disclosure;
  parsedTask: ParsedTask;
  networkBytesSent: number;
  detectedEntities: Array<{ type: string; placeholder: string }>;
  privacyVerificationPassed: boolean;
  externalRequestMade: boolean;
  blockReason?: string;
}

export interface ResolverOptions extends RemoteResolutionOptions {
  forceEscalationLevel?: "L0" | "L1" | "L2" | "L3";
  sanitizedScreenshotBase64?: string;
  resolveLiveElement?: (targetId: string) => Element | null;
  simulateUnsafeSanitization?: boolean; // For testing/demonstrating BLOCKED state in SIH demo
}

/**
 * Resolves a natural-language task into a validated browser Action using the
 * Two-Layer Privacy-First AI Architecture.
 */
export async function resolveTaskAction(
  taskStr: string,
  pageState: PageState,
  options: ResolverOptions = {}
): Promise<AgentResolutionResult> {
  const overallStartTime = performance.now();
  const parsedTask = parseTask(taskStr);

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 1: On-Device Local Processing (WASM / DOM Semantic Engine)
  // ══════════════════════════════════════════════════════════════════════════
  const localStart = performance.now();
  const localResult: LocalSolveResult = solveTaskLocally(pageState, parsedTask);
  const localLatencyMs = Number((performance.now() - localStart).toFixed(2));

  // Determine if Layer 1 is sufficient:
  // - Must not explicitly require computer vision (canvas charts, raster graphics)
  // - Local confidence must meet or exceed threshold (>= 0.75)
  // - No forced visual escalation requested
  const isLocalSufficient =
    Boolean(localResult.action) &&
    localResult.confidence >= 0.75 &&
    !parsedTask.requiresVision &&
    !options.forceEscalationLevel;

  if (isLocalSufficient && localResult.action) {
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));

    const l0Disclosure: Disclosure = {
      level: "L0",
      reason: `Task resolved locally on-device by Layer 1 (confidence: ${(localResult.confidence * 100).toFixed(0)}%). Zero network transmission.`,
      task: taskStr,
      elements: [],
      redacted_token_count: 0,
    };

    getPerformanceProfiler().recordStage("local_solver", localLatencyMs);
    getPerformanceProfiler().recordStage("e2e_task_resolution", totalLatencyMs);
    getPerformanceProfiler().recordBandwidth(1200000, 0, 0);

    return {
      action: localResult.action,
      processingPath: "LOCAL",
      modelUsed: "PrivaAgent Local Intent Engine (On-Device WASM)",
      executionBackend: "Browser CPU / Local DOM (Zero Network)",
      localLatencyMs,
      sanitizationLatencyMs: 0,
      vlmLatencyMs: 0,
      totalLatencyMs,
      latencyMs: totalLatencyMs,
      isLocal: true,
      disclosure: l0Disclosure,
      parsedTask,
      networkBytesSent: 0,
      detectedEntities: [],
      privacyVerificationPassed: true,
      externalRequestMade: false,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 2: VLM Fallback Pipeline
  // Triggered when local processing is insufficient (visual content, low confidence, etc.)
  // ══════════════════════════════════════════════════════════════════════════
  const sanitizationStart = performance.now();

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

  // Step 1: On-device screenshot capture & pixel redaction (burns opaque blackouts onto canvas)
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

  // Step 2: Minimum disclosure planning & placeholder tokenization ([EMAIL_1], [PHONE_1])
  const disclosure = planDisclosure(taskStr, pageState, {
    isSolvableLocally: false,
    requiresVision: isVisualEscalation,
    targetCropTargetId: options.forceEscalationLevel === "L3" ? undefined : targetCropId,
    sanitizedScreenshotBase64: screenshotData,
    resolveLiveElement: options.resolveLiveElement,
    forceLevel: options.forceEscalationLevel,
  });

  // Collect all detected sanitized placeholders
  const detectedEntities: Array<{ type: string; placeholder: string }> = [];
  for (const el of disclosure.elements) {
    const tokenMatch = el.label.match(/\[([A-Z_]+)_[0-9]+\]/);
    if (tokenMatch) {
      detectedEntities.push({
        type: tokenMatch[1],
        placeholder: tokenMatch[0],
      });
    }
  }

  // For testing/demonstrating BLOCKED state in SIH jury demo:
  if (options.simulateUnsafeSanitization) {
    // Deliberately inject raw PII to demonstrate pre-flight guard blocking the request
    disclosure.elements.push({
      target_id: "leak-simulation",
      role: "text",
      label: "Customer raw SSN/PAN: ABCDE1234F and email: test.leak@internal.gov",
    });
  }

  // Step 3: Pre-Flight Privacy Audit Verification
  // Scans the final outgoing payload. If ANY unredacted PII is found, STRICTLY BLOCK!
  const privacyAudit: PrivacyGuardResult = verifyOutgoingDisclosure(disclosure);
  const sanitizationLatencyMs = Number((performance.now() - sanitizationStart).toFixed(2));

  if (!privacyAudit.passed) {
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));
    const blockReason = privacyAudit.blockedReason || "Pre-flight privacy verification failed: unredacted sensitive data detected.";

    return {
      action: {
        action: "click",
        target_id: "none",
        reason: blockReason,
        confidence: 0.0,
      },
      processingPath: "BLOCKED",
      modelUsed: "PrivaAgent Privacy Guard (On-Device Sentry)",
      executionBackend: "On-Device Security Kernel (Blocked Outbound Request)",
      localLatencyMs,
      sanitizationLatencyMs,
      vlmLatencyMs: 0,
      totalLatencyMs,
      latencyMs: totalLatencyMs,
      isLocal: true,
      disclosure,
      parsedTask,
      networkBytesSent: 0,
      detectedEntities,
      privacyVerificationPassed: false,
      externalRequestMade: false,
      blockReason,
    };
  }

  // Step 4: Outbound Network Request to VLM with Sanitized Payload
  const outboundBytes = JSON.stringify(disclosure).length;
  const vlmStart = performance.now();

  try {
    const remoteAction = await requestRemoteAction(disclosure, options);
    const vlmLatencyMs = Number((performance.now() - vlmStart).toFixed(2));
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));

    getPerformanceProfiler().recordStage("vlm_network_call", vlmLatencyMs);
    getPerformanceProfiler().recordStage("e2e_task_resolution", totalLatencyMs);
    getPerformanceProfiler().recordBandwidth(1200000, outboundBytes, disclosure.redacted_token_count || 0);

    return {
      action: remoteAction,
      processingPath: "SANITIZED_VLM",
      modelUsed: remoteAction.model_used || "Open-Weight VLM Fallback",
      executionBackend: remoteAction.execution_backend || options.serverBaseUrl || "HTTP REST (http://127.0.0.1:8000)",
      localLatencyMs,
      sanitizationLatencyMs,
      vlmLatencyMs,
      totalLatencyMs,
      latencyMs: totalLatencyMs,
      isLocal: false,
      disclosure,
      parsedTask,
      networkBytesSent: outboundBytes,
      detectedEntities,
      privacyVerificationPassed: true,
      externalRequestMade: true,
    };
  } catch (err: any) {
    const vlmLatencyMs = Number((performance.now() - vlmStart).toFixed(2));
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));
    const errorMessage = err?.message || String(err);

    return {
      action: {
        action: "click",
        target_id: "none",
        reason: `VLM fallback request failed: ${errorMessage}`,
        confidence: 0.0,
      },
      processingPath: "SANITIZED_VLM",
      modelUsed: "VLM Gateway Connection Attempt",
      executionBackend: options.serverBaseUrl || "http://127.0.0.1:8000",
      localLatencyMs,
      sanitizationLatencyMs,
      vlmLatencyMs,
      totalLatencyMs,
      latencyMs: totalLatencyMs,
      isLocal: false,
      disclosure,
      parsedTask,
      networkBytesSent: outboundBytes,
      detectedEntities,
      privacyVerificationPassed: true,
      externalRequestMade: true,
      blockReason: `VLM Network Error: ${errorMessage}`,
    };
  }
}
