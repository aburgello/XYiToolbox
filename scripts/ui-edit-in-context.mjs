// =============================================================================
// scripts/ui-edit-in-context.mjs
// -----------------------------------------------------------------------------
// Click-through of Edit In Context against the browser build with a fake AE
// bridge (ui-harness.mjs): drill into a precomp, pick a layer, press the
// direction pad and the scale buttons, and check what reaches ExtendScript.
//
//   yarn build:web && node scripts/ui-edit-in-context.mjs
// =============================================================================
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch } from "./ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "web");
const SHOTS = process.env.UI_SHOTS || os.tmpdir();

const FIXTURES = `{
  teamGetMachineState: () => ({ owner: "Antonio" }),
  editInContextRoot: () => ({ success: true, compId: 1, compName: "SF_INTL_Trio_DOOH_Odiseja_1665x675px_10s_SI_V01" }),
  editInContextSelection: () => ({ success: true, compId: 1, compName: "SF_INTL_Trio_DOOH_Odiseja_1665x675px_10s_SI_V01", selectedCount: 0, layerIndex: 0 }),
  editInContextLayers: (id) => id === 1
    ? { success: true, compName: "SF_INTL_Trio_DOOH_Odiseja_1665x675px_10s_SI_V01", layers: [
        { index: 1, name: "Landscape_Frontcard", isPrecomp: true, sourceCompId: 2, transformable: true },
        { index: 2, name: "BG plate", isPrecomp: false, sourceCompId: 0, transformable: true } ] }
    : { success: true, compName: "Landscape_Frontcard", layers: [
        { index: 1, name: "Noise", isPrecomp: false, sourceCompId: 0, transformable: true },
        { index: 2, name: "FadeTo Black", isPrecomp: false, sourceCompId: 0, transformable: true },
        { index: 3, name: "Chromatic aberration", isPrecomp: false, sourceCompId: 0, transformable: true },
        { index: 4, name: "Optical_Flare", isPrecomp: false, sourceCompId: 0, transformable: true },
        { index: 5, name: "Diamond_Right", isPrecomp: true, sourceCompId: 3, transformable: true },
        { index: 6, name: "Diamond_Left", isPrecomp: true, sourceCompId: 4, transformable: true },
        { index: 7, name: "Audio", isPrecomp: false, sourceCompId: 0, transformable: false } ] },
  editInContextTarget: () => ({ success: true, layerName: "FadeTo Black", compName: "Landscape_Frontcard",
    position: [1920, 1080], scale: [200, 200], rotation: 0, opacity: 100, rootScale: [50, 50],
    positionKeyed: false, scaleKeyed: false, locked: false }),
  // As the real one: the layer's values after the nudge.
  editInContextNudge: () => ({ success: true, layerName: "FadeTo Black", compName: "Landscape_Frontcard",
    position: [1922, 1080], scale: [199.5, 199.5], rotation: 0, opacity: 100, rootScale: [49.875, 49.875],
    positionKeyed: false, scaleKeyed: false, locked: false }),
  editInContextNudgeMany: () => ({ success: true }),
  editInContextReveal: () => ({ success: true }),
}`;

let failures = 0;
const check = (ok, msg, extra) => {
    if (!ok) failures++;
    console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : ""));
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.innerText || "").replace(/\\s+/g, " ").trim()`;
const calls = (fn) => `window.__calls.filter(c => c.fn === ${JSON.stringify(fn)}).map(c => c.args)`;

const page = await launch({ root: ROOT, fixturesSrc: FIXTURES, width: 760, height: 1100 });
try {
    await page.goto();
    // Open the tool from the home search, as a person would.
    await page.waitFor(`document.querySelector(".home-search input")`, 8000);
    await page.eval(`(() => {
        const i = document.querySelector(".home-search input");
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(i, "Edit In Context"); i.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await pause(400);
    await page.click("button, [role=button]", "Edit In Context");
    check(await page.waitFor(`document.querySelector(".eic-tool")`, 6000), "the tool opens");

    console.log("\n1. Where you are, and the doorways");
    check(await page.waitFor(`document.querySelector(".eic-door")`, 4000), "the top level lists its precomps as doorways");
    check((await page.eval(text(".eic-crumb"))) === "Odiseja 1665x675", "the root reads as its site and size", await page.eval(text(".eic-crumb")));
    check(await page.eval(`[...document.querySelectorAll(".eic-crumb")].every(b => b.scrollWidth <= b.clientWidth + 1)`), "…and no crumb is cut off");
    check(!(await page.eval(`!!document.querySelector(".eic-hint")`)), "no second sentence repeating the header");

    console.log("\n2. Inside a precomp");
    await page.click(".eic-door", "Landscape_Frontcard");
    check(await page.waitFor(`document.querySelectorAll(".eic-layer-row").length === 7`, 4000), "every layer is listed");
    const bg = await page.eval(`getComputedStyle(document.querySelector(".eic-layer-main")).backgroundColor`);
    check(bg === "rgba(0, 0, 0, 0)", "rows are hairlines, not black boxes (.form-tool button no longer wins)", bg);
    check((await page.eval(`document.querySelectorAll(".eic-drill").length`)) === 2, "precomps get a chevron into them, not an 'Inside' button");
    check(await page.eval(`[...document.querySelectorAll(".eic-layer-main")].find(b => /Audio/.test(b.textContent)).disabled`), "a layer with no transform can't be picked");

    console.log("\n3. The editor");
    await page.click(".eic-layer-main", "FadeTo Black");
    check(await page.waitFor(`document.querySelector(".eic-editor")`, 4000), "picking a layer opens the editor");
    check((await page.eval(text(".eic-editor-title"))) === "FadeTo Black", "headed by the layer");
    check(/Position 1920, 1080/.test(await page.eval(text(".eic-readout"))), "with its values", await page.eval(text(".eic-readout")));
    check(await page.eval(`document.querySelector(".eic-layer-row--on")?.innerText.includes("FadeTo Black")`), "and its row is lit");
    check(await page.eval(`!!document.querySelector(".eic-editor-head .eic-select")`), "Select in AE sits in the editor's header");
    const dpad = await page.eval(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const u = r(".eic-dpad-up"), l = r(".eic-dpad-left"), c = r(".eic-dpad-step"), rt = r(".eic-dpad-right"), d = r(".eic-dpad-down"); return { cross: u.top < c.top && d.top > c.top && l.left < c.left && rt.left > c.left && Math.abs(u.left - c.left) < 2 && Math.abs(l.top - c.top) < 2 }; })()`);
    check(dpad.cross, "the arrows form a cross around the step size");
    const centred = await page.eval(`(() => { const cell = document.querySelector(".eic-dpad-step").getBoundingClientRect(); const i = document.querySelector(".eic-dpad-step input").getBoundingClientRect(); const u = document.querySelector(".eic-dpad-step em").getBoundingClientRect(); const mid = (i.left + u.right) / 2; return Math.round(Math.abs(mid - (cell.left + cell.width / 2))); })()`);
    check(centred <= 2, "the step and its unit sit centred in the pad", centred + "px off centre");
    check(!(await page.eval(`!!document.querySelector(".eic-group .eic-rootspace")`)) && (await page.eval(`!!document.querySelector(".eic-editor > .ov-tooltip-wrapper .eic-rootspace, .eic-editor .eic-rootspace")`)), "the on-screen toggle sits under both controls, not under Scale");
    await page.eval(`document.querySelector(".eic-rootspace").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))`);
    await page.eval(`document.querySelector(".eic-rootspace").dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))`);
    await pause(700);
    const tip = await page.eval(`[...document.querySelectorAll(".ov-tooltip-bubble, [class*=tooltip-bubble], [role=tooltip]")].map(e => e.innerText).join(" ")`);
    check(/drawn at 25%/.test(tip) && /8 px inside/.test(tip) && /0\.5 px on screen/.test(tip), "its tooltip explains it with this layer's numbers", tip.slice(0, 140));

    console.log("\n4. Presses reach After Effects");
    await page.click(".eic-dpad-right .eic-nudge");
    await pause(300);
    let n = await page.eval(calls("editInContextNudge"));
    const last = n[n.length - 1] || [];
    check(n.length >= 1 && last.includes("position") && last.includes(2) && last.includes(0), "→ nudges position +2, 0", last);
    await page.click(".eic-scale .eic-nudge");
    await pause(300);
    n = await page.eval(calls("editInContextNudge"));
    check(n.some((a) => a.includes("scale") && a.includes(-0.5)), "− nudges scale by −0.5%", n[n.length - 1]);

    console.log("\n5. Fits a docked panel");
    await page.resize(420, 1100);
    const sideways = await page.eval(`(() => { const t = document.querySelector(".eic-tool"); return t.scrollWidth - t.clientWidth; })()`);
    check(sideways <= 0, "no sideways scroll at 420px", sideways);
    await page.resize(760, 1100);
    await pause(300);
    await page.shot(path.join(SHOTS, "ui-edit-in-context.png"));

    console.log("");
    check(page.errors.length === 0, "no page errors", page.errors.slice(0, 5));
} finally {
    await page.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCLEAN — Edit In Context drills, picks and nudges.");
process.exit(failures ? 1 : 0);
