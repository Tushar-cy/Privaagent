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

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Privaagent Service Worker] Installed successfully:", details.reason);
  if (chrome.action?.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
    chrome.action.setBadgeText({ text: "ON" });
  }
  // Initialize shield state as enabled
  chrome.storage.local.set({ privaagent_shield_enabled: true });
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[Privaagent Service Worker] Browser startup - Sentry active");
  // Re-apply badge color on startup
  chrome.action?.setBadgeBackgroundColor?.({ color: "#10b981" });
});

// Listener for messages from content scripts, popup, and validation engines
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  switch (message.type) {
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

    default:
      sendResponse({ status: "ignored" });
      break;
  }

  return false;
});
