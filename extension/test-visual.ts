import { JSDOM } from "jsdom";
import { createCanvas, Image } from "@napi-rs/canvas";
import { detectFacesInCrop } from "./src/perception/face-detector";
import { analyzeCanvasPixels } from "./src/perception/cv-analyzer";
import { detectVisualSensitivity } from "./src/perception/visual-sensitivity";
import { PageState } from "./src/common/types";
import { PixelCrop } from "./src/perception/browser-state";
import * as fs from "fs";

// Setup JSDOM to mock the environment for detectVisualSensitivity
const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <svg id="test-avatar" aria-label="Customer Profile Photo" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="40" fill="#facc15" />
  </svg>
</body></html>`, { url: "http://localhost" });

(global as any).window = dom.window;
(global as any).document = dom.window.document;
(global as any).Image = Image;
(global as any).setTimeout = setTimeout;

// No mock needed; resolveElementByTargetId will use JSDOM document.querySelector

// Mock createImageBitmap for the full integration test
(global as any).fetch = async (url: string) => {
  return {
    blob: async () => url // Pass data URL as blob fake
  };
};

(global as any).createImageBitmap = async (blob: any) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = blob; // which is the data URL
  });
};

const originalCreateElement = dom.window.document.createElement.bind(dom.window.document);
dom.window.document.createElement = function(tagName: string) {
  if (tagName.toLowerCase() === "canvas") {
    return createCanvas(300, 300) as any;
  }
  return originalCreateElement(tagName);
};

async function runFaceTest(testName: string, type: 'light'|'medium'|'brown'|'dark'|'tan_rect'|'wood'|'beige_bg'|'warm_chart'|'white') {
  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext("2d");
  
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 100, 100);

  let isFace = false;

  if (type === 'light') {
    ctx.fillStyle = "rgb(255, 224, 189)";
    isFace = true;
  } else if (type === 'medium') {
    ctx.fillStyle = "rgb(234, 192, 134)";
    isFace = true;
  } else if (type === 'brown') {
    ctx.fillStyle = "rgb(141, 85, 36)";
    isFace = true;
  } else if (type === 'dark') {
    ctx.fillStyle = "rgb(61, 34, 15)";
    isFace = true;
  } else if (type === 'tan_rect') {
    ctx.fillStyle = "rgb(210, 180, 140)"; // Tan, skin-like color but a rectangle
    ctx.fillRect(20, 20, 60, 60);
  } else if (type === 'wood') {
    ctx.fillStyle = "rgb(133, 94, 66)";
    ctx.fillRect(0, 0, 100, 100);
    // Add some grain lines
    ctx.strokeStyle = "rgb(100, 60, 30)";
    ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(100, 30); ctx.stroke();
  } else if (type === 'beige_bg') {
    ctx.fillStyle = "rgb(245, 245, 220)";
    ctx.fillRect(0, 0, 100, 100);
  } else if (type === 'warm_chart') {
    ctx.fillStyle = "rgb(255, 99, 71)"; // Tomato red bar
    ctx.fillRect(40, 20, 20, 80);
  } else if (type === 'faceless_blob') {
    ctx.fillStyle = "rgb(234, 192, 134)";
    isFace = true; // but we will skip eyes
  }

  if (isFace) {
    ctx.beginPath();
    ctx.ellipse(50, 50, 30, 40, 0, 0, 2 * Math.PI);
    ctx.fill();

    if (type !== 'faceless_blob') {
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.arc(35, 40, 5, 0, 2 * Math.PI);
      ctx.arc(65, 40, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  const crop: PixelCrop = {
    canvas: canvas as any,
    width: 100,
    height: 100,
    boundingBox: [0, 0, 100, 100],
    toDataURL: (t) => canvas.toDataURL(t) as string,
    getImageData: () => ctx.getImageData(0, 0, 100, 100) as any
  };

  const res = await detectFacesInCrop(crop, undefined);
  console.log(`[Face Detector] ${testName}:`, res.faces.length > 0 ? `DETECTED (score: ${res.faces[0].score.toFixed(2)})` : 'NEGATIVE');
}

function runChartTest() {
  const canvas = createCanvas(400, 300);
  const ctx = canvas.getContext("2d");
  
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 400, 300);

  const bars = [
    { x: 40, w: 40, h: 100, color: "#38bdf8" },
    { x: 123, w: 40, h: 150, color: "#60a5fa" },
    { x: 206, w: 40, h: 80, color: "#818cf8" },
    { x: 289, w: 40, h: 200, color: "#3b82f6" }
  ];

  for (const b of bars) {
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, 300 - b.h, b.w, b.h);
  }

  const comps = analyzeCanvasPixels(canvas as any, {
    viewportOffset: [0, 0],
    minComponentWidth: 10,
    minComponentHeight: 10
  });

  console.log(`[CV Analyzer] Chart test components found:`, comps.length);
  if (comps.length > 0) {
    console.log(`              Example: ${comps[0].role} at ${JSON.stringify(comps[0].bbox)}`);
  }
}

async function runIntegrationTest() {
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 800, 600);
  
  // Draw something in the crop area
  ctx.fillStyle = "rgb(234, 192, 134)"; 
  ctx.beginPath();
  ctx.ellipse(150, 150, 30, 40, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(135, 140, 5, 0, 2 * Math.PI);
  ctx.arc(165, 140, 5, 0, 2 * Math.PI);
  ctx.fill();

  const dataUrl = canvas.toDataURL();

  const pageState: PageState = {
    url: "http://localhost",
    title: "Test",
    timestamp: Date.now(),
    viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0 },
    elements: [
      {
        target_id: "test-avatar", // from JSDOM
        role: "img", // or svg
        text: "",
        bbox: [100, 100, 100, 100],
        confidence: 1,
        sensitive: false,
        task_relevance: 0,
        sources: ["dom"],
        interactable: false,
      },
    ],
  };

  const results = await detectVisualSensitivity(pageState, dataUrl);
  console.log("[Integration] Result with screenshot data:", results.get("test-avatar"));
  
  const pageStateNoPixels: PageState = {
    ...pageState,
    elements: [{ ...pageState.elements[0], target_id: "test-avatar-2" }]
  };
  
  const resultsNoPixels = await detectVisualSensitivity(pageStateNoPixels, undefined);
  console.log("[Integration] Result without screenshot data:", resultsNoPixels.get("test-avatar-2"));

  // 3. Test half off-screen (scrolled)
  const pageStateHalfOff: PageState = {
    ...pageState,
    elements: [{ ...pageState.elements[0], target_id: "test-avatar-3", bbox: [-20, -10, 100, 100] }]
  };
  const resultsHalfOff = await detectVisualSensitivity(pageStateHalfOff, dataUrl);
  console.log("[Integration] Result half off-screen (should crop correctly):", resultsHalfOff.get("test-avatar-3"));

  // 4. Test fully off-screen (too small intersection)
  const pageStateFullyOff: PageState = {
    ...pageState,
    elements: [{ ...pageState.elements[0], target_id: "test-avatar-4", bbox: [-95, -95, 100, 100] }] // only 5x5 visible
  };
  const resultsFullyOff = await detectVisualSensitivity(pageStateFullyOff, dataUrl);
  console.log("[Integration] Result fully off-screen:", resultsFullyOff.get("test-avatar-4"));
}

async function runSvgTest() {
  const svg = `<svg id="user-avatar" width="48" height="48" viewBox="0 0 48 48" role="img" aria-label="Customer Profile Photo" style="border-radius: 50%; background: #e0f2fe;">
    <circle cx="24" cy="24" r="20" fill="#fed7aa" />
    <circle cx="18" cy="20" r="2.5" fill="#1e293b" />
    <circle cx="30" cy="20" r="2.5" fill="#1e293b" />
    <path d="M 24 22 L 23 26 L 25 26 Z" fill="#ea580c" />
    <path d="M 18 29 Q 24 35 30 29" stroke="#1e293b" stroke-width="2" fill="none" stroke-linecap="round" />
    <path d="M 10 18 Q 24 6 38 18 Q 24 12 10 18 Z" fill="#451a03" />
  </svg>`;
  
  const canvas = createCanvas(48, 48);
  const ctx = canvas.getContext("2d");
  
  // Render SVG to napi-rs/canvas manually since napi-rs doesn't load SVG strings directly well
  ctx.fillStyle = "#e0f2fe";
  ctx.fillRect(0, 0, 48, 48);

  ctx.fillStyle = "#fed7aa";
  ctx.beginPath();
  ctx.arc(24, 24, 20, 0, Math.PI*2);
  ctx.fill();

  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.arc(18, 20, 2.5, 0, Math.PI*2);
  ctx.fill();
  
  ctx.beginPath();
  ctx.arc(30, 20, 2.5, 0, Math.PI*2);
  ctx.fill();

  ctx.fillStyle = "#ea580c";
  ctx.beginPath();
  ctx.moveTo(24, 22); ctx.lineTo(23, 26); ctx.lineTo(25, 26);
  ctx.fill();

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(18, 29);
  ctx.quadraticCurveTo(24, 35, 30, 29);
  ctx.stroke();

  ctx.fillStyle = "#451a03";
  ctx.beginPath();
  ctx.moveTo(10, 18);
  ctx.quadraticCurveTo(24, 6, 38, 18);
  ctx.quadraticCurveTo(24, 12, 10, 18);
  ctx.fill();

  const crop: PixelCrop = {
    canvas: canvas as any,
    width: 48,
    height: 48,
    boundingBox: [0, 0, 48, 48],
    toDataURL: (t) => canvas.toDataURL(t) as string,
    getImageData: () => ctx.getImageData(0, 0, 48, 48) as any
  };

  // 1. Run purely on pixels (element=undefined)
  const resPixels = await detectFacesInCrop(crop, undefined);
  console.log(`[Face Detector] Real SVG (Pixels Only):`, resPixels.faces.length > 0 ? `DETECTED (score: ${resPixels.faces[0].score.toFixed(2)})` : 'NEGATIVE');
  
  // 2. Run with SVG DOM element attached
  const domEl = dom.window.document.createElement("div");
  domEl.innerHTML = svg;
  const resVector = await detectFacesInCrop(crop, domEl.firstElementChild!);
  console.log(`[Face Detector] Real SVG (With Vector DOM):`, resVector.faces.length > 0 ? `DETECTED (score: ${resVector.faces[0].score.toFixed(2)})` : 'NEGATIVE');
}

async function run() {
  await runFaceTest('Light Skin', 'light');
  await runFaceTest('Medium Skin', 'medium');
  await runFaceTest('Brown Skin', 'brown');
  await runFaceTest('Dark Skin', 'dark');
  await runFaceTest('Tan Rectangle', 'tan_rect');
  await runFaceTest('Wood Texture', 'wood');
  await runFaceTest('Beige Background', 'beige_bg');
  await runFaceTest('Warm Chart', 'warm_chart');
  await runFaceTest('Faceless Skin Blob', 'faceless_blob');
  
  console.log("-------------------");
  await runSvgTest();

  console.log("-------------------");
  runChartTest();
  
  console.log("-------------------");
  await runIntegrationTest();
}

run().catch(console.error);
