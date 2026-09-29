// =============================================================================
// scripts/ui-review-jobs.mjs
// -----------------------------------------------------------------------------
// Click-through of Review Session's "Your jobs" strip: Wrike jobs in Revised,
// To amend and Motion/Backlog (served from a fixture, never the live feed), their
// renders found the way Deliver finds them, the right versions ticked, and
// Import & Compare handing the selection to the session's own import.
//
//   yarn build:web && node scripts/ui-review-jobs.mjs
// =============================================================================
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const SHOTS = process.env.UI_SHOTS || os.tmpdir();
const B2 = "/Volumes/paramount/SF_Markets/Chile/Renders/Batch_02/";
const P = "SF_INTL_Trio_DOOH_";

const FIXTURES = `{
  teamGetMachineState: () => ({ owner: "Antonio", tag: "Antonio" }),
  deliveryFindRenders: (json) => {
    const a = JSON.parse(json);
    window.__asked = a;
    const f = (name, latest, version) => ({ path: "${B2}" + name, name, key: name.replace(/[.]mov$/, "").replace(/_V[0-9]+$/, "").toUpperCase(), version, matched: true, latest });
    return { success: true, missing: a.names.filter((n) => /NOTRENDERED/i.test(n)), folders: [{ campaign: "Street Fighter", territory: "Chile", label: "Batch_02", path: "${B2}", files: [
      f("${P}AmendDone_672x432px_10s_CL_V01.mov", false, 1),
      f("${P}AmendDone_672x432px_10s_CL_V02.mov", true, 2),
      f("${P}AmendWaiting_960x2000px_10s_CL_V01.mov", true, 1),
      f("${P}InProgress_1920x853px_10s_CL_V01.mov", false, 1),
      f("${P}InProgress_1920x853px_10s_CL_V02.mov", true, 2),
      f("${P}InMotion_1920x768px_10s_CL_V01.mov", true, 1),
      f("${P}Unrelated_1920x1080px_10s_CL_V01.mov", true, 1),
    ].map((x) => /UNRELATED/.test(x.key) ? { ...x, matched: false } : x) }] };
  },
  deliveryImportRenders: (json) => { window.__imported = JSON.parse(json); return { success: true, imported: window.__imported.paths.length, reused: 0, failed: [], itemIds: [11, 12] }; },
  reviewLoadSelectedItems: () => ({ success: true, items: (window.__imported ? window.__imported.paths : []).map((p, i) => ({ id: 11 + i, name: p.split("/").pop(), sourcePath: p, duration: 10, frameRate: 25 })) }),
  reviewFindCounterparts: (json) => ({ success: true, items: JSON.parse(json).map((it) => /AmendDone.*V02/.test(it.name)
      ? { name: it.name, amendPath: "${B2}${P}AmendDone_672x432px_10s_CL_V01.mov", amendName: "${P}AmendDone_672x432px_10s_CL_V01.mov" }
      : { name: it.name }) }),
  // A campaign, so masters pair too (Review takes it from the OV Library tab).
  loadCampaigns: () => [{ name: "Street Fighter", mastersRoot: "/Volumes/paramount/SF_Masters" }],
  loadLastCampaign: () => "Street Fighter",
  reviewMatchToMaster: (root, json) => ({ success: true, items: JSON.parse(json).map((it) => ({ name: it.name, sourcePath: it.sourcePath,
      mp4Path: "/Volumes/paramount/SF_Masters/Support/Motion_Components/_MP4/SF_INTL_Trio_DOOH_1920x1080px_10s_OV.mp4", masterStem: "x",
      repeat: /InMotion/.test(it.name) ? 2 : undefined })) }),
  createReviewComparisons: (json) => { window.__compared = JSON.parse(json); return { success: true, results: window.__compared.map((m, i) => ({ success: true, compId: 900 + i, compName: "Compare_" + i })) }; },
}`;

const sub = (name, s) => ({ id: name, name, status: "Active", customStatusName: s });
const FEED = [
    { id: "J1", title: "SF Motion Outdoor CL 2", assignee: "Antonio", status: "Motion", updated_at: "", subtask_count: 6, subtasks_done: 0,
      subtasks: [
        sub(P + "AMENDDONE_672x432px_10s_CL", "Revised"),
        sub(P + "AMENDWAITING_960x2000px_10s_CL", "Revised"),
        sub(P + "INPROGRESS_1920x853px_10s_CL", "To amend"),
        sub(P + "INMOTION_1920x768px_10s_CL", "Motion"),
        sub(P + "NOTRENDERED_1920x864px_10s_CL", "Backlog"),
        sub(P + "SHIPPED_1248x416px_10s_CL", "Prep for delivery"),
      ] },
    { id: "J2", title: "SF Motion Outdoor HU 2", assignee: "Antonio", status: "Prep for delivery", updated_at: "", subtask_count: 1, subtasks_done: 0,
      subtasks: [sub(P + "LED_1920x1080px_15s_HU", "Prep for delivery")] },
    { id: "J3", title: "SF Motion Outdoor LV", assignee: "Someone else", status: "Motion", updated_at: "", subtask_count: 1, subtasks_done: 0,
      subtasks: [sub(P + "X_1920x1080px_15s_LV", "To amend")] },
];

let failures = 0;
const check = (ok, msg, extra) => {
    if (!ok) failures++;
    console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : ""));
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, routes: { "api/panel/jobs": FEED } });
try {
    await page.goto();
    await page.waitFor(`document.querySelector(".category-card")`, 8000);
    await page.click(".category-card", "Review");
    check(await page.waitFor(`document.querySelector(".review-hub")`, 6000), "Review opens");
    await page.click(".rh-tab", "Review Session");
    check(await page.waitFor(`document.querySelector(".rv-session")`, 6000), "Review Session opens");

    console.log("\n1. The strip");
    check(await page.waitFor(`document.querySelectorAll(".rv-jobs .dj-chip").length > 0`, 6000), "Your jobs shows");
    const chips = await page.eval(`[...document.querySelectorAll(".rv-jobs .dj-chip")].map(c => c.innerText.replace(/\\s+/g, " ").trim())`);
    check(chips.length === 1 && /CL 2/.test(chips[0]), "only my job with work to review, not a Prep for delivery one or a colleague's", chips);
    const counts = await page.eval(`[...document.querySelectorAll(".rv-jobs .dj-chip .dj-count")].map(c => c.innerText)`);
    check(counts.join(",") === "2,1,2", "2 revised, 1 to amend, 2 in motion/backlog; the delivered one not counted", counts);

    console.log("\n2. Its renders");
    await page.click(".rv-jobs .dj-chip");
    check(await page.waitFor(`document.querySelectorAll(".rv-jobs .dj-row").length === 6`, 4000), "this job's six renders, not the batch's unrelated one");
    const asked = await page.eval(`window.__asked`);
    check(asked && asked.code === "CL" && asked.names.length === 5, "asked for CL and the five review names", asked);
    const rows = await page.eval(`[...document.querySelectorAll(".rv-jobs .dj-row")].map(r => ({ on: r.classList.contains("is-on"), t: r.innerText.replace(/\\s+/g, " ").trim() }))`);
    const on = (re) => rows.find((r) => re.test(r.t));
    check(on(/AmendDone.*V02/)?.on && !on(/AmendDone.*V01/)?.on, "Revised with a new version: the V02 is ticked", rows.map((r) => [r.on, r.t]));
    check(on(/AmendWaiting/) && !on(/AmendWaiting/).on && /no new version/.test(on(/AmendWaiting/).t), "Revised but still at V01 is not ticked, and says why");
    check(on(/InProgress.*V02/) && !on(/InProgress.*V02/).on && /in progress/.test(on(/InProgress.*V02/).t), "To amend is never ticked, even with a V02 on disk: it's still being made");
    check(on(/InMotion/)?.on, "a Motion subtask that has rendered is ticked");
    const notes = await page.eval(`[...document.querySelectorAll(".rv-jobs .dj-missing")].map(m => m.innerText.replace(/\\s+/g, " "))`);
    check(notes.some((n) => /Not rendered yet \(1\).*NOTRENDERED/.test(n)), "the Backlog one with no render is listed as not rendered yet", notes);
    check(notes.some((n) => /no new version on disk \(1\).*AmendWaiting/.test(n)), "the Revised one with no new render is flagged", notes);
    check(notes.some((n) => /Amends in progress \(1\).*INPROGRESS/.test(n)), "the To amend one is listed as in progress", notes);

    console.log("\n3. Import & Compare");
    await page.click(".rv-jobs .dj-import");
    check(await page.waitFor(`!!window.__compared`, 4000), "the session's own import runs on what was imported");
    const imp = await page.eval(`window.__imported`);
    check(imp && imp.paths.length === 2 && imp.folder === "Chile Batch_02", "imports the two ticked into Deliver's Chile Batch_02 bin", imp);
    const cmp = await page.eval(`window.__compared`);
    // MASTER FIRST, for every row: a V02 is still a deliverable to check
    // against the OV -- its V01 is an extra section, not a replacement.
    check(cmp && cmp.length === 2 && cmp.every((c) => c.kind === "master" && /_OV[.]mp4$/.test(c.mp4Path)), "every render is compared against its master at import, the V02 included", cmp && cmp.map((c) => [c.localItemName, c.kind]));
    check(cmp && cmp.some((c) => /InMotion/.test(c.localItemName) && c.repeat === 2), "a duration multiple carries its x2 to the builder", cmp && cmp.map((c) => c.repeat));
    check(await page.waitFor(`document.querySelectorAll(".rv-row").length === 2`, 3000), "both land in the session");
    const pills = await page.eval(`[...document.querySelectorAll(".rv-section")].map(p => p.innerText.replace(/\\s+/g, " ").trim())`);
    check(pills.length === 2 && /^vs Master 2$/.test(pills[0]) && /^Amends 1$/.test(pills[1]), "no All: vs Master leads and holds both, Amends beside it", pills);
    check((await page.eval(`[...document.querySelectorAll(".rv-row-repeat")].map(e => e.innerText)`)).join() === "×2", "the x2 row says so");
    await page.click(".rv-section", "Amends");
    await pause(300);
    const amendRow = await page.eval(`[...document.querySelectorAll(".rv-row")].map(r => r.innerText.replace(/\\s+/g, " "))`);
    check(amendRow.length === 1 && /vs previous/.test(amendRow[0]) && /AmendDone/.test(amendRow[0]), "and Amends still shows the V02 against its V01", amendRow);
    await page.shot(path.join(SHOTS, "ui-review-jobs.png"));

    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
} finally {
    await page.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — Review lists my Revised, To amend and Motion jobs and imports their renders into the session.");
process.exit(failures ? 1 : 0);
