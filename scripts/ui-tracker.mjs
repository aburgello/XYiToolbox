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
    window.__scan = q;
    // Like the real one, a row's Wrike status is whatever the scan was SENT.
    const echo = (out) => { out.rows.forEach((r) => { if (!r.wrike) return; const w = (q.wrike || []).find((x) => x.name === r.wrike.name); if (w) r.wrike.status = w.status; }); return out; };
    return echo({ success: true, territory: "Norway", batch: "Batch_02",
    folders: { art: "${T}/JPG_PNG/Batch_2", aep: "${T}/AE/Batch_02", renders: "${T}/Renders/Batch_02", delivered: ["${T}/Renders/Batch_02/_Delivery"], specs: "${T}/Masters/Specs" },
    rows: [
      { key: "A", name: "${P}NfkinoPOST_345x496px_30s_NO", art: { path: "${T}/JPG_PNG/Batch_2/${P}NfkinoPOST_345x496px_30s_NO", files: 2 },
        aep: { name: "${P}NfkinoPOST_345x496px_30s_NO_V01.aep", path: "${T}/AE/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.aep", version: 1, versions: 1 },
        render: { name: "${P}NfkinoPOST_345x496px_30s_NO_V02.mov", path: "${T}/Renders/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V02.mov", version: 2, versions: 2, all: [] },
        delivered: { name: "x.mp4", path: "${T}/Renders/Batch_02/_Delivery/x.mp4" },
        preview: { name: "${P}NfkinoPOST_345x496px_30s_NO_V01.mp4", path: "${T}/Renders/Batch_02/_mp4/${P}NfkinoPOST_345x496px_30s_NO_V01.mp4", version: 1 }, wrike: { name: "${P}NFKINOPOST_345x496px_30s_NO", status: "Prep for delivery" } },
      { key: "B", name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO",
        aep: { name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO_V01.aep", path: "${T}/AE/Batch_02/c.aep", version: 1, versions: 1 },
        wrike: { name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO", status: "To amend" },
        near: [{ stage: "art (JPG_PNG)", name: "SF_INTL_Characters_DOOH_Digital MetroPOST_1080x1920px_10s_NO", why: "same size, named differently (and 30s vs 10s)" }] },
      { key: "D", name: "SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO", wrike: { name: "SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO", status: "Backlog" },
        aep: { name: "SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.aep", path: "${T}/AE/Batch_02/d.aep", version: 1, versions: 1 },
        render: { name: "SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.mov", path: "${T}/Renders/Batch_02/d.mov", version: 1, versions: 1, all: [] },
        claimed: { name: "SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO", why: "same words, another order" } },
      { key: "E", name: "${P}Kiwi_1920x1080px_15s_NO", wrike: { name: "${P}Kiwi_1920x1080px_15s_NO", status: "Backlog" } },
      { key: "C", name: "SF_INTL_Characters_DOOH_Digital MetroPOST_1080x1920px_10s_NO", art: { path: "${T}/JPG_PNG/Batch_2/c", files: 1 } },
    ] }); },
  trackerCompCheck: () => ({ success: true, comps: window.__stale || [] }),
  // A method, so THIS is the fixtures: every chip answered by the fake trackerScan.
  trackerScanMany(json) { const list = JSON.parse(json); window.__scanMany = (window.__scanMany || 0) + 1; const keep = window.__scan; const out = {}; list.forEach((q) => { out[q.id] = this.trackerScan(JSON.stringify(q)); }); window.__scan = keep; return { success: true, results: out }; },
  trackerRenameComp: () => { window.__stale = []; window.__compRenamed = true; return { success: true, renamed: 1 }; },
  trackerRename: (json) => { const a = JSON.parse(json); (window.__renames = window.__renames || []).push(a);
    return a.apply ? { success: true, renamed: 3, plan: [] } : { success: true, plan: [{ from: "a", to: "b", kind: "project" }, { from: "a2", to: "b2", kind: "project" }, { from: "c", to: "d", kind: "render" }] }; },
  openLocalisedProject: (p) => { window.__opened = p; return { success: true }; },
  deliveryFindRenders: (json) => { window.__deliverAsked = JSON.parse(json); return { success: true, folders: [], missing: [] }; },
  parseDeliverableNames: (json) => JSON.parse(json).map((n) => ({ success: true, filmTitle: "SF", artworkType: "DOOH", campaign: "Trio", territory: "NO", duration: "15sec", site: "Kiwi" })),
}`;
const FEED = [{ id: "J1", title: "SF Motion Outdoor NO 2", assignee: "Antonio", status: "To amend", updated_at: "", subtask_count: 1, subtasks_done: 0,
    subtasks: [
        { id: "s", name: `${P}NFKINOPOST_345x496px_30s_NO`, status: "Active", customStatusName: "Prep for delivery" },
        { id: "s2", name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO", status: "Active", customStatusName: "To amend" },
        { id: "s3", name: "SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO", status: "Active", customStatusName: "Backlog" },
        { id: "s4", name: `${P}Kiwi_1920x1080px_15s_NO`, status: "Active", customStatusName: "Backlog" },
    ] },
  { id: "J2", title: "SF Motion Outdoor PE 1", assignee: "Antonio", status: "Motion", updated_at: "", subtask_count: 1, subtasks_done: 0,
    subtasks: [{ id: "p1", name: `${P}RealPlaza_1920x1080px_20s_PE`, status: "Active", customStatusName: "Backlog" }] }];

let failures = 0;
const check = (ok, msg, extra) => { if (!ok) failures++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : "")); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const openRowAt = (page, i) => page.eval(`(() => { const r = document.querySelectorAll(".bt-rows > .bt-row")[${i}]; if (r && !r.classList.contains("is-open")) r.querySelector(".bt-row-top").click(); })()`);

// The feed answers a LIVE read (refresh=1) with Wrike as it is now, and
// anything else with the snapshot -- the difference the tracker kept hiding.
// `liveKiwi` is what Wrike says about the Kiwi subtask right now.
let liveKiwi = "Motion";
const liveFeed = () => FEED.map((j) => ({ ...j, subtasks: j.subtasks.map((st) => (/Kiwi/.test(st.name) ? { ...st, customStatusName: liveKiwi } : st)) }));
// The job's latest Wrike comment, shaped like Michael's on NO 2: filenames
// (one as the DISK spells it), then the note; a line under no filename.
// The NEWEST comment is a hand-off with no amends in it (NO 2, 2026-09-30):
// the tracker must still find Michael's, which is older.
const HANDOFF = { author: "James Crouch", date: new Date().toISOString(), text: "@Sara Rivas\nDOOH Motions x8:\n/Volumes/paramount/SF/Markets/Norway/Renders/Batch_02" };
const COMMENT_BASE = { task: "J1", count: 3, comment: { author: "Michael Sills", date: new Date(Date.now() - 3600e3).toISOString(), text: [
    "SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.mov",
    "🔶 The paramount logo is cut off at the top",
    "",
    `${P}NfkinoPOST_345x496px_30s_NO_V01.mov`,
    "🔶On the MC please move the TT and date to the right",
    "",
    "✅ The others are approved",
].join("\n") } };
// And the motioner's own "amends are in" REPLY, which repeats the filenames
// and notes -- newer than the amends, and never the one to show.
const REPLY = { author: "Antonio Burgello", date: new Date(Date.now() - 1800e3).toISOString(), text: "Hey @Michael Sills , amends are in:\n\nSF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V02.mov\n:small_orange_diamond: The paramount logo is fixed" };
const COMMENT = { ...COMMENT_BASE, comment: HANDOFF, recent: [HANDOFF, REPLY, COMMENT_BASE.comment] };
let commentAsks = [];
const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, routes: {
    "api/panel/comment": (url) => { commentAsks.push(url); return /task=J1/.test(url) ? COMMENT : { comment: null, count: 0 }; },
    "api/panel/jobs": (url) => (/refresh=1/.test(url) ? liveFeed() : FEED),
} });
try {
    await page.goto();
    await page.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 10000);
    await page.click("button.category-card", "Localise");
    await page.waitFor(`[...document.querySelectorAll(".ls-pane-tab")].some(b => /Tracker/.test(b.textContent))`, 8000);
    await page.click(".ls-pane-tab", "Tracker");
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

    console.log("\n3b. Previews");
    check(await page.eval(`!!document.querySelectorAll(".bt-rows > .bt-row")[0].querySelector(".bt-play") && !document.querySelectorAll(".bt-rows > .bt-row")[1].querySelector(".bt-play")`), "a row with a preview in _mp4 has a play button; one without has none");
    check(await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[0].querySelector(".bt-play").classList.contains("is-stale")`), "…marked when the preview is older than the newest render");
    // Headless Chrome can't load a file:// video, so the thumb falls back to its
    // empty state -- the thumb itself is what's checked.
    check(await page.eval(`!!document.querySelectorAll(".bt-rows > .bt-row")[0].querySelector(".bt-thumb")`), "an opened row shows the preview's poster frame");
    check(await page.eval(`getComputedStyle(document.querySelectorAll(".bt-rows > .bt-row")[0].querySelector(".bt-chev")).transform !== "none" && getComputedStyle(document.querySelectorAll(".bt-rows > .bt-row")[3].querySelector(".bt-chev")).transform === "none"`), "an open row's chevron turns; a folded one's doesn't");
    check(/The preview is V01; the newest render is V02/.test(await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[0].innerText`)), "…and says it's older than the render");
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[0].querySelector(".bt-play").click()`);
    check(await page.waitFor(`/NfkinoPOST_345x496px_30s_NO_V01\\.mp4/.test(document.querySelector(".video-player-title")?.innerText || "")`, 4000), "play opens the panel's player on the _mp4 preview");
    await page.eval(`document.querySelector(".video-player-close").click()`);
    check(await page.waitFor(`!document.querySelector(".video-player-overlay")`, 4000), "…and closes");
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[0].querySelector(".bt-thumb").click()`);
    check(await page.waitFor(`!!document.querySelector(".video-player-overlay")`, 4000), "the poster frame opens it too");
    await page.eval(`document.querySelector(".video-player-close").click()`);
    await page.waitFor(`!document.querySelector(".video-player-overlay")`, 4000);

    console.log("\n3c. To amend");
    check(/2 to amend/.test(await page.eval(`document.querySelector(".bt-summary").innerText`)), "the summary counts the To amend subtask and the row the comment names on its newest version", await page.eval(`document.querySelector(".bt-summary").innerText`));
    const amendBtns = await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")].map(r => r.querySelector(".bt-row-head .bt-amend")?.innerText.trim() || "")`);
    check(amendBtns.join("|") === "|Amend|Amend||", "rows with open amends get Amend on their folded line; a note on an older version than the render does not", amendBtns);
    check(await page.eval(`!document.querySelectorAll(".bt-rows > .bt-row")[1].querySelector(".bt-wrike")`), "…in place of the status pill, which would say the same thing");
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[1].querySelector(".bt-row-head .bt-amend").click()`);
    check(await page.waitFor(`window.__opened === "${T}/AE/Batch_02/c.aep"`, 4000), "…which opens that project, without opening the row");
    await page.eval(`window.__opened = null`);

    console.log("\n3d. The amends, from the job's latest Wrike comment");
    check(commentAsks.length >= 1 && commentAsks.every((u) => /task=J1/.test(u)), "only the To amend job's comment is asked for", commentAsks.map((u) => u.replace(/^.*\?/, "")));
    const card = await page.eval(`document.querySelector(".bt-comment")?.innerText || ""`);
    check(/Amends in Wrike · Michael Sills/.test(card) && /A newer comment follows it \(James Crouch/.test(card), "a later hand-off and your own 'amends are in' reply don't bury the amends: Michael's is picked", card);
    check(/2 deliverables with amends/.test(card) && /The others are approved/.test(card) && !/paramount/.test(card), "the job's card names the reviewer, counts the deliverables and says the general line once", card);
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[2].querySelector(".bt-row-top").click()`);
    await pause(100);
    const dNotes = await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[2].querySelector(".bt-amends")?.innerText || ""`);
    check(/The paramount logo is cut off at the top/.test(dNotes) && /on V01/.test(dNotes), "the note written against the DISK's name lands on the row Wrike names differently", dNotes);
    const aNotes = await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[0].querySelector(".bt-amends")?.innerText || ""`);
    check(/move the TT and date to the right/.test(aNotes) && /V02 rendered since/.test(aNotes), "a note on V01 with a V02 rendered since says so", aNotes);
    check(await page.eval(`!document.querySelectorAll(".bt-rows > .bt-row")[3].querySelector(".bt-amends")`), "a row the comment doesn't name shows no amends");
    await page.click(".bt-comment-toggle", "Full comment");
    check(await page.waitFor(`/SF_INTL_Trio_POST_DOOH/.test(document.querySelector(".bt-comment-full")?.innerText || "")`, 3000), "the full comment is one press away, as plain text");
    await page.click(".bt-comment-toggle", "Hide");
    await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[2].querySelector(".bt-row-top").click()`);
    await pause(100);

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
    // As a Localise pane the PAGE scrolls (the tracker gives its scroll box
    // up there): find what scrolls above it, and reach the last row with it.
    const scroll = await page.eval(`(() => {
        let el = document.querySelector(".bt");
        while (el && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)) el = el.parentElement;
        if (!el) return { found: false };
        const before = el.scrollTop;
        const rows = document.querySelectorAll(".bt-rows > .bt-row, .bt-rows > .bt-extra");
        rows[rows.length - 1].scrollIntoView({ block: "end" });
        const last = rows[rows.length - 1].getBoundingClientRect();
        const box = el.getBoundingClientRect();
        const reached = last.bottom <= box.bottom + 1 && last.top >= box.top - 1;
        const moved = el.scrollTop > before; el.scrollTop = 0;
        return { found: true, moved, reached, cls: el.className };
    })()`);
    check(scroll.found && scroll.moved && scroll.reached, "on a short panel the page scrolls to the tracker's last row", scroll);
    const squashed = await page.eval(`[...document.querySelectorAll(".bt > *")].some(e => e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY === "visible")`);
    check(!squashed, "…and nothing inside is squashed to fit");
    await page.resize(420, 1100);
    await pause(200);
    const tabs = await page.eval(`[...document.querySelectorAll(".ls-pane-tab")].map(t => ({ right: Math.round(t.getBoundingClientRect().right), label: getComputedStyle(t.querySelector("span")).display !== "none" }))`);
    check(tabs.length === 3 && tabs.every((t) => t.right <= 420) && tabs.filter((t) => t.label).length === 1, "at 420px all three pane tabs fit, the active one keeping its label", tabs);
    const sideways = await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    check(sideways <= 0, "no sideways scroll on a docked panel", sideways);
    await page.shot(path.join(SHOTS, "ui-tracker-narrow.png"));

    console.log("\n6. Every problem carries its way out");
    const rowText = (i) => page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[${i}].innerText`);
    // Rows stay open across a rescan of the SAME batch now, so open-if-closed.
    const openRow = (i) => page.eval(`(() => { const r = document.querySelectorAll(".bt-rows > .bt-row")[${i}]; if (!r.classList.contains("is-open")) r.querySelector(".bt-row-top").click(); })()`);
    await openRow(2);
    await pause(100);
    const d = (await rowText(2)).replace(/\s+/g, " ");
    check(/On disk it's named SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO \(same words, another order\)/.test(d), "a subtask found under another name says so", d);
    check(/Rendered V01, but Wrike still says Backlog/.test(d) && /1 ahead of Wrike/.test(await page.eval(`document.querySelector(".bt-summary").innerText`)), "…and that Wrike looks behind, as a hint");
    check(/Rename to match Wrike/.test(d) && /Open to amend/.test(d) && !/Build it/.test(d), "…offering Rename and Open, never Build (it's built, just misnamed)", d);
    await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")[2].querySelectorAll(".bt-act")].find(b => /Rename/.test(b.textContent)).click()`);
    check(await page.waitFor(`/Rename 3 files to Wrike/.test(document.querySelector(".dialog-title")?.innerText || "")`, 4000), "the rename asks first, counting what moves");
    check(await page.eval(`window.__renames.length === 1 && window.__renames[0].apply === false`), "…having only planned so far");
    const fits = await page.eval(`(() => { const m = document.querySelector(".dialog-message"), c = document.querySelector(".dialog-card"); return { over: m.scrollWidth - m.clientWidth, right: m.getBoundingClientRect().right - c.getBoundingClientRect().right }; })()`);
    check(fits.over <= 0 && fits.right <= 0, "…and a long filename wraps inside the dialog", fits);
    await page.click(".dialog-btn-primary", "Rename");
    await page.waitFor(`(window.__renames || []).length === 2`, 4000);
    const ren = await page.eval(`window.__renames[1]`);
    check(ren.apply === true && ren.from === "SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO" && ren.to === "SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO" && ren.batch === "Batch_02", "confirmed, it renames the disk's name to Wrike's", ren);

    // The rename rescans: let it land, and the row somebody had open stays open.
    await page.waitFor(`!!document.querySelector(".bt-msg")`, 4000);
    await pause(200);
    await openRow(2);
    await page.resize(420, 1000); await pause(200);
    await page.shot(path.join(SHOTS, "ui-tracker-actions.png"));
    check(/Renamed 3/.test(await page.eval(`document.querySelector(".bt-msg").innerText`)), "…says what it did, and reads the batch again");
    await page.eval(`window.__stale = ["SF_INTL_Characters_DOOH_Post_old_V01"]`);
    await openRow(1);
    await pause(100);
    check(await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")[1].querySelectorAll(".bt-act")].some(b => /Open to amend/.test(b.textContent) && b.classList.contains("is-primary"))`), "a To amend row's open button reads 'Open to amend', as the primary action");
    await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")[1].querySelectorAll(".bt-act")].find(b => /Open to amend/.test(b.textContent)).click()`);
    check(await page.waitFor(`window.__opened === "${T}/AE/Batch_02/c.aep"`, 4000), "Open in AE opens the row's project");
    check(await page.waitFor(`!!document.querySelector(".bt-stale")`, 4000), "…and a comp still carrying an old name is pointed out");
    await page.click(".bt-stale .bt-act", "Rename comp");
    check(await page.waitFor(`window.__compRenamed && !document.querySelector(".bt-stale")`, 4000), "…and renamed in one press");

    await openRow(3);
    await pause(100);
    check(/Build it/.test(await rowText(3)), "a subtask with nothing on disk offers Build it");
    await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")[3].querySelectorAll(".bt-act")].find(b => /Build it/.test(b.textContent)).click()`);
    check(await page.waitFor(`!!document.querySelector(".ls-pane-tab") && !document.querySelector(".bt")`, 8000), "…which goes back to the Localise landing");
    check(await page.waitFor(`/1 row from SF Motion Outdoor NO 2/.test(document.body.innerText)`, 6000), "…where Build a Batch has the one subtask staged");

    await page.click(".ls-pane-tab", "Tracker");
    await page.waitFor(`document.querySelectorAll(".bt-row").length === 4`, 8000);
    await openRow(0);
    await pause(100);
    await page.eval(`[...document.querySelectorAll(".bt-rows > .bt-row")[0].querySelectorAll(".bt-act")].find(b => /Deliver/.test(b.textContent)).click()`);
    check(await page.waitFor(`!!window.__deliverAsked`, 8000), "Deliver opens the Deliver page on this job's renders");
    const asked = await page.eval(`window.__deliverAsked`);
    check(asked && asked.code === "NO" && asked.names.some((n) => /NFKINOPOST/.test(n)), "…asking for this job's deliverables", asked);

    console.log("\n7. Your jobs");
    await page.goto();
    await page.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 10000);
    await page.click("button.category-card", "Localise");
    await page.waitFor(`[...document.querySelectorAll(".ls-pane-tab")].some(b => /Tracker/.test(b.textContent))`, 8000);
    await page.click(".ls-pane-tab", "Tracker");
    check(await page.waitFor(`document.querySelectorAll(".bt-job").length === 2 && !!window.__peruScan`, 8000), "every Wrike job assigned to you is a chip");
    const order = await page.eval(`window.__calls.map(c => c.fn).filter(f => /^tracker(Scan|ScanMany)$/.test(f))`);
    check(order.filter((f) => f === "trackerScanMany").length === 1 && order.indexOf("trackerScan") !== -1 && order.indexOf("trackerScan") < order.indexOf("trackerScanMany"),
        "the chips cost ONE call to AE, made after the batch on screen was scanned", order);
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
    await page.waitFor(`[...document.querySelectorAll(".ls-pane-tab")].some(b => /Tracker/.test(b.textContent))`, 8000);
    await page.eval(`window.__noCtx = true`);
    await page.click(".ls-pane-tab", "Tracker");
    check(await page.waitFor(`document.querySelectorAll(".bt-jobs.is-overview .bt-job").length === 2 && /3\\/4 built/.test(document.querySelector(".bt-jobs.is-overview").innerText)`, 8000), "with no batch open, your jobs are listed with their counts");
    check(/Pick a job/.test(await page.eval(`document.querySelector(".bt-title").innerText`)), "…under 'Pick a job'");
    await page.shot(path.join(SHOTS, "ui-tracker-jobs.png"));
    await page.click(".bt-job", "NO 2");
    check(await page.waitFor(`/Norway/.test(document.querySelector(".bt-title").innerText) && document.querySelectorAll(".bt-rows > .bt-row").length === 4`, 6000), "…and one press opens a job");
    check(await page.eval(`!document.querySelector(".bt-jobs.is-overview") && !!document.querySelector(".bt-jobs")`), "…the list folding into the chip strip");

    console.log("\n9. Wrike as it is now, not as the snapshot had it");
    const pillOf = (re) => page.eval(`(() => { const r = [...document.querySelectorAll(".bt-rows > .bt-row")].find(x => ${re}.test(x.querySelector(".bt-name").innerText)); return r && r.querySelector(".bt-wrike") ? r.querySelector(".bt-wrike").innerText.trim() : ""; })()`);
    check(await page.waitFor(`[...document.querySelectorAll(".bt-rows > .bt-row")].some(x => /Kiwi/.test(x.innerText) && /Motion/.test(x.querySelector(".bt-wrike")?.innerText || ""))`, 8000),
        "the live read on open reaches the ROWS, not just the chips (snapshot said Backlog)", await pillOf("/Kiwi/"));
    liveKiwi = "Revised";
    await page.click(".bt-head .bt-icon", "");
    check(await page.waitFor(`[...document.querySelectorAll(".bt-rows > .bt-row")].some(x => /Kiwi/.test(x.innerText) && /Revised/.test(x.querySelector(".bt-wrike")?.innerText || ""))`, 8000),
        "refresh reads Wrike live and the rows follow", await pillOf("/Kiwi/"));

    console.log("\n10. Coming back is instant, and nothing is asked twice");
    await openRowAt(page, 1);
    await page.click(".ls-pane-tab", "Big Guy");
    await page.waitFor(`!document.querySelector(".bt")`, 4000);
    await page.eval(`window.__calls = []`);
    await page.click(".ls-pane-tab", "Tracker");
    check(await page.eval(`document.querySelectorAll(".bt-rows > .bt-row").length === 4 && !/Reading where/.test(document.body.innerText)`), "back on the Tracker tab, the rows are there at once -- no wait on AE");
    await pause(1500);
    const again = await page.eval(`window.__calls.map(c => c.fn)`);
    check(!again.includes("teamGetMachineState") && !again.includes("getTerritoryCountryCode"), "…and the machine's tag and the country code aren't asked again this session", again);
    check(again.filter((f) => f === "trackerScan").length <= 1, "…the batch is re-checked once behind it", again.filter((f) => /tracker/.test(f)));
    check(again.filter((f) => f === "trackerContext").length === 1, "…and where the open project sits is asked once, not twice", again.filter((f) => f === "trackerContext").length);
    await openRowAt(page, 1);
    await page.click(".bt-head .bt-icon", "");
    await page.waitFor(`window.__calls.filter(c => c.fn === "trackerScan").length >= 2`, 8000);
    await pause(600);
    check(await page.eval(`document.querySelectorAll(".bt-rows > .bt-row")[1].classList.contains("is-open")`), "a row you have open stays open when fresh Wrike data lands");
    const forced = await page.eval(`window.__calls.filter(c => c.fn === "trackerScan").map(c => JSON.parse(c.args[0]).force)`);
    check(forced.includes(true), "refresh asks AE for a real read of the disk (force)", forced);

    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
} finally {
    await page.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — the tracker lines a batch up, flags what disagrees, and every problem hands off to its fix.");
process.exit(failures ? 1 : 0);
