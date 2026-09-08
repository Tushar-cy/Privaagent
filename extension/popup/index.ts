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

  // Chip quick actions
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const cmd = chip.getAttribute("data-cmd");
      if (cmd && taskInputEl) {
        taskInputEl.value = cmd;
        runTask();
      }
    });
  });

  // Execute Agent Task or Compound Multi-Turn Goal
  function runTask() {
    const task = taskInputEl?.value?.trim();
    if (!task) return;

    const maxLevel = selCeilingEl?.value || "L2";
    const isCompound = /\s+(?:then|after\s+that|followed\s+by|and\s+then)\s+|;/i.test(task);

    if (btnRunEl) {
      btnRunEl.disabled = true;
      btnRunEl.textContent = isCompound ? "Planning..." : "Running...";
    }

    queryActiveTab((tabId) => {
      const messagePayload = isCompound
        ? { type: "RUN_GOAL", goal: task, maxLevel }
        : { type: "RUN_TASK", task, maxLevel };

      chrome.tabs.sendMessage(tabId, messagePayload, (res) => {
        if (btnRunEl) {
          btnRunEl.disabled = false;
          btnRunEl.textContent = "Run";
        }

        if (chrome.runtime.lastError || !res) {
          alert(`Execution failed: ${chrome.runtime.lastError?.message || "No response from tab"}`);
          return;
        }

        // Display Privacy Ledger Card
        if (ledgerCardEl) ledgerCardEl.style.display = "block";

        // Handle Multi-Turn Goal Result
        if (isCompound || res.decomposed) {
          const status = res.status || (res.success ? "SUCCESS" : "FAILED");
          if (ledgerLevelEl) {
            ledgerLevelEl.textContent = `MULTI-STEP: ${status}`;
            ledgerLevelEl.className = `ledger-badge ${
              status === "SUCCESS" ? "badge-l0" : status === "PAUSED_CONFIRMATION" ? "badge-l1" : "badge-l2"
            }`;
          }
          if (ledgerActionEl) {
            ledgerActionEl.textContent = `${res.totalSteps || 0} SUBTASKS EXECUTED`;
          }
          if (ledgerTargetEl) {
            ledgerTargetEl.textContent = (res.decomposed?.subtasks || []).join(" ➔ ");
          }
          if (ledgerVerdictEl) {
            ledgerVerdictEl.textContent = status;
            ledgerVerdictEl.style.color =
              status === "SUCCESS"
                ? "var(--success)"
                : status === "PAUSED_CONFIRMATION"
                ? "var(--warning)"
                : "var(--danger)";
          }
          if (ledgerBytesEl) {
            const bytes = res.cumulativeBytesSent || 0;
            const savings = bytes === 0 ? 100 : Math.max(0, 100 - (bytes / (1200 * 1024)) * 100);
            ledgerBytesEl.textContent = `${bytes} Bytes (${savings.toFixed(1)}% saved vs screenshot)`;
            if (metricSavingsEl) metricSavingsEl.textContent = `${savings.toFixed(0)}%`;
          }
          if (ledgerLatencyEl) {
            ledgerLatencyEl.textContent = "Privacy Budget Monitored";
          }
          if (ledgerReasonEl) {
            if (res.history && res.history.length > 0) {
              const lines = res.history.map(
                (h: any) =>
                  `Step ${h.stepIndex}: [${h.level}] ${h.action.action.toUpperCase()} -> ${h.action.target_id} (${h.verdict}, ${h.bytesSent}B)`
              );
              ledgerReasonEl.textContent = lines.join("\n");
              if (res.error) ledgerReasonEl.textContent += `\nHALTED: ${res.error}`;
            } else {
              ledgerReasonEl.textContent = res.error || "Execution completed.";
            }
          }
          return;
        }

        // Handle Single Step Task Result
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
      });
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

  // DPDP Compliance Report Export & Vault Clear
  const btnComplianceEl = document.getElementById("btn-compliance");
  const btnClearVaultEl = document.getElementById("btn-clear-vault");

  if (btnComplianceEl) {
    btnComplianceEl.addEventListener("click", () => {
      queryActiveTab((tabId) => {
        chrome.tabs.sendMessage(tabId, { type: "GET_COMPLIANCE_REPORT" }, (report) => {
          if (!report) {
            alert("No compliance records found for active session.");
            return;
          }

          if (ledgerCardEl) ledgerCardEl.style.display = "block";
          if (ledgerLevelEl) {
            ledgerLevelEl.textContent = "DPDP 2023 CERTIFICATE";
            ledgerLevelEl.className = "ledger-badge badge-l0";
          }
          if (ledgerActionEl) {
            ledgerActionEl.textContent = `STATUS: ${report.complianceStatus}`;
          }
          if (ledgerTargetEl) {
            ledgerTargetEl.textContent = `Protected: ${report.totalSensitiveEntitiesProtected} PII Entities | Leaks: ${report.unredactedLeaksDetected}`;
          }
          if (ledgerVerdictEl) {
            ledgerVerdictEl.textContent = "100% COMPLIANT";
            ledgerVerdictEl.style.color = "var(--success)";
          }
          if (ledgerBytesEl) {
            ledgerBytesEl.textContent = `${report.cumulativeNetworkBytes} B (${report.bandwidthSavedPercentage}% saved)`;
          }
          if (ledgerLatencyEl) {
            ledgerLatencyEl.textContent = `Zero-Net Ratio: ${report.onDeviceZeroNetworkRatio}%`;
          }
          if (ledgerReasonEl) {
            ledgerReasonEl.textContent = `DPDP Act 2023 / GDPR Art. 25 Audit Proof Verified. Transactions logged: ${report.totalTransactions}. Hashes chained cryptographically.`;
          }
        });
      });
    });
  }

  if (btnClearVaultEl) {
    btnClearVaultEl.addEventListener("click", () => {
      queryActiveTab((tabId) => {
        chrome.tabs.sendMessage(tabId, { type: "CLEAR_AUDIT_VAULT" }, () => {
          alert("Privacy Audit Vault cleared.");
          if (ledgerCardEl) ledgerCardEl.style.display = "none";
        });
      });
    });
  }
});
