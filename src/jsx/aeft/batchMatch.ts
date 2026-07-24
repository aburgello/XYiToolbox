// =============================================================================
// src/jsx/aeft/batchMatch.ts
// -----------------------------------------------------------------------------
// Batch Match -- "fix one file by hand, make the rest agree."
//
// Capture a REFERENCE property from the project you have open (whatever is
// selected in the Timeline), then find the equivalent property on matching
// layers across every .aep in a folder and write a value derived from that
// reference. Built after a real job: a CC Light Sweep's last Center keyframe
// had to be retargeted across a Finland batch, and the awkward parts were
// never the property write -- they were deciding WHICH comps and layers count.
//
// HOW A PROPERTY IS RE-FOUND IN ANOTHER FILE
// The reference is stored as its matchName PATH from the layer down, e.g.
//   ["ADBE Effect Parade", "CC Light Sweep", "Center"]
//   ["ADBE Transform Group", "ADBE Position"]
// and re-walked in each target. That is what makes this generic: it is not
// effect-specific, it works for any effect parameter or transform property,
// and a matchName is stable across AE versions and UI languages in a way a
// display name is not. Where two siblings share a matchName (two copies of the
// same effect), the recorded OCCURRENCE index disambiguates.
//
// THREE SCOPE RULES, ALL LEARNED THE HARD WAY -- see CLAUDE.md
//  1. requireMainFolder -- only comps under a folder called "Main" are
//     deliverables.
//  2. excludeImportedAep -- and "Main" alone is NOT enough. A project that has
//     imported a sibling project carries that project's ENTIRE
//     Composition/Main tree inside a folder named "<something>.aep". Those
//     comps are somebody else's deliverable. Without this rule a real run
//     proposed 10 edits where only 3 were genuine.
//  3. compSizes -- an explicit allow-list of comp sizes. A size that is not
//     listed cannot be touched, rather than relying on remembering to exclude
//     it. Blank means "any size".
//
// VALUES ARE NOT PORTABLE BETWEEN SIZES. Many properties (an effect's Center,
// a Position) are in source- or comp-pixel space, so the same number means a
// different place in a different asset. Hence scaleSource/scaleComp, which map
// the reference PROPORTIONALLY. That is a deliberate user choice, never
// inferred -- an offset that is right for one size is silently wrong for
// another, and this tool must not guess which.
//
// SAFETY
//  - Preview NEVER writes: it opens each project, reads, and closes with
//    DO_NOT_SAVE_CHANGES.
//  - Apply goes through losOpenForEdit(), so a file whose name still carries
//    an isolated "OV" master token is copied to a versioned working file and
//    only the COPY is edited -- same per-file guard LOS Tools/JPGLoc use.
//  - AE is single-document: a run closes whatever project is open. The caller
//    warns about this before running.
// =============================================================================
import { losOpenForEdit } from "./tools";

// ─── shapes ───────────────────────────────────────────────────────────────────

interface PathStep {
  matchName: string;
  name: string;
  occurrence: number; // index among siblings sharing this matchName
}

export interface BatchMatchReference {
  success: boolean;
  error?: string;
  compName?: string;
  compWidth?: number;
  compHeight?: number;
  layerName?: string;
  layerIndex?: number;
  sourceName?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  propertyLabel?: string;   // "CC Light Sweep > Center"
  pathJson?: string;        // PathStep[] -- handed straight back in the config
  dimensions?: number;      // 1 for a slider, 2 for a point, 3 for 3D
  isKeyframed?: boolean;
  numKeys?: number;
  keyIndex?: number;        // which key was captured
  keyTime?: number;
  value?: number[];         // always an array, even for a 1-D property
  hasExpression?: boolean;
}

interface BatchMatchConfig {
  folder: string;
  includeSubfolders: boolean;

  layerRule: { mode: string; text: string };   // exact | endsWith | contains | any
  scope: {
    requireMainFolder: boolean;
    excludeImportedAep: boolean;
    compSizes: string[];                        // ["864x1512"], empty = any
  };

  pathJson: string;                             // from the captured reference
  keyTarget: string;                            // last | first | all | static | auto

  transform: {
    mode: string;                               // verbatim | scaleSource | scaleComp | offset | multiply
    axes: number[];                             // dimension indices to write, e.g. [0] for X only
    amounts: number[];                          // offset/multiply operands, per dimension
  };

  // The reference, echoed back so a run is fully described by its config.
  reference: {
    value: number[];
    sourceWidth: number;
    sourceHeight: number;
    compWidth: number;
    compHeight: number;
  };

  roundDecimals: number;                        // -1 = no rounding
  selectedIds: string[];                        // apply only these (empty = all changes)
}

export interface BatchMatchRow {
  id: string;
  file: string;
  compPath: string;
  compName: string;
  compSize: string;
  layerName: string;
  layerIndex: number;
  sourceSize: string;
  keyIndex: number;   // 0 = static value, no keyframes
  keyTime: number;
  current: number[];
  proposed: number[];
  status: string;     // change | same | skip
  note?: string;
  savedAs?: string;   // set when apply copy-first'd an OV-tokened master
}

export interface BatchMatchRunResult {
  success: boolean;
  error?: string;
  applied: boolean;
  filesScanned: number;
  filesWritten: number;
  rows: BatchMatchRow[];
  message?: string;
}

// ─── small helpers (ES3-safe: no Array.some/forEach, no lookbehind) ───────────

function bmRound(n: number, decimals: number): number {
  if (decimals < 0) return n;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function bmToArray(v: any): number[] {
  if (v instanceof Array) {
    const out: number[] = [];
    for (let i = 0; i < v.length; i++) out.push(Number(v[i]));
    return out;
  }
  return [Number(v)];
}

function bmSameValue(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 0.01) return false;
  }
  return true;
}

function bmFmt(a: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < a.length; i++) parts.push(String(bmRound(a[i], 2)));
  return parts.join(", ");
}

// A real content layer -- duck-typed on sourceRectAtTime rather than
// `instanceof AVLayer`, which does not reliably match ShapeLayer in a real AE
// session (see CLAUDE.md's motionTools notes).
function bmIsContentLayer(layer: any): boolean {
  return typeof layer.sourceRectAtTime === "function";
}

function bmLayerNameMatches(layer: Layer, mode: string, text: string): boolean {
  if (mode === "any") return true;
  const needle = String(text).toLowerCase();
  if (needle === "") return false;

  const names: string[] = [String(layer.name).toLowerCase()];
  try {
    const src = (layer as any).source;
    if (src && src.name) names.push(String(src.name).toLowerCase());
  } catch (e) { /* camera/light/audio has no source */ }

  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    // indexOf, never .match() -- a real layer/file name can contain regex
    // metacharacters and .match() would treat them as a pattern.
    if (mode === "exact" && n === needle) return true;
    if (mode === "contains" && n.indexOf(needle) !== -1) return true;
    if (mode === "endsWith") {
      if (n.length >= needle.length && n.substring(n.length - needle.length) === needle) return true;
    }
  }
  return false;
}

function bmIsUnderMain(item: Item): boolean {
  let f: FolderItem | null = item.parentFolder;
  let guard = 0;
  while (f && guard++ < 50) {
    if (String(f.name) === "Main") return true;
    f = f.parentFolder;
  }
  return false;
}

function bmIsInsideImportedProject(item: Item): boolean {
  let f: FolderItem | null = item.parentFolder;
  let guard = 0;
  while (f && guard++ < 50) {
    const n = String(f.name).toLowerCase();
    if (n.length > 4 && n.substring(n.length - 4) === ".aep") return true;
    f = f.parentFolder;
  }
  return false;
}

function bmFolderPath(item: Item): string {
  const names: string[] = [];
  let f: FolderItem | null = item.parentFolder;
  let guard = 0;
  while (f && guard++ < 50) {
    if (String(f.name) === "Root") break;
    names.unshift(String(f.name));
    f = f.parentFolder;
  }
  return names.length ? names.join("/") : "(root)";
}

function bmSizeAllowed(comp: CompItem, sizes: string[]): boolean {
  if (!sizes) return true;
  if (sizes.length === 0) return true;
  const key = comp.width + "x" + comp.height;
  for (let i = 0; i < sizes.length; i++) {
    if (String(sizes[i]) === key) return true;
  }
  return false;
}

function bmCollectAeps(folder: Folder, recurse: boolean, out: File[]): void {
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it instanceof Folder) {
      // Underscore-prefixed folders are excluded from every scan in this
      // toolset (_old, _Delivered, ...), and AE's own autosave folder must
      // never be batch-edited.
      if (!recurse) continue;
      const nm = String(it.name);
      if (nm.charAt(0) === "_") continue;
      if (nm.indexOf("Auto-Save") !== -1) continue;
      bmCollectAeps(it, recurse, out);
    } else if (it instanceof File) {
      const n = String(it.name).toLowerCase();
      if (n.length > 4 && n.substring(n.length - 4) === ".aep") out.push(it);
    }
  }
}

// ─── property path: capture + resolve ─────────────────────────────────────────

function bmOwnerLayer(prop: PropertyBase): Layer | null {
  let node: any = prop;
  let guard = 0;
  while (node && guard++ < 60) {
    const parent = node.propertyGroup ? node.propertyGroup(1) : null;
    if (!parent) return null;
    // A Layer exposes containingComp; a PropertyGroup does not.
    if (typeof parent.containingComp !== "undefined" && typeof parent.index !== "undefined") return parent as Layer;
    node = parent;
  }
  return null;
}

// Occurrence = how many EARLIER siblings share this matchName, so a second
// copy of the same effect on one layer is still addressable.
//
// Walked by propertyIndex, never by object identity. A first version compared
// `parent.property(i) === child` and silently never matched: in ExtendScript's
// AE DOM two accesses to the same property hand back DIFFERENT wrapper
// objects, so `===` is always false. Every captured path came out with
// occurrence 1 instead of 0 and resolved to nothing in every target file --
// found by running this against a real batch, invisible to tsc and to browser
// preview. Same family as this codebase's other "the AE DOM is not a normal JS
// object graph" traps (instanceof against host classes, .match() on names).
function bmOccurrenceOf(parent: any, child: any): number {
  let childIdx = 0;
  try { childIdx = child.propertyIndex; } catch (e) { return 0; }
  if (!childIdx) return 0;

  let occ = 0;
  for (let i = 1; i < childIdx; i++) {
    let sib: any;
    try { sib = parent.property(i); } catch (e2) { continue; }
    if (String(sib.matchName) === String(child.matchName)) occ++;
  }
  return occ;
}

function bmCapturePath(prop: PropertyBase): PathStep[] {
  const steps: PathStep[] = [];
  let node: any = prop;
  let guard = 0;
  while (node && guard++ < 60) {
    const parent = node.propertyGroup ? node.propertyGroup(1) : null;
    if (!parent) break;
    steps.unshift({
      matchName: String(node.matchName),
      name: String(node.name),
      occurrence: bmOccurrenceOf(parent, node),
    });
    const isLayer = typeof parent.containingComp !== "undefined" && typeof parent.index !== "undefined";
    if (isLayer) break;
    node = parent;
  }
  return steps;
}

function bmResolvePath(layer: Layer, steps: PathStep[]): Property | null {
  let node: any = layer;
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    let found: any = null;
    let occ = 0;
    let count = 0;
    try { count = node.numProperties; } catch (e) { return null; }
    for (let i = 1; i <= count; i++) {
      let child: any;
      try { child = node.property(i); } catch (e2) { continue; }
      if (String(child.matchName) !== step.matchName) continue;
      if (occ === step.occurrence) { found = child; break; }
      occ++;
    }
    if (!found) return null;
    node = found;
  }
  if (!node) return null;
  if (node.propertyType !== PropertyType.PROPERTY) return null;
  return node as Property;
}

// ─── capture the reference from the open project ──────────────────────────────

export const batchMatchCaptureReference = (): BatchMatchReference => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) {
      return { success: false, error: "Open the comp holding the layer you want to use as the reference." };
    }

    const sel = comp.selectedProperties;
    if (!sel || sel.length === 0) {
      return { success: false, error: "Select the property to copy in the Timeline (click its name, e.g. an effect's Center), then capture again." };
    }

    let prop: Property | null = null;
    for (let i = 0; i < sel.length; i++) {
      const p: any = sel[i];
      if (p.propertyType === PropertyType.PROPERTY) { prop = p as Property; break; }
    }
    if (!prop) {
      return { success: false, error: "That selection is a property GROUP. Select the individual property itself (the one showing a value)." };
    }

    const val = bmToArray(prop.value);
    let allNumeric = true;
    for (let i = 0; i < val.length; i++) {
      if (isNaN(val[i])) allNumeric = false;
    }
    if (!allNumeric) {
      return { success: false, error: "Only numeric properties can be batch-matched (this one is text, a colour swatch, a dropdown or a curve)." };
    }

    const layer = bmOwnerLayer(prop);
    if (!layer) return { success: false, error: "Could not work out which layer that property belongs to." };

    const steps = bmCapturePath(prop);
    if (steps.length === 0) return { success: false, error: "Could not build a property path for that selection." };

    const labelParts: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      // The ever-present "Effects"/"Transform" container adds nothing to a label.
      if (steps[i].matchName === "ADBE Effect Parade") continue;
      if (steps[i].matchName === "ADBE Transform Group") continue;
      labelParts.push(steps[i].name);
    }

    // Which keyframe: an explicitly selected key wins, else the last one.
    let keyIndex = 0;
    let keyTime = 0;
    let value = val;
    if (prop.numKeys > 0) {
      keyIndex = prop.numKeys;
      const selKeys = prop.selectedKeys;
      if (selKeys && selKeys.length > 0) keyIndex = selKeys[selKeys.length - 1];
      keyTime = prop.keyTime(keyIndex);
      value = bmToArray(prop.keyValue(keyIndex));
    }

    let srcW = 0;
    let srcH = 0;
    try {
      const src = (layer as any).source;
      if (src) { srcW = src.width; srcH = src.height; }
    } catch (e) { /* no source */ }

    return {
      success: true,
      compName: comp.name,
      compWidth: comp.width,
      compHeight: comp.height,
      layerName: String(layer.name),
      layerIndex: layer.index,
      sourceName: (function () {
        try {
          const s = (layer as any).source;
          return s && s.name ? String(s.name) : "";
        } catch (e) { return ""; }
      })(),
      sourceWidth: srcW,
      sourceHeight: srcH,
      propertyLabel: labelParts.join(" > "),
      pathJson: JSON.stringify(steps),
      dimensions: val.length,
      isKeyframed: prop.numKeys > 0,
      numKeys: prop.numKeys,
      keyIndex: keyIndex,
      keyTime: keyTime,
      value: value,
      hasExpression: prop.expressionEnabled,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// ─── the value maths ──────────────────────────────────────────────────────────

// Returns the value to write, starting from `current` and overwriting only the
// dimensions named in cfg.transform.axes. Everything not in `axes` is kept
// exactly as the target already had it -- that is what "only touch X" means.
function bmComputeProposed(
  cfg: BatchMatchConfig,
  current: number[],
  targetSrcW: number,
  targetSrcH: number,
  targetCompW: number,
  targetCompH: number
): number[] {
  const mode = cfg.transform.mode;
  const ref = cfg.reference.value;
  const out: number[] = [];
  for (let i = 0; i < current.length; i++) out.push(current[i]);

  for (let a = 0; a < cfg.transform.axes.length; a++) {
    const d = cfg.transform.axes[a];
    if (d < 0) continue;
    if (d >= out.length) continue;

    const refD = d < ref.length ? ref[d] : ref[0];
    let next = out[d];

    if (mode === "verbatim") {
      next = refD;
    } else if (mode === "scaleSource") {
      // Dimension 0 scales by width, 1 by height; anything beyond (Z) has no
      // meaningful source axis, so it is copied verbatim rather than guessed.
      let refDim = 0;
      let tgtDim = 0;
      if (d === 0) { refDim = cfg.reference.sourceWidth; tgtDim = targetSrcW; }
      else if (d === 1) { refDim = cfg.reference.sourceHeight; tgtDim = targetSrcH; }
      if (refDim > 0 && tgtDim > 0) next = refD * (tgtDim / refDim);
      else next = refD;
    } else if (mode === "scaleComp") {
      let refDim = 0;
      let tgtDim = 0;
      if (d === 0) { refDim = cfg.reference.compWidth; tgtDim = targetCompW; }
      else if (d === 1) { refDim = cfg.reference.compHeight; tgtDim = targetCompH; }
      if (refDim > 0 && tgtDim > 0) next = refD * (tgtDim / refDim);
      else next = refD;
    } else if (mode === "offset") {
      const amt = d < cfg.transform.amounts.length ? cfg.transform.amounts[d] : 0;
      next = out[d] + amt;
    } else if (mode === "multiply") {
      const amt = d < cfg.transform.amounts.length ? cfg.transform.amounts[d] : 1;
      next = out[d] * amt;
    }

    out[d] = bmRound(next, cfg.roundDecimals);
  }
  return out;
}

// Which keyframe indices this run targets. 0 in the list means "the static
// value" (property has no keyframes at all).
function bmTargetKeyIndices(prop: Property, keyTarget: string): number[] {
  if (prop.numKeys === 0) {
    if (keyTarget === "static") return [0];
    if (keyTarget === "auto") return [0];
    return [];
  }
  if (keyTarget === "static") return [];
  if (keyTarget === "first") return [1];
  if (keyTarget === "all") {
    const all: number[] = [];
    for (let k = 1; k <= prop.numKeys; k++) all.push(k);
    return all;
  }
  return [prop.numKeys]; // last, and auto-with-keys
}

// ─── the run (preview and apply share one body) ───────────────────────────────

function bmRun(configJson: string, applyIt: boolean): BatchMatchRunResult {
  const rows: BatchMatchRow[] = [];
  let filesScanned = 0;
  let filesWritten = 0;

  let cfg: BatchMatchConfig;
  try {
    cfg = JSON.parse(configJson) as BatchMatchConfig;
  } catch (e) {
    return { success: false, error: "Could not read the run configuration.", applied: applyIt, filesScanned: 0, filesWritten: 0, rows: [] };
  }

  let steps: PathStep[];
  try {
    steps = JSON.parse(cfg.pathJson) as PathStep[];
  } catch (e2) {
    return { success: false, error: "Could not read the captured property path -- capture the reference again.", applied: applyIt, filesScanned: 0, filesWritten: 0, rows: [] };
  }
  if (!steps || steps.length === 0) {
    return { success: false, error: "No reference property captured yet.", applied: applyIt, filesScanned: 0, filesWritten: 0, rows: [] };
  }

  const folder = new Folder(cfg.folder);
  if (!folder.exists) {
    return { success: false, error: "Folder not found: " + cfg.folder, applied: applyIt, filesScanned: 0, filesWritten: 0, rows: [] };
  }

  const aeps: File[] = [];
  bmCollectAeps(folder, cfg.includeSubfolders, aeps);
  if (aeps.length === 0) {
    return { success: false, error: "No .aep files found in that folder.", applied: applyIt, filesScanned: 0, filesWritten: 0, rows: [] };
  }

  // Only the ids the caller ticked. Empty = every changed row.
  const wanted: { [id: string]: boolean } = {};
  let haveSelection = false;
  if (cfg.selectedIds && cfg.selectedIds.length > 0) {
    haveSelection = true;
    for (let i = 0; i < cfg.selectedIds.length; i++) wanted[String(cfg.selectedIds[i])] = true;
  }

  // NOTE ON THE OPEN PROJECT -- deliberately NOT force-closed here.
  //
  // An earlier version closed the current project with DO_NOT_SAVE_CHANGES
  // before the loop, after a test appeared to show that app.open() silently
  // saves a dirty project. That test drove AE through AppleScript DoScript,
  // which SUPPRESSES modal dialogs (the same reason a confirm() deadlocks
  // under automation) -- so the save happened with no prompt there. From the
  // PANEL, where evalScript runs with AE's UI live, AE shows its normal
  // "save changes?" dialog instead, which is what users actually see and
  // expect. Force-closing here would take that choice away and silently bin
  // unsaved work, so the batch just opens its first file and lets AE ask.
  //
  // Every subsequent iteration closes its own project with
  // DO_NOT_SAVE_CHANGES (see the end of the loop), so only the user's own
  // pre-existing project can ever raise that prompt.

  for (let a = 0; a < aeps.length; a++) {
    const file = aeps[a];
    filesScanned++;

    let proj: Project | null = null;
    try {
      // Preview never writes, so it opens directly and closes without saving.
      // Apply goes through losOpenForEdit(), which copy-firsts a file still
      // carrying an isolated "OV" master token.
      proj = applyIt ? losOpenForEdit(file) : app.open(file);
    } catch (openErr) {
      rows.push({
        id: file.name + "|open", file: file.name, compPath: "", compName: "", compSize: "",
        layerName: "", layerIndex: 0, sourceSize: "", keyIndex: 0, keyTime: 0,
        current: [], proposed: [], status: "skip", note: "Could not open: " + openErr.toString(),
      });
      continue;
    }
    if (!proj) {
      rows.push({
        id: file.name + "|open", file: file.name, compPath: "", compName: "", compSize: "",
        layerName: "", layerIndex: 0, sourceSize: "", keyIndex: 0, keyTime: 0,
        current: [], proposed: [], status: "skip", note: "Could not open this project.",
      });
      continue;
    }

    // losOpenForEdit may have opened a COPY -- report where writes land.
    let savedAs = "";
    try {
      if (applyIt && proj.file && String(proj.file.name) !== String(file.name)) savedAs = String(proj.file.name);
    } catch (e3) { /* ignore */ }

    let wroteHere = 0;
    if (applyIt) app.beginUndoGroup("Batch Match");

    for (let i = 1; i <= proj.numItems; i++) {
      const item = proj.item(i);
      if (!(item instanceof CompItem)) continue;

      if (cfg.scope.excludeImportedAep && bmIsInsideImportedProject(item)) continue;
      if (cfg.scope.requireMainFolder && !bmIsUnderMain(item)) continue;
      if (!bmSizeAllowed(item, cfg.scope.compSizes)) continue;

      for (let l = 1; l <= item.numLayers; l++) {
        const layer = item.layer(l);
        if (!bmIsContentLayer(layer)) continue;
        if (!bmLayerNameMatches(layer, cfg.layerRule.mode, cfg.layerRule.text)) continue;

        const prop = bmResolvePath(layer, steps);
        const baseId = file.name + "|" + item.name + "|" + l;

        if (!prop) {
          rows.push({
            id: baseId + "|none", file: file.name, compPath: bmFolderPath(item), compName: item.name,
            compSize: item.width + "x" + item.height, layerName: String(layer.name), layerIndex: l,
            sourceSize: "", keyIndex: 0, keyTime: 0, current: [], proposed: [],
            status: "skip", note: "Layer matched, but it has no " + (steps[steps.length - 1].name) + " to match on.",
          });
          continue;
        }

        let srcW = 0;
        let srcH = 0;
        try {
          const src = (layer as any).source;
          if (src) { srcW = src.width; srcH = src.height; }
        } catch (e4) { /* no source */ }

        const rowBase = {
          file: file.name,
          compPath: bmFolderPath(item),
          compName: item.name,
          compSize: item.width + "x" + item.height,
          layerName: String(layer.name),
          layerIndex: l,
          sourceSize: srcW > 0 ? srcW + "x" + srcH : "",
        };

        if (prop.expressionEnabled) {
          rows.push({
            id: baseId + "|expr", file: rowBase.file, compPath: rowBase.compPath, compName: rowBase.compName,
            compSize: rowBase.compSize, layerName: rowBase.layerName, layerIndex: l, sourceSize: rowBase.sourceSize,
            keyIndex: 0, keyTime: 0, current: bmToArray(prop.value), proposed: [],
            status: "skip", note: "Driven by an expression -- setting a value here would be overridden, so it is left alone.",
          });
          continue;
        }

        const targets = bmTargetKeyIndices(prop, cfg.keyTarget);
        if (targets.length === 0) {
          rows.push({
            id: baseId + "|nokeys", file: rowBase.file, compPath: rowBase.compPath, compName: rowBase.compName,
            compSize: rowBase.compSize, layerName: rowBase.layerName, layerIndex: l, sourceSize: rowBase.sourceSize,
            keyIndex: 0, keyTime: 0, current: bmToArray(prop.value), proposed: [],
            status: "skip",
            note: prop.numKeys === 0 ? "Not keyframed (run targets keyframes)." : "Keyframed (run targets the static value).",
          });
          continue;
        }

        for (let t = 0; t < targets.length; t++) {
          const k = targets[t];
          const current = k === 0 ? bmToArray(prop.value) : bmToArray(prop.keyValue(k));
          const proposed = bmComputeProposed(cfg, current, srcW, srcH, item.width, item.height);
          const id = baseId + "|" + k;

          if (bmSameValue(current, proposed)) {
            rows.push({
              id: id, file: rowBase.file, compPath: rowBase.compPath, compName: rowBase.compName,
              compSize: rowBase.compSize, layerName: rowBase.layerName, layerIndex: l, sourceSize: rowBase.sourceSize,
              keyIndex: k, keyTime: k === 0 ? 0 : prop.keyTime(k), current: current, proposed: proposed,
              status: "same", note: "Already at " + bmFmt(proposed) + ".",
            });
            continue;
          }

          let note = "";
          let status = "change";
          if (applyIt) {
            const allowed = haveSelection ? (wanted[id] === true) : true;
            if (!allowed) {
              status = "skip";
              note = "Not selected for this run.";
            } else {
              try {
                if (k === 0) prop.setValue(proposed);
                else prop.setValueAtKey(k, proposed);
                wroteHere++;
              } catch (setErr) {
                status = "skip";
                note = "Could not write: " + setErr.toString();
              }
            }
          }

          rows.push({
            id: id, file: rowBase.file, compPath: rowBase.compPath, compName: rowBase.compName,
            compSize: rowBase.compSize, layerName: rowBase.layerName, layerIndex: l, sourceSize: rowBase.sourceSize,
            keyIndex: k, keyTime: k === 0 ? 0 : prop.keyTime(k), current: current, proposed: proposed,
            status: status, note: note,
            savedAs: savedAs !== "" ? savedAs : undefined,
          });
        }
      }
    }

    if (applyIt) {
      app.endUndoGroup();
      if (wroteHere > 0) {
        try {
          proj.save();
          filesWritten++;
        } catch (saveErr) {
          rows.push({
            id: file.name + "|save", file: file.name, compPath: "", compName: "", compSize: "",
            layerName: "", layerIndex: 0, sourceSize: "", keyIndex: 0, keyTime: 0,
            current: [], proposed: [], status: "skip", note: "Edits made but SAVE FAILED: " + saveErr.toString(),
          });
        }
      }
    }

    try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (closeErr) { /* nothing open */ }
  }

  let changes = 0;
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].status === "change") changes++;
  }

  return {
    success: true,
    applied: applyIt,
    filesScanned: filesScanned,
    filesWritten: filesWritten,
    rows: rows,
    message: applyIt
      ? ("Changed " + changes + " value(s) across " + filesWritten + " file(s).")
      : ("Found " + changes + " value(s) to change across " + filesScanned + " file(s)."),
  };
}

export const batchMatchPreview = (configJson: string): BatchMatchRunResult => {
  try {
    return bmRun(configJson, false);
  } catch (e) {
    return { success: false, error: e.toString(), applied: false, filesScanned: 0, filesWritten: 0, rows: [] };
  }
};

export const batchMatchApply = (configJson: string): BatchMatchRunResult => {
  try {
    return bmRun(configJson, true);
  } catch (e) {
    return { success: false, error: e.toString(), applied: true, filesScanned: 0, filesWritten: 0, rows: [] };
  }
};

export const selectBatchMatchFolder = (): string | null => {
  const folder = Folder.selectDialog("Select the folder of .aep files to match");
  return folder ? folder.fsName : null;
};
