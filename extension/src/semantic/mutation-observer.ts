// Mutation Observer: Incrementally watches for DOM changes (SPAs, dynamic insertions)
// and debounces updates to preserve low latency.

import { PageState } from "../common/types";
import { extractPageState } from "./dom-extractor";

type PageStateUpdateCallback = (pageState: PageState, durationMs: number) => void;

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY_MS = 50;

/**
 * Initializes the DOM MutationObserver to detect dynamic page state changes.
 */
export function startObservingDOM(onUpdate: PageStateUpdateCallback): void {
  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver((mutations) => {
    // Filter out internal Privaagent mutations (e.g. redaction overlays)
    const hasExternalMutations = mutations.some((mutation) => {
      const target = mutation.target as HTMLElement;
      if (
        target.id?.startsWith("privaagent-") ||
        target.className?.includes?.("privaagent-")
      ) {
        return false;
      }
      return true;
    });

    if (!hasExternalMutations) return;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      const result = extractPageState();
      onUpdate(result.pageState, result.durationMs);
    }, DEBOUNCE_DELAY_MS);
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "disabled", "hidden", "aria-hidden", "value"],
      characterData: true,
    });
  }
}

/**
 * Stops observing DOM mutations.
 */
export function stopObservingDOM(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
