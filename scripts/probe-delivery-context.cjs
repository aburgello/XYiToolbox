// =============================================================================
// scripts/probe-delivery-context.cjs
// -----------------------------------------------------------------------------
// The spec sheet Delivery has open, handed to the agent.
//
// The bug: read_delivery_specs walked up from a mastersRoot looking for
// Masters/Specs, and on the studio's real layout the campaign folder is a
// SIBLING of the masters folder --
//
//   .../XY026039_..._Campaign/Masters/Specs      <- the specs
//   .../XY026039_..._Campaign_Masters/AE         <- what the agent is given
//
// -- so the walk could never reach them, and the agent insisted a campaign had
// no specs while the artist watched them parsed on screen beside it.
//
//   node scripts/probe-delivery-context.cjs
// =============================================================================
"use strict";
const { execFileSync } = require("child_process");
const os = require("os"), path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(os.tmpdir(), "xyi-delivctx-probe.cjs");
execFileSync("npx", ["esbuild", path.join(ROOT, "src/js/main/lib/agent/deliveryContext.ts"),
    "--bundle", "--format=cjs", "--platform=node", "--outfile=" + OUT,
    "--alias:canvas=" + path.join(__dirname, "empty-module.cjs"),
    "--alias:path2d-polyfill=" + path.join(__dirname, "empty-module.cjs"),
    "--log-level=error"], { cwd: ROOT });
const C = require(OUT);

let pass = 0, fail = 0;
const check = (l, c, d) => {
    if (c) { pass++; console.log("  ok    " + l); }
    else { fail++; console.log("  FAIL  " + l + (d ? "\n          " + d : "")); }
};

const withRows = {
    folder: "/Volumes/x/Campaign/Masters/Specs",
    note: "",
    files: [{ file: "FID - PH - DOOH - Batch 3.pdf", rows: [
        { size: "1536x672", duration: "10", bitRate: "", fps: "", fileSize: "21",
          sound: "no", site: "SplashScreen", flags: "", notes: "Max size 21mb" },
    ] }],
};
const emptyReport = { folder: "/Volumes/x/Campaign/Masters/Specs", note: "no readable table", files: [{ file: "a.pdf", rows: [] }] };

console.log("\n=== nothing open ===");
check("no report to start with", C.getLoadedSpecReport() === null);

console.log("\n=== Delivery reads a sheet ===");
C.setLoadedSpecReport(withRows);
check("the agent can see it", C.getLoadedSpecReport() !== null);
check("with the rows intact",
      C.getLoadedSpecReport().files[0].rows[0].fileSize === "21",
      JSON.stringify(C.getLoadedSpecReport().files[0].rows[0]));
check("including the free text the parser could not use",
      C.getLoadedSpecReport().files[0].rows[0].notes === "Max size 21mb");

console.log("\n=== a report that found nothing is NOT offered ===");
C.setLoadedSpecReport(emptyReport);
check("an empty sheet reads as no sheet",
      C.getLoadedSpecReport() === null,
      "would have had the agent announce there are no specs");

console.log("\n=== closing it ===");
C.setLoadedSpecReport(withRows);
C.setLoadedSpecReport(null);
check("dismissed means gone — never answers from a sheet nobody is looking at",
      C.getLoadedSpecReport() === null);

console.log("\n=== what Delivery is about to send ===");
const three = [
    { name: "Filmstaden_1920x1080", duration: 10, frameRate: 23.976, sizeMB: "", maxMbps: "", fps: "", audio: false },
    { name: "JCDecaux_1080x1920",   duration: 10, frameRate: 23.976, sizeMB: "", maxMbps: "", fps: "", audio: false },
    { name: "JCDecaux_1080x1920",   duration: 10, frameRate: 23.976, sizeMB: "", maxMbps: "", fps: "", audio: false },
];
C.setLoadedDeliveryRows(three);
const got = C.getLoadedDeliveryRows();
check("all three rows are visible, not just the active comp", got.rows.length === 3, String(got.rows.length));
check("carrying the comp's real frame rate, which is what a sheet disagrees with",
      got.rows[0].frameRate === 23.976);
check("nothing omitted at this size", got.omitted === 0 && got.total === 3);

C.setLoadedDeliveryRows(Array.from({ length: 40 }, (_, i) => ({
    name: "Row" + i, duration: 10, frameRate: 25, sizeMB: "", maxMbps: "", fps: "", audio: false,
})));
const big = C.getLoadedDeliveryRows();
check("a big batch is capped", big.rows.length === 25, String(big.rows.length));
check("and says how many it left out — never a silent truncation",
      big.omitted === 15 && big.total === 40, big.omitted + "/" + big.total);

C.setLoadedDeliveryRows([]);
check("cleared when the rows go", C.getLoadedDeliveryRows().total === 0);

console.log("\n=== the walk that could not work ===");
function walk(from) {
    let dir = path.dirname(from), out = [];
    for (let i = 0; i < 8 && dir && dir !== path.dirname(dir); i++) {
        out.push(path.join(dir, "Masters", "Specs"));
        dir = path.dirname(dir);
    }
    return out;
}
const SPECS = "/Vol/Pics/FID/Digital/INT/XY026039_Campaign/Masters/Specs";
const fromMasters = walk("/Vol/Pics/FID/Digital/INT/XY026039_Campaign_Masters/AE");
const fromRender = walk("/Vol/Pics/FID/Digital/INT/XY026039_Campaign/Renders/Batch_01/x.mp4");
check("walking up from a mastersRoot never reaches the specs",
      fromMasters.indexOf(SPECS) === -1, fromMasters.slice(0, 3).join(" "));
check("walking up from a render path does", fromRender.indexOf(SPECS) !== -1);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
