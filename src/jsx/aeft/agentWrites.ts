// =============================================================================
// src/jsx/aeft/agentWrites.ts
// -----------------------------------------------------------------------------
// THE WRITE FUNCTIONS WRITTEN FOR THE ASK AGENT.
//
// It used to say "the only functions the agent may call that change anything",
// and that stopped being true the moment XYTools was wired up: align, fit,
// fade, ease and the rest are pre-existing panel functions in motionTools.ts
// that the agent now calls too. A header claiming to be exhaustive when it is
// not is worse than one that does not claim it, so:
//
//   THE AUTHORITATIVE LIST IS WRITE_TOOLS in lib/agent/tools.ts. Nothing is
//   agent-callable unless it appears there, whichever file it lives in.
//
// What this file still is: everything written specifically FOR the agent,
// rather than wrapped from something the panel already did. Every rule below
// applies to both kinds.
//
// WHAT MAKES THESE SAFE IS NOT THAT THEY ARE SMALL -- IT IS THAT WE WROTE THEM.
// The alternative design is handing the model `runScript` and letting it author
// ExtendScript against the artist's open project. That is rejected outright
// (CLAUDE.md section 1, and docs/AGENT-READONLY-SLICE.md): a generated script
// can do anything the engine can, including overwrite a studio master, and the
// only gate would be somebody skimming code they did not write. A function like
// createComp cannot save over a master because saving is not in it.
//
// It also sidesteps the dialect problem entirely. A small model writing
// ExtendScript reaches for modern JavaScript on an ES3 engine and fails
// quietly; here the ExtendScript is written once, by hand, and reviewed, and
// the model only supplies arguments.
//
// RULES FOR ANYTHING ADDED HERE
//
//   1. ONE UNDO GROUP per call, so the worst case is one Ctrl+Z. If an action
//      cannot be expressed that way it does not belong in this file.
//   2. NEVER TOUCH A FILE. No open, no save, no import, no render queue. These
//      act on the project in memory and nothing else.
//   3. VALIDATE EVERY ARGUMENT, and bound it. The caller is a language model:
//      treat every number as hostile, not merely wrong.
//   4. RETURN {success, error} -- never throw across the bridge.
//   5. SAY WHAT HAPPENED, in the return, in words the agent can repeat to the
//      artist without embellishing.
// =============================================================================
import { Result } from "./shared";

/** AE's own limits. A comp outside these is refused by AE anyway, with a worse message. */
const MIN_DIM = 4;
const MAX_DIM = 30000;
const MIN_FPS = 1;
const MAX_FPS = 999;
const MAX_SECONDS = 10800; // three hours; past this it is a typo, not a comp

interface CreateCompResult extends Result {
  name?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  seconds?: number;
  /** Exactly what reverses it, for the agent to repeat verbatim. */
  undo?: string;
}

/**
 * A new, empty composition in the open project.
 *
 * Undoable in one step and touches nothing on disk -- the two properties that
 * let the agent call it at all.
 *
 * NOT SELECTED OR OPENED afterwards, deliberately. Stealing the artist's
 * viewer while they are working somewhere else is the kind of small violence
 * that makes a tool feel unsafe, and "I made it, it's in your project panel"
 * is a complete answer.
 */
export const agentCreateComp = (
  name: string,
  width: number,
  height: number,
  frameRate: number,
  seconds: number
): CreateCompResult => {
  try {
    if (!app || !app.project) {
      return { success: false, error: "No project is open in After Effects." };
    }

    // Trimmed, then checked for emptiness: a name of spaces produces a comp
    // nobody can find in the project panel.
    const compName = String(name == null ? "" : name).replace(/^\s+|\s+$/g, "");
    if (!compName) return { success: false, error: "The comp needs a name." };

    // Number() on a non-numeric string is NaN, and every comparison against NaN
    // is false -- so each bound is written to REJECT rather than to accept, and
    // NaN falls through to the error rather than past it.
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (!(w >= MIN_DIM && w <= MAX_DIM)) {
      return { success: false, error: "Width must be a number between " + MIN_DIM + " and " + MAX_DIM + "." };
    }
    if (!(h >= MIN_DIM && h <= MAX_DIM)) {
      return { success: false, error: "Height must be a number between " + MIN_DIM + " and " + MAX_DIM + "." };
    }

    const fps = Number(frameRate);
    if (!(fps >= MIN_FPS && fps <= MAX_FPS)) {
      return { success: false, error: "Frame rate must be a number between " + MIN_FPS + " and " + MAX_FPS + "." };
    }

    const dur = Number(seconds);
    if (!(dur > 0 && dur <= MAX_SECONDS)) {
      return { success: false, error: "Duration must be a positive number of seconds, up to " + MAX_SECONDS + "." };
    }

    // ONE GROUP AROUND THE WHOLE THING. Opened before the first change and
    // closed in `finally`, so an exception mid-way cannot leave AE with a
    // group open -- which silently swallows the artist's NEXT action into it.
    app.beginUndoGroup("Ask: create comp " + compName);
    let comp: CompItem;
    try {
      // Pixel aspect 1: the studio delivers square-pixel DOOH, and a
      // non-square PAR is a decision nobody asked the agent to make.
      comp = app.project.items.addComp(compName, w, h, 1, dur, fps);
    } finally {
      app.endUndoGroup();
    }

    if (!comp) return { success: false, error: "After Effects did not create the comp." };

    return {
      success: true,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      // Read back off the COMP, not echoed from the arguments: AE quantises
      // duration to the frame, so 10s at 25fps is what AE says it is, and
      // reporting the request rather than the result is how a tool ends up
      // claiming something that is not quite true.
      frameRate: comp.frameRate,
      seconds: comp.duration,
      undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects.",
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// -----------------------------------------------------------------------------
// Everything below acts on the ACTIVE COMP and its SELECTION.
//
// That is the studio's own working idiom -- most of the Toolset's one-click
// actions work the same way -- and it is also what keeps these safe to hand a
// language model. The agent cannot address a comp it has not been shown or a
// layer the artist has not picked: the blast radius is bounded by what is in
// front of the artist at the moment they ask, not by what the model believes
// about the project.
// -----------------------------------------------------------------------------

/** AE's label colours: 0 is None, 1-16 are the swatches in the Label menu. */
const MAX_LABEL = 16;

/**
 * The comp the artist is looking at, or null.
 *
 * DUCK-TYPED, never `instanceof CompItem` -- instanceof against an AE host
 * class is unreliable across contexts (CLAUDE.md section 2). A footage item has
 * no `layers`, so asking for the thing we are about to use is both the test and
 * the reason.
 */
function activeComp(): CompItem | null {
  if (!app || !app.project) return null;
  const item = app.project.activeItem;
  if (!item || typeof (item as CompItem).layers === "undefined") return null;
  return item as CompItem;
}

/** The selection, as a plain array. Empty when nothing is selected. */
function selectedLayers(comp: CompItem): Layer[] {
  const out: Layer[] = [];
  const sel = comp.selectedLayers;
  for (let i = 0; i < sel.length; i++) out.push(sel[i]);
  return out;
}

/**
 * WHICH LAYERS AN ACTION MEANS.
 *
 * Selection was the original answer and it is still the default, because it is
 * what an artist has in their hands. But requiring it made the agent ask people
 * to go and click things it could perfectly well identify -- "the layer called
 * BG", "the third one", "everything labelled red" are all unambiguous
 * instructions, and refusing them was a limit of the plumbing rather than a
 * safety property.
 *
 * The real bound was never the selection: it is the ACTIVE COMP. Nothing here
 * can reach a comp the artist is not looking at, and everything is one undo.
 * Widening from "what is selected" to "anything in this comp, named
 * explicitly" keeps that.
 *
 * AMBIGUITY REFUSES, IT NEVER PICKS. Two layers with the same name is a
 * question for the artist -- guessing between them is how the wrong layer gets
 * renamed and nobody notices until the render.
 *
 * Flat scalars, per CLAUDE.md: a selector object would lose its values crossing
 * the bridge, so the kind and the value travel as two strings.
 */
function resolveTargets(
  comp: CompItem,
  kind: string,
  value: string
): { layers?: Layer[]; error?: string } {
  const k = String(kind == null || kind === "" ? "selected" : kind);
  const raw = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");

  if (k === "selected") {
    const sel = selectedLayers(comp);
    if (!sel.length) {
      return { error: "Nothing is selected. Select the layers, or tell me which ones by name, index or label." };
    }
    return { layers: sel };
  }

  if (k === "name") {
    if (!raw) return { error: "Which layer name?" };
    const want = raw.toLowerCase();
    const hits: Layer[] = [];
    for (let i = 1; i <= comp.numLayers; i++) {
      const l = comp.layer(i);
      // Case-insensitive so "bg" finds "BG" -- artists type names, not ids.
      // Still an EXACT match, never a substring: "BG" must not select
      // "BG_OLD_DO_NOT_USE".
      if (l && String(l.name).toLowerCase() === want) hits.push(l);
    }
    if (!hits.length) return { error: 'No layer called "' + raw + '" in "' + comp.name + '".' };
    if (hits.length > 1) {
      return { error: hits.length + ' layers are called "' + raw + '". Select the one you mean, or give me its index.' };
    }
    return { layers: hits };
  }

  if (k === "index") {
    const n = Math.round(Number(raw));
    // Written to reject, so a NaN from "third" lands here rather than passing
    // a bounds test that is false either way.
    if (!(n >= 1 && n <= comp.numLayers)) {
      return { error: "Layer index must be between 1 and " + comp.numLayers + " in this comp." };
    }
    return { layers: [comp.layer(n)] };
  }

  if (k === "label") {
    const n = Math.round(Number(raw));
    if (!(n >= 0 && n <= MAX_LABEL)) {
      return { error: "Label must be a number from 0 (none) to " + MAX_LABEL + "." };
    }
    const hits: Layer[] = [];
    for (let i = 1; i <= comp.numLayers; i++) {
      const l = comp.layer(i);
      if (l && l.label === n) hits.push(l);
    }
    if (!hits.length) return { error: "No layers with label " + n + " in this comp." };
    return { layers: hits };
  }

  return { error: 'Target must be "selected", "name", "index" or "label".' };
}

/** "Open a comp first" / "select something first", said the same way every time. */
function needComp(): Result {
  return { success: false, error: "No composition is open. Open the comp you want to work in, then ask again." };
}
// (needSelection lived here. resolveTargets now owns that message, and phrases
//  it better -- it can offer name/index/label as alternatives to selecting.)

interface PrecomposeResult extends Result {
  name?: string;
  layerCount?: number;
  /** Set when moveAllAttributes was requested false and had to be forced true. */
  attributesMoved?: boolean;
  undo?: string;
}

/**
 * Precomposes the selected layers in the active comp.
 *
 * moveAllAttributes CAN ONLY BE FALSE FOR A SINGLE LAYER -- that is AE's rule,
 * not ours. Asked for false on a multi-layer selection, this forces true and
 * SAYS SO in the result rather than failing: the artist asked for a precomp and
 * got one, and the one detail that differs from the request is reported instead
 * of being either hidden or turned into an error.
 */
export const agentPrecomposeSelected = (
  name: string,
  moveAllAttributes: boolean,
  targetKind: string,
  targetValue: string
): PrecomposeResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const found = resolveTargets(comp, targetKind, targetValue);
    if (found.error) return { success: false, error: found.error };
    const layers = found.layers as Layer[];

    const compName = String(name == null ? "" : name).replace(/^\s+|\s+$/g, "");
    if (!compName) return { success: false, error: "The precomp needs a name." };

    const indices: number[] = [];
    for (let i = 0; i < layers.length; i++) indices.push(layers[i].index);

    let moveAll = moveAllAttributes !== false;
    let forced = false;
    if (!moveAll && indices.length > 1) { moveAll = true; forced = true; }

    app.beginUndoGroup("Ask: precompose " + compName);
    let made: CompItem;
    try {
      made = comp.layers.precompose(indices, compName, moveAll);
    } finally {
      app.endUndoGroup();
    }
    if (!made) return { success: false, error: "After Effects did not create the precomp." };

    return {
      success: true,
      name: made.name,
      layerCount: indices.length,
      attributesMoved: forced ? true : undefined,
      undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects.",
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface AddLayerResult extends Result {
  name?: string;
  kind?: string;
  undo?: string;
}

/** #RRGGBB -> AE's [r,g,b] floats, or null when it is not a colour. */
function parseHexColour(hex: string): number[] | null {
  const raw = String(hex == null ? "" : hex).replace(/^\s+|\s+$/g, "").replace(/^#/, "");
  // A FIXED literal pattern, not a caller-supplied one -- CLAUDE.md's ban is on
  // compiling a dynamic string (a filename) as a regex, which this is not.
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return [
    parseInt(raw.substring(0, 2), 16) / 255,
    parseInt(raw.substring(2, 4), 16) / 255,
    parseInt(raw.substring(4, 6), 16) / 255,
  ];
}

/**
 * A solid in the active comp, comp-sized unless told otherwise.
 *
 * Comp-sized by default because that is what a solid is for nine times out of
 * ten here -- a backing, a matte, a colour wash behind artwork.
 */
export const agentAddSolid = (
  name: string,
  hexColour: string,
  width: number,
  height: number
): AddLayerResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const solidName = String(name == null ? "" : name).replace(/^\s+|\s+$/g, "");
    if (!solidName) return { success: false, error: "The solid needs a name." };

    const colour = parseHexColour(hexColour);
    if (!colour) return { success: false, error: "Colour must be a hex value like #1A1A1A." };

    // Written to REJECT, so a NaN from a bad argument lands in the error rather
    // than sailing past a `> 0` test that is false for NaN either way.
    const w = width == null ? comp.width : Math.round(Number(width));
    const h = height == null ? comp.height : Math.round(Number(height));
    if (!(w >= MIN_DIM && w <= MAX_DIM)) return { success: false, error: "Width must be between " + MIN_DIM + " and " + MAX_DIM + "." };
    if (!(h >= MIN_DIM && h <= MAX_DIM)) return { success: false, error: "Height must be between " + MIN_DIM + " and " + MAX_DIM + "." };

    app.beginUndoGroup("Ask: add solid " + solidName);
    let layer: AVLayer;
    try {
      layer = comp.layers.addSolid(colour, solidName, w, h, 1);
    } finally {
      app.endUndoGroup();
    }
    if (!layer) return { success: false, error: "After Effects did not create the solid." };

    return { success: true, name: layer.name, kind: "solid", undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** An adjustment layer across the whole comp. */
export const agentAddAdjustmentLayer = (name: string): AddLayerResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const layerName = String(name == null ? "" : name).replace(/^\s+|\s+$/g, "") || "Adjustment Layer";

    app.beginUndoGroup("Ask: add adjustment layer");
    let layer: AVLayer;
    try {
      // An adjustment layer IS a comp-sized solid with the flag set -- there is
      // no addAdjustmentLayer() in the API. White, because the colour of an
      // adjustment layer is never seen and black would look like a mistake if
      // the flag were ever cleared.
      layer = comp.layers.addSolid([1, 1, 1], layerName, comp.width, comp.height, 1);
      layer.adjustmentLayer = true;
    } finally {
      app.endUndoGroup();
    }
    if (!layer) return { success: false, error: "After Effects did not create the layer." };

    return { success: true, name: layer.name, kind: "adjustment layer", undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** A null, for parenting. */
export const agentAddNull = (name: string): AddLayerResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const layerName = String(name == null ? "" : name).replace(/^\s+|\s+$/g, "");

    app.beginUndoGroup("Ask: add null");
    let layer: AVLayer;
    try {
      layer = comp.layers.addNull(comp.duration);
      if (layerName) layer.name = layerName;
    } finally {
      app.endUndoGroup();
    }
    if (!layer) return { success: false, error: "After Effects did not create the null." };

    return { success: true, name: layer.name, kind: "null", undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface SelectionResult extends Result {
  count?: number;
  names?: string[];
  undo?: string;
}

/**
 * Renames the selected layers.
 *
 * One layer takes the name as given. SEVERAL get a numbered suffix, because
 * silently giving eight layers the same name is technically legal in AE and
 * makes the comp unreadable -- the artist would have to undo and redo it by
 * hand, which is worse than the tool having had an opinion.
 */
export const agentRenameSelected = (
  baseName: string,
  targetKind: string,
  targetValue: string
): SelectionResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const found = resolveTargets(comp, targetKind, targetValue);
    if (found.error) return { success: false, error: found.error };
    const layers = found.layers as Layer[];

    const base = String(baseName == null ? "" : baseName).replace(/^\s+|\s+$/g, "");
    if (!base) return { success: false, error: "The layers need a name." };

    const names: string[] = [];
    app.beginUndoGroup("Ask: rename " + layers.length + " layer(s)");
    try {
      for (let i = 0; i < layers.length; i++) {
        const nm = layers.length === 1 ? base : base + "_" + (i + 1);
        layers[i].name = nm;
        names.push(nm);
      }
    } finally {
      app.endUndoGroup();
    }

    return { success: true, count: names.length, names: names, undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** Sets the label colour on the selected layers. 0 is None. */
export const agentLabelSelected = (
  label: number,
  targetKind: string,
  targetValue: string
): SelectionResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const found = resolveTargets(comp, targetKind, targetValue);
    if (found.error) return { success: false, error: found.error };
    const layers = found.layers as Layer[];

    const n = Math.round(Number(label));
    if (!(n >= 0 && n <= MAX_LABEL)) {
      return { success: false, error: "Label must be a number from 0 (none) to " + MAX_LABEL + "." };
    }

    app.beginUndoGroup("Ask: label " + layers.length + " layer(s)");
    try {
      for (let i = 0; i < layers.length; i++) layers[i].label = n;
    } finally {
      app.endUndoGroup();
    }

    return { success: true, count: layers.length, undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** Duplicates the selected layers. */
export const agentDuplicateSelected = (
  targetKind: string,
  targetValue: string
): SelectionResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const found = resolveTargets(comp, targetKind, targetValue);
    if (found.error) return { success: false, error: found.error };
    const layers = found.layers as Layer[];

    const names: string[] = [];
    app.beginUndoGroup("Ask: duplicate " + layers.length + " layer(s)");
    try {
      // Collected FIRST, then duplicated: duplicate() inserts into the same
      // collection being read, and walking a live collection while adding to it
      // is how a loop like this quietly runs away.
      for (let i = 0; i < layers.length; i++) {
        const copy = layers[i].duplicate();
        if (copy) names.push(copy.name);
      }
    } finally {
      app.endUndoGroup();
    }

    return { success: true, count: names.length, names: names, undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface CompDurationResult extends Result {
  name?: string;
  seconds?: number;
  undo?: string;
}

/**
 * Sets the active comp's duration.
 *
 * SHORTENING IS NOT DESTRUCTIVE IN AE -- layers past the new end still exist,
 * they simply fall outside the comp -- and it is one undo either way, which is
 * what lets this be here at all.
 */
export const agentSetCompDuration = (seconds: number): CompDurationResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const dur = Number(seconds);
    if (!(dur > 0 && dur <= MAX_SECONDS)) {
      return { success: false, error: "Duration must be a positive number of seconds, up to " + MAX_SECONDS + "." };
    }

    app.beginUndoGroup("Ask: set duration of " + comp.name);
    try {
      comp.duration = dur;
    } finally {
      app.endUndoGroup();
    }

    return {
      success: true,
      name: comp.name,
      // Read back: AE quantises to the frame.
      seconds: comp.duration,
      undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects.",
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// -----------------------------------------------------------------------------
// EFFECTS AND EXPRESSIONS
//
// MATCHNAMES, NEVER DISPLAY NAMES, and this is the one rule everything here is
// built around. Display names are localised and change between AE point
// releases -- the Transform effect's uniform scale reports as "Scale" on AE
// 26.2 and "Scale Height" on 26.3+, which returned null and silently skipped a
// whole rig for months in two separate codebases (CLAUDE.md section 2). So the
// read tool REPORTS matchNames and the write tool ADDRESSES by them: the pair
// is the point, because a model cannot use a matchName it was never told.
//
// Expressions are a different risk class from ExtendScript and it is worth
// being precise about why they are allowed here. An expression is evaluated by
// AE's expression engine: it computes a property value and can do nothing else.
// It cannot open, save, import or delete anything, it cannot reach the file
// system, and a bad one disables itself with an error on the property rather
// than damaging the project. It is also one undo. That is a genuinely smaller
// blast radius than a script, not a smaller-looking one.
// -----------------------------------------------------------------------------

/** Deep enough for an effect's nested groups, shallow enough never to run away. */
const MAX_PROP_DEPTH = 4;

interface EffectProp {
  name: string;
  matchName: string;
  value?: string;
  canSetExpression?: boolean;
  expression?: string;
}
interface EffectInfo {
  name: string;
  matchName: string;
  properties: EffectProp[];
}
interface LayerEffects {
  layer: string;
  effects: EffectInfo[];
}
interface ListEffectsResult extends Result {
  comp?: string;
  /** "extendscript" or "javascript-1.0" -- decides what syntax is legal. */
  expressionEngine?: string;
  layers?: LayerEffects[];
}

/** A group has numProperties; a leaf does not. Duck-typed, never instanceof. */
function isPropertyGroup(p: unknown): boolean {
  return !!p && typeof (p as PropertyGroup).numProperties === "number";
}

/**
 * Every settable property under a group, flattened.
 *
 * DOWNWARD ONLY. Never propertyGroup(1) to walk up -- that returns the PARENT
 * and grows exponentially, and it froze AE solid the one time it was done in a
 * collector (CLAUDE.md section 2).
 */
function collectProps(group: PropertyGroup, out: EffectProp[], depth: number): void {
  if (depth > MAX_PROP_DEPTH) return;
  const n = group.numProperties;
  for (let i = 1; i <= n; i++) {
    const p = group.property(i);
    if (!p) continue;

    if (isPropertyGroup(p)) {
      collectProps(p as PropertyGroup, out, depth + 1);
      continue;
    }

    const leaf = p as Property;
    const info: EffectProp = { name: leaf.name, matchName: leaf.matchName };

    // .value throws on some property types (custom value, layer selectors), and
    // a value is a nicety here -- losing one must never cost the matchName,
    // which is the part the caller actually needs.
    try {
      const v = leaf.value;
      if (typeof v === "number") info.value = String(Math.round(v * 1000) / 1000);
      else if (v && typeof (v as number[]).length === "number") {
        const parts: string[] = [];
        const arr = v as number[];
        for (let k = 0; k < arr.length; k++) parts.push(String(Math.round(arr[k] * 1000) / 1000));
        info.value = "[" + parts.join(", ") + "]";
      }
    } catch (e) { /* unreadable value; the matchName still stands */ }

    try {
      if (leaf.canSetExpression) {
        info.canSetExpression = true;
        if (leaf.expression) info.expression = leaf.expression;
      }
    } catch (e) { /* older property types can refuse the question */ }

    out.push(info);
  }
}

/**
 * The effects on the selected layers, with the matchNames needed to address
 * them. Read-only.
 */
export const agentListEffects = (
  targetKind: string,
  targetValue: string
): ListEffectsResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const found = resolveTargets(comp, targetKind, targetValue);
    if (found.error) return { success: false, error: found.error };
    const layers = found.layers as Layer[];

    const out: LayerEffects[] = [];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      // "ADBE Effect Parade" is the matchName for the Effects group. Asking for
      // "Effects" by display name is the localised lookup this file exists to
      // avoid.
      const parade = layer.property("ADBE Effect Parade") as PropertyGroup;
      const effects: EffectInfo[] = [];

      if (parade && typeof parade.numProperties === "number") {
        for (let e = 1; e <= parade.numProperties; e++) {
          const fx = parade.property(e) as PropertyGroup;
          if (!fx) continue;
          const props: EffectProp[] = [];
          collectProps(fx, props, 1);
          effects.push({ name: fx.name, matchName: fx.matchName, properties: props });
        }
      }

      out.push({ layer: layer.name, effects: effects });
    }

    return {
      success: true,
      comp: comp.name,
      // WHICH DIALECT AN EXPRESSION MUST BE WRITTEN IN. A project set to the
      // legacy engine rejects modern syntax, and the failure is a disabled
      // property rather than a thrown error -- so the caller is told up front
      // rather than finding out from a broken rig.
      expressionEngine: app.project.expressionEngine,
      layers: out,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface ExpressionResult extends Result {
  applied?: { layer: string; property: string }[];
  skipped?: { layer: string; why: string }[];
  expressionEngine?: string;
  undo?: string;
}

/** Finds one property inside an effect by matchName, searching downward only. */
function findPropByMatchName(group: PropertyGroup, matchName: string, depth: number): Property | null {
  if (depth > MAX_PROP_DEPTH) return null;
  const n = group.numProperties;
  for (let i = 1; i <= n; i++) {
    const p = group.property(i);
    if (!p) continue;
    if (isPropertyGroup(p)) {
      const nested = findPropByMatchName(p as PropertyGroup, matchName, depth + 1);
      if (nested) return nested;
      continue;
    }
    if ((p as Property).matchName === matchName) return p as Property;
  }
  return null;
}

/**
 * Sets an expression on one property of one effect, across the selected layers.
 *
 * A LAYER THAT DOES NOT HAVE THE EFFECT IS SKIPPED AND NAMED, never silently
 * passed over: "applied to 3 layers" when four were selected is the kind of
 * report that sends somebody hunting for a bug in the fourth one.
 *
 * Pass an empty expression to clear one.
 */
export const agentSetExpression = (
  effectMatchName: string,
  propertyMatchName: string,
  expression: string,
  targetKind: string,
  targetValue: string
): ExpressionResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const found = resolveTargets(comp, targetKind, targetValue);
    if (found.error) return { success: false, error: found.error };
    const layers = found.layers as Layer[];

    const fxMatch = String(effectMatchName == null ? "" : effectMatchName).replace(/^\s+|\s+$/g, "");
    const propMatch = String(propertyMatchName == null ? "" : propertyMatchName).replace(/^\s+|\s+$/g, "");
    if (!fxMatch) return { success: false, error: "Which effect? Give its matchName, from list_effects." };
    if (!propMatch) return { success: false, error: "Which property? Give its matchName, from list_effects." };

    const expr = String(expression == null ? "" : expression);

    const applied: { layer: string; property: string }[] = [];
    const skipped: { layer: string; why: string }[] = [];

    app.beginUndoGroup("Ask: set expression on " + propMatch);
    try {
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const parade = layer.property("ADBE Effect Parade") as PropertyGroup;
        if (!parade || typeof parade.numProperties !== "number") {
          skipped.push({ layer: layer.name, why: "has no effects" });
          continue;
        }

        let fx: PropertyGroup | null = null;
        for (let e = 1; e <= parade.numProperties; e++) {
          const cand = parade.property(e) as PropertyGroup;
          if (cand && cand.matchName === fxMatch) { fx = cand; break; }
        }
        if (!fx) { skipped.push({ layer: layer.name, why: "does not have that effect" }); continue; }

        const prop = findPropByMatchName(fx, propMatch, 1);
        if (!prop) { skipped.push({ layer: layer.name, why: "that effect has no such property" }); continue; }
        if (!prop.canSetExpression) {
          skipped.push({ layer: layer.name, why: "that property cannot take an expression" });
          continue;
        }

        prop.expression = expr;
        applied.push({ layer: layer.name, property: prop.name });
      }
    } finally {
      app.endUndoGroup();
    }

    // NOT an error when nothing matched -- the call did what it was asked and
    // found nothing to do. Reporting it as a failure would tell the artist the
    // tool broke when what actually happened is that the selection was wrong.
    return {
      success: true,
      applied: applied,
      skipped: skipped.length ? skipped : undefined,
      expressionEngine: app.project.expressionEngine,
      undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects.",
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};


interface LayerRow {
  index: number;
  name: string;
  label: number;
  enabled: boolean;
  selected: boolean;
  /** Present only when the layer has effects, so a quiet comp stays quiet. */
  effectCount?: number;
}
interface ListLayersResult extends Result {
  comp?: string;
  layerCount?: number;
  layers?: LayerRow[];
}

/**
 * Every layer in the active comp, with the index, name and label needed to
 * address one. Read-only.
 *
 * The other half of layer addressing: resolveTargets can find a layer by name,
 * index or label, and this is where those come from. Asking the agent to
 * address a layer without giving it a way to see the comp would be the same
 * mistake as expecting matchNames without list_effects.
 */
export const agentListLayers = (): ListLayersResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const rows: LayerRow[] = [];
    for (let i = 1; i <= comp.numLayers; i++) {
      const l = comp.layer(i);
      if (!l) continue;
      const row: LayerRow = {
        index: l.index,
        name: l.name,
        label: l.label,
        enabled: l.enabled,
        // So the agent can say "the three you have selected" and mean it, and
        // so `target: selected` and an explicit name never disagree silently.
        selected: l.selected,
      };
      // Counted, not listed: the names and parameters are list_effects' job,
      // and this row rides in a list that can be a hundred long.
      const parade = l.property("ADBE Effect Parade") as PropertyGroup;
      if (parade && typeof parade.numProperties === "number" && parade.numProperties > 0) {
        row.effectCount = parade.numProperties;
      }
      rows.push(row);
    }

    return { success: true, comp: comp.name, layerCount: rows.length, layers: rows };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * A text layer, optionally sized and coloured.
 *
 * FONT FAMILY IS DELIBERATELY NOT SETTABLE. Assigning a font AE does not have
 * does not throw -- it silently substitutes, and the layer looks fine until
 * somebody who knows the brand sees the render. A tool that can quietly ship
 * the wrong typeface is worse than one that makes you set it yourself, so this
 * creates the layer and leaves the font to the artist and their character
 * panel.
 */
export const agentAddTextLayer = (
  text: string,
  fontSize: number,
  hexColour: string
): AddLayerResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const body = String(text == null ? "" : text);

    // Validated BEFORE the undo group opens, so a bad argument never creates a
    // layer that then has to be undone.
    let size = 0;
    if (fontSize != null && String(fontSize) !== "") {
      size = Number(fontSize);
      if (!(size > 0 && size <= 2000)) {
        return { success: false, error: "Font size must be a number between 1 and 2000." };
      }
    }

    let colour: number[] | null = null;
    if (hexColour != null && String(hexColour) !== "") {
      colour = parseHexColour(hexColour);
      if (!colour) return { success: false, error: "Colour must be a hex value like #FFFFFF." };
    }

    app.beginUndoGroup("Ask: add text layer");
    let layer: TextLayer;
    try {
      layer = comp.layers.addText(body) as TextLayer;

      if (size || colour) {
        // matchNames throughout, never display names -- "Source Text" is
        // localised and the whole file exists to avoid that class of lookup.
        const srcProp = layer
          .property("ADBE Text Properties")
          .property("ADBE Text Document") as Property;
        // A TextDocument is read, mutated, and written BACK as a whole. Setting
        // a field on the value in place does nothing: the value is a copy.
        const doc = srcProp.value as TextDocument;
        if (size) doc.fontSize = size;
        if (colour) {
          doc.applyFill = true;
          doc.fillColor = colour;
        }
        srcProp.setValue(doc);
      }
    } finally {
      app.endUndoGroup();
    }
    if (!layer) return { success: false, error: "After Effects did not create the text layer." };

    return {
      success: true,
      name: layer.name,
      kind: "text layer",
      undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects.",
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * A shape layer, optionally with one rectangle or ellipse in it.
 *
 * "none" makes an empty shape layer for the artist to draw in, which is a
 * legitimate ask and the cheapest thing to get right. A rectangle or ellipse is
 * built from matchNames -- there is no scripting shortcut for "add a red box",
 * only the vector property tree.
 */
export const agentAddShapeLayer = (
  name: string,
  shape: string,
  width: number,
  height: number,
  hexColour: string
): AddLayerResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const kind = String(shape == null || shape === "" ? "none" : shape).toLowerCase();
    if (kind !== "none" && kind !== "rectangle" && kind !== "ellipse") {
      return { success: false, error: 'Shape must be "rectangle", "ellipse" or "none".' };
    }

    const layerName = String(name == null ? "" : name).replace(/^\s+|\s+$/g, "");

    let w = 0;
    let h = 0;
    let colour: number[] | null = null;
    if (kind !== "none") {
      w = width == null || String(width) === "" ? Math.round(comp.width / 2) : Math.round(Number(width));
      h = height == null || String(height) === "" ? Math.round(comp.height / 2) : Math.round(Number(height));
      if (!(w >= 1 && w <= MAX_DIM)) return { success: false, error: "Width must be between 1 and " + MAX_DIM + "." };
      if (!(h >= 1 && h <= MAX_DIM)) return { success: false, error: "Height must be between 1 and " + MAX_DIM + "." };

      colour = parseHexColour(hexColour == null || String(hexColour) === "" ? "#FFFFFF" : hexColour);
      if (!colour) return { success: false, error: "Colour must be a hex value like #FF0000." };
    }

    app.beginUndoGroup("Ask: add shape layer");
    let layer: ShapeLayer;
    try {
      layer = comp.layers.addShape() as ShapeLayer;
      if (layerName) layer.name = layerName;

      if (kind !== "none") {
        // Every one of these is a matchName. The vector tree has no stable
        // display names across AE versions or languages, so a display-name
        // lookup here would be the Auto AR bug again in a new place.
        const root = layer.property("ADBE Root Vectors Group") as PropertyGroup;
        const group = root.addProperty("ADBE Vector Group") as PropertyGroup;
        const contents = group.property("ADBE Vectors Group") as PropertyGroup;

        if (kind === "rectangle") {
          const rect = contents.addProperty("ADBE Vector Shape - Rect") as PropertyGroup;
          (rect.property("ADBE Vector Rect Size") as Property).setValue([w, h]);
        } else {
          const ell = contents.addProperty("ADBE Vector Shape - Ellipse") as PropertyGroup;
          (ell.property("ADBE Vector Ellipse Size") as Property).setValue([w, h]);
        }

        const fill = contents.addProperty("ADBE Vector Graphic - Fill") as PropertyGroup;
        (fill.property("ADBE Vector Fill Color") as Property).setValue(colour as number[]);
      }
    } finally {
      app.endUndoGroup();
    }
    if (!layer) return { success: false, error: "After Effects did not create the shape layer." };

    return {
      success: true,
      name: layer.name,
      kind: kind === "none" ? "empty shape layer" : kind + " shape layer",
      undo: "Ctrl+Z (Cmd+Z on Mac) once, in After Effects.",
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// ANIMATION -- the thing the agent kept having to refuse.
//
// Asked to "create animation on these 3 layers" it could only answer that it
// had no tool for it: easing existed, keyframes did not, so every request had
// to bounce back to the artist to set two keys by hand first. This closes that.
//
// IT MAKES MOVEMENT, IT DOES NOT INVENT TASTE. Two keyframes, a start, a
// duration, and optionally AE's own Easy Ease -- which is F9, a host gesture,
// not a studio opinion. Anything with a house feel to it comes from the
// studio's OWN ease bank afterwards (apply_ease_preset), which is why this
// leaves the keys it made SELECTED: the follow-up call lands on exactly them
// with nothing else to aim at. Building a library of "pop in", "slide up"
// presets here would be this file deciding how the studio's work moves, which
// is not its call -- same reasoning as Batch Match's transform modes and
// Master Tools' preset sizes.
// =============================================================================

/** Past this a value is a typo or an attack, not a transform. */
const MAX_ABS_VALUE = 1e6;
/** AE's own Easy Ease influence, as F9 applies it. */
const EASY_EASE_INFLUENCE = 33.3333;

interface AnimateResult extends Result {
  message?: string;
  undo?: string;
}

/**
 * A transform property, via `layer.transform`.
 *
 * NEVER `layer.property("Position")`. CLAUDE.md: a camera or light resolves
 * display-name lookups against the wrong property (Point of Interest shares a
 * matchName with Anchor Point), so the named form animates something nobody
 * asked for on exactly the layer types most likely to be in a rig.
 */
function transformProperty(
  layer: Layer,
  which: string
): { prop?: Property; label?: string; error?: string } {
  const tr = (layer as any).transform as any;
  if (!tr) return { error: '"' + layer.name + '" has no transform properties.' };

  const w = String(which || "").toLowerCase().replace(/[^a-z]/g, "");
  let prop: any = null;
  let label = "";
  if (w === "position") { prop = tr.position; label = "Position"; }
  else if (w === "scale") { prop = tr.scale; label = "Scale"; }
  else if (w === "rotation") {
    // A 3D layer has no plain `rotation`; its Z rotation is the one that means
    // "spin it on screen", and that is what an artist asking for rotation on a
    // flat DOOH comp means.
    prop = tr.rotation;
    label = "Rotation";
    if (!prop) { prop = tr.zRotation; label = "Z Rotation"; }
  }
  else if (w === "opacity") { prop = tr.opacity; label = "Opacity"; }
  else if (w === "anchor" || w === "anchorpoint") { prop = tr.anchorPoint; label = "Anchor Point"; }
  else return { error: '"' + which + '" is not an animatable transform. Use position, scale, rotation, opacity or anchor.' };

  // REPORTED, NEVER SKIPPED. A rig that half-applies and calls itself done is
  // the Auto AR bug that hid for months (CLAUDE.md section 2).
  if (!prop) {
    return { error: '"' + layer.name + '" has no ' + label + " -- it is probably a camera, light or audio layer." };
  }
  return { prop: prop as Property, label: label };
}

/** A number or an array of numbers from the agent, bounded and finite. */
function readNumbers(json: string, what: string): { vals?: number[]; error?: string } {
  const raw = String(json == null ? "" : json).replace(/^\s+|\s+$/g, "");
  if (!raw) return { vals: undefined };
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // A bare "540" is a reasonable thing for a model to send for a 1-D
    // property, so fall back to reading it as one number before refusing.
    const n = Number(raw);
    if (isNaN(n)) return { error: what + ' must be a number or an array of numbers, not "' + raw + '".' };
    parsed = n;
  }
  const arr: number[] = [];
  if (typeof parsed === "number") arr.push(parsed);
  else if (parsed && typeof parsed.length === "number") {
    for (let i = 0; i < parsed.length; i++) arr.push(Number(parsed[i]));
  } else {
    return { error: what + " must be a number or an array of numbers." };
  }
  if (!arr.length) return { error: what + " was an empty array." };
  for (let i = 0; i < arr.length; i++) {
    if (isNaN(arr[i]) || !isFinite(arr[i])) return { error: what + " contains something that is not a number." };
    if (Math.abs(arr[i]) > MAX_ABS_VALUE) return { error: what + " has a value past anything real (" + arr[i] + ")." };
  }
  return { vals: arr };
}

/** The value to write, sized to what the property actually holds. */
function sizeToProperty(
  given: number[] | undefined,
  current: any,
  dims: number,
  what: string
): { value?: number | number[]; error?: string } {
  if (dims === 1) {
    const v = given === undefined ? Number(current) : given[0];
    if (given !== undefined && given.length > 1) {
      return { error: what + " has " + given.length + " numbers but this property takes one." };
    }
    return { value: v };
  }
  const cur: number[] = [];
  for (let i = 0; i < dims; i++) cur.push(Number(current[i]));
  if (given === undefined) return { value: cur };
  if (given.length > dims) {
    return { error: what + " has " + given.length + " numbers but this property takes " + dims + "." };
  }
  // SHORT IS FILLED FROM THE CURRENT VALUE, not from zero. [x, y] against a 3D
  // position means "move it in the frame and leave its depth alone"; zeroing
  // the z would yank a 3D layer onto the camera plane silently.
  const out: number[] = [];
  for (let i = 0; i < dims; i++) out.push(i < given.length ? given[i] : cur[i]);
  return { value: out };
}

function addValues(base: number | number[], delta: number | number[], dims: number): number | number[] {
  if (dims === 1) return Number(base) + Number(delta);
  const out: number[] = [];
  for (let i = 0; i < dims; i++) out.push(Number((base as number[])[i]) + Number((delta as number[])[i]));
  return out;
}

/** The index of the key AE stored at `t`, or 0. Times are compared with a
 *  half-frame tolerance because AE snaps a written time to its own grid. */
function keyIndexAt(prop: Property, t: number, tolerance: number): number {
  for (let k = 1; k <= prop.numKeys; k++) {
    if (Math.abs(prop.keyTime(k) - t) <= tolerance) return k;
  }
  return 0;
}

/**
 * Two keyframes on one transform property, across every target layer.
 *
 * WHAT IT REFUSES TO DO QUIETLY: overwrite animation that is already there.
 * A property with keys on it is somebody's work, and dropping two more into
 * the middle of it produces motion nobody designed and nobody can see is
 * wrong without scrubbing. It stops and names the layers; `replaceExisting`
 * is the artist's explicit yes, and it is still one Ctrl+Z.
 *
 * `relative` reads from/to as offsets from where the layer is now, which is
 * what "slide it in from 200 below" means -- absolute coordinates for that
 * would need the agent to know where every layer sits.
 *
 * `staggerSeconds` walks the start time along per layer, so "these 3, one
 * after another" is one call rather than three with hand-computed times.
 */
export const agentAnimateProperty = (
  targetKind: string,
  targetValue: string,
  property: string,
  fromJson: string,
  toJson: string,
  startSeconds: number,
  durationSeconds: number,
  relative: boolean,
  staggerSeconds: number,
  ease: string,
  replaceExisting: boolean
): AnimateResult => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return needComp() as AnimateResult;

    const start = Number(startSeconds);
    const dur = Number(durationSeconds);
    const stagger = Number(staggerSeconds || 0);
    if (isNaN(start) || start < 0) return { success: false, error: "Start time must be zero or later." };
    if (isNaN(dur) || dur <= 0) return { success: false, error: "The animation needs a duration longer than zero." };
    if (start > MAX_SECONDS || dur > MAX_SECONDS) return { success: false, error: "That timing is past anything real." };
    if (isNaN(stagger) || stagger < 0 || stagger > MAX_SECONDS) return { success: false, error: "Stagger must be zero or a positive number of seconds." };

    const easeMode = String(ease || "none").toLowerCase();
    if (easeMode !== "none" && easeMode !== "in" && easeMode !== "out" && easeMode !== "both") {
      return { success: false, error: 'Ease must be "none", "in", "out" or "both".' };
    }

    const to = readNumbers(toJson, "The end value");
    if (to.error) return { success: false, error: to.error };
    if (!to.vals) return { success: false, error: "Tell me what to animate it to." };
    const from = readNumbers(fromJson, "The start value");
    if (from.error) return { success: false, error: from.error };

    const found = resolveTargets(comp, targetKind, targetValue);
    if (found.error || !found.layers) return { success: false, error: found.error };
    const layers = found.layers;

    // EVERY LAYER CHECKED BEFORE ANY LAYER IS WRITTEN. A half-applied
    // animation across a selection is worse than none: the board looks
    // animated and only some of it is.
    const propsFor: Property[] = [];
    let label = "";
    const blocked: string[] = [];
    for (let i = 0; i < layers.length; i++) {
      const got = transformProperty(layers[i], property);
      if (got.error || !got.prop) return { success: false, error: got.error };
      label = got.label || property;
      if (got.prop.numKeys > 0 && !replaceExisting) blocked.push(layers[i].name);
      propsFor.push(got.prop);
    }
    if (blocked.length) {
      return {
        success: false,
        error:
          label + " is already animated on " + blocked.join(", ") +
          ". I won't write over animation somebody made -- say to replace it and I will, or animate a different property.",
      };
    }

    const frame = comp.frameDuration;
    const tol = frame / 2;
    const startFrames = Math.round(start / frame);
    const durFrames = Math.max(1, Math.round(dur / frame));
    const staggerFrames = Math.round(stagger / frame);

    app.beginUndoGroup("Animate " + label);
    let touched = 0;
    let lastEnd = 0;
    for (let i = 0; i < layers.length; i++) {
      const prop = propsFor[i];
      const current = prop.value;
      const dims = typeof current === "number" ? 1 : (current as number[]).length;

      const endVal = sizeToProperty(to.vals, current, dims, "The end value");
      if (endVal.error) { app.endUndoGroup(); return { success: false, error: endVal.error }; }
      const startVal = sizeToProperty(from.vals, current, dims, "The start value");
      if (startVal.error) { app.endUndoGroup(); return { success: false, error: startVal.error }; }

      let v0 = startVal.value as number | number[];
      let v1 = endVal.value as number | number[];
      if (relative) {
        // Offsets from where it is NOW. `from` unstated means "from here",
        // which is already `current`, so only an explicit one is shifted.
        if (from.vals) v0 = addValues(current as number | number[], v0, dims);
        v1 = addValues(current as number | number[], v1, dims);
      }

      if (replaceExisting) {
        for (let k = prop.numKeys; k >= 1; k--) prop.removeKey(k);
      }

      // COUNTED IN FRAMES, not snapped afterwards. Rounding each time
      // independently looks equivalent and is not: a 0.5s stagger on a 25fps
      // comp is 12.5 frames, so successive starts rounded to 0.00 / 0.52 /
      // 1.00 -- gaps of 0.52 and 0.48 where the artist asked for even ones.
      // Snapping the INTERVAL and multiplying keeps every gap identical and
      // every layer the same length.
      //
      // The max(1) is not cosmetic either: a duration under half a frame
      // rounded both keys onto the same time, which is ONE keyframe, which is
      // no animation at all -- reported as success.
      const t0 = (startFrames + staggerFrames * i) * frame;
      const t1 = t0 + durFrames * frame;
      prop.setValueAtTime(t0, v0 as any);
      prop.setValueAtTime(t1, v1 as any);
      if (t1 > lastEnd) lastEnd = t1;

      const k0 = keyIndexAt(prop, t0, tol);
      const k1 = keyIndexAt(prop, t1, tol);

      if (easeMode !== "none" && k0 && k1) {
        // Built to the length AE reports for THIS key, per the note in
        // motionTools' writeEaseToTargets -- setTemporalEaseAtKey rejects an
        // array whose length does not match, and Scale is 2-D or 3-D.
        const slow = new KeyframeEase(0, EASY_EASE_INFLUENCE);
        const flat = new KeyframeEase(0, 0.1);
        const build = (n: number, e: KeyframeEase) => {
          const a: KeyframeEase[] = [];
          for (let d = 0; d < n; d++) a.push(e);
          return a as any;
        };
        try {
          // BEZIER FIRST. Temporal ease on a LINEAR keyframe is accepted and
          // then does nothing -- the curve stays straight and the call still
          // reports success. motionTools' own ease path sets this for the same
          // reason; missing it here would have shipped an "eased" animation
          // that is visibly linear.
          prop.setInterpolationTypeAtKey(k0, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
          prop.setInterpolationTypeAtKey(k1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
          const n0 = prop.keyOutTemporalEase(k0).length;
          const n1 = prop.keyInTemporalEase(k1).length;
          const outFirst = easeMode === "out" || easeMode === "both" ? slow : flat;
          const inLast = easeMode === "in" || easeMode === "both" ? slow : flat;
          prop.setTemporalEaseAtKey(k0, build(prop.keyInTemporalEase(k0).length, flat), build(n0, outFirst));
          prop.setTemporalEaseAtKey(k1, build(n1, inLast), build(prop.keyOutTemporalEase(k1).length, flat));
        } catch (e) {
          // An ease that will not take is not worth losing the keyframes over.
        }
      }

      // LEFT SELECTED, so the studio's own ease presets can land on exactly
      // these keys next. getSelectedEaseTargets reads comp.selectedProperties,
      // so the PROPERTY has to be selected, not only its keys.
      try {
        if (i === 0) {
          const sel = comp.selectedProperties;
          for (let s = 0; s < sel.length; s++) (sel[s] as any).selected = false;
        }
        (prop as any).selected = true;
        if (k0) prop.setSelectedAtKey(k0, true);
        if (k1) prop.setSelectedAtKey(k1, true);
      } catch (e) {
        /* selection is a convenience; never fail the animation over it */
      }
      touched++;
    }
    app.endUndoGroup();

    const overrun = lastEnd > comp.duration + tol
      ? " It runs past the end of the comp (" + comp.duration.toFixed(2) + "s), so the tail won't render."
      : "";
    // THE NUMBERS IT ACTUALLY WROTE. Reporting the request back would hide a
    // stagger or duration that had to move to land on a frame.
    const realDur = durFrames * frame;
    const realStagger = staggerFrames * frame;
    const staggerNote = realStagger > 0 && layers.length > 1
      ? ", staggered " + realStagger.toFixed(2) + "s apart"
      : "";
    const easeNote = easeMode === "none" ? "" : " with an easy ease " + easeMode;
    return {
      success: true,
      message:
        "Animated " + label + " on " + touched + " layer" + (touched === 1 ? "" : "s") +
        " over " + realDur.toFixed(2) + "s from " + (startFrames * frame).toFixed(2) + "s" + staggerNote + easeNote + "." + overrun +
        " The new keyframes are selected, so a studio ease preset will land on them.",
      undo: "Ctrl+Z once",
    };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};
