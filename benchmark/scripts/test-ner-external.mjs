// NER External Page Precision/Recall Test
// Tests detectNamedEntities() against real fetched content from pages we
// don't control the DOM of. Ground truth is manually labeled below.
//
// Run from extension/ dir:
//   npx tsx ../benchmark/scripts/test-ner-external.mjs

import https from "https";
import http from "http";

// Import the freshly-updated NER detector
import { detectNamedEntities, passesNERPreFilter } from "../../extension/src/privacy/ner-detector.ts";

// ---------------------------------------------------------------------------
// Helper: Fetch plain text from a URL (strips HTML tags)
// ---------------------------------------------------------------------------
function fetchText(url, isRestApi = false) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const opts = {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NER-test/1.0; +https://github.com/Tushar-cy/Privaagent)",
        "Accept": isRestApi ? "application/json" : "text/html",
      }
    };
    mod.get(url, opts, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location, isRestApi).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          if (isRestApi) {
            // Wikipedia REST API /page/summary returns JSON with 'extract' field
            const json = JSON.parse(data);
            // 'extract' is clean plain text
            resolve(json.extract || json.extract_html || "");
          } else {
            // HTML page — strip tags
            const text = data
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/\s+/g, " ")
              .trim();
            resolve(text);
          }
        } catch (e) {
          reject(e);
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Ground Truth: manually labeled expected names from each page
// These are real entities that appear in the actual page content.
// Pages chosen: Wikipedia articles with known named entities.
// ---------------------------------------------------------------------------
const TEST_CASES = [
  {
    label: "Wikipedia: A.P.J. Abdul Kalam",
    // Wikipedia REST API summary — returns clean plain text extract
    url: "https://en.wikipedia.org/api/rest_v1/page/summary/A._P._J._Abdul_Kalam",
    isRestApi: true,
    expectedPersons: ["Abdul Kalam", "Avul Pakir"],
    expectedOrgs: ["ISRO", "DRDO"],
    expectedAbsent: ["Early Life", "See Also", "External Links", "Indian"],
  },
  {
    label: "Wikipedia: Sundar Pichai",
    url: "https://en.wikipedia.org/api/rest_v1/page/summary/Sundar_Pichai",
    isRestApi: true,
    expectedPersons: ["Sundar Pichai", "Pichai"],
    expectedOrgs: ["Google"],
    expectedAbsent: ["Early Life", "See Also"],
  },
  {
    label: "Wikipedia: Ratan Tata",
    url: "https://en.wikipedia.org/api/rest_v1/page/summary/Ratan_Tata",
    isRestApi: true,
    expectedPersons: ["Ratan Tata", "Tata"],
    expectedOrgs: ["Tata Sons"],
    expectedAbsent: ["Early Life", "External Links"],
  },
];

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------
console.log("=".repeat(72));
console.log("  NER EXTERNAL PAGE PRECISION / RECALL TEST");
console.log("  Tests detectNamedEntities() on real Wikipedia content");
console.log("=".repeat(72));
console.log();

let globalTP = 0, globalFP = 0, globalFN = 0;

for (const tc of TEST_CASES) {
  console.log(`\n>>> ${tc.label}`);
  console.log(`    URL: ${tc.url}`);

  let rawText;
  try {
    rawText = await fetchText(tc.url, tc.isRestApi || false);
  } catch (err) {
    console.log(`    SKIP (fetch failed): ${err.message}`);
    continue;
  }

  // For REST API plain-text extracts, split on sentence boundaries;
  // for HTML pages, split on double newlines.
  let paragraphs;
  if (tc.isRestApi) {
    // Plain text extract — treat the whole extract as one block, but also
    // split into ~sentence-sized chunks for the NER prefilter to work on.
    paragraphs = rawText
      .split(/\.\s+/)
      .map(p => p.trim())
      .filter(p => p.length > 20);
    // Also add the full text as a single chunk
    if (rawText.length > 40) paragraphs.push(rawText);
  } else {
    paragraphs = rawText
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(p => p.length > 40 && p.length < 500);
  }

  console.log(`    Page text length: ${rawText.length} chars`);
  console.log(`    Paragraphs for NER: ${paragraphs.length}`);

  // Collect all detected spans across all paragraphs
  const allSpans = [];
  for (const para of paragraphs.slice(0, 60)) { // cap at 60 paragraphs for speed
    const spans = detectNamedEntities(para);
    allSpans.push(...spans);
  }

  // Deduplicate by text
  const detectedTexts = [...new Set(allSpans.map(s => s.text.trim()))];
  const detectedPersons = detectedTexts.filter(t =>
    allSpans.some(s => s.text === t && s.type === "PERSON")
  );
  const detectedOrgs = detectedTexts.filter(t =>
    allSpans.some(s => s.text === t && s.type === "ORG")
  );

  console.log(`\n    Detected PERSON spans (${detectedPersons.length} unique):`);
  detectedPersons.slice(0, 20).forEach(p => console.log(`      "${p}"`));

  console.log(`\n    Detected ORG spans (${detectedOrgs.length} unique):`);
  detectedOrgs.slice(0, 10).forEach(o => console.log(`      "${o}"`));

  // --- Precision/Recall vs ground truth ---
  let tp = 0, fn = 0, fp = 0;

  // True positives: expected persons found
  for (const expected of tc.expectedPersons) {
    const found = detectedTexts.some(d =>
      d.toLowerCase().includes(expected.toLowerCase()) ||
      expected.toLowerCase().includes(d.toLowerCase())
    );
    if (found) { tp++; console.log(`    ✓ Expected person found: "${expected}"`); }
    else        { fn++; console.log(`    ✗ Expected person MISSED: "${expected}"`); }
  }

  // True positives: expected orgs found
  for (const expected of tc.expectedOrgs) {
    const found = detectedTexts.some(d =>
      d.toLowerCase().includes(expected.toLowerCase()) ||
      expected.toLowerCase().includes(d.toLowerCase())
    );
    if (found) { tp++; console.log(`    ✓ Expected org found: "${expected}"`); }
    else        { fn++; console.log(`    ✗ Expected org MISSED: "${expected}"`); }
  }

  // False positives: strings that should not be flagged
  for (const absent of tc.expectedAbsent) {
    const wronglyDetected = detectedTexts.some(d =>
      d.toLowerCase().includes(absent.toLowerCase()) ||
      absent.toLowerCase().includes(d.toLowerCase())
    );
    if (wronglyDetected) {
      fp++;
      console.log(`    ✗ False positive: "${absent}" was incorrectly detected`);
    }
  }

  const precision = tp / (tp + fp) || 1.0;
  const recall    = tp / (tp + fn) || 1.0;
  const f1        = (2 * precision * recall) / (precision + recall) || 0;

  console.log(`\n    --- ${tc.label} Results ---`);
  console.log(`    TP: ${tp}, FP: ${fp}, FN: ${fn}`);
  console.log(`    Precision: ${(precision * 100).toFixed(1)}%  Recall: ${(recall * 100).toFixed(1)}%  F1: ${(f1 * 100).toFixed(1)}%`);

  globalTP += tp;
  globalFP += fp;
  globalFN += fn;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
const gPrecision = globalTP / (globalTP + globalFP) || 1.0;
const gRecall    = globalTP / (globalTP + globalFN) || 1.0;
const gF1        = (2 * gPrecision * gRecall) / (gPrecision + gRecall) || 0;

console.log("\n" + "=".repeat(72));
console.log("  AGGREGATE NER RESULTS (External Real Pages)");
console.log("=".repeat(72));
console.log(`  Total TP: ${globalTP}, FP: ${globalFP}, FN: ${globalFN}`);
console.log(`  Precision: ${(gPrecision * 100).toFixed(1)}%`);
console.log(`  Recall:    ${(gRecall * 100).toFixed(1)}%`);
console.log(`  F1 Score:  ${(gF1 * 100).toFixed(1)}%`);
console.log();
