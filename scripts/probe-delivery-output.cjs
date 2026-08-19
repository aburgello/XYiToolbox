// =============================================================================
// scripts/probe-delivery-output.cjs
// -----------------------------------------------------------------------------
// Where a queued delivery is written, and what happens when that cannot be
// worked out.
//
// A METROBUS Multi Art render landed in whatever folder After Effects had last
// written to. Its comp had no .MOV -- a Bespoke build is assembled from
// imported master .aep projects, so every source in it is a precomp -- and the
// old code logged "output path NOT set, check manually" and queued it anyway.
// AE then chose. The file came out correctly named, in the wrong place, with a
// green "Queued" beside it.
//
//   node scripts/probe-delivery-output.cjs
// =============================================================================
"use strict";
const { mkComp, loadBundle } = require("./jsx-harness.cjs");

let pass = 0, fail = 0;
const check = (l, c, d) => {
    if (c) { pass++; console.log("  ok    " + l); }
    else { fail++; console.log("  FAIL  " + l + (d ? "\n          " + d : "")); }
};

// A render-queue item that records whether an output file was ever set.
function scene(opts) {
    const removed = [];
    const om = { file: null, applyTemplate() {} };
    const rqItem = { outputModule: () => om, remove() { removed.push(1); } };

    const layers = [];
    if (opts.movSource) {
        layers.push({
            name: "master.mov", enabled: true,
            source: { file: { fsName: opts.movSource, parent: folder(dirOf(opts.movSource)) } },
        });
    } else {
        // A Bespoke comp: its sources are precomps, never footage files.
        layers.push({ name: "Main", enabled: true, source: { numLayers: 3 } });
    }

    const comp = mkComp(layers, { name: opts.name || "METROBUS_3240x1920" });
    comp.numLayers = layers.length;
    comp.layer = (n) => layers[n - 1];
    comp.selected = true;

    return { comp, om, rqItem, removed };
}
function dirOf(p) { return p.slice(0, p.lastIndexOf("/")); }
function folder(fsName) {
    return { fsName, exists: true, create: () => true, get parent() { return folder(dirOf(fsName)); } };
}

console.log("\n=== the shape of the bug ===");
console.log("  a Bespoke comp has no .MOV, so the old derivation returned nothing,");
console.log("  om.file stayed null, and the item was queued regardless.\n");

// Rather than driving the whole 800-line queue function through a mock AE, this
// asserts the DECISION the fix encodes, against the real source.
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../src/jsx/aeft/deliver.ts"), "utf8").replace(/\0/g, "");

check("there is a fallback to the saved project's folder",
      /proj\.file \? proj\.file\.parent : null/.test(src));
check("the fallback is only used when no .MOV was found",
      /!srcFolder && proj\.file/.test(src));
check("an item with no output path is REMOVED from the queue",
      /if \(!outputSet\) \{[\s\S]{0,200}rqItem\.remove\(\)/.test(src));
check("and the comp is named back to the panel", /notQueued\.push\(comp\.name\)/.test(src));
check("notQueued travels in the result", /return \{ success: true, log, notQueued \}/.test(src));
check("the log says the path came from the project, not a .MOV",
      /from this project's own folder/.test(src));
check("the log says plainly that it was NOT queued", /NOT QUEUED/.test(src));

const ui = fs.readFileSync(require("path").join(__dirname, "../src/js/main/tools/DeliveryHub.tsx"), "utf8");
check("the panel no longer ticks every row unconditionally",
      !/queued: true \}\)\)\)/.test(ui), "still marks all rows queued");
check("it ticks only the rows that were not refused",
      /refused\.indexOf\(x\.name\) === -1/.test(ui));
// Matched loosely on purpose. The exact wording is prose and gets
// reworded; what must not change is that the panel says a row was
// refused and why. Pinning the sentence made an unslop pass look like a
// regression.
check("and says so out loud when any were refused", /NOT queued\W+Nowhere to write to/i.test(ui));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
