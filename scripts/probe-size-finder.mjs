// =============================================================================
// scripts/probe-size-finder.mjs  (no build needed)
// -----------------------------------------------------------------------------
// Size Finder: which files count as approved, what each is paired with, and
// what "closest" means. The tree is a stub in the shapes the share really has
// (Norway's PDFs spell `Digital_Metro` where the render says `DigitalMetro`).
//
//   node scripts/probe-size-finder.mjs            the stub
//   node scripts/probe-size-finder.mjs <Markets>  also list a real root, read-only
// =============================================================================
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const out = join(tmpdir(), "xyi-size-finder.mjs");
await build({ entryPoints: ["src/js/main/lib/sizeScan.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error",
    stdin: undefined });
const scan = await import(pathToFileURL(out).href + "?" + Date.now());
const out2 = join(tmpdir(), "xyi-size-match.mjs");
await build({ entryPoints: ["src/js/main/lib/sizeMatch.ts"], bundle: true, platform: "node", format: "esm", outfile: out2, logLevel: "error" });
const M = await import(pathToFileURL(out2).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };

console.log("What a name says");
check(JSON.stringify(M.sizeOfName("SF_INTL_Trio_DOOH_Nfkino_1160x800px_30s_NO.mp4")) === '{"w":1160,"h":800,"seconds":30}', "size and length off the current convention");
check(JSON.stringify(M.sizeOfName("ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV")) === '{"w":1920,"h":858,"seconds":10}', "…and off the legacy one");
check(M.sizeOfName("FID_INTL_TVSpot_DOOH_Hoyts3x3_1920x1080_30s_NZ_V01.mov").w === 1920, "a site's grid is not a size");
check(M.sizeOfName("SF_INTL_Trio_DOOH_Metrobus_9x16_1080x1920px_10s_FR.pdf").h === 1920, "nor is a mech ratio");
check(M.sizeOfName("notes.mp4") === null, "a file with no size is not a deliverable");
check(M.deliverableSquash("SF_INTL_Characters_DOOH_Digital_Metro_1080x1920px_10s_NO.pdf") === M.deliverableSquash("SF_INTL_Characters_DOOH_DigitalMetro_1080x1920px_10s_NO_V01.mov"), "the PDF's spelling and the render's are one deliverable");
check(M.deliverableSquash("X_DOOH_A_1160x800px_30s_NO_V2.pdf") === M.deliverableSquash("X_DOOH_A_1160x800px_30s_NO_V02_DOUBLE_RES.mov"), "versions and RES tails come off");
check(M.deliverableSquash("X_DOOH_A_1160x800px_30s_NO") !== M.deliverableSquash("X_DOOH_A_1200x380px_30s_NO"), "two sizes never fold into one");
check(M.deliverableSquash("X_DOOH_A_1160x800px_10s_NO") !== M.deliverableSquash("X_DOOH_A_1160x800px_30s_NO"), "nor two lengths");

check(M.creativeOfName("SF_INTL_Trio_DOOH_Nfkino_1160x800px_30s_NO.mp4") === "Trio" && M.creativeOfName("FID_INTL_PortalToParadise_DINTH_X_1080x1920px_10s_IT") === "PortalToParadise", "the creative is the token left of the artwork type");
check(M.creativeOfName("ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV") === "" && M.creativeOfName("notes.mp4") === "", "a legacy name carries none, and neither does a stray file");

check(M.marketOfName("SF_INTL_Trio_DOOH_Kube_520x520px_10s_DK_V02.aep") === "DK" && M.marketOfName("SF_INTL_Characters_DOOH_1080x1920px_15s_BE_FL") === "BE", "the market is the token after the length, language or version after it ignored");
check(M.marketOfName("FID_INTL_PortalToParadise_DOOH_3840x586px_10s_OV") === "" && M.marketOfName("notes") === "", "…never OV, and nothing when the name doesn't say");

console.log("\nWhat closest means");
const near = (w, h, hw, hh) => M.closeness({ w, h }, { w: hw, h: hh });
check(near(400, 400, 400, 400).kind === "exact", "the same size is exact");
check(near(400, 400, 1080, 1080).kind === "same-shape" && near(400, 400, 1080, 1080).label === "Same ratio · 1:1", "a bigger square is the same ratio, and says the ratio rather than the scale", near(400, 400, 1080, 1080).label);
check(near(1920, 1080, 1280, 720).label === "Same ratio · 16:9", "…and so is a smaller 16:9");
check(near(400, 400, 420, 400).label === "21:20 · 5% wider" && near(400, 400, 400, 420).label === "20:21 · 5% taller", "off-ratio gives its own ratio, which way and how far", [near(400, 400, 420, 400).label, near(400, 400, 400, 420).label]);
check(near(600, 300, 1160, 800).label === "1.45:1 · 38% taller", "a ratio nobody would say is given against 1", near(600, 300, 1160, 800).label);
check(M.ratioLabel(600, 300) === "2:1" && M.ratioLabel(1080, 1920) === "9:16" && M.ratioLabel(1920, 858) === "2.24:1" && M.ratioLabel(345, 496) === "1:1.44", "the typed size's ratio, said the way people say it", [M.ratioLabel(1920, 858), M.ratioLabel(345, 496)]);
const F = "SF_INTL_Characters_DOOH_Digital Metro_1080x1920px_10s_NO";
check(M.pickSheet(F, [F + ".csv", F + "2.jpg", F + "1.png", F + "_ARTWORK_1.jpg", F + ".jpg", "ARTWORK_ONLY"]) === F + ".jpg", "the sheet is the JPG named as the folder is, never a numbered slot");
check(M.pickSheet(F, [F + "2.jpg", F + ".png"]) === "", "…and there is none when only artwork is there");
check(M.sheetImages(F, [F + ".csv", F + "10.jpg", F + "2.jpg", F + "1.png", F + ".jpg", ".DS_Store"]).join("|") === [F + ".jpg", F + "1.png", F + "2.jpg", F + "10.jpg"].join("|"), "paging order: the sheet, then the rest with numbers in order, pictures only");
check(M.sheetImages("", ["b_ARTWORK_2.jpg", "b_ARTWORK_1.jpg"]).join() === "b_ARTWORK_1.jpg,b_ARTWORK_2.jpg", "a subfolder's pictures page by name");
const order = [[400, 420], [1080, 1080], [1920, 1080], [400, 400], [512, 512]]
    .map(([w, h]) => ({ s: w + "x" + h, c: near(400, 400, w, h) }))
    .sort((a, b) => M.byCloseness(a.c, b.c)).map((x) => x.s);
check(order.join() === "400x400,512x512,1080x1080,400x420,1920x1080", "exact, then squares nearest in scale, then the nearest other shape", order);
check(JSON.stringify(M.parseWanted(" 400 x 400 ")) === '{"w":400,"h":400}' && M.parseWanted("1920×1080px").h === 1080 && M.parseWanted("400") === null && M.parseWanted("5000/3") === null, "the box reads a size and nothing else");

// ---------------------------------------------------------------------------
console.log("\nWhat counts as approved, and what it is paired with");
const tree = {};
const put = (p) => { const parts = p.split("/"); for (let i = 1; i < parts.length; i++) { const dir = parts.slice(0, i).join("/") || "/"; (tree[dir] = tree[dir] || new Set()).add(parts[i]); } };
const R = "/Volumes/paramount/SF/Markets";
const A = "SF_INTL_Characters_DOOH_DigitalMetro_1080x1920px_10s_NO";
const B = "SF_INTL_Trio_DOOH_Nfkino_1160x800px_30s_NO";
const C = "SF_INTL_Trio_DOOH_Nfkino_345x496px_30s_NO";
put(`${R}/Norway/Renders/Batch_01/_Delivery/${A}.mp4`);
put(`${R}/Norway/Renders/_Delivery/${A}.mp4`);                       // the same file, territory level
put(`${R}/Norway/Renders/Batch_01/_Delivery/${B}.mov`);              // delivered as a .mov…
put(`${R}/Norway/Renders/Batch_01/_mp4/${B}_V01.mp4`);
put(`${R}/Norway/Renders/Batch_01/_mp4/${B}_V02.mp4`);               // …its newest preview plays instead
put(`${R}/Norway/Renders/Batch_01/${C}_V01.mov`);                    // rendered, never delivered
put(`${R}/Norway/Renders/Batch_01/_mp4/${C}_V01.mp4`);
put(`${R}/Norway/Renders/Batch_01/_Delivery/.DS_Store`);
put(`${R}/Norway/Renders/Batch_01/_Delivery/readme.mp4`);            // no size: not a deliverable
put(`${R}/Norway/Renders/_Archive/_Delivery/SF_INTL_Trio_DOOH_Old_1920x1080px_30s_NO.mp4`);
put(`${R}/Norway/PDFs/Batch_1/SF_INTL_Characters_DOOH_Digital_Metro_1080x1920px_10s_NO.pdf`);
put(`${R}/Norway/PDFs/Batch_1/${B}.pdf`);
put(`${R}/Norway/PDFs/Batch_1/${B}_V2.pdf`);
put(`${R}/Norway/PDFs/_Old/${B}_V9.pdf`);
put(`${R}/Norway/JPG_PNG/Batch_1/SF_INTL_Characters_DOOH_Digital Metro_9x16_1080x1920px_10s_NO/x.jpg`);  // a batch level, a ratio token, a space
put(`${R}/Norway/JPG_PNG/_Old/${B}/x.jpg`);
put(`${R}/Chile/JPG_PNG/SF_INTL_StaticCast_DOOH_MallPlazaPOST_672x382px_10s_CL/x.jpg`);               // no batch level
put(`${R}/Chile/Renders/Batch_2_POST/_Delivery/2026-09-30/SF_INTL_StaticCast_DOOH_MallPlazaPOST_672x382px_10s_CL.mp4`);
put(`${R}/Chile/PDFs/_Delivered/Batch_2_POST/SF_INTL_StaticCast_DOOH_MallPlazaPOST_672x382px_10s_CL.pdf`);
put(`${R}/_TERRITORY_TEMPLATE/Renders/_Delivery/SF_INTL_Trio_DOOH_T_1920x1080px_30s_XX.mp4`);
put(`${R}/Peru/AE/Batch_01/x.aep`);                                  // nothing delivered
let listings = 0;
const list = async (dir) => { listings++; return [...(tree[dir] || [])].map((name) => ({ name, path: dir + "/" + name, dir: !!tree[dir + "/" + name] })); };

const rows = await scan.scanMarkets("Street Fighter", R, list);
const by = (re) => rows.filter((r) => re.test(r.name));
check(rows.length === 3, "three approved deliverables: the delivered ones, once each", rows.map((r) => r.territory + ":" + r.name));
const a = by(/DigitalMetro/)[0];
check(a && a.preview === a.delivered && /\.mp4$/.test(a.preview), "a delivered mp4 is its own preview");
check(a && /Digital_Metro/.test(a.pdf), "…paired with its PDF across the two spellings", a && a.pdf);
const b = by(/1160x800/)[0];
check(b && /\.mov$/.test(b.delivered) && /_mp4\/.*_V02\.mp4$/.test(b.preview), "a delivered .mov plays its newest _mp4 twin", b && b.preview);
check(b && /_V2\.pdf$/.test(b.pdf) && !/_Old/.test(b.pdf), "the newest PDF, never one from _Old", b && b.pdf);
check(a && /JPG_PNG\/Batch_1\/SF_INTL_Characters_DOOH_Digital Metro_9x16/.test(a.artFolder), "…and with its JPG_PNG folder, ratio token and space and all", a && a.artFolder);
check(b && b.artFolder === "", "a folder under JPG_PNG/_Old is not its art folder");
check(rows.map((r) => r.creative).sort().join() === "Characters,StaticCast,Trio", "each row carries its creative", rows.map((r) => r.creative));
check(by(/345x496/).length === 0, "rendered but never delivered is not approved");
check(by(/readme|Old_1920|_XX/).length === 0, "no unsized file, nothing under _Archive, no _ territory");
const c = by(/MallPlaza/)[0];
check(c && c.territory === "Chile" && c.batch === "Batch_2_POST" && /_Delivered/.test(c.pdf), "a dated subfolder of _Delivery is walked, and PDFs/_Delivered is read", c);
check(c && /Chile\/JPG_PNG\/SF_INTL_StaticCast/.test(c.artFolder), "JPG_PNG with no batch level is read too");
check((await scan.scanMarkets("Gone", "/Volumes/unmounted/Markets", list)).length === 0, "an unmounted root is simply empty");

console.log("\nThe project an approved deliverable came from");
put(`${R}/Norway/AE/Batch_1/${A}_V01.aep`);
put(`${R}/Norway/AE/Batch_1/${A}_V02.aep`);
put(`${R}/Norway/AE/Batch_1/Auto-Save/${A}_V09.aep`);
put(`${R}/Norway/AE/Batch_2/${A}_V07.aep`);                       // another batch's copy
put(`${R}/Norway/AE/Batch_1/${B}_V01.aep`);
const pa = await scan.findApprovedProject(R, a, list);
check(pa && /AE\/Batch_1\/.*_V02\.aep$/.test(pa.path), "its delivered batch (Renders' Batch_01 is AE's Batch_1), newest version, never Auto-Save", pa && pa.path);
check((await scan.findApprovedProject(R, c, list)) === null, "no project on disk: none, so it can be looked at but not built from");
const loose = { ...a, batch: "" };
check(/Batch_2\/.*_V07\.aep$/.test(((await scan.findApprovedProject(R, loose, list)) || {}).path || ""), "delivered from the territory's own _Delivery: every batch is looked in");

if (process.argv[2]) {
    console.log("\nA real root, read-only: " + process.argv[2]);
    const real = async (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, path: join(dir, d.name), dir: d.isDirectory() })); } catch { return []; } };
    const t0 = Date.now();
    const live = await scan.scanMarkets("live", process.argv[2], real);
    const sizes = new Set(live.map((r) => r.w + "x" + r.h));
    console.log(`  ${live.length} approved in ${sizes.size} sizes, ${live.filter((r) => r.preview).length} playable, ${live.filter((r) => r.pdf).length} with a PDF, ${live.filter((r) => r.artFolder).length} with a JPG_PNG folder, ${Date.now() - t0}ms`);
    const want = { w: 400, h: 400 };
    live.map((r) => ({ r, c: M.closeness(want, r) })).sort((x, y) => M.byCloseness(x.c, y.c)).slice(0, 6)
        .forEach(({ r, c }) => console.log(`  400x400 -> ${r.w}x${r.h}  ${c.label}  ${r.territory}  ${r.pdf ? "pdf" : "no pdf"}`));
    live.filter((r) => !r.pdf).slice(0, 5).forEach((r) => console.log("  no pdf: " + r.territory + "  " + r.name));
}

console.log(fails ? "\n" + fails + " FAILED" : "\nCLEAN — approved means delivered, each with what plays and its PDF, nearest shape first.");
process.exit(fails ? 1 : 0);
