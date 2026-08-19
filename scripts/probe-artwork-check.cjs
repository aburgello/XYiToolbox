// =============================================================================
// scripts/probe-artwork-check.cjs
// -----------------------------------------------------------------------------
// artworkCheck() against the REAL campaign tree on the NAS.
//
// File and Folder are backed by node's fs here rather than stubbed, so this
// exercises the actual folder walking -- the batch naming that disagrees
// between trees (AE writes Batch_01, JPG_PNG writes Batch_1), the _V01 suffix
// only one side carries, and the creative folders under Motion_Components.
// None of that can be checked against invented paths.
//
// SKIPS ITSELF when the share is not mounted, which is a normal state.
//
//   node scripts/probe-artwork-check.cjs
// =============================================================================
"use strict";
const fs = require("fs");
const nodePath = require("path");
const vm = require("vm");

const CAMPAIGN = "/Volumes/universal/Universal_Pictures/Forgotten_Island/Digital/INT";
const MARKETS = CAMPAIGN + "/XY026040_INTL_DIGITAL_Outdoor_Campaign_Markets";

if (!fs.existsSync(MARKETS)) {
    console.log("\n  universal share not mounted — skipped (a normal state)\n");
    process.exit(0);
}

// --- a File/Folder pair over the real filesystem ---------------------------
function mkFolder(p) {
    return {
        fsName: p,
        get name() { return nodePath.basename(p); },
        get exists() { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
        get parent() { return mkFolder(nodePath.dirname(p)); },
        getFiles() {
            let names = [];
            try { names = fs.readdirSync(p); } catch { return []; }
            const out = [];
            for (const n of names) {
                if (n.startsWith(".")) continue;
                const full = nodePath.join(p, n);
                let st; try { st = fs.statSync(full); } catch { continue; }
                out.push(st.isDirectory() ? mkFolder(full) : mkFile(full));
            }
            return out;
        },
    };
}
function mkFile(p) {
    let lines = null, idx = 0;
    return {
        fsName: p,
        get name() { return nodePath.basename(p); },
        get exists() { try { return fs.statSync(p).isFile(); } catch { return false; } },
        get parent() { return mkFolder(nodePath.dirname(p)); },
        get eof() { return lines !== null && idx >= lines.length; },
        open() { try { lines = fs.readFileSync(p, "utf8").split(/\r?\n/); idx = 0; return true; } catch { return false; } },
        readln() { return lines ? lines[idx++] : ""; },
        close() { lines = null; },
    };
}

function run(projectPath, projectItems) {
    const s = {
        app: {
            project: {
                file: mkFile(projectPath),
                numItems: projectItems.length,
                item: (n) => projectItems[n - 1],
                importFile: () => ({ name: "imported" }),
            },
            beginUndoGroup() {}, endUndoGroup() {},
        },
        File: function (p) { return mkFile(p); },
        Folder: function (p) { return mkFolder(p); },
        ImportOptions: function () {},
        CompItem: function () {}, Layer: function () {}, Property: function () {},
        KeyframeEase: function () {}, KeyframeInterpolationType: {}, PropertyType: {},
        $: { writeln() {}, global: {} }, BridgeTalk: { appName: "aftereffects" },
        JSON, Math, Number, String, Array, Object, isNaN, isFinite, parseInt, parseFloat, Error, Date,
    };
    const ctx = vm.createContext(s);
    vm.runInContext(fs.readFileSync(nodePath.join(__dirname, "../dist/cep/jsx/index.js"), "utf8"), ctx, { filename: "index.js" });
    const ns = Object.keys(s.$).filter((k) => k !== "writeln" && k !== "global")[0];
    return s.$[ns].artworkCheck();
}

let pass = 0, fail = 0;
const check = (l, c, d) => {
    if (c) { pass++; console.log("  ok    " + l); }
    else { fail++; console.log("  FAIL  " + l + (d ? "\n          " + d : "")); }
};
const footage = (name) => ({ file: { name } });

console.log("\n=== a real AU deliverable, with the RIGHT tiff in the project ===");
{
    const proj = MARKETS + "/Australia/AE/Batch_01/FID_INTL_Trio_DOOH_oOhRetailLandscapeEvokes_2732x768px_7s_AU_V01.aep";
    const r = run(proj, [footage("FID_INTL_Trio_96Sheet_RGB_OV.tif"), footage("FID_RGB_TT_OV_ON_BLACK_Simp_OOH.psd")]);
    console.log("      verdict: " + r.verdict + "   csv: " + (r.csvPath ? "found" : "none"));
    check("found the CSV despite Batch_01 vs Batch_3", !!r.csvPath, JSON.stringify(r).slice(0, 200));
    check("stripped the _V01 to match the deliverable",
          r.deliverable === "FID_INTL_Trio_DOOH_oOhRetailLandscapeEvokes_2732x768px_7s_AU", r.deliverable);
    check("read the territory off the tree", r.territory === "Australia", r.territory);
    check("says which tiff is expected",
          (r.rows || []).some((x) => x.type === "ART" && x.name.indexOf("96Sheet") !== -1),
          JSON.stringify(r.rows));
    check("verdict: match", r.verdict === "match", r.verdict);
    check("offers Trio's own art edits", (r.creative || "").toUpperCase() === "TRIO", r.creative);
    check("and lists them", (r.tiffs || []).length >= 5, String((r.tiffs || []).length));
}

console.log("\n=== the same deliverable with the WRONG tiff ===");
{
    const proj = MARKETS + "/Australia/AE/Batch_01/FID_INTL_Trio_DOOH_oOhRetailLandscapeEvokes_2732x768px_7s_AU_V01.aep";
    const r = run(proj, [footage("FID_INTL_Trio_48_Sheet_RGB_OV.tif")]);
    console.log("      verdict: " + r.verdict);
    check("verdict: mismatch", r.verdict === "mismatch", r.verdict);
    check("names the one that should be there",
          (r.rows || []).some((x) => x.type === "ART" && !x.inProject));
    check("and names the one that actually is",
          (r.unexpected || []).indexOf("FID_INTL_Trio_48_Sheet_RGB_OV.tif") !== -1,
          JSON.stringify(r.unexpected));
}

console.log("\n=== your case: a comp named 10s when the mech is 7s ===");
{
    const proj = MARKETS + "/Australia/AE/Batch_01/FID_INTL_Trio_DOOH_OOhRetailLandscapeEvokes_2732x768px_10s_AU_V01.aep";
    const r = run(proj, [footage("FID_INTL_Trio_48_Sheet_RGB_OV.tif")]);
    console.log("      verdict: " + r.verdict);
    check("reports no reference rather than a false mismatch", r.verdict === "no-reference", r.verdict);
    check("succeeds — it is an answer, not an error", r.success === true, r.error);
}

console.log("\n=== a project saved outside a territory ===");
{
    const r = run("/tmp/somewhere/Untitled_V01.aep", []);
    check("says so plainly", !r.success && /JPG_PNG/.test(r.error || ""), r.error);
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
