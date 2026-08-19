// =============================================================================
// scripts/probe-frontcard-fit.cjs
// -----------------------------------------------------------------------------
// Drives cheekyDTCheck's title path against the BUILT bundle, to check that a
// long film title WIDENS AND RECENTRES its box before the type is shrunk.
//
// Artists were fixing this by hand -- dragging the box wider and recentring it
// -- because the old helper only ever shrank the font. A title two points
// smaller than every other card in the campaign is a quiet inconsistency; the
// box is the container, and it is the thing that should move.
//
// The wrap model below is an APPROXIMATION of AE's line breaking (average glyph
// width x font size). It is enough to reproduce the real symptom -- "Forgotten
// Island" wrapping to two lines and falling out of a one-line box -- and to
// show the order of operations is right. It is not a substitute for looking at
// a rendered card.
//
// IT NOW CLIPS LIKE AE DOES, and that correction is the whole point of this
// revision. AE renders NOTHING past the bottom of a text box, and
// sourceRectAtTime reports what is RENDERED -- so a title that has already
// wrapped and been cut off measures exactly one line high and reads as
// fitting. The old model returned the full wrapped height, which no version of
// AE will ever return, so the overflow test passed here and did nothing on a
// real card: "Forgotten Island" shipped as FORGOTTEN for another day.
//
// A box layer therefore reports the CLIPPED height, and a point-text probe
// layer (comp.layers.addText) reports the true unwrapped width -- which is how
// the fix learns what the box needs to be.
//   node scripts/probe-frontcard-fit.cjs
// =============================================================================
"use strict";
const { loadBundle } = require("./jsx-harness.cjs");

const GLYPH = 0.55;   // average glyph advance as a fraction of font size
const LEAD  = 1.2;    // line height

function textLayer(name, text, opts = {}) {
  const doc = {
    text, fontSize: opts.fontSize || 60,
    boxText: opts.boxText !== false,
    boxTextSize: [opts.boxWidth || 300, opts.boxHeight || 80],
    boxTextPos: [opts.boxX === undefined ? 100 : opts.boxX, 0],
  };
  const L = {
    name,
    property: () => ({
      // A TextDocument stringifies to its own text in AE, and readText relies
      // on that -- so the mock has to as well.
      get value() {
        const copy = Object.assign({}, doc);
        copy.toString = function () { return doc.text; };
        return copy;
      },
      setValue(v) {
        if (typeof v === "string") { doc.text = v; return; }
        doc.fontSize = v.fontSize; doc.boxTextSize = v.boxTextSize; doc.boxTextPos = v.boxTextPos;
      },
    }),
    // What AE would RENDER: lines past the bottom of the box do not exist.
    sourceRectAtTime() {
      const lines = L._wrappedLines();
      const shown = Math.max(1, Math.min(lines, Math.floor(doc.boxTextSize[1] / (doc.fontSize * LEAD))));
      return {
        left: 0, top: 0,
        width: Math.min(doc.boxTextSize[0], inkWidth(doc.text, doc.fontSize)),
        height: shown * doc.fontSize * LEAD,
      };
    },
    // The truth the model knows and AE will not tell you: how many lines the
    // text actually needs. Tests assert against this, never against the
    // clipped rect, or they assert that clipping happened.
    _wrappedLines() {
      const perLine = Math.max(1, Math.floor(doc.boxTextSize[0] / (doc.fontSize * GLYPH)));
      const words = String(doc.text).split(" ");
      let lines = 1, cur = 0;
      for (const w of words) {
        const add = (cur ? 1 : 0) + w.length;
        if (cur + add > perLine && cur > 0) { lines++; cur = w.length; } else cur += add;
      }
      return lines;
    },
    _doc: doc,
  };
  return L;
}

/** One line of this string, unwrapped, at this size. */
function inkWidth(text, fontSize) {
  return String(text).length * fontSize * GLYPH;
}

/**
 * A point-text layer, as comp.layers.addText() makes one: no box, so it never
 * wraps and its rect is the true width of the string. This is what the fix
 * adds, measures and removes.
 */
function pointTextProbe(text, onRemove) {
  const doc = { text: String(text), fontSize: 60, boxText: false, boxTextSize: [0, 0], boxTextPos: [0, 0] };
  return {
    name: "probe", enabled: true, removed: false,
    property: () => ({
      get value() {
        const copy = Object.assign({}, doc);
        copy.toString = function () { return doc.text; };
        return copy;
      },
      setValue(v) {
        if (typeof v === "string") { doc.text = v; return; }
        if (v.text !== undefined) doc.text = v.text;
        doc.fontSize = v.fontSize;
      },
    }),
    sourceRectAtTime() {
      return { left: 0, top: 0, width: inkWidth(doc.text, doc.fontSize), height: doc.fontSize * LEAD };
    },
    remove() { this.removed = true; onRemove(this); },
    _doc: doc,
  };
}

function scene(title, opts) {
  const t = textLayer("Title", "Film Title", opts);
  // Layer indices per frontcardLayerTextIndices(variantA=true): title 8 ... date 3.
  const inner = [];
  for (let i = 1; i <= 16; i++) inner.push(textLayer("t" + i, "x", { boxText: false }));
  inner[1] = { name: "XYi_Logo_V20_[0000-0250].png", property: () => ({ value: "", setValue() {} }) };
  // Layers the reader also reads: campaignLine (5), territory (4), date (3),
  // artwork (7)... index 8 is the title. Give them plain strings.
  for (let i = 0; i < 16; i++) if (i !== 1 && i !== 7) {
    let v = "";
    inner[i] = { name: "t" + (i + 1), property: () => ({ get value() { return v; }, setValue(x) { v = String(x); } }) };
  }
  inner[7] = t;
  const source = { layer: (n) => inner[n - 1], numLayers: 16 };
  const fc = { name: "Frontcard", source, property: () => ({ value: "", setValue() {} }) };
  // Every probe layer the fix adds, so a test can insist none were left behind.
  const probes = [];
  const comp = {
    name: "FID_INTL_MultipleArt_DOOH_MotionPoster_1080x1526px_10s_DE_V01",
    numLayers: 1, layer: () => fc, width: 1080, height: 1526, duration: 10,
    frameDuration: 1 / 25, time: 0, selectedLayers: [], selectedProperties: [],
    layers: {
      addText(str) {
        const probe = pointTextProbe(str, () => {});
        probes.push(probe);
        return probe;
      },
    },
    _probes: probes,
  };
  // containingComp is what bounds the widening.
  t.containingComp = comp;
  return { comp, t, title, probes };
}

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log("  ok    " + label); }
  else { fail++; console.log("  FAIL  " + label + (detail ? "\n          " + detail : "")); }
};

function run(label, title, opts) {
  const s = scene(title, opts);
  // A saved project: every write path refuses on an unsaved one.
  const { api } = loadBundle(s.comp, { project: { file: { fsName: "/tmp/x.aep", name: "x.aep" } } });
  // The title comes from the comp name's campaign token, so feed it directly.
  s.t._doc.text = title;
  const before = { w: s.t._doc.boxTextSize[0], x: s.t._doc.boxTextPos[0], size: s.t._doc.fontSize };
  const r = api.cheekyDTCheck(true, false, false, false, false, false, false);
  const after = { w: s.t._doc.boxTextSize[0], x: s.t._doc.boxTextPos[0], size: s.t._doc.fontSize };
  const centreBefore = before.x + before.w / 2, centreAfter = after.x + after.w / 2;
  console.log(`\n  ${label}`);
  console.log(`      box ${before.w}px -> ${Math.round(after.w)}px   type ${before.size}pt -> ${after.size}pt   centre ${centreBefore} -> ${centreAfter}`);
  if (r && r.message) console.log("      " + String(r.message).trim().slice(0, 120));
  return { before, after, centreBefore, centreAfter, r, layer: s.t, probes: s.probes };
}

console.log("\n=== a long title in a box built for a short one ===");
{
  const g = run("'Forgotten Island' in a 300px box", "FORGOTTEN ISLAND", { boxWidth: 300, boxHeight: 80, fontSize: 60 });
  check("the box grew", g.after.w > g.before.w, `${g.before.w} -> ${g.after.w}`);
  check("it stayed centred", Math.abs(g.centreAfter - g.centreBefore) < 0.001, `${g.centreBefore} -> ${g.centreAfter}`);
  check("the type was NOT shrunk", g.after.size === g.before.size, `${g.before.size} -> ${g.after.size}`);
  // AGAINST THE WRAP, NOT THE RECT. The rect is clipped, so asking it whether
  // the text fits is asking a question that can only ever answer yes -- which
  // is exactly how the old fit passed this probe while shipping FORGOTTEN.
  check("it actually fits now", g.layer._wrappedLines() === 1, `${g.layer._wrappedLines()} lines`);
  check("no probe layer was left behind", g.probes.length > 0 && g.probes.every((x) => x.removed),
    `${g.probes.length} added, ${g.probes.filter((x) => x.removed).length} removed`);
  check("never past 90% of the frame", g.after.w <= 1080 * 0.9 + 0.001, `${g.after.w} vs ${1080 * 0.9}`);
}

console.log("\n=== Cheeky DT: typing a title writes AND fits ===");
{
  const sc = scene("x", { boxWidth: 300, boxHeight: 80, fontSize: 60 });
  const { api } = loadBundle(sc.comp, { project: { file: { fsName: "/tmp/x.aep", name: "x.aep" } } });
  const before = sc.t._doc.boxTextSize[0], cBefore = sc.t._doc.boxTextPos[0] + before / 2;
  const r = api.frontcardWriteFields(JSON.stringify({ title: "FORGOTTEN ISLAND" }));
  const after = sc.t._doc.boxTextSize[0], cAfter = sc.t._doc.boxTextPos[0] + after / 2;
  console.log(`\n  frontcardWriteFields({title})\n      box ${before}px -> ${Math.round(after)}px   centre ${cBefore} -> ${cAfter}`);
  check("the DT path writes the title", sc.t._doc.text === "FORGOTTEN ISLAND", sc.t._doc.text);
  check("the DT path now fits it too", after > before, `${before} -> ${after}`);
  check("and keeps it centred", Math.abs(cAfter - cBefore) < 0.001, `${cBefore} -> ${cAfter}`);
  check("it fits", sc.t._wrappedLines() === 1, `${sc.t._wrappedLines()} lines`);
  check("no probe layer was left behind", sc.probes.length > 0 && sc.probes.every((x) => x.removed));
}

console.log("\n=== a title too long for even a full-width box ===");
{
  const sc = scene("x", { boxWidth: 300, boxHeight: 80, fontSize: 60 });
  const { api } = loadBundle(sc.comp, { project: { file: { fsName: "/tmp/x.aep", name: "x.aep" } } });
  const size0 = sc.t._doc.fontSize;
  const r = api.frontcardWriteFields(JSON.stringify({ title: "THE EXTRAORDINARILY LONG AND UNREASONABLE FILM TITLE OF DOOM" }));
  const w = sc.t._doc.boxTextSize[0], size1 = sc.t._doc.fontSize;
  console.log(`\n  a very long title\n      box 300px -> ${Math.round(w)}px   type ${size0}pt -> ${size1}pt`);
  check("widened to the cap", w >= 1080 * 0.9 - 0.001, String(w));
  check("and only THEN shrank", size1 < size0, `${size0} -> ${size1}`);
  check("the compromise is reported", /would not fit even at full width/.test(String(r && r.message)), String(r && r.message));
  check("and the title is on one line after it", sc.t._wrappedLines() === 1, `${sc.t._wrappedLines()} lines`);
}

console.log("\n=== a title that already fits is left alone ===");
{
  const g = run("'FID'", "FID", { boxWidth: 600, boxHeight: 120, fontSize: 60 });
  check("box untouched", g.after.w === g.before.w);
  check("type untouched", g.after.size === g.before.size);
  check("nothing reported", !/widened|shrunk/.test(String(g.r && g.r.message || "")), String(g.r && g.r.message));
}

console.log("\n=== point text has no box to grow ===");
{
  const g = run("point text", "FORGOTTEN ISLAND", { boxText: false, boxWidth: 300, boxHeight: 80, fontSize: 60 });
  check("left completely alone", g.after.w === g.before.w && g.after.size === g.before.size);
}

console.log("\n=== reading the card: is that a real title or the template's slot? ===");
function readWith(title, projPath) {
  const sc = scene("x", { boxWidth: 600, boxHeight: 120, fontSize: 60 });
  sc.t._doc.text = title;
  const project = projPath === null ? {} : { file: { toString: () => projPath, fsName: projPath } };
  const { api } = loadBundle(sc.comp, { project });
  const r = api.frontcardReadFields();
  if (!r.success) console.log("      (read failed: " + r.error + ")");
  return r;
}
const CAMPAIGN = "/Volumes/universal/Universal_Pictures/Forgotten_Island/Digital/INT/Batch_01/x.aep";
{
  const r = readWith("Film Title", CAMPAIGN);
  check("'Film Title' is recognised as the template's slot", r.titlePlaceholder === true, JSON.stringify(r.titlePlaceholder));
  check("and the campaign folder gives the title", r.derived && r.derived.title === "Forgotten Island", r.derived && r.derived.title);
}
{
  const r = readWith("", CAMPAIGN);
  check("an empty title counts as unfilled too", r.titlePlaceholder === true);
}
{
  const r = readWith("Forgotten Island", CAMPAIGN);
  check("a real title is left alone", r.titlePlaceholder === false, JSON.stringify(r.titlePlaceholder));
}
{
  const r = readWith("Film Title", "/Users/antonio/Desktop/FID_INTL_MultipleArt_DOOH_1080x1526px_10s_DE_V01.aep");
  check("a project outside a campaign folder derives NOTHING",
        r.derived && r.derived.title === "", "got: " + (r.derived && r.derived.title));
  check("and says so in unresolved", (r.unresolved || []).indexOf("title") !== -1, JSON.stringify(r.unresolved));
}
{
  const r = readWith("Film Title", null);
  check("an unsaved project derives nothing", r.derived && r.derived.title === "", r.derived && r.derived.title);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
