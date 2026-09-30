// =============================================================================
// scripts/ui-palette.mjs  (after `yarn build:web`)
// -----------------------------------------------------------------------------
// ⌘K before a word is typed: Recent, then Most used, then Favorites, each
// thing once -- fed by tools opened ANYWHERE, not only from the palette. And
// ⌘K itself: claimed from AE (it is AE's Composition Settings) while the
// panel has focus, and still claimed after a tool that claims its own keys
// lets go of them.
// =============================================================================
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const FIXTURES = `{
  teamGetMachineState: () => ({ owner: "Antonio", tag: "Antonio" }),
  loadHomeLayout: () => [],
  loadStarredToolsetActions: () => [],
  loadFoldedToolsetGroups: () => [],
}`;
let failures = 0;
const check = (ok, msg, extra) => { if (!ok) failures++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, routes: { "api/panel/jobs": [] } });
// React listens for input events: set the value through the native setter.
const typeInto = (sel, text) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const cmdK = () => page.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))`);
const sections = () => page.eval(`[...document.querySelectorAll(".palette-list > *")].map(e => e.classList.contains("palette-section-label") ? "#" + e.textContent.trim() : (e.querySelector(".palette-row-label")?.childNodes[0]?.textContent || "").trim()).filter(Boolean)`);
const claimsK = () => page.eval(`(() => { const all = window.__keyClaims || []; if (!all.length) return null; const last = JSON.parse(all[all.length - 1]); return last.some(k => (k.keyCode === 40 && k.metaKey) || (k.keyCode === 75 && k.ctrlKey)); })()`);
try {
    await page.goto();
    await page.waitFor(`!!document.querySelector("button.category-card")`, 10000);

    console.log("\n1. ⌘K is the panel's while it has focus");
    check(await claimsK(), "the panel claims ⌘K from AE (it is Composition Settings there)", await page.eval(`window.__keyClaims`));

    console.log("\n2. Nothing used yet");
    await cmdK();
    await page.waitFor(`!!document.querySelector(".palette-input-row input")`, 4000);
    check(/The ones you use will\s+gather here/.test(await page.eval(`document.querySelector(".palette-list").innerText`)), "an empty palette says what will appear there");
    await page.eval(`document.querySelector(".palette-overlay").click()`);
    await pause(300);

    console.log("\n3. Opening tools anywhere fills Recent");
    // Opened from the HOME search, not the palette: usage is recorded wherever.
    await cmdK();
    await page.waitFor(`!!document.querySelector(".palette-input-row input")`, 4000);
    await typeInto(".palette-input-row input", "Naming Audit");
    await page.waitFor(`[...document.querySelectorAll(".palette-row")].some(r => /Naming Audit/.test(r.innerText))`, 4000);
    await page.click(".palette-row", "Naming Audit");
    await page.waitFor(`!document.querySelector(".palette-card")`, 4000);
    await pause(400);
    await cmdK();
    await page.waitFor(`!!document.querySelector(".palette-list")`, 4000);
    await pause(200);
    const s1 = await sections();
    check(s1[0] === "#Recent" && s1[1] === "Naming Audit", "the tool just opened is first under Recent", s1);
    await page.eval(`document.querySelector(".palette-overlay").click()`);
    await pause(300);

    console.log("\n4. Recent, Most used, Favorites -- each thing once");
    const now = Date.now();
    await page.eval(`localStorage.setItem("xyi.toolUsage", JSON.stringify({
        "tool:ov-swap":         { n: 14, t: ${now - 86400e3} },
        "tool:check":           { n: 1,  t: ${now - 1000} },
        "tool:artwork-check":   { n: 3,  t: ${now - 2000} },
        "tool:name-audit":      { n: 2,  t: ${now - 3000} },
        "tool:edit-in-context": { n: 1,  t: ${now - 4000} },
        "tool:batch-tracker":   { n: 5,  t: ${now - 5000} },
        "tool:gone-tool":       { n: 9,  t: ${now - 6000} },
    }))`);
    await cmdK();
    await page.waitFor(`!!document.querySelector(".palette-list")`, 4000);
    await pause(200);
    const s2 = await sections();
    const recent = s2.slice(1, s2.indexOf("#Most used"));
    const most = s2.slice(s2.indexOf("#Most used") + 1);
    check(s2[0] === "#Recent" && recent.join("|") === "Check|Artwork Check|Naming Audit|Edit In Context|Batch Tracker", "Recent: the five last used, newest first", recent);
    check(most[0] === "OV Swap" && most.indexOf("Batch Tracker") === -1, "Most used: the habit (OV Swap, 14 uses) -- and nothing already under Recent", most);
    check(!s2.some((x) => /gone/i.test(x)), "a tool that no longer exists is left out, not shown broken");
    await page.eval(`localStorage.setItem("xyi.toolUsage", "{not json")`);
    await page.eval(`document.querySelector(".palette-overlay").click()`);
    await pause(300);
    await cmdK();
    await page.waitFor(`!!document.querySelector(".palette-list")`, 4000);
    check(/The ones you use will\s+gather here/.test(await page.eval(`document.querySelector(".palette-list").innerText`)), "a damaged record reads as nothing used, never an error");
    await page.eval(`document.querySelector(".palette-overlay").click()`);
    await pause(300);

    console.log("\n5. A tool letting go of its keys doesn't take ⌘K with it");
    await cmdK();
    await page.waitFor(`!!document.querySelector(".palette-input-row input")`, 4000);
    await typeInto(".palette-input-row input", "Edit In Context");
    await page.waitFor(`[...document.querySelectorAll(".palette-row")].some(r => /Edit In Context/.test(r.innerText))`, 4000);
    await page.click(".palette-row", "Edit In Context");
    await pause(800);
    await page.eval(`window.__keyClaims = []`);
    await page.click(".home-button");
    await pause(600);
    const after = await page.eval(`window.__keyClaims`);
    check(after.length > 0 && (await claimsK()), "leaving Edit In Context releases its keys but keeps ⌘K", after);

    console.log("\n6. Double-tap Control");
    const key = (type, k, extra = "") => page.eval(`window.dispatchEvent(new KeyboardEvent("${type}", { key: "${k}", bubbles: true ${extra} }))`);
    const tap = async (hold = 60) => { await key("keydown", "Control", ", ctrlKey: true"); await pause(hold); await key("keyup", "Control"); };
    // A double-tap played INSIDE the page on its own timers: round trips to a
    // headless tab slow down while the palette animates, which is the test's
    // timing, not a person's.
    const doubleTap = (gap = 120, hold = 50) => page.eval(`new Promise((done) => {
        const k = (t) => window.dispatchEvent(new KeyboardEvent(t, { key: "Control", ctrlKey: t === "keydown", bubbles: true }));
        k("keydown"); setTimeout(() => { k("keyup"); setTimeout(() => { k("keydown"); setTimeout(() => { k("keyup"); done(true); }, ${hold}); }, ${gap}); }, ${hold});
    })`);
    const isOpen = () => page.eval(`!!document.querySelector(".palette-card")`);
    const closeIt = async () => { if (await isOpen()) { await page.eval(`document.querySelector(".palette-overlay").click()`); await pause(300); } };
    await closeIt();
    await doubleTap(); await pause(300);
    check(await isOpen(), "two quick taps of Ctrl open the palette");
    await doubleTap();
    // Closing animates out: wait for the card to go rather than guess a pause.
    check(await page.waitFor(`!document.querySelector(".palette-card")`, 2000), "…and two more close it");
    await tap(); await pause(400);
    check(!(await isOpen()), "one tap does nothing");
    await tap(); await pause(500); await tap(); await pause(300);
    check(!(await isOpen()), "two taps too far apart do nothing");
    await tap(); await pause(60); await key("keydown", "z", ", ctrlKey: true"); await key("keyup", "z"); await tap(); await pause(300);
    check(!(await isOpen()), "a shortcut between the taps (Ctrl+Z) cancels them");
    await tap(700); await pause(80); await tap(); await pause(300);
    check(!(await isOpen()), "a held Ctrl isn't a tap");
    await tap(); await pause(60); await page.eval(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`); await tap(); await pause(300);
    check(!(await isOpen()), "a click between the taps (Ctrl-click) cancels them");
    const lone = await page.eval(`(() => { const all = window.__keyClaims || []; const last = JSON.parse(all[all.length - 1] || "[]"); return last.filter(k => k.keyCode === 59 || k.keyCode === 62 || k.keyCode === 17).length; })()`);
    check(lone >= 2, "a lone Control is claimed from AE too, so the taps reach the panel", lone);

    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
} finally {
    await page.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — ⌘K (or a Ctrl double-tap) offers what you use, and stays yours while the panel has focus.");
process.exit(failures ? 1 : 0);
