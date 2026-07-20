// =============================================================================
// src/jsx/aeft/motionTools.ts -- ExtendScript backend for the "XYTools"
// droplet (src/js/main/XYToolsDroplet.tsx), a quick-access popover
// button to the LEFT of the home screen's search box. Split out of aeft.ts
// per this project's usual per-feature file convention (see aeft.ts's own
// header comment).
//
// The panel was called "Motion Tools" while it was being built; it's XYTools
// in the UI now, but these bridge function names (and the app.settings key
// "MotionToolsEasePresets" further down) deliberately kept their original
// names -- renaming the settings key would orphan every ease preset artists
// have already saved. See XYToolsDroplet.tsx's header.
//
// Built fresh for this app (not a port of anything in toolset/) -- modeled
// on the anchor-point/nudge/ease toolbars in the motion-design tools that
// get cited most often as genuinely useful quality-of-life kits (Mister
// Horse's Motion, AnimBot, Ease and Wizz, KBar-style one-click bars).
// Three sections, all operating on comp.selectedLayers in the active comp
// (same convention as Random Layers/Toggle By Label elsewhere in this
// file), none of them touch a master .aep -- pure in-comp transform edits.
// =============================================================================
import { Result } from "./shared";

function currentOrKeyframedValue(prop: Property, time: number): any {
  return prop.numKeys > 0 ? prop.valueAtTime(time, false) : prop.value;
}

function applyValue(prop: Property, time: number, value: any): void {
  if (prop.numKeys > 0) prop.setValueAtTime(time, value);
  else prop.setValue(value);
}

// For a layer whose source is itself a composition ("precomp" in this
// studio's own terminology), `sourceRectAtTime()` measures the bounding
// box of the actual rendered PIXEL CONTENT inside that nested comp --
// NOT the nested comp's own canvas/frame. A precomp built with full-bleed
// artwork (content deliberately extending past the comp's own edges, a
// common safety margin in motion design) reports a box WIDER than the
// precomp itself, so anchor-snapping/aligning to "corner" lands on the
// edge of the bleed, not the precomp's actual frame -- reads as the
// anchor "extending" past where it should land. Use the nested comp's
// own width/height instead for anything whose source is a CompItem;
// real footage/solids/text/shapes still use sourceRectAtTime, which
// already reports exactly what's on screen for those.
function getContentFrameRect(layer: AVLayer, time: number): { left: number; top: number; width: number; height: number } {
  if (layer.source && layer.source instanceof CompItem) {
    return { left: 0, top: 0, width: layer.source.width, height: layer.source.height };
  }
  return layer.sourceRectAtTime(time, false);
}

interface LayerBounds { left: number; top: number; width: number; height: number; cx: number; cy: number; }

// ---------------------------------------------------------------------------
// Comp-space geometry composed BY HAND from scriptable transform properties.
//
// AE's expression-language toComp()/toWorld()/fromComp() do NOT exist in the
// scripting DOM (confirmed against types-for-adobe: only `copyToComp` is
// there). Calling them threw, which is why every layer was filtered out as
// "no visible bounds". So we walk the parent chain ourselves using only
// Position / Rotation / Scale / Anchor Point.
//
// A layer's Position/Rotation/Scale/Anchor are all expressed in its PARENT's
// "child frame" -- the frame whose ORIGIN sits at the parent's anchor point.
// A child at Position (0,0) lands its own anchor exactly on the parent's
// anchor; that's what fixes the reported bug (reading Position as if it were
// comp space mixed coordinate spaces and displaced the layer).
//
// Scope, deliberately unchanged from before: 2D only. X/Y rotation,
// orientation, and camera projection are ignored -- these are flat DOOH
// comps and align/distribute have always been axis-aligned/2D. A 3D-rotated
// layer will be treated by its X/Y position and Z rotation only.
// ---------------------------------------------------------------------------
interface Xf2D { px: number; py: number; rot: number; sx: number; sy: number; ax: number; ay: number; }

function readXf(layer: Layer, time: number): Xf2D {
  const p = currentOrKeyframedValue(layer.property("Position") as Property, time) as number[];
  const rotP = layer.property("Rotation") as Property;
  const r = rotP ? (currentOrKeyframedValue(rotP, time) as number) : 0;
  const sP = layer.property("Scale") as Property;
  const s = sP ? (currentOrKeyframedValue(sP, time) as number[]) : [100, 100];
  const aP = layer.property("Anchor Point") as Property;
  const a = aP ? (currentOrKeyframedValue(aP, time) as number[]) : [0, 0];
  return { px: p[0], py: p[1], rot: r, sx: s[0] / 100, sy: s[1] / 100, ax: a[0], ay: a[1] };
}

// A point q in `layer`'s own child frame -> comp space (recurse up the chain).
function childFrameToComp(layer: Layer, qx: number, qy: number, time: number): number[] {
  const xf = readXf(layer, time);
  const rad = (xf.rot * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const sxv = xf.sx * qx, syv = xf.sy * qy;
  const mx = xf.px + (cos * sxv - sin * syv);
  const my = xf.py + (sin * sxv + cos * syv);
  const parent = layer.parent as Layer | null;
  if (!parent) return [mx, my];
  return childFrameToComp(parent, mx, my, time);
}

// Inverse of childFrameToComp: a comp-space point -> the q in `layer`'s child
// frame that maps to it. Invert the parent chain top-down, then this layer.
function compToChildFrame(layer: Layer, cx: number, cy: number, time: number): number[] {
  const parent = layer.parent as Layer | null;
  const m = parent ? compToChildFrame(parent, cx, cy, time) : [cx, cy];
  const xf = readXf(layer, time);
  const dx = m[0] - xf.px, dy = m[1] - xf.py;
  const rad = (-xf.rot * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const rx = cos * dx - sin * dy;
  const ry = sin * dx + cos * dy;
  return [xf.sx !== 0 ? rx / xf.sx : rx, xf.sy !== 0 ? ry / xf.sy : ry];
}

// Comp-space location of a point given in `layer`'s own SOURCE space (what
// sourceRectAtTime/getContentFrameRect return): shift by the anchor, then
// run it through the layer's own transform and up the parent chain.
function sourcePointToComp(layer: Layer, srcX: number, srcY: number, time: number): number[] {
  const xf = readXf(layer, time);
  return childFrameToComp(layer, srcX - xf.ax, srcY - xf.ay, time);
}

// Axis-aligned bounding box of an AVLayer's rendered content in COMP space,
// derived from its own content rect (getContentFrameRect() -- sourceRectAtTime
// for real footage, or the nested comp's own frame for a precomp). The four
// corners go through sourcePointToComp (parent-chain-aware), so bounds are
// correct for a PARENTED layer -- the fix. Building the box from the mapped
// corners also folds in Z rotation (AABB of the rotated rect); the old
// anchor/position math ignored rotation, a small intentional change that now
// matches what's on screen.
function getLayerBounds(layer: AVLayer, time: number): LayerBounds | null {
  let rect: { left: number; top: number; width: number; height: number };
  try {
    rect = getContentFrameRect(layer, time);
  } catch (e) {
    return null;
  }
  const corners = [
    [rect.left, rect.top],
    [rect.left + rect.width, rect.top],
    [rect.left, rect.top + rect.height],
    [rect.left + rect.width, rect.top + rect.height],
  ];
  let minX = Number.MAX_VALUE, minY = Number.MAX_VALUE, maxX = -Number.MAX_VALUE, maxY = -Number.MAX_VALUE;
  for (let i = 0; i < corners.length; i++) {
    let c: number[];
    try {
      c = sourcePointToComp(layer, corners[i][0], corners[i][1], time);
    } catch (e) {
      return null;
    }
    if (c[0] < minX) minX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] > maxY) maxY = c[1];
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return { left: minX, top: minY, width: width, height: height, cx: minX + width / 2, cy: minY + height / 2 };
}

// Move a layer so its rendered content shifts by (dx, dy) in COMP space,
// writing its Position correctly whether or not it's parented.
//
// Unparented: comp space == Position space, so this is just Position + (dx,
// dy) -- byte-for-byte the old align/distribute behavior, zero change for the
// common case.
//
// Parented: `Position` lives in the parent's child frame, so a raw add moves
// the layer by the wrong amount (and wrong direction under a rotated/scaled
// parent) -- the reported bug. The layer's anchor renders at
// childFrameToComp(parent, Position); we shift THAT comp point by the delta
// and invert with compToChildFrame(parent, ...) to recover the new Position.
// Nested parenting is handled because both walk the whole chain. Any z
// component of Position is preserved. try/catch falls back to the raw add if
// a parent's transform can't be read (e.g. a camera/light used as parent).
function applyCompDeltaToPosition(layer: Layer, dx: number, dy: number, time: number): void {
  const posProp = layer.property("Position") as Property;
  const pos = (currentOrKeyframedValue(posProp, time) as number[]).slice();
  const parent = layer.parent as Layer | null;
  if (parent) {
    try {
      const anchorComp = childFrameToComp(parent, pos[0], pos[1], time);
      const newPos = compToChildFrame(parent, anchorComp[0] + dx, anchorComp[1] + dy, time);
      pos[0] = newPos[0];
      pos[1] = newPos[1];
      applyValue(posProp, time, pos);
      return;
    } catch (e) {
      // fall through to the raw add below
    }
  }
  pos[0] += dx;
  pos[1] += dy;
  applyValue(posProp, time, pos);
}

// =============================================================================
// Anchor Point -- the single most-requested quality-of-life fix motion
// designers reach for free/paid "anchor point" scripts for: After Effects'
// own anchor point tool doesn't let you snap to a corner/edge/center of a
// layer's actual content without the layer visually jumping, since moving
// the anchor point alone shifts the rendered position too. This snaps the
// anchor to one of 9 positions on the layer's own bounding box (from
// getContentFrameRect() above -- sourceRectAtTime for real footage/solids/
// text/shapes, or the nested comp's own frame for a precomp layer, since
// sourceRectAtTime on a precomp reports the bleed of its actual pixel
// content rather than its frame, which used to land the anchor outside
// the precomp's visible corners/edges instead of on them -- either way
// independent of the current anchor/position) and compensates Position in
// the same call so nothing visibly moves.
//
// relX/relY are 0 / 0.5 / 1 (left|top, center, right|bottom) -- the 3x3
// grid the React side renders maps its 9 buttons directly to these pairs.
// =============================================================================
export const motionToolsSnapAnchor = (relX: number, relY: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };

    app.beginUndoGroup("Snap Anchor Point");
    const time = comp.time;
    let touched = 0;
    for (let i = 0; i < layers.length; i++) {
      const rawLayer = layers[i];
      // Duck-typed instead of `instanceof AVLayer` -- confirmed on a real
      // AE project that `instanceof AVLayer` does NOT reliably match a
      // ShapeLayer at ExtendScript runtime (its DOM class hierarchy isn't a
      // real JS prototype chain instanceof can always trust), even though
      // shape layers conceptually are AVLayers and Types-for-Adobe models
      // them that way. Checking for the actual method this code needs
      // right after (sourceRectAtTime) works for every real content layer
      // -- solid, footage, precomp, text, shape -- while still excluding
      // cameras/lights/audio-only layers, which never have it.
      if (typeof (rawLayer as any).sourceRectAtTime !== "function") continue;
      const layer = rawLayer as AVLayer;

      const rect = getContentFrameRect(layer, time);
      const newAnchorX = rect.left + rect.width * relX;
      const newAnchorY = rect.top + rect.height * relY;

      const anchorProp = layer.property("Anchor Point") as Property;
      const posProp = layer.property("Position") as Property;
      const scaleProp = layer.property("Scale") as Property;
      const rotationProp = layer.property("Rotation") as Property;
      if (!anchorProp || !posProp) continue;

      const oldAnchor = currentOrKeyframedValue(anchorProp, time) as number[];
      const oldPos = currentOrKeyframedValue(posProp, time) as number[];
      const scale = scaleProp ? (currentOrKeyframedValue(scaleProp, time) as number[]) : [100, 100];
      // "Rotation" is Z Rotation even on a 3D layer -- X/Y Rotation and
      // Orientation aren't accounted for here, so the position compensation
      // below is exact for any 2D layer (the common case) and an
      // approximation for a 3D layer that's also rotated on X/Y/Orientation.
      // Flagging this rather than silently pretending it's exact for every
      // case -- same "unverified/approximate edge case" caution this file
      // uses elsewhere (see CLAUDE.md).
      const rotation = rotationProp ? (currentOrKeyframedValue(rotationProp, time) as number) : 0;

      const sx = scale[0] / 100;
      const sy = scale[1] / 100;
      const dx = (newAnchorX - oldAnchor[0]) * sx;
      const dy = (newAnchorY - oldAnchor[1]) * sy;

      const rad = (rotation * Math.PI) / 180;
      const rdx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const rdy = dx * Math.sin(rad) + dy * Math.cos(rad);

      const newAnchor = oldAnchor.length > 2 ? [newAnchorX, newAnchorY, oldAnchor[2]] : [newAnchorX, newAnchorY];

      // Anchor Point: almost never animated in practice, but handled the
      // same way as Position below for consistency -- set every existing
      // keyframe to the same new anchor value (a snap targets one absolute
      // location, not a per-keyframe delta) rather than touching only the
      // current-time key.
      if (anchorProp.numKeys > 0) {
        for (let k = 1; k <= anchorProp.numKeys; k++) anchorProp.setValueAtKey(k, newAnchor);
      } else {
        anchorProp.setValue(newAnchor);
      }

      // Position: if animated, shift EVERY keyframe by the same rotation-
      // compensated delta (rdx, rdy) instead of only the current-time one.
      // The original code called applyValue() here, which for a keyframed
      // property does setValueAtTime(time, newPos) -- that only creates/
      // edits ONE keyframe at the playhead and leaves every OTHER Position
      // keyframe at its old value, which visibly distorts the rest of the
      // animation (the whole point of an anchor snap is to look identical
      // everywhere, not just at the current frame). Shifting every
      // keyframe by the same delta preserves the full animated path --
      // spacing, easing, shape -- just recentered around the new anchor.
      if (posProp.numKeys > 0) {
        const has3rd = oldPos.length > 2;
        for (let k = 1; k <= posProp.numKeys; k++) {
          const kv = posProp.keyValue(k) as number[];
          const nv = has3rd ? [kv[0] + rdx, kv[1] + rdy, kv[2]] : [kv[0] + rdx, kv[1] + rdy];
          posProp.setValueAtKey(k, nv);
        }
      } else {
        posProp.setValue([oldPos[0] + rdx, oldPos[1] + rdy].concat(oldPos.length > 2 ? [oldPos[2]] : []) as number[]);
      }
      touched++;
    }
    app.endUndoGroup();
    if (touched === 0) return { success: false, error: "No eligible layers selected (cameras/lights/audio have no anchor point)." };
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Nudge -- Position/Scale/Rotation/Opacity, one small bump per click.
// Adds a keyframe at the current time if the property is already animated
// (so an animated layer's timing isn't disturbed), otherwise just sets the
// static value -- same "don't invent a keyframe on a non-animated
// property" reasoning as everywhere else in this codebase that edits a
// transform property.
// =============================================================================
export const motionToolsNudgePosition = (dx: number, dy: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };
    app.beginUndoGroup("Nudge Position");
    const time = comp.time;
    for (let i = 0; i < layers.length; i++) {
      const pos = layers[i].property("Position") as Property;
      if (!pos) continue;
      const cur = currentOrKeyframedValue(pos, time) as number[];
      const next = cur.length > 2 ? [cur[0] + dx, cur[1] + dy, cur[2]] : [cur[0] + dx, cur[1] + dy];
      applyValue(pos, time, next);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

export const motionToolsNudgeScale = (deltaPercent: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };
    app.beginUndoGroup("Nudge Scale");
    const time = comp.time;
    for (let i = 0; i < layers.length; i++) {
      const scale = layers[i].property("Scale") as Property;
      if (!scale) continue;
      const cur = currentOrKeyframedValue(scale, time) as number[];
      const next = cur.length > 2 ? [cur[0] + deltaPercent, cur[1] + deltaPercent, cur[2]] : [cur[0] + deltaPercent, cur[1] + deltaPercent];
      applyValue(scale, time, next);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

export const motionToolsNudgeRotation = (deltaDegrees: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };
    app.beginUndoGroup("Nudge Rotation");
    const time = comp.time;
    for (let i = 0; i < layers.length; i++) {
      const rot = layers[i].property("Rotation") as Property;
      if (!rot) continue;
      const cur = currentOrKeyframedValue(rot, time) as number;
      applyValue(rot, time, cur + deltaDegrees);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

export const motionToolsNudgeOpacity = (deltaPercent: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };
    app.beginUndoGroup("Nudge Opacity");
    const time = comp.time;
    for (let i = 0; i < layers.length; i++) {
      const op = layers[i].property("Opacity") as Property;
      if (!op) continue;
      const cur = currentOrKeyframedValue(op, time) as number;
      const next = Math.max(0, Math.min(100, cur + deltaPercent));
      applyValue(op, time, next);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Easy Ease In/Out/Both -- a targeted, always-works version of AE's own
// Shift+F9 / Ctrl+Shift+F9 / F9. Applies to whichever keyframes are
// currently selected in the Timeline/Graph Editor (Property.selectedKeys,
// the same selection those shortcuts read); if nothing's explicitly
// selected there (common when you've just scrubbed the playhead onto a
// keyframe without box-selecting it), falls back to the nearest keyframe
// to the playhead on that property -- a small, deliberate improvement over
// the native shortcut's "does nothing if nothing's selected" behavior.
//
// GENERIC as of this version: Easy Ease + Copy/Paste Ease used to only
// operate on a hardcoded Pos/Scale/Rot/Opac toggle (EASE_PROPERTY_NAMES,
// looked up by name via layer.property(name)). That meant Mask Path, an
// effect's own parameters, Text Animator properties, or anything else
// with keyframes was simply unreachable -- and real-AE use repeatedly
// tripped on the toggle silently being out of sync with what was actually
// selected (see CLAUDE.md rounds 6-7). Both problems share one fix:
// operate on whatever's ACTUALLY selected in the Timeline/Graph Editor
// (comp.selectedProperties), not a fixed name list. This works for any
// animatable property, not just the four Transform ones.
// =============================================================================

// One property, resolved from the current Timeline/Graph Editor selection,
// together with which of its keyframes to act on.
interface EaseTarget {
  prop: Property;
  layerName: string;
  propLabel: string; // e.g. "Mask 1 > Mask Path", "Position" -- for messages
  keyIndices: number[];
  usedNearest: boolean;
}

// Walks up from `prop` until it finds the owning Layer. Every PropertyBase
// (Property, PropertyGroup) exposes `.propertyGroup(1)` to reach its
// parent; Layer itself is also a PropertyBase and is where the walk stops.
function ownerLayer(prop: PropertyBase): Layer | null {
  let cur: any = prop;
  let depth = 0;
  while (cur && depth < 12) {
    if (cur instanceof Layer) return cur as Layer;
    if (!cur.propertyGroup) return null;
    try {
      cur = cur.propertyGroup(1);
    } catch (e) {
      return null;
    }
    depth++;
  }
  return null;
}

// A short, disambiguating label for an arbitrary property: its own name,
// prefixed with its immediate parent group's name when that adds real
// context (e.g. "Mask 1 > Mask Path" for a layer with multiple masks, or
// an effect's display name for one of its parameters). The ever-present
// "Transform" group is skipped since Position/Scale/Rotation/Opacity are
// already unambiguous on their own.
function propertyLabel(prop: Property): string {
  let label = prop.name;
  try {
    const parent = prop.propertyGroup(1);
    if (parent && parent.name && parent.name !== label && parent.name !== "Transform") {
      label = parent.name + " > " + label;
    }
  } catch (e) {
    // No accessible parent group -- use the bare property name.
  }
  return label;
}

// Resolves every animated property currently selected in the Timeline/
// Graph Editor (across all selected layers) into copy/paste targets, each
// with either its explicitly-selected keyframes or a nearest-to-playhead
// fallback. This is the single source of truth Easy Ease, Copy, and Paste
// all now share -- replacing the old per-function EASE_PROPERTY_NAMES
// lookup + toggle-vs-selection reconciliation entirely.
function getSelectedEaseTargets(comp: CompItem): EaseTarget[] {
  const targets: EaseTarget[] = [];
  const selProps = comp.selectedProperties;
  if (!selProps) return targets;
  for (let i = 0; i < selProps.length; i++) {
    const pb = selProps[i];
    if (pb.propertyType !== PropertyType.PROPERTY) continue;
    const prop = pb as Property;
    if (prop.numKeys === 0) continue;
    const layer = ownerLayer(prop);
    const selKeys = prop.selectedKeys;
    let keyIndices: number[];
    let usedNearest = false;
    if (selKeys && selKeys.length > 0) {
      keyIndices = selKeys.slice().sort(function (a, b) { return a - b; });
    } else {
      const nearest = prop.nearestKeyIndex(comp.time);
      if (!nearest) continue;
      keyIndices = [nearest];
      usedNearest = true;
    }
    targets.push({
      prop: prop,
      layerName: layer ? layer.name : "layer",
      propLabel: propertyLabel(prop),
      keyIndices: keyIndices,
      usedNearest: usedNearest,
    });
  }
  return targets;
}

interface EaseMessageResult extends Result { message?: string; }

function easyEaseTuple(dims: number, influence: number): [KeyframeEase] | [KeyframeEase, KeyframeEase] | [KeyframeEase, KeyframeEase, KeyframeEase] {
  if (dims >= 3) return [new KeyframeEase(0, influence), new KeyframeEase(0, influence), new KeyframeEase(0, influence)];
  if (dims === 2) return [new KeyframeEase(0, influence), new KeyframeEase(0, influence)];
  return [new KeyframeEase(0, influence)];
}

export const motionToolsApplyEase = (mode: string): EaseMessageResult => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const targets = getSelectedEaseTargets(comp);
    if (targets.length === 0) {
      return { success: false, error: "Select one or more keyframes (or an animated property) in the timeline first." };
    }

    app.beginUndoGroup("Ease");
    let touched = 0;
    const skipped: string[] = [];
    for (let t = 0; t < targets.length; t++) {
      const target = targets[t];
      const prop = target.prop;
      for (let k = 0; k < target.keyIndices.length; k++) {
        const keyIndex = target.keyIndices[k];
        try {
          const curInType = prop.keyInInterpolationType(keyIndex);
          const curOutType = prop.keyOutInterpolationType(keyIndex);
          prop.setInterpolationTypeAtKey(
            keyIndex,
            mode === "out" ? curInType : KeyframeInterpolationType.BEZIER,
            mode === "in" ? curOutType : KeyframeInterpolationType.BEZIER
          );

          const curIn = prop.keyInTemporalEase(keyIndex);
          const curOut = prop.keyOutTemporalEase(keyIndex);
          // Dimension count MUST come from AE's own ease arrays for this
          // exact key, not from prop.value.length -- they can diverge (e.g.
          // Position with "Separate Dimensions" toggled reports a plain
          // number from .value while setTemporalEaseAtKey still expects an
          // array matching its real ease dimensionality). Building the
          // tuple from prop.value caused "Value array does not have N
          // elements" on real projects.
          const newIn = mode === "out" ? curIn : easyEaseTuple(curIn.length, 33);
          const newOut = mode === "in" ? curOut : easyEaseTuple(curOut.length, 33);
          prop.setTemporalEaseAtKey(keyIndex, newIn, newOut);
          touched++;
        } catch (e) {
          // Not every property supports temporal ease (Hold-only value
          // types, text documents, markers, etc.) -- skip it and report
          // which ones, rather than aborting the whole batch.
          if (skipped.indexOf(target.propLabel) === -1) skipped.push(target.propLabel);
        }
      }
    }
    app.endUndoGroup();
    if (touched === 0) {
      return {
        success: false,
        error: skipped.length > 0
          ? skipped.join(", ") + " -- doesn't support keyframe easing (e.g. Hold-only or a non-numeric property)."
          : "No keyframes found to ease -- select a keyframe, or move the playhead onto one, first.",
      };
    }
    const skipNote = skipped.length > 0 ? " (skipped: " + skipped.join(", ") + " -- no ease support)" : "";
    return { success: true, message: "Eased " + touched + " keyframe" + (touched === 1 ? "" : "s") + skipNote };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Copy/Paste Ease -- lifts the exact temporal ease (interpolation type +
// per-dimension speed/influence) off one keyframe and re-applies it to
// other keyframes, the classic "Ease Copy" workflow (aescripts' eponymous
// script, Mister Horse's Ease Copy) -- now fully generic, operating on
// whatever property/properties are selected in the Timeline/Graph Editor
// (getSelectedEaseTargets above), not a fixed Pos/Scale/Rot/Opac list. This
// is what makes "copy Position's ease, paste it onto a Mask Path keyframe"
// possible -- Copy just needs ONE property selected (its dimensionality is
// baked into the copied payload); Paste can target as many differently-
// selected properties at once as you like, reusing the same copied ease on
// each (with per-key dimension-matching, so a 1-D source eases fine onto a
// 2-D spatial target and vice versa).
//
// Copy reads ONE property's keyframe(s) (every explicitly-selected key, or
// the nearest one to the playhead) and hands them back as plain JSON so
// the React side can hold it in memory between the Copy and Paste clicks
// -- ExtendScript calls are stateless per invocation, there's nothing to
// keep server-side. Paste re-applies them to EVERY selected/nearest
// keyframe across ALL currently-selected properties (batch). If the source
// ease has fewer dimensions than the property being pasted onto (e.g. a 1D
// Rotation ease copied onto a 2D Position key), the source's first
// dimension is repeated across the extra ones rather than erroring --
// "same feel, different property" is the whole point of an ease-copy tool.
// =============================================================================
interface SerializedKeyframeEase { speed: number; influence: number; }
// One keyframe's full temporal ease (interp type + per-dimension ease on
// each side). Copy captures an ARRAY of these -- one per selected keyframe
// -- so a multi-keyframe ease profile (e.g. an ease-in on the first key and
// a different ease-out on the last) is reproduced key-for-key on paste,
// not collapsed to a single key's ease slapped onto everything.
interface SerializedKeyEase {
  inType: "linear" | "bezier" | "hold";
  outType: "linear" | "bezier" | "hold";
  inEase: SerializedKeyframeEase[];
  outEase: SerializedKeyframeEase[];
}
interface CopyEaseResult extends Result { keys?: SerializedKeyEase[]; message?: string; }
interface PasteEaseResult extends Result { message?: string; }

function interpTypeToLabel(t: KeyframeInterpolationType): "linear" | "bezier" | "hold" {
  if (t === KeyframeInterpolationType.HOLD) return "hold";
  if (t === KeyframeInterpolationType.LINEAR) return "linear";
  return "bezier";
}

function labelToInterpType(l: string): KeyframeInterpolationType {
  if (l === "hold") return KeyframeInterpolationType.HOLD;
  if (l === "linear") return KeyframeInterpolationType.LINEAR;
  return KeyframeInterpolationType.BEZIER;
}

// Compact "in 33%/0 · out 75%/0" summary of an ease's first dimension --
// influence (%) and speed (property-units/sec). Surfaced in the copy/paste
// confirmation so the exact numbers read/written are visible in the panel;
// this is what turns "the values are wrong" into a diagnosable difference
// between what was copied and what landed. First dimension only: for a
// spatial property (Position/Anchor/Mask Path) there is only one in
// practice; for Scale etc. the dimensions are near-identical, and a full
// per-dim dump would be noise in a one-line status.
// ExtendScript (ES3) has no Number.isFinite; typeof + NaN/Infinity guard.
function isFiniteNum(v: any): boolean {
  return typeof v === "number" && !isNaN(v) && v !== Infinity && v !== -Infinity;
}

function easeNumSummary(inArr: SerializedKeyframeEase[], outArr: SerializedKeyframeEase[]): string {
  const fmt = function (e: SerializedKeyframeEase): string {
    return (Math.round(e.influence * 10) / 10) + "%/" + Math.round(e.speed);
  };
  const inS = inArr.length > 0 ? fmt(inArr[0]) : "-";
  const outS = outArr.length > 0 ? fmt(outArr[0]) : "-";
  return "in " + inS + " · out " + outS;
}

export const motionToolsCopyEase = (): CopyEaseResult => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };

    const targets = getSelectedEaseTargets(comp);
    if (targets.length === 0) {
      return { success: false, error: "Select a keyframe (or an animated property) in the timeline first." };
    }
    if (targets.length > 1) {
      // Copy can only lift the ease off ONE property at a time (a copied
      // ease's dimensionality/shape is tied to a single source) -- ask
      // rather than arbitrarily picking the first one.
      const labels = targets.map(function (t) { return t.propLabel; });
      return {
        success: false,
        error: "Multiple properties have keyframes selected (" + labels.join(", ") + "). Select keyframes on just one property to copy from.",
      };
    }

    const target = targets[0];
    const keys: SerializedKeyEase[] = [];
    for (let n = 0; n < target.keyIndices.length; n++) {
      const ki = target.keyIndices[n];
      try {
        const inTemporal = target.prop.keyInTemporalEase(ki);
        const outTemporal = target.prop.keyOutTemporalEase(ki);
        const inEase: SerializedKeyframeEase[] = [];
        const outEase: SerializedKeyframeEase[] = [];
        for (let d = 0; d < inTemporal.length; d++) inEase.push({ speed: inTemporal[d].speed, influence: inTemporal[d].influence });
        for (let d = 0; d < outTemporal.length; d++) outEase.push({ speed: outTemporal[d].speed, influence: outTemporal[d].influence });
        keys.push({
          inType: interpTypeToLabel(target.prop.keyInInterpolationType(ki)),
          outType: interpTypeToLabel(target.prop.keyOutInterpolationType(ki)),
          inEase: inEase,
          outEase: outEase,
        });
      } catch (e) {
        // Not every property supports temporal ease (Hold-only value
        // types, text documents, markers, etc.).
        return { success: false, error: target.propLabel + " doesn't support keyframe easing (e.g. Hold-only or a non-numeric property)." };
      }
    }
    if (keys.length === 0) return { success: false, error: "No usable keyframes found on " + target.propLabel + "." };

    const first = keys[0];
    return {
      success: true,
      message: "Copied " + target.propLabel + " ease from " + keys.length + " keyframe" + (keys.length === 1 ? "" : "s") + " on \"" + target.layerName + "\" [first key " + easeNumSummary(first.inEase, first.outEase) + "]" + (target.usedNearest ? " (nearest to playhead)" : ""),
      keys: keys,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface WriteEaseResult { touched: number; landedOn: string[]; skipped: string[]; keptSummary: string; }

// Shared write loop behind both Paste Ease and Apply Ease Preset -- takes
// already-resolved targets (getSelectedEaseTargets) and a source ease
// sequence, and writes it onto every target key, tolerating properties
// that don't support temporal ease. Factored out so a preset's single-key
// ease can be applied through the EXACT same, already-hardened code path
// (per-key dimension matching, per-target try/catch, "AE kept" read-back)
// rather than a second copy of this logic drifting out of sync over time.
function writeEaseToTargets(targets: EaseTarget[], keysSrc: SerializedKeyEase[]): WriteEaseResult {
  let touched = 0;
  const landedOn: string[] = [];
  const skipped: string[] = [];
  // Read-back of the first key actually written, captured straight after
  // setTemporalEaseAtKey. Comparing "asked" (the source values) against
  // "kept" (what AE stored) is the direct test for AE silently clamping a
  // pasted speed to fit the target keyframe's value delta / neighbour
  // velocity continuity -- a reason a write "succeeds" but the curve looks
  // different from the source.
  let keptSummary = "";
  for (let t = 0; t < targets.length; t++) {
    const target = targets[t];
    const prop = target.prop;
    let targetTouched = 0;
    for (let k = 0; k < target.keyIndices.length; k++) {
      const keyIndex = target.keyIndices[k];
      // Map the k-th target key to the k-th source key. When more target
      // keys than source, clamp to the last source key; when only one ease
      // is given, it lands on every target key (the "apply this ease
      // everywhere" case -- what a preset always does).
      const src = keysSrc[k < keysSrc.length ? k : keysSrc.length - 1];
      try {
        // Build EACH side to the exact length AE reports for THIS target
        // key, independently -- setTemporalEaseAtKey requires
        // inEase.length == keyInTemporalEase().length and outEase.length ==
        // keyOutTemporalEase().length, and for a MULTI-dimensional property
        // (Scale is 2-D on a 2-D layer, 3-D on 3-D; Mask Path is spatial)
        // that count can be >1. Using a single max() of both sides could
        // over/under-fill one array and throw "Value array does not have N
        // elements". If the source has fewer dimensions than the target
        // (e.g. a 1-D Rotation ease onto 2-D Scale), the source's first
        // dimension is reused.
        const inLen = prop.keyInTemporalEase(keyIndex).length;
        const outLen = prop.keyOutTemporalEase(keyIndex).length;

        prop.setInterpolationTypeAtKey(keyIndex, labelToInterpType(src.inType), labelToInterpType(src.outType));

        const inEase: KeyframeEase[] = [];
        const outEase: KeyframeEase[] = [];
        for (let d = 0; d < inLen; d++) {
          const srcIn = src.inEase[d] || src.inEase[0];
          inEase.push(new KeyframeEase(srcIn.speed, srcIn.influence));
        }
        for (let d = 0; d < outLen; d++) {
          const srcOut = src.outEase[d] || src.outEase[0];
          outEase.push(new KeyframeEase(srcOut.speed, srcOut.influence));
        }
        prop.setTemporalEaseAtKey(keyIndex, inEase, outEase);
        if (keptSummary === "") {
          const keptIn = prop.keyInTemporalEase(keyIndex);
          const keptOut = prop.keyOutTemporalEase(keyIndex);
          const keptInS: SerializedKeyframeEase[] = [];
          const keptOutS: SerializedKeyframeEase[] = [];
          for (let q = 0; q < keptIn.length; q++) keptInS.push({ speed: keptIn[q].speed, influence: keptIn[q].influence });
          for (let q = 0; q < keptOut.length; q++) keptOutS.push({ speed: keptOut[q].speed, influence: keptOut[q].influence });
          keptSummary = easeNumSummary(keptInS, keptOutS);
        }
        touched++;
        targetTouched++;
      } catch (e) {
        // Not every property supports temporal ease -- skip it and report
        // which ones, rather than aborting the whole write.
        if (skipped.indexOf(target.propLabel) === -1) skipped.push(target.propLabel);
      }
    }
    if (targetTouched > 0) landedOn.push(target.propLabel + " on \"" + target.layerName + "\"");
  }
  return { touched: touched, landedOn: landedOn, skipped: skipped, keptSummary: keptSummary };
}

export const motionToolsPasteEase = (keysJson: string): PasteEaseResult => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };

    // The copied eases cross the bridge as a JSON STRING that we parse here,
    // NOT as a nested object/array argument. evalTS embeds each argument by
    // splicing JSON.stringify(arg) straight into the eval'd ExtendScript
    // SOURCE, so a nested array-of-objects like [{"inEase":[{"speed":0,
    // "influence":75}]}] arrives as a source-code literal to be re-parsed by
    // the ExtendScript engine -- and that path silently dropped the inner
    // speed/influence values, so `new KeyframeEase(undefined, undefined)`
    // produced AE's DEFAULT ease (bezier, influence 33.33, speed 0). That
    // was the "pastes bezier but with default values, no real values passed"
    // bug. A single JSON string survives the splice intact (it's just a
    // quoted string literal), and JSON.parse below reconstructs it
    // deterministically.
    let keysSrc: SerializedKeyEase[];
    try {
      keysSrc = JSON.parse(keysJson) as SerializedKeyEase[];
    } catch (parseErr) {
      return { success: false, error: "Couldn't read the copied ease (bad payload). Copy an ease again." };
    }
    if (!keysSrc || keysSrc.length === 0) return { success: false, error: "Copy an ease first." };
    // Validate the values actually survived -- guards against ever silently
    // re-applying AE defaults if the payload is malformed. A finite-number
    // check on the first copied key's first dimension catches the undefined
    // case that produced the default-ease bug.
    const probe = keysSrc[0];
    const pIn = probe && probe.inEase && probe.inEase[0];
    const pOut = probe && probe.outEase && probe.outEase[0];
    if (!pIn || !pOut ||
        !isFiniteNum(pIn.influence) || !isFiniteNum(pIn.speed) ||
        !isFiniteNum(pOut.influence) || !isFiniteNum(pOut.speed)) {
      return { success: false, error: "The copied ease has no usable speed/influence values -- copy the ease again." };
    }

    const targets = getSelectedEaseTargets(comp);
    if (targets.length === 0) {
      return { success: false, error: "Select the target keyframe(s) in the timeline first." };
    }

    app.beginUndoGroup("Paste Ease");
    const result = writeEaseToTargets(targets, keysSrc);
    app.endUndoGroup();

    if (result.touched === 0) {
      return {
        success: false,
        error: result.skipped.length > 0
          ? result.skipped.join(", ") + " doesn't support keyframe easing."
          : "No keyframes found to paste onto -- select the target keyframe(s) in the timeline first.",
      };
    }
    // The confirmation is the actual fix for an earlier "it pastes nothing"
    // report: paste WAS succeeding, but with no feedback about WHERE it
    // landed, a nearest-key fallback onto a key the user wasn't looking at
    // read as "nothing happened". This says exactly how many keys on which
    // properties/layers got the ease.
    let anyNearest = false;
    for (let t2 = 0; t2 < targets.length; t2++) {
      if (targets[t2].usedNearest) { anyNearest = true; break; }
    }
    const kept = result.keptSummary !== "" ? " [AE kept: " + result.keptSummary + "]" : "";
    const skipNote = result.skipped.length > 0 ? " (skipped: " + result.skipped.join(", ") + " -- no ease support)" : "";
    return {
      success: true,
      message: "Pasted ease onto " + result.touched + " keyframe" + (result.touched === 1 ? "" : "s") + " (" + result.landedOn.join(", ") + ")" + kept + (anyNearest ? " (nearest to playhead on at least one target -- select target keyframes to aim it exactly)" : "") + skipNote,
    };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Ease Presets -- a small library of instantly-applicable ease shapes, built-
// in + user-saveable, sitting alongside Copy/Paste Ease. A preset is a
// SINGLE ease shape (one in/out influence+speed pair, not a full multi-
// keyframe sequence like Copy/Paste captures) applied to EVERY target key at
// once -- the same "apply this shape everywhere" behaviour writeEaseToTargets
// already gives a single-entry keysSrc array, so preset application reuses
// that exact function, not a second copy of the write logic.
//
// Works on any property via the same getSelectedEaseTargets() resolver Easy
// Ease/Copy/Paste use -- a preset applies to Position just as well as Mask
// Path or an effect parameter.
//
// User-saved presets persist via app.settings (section "XYiToolbox", key
// "MotionToolsEasePresets", a JSON array) -- same section this studio's
// toolbox already uses for Expressions Bank (tools.ts) and campaign storage
// (localise.ts), so presets survive AE restarts on this machine. Built-in
// presets are hardcoded here, never touch app.settings, and can't be
// deleted (motionToolsDeleteEasePreset silently no-ops on a built-in id).
// =============================================================================
interface EasePreset {
  id: string;
  name: string;
  isBuiltIn: boolean;
  inType: "linear" | "bezier" | "hold";
  outType: "linear" | "bezier" | "hold";
  inInfluence: number;
  inSpeed: number;
  outInfluence: number;
  outSpeed: number;
}

const BUILT_IN_EASE_PRESETS: EasePreset[] = [
  { id: "builtin-linear", name: "Linear", isBuiltIn: true, inType: "linear", outType: "linear", inInfluence: 0, inSpeed: 0, outInfluence: 0, outSpeed: 0 },
  { id: "builtin-standard", name: "Standard Ease", isBuiltIn: true, inType: "bezier", outType: "bezier", inInfluence: 33.33, inSpeed: 0, outInfluence: 33.33, outSpeed: 0 },
  { id: "builtin-ease-in", name: "Ease In Only", isBuiltIn: true, inType: "bezier", outType: "linear", inInfluence: 33.33, inSpeed: 0, outInfluence: 0, outSpeed: 0 },
  { id: "builtin-ease-out", name: "Ease Out Only", isBuiltIn: true, inType: "linear", outType: "bezier", inInfluence: 0, inSpeed: 0, outInfluence: 33.33, outSpeed: 0 },
  { id: "builtin-soft", name: "Soft Ease", isBuiltIn: true, inType: "bezier", outType: "bezier", inInfluence: 15, inSpeed: 0, outInfluence: 15, outSpeed: 0 },
  { id: "builtin-strong", name: "Strong Ease", isBuiltIn: true, inType: "bezier", outType: "bezier", inInfluence: 75, inSpeed: 0, outInfluence: 75, outSpeed: 0 },
];

const EASE_PRESET_SETTINGS_SECTION = "XYiToolbox";
const EASE_PRESET_SETTINGS_KEY = "MotionToolsEasePresets";

function loadUserEasePresets(): EasePreset[] {
  try {
    if (!app.settings.haveSetting(EASE_PRESET_SETTINGS_SECTION, EASE_PRESET_SETTINGS_KEY)) return [];
    const raw = app.settings.getSetting(EASE_PRESET_SETTINGS_SECTION, EASE_PRESET_SETTINGS_KEY);
    if (!raw || raw.length === 0) return [];
    const parsed = JSON.parse(raw);
    if (!(parsed instanceof Array)) return [];
    return parsed as EasePreset[];
  } catch (e) {
    return [];
  }
}

function saveUserEasePresets(presets: EasePreset[]): void {
  app.settings.saveSetting(EASE_PRESET_SETTINGS_SECTION, EASE_PRESET_SETTINGS_KEY, JSON.stringify(presets));
}

interface EasePresetListResult extends Result { presets?: EasePreset[]; }

export const motionToolsListEasePresets = (): EasePresetListResult => {
  try {
    return { success: true, presets: BUILT_IN_EASE_PRESETS.concat(loadUserEasePresets()) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Saves the FIRST keyframe of a copied ease (see motionToolsCopyEase's
// `keys` payload) as a new named preset -- single ease shape only, not the
// full multi-key sequence a copy can hold, matching how presets work in
// Ease and Wizz/Keyframe Assistant: one shape, applied identically to
// every target key on paste.
export const motionToolsSaveEasePreset = (name: string, keysJson: string): EasePresetListResult => {
  try {
    const trimmedName = (name || "").replace(/^\s+|\s+$/g, "");
    if (!trimmedName) return { success: false, error: "Give the preset a name first." };

    let keysSrc: SerializedKeyEase[];
    try {
      keysSrc = JSON.parse(keysJson) as SerializedKeyEase[];
    } catch (e) {
      return { success: false, error: "Couldn't read the copied ease (bad payload). Copy an ease again." };
    }
    if (!keysSrc || keysSrc.length === 0) return { success: false, error: "Copy an ease first, then save it as a preset." };
    const first = keysSrc[0];
    const fIn = first.inEase && first.inEase[0];
    const fOut = first.outEase && first.outEase[0];
    if (!fIn || !fOut || !isFiniteNum(fIn.influence) || !isFiniteNum(fIn.speed) || !isFiniteNum(fOut.influence) || !isFiniteNum(fOut.speed)) {
      return { success: false, error: "The copied ease has no usable values -- copy an ease again." };
    }

    const userPresets = loadUserEasePresets();
    userPresets.push({
      id: "user-" + new Date().getTime(),
      name: trimmedName,
      isBuiltIn: false,
      inType: first.inType,
      outType: first.outType,
      inInfluence: fIn.influence,
      // Speed is deliberately dropped (forced to 0), not carried over from
      // the copied keyframe. Unlike influence (a %, portable anywhere),
      // speed is an ABSOLUTE value/sec tied to that one keyframe's own
      // value delta -- copying a keyframe with a big/fast move (confirmed
      // on a real spike: ~200,000 units/sec) into a preset and reapplying
      // it to an unrelated keyframe/property produces a nonsensical,
      // warped curve, because AE has to reinterpret a wildly out-of-range
      // absolute velocity for a completely different value range. A preset
      // is meant to be a reusable SHAPE, applicable anywhere -- exactly
      // what every built-in preset already is (all speed: 0 above) -- so
      // user-saved presets are normalized to match, not just copied
      // verbatim from whatever the source keyframe happened to be moving.
      inSpeed: 0,
      outInfluence: fOut.influence,
      outSpeed: 0,
    });
    saveUserEasePresets(userPresets);
    return { success: true, presets: BUILT_IN_EASE_PRESETS.concat(userPresets) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const motionToolsDeleteEasePreset = (id: string): EasePresetListResult => {
  try {
    // Silently no-ops on a built-in id -- there's no user-facing delete
    // control on built-in presets, so this only ever runs against a real
    // user preset id in practice, but guarding here too means the stored
    // list can never end up missing a built-in through some future bug.
    const userPresets = loadUserEasePresets();
    const next: EasePreset[] = [];
    for (let i = 0; i < userPresets.length; i++) {
      if (userPresets[i].id !== id) next.push(userPresets[i]);
    }
    saveUserEasePresets(next);
    return { success: true, presets: BUILT_IN_EASE_PRESETS.concat(next) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const motionToolsApplyEasePreset = (id: string): PasteEaseResult => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };

    const all = BUILT_IN_EASE_PRESETS.concat(loadUserEasePresets());
    let preset: EasePreset | null = null;
    for (let i = 0; i < all.length; i++) {
      if (all[i].id === id) { preset = all[i]; break; }
    }
    if (!preset) return { success: false, error: "Preset not found -- it may have been deleted." };

    // A preset is always a SINGLE ease shape -- one-entry keysSrc, so
    // writeEaseToTargets's "only one source ease -> apply to every target
    // key" behaviour lands it identically on every selected keyframe,
    // regardless of how many there are.
    const keysSrc: SerializedKeyEase[] = [{
      inType: preset.inType,
      outType: preset.outType,
      inEase: [{ speed: preset.inSpeed, influence: preset.inInfluence }],
      outEase: [{ speed: preset.outSpeed, influence: preset.outInfluence }],
    }];

    const targets = getSelectedEaseTargets(comp);
    if (targets.length === 0) {
      return { success: false, error: "Select the target keyframe(s) in the timeline first." };
    }

    app.beginUndoGroup("Apply Ease Preset");
    const result = writeEaseToTargets(targets, keysSrc);
    app.endUndoGroup();

    if (result.touched === 0) {
      return {
        success: false,
        error: result.skipped.length > 0
          ? result.skipped.join(", ") + " doesn't support keyframe easing."
          : "No keyframes found to apply the preset to -- select the target keyframe(s) in the timeline first.",
      };
    }
    const skipNote = result.skipped.length > 0 ? " (skipped: " + result.skipped.join(", ") + " -- no ease support)" : "";
    return {
      success: true,
      message: "Applied \"" + preset.name + "\" to " + result.touched + " keyframe" + (result.touched === 1 ? "" : "s") + " (" + result.landedOn.join(", ") + ")" + skipNote,
    };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Align & Distribute -- the Motion 2 / Motion Tools Pro signature. Aligns the
// selected layers' bounding boxes to a comp edge/center, or to each other's
// collective bounds. Distribute spaces 3+ layers evenly by center along one
// axis. Only Position is moved (never scale), and only the axis being aligned
// -- aligning Left leaves each layer's vertical position untouched.
//
// edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"
// relativeTo: "comp" | "selection"
// =============================================================================
export const motionToolsAlign = (edge: string, relativeTo: string): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };
    if (relativeTo === "selection" && layers.length < 2) return { success: false, error: "Select at least 2 layers to align to each other." };

    const isHorizontal = edge === "left" || edge === "hcenter" || edge === "right";
    const time = comp.time;

    // Gather bounds up front (bounds depend on current transforms, which we're
    // about to change) so a multi-layer "align to selection" measures the
    // ORIGINAL box, not one shifting mid-loop.
    const entries: { layer: Layer; bounds: LayerBounds }[] = [];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      // See motionToolsSnapAnchor above for why this is duck-typed rather
      // than `instanceof AVLayer` (doesn't reliably match shape layers).
      if (typeof (layer as any).sourceRectAtTime !== "function") continue;
      const b = getLayerBounds(layer as AVLayer, time);
      if (b) entries.push({ layer: layer, bounds: b });
    }
    if (entries.length === 0) return { success: false, error: "No eligible layers selected (need layers with visible bounds)." };

    // Target reference edge/center value on the relevant axis.
    let targetMin: number, targetMax: number;
    if (relativeTo === "comp") {
      targetMin = 0;
      targetMax = isHorizontal ? comp.width : comp.height;
    } else {
      targetMin = Number.MAX_VALUE;
      targetMax = -Number.MAX_VALUE;
      for (let i = 0; i < entries.length; i++) {
        const b = entries[i].bounds;
        const lo = isHorizontal ? b.left : b.top;
        const hi = isHorizontal ? b.left + b.width : b.top + b.height;
        if (lo < targetMin) targetMin = lo;
        if (hi > targetMax) targetMax = hi;
      }
    }
    const targetCenter = (targetMin + targetMax) / 2;

    app.beginUndoGroup("Align Layers");
    for (let i = 0; i < entries.length; i++) {
      const layer = entries[i].layer;
      const b = entries[i].bounds;

      let delta = 0;
      if (edge === "left") delta = targetMin - b.left;
      else if (edge === "right") delta = targetMax - (b.left + b.width);
      else if (edge === "hcenter") delta = targetCenter - b.cx;
      else if (edge === "top") delta = targetMin - b.top;
      else if (edge === "bottom") delta = targetMax - (b.top + b.height);
      else if (edge === "vcenter") delta = targetCenter - b.cy;

      // Bounds (b) are in comp space (parent-aware) and so is `delta`;
      // applyCompDeltaToPosition writes it back into Position correctly
      // whether or not the layer is parented.
      applyCompDeltaToPosition(layer, isHorizontal ? delta : 0, isHorizontal ? 0 : delta, time);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

export const motionToolsDistribute = (axis: string): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length < 3) return { success: false, error: "Select at least 3 layers to distribute." };

    const isHorizontal = axis === "horizontal";
    const time = comp.time;

    const entries: { layer: Layer; bounds: LayerBounds }[] = [];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      // See motionToolsSnapAnchor above for why this is duck-typed rather
      // than `instanceof AVLayer` (doesn't reliably match shape layers).
      if (typeof (layer as any).sourceRectAtTime !== "function") continue;
      const b = getLayerBounds(layer as AVLayer, time);
      if (b) entries.push({ layer: layer, bounds: b });
    }
    if (entries.length < 3) return { success: false, error: "Need at least 3 layers with visible bounds to distribute." };

    // Sort by center along the axis; hold the two extremes fixed and space the
    // rest evenly between them by center -- the standard "distribute centers".
    entries.sort(function (a, b) {
      return (isHorizontal ? a.bounds.cx - b.bounds.cx : a.bounds.cy - b.bounds.cy);
    });
    const first = isHorizontal ? entries[0].bounds.cx : entries[0].bounds.cy;
    const last = isHorizontal ? entries[entries.length - 1].bounds.cx : entries[entries.length - 1].bounds.cy;
    const gap = (last - first) / (entries.length - 1);

    app.beginUndoGroup("Distribute Layers");
    for (let i = 1; i < entries.length - 1; i++) {
      const layer = entries[i].layer;
      const b = entries[i].bounds;
      const targetCenter = first + gap * i;
      // Comp-space delta, parent-aware apply (see align above).
      const delta = isHorizontal ? targetCenter - b.cx : targetCenter - b.cy;
      applyCompDeltaToPosition(layer, isHorizontal ? delta : 0, isHorizontal ? 0 : delta, time);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Sequence / Stagger -- offsets each selected layer in time so they cascade,
// Motion 2's "Shifter" in miniature. Ordered top-to-bottom by layer index
// (not selection order, which is unpredictable); `reverse` flips that. Offset
// is in frames, snapped to whole frames via frameDuration.
// =============================================================================
export const motionToolsSequence = (frames: number, reverse: boolean): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length < 2) return { success: false, error: "Select at least 2 layers to sequence." };

    // Stable copy sorted by layer index (top layer = index 1).
    const ordered: Layer[] = [];
    for (let i = 0; i < layers.length; i++) ordered.push(layers[i]);
    ordered.sort(function (a, b) { return a.index - b.index; });
    if (reverse) ordered.reverse();

    app.beginUndoGroup("Sequence Layers");
    // Anchor the cascade to the earliest current startTime among the selection
    // so the group stays roughly where it is rather than all jumping to 0.
    let base = Number.MAX_VALUE;
    for (let i = 0; i < ordered.length; i++) if (ordered[i].startTime < base) base = ordered[i].startTime;
    const step = frames * comp.frameDuration;
    for (let i = 0; i < ordered.length; i++) {
      ordered[i].startTime = base + i * step;
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Excite -- adds an overshoot/bounce EXPRESSION to the selected properties
// (Motion 2's headline "Excite"). Applies to whatever properties are selected
// in the Timeline/Graph Editor (comp.selectedProperties), so the user picks
// exactly what animates -- Position, a Slider, Scale, etc. The expression
// rings out AFTER the final keyframe (the keyframed animation itself is
// untouched) -- so to SEE it, the playhead has to move past the last key.
// strength (1-10) tunes frequency + decay.
//   type: "overshoot" (signed elastic settle) | "bounce" (abs, settles from
//         one side, reads as a physical bounce)
//
// **Amplitude bugfix (first real-AE test found it "did nothing")**: the
// first version read velocityAtTime() a tenth of a frame before the last
// key. With easy-eased keyframes -- the default state of most real keys,
// and exactly what our own Ease buttons produce -- the velocity curve hits
// ~0 AT the key, so the sampled amplitude was ~0 and the ring-out was
// invisible. Now uses the AVERAGE velocity across the final keyframe
// segment ((lastKey.value - prevKey.value) / segment duration), which
// captures "how big/fast was the move into the last key" regardless of
// its easing. This is also why >= 2 keyframes are now REQUIRED (need a
// segment to average over) -- enforced with a clear error instead of
// silently attaching an expression that evaluates to nothing.
// =============================================================================
function exciteExpression(type: string, strength: number): string {
  const s = Math.max(1, Math.min(10, strength));
  const freq = (type === "bounce" ? 1.5 : 2.0) + s * 0.4;
  const decay = Math.max(1, (type === "bounce" ? 9 : 10) - s * 0.7);
  const oscillator = type === "bounce" ? "Math.abs(Math.sin(t*w))" : "Math.sin(t*w)";
  return (
    "freq = " + freq.toFixed(2) + ";\n" +
    "decay = " + decay.toFixed(2) + ";\n" +
    "if (numKeys > 1 && time > key(numKeys).time){\n" +
    "  t = time - key(numKeys).time;\n" +
    "  seg = Math.max(key(numKeys).time - key(numKeys-1).time, thisComp.frameDuration);\n" +
    "  amp = (key(numKeys).value - key(numKeys-1).value) / seg;\n" +
    "  w = freq*Math.PI*2;\n" +
    "  value + amp*(" + oscillator + "/Math.exp(decay*t)/w);\n" +
    "} else { value; }"
  );
}

export const motionToolsExcite = (type: string, strength: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const selProps = comp.selectedProperties;
    if (!selProps || selProps.length === 0) {
      return { success: false, error: "Select a property (e.g. Position) in the timeline first -- Excite applies to whatever property is selected." };
    }

    app.beginUndoGroup("Excite");
    const expr = exciteExpression(type, strength);
    let touched = 0;
    let hadUnkeyed = false;
    for (let i = 0; i < selProps.length; i++) {
      const p = selProps[i] as Property;
      if (p.propertyType !== PropertyType.PROPERTY) continue;
      if (!p.canSetExpression) continue;
      if (p.numKeys < 2) { hadUnkeyed = true; continue; }
      p.expression = expr;
      touched++;
    }
    app.endUndoGroup();
    if (touched === 0) {
      return {
        success: false,
        error: hadUnkeyed
          ? "Excite needs at least 2 keyframes on the property -- it springs out of the motion INTO the last keyframe, then rings out after it."
          : "No expression-capable property selected. Select something like Position or Scale in the timeline.",
      };
    }
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// Clears the expression on the selected properties -- the undo path for
// Excite (Ctrl+Z works too, but only right after; this works any time).
// Deliberately clears ANY expression on the selected property, not just
// ours -- detecting "is this specifically an Excite expression" via string
// matching would be fragile, and "remove expression from what I selected"
// is a predictable, useful behavior on its own.
export const motionToolsExciteRemove = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const selProps = comp.selectedProperties;
    if (!selProps || selProps.length === 0) {
      return { success: false, error: "Select the property with the expression in the timeline first." };
    }
    app.beginUndoGroup("Remove Excite");
    let touched = 0;
    for (let i = 0; i < selProps.length; i++) {
      const p = selProps[i] as Property;
      if (p.propertyType !== PropertyType.PROPERTY) continue;
      if (!p.canSetExpression || !p.expression) continue;
      p.expression = "";
      touched++;
    }
    app.endUndoGroup();
    if (touched === 0) return { success: false, error: "No expression found on the selected properties." };
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Group into Null -- parents the selected layers to a new null placed at the
// CENTER of their collective bounds, non-destructively (like Motion 2's
// "Group"). The null is given anchorPoint == position == that center, which
// makes it an identity transform, so parenting the children to it does NOT
// move them (no jump) while still giving you one handle that pivots around
// the group's middle.
// =============================================================================
export const motionToolsGroup = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };

    const time = comp.time;
    // Center = middle of the union of AVLayer bounds; falls back to the
    // average of raw Position values when nothing has measurable bounds
    // (e.g. all cameras/lights), so there's always a sensible pivot.
    let minX = Number.MAX_VALUE, minY = Number.MAX_VALUE, maxX = -Number.MAX_VALUE, maxY = -Number.MAX_VALUE;
    let boundsCount = 0;
    let sumX = 0, sumY = 0, posCount = 0;
    let topIndex = Number.MAX_VALUE;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer.index < topIndex) topIndex = layer.index;
      const posProp = layer.property("Position") as Property;
      if (posProp) {
        const pos = currentOrKeyframedValue(posProp, time) as number[];
        sumX += pos[0]; sumY += pos[1]; posCount++;
      }
      // See motionToolsSnapAnchor above for why this is duck-typed rather
      // than `instanceof AVLayer` (doesn't reliably match shape layers).
      if (typeof (layer as any).sourceRectAtTime === "function") {
        const b = getLayerBounds(layer as AVLayer, time);
        if (b) {
          if (b.left < minX) minX = b.left;
          if (b.top < minY) minY = b.top;
          if (b.left + b.width > maxX) maxX = b.left + b.width;
          if (b.top + b.height > maxY) maxY = b.top + b.height;
          boundsCount++;
        }
      }
    }
    const cx = boundsCount > 0 ? (minX + maxX) / 2 : (posCount > 0 ? sumX / posCount : comp.width / 2);
    const cy = boundsCount > 0 ? (minY + maxY) / 2 : (posCount > 0 ? sumY / posCount : comp.height / 2);

    app.beginUndoGroup("Group into Null");
    const nullLayer = comp.layers.addNull(comp.duration);
    nullLayer.name = "GROUP";
    (nullLayer.property("Anchor Point") as Property).setValue([cx, cy]);
    (nullLayer.property("Position") as Property).setValue([cx, cy]);
    // Place the null just above the topmost previously-selected layer. The
    // new null is currently at index 1 (added on top); moving it before the
    // topmost selected layer shifts that layer's index down by one, but the
    // reference is captured before this move so it's still correct.
    const topLayer = comp.layer(topIndex + 1); // +1: null insertion pushed everything down one
    if (topLayer) nullLayer.moveBefore(topLayer);

    for (let i = 0; i < layers.length; i++) {
      layers[i].parent = nullLayer;
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Fit / Fill / Stretch to comp -- the retarget workhorse for this studio: the
// same creative gets rebuilt at a dozen DOOH sizes, and "make this layer fill
// the frame properly" is a thing you do all day, by hand, with a calculator.
//   "contain" -- scale uniformly until the content fits INSIDE the comp
//                (letterboxes; nothing is cropped)
//   "cover"   -- scale uniformly until the content COVERS the comp
//                (crops the overflowing axis; the usual choice for artwork)
//   "stretch" -- scale each axis independently to exactly the comp size
//                (distorts; matches Adjust's own deliberately non-proportional
//                behavior, see CLAUDE.md)
// Each layer is also centered in the comp -- fitting without centering leaves
// the layer scaled but parked wherever it was, which is never what's wanted.
//
// Measures the layer's own content rect (getContentFrameRect -- the nested
// comp's frame for a precomp, sourceRectAtTime otherwise, same as the anchor
// tools) so the result is independent of the layer's current scale/anchor.
// Rotation is ignored, same axis-aligned assumption align/distribute make.
// =============================================================================
export const motionToolsFit = (mode: string): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };

    app.beginUndoGroup("Fit to Comp");
    const time = comp.time;
    let touched = 0;
    for (let i = 0; i < layers.length; i++) {
      const rawLayer = layers[i];
      // Duck-typed, not `instanceof AVLayer` -- see motionToolsSnapAnchor.
      if (typeof (rawLayer as any).sourceRectAtTime !== "function") continue;
      const layer = rawLayer as AVLayer;

      const rect = getContentFrameRect(layer, time);
      if (rect.width <= 0 || rect.height <= 0) continue;

      const scaleProp = layer.property("Scale") as Property;
      const posProp = layer.property("Position") as Property;
      const anchorProp = layer.property("Anchor Point") as Property;
      if (!scaleProp || !posProp || !anchorProp) continue;

      const fx = comp.width / rect.width;
      const fy = comp.height / rect.height;
      let sx: number;
      let sy: number;
      if (mode === "stretch") {
        sx = fx;
        sy = fy;
      } else {
        const f = mode === "cover" ? Math.max(fx, fy) : Math.min(fx, fy);
        sx = f;
        sy = f;
      }

      const curScale = currentOrKeyframedValue(scaleProp, time) as number[];
      const newScale = curScale.length > 2
        ? [sx * 100, sy * 100, curScale[2]]
        : [sx * 100, sy * 100];
      applyValue(scaleProp, time, newScale);

      // Center: put the content rect's own center on the comp's center. The
      // content center sits (rect center - anchor) away from the layer's
      // position, scaled by the NEW scale -- so position has to absorb that
      // offset rather than just being set to the comp center.
      const anchor = currentOrKeyframedValue(anchorProp, time) as number[];
      const curPos = currentOrKeyframedValue(posProp, time) as number[];
      const px = comp.width / 2 - (rect.left + rect.width / 2 - anchor[0]) * sx;
      const py = comp.height / 2 - (rect.top + rect.height / 2 - anchor[1]) * sy;
      const newPos = curPos.length > 2 ? [px, py, curPos[2]] : [px, py];
      applyValue(posProp, time, newPos);
      touched++;
    }
    app.endUndoGroup();
    if (touched === 0) return { success: false, error: "No eligible layers selected (cameras/lights/audio can't be fitted)." };
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// Flip horizontally/vertically by negating one Scale axis. Flips AROUND THE
// LAYER'S ANCHOR POINT (AE's own behavior for a negative scale) -- pair with
// the Anchor tab if the pivot isn't where you want it. Deliberately no
// position compensation: "flip in place around the anchor" is the expected
// behavior, and silently re-centering it would be surprising.
export const motionToolsFlip = (axis: string): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };

    app.beginUndoGroup("Flip Layers");
    const time = comp.time;
    let touched = 0;
    for (let i = 0; i < layers.length; i++) {
      const scaleProp = layers[i].property("Scale") as Property;
      if (!scaleProp) continue;
      const cur = currentOrKeyframedValue(scaleProp, time) as number[];
      const next = cur.length > 2 ? [cur[0], cur[1], cur[2]] : [cur[0], cur[1]];
      if (axis === "vertical") next[1] = -next[1];
      else next[0] = -next[0];
      applyValue(scaleProp, time, next);
      touched++;
    }
    app.endUndoGroup();
    if (touched === 0) return { success: false, error: "No eligible layers selected (cameras/lights have no scale)." };
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Trim In/Out to the playhead -- AE's own Alt+[ / Alt+], but reachable from
// the panel (and, unlike the shortcut, it reports what it couldn't do rather
// than silently no-op'ing). Skips any layer where the playhead is outside the
// layer's own span, since AE throws on an inPoint past its outPoint.
// =============================================================================
export const motionToolsTrim = (edge: string): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };

    app.beginUndoGroup(edge === "out" ? "Trim Out to Playhead" : "Trim In to Playhead");
    const time = comp.time;
    let touched = 0;
    let skipped = 0;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      try {
        if (edge === "out") {
          if (time <= layer.inPoint) { skipped++; continue; }
          layer.outPoint = time;
        } else {
          if (time >= layer.outPoint) { skipped++; continue; }
          layer.inPoint = time;
        }
        touched++;
      } catch (e) {
        skipped++;
      }
    }
    app.endUndoGroup();
    if (touched === 0) {
      return { success: false, error: "The playhead isn't inside any selected layer's span." };
    }
    if (skipped > 0) {
      return { success: false, error: "Trimmed " + touched + " layer(s); skipped " + skipped + " the playhead sits outside of." };
    }
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Reverse Keyframes -- mirrors each property's keys in time about the span
// they already occupy (first key stays put, last key stays put, everything
// between flips), so an animation plays backwards without moving in the
// timeline.
//
// Acts on whatever's selected in the Timeline/Graph Editor
// (comp.selectedProperties -- same resolution model the generic ease
// copy/paste uses); if no property is selected, falls back to every animated
// property on the selected LAYERS, found by walking each layer's property
// tree DOWNWARD only. That direction matters: True Comp Duplicator froze AE
// solid by also calling propertyGroup(1) (which returns the PARENT, not a
// child) during a tree walk, turning it into an exponential up-and-down
// re-traversal (see CLAUDE.md) -- never reintroduce an upward step here.
//
// Easing and interpolation are carried across and SWAPPED per key (a key's
// in-ease becomes its out-ease and vice versa), which is what makes the
// reversed curve actually mirror the original rather than keeping the same
// acceleration shape pointing the wrong way. Spatial tangents (Position's
// motion path) get the same swap.
// =============================================================================
function collectAnimatedProps(group: PropertyGroup, out: Property[], depth: number): void {
  if (depth > 8) return; // depth guard: no realistic property tree is deeper
  for (let i = 1; i <= group.numProperties; i++) {
    const child = group.property(i) as PropertyBase;
    if (!child) continue;
    if (child.propertyType === PropertyType.PROPERTY) {
      const prop = child as Property;
      if (prop.numKeys >= 2) out.push(prop);
    } else {
      // Downward only -- children, never propertyGroup(1)/the parent.
      collectAnimatedProps(child as PropertyGroup, out, depth + 1);
    }
  }
}

function reverseKeyframesOnProperty(prop: Property): boolean {
  const n = prop.numKeys;
  if (n < 2) return false;
  const firstTime = prop.keyTime(1);
  const lastTime = prop.keyTime(n);

  const snapshot: any[] = [];
  for (let k = 1; k <= n; k++) {
    const entry: any = {
      time: prop.keyTime(k),
      value: prop.keyValue(k),
      inInterp: prop.keyInInterpolationType(k),
      outInterp: prop.keyOutInterpolationType(k),
      inEase: prop.keyInTemporalEase(k),
      outEase: prop.keyOutTemporalEase(k),
      spatial: null as any,
    };
    if (prop.isSpatial) {
      try {
        entry.spatial = {
          inTangent: prop.keyInSpatialTangent(k),
          outTangent: prop.keyOutSpatialTangent(k),
          autoBezier: prop.keySpatialAutoBezier(k),
          continuous: prop.keySpatialContinuous(k),
          roving: prop.keyRoving(k),
        };
      } catch (e) { /* roving/tangent reads can throw on edge keys -- fine */ }
    }
    snapshot.push(entry);
  }

  for (let k = n; k >= 1; k--) prop.removeKey(k);

  // Re-add mirrored about [firstTime, lastTime]. Written back in ascending
  // time order, so new key j corresponds to snapshot[n - j].
  for (let i = n - 1; i >= 0; i--) {
    prop.setValueAtTime(firstTime + (lastTime - snapshot[i].time), snapshot[i].value);
  }

  for (let j = 1; j <= n; j++) {
    const src = snapshot[n - j];
    // Swapped: what used to lead INTO this key now leads OUT of it.
    try { prop.setInterpolationTypeAtKey(j, src.outInterp, src.inInterp); } catch (e) { /* hold-only props */ }
    try { prop.setTemporalEaseAtKey(j, src.outEase, src.inEase); } catch (e) { /* no temporal ease support */ }
    if (src.spatial) {
      try {
        prop.setSpatialAutoBezierAtKey(j, src.spatial.autoBezier);
        prop.setSpatialContinuousAtKey(j, src.spatial.continuous);
        prop.setSpatialTangentsAtKey(j, src.spatial.outTangent, src.spatial.inTangent);
        prop.setRovingAtKey(j, src.spatial.roving);
      } catch (e) { /* roving is illegal on the first/last key -- ignore */ }
    }
  }
  return true;
}

export const motionToolsReverseKeyframes = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };

    const targets: Property[] = [];
    const selectedProps = comp.selectedProperties;
    for (let i = 0; i < selectedProps.length; i++) {
      const p = selectedProps[i];
      if (p.propertyType === PropertyType.PROPERTY && (p as Property).numKeys >= 2) targets.push(p as Property);
    }

    if (targets.length === 0) {
      const layers = comp.selectedLayers;
      if (layers.length === 0) {
        return { success: false, error: "Select some layers, or the animated properties you want reversed." };
      }
      for (let i = 0; i < layers.length; i++) {
        collectAnimatedProps(layers[i] as any as PropertyGroup, targets, 0);
      }
    }

    if (targets.length === 0) {
      return { success: false, error: "Nothing animated in the selection (a property needs 2+ keyframes to reverse)." };
    }

    app.beginUndoGroup("Reverse Keyframes");
    let touched = 0;
    for (let i = 0; i < targets.length; i++) {
      try {
        if (reverseKeyframesOnProperty(targets[i])) touched++;
      } catch (e) { /* skip one stubborn property rather than abort the batch */ }
    }
    app.endUndoGroup();
    if (touched === 0) return { success: false, error: "Couldn't reverse any of the selected properties." };
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};
