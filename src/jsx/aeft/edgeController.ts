// =============================================================================
// src/jsx/aeft/edgeController.ts
// -----------------------------------------------------------------------------
// EDGE CONTROLLER -- one set of sliders for everything that happens at a
// layer's boundary: expand/contract the matte, soften the edge without
// softening the picture, and lay a coloured halo outside it or a tint inside.
//
// WHY A RIG AND NOT AN EFFECT. Every piece of this exists natively; what does
// not exist is the assembly. Doing it by hand is five effects across three
// copies of a layer with the parameters that matter buried at three different
// depths, which is why nobody does it twice. This builds that stack once and
// hangs every number people actually turn on ONE control null, so the whole
// thing stays adjustable in AE afterwards -- the panel's values are only the
// starting positions. (The commercial C++ plugins that do this in a single
// effect are faster at 4K and Windows-only; this runs on the machines the
// studio has.)
//
// THE ORDER IS THE DESIGN, top to bottom in the precomp:
//
//   EDGE CTRL     a guide null, and the only thing anybody touches
//   <name>        the original, choked and edge-softened
//   EDGE INNER    a copy, filled with the inner colour, eroded and feathered
//   EDGE OUTER    a copy, spread outwards and filled with the outer colour
//
// EDGE BLUR IS AN ALPHA BLUR, not a blur. Channel Blur on the alpha channel
// alone softens where the layer ENDS while leaving its picture sharp -- which
// is the whole trick, and the reason this is not just Fast Box Blur. Its
// "Blur Dimensions" gives the horizontal/vertical/both control for free.
//
// EFFECT PARAMETERS BY matchName, NEVER BY DISPLAY NAME (CLAUDE.md): display
// names change between point releases, and a null lookup here is REPORTED
// rather than skipped -- a rig that half-applies and says it worked is the bug
// this file exists to not have.
// =============================================================================
import { Result } from "./shared";

/** The guide null every control lives on. */
const CTRL_LAYER = "EDGE CTRL";
const OUTER_LAYER = "EDGE OUTER";
const INNER_LAYER = "EDGE INNER";
/** Suffix for the precomp the rig is built inside. */
const RIG_SUFFIX = " EDGE";

/** Slider and colour names on the control null. These are OUR names, so the
 *  expressions below can safely address them by name -- unlike AE's own
 *  parameters, which are addressed by matchName throughout. */
const P_CHOKE = "Dilate / Erode";
const P_BLUR = "Edge Blur";
const P_DIRECTION = "Blur Direction (0 both / 1 H / 2 V)";
const P_OUTER_SIZE = "Outer Size";
const P_OUTER_COLOUR = "Outer Colour";
const P_OUTER_OPACITY = "Outer Opacity";
const P_INNER_SIZE = "Inner Size";
const P_INNER_FEATHER = "Inner Feather";
const P_INNER_COLOUR = "Inner Colour";
const P_INNER_OPACITY = "Inner Opacity";

export interface EdgeControllerResult extends Result {
  /** The precomp the rig was built in, so the panel can name it. */
  compName?: string;
  /** How many layers were rigged, when several were selected. */
  rigged?: number;
  /** Layers that were skipped, and why -- never a silent continue. */
  skipped?: string[];
}

/**
 * Add an effect and hand it back, or throw with a name a person can act on.
 *
 * `canAddProperty` is asked FIRST: a text layer refuses some effects outright,
 * and the thrown error from addProperty alone says nothing about which layer
 * or which effect.
 */
function addFx(layer: AVLayer, matchName: string, label: string): PropertyGroup {
  const parade = layer.property("ADBE Effect Parade") as PropertyGroup;
  if (!parade.canAddProperty(matchName)) {
    throw new Error('"' + layer.name + '" will not take ' + label + " (" + matchName + ").");
  }
  const fx = parade.addProperty(matchName) as PropertyGroup;
  fx.name = label;
  return fx;
}

/**
 * A parameter by matchName, or an error naming both.
 *
 * The AE 26.3 "Scale" -> "Scale Height" rename is the precedent in CLAUDE.md:
 * a display-name lookup returned null, the guard skipped the rig, and Auto AR
 * silently shipped without its scale for months.
 */
function fxParam(fx: PropertyGroup, matchName: string, label: string): Property {
  const p = fx.property(matchName) as Property;
  if (!p) throw new Error("This After Effects has no " + label + " (" + matchName + ") on " + fx.name + ".");
  return p;
}

/** A slider on the control null. */
function addSlider(parade: PropertyGroup, label: string, value: number): void {
  const sl = parade.addProperty("ADBE Slider Control") as PropertyGroup;
  sl.name = label;
  (sl.property("ADBE Slider Control-0001") as Property).setValue(value);
}

/** A colour swatch on the control null. */
function addColour(parade: PropertyGroup, label: string, rgb: number[]): void {
  const c = parade.addProperty("ADBE Color Control") as PropertyGroup;
  c.name = label;
  (c.property("ADBE Color Control-0001") as Property).setValue([rgb[0], rgb[1], rgb[2], 1]);
}

/** `thisComp.layer("EDGE CTRL").effect("Outer Size")("Slider")`, as a string. */
function ctrlExpr(param: string, kind: string): string {
  return 'thisComp.layer("' + CTRL_LAYER + '").effect("' + param + '")("' + kind + '")';
}
const sliderExpr = (param: string) => ctrlExpr(param, "Slider");
const colourExpr = (param: string) => ctrlExpr(param, "Color");

export interface EdgeControllerOptions {
  choke: number;
  blur: number;
  direction: number;
  outerSize: number;
  outerColour: number[];
  outerOpacity: number;
  innerSize: number;
  innerFeather: number;
  innerColour: number[];
  innerOpacity: number;
  /** Build the coloured halo at all. Off is the ordinary matte-cleanup case. */
  useOuter: boolean;
  /** Build the inner tint at all. */
  useInner: boolean;
}

/**
 * Rig the selected layers.
 *
 * ONE PRECOMP PER LAYER, and `MOVE_ALL_ATTRIBUTES` so the layer keeps its
 * position, scale and keyframes in the parent comp -- the rig is about the
 * layer's own edge, and precomposing it into a comp the size of the whole
 * canvas would put the artwork back where the artist did not leave it.
 *
 * The precomp is then given ROOM: a spread of N pixels outside a layer that
 * ends at the comp edge has nowhere to go, so the comp is grown by the halo's
 * size and the layer re-centred in it. This is the trap that makes a
 * hand-built version of this clip flat on one side.
 */
export const edgeControllerApply = (optionsJson: string): EdgeControllerResult => {
  let undoOpen = false;
  try {
    let o: EdgeControllerOptions;
    try {
      o = JSON.parse(optionsJson) as EdgeControllerOptions;
    } catch (eParse) {
      return { success: false, error: "Could not read the settings." };
    }

    const comp = app.project.activeItem;
    // Duck-typed on what is about to be used, never instanceof on a host class.
    if (!comp || typeof (comp as CompItem).layers === "undefined") {
      return { success: false, error: "Open a composition first." };
    }
    const parent = comp as CompItem;
    const selected = parent.selectedLayers;
    if (selected.length === 0) return { success: false, error: "Select the layer to rig." };

    // The layers are resolved to INDICES before anything is built: precomposing
    // renumbers the comp, and a list of live layer objects would be pointing at
    // the wrong rows by the second one.
    const indices: number[] = [];
    const names: string[] = [];
    const skipped: string[] = [];
    for (let i = 0; i < selected.length; i++) {
      const l = selected[i];
      // A camera, a light and an audio layer have no matte to work on.
      if (typeof (l as AVLayer).sourceRectAtTime !== "function") {
        skipped.push(l.name + " (no matte)");
        continue;
      }
      indices.push(l.index);
      names.push(l.name);
    }
    if (indices.length === 0) {
      return { success: false, error: "Nothing selected that has an edge: " + skipped.join(", ") + "." };
    }

    app.beginUndoGroup("XYi Edge Controller");
    undoOpen = true;

    let rigged = 0;
    let lastComp = "";

    // LAST TO FIRST. Precomposing layer 3 leaves layers 1 and 2 where they
    // were; doing it the other way round shifts every index still to come.
    indices.sort(function (a, b) { return b - a; });

    for (let n = 0; n < indices.length; n++) {
      const src = parent.layer(indices[n]) as AVLayer;
      const rigName = src.name + RIG_SUFFIX;
      const rig = parent.layers.precompose([src.index], rigName, true);
      lastComp = rig.name;

      // ROOM TO SPREAD. Everything the halo needs, plus the blur's own reach.
      const pad = Math.ceil(Math.abs(o.outerSize) + Math.abs(o.choke) + o.blur) + 4;
      if (o.useOuter || o.blur > 0 || o.choke > 0) {
        const w = rig.width + pad * 2;
        const h = rig.height + pad * 2;
        // The layer inside has to move with the walls, or growing the comp
        // pushes the artwork into a corner.
        for (let li = 1; li <= rig.numLayers; li++) {
          const inner = rig.layer(li) as AVLayer;
          const pos = inner.property("ADBE Transform Group").property("ADBE Position") as Property;
          const pv = pos.value;
          const moved = pv.length > 2 ? [pv[0] + pad, pv[1] + pad, pv[2]] : [pv[0] + pad, pv[1] + pad];
          if (pos.numKeys > 0) pos.setValueAtTime(rig.time, moved);
          else pos.setValue(moved);
        }
        rig.width = w;
        rig.height = h;
      }

      const original = rig.layer(1) as AVLayer;

      // ── the control null ────────────────────────────────────────────────
      const ctrl = rig.layers.addNull();
      ctrl.name = CTRL_LAYER;
      (ctrl as any).enabled = false;
      (ctrl as any).guideLayer = true;
      const ctrlFx = ctrl.property("ADBE Effect Parade") as PropertyGroup;
      addSlider(ctrlFx, P_CHOKE, o.choke);
      addSlider(ctrlFx, P_BLUR, o.blur);
      addSlider(ctrlFx, P_DIRECTION, o.direction);
      if (o.useOuter) {
        addSlider(ctrlFx, P_OUTER_SIZE, o.outerSize);
        addColour(ctrlFx, P_OUTER_COLOUR, o.outerColour);
        addSlider(ctrlFx, P_OUTER_OPACITY, o.outerOpacity);
      }
      if (o.useInner) {
        addSlider(ctrlFx, P_INNER_SIZE, o.innerSize);
        addSlider(ctrlFx, P_INNER_FEATHER, o.innerFeather);
        addColour(ctrlFx, P_INNER_COLOUR, o.innerColour);
        addSlider(ctrlFx, P_INNER_OPACITY, o.innerOpacity);
      }

      // ── the original: choke, then soften the alpha ──────────────────────
      // ORDER MATTERS: choking a softened edge re-hardens it, so the spread
      // happens first and the softening last.
      const choke = addFx(original, "ADBE Simple Choker", "Edge Choke");
      // Simple Choker's slider is POSITIVE = contract, which is the opposite
      // of how everyone says it out loud ("expand by 3"), so the sign is
      // flipped here rather than in the artist's head.
      fxParam(choke, "ADBE Simple Choker-0002", "Choke Matte").expression =
        "-(" + sliderExpr(P_CHOKE) + ")";

      const soft = addFx(original, "ADBE Channel Blur", "Edge Softness");
      fxParam(soft, "ADBE Channel Blur-0004", "Alpha Blurriness").expression = sliderExpr(P_BLUR);
      // Repeat Edge Pixels ON: without it the blur pulls transparency in from
      // outside the frame and the rig fades out against its own comp edge.
      fxParam(soft, "ADBE Channel Blur-0007", "Repeat Edge Pixels").setValue(1);
      // 1 = Horizontal and Vertical, 2 = Horizontal, 3 = Vertical.
      fxParam(soft, "ADBE Channel Blur-0008", "Blur Dimensions").expression =
        "var d = " + sliderExpr(P_DIRECTION) + "; d < 0.5 ? 1 : (d < 1.5 ? 2 : 3)";

      // ── the halo, underneath ────────────────────────────────────────────
      if (o.useOuter) {
        const outer = original.duplicate() as AVLayer;
        outer.name = OUTER_LAYER;
        outer.moveAfter(original);
        // The duplicate carries the original's own rig; it needs its own.
        const outerParade = outer.property("ADBE Effect Parade") as PropertyGroup;
        while (outerParade.numProperties > 0) outerParade.property(1).remove();

        const spread = addFx(outer, "ADBE Simple Choker", "Spread");
        fxParam(spread, "ADBE Simple Choker-0002", "Choke Matte").expression =
          "-(" + sliderExpr(P_OUTER_SIZE) + " + " + sliderExpr(P_CHOKE) + ")";
        const fill = addFx(outer, "ADBE Fill", "Outer Colour");
        fxParam(fill, "ADBE Fill-0002", "Color").expression = colourExpr(P_OUTER_COLOUR);
        const outerSoft = addFx(outer, "ADBE Channel Blur", "Outer Softness");
        fxParam(outerSoft, "ADBE Channel Blur-0004", "Alpha Blurriness").expression = sliderExpr(P_BLUR);
        fxParam(outerSoft, "ADBE Channel Blur-0007", "Repeat Edge Pixels").setValue(1);
        (outer.property("ADBE Transform Group").property("ADBE Opacity") as Property).expression =
          sliderExpr(P_OUTER_OPACITY);
      }

      // ── the inner tint, between the two ─────────────────────────────────
      if (o.useInner) {
        const inner = original.duplicate() as AVLayer;
        inner.name = INNER_LAYER;
        inner.moveAfter(original);
        const innerParade = inner.property("ADBE Effect Parade") as PropertyGroup;
        while (innerParade.numProperties > 0) innerParade.property(1).remove();

        // Filled first, then eaten away from the edge inwards, so what is left
        // is a band hugging the boundary rather than a solid silhouette.
        const innerFill = addFx(inner, "ADBE Fill", "Inner Colour");
        fxParam(innerFill, "ADBE Fill-0002", "Color").expression = colourExpr(P_INNER_COLOUR);
        const innerChoke = addFx(inner, "ADBE Simple Choker", "Inner Choke");
        fxParam(innerChoke, "ADBE Simple Choker-0002", "Choke Matte").expression =
          sliderExpr(P_INNER_SIZE) + " - " + sliderExpr(P_CHOKE);
        const innerSoft = addFx(inner, "ADBE Channel Blur", "Inner Feather");
        fxParam(innerSoft, "ADBE Channel Blur-0004", "Alpha Blurriness").expression =
          sliderExpr(P_INNER_FEATHER);
        fxParam(innerSoft, "ADBE Channel Blur-0007", "Repeat Edge Pixels").setValue(1);
        // The tint belongs INSIDE the subject: an alpha matte of the original
        // is what stops it bleeding past the softened edge.
        (inner.property("ADBE Transform Group").property("ADBE Opacity") as Property).expression =
          sliderExpr(P_INNER_OPACITY);
        inner.trackMatteType = TrackMatteType.ALPHA;
      }

      rigged++;
    }

    app.endUndoGroup();
    undoOpen = false;

    return {
      success: true,
      compName: lastComp,
      rigged: rigged,
      skipped: skipped,
      message: rigged === 1
        ? 'Rigged "' + lastComp + '" — the sliders are on ' + CTRL_LAYER + "."
        : "Rigged " + rigged + " layers — the sliders are on each " + CTRL_LAYER + ".",
    } as EdgeControllerResult;
  } catch (e) {
    // The undo group must close even when a matchName lookup throws, or AE is
    // left recording into a group nobody ends.
    if (undoOpen) { try { app.endUndoGroup(); } catch (e2) {} }
    return { success: false, error: e.toString() };
  }
};
