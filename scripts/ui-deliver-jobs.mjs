// =============================================================================
// scripts/ui-deliver-jobs.mjs
// -----------------------------------------------------------------------------
// Click-through of Deliver's "Ready to deliver" strip: a Wrike job in Prep for
// delivery (served from a fixture, never the live feed), its Batch_02
// mirrored with the right files ticked, Import, then Make delivery comps.
//
//   yarn build:web && node scripts/ui-deliver-jobs.mjs
// =============================================================================
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const SHOTS = process.env.UI_SHOTS || os.tmpdir();
const B2 = "/Volumes/paramount/XY026201_SF_Markets/Hungary/Renders/Batch_02/";

const FIXTURES = `{
  teamGetMachineState: () => ({ owner: "Antonio", tag: "Antonio" }),
  deliveryFindRenders: (json) => {
    const a = JSON.parse(json);
    window.__asked = a;
    const f = (name, matched, latest, version) => ({ path: "${B2}" + name, name, key: "", version, matched, latest });
    return { success: true, missing: [], folders: [{ campaign: "Street Fighter", territory: "Hungary", label: "Batch_02", path: "${B2}", files: [
      f("SF_INTL_RyuHadouken_DOOH_Ledkeleti_2304x432px_10s_HU_V01.mov", true, true, 1),
      f("SF_INTL_Trio_DOOH_Led_1920x1080px_15s_HU_V01.mov", true, true, 1),
      f("SF_INTL_Trio_DOOH_Ledshopmark_1120x704px_10s_HU_V01.mov", true, false, 1),
      f("SF_INTL_Trio_DOOH_Ledshopmark_1120x704px_10s_HU_V02.mov", true, true, 2),
      f("SF_INTL_Trio_DOOH_Somethingelse_1920x1080px_10s_HU_V01.mov", false, true, 1),
    ] }] };
  },
  deliveryImportRenders: (json) => ({ success: true, imported: JSON.parse(json).paths.length, reused: 0, failed: [], itemIds: [1, 2, 3] }),
  delivery: () => ({ success: true, compIds: [] }),
}`;

const sub = (name, s) => ({ id: name, name, status: "Active", customStatusName: s });
const FEED = [
    { id: "J1", title: "SF Motion Outdoor HU 2", assignee: "Antonio", status: "Prep for delivery", updated_at: "", subtask_count: 3, subtasks_done: 0,
      subtasks: [sub("SF_INTL_RyuHadouken_DOOH_LEDKELETI_2304x432px_10s_HU", "Prep for delivery"), sub("SF_INTL_Trio_DOOH_LED_1920x1080px_15s_HU", "Prep for delivery"), sub("SF_INTL_Trio_DOOH_LEDSHOPMARK_1120x704px_10s_HU", "Prep for delivery"), sub("SF_INTL_Trio_DOOH_LEDNOTYET_1920x1080px_15s_HU", "Motion")] },
    { id: "J3", title: "SF Motion Outdoor SI 2", assignee: "Antonio", status: "Prep for delivery", updated_at: "", subtask_count: 1, subtasks_done: 0,
      subtasks: [sub("SF_INTL_Trio_DOOH_A_1920x1080px_15s_SI", "Prep for delivery")] },
    { id: "J4", title: "SF Motion Outdoor CO 1", assignee: "Antonio", status: "Prep for delivery", updated_at: "", subtask_count: 1, subtasks_done: 0,
      subtasks: [sub("SF_INTL_Trio_DOOH_B_1920x1080px_15s_CO", "Prep for delivery")] },
    { id: "J2", title: "SF Motion Outdoor LV", assignee: "Antonio", status: "Motion", updated_at: "", subtask_count: 1, subtasks_done: 0,
      subtasks: [sub("SF_INTL_Trio_DOOH_X_1920x1080px_15s_LV", "Motion")] },
];

let failures = 0;
const check = (ok, msg, extra) => {
    if (!ok) failures++;
    console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : ""));
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = (fn) => `window.__calls.filter(c => c.fn === ${JSON.stringify(fn)}).map(c => c.args)`;

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, routes: { "api/panel/jobs": FEED } });
try {
    await page.goto();
    await page.waitFor(`document.querySelector(".category-card")`, 8000);
    await page.click(".category-card", "Deliver");
    check(await page.waitFor(`document.querySelector(".delivery-hub")`, 6000), "Deliver opens");

    console.log("\n1. The strip");
    check(await page.waitFor(`document.querySelectorAll(".dj-chip").length > 0`, 6000), "Ready to deliver shows");
    const chips = await page.eval(`[...document.querySelectorAll(".dj-chip")].map(c => c.innerText.replace(/\\s+/g, " ").trim())`);
    check(chips.length === 3 && !chips.some((c) => /LV/.test(c)), "only the jobs in Prep for delivery, not the one in Motion", chips);
    check((await page.eval(`document.querySelector(".dj-shared")?.innerText`)) === "SF Motion Outdoor", "the words they share are said once, in the heading");
    check(chips[0] === "🇭🇺 HU 2 3", "each chip carries only what differs", chips[0]);
    check(/3$/.test(chips[0] || ""), "counting the three subtasks in Prep for delivery, not the one still in Motion", chips[0]);

    console.log("\n1b. Many jobs wrap, never hide past the edge");
    await page.resize(420, 1100);
    const reach = await page.eval(`(() => { const box = document.querySelector(".delivery-hub").getBoundingClientRect(); return [...document.querySelectorAll(".dj-chip")].every(c => c.getBoundingClientRect().right <= box.right + 1); })()`);
    check(reach, "every chip sits inside the page at 420px");
    await page.resize(760, 1100);
    await pause(200);

    console.log("\n2. Its renders, mirrored");
    await page.click(".dj-chip");
    check(await page.waitFor(`document.querySelectorAll(".dj-row").length === 5`, 4000), "the whole Batch_02 is listed");
    const asked = await page.eval(`window.__asked`);
    check(asked && asked.code === "HU" && asked.names.length === 3, "asked for HU and the three names", asked);
    const rows = await page.eval(`[...document.querySelectorAll(".dj-row")].map(r => ({ on: r.classList.contains("is-on"), t: r.innerText.replace(/\\s+/g, " ").trim() }))`);
    check(rows.filter((r) => r.on).length === 3, "three ticked", rows.filter((r) => r.on).map((r) => r.t));
    check(rows.some((r) => /V01/.test(r.t) && /older version/.test(r.t) && !r.on), "the older version is shown, unticked");
    check(rows.some((r) => /Somethingelse/.test(r.t) && /not in this job/.test(r.t) && !r.on), "another job's render is shown, unticked");
    check((await page.eval(`document.querySelector(".dj-folder-name").innerText`)) === "Batch_02", "headed by its folder");
    const sideways = await page.eval(`(() => { const t = document.querySelector(".delivery-hub"); return t.scrollWidth - t.clientWidth; })()`);
    check(sideways <= 0, "no sideways scroll", sideways);

    console.log("\n3. Import, then Delivery");
    await page.click(".dj-import");
    await pause(400);
    const imp = await page.eval(calls("deliveryImportRenders"));
    const sent = imp.length ? JSON.parse(imp[0][0]) : null;
    check(sent && sent.paths.length === 3 && sent.folder === "Hungary Batch_02", "imports the three ticked into a Hungary Batch_02 bin", sent);
    check(await page.waitFor(`!document.querySelector(".dj-panel")`, 3000), "the file list folds away once they're in");
    check(await page.eval(`document.querySelector(".dj-chip.is-done")?.innerText.includes("HU")`), "…the job's chip is marked done");
    check(/Imported 3 into Hungary Batch_02/.test(await page.eval(`document.querySelector(".dj-done")?.innerText || ""`)), "…and one line says what landed where");
    check(await page.waitFor(`!!document.querySelector(".dj-done .dj-deliver")`, 3000), "then offers Make delivery comps");
    await page.click(".dj-deliver");
    await pause(400);
    check((await page.eval(calls("delivery"))).length === 1, "which runs the page's own Delivery");
    check(!(await page.eval(`!!document.querySelector(".dj-done")`)), "…and the line clears");
    await page.shot(path.join(SHOTS, "ui-deliver-jobs.png"));

    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
} finally {
    await page.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — Prep for delivery jobs mirror their renders and import in one press.");
process.exit(failures ? 1 : 0);
