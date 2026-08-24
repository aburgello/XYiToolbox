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
    "--alias:canvas=" + path.join(__dirname, "empty-module.cjs"),
    "--alias:path2d-polyfill=" + path.join(__dirname, "empty-module.cjs"),
    "--log-level=error"], { cwd: ROOT });
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

console.log("\n=== a unit written without a space ===");
// The Brazil sheet: "950KB" and "700KB" in the FILE SIZE column, no space.
// The unit tests were \bk(b|ilo) and friends, and that \b needs a NON-WORD
// character before the k -- so a glued unit matched nothing, fell through to
// the unitless branch and came back as 950 MB. Delivery autofilled a cap a
// thousand times the real one, unflagged, because a bare 950 is an ordinary
// MB figure.
{
    const r = shape({ fileSize: "950KB" });
    check("950KB is 0.95 MB, not 950", r.FileSize === "0.95", r.FileSize);
}
{
    const r = shape({ fileSize: "700KB" });
    check("700KB is 0.7 MB", r.FileSize === "0.7", r.FileSize);
}
{
    const r = shape({ fileSize: "950 KB" });
    check("and the spaced spelling still agrees", r.FileSize === "0.95", r.FileSize);
}
{
    const r = shape({ fileSize: "2GB" });
    check("2GB is 2000 MB, not 2", r.FileSize === "2000", r.FileSize);
}
{
    const r = shape({ fileSize: "5MB" });
    check("5MB is still 5", r.FileSize === "5", r.FileSize);
}
{
    const r = shape({ fileSize: "800 kilobytes" });
    check("the spelled-out form still converts", r.FileSize === "0.8", r.FileSize);
}
{
    // Same hole in the bitrate column, and here nothing else caught it: 800 is
    // under the thousand the last-ditch kbps guess keys on.
    const r = shape({ bitRate: "800kbps" });
    check("800kbps is 0.8 Mbps, not 800", r.BitRate === "0.8", r.BitRate);
}
{
    const r = shape({ bitRate: "8000kbps" });
    check("8000kbps is 8 Mbps", r.BitRate === "8", r.BitRate);
}
{
    const r = shape({ bitRate: "8Mbps", frameRate: "25", duration: "10" });
    check("8Mbps glued is read plainly and not flagged",
          r.BitRate === "8" && r.Flags === "", r.BitRate + " | " + r.Flags);
}

console.log("\n=== the real oOh sheet that started this ===");
// FILE SIZE column reads "MP4" (its own header invites it: "KB, MB, PRO RES"),
// and the actual cap sits in SPECIFIC VIDEO REQUIREMENTS as "Max size 21mb".
{
    const r = shape({ fileSize: "MP4", specificVideo: "Max size 21mb", duration: "7" });
    check("MP4 is no longer read as a 4 MB cap", r.FileSize !== "4", "got " + r.FileSize);
    check("the real 21 MB limit is found in the notes column", r.FileSize === "21", r.FileSize);
    check("and it says where it came from", /not the file size column/.test(r.Flags), r.Flags);
    check("the free text is carried verbatim", r.Notes === "Max size 21mb", r.Notes);
}
{
    const r = shape({ fileSize: "MP4", specificVideo: "", duration: "45" });
    check("a row with no cap anywhere reports none", r.FileSize === "", r.FileSize);
    check("and says the size column holds a format", /a format, not a size/.test(r.Flags), r.Flags);
}
for (const w of ["ProRes422", "H264", "H.265", "MOV"]) {
    const r = shape({ fileSize: w });
    check(`"${w}" is not read as a number`, r.FileSize === "", w + " -> " + r.FileSize);
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
