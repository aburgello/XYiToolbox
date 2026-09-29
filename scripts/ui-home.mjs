// =============================================================================
// scripts/ui-home.mjs
// -----------------------------------------------------------------------------
// The home screen's live category cards and Arrange mode, against a fake AE
// bridge and a jobs feed served from a fixture (never the live one).
//
//   yarn build:web && node scripts/ui-home.mjs
// =============================================================================
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const SHOTS = process.env.UI_SHOTS || os.tmpdir();

const FIXTURES = `{
  teamGetMachineState: () => ({ owner: "Antonio", tag: "Antonio" }),
  timesheetActiveFile: () => ({ success: true, hasFile: true, path: "/Volumes/paramount/SF/XY026205_Markets/Chile/AE/Batch_02/SF_INTL_Trio_DOOH_X_1920x1080px_10s_CL_V01.aep", name: "x.aep", folderName: "Batch_02" }),
  loadHomeLayout: () => window.__savedLayout || [],
  saveHomeLayout: (tokens) => { window.__savedLayout = tokens; window.__saves = (window.__saves || 0) + 1; return { success: true }; },
}`;

const sub = (name, s) => ({ id: name, name, status: "Active", customStatusName: s });
const FEED = [
    { id: "J1", title: "SF Motion Outdoor CL 2", assignee: "Antonio", status: "Backlog", updated_at: "", subtask_count: 3, subtasks_done: 0,
      subtasks: [sub("SF_INTL_Trio_DOOH_A_1920x1080px_10s_CL", "Revised"), sub("SF_INTL_Trio_DOOH_B_1920x1080px_10s_CL", "Revised"), sub("SF_INTL_Trio_DOOH_C_1920x1080px_10s_CL", "Backlog")] },
    { id: "J2", title: "SF Motion Outdoor HU 2", assignee: "Antonio", status: "Prep for delivery", updated_at: "", subtask_count: 1, subtasks_done: 0,
      subtasks: [sub("SF_INTL_Trio_DOOH_LED_1920x1080px_15s_HU", "Prep for delivery")] },
    { id: "J3", title: "SF Motion Outdoor SI 2", assignee: "Antonio", status: "Prep for delivery", updated_at: "", subtask_count: 1, subtasks_done: 0,
      subtasks: [sub("SF_INTL_Trio_DOOH_O_1920x1080px_10s_SI", "Prep for delivery")] },
    { id: "J4", title: "SF Motion Outdoor LV", assignee: "Someone else", status: "Backlog", updated_at: "", subtask_count: 1, subtasks_done: 0,
      subtasks: [sub("SF_INTL_Trio_DOOH_X_1920x1080px_15s_LV", "Revised")] },
];

let failures = 0;
const check = (ok, msg, extra) => {
    if (!ok) failures++;
    console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : ""));
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const cardText = `[...document.querySelectorAll(".category-card")].map(c => c.innerText.replace(/\\s+/g, " ").trim())`;
const blockOrder = `[...document.querySelectorAll(".home-screen .toolset-grid, .home-screen .category-row, .home-screen .home-block")].map(e => e.classList.contains("home-block") ? "B:" + e.querySelector(".home-block-name").innerText : e.className.split(" ")[0])`;

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, routes: { "api/panel/jobs": FEED } });
try {
    await page.goto();
    await page.waitFor(`document.querySelectorAll(".category-card").length === 4`, 8000);

    console.log("1. Live cards");
    check(await page.waitFor(`/Chile · Batch_02/.test(document.querySelector(".category-card")?.innerText || "")`, 6000), "Localise says where the open project is", await page.eval(cardText));
    const cards = await page.eval(cardText);
    check(/1 job ready/.test(cards[0]) && /^Localise.*1$/.test(cards[0]), "…and counts the job ready to localise", cards[0]);
    check(/2 revised to review/.test(cards[1]) && /2$/.test(cards[1]), "Review counts my Revised subtasks, not a colleague's", cards[1]);
    check(/HU 2 · SI 2/.test(cards[2]) && /2$/.test(cards[2]), "Deliver names the batches in Prep for delivery", cards[2]);
    check(cards[3] === "Tools", "Tools stays a plain card until a tool has been picked", cards[3]);
    await page.shot(path.join(SHOTS, "ui-home-cards.png"));

    console.log("\n2. Arrange");
    check(JSON.stringify(await page.eval(blockOrder)).indexOf("toolset-grid") < JSON.stringify(await page.eval(blockOrder)).indexOf("category-row"), "default order: Toolset, then the cards", await page.eval(blockOrder));
    await page.eval(`[...document.querySelectorAll(".favorites-toggle")].find(b => b.querySelector("svg.lucide-layout-dashboard"))?.click()`);
    check(await page.waitFor(`document.querySelectorAll(".home-block").length === 3`, 3000), "Arrange frames the three blocks");
    // Cards up above the Toolset.
    await page.eval(`[...document.querySelectorAll(".home-block")].find(b => /localise/i.test(b.querySelector(".home-block-name").innerText)).querySelector('[aria-label="Move up"]').click()`);
    await pause(150);
    const names = await page.eval(`[...document.querySelectorAll(".home-block-name")].map(e => e.innerText)`);
    check(/localise/i.test(names[0]) && /Toolset/i.test(names[1]), "the cards move above the Toolset", names);
    // Hide Active Jobs.
    await page.eval(`[...document.querySelectorAll(".home-block")].find(b => /Active Jobs/i.test(b.querySelector(".home-block-name").innerText)).querySelector('[aria-label="Hide"]').click()`);
    await pause(150);
    check(await page.eval(`[...document.querySelectorAll(".home-block")].find(b => /Active Jobs/i.test(b.querySelector(".home-block-name").innerText)).classList.contains("is-hidden")`), "Active Jobs can be hidden");
    // 2x2.
    await page.eval(`[...document.querySelectorAll(".home-block .seg-option")].find(b => /2×2/.test(b.innerText)).click()`);
    await pause(250);
    check(await page.eval(`document.querySelector(".category-row").classList.contains("category-row--grid")`), "the cards switch to 2×2");
    const rows = await page.eval(`(() => { const t = [...document.querySelectorAll(".category-card")].map(c => Math.round(c.getBoundingClientRect().top)); return [...new Set(t)].length; })()`);
    check(rows === 2, "…two lines of two", rows);
    await page.shot(path.join(SHOTS, "ui-home-arrange.png"));
    check(JSON.stringify(await page.eval(`window.__savedLayout`)) === JSON.stringify(["cards", "toolset", "-jobs", "cards:grid"]), "every change is saved, as app-generated tokens", await page.eval(`window.__savedLayout`));
    await page.click(".home-block-done");
    await pause(200);
    check(!(await page.eval(`!!document.querySelector(".home-block")`)) && !(await page.eval(`!!document.querySelector(".active-jobs")`)), "Done: frames gone, the hidden block stays hidden");
    const after = await page.eval(`(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1; return [r(".category-row"), r(".toolset-grid")]; })()`);
    check(after[0] >= 0 && after[1] > after[0], "and the cards now sit above the Toolset", after);

    console.log("\n3. Bar, and back");
    await page.eval(`[...document.querySelectorAll(".favorites-toggle")].find(b => b.querySelector("svg.lucide-layout-dashboard"))?.click()`);
    await page.waitFor(`document.querySelectorAll(".home-block").length === 3`, 3000);
    await page.eval(`[...document.querySelectorAll(".home-block .seg-option")].find(b => /Bar/.test(b.innerText)).click()`);
    await pause(250);
    const h = await page.eval(`Math.round(document.querySelector(".category-card").getBoundingClientRect().height)`);
    check(await page.eval(`document.querySelector(".category-row").classList.contains("category-row--bar")`) && h < 50, "the bar is one slim line", h);
    await page.click(".home-block-reset");
    await pause(200);
    check(JSON.stringify(await page.eval(`window.__savedLayout`)) === JSON.stringify(["toolset", "cards", "jobs", "cards:row"]), "Reset puts the default back", await page.eval(`window.__savedLayout`));
    const sideways = await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    check(sideways <= 0, "no sideways scroll", sideways);

    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
} finally {
    await page.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — the home cards say what's waiting, and the page arranges.");
process.exit(failures ? 1 : 0);
