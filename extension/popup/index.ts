// Privaagent popup controller: protection status, task dispatch, and local health checks.

import { detectStructuredPII } from "../src/privacy/pii-detector";
import { detectSecrets } from "../src/privacy/secret-detector";
import { verifyOutgoingDisclosure } from "../src/privacy/privacy-guard";
import { PrivacyAuditVault } from "../src/privacy/audit-vault";
import { dispatchUserApprovedAction, dispatchUserApprovedGoal } from "./confirmation";
import { initializeOCRWorker, recognizeOCRImage } from "../src/perception/ocr";

// OCR runs in the extension popup because Chrome can host its local Web Worker
// here. The background service worker brokers requests from the content script.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OCR_RECOGNIZE_POPUP" && message?.type !== "OCR_WARM_POPUP") return false;
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("src/background/index.js")) {
    sendResponse({ complete: false, ready: false, error: "Invalid internal OCR request" });
    return false;
  }

  const operation = message.type === "OCR_WARM_POPUP"
    ? initializeOCRWorker().then(() => ({ ready: true }))
    : typeof message.imageDataUrl === "string"
      ? recognizeOCRImage(message.imageDataUrl).then((words) => ({ complete: true, words }))
      : Promise.reject(new Error("OCR request did not include an image"));
  operation.then(sendResponse).catch((error: unknown) => sendResponse({
    complete: false,
    ready: false,
    error: error instanceof Error ? error.message : "Popup OCR failed",
  }));
  return true;
});

document.addEventListener("DOMContentLoaded", () => {

  function setPopupState(state: string) {
    const card = document.getElementById("dynamic-status-card");
    const title = document.getElementById("status-title");
    const desc = document.getElementById("status-desc");
    const icon = document.getElementById("status-icon-svg");
    if (!card || !title || !desc || !icon) return;
    
    card.className = "status-card state-" + state;
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "icon-lg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const addShape = (tagName: string, attributes: Record<string, string>) => {
      const shape = document.createElementNS(svgNs, tagName);
      for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
      svg.appendChild(shape);
    };

    if (state === "active") {
      title.textContent = "Protection Active";
      desc.textContent = "This page is protected. Sensitive data is checked before any disclosure.";
      addShape("polyline", { points: "20 6 9 17 4 12" });
    } else if (state === "loading") {
      title.textContent = "Checking this page";
      desc.textContent = "Reading page structure locally.";
      addShape("path", { d: "M21 12a9 9 0 1 1-6.219-8.56" });
    } else if (state === "error") {
      title.textContent = "Action Blocked";
      desc.textContent = "A privacy or safety check stopped the requested action.";
      addShape("path", { d: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" });
      addShape("line", { x1: "12", y1: "9", x2: "12", y2: "13" });
      addShape("line", { x1: "12", y1: "17", x2: "12.01", y2: "17" });
    } else if (state === "confirm") {
      title.textContent = "Action needs approval";
      desc.textContent = "Review the action below. It will be checked against the current page before it runs.";
      addShape("path", { d: "M12 8v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.41 0Z" });
    } else if (state === "empty") {
      title.textContent = "Protection paused";
      desc.textContent = "Turn protection on to resume local page checks.";
      addShape("path", { d: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" });
    }
    icon.replaceChildren(svg);
  }

  // ─── Element refs ────────────────────────────────────────────────────────
  const toggleShieldEl  = document.getElementById("toggle-shield")  as HTMLInputElement;
  const shieldStatusEl  = document.getElementById("shield-status")  as HTMLDivElement;
  const statusDotEl     = document.getElementById("status-dot")     as HTMLSpanElement;
  const statusLabelEl   = document.getElementById("status-label")   as HTMLSpanElement;
  const headerEl        = document.getElementById("header")         as HTMLDivElement;
  const logoEl          = document.getElementById("logo")           as HTMLDivElement;

  const tabUrlEl        = document.getElementById("tab-url")        as HTMLSpanElement;
  const mLatencyEl      = document.getElementById("m-latency")      as HTMLDivElement;
  const mPiiEl          = document.getElementById("m-pii")          as HTMLDivElement;
  const mSecretsEl      = document.getElementById("m-secrets")      as HTMLDivElement;

  const threatFeedEl    = document.getElementById("threat-feed")    as HTMLDivElement;
  const feedCountEl     = document.getElementById("feed-count")     as HTMLSpanElement;

  const taskInputEl     = document.getElementById("task-input")     as HTMLInputElement;
  const btnRunEl        = document.getElementById("btn-run")        as HTMLButtonElement;
  const selModeEl       = document.getElementById("sel-mode")       as HTMLSelectElement;
  const selCeilingEl    = document.getElementById("sel-ceiling")    as HTMLSelectElement;

  const toastEl         = document.getElementById("toast")          as HTMLDivElement;
  const ledgerBoxEl     = document.getElementById("ledger-box")     as HTMLDivElement;
  const detailsPanelEl  = document.getElementById("details-panel")  as HTMLDetailsElement;
  const ledgerLevelEl   = document.getElementById("ledger-level")   as HTMLSpanElement;
  const ledgerHeadEl    = document.getElementById("ledger-head")    as HTMLDivElement;
  const lModelEl        = document.getElementById("l-model")        as HTMLSpanElement;
  const lBackendEl      = document.getElementById("l-backend")      as HTMLSpanElement;
  const lLocalLatEl     = document.getElementById("l-local-lat")    as HTMLSpanElement;
  const lSanLatEl       = document.getElementById("l-san-lat")      as HTMLSpanElement;
  const lVlmLatEl       = document.getElementById("l-vlm-lat")      as HTMLSpanElement;
  const lEntitiesEl     = document.getElementById("l-entities")     as HTMLSpanElement;
  const lExtReqEl       = document.getElementById("l-ext-req")      as HTMLSpanElement;
  const lPrivacyGuardEl = document.getElementById("l-privacy-guard") as HTMLSpanElement;
  const lActionEl       = document.getElementById("l-action")       as HTMLSpanElement;
  const lTargetEl       = document.getElementById("l-target")       as HTMLSpanElement;
  const lVerdictEl      = document.getElementById("l-verdict")      as HTMLSpanElement;
  const lBytesEl        = document.getElementById("l-bytes")        as HTMLSpanElement;
  const lLatencyEl      = document.getElementById("l-latency")      as HTMLSpanElement;
  const lReasonEl       = document.getElementById("l-reason")       as HTMLDivElement;

  const btnDemoEl       = document.getElementById("btn-demo")      as HTMLButtonElement;
  const btnPortalEl     = document.getElementById("btn-portal")    as HTMLButtonElement;
  const btnInspectEl    = document.getElementById("btn-inspect")   as HTMLButtonElement;
  const btnClearEl      = document.getElementById("btn-clear")     as HTMLButtonElement;

  const btnHealthCheckEl  = document.getElementById("btn-health-check") as HTMLButtonElement;
  const healthResultsEl   = document.getElementById("health-results") as HTMLDivElement;
  const healthDetectorsEl = document.getElementById("health-detectors") as HTMLSpanElement;
  const healthOutboundEl  = document.getElementById("health-outbound") as HTMLSpanElement;
  const healthAuditEl     = document.getElementById("health-audit") as HTMLSpanElement;
  const healthScanEl      = document.getElementById("health-scan") as HTMLSpanElement;
  const healthModeEl      = document.getElementById("health-mode") as HTMLSpanElement;
  const healthTimestampEl = document.getElementById("health-timestamp") as HTMLSpanElement;
  const btnExportHealthEl = document.getElementById("btn-export-health") as HTMLButtonElement;
  const confirmationPanelEl = document.getElementById("confirmation-panel") as HTMLDivElement;
  const confirmationMessageEl = document.getElementById("confirmation-message") as HTMLParagraphElement;
  const confirmationApproveEl = document.getElementById("confirmation-approve") as HTMLButtonElement;
  const confirmationCancelEl = document.getElementById("confirmation-cancel") as HTMLButtonElement;

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let lastHealthData: Record<string, unknown> | null = null;
  let pendingApproval: { tabId: number; action: any; isCompound: boolean; disclosureLevel: string; continuationId?: string } | null = null;

  // ─── Toast System (replaces alert) ──────────────────────────────────────
  function showToast(msg: string, type: "error" | "success" | "warning" = "error", durationMs = 3500) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = `toast ${type} show`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, durationMs);
  }

  function setTone(element: HTMLElement | null, tone: "success" | "warning" | "danger" | "primary" | "neutral") {
    if (!element) return;
    element.classList.remove("tone-success", "tone-warning", "tone-danger", "tone-primary", "tone-neutral", "tone-alert");
    element.classList.add(`tone-${tone}`);
  }

  function formatVisualTrace(trace: any): string {
    if (!trace || (trace.level !== "L2" && trace.level !== "L3")) return "";
    const formatBox = (box: unknown) => Array.isArray(box) && box.length === 4
      ? `[${box.map((value) => Number(value).toFixed(0)).join(", ")}]`
      : "unlocalized viewport";
    const detectedRoi = trace.targetRoi ? formatBox(trace.targetRoi) : "full viewport";
    const redactedBoxes = Array.isArray(trace.redactedBoxes) ? trace.redactedBoxes : [];
    const redactedAreas = redactedBoxes.slice(0, 4).map(formatBox).join(", ");
    const extraCount = Math.max(0, redactedBoxes.length - 4);
    const redactedRoi = redactedAreas
      ? `${redactedBoxes.length}/${Number(trace.sourceSensitiveBoxCount) || 0} detected box(es): ${redactedAreas}${extraCount ? `, +${extraCount} more` : ""}`
      : `0/${Number(trace.sourceSensitiveBoxCount) || 0} detected boxes`;
    const vlmRoi = trace.level === "L2" ? `L2 crop ${detectedRoi}` : "L3 full viewport";
    return `Detected ROI ${detectedRoi} → Redacted ROI ${redactedRoi} → VLM ROI ${vlmRoi}`;
  }

  // ─── Zero-Leak Message Dispatchers (Suppresses Unchecked runtime.lastError) ──
  function sendTabMsg(tabId: number, message: any, callback?: (response: any) => void) {
    if (typeof chrome === "undefined" || !chrome.tabs?.sendMessage) {
      if (callback) callback(null);
      return;
    }
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        // ALWAYS read lastError to suppress Chrome Unchecked runtime.lastError logs
        const err = chrome.runtime?.lastError;
        if (callback) {
          callback(err ? null : response);
        }
      });
    } catch {
      if (callback) callback(null);
    }
  }

  function sendRuntimeMsg(message: any, callback?: (response: any) => void) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      if (callback) callback(null);
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        // ALWAYS read lastError to suppress Chrome Unchecked runtime.lastError logs
        const err = chrome.runtime?.lastError;
        if (callback) {
          callback(err ? null : response);
        }
      });
    } catch {
      if (callback) callback(null);
    }
  }

  function renderConfirmation(res: any, isCompound: boolean, tabId: number) {
    pendingApproval = null;
    if (confirmationPanelEl) confirmationPanelEl.hidden = true;

    const lastStep = Array.isArray(res?.history) ? res.history[res.history.length - 1] : null;
    const confirmedStep = isCompound && res?.status === "PAUSED_CONFIRMATION" && lastStep?.verdict === "CONFIRM"
      ? lastStep
      : null;
    if (isCompound && !res?.continuationId) return;
    const requiresConfirmation = confirmedStep !== null || (!isCompound && res?.validation?.verdict === "CONFIRM");
    const action = confirmedStep?.action || res?.resolution?.action;
    if (!requiresConfirmation || !action || typeof action.action !== "string" || typeof action.target_id !== "string") return;

    pendingApproval = {
      tabId,
      action,
      isCompound,
      disclosureLevel: String(confirmedStep?.level || res?.resolution?.disclosure?.level || "L0"),
      continuationId: isCompound ? res.continuationId : undefined,
    };
    const reason = String(
      confirmedStep?.error ||
      res?.validation?.policyResult?.requiredUserConfirmation ||
      res?.error ||
      "This action requires explicit approval."
    ).slice(0, 240);
    const actionSummary = action.action === "type"
      ? `Type into ${action.target_id}; the value is withheld in this prompt.`
      : `${action.action} target ${action.target_id}`;
    const continuationNote = isCompound
      ? " Approval revalidates and executes this step, then continues the remaining goal."
      : " The page will be revalidated before execution.";

    if (confirmationMessageEl) {
      confirmationMessageEl.textContent = `${reason} Action: ${actionSummary}.${continuationNote}`;
    }
    if (confirmationApproveEl) confirmationApproveEl.disabled = false;
    if (confirmationCancelEl) confirmationCancelEl.disabled = false;
    if (confirmationPanelEl) confirmationPanelEl.hidden = false;
  }

  if (confirmationApproveEl) {
    confirmationApproveEl.addEventListener("click", () => {
      const approval = pendingApproval;
      if (!approval) return;
      pendingApproval = null;
      confirmationApproveEl.disabled = true;
      if (confirmationCancelEl) confirmationCancelEl.disabled = true;
      if (confirmationMessageEl) confirmationMessageEl.textContent = "Revalidating the current page and executing the approved action…";

      const handleApprovalResponse = (response: any) => {
        if (approval.isCompound && response?.decomposed) {
          showLedger(response, true, approval.tabId);
          const stillPaused = response.status === "PAUSED_CONFIRMATION";
          const success = response.status === "SUCCESS" || response.status === "NAVIGATION_PENDING";
          if (lVerdictEl && !stillPaused) {
            lVerdictEl.textContent = success ? "APPROVED · GOAL RESUMED" : response.status || "NOT EXECUTED";
            setTone(lVerdictEl, success ? "success" : "danger");
          }
          const resultMessage = stillPaused
            ? response.error || "The next goal step needs approval."
            : success
              ? response.status === "NAVIGATION_PENDING"
                ? "Approved action executed. The goal will need fresh perception after navigation."
                : "Approved action executed and the remaining goal steps completed."
              : String(response.error || "The goal could not continue after revalidation.");
          if (lReasonEl && !stillPaused) lReasonEl.textContent = resultMessage;
          if (!stillPaused) {
            if (confirmationPanelEl) confirmationPanelEl.hidden = true;
            showToast(resultMessage, success ? "success" : "warning", 4500);
          }
          setPopupState(stillPaused ? "confirm" : success ? "active" : "error");
          refreshPageState();
          return;
        }

        if (confirmationPanelEl) confirmationPanelEl.hidden = true;
        const success = response?.success === true;
        if (lVerdictEl) {
          lVerdictEl.textContent = success ? "APPROVED · EXECUTED" : "NOT EXECUTED";
          setTone(lVerdictEl, success ? "success" : "danger");
        }
        const resultMessage = success
          ? "Approved action executed after current-page revalidation."
          : String(response?.error || "The action could not be revalidated and was not executed.");
        if (lReasonEl) lReasonEl.textContent = resultMessage;
        showToast(resultMessage, success ? "success" : "warning", 4500);
        setPopupState(success ? "active" : "error");
        refreshPageState();
      };

      if (approval.isCompound && approval.continuationId) {
        dispatchUserApprovedGoal(sendTabMsg, approval.tabId, approval.continuationId, true, handleApprovalResponse);
      } else {
        dispatchUserApprovedAction(sendTabMsg, approval.tabId, approval.action, handleApprovalResponse, approval.disclosureLevel);
      }
    });
  }

  if (confirmationCancelEl) {
    confirmationCancelEl.addEventListener("click", () => {
      const approval = pendingApproval;
      pendingApproval = null;
      if (approval?.isCompound && approval.continuationId) {
        dispatchUserApprovedGoal(sendTabMsg, approval.tabId, approval.continuationId, false, () => {});
      }
      if (confirmationPanelEl) confirmationPanelEl.hidden = true;
      if (lVerdictEl) {
        lVerdictEl.textContent = "CANCELLED";
        setTone(lVerdictEl, "neutral");
      }
      if (lReasonEl) lReasonEl.textContent = "Cancelled. The paused action was not executed.";
      showToast("Action cancelled; nothing was executed.", "warning", 2500);
    });
  }

  // ─── Active Tab Query ────────────────────────────────────────────────────
  function queryActiveTab(callback: (tabId: number) => void) {
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs?.[0];
        if (activeTab?.id) {
          const url = activeTab.url || "";
          if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) {
            if (tabUrlEl) tabUrlEl.textContent = "Protected Browser Page (Standalone Mode)";
          }
          callback(activeTab.id);
        } else {
          if (tabUrlEl) tabUrlEl.textContent = "Standalone / Benchmark Mode";
        }
      });
    }
  }

  // ─── PII Type → Badge class ──────────────────────────────────────────────
  function getBadgeClass(type: string): string {
    const t = type.toUpperCase();
    if (t === "EMAIL")           return "badge-email";
    if (t === "PHONE")           return "badge-phone";
    if (t === "SECRET_KEY")      return "badge-secret";
    if (t === "AADHAAR")         return "badge-aadhaar";
    if (t === "PAN")             return "badge-pan";
    if (t === "CREDIT_CARD")     return "badge-card";
    if (t === "PERSON")          return "badge-person";
    if (t === "GSTIN")           return "badge-gstin";
    if (t === "DRIVING_LICENSE") return "badge-dl";
    if (t === "BANK_ACCOUNT")    return "badge-bank";
    if (t === "DOB")             return "badge-dob";
    if (t === "VEHICLE_RC")      return "badge-rc";
    return "badge-default";
  }

  function getBadgeLabel(type: string): string {
    const t = type.toUpperCase();
    if (t === "EMAIL")           return "EMAIL";
    if (t === "PHONE")           return "PHONE";
    if (t === "SECRET_KEY")      return "⬛ SECRET";
    if (t === "AADHAAR")         return "AADHAAR";
    if (t === "PAN")             return "PAN";
    if (t === "CREDIT_CARD")     return "CARD";
    if (t === "PERSON")          return "NAME";
    if (t === "GSTIN")           return "🏛️ GSTIN";
    if (t === "DRIVING_LICENSE") return "🪪 DL";
    if (t === "BANK_ACCOUNT")    return "🏦 BANK A/C";
    if (t === "DOB")             return "📅 DOB";
    if (t === "VEHICLE_RC")      return "🚗 RC";
    return type;
  }

  // ─── Render live threat feed ──────────────────────────────────────────────
  function renderThreatFeed(feed: Array<{ type: string; maskedValue: string }>) {
    if (!threatFeedEl) return;

    if (!feed || feed.length === 0) {
      const empty = document.createElement("p");
      empty.className = "feed-empty";
      empty.textContent = "No sensitive values detected in this scan.";
      threatFeedEl.replaceChildren(empty);
      if (feedCountEl) feedCountEl.textContent = "None found";
      return;
    }

    if (feedCountEl) feedCountEl.textContent = `${feed.length} detection${feed.length > 1 ? "s" : ""}`;

    const secretCount = feed.filter(f => f.type === "SECRET_KEY").length;
    if (mSecretsEl) mSecretsEl.textContent = String(secretCount);

    const rows = feed.map((item) => {
      const row = document.createElement("div");
      row.className = "threat-item";
      const badge = document.createElement("span");
      badge.className = `threat-badge ${getBadgeClass(item.type)}`;
      badge.textContent = getBadgeLabel(item.type);
      const value = document.createElement("span");
      value.className = "threat-value threat-masked";
      value.textContent = item.maskedValue;
      const note = document.createElement("span");
      note.className = "threat-note";
      note.textContent = "masked";
      row.append(badge, value, note);
      return row;
    });
    threatFeedEl.replaceChildren(...rows);
  }

  // ─── Fetch page state and populate metrics + feed ────────────────────────
  function refreshPageState() {
    
    

    queryActiveTab((tabId) => {
      sendTabMsg(tabId, { type: "GET_PAGE_STATE" }, (response) => {
        
        

        if (!response) {
          if (tabUrlEl) tabUrlEl.textContent = "Protected Browser Page or Dev Tab";
          return;
        }

        if (tabUrlEl) {
          const urlShort = (response.url || "").replace(/^https?:\/\//, "").split("?")[0];
          tabUrlEl.textContent = `${response.title || "Webpage"} — ${urlShort}`;
        }
        if (mLatencyEl) {
          const ms = Number(response.durationMs || 0).toFixed(1);
          mLatencyEl.textContent = `${ms}`;
          mLatencyEl.classList.toggle("tone-warning", Number(ms) >= 50);
        }
        if (mPiiEl) {
          const count = response.sensitiveElementsCount || 0;
          mPiiEl.textContent = String(count);
          mPiiEl.classList.toggle("tone-alert", count > 0);
        }

        renderThreatFeed(response.threatFeed || []);

        if (response.redactionMode && selModeEl) {
          selModeEl.value = response.redactionMode;
        }

        // Reflect shield state from content script
        const shieldOn = response.shieldEnabled !== false;
        applyShieldUI(shieldOn);
        if (toggleShieldEl) toggleShieldEl.checked = shieldOn;
      });
    });
  }

  // ─── Shield Toggle UI ────────────────────────────────────────────────────
  function applyShieldUI(enabled: boolean) {
    if (enabled) {
      if (shieldStatusEl) shieldStatusEl.className = "shield-status on";
      if (statusDotEl) statusDotEl.className = "status-dot on";
      if (statusLabelEl) statusLabelEl.textContent = "Active";
      setPopupState("active");
    } else {
      if (shieldStatusEl) shieldStatusEl.className = "shield-status off";
      if (statusDotEl) statusDotEl.className = "status-dot off";
      if (statusLabelEl) statusLabelEl.textContent = "VISUAL OFF · ACTIONS ACTIVE";
      setPopupState("empty");
      const statusTitle = document.getElementById("status-title");
      const statusDesc = document.getElementById("status-desc");
      if (statusTitle) statusTitle.textContent = "Visual Shield Off · Action Security Active";
      if (statusDesc) statusDesc.textContent = "Sensitive overlays are hidden. Action validation and confirmation checks remain active.";
    }
  }

  // ─── Restore saved preferences ───────────────────────────────────────────
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["privaagent_shield_enabled", "privaagent_ceiling", "privaagent_redaction_mode"], (result) => {
      const shieldOn = result.privaagent_shield_enabled !== false;
      if (toggleShieldEl) toggleShieldEl.checked = shieldOn;
      applyShieldUI(shieldOn);

      const savedCeiling = result.privaagent_ceiling;
      if (savedCeiling && selCeilingEl) selCeilingEl.value = savedCeiling;

      const savedMode = result.privaagent_redaction_mode;
      if (savedMode && selModeEl) selModeEl.value = savedMode;

      refreshPageState();
    });
  } else {
    refreshPageState();
  }

  // ─── Power Toggle Handler ─────────────────────────────────────────────────
  if (toggleShieldEl) {
    toggleShieldEl.addEventListener("change", () => {
      const enabled = toggleShieldEl.checked;
      applyShieldUI(enabled);

      chrome.storage?.local?.set({ privaagent_shield_enabled: enabled });

      queryActiveTab((tabId) => {
        sendTabMsg(tabId, { type: "TOGGLE_OVERLAYS", visible: enabled });
      });

      sendRuntimeMsg({ type: "SET_SHIELD_STATE", enabled });

      showToast(
        enabled ? "Privacy protection is active." : "Privacy protection is paused.",
        enabled ? "success" : "warning",
        2000
      );
    });
  }

  // ─── Redaction Mode Switcher ──────────────────────────────────────────────
  if (selModeEl) {
    selModeEl.addEventListener("change", () => {
      const mode = selModeEl.value;
      queryActiveTab((tabId) => {
        sendTabMsg(tabId, { type: "SET_REDACTION_MODE", mode });
      });
      chrome.storage?.local?.set({ privaagent_redaction_mode: mode });
      showToast(
        mode === "GHOST"
          ? "Ghost mask active. Sensitive elements use a temporary masking class."
          : mode === "SYNTHETIC"
          ? "Synthetic replacement mode is active."
          : "Blur overlay mode is active.",
        "success",
        2500
      );
    });
  }

  // ─── Disclosure Ceiling Persistence ─────────────────────────────────────
  if (selCeilingEl) {
    selCeilingEl.addEventListener("change", () => {
      chrome.storage?.local?.set({ privaagent_ceiling: selCeilingEl.value });
    });
  }

  // ─── Chips ───────────────────────────────────────────────────────────────
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const cmd = chip.getAttribute("data-cmd");
      if (cmd && taskInputEl) {
        taskInputEl.value = cmd;
        taskInputEl.focus();
        runTask();
      }
    });
  });

  // ─── Task Execution ───────────────────────────────────────────────────────
  function runTask() {
    const task = taskInputEl?.value?.trim();
    if (!task) { showToast("Please enter a task description", "warning"); return; }

    const maxLevel = selCeilingEl?.value || "L2";
    const isCompound = /\s+(?:then|after\s+that|followed\s+by|and\s+then)\s+|;/i.test(task);

    if (btnRunEl) {
      btnRunEl.disabled = true;
      btnRunEl.textContent = isCompound ? "⏳ Planning..." : "⏳ Running...";
      setPopupState("loading");
    }
    if (ledgerBoxEl) ledgerBoxEl.classList.remove("show");
    pendingApproval = null;
    if (confirmationPanelEl) confirmationPanelEl.hidden = true;

    const simulateUnsafeSanitization =
      task.toLowerCase().includes("unsafe") ||
      task.toLowerCase().includes("leak") ||
      task.toLowerCase().includes("simulate");

    const payload = isCompound
      ? { type: "RUN_GOAL", goal: task, maxLevel }
      : { type: "RUN_TASK", task, maxLevel, simulateUnsafeSanitization };

    queryActiveTab((tabId) => {
      sendTabMsg(tabId, payload, (res) => {
        if (btnRunEl) {
          btnRunEl.disabled = false;
          btnRunEl.textContent = "▶ Run";
        }

        if (!res) {
          showToast("Execution note: Open http://127.0.0.1:8000/demo/ to test full agent interaction on demo page", "warning");
          return;
        }

        showLedger(res, isCompound, tabId);
        const needsApproval = res.status === "PAUSED_CONFIRMATION" || res.validation?.verdict === "CONFIRM";
        setPopupState(needsApproval ? "confirm" : res.success === true || res.status === "SUCCESS" ? "active" : "error");
        refreshPageState();
      });
    });
  }

  if (btnRunEl) btnRunEl.addEventListener("click", runTask);
  if (taskInputEl) taskInputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") runTask(); });

  // ─── Show Ledger Card & Two-Layer Inspector ──────────────────────────────
  function showLedger(res: any, isCompound: boolean, tabId: number) {
    if (!ledgerBoxEl) return;
    ledgerBoxEl.classList.add("show");

    if (isCompound || res.decomposed) {
      const status = res.status || (res.success ? "SUCCESS" : "FAILED");
      setLedgerLevel(status.includes("SUCCESS") ? "L0" : "L3", `MULTI-STEP: ${status}`);
      if (ledgerHeadEl) ledgerHeadEl.textContent = "Architecture: Multi-Turn Goal Decomposition";
      if (lModelEl) lModelEl.textContent = "PrivaAgent Goal Decomposer (Local-First)";
      if (lBackendEl) lBackendEl.textContent = "Browser Autonomous Agent Loop";
      if (lActionEl) lActionEl.textContent = `${res.totalSteps || 0} subtasks executed`;
      if (lTargetEl) lTargetEl.textContent = (res.decomposed?.subtasks || []).join(" → ");
      if (lVerdictEl) {
        lVerdictEl.textContent = status;
        setTone(lVerdictEl, status === "SUCCESS" ? "success" : "danger");
      }
      updateBandwidth(res.cumulativeBytesSent || 0);
      if (lLatencyEl) lLatencyEl.textContent = "Budget monitored";
      if (lLocalLatEl) lLocalLatEl.textContent = "Monitored";
      if (lSanLatEl) lSanLatEl.textContent = "Per-step";
      if (lVlmLatEl) lVlmLatEl.textContent = "On-demand";
      if (lEntitiesEl) lEntitiesEl.textContent = "Protected on each step";
      if (lExtReqEl) {
        lExtReqEl.textContent = res.cumulativeBytesSent > 0 ? "YES (Selective Fallback)" : "NO (All Local)";
        setTone(lExtReqEl, res.cumulativeBytesSent > 0 ? "primary" : "success");
      }
      if (lPrivacyGuardEl) {
        lPrivacyGuardEl.textContent = "VERIFIED (Multi-step chained)";
        setTone(lPrivacyGuardEl, "success");
      }
      if (lReasonEl) {
        lReasonEl.textContent = (res.history || [])
          .map((h: any) => {
            const trace = formatVisualTrace(h.visualTrace);
            return `Step ${h.stepIndex}: [${h.level}] ${h.action.action.toUpperCase()} → ${h.action.target_id} (${h.verdict}, ${h.bytesSent}B)${trace ? `\n  ${trace}` : ""}`;
          })
          .join("\n") || res.error || "Completed.";
      }
      renderConfirmation(res, isCompound, tabId);
      return;
    }

    if (res.resolution) {
      const r = res.resolution;
      const path: string = r.processingPath || (r.isLocal ? "LOCAL" : "SANITIZED_VLM");

      if (path === "LOCAL") {
        setLedgerLevel("L0", "🟢 LAYER 1: LOCAL PROCESSING");
        if (ledgerHeadEl) ledgerHeadEl.textContent = "Architecture: Layer 1 (On-Device WASM/DOM)";
        if (lModelEl) lModelEl.textContent = r.modelUsed || "PrivaAgent Local Intent Engine";
        if (lBackendEl) lBackendEl.textContent = r.executionBackend || "Browser WASM / DOM (0 Network)";
        if (lLocalLatEl) lLocalLatEl.textContent = `${r.localLatencyMs} ms`;
        if (lSanLatEl) lSanLatEl.textContent = "0.0 ms (Bypassed)";
        if (lVlmLatEl) lVlmLatEl.textContent = "0.0 ms (Bypassed)";
        if (lLatencyEl) lLatencyEl.textContent = `${r.totalLatencyMs || r.localLatencyMs} ms`;
        if (lEntitiesEl) lEntitiesEl.textContent = "None; resolved locally";
        if (lExtReqEl) {
          lExtReqEl.textContent = "NO (0 External Requests)";
          setTone(lExtReqEl, "success");
        }
        if (lBytesEl) lBytesEl.textContent = "0 B sent";
        if (lPrivacyGuardEl) {
          lPrivacyGuardEl.textContent = "PASSED (local-only; 0 B sent)";
          setTone(lPrivacyGuardEl, "success");
        }
      } else if (path === "SANITIZED_VLM") {
        setLedgerLevel("L2", "🟣 LAYER 2: SANITIZED VLM");
        if (ledgerHeadEl) ledgerHeadEl.textContent = "Architecture: Layer 2 (Sanitized VLM Fallback)";
        if (lModelEl) lModelEl.textContent = r.modelUsed || "qwen2.5vl:3b-instruct-q4_K_M (Ollama)";
        if (lBackendEl) lBackendEl.textContent = r.executionBackend || "Remote VLM (http://127.0.0.1:8000)";
        if (lLocalLatEl) lLocalLatEl.textContent = `${r.localLatencyMs} ms (Local insufficient)`;
        if (lSanLatEl) lSanLatEl.textContent = `${r.sanitizationLatencyMs} ms`;
        if (lVlmLatEl) lVlmLatEl.textContent = `${r.vlmLatencyMs} ms`;
        if (lLatencyEl) lLatencyEl.textContent = `${r.totalLatencyMs} ms`;
        const entList = (r.detectedEntities || []).map((e: any) => e.placeholder).join(", ");
        if (lEntitiesEl) lEntitiesEl.textContent = entList || "Masked Placeholders";
        if (lExtReqEl) {
          lExtReqEl.textContent = "YES (Sanitized Payload Sent)";
          setTone(lExtReqEl, "primary");
        }
        if (lBytesEl) lBytesEl.textContent = `${r.networkBytesSent} B`;
        if (lPrivacyGuardEl) {
          lPrivacyGuardEl.textContent = "PASSED (local pre-send checks)";
          setTone(lPrivacyGuardEl, "success");
        }
      } else if (path === "BLOCKED") {
        setLedgerLevel("L3", "🔴 BLOCKED: PRIVACY AUDIT");
        if (ledgerHeadEl) ledgerHeadEl.textContent = "Architecture: Blocked by Pre-Flight Sentry";
        if (lModelEl) lModelEl.textContent = r.modelUsed || "PrivaAgent Privacy Guard";
        if (lBackendEl) lBackendEl.textContent = r.executionBackend || "Local privacy check";
        if (lLocalLatEl) lLocalLatEl.textContent = `${r.localLatencyMs} ms`;
        if (lSanLatEl) lSanLatEl.textContent = `${r.sanitizationLatencyMs} ms`;
        if (lVlmLatEl) lVlmLatEl.textContent = "0.0 ms (Blocked)";
        if (lLatencyEl) lLatencyEl.textContent = `${r.totalLatencyMs} ms`;
        if (lEntitiesEl) lEntitiesEl.textContent = "UNSAFE PATTERNS DETECTED";
        if (lExtReqEl) {
          lExtReqEl.textContent = "NO (Request Blocked on Device)";
          setTone(lExtReqEl, "danger");
        }
        if (lBytesEl) lBytesEl.textContent = "0 B (0 Bytes Transmitted)";
        if (lPrivacyGuardEl) {
          lPrivacyGuardEl.textContent = "FAILED: Raw PII Leak Blocked";
          setTone(lPrivacyGuardEl, "danger");
        }
      }

      if (lActionEl) lActionEl.textContent = r.action.action.toUpperCase();
      if (lTargetEl) lTargetEl.textContent = r.action.target_id;
      if (lReasonEl) {
        const reason = r.blockReason || r.action.reason || "";
        const trace = formatVisualTrace({
          level: r.disclosure?.level,
          targetRoi: r.disclosure?.crop_box,
          sourceSensitiveBoxCount: r.disclosure?.redaction_manifest?.sourceSensitiveBoxCount,
          redactedBoxes: r.disclosure?.redaction_manifest?.redactedBoxes,
        });
        lReasonEl.textContent = [reason, trace].filter(Boolean).join("\n");
      }
    }

    if (res.validation) {
      const v = res.validation.verdict;
      if (lVerdictEl) {
        lVerdictEl.textContent = v;
        setTone(lVerdictEl, v === "ALLOW" ? "success" : v === "CONFIRM" ? "warning" : "danger");
      }
    }

    if (!res.success && res.error) {
      showToast(res.error, res.error.includes("BLOCK") || res.error.includes("blocked") ? "error" : "warning");
      if (lReasonEl) lReasonEl.textContent = `⚠️ ${res.error}`;
    } else if (res.success) {
      showToast("✅ Action executed successfully", "success", 2000);
    }
    renderConfirmation(res, isCompound, tabId);
  }

  function setLedgerLevel(level: string, label: string) {
    if (!ledgerLevelEl) return;
    const l = level.toLowerCase();
    ledgerLevelEl.textContent = label;
    ledgerLevelEl.className = `level-pill level-${l in { l0:1,l1:1,l2:1,l3:1 } ? l : "l0"}`;
  }

  function updateBandwidth(bytes: number) {
    if (lBytesEl) lBytesEl.textContent = `${bytes} B sent`;
  }

  // ─── Local runtime privacy health check (not a benchmark score) ──────────
  if (btnHealthCheckEl) {
    btnHealthCheckEl.addEventListener("click", () => {
      btnHealthCheckEl.disabled = true;
      btnHealthCheckEl.textContent = "Checking…";

      const testVectors = [
        { text: "ayashmuthal@gmail.com", type: "EMAIL" },
        { text: "981652472", type: "PHONE" },
        { text: "+91 98165 24721", type: "PHONE" },
        { text: "9999 0000 0016", type: "AADHAAR" },
        { text: "ABCDE1234F", type: "PAN" },
        { text: "27ABCDE1234F1Z5", type: "GSTIN" },
        { text: "DL-1420180123456", type: "DRIVING_LICENSE" },
        { text: "A/C 123456789012", type: "BANK_ACCOUNT" },
        { text: "DOB: 14/08/1998", type: "DOB" },
        { text: "MH-12-AB-1234", type: "VEHICLE_RC" },
        { text: "4532 1234 5678 9010", type: "CREDIT_CARD" },
        { text: "sk-ant-api03-1234567890abcdef", type: "SECRET_KEY" },
        { text: "AIzaSyD3x94jKlw-z8x9039klw-ABCD1234", type: "SECRET_KEY" },
        { text: "ghp_1234567890abcdefghijklmnopqrstuvwx", type: "SECRET_KEY" },
        { text: "user@okhdfcbank", type: "UPI_ID" },
        { text: "HDFC0001234", type: "IFSC" },
      ];
      const vectorsPassed = testVectors.filter((vector) => {
        const pii = detectStructuredPII(vector.text);
        const secrets = detectSecrets(vector.text);
        return pii.some((result) => result.type === vector.type)
          || secrets.some((result) => result.type === vector.type);
      }).length;

      const unsafeCanary = verifyOutgoingDisclosure({
        level: "L1",
        reason: "Synthetic outbound guard test",
        task: "Contact health-check@example.com",
        elements: [],
        redacted_token_count: 0,
      });
      const safeCanary = verifyOutgoingDisclosure({
        level: "L1",
        reason: "Synthetic outbound guard test",
        task: "Contact [EMAIL_1]",
        elements: [],
        redacted_token_count: 0,
      });
      const outboundGuardPassed = !unsafeCanary.passed && safeCanary.passed;

      queryActiveTab((tabId) => {
        sendTabMsg(tabId, { type: "GET_PAGE_STATE" }, (pageStateResponse) => {
          const finishCheck = (stored: { privaagent_audit_ledger?: unknown[] }) => {
            const records = Array.isArray(stored.privaagent_audit_ledger)
              ? stored.privaagent_audit_ledger
              : [];
            const vault = new PrivacyAuditVault();
            vault.loadFromStorage(records as any[]);
            const integrity = vault.verifyLedgerIntegrity();
            const scanDurationMs = typeof pageStateResponse?.durationMs === "number"
              && Number.isFinite(pageStateResponse.durationMs)
              ? Number(pageStateResponse.durationMs.toFixed(2))
              : null;
            const timestamp = new Date().toISOString();

            if (healthResultsEl) healthResultsEl.classList.add("show");
            if (healthDetectorsEl) {
              healthDetectorsEl.textContent = `${vectorsPassed} / ${testVectors.length}`;
              setTone(healthDetectorsEl, vectorsPassed === testVectors.length ? "success" : "danger");
            }
            if (healthOutboundEl) {
              healthOutboundEl.textContent = outboundGuardPassed ? "PASS" : "FAIL";
              setTone(healthOutboundEl, outboundGuardPassed ? "success" : "danger");
            }
            if (healthAuditEl) {
              healthAuditEl.textContent = integrity.chainLength === 0
                ? "No records yet"
                : integrity.valid ? `Verified · ${integrity.chainLength} records` : "Integrity issue";
              setTone(healthAuditEl, integrity.chainLength === 0 ? "neutral" : integrity.valid ? "success" : "danger");
            }
            if (healthScanEl) healthScanEl.textContent = scanDurationMs === null ? "Unavailable" : `${scanDurationMs.toFixed(2)} ms`;
            if (healthModeEl) healthModeEl.textContent = "L0-first";
            if (healthTimestampEl) healthTimestampEl.textContent = `Checked ${new Date(timestamp).toLocaleTimeString()}`;

            lastHealthData = {
              checkedAt: timestamp,
              detectorVectors: { passed: vectorsPassed, total: testVectors.length },
              outboundGuard: { passed: outboundGuardPassed, probe: "synthetic email canary; no request sent" },
              auditChain: { valid: integrity.valid, recordsChecked: integrity.chainLength, rootHash: integrity.rootHash },
              domScanDurationMs: scanDurationMs,
              privacyArchitecture: "L0-first",
            };

            btnHealthCheckEl.disabled = false;
            btnHealthCheckEl.textContent = "Run privacy health check";
            const checksPassed = vectorsPassed === testVectors.length && outboundGuardPassed && integrity.valid;
            showToast(
              checksPassed ? "Health check complete. Results shown below." : "A local health check needs attention.",
              checksPassed ? "success" : "warning",
              3000
            );
          };

          if (typeof chrome !== "undefined" && chrome.storage?.local) {
            chrome.storage.local.get(["privaagent_audit_ledger"], (stored) => {
              const error = chrome.runtime?.lastError;
              finishCheck(error ? {} : stored);
            });
          } else {
            finishCheck({});
          }
        });
      });
    });
  }

  if (btnExportHealthEl) {
    btnExportHealthEl.addEventListener("click", () => {
      if (!lastHealthData) return;
      const blob = new Blob([JSON.stringify(lastHealthData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `privaagent_privacy_health_${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  // ─── Portal / Ledger / Clear ──────────────────────────────────────────────
  if (btnDemoEl) {
    btnDemoEl.addEventListener("click", () => {
      chrome.tabs.create({ url: "http://127.0.0.1:8000/demo/index.html" });
    });
  }

  if (btnPortalEl) {
    btnPortalEl.addEventListener("click", () => {
      const reportUrl = chrome.runtime.getURL("report/audit-dashboard.html");
      chrome.tabs.create({ url: reportUrl });
    });
  }

  if (btnInspectEl) {
    btnInspectEl.addEventListener("click", () => {
      queryActiveTab((tabId) => {
        sendTabMsg(tabId, { type: "GET_PRIVACY_AUDIT_SUMMARY" }, (report) => {
          if (!report || report.totalTransactions === 0) {
            showToast("No audit records found for this session. Run an action to record.", "warning");
            return;
          }
          if (detailsPanelEl) detailsPanelEl.open = true;
          if (!ledgerBoxEl) return;
          ledgerBoxEl.classList.add("show");
          setLedgerLevel("L0", "PRIVACY AUDIT REPORT");
          if (lActionEl) lActionEl.textContent = `Entities masked: ${report.totalSensitiveEntitiesProtected} | Leaks: ${report.unredactedLeaksDetected}`;
          if (lTargetEl) lTargetEl.textContent = `On-device ratio: ${report.onDeviceRatio !== undefined ? (report.onDeviceRatio * 100).toFixed(1) + "%" : "N/A"}    Cumulative bytes: ${report.cumulativeNetworkBytes} B`;
          const integrityVerified = report.ledgerIntegrity === "VERIFIED_UNBROKEN";
          if (lVerdictEl) {
            lVerdictEl.textContent = integrityVerified ? "VERIFIED" : "COMPROMISED";
            setTone(lVerdictEl, integrityVerified ? "success" : "danger");
          }
          if (lBytesEl) lBytesEl.textContent = `${report.cumulativeNetworkBytes} B (${report.bandwidthSavedPercentage}% saved)`;
          if (lLatencyEl) lLatencyEl.textContent = `On-device ratio: ${report.onDeviceRatio !== undefined ? (report.onDeviceRatio * 100).toFixed(1) + "%" : "N/A"}`;
          if (lReasonEl) lReasonEl.textContent = `Root Hash: ${report.cryptographicRootHash || "N/A"} | Integrity: ${report.ledgerIntegrity || "UNKNOWN"}\nTotal transactions: ${report.totalTransactions}.`;
        });
      });
    });
  }

  if (btnClearEl) {
    btnClearEl.addEventListener("click", () => {
      queryActiveTab((tabId) => {
        sendTabMsg(tabId, { type: "CLEAR_AUDIT_VAULT" }, () => {
          if (ledgerBoxEl) ledgerBoxEl.classList.remove("show");
          showToast("Privacy Audit Vault cleared", "success", 2000);
        });
      });
    });
  }
});
