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
check(box(b.panels[0]) === "2049,0,768,1472" && b.panels[0].masks.length === 1, "the panel is the LEG, exactly as its row wrote it (never a box round the lintel too)", box(b.panels[0]));
check(b.panels[0].extras.length === 1 && [b.panels[0].extras[0].x, b.panels[0].extras[0].w, b.panels[0].extras[0].h].join() === "1641,1176,320", "…and the lintel its background runs along is kept beside it, not built", b.panels[0].extras);
check(box(b.panels[1]) === "7296,0,384,1472" && b.panels[1].masks.length === 2 && b.panels[1].art.length === 2 && b.panels[1].extras.length === 1, "the right leg takes the BORDER window inside it, and leaves its lintel out", [box(b.panels[1]), b.panels[1].masks.length, b.panels[1].extras]);
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
check(b.panels.map(box).join(" ") === "0,0,511,1280 511,0,512,1280 1024,0,512,1280", "…and a pixel of overlap between neighbours joins nothing", b.panels.map(box));
const leg = HEAD + [
    `Page1,"ART","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${T}_BG.tif",0,0,400,1500,0,0,384,300`,
    `Page1,"ART2","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${T}_BG.tif",0,0,400,1500,0,900,384,572`,
    `Page1,"ART3","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif","${T}_BORDER.tif",0,0,400,1500,0,0,384,1472`,
].join("\n");
b = B.boardFromRows(B.parseBespokeCsv(leg), 2816, 1472);
check(b.panels.length === 1 && box(b.panels[0]) === "0,0,384,1472" && b.panels[0].masks.length === 3 && b.panels[0].extras.length === 0, "two windows that only meet through a third, read last, still end as one panel, both inside it", b.panels.map(box));

const tiled = HEAD + [
    `Page1,"ART","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${T}_BG.tif",0,0,400,1500,0,596,384,876`,
    `Page1,"ART2","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${T}_BG.tif",0,0,400,1500,0,0,384,799`,
].join("\n");
b = B.boardFromRows(B.parseBespokeCsv(tiled), 2816, 1472);
check(b.panels.length === 1 && box(b.panels[0]) === "0,0,384,1472" && b.panels[0].extras.length === 0, "a leg laid in two tiles, one above the other at the same width, is one whole leg", b.panels.map(box));

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

console.log("\nPlacing what the CSV could not see (the VivaCity arch's lintel)");
const archBoard = B.boardFromRows(B.parseBespokeCsv(arch), 7680, 1472);
const legs = archBoard.panels.map((p) => p.box);
const runOns = [].concat(...archBoard.panels.map((p) => p.extras));
const g = (x, y, panels = legs) => { const r = B.gapAt(x, y, panels, runOns, 7680, 1472); return r ? [r.x, r.y, r.w, r.h].join() : null; };
check(g(900, 150) === "0,0,2049,320", "pointing left of the first leg: the lintel up to it, 320 tall because the run-on says so", g(900, 150));
check(g(4000, 150) === "2817,0,4479,320", "between the legs: the whole stretch from one to the other", g(4000, 150));
check(g(2400, 700) === null, "pointing at a panel is not a gap");
check(g(900, 900) === "0,320,2049,1152", "below the lintel is its own band (not screen on this board, but that is the person's call)", g(900, 900));
check(g(100, 100, []) === "0,0,7680,320" && B.gapAt(100, 100, [], [], 500, 300).w === 500, "nothing read at all: the band, or the whole board");
const ryu = { x: 0, y: 0, w: 2049, h: 320 };
const cp = B.copySpot(ryu, legs, 7680);
check(cp && cp.x === 5247 && cp.w === 2049 && cp.h === 320, "a copy of the left banner lands against the FAR leg, mirrored", cp);
check(g(4000, 150, legs.concat([ryu, cp])) === "2817,0,2430,320", "…and what is left between them is the middle panel, in one press", g(4000, 150, legs.concat([ryu, cp])));
const pillar = { x: 0, y: 0, w: 512, h: 1344 };
check(B.copySpot(pillar, [], 2048).x === 512, "a copy with room straight after it goes hard against it: the next pillar along");
check(B.copySpot({ x: 1536, y: 0, w: 512, h: 1344 }, [], 2048).x === 1024, "no room to the right: to the left instead");
check(B.copySpot({ x: 0, y: 0, w: 2048, h: 1344 }, [], 2048) === null, "no room in the band: nowhere");
check(B.creativeIn(ryu, archBoard.titles, "Page1") === "RyuHadouken" && B.creativeIn({ x: 2817, y: 0, w: 2430, h: 320 }, archBoard.titles, "Page1") === "", "a new panel takes the creative of the title inside it; one with no title has none", [B.creativeIn(ryu, archBoard.titles, "Page1")]);
check(B.creativeIn({ x: 0, y: 0, w: 7680, h: 1472 }, archBoard.titles, "Page1") === "", "…and two creatives' titles in one box decide nothing");

console.log("\nMagnetic sides");
const XS = [0, 7680, 2049, 2817, 7296];
const YS = [0, 1472, 320];
const mv = (r, dx, dy, reach = 30) => { const s = B.snapMove(r, dx, dy, XS, YS, reach, 7680, 1472); return [s.rect.x, s.rect.y, s.rect.w, s.rect.h, s.atX, s.atY].join(); };
check(mv({ x: 100, y: 10, w: 1900, h: 320 }, 30, -4) === "149,0,1900,320,2049,0", "a box moved near a leg takes it by its RIGHT side, and the top edge by its top", mv({ x: 100, y: 10, w: 1900, h: 320 }, 30, -4));
check(mv({ x: 2900, y: 0, w: 500, h: 320 }, -70, 0) === "2817,0,500,320,2817,0", "…by its left side when that is the nearer one", mv({ x: 2900, y: 0, w: 500, h: 320 }, -70, 0));
check(mv({ x: 3500, y: 600, w: 500, h: 320 }, 40, 40) === "3540,640,500,320,,", "out of reach of every line it moves freely", mv({ x: 3500, y: 600, w: 500, h: 320 }, 40, 40));
check(mv({ x: 7000, y: 0, w: 500, h: 320 }, 900, 0, 0) === "7180,0,500,320,,0", "and it never leaves the board", mv({ x: 7000, y: 0, w: 500, h: 320 }, 900, 0, 0));
const rs = (r, sides, dx, dy) => { const s = B.snapResize(r, sides, dx, dy, XS, YS, 30, 7680, 1472); return [s.rect.x, s.rect.y, s.rect.w, s.rect.h, s.atX, s.atY].join(); };
check(rs({ x: 2817, y: 0, w: 2000, h: 320 }, { r: true }, 2460, 0) === "2817,0,4479,320,7296,", "dragging a right side to within reach of the far leg stops it ON the leg", rs({ x: 2817, y: 0, w: 2000, h: 320 }, { r: true }, 2460, 0));
check(rs({ x: 2817, y: 0, w: 2000, h: 300 }, { b: true, l: true }, -10, 15) === "2817,0,2000,320,2817,320", "a corner takes a line on each axis, the other two sides staying put", rs({ x: 2817, y: 0, w: 2000, h: 300 }, { b: true, l: true }, -10, 15));
check(rs({ x: 3000, y: 400, w: 500, h: 300 }, { l: true }, 900, 0) === "3492,400,8,300,,", "a side cannot cross its opposite: the box keeps a few pixels", rs({ x: 3000, y: 400, w: 500, h: 300 }, { l: true }, 900, 0));
check(rs({ x: 3000, y: 400, w: 500, h: 300 }, { t: true }, 0, -900) === "3000,0,500,700,,", "…nor leave the board", rs({ x: 3000, y: 400, w: 500, h: 300 }, { t: true }, 0, -900));

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
    real.panels.forEach((p, i) => console.log(`  panel ${i + 1}  ${p.page}  ${p.creative}  ${box(p)}  ${p.masks.length} window(s)${p.extras.length ? "  +" + p.extras.map((e) => [e.x, e.y, e.w, e.h].join(",")).join(" +") : ""}  ${p.art.join(" + ")}`));
    console.log("  " + real.titles.length + " title(s)");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nCLEAN — a mech CSV reads as the board it describes.");
process.exit(fails ? 1 : 0);
