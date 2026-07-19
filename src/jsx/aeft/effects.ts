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
//
// AND the full installed-effects enumeration + user-pinned effects ("My
// Effects"). `app.effects` lists EVERY effect installed on this machine
// (built-in + third-party plugins, displayName/matchName/category -- the
// same list AE's own Effects & Presets panel shows), which is what lets the
// page's search cover everything, not just quickFxData.ts's curated 20.
// (An earlier comment here claimed no such API exists -- that was wrong;
// see quickFxListInstalledEffects below.)
// =============================================================================
import { Result, SETTINGS_SECTION } from "./shared";

interface ApplyEffectResult extends Result {
  message?: string;
  appliedCount?: number;
}

// --- Effect parameter value capture / restore ------------------------------
// A combo records not just WHICH effects are stacked but the artist's
// settings on each one, so re-applying reproduces the LOOK, not a stack of
// default effects. Values are captured as a flat, depth-first-ordered list
// of {matchName, value} per effect and re-applied positionally onto the
// freshly-added effect (identical matchName -> identical property tree, so
// the k-th capturable leaf lines up); the matchName is re-checked at each
// step as a safety assert so an AE-version structure drift stops rather than
// writes a value into the wrong slot.
interface CapturedProp {
  matchName: string;
  value: any;
}

// Depth-first collect of every leaf Property under an effect (recursing into
// its sub-groups, e.g. an effect's own "Transform"/"Compositing Options").
function collectEffectLeaves(group: any, out: any[]): void {
  for (let i = 1; i <= group.numProperties; i++) {
    const p = group.property(i);
    const pt = p.propertyType;
    if (pt === PropertyType.PROPERTY) {
      out.push(p);
    } else if (pt === PropertyType.INDEXED_GROUP || pt === PropertyType.NAMED_GROUP) {
      collectEffectLeaves(p, out);
    }
  }
}

// Which leaf properties carry a static value worth saving into a combo.
// Skips: group headers / custom-value params (histograms, the Curves curve
// shape -- no scriptable setValue), layer/mask references (an index that
// means nothing in another comp), and anything animated or expression-driven
// (a combo is a static look, and setValue would also nuke the animation).
function isCapturableValue(prop: any): boolean {
  const vt = prop.propertyValueType;
  if (vt === PropertyValueType.NO_VALUE || vt === PropertyValueType.CUSTOM_VALUE) return false;
  if (vt === PropertyValueType.LAYER_INDEX || vt === PropertyValueType.MASK_INDEX) return false;
  if (prop.numKeys > 0) return false;
  if (prop.expressionEnabled) return false;
  return true;
}

function captureEffectProps(fx: any): CapturedProp[] {
  const leaves: any[] = [];
  collectEffectLeaves(fx, leaves);
  const out: CapturedProp[] = [];
  for (let i = 0; i < leaves.length; i++) {
    if (!isCapturableValue(leaves[i])) continue;
    try {
      out.push({ matchName: leaves[i].matchName, value: leaves[i].value });
    } catch (e) {
      // A property that refused to read its value -- skip it, don't abort.
    }
  }
  return out;
}

// Re-applies captured values onto a freshly-added effect. Positional zip
// against the same isCapturableValue filter, with a matchName guard: on the
// first mismatch (only possible across AE versions where the effect's
// property layout changed) we stop, leaving the rest at defaults rather than
// writing values into the wrong parameters.
function applyEffectProps(fx: any, captured: CapturedProp[] | undefined): void {
  if (!captured || captured.length === 0) return;
  const leaves: any[] = [];
  collectEffectLeaves(fx, leaves);
  let idx = 0;
  for (let i = 0; i < leaves.length && idx < captured.length; i++) {
    if (!isCapturableValue(leaves[i])) continue;
    if (leaves[i].matchName !== captured[idx].matchName) break; // structure drift -> stop
    try {
      leaves[i].setValue(captured[idx].value);
    } catch (e) {
      // Value rejected (out of range / incompatible) -- leave that one at
      // default, keep going with the rest.
    }
    idx++;
  }
}

export const applyEffectToSelectedLayers = (id: string, matchName: string, displayLabel: string, category: string): ApplyEffectResult => {
  // Guards the catch's endUndoGroup so it only ever closes a group that was
  // actually opened -- the early comp/selection returns below happen BEFORE
  // beginUndoGroup, and a stray endUndoGroup with no matching begin is a
  // needless no-op/warning in AE.
  let undoOpen = false;
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };

    app.beginUndoGroup("Apply " + displayLabel);
    undoOpen = true;
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
        const added = (effectsGroup as Property).addProperty(matchName);
        // Reveal the just-added effect: select it so AE highlights it in the
        // Effect Controls / timeline, saving a hunt for the thing you just
        // applied. Its own try/catch so a reveal hiccup never counts the
        // apply itself as failed.
        try { (added as any).selected = true; } catch (e2) { /* reveal is best-effort */ }
        applied++;
      } catch (e) {
        failedLayerNames.push(layer.name);
      }
    }
    app.endUndoGroup();
    undoOpen = false;

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
    if (undoOpen) app.endUndoGroup();
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
  // The artist's settings on this effect at record time (see CapturedProp
  // above). Optional so combos saved before value-capture existed still load
  // and re-apply (they just come back at default values, as they always did).
  props?: CapturedProp[];
}

export interface EffectComboEntry {
  id: string;
  name: string;
  effects: EffectComboEffect[];
}

const QUICK_FX_COMBOS_KEY = "QuickFxCombos";

// Exported (not module-private like the recents/user-effects loaders) so
// team.ts's shared-library sync can merge team combos into this same store
// without duplicating the parse/save logic.
export function loadCombos(): EffectComboEntry[] {
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

export function saveCombos(combos: EffectComboEntry[]): void {
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
      // Capture the effect AND the artist's settings on it, so re-applying
      // reproduces the look rather than a default-valued effect.
      effects.push({ matchName: fx.matchName, label: fx.name, props: captureEffectProps(fx) });
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
  let undoOpen = false;
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
    undoOpen = true;
    let appliedLayers = 0;
    const failedNotes: string[] = [];

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const effectsGroup = layer.property("Effects");
      if (!effectsGroup) continue; // no Effects group on this layer type

      let appliedOnThisLayer = 0;
      for (let ei = 0; ei < combo.effects.length; ei++) {
        try {
          const added = (effectsGroup as Property).addProperty(combo.effects[ei].matchName);
          // Restore the artist's saved settings onto the just-added effect
          // (no-op for combos saved before value-capture, whose props are
          // undefined -- they re-apply at defaults, unchanged from before).
          applyEffectProps(added, combo.effects[ei].props);
          appliedOnThisLayer++;
        } catch (e) {
          failedNotes.push(layer.name + " (" + combo.effects[ei].label + ")");
        }
      }
      if (appliedOnThisLayer > 0) appliedLayers++;
    }
    app.endUndoGroup();
    undoOpen = false;

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
    if (undoOpen) app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// --- Combo export/import (team sharing) ------------------------------------
// Combos live in app.settings, which is per-machine -- these two move them
// through a .json file (e.g. on the studio NAS) so one artist's recorded
// look can be handed to the whole team. Same File.saveDialog/openDialog +
// ""-message-means-cancelled convention as tools.ts's
// exportCustomToolsToFile/importCustomToolsFromFile (My Tools' sharing
// feature) -- but combos are backend-owned end to end (every combo op
// returns the authoritative list), so the merge lives here, not in React.
interface ComboTransferResult extends Result {
  combos?: EffectComboEntry[];
  message?: string;
}

const COMBO_FILE_TYPE = "xyi-quickfx-combos";

export const quickFxExportCombos = (): ComboTransferResult => {
  try {
    const combos = loadCombos();
    if (combos.length === 0) return { success: false, error: "No combos to export -- record one first." };
    let file = File.saveDialog("Export combos to a shareable file", "JSON:*.json");
    if (!file) return { success: true, message: "" }; // cancelled
    if (file.name.toLowerCase().indexOf(".json") === -1) {
      file = new File(file.fsName + ".json");
    }
    file.encoding = "UTF-8";
    if (!file.open("w")) return { success: false, error: "Could not open the file for writing." };
    file.write(JSON.stringify({ type: COMBO_FILE_TYPE, version: 1, combos: combos }));
    file.close();
    return { success: true, message: "Exported " + combos.length + " combo" + (combos.length === 1 ? "" : "s") + " to " + file.fsName };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const quickFxImportCombos = (): ComboTransferResult => {
  try {
    const file = File.openDialog("Import combos from a shared file", "JSON:*.json");
    if (!file) return { success: true, message: "" }; // cancelled
    file.encoding = "UTF-8";
    if (!file.open("r")) return { success: false, error: "Could not open the file for reading." };
    const content = file.read();
    file.close();
    if (!content) return { success: true, message: "" }; // empty file -- nothing to import

    let parsed: { type?: string; combos?: EffectComboEntry[] };
    try {
      parsed = JSON.parse(content);
    } catch (e2) {
      return { success: false, error: "That file isn't valid JSON." };
    }
    if (!parsed || parsed.type !== COMBO_FILE_TYPE || !(parsed.combos instanceof Array)) {
      return { success: false, error: "That file isn't a QuickFX combos export." };
    }

    const existing = loadCombos();
    // Merge by NAME (case-insensitive): re-importing the same shared file, or
    // a combo the artist already has, skips rather than piling up duplicates.
    // Imported combos get FRESH ids -- the exporter's timestamp ids could
    // collide with (or be mistaken for) this machine's own.
    const existingNames: { [lower: string]: boolean } = {};
    for (let i = 0; i < existing.length; i++) existingNames[existing[i].name.toLowerCase()] = true;

    let added = 0;
    let skipped = 0;
    for (let i = 0; i < parsed.combos.length; i++) {
      const combo = parsed.combos[i];
      if (!combo || !combo.name || !(combo.effects instanceof Array) || combo.effects.length === 0) continue;
      if (existingNames[combo.name.toLowerCase()]) {
        skipped++;
        continue;
      }
      existing.push({
        id: "combo-" + new Date().getTime() + "-" + Math.floor(Math.random() * 100000) + "-" + i,
        name: combo.name,
        effects: combo.effects,
      });
      existingNames[combo.name.toLowerCase()] = true;
      added++;
    }
    saveCombos(existing);
    const skippedNote = skipped > 0 ? " (" + skipped + " skipped -- same name already here)" : "";
    return {
      success: true,
      combos: existing,
      message: added === 0 && skipped > 0
        ? "Nothing new -- all " + skipped + " combos in that file are already here."
        : "Imported " + added + " combo" + (added === 1 ? "" : "s") + "." + skippedNote,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Installed effects enumeration + user-pinned "My Effects" --------------
// `app.effects` is AE's own registry of every installed effect (built-in AND
// third-party plugins): an array of {displayName, matchName, category,
// version}, the same data the native Effects & Presets panel is built from.
// Because every matchName here comes straight from THIS machine's install,
// an effect found through this list can never hit the "matchName not
// recognised" failure the curated quickFxData.ts list is exposed to.
// Note: category names are AE's own (localised to the UI language, e.g.
// "Blur & Sharpen", "Color Correction") -- user-pinned effects therefore
// carry AE's category label, not one of the page's five custom groups.
export interface InstalledEffectEntry {
  displayName: string;
  matchName: string;
  category: string;
}

interface InstalledEffectsResult extends Result {
  effects?: InstalledEffectEntry[];
}

export const quickFxListInstalledEffects = (): InstalledEffectsResult => {
  try {
    const out: InstalledEffectEntry[] = [];
    const list = app.effects;
    for (let i = 0; i < list.length; i++) {
      const fx = list[i];
      // Skip entries with no matchName (can't be applied) or no display
      // name (internal/hidden registrations not worth surfacing).
      if (!fx || !fx.matchName || !fx.displayName) continue;
      out.push({ displayName: fx.displayName, matchName: fx.matchName, category: fx.category || "" });
    }
    return { success: true, effects: out };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// User-pinned effects -- the persistent "My Effects" row on the Effects
// page, fed by pinning a search hit from the installed list above. Same
// JSON-array-in-app.settings convention as recents/combos.
const QUICK_FX_USER_KEY = "QuickFxUserEffects";

function loadUserEffects(): QuickFxRecentEntry[] {
  try {
    if (!app.settings.haveSetting(SETTINGS_SECTION, QUICK_FX_USER_KEY)) return [];
    const raw = app.settings.getSetting(SETTINGS_SECTION, QUICK_FX_USER_KEY);
    if (!raw || raw.length === 0) return [];
    const parsed = JSON.parse(raw);
    if (!(parsed instanceof Array)) return [];
    return parsed as QuickFxRecentEntry[];
  } catch (e) {
    return [];
  }
}

function saveUserEffects(entries: QuickFxRecentEntry[]): void {
  app.settings.saveSetting(SETTINGS_SECTION, QUICK_FX_USER_KEY, JSON.stringify(entries));
}

export const quickFxListUserEffects = (): QuickFxRecentListResult => {
  try {
    return { success: true, effects: loadUserEffects() };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const quickFxAddUserEffect = (label: string, matchName: string, category: string): QuickFxRecentListResult => {
  try {
    const existing = loadUserEffects();
    // De-dupe by matchName -- pinning the same effect twice just re-returns
    // the current list rather than growing a duplicate pill.
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].matchName === matchName) return { success: true, effects: existing };
    }
    existing.push({ id: "user-" + matchName, label: label, matchName: matchName, category: category });
    saveUserEffects(existing);
    return { success: true, effects: existing };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const quickFxRemoveUserEffect = (id: string): QuickFxRecentListResult => {
  try {
    const existing = loadUserEffects();
    const next: QuickFxRecentEntry[] = [];
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].id !== id) next.push(existing[i]);
    }
    saveUserEffects(next);
    return { success: true, effects: next };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- matchName verification (dev / one-off self-check) ---------------------
// The curated list in quickFxData.ts uses documented-standard AE matchNames
// that a wrong string fails on SILENTLY (per-effect, counted as skipped). This
// checks a batch of them against THIS machine's actual install by adding each
// to the first selected layer and immediately removing it -- net-zero change,
// all inside one undo group -- and reports which ones AE rejects. Fed the
// curated list from the React side (as a JSON string, same transport rule as
// combos) so the single source of truth stays quickFxData.ts, not a second
// copy here.
interface VerifyResult extends Result {
  bad?: { id: string; label: string; matchName: string }[];
  checked?: number;
}

// REWRITTEN once app.effects landed: the original implementation physically
// added + removed each curated effect on a SELECTED LAYER (needed an open
// comp, a selection, and an undo group) because there was "no way" to ask AE
// what's installed. There is -- app.effects -- so this is now a pure
// membership check against AE's own registry: instant, no layer/selection
// required, nothing touched in the project. Scope also widened from just the
// curated list to EVERYTHING this page can apply, because the curated list
// is now the LEAST likely thing to be stale (it ships with the panel) --
// the real staleness risk is user-authored data referencing a third-party
// plugin that later got uninstalled: pinned My Effects and recorded combos.
// Curated entries still arrive as an argument (quickFxData.ts stays the
// single source of truth); user effects + combos are read from settings here.
export const quickFxVerifyMatchNames = (entriesJson: string): VerifyResult => {
  try {
    const entries = JSON.parse(entriesJson) as { id: string; label: string; matchName: string }[];
    if (!(entries instanceof Array)) return { success: false, error: "Nothing to verify." };

    // Plain object as a set -- ExtendScript has no Set, and shared.ts's
    // polyfills don't (and shouldn't) fake one.
    const installed: { [matchName: string]: boolean } = {};
    const registry = app.effects;
    for (let i = 0; i < registry.length; i++) {
      if (registry[i] && registry[i].matchName) installed[registry[i].matchName] = true;
    }

    const missing: string[] = [];
    let checked = 0;
    const bad: { id: string; label: string; matchName: string }[] = [];

    for (let i = 0; i < entries.length; i++) {
      checked++;
      if (!installed[entries[i].matchName]) {
        bad.push(entries[i]);
        missing.push(entries[i].label + " (curated)");
      }
    }

    const userFx = loadUserEffects();
    for (let i = 0; i < userFx.length; i++) {
      checked++;
      if (!installed[userFx[i].matchName]) {
        bad.push({ id: userFx[i].id, label: userFx[i].label, matchName: userFx[i].matchName });
        missing.push(userFx[i].label + " (My Effects)");
      }
    }

    const combos = loadCombos();
    for (let i = 0; i < combos.length; i++) {
      for (let j = 0; j < combos[i].effects.length; j++) {
        checked++;
        if (!installed[combos[i].effects[j].matchName]) {
          bad.push({ id: combos[i].id, label: combos[i].effects[j].label, matchName: combos[i].effects[j].matchName });
          missing.push(combos[i].effects[j].label + ' (combo "' + combos[i].name + '")');
        }
      }
    }

    return {
      success: true,
      checked: checked,
      bad: bad,
      message:
        missing.length === 0
          ? "All " + checked + " effects (curated + My Effects + combos) are available on this machine."
          : missing.length + " of " + checked + " missing on this machine: " + missing.join(", "),
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
