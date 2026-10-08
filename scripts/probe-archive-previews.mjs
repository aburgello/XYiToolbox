// =============================================================================
// scripts/probe-archive-previews.mjs  (no build needed)
// -----------------------------------------------------------------------------
// A delivered batch's previews go from Renders/<Batch>/_mp4 to
// Renders/<Batch>/_Old/_mp4 (lib/archivePreviews.ts). This moves real files in
// a throwaway tree and checks: _Old made when missing and reused whatever its
// case, a second archive merging into the first, nothing outside a batch's
// Renders folder ever touched (a masters tree's Motion_Components/_mp4 least
// of all), and which campaigns Size Finder reads (activeFirst).
// =============================================================================
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

globalThis.window = { cep: {} };
globalThis.require = createRequire(import.meta.url);
const load = async (entry, name) => {
    const out = join(tmpdir(), name);
    await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
    return import(pathToFileURL(out).href + "?" + Date.now());
};
const { archivePreviews, findPreviewFolders, previewFolderOf, archiveDeliveredPreview, previewKey } = await load("src/js/main/lib/archivePreviews.ts", "xyi-archive-previews.mjs");
const { activeFirst } = await load("src/js/main/lib/sizeMatch.ts", "xyi-size-match-af.mjs");

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra).slice(0, 300) : "")); };
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "xyi-ap-")));
const put = (p) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, "x"); };
const ls = (p) => (existsSync(p) ? readdirSync(p).sort() : null);

try {
    const M = join(ROOT, "XY1_Markets");
    const NO = join(M, "Norway", "Renders");
    // 1. no _Old yet
    put(`${NO}/Batch_01/a_V01.mov`);
    put(`${NO}/Batch_01/_mp4/a_V01.mp4`);
    put(`${NO}/Batch_01/_mp4/b_V01.mp4`);
    put(`${NO}/Batch_01/_mp4/.DS_Store`);
    // 2. an _old spelled lower-case, holding something else
    put(`${NO}/Batch_02/_old/a_V01.mov`);
    put(`${NO}/Batch_02/_MP4/c_V01.mp4`);
    // 3. archived once already, rendered again
    put(`${NO}/Batch_03/_Old/_mp4/d_V01.mp4`);
    put(`${NO}/Batch_03/_mp4/d_V01.mp4`);
    put(`${NO}/Batch_03/_mp4/d_V02.mp4`);
    // not batches, not previews
    put(`${NO}/Batch_04/_mp4/notes.txt`);
    put(`${NO}/_Delivery/_mp4/z.mp4`);
    put(`${M}/_Archive/Renders/Batch_01/_mp4/z.mp4`);
    put(`${M}/Peru/Renders/Batch_1_POST/_mp4/p.mp4`);
    const MC = join(ROOT, "XY0_Masters", "Support", "Motion_Components");
    put(`${MC}/_mp4/master.mp4`);

    console.log("1. what a campaign sweep finds");
    const found = await findPreviewFolders(M);
    check(found.length === 4, "four batches hold previews", found.map((f) => f.territory + "/" + f.batch + ":" + f.files));
    check(found.every((f) => f.batch.charAt(0) !== "_" && f.territory.charAt(0) !== "_"), "no _ folder is a territory or a batch");
    const b1 = found.find((f) => f.batch === "Batch_01");
    check(b1 && b1.files === 2 && b1.territory === "Norway", "Batch_01: two clips, .DS_Store not counted", b1);
    check((await findPreviewFolders(join(ROOT, "nowhere"))).length === 0, "an unmounted root finds nothing");
    check((await previewFolderOf(`${NO}/Batch_04`)) === null, "an _mp4 with no clip in it is not offered");

    console.log("2. _Old is made when it is missing");
    let r = await archivePreviews(`${NO}/Batch_01`);
    check(r.success && r.madeOld && r.moved === 3, "moved, _Old made", r);
    check(ls(`${NO}/Batch_01`).join() === "_Old,a_V01.mov", "the batch holds _Old and its render", ls(`${NO}/Batch_01`));
    check(ls(`${NO}/Batch_01/_Old/_mp4`).join() === ".DS_Store,a_V01.mp4,b_V01.mp4", "the clips are in _Old/_mp4", ls(`${NO}/Batch_01/_Old/_mp4`));

    console.log("3. an existing _old is reused, whatever its case");
    r = await archivePreviews(`${NO}/Batch_02`);
    check(r.success && !r.madeOld, "moved into the _old that was there", r);
    check(ls(`${NO}/Batch_02`).length === 1, "no second _Old beside it", ls(`${NO}/Batch_02`));
    check(ls(`${NO}/Batch_02/_old`).join() === "_MP4,a_V01.mov", "the folder keeps its own spelling, the old render stays", ls(`${NO}/Batch_02/_old`));

    console.log("4. archived before, rendered again: merged");
    r = await archivePreviews(`${NO}/Batch_03`);
    check(r.success && r.moved === 2, "both clips moved", r);
    check(ls(`${NO}/Batch_03/_Old/_mp4`).join() === "d_V01.mp4,d_V02.mp4", "one folder, both versions", ls(`${NO}/Batch_03/_Old/_mp4`));
    check(!existsSync(`${NO}/Batch_03/_mp4`), "the emptied _mp4 is gone");

    console.log("5. refusals");
    r = await archivePreviews(`${NO}/Batch_01`);
    check(!r.success, "a batch with no _mp4 left: nothing to move", r.error);
    r = await archivePreviews(MC);
    check(!r.success && ls(`${MC}/_mp4`).join() === "master.mp4", "Motion_Components is refused and untouched", r.error);
    r = await archivePreviews(`${NO}/_Delivery`);
    check(!r.success && ls(`${NO}/_Delivery/_mp4`).length === 1, "a _ folder under Renders is refused", r.error);
    r = await archivePreviews("");
    check(!r.success, "no path: refused");

    console.log("6. the campaigns Size Finder reads");
    const C = [{ name: "Odyssey" }, { name: "Forgotten Island" }, { name: "Street Fighter" }, { name: "Paw Patrol" }];
    const names = (l) => l.map((c) => c.name).join(",");
    check(names(activeFirst(C, ["odyssey", "Paw Patrol"], "Street Fighter")) === "Street Fighter,Forgotten Island", "retired out, the current one first", names(activeFirst(C, ["odyssey", "Paw Patrol"], "Street Fighter")));
    check(names(activeFirst(C, ["Odyssey"], "Odyssey")) === "Odyssey,Forgotten Island,Street Fighter,Paw Patrol", "the one it was opened on stays, retired or not");
    check(names(activeFirst(C, [], "")) === names(C), "nothing retired, nowhere in particular: as listed");
    check(names(activeFirst(C, ["Odyssey"], "Unknown")) === "Forgotten Island,Street Fighter,Paw Patrol", "a current campaign not in the list changes nothing else");

    console.log("7. at delivery: only that deliverable's previews move");
    const TH = join(M, "Thailand", "Renders");
    const N = "SF_INTL_Trio_DOOH_Mall_1080x1920px_10s_TH";
    put(`${TH}/Batch_06/_mp4/${N}_V01.mp4`);
    put(`${TH}/Batch_06/_mp4/${N}_V02_DOUBLE_RES.mp4`);
    put(`${TH}/Batch_06/_mp4/SF_INTL_Trio_DOOH_Mall_1080x1920px_15s_TH_V01.mp4`);
    put(`${TH}/Batch_06/_Delivery/${N}.mp4`);
    check(previewKey(`${N}_V02_DOUBLE_RES.mp4`) === previewKey(`${N}.mp4`) && previewKey(`${N}_V01.mov`) === N.toUpperCase(), "version, RES tail and extension are not part of the name");
    let d = await archiveDeliveredPreview(`${TH}/Batch_06/_Delivery/${N}.mp4`);
    check(d.moved === 2 && !d.error, "both versions of the delivered one moved", d);
    check(ls(`${TH}/Batch_06/_Old/_mp4`).join() === `${N}_V01.mp4,${N}_V02_DOUBLE_RES.mp4`, "into _Old/_mp4, both made", ls(`${TH}/Batch_06/_Old/_mp4`));
    check(ls(`${TH}/Batch_06/_mp4`).join() === "SF_INTL_Trio_DOOH_Mall_1080x1920px_15s_TH_V01.mp4", "the 15s, not delivered yet, stays", ls(`${TH}/Batch_06/_mp4`));
    put(`${TH}/Batch_06/_mp4/.DS_Store`);
    d = await archiveDeliveredPreview(`${TH}/Batch_06/_Delivery/2026-10-08/SF_INTL_Trio_DOOH_Mall_1080x1920px_15s_TH_V01.mp4`);
    check(d.moved === 1 && !existsSync(`${TH}/Batch_06/_mp4`), "a dated subfolder still finds its batch; the emptied _mp4 is removed", d);
    // _Delivery under Renders itself: the batch is whichever holds the preview.
    put(`${TH}/Batch_07/_mp4/${N}_V01.mp4`);
    put(`${TH}/Batch_08/_mp4/OTHER_1080x1920px_10s_TH_V01.mp4`);
    d = await archiveDeliveredPreview(`${TH}/_Delivery/${N}_V01.mp4`);
    check(d.moved === 1 && ls(`${TH}/Batch_07/_Old/_mp4`).length === 1 && ls(`${TH}/Batch_08/_mp4`).length === 1 && !existsSync(`${TH}/Batch_08/_Old`), "a territory-level _Delivery: found in its batch, the others untouched", d);
    d = await archiveDeliveredPreview(`${TH}/Batch_08/OTHER_1080x1920px_10s_TH_V01.mov`);
    check(d.moved === 0 && ls(`${TH}/Batch_08/_mp4`).length === 1, "a render that is not a delivery moves nothing", d);
    put(`${TH}/Batch_09/_mp4/${N}_V01.mp4`);
    d = await archiveDeliveredPreview(`${TH}/Batch_09/_Delivery/${N}.mov`);
    check(d.moved === 0 && ls(`${TH}/Batch_09/_mp4`).length === 1 && !existsSync(`${TH}/Batch_09/_Old`), "delivered as a .mov: its preview stays (it is all Size Finder can play)", d);
    d = await archiveDeliveredPreview(`${MC}/_Delivery/master.mp4`);
    check(d.moved === 0 && ls(`${MC}/_mp4`).join() === "master.mp4", "nothing outside a Renders folder", d);
} finally {
    rmSync(ROOT, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : "\nall ok");
process.exit(fails ? 1 : 0);
