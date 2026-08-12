// =============================================================================
// auto-ar-probe.jsx -- read-only diagnostic for the Auto AR rig.
// -----------------------------------------------------------------------------
// Why this exists: Auto AR applies the Position expression and skips the Scale
// one on ONE artist's machine, and every candidate cause produces the same
// description from the user ("the scale isn't tied"). This reports exactly
// what the rig's own lookups see on the failing layer, so the cause is read
// rather than guessed.
//
// HOW TO RUN
//   Open the comp, select the layer Auto AR was run on, then either
//     File > Scripts > Run Script File…  and pick this file, or
//     paste the whole thing into the panel's Script Playground and run it.
//   It writes a report next to this file and to the Desktop, and shows it.
//
// READS ONLY. Touches no expression, no value, no file the panel uses.
// =============================================================================
(function () {
    var out = [];
    var verdict = [];
    function say(s) { out.push(String(s)); }
    // Goes in both the file and the on-screen alert -- AE's alert can't scroll,
    // so only the decisive lines are shown there.
    function key(s) { out.push(String(s)); verdict.push(String(s)); }

    function safe(fn, fallback) {
        try { return fn(); } catch (e) { return fallback === undefined ? "<err: " + e.toString() + ">" : fallback; }
    }

    say("=== Auto AR probe ===");
    say("AE version        : " + safe(function () { return app.version; }));
    say("Project file      : " + safe(function () { return app.project.file ? app.project.file.name : "(unsaved)"; }));
    // The project-level expression engine matters: a project set to Legacy
    // ExtendScript evaluates the rig's expressions under different rules to a
    // JavaScript-engine project, and this setting travels inside the .aep --
    // so it follows one artist's template around without being a machine
    // difference at all.
    say("Expression engine : " + safe(function () { return app.project.expressionEngine; }));

    var comp = app.project.activeItem;
    // Duck-typed, not `instanceof CompItem` -- see CLAUDE.md §2.
    if (!comp || typeof comp.numLayers !== "number") {
        alert("Open the composition first, then select the layer Auto AR was run on.");
        return;
    }
    say("Comp              : " + comp.name + "  " + comp.width + "x" + comp.height +
        "  (aspect " + (comp.width / comp.height).toFixed(6) + ")");

    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) {
        alert("Select the layer Auto AR was run on, then run this again.");
        return;
    }

    for (var li = 0; li < sel.length; li++) {
        var layer = sel[li];
        say("");
        say("-----------------------------------------------------------------");
        say("LAYER: " + layer.name + "   (index " + layer.index + ")");

        var effects = safe(function () { return layer.property("Effects"); }, null);
        if (!effects) { say("  NO Effects group -- the rig would have skipped this layer entirely."); continue; }

        say("  Effects on the layer (" + effects.numProperties + "):");
        for (var i = 1; i <= effects.numProperties; i++) {
            // Not named `e` -- ExtendScript is loose about whether a catch
            // parameter stays inside its block, and `catch (e)` appears below.
            var efx = effects.property(i);
            say("    " + i + ". '" + efx.name + "'   [" + safe(function () { return efx.matchName; }) + "]");
        }

        // This is the exact lookup the rig does, and it returns the FIRST
        // effect whose name is "Transform" -- not necessarily the one being
        // looked at in Effect Controls.
        var tf = safe(function () { return effects.property("Transform"); }, null);
        say("");
        say("  effects.property('Transform') -> " +
            (tf ? "'" + tf.name + "'  [" + safe(function () { return tf.matchName; }) + "]" : "NULL"));

        if (tf) {
            say("  Its parameters:");
            for (var p = 1; p <= tf.numProperties; p++) {
                var pr = tf.property(p);
                var line = "    " + p + ". '" + pr.name + "'  [" + safe(function () { return pr.matchName; }) + "]";
                line += "  canSetExpr=" + safe(function () { return pr.canSetExpression; }, "n/a");
                var hasExpr = safe(function () { return pr.expression && pr.expression.length > 0; }, false);
                line += "  expr=" + (hasExpr ? safe(function () { return pr.expression.length; }) + " chars" : "none");
                if (hasExpr) {
                    line += "  enabled=" + safe(function () { return pr.expressionEnabled; }, "n/a");
                    var err = safe(function () { return pr.expressionError; }, "");
                    if (err && err.length > 0) line += "  ERROR=" + err;
                }
                say(line);
            }

            say("");
            key("  The rig's own lookups on that effect:");
            key("    property('Position')     -> " + (safe(function () { return tf.property("Position"); }, null) ? "FOUND" : "NULL"));
            key("    property('Scale')        -> " + (safe(function () { return tf.property("Scale"); }, null) ? "FOUND" : "NULL"));
            key("    property('Scale Height') -> " + (safe(function () { return tf.property("Scale Height"); }, null) ? "FOUND" : "NULL"));
            key("    property('Scale Width')  -> " + (safe(function () { return tf.property("Scale Width"); }, null) ? "FOUND" : "NULL"));
            var uni = safe(function () { return tf.property("Uniform Scale"); }, null);
            key("    Uniform Scale            = " + (uni ? safe(function () { return uni.value; }) : "NULL"));

            // The decisive one: is there an expression on the scale slot, and
            // did AE disable it? Absent vs present-but-disabled vs live are
            // three different faults with three different fixes.
            var scaleSlot = safe(function () { return tf.property("Scale"); }, null) ||
                            safe(function () { return tf.property("Scale Height"); }, null);
            if (scaleSlot) {
                var sHas = safe(function () { return scaleSlot.expression && scaleSlot.expression.length > 0; }, false);
                key("    scale expression         = " + (sHas
                    ? safe(function () { return scaleSlot.expression.length; }) + " chars, enabled=" +
                      safe(function () { return scaleSlot.expressionEnabled; }, "n/a") +
                      ", error=" + (safe(function () { return scaleSlot.expressionError; }, "") || "none")
                    : "NONE"));
            }
        }

        // The controls the SCALE expression reads. Every one of these lookups
        // is inside a `catch { continue; }` in the expression, so a missing or
        // wrong-typed control produces no error -- just a flat result of 100.
        say("");
        say("  Controls the scale expression looks for (name + does ('Slider') resolve?):");
        var labelsL = ["Square", "Quad", "1920x1080", "48", "30", "96", "Extreme"];
        var labelsP = ["1Sheet", "1080x1920", "Tall-Port", "6Sheet"];
        var found = 0, missing = 0, wrongType = 0;
        function checkControl(name, wantSub) {
            var ctrl = safe(function () { return effects.property(name); }, null);
            if (!ctrl) { say("    MISSING   '" + name + "'"); missing++; return; }
            var sub = safe(function () { return ctrl.property(wantSub); }, null);
            if (!sub) {
                say("    WRONGTYPE '" + name + "'  [" + safe(function () { return ctrl.matchName; }) +
                    "] has no '" + wantSub + "' -- the expression skips this point");
                wrongType++;
                return;
            }
            say("    ok        '" + name + "' = " + safe(function () { return sub.value; }));
            found++;
        }
        for (var a = 0; a < labelsL.length; a++) checkControl("[L] " + labelsL[a] + " Scale", "Slider");
        for (var b = 0; b < labelsP.length; b++) checkControl("[P] " + labelsP[b] + " Scale", "Slider");
        checkControl("Over_Ride", "Slider");
        key("    --> usable scale points: " + found + ",  missing: " + missing + ",  wrong type: " + wrongType);
        if (found === 0) {
            key("    !! Zero usable points: the scale expression can only return its");
            key("       default of 100 -- it looks 'not tied' even when it IS applied.");
        }
    }

    var text = out.join("\n");

    // Write next to this script and to the Desktop, so it's easy to send on.
    var written = [];
    function tryWrite(f) {
        try {
            f.encoding = "UTF-8";
            if (f.open("w")) { f.write(text); f.close(); written.push(f.fsName); }
        } catch (e) { /* not writable here, try the next */ }
    }
    tryWrite(new File(Folder.desktop.fsName + "/AutoAR-probe-report.txt"));
    try { tryWrite(new File(File($.fileName).parent.fsName + "/AutoAR-probe-report.txt")); } catch (e) {}

    alert("Auto AR probe\n\n" + verdict.join("\n") +
        (written.length
            ? "\n\nFull report saved to:\n" + written.join("\n")
            : "\n\n(Could not save the full report anywhere -- run from File > Scripts > Run Script File.)"));
})();
