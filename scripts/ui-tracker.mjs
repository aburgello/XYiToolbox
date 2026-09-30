// =============================================================================
// scripts/ui-tracker.mjs
// -----------------------------------------------------------------------------
// Click-through of the Batch Tracker on a fake bridge and a fixture jobs feed:
// the open project places it, the stages light, the POST pair is flagged, the
// filter narrows to what needs a look, and every link only opens Finder.
//
//   yarn build:web && node scripts/ui-tracker.mjs
// =============================================================================
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const SHOTS = process.env.UI_SHOTS || os.tmpdir();
const T = "/Volumes/paramount/SF/Markets/Norway";
const P = "SF_INTL_Trio_DOOH_";

const FIXTURES = `{
  teamGetMachineState: () => ({ owner: "Antonio", tag: "Antonio" }),
  getTerritoryCountryCode: () => "NO",
  trackerContext: () => ({ success: true, territoryPath: "${T}", territory: "Norway", batch: "Batch_02", batches: ["Batch_01", "Batch_02"], projectPath: "${T}/AE/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.aep" }),
  trackerScan: (json) => { window.__scan = JSON.parse(json); return { success: true, territory: "Norway", batch: "Batch_02",
    folders: { art: "${T}/JPG_PNG/Batch_2", aep: "${T}/AE/Batch_02", renders: "${T}/Renders/Batch_02", delivered: ["${T}/Renders/Batch_02/_mp4"], specs: "${T}/Masters/Specs" },
    rows: [
      { key: "A", name: "${P}NfkinoPOST_345x496px_30s_NO", art: { path: "${T}/JPG_PNG/Batch_2/${P}NfkinoPOST_345x496px_30s_NO", files: 2 },
        aep: { name: "${P}NfkinoPOST_345x496px_30s_NO_V01.aep", path: "${T}/AE/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.aep", version: 1, versions: 1 },
        render: { name: "${P}NfkinoPOST_345x496px_30s_NO_V02.mov", path: "${T}/Renders/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V02.mov", version: 2, versions: 2, all: [] },
        delivered: { name: "x.mp4", path: "${T}/Renders/Batch_02/_mp4/x.mp4" }, wrike: { name: "x", status: "Prep for delivery" } },
      { key: "B", name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO",
        aep: { name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO_V01.aep", path: "${T}/AE/Batch_02/c.aep", version: 1, versions: 1 },
        near: [{ stage: "art (JPG_PNG)", name: "SF_INTL_Characters_DOOH_Digital MetroPOST_1080x1920px_10s_NO", why: "same size, named differently (and 30s vs 10s)" }] },
      { key: "C", name: "SF_INTL_Characters_DOOH_Digital MetroPOST_1080x1920px_10s_NO", art: { path: "${T}/JPG_PNG/Batch_2/c", files: 1 } },
    ] }; },
}`;
const FEED = [{ id: "J1", title: "SF Motion Outdoor NO 2", assignee: "Antonio", status: "Prep for delivery", updated_at: "", subtask_count: 1, subtasks_done: 0,
    subtasks: [{ id: "s", name: `${P}NFKINOPOST_345x496px_30s_NO`, status: "Active", customStatusName: "Prep for delivery" }] }];

let failures = 0;
const check = (ok, msg, extra) => { if (!ok) failures++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : "")); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, routes: { "api/panel/jobs": FEED } });
try {
    await page.goto();
    await page.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 10000);
    await page.click("button.category-card", "Localise");
    await page.waitFor(`[...document.querySelectorAll(".ls-grid-item")].some(b => /Batch Tracker/.test(b.textContent))`, 8000);
    await page.click(".ls-grid-item", "Batch Tracker");
    check(await page.waitFor(`document.querySelectorAll(".bt-row").length === 3`, 8000), "the tracker opens on the open project's batch");
    check(/Norway/.test(await page.eval(`document.querySelector(".bt-title")?.innerText`)), "…naming the territory");
    const sent = await page.eval(`window.__scan`);
    check(sent && sent.batch === "Batch_02" && sent.wrike.length === 1 && sent.wrike[0].status === "Prep for delivery", "…and it asked with this batch's Wrike subtasks (NO 2 = Batch_02)", sent);

    console.log("\n1. The rows");
    const first = await page.eval(`[...document.querySelectorAll(".bt-row")[0].querySelectorAll(".bt-stage")].map(s => (s.classList.contains("is-on") ? "*" : "") + s.innerText.replace(/\\s+/g, " ").trim())`);
    check(first.join("|") === "*Art|*Built V01|*Rendered V02|*Delivered", "a finished deliverable lights every stage, versions shown", first);
    check(await page.eval(`document.querySelectorAll(".bt-row")[0].classList.contains("is-here")`), "the open project's row is marked");
    check(/Prep for delivery/.test(await page.eval(`document.querySelectorAll(".bt-row")[0].innerText`)), "…with its Wrike status");
    const near = await page.eval(`document.querySelectorAll(".bt-row")[1].querySelector(".bt-near")?.innerText || ""`);
    check(/named SF_INTL_Characters_DOOH_Digital MetroPOST.*same size, named differently \(and 30s vs 10s\)/.test(near.replace(/\s+/g, " ")), "the POST pair is flagged, never joined", near);
    check(/1 deliverable|3 deliverables/.test(await page.eval(`document.querySelector(".bt-summary").innerText`)), "the summary counts the batch", await page.eval(`document.querySelector(".bt-summary").innerText`));

    console.log("\n2. Where is it");
    await page.eval(`window.__spawned = []`);
    await page.click(".bt-link", "Renders");
    await page.click(".bt-link", "Its render");
    await pause(100);
    const sp = await page.eval(`window.__spawned`);
    check(sp.length === 2 && sp[0].join(" ") === `open ${T}/Renders/Batch_02` && sp[1][1] === "-R" && /NfkinoPOST_345x496px_30s_NO_V02\.mov$/.test(sp[1][2]), "a link opens the folder; the open project's render is shown in Finder", sp);
    await page.eval(`document.querySelectorAll(".bt-row")[0].querySelectorAll(".bt-stage")[1].click()`);
    await pause(50);
    check((await page.eval(`window.__spawned`)).length === 3, "a lit stage shows its file in Finder");
    check(await page.eval(`document.querySelectorAll(".bt-row")[2].querySelectorAll(".bt-stage")[1].disabled`), "a stage that doesn't exist can't be pressed");

    console.log("\n3. What needs a look");
    await page.click(".bt-summary .bt-btn");
    await pause(150);
    const left = await page.eval(`[...document.querySelectorAll(".bt-row .bt-name")].map(e => e.innerText)`);
    check(left.length === 2 && left.every((n) => /Characters/.test(n)), "the filter keeps only the rows with something wrong", left);
    await page.shot(path.join(SHOTS, "ui-tracker.png"));
    await page.click(".bt-summary .bt-btn");
    await page.resize(420, 1100);
    await pause(200);
    const sideways = await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    check(sideways <= 0, "no sideways scroll on a docked panel", sideways);
    await page.shot(path.join(SHOTS, "ui-tracker-narrow.png"));

    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
} finally {
    await page.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — the tracker lines a batch up, flags what disagrees, and only ever opens Finder.");
process.exit(failures ? 1 : 0);
