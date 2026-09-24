// =============================================================================
// scripts/probe-job-titles.cjs
// -----------------------------------------------------------------------------
// parseJobTitle over the Wrike title shapes actually on the board: dashed
// ("FID - TW - DINTH - Batch 1") and dashless ("SF Motion Outdoor LV",
// "XY026305 DOOH AU 1"). The territory feeds the flag, the Localise jobs
// strip's "you are here" and the batch builder's territory; the batch becomes
// an OUTPUT FOLDER, so it is only ever read from the word "Batch".
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
    ["SF Motion Outdoor LV", { territory: "LV", name: "SF Motion Outdoor", batch: "" }],
    ["XY026305 DOOH AU 1", { territory: "AU", name: "XY026305 DOOH", batch: "" }],
    // A bare trailing number is NOT a batch: guessed wrong, it names a folder.
    ["SF Motion Outdoor AT 2", { territory: "AT", batch: "" }],
    ["SF Motion Outdoor LV Batch 2", { territory: "LV", batch: "Batch 2" }],
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
