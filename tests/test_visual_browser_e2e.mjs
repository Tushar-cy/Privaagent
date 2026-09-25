import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "../extension/node_modules/puppeteer/lib/puppeteer/puppeteer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "privaagent-extension");
let outboundDisclosure = null;

const fixtureHtml = `<!doctype html>
<html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Visual disclosure smoke test</title>
<style>body{font:18px Arial;margin:24px}canvas{display:block;border:1px solid #ccc}</style></head>
<body><h1>Quarterly revenue</h1>
<canvas id="chart" width="900" height="520" role="img" aria-label="Quarterly revenue bar chart, Q1 Q2 Q3 Q4"></canvas>
<script>
const canvas=document.querySelector('#chart'),ctx=canvas.getContext('2d');
ctx.fillStyle='#fff';ctx.fillRect(0,0,900,520);
ctx.fillStyle='#111';ctx.font='bold 38px Arial';ctx.fillText('PAN ABCDE1234F',32,58);
const bars=[['Q1',120],['Q2',210],['Q3',165],['Q4',330]];
bars.forEach(([label,height],index)=>{
  const x=72+index*195,y=430-height;
  ctx.fillStyle='#2878d0';ctx.fillRect(x,y,112,height);
  ctx.fillStyle='#111';ctx.font='bold 34px Arial';ctx.fillText(label,x+18,478);
});
</script></body></html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1:8000");
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": request.headers.origin || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-privaagent-session-token",
    });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/visual-test.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/resolve-action") {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        outboundDisclosure = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const target = outboundDisclosure.elements.find((element) =>
          element.role === "canvas" || element.role === "img");
        if (!target) throw new Error("Visual disclosure contained no bound canvas/image target.");
        response.writeHead(200, {
          "content-type": "application/json",
          "access-control-allow-origin": request.headers.origin || "*",
        });
        response.end(JSON.stringify({
          action: "click",
          target_id: target.target_id,
          reason: "Visual browser smoke test",
          confidence: 0.95,
        }));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(8000, "127.0.0.1", resolve);
});

let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--window-size=1280,900",
    ],
  });

  // Wait for the service worker to register — this is all we need; no popup.
  const serviceWorkerTarget = await browser.waitForTarget((target) =>
    target.type() === "service_worker" && target.url().startsWith("chrome-extension://"),
    { timeout: 20000 }
  );
  const extensionId = new URL(serviceWorkerTarget.url()).host;

  // Open only the test fixture page — the popup is intentionally NOT opened.
  // This validates that OCR runs via the offscreen document which is
  // popup-independent: the background creates it on first OCR_RECOGNIZE
  // if it doesn't already exist.
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:8000/visual-test.html", { waitUntil: "networkidle0" });

  // Give the content script time to initialize
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Send RUN_TASK directly to the content script via the service worker context.
  // The popup is deliberately closed/never opened — this is the gold-standard test:
  //   webpage → RUN_TASK → content script → captureVisibleTab → offscreen OCR
  //   → pixel redaction → L2 disclosure → remote mock → action validation
  const swPage = await serviceWorkerTarget.worker();
  const taskResult = await swPage.evaluate(() => {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ url: "http://127.0.0.1:8000/visual-test.html" }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) return reject(new Error("Could not find the visual fixture tab."));
        chrome.tabs.sendMessage(tab.id, {
          type: "RUN_TASK",
          task: "Click the bar representing Q4",
          maxLevel: "L2",
        }, (result) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(result);
        });
      });
    });
  });

  if (!outboundDisclosure) {
    console.error("Live visual task result:", JSON.stringify(taskResult));
    console.error("Browser errors:", browserErrors.join(" | "));
  }
  assert.ok(outboundDisclosure, `The live visual task must reach the test resolver (popup was NOT opened — OCR runs via offscreen document): ${JSON.stringify(taskResult)}`);
  assert.equal(outboundDisclosure.level, "L2");
  assert.match(outboundDisclosure.screenshot_data || "", /^data:image\/png;base64,/);
  assert.ok(outboundDisclosure.redaction_manifest, "The live request must carry a redaction manifest.");
  assert.ok(outboundDisclosure.redaction_manifest.sourceSensitiveBoxCount > 0,
    `On-device OCR (via offscreen document) must detect the PAN rendered inside the canvas: ${JSON.stringify(outboundDisclosure.redaction_manifest)}; elements=${JSON.stringify(outboundDisclosure.elements)}`);
  assert.ok(outboundDisclosure.redaction_manifest.redactedBoxCount > 0,
    "The detected OCR region must be burned into the captured image.");
  assert.ok(!JSON.stringify(outboundDisclosure).includes("ABCDE1234F"),
    "The raw PAN must not appear in the outgoing disclosure.");
  assert.equal(taskResult?.success, true, `The returned visual target must validate and execute: ${JSON.stringify(taskResult)}`);
  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);
  console.log("✓ Live Chrome capture → offscreen OCR (popup NOT open) → pixel redaction → L2 request → validated action succeeded.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
