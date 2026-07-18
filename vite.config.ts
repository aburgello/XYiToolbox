import { defineConfig } from "vite";

import react from "@vitejs/plugin-react"; 

import { cep, CepOptions, runAction } from "vite-cep-plugin";
import cepConfig from "./cep.config";
import path from "path";
import { extendscriptConfig } from "./vite.es.config";

const extensions = [".js", ".ts", ".tsx"];

const devDist = "dist";
const cepDist = "cep";

const src = path.resolve(__dirname, "src");
const root = path.resolve(src, "js");
const outDir = path.resolve(__dirname, "dist", cepDist);

const debugReact = process.env.DEBUG_REACT === "true";
const isProduction = process.env.NODE_ENV === "production";
const isMetaPackage = process.env.ZIP_PACKAGE === "true";
const isPackage = process.env.ZXP_PACKAGE === "true" || isMetaPackage;
const isServe = process.env.SERVE_PANEL === "true";
const action = process.env.BOLT_ACTION;

let input: { [key: string]: string } = {};
cepConfig.panels.map((panel) => {
  input[panel.name] = path.resolve(root, panel.mainPath);
});

const config: CepOptions = {
  cepConfig,
  isProduction,
  isPackage,
  isMetaPackage,
  isServe,
  debugReact,
  dir: `${__dirname}/${devDist}`,
  cepDist: cepDist,
  zxpOutput: `${__dirname}/${devDist}/zxp/${cepConfig.id}`,
  zipOutput: `${__dirname}/${devDist}/zip/${cepConfig.displayName}_${cepConfig.version}`,
  packages: cepConfig.installModules || [],
};

if (action) runAction(config, action);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    cep(config),
  ],
  resolve: {
    alias: [{ find: "@esTypes", replacement: path.resolve(__dirname, "src") }],
  },
  root,
  clearScreen: false,
  server: {
    port: cepConfig.port,
  },
  preview: {
    port: cepConfig.servePort,
  },

  build: {
    sourcemap: isPackage ? cepConfig.zxp.sourceMap : cepConfig.build?.sourceMap,
    // CEP has no native ESM/dynamic-import support, so vite-cep-plugin's
    // output uses a hand-rolled synchronous require() loader (see the
    // inline <script> at the top of the built index.html) instead of
    // real browser <script type="module">/import(). That loader only
    // knows how to fetch+eval JS text -- it has no CSS-injection logic at
    // all. Vite's default cssCodeSplit:true still happily generates a
    // separate .css file per lazy-loaded chunk (one per tools/*.tsx,
    // confirmed: 8 extra .css files sat in dist/cep/assets alongside
    // main-*.css), but nothing ever creates a <link> for them -- only
    // index.html's ONE static <link rel="stylesheet"> (for the eager
    // main entry's own CSS) ever loads. Every tool imported via
    // React.lazy() in toolRegistry.tsx was therefore shipping with its
    // own styling completely absent in the real packaged ZXP, even
    // though `yarn dev` in a browser looked fully styled -- browser
    // preview uses Vite's real dev-server ESM pipeline, which DOES
    // inject lazy-chunk CSS automatically, so this class of bug is
    // invisible there no matter how much of the UI gets tested that way
    // (same "invisible in preview" trap as the ExtendScript-only bugs
    // documented elsewhere in CLAUDE.md, just on the frontend build side
    // instead). Fix: force everything into the one CSS file that's
    // already always linked, rather than teaching the custom loader to
    // also inject <link> tags -- there's no real bundle-size/load-time
    // cost that matters for a locally-installed panel loading from disk.
    cssCodeSplit: false,
    watch: {
      include: "src/jsx/**",
    },
    // commonjsOptions: {
    //   transformMixedEsModules: true,
    // },
    rollupOptions: {
      input,
      output: {
        // Inline EVERY dynamic import into the single entry chunk instead
        // of splitting per-tool. The tools are declared with React.lazy()
        // in toolRegistry.tsx, which Rollup would otherwise emit as ~50
        // separate .cjs chunks. In the real CEF panel host those chunks
        // are NOT loaded as ES modules -- vite-cep-plugin's hand-rolled
        // synchronous require() loader fetches each one with a BLOCKING
        // XMLHttpRequest the first time its React.lazy import() fires, and
        // that first fetch+eval visibly disrupts the panel: the home
        // entrance animation replays and navigation state resets to home
        // ("hover/click a category card, the homepage re-animates and
        // bounces me back; second time works because the chunk is now
        // cached"). Inlining removes the runtime fetch entirely -- every
        // tool is already present in the one entry chunk the loader
        // evaluates at startup, so React.lazy resolves instantly from the
        // in-memory module registry and nothing is ever fetched mid-
        // interaction. Single panel (cep.config.ts) so single-input, which
        // is what inlineDynamicImports requires. Same "one big local file,
        // no per-chunk load cost that matters off local disk" reasoning as
        // cssCodeSplit:false above. **Build-artifact verified (chunk count
        // drops from ~50 to 1); final confirmation needs a real yarn zxp +
        // reinstall, same as the cssCodeSplit fix.**
        inlineDynamicImports: true,
        // esModule: false,
        preserveModules: false,
        format: "cjs",
        entryFileNames: "assets/[name]-[hash].cjs",
        chunkFileNames: "assets/[name]-[hash].cjs",
      },
    },
    target: "chrome74",
    outDir,
  },
});

// rollup es3 build
const outPathExtendscript = path.join("dist", cepDist, "jsx", "index.js");
extendscriptConfig(
  `src/jsx/index.ts`,
  outPathExtendscript,
  cepConfig,
  extensions,
  isProduction,
  isPackage,
);
