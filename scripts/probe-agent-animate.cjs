// =============================================================================
// scripts/probe-agent-animate.cjs
// -----------------------------------------------------------------------------
// Exercises agentAnimateProperty against the BUILT bundle. Run after `yarn
// build`:  node scripts/probe-agent-animate.cjs
//
// Two real defects came out of writing this, neither of which any type-checker
// would have found, and both of which report SUCCESS while being wrong:
//
//   - a 0.5s stagger on a 25fps comp is 12.5 frames, so rounding each start
//     independently gave gaps of 0.52 and 0.48 where the artist asked for even
//     ones. Fixed by counting in frames and multiplying.
//   - a duration under half a frame rounded both keyframes onto the same time,
//     which is ONE key, which is no animation -- reported as done.
//
// See scripts/jsx-harness.cjs for what the mock does and does not cover.
// =============================================================================
"use strict";
const { mkLayer, mkComp, loadBundle } = require("./jsx-harness.cjs");

function animate(comp, args) {
  const { api, sandbox } = loadBundle(comp);
  const r = api.agentAnimateProperty(
    args.kind || "selected", args.value || "", args.property,
    args.from === undefined ? "" : args.from, args.to,
    args.start === undefined ? 0 : args.start, args.duration,
    !!args.relative, args.stagger || 0, args.ease || "none", !!args.replace
  );
  return { r, undo: sandbox.__undo, ends: sandbox.__ends };
}
function keys(layer, which) {
  return layer.transform[which]._keys
    .map((k) => k.t.toFixed(2) + "s=" + JSON.stringify(k.v) + (k.inInterp === "BEZIER" ? "~" : "") + (k.selected ? "*" : ""))
    .join("  ");
}
const sel = (l) => { l._selected = true; return l; };
let pass=0, fail=0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail?"\n          "+detail:""}`); }
}

console.log("\n=== the screenshot's request: fade 3 layers up ===");
{
  const ls=[sel(mkLayer("A")),sel(mkLayer("B")),sel(mkLayer("C"))];
  const c=mkComp(ls);
  const {r,undo,ends}=animate(c,{property:"opacity",from:"0",to:"100",duration:1,ease:"both"});
  check("succeeds", r.success, r.error);
  check("one undo group", undo.length===1 && ends===1, `${undo.length} groups`);
  check("all three animated", ls.every(l=>l.transform.opacity.numKeys===2));
  check("0 -> 100", keys(ls[0],"opacity").includes("0.00s=0") && keys(ls[0],"opacity").includes("1.00s=100"));
  check("keys are bezier (ease actually takes)", ls[0].transform.opacity._keys.every(k=>k.inInterp==="BEZIER"));
  check("ease influence written", ls[0].transform.opacity._keys[1].inEase[0].influence>30,
        JSON.stringify(ls[0].transform.opacity._keys[1].inEase));
  check("keys left selected for a preset", ls[0].transform.opacity.selectedKeys.length===2);
  console.log("    ", r.message);
}

console.log("\n=== stagger: 'one after another' ===");
{
  const ls=[sel(mkLayer("A")),sel(mkLayer("B")),sel(mkLayer("C"))];
  const {r}=animate(mkComp(ls),{property:"opacity",from:"0",to:"100",duration:1,stagger:0.5});
  const starts=ls.map(l=>l.transform.opacity._keys[0].t);
  const gaps=[starts[1]-starts[0], starts[2]-starts[1]];
  check("gaps are EVEN (0.5s is 12.5 frames at 25fps)", Math.abs(gaps[0]-gaps[1])<1e-9, starts.join(","));
  check("every layer gets the same duration",
    new Set(ls.map(l=>+(l.transform.opacity._keys[1].t-l.transform.opacity._keys[0].t).toFixed(6))).size===1,
    ls.map(l=>l.transform.opacity._keys[1].t-l.transform.opacity._keys[0].t).join(","));
  console.log("    ", r.message);
}

console.log("\n=== relative: 'slide in from 200 below' ===");
{
  const l=sel(mkLayer("A"));   // sits at 960,540
  const {r}=animate(mkComp([l]),{property:"position",from:"[0,200]",to:"[0,0]",duration:0.8,relative:true});
  check("from 960,740 to 960,540",
    JSON.stringify(l.transform.position._keys.map(k=>k.v))==="[[960,740],[960,540]]", keys(l,"position"));
  console.log("    ", r.message);
}

console.log("\n=== short value against a 3D property ===");
{
  const l=sel(mkLayer("A",{threeD:true}));   // position [960,540,0]
  animate(mkComp([l]),{property:"position",to:"[100,200]",duration:1});
  check("z left alone, not zeroed to a plane", JSON.stringify(l.transform.position._keys[1].v)==="[100,200,0]",
        JSON.stringify(l.transform.position._keys[1].v));
}
{
  const l=sel(mkLayer("A",{threeD:true}));
  const {r}=animate(mkComp([l]),{property:"rotation",to:"360",duration:2});
  check("3D layer rotates via zRotation", r.success && l.transform.zRotation.numKeys===2, r.error);
}

console.log("\n=== refusals ===");
{
  const l=sel(mkLayer("A"));
  l.transform.opacity.setValueAtTime(0,100); l.transform.opacity.setValueAtTime(3,0);
  const {r}=animate(mkComp([l]),{property:"opacity",to:"100",duration:1});
  check("won't overwrite existing animation", !r.success && /already animated/.test(r.error), r.error);
  const {r:r2}=animate(mkComp([l]),{property:"opacity",to:"0",duration:1,replace:true});
  check("replaces when told to", r2.success && l.transform.opacity.numKeys===2, r2.error);
}
{
  const cam=sel(mkLayer("Camera 1",{camera:true}));
  const {r}=animate(mkComp([cam]),{property:"opacity",to:"0",duration:1});
  check("reports a missing property, never skips it", !r.success && /no Opacity/.test(r.error), r.error);
}
{
  const ls=[sel(mkLayer("A")),sel(mkLayer("Camera 1",{camera:true}))];
  const c=mkComp(ls);
  const {r}=animate(c,{property:"opacity",to:"0",duration:1});
  check("all-or-nothing across a mixed selection",
        !r.success && ls[0].transform.opacity.numKeys===0, "layer A got keys anyway");
}
const bad=[
  ["no duration",       {property:"opacity",to:"100",duration:0}],
  ["negative start",    {property:"opacity",to:"100",duration:1,start:-2}],
  ["unknown property",  {property:"wobble",to:"100",duration:1}],
  ["junk value",        {property:"opacity",to:"soon",duration:1}],
  ["too many numbers",  {property:"opacity",to:"[1,2,3]",duration:1}],
  ["hostile magnitude", {property:"position",to:"[1e12,0]",duration:1}],
  ["bad ease name",     {property:"opacity",to:"100",duration:1,ease:"bouncy"}],
];
for (const [label,args] of bad) {
  const l=sel(mkLayer("A"));
  const {r}=animate(mkComp([l]),args);
  check("refuses: "+label, !r.success && !!r.error && l.transform.opacity.numKeys===0, r.error||"succeeded!");
}
{
  const {r}=animate(null,{property:"opacity",to:"100",duration:1});
  check("refuses with no comp open", !r.success && /No composition/.test(r.error), r.error);
}
{
  const l=mkLayer("A");  // NOT selected
  const {r}=animate(mkComp([l]),{property:"opacity",to:"100",duration:1});
  check("refuses with nothing selected", !r.success && /Nothing is selected/.test(r.error), r.error);
}

console.log("\n=== targeting without a selection ===");
{
  const ls=[mkLayer("BG"),mkLayer("Logo")];
  const {r}=animate(mkComp(ls),{kind:"name",value:"logo",property:"scale",to:"[120,120]",duration:0.5});
  check("finds a layer by name, case-insensitively", r.success && ls[1].transform.scale.numKeys===2, r.error);
}
{
  const ls=[mkLayer("Logo"),mkLayer("Logo")];
  const {r}=animate(mkComp(ls),{kind:"name",value:"Logo",property:"scale",to:"[120,120]",duration:0.5});
  check("refuses an ambiguous name", !r.success && /2 layers are called/.test(r.error), r.error);
}

console.log("\n=== sub-frame duration ===");
{
  const l=sel(mkLayer("A"));
  const {r}=animate(mkComp([l],{fps:25}),{property:"opacity",to:"0",duration:0.005});
  check("a duration under one frame still makes TWO keys, not one",
        l.transform.opacity.numKeys===2, `${l.transform.opacity.numKeys} key(s) -- no animation`);
}

console.log("\n=== frame snapping and overrun ===");
{
  const l=sel(mkLayer("A"));
  const {r}=animate(mkComp([l],{fps:25}),{property:"opacity",to:"0",duration:0.333,start:0.111});
  const ts=l.transform.opacity._keys.map(k=>k.t);
  check("snapped to the 25fps grid", ts.every(t=>Math.abs(t/0.04-Math.round(t/0.04))<1e-9), ts.join(","));
}
{
  const l=sel(mkLayer("A"));
  const {r}=animate(mkComp([l],{duration:5}),{property:"opacity",to:"0",duration:4,start:3});
  check("says when it runs past the comp end", /past the end of the comp/.test(r.message||""), r.message);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
