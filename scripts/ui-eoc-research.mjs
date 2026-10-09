// =============================================================================
// scripts/ui-eoc-research.mjs
// -----------------------------------------------------------------------------
// Click-through of EOC Research on a fake bridge and a fake folder tree (the
// harness answers readdir from window.__fsTree; nothing real is read, nothing
// renders).
//
//   yarn build:web && node scripts/ui-eoc-research.mjs
// =============================================================================
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const SHOTS = process.env.UI_SHOTS || os.tmpdir();
const R = "/Volumes/newmedia/Project_Research";
const M = "/Volumes/universal/ODY/Camp_Markets";

// The bridge. researchRenderChunk "renders" by adding files to the fake tree,
// leaving AE's frame number on the still the way the real queue does, and
// fails the one render called BROKEN.
const FIXTURES = `{
  researchGetRoot: () => "${R}",
  loadLocLibCampaigns: () => [{ name: "Odyssey", marketsRoot: "${M}" }],
  researchProjectState: () => window.__project || { success: true, items: 0, queued: 0, dirty: false, name: "" },
  researchNewProject: () => ({ success: true }),
  teamListProfiles: () => ({ success: true, profiles: [{ name: "Antonio", hasProfile: true }, { name: "Luke", hasProfile: true }, { name: "misc", hasProfile: false }] }),
  teamGetMachineState: () => ({ success: true, owner: "Antonio" }),
  researchRenderChunk: (json) => {
    const a = JSON.parse(json);
    // Another machine, adding another market to the same folder while this pass renders.
    const mf = a.dest + "/_RESEARCH_MANIFEST.txt";
    window.__fsFiles[mf] = (window.__fsFiles[mf] || "") + "\\nDONE\\tSpain_B1_FROM_ANOTHER_MACHINE\\t${M}/Spain/Renders/B1/FROM_ANOTHER_MACHINE.mov\\t";
    const list = (window.__fsTree[a.dest] = window.__fsTree[a.dest] || []);
    const rows = a.rows.map((r) => {
      if (/BROKEN/.test(r.prefix)) return { prefix: r.prefix, ok: false, note: "Could not import the render" };
      list.push({ name: r.prefix + ".mp4" }, { name: r.prefix + "_LASTFRAME_00359.jpg" });
      return { prefix: r.prefix, ok: true, note: "" };
    });
    return { success: true, rows, seconds: 30 };
  },
}`;

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
// A hand-made film: clips with timecoded stills, the `_0.56_` sort prefix.
put(`${R}/Novacaine/MASTER_OV/_0.56_NVC_INTL_DGTL_DOOH_GLASS_1080x1920_10sec_OV.mp4`);
put(`${R}/Novacaine/MASTER_OV/_0.56_NVC_INTL_DGTL_DOOH_GLASS_1080x1920_10sec_OV (0-00-05-11).jpg`);
put(`${R}/Novacaine/MASTER_OV/_0.56_NVC_INTL_DGTL_DOOH_GLASS_1080x1920_10sec_OV (0-00-14-23).jpg`);
put(`${R}/Novacaine/LOCALISED/_1.78_NVC_INTL_DGTL_DOOH_GLASS_1920x1080_15sec_TW_V03.mp4`);
put(`${R}/Novacaine/LOCALISED/_1.00_NVC_INTL_DGTL_DOOH_GLASS_1024x1024_15sec_EG_V01.mp4`);
put(`${R}/Novacaine/BESPOKES/_11.88_NVC_INTL_DGTL_DOOH_ARCH_4560x384_15sec_EG_V01 (0-00-19-23).jpg`);
// The tool's own output: a run that stopped part-way, stills misnamed.
put(`${R}/The_Odyssey/LOCALISED/_RESEARCH_MANIFEST.txt`);
put(`${R}/The_Odyssey/LOCALISED/Norway_Batch_1_ODY_INTL_DGTL_DOOH_HORSE_1080x1920_10sec_NO_V01.mp4`);
put(`${R}/The_Odyssey/LOCALISED/Norway_Batch_1_ODY_INTL_DGTL_DOOH_HORSE_1080x1920_10sec_NO_V01_LASTFRAME.jpg00359`);
const manifest = ["# m", "DONE\tNorway_Batch_1_ODY_INTL_DGTL_DOOH_HORSE_1080x1920_10sec_NO_V01\t" + M + "/Norway/Renders/Batch_1/ODY_INTL_DGTL_DOOH_HORSE_1080x1920_10sec_NO_V01.mov",
    "TODO\tBrazil_B2_ODY_INTL_DGTL_DOOH_HORSE_960x480_10sec_BR_V02\t" + M + "/Brazil/Renders/B2/ODY_INTL_DGTL_DOOH_HORSE_960x480_10sec_BR_V02.mov"].join("\r");
// The campaign it came from.
put(`${M}/Norway/Renders/Batch_1/ODY_INTL_DGTL_DOOH_HORSE_1080x1920_10sec_NO_V01.mov`);
put(`${M}/Norway/Renders/Batch_1/_Old/ODY_INTL_DGTL_DOOH_HORSE_1080x1920_10sec_NO_V00.mov`);
put(`${M}/Brazil/Renders/B2/ODY_INTL_DGTL_DOOH_HORSE_960x480_10sec_BR_V01.mov`);
put(`${M}/Brazil/Renders/B2/ODY_INTL_DGTL_DOOH_HORSE_960x480_10sec_BR_V02.mov`);
put(`${M}/Brazil/Renders/B2/ODY_INTL_DGTL_DOOH_BROKEN_960x480_10sec_BR_V01.mov`);
put(`${M}/Brazil/PDFs/x.pdf`);

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const setInput = (page, sel, v) => page.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const text = (page, sel) => page.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.innerText.replace(/\\s+/g, " ").trim())`);
const calls = (page, fn) => page.eval(`window.__calls.filter(c => c.fn === ${JSON.stringify(fn)}).map(c => c.args)`);

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, width: 900, height: 1300 });
try {
    await page.goto();
    await page.eval(`window.__fsTree = ${JSON.stringify(tree)}; window.__fsFiles = ${JSON.stringify({ [`${R}/The_Odyssey/LOCALISED/_RESEARCH_MANIFEST.txt`]: manifest })}; try { localStorage.removeItem("xyi.eoc.film"); localStorage.removeItem("xyi.eoc.lastRun"); } catch (e) {}`);
    await page.waitFor(`document.querySelector(".home-search input")`, 8000);
    await setInput(page, ".home-search input", "EOC Research");
    await pause(400);
    await page.click("button, [role=button]", "EOC Research");
    check(await page.waitFor(`document.querySelector(".eoc")`, 6000), "EOC Research is a tool of its own, found by search");

    console.log("\n1. Browse");
    check(await page.waitFor(`document.querySelectorAll(".eoc-films .eoc-chip").length === 3`, 6000), "the archive's films are chips, plus Every film", await text(page, ".eoc-films .eoc-chip"));
    check(await page.waitFor(`document.querySelectorAll(".eoc-card").length === 4`, 6000), "the first film opens: clips, and stills with no clip", await text(page, ".eoc-card-size"));
    check((await text(page, ".eoc-sections .eoc-chip")).join("|") === "Everything 4|BESPOKES 1|LOCALISED 2|MASTER OV 1", "its sections, counted", await text(page, ".eoc-sections .eoc-chip"));
    // (The fake tree has no real pictures, so a still that fails to load falls back to the clip: 2 or 3.)
    const vids = await page.eval(`document.querySelectorAll(".eoc-card video").length`);
    check(vids >= 2 && vids <= 3, "a clip with no still shows its own frame; stills alone load no video", vids);
    check(await page.eval(`[...document.querySelectorAll(".eoc-flag")].length === 1`), "stills-only is said on the card");

    await setInput(page, ".eoc-field--size input", "1080x1080");
    await pause(300);
    const order = await text(page, ".eoc-card-size");
    check(/^1024×1024/.test(order[0]) && order.length === 4, "a size ranks by shape, the square first", order);
    check(/Same ratio/.test((await text(page, ".eoc-card-near"))[0] || ""), "…and says how close each is");
    await setInput(page, ".eoc-field--size input", "");
    await setInput(page, ".eoc-field--wide input", "glass 15sec");
    await pause(300);
    check((await text(page, ".eoc-card-size")).length === 2, "search words are ANDed against the name", await text(page, ".eoc-card-size"));
    await setInput(page, ".eoc-field--wide input", "");
    await page.click(".eoc-sections .eoc-chip", "MASTER OV");
    await pause(300);
    check((await text(page, ".eoc-card-size")).length === 1, "a section chip narrows it");

    await page.click(".eoc-card");
    check(await page.waitFor(`document.querySelector(".eoc-detail video") && document.querySelector(".eoc-detail .eoc-still")`, 4000), "picking a card plays the clip beside its stills");
    check((await text(page, ".eoc-detail-head strong"))[0] === "NVC_INTL_DGTL_DOOH_GLASS_1080x1920_10sec_OV", "the archive's `_0.56_` prefix is off the name", await text(page, ".eoc-detail-head strong"));
    check((await text(page, ".eoc-stills button")).join("|") === "0:05|0:14", "its stills are named by where in the clip they are", await text(page, ".eoc-stills button"));
    check(await page.eval(`!!document.querySelector(".eoc-top .eoc-root") && !document.querySelector(".eoc-bar .eoc-btn")`), "Re-read sits in the header, not in the filter row");
    await page.click(".eoc-top .eoc-root", "Re-read");
    await pause(600);
    check(await page.eval(`/MASTER OV/.test((document.querySelector(".eoc-sections .eoc-chip.is-on") || {}).innerText || "") && document.querySelectorAll(".eoc-card").length === 1 && !!document.querySelector(".eoc-detail")`), "…and re-reading keeps the filter and the picked card");
    check(await page.eval(`[...document.querySelectorAll(".eoc-pane-actions .eoc-btn")].map(b => b.innerText.trim()).join("|")`) === "Play large|Show in Finder", "a clip offers Play large and Show in Finder, nothing else");
    await page.shot(path.join(SHOTS, "eoc-browse.png"));

    console.log("\n2. What a film needs");
    await page.click(".eoc-films .eoc-chip", "The Odyssey");
    check(await page.waitFor(`document.querySelectorAll(".eoc-notice").length === 2`, 6000), "misnamed stills and a run that stopped are both said", await text(page, ".eoc-notice span"));
    check(/Norway/.test((await text(page, ".eoc-card-where"))[0] || ""), "a run's clip is placed by the manifest", await text(page, ".eoc-card-where"));
    await page.click(".eoc-notice .eoc-btn", "Fix names");
    await page.waitFor(`document.querySelector(".dialog-card")`, 3000);
    check(/Fix 1 still\?/.test((await text(page, ".dialog-title"))[0] || ""), "…asking first, with a count", await text(page, ".dialog-title"));
    await page.click(".dialog-btn-primary");
    await pause(500);
    const ops = await page.eval(`(window.__fsOps || []).filter(o => o[0] === "rename" && /LASTFRAME/.test(o[1]))`);
    check(ops.length === 1 && /_LASTFRAME\.jpg$/.test(ops[0][2]), "Fix names renames the still to .jpg, after asking", ops);

    console.log("\n3. Add a campaign");
    await page.click(".eoc-notice .eoc-btn", "Pick it up");
    check(await page.waitFor(`document.querySelector(".eoc-arch") && /render/.test(document.querySelector(".eoc-arch").innerText)`, 6000), "Pick it up opens Archive on that run's campaign and folder");
    await pause(600);
    check((await text(page, ".eoc-step .eoc-path"))[2] === `${R}/The_Odyssey/LOCALISED`, "…pointing at the folder the run was writing to", await text(page, ".eoc-step .eoc-path"));
    check(/4 renders in 2 markets/.test((await text(page, ".eoc-arch"))[0]), "the campaign's renders are counted, _Old left out", (await text(page, ".eoc-row--tight .eoc-status")));
    check(/^2 clips to add/.test((await text(page, ".eoc-tally"))[0] || ""), "newest version only, less what is already there", await text(page, ".eoc-tally"));
    await page.click(".checkbox-toggle", "Newest version only");
    await pause(300);
    check(/^3 clips to add/.test((await text(page, ".eoc-tally"))[0] || ""), "…and every version when asked", await text(page, ".eoc-tally"));
    await page.click(".checkbox-toggle", "Newest version only");
    await pause(300);

    check(/moved, changed or retired/.test((await text(page, ".eoc-arch"))[0]), "it says it leaves the campaign alone");
    const boxes = await page.eval(`[...document.querySelectorAll(".eoc-step .eoc-row .dropdown-trigger, .eoc-step .eoc-row .checkbox-toggle, .eoc-step .eoc-row .eoc-btn")].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; })`);
    const clash = boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[1] - 1 && b[0] < a[1] - 1 && a[2] < b[3] - 1 && b[2] < a[3] - 1));
    check(!clash, "no control in a row lies over the next", boxes);
    await page.click(".eoc-drop--small");
    await pause(200);
    const rates = await text(page, ".dropdown-list .dropdown-option");
    check(/0\.6 Mbps/.test(rates.join("|")) && /2 Mbps/.test(rates.join("|")) && !/5 Mbps/.test(rates.join("|")), "0.6, 1 and 2 Mbps", rates);
    await page.click(".dropdown-list .dropdown-option", "0.6 Mbps");
    await pause(200);
    await page.eval(`window.__project = { success: true, items: 4, queued: 0, dirty: true, name: "Work.aep" }`);
    await page.click(".eoc-btn--go");
    await pause(500);
    check((await calls(page, "researchRenderChunk")).length === 0 && /Save or close/.test((await text(page, "body")).join(" ")), "a project with unsaved work: refused, nothing rendered");
    await page.click(".dialog-btn-primary");
    await page.eval(`window.__project = null`);
    await pause(300);
    await page.click(".eoc-btn--go");
    check(await page.waitFor(`/added/.test((document.querySelector(".eoc-status--done") || {}).innerText || "")`, 8000), "the run finishes and says what it did", await text(page, ".eoc-status--done"));
    const sent = (await calls(page, "researchRenderChunk")).map((a) => JSON.parse(a[0]));
    check(sent.length === 1 && sent[0].rows.length === 2 && sent[0].mp4Template === "H264_0.6MBPS_MOS" && sent[0].dest === `${R}/The_Odyssey/LOCALISED`, "one pass, the rows as a JSON string", sent.map((s) => [s.dest, s.rows.length, s.mp4Template]));
    check(/1 clip added, 1 failed/.test((await text(page, ".eoc-status--done"))[0]), "done is what landed in the folder; the broken render is a failure", await text(page, ".eoc-status--done"));
    check((await text(page, ".eoc-fail b"))[0] === "Brazil_B2_ODY_INTL_DGTL_DOOH_BROKEN_960x480_10sec_BR_V01", "…named, with why", await text(page, ".eoc-fail"));
    const renames = await page.eval(`(window.__fsOps || []).filter(o => o[0] === "rename" && /LASTFRAME_00359/.test(o[1])).map(o => o[2])`);
    check(renames.length === 1 && /_LASTFRAME\.jpg$/.test(renames[0]), "AE's frame number comes off the new still", renames);
    const written = await page.eval(`(window.__fsFiles || {})[${JSON.stringify(`${R}/The_Odyssey/LOCALISED/_RESEARCH_MANIFEST.txt`)}] || ""`);
    check(/^DONE\tNorway_Batch_1/m.test(written) && /^DONE\tBrazil_B2_ODY_INTL_DGTL_DOOH_HORSE_960x480_10sec_BR_V02/m.test(written) && /^FAILED\tBrazil_B2_ODY_INTL_DGTL_DOOH_BROKEN/m.test(written), "the manifest records done, failed and why", written.split("\n").map((l) => l.split("\t").slice(0, 2).join(" ")));
    check(/^DONE\tSpain_B1_FROM_ANOTHER_MACHINE/m.test(written), "a row another machine wrote during the pass is still there");
    check(/^1 clip to add/.test((await text(page, ".eoc-tally"))[0] || ""), "what is left is the one that failed", await text(page, ".eoc-tally"));

    console.log("\n4. Who takes what");
    check(/Splitting this between machines/.test((await text(page, ".eoc-shares"))[0] || ""), "with nobody assigned, it says how to split a campaign");
    const pick = async (nth, name) => {
        await page.eval(`document.querySelectorAll(".eoc-market-head .eoc-drop--who")[${nth}].click()`);
        await pause(250);
        await page.click(".dropdown-list .dropdown-option", name);
        await pause(500);
    };
    check((await text(page, ".eoc-market-head .checkbox-toggle")).join("|") === "Brazil|Norway", "markets in order", await text(page, ".eoc-market-head .checkbox-toggle"));
    await pick(0, "Luke");
    await pick(1, "Antonio (you)");
    const saved = JSON.parse(await page.eval(`(window.__fsFiles || {})[${JSON.stringify(`${R}/The_Odyssey/LOCALISED/_RESEARCH_ASSIGN.json`)}] || "{}"`));
    check(saved.assign && saved.assign["Brazil\nB2"] === "Luke" && saved.assign["Norway\nBatch_1"] === "Antonio" && saved.updatedBy === "Antonio", "assignments are saved beside the clips, for every machine to read", saved.assign);
    const shares = await text(page, ".eoc-share");
    check(shares.length === 2 && /^Antonio \(you\) 1 of 1/.test(shares[0]) && /^Luke 1 of 2/.test(shares[1]), "each member's share and how much of it is there", shares);
    const counts = await text(page, ".eoc-market-count");
    check(/1 of 2/.test(counts[0]) && /all 1 there/.test(counts[1]) && await page.eval(`document.querySelectorAll(".eoc-market.is-done").length === 1`), "a market says how far along it is, and a finished one reads as done", counts);
    await page.click(".eoc-link", "Not done");
    await pause(300);
    check(await page.eval(`[...document.querySelectorAll(".eoc-market-head .checkbox-toggle")].map(b => b.classList.contains("active")).join()`) === "true,false", "Not done ticks only what still has clips to add");
    await page.click(".eoc-share", "Antonio");
    await pause(300);
    check(await page.eval(`[...document.querySelectorAll(".eoc-market-head .checkbox-toggle")].map(b => b.classList.contains("active")).join()`) === "false,true" && /^0 clips to add/.test((await text(page, ".eoc-tally"))[0] || ""), "pressing your name ticks only yours", await text(page, ".eoc-tally"));
    await page.click(".eoc-share", "Luke");
    await pause(300);
    const before = (await calls(page, "researchRenderChunk")).length;
    await page.click(".eoc-btn--go");
    await pause(500);
    check(/assigned to Luke/.test((await text(page, ".dialog-title"))[0] || ""), "rendering somebody else's asks first", await text(page, ".dialog-title"));
    await page.click(".dialog-btn-secondary");
    await pause(300);
    check((await calls(page, "researchRenderChunk")).length === before, "…and cancelling renders nothing");
    // Several at once: tick, then hand the ticked ones over together.
    await page.click(".eoc-link", "None");
    await pause(200);
    check(/Tick markets with clips left/.test((await text(page, ".eoc-drop--assign"))[0] || ""), "with nothing ticked there is nothing to assign", await text(page, ".eoc-drop--assign"));
    await page.eval(`document.querySelectorAll(".eoc-market-head .checkbox-toggle")[0].click()`);
    await page.eval(`document.querySelectorAll(".eoc-market-head .checkbox-toggle")[1].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))`);
    await pause(300);
    check(await page.eval(`[...document.querySelectorAll(".eoc-market-head .checkbox-toggle")].every(b => b.classList.contains("active"))`), "Shift-click ticks the run of markets between two presses");
    check(/Assign 1 ticked batch to/.test((await text(page, ".eoc-drop--assign"))[0] || ""), "only ticked batches with something left are counted", await text(page, ".eoc-drop--assign"));
    await page.click(".eoc-drop--assign");
    await pause(250);
    await page.click(".dropdown-list .dropdown-option", "Antonio (you)");
    await pause(500);
    const all = JSON.parse(await page.eval(`(window.__fsFiles || {})[${JSON.stringify(`${R}/The_Odyssey/LOCALISED/_RESEARCH_ASSIGN.json`)}] || "{}"`)).assign;
    check(all["Brazil\nB2"] === "Antonio" && all["Norway\nBatch_1"] === "Antonio", "…and handed over in one press (Brazil was Luke's)", all);
    const boxes2 = await page.eval(`[...document.querySelectorAll(".eoc-market-head .checkbox-toggle, .eoc-market-head .dropdown-trigger, .eoc-market-head .eoc-market-count")].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; })`);
    check(!boxes2.some((a, i) => boxes2.some((b, j) => j > i && a[0] < b[1] - 1 && b[0] < a[1] - 1 && a[2] < b[3] - 1 && b[2] < a[3] - 1)), "nothing in a market's row overlaps");
    await page.shot(path.join(SHOTS, "eoc-archive.png"));
} finally {
    await page.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — browse, fix, pick up and archive.");
process.exit(fails ? 1 : 0);
