// =============================================================================
// scripts/probe-job-titles.cjs
// -----------------------------------------------------------------------------
// parseJobTitle over the Wrike title shapes actually on the board: dashed
// ("FID - TW - DINTH - Batch 1") and dashless ("SF Motion Outdoor LV",
// "XY026305 DOOH AU 1"). The territory feeds the flag, the Localise jobs
// strip's "you are here" and the batch builder's territory; the batch becomes
// an OUTPUT FOLDER, so it is read from the word "Batch", or from a bare number
// / B-number AFTER the territory -- never from anywhere else in the title.
//
//   node scripts/probe-job-titles.cjs      (no build needed)
// =============================================================================
const ts = require("typescript");
const fs = require("fs");
const src = fs.readFileSync("src/js/main/lib/jobsFeed.ts", "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const m = { exports: {} };
new Function("module", "exports", "require", js)(m, m.exports, (n) => (n.endsWith("bolt") ? { evalTS: async () => undefined } : {}));
const parse = m.exports.parseJobTitle;

const cases = [
    ["FID - TW - DINTH - Batch 1", { territory: "TW", name: "DINTH", batch: "Batch 1" }],
    ["SF Motion Outdoor LV", { territory: "LV", name: "SF Motion Outdoor", batch: "Batch 1" }],
    // A number AFTER the territory IS the batch (studio decision, 2026-09-28):
    // Wrike titles drifted from "Batch 4" to "CO 4" and "CL POST B1".
    ["XY026305 DOOH AU 1", { territory: "AU", name: "XY026305 DOOH", batch: "Batch 1" }],
    ["SF Motion Outdoor AT 2", { territory: "AT", batch: "Batch 2" }],
    ["SF Motion Outdoor CO 4", { territory: "CO", name: "SF Motion Outdoor", batch: "Batch 4" }],
    ["SF Motion Outdoor CO 5", { territory: "CO", batch: "Batch 5" }],
    ["SF Motion Outdoor PL 3", { territory: "PL", batch: "Batch 3" }],
    // B1 is batch 1, and POST belongs to the batch: its own folder.
    ["SF Motion Outdoor CL POST B1", { territory: "CL", name: "SF Motion Outdoor", batch: "Batch 1 POST" }],
    ["SF Motion Outdoor CL POST B12", { territory: "CL", batch: "Batch 12 POST" }],
    ["SF Motion Outdoor CL POST", { territory: "CL", batch: "Batch 1 POST" }],
    ["SF Motion Outdoor CL B2 POST", { territory: "CL", batch: "Batch 2 POST" }],
    // Any other word after the territory stays in the name.
    ["SF Motion Outdoor CL EXTRA 3", { territory: "CL", name: "SF Motion Outdoor EXTRA", batch: "Batch 3" }],
    // No number: the first batch, Batch 1 (studio decision).
    ["SF Motion Outdoor TW", { territory: "TW", name: "SF Motion Outdoor", batch: "Batch 1" }],
    ["SF Motion Outdoor GR", { territory: "GR", batch: "Batch 1" }],
    // A number BEFORE the territory is not a batch -- that one is Batch 1 too.
    ["SF 2 Motion Outdoor GR", { territory: "GR", batch: "Batch 1" }],
    // "Batch N" still wins, and is not read twice.
    ["SF Motion Outdoor LV Batch 2", { territory: "LV", name: "SF Motion Outdoor", batch: "Batch 2" }],
    ["SF Motion Outdoor LV Batch 2 3", { territory: "LV", batch: "Batch 2" }],
    // OV is a master, never a territory.
    ["Some OV master prep", { territory: "" }],
];
let fails = 0;
for (const [title, want] of cases) {
    const got = parse(title);
    const ok = Object.keys(want).every((k) => got[k] === want[k]);
    if (!ok) fails++;
    console.log((ok ? "  ok    " : "  FAIL  ") + JSON.stringify(title) + "  ->  " + JSON.stringify(got));
}
console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — dashed and dashless titles both find their territory.");
process.exit(fails ? 1 : 0);
