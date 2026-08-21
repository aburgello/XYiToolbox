// =============================================================================
// src/jsx/aeft/insitu.ts
// -----------------------------------------------------------------------------
// PUTTING THE DELIVERABLE ON THE WALL.
//
// An in-situ is the photo of the site with the build corner-pinned onto the
// screen face, and the studio makes one for nearly every bespoke. By hand it is
// import, precomp, corner pin, drag four points, repeat per face, and the
// dragging happens at 30% zoom against a background you cannot see through.
//
// WHAT THE API ALLOWS, probed against AE 26.2.1 rather than assumed:
// `ADBE Corner Pin` takes setValue and setValueAtTime on all four points and
// warps exactly as the UI does -- verified by rendering a frame and looking at
// it. READING one back throws "invalid numeric result (divide by zero?)", from
// `.value` and `valueAtTime` alike, so nothing here reads a pin. The panel owns
// the quad and AE is written to, never asked. `CC Power Pin`'s points start at
// -0002, not -0001, if anyone ever swaps the effect.
//
// LAYER SPACE IS MADE EQUAL TO COMP SPACE before pinning: anchor and position
// both zeroed, so the four points can be given in the coordinates the panel
// already has. Without that the quad is offset by half the layer and the
// numbers stop meaning anything an artist can check.
// =============================================================================
import { Result } from "./shared";

const CORNER_PIN = "ADBE Corner Pin";
// Bezier Warp, for curved screens. Twelve points around the perimeter: a
// vertex, then the two tangents of the edge leaving it. Probed for the real
// matchName -- "ADBE Bezier Warp" is refused, the effect is ADBE BEZMESH.
const BEZIER_WARP = "ADBE BEZMESH";
// A true cylindrical wrap. Probed: Radius, Rotation X/Y/Z and the shading
// sliders all take setValue; the grouped params (Position, Rotation, Light)
// throw on READ like every other compound effect param in this file.
const CC_CYLINDER = "CC Cylinder";
const CYL_RADIUS = "CC Cylinder-0002";
const CYL_ROT_Y = "CC Cylinder-0010";
const CYL_RENDER = "CC Cylinder-0013";
const CYL_AMBIENT = "CC Cylinder-0021";
const CYL_DIFFUSE = "CC Cylinder-0022";
const CYL_SPECULAR = "CC Cylinder-0023";
const BEZ = [
  "ADBE BEZMESH-0001",  // 0  top left vertex
  "ADBE BEZMESH-0002",  // 1  top edge, leaving TL
  "ADBE BEZMESH-0003",  // 2  top edge, arriving TR
  "ADBE BEZMESH-0004",  // 3  top right vertex
  "ADBE BEZMESH-0005",  // 4  right edge, leaving TR
  "ADBE BEZMESH-0006",  // 5  right edge, arriving BR
  "ADBE BEZMESH-0007",  // 6  bottom right vertex
  "ADBE BEZMESH-0008",  // 7  bottom edge, leaving BR
  "ADBE BEZMESH-0009",  // 8  bottom edge, arriving BL
  "ADBE BEZMESH-0010",  // 9  bottom left vertex
  "ADBE BEZMESH-0011",  // 10 left edge, leaving BL
  "ADBE BEZMESH-0012",  // 11 left edge, arriving TL
];
const PIN_UL = "ADBE Corner Pin-0001";
const PIN_UR = "ADBE Corner Pin-0002";
const PIN_LL = "ADBE Corner Pin-0003";
const PIN_LR = "ADBE Corner Pin-0004";

/** Stamped on what this builds, so a rebuild can replace its own work. */
const INSITU_MARK = "XYi Insitu";
/** A face's artwork comp. Marked SEPARATELY from the build, because a rebuild
 *  replaces the build and must leave the artwork alone. */
const INSITU_ART = "XYi Insitu artwork";
/** MEASURED, not guessed: rendered a full-width solid through CC Cylinder and
 *  read the alpha bounds back. At Radius 100 the drum covers 0.321 of the
 *  layer's width -- 1/PI, so the layer's width IS the circumference and the
 *  visible diameter is width/PI. Height comes back untouched (1.000), which is
 *  why the wrapper needs no vertical padding at all; adding some only squashed
 *  the artwork into the middle of the quad. */
const CYL_PAD_H = 1;
/** How far past the drum's silhouette the artwork is pushed, to cover the
 *  antialiased fade at the very edge. See the note where it is used. */
const CYL_BLEED = 1.04;
/** The control null inside a drum comp. Named, because three expressions and
 *  an artist all have to find it. */
const DRUM_CTRL = "DRUM CONTROLS";

export interface InsituFace {
  /** Comp coordinates, clockwise from the top left. */
  ul: number[];
  ur: number[];
  ll: number[];
  lr: number[];
  /** What goes on this face. An item id from the project panel is the normal
   *  case -- in-situs are built from the localised comp that is open, not from
   *  a master on disk. A path is still accepted for anything off disk. */
  sourceId: number;
  masterPath: string;
  /** THE FACE IS A GRID, not a row of panels. `grid[r][c]` is a point in comp
   *  coordinates; two rows by two columns is the flat quad everything started
   *  as. Columns divide the screen along its length, rows down its height, and
   *  both are needed -- a corner unit or a stacked wall bends on both axes and
   *  a single row of ribs can only ever cut it one way. */
  grid: number[][][];
  /** One per CELL, `cells[r][c]`, so curvature is a property of the piece it
   *  belongs to. `t` is EIGHT tangents, two per edge, in edge order: top (left
   *  to right), right (top to bottom), bottom (LEFT TO RIGHT), left (bottom to
   *  top). `edges` says which of the four are bent; the rest are straight
   *  thirds. Which sides of a screen curve is not knowable in advance, so all
   *  four are available. */
  cells: { curved: boolean; t: number[][]; edges: boolean[] }[][];
  /** THE SPINE OF THE SCREEN. Two ribs is a flat panel and the four corners
   *  above are it. Three or more is a wall that bends: each pair of ribs is a
   *  segment carrying its own slice of the artwork, which is the only way to
   *  follow an S-curve, since one cubic per edge cannot. Each rib is
   *  [topX, topY, bottomX, bottomY] in comp coordinates. */
  ribs: number[][];
  /** 0 for a flat wall. Otherwise how much of a drum the face shows, in
   *  degrees, which changes how the artwork is distributed across the ribs. */
  wrapDeg: number;
  /** A true cylindrical wrap through CC Cylinder rather than a strip. */
  cylinder: boolean;
  cylinderRadius: number;
  cylinderRotation: number;
  /** How many degrees of the drum the artwork actually covers. */
  cylinderWrap: number;
  /**
   * THE FACE'S REAL OUTLINE, in comp coordinates, when it has one.
   *
   * A chevron arch is not a quadrilateral, and a quad around it spills artwork
   * over the gap in the middle. Given an outline, the layer is placed to the
   * face's bounding box and MASKED to the outline instead of being warped:
   * masks apply in layer space, before effects, so a mask on a corner-pinned
   * layer would be warped along with the picture. Fitting rather than pinning
   * is what keeps the mask meaning what it says.
   */
  outline: number[][];
  /** What to call the layer. */
  name: string;
  opacity: number;
  /** "normal" | "screen" | "add" -- an LED wall reads better than a matte. */
  blend: string;
}

interface InsituConfig {
  backdrop: string;
  compName: string;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  facesJson: string;
}

export interface InsituResult extends Result {
  compName?: string;
  faces?: number;
  missing?: string[];
}

function blendMode(name: string): any {
  const n = String(name || "").toLowerCase();
  if (n === "screen") return BlendingMode.SCREEN;
  if (n === "add") return BlendingMode.ADD;
  return BlendingMode.NORMAL;
}

/** An item already in the project for this file, or a fresh import.
 *
 *  Matched on fsName rather than on name: two territories' backdrops are both
 *  called insitu.jpg often enough, and importing the same file twice leaves the
 *  artist choosing between identical-looking footage items. */
function importOnce(path: string): any {
  const file = new File(path);
  const wantName = String(file.name);
  const isProject = wantName.length > 4 &&
    wantName.substring(wantName.length - 4).toLowerCase() === ".aep";

  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i) as any;

    // AN IMPORTED .aep IS A FOLDER, AND A FOLDER HAS NO `.file`. Measured:
    // re-importing the same master eight times over eight builds left eight
    // copies of its whole comp tree in the project, because the dedupe below
    // skipped anything without a file and a FolderItem never has one. AE names
    // that folder exactly after the file, extension and all.
    if (isProject) {
      if (typeof item.numItems !== "number") continue;
      if (String(item.name) === wantName) return item;
      continue;
    }

    if (!item.file) continue;
    if (String(item.file.fsName) === String(file.fsName)) return item;
    if (String(item.name) === wantName) return item;
  }
  // Attempted, not tested with .exists -- that lies on the studio NAS.
  return app.project.importFile(new ImportOptions(file));
}

/** The comp inside an imported master .aep, or the footage item itself.
 *
 *  A master imported as a project arrives as a whole folder of comps; what an
 *  in-situ wants is the one named like the file. Anything else is a precomp of
 *  it and would show a fragment of the build on the wall. */
function pickBuildComp(imported: any, stem: string): any {
  if (!imported) return null;
  if (typeof imported.numLayers === "number") return imported;
  if (typeof imported.numItems !== "number") return imported;

  // RECURSIVE, because an imported .aep arrives as its own tree: the studio's
  // masters keep their comps under Composition/Main, so a single level down
  // finds folders and no comp at all. Measured on a real template, which is
  // how this was caught.
  let best: any = null;
  let bestArea = -1;

  const walk = function (folder: any, depth: number): any {
    if (depth > 4) return null;
    for (let i = 1; i <= folder.numItems; i++) {
      const kid = folder.item(i) as any;
      if (typeof kid.numLayers === "number") {
        // The comp named like the file is the build, by the studio's own
        // convention (CLAUDE.md section 5). Anything else is a precomp of it,
        // and putting one of those on a wall shows a fragment.
        if (String(kid.name).toLowerCase() === String(stem).toLowerCase()) return kid;
        const area = Number(kid.width) * Number(kid.height);
        if (area > bestArea) { bestArea = area; best = kid; }
        continue;
      }
      if (typeof kid.numItems !== "number") continue;
      const hit = walk(kid, depth + 1);
      if (hit) return hit;
    }
    return null;
  };

  const exact = walk(imported, 0);
  if (exact) return exact;
  // No exact name: the biggest comp is the board, its precomps are smaller.
  return best;
}

/** The project item with this id, or null. Ids are stable for the life of the
 *  project, which names and indices are not. */
function itemById(id: number): any {
  if (!(Number(id) > 0)) return null;
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i) as any;
    if (Number(item.id) === Number(id)) return item;
  }
  return null;
}

/**
 * The comp the warp is actually applied to: one per face, holding its artwork.
 *
 * THE RIG OUTLIVES THE CONTENT. Pinning the video straight onto the wall means
 * a new cut is a new build, and any nudge the artist made is gone. A face's
 * artwork lives in its own comp instead, and everything downstream -- the
 * slices, the drum padding, the warp -- refers to THAT. Swapping the video, or
 * scaling it a little to sit better on the screen, is then a change inside one
 * comp that every piece picks up.
 *
 * REUSED IF IT EXISTS, which is the whole point: a rebuild must not throw away
 * an adjustment made inside it. Only the name and this tool's own stamp
 * identify it, so a comp somebody else made is never touched.
 */
function artworkComp(face: InsituFace, source: any, secs: number, fps: number): any {
  const name = String(face.name || "Face") + " ART";
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i) as any;
    if (typeof item.numLayers !== "number") continue;
    if (String(item.name) !== name) continue;
    if (String(item.comment) !== INSITU_ART) continue;
    return item;
  }
  // ITS OWN UNDO STEP. This comp is meant to outlive builds -- it holds the
  // artwork and whatever the artist did to it -- so undoing a build must not
  // be able to take it away.
  app.beginUndoGroup("XYi Insitu artwork: " + name);
  try {
    const comp = app.project.items.addComp(name, Number(source.width), Number(source.height), 1, secs, fps);
    comp.comment = INSITU_ART;
    const lay = comp.layers.add(source);
    const tr = lay.property("ADBE Transform Group") as PropertyGroup;
    (tr.property("ADBE Position") as Property).setValue([Number(source.width) / 2, Number(source.height) / 2]);
    return comp;
  } finally {
    app.endUndoGroup();
  }
}

/**
 * Puts a built face into the in-situ and cuts it to its traced outline.
 *
 * The comp is the same size as the in-situ, so its layer sits at the origin
 * unscaled and the outline's comp coordinates ARE its layer coordinates --
 * no conversion, nothing to get wrong.
 */
function maskFaceComp(into: CompItem, faceComp: CompItem, face: InsituFace, outline: number[][]): void {
  const lay = into.layers.add(faceComp);
  lay.name = String(face.name || "Face");
  lay.moveToBeginning();
  const tr = lay.property("ADBE Transform Group") as PropertyGroup;
  (tr.property("ADBE Anchor Point") as Property).setValue([0, 0]);
  (tr.property("ADBE Position") as Property).setValue([0, 0]);
  if (Number(face.opacity) >= 0) {
    (tr.property("ADBE Opacity") as Property).setValue(Number(face.opacity));
  }
  (lay as any).blendingMode = blendMode(face.blend);

  const verts: number[][] = [];
  for (let i = 0; i < outline.length; i++) {
    verts.push([Number(outline[i][0]), Number(outline[i][1])]);
  }

  // SMOOTH WHERE IT CURVES, SHARP WHERE IT TURNS.
  //
  // A traced outline is a polygon, so a rounded cap arrives as a fan of short
  // straight segments visibly trying to be a curve. AE masks carry tangents,
  // so each vertex gets a Catmull-Rom handle -- which leaves collinear points
  // dead straight, bends the sampled curves properly, and is skipped at a real
  // corner, where a handle would round off something that should stay square.
  const inT: number[][] = [];
  const outT: number[][] = [];
  const CORNER_TURN = Math.cos(35 * Math.PI / 180);
  for (let i = 0; i < verts.length; i++) {
    const prev = verts[(i - 1 + verts.length) % verts.length];
    const next = verts[(i + 1) % verts.length];
    const here = verts[i];
    const ax = here[0] - prev[0];
    const ay = here[1] - prev[1];
    const bx = next[0] - here[0];
    const by = next[1] - here[1];
    const la = Math.sqrt(ax * ax + ay * ay);
    const lb = Math.sqrt(bx * bx + by * by);
    let straightness = 1;
    if (la > 0 && lb > 0) straightness = (ax * bx + ay * by) / (la * lb);
    if (straightness < CORNER_TURN) {
      inT.push([0, 0]);
      outT.push([0, 0]);
      continue;
    }
    const tx = (next[0] - prev[0]) / 6;
    const ty = (next[1] - prev[1]) / 6;
    inT.push([-tx, -ty]);
    outT.push([tx, ty]);
  }

  const mask = (lay.property("ADBE Mask Parade") as PropertyGroup)
    .addProperty("ADBE Mask Atom") as PropertyGroup;
  mask.name = String(face.name || "Face") + " outline";
  const shape = new Shape();
  shape.vertices = verts;
  shape.inTangents = inT;
  shape.outTangents = outT;
  shape.closed = true;
  (mask.property("ADBE Mask Shape") as Property).setValue(shape);
}

/** Where each rib sits along the screen, 0..1, measured along the TOP edge.
 *  Arc length rather than even spacing: a segment that covers more wall should
 *  carry more artwork, which is what makes a bent wall read as continuous. */
function ribFractions(points: number[][], wrapDeg: number): number[] {
  const ribs = points;
  const out: number[] = [0];
  let total = 0;
  const runs: number[] = [];
  for (let i = 1; i < ribs.length; i++) {
    const dx = Number(ribs[i][0]) - Number(ribs[i - 1][0]);
    const dy = Number(ribs[i][1]) - Number(ribs[i - 1][1]);
    const d = Math.sqrt(dx * dx + dy * dy);
    runs.push(d);
    total += d;
  }
  if (total <= 0) {
    for (let i = 1; i < ribs.length; i++) out.push(i / (ribs.length - 1));
    return out;
  }
  let acc = 0;
  for (let i = 0; i < runs.length; i++) {
    acc += runs[i];
    out.push(acc / total);
  }

  // A DRUM DOES NOT SPREAD ITS ARTWORK EVENLY ACROSS THE PHOTO. On a cylinder
  // the wall turns away from the camera, so equal arcs compress towards the
  // silhouette: screen x goes as sin(angle) while artwork goes as the angle
  // itself. Distributing by on-screen distance stretches the edges of a curved
  // screen and everyone fixes it by eye afterwards.
  //
  //   s = sin(t) / sin(a)   ->   t = asin(s * sin(a))   ->   u = (t + a) / 2a
  //
  // with `a` half the visible wrap. At 180 degrees this is the plain asin; at
  // 0 it is left alone, which is the flat wall.
  const deg = Number(wrapDeg);
  if (!(deg > 0) || deg >= 360) return out;
  const a = (deg / 2) * Math.PI / 180;
  const sinA = Math.sin(a);
  if (!(sinA > 0)) return out;

  const wrapped: number[] = [];
  for (let i = 0; i < out.length; i++) {
    const sPos = out[i] * 2 - 1;                 // -1..1 across the visible band
    let inner = sPos * sinA;
    if (inner > 1) inner = 1;
    if (inner < -1) inner = -1;
    const t = Math.asin(inner);
    wrapped.push((t + a) / (2 * a));
  }
  return wrapped;
}

/**
 * A comp holding one vertical slice of `source`, from `u0` to `u1`.
 *
 * A precomp rather than a mask plus some homography: masks apply in LAYER
 * space, before effects, so masking a slice and corner-pinning the layer puts
 * the slice inside a corner of the segment rather than filling it. Offsetting
 * the source inside a comp the width of the slice is exact, needs no maths,
 * and an artist can open it and see what it is.
 */
function sliceComp(source: any, u0: number, u1: number, v0: number, v1: number,
                  name: string, secs: number, fps: number, into: FolderItem): any {
  const w = Number(source.width);
  const h = Number(source.height);
  const x0 = Math.round(u0 * w);
  const x1 = Math.round(u1 * w);
  const y0 = Math.round(v0 * h);
  const y1 = Math.round(v1 * h);
  const sw = Math.max(1, x1 - x0);
  const sh = Math.max(1, y1 - y0);
  const comp = app.project.items.addComp(name, sw, sh, 1, secs, fps);
  comp.parentFolder = into;
  const lay = comp.layers.add(source);
  const tr = lay.property("ADBE Transform Group") as PropertyGroup;
  (tr.property("ADBE Anchor Point") as Property).setValue([0, 0]);
  (tr.property("ADBE Position") as Property).setValue([-x0, -y0]);
  return comp;
}

function stemOf(path: string): string {
  const file = new File(path);
  let n = String(file.name);
  const dot = n.lastIndexOf(".");
  if (dot > 0) n = n.substring(0, dot);
  return n;
}

/**
 * Builds the in-situ comp: backdrop at the bottom, one pinned layer per face.
 *
 * Rebuilding replaces this tool's own comp of the same name rather than piling
 * up _2, _3 copies -- an in-situ gets rebuilt five times as the quad is nudged,
 * and the fifth one is the only one anybody wants.
 */
export const insituBuild = (configJson: string): InsituResult => {
  try {
    const cfg = JSON.parse(String(configJson || "{}")) as InsituConfig;
    const faces = JSON.parse(String(cfg.facesJson || "[]")) as InsituFace[];
    if (!cfg.backdrop) return { success: false, error: "Pick a backdrop first." };
    if (faces.length === 0) return { success: false, error: "Mark at least one face on the backdrop." };

    const missing: string[] = [];
    // NOT ONE GIANT UNDO STEP.
    //
    // A single group meant one stray Cmd+Z deleted the whole comp, however long
    // ago it was built -- and since nothing in the panel touches AE, the build
    // sits at the top of AE's undo stack for as long as the artist keeps
    // working on the board. The work is split instead: the comp and its plate,
    // then one step per face, then a cushion. One press now costs one face, and
    // the press people actually make by accident costs nothing at all.
    app.beginUndoGroup("XYi Insitu comp");
    let openGroup = true;
    const step = function (label: string): void {
      if (openGroup) app.endUndoGroup();
      app.beginUndoGroup(label);
      openGroup = true;
    };
    try {
      const backdrop = importOnce(String(cfg.backdrop));
      if (!backdrop) return { success: false, error: "Couldn't import that backdrop." };

      const width = Number(cfg.width) > 0 ? Number(cfg.width) : Number(backdrop.width);
      const height = Number(cfg.height) > 0 ? Number(cfg.height) : Number(backdrop.height);
      const fps = Number(cfg.frameRate) > 0 ? Number(cfg.frameRate) : 25;
      const secs = Number(cfg.duration) > 0 ? Number(cfg.duration) : 10;
      const name = String(cfg.compName || "INSITU");

      // Replace OURS, by the stamp. A comp of the same name that this tool did
      // not make is left alone and the build gets a new one beside it. The
      // slice folders go with it -- they belong to that build and nothing else
      // refers to them.
      for (let i = app.project.numItems; i >= 1; i--) {
        const item = app.project.item(i) as any;
        if (typeof item.numItems !== "number") continue;
        if (String(item.comment) !== INSITU_MARK) continue;
        item.remove();
      }
      for (let i = app.project.numItems; i >= 1; i--) {
        const item = app.project.item(i) as any;
        if (typeof item.numLayers !== "number") continue;
        if (String(item.name) !== name) continue;
        if (String(item.comment) !== INSITU_MARK) continue;
        item.remove();
      }

      const comp = app.project.items.addComp(name, width, height, 1, secs, fps);
      comp.comment = INSITU_MARK;

      const plate = comp.layers.add(backdrop);
      plate.name = "PLATE " + String(backdrop.name);
      // A still stretched to the comp; a movie keeps its own length.
      if (typeof (backdrop as any).duration === "number" && (backdrop as any).duration === 0) {
        plate.outPoint = comp.duration;
      }
      (plate as any).locked = true;

      let placed = 0;
      for (let f = faces.length - 1; f >= 0; f--) {
        const face = faces[f];
        step("XYi Insitu face: " + String(face.name || "Face"));
        let build: any = null;
        if (Number(face.sourceId) > 0) {
          build = itemById(Number(face.sourceId));
          if (!build) { missing.push(String(face.name) + " (that item has gone from the project)"); continue; }
        } else if (face.masterPath) {
          const fromDisk = stemOf(String(face.masterPath));
          build = pickBuildComp(importOnce(String(face.masterPath)), fromDisk);
          if (!build) { missing.push(fromDisk + " (no comp inside)"); continue; }
        } else {
          missing.push(String(face.name) + " (nothing assigned)");
          continue;
        }

        // Everything below works on the face's own artwork comp, never on the
        // item itself. See artworkComp.
        build = artworkComp(face, build,
          Number(cfg.duration) > 0 ? Number(cfg.duration) : 10, fps);

        // A MASKED FACE IS BUILT INTO ITS OWN COMP, THEN MASKED.
        //
        // Masks apply in layer space, before effects, so a mask on a
        // corner-pinned layer is warped along with the picture. The first
        // version dodged that by fitting the artwork to a bounding box instead
        // of warping it -- which quietly threw away Round, the bezier sides and
        // the cells for any face carrying an outline, so a traced tower came
        // back as a flat crop of the artwork.
        //
        // Building the face into a comp the size of the in-situ and masking
        // THAT layer composes properly: the warp happens inside, the mask
        // applies to the finished result, and every control still means what
        // it says.
        const outline = face.outline || [];
        const needsMask = outline.length >= 3;
        let target = comp;
        let faceComp: CompItem | null = null;
        if (needsMask) {
          faceComp = app.project.items.addComp(
            String(face.name || "Face") + " SHAPE", comp.width, comp.height, 1,
            Number(cfg.duration) > 0 ? Number(cfg.duration) : 10, fps);
          faceComp.comment = INSITU_MARK;
          target = faceComp;
        }

        // EVERY FACE IS A GRID OF CELLS. One cell is the flat panel that used
        // to be the special case; the only difference is how many pieces the
        // artwork is cut into, and each cell decides for itself whether it is
        // straight or bowed.
        const grid = face.grid || [];
        const cells = face.cells || [];
        const rows = grid.length;
        const cols = rows > 0 ? grid[0].length : 0;
        if (rows >= 2 && cols >= 2 && !face.cylinder) {
          const secs = Number(cfg.duration) > 0 ? Number(cfg.duration) : 10;
          const many = rows > 2 || cols > 2;
          let folder: FolderItem | null = null;
          if (many) {
            folder = app.project.items.addFolder(String(face.name || "Face") + " slices");
            folder.comment = INSITU_MARK;
          }
          // Columns measured along the top edge, rows down the left: the two
          // axes are independent and a face can be bent on either.
          const leftEdge: number[][] = [];
          for (let r = 0; r < rows; r++) leftEdge.push(grid[r][0]);
          const us = ribFractions(grid[0], Number(face.wrapDeg));
          const vs = ribFractions(leftEdge, 0);

          // Built back to front so the first cell ends up on top, matching the
          // order the panel lists them in.
          for (let r = rows - 2; r >= 0; r--) {
            for (let c = cols - 2; c >= 0; c--) {
              const piece = many
                ? sliceComp(build, us[c], us[c + 1], vs[r], vs[r + 1],
                    String(face.name || "Face") + "_r" + (r + 1) + "c" + (c + 1), secs, fps, folder as FolderItem)
                : build;
              const cell = target.layers.add(piece);
              cell.name = String(face.name || "Face") + (many ? " r" + (r + 1) + "c" + (c + 1) : "");
              cell.moveToBeginning();
              const cTr = cell.property("ADBE Transform Group") as PropertyGroup;
              (cTr.property("ADBE Anchor Point") as Property).setValue([0, 0]);
              (cTr.property("ADBE Position") as Property).setValue([0, 0]);
              if (Number(face.opacity) >= 0) {
                (cTr.property("ADBE Opacity") as Property).setValue(Number(face.opacity));
              }
              (cell as any).blendingMode = blendMode(face.blend);

              const ul = grid[r][c];
              const ur = grid[r][c + 1];
              const lr = grid[r + 1][c + 1];
              const ll = grid[r + 1][c];
              const spec = cells[r] ? cells[r][c] : null;
              const cellFx = cell.property("ADBE Effect Parade") as PropertyGroup;

              if (spec && spec.curved && spec.t && spec.t.length >= 8) {
                const bez = cellFx.addProperty(BEZIER_WARP) as PropertyGroup;
                const third = function (p: number[], q: number[], k: number): number[] {
                  return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
                };
                const on = spec.edges || [];
                // An edge that is not bent gets straight thirds, which is what
                // Corner Pin would have done with it.
                const topT = on[0] ? [spec.t[0], spec.t[1]] : [third(ul, ur, 1 / 3), third(ul, ur, 2 / 3)];
                const rightT = on[1] ? [spec.t[2], spec.t[3]] : [third(ur, lr, 1 / 3), third(ur, lr, 2 / 3)];
                // BEZMESH walks the bottom RIGHT TO LEFT while the panel stores
                // it left to right, so these two swap.
                const botT = on[2] ? [spec.t[5], spec.t[4]] : [third(lr, ll, 1 / 3), third(lr, ll, 2 / 3)];
                const leftT = on[3] ? [spec.t[7], spec.t[6]] : [third(ll, ul, 1 / 3), third(ll, ul, 2 / 3)];
                const pts: number[][] = [
                  ul, topT[0], topT[1],
                  ur, rightT[0], rightT[1],
                  lr, botT[0], botT[1],
                  ll, leftT[0], leftT[1],
                ];
                for (let i = 0; i < BEZ.length; i++) {
                  (bez.property(BEZ[i]) as Property).setValue([Number(pts[i][0]), Number(pts[i][1])]);
                }
              } else {
                const cellPin = cellFx.addProperty(CORNER_PIN) as PropertyGroup;
                (cellPin.property(PIN_UL) as Property).setValue([Number(ul[0]), Number(ul[1])]);
                (cellPin.property(PIN_UR) as Property).setValue([Number(ur[0]), Number(ur[1])]);
                (cellPin.property(PIN_LL) as Property).setValue([Number(ll[0]), Number(ll[1])]);
                (cellPin.property(PIN_LR) as Property).setValue([Number(lr[0]), Number(lr[1])]);
              }
            }
          }
          if (faceComp) maskFaceComp(comp, faceComp, face, outline);
          placed++;
          continue;
        }

        // THE CYLINDER PATH IS A SINGLE LAYER, not a grid of cells: the effect
        // does the wrapping, so cutting the artwork into pieces first would
        // wrap each piece separately.
        //
        // AND IT NEEDS ROOM. CC Cylinder renders inside the LAYER'S OWN BOUNDS,
        // so applying it straight to the artwork bends the picture within its
        // own rectangle and clips whatever leaves it -- which is exactly what
        // it looked like. The artwork goes into a wider comp first, centred,
        // and the effect is applied to THAT: the full width of the wrapper maps
        // to the full 360 degrees, so artwork covering `cylinderWrap` degrees
        // needs a wrapper 360/wrap times as wide.
        // THE DRUM IS SIZED INSIDE ITS OWN COMP, never by stretching the
        // placement.
        //
        // The first version expanded the four corners by ~3.14 so the drum
        // filled the quad -- which dragged the bezier handles out with them, so
        // only the flat middle of the artist's curve stayed visible and the top
        // and bottom came back as straight lines with sharp corners. The
        // expansion belongs where the effect is: the wrapped layer is scaled
        // horizontally INSIDE a comp until the artwork fills it, and that comp
        // is then placed on the artist's quad exactly as drawn, curves and all.
        let cylSource: any = build;
        if (face.cylinder) {
          const wrapDeg = Number(face.cylinderWrap) > 0 ? Number(face.cylinderWrap) : 180;
          const radius = Number(face.cylinderRadius) > 0 ? Number(face.cylinderRadius) : 100;
          const times = Math.max(1, Math.min(6, 360 / wrapDeg));
          const secs = Number(cfg.duration) > 0 ? Number(cfg.duration) : 10;

          // 1. The artwork on a strip covering `wrapDeg` of the circumference.
          const padW = Math.max(2, Math.round(Number(build.width) * times));
          const padH = Math.max(2, Math.round(Number(build.height)));
          const pad = app.project.items.addComp(
            String(face.name || "Face") + "_wrap", padW, padH, 1, secs, fps);
          pad.comment = INSITU_MARK;
          const inner = pad.layers.add(build);
          (inner.property("ADBE Transform Group").property("ADBE Position") as Property)
            .setValue([padW / 2, padH / 2]);

          // 2. Wrapped, then scaled until the artwork fills the frame. Measured:
          //    the drum covers (radius/100)/PI of the layer's width, and the
          //    artwork covers sin(half the wrap) of THAT. Scale is a transform,
          //    so it happens after the effect -- which is what makes this work.
          const drum = app.project.items.addComp(
            String(face.name || "Face") + "_drum", padW, padH, 1, secs, fps);
          drum.comment = INSITU_MARK;
          const wrapped = drum.layers.add(pad);
          const cyl = (wrapped.property("ADBE Effect Parade") as PropertyGroup)
            .addProperty(CC_CYLINDER) as PropertyGroup;
          (cyl.property(CYL_RADIUS) as Property).setValue(radius);
          (cyl.property(CYL_ROT_Y) as Property).setValue(Number(face.cylinderRotation) || 0);
          (cyl.property(CYL_RENDER) as Property).setValue(2);
          (cyl.property(CYL_AMBIENT) as Property).setValue(100);
          (cyl.property(CYL_DIFFUSE) as Property).setValue(0);
          (cyl.property(CYL_SPECULAR) as Property).setValue(0);

          // THE NUMBERS LIVE IN THE COMP, not only in the panel.
          //
          // A drum always needs a nudge once it is sitting on the real plate,
          // and going back to the panel to rebuild loses whatever else was
          // done in the meantime. Three sliders on a control null drive the
          // wrap, the turn and the bleed by expression, so the whole thing
          // stays adjustable in AE afterwards. The panel's values are simply
          // the starting positions.
          const ctrl = drum.layers.addNull();
          ctrl.name = DRUM_CTRL;
          (ctrl as any).enabled = false;
          const ctrlFx = ctrl.property("ADBE Effect Parade") as PropertyGroup;
          const slider = function (label: string, value: number): void {
            const sl = ctrlFx.addProperty("ADBE Slider Control") as PropertyGroup;
            sl.name = label;
            (sl.property("ADBE Slider Control-0001") as Property).setValue(value);
          };
          slider("Wrap", wrapDeg);
          slider("Turn", Number(face.cylinderRotation) || 0);
          slider("Bleed", CYL_BLEED * 100);

          const halfWrap = (Math.min(180, wrapDeg) / 2) * Math.PI / 180;
          let seen = Math.sin(halfWrap);
          if (seen < 0.05) seen = 0.05;
          // A TOUCH OF BLEED, and it is not a fudge. At 180 degrees the
          // artwork's edges land exactly ON the silhouette, where the surface
          // turns away from camera: the last degrees compress into sub-pixel
          // width and antialias to transparent, so the artwork reaches the edge
          // arithmetically and fades a few pixels short of it visually. Four
          // percent covers the fade, and the pixels it pushes past the edge
          // were the ones already squeezed to nothing.
          //
          // A screen that genuinely wraps further should say so in ° wrap --
          // over 180 is allowed and is the honest answer for a real drum.
          let fill = (Math.PI / ((radius / 100) * seen)) * CYL_BLEED;
          if (fill > 12) fill = 12;
          (wrapped.property("ADBE Transform Group").property("ADBE Scale") as Property)
            .setValue([fill * 100, 100]);

          // Same arithmetic as above, expressed so the sliders drive it.
          (cyl.property(CYL_ROT_Y) as Property).expression =
            'thisComp.layer("' + DRUM_CTRL + '").effect("Turn")("Slider");';
          (wrapped.property("ADBE Transform Group").property("ADBE Scale") as Property).expression =
            'var c = thisComp.layer("' + DRUM_CTRL + '");\n' +
            'var w = Math.min(180, c.effect("Wrap")("Slider"));\n' +
            'var seen = Math.max(0.05, Math.sin(degreesToRadians(w / 2)));\n' +
            'var fill = (Math.PI / ((' + radius + ' / 100) * seen)) * (c.effect("Bleed")("Slider") / 100);\n' +
            '[Math.min(1200, fill * 100), 100];';

          // How much of the strip the artwork covers is the wrap too, so it
          // follows the same slider. Normalised to the width the strip was
          // built at, so the slider reads 1:1 with what the panel asked for.
          (inner.property("ADBE Transform Group").property("ADBE Scale") as Property).expression =
            'var c = comp("' + String(drum.name) + '").layer("' + DRUM_CTRL + '");\n' +
            'var k = c.effect("Wrap")("Slider") / ' + wrapDeg + ';\n' +
            '[Math.max(5, k * 100), 100];';

          cylSource = drum;
        }

        const lay = target.layers.add(cylSource);
        lay.name = String(face.name || build.name);
        lay.moveToBeginning();
        const lTr = lay.property("ADBE Transform Group") as PropertyGroup;
        (lTr.property("ADBE Anchor Point") as Property).setValue([0, 0]);
        (lTr.property("ADBE Position") as Property).setValue([0, 0]);
        if (Number(face.opacity) >= 0) {
          (lTr.property("ADBE Opacity") as Property).setValue(Number(face.opacity));
        }
        (lay as any).blendingMode = blendMode(face.blend);

        const fx = lay.property("ADBE Effect Parade") as PropertyGroup;

        // A DRUM CAN STILL HAVE A BENT EDGE, and now it keeps it: the quad
        // and its tangents are used exactly as drawn, because the drum was
        // sized inside its own comp rather than by stretching this.
        const placeSpec = (face.cells && face.cells[0]) ? face.cells[0][0] : null;
        const ulP = [Number(face.ul[0]), Number(face.ul[1])];
        const urP = [Number(face.ur[0]), Number(face.ur[1])];
        const llP = [Number(face.ll[0]), Number(face.ll[1])];
        const lrP = [Number(face.lr[0]), Number(face.lr[1])];

        if (placeSpec && placeSpec.curved && placeSpec.t && placeSpec.t.length >= 8) {
          const bez = fx.addProperty(BEZIER_WARP) as PropertyGroup;
          const third = function (p: number[], q: number[], k: number): number[] {
            return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
          };
          const on = placeSpec.edges || [];
          const put = function (t: number[]): number[] {
            return [Number(t[0]), Number(t[1])];
          };
          const topT = on[0] ? [put(placeSpec.t[0]), put(placeSpec.t[1])] : [third(ulP, urP, 1 / 3), third(ulP, urP, 2 / 3)];
          const rightT = on[1] ? [put(placeSpec.t[2]), put(placeSpec.t[3])] : [third(urP, lrP, 1 / 3), third(urP, lrP, 2 / 3)];
          const botT = on[2] ? [put(placeSpec.t[5]), put(placeSpec.t[4])] : [third(lrP, llP, 1 / 3), third(lrP, llP, 2 / 3)];
          const leftT = on[3] ? [put(placeSpec.t[7]), put(placeSpec.t[6])] : [third(llP, ulP, 1 / 3), third(llP, ulP, 2 / 3)];
          const pts: number[][] = [
            ulP, topT[0], topT[1],
            urP, rightT[0], rightT[1],
            lrP, botT[0], botT[1],
            llP, leftT[0], leftT[1],
          ];
          for (let i = 0; i < BEZ.length; i++) {
            (bez.property(BEZ[i]) as Property).setValue([Number(pts[i][0]), Number(pts[i][1])]);
          }
        } else {
          const pin = fx.addProperty(CORNER_PIN) as PropertyGroup;
          (pin.property(PIN_UL) as Property).setValue(ulP);
          (pin.property(PIN_UR) as Property).setValue(urP);
          (pin.property(PIN_LL) as Property).setValue(llP);
          (pin.property(PIN_LR) as Property).setValue(lrP);
        }
        if (faceComp) maskFaceComp(comp, faceComp, face, outline);
        placed++;
      }

      // THE CUSHION. A real but harmless write, so the first Cmd+Z after a
      // build undoes this and not the comp. It is named for what it is, so
      // anyone reading the Edit menu can see there is nothing to it.
      step("XYi Insitu built");
      comp.comment = INSITU_MARK;

      comp.openInViewer();
      return { success: true, compName: name, faces: placed, missing: missing };
    } finally {
      if (openGroup) app.endUndoGroup();
    }
  } catch (e) {
    // The LINE with it: "Object is invalid" says nothing on its own, and this
    // function reaches into three different effects.
    return { success: false, error: e.toString() + (e.line ? " (line " + e.line + ")" : "") };
  }
};

/** The backdrop picker. Null on cancel, never a fake error. */
/** Where the studio's screen plates live. Opening the dialog anywhere else is
 *  four clicks of navigation every single time. */
const PLATE_ROOT = "/Volumes/newmedia/_Motion/DOOH/DOOH_Specs";

export const insituPickBackdrop = (): string | null => {
  // openDlg on a File STARTS THERE; File.openDialog has no start folder and
  // lands wherever AE was last. Falls back when the share isn't mounted.
  const start = new Folder(PLATE_ROOT);
  if (start.exists) {
    const at = new File(PLATE_ROOT + "/plate");
    const picked = at.openDlg("Pick the in-situ photo") as any;
    return picked ? String(picked.fsName) : null;
  }
  const file = File.openDialog("Pick the in-situ photo");
  return file ? file.fsName : null;
};

export interface ProjectPick {
  id: number;
  name: string;
  kind: string;
  width: number;
  height: number;
  duration: number;
  isStill: boolean;
  /** Present for footage that came from a file, so the panel can paint it. */
  path: string;
}

export interface ProjectSelectionResult extends Result {
  items?: ProjectPick[];
}

/**
 * What is selected in the PROJECT PANEL right now.
 *
 * This is how an in-situ actually gets built here: the localised comp is open
 * and selected, and it goes on the wall. Masters are for Bespoke; asking an
 * in-situ to pick one off disk was answering a question nobody asked.
 */
export const insituProjectSelection = (): ProjectSelectionResult => {
  try {
    const sel = app.project.selection;
    const out: ProjectPick[] = [];
    for (let i = 0; i < sel.length; i++) {
      const item = sel[i] as any;
      const isComp = typeof item.numLayers === "number";
      // A folder has neither, and is not something to put on a wall.
      if (!isComp && typeof item.width !== "number") continue;
      let path = "";
      try {
        if (item.mainSource && item.mainSource.file) path = String(item.mainSource.file.fsName);
      } catch (e) { /* a solid or a placeholder has no file */ }
      out.push({
        id: Number(item.id),
        name: String(item.name),
        kind: isComp ? "comp" : "footage",
        width: Number(item.width),
        height: Number(item.height),
        duration: Number(item.duration),
        isStill: Number(item.duration) === 0,
        path: path,
      });
    }
    return { success: true, items: out };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export interface BackdropInfo extends Result {
  path?: string;
  width?: number;
  height?: number;
  isStill?: boolean;
}

/**
 * A backdrop's pixel size, straight from AE.
 *
 * Asked of AE rather than measured in the panel because the panel cannot
 * decode every format the studio shoots -- a ProRes .mov has no width in
 * Chromium and the canvas would be laid out against nothing.
 */
export const insituBackdropInfo = (path: string): BackdropInfo => {
  try {
    if (!path) return { success: false, error: "No file given." };
    app.beginUndoGroup("XYi Insitu backdrop");
    try {
      const item = importOnce(String(path)) as any;
      if (!item) return { success: false, error: "Couldn't read that file." };
      return {
        success: true,
        path: String(path),
        width: Number(item.width),
        height: Number(item.height),
        isStill: Number(item.duration) === 0,
      };
    } finally {
      app.endUndoGroup();
    }
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * A PNG of the artwork's first frame, for the panel to paint on the canvas.
 *
 * Rendered through a throwaway comp rather than read off disk, because most
 * sources are comps with no file at all and the rest are movies Chromium
 * cannot decode. Small on purpose: this is a texture for a preview, not a
 * deliverable, and it is written to the user's temp folder.
 */
export const insituSourceThumb = (id: number): Result & { path?: string; width?: number; height?: number } => {
  try {
    const item = itemById(Number(id));
    if (!item) return { success: false, error: "That item has gone from the project." };
    const w = Number(item.width);
    const h = Number(item.height);
    if (!(w > 0) || !(h > 0)) return { success: false, error: "That item has no picture." };

    const cap = 640;
    const scale = w > cap ? cap / w : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    // Folder.temp looked right and silently wrote nothing -- saveFrameToPng
    // needs a folder that exists, and the panel's own data folder is the one
    // the rest of the toolbox already keeps files in.
    const dir = new Folder(Folder.userData.fsName + "/XYiToolbox");
    if (!dir.exists) dir.create();
    const shots = new Folder(dir.fsName + "/previews");
    if (!shots.exists) shots.create();
    const out = new File(shots.fsName + "/insitu_" + Number(id) + ".png");
    app.beginUndoGroup("XYi Insitu preview");
    let shot: CompItem | null = null;
    try {
      shot = app.project.items.addComp("__xyi_insitu_preview__", tw, th, 1, 1, 25);
      const lay = shot.layers.add(item);
      const tr = lay.property("ADBE Transform Group") as PropertyGroup;
      (tr.property("ADBE Anchor Point") as Property).setValue([0, 0]);
      (tr.property("ADBE Position") as Property).setValue([0, 0]);
      (tr.property("ADBE Scale") as Property).setValue([scale * 100, scale * 100]);
      shot.saveFrameToPng(0, out);
    } finally {
      // Removed inside the same undo group, so the preview never shows up in
      // anybody's project panel.
      try { if (shot) shot.remove(); } catch (e) { /* already gone */ }
      app.endUndoGroup();
    }
    return { success: true, path: out.fsName, width: w, height: h };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
