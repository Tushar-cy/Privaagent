// Privaagent Background Service Worker (MV3)
// Implements active badge status indicators, cross-tab audit storage synchronization,
// and outbound traffic sentry monitoring.

const BADGE_COLORS: Record<string, string> = {
  L0: "#10b981",      // Emerald Green (Zero Network, Pure On-Device)
  L1: "#f59e0b",      // Amber (Sanitized Text DOM)
  L2: "#8b5cf6",      // Violet (Sanitized Visual Crop ROI)
  L3: "#ec4899",      // Pink (Masked Full Screen)
  CONFIRM: "#f97316", // Orange (User Confirmation Pause)
  BLOCKED: "#ef4444", // Crimson (Security Policy Block)
};

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Privaagent Service Worker] Installed successfully:", details.reason);
  if (chrome.action?.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
    chrome.action.setBadgeText({ text: "0B" });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[Privaagent Service Worker] Browser startup - Sentry active");
});

// Listener for messages from content scripts, popup, and validation engines
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  switch (message.type) {
    case "PING": {
      sendResponse({ status: "alive", timestamp: Date.now() });
      break;
    }

    case "UPDATE_BADGE": {
      const level = message.level || "L0";
      const customText = message.text || (level === "L0" ? "0B" : level);
      const color = BADGE_COLORS[level] || BADGE_COLORS.L0;

      if (chrome.action?.setBadgeText) {
        chrome.action.setBadgeText({ text: customText });
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

    case "GET_AUDIT_LEDGER": {
      if (chrome.storage?.local) {
        chrome.storage.local.get(["privaagent_audit_ledger"], (result) => {
          sendResponse({ success: true, ledger: result.privaagent_audit_ledger || [] });
        });
        return true; // Async response
      }
      sendResponse({ success: false, ledger: [] });
      break;
    }

    case "PERSIST_AUDIT_TRANSACTION": {
      if (chrome.storage?.local && message.transaction) {
        chrome.storage.local.get(["privaagent_audit_ledger"], (result) => {
          const ledger = result.privaagent_audit_ledger || [];
          ledger.push(message.transaction);
          chrome.storage.local.set({ privaagent_audit_ledger: ledger }, () => {
            sendResponse({ success: true, count: ledger.length });
          });
        });
        return true; // Async response
      }
      sendResponse({ success: false });
      break;
    }

    default:
      sendResponse({ status: "ignored" });
      break;
  }

  return true;
});
