// =============================================================================
// scripts/jsx-harness.cjs
// -----------------------------------------------------------------------------
// RUNS THE BUILT EXTENDSCRIPT BUNDLE IN NODE, against a mock After Effects DOM.
//
// CLAUDE.md section 6 is blunt about why this needs to exist: `tsc -p
// tsconfig-build.json` type-checks ZERO files under src/jsx, and the frontend
// config types them against DOM File/Folder behind ~2000 baseline errors. A
// wrong property on an AE object compiles and ships -- `bestMatch.fsName` broke
// every matched row of csvLocaliserRun for months exactly this way. The
// instruction it ends on is "exercise it headlessly against the built bundle
// instead", and this is the thing that does that.
//
// IT LOADS dist/cep/jsx/index.js -- THE SHIPPED FILE, not the TypeScript. So it
// catches what the type-checker cannot: a bundling mistake, an ES3 lowering
// problem, a global that does not exist at runtime.
//
// THE MOCK IS NOT AFTER EFFECTS, and must not be trusted as if it were. It
// models the parts of the DOM the code under test touches, and it deliberately
// models two behaviours that bite in real AE:
//
//   - temporal ease on a LINEAR keyframe is accepted and does nothing, so
//     forgetting setInterpolationTypeAtKey shows up as a flat curve here
//     rather than passing;
//   - setTemporalEaseAtKey throws when the array length does not match what
//     the key reports, which is the multi-dimensional Scale trap.
//
// Anything geometric, anything about how a render looks, and anything touching
// a file still needs a real-AE pass. This narrows what has to be checked by
// hand; it does not remove it.
// =============================================================================
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const BUNDLE = path.join(__dirname, "..", "dist", "cep", "jsx", "index.js");

function mkProp(name, value, dims) {
  const keys = [];  // {t, v, inEase, outEase, inInterp, outInterp, selected}
  const P = {
    name, selected: false,
    get value() { return keys.length ? keys[0].v : value; },
    get numKeys() { return keys.length; },
    keyTime: k => keys[k-1].t,
    keyValue: k => keys[k-1].v,
    setValueAtTime(t, v) {
      const i = keys.findIndex(k => Math.abs(k.t - t) < 1e-9);
      const rec = { t, v, inEase: mk(dims), outEase: mk(dims), inInterp: "LINEAR", outInterp: "LINEAR", selected: false };
      if (i >= 0) keys[i] = rec; else keys.push(rec);
      keys.sort((a,b) => a.t - b.t);
    },
    removeKey(k) { keys.splice(k-1, 1); },
    keyInTemporalEase: k => keys[k-1].inEase,
    keyOutTemporalEase: k => keys[k-1].outEase,
    setTemporalEaseAtKey(k, inE, outE) {
      if (inE.length !== keys[k-1].inEase.length) throw new Error("Value array does not have " + keys[k-1].inEase.length + " elements");
      if (outE.length !== keys[k-1].outEase.length) throw new Error("Value array does not have " + keys[k-1].outEase.length + " elements");
      // AE ignores temporal ease on a LINEAR key -- the whole reason BEZIER
      // must be set first. Modelled, so a missing setInterpolationTypeAtKey
      // shows up here as a flat curve rather than passing.
      if (keys[k-1].inInterp === "LINEAR" && keys[k-1].outInterp === "LINEAR") return;
      keys[k-1].inEase = inE; keys[k-1].outEase = outE;
    },
    setInterpolationTypeAtKey(k, i, o) { keys[k-1].inInterp = "BEZIER"; keys[k-1].outInterp = "BEZIER"; },
    setSelectedAtKey(k, on) { keys[k-1].selected = on; },
    get selectedKeys() { return keys.map((k,i)=>k.selected?i+1:0).filter(Boolean); },
    _keys: keys,
  };
  function mk(n) { const a=[]; for (let i=0;i<n;i++) a.push({influence:0.1,speed:0}); return a; }
  return P;
}
function mkLayer(name, opts = {}) {
  const three = !!opts.threeD;
  const L = { name, label: opts.label || 0, transform: {} };
  L.transform.position   = mkProp("Position", three ? [960,540,0] : [960,540], three?3:2);
  L.transform.scale      = mkProp("Scale",    three ? [100,100,100] : [100,100], three?3:2);
  L.transform.opacity    = mkProp("Opacity", 100, 1);
  L.transform.anchorPoint= mkProp("Anchor Point", three ? [0,0,0] : [0,0], three?3:2);
  if (three) L.transform.zRotation = mkProp("Z Rotation", 0, 1);
  else L.transform.rotation = mkProp("Rotation", 0, 1);
  if (opts.camera) { L.transform = { position: mkProp("Position",[0,0,0],3) }; }  // no opacity/scale
  return L;
}
function mkComp(layers, opts = {}) {
  const C = {
    name: opts.name || "Main", duration: opts.duration || 10,
    frameDuration: 1 / (opts.fps || 25), time: 0,
    numLayers: layers.length, layer: n => layers[n-1],
    selectedLayers: layers.filter(l => l._selected),
    selectedProperties: [],
    _layers: layers,
  };
  return C;
}

/**
 * Loads the bundle into a fresh sandbox holding `comp` as the active item.
 * Returns the panel's exported namespace, plus the sandbox so a test can see
 * how many undo groups were opened and closed.
 */
function loadBundle(comp) {
  const s = {
    app: {
      project: { activeItem: comp },
      beginUndoGroup(n) { s.__undo.push(n); },
      endUndoGroup() { s.__ends++; },
    },
    __undo: [], __ends: 0,
    CompItem: function CompItem() {}, Layer: function Layer() {}, Property: function Property() {},
    KeyframeEase: function (speed, influence) { this.speed = speed; this.influence = influence; },
    KeyframeInterpolationType: { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 },
    PropertyType: { PROPERTY: 6173 },
    $: { writeln() {}, global: {} },
    Folder: function () {}, File: function () {},
    BridgeTalk: { appName: "aftereffects" },
    JSON, Math, Number, String, Array, Object, isNaN, isFinite, parseInt, parseFloat, Error, Date,
  };
  // `comp instanceof CompItem` is the first thing most of these functions do,
  // and it has to be the sandbox's CompItem, not this file's.
  if (comp) Object.setPrototypeOf(comp, s.CompItem.prototype);
  const ctx = vm.createContext(s);
  vm.runInContext(fs.readFileSync(BUNDLE, "utf8"), ctx, { filename: "index.js" });
  // The bundle ends with `host[ns] = aeft`, host being `$` and ns the panel id.
  const ns = Object.keys(s.$).filter((k) => k !== "writeln" && k !== "global")[0];
  if (!ns) throw new Error("The bundle did not register a namespace on $ — did the AE host check pass?");
  return { api: s.$[ns], sandbox: s };
}

module.exports = { mkProp, mkLayer, mkComp, loadBundle, BUNDLE };
