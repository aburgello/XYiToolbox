// =============================================================================
// src/jsx/aeft/effects.ts -- backend for the "Effects" quick-apply tool
// (tools/QuickFX.tsx), NOT a port of anything in toolset/. Applies a named
// AE effect (by its stable matchName, not its display name/language) to
// every selected layer in the active comp, in one undo step. Generic, not
// per-effect -- the curated button list (id/label/matchName) lives entirely
// in tools/quickFxData.ts on the React side; this file just knows how to
// add ONE effect by matchName, same "generic action + data-driven list"
// split as Toolset.tsx's own ACTIONS array.
//
// Also owns the small "recently used effects" list backing the Toolset
// grid's own "Quick FX" button (Toolset.tsx's QuickFxRecentDropletBody) --
// a fast-access droplet of the last 5 DISTINCT effects applied from either
// entry point (the full Effects page or the grid button itself), so using
// one updates the other's history too.
//
// AND the user-recorded "combo" presets (QuickFX.tsx's "My Combos" section)
// -- record whatever effects are currently stacked on a selected layer,
// name that stack, and re-apply the whole combo elsewhere in one click.
// See the "Combo effects" section further down.
// =============================================================================
import { Result, SETTINGS_SECTION } from "./shared";

interface ApplyEffectResult extends Result {
  message?: string;
  appliedCount?: number;
}

export const applyEffectToSelectedLayers = (id: string, matchName: string, displayLabel: string, category: string): ApplyEffectResult => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };

    app.beginUndoGroup("Apply " + displayLabel);
    let applied = 0;
    // Per-layer failures (missing "Effects" group -- cameras/lights/audio;
    // or a matchName AE doesn't recognise on THIS machine, e.g. a
    // third-party effect that isn't installed here) are collected rather
    // than aborting the whole batch, same "do as much as you can, report
    // what didn't work" convention as every other multi-layer loop in this
    // file (see localise.ts's renderMe()/importFilesRaw() comments).
    const failedLayerNames: string[] = [];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const effectsGroup = layer.property("Effects");
      if (!effectsGroup) continue; // no Effects group on this layer type

      try {
        (effectsGroup as Property).addProperty(matchName);
        applied++;
      } catch (e) {
        failedLayerNames.push(layer.name);
      }
    }
    app.endUndoGroup();

    if (applied === 0) {
      // Every eligible layer failed (or none were eligible) -- almost
      // always means the matchName is wrong/not installed on this machine,
      // not that the user did anything wrong. Say so plainly rather than a
      // generic "nothing happened".
      return {
        success: false,
        error:
          failedLayerNames.length > 0
            ? '"' + displayLabel + '" isn\'t available on this machine (matchName "' + matchName + '" not recognised) -- effect not installed, or the matchName needs correcting.'
            : "No eligible layers selected (cameras/lights/audio-only layers have no Effects).",
      };
    }

    // Only record a genuinely successful apply -- a failed/no-op attempt
    // shouldn't shove a broken effect to the top of "recently used".
    recordRecentEffect(id, displayLabel, matchName, category);

    const skippedNote = failedLayerNames.length > 0 ? " (skipped " + failedLayerNames.length + ": " + failedLayerNames.join(", ") + ")" : "";
    return {
      success: true,
      message: 'Applied "' + displayLabel + '" to ' + applied + " layer" + (applied === 1 ? "" : "s") + "." + skippedNote,
      appliedCount: applied,
    };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// --- Recently used effects (Toolset grid's "Quick FX" button) --------------
// Persisted as a JSON array, same app.settings-JSON convention motionTools.ts
// already established for ease presets (MotionToolsEasePresets) -- a plain
// id -> {label, matchName, category} list has no natural fit for the rest of
// this codebase's tab-separated-lines convention the way flat string rows do.
export interface QuickFxRecentEntry {
  id: string;
  label: string;
  matchName: string;
  category: string;
}

const QUICK_FX_RECENT_KEY = "QuickFxRecentEffects";
const QUICK_FX_RECENT_MAX = 5;

function loadRecentEffects(): QuickFxRecentEntry[] {
  try {
    if (!app.settings.haveSetting(SETTINGS_SECTION, QUICK_FX_RECENT_KEY)) return [];
    const raw = app.settings.getSetting(SETTINGS_SECTION, QUICK_FX_RECENT_KEY);
    if (!raw || raw.length === 0) return [];
    const parsed = JSON.parse(raw);
    if (!(parsed instanceof Array)) return [];
    return parsed as QuickFxRecentEntry[];
  } catch (e) {
    return [];
  }
}

function saveRecentEffects(entries: QuickFxRecentEntry[]): void {
  app.settings.saveSetting(SETTINGS_SECTION, QUICK_FX_RECENT_KEY, JSON.stringify(entries));
}

// Moves `id` to the front (de-duped, not just prepended -- re-using an
// effect shouldn't leave a stale second copy further down the list) and
// caps at QUICK_FX_RECENT_MAX, oldest dropped first.
function recordRecentEffect(id: string, label: string, matchName: string, category: string): void {
  const existing = loadRecentEffects();
  const next: QuickFxRecentEntry[] = [{ id, label, matchName, category }];
  for (let i = 0; i < existing.length; i++) {
    if (existing[i].id !== id) next.push(existing[i]);
  }
  if (next.length > QUICK_FX_RECENT_MAX) next.length = QUICK_FX_RECENT_MAX;
  saveRecentEffects(next);
}

interface QuickFxRecentListResult extends Result {
  effects?: QuickFxRecentEntry[];
}

export const quickFxListRecentEffects = (): QuickFxRecentListResult => {
  try {
    return { success: true, effects: loadRecentEffects() };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Combo effects (user-recorded multi-effect presets) --------------------
// "Record what's applied to a layer right now, give it a name, re-apply the
// whole stack in one click later" -- a combo is a small ordered list of
// {matchName, label} pairs (matchName is what actually gets re-applied,
// label is just for display since a renamed effect layer instance can carry
// a custom label that isn't its real matchName). Distinct from a single
// QUICK_FX entry (quickFxData.ts's curated 20) and from the "recently used"
// list above -- a combo is user-authored, not auto-tracked, and can bundle
// several effects at once. Same JSON-array-in-app.settings convention as
// both features above and motionTools.ts's ease presets.
export interface EffectComboEffect {
  matchName: string;
  label: string;
}

export interface EffectComboEntry {
  id: string;
  name: string;
  effects: EffectComboEffect[];
}

const QUICK_FX_COMBOS_KEY = "QuickFxCombos";

function loadCombos(): EffectComboEntry[] {
  try {
    if (!app.settings.haveSetting(SETTINGS_SECTION, QUICK_FX_COMBOS_KEY)) return [];
    const raw = app.settings.getSetting(SETTINGS_SECTION, QUICK_FX_COMBOS_KEY);
    if (!raw || raw.length === 0) return [];
    const parsed = JSON.parse(raw);
    if (!(parsed instanceof Array)) return [];
    return parsed as EffectComboEntry[];
  } catch (e) {
    return [];
  }
}

function saveCombos(combos: EffectComboEntry[]): void {
  app.settings.saveSetting(SETTINGS_SECTION, QUICK_FX_COMBOS_KEY, JSON.stringify(combos));
}

interface ComboListResult extends Result {
  combos?: EffectComboEntry[];
}

export const quickFxListCombos = (): ComboListResult => {
  try {
    return { success: true, combos: loadCombos() };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface ComboEffectsReadResult extends Result {
  effects?: EffectComboEffect[];
  layerName?: string;
}

// Reads the applied effects off the FIRST selected layer -- a combo is one
// stack, so a multi-layer selection would be ambiguous about which layer's
// effects to capture. Returns matchName (what actually gets re-applied) AND
// the effect's current display name (.name, which can differ from its
// built-in label if the artist renamed the effect instance) so the saved
// combo's own summary reads like what the artist actually sees in the
// Effects panel, not a raw matchName string.
export const quickFxGetSelectedLayerEffects = (): ComboEffectsReadResult => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select a layer first." };

    const layer = layers[0];
    const effectsGroup = layer.property("Effects");
    if (!effectsGroup) return { success: false, error: "This layer type has no Effects." };

    const group = effectsGroup as Property;
    const effects: EffectComboEffect[] = [];
    for (let i = 1; i <= group.numProperties; i++) {
      const fx = group.property(i) as Property;
      effects.push({ matchName: fx.matchName, label: fx.name });
    }
    if (effects.length === 0) {
      return { success: false, error: '"' + layer.name + '" has no effects applied -- add one first, then record it as a combo.' };
    }
    return { success: true, effects, layerName: layer.name };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const quickFxSaveCombo = (name: string, effectsJson: string): ComboListResult => {
  try {
    const trimmedName = name && name.length > 0 ? name : "Untitled Combo";
    // Same "transport as a JSON string, JSON.parse on this side" pattern
    // motionTools.ts's ease copy/paste settled on -- a nested array of
    // objects spliced directly into the eval'd ExtendScript source can lose
    // its inner values (see that file's round-3 note), a single string
    // survives the splice intact.
    const effects = JSON.parse(effectsJson) as EffectComboEffect[];
    if (!(effects instanceof Array) || effects.length === 0) {
      return { success: false, error: "Nothing to save -- no effects captured." };
    }
    const combos = loadCombos();
    // Plain timestamp + random-suffix id -- ExtendScript has no
    // crypto.randomUUID, and this only ever needs to be unique on one
    // machine's own local settings, not globally.
    const id = "combo-" + new Date().getTime() + "-" + Math.floor(Math.random() * 100000);
    combos.push({ id, name: trimmedName, effects });
    saveCombos(combos);
    return { success: true, combos };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const quickFxRenameCombo = (id: string, newName: string): ComboListResult => {
  try {
    const trimmedName = newName && newName.length > 0 ? newName : "Untitled Combo";
    const combos = loadCombos();
    let found = false;
    for (let i = 0; i < combos.length; i++) {
      if (combos[i].id === id) {
        combos[i].name = trimmedName;
        found = true;
        break;
      }
    }
    if (!found) return { success: false, error: "Combo not found -- it may have already been deleted." };
    saveCombos(combos);
    return { success: true, combos };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const quickFxDeleteCombo = (id: string): ComboListResult => {
  try {
    const combos = loadCombos();
    const next: EffectComboEntry[] = [];
    for (let i = 0; i < combos.length; i++) {
      if (combos[i].id !== id) next.push(combos[i]);
    }
    saveCombos(next);
    return { success: true, combos: next };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Applies every effect in a saved combo, in stack order, to every selected
// layer, in one undo group -- same per-layer/per-effect "collect failures,
// don't abort the batch" convention as applyEffectToSelectedLayers above,
// just one extra loop level (effects within each layer).
export const quickFxApplyCombo = (id: string): ApplyEffectResult => {
  try {
    const combos = loadCombos();
    let combo: EffectComboEntry | null = null;
    for (let i = 0; i < combos.length; i++) {
      if (combos[i].id === id) {
        combo = combos[i];
        break;
      }
    }
    if (!combo) return { success: false, error: "Combo not found -- it may have already been deleted." };

    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };

    app.beginUndoGroup("Apply Combo: " + combo.name);
    let appliedLayers = 0;
    const failedNotes: string[] = [];

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const effectsGroup = layer.property("Effects");
      if (!effectsGroup) continue; // no Effects group on this layer type

      let appliedOnThisLayer = 0;
      for (let ei = 0; ei < combo.effects.length; ei++) {
        try {
          (effectsGroup as Property).addProperty(combo.effects[ei].matchName);
          appliedOnThisLayer++;
        } catch (e) {
          failedNotes.push(layer.name + " (" + combo.effects[ei].label + ")");
        }
      }
      if (appliedOnThisLayer > 0) appliedLayers++;
    }
    app.endUndoGroup();

    if (appliedLayers === 0) {
      return {
        success: false,
        error: "No eligible layers selected (cameras/lights/audio have no Effects), or none of this combo's effects are recognised on this machine.",
      };
    }

    const skippedNote = failedNotes.length > 0 ? " (skipped: " + failedNotes.join(", ") + ")" : "";
    return {
      success: true,
      message:
        'Applied "' +
        combo.name +
        '" (' +
        combo.effects.length +
        " effect" +
        (combo.effects.length === 1 ? "" : "s") +
        ") to " +
        appliedLayers +
        " layer" +
        (appliedLayers === 1 ? "" : "s") +
        "." +
        skippedNote,
    };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};
