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

interface PreflightReport {
  projectName: string;
  compCount: number;
  footageCount: number;
  missingFootage: string[];
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
          if ((item as any).footageMissing) report.missingFootage.push(item.name);
        } catch (e) {
          // solids/placeholders can lack the flag -- not missing
        }
        continue;
      }

      if (!(item instanceof CompItem)) continue;
      report.compCount++;

      for (let li = 1; li <= item.numLayers; li++) {
        const layer = item.layer(li);

        // Effects on this layer vs the installed registry.
        try {
          const fxGroup = layer.property("ADBE Effect Parade");
          if (fxGroup) {
            const group = fxGroup as Property;
            for (let fi = 1; fi <= group.numProperties; fi++) {
              const fx = group.property(fi) as Property;
              if (!fx || !fx.matchName) continue;
              // Expression/pseudo controls saved into projects aren't in
              // app.effects on any machine -- skip the known-benign one.
              if (fx.matchName.indexOf("Pseudo/") === 0) continue;
              if (!installed[fx.matchName]) {
                if (!effectIssues[fx.matchName]) {
                  effectIssues[fx.matchName] = { matchName: fx.matchName, label: fx.name, usedIn: [] };
                }
                let already = false;
                for (let u = 0; u < effectIssues[fx.matchName].usedIn.length; u++) {
                  if (effectIssues[fx.matchName].usedIn[u] === item.name) { already = true; break; }
                }
                if (!already) effectIssues[fx.matchName].usedIn.push(item.name);
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
