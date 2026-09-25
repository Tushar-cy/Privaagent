import { defineConfig, build } from "vite";
import { resolve } from "path";
import fs from "fs";

function extensionPostBuildPlugin() {
  return {
    name: "extension-post-build",
    async closeBundle() {
      const ocrAssets = [
        ["node_modules/tesseract.js/dist/worker.min.js", "assets/ocr/worker.min.js"],
        ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "assets/ocr/tesseract-core-simd-lstm.wasm.js"],
        ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm", "assets/ocr/tesseract-core-simd-lstm.wasm"],
        ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "assets/ocr/tesseract-core-lstm.wasm.js"],
        ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm", "assets/ocr/tesseract-core-lstm.wasm"],
        ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "assets/ocr/lang/eng.traineddata.gz"],
      ];
      for (const [source, target] of ocrAssets) {
        const sourcePath = resolve(__dirname, source);
        const targetPath = resolve(__dirname, "dist", target);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`[Vite Post-Build] Required local OCR resource is missing: ${sourcePath}`);
        }
        fs.mkdirSync(resolve(targetPath, ".."), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
      }

      // 1. Copy manifest.json to dist
      const manifestSrc = resolve(__dirname, "manifest.json");
      const manifestDest = resolve(__dirname, "dist/manifest.json");
      fs.copyFileSync(manifestSrc, manifestDest);

      // 2. Copy report directory to dist
      const reportDirSrc = resolve(__dirname, "report");
      const reportDirDest = resolve(__dirname, "dist/report");
      if (fs.existsSync(reportDirSrc)) {
        if (!fs.existsSync(reportDirDest)) {
          fs.mkdirSync(reportDirDest, { recursive: true });
        }
        fs.cpSync(reportDirSrc, reportDirDest, { recursive: true });
      }

      // 3. Build content script IIFE bundle
      await build({
        configFile: false,
        build: {
          emptyOutDir: false,
          outDir: resolve(__dirname, "dist"),
          rollupOptions: {
            input: resolve(__dirname, "src/content/index.ts"),
            output: {
              format: "iife",
              name: "PrivaagentContent",
              entryFileNames: "src/content/index.js",
              extend: true,
            },
          },
        },
        resolve: {
          alias: {
            "@": resolve(__dirname, "src"),
          },
        },
      });

      // 4. Mirror complete finalized dist to root privaagent-extension
      try {
        const rootUnpacked = resolve(__dirname, "../privaagent-extension");
        if (fs.existsSync(rootUnpacked)) {
          fs.rmSync(rootUnpacked, { recursive: true, force: true });
        }
        fs.mkdirSync(rootUnpacked, { recursive: true });
        fs.cpSync(resolve(__dirname, "dist"), rootUnpacked, { recursive: true });
      } catch (err) {
        console.warn("[Vite Post-Build] Mirror to privaagent-extension warning:", err);
      }
    },
  };
}

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup/index.html"),
        audit: resolve(__dirname, "report/audit-dashboard.html"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") {
            return "src/background/index.js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  plugins: [extensionPostBuildPlugin()],
});
