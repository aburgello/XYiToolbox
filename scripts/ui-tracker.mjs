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
    folders: { art: "${T}/JPG_PNG/Batch_2", aep: "${T}/AE/Batch_02", renders: "${T}/Renders/Batch_02", delivered: ["${T}/Renders/Batch_02/_Delivery"], specs: "${T}/Masters/Specs" },
    rows: [
      { key: "A", name: "${P}NfkinoPOST_345x496px_30s_NO", art: { path: "${T}/JPG_PNG/Batch_2/${P}NfkinoPOST_345x496px_30s_NO", files: 2 },
        aep: { name: "${P}NfkinoPOST_345x496px_30s_NO_V01.aep", path: "${T}/AE/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.aep", version: 1, versions: 1 },
        render: { name: "${P}NfkinoPOST_345x496px_30s_NO_V02.mov", path: "${T}/Renders/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V02.mov", version: 2, versions: 2, all: [] },
        delivered: { name: "x.mp4", path: "${T}/Renders/Batch_02/_Delivery/x.mp4" }, wrike: { name: "${P}NFKINOPOST_345x496px_30s_NO", status: "Prep for delivery" } },
      { key: "B", name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO",
        aep: { name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO_V01.aep", path: "${T}/AE/Batch_02/c.aep", version: 1, versions: 1 },
        wrike: { name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO", status: "Motion" },
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
    check(await page.waitFor(`document.querySelectorAll(".bt-row").length === 2`, 8000), "the tracker opens on the open project's batch");
    check(/Norway/.test(await page.eval(`document.querySelector(".bt-title")?.innerText`)), "…naming the territory");
    const sent = await page.eval(`window.__scan`);
    check(sent && sent.batch === "Batch_02" && sent.wrike.length === 1 && sent.wrike[0].status === "Prep for delivery", "…and it asked with this batch's Wrike subtasks (NO 2 = Batch_02)", sent);

    console.log("\n1. Wrike's subtasks are the list, folded");
    const names = await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row .bt-name")].map(e => e.innerText)`);
    check(names.length === 2 && names.every((n) => !/MetroPOST/.test(n)), "only the batch's Wrike subtasks are listed", names);
    check(/2\s*in Wrike/.test(await page.eval(`document.querySelector(".bt-summary").innerText`)), "the summary counts Wrike's subtasks");
    check(await page.eval(`document.querySelectorAll(".bt-stage").length === 0`), "every row starts folded");
    const pips = await page.eval(`[...document.querySelectorAll(".bt-row")[0].querySelectorAll(".bt-pip")].map(p => p.classList.contains("is-on") ? 1 : 0).join("")`);
    check(pips === "1111", "…a folded row still shows its four stages as pips", pips);
    check(await page.eval(`!!document.querySelectorAll(".bt-row")[0].querySelector(".bt-ok")`), "…and a tick when there's nothing to look at");
    check(await page.eval(`document.querySelectorAll(".bt-row")[1].querySelector(".bt-issues")?.innerText.trim()`) === "1", "…or a count when there is");
    const here = await page.eval(`(() => { const r = document.querySelectorAll(".bt-row")[0]; const cs = getComputedStyle(r); return { here: r.classList.contains("is-here"), pin: !!r.querySelector(".bt-here-pin"), shadow: cs.boxShadow, radius: cs.borderTopLeftRadius }; })()`);
    check(here.here && here.pin && here.shadow === "none" && here.radius === "8px", "the open project's card is outlined and pinned, with no bar on its edge", here);
    check(/Prep for delivery/.test(await page.eval(`document.querySelectorAll(".bt-row")[0].innerText`)), "…with its Wrike status");

    console.log("\n2. Opening a row shows what's wrong");
    await page.eval(`document.querySelectorAll(".bt-row")[1].querySelector(".bt-row-top").click()`);
    await pause(100);
    const near = await page.eval(`document.querySelectorAll(".bt-row")[1].querySelector(".bt-near")?.innerText || ""`);
    check(/named SF_INTL_Characters_DOOH_Digital MetroPOST.*same size, named differently \(and 30s vs 10s\)/.test(near.replace(/\s+/g, " ")), "the POST pair is flagged, never joined", near);
    check(await page.eval(`document.querySelectorAll(".bt-row")[1].querySelectorAll(".bt-near").length`) === 1, "…and the near miss replaces a plain 'no artwork' line");
    await page.eval(`document.querySelectorAll(".bt-row")[0].querySelector(".bt-row-top").click()`);
    await pause(100);
    const first = await page.eval(`[...document.querySelectorAll(".bt-row")[0].querySelectorAll(".bt-stage")].map(s => (s.classList.contains("is-on") ? "*" : "") + s.innerText.replace(/\\s+/g, " ").trim())`);
    check(first.join("|") === "*Art|*Built V01|*Rendered V02|*Delivered", "an opened finished row lists every stage with versions", first);
    check(/Nothing to look at/.test(await page.eval(`document.querySelectorAll(".bt-row")[0].innerText`)), "…and says there's nothing to look at");

    console.log("\n3. On disk, not in Wrike");
    check(/1 on disk, not in Wrike/.test(await page.eval(`document.querySelector(".bt-extra")?.innerText || ""`)), "what Wrike doesn't list folds into one line");
    await page.click(".bt-extra", "on disk");
    await pause(100);
    check(await page.eval(`[...document.querySelectorAll(".bt-row.is-extra .bt-name")].some(e => /MetroPOST/.test(e.innerText))`), "…which opens to show it");

    console.log("\n4. Where is it");
    await page.eval(`window.__spawned = []`);
    await page.click(".bt-link", "Renders");
    await page.click(".bt-link", "Its render");
    await pause(100);
    const sp = await page.eval(`window.__spawned`);
    check(sp.length === 2 && sp[0].join(" ") === `open ${T}/Renders/Batch_02` && sp[1][1] === "-R" && /NfkinoPOST_345x496px_30s_NO_V02\.mov$/.test(sp[1][2]), "a link opens the folder; the open project's render is shown in Finder", sp);
    await page.eval(`document.querySelectorAll(".bt-row")[0].querySelectorAll(".bt-stage")[1].click()`);
    await pause(50);
    check((await page.eval(`window.__spawned`)).length === 3, "a lit stage shows its file in Finder");
    check(await page.eval(`document.querySelectorAll(".bt-row")[1].querySelectorAll(".bt-stage")[0].disabled`), "a stage that doesn't exist can't be pressed");

    console.log("\n5. What needs a look");
    await page.click(".bt-summary .bt-btn");
    await pause(150);
    const left = await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row:not(.is-extra) .bt-name")].map(e => e.innerText)`);
    check(left.length === 1 && /Characters_DOOH_Post/.test(left[0]), "the filter keeps only the subtasks with something wrong", left);
    await page.click(".bt-summary .bt-btn");
    await page.shot(path.join(SHOTS, "ui-tracker.png"));
    await page.resize(420, 420);
    await pause(200);
    const scroll = await page.eval(`(() => { const el = document.querySelector(".bt"); const before = el.scrollTop; el.scrollTop = 9999; const moved = el.scrollTop > before; el.scrollTop = 0; return { moved, h: el.clientHeight, sh: el.scrollHeight, overflow: getComputedStyle(el).overflowY }; })()`);
    check(scroll.moved && scroll.overflow === "auto", "on a short panel the tracker scrolls", scroll);
    const squashed = await page.eval(`[...document.querySelectorAll(".bt > *")].some(e => e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY === "visible")`);
    check(!squashed, "…and nothing inside is squashed to fit");
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
