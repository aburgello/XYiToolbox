// =============================================================================
// vite.web.config.ts — hostable DEMO build (plain web app, NO CEP / NO AE)
// -----------------------------------------------------------------------------
// Produces an ordinary static site of the `main` panel that runs in any
// browser, for the team to try without After Effects. Unlike vite.config.ts
// (which emits the CEP require()-loader bundle + the ExtendScript build), this
// is a standard Vite/Rollup ESM build with real <script type="module"> output,
// so it just works on any static host (Cloudflare Pages, Vercel, Netlify, …).
//
// The demo bridge (src/js/lib/utils/demoBridge.ts) makes every tool clickable —
// it activates automatically because window.__adobe_cep__ is absent in a
// browser. Build with:  yarn build:web   →   dist/web/
//
//   base:"./"       relative asset URLs so it works under any hosted subpath.
//   cssCodeSplit    left on (real ESM host injects lazy-chunk CSS fine, unlike
//                   the CEP loader that forced cssCodeSplit:false).
// =============================================================================
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const src = path.resolve(__dirname, "src");
const root = path.resolve(src, "js");

export default defineConfig({
  plugins: [react()],
  base: "./",
  root,
  resolve: {
    alias: [{ find: "@esTypes", replacement: path.resolve(__dirname, "src") }],
  },
  build: {
    target: "chrome74",
    outDir: path.resolve(__dirname, "dist", "web"),
    emptyOutDir: true,
    rollupOptions: {
      input: { main: path.resolve(root, "main/index.html") },
    },
  },
});
