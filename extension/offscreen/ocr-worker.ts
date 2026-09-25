// Privaagent Offscreen OCR Worker
// ================================
// Runs inside the extension-origin offscreen document (chrome.offscreen API).
// The background service worker routes OCR_RECOGNIZE and OCR_WARMUP messages here
// so that Tesseract.js can start a Web Worker without requiring the popup to be open.
//
// Message contract (from background):
//   { type: "OCR_RECOGNIZE_OFFSCREEN", imageDataUrl: string }  → { complete: true, words: Word[] }
//   { type: "OCR_WARM_OFFSCREEN" }                             → { ready: true }
//
// Both responses are forwarded back to the background via sendResponse().

import { initializeOCRWorker, recognizeOCRImage } from "../src/perception/ocr";

chrome.runtime.onMessage.addListener(
  (
    message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ): boolean => {
    const { type } = message;
    if (type !== "OCR_RECOGNIZE_OFFSCREEN" && type !== "OCR_WARM_OFFSCREEN") {
      return false;
    }

    // Only accept messages from our own extension background
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ complete: false, ready: false, error: "Invalid internal OCR request" });
      return false;
    }

    let operation: Promise<unknown>;
    if (type === "OCR_WARM_OFFSCREEN") {
      operation = initializeOCRWorker().then(() => ({ ready: true }));
    } else if (typeof message.imageDataUrl === "string") {
      operation = recognizeOCRImage(message.imageDataUrl).then((words) => ({
        complete: true,
        words,
      }));
    } else {
      sendResponse({ complete: false, error: "OCR_RECOGNIZE_OFFSCREEN did not include an imageDataUrl" });
      return false;
    }

    operation
      .then(sendResponse)
      .catch((err: unknown) =>
        sendResponse({
          complete: false,
          ready: false,
          error: err instanceof Error ? err.message : "Offscreen OCR worker failed",
        })
      );

    // Return true to keep the message channel open for the async response
    return true;
  }
);

console.log("[Privaagent] Offscreen OCR worker document loaded and listening.");
