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
const PE = "/Volumes/paramount/SF/Markets/Peru";

const FIXTURES = `{
  teamGetMachineState: () => ({ owner: "Antonio", tag: "Antonio" }),
  getTerritoryCountryCode: (t) => (/Peru/.test(t) ? "PE" : "NO"),
  trackerLocate: (json) => { window.__located = JSON.parse(json); return { success: true, jobs: [
    { id: "J1", territoryPath: "${T}", territory: "Norway", batch: "Batch_02", batches: ["Batch_01", "Batch_02"] },
    { id: "J2", territoryPath: "${PE}", territory: "Peru", batch: "Batch_01", batches: ["Batch_01"] } ] }; },
  trackerContext: () => window.__noCtx ? ({ success: true }) : ({ success: true, territoryPath: "${T}", territory: "Norway", batch: "Batch_02", batches: ["Batch_01", "Batch_02"], projectPath: "${T}/AE/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.aep" }),
  trackerScan: (json) => { const q = JSON.parse(json);
    if (/Peru/.test(q.territoryPath)) { window.__peruScan = q; return { success: true, territory: "Peru", batch: "Batch_01",
      folders: { art: "", aep: "${PE}/AE/Batch_01", renders: "", delivered: [], specs: "" },
      rows: [{ key: "P", name: "${P}RealPlaza_1920x1080px_20s_PE", wrike: { name: "${P}RealPlaza_1920x1080px_20s_PE", status: "Backlog" },
        aep: { name: "${P}RealPlaza_1920x1080px_20s_PE_V01.aep", path: "${PE}/AE/Batch_01/p.aep", version: 1, versions: 1 } }] }; }
    window.__scan = q; return { success: true, territory: "Norway", batch: "Batch_02",
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
      { key: "D", name: "SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO", wrike: { name: "SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO", status: "Backlog" },
        aep: { name: "SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.aep", path: "${T}/AE/Batch_02/d.aep", version: 1, versions: 1 },
        render: { name: "SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.mov", path: "${T}/Renders/Batch_02/d.mov", version: 1, versions: 1, all: [] },
        claimed: { name: "SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO", why: "same words, another order" } },
      { key: "E", name: "${P}Kiwi_1920x1080px_15s_NO", wrike: { name: "${P}Kiwi_1920x1080px_15s_NO", status: "Backlog" } },
      { key: "C", name: "SF_INTL_Characters_DOOH_Digital MetroPOST_1080x1920px_10s_NO", art: { path: "${T}/JPG_PNG/Batch_2/c", files: 1 } },
    ] }; },
  trackerCompCheck: () => ({ success: true, comps: window.__stale || [] }),
  trackerRenameComp: () => { window.__stale = []; window.__compRenamed = true; return { success: true, renamed: 1 }; },
  trackerRename: (json) => { const a = JSON.parse(json); (window.__renames = window.__renames || []).push(a);
    return a.apply ? { success: true, renamed: 3, plan: [] } : { success: true, plan: [{ from: "a", to: "b", kind: "project" }, { from: "a2", to: "b2", kind: "project" }, { from: "c", to: "d", kind: "render" }] }; },
  openLocalisedProject: (p) => { window.__opened = p; return { success: true }; },
  deliveryFindRenders: (json) => { window.__deliverAsked = JSON.parse(json); return { success: true, folders: [], missing: [] }; },
  parseDeliverableNames: (json) => JSON.parse(json).map((n) => ({ success: true, filmTitle: "SF", artworkType: "DOOH", campaign: "Trio", territory: "NO", duration: "15sec", site: "Kiwi" })),
}`;
const FEED = [{ id: "J1", title: "SF Motion Outdoor NO 2", assignee: "Antonio", status: "Prep for delivery", updated_at: "", subtask_count: 1, subtasks_done: 0,
    subtasks: [
        { id: "s", name: `${P}NFKINOPOST_345x496px_30s_NO`, status: "Active", customStatusName: "Prep for delivery" },
        { id: "s2", name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO", status: "Active", customStatusName: "Motion" },
        { id: "s3", name: "SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO", status: "Active", customStatusName: "Backlog" },
        { id: "s4", name: `${P}Kiwi_1920x1080px_15s_NO`, status: "Active", customStatusName: "Backlog" },
    ] },
  { id: "J2", title: "SF Motion Outdoor PE 1", assignee: "Antonio", status: "Motion", updated_at: "", subtask_count: 1, subtasks_done: 0,
    subtasks: [{ id: "p1", name: `${P}RealPlaza_1920x1080px_20s_PE`, status: "Active", customStatusName: "Backlog" }] }];

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
    check(await page.waitFor(`document.querySelectorAll(".bt-row").length === 4`, 8000), "the tracker opens on the open project's batch");
    check(/Norway/.test(await page.eval(`document.querySelector(".bt-title")?.innerText`)), "…naming the territory");
    await page.waitFor(`!!window.__peruScan`, 8000);
    const sent = await page.eval(`window.__scan`);
    check(sent && sent.batch === "Batch_02" && sent.wrike.length === 4 && sent.wrike[0].status === "Prep for delivery", "…and it asked with this batch's Wrike subtasks (NO 2 = Batch_02)", sent);

    console.log("\n1. Wrike's subtasks are the list, folded");
    const names = await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row .bt-name")].map(e => e.innerText)`);
    check(names.length === 4 && names.every((n) => !/MetroPOST/.test(n)), "only the batch's Wrike subtasks are listed", names);
    check(/4\s*in Wrike/.test(await page.eval(`document.querySelector(".bt-summary").innerText`)), "the summary counts Wrike's subtasks");
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
    check(left.length === 3 && !left.some((n) => /NFKINO/i.test(n)), "the filter keeps only the subtasks with something wrong", left);
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

    console.log("\n6. Every problem carries its way out");
    const rowText = (i) => page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[${i}].innerText`);
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[2].querySelector(".bt-row-top").click()`);
    await pause(100);
    const d = (await rowText(2)).replace(/\s+/g, " ");
    check(/On disk it's named SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO \(same words, another order\)/.test(d), "a subtask found under another name says so", d);
    check(/Rendered V01, but Wrike still says Backlog/.test(d) && /1 ahead of Wrike/.test(await page.eval(`document.querySelector(".bt-summary").innerText`)), "…and that Wrike looks behind, as a hint");
    check(/Rename to match Wrike/.test(d) && /Open in AE/.test(d) && !/Build it/.test(d), "…offering Rename and Open, never Build (it's built, just misnamed)", d);
    await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")[2].querySelectorAll(".bt-act")].find(b => /Rename/.test(b.textContent)).click()`);
    check(await page.waitFor(`/Rename 3 files to Wrike/.test(document.querySelector(".dialog-title")?.innerText || "")`, 4000), "the rename asks first, counting what moves");
    check(await page.eval(`window.__renames.length === 1 && window.__renames[0].apply === false`), "…having only planned so far");
    const fits = await page.eval(`(() => { const m = document.querySelector(".dialog-message"), c = document.querySelector(".dialog-card"); return { over: m.scrollWidth - m.clientWidth, right: m.getBoundingClientRect().right - c.getBoundingClientRect().right }; })()`);
    check(fits.over <= 0 && fits.right <= 0, "…and a long filename wraps inside the dialog", fits);
    await page.click(".dialog-btn-primary", "Rename");
    await page.waitFor(`(window.__renames || []).length === 2`, 4000);
    const ren = await page.eval(`window.__renames[1]`);
    check(ren.apply === true && ren.from === "SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO" && ren.to === "SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO" && ren.batch === "Batch_02", "confirmed, it renames the disk's name to Wrike's", ren);

    // The rename rescans, which folds every row: let it land first.
    await page.waitFor(`!!document.querySelector(".bt-msg") && !document.querySelector(".bt-row.is-open")`, 4000);
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[2].querySelector(".bt-row-top").click()`);
    await page.resize(420, 1000); await pause(200);
    await page.shot(path.join(SHOTS, "ui-tracker-actions.png"));
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[2].querySelector(".bt-row-top").click()`);
    await pause(100);
    check(/Renamed 3/.test(await page.eval(`document.querySelector(".bt-msg").innerText`)), "…says what it did, and reads the batch again");
    await page.eval(`window.__stale = ["SF_INTL_Characters_DOOH_Post_old_V01"]`);
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[1].querySelector(".bt-row-top").click()`);
    await pause(100);
    await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")[1].querySelectorAll(".bt-act")].find(b => /Open in AE/.test(b.textContent)).click()`);
    check(await page.waitFor(`window.__opened === "${T}/AE/Batch_02/c.aep"`, 4000), "Open in AE opens the row's project");
    check(await page.waitFor(`!!document.querySelector(".bt-stale")`, 4000), "…and a comp still carrying an old name is pointed out");
    await page.click(".bt-stale .bt-act", "Rename comp");
    check(await page.waitFor(`window.__compRenamed && !document.querySelector(".bt-stale")`, 4000), "…and renamed in one press");

    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[3].querySelector(".bt-row-top").click()`);
    await pause(100);
    check(/Build it/.test(await rowText(3)), "a subtask with nothing on disk offers Build it");
    await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")[3].querySelectorAll(".bt-act")].find(b => /Build it/.test(b.textContent)).click()`);
    check(await page.waitFor(`!!document.querySelector(".ls-pane-tab") && !document.querySelector(".bt")`, 8000), "…which goes back to the Localise landing");
    check(await page.waitFor(`/1 row from SF Motion Outdoor NO 2/.test(document.body.innerText)`, 6000), "…where Build a Batch has the one subtask staged");

    await page.click(".ls-grid-item", "Batch Tracker");
    await page.waitFor(`document.querySelectorAll(".bt-row").length === 4`, 8000);
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[0].querySelector(".bt-row-top").click()`);
    await pause(100);
    await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")[0].querySelectorAll(".bt-act")].find(b => /Deliver/.test(b.textContent)).click()`);
    check(await page.waitFor(`!!window.__deliverAsked`, 8000), "Deliver opens the Deliver page on this job's renders");
    const asked = await page.eval(`window.__deliverAsked`);
    check(asked && asked.code === "NO" && asked.names.some((n) => /NFKINOPOST/.test(n)), "…asking for this job's deliverables", asked);

    console.log("\n7. Your jobs");
    await page.goto();
    await page.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 10000);
    await page.click("button.category-card", "Localise");
    await page.waitFor(`[...document.querySelectorAll(".ls-grid-item")].some(b => /Batch Tracker/.test(b.textContent))`, 8000);
    await page.click(".ls-grid-item", "Batch Tracker");
    check(await page.waitFor(`document.querySelectorAll(".bt-job").length === 2 && !!window.__peruScan`, 8000), "every Wrike job assigned to you is a chip");
    const locd = await page.eval(`window.__located`);
    check(locd.length === 2 && locd[0].code === "NO" && locd[0].batch === "Batch_2" && locd[0].prefix === "SF" && locd[1].batch === "Batch_1", "…located by territory, batch and film prefix", locd);
    const chips = await page.eval(`[...document.querySelectorAll(".bt-job")].map(b => ({ label: b.querySelector(".bt-job-label").innerText, on: b.classList.contains("is-on"), built: b.querySelector(".is-built").style.width, issues: b.querySelector(".bt-issues")?.innerText.trim() || "" }))`);
    check(chips[0].label === "NO 2" && chips[0].on && chips[1].label === "PE 1" && !chips[1].on, "…labelled by territory and batch, the open batch's lit", chips);
    check(chips[0].built === "75%" && chips[0].issues === "3" && chips[1].built === "100%", "…each carrying its own progress and problems", chips);
    await page.click(".bt-job", "PE 1");
    check(await page.waitFor(`/Peru/.test(document.querySelector(".bt-title").innerText) && [...document.querySelectorAll(".bt-rows > .bt-row .bt-name")].some(e => /RealPlaza/.test(e.innerText))`, 6000), "a chip opens its batch, no project needed");
    check(await page.eval(`document.querySelectorAll(".bt-job")[1].classList.contains("is-on")`), "…and lights");

    console.log("\n8. Nothing open: the jobs are the page");
    await page.goto();
    await page.eval(`window.__noCtx = true`);
    await page.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 10000);
    await page.click("button.category-card", "Localise");
    await page.waitFor(`[...document.querySelectorAll(".ls-grid-item")].some(b => /Batch Tracker/.test(b.textContent))`, 8000);
    await page.eval(`window.__noCtx = true`);
    await page.click(".ls-grid-item", "Batch Tracker");
    check(await page.waitFor(`document.querySelectorAll(".bt-jobs.is-overview .bt-job").length === 2 && /3\\/4 built/.test(document.querySelector(".bt-jobs.is-overview").innerText)`, 8000), "with no batch open, your jobs are listed with their counts");
    check(/Pick a job/.test(await page.eval(`document.querySelector(".bt-title").innerText`)), "…under 'Pick a job'");
    await page.shot(path.join(SHOTS, "ui-tracker-jobs.png"));
    await page.click(".bt-job", "NO 2");
    check(await page.waitFor(`/Norway/.test(document.querySelector(".bt-title").innerText) && document.querySelectorAll(".bt-rows > .bt-row").length === 4`, 6000), "…and one press opens a job");
    check(await page.eval(`!document.querySelector(".bt-jobs.is-overview") && !!document.querySelector(".bt-jobs")`), "…the list folding into the chip strip");

    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
} finally {
    await page.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — the tracker lines a batch up, flags what disagrees, and every problem hands off to its fix.");
process.exit(failures ? 1 : 0);
