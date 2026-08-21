// =============================================================================
// src/jsx/aeft/puppeteer.ts
// -----------------------------------------------------------------------------
// PUPPET WARP, AFTER THE PINS EXIST.
//
// WHAT THE API ACTUALLY ALLOWS, probed against AE 26.2.1 rather than assumed
// (CLAUDE.md section 6). A script CAN add `ADBE FreePin3`, add a Mesh Atom and
// add PosPin Atoms -- every `canAddProperty` returns true and every add
// succeeds. It just doesn't MEAN anything: a scripted pin comes back with
//
//     ADBE FreePin3 PosPin Vtx Index   value = -1
//
// because the mesh behind it was never generated, and the first
// `position.setValue([100,100])` throws "invalid numeric result (divide by
// zero?)". The mesh is built by the Puppet tool in the UI and there is no
// scripted equivalent. Nothing in this file tries to create a pin, and nothing
// should be added later that does -- it looks like it works right up until the
// artist wonders why their character won't move.
//
// So the division of labour is: the artist places the pins with the Puppet
// tool, which takes seconds and is the part that needs a human eye anyway.
// Everything after that -- naming twelve pins, building a control null for
// each, posing, staggering, easing, baking -- is the tedious half, and that is
// all here.
//
// PIN POSITIONS ARE IN SOURCE SPACE, not comp space. Every conversion goes
// through `pinToComp`/`compToPin` so a scaled, rotated or parented layer rigs
// as correctly as one sitting square at 100%.
// =============================================================================
import { Result, SETTINGS_SECTION } from "./shared";

const PUPPET_FX = "ADBE FreePin3";
const ARAP_GROUP = "ADBE FreePin3 ARAP Group";
const MESH_GROUP = "ADBE FreePin3 Mesh Group";
const MESH_ATOM = "ADBE FreePin3 Mesh Atom";
const POS_PINS = "ADBE FreePin3 PosPins";
const PIN_POSITION = "ADBE FreePin3 PosPin Position";
const PIN_ROTATION = "ADBE FreePin3 PosPin Rotation";
const PIN_SCALE = "ADBE FreePin3 PosPin Scale";
const PIN_VTX_INDEX = "ADBE FreePin3 PosPin Vtx Index";
const MESH_TRIANGLES = "ADBE FreePin3 Mesh Tri Count";
const MESH_DENSITY = "ADBE FreePin3 Mesh Tri Density";
const MESH_EXPANSION = "ADBE FreePin3 Mesh Expansion";
const PUPPET_ENGINE = "ADBE FreePin3 Puppet Engine";

/** Stamped on every null this tool makes, so unrigging can find its own work
 *  and leave anything the artist built by hand alone. */
const CTRL_MARK = "XYi Puppeteer control";

/** Poses are USER-AUTHORED text plus numbers, so JSON, never a delimited line
 *  (CLAUDE.md section 4). Deliberately NOT in team.ts's PROFILE_KEYS: a pose
 *  belongs to one rig in one project, not to a person. */
const POSE_KEY = "PuppeteerPoses";

export interface PuppetPin {
  /** 1-based index inside its own mesh, which is what AE calls it by. */
  index: number;
  name: string;
  /** Source-space position, i.e. what the property actually holds. */
  x: number;
  y: number;
  /** And the same point in comp space, which is where a null has to go. */
  compX: number;
  compY: number;
  keys: number;
  expression: boolean;
  rotation: number | null;
  scale: number | null;
  /** -1 means a pin no script should touch -- see the header. */
  vertex: number;
  /** The null driving this pin, read out of its own expression, or "". */
  control: string;
  /** True when that null carries a motion expression of its own. */
  controlDriven: boolean;
}

export interface PuppetMesh {
  index: number;
  name: string;
  triangles: number;
  density: number;
  expansion: number;
  pins: PuppetPin[];
}

export interface PuppetLayerInfo {
  index: number;
  name: string;
  /** 1 Legacy, 2 Advanced. The Advanced engine is what gives pins their own
   *  rotation and scale, so the panel says which one it is looking at. */
  engine: number;
  meshes: PuppetMesh[];
  pinCount: number;
  rigged: number;
}

export interface PuppetScanResult extends Result {
  comp?: string;
  frameRate?: number;
  time?: number;
  layers?: PuppetLayerInfo[];
  /** Layers selected that have no puppet on them -- said plainly, because
   *  "nothing happened" and "that layer has no pins" are different answers. */
  skipped?: string[];
}

// ---------------------------------------------------------------------------
// finding things
// ---------------------------------------------------------------------------

function layerNamed(comp: CompItem, name: string): Layer | null {
  for (let i = 1; i <= comp.numLayers; i++) {
    if (String(comp.layer(i).name) === String(name)) return comp.layer(i);
  }
  return null;
}

/** Duck-typed, never `instanceof CompItem` (CLAUDE.md section 2). */
function activeComp(): CompItem | null {
  const item = app.project.activeItem as any;
  if (!item) return null;
  if (typeof item.numLayers !== "number") return null;
  if (typeof item.layer !== "function") return null;
  return item as CompItem;
}

function puppetOn(layer: Layer): PropertyGroup | null {
  const parade = layer.property("ADBE Effect Parade") as PropertyGroup;
  if (!parade) return null;
  for (let i = 1; i <= parade.numProperties; i++) {
    const fx = parade.property(i) as PropertyGroup;
    if (fx.matchName === PUPPET_FX) return fx;
  }
  return null;
}

function meshesOf(puppet: PropertyGroup): PropertyGroup | null {
  const arap = puppet.property(ARAP_GROUP) as PropertyGroup;
  if (!arap) return null;
  return arap.property(MESH_GROUP) as PropertyGroup;
}

function pinsOf(mesh: PropertyGroup): PropertyGroup | null {
  return mesh.property(POS_PINS) as PropertyGroup;
}

/** A property that may not exist on this AE version or engine. */
function maybeNumber(group: PropertyGroup, matchName: string): number | null {
  const p = group.property(matchName) as Property;
  if (!p) return null;
  try {
    return Number(p.value);
  } catch (e) {
    return null;
  }
}

/** Source space -> comp space. `sourcePointToComp` is the explicit modern
 *  form; `toComp` is the same conversion on older builds. Duck-typed on the
 *  method rather than version-sniffed. */
function pinToComp(layer: Layer, pt: number[]): number[] {
  const any = layer as any;
  if (typeof any.sourcePointToComp === "function") {
    const out = any.sourcePointToComp(pt);
    return [Number(out[0]), Number(out[1])];
  }
  const out2 = any.toComp(pt);
  return [Number(out2[0]), Number(out2[1])];
}

function layersToWorkOn(comp: CompItem): { layers: Layer[]; skipped: string[] } {
  const skipped: string[] = [];
  const out: Layer[] = [];
  const selected = comp.selectedLayers;
  if (selected.length > 0) {
    for (let i = 0; i < selected.length; i++) {
      if (puppetOn(selected[i])) out.push(selected[i]);
      else skipped.push(String(selected[i].name));
    }
    // A SELECTION WITH NO PUPPET IN IT IS NOT AN ANSWER. Rigging selects the
    // nulls it just made, so the very next scan asked about a handful of
    // controls and reported no pins anywhere -- the tool losing its subject as
    // a direct result of using it. Falling through to the whole comp is right
    // in every case: the artist has nothing puppet-shaped selected, so the
    // question they are asking is the general one.
    if (out.length > 0) return { layers: out, skipped: skipped };
  }
  // Nothing selected is a question, not an instruction: every puppet in the
  // comp is reported so the panel can show what there is to work on.
  for (let i = 1; i <= comp.numLayers; i++) {
    const lay = comp.layer(i);
    if (puppetOn(lay)) out.push(lay);
  }
  return { layers: out, skipped: skipped };
}

function readPin(layer: Layer, pin: PropertyGroup, index: number): PuppetPin {
  const pos = pin.property(PIN_POSITION) as Property;
  let x = 0;
  let y = 0;
  let keys = 0;
  let hasExpr = false;
  if (pos) {
    try {
      const v = pos.value as number[];
      x = Number(v[0]);
      y = Number(v[1]);
    } catch (e) { /* an unbound pin -- reported through `vertex` below */ }
    keys = pos.numKeys;
    hasExpr = pos.expressionEnabled && pos.expression !== "";
  }
  const comp = pinToComp(layer, [x, y]);
  const ctrlName = hasExpr ? controlNameIn(String(pos.expression)) : "";
  const vtx = pin.property(PIN_VTX_INDEX) as Property;
  let vertex = 0;
  try {
    vertex = vtx ? Number(vtx.value) : 0;
  } catch (e) {
    vertex = -1;
  }
  return {
    index: index,
    name: String(pin.name),
    x: x,
    y: y,
    compX: comp[0],
    compY: comp[1],
    keys: keys,
    expression: hasExpr,
    rotation: maybeNumber(pin, PIN_ROTATION),
    scale: maybeNumber(pin, PIN_SCALE),
    vertex: vertex,
    control: ctrlName,
    controlDriven: false,     // filled in by readLayer, which has the comp
  };
}

/** The layer name inside `thisComp.layer("...")`, or "". */
function controlNameIn(expr: string): string {
  const open = expr.indexOf('thisComp.layer("');
  if (open === -1) return "";
  const from = open + 'thisComp.layer("'.length;
  const close = expr.indexOf('"', from);
  if (close === -1) return "";
  return expr.substring(from, close);
}

function readLayer(layer: Layer): PuppetLayerInfo | null {
  const puppet = puppetOn(layer);
  if (!puppet) return null;
  const meshGroup = meshesOf(puppet);
  const meshes: PuppetMesh[] = [];
  let pinCount = 0;
  let rigged = 0;
  if (meshGroup) {
    for (let m = 1; m <= meshGroup.numProperties; m++) {
      const mesh = meshGroup.property(m) as PropertyGroup;
      const pinGroup = pinsOf(mesh);
      const pins: PuppetPin[] = [];
      if (pinGroup) {
        for (let p = 1; p <= pinGroup.numProperties; p++) {
          const info = readPin(layer, pinGroup.property(p) as PropertyGroup, p);
          if (info.expression) rigged++;
          if (info.control) {
            const ctrl = layerNamed(layer.containingComp, info.control);
            if (ctrl) {
              const cp = ctrl.property("ADBE Transform Group").property("ADBE Position") as Property;
              const driven = cp.expressionEnabled && cp.expression !== "";
              info.controlDriven = driven;
              if (!driven) info.controlDriven = cp.numKeys > 0;
            }
          }
          pins.push(info);
        }
      }
      pinCount += pins.length;
      meshes.push({
        index: m,
        name: String(mesh.name),
        triangles: Number(maybeNumber(mesh, MESH_TRIANGLES)),
        density: Number(maybeNumber(mesh, MESH_DENSITY)),
        expansion: Number(maybeNumber(mesh, MESH_EXPANSION)),
        pins: pins,
      });
    }
  }
  const engine = maybeNumber(puppet, PUPPET_ENGINE);
  return {
    index: layer.index,
    name: String(layer.name),
    engine: engine === null ? 0 : engine,
    meshes: meshes,
    pinCount: pinCount,
    rigged: rigged,
  };
}

/**
 * Everything Puppeteer knows about the puppets in the active comp.
 *
 * Read-only, so no undo group: a scan that shows up in the undo history is a
 * scan that has to be undone.
 */
export const puppetScan = (): PuppetScanResult => {
  try {
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const picked = layersToWorkOn(comp);
    const layers: PuppetLayerInfo[] = [];
    for (let i = 0; i < picked.layers.length; i++) {
      const info = readLayer(picked.layers[i]);
      if (info) layers.push(info);
    }
    return {
      success: true,
      comp: String(comp.name),
      frameRate: comp.frameRate,
      time: comp.time,
      layers: layers,
      skipped: picked.skipped,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// ---------------------------------------------------------------------------
// the pins themselves
// ---------------------------------------------------------------------------

/** Every pin on a layer, flat, in mesh-then-pin order. */
function allPins(layer: Layer): PropertyGroup[] {
  const out: PropertyGroup[] = [];
  const puppet = puppetOn(layer);
  if (!puppet) return out;
  const meshGroup = meshesOf(puppet);
  if (!meshGroup) return out;
  for (let m = 1; m <= meshGroup.numProperties; m++) {
    const pinGroup = pinsOf(meshGroup.property(m) as PropertyGroup);
    if (!pinGroup) continue;
    for (let p = 1; p <= pinGroup.numProperties; p++) {
      out.push(pinGroup.property(p) as PropertyGroup);
    }
  }
  return out;
}

function layerByIndex(comp: CompItem, index: number): Layer | null {
  // By INDEX, never by holding a layer object across calls: two accesses to
  // the same AE object are not `===` (CLAUDE.md section 2).
  for (let i = 1; i <= comp.numLayers; i++) {
    if (comp.layer(i).index === index) return comp.layer(i);
  }
  return null;
}

/**
 * The pins a command should act on.
 *
 * `which` is a list of 1-based flat indices, empty meaning "all of them". The
 * panel always knows what it is showing, so it says; an empty list is the
 * deliberate "no selection means everything" case.
 */
function pinsFor(layer: Layer, which: number[]): PropertyGroup[] {
  const every = allPins(layer);
  if (!which || which.length === 0) return every;
  const out: PropertyGroup[] = [];
  for (let i = 0; i < which.length; i++) {
    const n = which[i];
    if (n >= 1 && n <= every.length) out.push(every[n - 1]);
  }
  return out;
}

/** A name safe to splice into an expression string. */
function expressionSafe(name: string): string {
  let out = "";
  const s = String(name);
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === '"') { out += '\\"'; continue; }
    if (c === "\\") { out += "\\\\"; continue; }
    out += c;
  }
  return out;
}

interface RigConfig {
  layerIndex: number;
  pins: number[];
  /** Prefix for the control nulls; the pin's own name completes it. */
  prefix: string;
  /** Parent every control to one master null, so the whole rig moves at once. */
  master: boolean;
  /** Give the controls the layer's in/out points rather than the comp's. */
  matchTiming: boolean;
}

export interface RigResult extends Result {
  created?: number;
  masterName?: string;
  skipped?: string[];
}

/**
 * A control null for every pin, linked by expression.
 *
 * THE NULL GOES WHERE THE PIN IS, in comp space, so the rig lines up on a
 * layer that is scaled, rotated, parented or all three. The expression walks
 * the same conversion back the other way, which is why it survives the layer
 * being moved afterwards -- the pin follows the null through whatever
 * transform the layer has at that moment.
 *
 * The expression clamps to two dimensions on purpose: `fromComp` on a 3D layer
 * hands back three, and a pin position takes two.
 */
export const puppetRigNulls = (configJson: string): RigResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as RigConfig;
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(cfg.layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };

    const pins = pinsFor(layer, cfg.pins || []);
    if (pins.length === 0) return { success: false, error: "No pins to rig on that layer." };

    const skipped: string[] = [];
    let created = 0;
    let masterName = "";

    app.beginUndoGroup("XYi Puppeteer rig");
    try {
      // MADE ON THE FIRST PIN THAT ACTUALLY RIGS, not up front. Every pin can
      // legitimately be refused -- an unbound pin, a pin already linked -- and
      // a master null presiding over nothing is litter the artist has to
      // notice and delete.
      let master: Layer | null = null;
      const makeMaster = function (): Layer | null {
        if (!cfg.master) return null;
        if (master) return master;
        master = comp.layers.addNull();
        master.name = String(cfg.prefix || "Puppet") + "_CTRL";
        master.comment = CTRL_MARK;
        (master as any).position.setValue([comp.width / 2, comp.height / 2]);
        master.moveBefore(layer);
        masterName = String(master.name);
        return master;
      };

      for (let i = 0; i < pins.length; i++) {
        const pin = pins[i];
        const pos = pin.property(PIN_POSITION) as Property;
        if (!pos) { skipped.push(String(pin.name) + " (no position)"); continue; }
        // An unbound pin is one a script created and the mesh never claimed --
        // rigging it would build a control that moves nothing.
        const vtx = pin.property(PIN_VTX_INDEX) as Property;
        let bound = true;
        try {
          if (vtx && Number(vtx.value) < 0) bound = false;
        } catch (e) { bound = false; }
        if (!bound) { skipped.push(String(pin.name) + " (not on the mesh)"); continue; }
        if (pos.expressionEnabled && pos.expression !== "") {
          skipped.push(String(pin.name) + " (already linked)");
          continue;
        }

        const here = pos.value as number[];
        const compPt = pinToComp(layer, [Number(here[0]), Number(here[1])]);

        const ctrl = comp.layers.addNull();
        ctrl.name = String(cfg.prefix || "Puppet") + "_" + String(pin.name);
        ctrl.comment = CTRL_MARK;
        (ctrl as any).position.setValue(compPt);
        ctrl.label = 9;                       // one colour for the whole rig
        ctrl.moveBefore(layer);
        if (cfg.matchTiming) {
          ctrl.inPoint = layer.inPoint;
          ctrl.outPoint = layer.outPoint;
        }
        const top = makeMaster();
        if (top) ctrl.parent = top;

        pos.expression =
          'var C = thisComp.layer("' + expressionSafe(ctrl.name) + '");\n' +
          "var p = fromComp(C.toComp(C.anchorPoint));\n" +
          "[p[0], p[1]];";
        created++;
      }
      // THE PUPPET LAYER KEEPS THE SELECTION. AE selects each null as it is
      // created, which would leave the artist looking at twelve controls and
      // the panel unable to find the layer they were working on.
      for (let i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
      layer.selected = true;
    } finally {
      app.endUndoGroup();
    }

    return { success: true, created: created, masterName: masterName, skipped: skipped };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface BakeConfig {
  layerIndex: number;
  pins: number[];
  /** Keep the motion as keyframes rather than freezing at the current value. */
  keyframes: boolean;
  /** Delete the controls afterwards. Only ever this tool's own. */
  removeControls: boolean;
}

export interface BakeResult extends Result {
  baked?: number;
  keysWritten?: number;
  controlsRemoved?: number;
}

/**
 * Expressions off, motion kept.
 *
 * The order matters and is the whole reason this isn't two lines: the values
 * have to be READ while the expression is still live, then written after it is
 * gone. Clearing first and sampling second bakes the pre-rig pose over the
 * animation, silently.
 */
export const puppetBake = (configJson: string): BakeResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as BakeConfig;
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(cfg.layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };

    const pins = pinsFor(layer, cfg.pins || []);
    let baked = 0;
    let keysWritten = 0;
    let controlsRemoved = 0;

    app.beginUndoGroup("XYi Puppeteer bake");
    try {
      const step = comp.frameDuration;
      const from = layer.inPoint;
      const to = layer.outPoint;

      for (let i = 0; i < pins.length; i++) {
        const pos = pins[i].property(PIN_POSITION) as Property;
        if (!pos) continue;
        if (!pos.expressionEnabled) continue;
        if (pos.expression === "") continue;

        if (cfg.keyframes) {
          // Sampled first, ENTIRELY, then written. See the note above.
          const times: number[] = [];
          const values: number[][] = [];
          for (let t = from; t <= to + step / 2; t += step) {
            const v = pos.valueAtTime(t, false) as number[];
            times.push(t);
            values.push([Number(v[0]), Number(v[1])]);
          }
          pos.expression = "";
          for (let k = 0; k < times.length; k++) {
            pos.setValueAtTime(times[k], values[k]);
            keysWritten++;
          }
        } else {
          const frozen = pos.valueAtTime(comp.time, false) as number[];
          pos.expression = "";
          pos.setValue([Number(frozen[0]), Number(frozen[1])]);
        }
        baked++;
      }

      if (cfg.removeControls) {
        // OURS ONLY, by the stamp this tool put there. A null the artist made
        // and parented into the rig is not this tool's to delete.
        for (let i = comp.numLayers; i >= 1; i--) {
          const lay = comp.layer(i);
          if (String(lay.comment) !== CTRL_MARK) continue;
          lay.remove();
          controlsRemoved++;
        }
      }
    } finally {
      app.endUndoGroup();
    }

    return { success: true, baked: baked, keysWritten: keysWritten, controlsRemoved: controlsRemoved };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// ---------------------------------------------------------------------------
// naming
// ---------------------------------------------------------------------------

interface RenameConfig {
  layerIndex: number;
  pins: number[];
  /** "Arm" becomes Arm 1, Arm 2 ... ; a "#" anywhere is where the number goes. */
  pattern: string;
  start: number;
}

export interface RenameResult extends Result {
  renamed?: number;
  names?: string[];
}

/**
 * Pin 1, Pin 2, Pin 3 is not a rig, it is a list.
 *
 * AE names pins in the order they were placed and there is no way to rename
 * one without hunting it down in the timeline, which is why nobody does it and
 * why every puppet rig in the building is unreadable a week later.
 */
export const puppetRenamePins = (configJson: string): RenameResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as RenameConfig;
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(cfg.layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };

    const pattern = String(cfg.pattern || "").replace(/^\s+|\s+$/g, "");
    if (!pattern) return { success: false, error: "Give the pins a name to work from." };

    const pins = pinsFor(layer, cfg.pins || []);
    if (pins.length === 0) return { success: false, error: "No pins to rename." };

    const names: string[] = [];
    let n = Number(cfg.start);
    if (!(n > 0)) n = 1;

    app.beginUndoGroup("XYi Puppeteer rename");
    try {
      for (let i = 0; i < pins.length; i++) {
        // indexOf, never .match: a pin name is not a regex (CLAUDE.md).
        let name = pattern;
        if (pattern.indexOf("#") !== -1) {
          const at = pattern.indexOf("#");
          name = pattern.substring(0, at) + String(n) + pattern.substring(at + 1);
        } else if (pins.length > 1) {
          name = pattern + " " + String(n);
        }
        pins[i].name = name;
        names.push(name);
        n++;
      }
    } finally {
      app.endUndoGroup();
    }
    return { success: true, renamed: names.length, names: names };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const puppetRenameOnePin = (layerIndex: number, pinIndex: number, name: string): Result => {
  try {
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };
    const pins = pinsFor(layer, [Number(pinIndex)]);
    if (pins.length === 0) return { success: false, error: "That pin is gone." };
    const clean = String(name || "").replace(/^\s+|\s+$/g, "");
    if (!clean) return { success: false, error: "A pin needs a name." };
    app.beginUndoGroup("XYi Puppeteer rename pin");
    try {
      pins[0].name = clean;
    } finally {
      app.endUndoGroup();
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// ---------------------------------------------------------------------------
// poses
// ---------------------------------------------------------------------------

export interface PoseCapture extends Result {
  pins?: { name: string; x: number; y: number; rotation: number | null; scale: number | null }[];
}

/** The pose the rig is in right now, for the panel to name and keep. */
export const puppetCapturePose = (layerIndex: number): PoseCapture => {
  try {
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };
    const pins = allPins(layer);
    if (pins.length === 0) return { success: false, error: "That layer has no pins." };

    const out: { name: string; x: number; y: number; rotation: number | null; scale: number | null }[] = [];
    for (let i = 0; i < pins.length; i++) {
      const pos = pins[i].property(PIN_POSITION) as Property;
      // valueAtTime, not value: with a control null driving the pin, `value`
      // is the un-evaluated one and the pose would come back as the rest pose.
      const v = pos.valueAtTime(comp.time, false) as number[];
      out.push({
        name: String(pins[i].name),
        x: Number(v[0]),
        y: Number(v[1]),
        rotation: maybeNumber(pins[i], PIN_ROTATION),
        scale: maybeNumber(pins[i], PIN_SCALE),
      });
    }
    return { success: true, pins: out };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface ApplyPoseConfig {
  layerIndex: number;
  /** Positions in the same order `puppetCapturePose` returned them. */
  pins: { x: number; y: number }[];
  /** Key it at the current time rather than just setting the value. */
  key: boolean;
  /** Move the control nulls instead of the pins, when the rig is expression-
   *  driven and setting the pin would do nothing visible. */
  viaControls: boolean;
}

export interface ApplyPoseResult extends Result {
  moved?: number;
  keyed?: number;
  note?: string;
}

/**
 * Put the rig back into a pose.
 *
 * A RIGGED PIN CANNOT BE POSED DIRECTLY -- its position is an expression
 * result, and setValue on an expression-driven property is thrown away with no
 * error whatsoever. So when the pin is linked, the pose is applied to the
 * CONTROL instead, converted back into comp space. Getting this wrong looks
 * exactly like the tool doing nothing.
 */
export const puppetApplyPose = (configJson: string): ApplyPoseResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as ApplyPoseConfig;
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(cfg.layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };

    const pins = allPins(layer);
    const wanted = cfg.pins || [];
    if (pins.length === 0) return { success: false, error: "That layer has no pins." };
    if (wanted.length !== pins.length) {
      return {
        success: false,
        error: "That pose has " + wanted.length + " pins and this layer has " + pins.length + ".",
      };
    }

    let moved = 0;
    let keyed = 0;
    let viaControl = 0;

    app.beginUndoGroup("XYi Puppeteer pose");
    try {
      for (let i = 0; i < pins.length; i++) {
        const pos = pins[i].property(PIN_POSITION) as Property;
        if (!pos) continue;
        const target = [Number(wanted[i].x), Number(wanted[i].y)];

        const linked = pos.expressionEnabled && pos.expression !== "";
        if (linked && cfg.viaControls) {
          const ctrl = controlDriving(comp, pos);
          if (!ctrl) continue;
          const compPt = pinToComp(layer, target);
          const ctrlPos = ctrl.property("ADBE Transform Group").property("ADBE Position") as Property;
          if (cfg.key) { ctrlPos.setValueAtTime(comp.time, compPt); keyed++; }
          else ctrlPos.setValue(compPt);
          viaControl++;
          moved++;
          continue;
        }
        if (linked) continue;       // would be silently discarded -- see above
        if (cfg.key) { pos.setValueAtTime(comp.time, target); keyed++; }
        else pos.setValue(target);
        moved++;
      }
    } finally {
      app.endUndoGroup();
    }

    let note = "";
    if (viaControl > 0) note = viaControl + " applied through the control nulls.";
    return { success: true, moved: moved, keyed: keyed, note: note };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** The null an expression-linked pin is following, by the name in its own
 *  expression. Read out of the expression rather than remembered anywhere,
 *  so a rig still works after a save, a reopen, or somebody else's edit. */
function controlDriving(comp: CompItem, pos: Property): Layer | null {
  const expr = String(pos.expression || "");
  const open = expr.indexOf('thisComp.layer("');
  if (open === -1) return null;
  const from = open + 'thisComp.layer("'.length;
  const close = expr.indexOf('"', from);
  if (close === -1) return null;
  const name = expr.substring(from, close);
  for (let i = 1; i <= comp.numLayers; i++) {
    if (String(comp.layer(i).name) === name) return comp.layer(i);
  }
  return null;
}

// ---------------------------------------------------------------------------
// timing
// ---------------------------------------------------------------------------

/** One keyframe, read completely enough to be put back unchanged. */
interface KeySnapshot {
  time: number;
  value: any;
  inInterp: KeyframeInterpolationType;
  outInterp: KeyframeInterpolationType;
  inEase: KeyframeEase[];
  outEase: KeyframeEase[];
  inTangent: number[] | null;
  outTangent: number[] | null;
  roving: boolean;
  continuous: boolean;
  autoBezier: boolean;
}

/**
 * Moving a keyframe in time.
 *
 * AE has no "set key time", so a shift is read-all, remove-all, write-all --
 * and everything that makes the keyframe what it is has to come along: eases,
 * interpolation types, spatial tangents, roving. Rewriting only time and value
 * turns a hand-eased animation into linear, which is a worse outcome than
 * refusing to shift it.
 */
function readKeys(prop: Property): KeySnapshot[] {
  const out: KeySnapshot[] = [];
  for (let k = 1; k <= prop.numKeys; k++) {
    let inTan: number[] | null = null;
    let outTan: number[] | null = null;
    let roving = false;
    let continuous = false;
    let autoBez = false;
    try {
      if (prop.isSpatial) {
        inTan = prop.keyInSpatialTangent(k) as number[];
        outTan = prop.keyOutSpatialTangent(k) as number[];
        roving = prop.keyRoving(k);
      }
      continuous = prop.keyTemporalContinuous(k);
      autoBez = prop.keyTemporalAutoBezier(k);
    } catch (e) { /* not every property carries all of these */ }
    out.push({
      time: prop.keyTime(k),
      value: prop.keyValue(k),
      inInterp: prop.keyInInterpolationType(k),
      outInterp: prop.keyOutInterpolationType(k),
      inEase: prop.keyInTemporalEase(k),
      outEase: prop.keyOutTemporalEase(k),
      inTangent: inTan,
      outTangent: outTan,
      roving: roving,
      continuous: continuous,
      autoBezier: autoBez,
    });
  }
  return out;
}

function writeKeys(prop: Property, keys: KeySnapshot[]): void {
  while (prop.numKeys > 0) prop.removeKey(1);
  for (let i = 0; i < keys.length; i++) {
    prop.setValueAtTime(keys[i].time, keys[i].value);
  }
  // A second pass, because the shape of a keyframe can only be set once the
  // keyframe on either side of it exists.
  for (let i = 0; i < keys.length; i++) {
    const k = i + 1;
    try {
      prop.setInterpolationTypeAtKey(k, keys[i].inInterp, keys[i].outInterp);
      prop.setTemporalEaseAtKey(k, keys[i].inEase, keys[i].outEase);
      if (keys[i].inTangent && keys[i].outTangent) {
        prop.setSpatialTangentsAtKey(k, keys[i].inTangent as number[], keys[i].outTangent as number[]);
      }
      if (keys[i].continuous) prop.setTemporalContinuousAtKey(k, true);
      if (keys[i].autoBezier) prop.setTemporalAutoBezierAtKey(k, true);
      if (keys[i].roving) prop.setRovingAtKey(k, true);
    } catch (e) { /* keep the timing even when a nicety won't take */ }
  }
}

interface StaggerConfig {
  layerIndex: number;
  pins: number[];
  /** Frames between one pin and the next. Negative runs the wave backwards. */
  frames: number;
  /** "order" walks the pin list; "distance" walks outwards from `rootPin`. */
  mode: string;
  rootPin: number;
  /** Shift the controls when the pins are rigged -- that is where the keys are. */
  viaControls: boolean;
}

export interface StaggerResult extends Result {
  shifted?: number;
  skippedNoKeys?: number;
  order?: string[];
}

/**
 * Follow-through, in one press.
 *
 * The same animation on every pin, each one starting a little later, is most
 * of what makes puppet work read as weight rather than as a texture sliding
 * about. By hand it is a dozen drag-selects in the timeline, and everybody
 * does it badly rather than not at all.
 *
 * "distance" order is the one worth having: it ripples outward from the pin
 * you nominate as the root, so a hand lags the elbow which lags the shoulder
 * without anybody working out the pin order by hand.
 */
export const puppetStagger = (configJson: string): StaggerResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as StaggerConfig;
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(cfg.layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };

    const pins = pinsFor(layer, cfg.pins || []);
    if (pins.length === 0) return { success: false, error: "No pins to stagger." };

    // Which property actually holds the keys: the pin, or the null driving it.
    const targets: { name: string; prop: Property; x: number; y: number }[] = [];
    for (let i = 0; i < pins.length; i++) {
      const pos = pins[i].property(PIN_POSITION) as Property;
      if (!pos) continue;
      const here = pos.valueAtTime(comp.time, false) as number[];
      const linked = pos.expressionEnabled && pos.expression !== "";
      if (linked && cfg.viaControls) {
        const ctrl = controlDriving(comp, pos);
        if (!ctrl) continue;
        targets.push({
          name: String(pins[i].name),
          prop: ctrl.property("ADBE Transform Group").property("ADBE Position") as Property,
          x: Number(here[0]),
          y: Number(here[1]),
        });
        continue;
      }
      targets.push({ name: String(pins[i].name), prop: pos, x: Number(here[0]), y: Number(here[1]) });
    }

    // ORDER FIRST, then shift, so the ordering never depends on keys that a
    // previous iteration has already moved.
    let ordered = targets;
    if (String(cfg.mode) === "distance") {
      let rx = 0;
      let ry = 0;
      const root = Number(cfg.rootPin);
      for (let i = 0; i < targets.length; i++) {
        if (i + 1 === root) { rx = targets[i].x; ry = targets[i].y; }
      }
      const withDist: { t: any; d: number }[] = [];
      for (let i = 0; i < targets.length; i++) {
        const dx = targets[i].x - rx;
        const dy = targets[i].y - ry;
        withDist.push({ t: targets[i], d: Math.sqrt(dx * dx + dy * dy) });
      }
      withDist.sort(function (a, b) { return a.d - b.d; });
      ordered = [];
      for (let i = 0; i < withDist.length; i++) ordered.push(withDist[i].t);
    }

    const step = comp.frameDuration * Number(cfg.frames);
    let shifted = 0;
    let skippedNoKeys = 0;
    const order: string[] = [];

    app.beginUndoGroup("XYi Puppeteer stagger");
    try {
      for (let i = 0; i < ordered.length; i++) {
        order.push(ordered[i].name);
        const prop = ordered[i].prop;
        if (prop.numKeys === 0) { skippedNoKeys++; continue; }
        const delta = step * i;
        if (delta === 0) continue;
        const keys = readKeys(prop);
        for (let k = 0; k < keys.length; k++) keys[k].time += delta;
        writeKeys(prop, keys);
        shifted++;
      }
    } finally {
      app.endUndoGroup();
    }

    return { success: true, shifted: shifted, skippedNoKeys: skippedNoKeys, order: order };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface OvershootConfig {
  layerIndex: number;
  pins: number[];
  amplitude: number;
  frequency: number;
  decay: number;
  viaControls: boolean;
}

export interface OvershootResult extends Result {
  applied?: number;
}

/**
 * Inertial overshoot after the last keyframe, as an expression.
 *
 * An expression rather than baked keys because it stays adjustable: the artist
 * moves a keyframe and the settle follows it. Applied to the CONTROL where one
 * exists, since a pin already driven by a rig cannot carry a second expression.
 */
export const puppetOvershoot = (configJson: string): OvershootResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as OvershootConfig;
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(cfg.layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };

    const amp = Number(cfg.amplitude);
    const freq = Number(cfg.frequency);
    const decay = Number(cfg.decay);

    const body =
      "amp = " + amp + ";\n" +
      "freq = " + freq + ";\n" +
      "decay = " + decay + ";\n" +
      "n = 0;\n" +
      "if (numKeys > 0) {\n" +
      "  n = nearestKey(time).index;\n" +
      "  if (key(n).time > time) n--;\n" +
      "}\n" +
      "if (n > 0) {\n" +
      "  t = time - key(n).time;\n" +
      "  v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);\n" +
      "  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);\n" +
      "} else { value; }";

    const pins = pinsFor(layer, cfg.pins || []);
    let applied = 0;

    app.beginUndoGroup("XYi Puppeteer overshoot");
    try {
      for (let i = 0; i < pins.length; i++) {
        const pos = pins[i].property(PIN_POSITION) as Property;
        if (!pos) continue;
        const linked = pos.expressionEnabled && pos.expression !== "";
        if (linked && cfg.viaControls) {
          const ctrl = controlDriving(comp, pos);
          if (!ctrl) continue;
          const ctrlPos = ctrl.property("ADBE Transform Group").property("ADBE Position") as Property;
          if (ctrlPos.numKeys === 0) continue;   // nothing to settle from
          ctrlPos.expression = body;
          applied++;
          continue;
        }
        if (linked) continue;
        if (pos.numKeys === 0) continue;
        pos.expression = body;
        applied++;
      }
    } finally {
      app.endUndoGroup();
    }
    return { success: true, applied: applied };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// ---------------------------------------------------------------------------
// the mesh
// ---------------------------------------------------------------------------

interface MeshConfig {
  layerIndex: number;
  triangles: number;
  expansion: number;
  density: number;
  /** Which of the three to actually write -- 0 leaves one alone. */
  setTriangles: boolean;
  setExpansion: boolean;
  setDensity: boolean;
}

export interface MeshResult extends Result {
  /** How many values were actually written, across every mesh. */
  meshes?: number;
}

/**
 * Triangles, expansion and density across every mesh on the layer.
 *
 * These are ordinary sliders and always were; the reason they are here is that
 * they live four groups deep behind a twirl-down nobody opens, so in practice
 * every puppet in the building runs on whatever the default was.
 */
export const puppetSetMesh = (configJson: string): MeshResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as MeshConfig;
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(cfg.layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };
    const puppet = puppetOn(layer);
    if (!puppet) return { success: false, error: "No Puppet effect on that layer." };
    const meshGroup = meshesOf(puppet);
    if (!meshGroup) return { success: false, error: "That puppet has no mesh yet." };

    let touched = 0;
    let refused = "";

    /** One slider, set on its own.
     *
     *  A mesh that a script created rather than the Puppet tool comes back
     *  "hidden" and refuses setValue outright, so a single try/catch around
     *  all three would report a whole failure for one bad slider -- and a
     *  half-applied mesh that claims success is the failure CLAUDE.md calls
     *  out by name. Each one is asked separately and the refusal is carried
     *  back verbatim. */
    const trySet = function (mesh: PropertyGroup, matchName: string, value: number): void {
      const p = mesh.property(matchName) as Property;
      if (!p) { refused = refused + (refused ? "; " : "") + matchName + " isn't on this mesh"; return; }
      try {
        p.setValue(value);
        touched++;
      } catch (err) {
        refused = refused + (refused ? "; " : "") + String(p.name) + ": " + err.toString();
      }
    };

    app.beginUndoGroup("XYi Puppeteer mesh");
    try {
      for (let m = 1; m <= meshGroup.numProperties; m++) {
        const mesh = meshGroup.property(m) as PropertyGroup;
        if (cfg.setTriangles) trySet(mesh, MESH_TRIANGLES, Number(cfg.triangles));
        if (cfg.setExpansion) trySet(mesh, MESH_EXPANSION, Number(cfg.expansion));
        if (cfg.setDensity) trySet(mesh, MESH_DENSITY, Number(cfg.density));
      }
    } finally {
      app.endUndoGroup();
    }

    if (touched === 0) {
      return { success: false, error: refused ? "AE wouldn't take that: " + refused : "Nothing was set." };
    }
    return { success: true, meshes: touched, error: refused ? refused : undefined };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// ---------------------------------------------------------------------------
// poses, kept
// ---------------------------------------------------------------------------

/** JSON, not a delimited line: a pose carries a name somebody typed. */
export const puppetPosesLoad = (): Result & { json?: string } => {
  try {
    const raw = app.settings.haveSetting(SETTINGS_SECTION, POSE_KEY)
      ? app.settings.getSetting(SETTINGS_SECTION, POSE_KEY)
      : "";
    return { success: true, json: raw ? String(raw) : "{}" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const puppetPosesSave = (json: string): Result => {
  try {
    app.settings.saveSetting(SETTINGS_SECTION, POSE_KEY, String(json || "{}"));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// ---------------------------------------------------------------------------
// driving the controls
// ---------------------------------------------------------------------------

/** Every control null driving a pin on this layer, in pin order. */
function controlsFor(comp: CompItem, layer: Layer, which: number[]): { pin: string; ctrl: Layer; x: number; y: number }[] {
  const out: { pin: string; ctrl: Layer; x: number; y: number }[] = [];
  const pins = pinsFor(layer, which);
  for (let i = 0; i < pins.length; i++) {
    const pos = pins[i].property(PIN_POSITION) as Property;
    if (!pos) continue;
    if (!pos.expressionEnabled) continue;
    if (pos.expression === "") continue;
    const ctrl = controlDriving(comp, pos);
    if (!ctrl) continue;
    const cp = ctrl.property("ADBE Transform Group").property("ADBE Position") as Property;
    const at = cp.valueAtTime(comp.time, false) as number[];
    out.push({ pin: String(pins[i].name), ctrl: ctrl, x: Number(at[0]), y: Number(at[1]) });
  }
  return out;
}

export interface ControlActionResult extends Result {
  count?: number;
}

/**
 * Selects the controls in AE, so the artist can grab them on the canvas.
 *
 * The panel is a list of names; the work happens in the comp viewer. Clicking
 * a pin here and finding its null already selected there is the difference
 * between a readout and a control surface.
 */
export const puppetSelectControls = (layerIndex: number, pinsJson: string): ControlActionResult => {
  try {
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };
    const which = JSON.parse(String(pinsJson || "[]")) as number[];
    const controls = controlsFor(comp, layer, which);

    for (let i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
    for (let i = 0; i < controls.length; i++) controls[i].ctrl.selected = true;
    return { success: true, count: controls.length };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface MotionConfig {
  layerIndex: number;
  pins: number[];
  /** "sway" | "wiggle" | "orbit" | "breathe" */
  kind: string;
  /** Pixels of travel. */
  amount: number;
  /** Cycles per second, or wiggles per second. */
  speed: number;
  /** Seconds of phase between one control and the next, so the motion travels
   *  across the rig instead of every pin moving as one. */
  spread: number;
  /** Amplitude grows with distance from `rootPin` -- a tip moves, a root
   *  barely does, which is what foliage, hair and fabric actually do. */
  scaleByDistance: boolean;
  rootPin: number;
}

export interface MotionResult extends Result {
  applied?: number;
}

/**
 * Ambient motion on the controls, as expressions.
 *
 * THE FOUR THINGS PUPPET RIGS ARE ACTUALLY ASKED FOR at this studio: a sway
 * (leaves, fabric, hanging signage), a wiggle (handheld life), an orbit (a
 * float or a bob), and a breathe (a slow scale-ish pulse in and out from the
 * rig's centre). Each is two numbers and a phase offset, which is the whole
 * reason nobody writes them by hand twelve times.
 *
 * ON THE CONTROLS, NOT THE PINS. A rigged pin already carries the expression
 * that links it to its null, so this has to go one level up -- and putting it
 * there means the artist can still keyframe the null underneath the motion,
 * which is how a sway that also travels gets made.
 */
export const puppetMotion = (configJson: string): MotionResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as MotionConfig;
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(cfg.layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };

    const controls = controlsFor(comp, layer, cfg.pins || []);
    if (controls.length === 0) {
      return { success: false, error: "No control nulls on those pins. Give them controls first." };
    }

    const amount = Number(cfg.amount);
    const speed = Number(cfg.speed);
    const spread = Number(cfg.spread);
    const kind = String(cfg.kind || "sway");

    // Distances from the root, for the falloff. Measured in comp space off the
    // controls themselves, so it follows the rig rather than the mesh.
    let rx = controls[0].x;
    let ry = controls[0].y;
    const root = Number(cfg.rootPin);
    for (let i = 0; i < controls.length; i++) {
      if (i + 1 === root) { rx = controls[i].x; ry = controls[i].y; }
    }
    let maxDist = 0;
    const dists: number[] = [];
    for (let i = 0; i < controls.length; i++) {
      const dx = controls[i].x - rx;
      const dy = controls[i].y - ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      dists.push(d);
      if (d > maxDist) maxDist = d;
    }

    app.beginUndoGroup("XYi Puppeteer motion");
    let applied = 0;
    try {
      for (let i = 0; i < controls.length; i++) {
        let amp = amount;
        if (cfg.scaleByDistance && maxDist > 0) amp = amount * (dists[i] / maxDist);
        const phase = spread * i;

        let body = "";
        if (kind === "wiggle") {
          // seedRandom per control, or every null wiggles in lockstep.
          body = "seedRandom(" + (i + 1) + ", true);\n" +
            "wiggle(" + speed + ", " + amp + ");";
        } else if (kind === "orbit") {
          body = "t = (time + " + phase + ") * " + speed + " * 2 * Math.PI;\n" +
            "value + [Math.cos(t) * " + amp + ", Math.sin(t) * " + amp + "];";
        } else if (kind === "breathe") {
          // Out from the rig's own centre, so the whole thing swells.
          const dx = controls[i].x - rx;
          const dy = controls[i].y - ry;
          const len = Math.sqrt(dx * dx + dy * dy);
          const ux = len > 0 ? dx / len : 0;
          const uy = len > 0 ? dy / len : 0;
          body = "t = (time + " + phase + ") * " + speed + " * 2 * Math.PI;\n" +
            "k = Math.sin(t) * " + amp + ";\n" +
            "value + [" + ux + " * k, " + uy + " * k];";
        } else {
          // Sway: mostly sideways, with a smaller slower bob, which reads as
          // weight rather than as a metronome.
          body = "t = (time + " + phase + ") * " + speed + " * 2 * Math.PI;\n" +
            "value + [Math.sin(t) * " + amp + ", Math.sin(t * 0.6) * " + (amp * 0.35) + "];";
        }

        const cp = controls[i].ctrl.property("ADBE Transform Group").property("ADBE Position") as Property;
        cp.expression = body;
        applied++;
      }
    } finally {
      app.endUndoGroup();
    }
    return { success: true, applied: applied };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** Motion off, position kept. Keyframes on the control are left alone. */
export const puppetClearMotion = (layerIndex: number, pinsJson: string): ControlActionResult => {
  try {
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };
    const which = JSON.parse(String(pinsJson || "[]")) as number[];
    const controls = controlsFor(comp, layer, which);

    let cleared = 0;
    app.beginUndoGroup("XYi Puppeteer clear motion");
    try {
      for (let i = 0; i < controls.length; i++) {
        const cp = controls[i].ctrl.property("ADBE Transform Group").property("ADBE Position") as Property;
        if (!cp.expressionEnabled) continue;
        if (cp.expression === "") continue;
        // Read before clearing -- the same order the bake depends on.
        const at = cp.valueAtTime(comp.time, false) as number[];
        cp.expression = "";
        if (cp.numKeys === 0) cp.setValue([Number(at[0]), Number(at[1])]);
        cleared++;
      }
    } finally {
      app.endUndoGroup();
    }
    return { success: true, count: cleared };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface NudgeConfig {
  layerIndex: number;
  pins: number[];
  dx: number;
  dy: number;
  key: boolean;
}

/**
 * Moves the controls by hand, from the panel.
 *
 * Small, exact offsets are miserable on a canvas at 40% zoom and trivial as a
 * number, which is the same argument the ruler in Bespoke won.
 */
export const puppetNudge = (configJson: string): ControlActionResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as NudgeConfig;
    const comp = activeComp();
    if (!comp) return { success: false, error: "Open a composition first." };
    const layer = layerByIndex(comp, Number(cfg.layerIndex));
    if (!layer) return { success: false, error: "That layer isn't in this comp any more." };
    const controls = controlsFor(comp, layer, cfg.pins || []);
    if (controls.length === 0) return { success: false, error: "No control nulls on those pins." };

    let moved = 0;
    app.beginUndoGroup("XYi Puppeteer nudge");
    try {
      for (let i = 0; i < controls.length; i++) {
        const cp = controls[i].ctrl.property("ADBE Transform Group").property("ADBE Position") as Property;
        const at = cp.valueAtTime(comp.time, false) as number[];
        const to = [Number(at[0]) + Number(cfg.dx), Number(at[1]) + Number(cfg.dy)];
        if (cfg.key) cp.setValueAtTime(comp.time, to);
        else if (cp.numKeys > 0) cp.setValueAtTime(comp.time, to);
        else cp.setValue(to);
        moved++;
      }
    } finally {
      app.endUndoGroup();
    }
    return { success: true, count: moved };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
