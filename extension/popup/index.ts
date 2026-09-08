// Privaagent Popup Controller

console.log("[Privaagent Popup] Popup opened");

document.addEventListener("DOMContentLoaded", () => {
  const statusInfo = document.getElementById("status-info");
  if (statusInfo) {
    statusInfo.textContent = "Extension MV3 Core active. Ready for local perception & disclosure.";
  }
});
