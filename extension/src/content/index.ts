// Privaagent Content Script (Injected into web pages)

import { PageState } from "../common/types";

console.log("[Privaagent Content Script] Injected and active on:", window.location.href);

// Quick DOM connectivity check
export function getBasicPageSnapshot(): Partial<PageState> {
  return {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    elements: [],
  };
}

window.addEventListener("DOMContentLoaded", () => {
  console.log("[Privaagent Content Script] DOMContentLoaded on:", window.location.href);
});
