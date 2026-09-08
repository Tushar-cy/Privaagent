// Privaagent Background Service Worker

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Privaagent Service Worker] alive - extension installed", details);
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[Privaagent Service Worker] alive - browser started");
});

// Listener for messages from content scripts, popup, or validator
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Privaagent Service Worker] received message:", message?.type || message);
  if (message?.type === "PING") {
    sendResponse({ status: "alive", timestamp: Date.now() });
  }
  return true;
});
