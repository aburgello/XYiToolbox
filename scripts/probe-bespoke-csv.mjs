// =============================================================================
// scripts/probe-bespoke-csv.mjs  (no build needed)
// -----------------------------------------------------------------------------
// Bespoke's guided build: what board a mech CSV describes. The three CSVs are
// Malaysia's real VivaCity ones (read 2026-10-05), paths shortened.
//
//   node scripts/probe-bespoke-csv.mjs            the three below
//   node scripts/probe-bespoke-csv.mjs <x.csv>    also print a real one's board
// =============================================================================
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const out = join(tmpdir(), "xyi-bespoke-csv.mjs");
await build({ entryPoints: ["src/js/main/lib/bespokeCsv.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const B = await import(pathToFileURL(out).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };
const HEAD = "PageLabel,Type,Name,FilePath,X_px,Y_px,Width_px,Height_px,MaskX_px,MaskY_px,MaskWidth_px,MaskHeight_px\n";
const S = "/Volumes/paramount/SF/XY026204_Masters/Support";
const box = (p) => [p.box.x, p.box.y, p.box.w, p.box.h].join(",");

console.log("A single screen: one artwork in two layers is one panel");
const vertical = HEAD + [
    `Page1,"TT","SF_RGB_Legendary_TT_OV_SIMP.psd","${S}/Trio/TT/SF_RGB_Legendary_TT_OV_SIMP.psd",-91,-39,567,324,9,6,364,226`,
    `Page1,"ART","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif",-265,-166,915,1620,0,0,384,1152`,
    `Page1,"ART2","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif",-265,-122,916,1524,0,0,384,1152`,
].join("\n") + "\n";
let b = B.boardFromRows(B.parseBespokeCsv(vertical), 384, 1152);
check(b.panels.length === 1 && box(b.panels[0]) === "0,0,384,1152", "BORDER and BG, a pixel apart in width, are one panel the size of the canvas", b.panels.map(box));
check(b.panels[0].creative === "Trio" && b.panels[0].family === "SF_INTL_Trio_OOH_Tall_Portrait_RGB" && b.panels[0].art.length === 2, "…carrying its creative off the path and both layers' names", b.panels[0]);
check(b.titles.length === 1 && box(b.titles[0]) === "9,6,364,226", "the title is kept for the preview, at its mask");

console.log("\nAn arch: two artworks, each seen through several windows");
const arch = HEAD + [
    `Page1,"TT","SF_RGB_Teaser_1Line_TT_OV_SIMP.psd","${S}/RyuHadouken/TT/SF_RGB_Teaser_1Line_TT_OV_SIMP.psd",5762,-173,1107,632,5810,1,1027,204`,
    `Page1,"TT2","SF_RGB_Legendary_TT_OV_SIMP.psd","${S}/Trio/TT/SF_RGB_Legendary_TT_OV_SIMP.psd",7205,20,569,325,7305,66,365,227`,
    `Page1,"TT3","SF_RGB_Legendary_TT_OV_SIMP.psd","${S}/Trio/TT/SF_RGB_Legendary_TT_OV_SIMP.psd",1946,-66,981,561,2068,35,729,393`,
    `Page1,"TT4","SF_RGB_Teaser_1Line_TT_OV_SIMP.psd","${S}/RyuHadouken/TT/SF_RGB_Teaser_1Line_TT_OV_SIMP.psd",684,-173,1107,632,732,1,1027,204`,
    `Page1,"ART","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif",7030,-64,919,1530,6792,0,888,320`,
    `Page1,"ART2","SF_INTL_Trio_OOH_1080x1920_RGB_OV_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_1080x1920_RGB_OV_BG.tif",1337,-704,2190,2718,1641,0,1176,320`,
    `Page1,"ART3","SF_INTL_Trio_OOH_1080x1920_RGB_OV_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_1080x1920_RGB_OV_BG.tif",1337,-704,2190,2718,2049,0,768,1472`,
    `Page1,"ART4","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif",7030,-357,919,2249,7296,361,384,1111`,
    `Page1,"ART5","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif",7030,-64,919,1530,7296,0,384,1472`,
].join("\n");
b = B.boardFromRows(B.parseBespokeCsv(arch), 7680, 1472);
check(b.panels.length === 2, "five ART rows are two panels", b.panels.map((p) => p.family + " " + box(p)));
check(box(b.panels[0]) === "1641,0,1176,1472" && b.panels[0].masks.length === 2, "left to right: the lintel piece and the leg cut from one picture are one box", box(b.panels[0]));
check(box(b.panels[1]) === "6792,0,888,1472" && b.panels[1].masks.length === 3 && b.panels[1].art.length === 2, "…and the right-hand one takes all three windows of its two layers", box(b.panels[1]));
check(b.titles.length === 4 && b.titles.filter((t) => t.creative === "RyuHadouken").length === 2, "titles keep their own creative: two are Ryu's, where no panel is", b.titles.map((t) => t.creative));

console.log("\nPillars: one panel's layers placed differently, neighbours a pixel over");
const T = `${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB`;
const pillars = HEAD + [
    `Page1,"ART","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif","${T}_BORDER.tif",-140,-400,800,2100,0,0,511,1280`,
    `Page1,"ART2","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${T}_BG.tif",-200,-90,930,1500,0,0,510,1280`,
    `Page1,"ART3","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${T}_BG.tif",310,-90,930,1500,511,0,512,1280`,
    `Page1,"ART4","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif","${T}_BORDER.tif",372,-400,800,2100,512,0,512,1280`,
    `Page1,"ART5","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${T}_BG.tif",820,-90,930,1500,1024,0,512,1280`,
    `Page1,"ART6","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif","${T}_BORDER.tif",884,-400,800,2100,1025,0,512,1280`,
].join("\n");
b = B.boardFromRows(B.parseBespokeCsv(pillars), 2048, 1280);
check(b.panels.length === 3, "six rows are three pillars, however each layer was placed", b.panels.map(box));
check(b.panels.map(box).join(" ") === "0,0,511,1280 511,0,513,1280 1024,0,513,1280", "…and a pixel of overlap between neighbours joins nothing", b.panels.map(box));
const leg = HEAD + [
    `Page1,"ART","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${T}_BG.tif",0,0,400,1500,0,0,384,300`,
    `Page1,"ART2","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${T}_BG.tif",0,0,400,1500,0,900,384,572`,
    `Page1,"ART3","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif","${T}_BORDER.tif",0,0,400,1500,0,0,384,1472`,
].join("\n");
b = B.boardFromRows(B.parseBespokeCsv(leg), 2816, 1472);
check(b.panels.length === 1 && box(b.panels[0]) === "0,0,384,1472" && b.panels[0].masks.length === 3, "two windows that only meet through a third, read last, still end as one panel", b.panels.map(box));

console.log("\nPages");
const foyer = HEAD + [
    `Page1,"TT","SF_RGB_Teaser_TT_OV_SIMP.psd","${S}/Trio/TT/SF_RGB_Teaser_TT_OV_SIMP.psd",-186,-141,1869,1068,0,0,1485,755`,
    `Page2,"TT","SF_RGB_Legendary_TT_OV_SIMP.psd","${S}/Trio/TT/SF_RGB_Legendary_TT_OV_SIMP.psd",-202,55,1800,1029,73,206,1234,724`,
    `Page2,"ART","SF_INTL_Trio_OOH_96Sheet_RGB_OV_BORDER.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_96Sheet_RGB_OV_BORDER.tif",-1162,-1144,6134,3383,0,0,3840,1080`,
    `Page2,"ART2","SF_INTL_Trio_OOH_96Sheet_RGB_OV_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_96Sheet_RGB_OV_BG.tif",-1162,-963,6134,3020,0,0,3840,1080`,
].join("\r\n");
b = B.boardFromRows(B.parseBespokeCsv(foyer), 3840, 1080);
check(b.pages.join() === "Page1,Page2" && b.panels.length === 1 && b.panels[0].page === "Page2", "a title-only page has no panel; the artwork's page has one (CRLF line ends read too)", b.panels.map((p) => p.page + " " + box(p)));

console.log("\nEdges");
check(B.boardFromRows(B.parseBespokeCsv(HEAD + `Page1,"ART","a.tif","/x/a.tif",5000,0,100,100,5000,0,100,100`), 384, 1152).panels.length === 0, "a row wholly off the board is not a panel");
check(box(B.boardFromRows(B.parseBespokeCsv(HEAD + `Page1,"ART","a.tif","/x/a.tif",-50,-50,500,500`), 384, 1152).panels[0]) === "0,0,384,450", "a row with no mask is seen through its own placement, cut to the board");
check(box(B.boardFromRows(B.parseBespokeCsv(HEAD + `Page1,"ART","a, b.tif","/x/Support/Tr""io/a, b.tif",0,0,10,10,0,0,10,10`), 384, 1152).panels[0]) === "0,0,10,10", "a comma or a doubled quote inside a quoted cell does not shift the columns");
check(B.parseBespokeCsv("").length === 0 && B.boardFromRows([], 100, 100).panels.length === 0, "an empty file is an empty board");
check(B.creativeFromSupportPath(`${S}/Motion_Components/_Trio/Tiffs/x.aep`) === "Trio" && B.creativeFromSupportPath("/Desktop/x.tif") === "", "Motion_Components is a container, never a creative; no Support level, no creative");
check(B.artFamily("SF_INTL_Trio_OOH_48Sheet_RGB_OV.tif") === "SF_INTL_Trio_OOH_48Sheet_RGB_OV" && B.artFamily("X_RGB_BORDER.tif") === "X_RGB", "only a layer suffix comes off an artwork's name");

console.log("\nWhere a build is filed");
const w = B.whereItFiles("/Volumes/paramount/SF/XY026206_Bespoke/Malaysia/PNGs/Bespoke_VivaCity/SF_X_384x1152px_30s_MY/SF_X_384x1152px_30s_MY.csv");
check(w && w.marketsRoot === "/Volumes/paramount/SF/XY026206_Bespoke" && w.territory === "Malaysia" && w.batch === "Bespoke_VivaCity", "read off where the CSV sits", w);
check(B.whereItFiles("/Volumes/x/Markets/Norway/JPG_PNG/Batch_1/D/D.csv").batch === "Batch_1", "JPG_PNG is the same level as PNGs");
check(B.whereItFiles("/Users/antonio/Desktop/Stuff/D/D.csv") === null && B.whereItFiles("D.csv") === null, "any other shape files nowhere");

if (process.argv[2]) {
    const name = process.argv[2].split("/").pop();
    const m = /_(\d{3,})x(\d{3,})(?:px)?_/.exec(name) || [0, 1920, 1080];
    const real = B.boardFromRows(B.parseBespokeCsv(fs.readFileSync(process.argv[2], "utf8")), +m[1], +m[2]);
    console.log("\n" + name + "  " + m[1] + "x" + m[2] + "  pages " + real.pages.join(","));
    real.panels.forEach((p, i) => console.log(`  panel ${i + 1}  ${p.page}  ${p.creative}  ${box(p)}  ${p.masks.length} window(s)  ${p.art.join(" + ")}`));
    console.log("  " + real.titles.length + " title(s)");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nCLEAN — a mech CSV reads as the board it describes.");
process.exit(fails ? 1 : 0);
