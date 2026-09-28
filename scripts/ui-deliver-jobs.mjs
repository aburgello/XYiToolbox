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
    const f = (name, matched, latest, version) => ({ path: "${B2}" + name, name, key: name.replace(/[.]mov$/, "").replace(/_V[0-9]+$/, "").toUpperCase(), version, matched, latest });
    if (a.code === "SI") {
      const S = "/Volumes/paramount/SF/Slovenia/Renders/Batch_02/";
      const g = (name, matched) => ({ path: S + name, name, key: name.replace(/[.]mov$/, "").replace(/_V[0-9]+(_(DOUBLE|QUAD)_RES)?$/, "").toUpperCase(), version: +(/_V([0-9]+)/.exec(name) || [0, 0])[1], variant: (/_((DOUBLE|QUAD)_RES)[.]mov$/.exec(name) || [0, ""])[1], matched, latest: true });
      const files = [
        g("SF_INTL_Trio_DOOH_Odiseja_1600x1200px_10s_SI_V01.mov", true),
        g("SF_INTL_Trio_DOOH_Odiseja_400x800px_10s_SI_V01_DOUBLE_RES.mov", true),
        g("SF_INTL_Trio_DOOH_Odiseja_800x800px_10s_SI_V02.mov", false),
        g("SF_INTL_RyuHadouken_DOOH_Odiseja_2760x450px_15s_SI_V01.mov", false),
        g("SF_INTL_RyuHadouken_DOOH_CineplexxLCDSmall_2048x640px_15s_SI_V01.mov", false),
        g("SF_INTL_Trio_DOOH_CineplexxCealing_INSITU_5000x1024px_10s_SI_V02.mov", false),
        g("SF_INTL_Trio_DOOH_Odiseja_800x800px_10s_SI_V01.mov", false),
      ];
      const got = files.filter((f) => f.matched).map((f) => f.key);
      return { success: true, folders: [{ campaign: "Street Fighter", territory: "Slovenia", label: "Batch_02", path: S, files }],
        missing: a.names.filter((n) => got.indexOf(n.toUpperCase()) === -1) };
    }
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
    // Slovenia's real Batch_02 subtasks, 800x800 at Revised.
    { id: "J3", title: "SF Motion Outdoor SI 2", assignee: "Antonio", status: "Prep for delivery", updated_at: "", subtask_count: 5, subtasks_done: 0,
      subtasks: [sub("SF_INTL_Trio_DOOH_ODISEJA_800x800px_10s_SI", "Revised"), sub("SF_INTL_RyuHadouken_DOOH_CineplexxLCDSmall_2048x640px_10s_SI", "Prep for delivery"),
        sub("SF_INTL_RyuHadouken_DOOH_ODISEJA_2760x450px_10s_SI", "Prep for delivery"), sub("SF_INTL_Trio_DOOH_ODISEJA_400x800px_10s_SI", "Prep for delivery"),
        sub("SF_INTL_Trio_DOOH_ODISEJA_1600x1200px_10s_SI", "Prep for delivery")] },
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
    // Finder colours as xattr reports them (FinderInfo hex, measured on the
    // share): Led V01 green, Ledshopmark V01 ORANGE and its V02 RED -- so the
    // older version is the right one, which is the case this exists for.
    const GREEN = "0000000000000000000400000000000000000000000000003249147200000000";
    const ORANGE = "0000000000000000000E0000000000000000000000000000324960B580000000";
    const RED = "0000000000000000000C0000000000000000000000000000324960B580000000";
    await page.eval(`window.__fakeXattr = ${JSON.stringify({
        [B2 + "SF_INTL_Trio_DOOH_Led_1920x1080px_15s_HU_V01.mov"]: GREEN,
        [B2 + "SF_INTL_Trio_DOOH_Ledshopmark_1120x704px_10s_HU_V01.mov"]: ORANGE,
        [B2 + "SF_INTL_Trio_DOOH_Ledshopmark_1120x704px_10s_HU_V02.mov"]: RED,
    })}`);
    await page.click(".dj-chip");
    check(await page.waitFor(`document.querySelectorAll(".dj-row").length === 5`, 4000), "the whole Batch_02 is listed");
    const asked = await page.eval(`window.__asked`);
    check(asked && asked.code === "HU" && asked.names.length === 3, "asked for HU and the three names", asked);
    const rows = await page.eval(`[...document.querySelectorAll(".dj-row")].map(r => ({ on: r.classList.contains("is-on"), t: r.innerText.replace(/\\s+/g, " ").trim() }))`);
    check(rows.filter((r) => r.on).length === 3, "three ticked", rows.filter((r) => r.on).map((r) => r.t));
    check(rows.some((r) => /Ledshopmark.*V01/.test(r.t) && r.on) && rows.some((r) => /Ledshopmark.*V02/.test(r.t) && !r.on && /marked red/.test(r.t)),
        "the orange V01 is ticked over the newer V02 marked red");
    const dots = await page.eval(`[...document.querySelectorAll(".dj-dot")].map(d => d.className)`);
    check(dots.length === 3 && dots.some((d) => /is-green/.test(d)) && dots.some((d) => /is-orange/.test(d)) && dots.some((d) => /is-red/.test(d)), "each row shows its Finder colour", dots);
    check(await page.eval(`document.querySelectorAll(".dj-row.is-version").length === 1`), "the V02 hangs off its V01 as one group");
    await page.eval(`(() => { const r = [...document.querySelectorAll(".dj-row")].find(x => /Ledshopmark.*V02/.test(x.innerText)); r.querySelector(".checkbox-toggle").click(); })()`);
    await pause(150);
    const after = await page.eval(`[...document.querySelectorAll(".dj-row")].filter(r => /Ledshopmark/.test(r.innerText)).map(r => r.classList.contains("is-on"))`);
    check(after[0] === false && after[1] === true, "ticking V02 unticks V01: one render per deliverable", after);
    await page.eval(`(() => { const r = [...document.querySelectorAll(".dj-row")].find(x => /Ledshopmark.*V01/.test(x.innerText)); r.querySelector(".checkbox-toggle").click(); })()`);
    await pause(150);
    await page.eval(`[...document.querySelectorAll(".dj-row")].find(x => /Ledshopmark.*V02/.test(x.innerText)).querySelector(".dj-play").click()`);
    const spawned = await page.eval(`window.__spawned || []`);
    check(spawned.length === 1 && spawned[0][0] === "open" && /Ledshopmark.*V02[.]mov$/.test(spawned[0][1]), "▶ opens that version in QuickTime", spawned);
    check(rows.some((r) => /Somethingelse/.test(r.t) && /not in this job/.test(r.t) && !r.on), "another job's render is shown, unticked");
    check((await page.eval(`document.querySelector(".dj-folder-name").innerText`)) === "Batch_02", "headed by its folder");
    const sideways = await page.eval(`(() => { const t = document.querySelector(".delivery-hub"); return t.scrollWidth - t.clientWidth; })()`);
    check(sideways <= 0, "no sideways scroll", sideways);

    console.log("\n2b. Near misses say why (Slovenia's real batch)");
    await page.click(".dj-chip", "SI 2");
    check(await page.waitFor(`document.querySelectorAll(".dj-row").length === 7 && /Slovenia/.test(document.querySelector(".dj-folder-where")?.innerText || "")`, 4000), "Slovenia's batch opens");
    const tagOf = async (re) => page.eval(`(() => { const r = [...document.querySelectorAll(".dj-row")].find(x => ${re}.test(x.innerText)); return r ? { tag: r.querySelector(".dj-tag")?.innerText || "", on: r.classList.contains("is-on") } : null; })()`);
    let t = await tagOf("/2760x450/");
    check(t && /length differs: Wrike 10s, render 15s/.test(t.tag) && !t.on, "a 15s render of a 10s subtask says so, and stays unticked", t);
    t = await tagOf("/DOUBLE_RES/");
    check(t && /double res/.test(t.tag) && t.on, "a _DOUBLE_RES render IS the deliverable: ticked, labelled double res", t);
    const names = await page.eval(`[...document.querySelectorAll(".dj-row .dj-file")].map(e => e.innerText)`);
    const i1 = names.findIndex((n) => /800x800.*V01/.test(n)), i2 = names.findIndex((n) => /800x800.*V02/.test(n));
    check(i1 >= 0 && i2 === i1 + 1, "V01 and V02 sit together, oldest first, however the folder listed them", [i1, i2]);
    t = await tagOf("/800x800/");
    check(t && t.tag === "Revised in Wrike" && !t.on, "a file whose subtask is in another status says which", t);
    t = await tagOf("/INSITU/");
    check(t && t.tag === "not in this job", "a mockup nothing names is still 'not in this job'", t);
    const missing = await page.eval(`[...document.querySelectorAll(".dj-missing-row")].map(r => r.innerText.replace(/\\s+/g, " "))`);
    check(missing.length === 2 && missing.every((m) => /differs/.test(m)), "only the two 15s-for-10s subtasks are missing, each with its near render", missing);
    await page.click(".dj-chip", "HU 2");
    await page.waitFor(`/Hungary/.test(document.querySelector(".dj-folder-where")?.innerText || "")`, 4000);

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
