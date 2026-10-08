// =============================================================================
// scripts/ui-size-finder.mjs
// -----------------------------------------------------------------------------
// Click-through of Size Finder on a fake bridge and a fake folder tree (the
// harness answers readdir from window.__fsTree; nothing real is read).
//
//   yarn build:web && node scripts/ui-size-finder.mjs
// =============================================================================
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const SHOTS = process.env.UI_SHOTS || os.tmpdir();
const SF = "/Volumes/paramount/SF/Markets";
const FID = "/Volumes/universal/FID/Markets";

const FIXTURES = `{
  loadLocLibCampaigns: () => [
    { name: "Street Fighter", marketsRoot: "${SF}" },
    { name: "Forgotten Island", marketsRoot: "${FID}" },
    { name: "Gone", marketsRoot: "/Volumes/unmounted/Markets" } ],
}`;

// path -> children, built from a flat list of files.
const tree = {};
const put = (p) => {
    const parts = p.split("/");
    for (let i = 2; i <= parts.length; i++) {
        const dir = parts.slice(0, i - 1).join("/");
        const name = parts[i - 1];
        const list = (tree[dir] = tree[dir] || []);
        if (!list.some((e) => e.name === name)) list.push({ name, dir: i < parts.length });
    }
};
const d = (root, terr, batch, name, ext = "mp4") => put(`${root}/${terr}/Renders/${batch}/_Delivery/${name}.${ext}`);
d(SF, "Denmark", "Batch_01", "SF_INTL_Trio_DOOH_Kube_520x520px_10s_DK");
put(`${SF}/Denmark/PDFs/Batch_1/SF_INTL_Trio_DOOH_Kube_520x520px_10s_DK.pdf`);
put(`${SF}/Denmark/JPG_PNG/Batch_1/SF_INTL_Trio_DOOH_Kube_520x520px_10s_DK/SF_INTL_Trio_DOOH_Kube_520x520px_10s_DK.jpg`);
put(`${SF}/Denmark/JPG_PNG/Batch_1/SF_INTL_Trio_DOOH_Kube_520x520px_10s_DK/SF_INTL_Trio_DOOH_Kube_520x520px_10s_DK2.jpg`);
put(`${SF}/Denmark/JPG_PNG/Batch_1/SF_INTL_Trio_DOOH_Kube_520x520px_10s_DK/ARTWORK_ONLY/SF_INTL_Trio_DOOH_Kube_520x520px_10s_DK_ARTWORK_1.jpg`);
put(`${SF}/Peru/JPG_PNG/SF_INTL_Trio_DOOH_RealPlaza_816x864px_20s_PE/SF_INTL_Trio_DOOH_RealPlaza_816x864px_20s_PE1.png`);
d(SF, "Taiwan", "Batch_01", "SF_INTL_Trio_DOOH_Square_1024x1024px_15s_TW");
put(`${SF}/Taiwan/PDFs/Batch_1/SF_INTL_Trio_DOOH_SomethingElse_1024x1024px_10s_TW.pdf`);
d(SF, "Peru", "Batch_01", "SF_INTL_Trio_DOOH_RealPlaza_816x864px_20s_PE");
d(SF, "Norway", "Batch_01", "SF_INTL_Trio_DOOH_Nfkino_1160x800px_30s_NO", "mov");
d(SF, "Norway", "Batch_01", "SF_INTL_Trio_DOOH_1920x1080px_30s_NO");
d(SF, "Chile", "Batch_01", "SF_INTL_Characters_DOOH_Mall_1920x1080px_10s_CL");
d(FID, "Italy", "Batch_01", "FID_INTL_PortalToParadise_DOOH_Cubo_400x400px_10s_IT");
put(`${FID}/Italy/PDFs/FID_INTL_PortalToParadise_DOOH_Cubo_400x400px_10s_IT.pdf`);

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };
const type = (page, v) => page.eval(`(() => { const i = document.querySelector(".szf-size input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const text = (page, sel) => page.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ""`);
const sizes = (page) => page.eval(`[...document.querySelectorAll(".szf-card .szf-card-size")].map(e => e.innerText.split(" ")[0])`);

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, width: 900, height: 1200 });
try {
    await page.goto();
    await page.eval(`window.__fsTree = ${JSON.stringify(tree)}; try { localStorage.removeItem("xyi.sizefinder.size"); } catch (e) {}`);
    await page.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 10000);
    await page.click("button.category-card", "Localise");
    await page.waitFor(`[...document.querySelectorAll(".ls-grid-item")].some(b => /Size Finder/.test(b.textContent))`, 8000);
    check(await page.click(".ls-grid-item", "Size Finder"), "Size Finder is a tool on the Localise page");
    check(await page.waitFor(`/approved deliverable/.test((document.querySelector(".szf-sum") || {}).innerText || "")`, 10000), "it reads every campaign's Markets on opening");
    const sum = await text(page, ".szf-sum");
    check(/7 approved deliverables in 6 sizes/.test(sum), "…and counts what was delivered", sum);
    check(/not mounted: Gone/.test(sum), "an unmounted campaign is named, not an error", sum);

    const chips = await page.eval(`[...document.querySelectorAll(".szf-common .szf-chip")].map(e => e.innerText.replace(/\\s+/g, " "))`);
    check(chips.length === 6 && /^1920×1080 ?2$/.test(chips[0]), "with nothing typed: the sizes made most often", chips);
    check(await page.eval(`document.querySelectorAll(".szf-card").length`) === 0, "…and no results until a size is asked for");

    await type(page, "400x400");
    await page.waitFor(`document.querySelectorAll(".szf-card").length > 0`, 4000);
    const order = await sizes(page);
    check(order.slice(0, 5).join() === "400×400,520×520,1024×1024,816×864,1160×800", "400x400: the exact one, then squares by scale, then the nearest shapes", order);
    const nears = await page.eval(`[...document.querySelectorAll(".szf-card .szf-card-near")].map(e => e.innerText)`);
    check(nears[0] === "Exact size" && nears[1] === "Same ratio · 1:1" && nears[3] === "17:18 · 5.9% taller", "each card says how close its RATIO is, not its scale", nears.slice(0, 4));
    check((await text(page, ".szf-ratio")).trim() === "1:1", "the typed size shows its own ratio", await text(page, ".szf-ratio"));
    check(/1 at exactly 400×400, 2 more at the same ratio/.test(await text(page, ".szf-sum")), "the summary says how many are exact and how many the same ratio", await text(page, ".szf-sum"));
    check(/Cubo_400x400px/.test(await text(page, ".szf-detail-head")) && /Italy · Forgotten Island/.test(await text(page, ".szf-detail-head")), "the closest is shown at once, clip beside PDF", await text(page, ".szf-detail-head"));
    check(await page.eval(`!!document.querySelector(".szf-pane video")`), "…with its clip");
    check(await page.waitFor(`/No JPG_PNG folder named after this deliverable in Italy/.test((document.querySelector(".szf-detail") || {}).innerText || "")`, 3000), "no JPG_PNG folder for it: said, with the PDF still one press away");

    await page.click(".szf-card", "1024×1024");
    await page.waitFor(`/Square_1024/.test((document.querySelector(".szf-detail-head") || {}).innerText || "")`, 3000);
    check(/Open the PDFs folder/.test(await text(page, ".szf-detail")), "a deliverable with no PDF offers the PDFs folder instead", (await text(page, ".szf-detail")).slice(0, 200));
    await page.click(".szf-card", "816×864");
    check(await page.waitFor(`/RealPlaza|couldn't be shown/.test((document.querySelector(".szf-detail") || {}).innerText || "")`, 3000), "a folder holding only artwork still shows its artwork (one picture: no pager)");
    check(await page.eval(`!!document.querySelector(".szf-card.is-active") && /816/.test(document.querySelector(".szf-card.is-active").innerText)`), "the picked card is marked");

    await page.click(".szf-card", "1160×800");
    await page.waitFor(`/Nfkino/.test((document.querySelector(".szf-detail-head") || {}).innerText || "")`, 3000);
    check(/can't play here/.test(await text(page, ".szf-detail")), "a .mov with no mp4 says it can't play, and is still listed");

    await page.click(".szf-card", "520×520");
    await page.waitFor(`/Kube/.test((document.querySelector(".szf-detail-head") || {}).innerText || "")`, 3000);
    // The harness blocks file:// images, so a FOUND sheet shows as "couldn't
    // be shown" here; "No JPG named…" would mean it was not found at all.
    check(await page.waitFor(`!!document.querySelector("img.szf-sheet") || /couldn't be shown/.test((document.querySelector(".szf-detail") || {}).innerText || "")`, 3000), "a folder holding the sheet's JPG finds it");
    const pager = () => text(page, ".szf-pager");
    check(/^\s*1 of 3/.test(await pager()) && /Kube_520x520px_10s_DK\.jpg/.test(await pager()), "more than one picture: a pager, opening on the sheet", await pager());
    await page.click(".szf-pager button[aria-label='Next picture']");
    check(/2 of 3/.test(await pager()) && /DK2\.jpg/.test(await pager()), "next is the numbered artwork", await pager());
    await page.click(".szf-pager button[aria-label='Next picture']");
    check(/3 of 3/.test(await pager()) && /ARTWORK_ONLY\/.*_ARTWORK_1\.jpg/.test(await pager()), "…then what is in ARTWORK_ONLY", await pager());
    await page.click(".szf-pager button[aria-label='Next picture']");
    check(/1 of 3/.test(await pager()), "and round to the sheet again");
    await page.click(".szf-pager button[aria-label='Previous picture']");
    check(/3 of 3/.test(await pager()), "previous goes back round");
    await page.click(".szf-btn", "Open the PDF");
    await page.click(".szf-btn", "Show in Finder");
    const spawned = await page.eval(`window.__spawned || []`);
    check(spawned.length === 2 && /Kube_520x520px_10s_DK\.pdf$/.test(spawned[0][1]) && spawned[1][1] === "-R", "Open the PDF and Show in Finder only ever open things", spawned);
    await page.click(".szf-btn", "Play large");
    check(await page.waitFor(`!!document.querySelector(".video-player-overlay")`, 3000), "Play large opens the one player");
    await page.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);

    // --- by creative ---
    const crea = () => page.eval(`[...document.querySelectorAll(".szf-creatives .szf-chip")].map(e => e.innerText.replace(/\\s+/g, " ").trim() + (e.classList.contains("is-on") ? "*" : ""))`);
    check((await crea()).join("|") === "Every creative7*|Trio5|Characters1|PortalToParadise1", "the creatives delivered, most first, all of them on to begin with", await crea());
    await page.click(".szf-creatives .szf-chip", "Characters");
    await page.waitFor(`document.querySelectorAll(".szf-card").length === 1`, 3000);
    check((await sizes(page)).join() === "1920×1080" && /1 approved Characters deliverable in 1 size/.test(await text(page, ".szf-sum")), "one creative: only its deliverables, and the count says whose", await text(page, ".szf-sum"));
    check(/Characters · Chile/.test(await text(page, ".szf-card-where")), "a card names its creative", await text(page, ".szf-card-where"));
    await page.click(".szf-creatives .szf-chip", "Trio");
    await page.waitFor(`document.querySelectorAll(".szf-card").length === 5`, 3000);
    check((await sizes(page))[0] === "520×520", "another creative re-ranks within it: Trio's closest to 400x400", await sizes(page));
    await page.click(".szf-creatives .szf-chip", "Every creative");
    await page.waitFor(`document.querySelectorAll(".szf-card").length === 7`, 3000);

    await type(page, "600x300");
    await page.waitFor(`/2:1/.test((document.querySelector(".szf-ratio") || {}).innerText || "")`, 3000);
    check((await text(page, ".szf-ratio")).trim() === "2:1", "600x300 is 2:1", await text(page, ".szf-ratio"));
    await type(page, "1920x1080");
    await page.waitFor(`/2 at exactly/.test((document.querySelector(".szf-sum") || {}).innerText || "")`, 3000);
    check((await sizes(page)).slice(0, 2).join() === "1920×1080,1920×1080", "another size re-ranks", await sizes(page));
    await type(page, "wide");
    await page.waitFor(`document.querySelectorAll(".szf-card").length === 0`, 3000);
    check(/isn't a size/.test(await text(page, ".szf-common-label")), "text that is not a size says so and offers sizes instead");

    await page.shot(path.join(SHOTS, "size-finder.png"));
    await type(page, "400x400");
    await page.waitFor(`document.querySelectorAll(".szf-card").length > 0`, 3000);
    await page.shot(path.join(SHOTS, "size-finder-400.png"));
    const errs = await page.eval(`window.__errors || []`);
    check(!errs.length, "no page errors", errs);
} finally {
    await page.close();
}
// ---------------------------------------------------------------------------
// THE TEAM FOLDER'S COPY. A fresh page each time, so nothing is kept in memory.
console.log("\nThe team folder's copy");
const TEAM_FIX = (owner) => `{
  loadLocLibCampaigns: () => [{ name: "Street Fighter", marketsRoot: "${SF}" }],
  teamGetFolder: () => ({ success: true, path: "/Volumes/newmedia/Team_Folder", mounted: true }),
  teamGetMachineState: () => ({ success: true, owner: "${owner}" }),
}`;
const COPY = "/Volumes/newmedia/Team_Folder/misc/sizes/Street_Fighter.json";
const open = async (p, files, delay) => {
    await p.goto();
    await p.eval(`window.__fsTree = ${JSON.stringify(tree)}; window.__fsFiles = ${JSON.stringify(files)}; window.__fsDelay = ${delay || 0}; try { localStorage.setItem("xyi.sizefinder.size", "400x400"); } catch (e) {}`);
    await p.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 10000);
    await p.click("button.category-card", "Localise");
    await p.waitFor(`[...document.querySelectorAll(".ls-grid-item")].some(b => /Size Finder/.test(b.textContent))`, 8000);
    await p.click(".ls-grid-item", "Size Finder");
};
let p1 = await launch({ root: ROOT, fixturesSrc: TEAM_FIX("Antonio"), width: 900, height: 1200 });
let written = null;
try {
    await open(p1, {});
    check(await p1.waitFor(`/6 approved/.test((document.querySelector(".szf-sum") || {}).innerText || "")`, 10000), "no team copy yet: the disk is read", await text(p1, ".szf-sum"));
    check(await p1.waitFor(`!!(window.__fsFiles || {})[${JSON.stringify(COPY)}]`, 4000), "…and a tagged machine leaves its read in the team folder");
    written = JSON.parse(await p1.eval(`window.__fsFiles[${JSON.stringify(COPY)}]`));
    check(written.version === 1 && written.scannedBy === "Antonio" && written.rows.length === 6, "one file per campaign, saying who read it", { by: written.scannedBy, rows: written.rows.length });
    check(written.rows.every((r) => !/^\/Volumes/.test(r.delivered)) && /^Denmark\//.test(written.rows.find((r) => /Kube/.test(r.name)).delivered), "paths are kept relative to the Markets root, so another mount still works", written.rows.find((r) => /Kube/.test(r.name)).delivered);
    check(!Object.keys(await p1.eval(`window.__fsFiles`)).some((k) => /\.tmp$/.test(k)), "written through a temp file that is gone afterwards");
} finally { await p1.close(); }

// The team copy knows one deliverable the disk no longer has: shown at once,
// then the slow disk check behind it corrects it and rewrites the copy.
const stale = JSON.parse(JSON.stringify(written));
stale.rows.push({ ...stale.rows[0], id: "Street Fighter|Japan|X", territory: "Japan", name: "SF_INTL_Trio_DOOH_TeamOnly_400x400px_10s_JP", w: 400, h: 400, delivered: "Japan/Renders/_Delivery/SF_INTL_Trio_DOOH_TeamOnly_400x400px_10s_JP.mp4", preview: "" });
stale.scannedBy = "Someone";
let p2 = await launch({ root: ROOT, fixturesSrc: TEAM_FIX("Antonio"), width: 900, height: 1200 });
try {
    await open(p2, { [COPY]: JSON.stringify(stale) }, 120);
    check(await p2.waitFor(`/7 approved/.test((document.querySelector(".szf-sum") || {}).innerText || "")`, 4000), "the team copy draws first, before any folder is read", await text(p2, ".szf-sum"));
    check(/checking for new deliveries/.test(await text(p2, ".szf-sum")), "…saying the disk is being checked behind it", await text(p2, ".szf-sum"));
    check(/Japan/.test(await p2.eval(`[...document.querySelectorAll(".szf-card-where")].map(e => e.innerText).join("|")`)), "…with the team copy's rows, paths made whole again");
    check(await p2.waitFor(`/6 approved/.test((document.querySelector(".szf-sum") || {}).innerText || "") && !/checking/.test(document.querySelector(".szf-sum").innerText)`, 15000), "then the disk answers and the page follows it", await text(p2, ".szf-sum"));
    const after = JSON.parse(await p2.eval(`window.__fsFiles[${JSON.stringify(COPY)}]`));
    check(after.rows.length === 6 && after.scannedBy === "Antonio", "…and the team copy is replaced with what the disk said", { rows: after.rows.length, by: after.scannedBy });
} finally { await p2.close(); }

// An untagged machine reads the copy but never writes one.
let p3 = await launch({ root: ROOT, fixturesSrc: TEAM_FIX(""), width: 900, height: 1200 });
try {
    await open(p3, { [COPY]: JSON.stringify(stale) });
    await p3.waitFor(`/6 approved/.test((document.querySelector(".szf-sum") || {}).innerText || "")`, 10000);
    const kept = JSON.parse(await p3.eval(`window.__fsFiles[${JSON.stringify(COPY)}]`));
    check(kept.scannedBy === "Someone" && kept.rows.length === 7, "an untagged machine never writes to the team folder", { by: kept.scannedBy });
} finally { await p3.close(); }

// ACTIVE CAMPAIGNS ONLY, opening on the one being worked on.
console.log("\nRetired campaigns");
const RET_FIX = `{
  loadLocLibCampaigns: () => [
    { name: "Forgotten Island", marketsRoot: "${FID}" },
    { name: "Gone", marketsRoot: "/Volumes/unmounted/Markets" },
    { name: "Street Fighter", marketsRoot: "${SF}" } ],
  teamCampaignBoard: () => window.__noBoard ? ({ success: true, read: false, rows: [] }) : ({ success: true, read: true, rows: [
    { name: "Forgotten Island", mastersRoot: "", marketsRoot: "", retiredBy: "Antonio", retiredAt: "x" },
    { name: "Street Fighter", mastersRoot: "", marketsRoot: "", retiredBy: "", retiredAt: "" } ] }),
  csvLocaliserLoadLastCampaign: () => "Street Fighter",
}`;
for (const noBoard of [false, true]) {
    const p4 = await launch({ root: ROOT, fixturesSrc: RET_FIX, width: 900, height: 1200 });
    try {
        await p4.goto();
        await p4.eval(`window.__noBoard = ${noBoard}`);
        await open(p4, {});
        await p4.waitFor(`/approved/.test((document.querySelector(".szf-sum") || {}).innerText || "")`, 10000);
        await new Promise((r) => setTimeout(r, 300));
        const asked = await p4.eval(`[...new Set(window.__calls.filter(c => c.fn === "teamCampaignBoard").map(c => c.fn))]`);
        const on = await text(p4, ".szf-campaign");
        const all = await p4.eval(`document.body.innerText`);
        if (!noBoard) {
            check(asked.length === 1 && /Street Fighter/.test(on), "it opens on the campaign being worked on", on);
            check(!/Forgotten Island/.test(all), "a retired campaign is not read or shown");
            check(/6 approved/.test(await text(p4, ".szf-sum")), "…so only the active ones are counted", await text(p4, ".szf-sum"));
        } else {
            check(/Street Fighter/.test(on) && /not mounted: Gone/.test(await text(p4, ".szf-sum")), "a team board that can't be read retires nothing", await text(p4, ".szf-sum"));
        }
        check(!p4.errors.length, "no page errors", p4.errors);
    } finally { await p4.close(); }
}

console.log(fails ? "\n" + fails + " FAILED" : "\nCLEAN — a size in, the closest approved deliverables out, each with its clip and its PDF.");
process.exit(fails ? 1 : 0);
