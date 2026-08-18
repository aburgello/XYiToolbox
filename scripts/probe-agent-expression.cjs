// =============================================================================
// scripts/probe-agent-expression.cjs
// -----------------------------------------------------------------------------
// set_expression against the BUILT bundle, on both routes.
//
// The gap this closes showed up in real use: asked for a random rotation, the
// agent found exactly the right expression in the Expressions Bank and then had
// to explain it could only write to effect parameters. That was our tool
// surface, not the model.
//
//   node scripts/probe-agent-expression.cjs
// =============================================================================
"use strict";
const { loadBundle } = require("./jsx-harness.cjs");

function prop(initial) {
    let expr = "";
    return {
        get value() { return initial; },
        get expression() { return expr; },
        set expression(v) { expr = String(v); },
        canSetExpression: true,
        _get: () => expr,
    };
}
function layer(name, opts = {}) {
    const L = { name, label: 0, transform: {} };
    L.transform.position = prop([960, 540]);
    L.transform.scale = prop([100, 100]);
    L.transform.opacity = prop(100);
    L.transform.rotation = prop(0);
    L.transform.anchorPoint = prop([0, 0]);
    if (opts.camera) L.transform = { position: prop([0, 0, 0]) };  // no rotation/opacity
    L.property = (n) => (n === "ADBE Effect Parade" ? opts.parade || null : null);
    L._selected = true;
    return L;
}
function comp(layers) {
    return {
        // activeComp() duck-types on `layers`; without it every call reports
        // "no composition is open".
        layers: layers,
        name: "Main", numLayers: layers.length, layer: (n) => layers[n - 1],
        selectedLayers: layers.filter((l) => l._selected), selectedProperties: [],
        width: 1080, height: 1920, duration: 10, frameDuration: 1 / 25, time: 0,
    };
}

let pass = 0, fail = 0;
const check = (l, c, d) => {
    if (c) { pass++; console.log("  ok    " + l); }
    else { fail++; console.log("  FAIL  " + l + (d ? "\n          " + d : "")); }
};
const SPIN = "seedRandom(index, true);\nrandom(0, 360)";

function run(layers, fx, propName, expr) {
    const c = comp(layers);
    const { api, sandbox } = loadBundle(c);
    const r = api.agentSetExpression(fx, propName, expr, "selected", "");
    return { r, undo: sandbox.__undo.length, ends: sandbox.__ends };
}

console.log("\n=== the case from the screenshot: Random Spin onto Rotation ===");
{
    const ls = [layer("A"), layer("B"), layer("C")];
    const { r, undo, ends } = run(ls, "", "rotation", SPIN);
    check("succeeds with no effect named", r.success, r.error);
    check("lands on all three layers' Rotation",
          ls.every((l) => l.transform.rotation._get() === SPIN),
          ls.map((l) => JSON.stringify(l.transform.rotation._get())).join(" | "));
    check("one undo group", undo === 1 && ends === 1, undo + "/" + ends);
    if (r.message) console.log("      " + String(r.message).trim().slice(0, 130));
}

console.log("\n=== the other transforms ===");
for (const p of ["position", "scale", "opacity", "anchor"]) {
    const ls = [layer("A")];
    const { r } = run(ls, "", p, "wiggle(2,30)");
    const key = p === "anchor" ? "anchorPoint" : p;
    check(p + " takes an expression", r.success && ls[0].transform[key]._get() === "wiggle(2,30)", r.error);
}

console.log("\n=== 'transform' spelled out works too ===");
{
    const ls = [layer("A")];
    const { r } = run(ls, "transform", "rotation", SPIN);
    check("effectMatchName 'transform' is accepted", r.success && ls[0].transform.rotation._get() === SPIN, r.error);
}

console.log("\n=== clearing ===");
{
    const ls = [layer("A")];
    run(ls, "", "rotation", SPIN);
    const { r } = run(ls, "", "rotation", "");
    check("an empty expression clears it", r.success && ls[0].transform.rotation._get() === "", ls[0].transform.rotation._get());
}

console.log("\n=== refusals ===");
{
    const ls = [layer("A")];
    const { r } = run(ls, "", "wobble", SPIN);
    check("an unknown transform refuses the whole call", !r.success && /not an animatable transform/.test(r.error), r.error);
    check("and writes nothing", ls[0].transform.rotation._get() === "");
}
{
    const ls = [layer("A"), layer("Camera 1", { camera: true })];
    const { r } = run(ls, "", "rotation", SPIN);
    check("a camera is named, not silently skipped",
          r.success ? /Camera 1/.test(JSON.stringify(r)) : true, JSON.stringify(r).slice(0, 160));
}
{
    const ls = [layer("A")];
    const { r } = run(ls, "", "", SPIN);
    check("no property at all refuses helpfully",
          !r.success && /position, scale, rotation/.test(r.error), r.error);
}

console.log("\n=== effects still work ===");
{
    const param = prop(0);
    const fx = { matchName: "ADBE 4ColorGradient", numProperties: 1, property: () => param };
    const parade = { numProperties: 1, property: () => fx };
    const ls = [layer("A", { parade })];
    const { r } = run(ls, "ADBE 4ColorGradient", "ADBE 4ColorGradient-0002", "time*10");
    check("the effect route is unchanged", r.success, r.error);
}
{
    const ls = [layer("A")];   // no effects at all
    const { r } = run(ls, "ADBE 4ColorGradient", "ADBE 4ColorGradient-0002", "time*10");
    check("a layer without the effect is still reported", !r.success || /no effects|does not have/.test(JSON.stringify(r)),
          JSON.stringify(r).slice(0, 140));
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
