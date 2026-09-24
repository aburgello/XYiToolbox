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
  getTerritoryCountryCode: (t) => (${JSON.stringify({
      Argentina: "AR", Austria: "AT", Belgium: "BE", Bulgaria: "BG", Chile: "CL", Colombia: "CO", Croatia: "HR", Cyprus: "CY",
      Czechia: "CZ", Denmark: "DK", Greece: "GR", Hungary: "HU", Indonesia: "ID", Latvia: "LV", Poland: "PL", Slovakia: "SK",
      Slovenia: "SI", South_Africa: "ZA", Sweden: "SE", Italy: "IT", France: "FR",
  })})[t] || null,
  detectCurrentTerritory: (terrs) => terrs.indexOf("Czechia") !== -1 ? "Czechia" : null,
  loadLocLibComponents: () => {
    const counts = ${JSON.stringify({ Argentina: 8, Austria: 18, Belgium: 33, Bulgaria: 15, Chile: 40, Croatia: 29, Cyprus: 18, Czechia: 5, Hungary: 37, Indonesia: 15, Slovakia: 26, Slovenia: 42, South_Africa: 12, Sweden: 12 })};
    const out = [];
    Object.keys(counts).forEach((t) => {
      for (let i = 0; i < counts[t]; i++) {
        const ext = ["aep", "ai", "psd", "png"][i % 4];
        out.push({ campaign: "Street Fighter", territory: t, label: "SF_Trio_" + t + "_" + i, path: "/Volumes/paramount/SF/XY026205_Markets/" + t + "/Support_Motion/SF_Trio_" + i + "." + ext });
      }
    });
    return out;
  },
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

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES });
try {
    await page.goto();

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
    check((await page.eval(count(".ls-tool-group"))) === 3 && (await page.eval(count(".ls-tool-group .ls-grid-item"))) === 12, "tools: three groups, twelve tools");
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
    await page.click(".specs-camp .specs-ready-edit");
    check(await page.waitFor(`document.querySelector(".specs-setup-root")`, 3000), "Edit opens the setup form");
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
    await pause(800);
    await page.shot(path.join(SHOTS, "ui-handoff.png"));
    // TAKE-ONCE: leaving and coming back must not re-prefill the builder with
    // a job already dealt with.
    await page.click(".home-button");
    await page.waitFor(`document.querySelector("button.category-card")`, 6000);
    await openLocalise(page);
    await pause(600);
    check(!(await page.eval(`!!document.querySelector(".specs-handoff")`)), "…and is taken once: coming back does not replay it");

    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
    check(page.blocked.every((u) => !/^http:\/\/127\.0\.0\.1/.test(u)), "nothing but the local build was requested", page.blocked.length + " blocked");
} finally {
    await page.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — the Localise landing, the Library and the Active Jobs handoff all click through.");
process.exit(failures ? 1 : 0);
