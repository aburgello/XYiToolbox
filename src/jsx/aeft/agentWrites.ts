// =============================================================================
// src/jsx/aeft/agentWrites.ts
// -----------------------------------------------------------------------------
// THE ONLY FUNCTIONS THE ASK AGENT MAY CALL THAT CHANGE ANYTHING.
//
// Its own file so the answer to "what can the agent do to my project?" is one
// file long. Everything else it holds reads, scans, navigates, or fills a form;
// this is the whole of the other half, and it should stay short enough to read
// in a sitting.
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

/** "Open a comp first" / "select something first", said the same way every time. */
function needComp(): Result {
  return { success: false, error: "No composition is open. Open the comp you want to work in, then ask again." };
}
function needSelection(what: string): Result {
  return { success: false, error: "Nothing is selected. Select the layer(s) you want to " + what + ", then ask again." };
}

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
  moveAllAttributes: boolean
): PrecomposeResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const layers = selectedLayers(comp);
    if (layers.length === 0) return needSelection("precompose");

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
export const agentRenameSelected = (baseName: string): SelectionResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const layers = selectedLayers(comp);
    if (layers.length === 0) return needSelection("rename");

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
export const agentLabelSelected = (label: number): SelectionResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const layers = selectedLayers(comp);
    if (layers.length === 0) return needSelection("label");

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
export const agentDuplicateSelected = (): SelectionResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const layers = selectedLayers(comp);
    if (layers.length === 0) return needSelection("duplicate");

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
export const agentListEffects = (): ListEffectsResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const layers = selectedLayers(comp);
    if (layers.length === 0) return needSelection("inspect");

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
  expression: string
): ExpressionResult => {
  try {
    const comp = activeComp();
    if (!comp) return needComp();

    const layers = selectedLayers(comp);
    if (layers.length === 0) return needSelection("apply an expression to");

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
