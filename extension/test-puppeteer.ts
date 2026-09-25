import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectFacesInCrop } from './src/perception/face-detector.js';
import { JSDOM } from 'jsdom';
import { createCanvas, loadImage as loadNapiImage } from '@napi-rs/canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  const testPagePath = path.resolve(__dirname, '../benchmark/pages/test-page-1.html');
  await page.goto(`file://${testPagePath}`);
  
  // Get bounding box of the avatar
  const bbox = await page.evaluate(() => {
    const el = document.getElementById('user-avatar');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)];
  });

  if (!bbox) {
    console.error("Avatar not found");
    await browser.close();
    return;
  }

  // Screenshot the specific element (pixels)
  const elementHandle = await page.$('#user-avatar');
  const buffer = await elementHandle.screenshot();
  
  // Draw it on a napi-rs canvas to pass to the face detector
  const img = await loadNapiImage(buffer);
  const canvas = createCanvas(bbox[2], bbox[3]);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const crop = {
    canvas: canvas as any,
    width: bbox[2],
    height: bbox[3],
    boundingBox: bbox as [number, number, number, number],
    toDataURL: (t: string) => canvas.toDataURL(t) as string,
    getImageData: () => ctx.getImageData(0, 0, bbox[2], bbox[3]) as any
  };

  // 1. Pixel Path (No element passed)
  const resPixels = await detectFacesInCrop(crop, undefined);
  console.log(`[Puppeteer] Real SVG (Pixel Path):`, resPixels.faces.length > 0 ? `DETECTED (score: ${resPixels.faces[0].score.toFixed(2)})` : 'NEGATIVE');

  // 2. Vector Path (Pass the DOM element, but force pixel path to fail by passing empty crop)
  const outerHtml = await page.evaluate(() => document.getElementById('user-avatar')?.outerHTML);
  const dom = new JSDOM(`<body>${outerHtml}</body>`);
  const domEl = dom.window.document.body.firstElementChild!;
  
  const cropEmpty = { ...crop, width: 0, height: 0 }; // Forces pixel path to fail
  const resVector = await detectFacesInCrop(cropEmpty, domEl);
  console.log(`[Puppeteer] Real SVG (Vector Path):`, resVector.faces.length > 0 ? `DETECTED (score: ${resVector.faces[0].score.toFixed(2)})` : 'NEGATIVE');

  await browser.close();
}

run().catch(console.error);
