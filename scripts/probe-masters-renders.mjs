// =============================================================================
// scripts/probe-masters-renders.mjs  (no build needed)
// -----------------------------------------------------------------------------
// Which masters' Renders folder the Tracker's hand-off message names: the
// creative's own only when the whole batch is that creative, the root the
// moment it holds several. Run over a throwaway tree in the temp folder.
// =============================================================================
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// lib/cep/node.ts hands out Node's modules only inside CEP.
globalThis.window = { cep: {} };
globalThis.require = createRequire(import.meta.url);
const out = join(tmpdir(), "xyi-masters-renders.mjs");
await build({
    entryPoints: ["src/js/main/lib/mastersRoot.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error",
    plugins: [{ name: "no-bridge", setup(b) {
        b.onResolve({ filter: /utils\/bolt$/ }, () => ({ path: "bolt", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const evalTS = async () => undefined;" }));
    } }],
});
const { mastersRendersFor } = await import(pathToFileURL(out).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };

const root = mkdtempSync(join(tmpdir(), "xyi-mr-"));
try {
    const MK = join(root, "XY026205_INTL_DIGITAL_Outdoor_Campaign_Markets");
    const MS = join(root, "XY026204_INTL_DIGITAL_Outdoor_Campaign_Masters");
    for (const d of ["Trio", "CharacterMotionPoster", "PORTAL_TO_PARADISE", "_Old"]) mkdirSync(join(MS, "Renders", d), { recursive: true });
    mkdirSync(join(MK, "Norway"), { recursive: true });
    const NO = join(MK, "Norway");
    const R = join(MS, "Renders");

    check(mastersRendersFor(NO, ["SF_INTL_Trio_DOOH_NfkinoPOST_1160x800px_30s_NO", "SF_INTL_Trio_DOOH_OdeonPOST_3840x1152px_30s_NO"]) === join(R, "Trio"),
        "a batch that is all Trio: Trio's own folder");
    check(mastersRendersFor(NO, ["SF_INTL_Trio_DOOH_NfkinoPOST_1160x800px_30s_NO", "SF_INTL_Characters_DOOH_POST_1080x1920px_30s_NO"]) === R,
        "Norway Batch_02, Trio and Characters: the root Renders, not Trio's");
    check(mastersRendersFor(NO, ["SF_INTL_Trio_DOOH_Nfkino_1160x800px_30s_NO", "FID_INTL_PortalToParadise_DOOH_Odeon_1920x1080px_10s_NO"]) === R,
        "two creatives that both have folders: the root");
    check(mastersRendersFor(NO, ["FID_INTL_PortalToParadise_DOOH_Odeon_1920x1080px_10s_NO"]) === join(R, "PORTAL_TO_PARADISE"),
        "a folder spelled another way still answers to its creative");
    check(mastersRendersFor(NO, ["SF_INTL_Kicking_DOOH_Odeon_1920x1080px_10s_NO"]) === R, "a creative with no folder of its name: the root, never a guess");
    check(mastersRendersFor(NO, []) === R, "no deliverables read yet: the root");
    const lone = join(root, "Apart", "SomeJob_Markets", "Territory");
    mkdirSync(lone, { recursive: true });
    check(mastersRendersFor(lone, ["SF_INTL_Trio_DOOH_X_1920x1080px_10s_NO"]) === "", "no Masters beside the Markets folder: nothing, and the block is left out");
} finally {
    rmSync(root, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — the creative's folder for one creative, the root for several.");
process.exit(fails ? 1 : 0);
