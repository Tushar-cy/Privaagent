// Privaagent Popup Controller
// Manages real-time Privacy Ledger, tab communication, task dispatch, and controls.

document.addEventListener("DOMContentLoaded", () => {
  const tabMetaEl = document.getElementById("tab-meta");
  const metricDomEl = document.getElementById("metric-dom");
  const metricPiiEl = document.getElementById("metric-pii");
  const metricSavingsEl = document.getElementById("metric-savings");
  const taskInputEl = document.getElementById("task-input") as HTMLInputElement;
  const btnRunEl = document.getElementById("btn-run") as HTMLButtonElement;
  const chkOverlayEl = document.getElementById("chk-overlay") as HTMLInputElement;
  const selCeilingEl = document.getElementById("sel-ceiling") as HTMLSelectElement;

  const ledgerCardEl = document.getElementById("ledger-card");
  const ledgerLevelEl = document.getElementById("ledger-level");
  const ledgerActionEl = document.getElementById("ledger-action");
  const ledgerTargetEl = document.getElementById("ledger-target");
  const ledgerVerdictEl = document.getElementById("ledger-verdict");
  const ledgerBytesEl = document.getElementById("ledger-bytes");
  const ledgerLatencyEl = document.getElementById("ledger-latency");
  const ledgerReasonEl = document.getElementById("ledger-reason");

  // Query active tab
  function queryActiveTab(callback: (tabId: number) => void) {
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.id) {
          callback(tabs[0].id);
        } else {
          if (tabMetaEl) tabMetaEl.textContent = "Local Benchmark / Standalone Mode";
        }
      });
    } else {
      if (tabMetaEl) tabMetaEl.textContent = "Mock Dev Mode";
    }
  }

  // Fetch initial page state from active tab
  queryActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_STATE" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        if (tabMetaEl) tabMetaEl.textContent = "Unable to connect to active tab content script.";
        return;
      }

      if (tabMetaEl) {
        tabMetaEl.textContent = `${response.title || "Webpage"} (${response.url || ""})`;
      }
      if (metricDomEl) {
        metricDomEl.textContent = `${response.durationMs?.toFixed(1) || 0} ms`;
      }
      if (metricPiiEl) {
        metricPiiEl.textContent = `${response.sensitiveElementsCount || 0}`;
      }
    });
  });

  // Toggle Viewport Overlays
  if (chkOverlayEl) {
    chkOverlayEl.addEventListener("change", () => {
      queryActiveTab((tabId) => {
        chrome.tabs.sendMessage(tabId, {
          type: "TOGGLE_OVERLAYS",
          visible: chkOverlayEl.checked,
        });
      });
    });
  }

  // Execute Agent Task
  function runTask() {
    const task = taskInputEl?.value?.trim();
    if (!task) return;

    const maxLevel = selCeilingEl?.value || "L2";

    if (btnRunEl) {
      btnRunEl.disabled = true;
      btnRunEl.textContent = "Running...";
    }

    queryActiveTab((tabId) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: "RUN_TASK", task, maxLevel },
        (res) => {
          if (btnRunEl) {
            btnRunEl.disabled = false;
            btnRunEl.textContent = "Run";
          }

          if (chrome.runtime.lastError || !res) {
            alert(`Execution failed: ${chrome.runtime.lastError?.message || "No response"}`);
            return;
          }

          // Display Privacy Ledger Card
          if (ledgerCardEl) ledgerCardEl.style.display = "block";

          if (res.resolution) {
            const level = res.resolution.disclosure.level;
            if (ledgerLevelEl) {
              ledgerLevelEl.textContent = `${level} ${level === "L0" ? "LOCAL" : "FALLBACK"}`;
              ledgerLevelEl.className = `ledger-badge badge-${level.toLowerCase()}`;
            }

            if (ledgerActionEl) {
              ledgerActionEl.textContent = res.resolution.action.action.toUpperCase();
            }
            if (ledgerTargetEl) {
              ledgerTargetEl.textContent = res.resolution.action.target_id;
            }
            if (ledgerBytesEl) {
              const bytes = res.resolution.networkBytesSent || 0;
              const savings = bytes === 0 ? 100 : Math.max(0, 100 - (bytes / (1200 * 1024)) * 100);
              ledgerBytesEl.textContent = `${bytes} Bytes (${savings.toFixed(1)}% saved vs screenshot)`;
              if (metricSavingsEl) metricSavingsEl.textContent = `${savings.toFixed(0)}%`;
            }
            if (ledgerLatencyEl) {
              ledgerLatencyEl.textContent = `${res.resolution.latencyMs.toFixed(1)} ms`;
            }
            if (ledgerReasonEl) {
              ledgerReasonEl.textContent = res.resolution.action.reason || "";
            }
          }

          if (res.validation) {
            if (ledgerVerdictEl) {
              ledgerVerdictEl.textContent = res.validation.verdict;
              ledgerVerdictEl.style.color =
                res.validation.verdict === "ALLOW"
                  ? "var(--success)"
                  : res.validation.verdict === "CONFIRM"
                  ? "var(--warning)"
                  : "var(--danger)";
            }
          }

          if (!res.success && res.error) {
            if (ledgerReasonEl) {
              ledgerReasonEl.textContent = `ERROR / POLICY: ${res.error}`;
            }
          }
        }
      );
    });
  }

  if (btnRunEl) {
    btnRunEl.addEventListener("click", runTask);
  }

  if (taskInputEl) {
    taskInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runTask();
    });
  }
});
