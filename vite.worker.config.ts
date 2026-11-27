import { defineConfig } from "vite";

// Cloudflare Pages Advanced Mode expects a compiled Module Worker at dist/_worker.js.
// Keep this build separate from the Vite SPA build and preserve the generated assets.
export default defineConfig({
  build: {
    lib: {
      entry: "src/worker.ts",
      formats: ["es"],
      fileName: () => "_worker.js"
    },
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});
