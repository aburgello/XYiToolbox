// =============================================================================
// scripts/probe-spec-match.cjs
// -----------------------------------------------------------------------------
// Which spec row belongs to which comp.
//
// The rule is size + duration, and two sites ordering the same size is normal:
// Brazil's Batch 1 sheet has JockeyClub and MarinaTotens both at
// 1080x1920 for 15s. Size and duration alone called that ambiguous and left
// both rows blank beside seven that filled themselves in.
//
// Rows below are the real FID - BR - DOOH - Batch 1 sheets, typed out as the
// parser hands them over -- accents, ampersand and DATE placeholders included,
// because those are exactly what the normalisation has to survive.
//
//   node scripts/probe-spec-match.cjs
// =============================================================================
"use strict";
const { execFileSync } = require("child_process");
const os = require("os"), path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(os.tmpdir(), "xyi-specmatch-probe.cjs");
execFileSync("npx", ["esbuild", path.join(ROOT, "src/js/main/lib/deliverySpecMatch.ts"),
    "--bundle", "--format=cjs", "--platform=node", "--outfile=" + OUT,
    "--alias:canvas=" + path.join(__dirname, "empty-module.cjs"),
    "--alias:path2d-polyfill=" + path.join(__dirname, "empty-module.cjs"),
    "--log-level=error"], { cwd: ROOT });
// cep/node reads window.cep to decide whether Node is available. Absent = the
// browser-preview branch, which is all this probe needs: nothing here touches
// the filesystem.
globalThis.window = {};
const M = require(OUT);

let pass = 0, fail = 0;
const check = (l, c, d) => {
    if (c) { pass++; console.log("  ok    " + l); }
    else { fail++; console.log("  FAIL  " + l + (d ? "\n          " + d : "")); }
};

const row = (Size, Duration, Site, FileSize) => ({
    Size, Duration: String(Duration), Site, FileSize, BitRate: "", Fps: "",
    Sound: "no", Notes: "MP4", Flags: "", Artwork: "DOOH", Campaign: "FID", Country: "BR",
});

// FID - BR - DOOH - Batch 1 - POST.pdf, verbatim.
const POST = [
    row("1080x1920", 15, "JockeyClub", "5"),
    row("320x640", 15, "MarinaLEDPraça&Pier", "5"),
    row("1080x1920", 15, "MarinaTotens", "5"),
    row("512x1024", 10, "ParqueVillaLobos01", "5"),
    row("256x384", 10, "ParqueVillaLobos02", "5"),
    row("960x1724", 15, "EmpenaRJ", "5"),
    row("384x682", 10, "RelógioDigital01", "20"),
    row("576x1026", 10, "RelógioDigital02", "20"),
];

const forComp = (name, rows) => {
    const parts = M.parseDeliveryCompName(name);
    if (!parts) return null;
    return M.specRowsForComp(rows, parts);
};

console.log("\n=== the two rows that came back blank ===");
{
    const hits = forComp("FID_INTL_Trio_DOOH_JockeyClub_1080x1920px_15s_BR", POST);
    check("JockeyClub picks its own row out of two at 1080x1920 · 15s",
          hits.length === 1 && hits[0].Site === "JockeyClub",
          hits.map((h) => h.Site).join(", "));
}
{
    const hits = forComp("FID_INTL_Trio_DOOH_MarinaTotens_1080x1920px_15s_BR", POST);
    check("and MarinaTotens picks the other",
          hits.length === 1 && hits[0].Site === "MarinaTotens",
          hits.map((h) => h.Site).join(", "));
}

console.log("\n=== the sheet spells a site differently from the comp ===");
{
    // The sheet writes an ampersand and a cedilla; the comp cannot.
    const hits = forComp("FID_INTL_Trio_DOOH_MarinaLEDPracaPier_320x640px_15s_BR", POST);
    check("MarinaLEDPraça&Pier matches MarinaLEDPracaPier",
          hits.length === 1 && hits[0].Size === "320x640", hits.length + " hits");
}
{
    // Unique on size anyway, but prove the fold rather than assume it: an
    // accent STRIPPED instead of folded deletes the letter -- praça -> praa.
    check("squash folds rather than deletes an accent",
          M.parseDeliveryCompName("X_RelogioDigital01_384x682px_10s_BR").site === "RelogioDigital01");
    const hits = forComp("FID_INTL_Trio_DOOH_RelogioDigital01_384x682px_10s_BR", POST);
    check("RelógioDigital01 resolves to a 20 MB cap",
          hits.length === 1 && hits[0].FileSize === "20", JSON.stringify(hits));
}

console.log("\n=== what must STAY ambiguous ===");
{
    // The PRE sheet suffixes every site with DATE. That is not the same site,
    // and a prefix match would have paired them.
    const PRE = [
        row("1080x1920", 15, "JockeyClubDATE", "5"),
        row("1080x1920", 15, "MarinaTotensDATE", "5"),
    ];
    const hits = forComp("FID_INTL_Trio_DOOH_JockeyClub_1080x1920px_15s_BR", PRE);
    check("JockeyClub does not claim JockeyClubDATE", hits.length === 2, hits.length + " hits");
}
{
    // Same site twice at one size is a sheet that genuinely needs a human.
    const dupe = [row("1080x1920", 15, "JockeyClub", "5"), row("1080x1920", 15, "JockeyClub", "8")];
    const hits = forComp("FID_INTL_Trio_DOOH_JockeyClub_1080x1920px_15s_BR", dupe);
    check("two rows for the SAME site stay ambiguous", hits.length === 2, hits.length + " hits");
}
{
    const hits = forComp("FID_INTL_Trio_DOOH_Nowhere_1234x5678px_11s_BR", POST);
    check("a size nobody ordered matches nothing", hits.length === 0, hits.length + " hits");
}

console.log("\n=== the rows that always worked still do ===");
for (const [comp, size, cap] of [
    ["FID_INTL_Trio_DOOH_ParqueVillaLobos01_512x1024px_10s_BR", "512x1024", "5"],
    ["FID_INTL_Trio_DOOH_ParqueVillaLobos02_256x384px_10s_BR", "256x384", "5"],
    ["FID_INTL_Trio_DOOH_RelogioDigital02_576x1026px_10s_BR", "576x1026", "20"],
]) {
    const hits = forComp(comp, POST);
    check(`${size} -> ${cap} MB`, hits.length === 1 && hits[0].FileSize === cap, JSON.stringify(hits));
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
