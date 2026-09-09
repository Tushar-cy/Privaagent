import { defineConfig, build } from "vite";
import { resolve } from "path";
import fs from "fs";

function extensionPostBuildPlugin() {
  return {
    name: "extension-post-build",
    async closeBundle() {
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
        if (!fs.existsSync(rootUnpacked)) {
          fs.mkdirSync(rootUnpacked, { recursive: true });
        }
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
  plugins: [extensionPostBuildPlugin()],
});
