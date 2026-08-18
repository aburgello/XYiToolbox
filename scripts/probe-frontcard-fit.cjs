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
      get value() { return Object.assign(Object.create(null), doc); },
      setValue(v) {
        if (typeof v === "string") { doc.text = v; return; }
        doc.fontSize = v.fontSize; doc.boxTextSize = v.boxTextSize; doc.boxTextPos = v.boxTextPos;
      },
    }),
    sourceRectAtTime() {
      const perLine = Math.max(1, Math.floor(doc.boxTextSize[0] / (doc.fontSize * GLYPH)));
      const words = String(doc.text).split(" ");
      let lines = 1, cur = 0;
      for (const w of words) {
        const add = (cur ? 1 : 0) + w.length;
        if (cur + add > perLine && cur > 0) { lines++; cur = w.length; } else cur += add;
      }
      return { left: 0, top: 0, width: doc.boxTextSize[0], height: lines * doc.fontSize * LEAD };
    },
    _doc: doc,
  };
  return L;
}

function scene(title, opts) {
  const t = textLayer("Title", "Film Title", opts);
  // Layer indices per frontcardLayerTextIndices(variantA=true): title 8 ... date 3.
  const inner = [];
  for (let i = 1; i <= 16; i++) inner.push(textLayer("t" + i, "x", { boxText: false }));
  inner[1] = { name: "XYi_Logo_V20_[0000-0250].png", property: () => ({ value: "", setValue() {} }) };
  inner[7] = t;
  const source = { layer: (n) => inner[n - 1], numLayers: 16 };
  const fc = { name: "Frontcard", source, property: () => ({ value: "", setValue() {} }) };
  const comp = {
    name: "FID_INTL_MultipleArt_DOOH_MotionPoster_1080x1526px_10s_DE_V01",
    numLayers: 1, layer: () => fc, width: 1080, height: 1526, duration: 10,
    frameDuration: 1 / 25, time: 0, selectedLayers: [], selectedProperties: [],
  };
  // containingComp is what bounds the widening.
  t.containingComp = comp;
  return { comp, t, title };
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
  return { before, after, centreBefore, centreAfter, r, layer: s.t };
}

console.log("\n=== a long title in a box built for a short one ===");
{
  const g = run("'Forgotten Island' in a 300px box", "FORGOTTEN ISLAND", { boxWidth: 300, boxHeight: 80, fontSize: 60 });
  check("the box grew", g.after.w > g.before.w, `${g.before.w} -> ${g.after.w}`);
  check("it stayed centred", Math.abs(g.centreAfter - g.centreBefore) < 0.001, `${g.centreBefore} -> ${g.centreAfter}`);
  check("the type was NOT shrunk", g.after.size === g.before.size, `${g.before.size} -> ${g.after.size}`);
  check("it actually fits now", g.layer.sourceRectAtTime().height <= g.layer._doc.boxTextSize[1]);
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
  check("it fits", sc.t.sourceRectAtTime().height <= sc.t._doc.boxTextSize[1]);
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
