// =============================================================================
// src/jsx/aeft/motionTools.ts -- ExtendScript backend for the "Motion Tools"
// droplet (src/js/main/MotionToolsDroplet.tsx), a quick-access popover
// button to the LEFT of the home screen's search box. Split out of aeft.ts
// per this project's usual per-feature file convention (see aeft.ts's own
// header comment).
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

// Axis-aligned bounding box of an AVLayer's rendered content in COMP space,
// derived from its own content rect (sourceRectAtTime, independent of the
// current anchor/position) transformed by the layer's current anchor,
// position, and scale. Rotation is intentionally ignored -- align/distribute
// tools everywhere (AE's own included) work on axis-aligned bounds, and
// factoring in rotation would give a looser, less predictable box. **Parenting
// caveat**: `Position` for a parented layer is in its PARENT's space, so
// aligning a parented layer to the comp mixes coordinate spaces and will be
// off -- same limitation Motion 2/most align scripts have; flagged rather
// than silently wrong.
interface LayerBounds { left: number; top: number; width: number; height: number; cx: number; cy: number; }

function getLayerBounds(layer: AVLayer, time: number): LayerBounds | null {
  const rect = layer.sourceRectAtTime(time, false);
  const anchorProp = layer.property("Anchor Point") as Property;
  const posProp = layer.property("Position") as Property;
  const scaleProp = layer.property("Scale") as Property;
  if (!anchorProp || !posProp) return null;
  const anchor = currentOrKeyframedValue(anchorProp, time) as number[];
  const pos = currentOrKeyframedValue(posProp, time) as number[];
  const scale = scaleProp ? (currentOrKeyframedValue(scaleProp, time) as number[]) : [100, 100];
  const sx = scale[0] / 100;
  const sy = scale[1] / 100;
  const left = pos[0] + (rect.left - anchor[0]) * sx;
  const top = pos[1] + (rect.top - anchor[1]) * sy;
  const width = rect.width * sx;
  const height = rect.height * sy;
  return { left, top, width, height, cx: left + width / 2, cy: top + height / 2 };
}

// =============================================================================
// Anchor Point -- the single most-requested quality-of-life fix motion
// designers reach for free/paid "anchor point" scripts for: After Effects'
// own anchor point tool doesn't let you snap to a corner/edge/center of a
// layer's actual content without the layer visually jumping, since moving
// the anchor point alone shifts the rendered position too. This snaps the
// anchor to one of 9 positions on the layer's own bounding box (from
// sourceRectAtTime, which is independent of the current anchor/position)
// and compensates Position in the same call so nothing visibly moves.
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
      const layer = layers[i];
      // Only AVLayers (footage/comp/solid/text/shape) have sourceRectAtTime
      // and a Scale/Rotation transform -- cameras/lights/audio-only layers
      // are silently skipped rather than thrown on.
      if (!(layer instanceof AVLayer)) continue;

      const rect = layer.sourceRectAtTime(time, false);
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
      const newPos = oldPos.length > 2 ? [oldPos[0] + rdx, oldPos[1] + rdy, oldPos[2]] : [oldPos[0] + rdx, oldPos[1] + rdy];

      applyValue(anchorProp, time, newAnchor);
      applyValue(posProp, time, newPos);
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
// =============================================================================
const EASE_PROPERTY_NAMES: Record<string, string> = {
  position: "Position",
  scale: "Scale",
  rotation: "Rotation",
  opacity: "Opacity",
};

function easyEaseTuple(dims: number, influence: number): [KeyframeEase] | [KeyframeEase, KeyframeEase] | [KeyframeEase, KeyframeEase, KeyframeEase] {
  if (dims >= 3) return [new KeyframeEase(0, influence), new KeyframeEase(0, influence), new KeyframeEase(0, influence)];
  if (dims === 2) return [new KeyframeEase(0, influence), new KeyframeEase(0, influence)];
  return [new KeyframeEase(0, influence)];
}

export const motionToolsApplyEase = (propertyKey: string, mode: string): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };
    const propName = EASE_PROPERTY_NAMES[propertyKey];
    if (!propName) return { success: false, error: "Unknown property." };

    app.beginUndoGroup("Ease " + propName);
    let touched = 0;
    for (let i = 0; i < layers.length; i++) {
      const prop = layers[i].property(propName) as Property;
      if (!prop || prop.numKeys === 0) continue;

      let keys = prop.selectedKeys;
      if (!keys || keys.length === 0) {
        const nearest = prop.nearestKeyIndex(comp.time);
        keys = nearest ? [nearest] : [];
      }

      for (let k = 0; k < keys.length; k++) {
        const keyIndex = keys[k];
        const dims = prop.value instanceof Array ? prop.value.length : 1;
        const ease = easyEaseTuple(dims, 33);

        const curInType = prop.keyInInterpolationType(keyIndex);
        const curOutType = prop.keyOutInterpolationType(keyIndex);
        prop.setInterpolationTypeAtKey(
          keyIndex,
          mode === "out" ? curInType : KeyframeInterpolationType.BEZIER,
          mode === "in" ? curOutType : KeyframeInterpolationType.BEZIER
        );

        const curIn = prop.keyInTemporalEase(keyIndex);
        const curOut = prop.keyOutTemporalEase(keyIndex);
        prop.setTemporalEaseAtKey(keyIndex, mode === "out" ? curIn : ease, mode === "in" ? curOut : ease);
        touched++;
      }
    }
    app.endUndoGroup();
    if (touched === 0) {
      return { success: false, error: "No keyframes found on " + propName + " for the selected layers -- select a keyframe, or move the playhead onto one, first." };
    }
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Copy/Paste Ease -- lifts the exact temporal ease (interpolation type +
// per-dimension speed/influence) off one keyframe and re-applies it to
// other keyframes, the classic "Ease Copy" workflow (aescripts' eponymous
// script, Mister Horse's Ease Copy) adapted to this app's own
// property-picker (the Ease tab's Pos/Scale/Rot/Opac toggle) and
// keyframe-selection conventions (Property.selectedKeys, falling back to
// the nearest key to the playhead -- same as Easy Ease above).
//
// Copy reads ONE keyframe (first selected/nearest, first eligible layer in
// the selection) and hands it back as plain JSON so the React side can
// hold it in memory between the Copy and Paste clicks -- ExtendScript calls
// are stateless per invocation, there's nothing to keep server-side.
// Paste re-applies it to EVERY selected/nearest keyframe across the
// current layer selection. If the source ease has fewer dimensions than
// the property being pasted onto (e.g. a 1D Rotation ease copied onto a 2D
// Position key), the source's first dimension is repeated across the
// extra ones rather than erroring -- "same feel, different property" is
// the whole point of an ease-copy tool.
// =============================================================================
interface SerializedKeyframeEase { speed: number; influence: number; }
interface SerializedEase {
  inType: "linear" | "bezier" | "hold";
  outType: "linear" | "bezier" | "hold";
  inEase: SerializedKeyframeEase[];
  outEase: SerializedKeyframeEase[];
}
interface CopyEaseResult extends Result { ease?: SerializedEase; }

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

export const motionToolsCopyEase = (propertyKey: string): CopyEaseResult => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select a layer with a keyframe first." };
    const propName = EASE_PROPERTY_NAMES[propertyKey];
    if (!propName) return { success: false, error: "Unknown property." };

    for (let i = 0; i < layers.length; i++) {
      const prop = layers[i].property(propName) as Property;
      if (!prop || prop.numKeys === 0) continue;

      let keyIndex = 0;
      const selKeys = prop.selectedKeys;
      if (selKeys && selKeys.length > 0) keyIndex = selKeys[0];
      else {
        const nearest = prop.nearestKeyIndex(comp.time);
        if (!nearest) continue;
        keyIndex = nearest;
      }

      const inTemporal = prop.keyInTemporalEase(keyIndex);
      const outTemporal = prop.keyOutTemporalEase(keyIndex);
      const inEase: SerializedKeyframeEase[] = [];
      const outEase: SerializedKeyframeEase[] = [];
      for (let d = 0; d < inTemporal.length; d++) inEase.push({ speed: inTemporal[d].speed, influence: inTemporal[d].influence });
      for (let d = 0; d < outTemporal.length; d++) outEase.push({ speed: outTemporal[d].speed, influence: outTemporal[d].influence });

      return {
        success: true,
        ease: {
          inType: interpTypeToLabel(prop.keyInInterpolationType(keyIndex)),
          outType: interpTypeToLabel(prop.keyOutInterpolationType(keyIndex)),
          inEase: inEase,
          outEase: outEase,
        },
      };
    }
    return { success: false, error: "No keyframes found on " + propName + " -- select a keyframe, or move the playhead onto one, first." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const motionToolsPasteEase = (propertyKey: string, ease: SerializedEase): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    if (!ease || !ease.inEase || !ease.outEase) return { success: false, error: "Copy an ease first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };
    const propName = EASE_PROPERTY_NAMES[propertyKey];
    if (!propName) return { success: false, error: "Unknown property." };

    app.beginUndoGroup("Paste Ease");
    let touched = 0;
    for (let i = 0; i < layers.length; i++) {
      const prop = layers[i].property(propName) as Property;
      if (!prop || prop.numKeys === 0) continue;

      let keys = prop.selectedKeys;
      if (!keys || keys.length === 0) {
        const nearest = prop.nearestKeyIndex(comp.time);
        keys = nearest ? [nearest] : [];
      }

      for (let k = 0; k < keys.length; k++) {
        const keyIndex = keys[k];
        const dims = prop.value instanceof Array ? prop.value.length : 1;

        prop.setInterpolationTypeAtKey(keyIndex, labelToInterpType(ease.inType), labelToInterpType(ease.outType));

        const inEase: KeyframeEase[] = [];
        const outEase: KeyframeEase[] = [];
        for (let d = 0; d < dims; d++) {
          const srcIn = ease.inEase[d] || ease.inEase[0];
          const srcOut = ease.outEase[d] || ease.outEase[0];
          inEase.push(new KeyframeEase(srcIn.speed, srcIn.influence));
          outEase.push(new KeyframeEase(srcOut.speed, srcOut.influence));
        }
        prop.setTemporalEaseAtKey(keyIndex, inEase, outEase);
        touched++;
      }
    }
    app.endUndoGroup();
    if (touched === 0) {
      return { success: false, error: "No keyframes found on " + propName + " for the selected layers -- select a keyframe, or move the playhead onto one, first." };
    }
    return { success: true };
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
      if (!(layer instanceof AVLayer)) continue;
      const b = getLayerBounds(layer, time);
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
      const posProp = layer.property("Position") as Property;
      const pos = currentOrKeyframedValue(posProp, time) as number[];

      let delta = 0;
      if (edge === "left") delta = targetMin - b.left;
      else if (edge === "right") delta = targetMax - (b.left + b.width);
      else if (edge === "hcenter") delta = targetCenter - b.cx;
      else if (edge === "top") delta = targetMin - b.top;
      else if (edge === "bottom") delta = targetMax - (b.top + b.height);
      else if (edge === "vcenter") delta = targetCenter - b.cy;

      const next = pos.slice();
      if (isHorizontal) next[0] = pos[0] + delta;
      else next[1] = pos[1] + delta;
      applyValue(posProp, time, next);
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
      if (!(layer instanceof AVLayer)) continue;
      const b = getLayerBounds(layer, time);
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
      const posProp = layer.property("Position") as Property;
      const pos = currentOrKeyframedValue(posProp, time) as number[];
      const targetCenter = first + gap * i;
      const next = pos.slice();
      if (isHorizontal) next[0] = pos[0] + (targetCenter - b.cx);
      else next[1] = pos[1] + (targetCenter - b.cy);
      applyValue(posProp, time, next);
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
      if (layer instanceof AVLayer) {
        const b = getLayerBounds(layer, time);
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
