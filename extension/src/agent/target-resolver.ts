// Target Resolver: Two-Layer Privacy-First AI Architecture Orchestrator
//
// LAYER 1: On-Device Local Processing (Zero Network, WASM/DOM Semantic Engine)
//   - Tries clear text/semantic tasks directly in-browser without a network call.
//   - Conditions when insufficient: requiresVision=true, low confidence (<0.75), canvas/charts.
//
// LAYER 2: Sanitized VLM Fallback Pipeline
//   - Triggered ONLY when local processing is insufficient.
//   - Pipeline: Raw Data -> Local Extraction -> PII Detection -> Sanitization ([EMAIL_1], [PHONE_1])
//     -> In-Browser Mapping Isolation -> Pre-Flight Privacy Audit -> Outbound VLM Request.
//   - Pre-flight privacy check strictly BLOCKS request if any unredacted PII remains.

import { Action, Disclosure, DisclosureLevel, PageState, VisualRedactionManifest } from "../common/types";
import { planDisclosure } from "../disclosure/disclosure-planner";
import { parseTask, ParsedTask } from "./task-parser";
import { solveTaskLocally, LocalSolveResult } from "./local-solver";
import { buildResolverEndpoint, requestRemoteAction, RemoteResolutionOptions } from "./action-planner";
import { captureAndSanitizeTab } from "./capture-tab";
import { getPerformanceProfiler } from "../common/profiler";
import { verifyOutgoingDisclosure, PrivacyGuardResult } from "../privacy/privacy-guard";
import { locateLiveElement } from "../validator/action-validator";
import { inspectElementForHiddenInjection } from "../validator/prompt-injection";
import { extractPageState, hasPerceivedNodeBinding, resolvePerceivedElement } from "../semantic/dom-extractor";

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
  budgetExceeded?: boolean;
  ceilingExceeded?: boolean;
  blockReason?: string;
}

export interface ResolverOptions extends RemoteResolutionOptions {
  forceEscalationLevel?: "L0" | "L1" | "L2" | "L3";
  maxDisclosureLevel?: DisclosureLevel;
  beforeRemoteRequest?: (disclosure: Disclosure, outboundBytes: number) => boolean;
  sanitizedScreenshotBase64?: string;
  sanitizedScreenshotManifest?: VisualRedactionManifest;
  resolveLiveElement?: (targetId: string) => Element | null;
  simulateUnsafeSanitization?: boolean; // For testing/demonstrating BLOCKED state in SIH demo
}

function perceptionStillMatchesLiveDom(snapshot: PageState): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return true;
  const boundElements = snapshot.elements.filter((element) =>
    typeof element.metadata?.derived_from !== "string" &&
    hasPerceivedNodeBinding(element));
  if (boundElements.length === 0) return true;

  const liveState = extractPageState().pageState;
  if (snapshot.url !== liveState.url || boundElements.length !== liveState.elements.length) return false;
  const liveById = new Map(liveState.elements.map((element) => [element.target_id, element]));
  return boundElements.every((before) => {
    const current = liveById.get(before.target_id);
    if (!current || before.role !== current.role || before.text !== current.text) return false;
    const beforeNode = resolvePerceivedElement(before);
    if (!beforeNode || beforeNode !== resolvePerceivedElement(current)) return false;
    if (before.bbox && current.bbox && before.bbox.some((value, index) => value !== current.bbox![index])) return false;
    const beforeMeta = before.metadata as Record<string, unknown> | undefined;
    const currentMeta = current.metadata as Record<string, unknown> | undefined;
    const sameSemantics = beforeMeta?.tagName === currentMeta?.tagName &&
      beforeMeta?.ariaRole === currentMeta?.ariaRole &&
      beforeMeta?.accessibleName === currentMeta?.accessibleName &&
      beforeMeta?.disabled === currentMeta?.disabled && beforeMeta?.readOnly === currentMeta?.readOnly;
    if (!sameSemantics) return false;
    return String(beforeMeta?.tagName).toLowerCase() !== "select" ||
      JSON.stringify(beforeMeta?.selectOptions || []) === JSON.stringify(currentMeta?.selectOptions || []);
  });
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
  // PRE-FLIGHT: Prompt Injection Scan over candidate elements
  // ══════════════════════════════════════════════════════════════════════════
  if (typeof window !== "undefined" && window.document) {
    const doc = window.document;
    for (const el of pageState.elements) {
      const liveEl = options.resolveLiveElement
        ? options.resolveLiveElement(el.target_id)
        : locateLiveElement(el.target_id, doc, pageState);
      if (liveEl) {
        const injectionCheck = inspectElementForHiddenInjection(liveEl);
        if (injectionCheck.isInjection) {
          const l0Disclosure: Disclosure = {
            level: "L1",
            reason: `Task BLOCKED globally due to prompt injection in candidate element ${el.target_id}: ${injectionCheck.reason}`,
            task: taskStr,
            elements: [],
            redacted_token_count: 0,
          };
          return {
            action: { action: "click", target_id: "none", reason: injectionCheck.reason || "Prompt injection detected", confidence: 0.0 },
            processingPath: "BLOCKED",
            modelUsed: "Pre-Flight Injection Scanner",
            executionBackend: "Local DOM",
            localLatencyMs: 0,
            sanitizationLatencyMs: 0,
            vlmLatencyMs: 0,
            totalLatencyMs: Number((performance.now() - overallStartTime).toFixed(2)),
            latencyMs: Number((performance.now() - overallStartTime).toFixed(2)),
            isLocal: true,
            disclosure: l0Disclosure,
            parsedTask,
            networkBytesSent: 0,
            detectedEntities: [],
            privacyVerificationPassed: false,
            externalRequestMade: false,
            blockReason: `Global pre-execution validation BLOCKED: ${injectionCheck.reason}`,
          };
        }
      }
    }
  }

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
    (!options.forceEscalationLevel || options.forceEscalationLevel === "L0");

  // L0 is a hard zero-network policy, not an escalation request. If the local
  // solver cannot resolve the task without vision, stop here instead of falling
  // through to the remote fallback with an L0 disclosure.
  if (options.forceEscalationLevel === "L0" && !isLocalSufficient) {
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));
    const disclosure: Disclosure = {
      level: "L0",
      reason: "Forced L0 cannot be resolved safely by the local solver. Remote disclosure is prohibited.",
      task: "",
      elements: [],
      redacted_token_count: 0,
    };
    return {
      action: { action: parsedTask.actionType, target_id: "none", reason: disclosure.reason, confidence: 0 },
      processingPath: "BLOCKED",
      modelUsed: "PrivaAgent L0 Local-Only Gate",
      executionBackend: "Local policy gate (zero network)",
      localLatencyMs,
      sanitizationLatencyMs: 0,
      vlmLatencyMs: 0,
      totalLatencyMs,
      latencyMs: totalLatencyMs,
      isLocal: true,
      disclosure,
      parsedTask,
      networkBytesSent: 0,
      detectedEntities: [],
      privacyVerificationPassed: true,
      externalRequestMade: false,
      blockReason: disclosure.reason,
    };
  }

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

  const requiredDisclosureLevel: DisclosureLevel = isVisualEscalation
    ? (options.forceEscalationLevel === "L3" || !targetCropId ? "L3" : "L2")
    : "L1";
  const freshnessBlockReason = "Page content changed while preparing the disclosure. Refresh perception and retry; no request was sent.";
  const freshnessBlockedResult = (
    disclosure: Disclosure,
    detectedEntities: Array<{ type: string; placeholder: string }> = [],
    sanitizationLatencyMs = Number((performance.now() - sanitizationStart).toFixed(2)),
  ): AgentResolutionResult => {
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));
    return {
      action: { action: parsedTask.actionType, target_id: "none", reason: freshnessBlockReason, confidence: 0 },
      processingPath: "BLOCKED",
      modelUsed: "PrivaAgent Freshness Gate",
      executionBackend: "Local privacy check (request not sent)",
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
      privacyVerificationPassed: true,
      externalRequestMade: false,
      blockReason: freshnessBlockReason,
    };
  };
  const disclosureOrder: Record<DisclosureLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };
  const disclosureCeiling = options.maxDisclosureLevel ?? "L2";
  if (disclosureOrder[requiredDisclosureLevel] > disclosureOrder[disclosureCeiling]) {
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));
    const blockReason = `Disclosure ceiling exceeded: request requires ${requiredDisclosureLevel}, maximum allowed is ${disclosureCeiling}. No request was sent.`;
    const disclosure: Disclosure = {
      level: requiredDisclosureLevel,
      reason: blockReason,
      task: "",
      elements: [],
      redacted_token_count: 0,
    };
    return {
      action: { action: parsedTask.actionType, target_id: "none", reason: blockReason, confidence: 0 },
      processingPath: "BLOCKED",
      modelUsed: "PrivaAgent Outbound Policy Gate",
      executionBackend: "Local privacy check (request not sent)",
      localLatencyMs,
      sanitizationLatencyMs: 0,
      vlmLatencyMs: 0,
      totalLatencyMs,
      latencyMs: totalLatencyMs,
      isLocal: true,
      disclosure,
      parsedTask,
      networkBytesSent: 0,
      detectedEntities: [],
      privacyVerificationPassed: true,
      externalRequestMade: false,
      ceilingExceeded: true,
      blockReason,
    };
  }

  try {
    buildResolverEndpoint(options.serverBaseUrl || "http://127.0.0.1:8000");
  } catch (error: unknown) {
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));
    const blockReason = error instanceof Error ? error.message : "Remote resolver URL is not permitted.";
    const disclosure: Disclosure = {
      level: requiredDisclosureLevel,
      reason: blockReason,
      task: "",
      elements: [],
      redacted_token_count: 0,
    };
    return {
      action: { action: parsedTask.actionType, target_id: "none", reason: blockReason, confidence: 0 },
      processingPath: "BLOCKED",
      modelUsed: "PrivaAgent Transport Policy Gate",
      executionBackend: "Local privacy check (request not sent)",
      localLatencyMs,
      sanitizationLatencyMs: 0,
      vlmLatencyMs: 0,
      totalLatencyMs,
      latencyMs: totalLatencyMs,
      isLocal: true,
      disclosure,
      parsedTask,
      networkBytesSent: 0,
      detectedEntities: [],
      privacyVerificationPassed: true,
      externalRequestMade: false,
      blockReason,
    };
  }

  // Fail before expensive capture or sanitization if perception is already stale.
  if (!perceptionStillMatchesLiveDom(pageState)) {
    const disclosure: Disclosure = {
      level: requiredDisclosureLevel,
      reason: freshnessBlockReason,
      task: "",
      elements: [],
      redacted_token_count: 0,
    };
    return freshnessBlockedResult(disclosure, [], 0);
  }

  // Step 1: On-device screenshot capture & pixel redaction (burns opaque blackouts onto canvas)
  let screenshotData = options.sanitizedScreenshotBase64;
  let screenshotManifest = options.sanitizedScreenshotManifest;
  if (isVisualEscalation && !screenshotData) {
    try {
      const targetEl = targetCropId
        ? pageState.elements.find((el) => el.target_id === targetCropId)
        : undefined;
      const cropBox = options.forceEscalationLevel === "L3" ? undefined : targetEl?.bbox;
      const captureResult = await captureAndSanitizeTab(pageState, cropBox);
      // captureResult is CaptureAndSanitizeResult { dataUrl?, manifest? }
      screenshotData = captureResult.dataUrl;
      screenshotManifest = captureResult.manifest;
    } catch (_) {
      // Graceful fallback if tab capture is unavailable in current context
    }
  }

  // Visual payloads are valid only as a sanitized image plus the manifest for
  // that exact image. Capture, decoding, or analysis failures must stop locally.
  if (isVisualEscalation && (!screenshotData || !screenshotManifest)) {
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));
    const blockReason = "Visual capture or sanitization did not produce a complete screenshot and redaction manifest. No request was sent.";
    const disclosure: Disclosure = {
      level: options.forceEscalationLevel === "L3" || !targetCropId ? "L3" : "L2",
      reason: blockReason,
      task: "",
      elements: [],
      redacted_token_count: 0,
    };
    return {
      action: { action: parsedTask.actionType, target_id: "none", reason: blockReason, confidence: 0 },
      processingPath: "BLOCKED",
      modelUsed: "PrivaAgent Visual Disclosure Gate",
      executionBackend: "Local privacy check (visual request not sent)",
      localLatencyMs,
      sanitizationLatencyMs: Number((performance.now() - sanitizationStart).toFixed(2)),
      vlmLatencyMs: 0,
      totalLatencyMs,
      latencyMs: totalLatencyMs,
      isLocal: true,
      disclosure,
      parsedTask,
      networkBytesSent: 0,
      detectedEntities: [],
      privacyVerificationPassed: true,
      externalRequestMade: false,
      blockReason,
    };
  }


  // Step 2: Minimum disclosure planning & placeholder tokenization ([EMAIL_1], [PHONE_1])
  const disclosure = planDisclosure(taskStr, pageState, {
    isSolvableLocally: false,
    requiresVision: isVisualEscalation,
    targetCropTargetId: options.forceEscalationLevel === "L3" ? undefined : targetCropId,
    sanitizedScreenshotBase64: screenshotData,
    sanitizedScreenshotManifest: screenshotManifest,
    resolveLiveElement: options.resolveLiveElement,
    forceLevel: options.forceEscalationLevel,
    taskKeywords: parsedTask.keywords,
    targetRoleHint: parsedTask.targetRoleHint,
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
      executionBackend: "Local privacy check (request blocked)",
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

  // Step 4: Enforce all outbound policy before the first network request.
  const serializedDisclosure = JSON.stringify(disclosure);
  const outboundBytes = new TextEncoder().encode(serializedDisclosure).byteLength;
  const levelOrder: Record<DisclosureLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };
  const configuredCeiling = options.maxDisclosureLevel ?? "L2";
  const ceilingRank = levelOrder[configuredCeiling] ?? levelOrder.L0;
  const exceedsCeiling = Boolean(
    levelOrder[disclosure.level] > ceilingRank
  );
  const budgetAllowsRequest = !options.beforeRemoteRequest || options.beforeRemoteRequest(disclosure, outboundBytes);

  if (exceedsCeiling || !budgetAllowsRequest) {
    const budgetExceeded = !exceedsCeiling && !budgetAllowsRequest;
    const blockReason = exceedsCeiling
      ? `Disclosure ceiling exceeded: request requires ${disclosure.level}, maximum allowed is ${configuredCeiling}. Request was not sent.`
      : "Session privacy budget would be exceeded by this disclosure. Request was not sent.";
    const totalLatencyMs = Number((performance.now() - overallStartTime).toFixed(2));
    return {
      action: { action: "click", target_id: "none", reason: blockReason, confidence: 0 },
      processingPath: "BLOCKED",
      modelUsed: "PrivaAgent Outbound Policy Gate",
      executionBackend: "Local privacy check (request not sent)",
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
      privacyVerificationPassed: true,
      externalRequestMade: false,
      budgetExceeded,
      ceilingExceeded: exceedsCeiling,
      blockReason,
    };
  }

  // Capture, OCR, disclosure planning, and policy checks can yield or take time.
  // Revalidate at the final outbound boundary so none of those steps can send
  // a disclosure built from an outdated page snapshot.
  if (!perceptionStillMatchesLiveDom(pageState)) {
    return freshnessBlockedResult(disclosure, detectedEntities, sanitizationLatencyMs);
  }

  // The byte estimate matches the serialized disclosure body sent by action-planner.
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
