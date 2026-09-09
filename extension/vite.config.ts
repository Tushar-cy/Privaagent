import { defineConfig, build } from "vite";
import { resolve } from "path";
import fs from "fs";

function buildContentScript() {
  return {
    name: "build-content-script",
    async closeBundle() {
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
    },
  };
}

function copyManifest() {
  return {
    name: "copy-manifest",
    closeBundle() {
      const manifestSrc = resolve(__dirname, "manifest.json");
      const manifestDest = resolve(__dirname, "dist/manifest.json");
      fs.copyFileSync(manifestSrc, manifestDest);

      const reportDir = resolve(__dirname, "dist/report");
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }
      const reportSrc = resolve(__dirname, "report/compliance-dashboard.html");
      const reportDest = resolve(__dirname, "dist/report/compliance-dashboard.html");
      if (fs.existsSync(reportSrc)) {
        fs.copyFileSync(reportSrc, reportDest);
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup/index.html"),
        compliance: resolve(__dirname, "report/compliance-dashboard.html"),
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
  plugins: [buildContentScript(), copyManifest()],
});
