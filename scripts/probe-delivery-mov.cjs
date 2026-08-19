// =============================================================================
// scripts/probe-delivery-mov.cjs
// -----------------------------------------------------------------------------
// Finding the .MOV a delivery should be written beside.
//
// THE BUG THIS PINS DOWN. deliveryRotate90CC wraps a comp in a rotated one, so
// the wrapper's only layer is a COMP, not footage. The search looked one level
// deep, found nothing, and the queue left the output path unset -- so After
// Effects wrote a correctly named METROBUS delivery into whatever folder it had
// last written to. Every rotated deliverable was affected, and rotating is a
// normal thing several territories ask for.
//
// Driven through deliveryChecklistLoadComps against the BUILT bundle, since
// that is what reports sourcePath from the same search.
//
//   node scripts/probe-delivery-mov.cjs
// =============================================================================
"use strict";
const path = require("path");
const { loadBundle } = require("./jsx-harness.cjs");

const R = "/Volumes/universal/Forgotten_Island/France/Renders/Batch_01";
const MOV = R + "/FID_INTL_MultipleArt_DOOH_METROBUS_3240x1920px_10s_FR_V02.mov";

const file = (fsName) => ({
    fsName,
    get parent() { return { fsName: fsName.slice(0, fsName.lastIndexOf("/")), name: "Batch_01" }; },
});
const footage = (f) => ({ name: "mov layer", source: { file: file(f) } });
const nested = (c) => ({ name: "wrapped comp", source: c });
const solid = () => ({ name: "solid", source: {} });

let nextId = 1;
function comp(name, layers) {
    return {
        id: nextId++, name, layers, numLayers: layers.length, layer: (n) => layers[n - 1],
        width: 3240, height: 1920, duration: 10, frameRate: 25, pixelAspect: 1,
        frameDuration: 1 / 25, time: 0, selected: true, selectedLayers: [], selectedProperties: [],
    };
}

let pass = 0, fail = 0;
const check = (l, c, d) => {
    if (c) { pass++; console.log("  ok    " + l); }
    else { fail++; console.log("  FAIL  " + l + (d ? "\n          " + d : "")); }
};

// deliveryChecklistLoadComps reads the project's SELECTED comps and reports
// each one's sourcePath, which comes from the same search the queue uses.
function sourcePathOf(target) {
    const items = [target];
    const proj = {
        numItems: items.length,
        item: (n) => items[n - 1],
        selection: items,
        file: null,
        renderQueue: { items: { add: () => ({ outputModule: () => ({}) }) } },
    };
    // Every comp in the tree must pass `instanceof CompItem`, not just the
    // selected one -- the search recurses into layer sources.
    // Visited-guarded, because one of the cases below is a comp that contains
    // itself -- the very thing the depth cap in the code under test exists for.
    const all = [], seen = new Set();
    (function walk(c) {
        if (seen.has(c)) return;
        seen.add(c); all.push(c);
        for (const l of c.layers) if (l.source && l.source.layers) walk(l.source);
    })(target);
    const { api } = loadBundle(null, { project: proj, compItems: all });
    const r = api.deliveryChecklistLoadComps();
    if (!r || !r.success || !r.comps || !r.comps.length) return { error: (r && r.error) || "no comps" };
    return { sourcePath: r.comps[0].sourcePath, folderName: r.comps[0].folderName };
}

console.log("\n=== a plain deliverable: the .MOV is right there ===");
{
    const c = comp("FID_..._FR", [footage(MOV)]);
    const got = sourcePathOf(c);
    check("finds it", got.sourcePath === MOV, JSON.stringify(got));
}

console.log("\n=== the case that broke: a 90CC wrapper ===");
{
    const base = comp("FID_..._FR", [footage(MOV)]);
    const wrap = comp("FID_..._FR_90CC", [nested(base)]);
    const got = sourcePathOf(wrap);
    check("finds the .MOV one level down", got.sourcePath === MOV, JSON.stringify(got));
    check("so the render lands in the France batch folder", got.folderName === "Batch_01", JSON.stringify(got));
}

console.log("\n=== deeper nesting still resolves ===");
{
    const base = comp("base", [footage(MOV)]);
    const wrap = comp("wrap", [nested(base)]);
    const outer = comp("outer", [nested(wrap)]);
    check("two levels down", sourcePathOf(outer).sourcePath === MOV);
}

console.log("\n=== a comp with genuinely no .MOV still reports none ===");
{
    const inner = comp("precomp", [solid()]);
    const bespoke = comp("bespoke build", [nested(inner)]);
    const got = sourcePathOf(bespoke);
    check("null, not a wrong guess", !got.sourcePath, JSON.stringify(got));
}

console.log("\n=== a comp that contains itself does not hang ===");
{
    const loop = comp("loop", []);
    loop.layers.push(nested(loop));
    loop.numLayers = 1;
    const got = sourcePathOf(loop);
    check("depth cap holds", !got.sourcePath, JSON.stringify(got));
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
