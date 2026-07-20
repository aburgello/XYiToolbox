// =============================================================================
// src/jsx/aeft/preflight.ts -- one-shot "is this project safe to hand over /
// render" audit of the OPEN project. Read-only: walks items and layers,
// changes nothing. Three checks:
//   1. Missing footage -- FootageItem.footageMissing, the classic
//      moved-machines breakage.
//   2. Missing EFFECTS -- every effect used anywhere in the project,
//      checked against THIS machine's app.effects registry. A project using
//      a third-party plugin the receiving machine doesn't have renders
//      silently wrong; this surfaces it before render time.
//   3. Fonts -- BEST-EFFORT, feature-gated: reads each text layer's font
//      and, where this AE version exposes a queryable font registry
//      (app.fonts, newer AE only -- UNVERIFIED against a real install,
//      same first-real-test caveat as everything ExtendScript-only),
//      flags fonts that don't resolve. On older AE the report says fonts
//      weren't checked rather than pretending they passed.
// Returns a JSON report the React side formats -- no alerts from here.
// =============================================================================
import { Result } from "./shared";

interface PreflightEffectIssue {
  matchName: string;
  label: string;
  usedIn: string[];
}

// Each missing footage item carries its project item `id` (so the modal can
// target it for reveal/relink even though the project selection may change)
// and its EXPECTED path (where AE is looking for the file that isn't there),
// which drives both "Reveal in Finder" (nearest existing ancestor folder) and
// the auto-relink sibling match.
interface PreflightFootageIssue {
  id: number;
  name: string;
  path: string;
  fileName: string;
}

interface PreflightReport {
  projectName: string;
  compCount: number;
  footageCount: number;
  missingFootage: PreflightFootageIssue[];
  missingEffects: PreflightEffectIssue[];
  fontsChecked: boolean;
  missingFonts: string[];
  fontsUsed: number;
}

interface PreflightResult extends Result {
  report?: PreflightReport;
}

export const preflightAudit = (): PreflightResult => {
  try {
    const proj = app.project;
    if (!proj || proj.numItems === 0) {
      return { success: false, error: "Open a project first (this audits the currently open project)." };
    }

    const report: PreflightReport = {
      projectName: proj.file ? proj.file.name : "(unsaved project)",
      compCount: 0,
      footageCount: 0,
      missingFootage: [],
      missingEffects: [],
      fontsChecked: false,
      missingFonts: [],
      fontsUsed: 0,
    };

    // Installed-effects set from AE's own registry (same source QuickFX's
    // search uses) -- plain object as a set, ExtendScript has no Set.
    const installed: { [matchName: string]: boolean } = {};
    const registry = app.effects;
    for (let i = 0; i < registry.length; i++) {
      if (registry[i] && registry[i].matchName) installed[registry[i].matchName] = true;
    }

    // Font availability: only when this AE exposes a queryable registry.
    // Feature-detected, never assumed -- and each probe is try/caught so a
    // partial/changed API degrades to "fonts not checked", never a crash.
    const appAny = app as any;
    const canCheckFonts =
      typeof appAny.fonts !== "undefined" &&
      appAny.fonts &&
      typeof appAny.fonts.getFontsByPostScriptName === "function";
    const missingFontSet: { [ps: string]: boolean } = {};
    const seenFontSet: { [ps: string]: boolean } = {};

    // Track each missing effect once, with the comps it appears in.
    const effectIssues: { [matchName: string]: PreflightEffectIssue } = {};

    for (let i = 1; i <= proj.numItems; i++) {
      const item = proj.item(i);

      if (item instanceof FootageItem) {
        report.footageCount++;
        try {
          if ((item as any).footageMissing) {
            let path = "";
            let fileName = "";
            try {
              if (item.file) { path = item.file.fsName; fileName = item.file.name; }
            } catch (ef) {
              // some sources (solids) have no .file -- leave path blank
            }
            report.missingFootage.push({ id: item.id, name: item.name, path: path, fileName: fileName });
          }
        } catch (e) {
          // solids/placeholders can lack the flag -- not missing
        }
        continue;
      }

      if (!(item instanceof CompItem)) continue;
      report.compCount++;

      for (let li = 1; li <= item.numLayers; li++) {
        const layer = item.layer(li);

        // Effects on this layer: flagged as missing when EITHER signal says
        // so --
        //   1. The display name starts with "Missing:" -- AE's own placeholder
        //      rename for an effect whose plugin isn't loaded (this is
        //      exactly what the Effect Controls panel shows, e.g.
        //      "Missing: UnMult"). This is the authoritative check: a REAL
        //      false negative shipped without it, because a missing-effect
        //      placeholder doesn't reliably fail the registry test below
        //      (its matchName can read empty or as a registered placeholder,
        //      depending on AE version).
        //   2. The matchName isn't in app.effects (catches an effect whose
        //      placeholder naming ever differs, e.g. localised AE).
        // Each effect is probed in its OWN try/catch -- the first shipped
        // version wrapped the whole per-layer loop, so one unreadable
        // placeholder silently skipped every remaining effect on that layer.
        try {
          const fxGroup = layer.property("ADBE Effect Parade");
          if (fxGroup) {
            const group = fxGroup as Property;
            for (let fi = 1; fi <= group.numProperties; fi++) {
              try {
                const fx = group.property(fi) as Property;
                if (!fx) continue;
                let fxName = "";
                let fxMatch = "";
                try { fxName = fx.name || ""; } catch (e3) { /* unreadable */ }
                try { fxMatch = fx.matchName || ""; } catch (e3) { /* unreadable */ }

                const isMissingByName = fxName.indexOf("Missing:") === 0;
                // Expression/pseudo controls saved into projects aren't in
                // app.effects on any machine -- benign, skip (unless AE
                // itself says Missing, which wins).
                const isMissingByRegistry =
                  fxMatch !== "" && fxMatch.indexOf("Pseudo/") !== 0 && !installed[fxMatch];

                if (!isMissingByName && !isMissingByRegistry) continue;

                const issueKey = fxMatch || fxName || "(unidentified effect)";
                if (!effectIssues[issueKey]) {
                  effectIssues[issueKey] = { matchName: fxMatch, label: fxName || issueKey, usedIn: [] };
                }
                let already = false;
                for (let u = 0; u < effectIssues[issueKey].usedIn.length; u++) {
                  if (effectIssues[issueKey].usedIn[u] === item.name) { already = true; break; }
                }
                if (!already) effectIssues[issueKey].usedIn.push(item.name);
              } catch (e2) {
                // one unreadable effect must not hide the rest of the stack
              }
            }
          }
        } catch (e) {
          // a layer type without effects -- skip
        }

        // Fonts on text layers.
        if (canCheckFonts) {
          try {
            const srcText = layer.property("Source Text") as Property;
            if (srcText && srcText.value && (srcText.value as any).font) {
              const ps = String((srcText.value as any).font);
              if (ps && !seenFontSet[ps]) {
                seenFontSet[ps] = true;
                report.fontsUsed++;
                const found = appAny.fonts.getFontsByPostScriptName(ps);
                if (!found || found.length === 0) missingFontSet[ps] = true;
              }
            }
          } catch (e) {
            // non-text layer or an API shape this AE doesn't have -- skip
          }
        }
      }
    }

    report.fontsChecked = canCheckFonts;
    for (const ps in missingFontSet) {
      if (Object.prototype.hasOwnProperty.call(missingFontSet, ps)) report.missingFonts.push(ps);
    }
    for (const mn in effectIssues) {
      if (Object.prototype.hasOwnProperty.call(effectIssues, mn)) report.missingEffects.push(effectIssues[mn]);
    }

    return { success: true, report: report };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// -----------------------------------------------------------------------------
// Reveal a missing footage item's EXPECTED location in Finder/Explorer. The
// file itself is gone (that's why it's missing), so we walk UP from its
// expected path to the nearest ancestor folder that actually exists and open
// that -- lands the user as close as possible to where AE was looking. Same
// system.callSystem open/explorer approach as review.ts's revealFile.
// -----------------------------------------------------------------------------
export const preflightRevealMissing = (itemId: number): Result => {
  try {
    const item = app.project.itemByID(itemId);
    if (!(item instanceof FootageItem)) return { success: false, error: "That footage item is no longer in the project." };
    let expected: File | null = null;
    try { expected = item.file; } catch (e) { expected = null; }
    if (!expected) return { success: false, error: "This item has no file path to reveal (it may be a solid or placeholder)." };

    // Nearest existing ancestor folder.
    let folder: Folder | null = expected.parent;
    while (folder && !folder.exists) {
      const up = folder.parent;
      if (!up || up.fsName === folder.fsName) { folder = null; break; }
      folder = up;
    }
    if (!folder || !folder.exists) {
      return { success: false, error: "None of the expected folders exist on this machine:\n" + expected.fsName };
    }
    const p = folder.fsName;
    if ($.os.indexOf("Windows") !== -1) system.callSystem('explorer "' + p + '"');
    else system.callSystem('open "' + p + '"');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface PreflightRelinkResult extends Result {
  cancelled?: boolean;
  relinked?: string[];
}

// Relink a missing footage item to a user-picked file, then auto-relink any
// OTHER missing footage items whose expected filename matches a file sitting
// in the SAME folder the user just picked from. Predictable "same folder,
// exact filename" rule -- never guesses across folders, never fuzzy-matches.
// Returns cancelled:true (no error) if the user dismisses the picker.
export const preflightReplaceMissing = (itemId: number): PreflightRelinkResult => {
  try {
    const item = app.project.itemByID(itemId);
    if (!(item instanceof FootageItem)) return { success: false, error: "That footage item is no longer in the project." };

    const picked = File.openDialog("Select the replacement for: " + item.name);
    if (!picked) return { success: false, cancelled: true };

    app.beginUndoGroup("Pre-Flight Relink");
    const relinked: string[] = [];
    try {
      item.replace(picked as File);
      relinked.push(item.name);
    } catch (er) {
      app.endUndoGroup();
      return { success: false, error: "Could not relink " + item.name + ": " + er.toString() };
    }

    // Auto-relink siblings: for every other still-missing footage item, look
    // for a file with its expected NAME in the folder we just picked from.
    const folder = (picked as File).parent;
    for (let i = 1; i <= app.project.numItems; i++) {
      const other = app.project.item(i);
      if (other.id === itemId) continue;
      if (!(other instanceof FootageItem)) continue;
      let stillMissing = false;
      try { stillMissing = (other as any).footageMissing; } catch (e) { stillMissing = false; }
      if (!stillMissing) continue;

      let wantName = "";
      try { if (other.file) wantName = other.file.name; } catch (e) { wantName = ""; }
      if (!wantName) continue;

      const candidate = new File(folder.fsName + "/" + wantName);
      if (candidate.exists) {
        try {
          other.replace(candidate);
          relinked.push(other.name);
        } catch (e) {
          // one sibling failing to relink shouldn't abort the rest
        }
      }
    }
    app.endUndoGroup();
    return { success: true, relinked: relinked };
  } catch (e) {
    try { app.endUndoGroup(); } catch (e2) { /* no group open */ }
    return { success: false, error: e.toString() };
  }
};
