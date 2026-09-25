// Privaagent Background Service Worker (MV3)
// Implements active badge status indicators, cross-tab audit storage synchronization,
// and outbound traffic sentry monitoring.

const BADGE_COLORS: Record<string, string> = {
  L0: "#10b981",      // Emerald Green (Zero Network, Pure On-Device)
  L1: "#f59e0b",      // Amber (Sanitized Text DOM)
  L2: "#8b5cf6",      // Violet (Sanitized Visual Crop ROI)
  L3: "#ec4899",      // Pink (Masked Full Screen)
  CONFIRM: "#f97316", // Orange (User Confirmation Pause)
  BLOCKED: "#6b7280", // Grey (Shield OFF or blocked)
  OFF: "#6b7280",     // Grey (Shield disabled by user)
};

function sendPopupOCRMessage(message: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error || !response) reject(new Error(error?.message || "The Privaagent popup did not respond to the OCR request"));
      else resolve(response);
    });
  });
}

function sendOCRStatus(tabId: number, status: "loading" | "ready" | "error"): void {
  chrome.tabs.sendMessage(tabId, { type: "OCR_WORKER_STATUS", status }, () => {
    void chrome.runtime.lastError;
  });
}

let sessionTokenProvisioning = false;

const PRIVACY_BUDGET_LIMITS = {
  maxCumulativeBytes: 50 * 1024,
  maxRemoteCalls: 4,
  maxSteps: 8,
};

interface StoredTabBudget {
  cumulativeBytesSent: number;
  remoteCallsMade: number;
  stepsExecuted: number;
}

const tabBudgetQueues = new Map<number, Promise<unknown>>();

function sessionBudgetKey(tabId: number): string {
  return `privaagent_privacy_budget_tab_${tabId}`;
}

function readSessionStorage(key: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.session.get(key, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

function writeSessionStorage(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function normalizeStoredBudget(value: unknown): StoredTabBudget {
  const candidate = value && typeof value === "object" ? value as Partial<StoredTabBudget> : {};
  return {
    cumulativeBytesSent: Number.isFinite(candidate.cumulativeBytesSent) ? Math.max(0, Number(candidate.cumulativeBytesSent)) : 0,
    remoteCallsMade: Number.isFinite(candidate.remoteCallsMade) ? Math.max(0, Number(candidate.remoteCallsMade)) : 0,
    stepsExecuted: Number.isFinite(candidate.stepsExecuted) ? Math.max(0, Number(candidate.stepsExecuted)) : 0,
  };
}

function budgetStatus(budget: StoredTabBudget, reason?: string) {
  return {
    exceeded: Boolean(reason),
    cumulativeBytesSent: budget.cumulativeBytesSent,
    remoteCallsMade: budget.remoteCallsMade,
    stepsExecuted: budget.stepsExecuted,
    maxCumulativeBytes: PRIVACY_BUDGET_LIMITS.maxCumulativeBytes,
    maxRemoteCalls: PRIVACY_BUDGET_LIMITS.maxRemoteCalls,
    maxSteps: PRIVACY_BUDGET_LIMITS.maxSteps,
    reason,
  };
}

async function updateTabBudget(
  tabId: number,
  operation: "status" | "step" | "remote",
  estimatedBytes = 0
): Promise<{ allowed: boolean; budget: ReturnType<typeof budgetStatus> }> {
  const previous = tabBudgetQueues.get(tabId) || Promise.resolve();
  let result: { allowed: boolean; budget: ReturnType<typeof budgetStatus> } | null = null;
  const operationPromise = previous.catch(() => undefined).then(async () => {
    const key = sessionBudgetKey(tabId);
    const stored = await readSessionStorage(key);
    const budget = normalizeStoredBudget(stored[key]);
    let reason: string | undefined;

    if (operation === "step") {
      if (budget.stepsExecuted >= PRIVACY_BUDGET_LIMITS.maxSteps) {
        reason = `Tab session step limit reached (${budget.stepsExecuted}/${PRIVACY_BUDGET_LIMITS.maxSteps}).`;
      } else {
        budget.stepsExecuted++;
      }
    } else if (operation === "remote") {
      if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0) {
        reason = "Invalid outbound byte estimate; request was not sent.";
      } else if (budget.remoteCallsMade >= PRIVACY_BUDGET_LIMITS.maxRemoteCalls) {
        reason = `Tab session remote-call limit reached (${budget.remoteCallsMade}/${PRIVACY_BUDGET_LIMITS.maxRemoteCalls}).`;
      } else if (budget.cumulativeBytesSent + estimatedBytes > PRIVACY_BUDGET_LIMITS.maxCumulativeBytes) {
        reason = `Tab session privacy budget would exceed ${PRIVACY_BUDGET_LIMITS.maxCumulativeBytes} bytes.`;
      } else {
        budget.remoteCallsMade++;
        budget.cumulativeBytesSent += estimatedBytes;
      }
    }

    if (operation !== "status" && !reason) await writeSessionStorage({ [key]: budget });
    result = { allowed: !reason, budget: budgetStatus(budget, reason) };
  });
  tabBudgetQueues.set(tabId, operationPromise);
  try {
    await operationPromise;
  } finally {
    if (tabBudgetQueues.get(tabId) === operationPromise) tabBudgetQueues.delete(tabId);
  }
  return result!;
}

chrome.tabs?.onRemoved?.addListener((tabId) => {
  tabBudgetQueues.delete(tabId);
  chrome.storage.session.remove(sessionBudgetKey(tabId), () => { void chrome.runtime.lastError; });
});

function ensureSessionToken(): void {
  if (sessionTokenProvisioning) return;
  sessionTokenProvisioning = true;
  chrome.storage.local.get(["privaagent_session_token"], (result) => {
    if (result?.privaagent_session_token) {
      sessionTokenProvisioning = false;
      return;
    }
    const token = "sih_" + crypto.randomUUID().replace(/-/g, "");
    chrome.storage.local.set({ privaagent_session_token: token }, () => {
      sessionTokenProvisioning = false;
      console.log("[Privaagent Security] Generated a missing per-install session token.");
    });
  });
}

// Service workers may start without a fresh onInstalled event (for example,
// after extension storage was cleared). Provision before any request is made.
ensureSessionToken();

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Privaagent Service Worker] Installed successfully:", details.reason);
  if (chrome.action?.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
    chrome.action.setBadgeText({ text: "ON" });
  }
  
  chrome.storage.local.set({ privaagent_shield_enabled: true });
  ensureSessionToken();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[Privaagent Service Worker] Browser startup - Sentry active");
  ensureSessionToken();
  // Re-apply badge color on startup
  chrome.action?.setBadgeBackgroundColor?.({ color: "#10b981" });

  // Auto-restore audit ledger from persistent storage so in-memory AuditVault
  // is seeded even if the browser was restarted between sessions.
  if (chrome.storage?.local) {
    chrome.storage.local.get(["privaagent_audit_ledger"], (result) => {
      const ledger = result.privaagent_audit_ledger;
      if (Array.isArray(ledger) && ledger.length > 0) {
        // Broadcast to all tabs so content-script AuditVault instances can restore state
        chrome.runtime.sendMessage({ type: "RESTORE_AUDIT_LEDGER", ledger }).catch(() => {});
        console.log(`[Privaagent Service Worker] Restored ${ledger.length} audit record(s) from storage.`);
      }
    });
  }
});


// Listener for messages from content scripts, popup, and validation engines
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  switch (message.type) {
    case "GET_PRIVACY_BUDGET":
    case "RESERVE_PRIVACY_STEP":
    case "RESERVE_PRIVACY_REMOTE": {
      const tabId = sender.tab?.id;
      if (!Number.isInteger(tabId)) {
        sendResponse({ allowed: false, error: "Privacy budget requests require an active browser tab." });
        break;
      }
      const operation = message.type === "GET_PRIVACY_BUDGET"
        ? "status"
        : message.type === "RESERVE_PRIVACY_STEP" ? "step" : "remote";
      updateTabBudget(tabId!, operation, Number(message.estimatedBytes || 0))
        .then(sendResponse)
        .catch(() => sendResponse({ allowed: false, error: "Could not update the tab privacy budget; request was not sent." }));
      return true;
    }

    case "PING": {
      sendResponse({ status: "alive", timestamp: Date.now() });
      break;
    }

    case "CAPTURE_TAB": {
      const targetWindowId = sender.tab?.windowId ?? chrome.windows?.WINDOW_ID_CURRENT;
      if (chrome.tabs?.captureVisibleTab) {
        chrome.tabs.captureVisibleTab(
          targetWindowId,
          { format: "png" },
          (dataUrl) => {
            if (chrome.runtime.lastError || !dataUrl) {
              const errMsg = chrome.runtime.lastError?.message || "Failed to capture visible tab";
              console.warn("[Privaagent Service Worker] Tab capture failed:", errMsg);
              sendResponse({ success: false, error: errMsg });
            } else {
              sendResponse({ success: true, dataUrl });
            }
          }
        );
        return true;
      } else {
        sendResponse({ success: false, error: "chrome.tabs.captureVisibleTab API unavailable" });
      }
      break;
    }

    case "OCR_RECOGNIZE": {
      console.debug("[OCR background] Received on-device OCR request.");
      if (!sender.tab?.id || typeof message.imageDataUrl !== "string") {
        sendResponse({ complete: false, error: "OCR requests are accepted only from a browser tab" });
        break;
      }
      const tabId = sender.tab.id;
      sendOCRStatus(tabId, "loading");
      sendPopupOCRMessage({ type: "OCR_RECOGNIZE_POPUP", imageDataUrl: message.imageDataUrl })
        .then((result) => {
          sendOCRStatus(tabId, result?.complete ? "ready" : "error");
          sendResponse(result);
        })
        .catch((error: unknown) => {
          sendOCRStatus(tabId, "error");
          sendResponse({
            complete: false,
            error: error instanceof Error ? error.message : "Extension popup OCR is unavailable",
          });
        });
      return true;
    }

    case "OCR_WARMUP": {
      console.debug("[OCR background] Received OCR warmup request.");
      if (!sender.tab?.id) {
        sendResponse({ ready: false, error: "OCR warmup must be requested by a browser tab" });
        break;
      }
      const tabId = sender.tab.id;
      sendOCRStatus(tabId, "loading");
      sendPopupOCRMessage({ type: "OCR_WARM_POPUP" })
        .then((result) => {
          sendOCRStatus(tabId, result?.ready ? "ready" : "error");
          sendResponse(result);
        })
        .catch((error: unknown) => {
          sendOCRStatus(tabId, "error");
          sendResponse({ ready: false, error: error instanceof Error ? error.message : "Extension popup OCR is unavailable" });
        });
      return true;
    }

    case "UPDATE_BADGE": {
      const level = message.level || "L0";
      const customText = message.text || (level === "L0" ? "ON" : level);
      const color = BADGE_COLORS[level] || BADGE_COLORS.L0;

      if (chrome.action?.setBadgeText) {
        chrome.action.setBadgeText({ text: String(customText).slice(0, 4) });
        chrome.action.setBadgeBackgroundColor({ color });
      }
      sendResponse({ success: true, badge: customText, color });
      break;
    }

    case "CLEAR_BADGE": {
      if (chrome.action?.setBadgeText) {
        chrome.action.setBadgeText({ text: "" });
      }
      sendResponse({ success: true });
      break;
    }

    // Shield ON/OFF state — persisted via chrome.storage.local
    case "SET_SHIELD_STATE": {
      const enabled = Boolean(message.enabled);
      chrome.storage.local.set({ privaagent_shield_enabled: enabled }, () => {
        if (chrome.action?.setBadgeText) {
          chrome.action.setBadgeText({ text: enabled ? "ON" : "OFF" });
          chrome.action.setBadgeBackgroundColor({
            color: enabled ? "#10b981" : "#6b7280",
          });
        }
        sendResponse({ success: true, enabled });
      });
      return true;
    }

    case "GET_SHIELD_STATE": {
      chrome.storage.local.get(["privaagent_shield_enabled"], (result) => {
        const enabled = result.privaagent_shield_enabled !== false; // default true
        sendResponse({ success: true, enabled });
      });
      return true;
    }

    case "GET_AUDIT_LEDGER": {
      if (chrome.storage?.local) {
        chrome.storage.local.get(["privaagent_audit_ledger"], (result) => {
          sendResponse({ success: true, ledger: result.privaagent_audit_ledger || [] });
        });
        return true;
      }
      sendResponse({ success: false, ledger: [] });
      break;
    }

    case "PERSIST_AUDIT_TRANSACTION": {
      if (chrome.storage?.local && message.transaction) {
        chrome.storage.local.get(["privaagent_audit_ledger"], (result) => {
          const ledger = result.privaagent_audit_ledger || [];
          ledger.push(message.transaction);
          // Keep ledger to last 500 entries to avoid storage overflow
          const trimmed = ledger.slice(-500);
          chrome.storage.local.set({ privaagent_audit_ledger: trimmed }, () => {
            sendResponse({ success: true, count: trimmed.length });
          });
        });
        return true;
      }
      sendResponse({ success: false });
      break;
    }

    case "RESTORE_AUDIT_LEDGER": {
      // Content scripts receive this on browser startup to re-seed their in-memory AuditVault
      // from chrome.storage persisted records (auto-restore invariant).
      sendResponse({ success: true, received: true });
      break;
    }

    default:
      sendResponse({ status: "ignored" });
      break;
  }

  return false;
});
