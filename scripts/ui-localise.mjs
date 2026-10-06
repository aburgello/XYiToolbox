// =============================================================================
// scripts/ui-localise.mjs
// -----------------------------------------------------------------------------
// Click-through test of the Localise landing, the Localised Library and the
// Active Jobs -> Localise handoff, against the browser build with a fake AE
// bridge (see ui-harness.mjs). Street Fighter fixtures, shaped like the real
// campaign: 22 territories, some empty, the open project in Czechia.
//
//   yarn build:web && node scripts/ui-localise.mjs
//
// Screenshots land in $UI_SHOTS (default: the OS temp dir) for a human look.
// =============================================================================
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const SHOTS = process.env.UI_SHOTS || os.tmpdir();

const FIXTURES = `{
  loadLocLibCampaigns: () => [
    { name: "Street Fighter", marketsRoot: "/Volumes/paramount/SF/XY026205_Markets" },
    { name: "Forgotten Island", marketsRoot: "/Volumes/universal/FI/XY026040_Markets" },
  ],
  loadOVLibCampaigns: () => [],
  // The real parser is ExtendScript (nameGeneratorParse) and has its own
  // probes; this stand-in only has to read the sample jobs' current-convention
  // names: PREFIX_INTL_<Creative>_<Artwork>[_<Site>]_<WxH>px_<N>s_<TERR>.
  parseDeliverableNames: (json) => JSON.parse(json).map((name) => {
    const t = String(name).split("_");
    const si = t.findIndex((x) => /^\\d{3,}x\\d{3,}(px)?$/.test(x));
    if (si < 4) return { success: false };
    const dur = t[si + 1] || "";
    return {
      success: true, isOv: t[t.length - 1] === "OV",
      campaign: t[2], artworkType: t[3], site: si > 4 ? t.slice(4, si).join("_") : "",
      duration: /\\d+s(ec)?$/.test(dur) ? dur.replace(/s(ec)?$/, "sec") : "",
      territory: t[si + 2] || "", language: t[si + 3] || "",
    };
  }),
  // Master lookups for Build a Batch. The masters folder has nothing at the
  // row's size and length (only a 15s at other durations); "another folder"
  // has one. The two dialogs answer as a person picking would.
  csvLocaliserResolveMasters: (root, json) => ({ success: true, indexed: 5, rows: JSON.parse(json).map(() => ({ master: null, path: null })) }),
  csvLocaliserListMasters: (root) => root.indexOf("Other_Masters") !== -1
    ? { success: true, candidates: [{ name: "FID_INTL_Trio_DINTH_Showtime_1920x1080px_30s_OV.aep", path: root + "/Trio/FID_INTL_Trio_DINTH_Showtime_1920x1080px_30s_OV.aep", creative: "Trio", tier: 2 }], otherDurations: [] }
    : { success: true, candidates: [], otherDurations: [{ name: "FID_INTL_Trio_DOOH_MotionPoster_1920x1080px_15s_OV_with_a_long_name_that_used_to_scroll.aep", path: root + "/Trio/x_15s_OV.aep", creative: "Trio", tier: 2, seconds: "15" }] },
  csvLocaliserPickMasterFolder: () => "/Volumes/paramount/SF/Other_Masters/AE",
  csvLocaliserPickMasterFile: () => "/Volumes/paramount/SF/Other_Masters/AE/Trio/FID_INTL_Trio_Handpicked_1920x1080px_30s_OV.aep",
  // A tagged machine, or Active Jobs has nobody's jobs to show.
  teamGetMachineState: () => ({ owner: "Antonio", tag: "Antonio" }),
  csvLocaliserLoadLastCampaign: () => "Street Fighter",
  csvLocaliserLoadLastPath: () => "/Volumes/paramount/SF/XY026206_Masters/AE",
  locLibCampaignStatus: () => [{ name: "Street Fighter", reachable: true }, { name: "Forgotten Island", reachable: true }],
  teamCampaignBoard: () => ({ read: true, rows: [] }),
  loadCampaignBanner: () => "",
  detectCurrentLocLibCampaign: () => "Street Fighter",
  // The open project: Czechia, Batch_01 -- what the header says "you are in".
  timesheetActiveFile: () => ({ success: true, hasFile: true, path: "/Volumes/paramount/SF/XY026205_Markets/Czechia/AE/Batch_01/SF_INTL_Trio_DINTH_1080x1920px_10s_CZ_V01.aep", name: "SF_INTL_Trio_DINTH_1080x1920px_10s_CZ_V01.aep", folderName: "Batch_01" }),
  loadLocLibFolders: () => [],
  scanTerritories: (root) => root.indexOf("SF") !== -1 ? ${JSON.stringify([
      "Argentina", "Austria", "Belgium", "Bulgaria", "Chile", "Colombia", "Croatia", "Cyprus", "Czechia", "Denmark",
      "Greece", "Hungary", "Indonesia", "Latvia", "Poland", "Slovakia", "Slovenia", "South_Africa", "Sweden",
  ])} : ["Italy", "France"],
  // The Tracker pane: nothing open in a batch, and only Indonesia on disk.
  trackerContext: () => ({ success: true }),
  trackerCompCheck: () => ({ success: true, comps: [] }),
  trackerScanMany: (json) => ({ success: true, results: Object.fromEntries(JSON.parse(json).map((q) => [q.id, { success: true, rows: [] }])) }),
  trackerLocate: (json) => ({ success: true, jobs: JSON.parse(json).filter((j) => j.code === "ID").map((j) => ({ id: j.id, territoryPath: "/Volumes/paramount/SF/XY026205_Markets/Indonesia", territory: "Indonesia", batch: "Batch_01", batches: ["Batch_01"] })) }),
  trackerScan: (json) => { window.__trackerScan = JSON.parse(json); return { success: true, territory: "Indonesia", batch: "Batch_01", folders: { art: "", aep: "", renders: "", delivered: [], specs: "" }, rows: [] }; },
  getTerritoryCountryCode: (t) => (${JSON.stringify({
      Argentina: "AR", Austria: "AT", Belgium: "BE", Bulgaria: "BG", Chile: "CL", Colombia: "CO", Croatia: "HR", Cyprus: "CY",
      Czechia: "CZ", Denmark: "DK", Greece: "GR", Hungary: "HU", Indonesia: "ID", Latvia: "LV", Poland: "PL", Slovakia: "SK",
      Slovenia: "SI", South_Africa: "ZA", Sweden: "SE", Italy: "IT", France: "FR",
  })})[t] || null,
  detectCurrentTerritory: (terrs) => terrs.indexOf("Czechia") !== -1 ? "Czechia" : null,
  // Global Components: a little stateful store, so adding and removing show up.
  locLibPickGlobal: (kind) => ({ paths: kind === "folder" ? ["/Volumes/paramount/SF/Brand/Logo_Pack"] : ["/Volumes/paramount/SF/Brand/SF_EndCard.aep", "/Volumes/paramount/SF/Brand/SF_Font.otf"] }),
  addLocLibGlobal: (campaign, label, path, kind) => { (window.__globals = window.__globals || []).push({ campaign, territory: "__GLOBAL__", label, path, kind: kind === "folder" ? "folder" : undefined }); return { success: true }; },
  removeLocLibComponent: (campaign, territory, label, path) => { window.__globals = (window.__globals || []).filter((g) => g.path !== path); return { success: true }; },
  locLibListFolder: (path) => path.endsWith("Logo_Pack")
    ? { folders: [{ name: "Variants", path: path + "/Variants" }], files: [{ name: "SF_Logo_RGB.ai", path: path + "/SF_Logo_RGB.ai" }, { name: "SF_Logo_White.png", path: path + "/SF_Logo_White.png" }] }
    : { folders: [], files: [{ name: "SF_Logo_Mono.psd", path: path + "/SF_Logo_Mono.psd" }] },
  loadLocLibComponents: () => (window.__globals || []).concat((() => {
    const counts = ${JSON.stringify({ Argentina: 8, Austria: 18, Belgium: 33, Bulgaria: 15, Chile: 40, Croatia: 29, Cyprus: 18, Czechia: 5, Hungary: 37, Indonesia: 15, Slovakia: 26, Slovenia: 42, South_Africa: 12, Sweden: 12 })};
    const out = [];
    Object.keys(counts).forEach((t) => {
      for (let i = 0; i < counts[t]; i++) {
        const ext = ["aep", "ai", "psd", "png"][i % 4];
        out.push({ campaign: "Street Fighter", territory: t, label: "SF_Trio_" + t + "_" + i + (i % 5 === 0 ? "_POST" : ""), path: "/Volumes/paramount/SF/XY026205_Markets/" + t + "/Support_Motion/SF_Trio_" + i + "." + ext });
      }
    });
    return out;
  })()),
}`;

let failures = 0;
const check = (ok, msg, extra) => {
    if (!ok) failures++;
    console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : ""));
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.innerText || "").replace(/\\s+/g, " ").trim()`;
const count = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;
const rect = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } : null; })()`;

async function openLocalise(page) {
    await page.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 10000);
    await page.click("button.category-card", "Localise");
    const ok = await page.waitFor(`document.querySelector(".ls-libcard-row")`, 8000);
    await pause(400);
    return ok;
}

// What Street Fighter has had approved, for the builder's "seen before" hint:
// Trio twice at 3:5 (once at exactly 768x1280) and once CLOSE to it (800x1280,
// 4% wider); a 20s the 30s rows can't be built from; and, for the 512x1280
// row, nothing at its ratio but one within 10% of it.
const APPROVED = {};
for (const f of ["SF_INTL_Trio_DOOH_Cinema_768x1280px_10s_IT.mp4", "SF_INTL_Trio_DOOH_Wall_1536x2560px_30s_IT.mp4", "SF_INTL_Characters_DOOH_Wall_1080x1920px_10s_IT.mp4",
    "SF_INTL_Trio_DOOH_Totem_800x1280px_15s_IT.mp4", "SF_INTL_Trio_DOOH_Arcade_768x1280px_20s_IT.mp4", "SF_INTL_Trio_DOOH_Pillar_540x1280px_30s_IT.mp4"]) {
    // The 30s Wall also has the project it was rendered from, so it can be built from.
    const files = ["Renders/Batch_01/_Delivery/" + f].concat(/Wall_1536|Totem_800|Cinema_768/.test(f) ? ["AE/Batch_1/" + f.replace(".mp4", "_V01.aep"), "AE/Batch_1/" + f.replace(".mp4", "_V02.aep")] : []);
    for (const rel of files) {
    const parts = ("/Volumes/paramount/SF/XY026205_Markets/Italy/" + rel).split("/");
    for (let i = 2; i <= parts.length; i++) {
        const dir = parts.slice(0, i - 1).join("/");
        const list = (APPROVED[dir] = APPROVED[dir] || []);
        if (!list.some((e) => e.name === parts[i - 1])) list.push({ name: parts[i - 1], dir: i < parts.length });
    }
    }
}

// Denmark's own artwork for the first builder row (the sheet and two slots),
// and Italy's for the approved Cinema (the sheet and one), to wipe and page.
{
    const D = "SF_INTL_Trio_DOOH_ShowtimeCinemasTPED_768x1280px_30s_DK";
    const I = "SF_INTL_Trio_DOOH_Cinema_768x1280px_10s_IT";
    const M = "/Volumes/paramount/SF/XY026205_Markets/";
    for (const f of ["Denmark/AE/Batch_1/SF_INTL_Trio_DOOH_InTheatreFoyerScreen_512x1280px_30s_DK_V01.aep", "Denmark/AE/Batch_1/Adobe After Effects Auto-Save/x.aep", `Denmark/JPG_PNG/Batch_1/${D}/${D}.jpg`, `Denmark/JPG_PNG/Batch_1/${D}/${D}1.png`, `Denmark/JPG_PNG/Batch_1/${D}/${D}2.png`,
        `Italy/JPG_PNG/Batch_1/${I}/${I}.jpg`, `Italy/JPG_PNG/Batch_1/${I}/${I}1.png`]) {
        const parts = (M + f).split("/");
        for (let i = 2; i <= parts.length; i++) {
            const dir = parts.slice(0, i - 1).join("/");
            const list = (APPROVED[dir] = APPROVED[dir] || []);
            if (!list.some((e) => e.name === parts[i - 1])) list.push({ name: parts[i - 1], dir: i < parts.length });
        }
    }
}

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES });
try {
    await page.goto();
    await page.eval(`window.__fsTree = ${JSON.stringify(APPROVED)}`);

    console.log("\n1. Localise landing, side by side (760px)");
    check(await openLocalise(page), "the landing renders and the Library card loads its territories");
    check((await page.eval(text(".specs-camp-text strong"))) === "Street Fighter", "the campaign card names the campaign", await page.eval(text(".specs-camp-text strong")));
    const camp = await page.eval(rect(".specs-camp")), lib = await page.eval(rect(".ls-libcard"));
    check(camp && lib && lib.left > camp.right - 1 && Math.abs(lib.top - camp.top) < 2, "campaign and Library sit side by side", { camp, lib });
    const rows = await page.eval(`[...document.querySelectorAll(".ls-libcard-row")].map(b => ({ here: b.classList.contains("is-here"), t: b.innerText.replace(/\\s+/g, " ").trim() }))`);
    check(rows.length === 8, "eight territory rows", rows.length);
    check(rows[0] && rows[0].here && rows[0].t.indexOf("Czechia") !== -1, "the open project's territory is pinned first and lit", rows[0]);
    check(rows[1] && rows[1].t.indexOf("Slovenia") !== -1, "then the best-stocked (Slovenia, 42)", rows[1]);
    check((await page.eval(text(".ls-libcard-more"))) === "+6 more", "the rest are counted, not listed", await page.eval(text(".ls-libcard-more")));
    check((await page.eval(text(".ls-libcard-line"))).indexOf("310 components across 14 of 19") === 0, "the card says what is behind it", await page.eval(text(".ls-libcard-line")));
    const openBg = await page.eval(`getComputedStyle(document.querySelector(".ls-libcard-open")).backgroundColor`);
    check(openBg === "rgb(230, 244, 247)", "the Open button is the one light button (not repainted by .form-tool button)", openBg);
    check((await page.eval(count(".ls-tool-group"))) === 3 && (await page.eval(count(".ls-tool-group .ls-grid-item"))) === 13, "tools: three groups, thirteen tools (the Tracker is a pane, not a card)");
    check(!(await page.eval(`!!document.querySelector(".specs-camp-banner") && getComputedStyle(document.querySelector(".specs-camp-banner")).display !== "none"`)), "no banner pinned: no empty banner block");
    check(await page.waitFor(`/Czechia/.test(document.querySelector(".ls-page-heading .ls-page-title")?.innerText || "")`, 4000), "the header says where you are", await page.eval(text(".ls-page-heading")));
    check((await page.eval(text(".ls-page-batch"))) === "· Batch_01", "…including the open project's batch", await page.eval(text(".ls-page-batch")));
    check((await page.eval(text(".ls-page-kicker"))) === "Localise · Street Fighter", "…under a quiet Localise · campaign line");
    check(!(await page.eval(`!!document.querySelector(".ls-head-wash")`)), "no banner pinned: no wash");
    check((await page.eval(count(".ls-libcard-icon .file-badge"))) === 3, "the card's icon is the fanned PSD/AI/AEP badges");
    const fanned = await page.eval(`[...document.querySelectorAll(".ls-libcard-file")].map(e => getComputedStyle(e).position)`);
    check(fanned.every((p) => p === "absolute"), "…stacked, not laid out in a row", fanned);
    await page.shot(path.join(SHOTS, "ui-localise-wide.png"));

    // No text may run off a button in the campaign card, at the widths where
    // its column is narrowest: just above the side-by-side cut-off, and stacked.
    const overflowAt = async (w) => {
        await page.resize(w, 1100);
        return page.eval(`[...document.querySelectorAll(".specs-camp button, .specs-camp .specs-route *")].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== "none").map(e => e.className || e.tagName)`);
    };
    for (const w of [760, 640, 500]) {
        const over = await overflowAt(w);
        check(over.length === 0, `no text overflows the campaign card's buttons at ${w}px`, over);
        const cut = await page.eval(`[...document.querySelectorAll(".ls-libcard-name")].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.innerText)`);
        check(cut.length === 0, `no territory name is cut short in the Library card at ${w}px`, cut);
    }
    check((await page.eval(`[...document.querySelectorAll(".specs-camp .specs-route-s")].every(e => getComputedStyle(e).display === "none")`)), "route subtitles are hidden inside the card");
    await page.resize(760, 1100);

    console.log("\n1a. Setup form: Edit, Manage, Done");
    const libBefore = await page.eval(rect(".ls-libcard"));
    await page.click(".specs-camp .specs-ready-edit");
    check(await page.waitFor(`document.querySelector(".specs-setup-root")`, 3000), "Edit opens the setup form");
    const libDuring = await page.eval(rect(".ls-libcard"));
    check(await page.eval(`!!document.querySelector(".specs-hub .specs-camp.is-editing .specs-setup-root") && !document.querySelector(".specs-hub-solo")`)
        && Math.abs(libBefore.left - libDuring.left) < 2 && Math.abs(libBefore.top - libDuring.top) < 2,
        "…IN PLACE of the campaign card: the Library doesn't move", { libBefore, libDuring });
    await page.shot(path.join(SHOTS, "ui-edit-in-place.png"));
    check((await page.eval(count(".specs-run-row .checkbox-toggle, .specs-run-row input[type=checkbox], .specs-options"))) === 0, "no option checkboxes in Setup");
    check((await page.eval(count(".specs-setup-root .specs-campaign-btn"))) === 0, "no row of icon buttons beside the picker");
    await page.click(".specs-manage-btn");
    check(await page.waitFor(`document.querySelectorAll(".specs-manage-menu button").length >= 4`, 3000), "Manage opens a labelled menu");
    const items = await page.eval(`[...document.querySelectorAll(".specs-manage-menu strong")].map(e => e.innerText)`);
    check(["Add a campaign…", "Share with the team", "Retire for the team", "Remove from this machine"].every((t) => items.indexOf(t) !== -1), "…add, share, retire, remove", items);
    await page.shot(path.join(SHOTS, "ui-setup-manage.png"));
    await page.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await pause(300);
    await page.click(".specs-run-row .specs-ready-done");
    check(await page.waitFor(`document.querySelector(".specs-camp") && !document.querySelector(".specs-setup-root")`, 3000), "Done, beside Scan, goes back to the campaign card");

    console.log("\n1b. The scan list can be put away");
    await page.click(".specs-camp-scan");
    check(await page.waitFor(`document.querySelectorAll(".specs-results .specs-list > *").length > 0`, 6000), "Scan territories lists the territories");
    if (process.env.UI_DEBUG) console.log(await page.eval(`JSON.stringify({ results: !!document.querySelector(".specs-results"), collapsed: !!document.querySelector(".specs-results-collapsed"), notice: (document.querySelector(".specs-tool .loc-status, .specs-tool .notice, .specs-notice")?.innerText || ""), progress: (document.querySelector(".specs-progress")?.innerText || ""), html: (document.querySelector(".specs-results")?.outerHTML || "").slice(0, 400) })`));
    const terr = await page.eval(`[...document.querySelectorAll(".specs-terr")].map(e => ({ here: e.classList.contains("is-here"), t: e.innerText.replace(/\\s+/g, " ").trim() }))`);
    check(terr[0] && terr[0].here && /Czechia/.test(terr[0].t) && /open project/.test(terr[0].t), "the open project's territory is pinned first", terr[0]);
    check(!terr.some((r) => /open to read/.test(r.t)), "no 'open to read' pill on every row");
    check(terr.some((r) => r.t.indexOf("South Africa") !== -1), "folder underscores read as spaces");
    check((await page.eval(`getComputedStyle(document.querySelectorAll(".specs-terr-reveal")[1]).opacity`)) === "0", "the folder button waits for hover");
    check(!(await page.eval(`/Open one to read its specs/.test(document.querySelector(".specs-tool").innerText)`)), "no line repeating the list's length");
    check(await page.eval(`document.querySelector(".specs-camp-scan").classList.contains("is-secondary") && /Re-scan/.test(document.querySelector(".specs-camp-scan").innerText)`), "Re-scan steps down to a secondary button");
    await page.shot(path.join(SHOTS, "ui-scan-list.png"));
    await page.click(".specs-results-hide");
    check(await page.waitFor(`!document.querySelector(".specs-results") && document.querySelector(".specs-results-collapsed")`, 3000), "Hide closes it to one line");
    check(/19 territories scanned/.test(await page.eval(text(".specs-results-collapsed"))), "…that says what is behind it", await page.eval(text(".specs-results-collapsed")));
    await page.shot(path.join(SHOTS, "ui-scan-hidden.png"));
    await page.click(".specs-results-collapsed");
    check(await page.waitFor(`document.querySelector(".specs-results")`, 3000), "Show brings it back without re-scanning", (await page.eval(`window.__calls.filter(c => c.fn === "scanTerritories").length`)) + " scanTerritories calls");
    await page.click(".specs-results-hide");
    await page.click(".specs-camp-scan");
    check(await page.waitFor(`document.querySelector(".specs-results")`, 6000), "a new scan opens it again");

    console.log("\n2. A territory row opens the Library straight into it");
    check(await page.click(".ls-libcard-row", "Slovenia"), "pressed Slovenia");
    check(await page.waitFor(`document.querySelector(".ll-comp-title")`, 8000), "the Library opened inside a territory");
    check((await page.eval(text(".ll-comp-title"))).indexOf("Slovenia") === 0, "…and it is Slovenia", await page.eval(text(".ll-comp-title")));
    check((await page.eval(`document.querySelector(".ll-campaign-select")?.innerText || ""`)).indexOf("Street Fighter") !== -1, "…on the campaign the card named");
    check((await page.eval(text(".ll-hero-title"))) === "Street Fighter", "the Library leads with the campaign, as Localise does");
    check(/310 components · 14 of 19 territories/.test(await page.eval(text(".ll-hero-stats"))), "…with what it holds", await page.eval(text(".ll-hero-stats")));
    check(!(await page.eval(`!!document.querySelector(".ls-tool-header")`)), "…and not under the shared tool strip");
    check(await page.eval(`!!document.querySelector(".ll-hero .ll-hero-icon")`), "…while keeping its own tutorial icon");
    check(await page.eval(`!!document.querySelector(".ll-comp-head .ll-make-motion")`), "Make the Motion sits in the territory's heading");
    check(/Find the Slovenia Motion/.test(await page.eval(text(".ll-hero-find"))), "Find the Motion names the territory", await page.eval(text(".ll-hero-find")));
    await page.click(".ll-manage-btn");
    const llItems = await page.eval(`[...document.querySelectorAll(".ll-manage-menu strong")].map(e => e.innerText)`);
    check(llItems.indexOf("Add a campaign…") !== -1 && llItems.indexOf("Remove from this machine") !== -1, "the Library's Manage menu: add, remove", llItems);
    await page.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await page.shot(path.join(SHOTS, "ui-library-territory.png"));

    console.log("\n2a. Search inside a territory");
    const typeIn = (v) => page.eval(`(() => { const i = document.querySelector(".ll-lib-search input"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check(await page.eval(`!!document.querySelector(".ll-lib-search input")`), "the territory has a search box");
    await typeIn("post");
    await pause(200);
    check(/^9 files match/.test(await page.eval(text(".ll-search-summary"))), "'post' finds every POST file in Slovenia, across its folders", await page.eval(text(".ll-search-summary")));
    check((await page.eval(`document.querySelectorAll(".ll-search-results .ll-comp-row").length`)) === 9 && !(await page.eval(`!!document.querySelector(".ll-creative-list, .ll-folders-scroll > .ll-folder-list")`)), "…shown as results in place of the tree");
    check((await page.eval(`getComputedStyle(document.querySelector(".ll-jpgpng-section")).display`)) === "none", "…with the live JPG_PNG browse out of the way");
    await typeIn("post 1");
    await pause(200);
    check(/^2 files match/.test(await page.eval(text(".ll-search-summary"))), "words are ANDed: 'post 1' narrows it", await page.eval(text(".ll-search-summary")));
    await page.click(".ll-search-selectall");
    await pause(100);
    check((await page.eval(`document.querySelectorAll(".ll-search-results .ll-comp-row.selected").length`)) === 2, "Select all selects the matches, for a batch import");
    const ends = await page.eval(`[...document.querySelectorAll(".ll-search-results .ll-comp-row")].map(r => { const btns = r.querySelectorAll(".ll-row-btn"); return Math.round(r.getBoundingClientRect().right - btns[btns.length - 1].getBoundingClientRect().right); })`);
    check(ends.every((d) => d >= 0 && d < 20), "each row's buttons sit at its end, not after the name", ends);
    await page.shot(path.join(SHOTS, "ui-library-search.png"));
    await page.click(".ll-search-selectall");
    await page.eval(`document.querySelector(".ll-lib-search input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await pause(200);
    check(!(await page.eval(`!!document.querySelector(".ll-search-results")`)) && (await page.eval(`document.querySelector(".ll-lib-search input").value`)) === "", "Escape clears it and the tree comes back");

    console.log("\n2b. Dialogs speak the panel's language");
    await page.click(".ll-hero-find");
    check(await page.waitFor(`document.querySelector(".dialog-card")`, 3000), "Find the Motion asks first");
    check((await page.eval(text(".dialog-title"))) === "Find the Slovenia motion?", "…with a title that is the question", await page.eval(text(".dialog-title")));
    check((await page.eval(text(".dialog-btn-primary"))) === "Find", "…and a button named for what it does", await page.eval(text(".dialog-btn-primary")));
    check((await page.eval(text(".dialog-message"))).length < 160, "…and a body that stays short", (await page.eval(text(".dialog-message"))).length + " chars");
    check((await page.eval(`getComputedStyle(document.querySelector(".dialog-card"), "::before").content`)) === "none", "no gradient strip across the top");
    const dlgBg = await page.eval(`getComputedStyle(document.querySelector(".dialog-btn-primary")).backgroundImage`);
    check(/28, 122, 118/.test(dlgBg), "…in the colour of where it was opened (Localise teal)", dlgBg.slice(0, 50));
    await pause(500);
    await page.shot(path.join(SHOTS, "ui-dialog.png"));
    await page.click(".dialog-btn-secondary");
    check(await page.waitFor(`!document.querySelector(".dialog-card")`, 2000), "Cancel closes it, nothing run");
    await page.click(".ll-manage-btn");
    await page.click(".ll-manage-menu button", "Remove from this machine");
    check(await page.waitFor(`document.querySelector(".dialog-card.is-danger")`, 3000), "a destructive dialog is marked as one");
    const dangerBg = await page.eval(`getComputedStyle(document.querySelector(".dialog-btn-primary")).backgroundImage`);
    check(/194, 65, 65/.test(dangerBg), "…with a red primary button", dangerBg.slice(0, 50));
    check((await page.eval(`document.activeElement && document.activeElement.classList.contains("dialog-btn-primary")`)) === false, "…and focus never starts on it");
    await pause(500);
    await page.shot(path.join(SHOTS, "ui-dialog-danger.png"));
    await page.click(".dialog-btn-secondary");
    await page.waitFor(`!document.querySelector(".dialog-card")`, 2000);

    console.log("\n2c. Global Components");
    await page.click(".ll-back", "All territories");
    check(await page.waitFor(`document.querySelector(".ll-global")`, 4000), "the campaign's Global Components sit above the territories");
    check(!(await page.eval(`!!document.querySelector(".ll-search input")`)), "no territory search box: the list is short enough to read");
    check(!(await page.eval(`!!document.querySelector(".ll-global-note, .ll-global-list")`)), "Global components start folded, so the territories lead");
    await page.click(".ll-global-toggle");
    check(/Files and folders for the whole campaign/.test(await page.eval(text(".ll-global-note"))), "opened while empty, it says what it is for");
    await page.click(".ll-global-toggle");
    check(!(await page.eval(`!!document.querySelector(".ll-global-note")`)), "…and folds again");
    check(await page.eval(`document.querySelectorAll(".ll-global-add").length === 1 && !/Add files/.test(document.querySelector(".ll-global").innerText)`), "one quiet Add, not two buttons always on show");
    await page.click(".ll-global-add");
    await page.click(".ll-manage-menu button", "Files");
    check(await page.waitFor(`document.querySelectorAll(".ll-global-row.is-file").length === 2`, 4000), "Add ▸ Files… adds several at once");
    check(await page.waitFor(`/Added 2 to Global Components/.test(document.body.innerText)`, 3000), "…and says so");
    check(await page.eval(`document.querySelector(".ll-global-toggle").getAttribute("aria-expanded") === "true"`), "an add unfolds the section so you see what landed");
    await page.click(".ll-global-add");
    await page.click(".ll-manage-menu button", "A folder");
    check(await page.waitFor(`document.querySelector(".ll-global-row.is-folder")`, 4000), "Add folder… adds a folder");
    const aligned = await page.eval(`(() => { const rows = [...document.querySelectorAll(".ll-global-list > .ll-global-row")]; const ends = rows.map(r => Math.round([...r.querySelectorAll(".ll-row-btn")].pop().getBoundingClientRect().right)); return ends.every(e => Math.abs(e - ends[0]) <= 1); })()`);
    check(aligned, "every row's buttons line up at the end");
    check((await page.eval(`[...document.querySelectorAll(".ll-global-list > .ll-global-row")].map(r => r.classList.contains("is-folder"))`))[0] === true, "folders list first");
    await page.click(".ll-global-open", "Logo_Pack");
    check(await page.waitFor(`document.querySelectorAll(".ll-global-row.is-sub").length === 3`, 4000), "a folder opens in place, listing what's in it", await page.eval(`document.querySelectorAll(".ll-global-row.is-sub").length`));
    await page.click("button.ll-global-row.is-sub", "Variants");
    check(await page.waitFor(`[...document.querySelectorAll(".ll-global-row.is-sub")].some(r => /SF_Logo_Mono/.test(r.textContent))`, 4000), "and sub-folders open the same way");
    const published = await page.eval(`window.__calls.filter(c => c.fn === "teamLocLibPublish").map(c => c.args[1])`);
    check(published.includes("/Volumes/paramount/SF/Brand/Logo_Pack"), "each add is published to the team, clearing any old removal", published.filter(Boolean));
    await page.shot(path.join(SHOTS, "ui-global.png"));
    await page.eval(`(() => { const row = [...document.querySelectorAll(".ll-global-list > .ll-global-row.is-file")].find(r => /SF_Font/.test(r.textContent)); row.querySelectorAll(".ll-row-btn")[2].click(); })()`);
    await page.waitFor(`document.querySelector(".dialog-card")`, 2000);
    await page.click(".dialog-btn-primary");
    check(await page.waitFor(`document.querySelectorAll(".ll-global-row.is-file:not(.is-sub)").length === 1`, 4000), "removing takes it out");
    const removedCalls = await page.eval(`window.__calls.filter(c => c.fn === "teamLocLibRemove").map(c => c.args[1])`);
    check(removedCalls.includes("/Volumes/paramount/SF/Brand/SF_Font.otf"), "…for the team too, so it doesn't come back", removedCalls);

    console.log("\n3. Open the Library: the compact list");
    await page.click(".back-button");
    check(await page.waitFor(`document.querySelector(".ls-libcard-open")`, 6000), "back on the landing");
    await page.click(".ls-libcard-open");
    check(await page.waitFor(`document.querySelectorAll(".ll-terr-row").length > 0`, 8000), "the Library opened on its territory list");
    const list = await page.eval(`[...document.querySelectorAll(".ll-terr-row")].map(b => ({ here: b.classList.contains("is-here"), t: b.innerText.replace(/\\s+/g, " ").trim() }))`);
    check(list[0] && list[0].here && list[0].t.indexOf("Czechia") !== -1, "the open project's territory is pinned first and lit", list[0]);
    check(list.length === 14, "only territories with components are rows", list.length);
    check(!(await page.eval(`!!document.querySelector(".ll-terr-list .ll-suggestion")`)), "no separate 'You may be in' banner");
    const empty = await page.eval(text(".ll-terr-empty-line"));
    check(["Colombia", "Denmark", "Greece", "Latvia", "Poland"].every((t) => empty.indexOf(t) !== -1), "empty territories fold into one line", empty);
    check(list.some((r) => r.t.indexOf("South Africa") !== -1), "folder underscores read as spaces");
    check(list.some((r) => /\uD83C[\uDDE6-\uDDFF]/.test(r.t)), "rows carry flags");
    await page.shot(path.join(SHOTS, "ui-library-list.png"));
    await page.click(".ll-terr-empty", "Latvia");
    check(await page.waitFor(`(document.querySelector(".ll-comp-title")?.innerText || "").indexOf("Latvia") === 0`, 6000), "an empty territory is still one press away");

    console.log("\n4. Build a Batch, Trott & Batch, Bespoke It");
    await page.click(".back-button");
    await page.waitFor(`document.querySelector(".specs-camp")`, 6000);
    await page.click(".specs-camp .specs-route", "Build a Batch");
    check(await page.waitFor(`document.querySelector(".specs-build-body")`, 4000), "Build a Batch opens the builder");
    await page.click(".ls-pane-tab", "Trott");
    check(await page.waitFor(`document.querySelector(".ls-libcard-solo .ls-libcard") && document.querySelector(".campaign-localiser")`, 4000), "Trott & Batch: the Library leads the pane on its own");
    await page.click(".ls-pane-tab", "Big Guy");
    await page.waitFor(`document.querySelector(".specs-camp")`, 4000);
    await page.click(".specs-camp .specs-route", "Bespoke It");
    check(await page.waitFor(`/Bespok/.test(document.querySelector(".tool-content-header, .ls-tool-header")?.innerText || "")`, 6000), "Bespoke It opens Bespoke", await page.eval(text(".tool-content-header, .ls-tool-header")));

    console.log("\n5. Narrow dock (500px): stacked");
    await page.click(".back-button");
    await page.waitFor(`document.querySelector(".specs-camp")`, 6000);
    await page.resize(500, 1100);
    const camp2 = await page.eval(rect(".specs-camp")), lib2 = await page.eval(rect(".ls-libcard"));
    check(camp2 && lib2 && lib2.top >= camp2.bottom, "the Library stacks under the campaign", { camp2, lib2 });
    const pill = await page.eval(`getComputedStyle(document.querySelectorAll(".ls-libcard-row")[1]).borderRadius`);
    check(pill === "999px", "territory rows become pills", pill);
    const overflow = await page.eval(`document.querySelector(".ls-landing").scrollWidth - document.querySelector(".ls-landing").clientWidth`);
    check(overflow <= 0, "no sideways scroll", overflow);
    await page.shot(path.join(SHOTS, "ui-localise-narrow.png"));
    await page.resize(760, 1100);

    console.log("\n6. Active Jobs -> Localise handoff");
    await page.click(".home-button");
    check(await page.waitFor(`document.querySelector(".active-jobs-toggle")`, 6000), "home");
    await page.click(".active-jobs-toggle");
    check(await page.waitFor(`document.querySelectorAll(".active-jobs-row").length > 0`, 6000), "jobs listed (the panel's sample jobs; the feed is blocked)");
    await page.click(".active-jobs-row", "DINTH");
    const send = await page.waitFor(`[...document.querySelectorAll(".ajm-btn--primary")].some(b => /Send \\d+ rows? to Localise/.test(b.textContent) && !b.disabled)`, 6000);
    const sendLabel = await page.eval(text(".ajm-btn--primary"));
    if (process.env.UI_DEBUG) console.log(await page.eval(`JSON.stringify({ modal: (document.querySelector(".ajm-btn--primary")?.closest("[class*=ajm]")?.parentElement?.innerText || "").slice(0, 600), calls: window.__calls.filter(c => c.fn === "parseDeliverableNames") })`));
    check(send, "the job modal offers to send its rows", sendLabel);
    const n = Number((sendLabel.match(/Send (\d+)/) || [])[1] || 0);
    await page.click(".ajm-btn--primary", "Send");
    check(await page.waitFor(`document.querySelector(".specs-handoff")`, 8000), "Localise opens with the handoff notice");
    check((await page.eval(text(".specs-handoff"))).indexOf("TW") !== -1, "…naming the job", await page.eval(text(".specs-handoff")));
    check(await page.eval(`!!document.querySelector(".specs-build-body")`), "…with Build a Batch open");
    // The header is a .specs-build-row too; the data rows are the rest.
    const built = await page.eval(`document.querySelectorAll(".specs-build-rows .specs-build-row:not(.specs-build-row--head)").length`);
    check(built === n && n > 0, "…holding exactly the job's rows", { rows: built, sent: n });
    check(await page.waitFor(`document.querySelector(".specs-camp") && document.querySelector(".ls-libcard-row")`, 8000), "…under the same campaign card and Library");
    const buildBtns = await page.eval(`[...document.querySelectorAll(".specs-build-actions button")].map(b => b.innerText.replace(/\\s+/g, " ").trim())`);
    // MC It! and Support Swap always run during the localise now: no switch,
    // and no redo button either (that is on the batch row's menu).
    check(!buildBtns.some((t) => /MC It!|Support Swap|inline/i.test(t)) && buildBtns.some((t) => /^Localise/.test(t)), "the run bar has no MC It! or Support Swap switch, only Localise", buildBtns);
    check(await page.eval(`document.querySelectorAll(".specs-build-actions input[type=checkbox], .specs-build-actions .checkbox-toggle").length`) === 0, "…and no checkbox at all");

    console.log("\n6a. Seen before");
    check(await page.waitFor(`document.querySelectorAll(".specs-build-seen").length === 2`, 6000), "two rows' creative has been approved at or near their ratio; the third row has no hint", await page.eval(`document.querySelectorAll(".specs-build-seen").length`));
    const pills = await page.eval(`[...document.querySelectorAll(".specs-build-seen")].map(e => e.innerText.trim() + (e.classList.contains("specs-build-seen--near") ? " near" : ""))`);
    check(pills[0] === "3", "…counting the exact size, the same ratio and one within 10%, but not the 20s", pills);
    check(pills[1] === "1 near", "a row with nothing at its ratio but one close to it gets a quieter hint", pills);
    await page.click(".specs-build-seen");
    check(await page.waitFor(`document.querySelector(".szf-window .szf-card")`, 6000), "pressing it opens Size Finder in a window over the builder");
    check((await page.eval(`document.querySelector(".szf-window .szf-size input").value`)) === "768x1280", "…on that row's size", await page.eval(`document.querySelector(".szf-window .szf-size input").value`));
    check(await page.eval(`document.querySelectorAll(".szf-window .szf-card").length`) === 4 && /Trio/.test(await page.eval(text(".szf-window .szf-chip.is-on"))), "…and its creative: Trio's, not Characters'", await page.eval(text(".szf-window .szf-creatives")));
    check(!/Arcade|20s/.test(await page.eval(`[...document.querySelectorAll(".szf-window .szf-card")].map(e => e.innerText).join("|")`)) && /1 at lengths a 30s row can't be built from left out/.test(await page.eval(text(".szf-window .szf-sum"))), "a length the row can't be built from is left out, and counted", await page.eval(text(".szf-window .szf-sum")));
    await page.click(".szf-window-close");
    check(await page.waitFor(`!document.querySelector(".szf-window")`, 3000), "closing it");
    check((await page.eval(`document.querySelectorAll(".specs-build-rows .specs-build-row:not(.specs-build-row--head)").length`)) === n, "…leaves the batch being edited exactly as it was");

    console.log("\n6a2. Use as this row's master");
    const useBtn = ".szf-window .szf-use-btn";
    const pinned = () => page.eval(`document.querySelectorAll(".specs-master--pinned").length`);
    const hints = () => page.eval(`[...document.querySelectorAll(".hint")].map(e => e.innerText).join(" | ")`);
    const backToAuto = async () => {
        await page.click(".specs-master--pinned");
        await page.waitFor(`document.querySelector(".mpick")`, 4000);
        await page.click(".mpick-option--auto");
        return page.waitFor(`!document.querySelector(".mpick") && !document.querySelector(".specs-master--pinned")`, 4000);
    };
    await page.click(".specs-build-seen");
    check(await page.waitFor(`document.querySelector(${JSON.stringify(useBtn)})`, 6000), "the window leads with a bar offering to build the row from what is on screen");
    // The closest is the 10s Cinema: a third of the 30s row.
    check(/×3/.test(await page.eval(text(useBtn))) && /10s, played 3× to fill 30s/.test(await page.eval(text(".szf-window .szf-use"))), "a third of the row's length is offered played three times", await page.eval(text(".szf-window .szf-use")));
    await page.click(".szf-window .szf-card", "800×1280");
    check(await page.waitFor(`/Totem_800/.test(document.querySelector(".szf-window .szf-detail-head")?.innerText || "")`, 4000) && /×2/.test(await page.eval(text(useBtn))), "half of it, twice", await page.eval(text(useBtn)));
    await page.click(useBtn);
    check(await page.waitFor(`!document.querySelector(".szf-window")`, 6000) && (await pinned()) === 1, "pressing it closes the window and pins that row, and only that row");
    check(/built from Italy's SF_INTL_Trio_DOOH_Totem_800x1280px_15s_IT_V02, played 2× to fill the row: its IT artwork is swapped/.test(await hints()), "…from its newest project, saying it is played twice and whose artwork gets swapped", await hints());
    check(await backToAuto(), "the picker takes it back to automatic");
    await page.click(".specs-build-seen");
    await page.waitFor(`document.querySelector(".szf-window .szf-card")`, 6000);
    await page.click(".szf-window .szf-card", "1536×2560");
    check(await page.waitFor(`/Wall_1536/.test(document.querySelector(".szf-window .szf-detail-head")?.innerText || "")`, 4000) && !/×/.test(await page.eval(text(useBtn))), "the row's own length is offered as it is");
    await page.shot(path.join(SHOTS, "ui-use-as-master.png"));
    await page.click(useBtn);
    check(await page.waitFor(`!document.querySelector(".szf-window")`, 6000) && /Wall_1536x2560px_30s_IT_V02: its IT artwork/.test(await hints()), "…and pins with no repeat", await hints());
    check((await page.eval(`document.querySelectorAll(".specs-build-rows .specs-build-row:not(.specs-build-row--head)").length`)) === n, "…with the batch otherwise as it was");
    check(await backToAuto(), "and back to automatic, so the hand-pick below starts clean");

    console.log("\n6a3. The row's sheet against the approved one's");
    await page.click(".specs-build-seen");
    check(await page.waitFor(`/nothing to compare with/.test(document.querySelector(".szf-window .szf-cmp-note")?.innerText || "")`, 6000), "no territory picked, so no sheet of the row's: said, with the approved sheet as before", await page.eval(text(".szf-window .szf-cmp-note")));
    await page.click(".szf-window-close");
    await page.click(".specs-build-meta .dropdown-trigger");
    await page.waitFor(`document.querySelector(".dropdown-option")`, 3000);
    await page.click(".dropdown-option", "Denmark");
    await page.click(".specs-build-seen");
    check(await page.waitFor(`document.querySelector(".szf-window .szf-cmp-wipe .szf-cmp-divider")`, 6000), "with the row's JPG_PNG folder found: its sheet wiped over the approved one's");
    check(!(await page.eval(`!!document.querySelector(".szf-window .szf-cmp .segmented-toggle")`)), "…and nothing above it: no mode switch");
    const legend = await page.eval(text(".szf-window .szf-cmp-legend"));
    check(/This row · Denmark/.test(legend) && /Italy · approved/.test(legend), "…saying which side is whose", legend);
    const tops = await page.eval(`({ clip: document.querySelector(".szf-window .szf-pane video").getBoundingClientRect().top, wipe: document.querySelector(".szf-window .szf-cmp-wipe").getBoundingClientRect().top })`);
    check(Math.abs(tops.clip - tops.wipe) < 2, "the wipe starts level with the clip beside it", tops);
    const shape = await page.eval(`(() => { const r = document.querySelector(".szf-window .szf-cmp-wipe").getBoundingClientRect(); return r.height / r.width; })()`);
    check(Math.abs(shape - 1.25) < 0.02, "…in the row's own shape, capped for a tall one", shape);
    const before = await page.eval(`document.querySelector(".szf-window .szf-cmp-divider").style.left`);
    await page.eval(`(() => { const el = document.querySelector(".szf-window .szf-cmp-wipe"); const r = el.getBoundingClientRect(); const at = (x) => ({ bubbles: true, clientX: r.left + r.width * x, clientY: r.top + 10 }); el.dispatchEvent(new MouseEvent("mousedown", at(0.5))); window.dispatchEvent(new MouseEvent("mousemove", at(0.2))); window.dispatchEvent(new MouseEvent("mouseup", at(0.2))); })()`);
    await pause(150);
    const after = await page.eval(`document.querySelector(".szf-window .szf-cmp-divider").style.left`);
    check(before === "50%" && Math.abs(parseFloat(after) - 20) < 1.5, "the divider follows a drag (mouse events)", { before, after });
    const cpager = () => page.eval(text(".szf-window .szf-cmp .szf-pager"));
    check(/1 of 3/.test(await cpager()) && /30s_DK\.jpg/.test(await cpager()), "it pages through every picture, opening on the sheets", await cpager());
    await page.click(".szf-window .szf-cmp .szf-pager button[aria-label='Next picture']");
    check(/2 of 3/.test(await cpager()) && /DK1\.png/.test(await cpager()), "next is slot 1 of each", await cpager());
    check(Math.abs(parseFloat(await page.eval(`document.querySelector(".szf-window .szf-cmp-divider").style.left`)) - 20) < 1.5, "…with the divider left where it was put");
    await page.click(".szf-window .szf-cmp .szf-pager button[aria-label='Next picture']");
    check(/3 of 3/.test(await cpager()) && /Italy has no picture 3/.test(await page.eval(text(".szf-window .szf-cmp-wipe"))), "a picture only one side has says so on the other", await page.eval(text(".szf-window .szf-cmp-wipe")));
    await page.click(".szf-window .szf-cmp .szf-pager button[aria-label='Next picture']");
    check(/1 of 3/.test(await cpager()), "and round to the sheets again");
    await page.shot(path.join(SHOTS, "ui-compare-wipe.png"));
    await page.click(".szf-window-close");

    console.log("\n6a4. A POST row's PRE version");
    const setSite = (n, v) => page.eval(`(() => { const i = document.querySelectorAll("input[aria-label='Media site name (optional)']")[${n}]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check(!(await page.eval(`!!document.querySelector(".specs-pre")`)), "no POST row: nothing is offered");
    await setSite(2, "InTheatreFoyerScreenPOST");
    check(await page.waitFor(`/1 POST row has a PRE version in Batch_1/.test((document.querySelector(".specs-pre") || {}).innerText || "")`, 5000), "a POST row whose PRE project is in the territory's AE folder is offered it", await page.eval(text(".specs-pre")));
    await page.click(".specs-pre-btn");
    check(await page.waitFor(`!document.querySelector(".specs-pre") && document.querySelectorAll(".specs-master--pinned").length === 1`, 4000), "one press pins the row to it, and the offer goes");
    check(/1 POST row will be built from its PRE version/.test(await page.eval(`[...document.querySelectorAll(".hint")].map(e => e.innerText).join(" | ")`)), "…saying what will be swapped");
    await setSite(2, "InTheatreFoyerScreen");
    check(await page.waitFor(`!document.querySelector(".specs-master--pinned") && !document.querySelector(".specs-pre")`, 4000), "taking the POST off the row drops the pin: it was that row's answer, not this one's");

    console.log("\n6b. Hand-picking a master");
    check(await page.waitFor(`document.querySelector(".specs-master--none")`, 6000), "an unmatched row offers to pick a master");
    await page.click(".specs-master--none");
    check(await page.waitFor(`document.querySelector(".mpick")`, 4000), "the picker opens even with nothing at this size and length");
    check(/No master at/.test(await page.eval(text(".mpick-empty"))) || (await page.eval(count(".mpick-option--elsewhere"))) > 0, "…and says what it looked for, or offers other lengths");
    const sideways = await page.eval(`(() => { const l = document.querySelector(".mpick-list"); return l.scrollWidth - l.clientWidth; })()`);
    check(sideways <= 0, "the picker never scrolls sideways", sideways);
    await page.click(".mpick-foot-btn", "Look in another folder");
    check(await page.waitFor(`/Other_Masters\\/AE/.test(document.querySelector(".mpick-sub")?.innerText || "")`, 4000), "Look in another folder lists that folder's masters", await page.eval(text(".mpick-sub")));
    await page.click(".mpick-option", "Showtime");
    check(await page.waitFor(`!document.querySelector(".mpick") && document.querySelector(".specs-master--pinned")`, 4000), "picking one pins it to the row");
    await page.click(".specs-master--pinned");
    await page.waitFor(`document.querySelector(".mpick")`, 4000);
    await page.click(".mpick-foot-btn", "Pick a file");
    check(await page.waitFor(`!document.querySelector(".mpick")`, 4000), "Pick a file… closes the picker");
    check((await page.eval(`window.__calls.filter(c => c.fn === "csvLocaliserPickMasterFile" || c.fn === "csvLocaliserPickMasterFolder").map(c => c.args[0])`)).every((a) => typeof a === "string" && a.length > 0), "both dialogs start in a folder, not wherever AE was last");
    await page.shot(path.join(SHOTS, "ui-handpick.png"));

    await pause(800);
    await page.shot(path.join(SHOTS, "ui-handoff.png"));
    // TAKE-ONCE: leaving and coming back must not re-prefill the builder with
    // a job already dealt with.
    await page.click(".home-button");
    await page.waitFor(`document.querySelector("button.category-card")`, 6000);
    await openLocalise(page);
    await pause(600);
    check(!(await page.eval(`!!document.querySelector(".specs-handoff")`)), "…and is taken once: coming back does not replay it");

    console.log("\n6c. Swap campaigns from the card");
    await page.click(".home-button");
    await openLocalise(page);
    await page.waitFor(`!!document.querySelector(".specs-camp-switch")`, 6000);
    check(/Street Fighter/.test(await page.eval(text(".specs-camp-switch"))), "the campaign's name on the card is the switcher");
    await page.click(".specs-camp-switch");
    check(await page.waitFor(`document.querySelectorAll(".specs-switch-item").length === 2`, 3000), "…opening the campaigns, with no trip through Edit");
    const items2 = await page.eval(`[...document.querySelectorAll(".specs-switch-item")].map(b => b.querySelector(".specs-switch-name").innerText + (b.classList.contains("is-current") ? " *" : ""))`);
    check(items2.join("|") === "Street Fighter *|Forgotten Island", "…the one you're on marked", items2);
    await page.shot(path.join(SHOTS, "ui-campaign-switch.png"));
    await page.click(".specs-switch-item", "Forgotten Island");
    // Masters come from the disk's sibling folder, which this inert fs can't
    // answer -- so here the setup asks for them; on the share the card swaps.
    check(await page.waitFor(`/XY026040_Markets/.test(document.body.innerText)`, 4000), "picking one switches the campaign at once");

    console.log("\n7. Your jobs, on the Localise page");
    await page.click(".home-button");
    await openLocalise(page);
    check(await page.waitFor(`document.querySelectorAll(".ls-jobs-chip").length > 0`, 6000), "the jobs strip sits under the header");
    const chips = await page.eval(`[...document.querySelectorAll(".ls-jobs-chip")].map(b => b.innerText.replace(/\\s+/g, " ").trim())`);
    check(chips.length === 2 && chips.some((c) => /TW/.test(c)) && chips.some((c) => /IT/.test(c)), "open jobs only (the finished SE job is left out)", chips);
    check(await page.eval(`!!document.querySelector(".ls-jobs-sample")`), "the feed's sample list is marked SAMPLE");
    check(!(await page.eval(`!!document.querySelector(".ls-jobs-label")`)) && !/Your jobs/.test(await page.eval(text(".ls-jobs"))), "no 'Your jobs' label taking a chip's worth of the row");
    await page.shot(path.join(SHOTS, "ui-jobs-strip.png"));
    await page.click(".ls-jobs-chip", "TW");
    check(await page.waitFor(`/Tracker/.test(document.querySelector(".ls-pane-tab.active")?.innerText || "") && !!document.querySelector(".ls-main-surface .bt")?.offsetParent`, 4000), "a job chip opens the Tracker pane (the job window is a press further in)");
    check(!(await page.eval(`!!document.querySelector(".ls-jobs")`)), "…where the tracker's own job chips stand in for the strip");
    check(await page.eval(`getComputedStyle(document.querySelector(".ls-main-surface .bt")).paddingTop === "0px"`), "…and the surface, not the tool, owns the inset");
    await page.click(".home-button");
    await page.waitFor(`[...document.querySelectorAll("button.category-card")].some(b => /Localise/.test(b.textContent))`, 6000);
    await page.click("button.category-card", "Localise");
    check(await page.waitFor(`/Tracker/.test(document.querySelector(".ls-pane-tab.active")?.innerText || "")`, 6000), "the last pane used is where Localise opens next time");
    await page.click(".ls-pane-tab", "Big Guy");
    check(await page.waitFor(`!!document.querySelector(".ls-jobs") && !!document.querySelector(".ls-libcard-row")`, 6000), "back on Big Guy Localiser, the strip returns");

    // PANES STAY ALIVE: switching tabs hides a pane, it does not rebuild it.
    console.log("\n7b. A pane is kept once opened");
    const shown = (sel) => page.eval(`!!document.querySelector(${JSON.stringify(sel)})?.offsetParent`);
    await page.eval(`(() => { const el = document.querySelector(".ls-main-surface .form-tool"); if (el) el.setAttribute("data-kept", "1"); })()`);
    await page.eval(`window.__calls = []`);
    await page.click(".ls-pane-tab", "Tracker");
    check(await page.waitFor(`!!document.querySelector(".ls-main-surface .bt")?.offsetParent`, 4000) && !(await shown(".ls-main-surface .form-tool")), "on the Tracker tab, Big Guy is hidden");
    await page.click(".ls-pane-tab", "Big Guy");
    await pause(600);
    check((await shown(".ls-main-surface .form-tool")) && (await page.eval(`document.querySelector(".ls-main-surface .form-tool")?.getAttribute("data-kept")`)) === "1", "back on Big Guy, it is the SAME page, not a rebuilt one");
    const reread = await page.eval(`window.__calls.map(c => c.fn).filter(f => /^(loadLocLibCampaigns|locLibCampaignStatus|teamCampaignBoard|scanTerritories|loadCampaignBanner)$/.test(f))`);
    check(reread.length === 0, "…and nothing about the campaigns was read again on the way back", reread);
    check(!(await shown(".ls-main-surface .bt")) && !!(await page.eval(`!!document.querySelector(".ls-main-surface .bt")`)), "the Tracker is hidden, and still there");
    check((await page.eval(`getComputedStyle(document.querySelector(".ls-main-surface .form-tool")).paddingTop`)) === "0px", "the surface still owns the inset through the keep-alive wrapper");


    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
    check(page.blocked.every((u) => !/^http:\/\/127\.0\.0\.1/.test(u)), "nothing but the local build was requested", page.blocked.length + " blocked");
} finally {
    await page.close();
}

// 8. A job whose subtask NAMES didn't arrive. The real SF Motion Outdoor ID
// job: five subtasks, the feed resolved one name and sent four blank. They
// can't be rows, and dropping them silently made a job of five read as one.
{
    const FEED = [{
        id: "IEAB1", title: "SF Motion Outdoor ID", assignee: "Antonio", status: "Motion", updated_at: "2026-09-24T10:00:00Z",
        permalink: "https://www.wrike.com/open.htm?id=1", subtask_count: 5, subtasks_done: 0,
        subtasks: [
            { id: "a", name: "SF_INTL_Trio_DOOH_MRTLCD_1080x1920px_15s_ID", status: "Active", customStatusName: "Motion" },
            { id: "b", name: "", status: "", customStatusName: "" },
            { id: "c", name: "", status: "", customStatusName: "" },
            { id: "d", name: "", status: "", customStatusName: "" },
            { id: "e", name: "", status: "", customStatusName: "" },
        ],
    }];
    const p2 = await launch({ root: ROOT, fixturesSrc: FIXTURES, routes: { "/api/panel/jobs": FEED } });
    try {
        console.log("\n8. Subtasks the feed sent without names");
        await p2.goto();
        await openLocalise(p2);
        check(await p2.waitFor(`document.querySelectorAll(".ls-jobs-chip").length === 1`, 6000), "the strip shows the real feed's job", await p2.eval(text(".ls-jobs")));
        check(!(await p2.eval(`!!document.querySelector(".ls-jobs-sample")`)), "…not marked SAMPLE");
        await p2.click(".ls-jobs-chip", "ID");
        check(await p2.waitFor(`/Indonesia/.test(document.querySelector(".bt-title")?.innerText || "") && !!window.__trackerScan`, 6000), "the chip opens the Tracker on that job's batch (no number in the title: Batch 1)");
        const asked = await p2.eval(`window.__trackerScan`);
        check(asked && asked.wrike.length === 1 && /MRTLCD/.test(asked.wrike[0].name), "…with the job's subtasks (a title with no batch number is Batch_01's)", asked);
        await p2.waitFor(`[...document.querySelectorAll(".bt-link")].some(b => /Job details/.test(b.textContent))`, 6000);
        await p2.click(".bt-link", "Job details");
        check(await p2.waitFor(`document.querySelector(".ajm-note--warn")`, 6000), "Job details opens the job window, which says names are missing");
        check(/4 more subtasks/.test(await p2.eval(text(".ajm-note--warn"))), "…how many", await p2.eval(text(".ajm-note--warn")));
        check(await p2.eval(`!!document.querySelector(".ajm-note--warn .ajm-link")`), "…with a way to open the job in Wrike");
        check((await p2.eval(`document.querySelectorAll(".ajm table tbody tr, .ajm-row").length`)) >= 1, "…and still lists the one that did arrive");
        await p2.shot(path.join(SHOTS, "ui-unnamed-subtasks.png"));
        // Opening revalidates with ONE live read (fetchJobsFresh), throttled
        // panel-wide -- never one per surface, and it must not cost names.
        const lives = await p2.eval(`performance.getEntriesByType("resource").filter(e => /refresh=1/.test(e.name)).length`);
        check(lives <= 1, "at most one live Wrike read on open, however many surfaces ask", lives);
        check(/4 more subtasks/.test(await p2.eval(text(".ajm-note--warn"))) && (await p2.eval(`document.querySelectorAll(".ajm table tbody tr, .ajm-row").length`)) >= 1, "…and the name that arrived is still there after it");
        check(p2.errors.length === 0, "no page errors", p2.errors.slice(0, 5));
    } finally {
        await p2.close();
    }
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — the Localise landing, the Library and the Active Jobs handoff all click through.");
process.exit(failures ? 1 : 0);
