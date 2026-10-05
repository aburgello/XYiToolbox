// =============================================================================
// scripts/ui-bespoke-guided.mjs
// -----------------------------------------------------------------------------
// Click-through of Bespoke's guided build on a fake bridge and a fake folder
// tree (the harness answers readdir/readFile from window.__fsTree/__fsFiles;
// nothing real is read). The arch is Malaysia's real VivaCity CSV.
//
//   yarn build:web && node scripts/ui-bespoke-guided.mjs
// =============================================================================
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const SHOTS = process.env.UI_SHOTS || os.tmpdir();
const MASTERS = "/Volumes/paramount/SF/XY026204_Masters";
const BATCH = "/Volumes/paramount/SF/XY026206_Bespoke/Malaysia/PNGs/Bespoke_VivaCity";
const ARCH = "SF_INTL_RyuHadouken_Trio_DINTH_VivacityArch_7680x1472px_30s_MY";
const PANEL = "SF_INTL_Trio_DINTH_VivacityVerticalPanel_384x1152px_30s_MY";
const TOPPEN = "SF_INTL_RyuHadouken_DINTH_TGVToppen_5376x352px_30s_MY";
const S = MASTERS + "/Support";
const HEAD = "PageLabel,Type,Name,FilePath,X_px,Y_px,Width_px,Height_px,MaskX_px,MaskY_px,MaskWidth_px,MaskHeight_px\n";
const files = {
    [`${BATCH}/${ARCH}/${ARCH}.csv`]: HEAD + [
        `Page1,"TT","SF_RGB_Teaser_1Line_TT_OV_SIMP.psd","${S}/RyuHadouken/TT/SF_RGB_Teaser_1Line_TT_OV_SIMP.psd",5762,-173,1107,632,5810,1,1027,204`,
        `Page1,"TT4","SF_RGB_Teaser_1Line_TT_OV_SIMP.psd","${S}/RyuHadouken/TT/SF_RGB_Teaser_1Line_TT_OV_SIMP.psd",684,-173,1107,632,732,1,1027,204`,
        `Page1,"ART","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif",7030,-64,919,1530,6792,0,888,320`,
        `Page1,"ART2","SF_INTL_Trio_OOH_1080x1920_RGB_OV_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_1080x1920_RGB_OV_BG.tif",1337,-704,2190,2718,1641,0,1176,320`,
        `Page1,"ART3","SF_INTL_Trio_OOH_1080x1920_RGB_OV_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_1080x1920_RGB_OV_BG.tif",1337,-704,2190,2718,2049,0,768,1472`,
        `Page1,"ART4","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB_BORDER.tif",7030,-357,919,2249,7296,361,384,1111`,
        `Page1,"ART5","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif",7030,-64,919,1530,7296,0,384,1472`,
    ].join("\n"),
    [`${BATCH}/${PANEL}/${PANEL}.csv`]: HEAD + `Page1,"ART","SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif","${S}/Trio/Tiffs/SF_INTL_Trio_OOH_Tall_Portrait_RGB_BG.tif",-265,-122,916,1524,0,0,384,1152`,
    [`${BATCH}/${TOPPEN}/${TOPPEN}.csv`]: HEAD + `Page1,"TT","SF_RGB_Teaser_1Line_TT_OV_SIMP.psd","${S}/RyuHadouken/TT/SF_RGB_Teaser_1Line_TT_OV_SIMP.psd",100,-20,1107,632,120,1,1027,204`,
};
const tree = {};
const put = (p) => {
    const parts = p.split("/");
    for (let i = 2; i <= parts.length; i++) {
        const dir = parts.slice(0, i - 1).join("/");
        const list = (tree[dir] = tree[dir] || []);
        if (!list.some((e) => e.name === parts[i - 1])) list.push({ name: parts[i - 1], dir: i < parts.length });
    }
};
Object.keys(files).forEach(put);
put(`${BATCH}/${ARCH}/${ARCH}.jpg`);
put(`${BATCH}/${ARCH}/ARTWORK_ONLY/x.jpg`);
put(`${BATCH}/_Old/Something_384x1152px_30s_MY/x.csv`);
// The vertical panel was already built: its project is in the batch's AE folder.
put(`/Volumes/paramount/SF/XY026206_Bespoke/Malaysia/AE/Bespoke_VivaCity/${PANEL}_V01.aep`);

// Trio has 15s and 10s masters and no 30s; another creative has a 30s.
const FIXTURES = `{
  loadLocLibCampaigns: () => [{ name: "Street Fighter", marketsRoot: "/Volumes/paramount/SF/XY026205_Markets" }],
  loadCampaigns: () => [{ name: "Street Fighter", mastersRoot: "${MASTERS}" }],
  csvLocaliserLoadLastPath: () => "${MASTERS}",
  csvLocaliserLoadLastCampaign: () => "Street Fighter",
  bespokeListMasters: () => ({ success: true, masters: ["Trio", "RyuHadouken", "CharacterMotionPoster"].map((c) => ({ path: "/m/" + c + ".aep", name: c, creative: c, artwork: "DOOH", site: "", size: "1080x1920", width: 1080, height: 1920, duration: "15", territory: "OV", film: "SF", region: "INTL", orientation: "PORTRAIT" })) }),
  bespokeTemplateList: () => ({ success: true, read: true, templates: [] }),
  csvLocaliserListMasters: (root, creative, size, duration) => {
    if (creative !== "Trio") return { success: true, candidates: [{ name: "SF_INTL_Characters_DOOH_MotionPoster_1080x1920px_30s_OV.aep", path: root + "/AE/CharacterMotionPoster/c30.aep", creative: "CharacterMotionPoster", tier: 0 }], otherDurations: [] };
    return { success: true,
      candidates: [{ name: "SF_INTL_Characters_DOOH_MotionPoster_1080x1920px_30s_OV.aep", path: root + "/AE/CharacterMotionPoster/c30.aep", creative: "CharacterMotionPoster", tier: 0 }],
      otherDurations: [
        { name: "SF_INTL_Trio_DOOH_MotionPoster_1080x1920px_10s_OV.aep", path: root + "/AE/Trio/t10.aep", creative: "Trio", tier: 3, seconds: "10" },
        { name: "SF_INTL_Trio_DOOH_MotionPoster_1080x1920px_15s_OV.aep", path: root + "/AE/Trio/t15.aep", creative: "Trio", tier: 3, seconds: "15" },
        { name: "SF_INTL_Trio_DOOH_MotionPoster_1080x1920px_20s_OV.aep", path: root + "/AE/Trio/t20.aep", creative: "Trio", tier: 3, seconds: "20" } ] };
  },
  bespokeBuildRegions: (json) => { window.__plan = JSON.parse(json); return { success: true, report: "built " + window.__plan.name, saved: !!window.__plan.territory, savedTo: "/x/Malaysia/AE/Bespoke_VivaCity/" + window.__plan.name + "_V01.aep" }; },
}`;

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };
const text = (page, sel) => page.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ""`);
const type = (page, sel, v) => page.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const rows = (page) => page.eval(`[...document.querySelectorAll(".bsg-row")].map(r => ({ what: r.querySelector(".bsg-row-what").innerText.replace(/\\s+/g, " "), pick: (r.querySelector(".bsg-pick .dropdown-trigger-label") || {}).innerText || "", fit: (r.querySelector(".bsg-row-fit") || {}).innerText || "", nums: [...r.querySelectorAll(".bsg-num input")].map(i => i.value).join(",") }))`);

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, width: 1000, height: 1300 });
try {
    await page.goto();
    await page.eval(`window.__fsTree = ${JSON.stringify(tree)}; window.__fsFiles = ${JSON.stringify(files)}; try { localStorage.removeItem("xyi.bespoke.guided.path"); } catch (e) {}`);
    await page.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 10000);
    await page.click("button.category-card", "Localise");
    await page.waitFor(`[...document.querySelectorAll(".ls-grid-item")].some(b => /Bespok/.test(b.textContent))`, 8000);
    await page.click(".ls-grid-item", "Bespok");
    check(await page.waitFor(`document.querySelectorAll(".bsp-choose-card").length === 2`, 8000), "Bespoke opens on its chooser");
    await page.click(".bsp-choose-card", "Bespoke");
    check(await page.waitFor(`!!document.querySelector(".bsg .bsg-empty")`, 5000), "the Bespoke card opens the guided build, not the tracing board");
    check(!(await page.eval(`!!document.querySelector(".bsp-canvas")`)), "…with no canvas to draw on");

    console.log("\nAn arch, read off its CSV");
    await type(page, ".bsg-path", `${BATCH}/${ARCH}`);
    await page.click(".bsg-top .bsp-btn", "Read");
    check(await page.waitFor(`document.querySelectorAll(".bsg-row").length === 2`, 6000), "pointing at the deliverable's folder reads two panels from five ART rows", await page.eval(`document.querySelectorAll(".bsg-row").length`));
    check(/7680×1472/.test(await text(page, ".bsg-head")) && (await page.eval(`document.querySelector(".bsg-num--secs input").value`)) === "30", "the canvas and the length come off the name", await text(page, ".bsg-head"));
    let r = await rows(page);
    check(/^Trio 768×1472/.test(r[0].what) && r[0].nums === "2049,0,768,1472" && r[1].nums === "7296,0,384,1472", "each panel is its leg exactly as the CSV wrote it, never a box round the lintel too", r.map((x) => x.nums));
    check(/also runs on at 1641, 0 · 1176×320/.test(await text(page, ".bsg-row .bsg-row-extra")), "…and the lintel its artwork runs along is said, not built", await text(page, ".bsg-row .bsg-row-extra"));
    check(await page.waitFor(`[...document.querySelectorAll(".bsg-row .bsg-pick .dropdown-trigger-label")].every(e => /^1080×1920 · 15s · MotionPoster$/.test(e.innerText.trim()))`, 6000), "no 30s Trio master: the 15s is proposed for each, never another creative's 30s", (await rows(page)).map((x) => x.pick));
    r = await rows(page);
    check(/played 2× to fill 30s/.test(r[0].fit) && /cropped to the panel/.test(r[0].fit), "…saying it is played twice and how its shape sits", r[0].fit);
    check(/^SF_INTL_Trio_DOOH_MotionPoster_1080x1920px_15s_OV · /.test(r[0].fit), "…with the master's full name under it, since the list shows its size instead", r[0].fit);
    check(await page.eval(`document.querySelectorAll(".bsg-board .bsg-panel").length === 2 && document.querySelectorAll(".bsg-board .bsg-window").length === 3 && document.querySelectorAll(".bsg-board .bsg-extra").length === 2 && document.querySelectorAll(".bsg-board .bsg-title").length === 2`), "the sheet shows both legs, the two lintels dashed beside them, and the titles");
    const geo = await page.eval(`(() => { const b = document.querySelector(".bsg-board").getBoundingClientRect(); const p = document.querySelector(".bsg-board .bsg-panel").getBoundingClientRect(); return { ratio: b.width / b.height, left: (p.left - b.left) / b.width, width: p.width / b.width, wide: b.width }; })()`);
    check(Math.abs(geo.ratio - 7680 / 1472) < 0.05 && Math.abs(geo.left - 2049 / 7680) < 0.005 && Math.abs(geo.width - 768 / 7680) < 0.005, "…drawn in the board's own shape, each box where the CSV put it", geo);
    check(geo.wide > 850, "the board takes the page's width", geo.wide);
    check((await page.eval(`document.querySelectorAll(".bsg-sib").length`)) === 3 && !/_Old|Something/.test(await text(page, ".bsg-siblings")), "the rest of the batch is one press away (never _Old)", await text(page, ".bsg-siblings"));
    check(/Save it to Malaysia\/AE\/Bespoke_VivaCity/.test(await text(page, ".bsg-filing")), "where it files is read off where the CSV sits", await text(page, ".bsg-filing"));
    await page.shot(path.join(SHOTS, "ui-bespoke-guided.png"));

    console.log("\nCorrecting it");
    await page.click(".bsg-row .bsg-pick");
    await page.waitFor(`document.querySelector(".dropdown-option")`, 3000);
    const opts = await page.eval(`[...document.querySelectorAll(".dropdown-option")].map(o => o.innerText.replace(/\\s+/g, " "))`);
    check(opts.length === 4 && /^1080×1920 · 15s · MotionPoster .*×2/i.test(opts[0]) && /^1080×1920 · 10s · MotionPoster .*×3/i.test(opts[1]) && /1080×1920 · 30s · MotionPoster · CharacterMotionPoster/.test(opts[2]) && /Leave it empty/.test(opts[3]), "the list: fewest passes first, then other creatives', then empty. A 20s that doesn't go into 30s is not offered", opts);
    await page.click(".dropdown-option", "· 10s ·");
    check(await page.waitFor(`/played 3×/.test(document.querySelector(".bsg-row .bsg-row-fit").innerText) && /picked/.test(document.querySelector(".bsg-row .bsg-row-fit").innerText)`, 3000), "picking another master sticks, and says it was picked");
    console.log("\nWhat the CSV could not see: the lintel");
    const over = (fx, fy, kind) => page.eval(`(() => { const el = document.querySelector(".bsg-board"); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent(${JSON.stringify(kind)}, { bubbles: true, clientX: r.left + r.width * ${fx}, clientY: r.top + r.height * ${fy} })); })()`);
    const nums = async () => (await rows(page)).map((x) => x.nums);
    await over(0.1, 0.1, "mousemove");
    check(await page.waitFor(`/2049×320/.test((document.querySelector(".bsg-ghost") || {}).innerText || "")`, 3000), "moving over the empty lintel shows the gap a press would fill: up to the leg, 320 tall", await text(page, ".bsg-ghost"));
    await over(0.3, 0.5, "mousemove");
    check(await page.waitFor(`!document.querySelector(".bsg-ghost")`, 3000), "…and nothing over a panel");
    await over(0.1, 0.1, "click");
    check(await page.waitFor(`document.querySelectorAll(".bsg-row").length === 3`, 3000) && (await nums())[2] === "0,0,2049,320", "a press makes it a panel, with no number typed", await nums());
    r = await rows(page);
    check(/^RyuHadouken 2049×320/.test(r[2].what) && /added by hand/.test(r[2].what), "…as the creative whose title sits in it", r[2].what);
    check(await page.waitFor(`/No RyuHadouken master at this length/.test(document.querySelectorAll(".bsg-row")[2].innerText)`, 5000), "a creative with no master of its own is asked about, never given another's", await page.eval(`document.querySelectorAll(".bsg-row")[2].innerText`));
    await page.click(".bsg-row:nth-child(3) button[aria-label='Copy panel 3']");
    check(await page.waitFor(`document.querySelectorAll(".bsg-row").length === 4`, 3000) && (await nums())[3] === "5247,0,2049,320", "Copy lands its twin against the far leg", await nums());
    await over(0.5, 0.1, "mousemove");
    check(await page.waitFor(`/2430×320/.test((document.querySelector(".bsg-ghost") || {}).innerText || "")`, 3000), "what is left between them is one gap", await text(page, ".bsg-ghost"));
    await over(0.5, 0.1, "click");
    await page.waitFor(`document.querySelectorAll(".bsg-row").length === 5`, 3000);
    r = await rows(page);
    check(r[4].nums === "2817,0,2430,320" && /Leave it empty/.test(r[4].pick), "…and with no title in it, it starts empty: a hole for a PNG", r[4]);
    check(!(await page.eval(`!!document.querySelector(".bsg-row button[aria-label^='Split']")`)), "there is no Split");

    console.log("\nSums, and magnetic sides");
    const enter = async (sel, v) => { await type(page, sel, v); await page.eval(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`); };
    const W5 = ".bsg-row:nth-child(5) .bsg-row-nums .bsg-num:nth-child(3) input";
    await type(page, W5, "2430/");
    check((await page.eval(`document.querySelector(${JSON.stringify(W5)}).value`)) === "2430/" && /2430×320/.test((await rows(page))[4].what), "a half-typed sum is left alone, and changes nothing yet", (await rows(page))[4].what);
    await enter(W5, "2430/2");
    check(await page.waitFor(`document.querySelector(${JSON.stringify(W5)}).value === "1215"`, 3000), "W takes a sum: 2430/2 is 1215", (await nums())[4]);
    await enter(".bsg-row:nth-child(5) .bsg-row-nums .bsg-num:nth-child(1) input", "2049+768");
    check((await nums())[4] === "2817,0,1215,320", "…and so does X", (await nums())[4]);
    await enter(W5, "99999");
    check((await nums())[4] === "2817,0,4863,320", "a number past the board's edge stops at it", (await nums())[4]);
    await enter(W5, "1215");
    // Drag panel 5's right side to within reach of panel 4's left (5247).
    const drag = (n, handle, toX, toY, release = true) => page.eval(`(() => {
        const b = document.querySelector(".bsg-board").getBoundingClientRect();
        const panel = [...document.querySelectorAll(".bsg-board .bsg-panel")].filter(p => p.querySelector("b").innerText.trim() === "${n}")[0];
        const el = ${JSON.stringify(handle)} ? panel.querySelector(${JSON.stringify(handle)}) : panel;
        const r = el.getBoundingClientRect();
        const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
        const px = (bx) => b.left + (bx / 7680) * b.width, py = (by) => b.top + (by / 1472) * b.height;
        const tx = ${toX} === null ? sx : (${JSON.stringify(handle)} ? px(${toX}) : sx + (${toX} / 7680) * b.width);
        const ty = ${toY} === null ? sy : (${JSON.stringify(handle)} ? py(${toY}) : sy + (${toY} / 1472) * b.height);
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: sx, clientY: sy }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: (sx + tx) / 2, clientY: (sy + ty) / 2 }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: tx, clientY: ty }));
        if (${release}) window.dispatchEvent(new MouseEvent("mouseup", { clientX: tx, clientY: ty }));
    })()`);
    await drag(5, ".bsg-handle--r", 5210, null, false);
    check(await page.waitFor(`!!document.querySelector(".bsg-snap--x") && /2430×320 at 2817, 0/.test((document.querySelector(".bsg-panel.is-dragging em") || {}).innerText || "")`, 3000), "dragging a side near another panel's catches on it: the line shows, and the size reads live", await text(page, ".bsg-panel.is-dragging"));
    check((await page.eval(`document.querySelector(${JSON.stringify(W5)}).value`)) === "2430", "…in the number field too, while it is still held");
    await page.eval(`window.dispatchEvent(new MouseEvent("mouseup", {}))`);
    check(await page.waitFor(`!document.querySelector(".bsg-snap") && !document.querySelector(".bsg-panel.is-dragging")`, 3000) && (await nums())[4] === "2817,0,2430,320", "letting go leaves it exactly on that side, 37 pixels short of where the mouse was", (await nums())[4]);
    await drag(4, "", -1000, null);
    await page.waitFor(`!document.querySelector(".bsg-panel.is-dragging")`, 3000);
    const moved = (await nums())[3].split(",").map(Number);
    check(Math.abs(moved[0] - 4247) <= 3 && moved[2] === 2049 && moved[3] === 320, "dragging a panel's body moves it freely when nothing is near", moved);
    await drag(4, "", 5215 - moved[0], 40);
    await page.waitFor(`!document.querySelector(".bsg-panel.is-dragging")`, 3000);
    check((await nums())[3] === "5247,0,2049,320", "…and back near where it was, it catches on both axes", (await nums())[3]);
    check((await page.eval(`document.querySelectorAll(".bsg-row").length`)) === 5 && !(await page.eval(`!!document.querySelector(".bsg-ghost")`)), "a drag is never read as a press on a gap");
    check((await page.eval(`document.querySelectorAll(".bsg-board .bsg-panel").length`)) === 5, "all five are on the sheet");
    await page.shot(path.join(SHOTS, "ui-bespoke-lintel.png"));
    // The creative of a panel can be changed: the copy becomes Trio's.
    await page.click(".bsg-row:nth-child(4) .bsg-creative");
    await page.waitFor(`document.querySelector(".dropdown-option")`, 3000);
    await page.click(".dropdown-option", "Trio");
    check(await page.waitFor(`/1080×1920 · 15s · MotionPoster/.test((document.querySelectorAll(".bsg-row")[3].querySelector(".bsg-pick .dropdown-trigger-label") || {}).innerText || "")`, 5000), "changing a panel's creative re-asks for its master");
    await page.click(".bsg-row:nth-child(2) .bsg-link");
    check(await page.waitFor(`document.querySelectorAll(".bsg-row").length === 6`, 3000), "a run-on window can be made a panel of its own");
    r = await rows(page);
    check(r[2].nums === "6792,0,888,320" && /^Trio 888×320/.test(r[2].what) && !/also runs on/.test(await text(page, ".bsg-row:nth-child(2)")), "…straight after the panel it came from, at the CSV's own numbers", r[2]);
    await page.click(".bsg-row:nth-child(3) .bsp-btn--danger");
    await page.waitFor(`document.querySelectorAll(".bsg-row").length === 5`, 3000);

    console.log("\nBuilding");
    await page.click(".bsg-build");
    check(await page.waitFor(`!!window.__plan`, 5000), "Build sends one plan to the build the tracing board used");
    const plan = await page.eval(`window.__plan`);
    check(plan.canvasWidth === 7680 && plan.canvasHeight === 1472 && plan.seconds === 30 && plan.name === ARCH && plan.scalePanels === true, "the canvas, the length and the deliverable's own name", { w: plan.canvasWidth, s: plan.seconds, n: plan.name });
    check(plan.regions.length === 5 && /t10\.aep$/.test(plan.regions[0].path) && plan.regions[0].repeat === 3 && /t15\.aep$/.test(plan.regions[1].path) && plan.regions[1].repeat === 2 && /t15\.aep$/.test(plan.regions[3].path), "each panel with its master and how often it is played", plan.regions.map((x) => [x.path.split("/").pop(), x.repeat]));
    check(plan.regions[4].path === "" && plan.regions[4].label === "PANEL 5" && [plan.regions[4].x, plan.regions[4].w, plan.regions[4].h].join() === "2817,2430,320", "an empty panel goes as an empty comp of its size, where it was put", plan.regions[4]);
    check(plan.territory === "Malaysia" && plan.batch === "Bespoke_VivaCity" && /XY026206_Bespoke$/.test(plan.marketsRoot), "filed where the CSV's own folders say", [plan.marketsRoot, plan.territory, plan.batch]);
    check(new RegExp(ARCH + "\\.jpg$").test(plan.refPath), "the mech sheet goes along as the guide layer", plan.refPath);
    check(await page.waitFor(`/Built and saved/.test((document.querySelector(".bsg-note") || {}).innerText || "") && /built SF_INTL/.test((document.querySelector(".bsg-report") || {}).innerText || "")`, 5000), "the report comes back on the page", await text(page, ".bsg-note"));
    check(/already in Malaysia\/AE\/Bespoke_VivaCity/.test(await text(page, ".bsg-filing")), "…and the page knows it is on disk now", await text(page, ".bsg-filing"));

    console.log("\nThe rest of the batch");
    await page.click(".bsg-sib", "VivacityVerticalPanel");
    check(await page.waitFor(`/384×1152/.test(document.querySelector(".bsg-head").innerText) && document.querySelectorAll(".bsg-row").length === 1`, 6000), "a sibling loads in place: one panel the size of its canvas");
    check(/already in Malaysia\/AE\/Bespoke_VivaCity/.test(await text(page, ".bsg-filing")), "already built: said, and it will not be saved over", await text(page, ".bsg-filing"));
    await page.eval(`window.__plan = null`);
    await page.waitFor(`!document.querySelector(".bsg-build").disabled`, 5000);
    await page.click(".bsg-build");
    await page.waitFor(`!!window.__plan`, 5000);
    check((await page.eval(`window.__plan.territory`)) === "", "…so that build carries no territory and is left open");
    const tall = await page.eval(`(() => { const b = document.querySelector(".bsg-board").getBoundingClientRect(); return { h: b.height, ratio: b.width / b.height }; })()`);
    check(tall.h <= 462 && Math.abs(tall.ratio - 384 / 1152) < 0.01, "a tall board is held to a height, still in its own shape", tall);
    await page.click(".bsg-sib", "TGVToppen");
    check(await page.waitFor(`/places no artwork, only titles/.test((document.querySelector(".bsg") || {}).innerText || "")`, 6000), "a CSV with titles only says there is nothing to size a panel from");
    check(await page.eval(`document.querySelector(".bsg-build").disabled`), "…and nothing can be built until a panel is added");

    console.log("\nWhat can't be read");
    await type(page, ".bsg-path", `${BATCH}/${ARCH}/ARTWORK_ONLY`);
    await page.click(".bsg-top .bsp-btn", "Read");
    check(await page.waitFor(`/No CSV in ARTWORK_ONLY/.test((document.querySelector(".bsg-note.is-bad") || {}).innerText || "")`, 5000), "a folder with no CSV says so");
    await page.click(".bsg-top .bsp-btn", "Back");
    check(await page.waitFor(`document.querySelectorAll(".bsp-choose-card").length === 2`, 4000), "Back returns to the chooser");
    const errs = await page.eval(`window.__errors || []`);
    check(!errs.length, "no page errors", errs);
} finally {
    await page.close();
}
console.log(fails ? "\n" + fails + " FAILED" : "\nCLEAN — a deliverable's folder in, its board proposed, corrected and built.");
process.exit(fails ? 1 : 0);
