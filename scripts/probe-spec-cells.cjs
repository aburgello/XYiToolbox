// =============================================================================
// scripts/probe-spec-cells.cjs
// -----------------------------------------------------------------------------
// Spec sheets filled in by hand, and whether the parser notices.
//
// Real client sheets put the fps in the bitrate column, the bitrate in the fps
// column, and sometimes a file size AND a bitrate in one cell. The last of
// those was read as a bitrate of 50 for "50MB / 8Mbps" -- six times the actual
// cap, parsed silently, with a clean-looking row to show for it.
//
// Nothing here is auto-corrected beyond following a unit the client wrote
// themselves, and every reading is reported.
//
//   node scripts/probe-spec-cells.cjs
// =============================================================================
"use strict";
const { execFileSync } = require("child_process");
const os = require("os"), path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(os.tmpdir(), "xyi-specs-probe.cjs");
execFileSync("npx", ["esbuild", path.join(ROOT, "src/js/main/lib/pdfSpecs.ts"),
    "--bundle", "--format=cjs", "--platform=node", "--outfile=" + OUT,
    "--external:canvas", "--log-level=error"], { cwd: ROOT });
const S = require(OUT);

let pass = 0, fail = 0;
const check = (l, c, d) => {
    if (c) { pass++; console.log("  ok    " + l); }
    else { fail++; console.log("  FAIL  " + l + (d ? "\n          " + d : "")); }
};

// reshapeSpecs takes the raw row shape the PDF parser emits.
function row(over) {
    return Object.assign({
        artworkSelection: "DOOH", campaignSelection: "FID",
        size: "1080x1920", duration: "10", mediaSiteName: "Test",
        fileSize: "", bitRate: "", frameRate: "", soundReq: "No",
    }, over);
}
const shape = (over) => S.reshapeSpecs([row(over)], "DE")[0];

console.log("\n=== two values crammed into one cell ===");
{
    const r = shape({ bitRate: "50MB / 8Mbps", duration: "10" });
    console.log(`      bitRate "50MB / 8Mbps"  ->  ${r.BitRate} Mbps`);
    check("takes the value labelled as a rate, not the first number", r.BitRate === "8", r.BitRate);
    check("and says what it did", /took 8Mbps/.test(r.Flags), r.Flags);
}
{
    const r = shape({ bitRate: "8 / 50" });
    check("two bare numbers: takes the first and admits the ambiguity",
          r.BitRate === "8" && /no unit to tell them apart/.test(r.Flags), r.BitRate + " | " + r.Flags);
}
{
    const r = shape({ fileSize: "8Mbps 50MB" });
    check("file size cell with both: takes the MB", r.FileSize === "50", r.FileSize + " | " + r.Flags);
}

console.log("\n=== a column holding the wrong kind of thing ===");
{
    const r = shape({ bitRate: "50MB" });
    check("a file size sitting in the bitrate column is named",
          /bitrate column holds "50MB", which is a file size/.test(r.Flags), r.Flags);
}
{
    const r = shape({ bitRate: "25fps" });
    check("a frame rate in the bitrate column is named",
          /which is a frame rate/.test(r.Flags), r.Flags);
}
{
    const r = shape({ frameRate: "8Mbps" });
    check("a bitrate in the frame-rate column is named",
          /frame rate column holds "8Mbps", which is a bitrate/.test(r.Flags), r.Flags);
}
{
    const r = shape({ frameRate: "50MB" });
    check("a file size in the frame-rate column is named",
          /frame rate column holds "50MB", which is a file size/.test(r.Flags), r.Flags);
}

console.log("\n=== the checks that already worked still do ===");
{
    const r = shape({ bitRate: "25", frameRate: "8" });
    check("the classic swap", /looks like a frame rate/.test(r.Flags), r.Flags);
}
{
    const r = shape({ fileSize: "45000" });
    check("an unlabelled KB file size", /looks like KB, not MB/.test(r.Flags), r.Flags);
}
{
    const r = shape({ fileSize: "200", bitRate: "8", duration: "10" });
    check("size and bitrate that contradict each other", /disagree/.test(r.Flags), r.Flags);
}
{
    const r = shape({ bitRate: "8000" });
    check("a bitrate in kbps is converted AND reported",
          r.BitRate === "8" && /read as kbps/.test(r.Flags), r.BitRate + " | " + r.Flags);
}

console.log("\n=== a clean row stays clean ===");
{
    const r = shape({ fileSize: "12", bitRate: "8", frameRate: "25", duration: "10" });
    console.log(`      12MB · 8Mbps · 25fps · 10s  ->  flags: ${r.Flags || "(none)"}`);
    check("no false alarms", r.Flags === "", r.Flags);
    check("values survive intact", r.FileSize === "12" && r.BitRate === "8" && r.Fps === "25");
}
{
    // Italy's real sheet: no fps column, bitrate 30 on every row. The looser
    // rule flagged all twelve, which is how a checker gets ignored.
    const r = shape({ bitRate: "30", frameRate: "" });
    check("a plain 30 Mbps with no fps column is not flagged", r.Flags === "", r.Flags);
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
