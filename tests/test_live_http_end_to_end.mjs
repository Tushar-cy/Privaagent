// Live End-to-End HTTP Integration Test
// Boots the FastAPI server, tests real network requests over the HTTPS/HTTP boundary,
// validates strict Action schemas and defense-in-depth HTTP 422 rejection of leaked PII.

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const pythonExe = path.resolve(ROOT_DIR, "server/venv/Scripts/python.exe");

console.log("==================================================");
console.log("   PRIVAAGENT LIVE HTTP TRUST BOUNDARY TEST       ");
console.log("==================================================");

// 1. Boot FastAPI Server
console.log("[SETUP] Spawning FastAPI Core backend server on port 8000...");
const serverProcess = spawn(
  pythonExe,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
  { cwd: path.resolve(ROOT_DIR, "server") }
);

serverProcess.stderr.on("data", (data) => {
  // Silence regular access logs, output errors
  const str = data.toString();
  if (str.includes("ERROR") || str.includes("Traceback")) {
    console.error("[SERVER ERROR]", str);
  }
});

// Helper to wait for server health
async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch("http://127.0.0.1:8000/health");
      if (res.ok) return true;
    } catch {
      // Waiting for socket
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

try {
  const isHealthy = await waitForServer();
  if (!isHealthy) {
    throw new Error("FastAPI server failed to start within timeout!");
  }
  console.log("✓ Server online at http://127.0.0.1:8000 (/health: 200 OK)");

  // ----------------------------------------------------
  // TEST 1: Live Sanitized L1 Disclosure Action Resolution
  // ----------------------------------------------------
  console.log("\n[TEST 1] Dispatching Live Sanitized L1 Structured Disclosure...");
  const l1Payload = {
    level: "L1",
    reason: "Complex customer lookup requiring fallback reasoning",
    task: "Open Rahul's invoice",
    elements: [
      {
        target_id: "btn-open-invoice",
        role: "button",
        label: "Open [PERSON_1]'s invoice",
        bounds: [24, 280, 340, 42],
      },
      {
        target_id: "btn-secondary",
        role: "button",
        label: "Cancel [REDACTED]",
        bounds: [24, 340, 100, 36],
      },
    ],
    redacted_token_count: 2,
  };

  const res1 = await fetch("http://127.0.0.1:8000/api/resolve-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(l1Payload),
  });

  if (!res1.ok) {
    throw new Error(`Expected 200 OK from server, got ${res1.status}: ${await res1.text()}`);
  }

  const action1 = await res1.json();
  console.log("  - Server Response Action:", JSON.stringify(action1));
  if (!action1.action || !action1.target_id) {
    throw new Error("Invalid Action schema received from server!");
  }
  console.log("✓ Live L1 resolution passed: Valid Action schema returned over HTTP boundary.");

  // ----------------------------------------------------
  // TEST 2: Live Sanitized L2 Visual Crop Resolution
  // ----------------------------------------------------
  console.log("\n[TEST 2] Dispatching Live Sanitized L2 Visual Crop ROI Disclosure...");
  const l2Payload = {
    level: "L2",
    reason: "Canvas quarterly revenue bar chart requires visual reasoning",
    task: "Click the bar representing Q4",
    crop_box: [450, 80, 380, 220],
    elements: [
      {
        target_id: "revenue-chart_bar_1",
        role: "chart_bar",
        label: "Q1 Revenue [CONFIDENTIAL_VAL]",
        bounds: [490, 185, 48, 75],
      },
      {
        target_id: "revenue-chart_bar_4",
        role: "chart_bar",
        label: "Q4 Revenue [CONFIDENTIAL_VAL]",
        bounds: [739, 115, 48, 145],
      },
    ],
    redacted_token_count: 4,
  };

  const res2 = await fetch("http://127.0.0.1:8000/api/resolve-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(l2Payload),
  });

  if (!res2.ok) {
    throw new Error(`Expected 200 OK, got ${res2.status}: ${await res2.text()}`);
  }

  const action2 = await res2.json();
  console.log("  - Server Response Action:", JSON.stringify(action2));
  if (action2.target_id !== "revenue-chart_bar_4") {
    throw new Error(`Expected target revenue-chart_bar_4, got ${action2.target_id}`);
  }
  console.log("✓ Live L2 resolution passed: Correct Q4 bar targeted over HTTP boundary.");

  // ----------------------------------------------------
  // TEST 3: Defense-in-Depth Rejection of Raw PII Leak
  // ----------------------------------------------------
  console.log("\n[TEST 3] Testing Defense-in-Depth Server-Side Rejection of Leaked PII...");
  const leakedPayload = {
    level: "L1",
    reason: "Test leak verification",
    task: "Check customer details",
    elements: [
      {
        target_id: "user-pan",
        role: "text",
        label: "Customer PAN is ABCDE1234F", // UNREDACTED RAW PAN!
        bounds: [10, 10, 100, 20],
      },
    ],
    redacted_token_count: 0,
  };

  const res3 = await fetch("http://127.0.0.1:8000/api/resolve-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(leakedPayload),
  });

  console.log(`  - Server Response Status: ${res3.status} (Expected: 422 Unprocessable Content)`);
  if (res3.status !== 422) {
    throw new Error(`CRITICAL SECURITY FAILURE: Server accepted leaked raw PII! Status: ${res3.status}`);
  }
  const errorDetail = await res3.json();
  console.log("  - Rejection Reason:", errorDetail.detail);
  console.log("✓ Defense-in-Depth verified: Server strictly rejected unredacted PAN leak with HTTP 422!");

  // ----------------------------------------------------
  // TEST 4: Static File Mounts Verification
  // ----------------------------------------------------
  console.log("\n[TEST 4] Testing FastAPI Static Demonstration Mounts...");
  const demoRes = await fetch("http://127.0.0.1:8000/demo/index.html");
  if (!demoRes.ok || !(await demoRes.text()).includes("Privaagent")) {
    throw new Error("Demo static mount failed!");
  }
  console.log("✓ Static demo portal served successfully at /demo/index.html");

  console.log("\n--------------------------------------------------");
  console.log("[ALL TESTS PASSED] Live HTTP Trust Boundary & Defense-in-Depth fully verified!");
} finally {
  console.log("\n[TEARDOWN] Stopping FastAPI server process...");
  serverProcess.kill("SIGTERM");
}
