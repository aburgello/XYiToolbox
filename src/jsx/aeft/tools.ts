// =============================================================================
// src/jsx/aeft/tools.ts -- backend catch-all: every Tools-category tool
// (Scale Composition, Adjust, Safe Generator, Master of Nulls, Edit Tools,
// Find and Replace, Wall Tools, Extreme Tools 01/02, LOS Tools, Master
// Tools, Project Buttons, Timesheet Tracker, Mask Separator) plus the
// Toolset one-click grid (Turk It, Frontcard, Cheeky T Check, DRQR, MC It!,
// etc.). Split out of aeft.ts, which is now a thin barrel -- see its header
// comment for context.
// =============================================================================
import { Result, SETTINGS_SECTION, decode, findBestComponentFile, LocGenRowReport, LocGenResult, finishLocGenReport, buildDeliverableName, durationForMasterLookup, sanitiseSiteToken, camelCaseToken, camelCaseName } from "./shared";
import { drqrProcessLayers, makeParentLayerOfAllUnparented, scaleAllCameraZooms, scaleCompToFit } from "./deliver";



// =============================================================================
// Turk It / Un-Turk It -- ported from XYi_TurkIt.jsx and XYi_UnTurkIt.jsx.
// Renames every comp in the CURRENTLY OPEN project whose name ends in a
// "_VNN" version tag, incrementing (Turk It) or decrementing (Un-Turk It)
// that number. No file dialogs, no scanning, no master files touched --
// this only ever renames comps already sitting in the active project, so
// it carries none of the master-file risk the other tools do.
// =============================================================================
const TURK_IT_VERSION_REGEX = /_V(\d\d)/;

export const turkIt = (direction: "up" | "down"): Result => {
  try {
    app.beginUndoGroup(direction === "up" ? "Turk It" : "Un-Turk It");
    const proj = app.project;
    // Tracks the highest resulting version across every renamed comp --
    // returned as maxVersion (outside the strict Result shape, but this
    // module isn't type-checked by the frontend's tsc pass, see CLAUDE.md)
    // so the React side can decide whether to celebrate a milestone
    // version without a second round-trip.
    let maxVersion = -1;
    for (let i = 1; i <= proj.numItems; i++) {
      const item = proj.item(i);
      if (item instanceof CompItem) {
        const m = item.name.match(TURK_IT_VERSION_REGEX);
        if (m) {
          const current = parseInt(m[1], 10);
          const next = direction === "up" ? current + 1 : current - 1;
          if (next > maxVersion) maxVersion = next;
          const padded = "_V" + (next < 10 ? "0" + next : String(next));
          item.name = item.name.replace(TURK_IT_VERSION_REGEX, padded);

          // Keep the Frontcard precomp's own version text layer in sync,
          // ported from XYi_TurkIt_V02.jsx -- the original tool only ever
          // renamed the comp itself, so a Frontcard-based project's visible
          // "V02" text used to silently fall out of step with the comp's
          // real _VNN tag until someone updated it by hand. Same hardcoded
          // layer-14 index and silent try/catch as the original (a locked
          // or missing layer 14 shouldn't abort the whole batch rename --
          // only that one comp's Frontcard text stays unsynced).
          const frontcardVersion = "V" + (next < 10 ? "0" + next : String(next));
          for (let li = 1; li <= item.layers.length; li++) {
            const l = item.layer(li);
            if (l.name && l.name.indexOf("Frontcard") !== -1) {
              const source = (l as AVLayer).source;
              if (source instanceof CompItem) {
                try {
                  (source.layer(14).property("Source Text") as Property).setValue(frontcardVersion);
                } catch (e) {
                  // Silently ignore if layer 14 is locked or missing -- matches original.
                }
              }
            }
          }
        }
      }
    }
    app.endUndoGroup();
    return maxVersion >= 0 ? { success: true, maxVersion: maxVersion } : { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Random Layers (Random Z / Random Starting Point) -- ported from
// XYi_RandomZ.jsx and XYi_RSP.jsx. Both act on the layers currently
// SELECTED in the active comp, nudging either their Z position or their
// start time to a random value within [minimum, minimum+range]. No file
// dialogs, no scanning, no master files touched.
// =============================================================================
export const randomZ = (minimum: number, range: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };
    app.beginUndoGroup("Random Z");
    for (let i = 0; i < layers.length; i++) {
      const pos = layers[i].property("Transform").property("Position") as Property;
      const x = pos.value[0];
      const y = pos.value[1];
      const z = minimum + Math.random() * range;
      pos.setValue([x, y, z]);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const randomStartingPoint = (minimum: number, range: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const layers = comp.selectedLayers;
    if (layers.length === 0) return { success: false, error: "Please select layers first." };
    app.beginUndoGroup("Random Starting Point");
    const frameRate = comp.frameRate;
    for (let i = 0; i < layers.length; i++) {
      const randomTime = Math.random() * range + minimum;
      layers[i].startTime = Math.floor(randomTime * frameRate) / frameRate;
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Save From Comp -- ported from XYi_CompNameSave.jsx. Saves the CURRENTLY
// OPEN project to a new file per selected comp, named after that comp, in
// the same folder as the project. Guards against the one real risk here:
// if a constructed name would coincide with the project's own current
// filename, that save is refused rather than silently overwriting it.
// =============================================================================
interface SaveFromCompResult {
  success: boolean;
  error?: string;
  savedFiles?: string[];
}

export const saveFromComp = (): SaveFromCompResult => {
  try {
    const proj = app.project;
    if (!proj.file) return { success: false, error: "Save this project once first -- there's no folder to save copies into yet." };
    if (proj.selection.length === 0) return { success: false, error: "Select one or more comps first." };
    const folder = proj.file.parent;
    const savedFiles: string[] = [];
    for (let i = 0; i < proj.selection.length; i++) {
      const name = proj.selection[i].name;
      const newFile = new File(folder.fsName + "/" + name + ".aep");
      if (newFile.fsName === proj.file.fsName) {
        return { success: false, error: 'Refusing to save "' + name + '" -- that name would overwrite the currently open project file itself.' };
      }
      proj.save(newFile);
      savedFiles.push(newFile.name);
    }
    return { success: true, savedFiles: savedFiles };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Res-suffix naming convention (set by DRQR, honoured by Rename Main Comp and
// Scale by Name)
// -----------------------------------------------------------------------------
// A Main-comp name carries its DELIVERY size as a "<W>x<H>" token. DRQR may
// append a render-quality multiplier suffix: "_DOUBLE_RES" means the comp is
// actually rendered at 2x that nominal size, "_QUAD_RES" at 4x. So a comp
// named "..._600x300_..._DOUBLE_RES" should be 1200x600 pixels on disk -- the
// WxH token stays the delivery size, the suffix is the multiplier.
//
// Two tools have to respect this or they corrupt the name/size relationship:
//   - Rename Main Comp rebuilds a comp's name from the project filename, which
//     would otherwise DROP a trailing _DOUBLE_RES/_QUAD_RES -> we re-append it.
//   - Scale by Name reads the "<W>x<H>" token; ignoring the suffix would scale
//     a "_DOUBLE_RES" comp to the bare nominal size, producing an "impostor"
//     (named double-res, actually single-res) -> we scale to nominal x
//     multiplier instead.
// These suffix strings MUST stay identical to the ones drqr() appends (same
// file, below) -- keep them in one place so they can't drift.
// =============================================================================
const RES_QUAD_SUFFIX = "_QUAD_RES";
const RES_DOUBLE_SUFFIX = "_DOUBLE_RES";

// The res suffix on a comp name, or "" if none (case-insensitive on the token).
function resSuffixOf(name: string): string {
  if (new RegExp(RES_QUAD_SUFFIX + "$", "i").test(name)) return RES_QUAD_SUFFIX;
  if (new RegExp(RES_DOUBLE_SUFFIX + "$", "i").test(name)) return RES_DOUBLE_SUFFIX;
  return "";
}

// =============================================================================
// Rename Main Comp -- ported from XYi_CRename.jsx. Renames every comp inside
// a "Main" folder to match the currently open project's own filename (plus
// its "_VNN" version tag, if any). Only renames comps already in the active
// project -- no file dialogs, no other files touched.
// =============================================================================
export const renameMainComp = (): Result => {
  try {
    if (!app.project.file) return { success: false, error: "Save this project once first." };
    let name = app.project.file.name.split(".")[0];
    let version = "_V01";
    // Original used two different regexes here (one without the leading
    // underscore for the test, one with it for the extraction), which could
    // mismatch on some filenames -- using the same regex for both, since
    // that's clearly the intent.
    const m = name.match(/_V\d\d/);
    if (m) {
      version = String(m[0]);
      name = name.split(/_V\d\d/)[0];
    }
    for (let i = 1; i <= app.project.numItems; i++) {
      const item = app.project.item(i);
      if (item.parentFolder && item.parentFolder.name === "Main") {
        const compName = item.name;
        // Preserve a trailing _DOUBLE_RES/_QUAD_RES. Strip it BEFORE the
        // "is the last token short?" heuristic (otherwise the suffix's own
        // "RES" token skews that test), then re-append it to the new name.
        const resSuffix = resSuffixOf(compName);
        const baseName = resSuffix ? compName.slice(0, compName.length - resSuffix.length) : compName;
        const lastToken = String(baseName.split("_").slice(-1));
        item.name = (lastToken.length < 3 ? name : name + version) + resSuffix;
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Organise Folders -- ported from XYi_Toolbox.jsx's orgFolWitDel(), wired to
// the "Organise Folders" button. Arranges the CURRENTLY OPEN project's own
// comps/footage into a standard folder structure (Composition/PreComp/Main,
// Footage/MOVs/Artwork/Solids/PNG), then removes any folders left empty
// afterward. No file dialogs, no other files touched.
// =============================================================================
export const organiseFolders = (): Result => {
  try {
    app.beginUndoGroup("XYi Comp Organise with Delete");

    let composition: FolderItem | undefined;
    let preComp: FolderItem | undefined;
    let main: FolderItem | undefined;
    let assets: FolderItem | undefined;
    let footage: FolderItem | undefined;
    let artwork: FolderItem | undefined;
    let solids: FolderItem | undefined;
    let png: FolderItem | undefined;

    for (let i = 1; i <= app.project.numItems; i++) {
      const item = app.project.item(i);
      if (item.name === "Composition") composition = item as FolderItem;
      if (item.name === "PreComp") preComp = item as FolderItem;
      if (item.name === "Main") main = item as FolderItem;
      if (item.name === "Footage") assets = item as FolderItem;
      if (item.name === "MOVs") footage = item as FolderItem;
      if (item.name === "Artwork") artwork = item as FolderItem;
      if (item.name === "Solids") solids = item as FolderItem;
      if (item.name === "PNG") png = item as FolderItem;
    }

    // WAS `isValid(...)`, WHICH IS NOT A GLOBAL. ExtendScript exposes
    // Object.isValid(), not a bare isValid(), so every one of these threw a
    // ReferenceError and Organise Folders could never have run to completion.
    // These are `FolderItem | undefined` filled by the loop above, so "did we
    // find one" is plain truthiness.
    if (!composition) composition = app.project.items.addFolder("Composition");
    if (!preComp) preComp = app.project.items.addFolder("PreComp");
    if (!main) main = app.project.items.addFolder("Main");
    if (!assets) assets = app.project.items.addFolder("Footage");
    if (!footage) footage = app.project.items.addFolder("MOVs");
    if (!artwork) artwork = app.project.items.addFolder("Artwork");
    if (!solids) solids = app.project.items.addFolder("Solids");
    if (!png) png = app.project.items.addFolder("PNG");

    preComp!.parentFolder = composition!;
    main!.parentFolder = composition!;
    footage!.parentFolder = assets!;
    artwork!.parentFolder = assets!;
    solids!.parentFolder = assets!;
    png!.parentFolder = assets!;

    // CORRECTED: an earlier version of this optimization assumed
    // reassigning parentFolder never changes any item's index in
    // app.project.items, based on general AE scripting documentation, and
    // iterated 1..numItems by index while reparenting in place. That
    // assumption was WRONG for real projects -- confirmed empirically
    // (not just re-argued from memory) via a controlled test: generating a
    // batch of comps and running this function once left roughly every
    // OTHER comp in a consecutive run unsorted, the textbook signature of
    // mutating a collection while iterating it forward by index (identical
    // bug class to FolderItem.remove() shifting indices below -- it turns
    // out reparenting does too). Fixed the same way as the deletion pass
    // already was: snapshot every item as a stable object reference FIRST,
    // then iterate that plain array instead of the live, index-shifting
    // collection. No item gets added or removed between here and the
    // deletion pass below (only reparented), so this one snapshot stays
    // complete and accurate through all three reparenting passes.
    const allItems: Item[] = [];
    for (let i = 1; i <= app.project.numItems; i++) {
      allItems.push(app.project.item(i));
    }

    for (let idx = 0; idx < allItems.length; idx++) {
      const item = allItems[idx];
      if (item instanceof CompItem) {
        item.parentFolder = item.label === 1 ? main! : preComp!;
      }
      if (item instanceof FootageItem) {
        const source = item.mainSource;
        if (source instanceof SolidSource) {
          item.parentFolder = solids!;
        } else if (source instanceof FileSource) {
          item.parentFolder = source.isStill ? artwork! : footage!;
        }
      }
    }

    // PNG stills get their own pass -- either explicitly labelled (11) or
    // named with a .png extension. Runs AFTER the classification pass above
    // (which put every still in Artwork) to refine PNG stills out into
    // their own folder. Same stable-snapshot iteration as above (reusing
    // the same snapshot -- nothing was added/removed by the pass above).
    for (let idx = 0; idx < allItems.length; idx++) {
      const item = allItems[idx];
      const source = item instanceof FootageItem ? item.mainSource : null;
      const isPngByExt = item.name.slice(-3).toLowerCase() === "png";
      if (source instanceof FileSource && source.isStill && (item.label === 11 || isPngByExt)) {
        item.parentFolder = png!;
      }
    }

    for (let idx = 0; idx < allItems.length; idx++) {
      const item = allItems[idx];
      if (item instanceof FolderItem && (item.name === "Composition" || item.name === "Footage")) {
        item.parentFolder = app.project.rootFolder;
      }
    }

    // Remove whatever folders ended up empty. Deletion is the other place
    // reindexing is real: FolderItem.remove() shifts every later item's
    // index down by one, which is exactly what breaks a naive forward
    // for-loop that removes in place (the item that slides into the
    // just-vacated index gets skipped, since the loop counter already moved
    // past it -- the original masked this by re-scanning 10x, which usually
    // but not provably recovers). It also can't be done in one forward pass
    // regardless, because a wrapper folder (e.g. "Composition") only becomes
    // empty AFTER its children (PreComp/Main) are removed.
    //
    // Fixed deterministically instead of re-scanned around: reuse the same
    // stable item snapshot (object references stay valid regardless of how
    // reparenting shuffled their indices), filter to FolderItems, compute
    // each one's nesting depth by walking .parentFolder up to rootFolder,
    // then remove deepest-first. A child always has strictly greater depth
    // than its parent, so children are always checked -- and removed if
    // empty -- before their parent, letting nested empties cascade
    // correctly in a single pass with no dependency on index order. Kept
    // unscoped (every FolderItem, not just this tool's own 8) to match the
    // original, which removed ANY empty folder in the project. Only ever
    // calls .remove() on a folder whose numItems is already 0, so no folder
    // holding real content -- or another snapshot entry -- is ever removed
    // as a side effect.
    const allFolders: FolderItem[] = [];
    for (let idx = 0; idx < allItems.length; idx++) {
      const item = allItems[idx];
      if (item instanceof FolderItem) allFolders.push(item);
    }

    const rootFolder = app.project.rootFolder;
    const depthOf = (folder: FolderItem): number => {
      let depth = 0;
      let current: FolderItem = folder;
      // Safety bound guards against any unexpected self-referential parent
      // chain -- a real AE project's folder nesting is never anywhere near
      // this deep, so it can only ever trip on a malformed cycle.
      while (current !== rootFolder && depth < 1000) {
        current = current.parentFolder;
        depth++;
      }
      return depth;
    };

    const withDepth = allFolders.map((folder) => ({ folder, depth: depthOf(folder) }));
    withDepth.sort((a, b) => b.depth - a.depth);
    for (let i = 0; i < withDepth.length; i++) {
      const folder = withDepth[i].folder;
      if (folder.numItems === 0) folder.remove();
    }

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Frontcard -- ported from XYi_Toolbox.jsx's FroCar(), wired to the
// "Frontcard" button. Imports the studio's brand Frontcard template
// (importFile only, never opened directly) and wraps the active comp in a
// new comp with the Frontcard layered on top.
//
// The template path is a hardcoded studio NAS mount
// (/Volumes/newmedia/...), NOT a bug -- confirmed with the studio this is a
// consistent mount point across every artist's Mac, so it's kept exactly
// as-is rather than turned into a configurable setting. This will NOT
// resolve on a non-Mac machine or one that doesn't have that share mounted.
// =============================================================================
const FRONTCARD_LANDSCAPE_TEMPLATE = "/Volumes/newmedia/XYi Design/XY016893_XYi_Brand_Guidelines/AE/_Landscape.aep";
const FRONTCARD_PORTRAIT_TEMPLATE = "/Volumes/newmedia/XYi Design/XY016893_XYi_Brand_Guidelines/AE/_Portrait.aep";
// The source comp is held off the top of the wrapper by this much, so the
// Frontcard has time to play before the creative starts.
export const FRONTCARD_LEAD_IN_SECONDS = 5;
// AE label index 1 is red -- same constant setCompDuration's red-label rule
// uses. The wrapper is deliberately flagged so the delivery comp stands out
// from the source comp sitting next to it in the Project panel.
const FRONTCARD_LABEL_RED = 1;

// Finds a named comp inside an imported .aep's folder tree. Duck-typed on
// numItems rather than `instanceof FolderItem` -- this file already documents
// that instanceof against an AE host class isn't reliable (see the
// motionTools.ts shape-layer note in CLAUDE.md).
function frontcardFindInFolder(folder: FolderItem, name: string): AVItem | null {
  for (let i = 1; i <= folder.numItems; i++) {
    const item = folder.item(i);
    if (typeof (item as any).numItems === "number") {
      const nested = frontcardFindInFolder(item as FolderItem, name);
      if (nested) return nested;
    } else if (item.name === name) {
      return item as AVItem;
    }
  }
  return null;
}

/**
 * Wraps `source` in a "<name>_V01" comp with the brand Frontcard over it and a
 * 5s lead-in -- the structure every master already has (the probe found _V01 at
 * 15s over a 10s edit).
 *
 * Extracted from frontcard() so Bespoke can produce the identical thing. Two
 * copies of this would drift, and the version that drifts is the one nobody
 * looks at until a deliverable goes out wrong.
 */
export function frontcardWrap(source: CompItem): { comp: CompItem; frontcardItem: AVItem | null } {
  const versionMatch = source.name.match(/_[Vv](\d\d)$/);
  let newName: string;
  if (versionMatch) {
    const next = parseInt(versionMatch[1], 10) + 1;
    newName = source.name.replace(/_[Vv]\d\d$/, "_V" + (next < 10 ? "0" + next : String(next)));
  } else {
    newName = source.name + "_V01";
  }

  const width = source.width;
  const height = source.height;
  const frameRate = source.frameRate;
  const format = width / height > 1.2 ? "Landscape" : "Portrait";
  const wantedName = format + "_Frontcard";

  const imported = app.project.importFile(
    new ImportOptions(new File(format === "Landscape" ? FRONTCARD_LANDSCAPE_TEMPLATE : FRONTCARD_PORTRAIT_TEMPLATE))
  ) as unknown as Item;

  let frontcardItem: AVItem | null = null;
  if (imported) {
    if (typeof (imported as any).numItems === "number") {
      frontcardItem = frontcardFindInFolder(imported as FolderItem, wantedName);
    } else if (imported.name === wantedName) {
      frontcardItem = imported as AVItem;
    }
  }
  if (!frontcardItem) {
    for (let i = 1; i <= app.project.numItems; i++) {
      const item = app.project.item(i);
      if (item.name === wantedName) { frontcardItem = item as AVItem; break; }
    }
  }

  const newComp = app.project.items.addComp(
    newName, width, height, 1, source.duration + FRONTCARD_LEAD_IN_SECONDS, frameRate
  );
  newComp.parentFolder = source.parentFolder;
  newComp.label = FRONTCARD_LABEL_RED;

  const compLayer = newComp.layers.add(source);
  const frameDuration = 1 / frameRate;
  compLayer.startTime = Math.round(FRONTCARD_LEAD_IN_SECONDS / frameDuration) * frameDuration;

  if (frontcardItem) newComp.layers.add(frontcardItem);
  return { comp: newComp, frontcardItem: frontcardItem };
}

export const frontcard = (): Result => {
  // Resolve the source comp BEFORE opening an undo group, so the early-out
  // paths never leave one dangling.
  let source: CompItem | null = null;
  const activeItem = app.project.activeItem;
  if (activeItem instanceof CompItem) {
    source = activeItem;
  } else {
    // Fall back to whatever is selected in the Project panel -- clicking a
    // panel button can leave no active viewer item.
    const selection = app.project.selection;
    for (let i = 0; i < selection.length; i++) {
      if (selection[i] instanceof CompItem) {
        source = selection[i] as CompItem;
        break;
      }
    }
  }
  if (!source) return { success: false, error: "Select or open a composition first." };

  try {
    app.beginUndoGroup("XYi Frontcard");

    // The wrap itself lives in frontcardWrap so Bespoke produces the identical
    // structure -- see the note there.
    const wrapped = frontcardWrap(source);
    const newComp = wrapped.comp;
    const frontcardItem = wrapped.frontcardItem;
    const format = source.width / source.height > 1.2 ? "Landscape" : "Portrait";
    const wantedName = format + "_Frontcard";

    newComp.openInViewer();
    newComp.selected = true;

    app.endUndoGroup();
    return frontcardItem
      ? { success: true }
      : { success: false, error: 'Comp created, but no "' + wantedName + '" was found in the template.' };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Cheeky T Check -- ported from XYi_Toolbox.jsx's cheekyTCheck() (wired to
// the "Cheeky T Check" button), which itself calls DT_Check() from
// toolset/XYi_Cheeky_DT_Check.jsx with fixed flags. That file in turn
// depends on toolset/XYi_Cheeky_N_Check.jsx (filename parsing) and
// toolset/XYi_Cheeky_TT_Check.jsx (territory-code lookup) -- all three
// ported together here as cheekyDTCheck() + its two helpers, since they
// only make sense as one unit.
//
// This reaches into a "Frontcard" precomp by hardcoded numeric layer
// indices, branching on which of two known template variants is present
// (detected by a specific logo PNG layer name) -- this is a direct, faithful
// port of that exact indexing, not something verifiable without a real
// Frontcard-based project. Test carefully on a real one before relying on
// it.
// =============================================================================
interface FilenameMeta {
  filmTitle: string;
  artworkType: string;
  /** What sits LEFT of the artwork type -- the creative. */
  campaign: string;
  /** What sits RIGHT of it -- the site, never shown on the frontcard. */
  siteName: string;
  size: string;
  duration: string;
  territory: string;
  version: string;
  region: string;
}

/**
 * The size token, and ONLY when it is a token.
 *
 * `/(\d+x\d+)/` takes the first match in the string, and a site name can
 * contain that shape: FID_INTL_TVSpot_DOOH_Hoyts3x3_1920x1080_30s_NZ_V01.mov
 * parsed as 3x3, which is a real deliverable and it failed the import of every
 * component selected with it. A grid, a wall, a bank of screens -- "3x3",
 * "4x3", "2x2" -- all read as resolutions.
 *
 * sanitiseSiteToken defuses this when the toolbox WRITES a name, but names
 * already on disk were written by people, so the readers have to hold their end
 * up too. Delimited first: a size sits between underscores or at either end of
 * the name, while a collision is welded to letters. The loose match is kept as
 * a fallback so nothing that parsed before stops parsing now.
 */
export function firstSizeToken(name: string): string {
  // THREE DIGITS EACH SIDE, because that is the whole difference between a
  // SIZE and a RATIO. JPG_PNG writes an aspect-ratio token that AE does not --
  // "..._Metrobus_9x16_1080x1920px_10s_FR" -- and it is delimited exactly like
  // a size, so the old /(\d+x\d+)/ took "9x16" and every reader downstream
  // compared it against a real 1080x1920 and found nothing. Real pixel sizes
  // are three digits and up (3552x128 is the smallest in the tree), so the
  // digit count separates them cleanly; this is the same test as artwork.ts's
  // isRatioToken, applied on the reading side.
  const delimited = String(name || "").match(/(?:^|_)(\d{3,}x\d{3,})(?:px)?(?=_|\.|$)/i);
  if (delimited) return delimited[1];
  const loose = String(name || "").match(/(\d+x\d+)(?:px)?/i);
  return loose ? loose[1] : "";
}

export function parseFilenameMeta(name: string): FilenameMeta {
  const artworkTypes = ["DOOH", "DFOH", "DINTH", "FOH"];
  const regDur = /(\d+)s(?:ec)?/;
  const regTerPart = /_([A-Z]{2})(?:_|$)/;
  const regVPart = /(V\d+)/;

  let filmTitle = "";
  let artworkType = "";
  let campaign = "";
  let size = "";
  let duration = "";
  let territory = "";
  let version = "";
  let region = "";
  let siteName = "";

  const regionMatch = name.match(/_(INTL|DOM)_/);
  if (regionMatch && regionMatch.index !== undefined) {
    region = regionMatch[1];
    filmTitle = name.substring(0, regionMatch.index);
  }

  size = firstSizeToken(name);

  const durMatch = name.match(regDur);
  if (durMatch) duration = durMatch[1] + "sec";

  const terMatch = name.match(regTerPart);
  if (terMatch) territory = terMatch[1];

  const verMatch = name.match(regVPart);
  if (verMatch) version = verMatch[1];

  // `size` rather than a match object: the size is read by firstSizeToken now,
  // and indexOf finds the same place whether or not a px follows it.
  if (regionMatch && regionMatch.index !== undefined && size) {
    let startOfDesc = regionMatch.index + regionMatch[0].length;
    const dgtlMarker = "_DGTL_";
    const dgtlIndex = name.indexOf(dgtlMarker, regionMatch.index);
    if (dgtlIndex !== -1) startOfDesc = dgtlIndex + dgtlMarker.length;

    const endOfDesc = name.indexOf("_" + size);

    if (endOfDesc > startOfDesc) {
      const middlePart = name.substring(startOfDesc, endOfDesc);
      const allMiddleParts = middlePart.split("_");
      const middleParts: string[] = [];
      for (let i = 0; i < allMiddleParts.length; i++) {
        if (allMiddleParts[i] !== "") middleParts.push(allMiddleParts[i]);
      }
      let artworkIndex = -1;
      for (let j = 0; j < middleParts.length; j++) {
        let isArtwork = false;
        for (let k = 0; k < artworkTypes.length; k++) {
          if (middleParts[j].toUpperCase() === artworkTypes[k]) {
            isArtwork = true;
            break;
          }
        }
        if (isArtwork) {
          artworkIndex = j;
          break;
        }
      }
      // CAMPAIGN IS WHAT SITS LEFT OF THE ARTWORK TYPE. Everything to its
      // RIGHT is the site name (MotionPoster, INTHDS, BioRexTripla), which is
      // never shown on the frontcard. This used to drop the artwork token and
      // join whatever was left, so a name like
      // MultipleArt_DINTH_MotionPoster gave a campaign of
      // "MultipleArt_MotionPoster" -- the site glued onto the creative, long
      // enough to overflow the frontcard's campaign line.
      if (artworkIndex !== -1) {
        artworkType = middleParts[artworkIndex];
        const left: string[] = [];
        const right: string[] = [];
        for (let m = 0; m < middleParts.length; m++) {
          if (m < artworkIndex) left.push(middleParts[m]);
          else if (m > artworkIndex) right.push(middleParts[m]);
        }
        campaign = left.join("_");
        siteName = right.join("_");
      } else {
        // No recognised artwork type: keep the old behaviour rather than
        // guessing where the split would have been.
        campaign = middleParts.join("_");
      }
    }
  }

  return { filmTitle, artworkType, campaign, siteName, size, duration, territory, version, region };
}

/**
 * "MultipleArt" -> "Multiple Art". Filenames run the creative together in
 * CamelCase; the frontcard shows it as words. The text layer applies All Caps
 * itself, so "PortalToParadise" -> "Portal To Paradise" renders correctly as
 * PORTAL TO PARADISE. An all-caps token (INTHDS) is left alone.
 */
export function campaignWords(token: string): string {
  return String(token).split("_").join(" ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export const TC_COUNTRIES: { name: string; code: string }[] = [
  { name: "Afghanistan", code: "AF" }, { name: "Åland Islands", code: "AX" }, { name: "Albania", code: "AL" },
  { name: "Algeria", code: "DZ" }, { name: "American Samoa", code: "AS" }, { name: "Andorra", code: "AD" },
  { name: "Angola", code: "AO" }, { name: "Anguilla", code: "AI" }, { name: "Antarctica", code: "AQ" },
  { name: "Antigua and Barbuda", code: "AG" }, { name: "Argentina", code: "AR" }, { name: "Armenia", code: "AM" },
  { name: "Aruba", code: "AW" }, { name: "Australia", code: "AU" }, { name: "Austria", code: "AT" },
  { name: "Azerbaijan", code: "AZ" }, { name: "Bahamas", code: "BS" }, { name: "Bahrain", code: "BH" },
  { name: "Bangladesh", code: "BD" }, { name: "Barbados", code: "BB" }, { name: "Belarus", code: "BY" },
  { name: "Belgium", code: "BE" }, { name: "Belgium French", code: "BE_FR" }, { name: "Belgium German", code: "BE_DE" },
  { name: "Belize", code: "BZ" }, { name: "Benin", code: "BJ" },
  { name: "Bermuda", code: "BM" }, { name: "Bhutan", code: "BT" }, { name: "Bolivia (Plurinational State of)", code: "BO" },
  { name: "Bonaire, Sint Eustatius and Saba", code: "BQ" }, { name: "Bosnia and Herzegovina", code: "BA" }, { name: "Botswana", code: "BW" },
  { name: "Bouvet Island", code: "BV" }, { name: "Brazil", code: "BR" }, { name: "British Indian Ocean Territory", code: "IO" },
  { name: "Brunei Darussalam", code: "BN" }, { name: "Bulgaria", code: "BG" }, { name: "Burkina Faso", code: "BF" },
  { name: "Burundi", code: "BI" }, { name: "Cabo Verde", code: "CV" }, { name: "Cambodia", code: "KH" },
  { name: "Cameroon", code: "CM" }, { name: "Canada", code: "CA" }, { name: "Cayman Islands", code: "KY" },
  { name: "Central African Republic", code: "CF" }, { name: "Chad", code: "TD" }, { name: "Chile", code: "CL" },
  { name: "China", code: "CN" }, { name: "Christmas Island", code: "CX" }, { name: "Cocos (Keeling) Islands", code: "CC" },
  { name: "Colombia", code: "CO" }, { name: "Comoros", code: "KM" }, { name: "Congo", code: "CG" },
  { name: "Congo (Democratic Republic of the)", code: "CD" }, { name: "Cook Islands", code: "CK" }, { name: "Costa Rica", code: "CR" },
  { name: "Côte d'Ivoire", code: "CI" }, { name: "Croatia", code: "HR" }, { name: "Cuba", code: "CU" },
  { name: "Curaçao", code: "CW" }, { name: "Cyprus", code: "CY" }, { name: "Czech Republic", code: "CZ" },
  { name: "Denmark", code: "DK" }, { name: "Djibouti", code: "DJ" }, { name: "Dominica", code: "DM" },
  { name: "Dominican Republic", code: "DO" }, { name: "Ecuador", code: "EC" }, { name: "Egypt", code: "EG" },
  { name: "El Salvador", code: "SV" }, { name: "Equatorial Guinea", code: "GQ" }, { name: "Eritrea", code: "ER" },
  { name: "Estonia", code: "EE" }, { name: "Eswatini", code: "SZ" }, { name: "Ethiopia", code: "ET" },
  { name: "Falkland Islands (Malvinas)", code: "FK" }, { name: "Faroe Islands", code: "FO" }, { name: "Fiji", code: "FJ" },
  { name: "Finland", code: "FI" }, { name: "France", code: "FR" }, { name: "French Guiana", code: "GF" },
  { name: "French Polynesia", code: "PF" }, { name: "French Southern Territories", code: "TF" }, { name: "Gabon", code: "GA" },
  { name: "Gambia", code: "GM" }, { name: "Georgia", code: "GE" }, { name: "Germany", code: "DE" },
  { name: "Ghana", code: "GH" }, { name: "Gibraltar", code: "GI" }, { name: "Greece", code: "GR" },
  { name: "Greenland", code: "GL" }, { name: "Grenada", code: "GD" }, { name: "Guadeloupe", code: "GP" },
  { name: "Guam", code: "GU" }, { name: "Guatemala", code: "GT" }, { name: "Guernsey", code: "GG" },
  { name: "Guinea", code: "GN" }, { name: "Guinea-Bissau", code: "GW" }, { name: "Guyana", code: "GY" },
  { name: "Haiti", code: "HT" }, { name: "Heard Island and McDonald Islands", code: "HM" }, { name: "Holy See", code: "VA" },
  { name: "Honduras", code: "HN" }, { name: "Hong Kong", code: "HK" }, { name: "Hungary", code: "HU" },
  { name: "Iceland", code: "IS" }, { name: "India", code: "IN" }, { name: "Indonesia", code: "ID" },
  { name: "Iran (Islamic Republic of)", code: "IR" }, { name: "Iraq", code: "IQ" }, { name: "Ireland", code: "IE" },
  { name: "Isle of Man", code: "IM" }, { name: "Israel", code: "IL" }, { name: "Italy", code: "IT" },
  { name: "Jamaica", code: "JM" }, { name: "Japan", code: "JP" }, { name: "Jersey", code: "JE" },
  { name: "Jordan", code: "JO" }, { name: "Kazakhstan", code: "KZ" }, { name: "Kenya", code: "KE" },
  { name: "Kiribati", code: "KI" }, { name: "Korea (Democratic People's Republic of)", code: "KP" }, { name: "Korea (Republic of)", code: "KR" },
  { name: "South Korea", code: "KR" },
  { name: "Kuwait", code: "KW" }, { name: "Kyrgyzstan", code: "KG" }, { name: "Lao People's Democratic Republic", code: "LA" },
  { name: "Latvia", code: "LV" }, { name: "Lebanon", code: "LB" }, { name: "Lesotho", code: "LS" },
  { name: "Liberia", code: "LR" }, { name: "Libya", code: "LY" }, { name: "Liechtenstein", code: "LI" },
  { name: "Lithuania", code: "LT" }, { name: "Luxembourg", code: "LU" }, { name: "Macao", code: "MO" },
  { name: "Madagascar", code: "MG" }, { name: "Malawi", code: "MW" }, { name: "Malaysia", code: "MY" },
  { name: "Maldives", code: "MV" }, { name: "Mali", code: "ML" }, { name: "Malta", code: "MT" },
  { name: "Marshall Islands", code: "MH" }, { name: "Master OV", code: "OV" }, { name: "OV", code: "OV" }, { name: "Martinique", code: "MQ" },
  { name: "Mauritania", code: "MR" }, { name: "Mauritius", code: "MU" }, { name: "Mayotte", code: "YT" },
  { name: "Mexico", code: "MX" }, { name: "Micronesia (Federated States of)", code: "FM" }, { name: "Moldova (Republic of)", code: "MD" },
  { name: "Monaco", code: "MC" }, { name: "Mongolia", code: "MN" }, { name: "Montenegro", code: "ME" },
  { name: "Montserrat", code: "MS" }, { name: "Morocco", code: "MA" }, { name: "Mozambique", code: "MZ" },
  { name: "Myanmar", code: "MM" }, { name: "Namibia", code: "NA" }, { name: "Nauru", code: "NR" },
  { name: "Nepal", code: "NP" }, { name: "Netherlands", code: "NL" }, { name: "New Caledonia", code: "NC" },
  { name: "New Zealand", code: "NZ" }, { name: "Nicaragua", code: "NI" }, { name: "Niger", code: "NE" },
  { name: "Nigeria", code: "NG" }, { name: "Niue", code: "NU" }, { name: "Norfolk Island", code: "NF" },
  { name: "North Macedonia", code: "MK" }, { name: "Northern Mariana Islands", code: "MP" }, { name: "Norway", code: "NO" },
  { name: "Oman", code: "OM" }, { name: "Pakistan", code: "PK" }, { name: "Palau", code: "PW" },
  { name: "Palestine, State of", code: "PS" }, { name: "Panama", code: "PA" }, { name: "Papua New Guinea", code: "PG" },
  { name: "Paraguay", code: "PY" }, { name: "Peru", code: "PE" }, { name: "Philippines", code: "PH" },
  { name: "Pitcairn", code: "PN" }, { name: "Poland", code: "PL" }, { name: "Portugal", code: "PT" },
  { name: "Puerto Rico", code: "PR" }, { name: "Qatar", code: "QA" }, { name: "Réunion", code: "RE" },
  { name: "Romania", code: "RO" }, { name: "Russian Federation", code: "RU" }, { name: "Rwanda", code: "RW" },
  { name: "Saint Barthélemy", code: "BL" }, { name: "Saint Helena, Ascension and Tristan da Cunha", code: "SH" }, { name: "Saint Kitts and Nevis", code: "KN" },
  { name: "Saint Lucia", code: "LC" }, { name: "Saint Martin (French part)", code: "MF" }, { name: "Saint Pierre and Miquelon", code: "PM" },
  { name: "Saint Vincent and the Grenadines", code: "VC" }, { name: "Samoa", code: "WS" }, { name: "San Marino", code: "SM" },
  { name: "Sao Tome and Principe", code: "ST" }, { name: "Saudi Arabia", code: "SA" }, { name: "Senegal", code: "SN" },
  { name: "Serbia", code: "RS" }, { name: "Seychelles", code: "SC" }, { name: "Sierra Leone", code: "SL" },
  { name: "Singapore", code: "SG" }, { name: "Sint Maarten (Dutch part)", code: "SX" }, { name: "Slovakia", code: "SK" },
  { name: "Slovenia", code: "SI" }, { name: "Solomon Islands", code: "SB" }, { name: "Somalia", code: "SO" },
  { name: "South Africa", code: "ZA" }, { name: "South Georgia and the South Sandwich Islands", code: "GS" }, { name: "South Sudan", code: "SS" },
  { name: "Spain", code: "ES" }, { name: "Sri Lanka", code: "LK" }, { name: "Sudan", code: "SD" },
  { name: "Suriname", code: "SR" }, { name: "Svalbard and Jan Mayen", code: "SJ" }, { name: "Sweden", code: "SE" },
  { name: "Switzerland", code: "CH" }, { name: "Switzerland Italy", code: "CH_IT" }, { name: "Switzerland French", code: "CH_FR" },
  { name: "Switzerland German", code: "CH_DE" }, { name: "Syrian Arab Republic", code: "SY" }, { name: "Taiwan", code: "TW" },
  { name: "Tajikistan", code: "TJ" }, { name: "Tanzania, United Republic of", code: "TZ" }, { name: "Thailand", code: "TH" },
  { name: "Timor-Leste", code: "TL" }, { name: "Togo", code: "TG" }, { name: "Tokelau", code: "TK" },
  { name: "Tonga", code: "TO" }, { name: "Trinidad and Tobago", code: "TT" }, { name: "Tunisia", code: "TN" },
  { name: "Turkey", code: "TR" }, { name: "Turkmenistan", code: "TM" }, { name: "Turks and Caicos Islands", code: "TC" },
  { name: "Tuvalu", code: "TV" }, { name: "Uganda", code: "UG" }, { name: "Ukraine", code: "UA" },
  { name: "United Arab Emirates", code: "AE" },
  { name: "United Kingdom of Great Britain and Northern Ireland", code: "UK" }, { name: "Britain", code: "UK" }, { name: "UK", code: "UK" },
  { name: "USA", code: "DOM" }, { name: "United States of America", code: "DOM" },
  { name: "United States Minor Outlying Islands", code: "UM" }, { name: "Uruguay", code: "UY" }, { name: "Uzbekistan", code: "UZ" },
  { name: "Vanuatu", code: "VU" }, { name: "Venezuela (Bolivarian Republic of)", code: "VE" }, { name: "Vietnam", code: "VN" },
  { name: "Virgin Islands (British)", code: "VG" }, { name: "Virgin Islands (U.S.)", code: "VI" }, { name: "Wallis and Futuna", code: "WF" },
  { name: "Western Sahara", code: "EH" }, { name: "Yemen", code: "YE" }, { name: "Zambia", code: "ZM" },
  { name: "Zimbabwe", code: "ZW" },
];

/** Lowercase, and treat _ - and spaces as the same separator on BOTH sides. */
function tcNormalise(s: string): string {
  return String(s).toLowerCase().replace(/[_\-\s]+/g, " ").replace(/^ +/, "").replace(/ +$/, "");
}

// Exported so CSV Localiser can canonicalise a Wrike territory code and a
// markets FOLDER NAME through the same resolver, rather than inventing a second
// answer to "which country is this". Everything below -- exact code, then exact
// name, then a length-guarded substring -- is the fix that stopped "DE" hitting
// BE_DE; a caller reimplementing any of it would reintroduce it.
export function territoryCheck(input: string): string | null {
  const want = tcNormalise(input);
  if (want === "") return null;

  // EXACT CODE FIRST, and this is the whole fix.
  //
  // This used to be a substring test in the OTHER direction -- "does any code
  // CONTAIN the input" -- walking the table in order. So "DE" hit `BE_DE`
  // (Belgium German), which sits two hundred entries before Germany, and "FR"
  // hit `BE_FR` before ever reaching France. A German batch went out with
  // BELGIUM GERMAN burnt into its frontcard, and France was wrong the same way
  // the whole time without anybody noticing.
  //
  // The compound codes were broken too, in the opposite direction: the input
  // had `_` normalised to a space but the code side did not, so "BE_DE" and
  // all three CH_* codes matched nothing at all and returned null.
  for (let i = 0; i < TC_COUNTRIES.length; i++) {
    if (tcNormalise(TC_COUNTRIES[i].code) === want) return TC_COUNTRIES[i].name;
  }
  for (let i = 0; i < TC_COUNTRIES.length; i++) {
    if (tcNormalise(TC_COUNTRIES[i].name) === want) return TC_COUNTRIES[i].name;
  }

  // Messy real-world folder names ("Germany (DE)") still resolve, but only
  // against the NAME and only when the input is long enough that a two-letter
  // code cannot collide -- which is exactly what went wrong above.
  //
  // indexOf, never .match(): this input comes from real folder and file names,
  // and .match() would compile "APAC (ex. China)" as a regex and throw.
  if (want.length >= 4) {
    for (let i = 0; i < TC_COUNTRIES.length; i++) {
      if (tcNormalise(TC_COUNTRIES[i].name).indexOf(want) !== -1) return TC_COUNTRIES[i].name;
    }
  }
  return null;
}


/** The most of the frame a title box may grow to occupy. */
const FRONTCARD_BOX_MAX = 0.9;

/**
 * The width the title actually draws at, on one line.
 *
 * MEASURED ON A DUPLICATE OF THE LAYER ITSELF, not on a synthetic probe built
 * from a few copied attributes. That probe was the bug: it carried font, size
 * and tracking across and nothing else, so it missed that the brand template's
 * title layer has ALL CAPS on. The layer holds "Forgotten Island" and the card
 * draws FORGOTTEN ISLAND, and capitals are wider -- measured on the real card,
 * 730.4px as stored against 950.7px as drawn, a 28% under-count. The fit
 * compared 730 to a 918px box, found room to spare, grew nothing, and the
 * title wrapped into a box one line tall. The card read FORGOTTEN.
 *
 * Copying allCaps onto a probe is not available as a fix: allCaps and boxText
 * are both READ-ONLY on TextDocument (AE 2026 refuses the assignment outright).
 * Uppercasing the probe's string gets closer -- 936.6px -- and is still 14px
 * short, because a probe has no trailing tracking and different side bearings.
 * At tracking 80 that is two characters' worth, and the whole margin between
 * fitting and wrapping here was 40px.
 *
 * A duplicate carries every one of those attributes by construction, so there
 * is nothing left to model. boxTextSize IS writable, which is what makes this
 * possible: widen the copy past any width it could need, ask AE how wide the
 * text came out, throw the copy away.
 */
function measureUnwrapped(layer: Layer, doc: TextDocument, comp: CompItem): { w: number; h: number } | null {
  if (!comp || !comp.width) return null;
  if (!doc || !doc.boxTextSize) return null;
  let dup: Layer | null = null;
  try {
    dup = layer.duplicate();
    if (!dup) return null;
    const dprop = dup.property("Source Text") as Property;
    if (!dprop) return null;
    const ddoc = dprop.value as TextDocument;
    if (!ddoc) return null;
    // Room it cannot possibly need, so what comes back is the title on one
    // line. Four frames wide rather than the 0.9 cap: the cap is what the box
    // is ALLOWED to grow to, and measuring inside it would wrap exactly the
    // titles this exists to catch.
    ddoc.boxTextSize = [comp.width * 4, doc.boxTextSize[1]];
    dprop.setValue(ddoc);
    const rect = (dup as AVLayer).sourceRectAtTime(0, false);
    if (!rect || !rect.width || !rect.height) return null;
    return { w: rect.width, h: rect.height };
  } catch (e) {
    return null;
  } finally {
    // MUST come off. It sits above the original, so a duplicate left behind
    // shifts every layer index below it -- and the caller writes the artwork,
    // version and territory fields BY INDEX straight after this returns.
    try { if (dup) dup.remove(); } catch (e) { /* nothing left to remove */ }
  }
}

/**
 * Makes a BOX text layer's title fit -- by WIDENING THE BOX FIRST, and only
 * shrinking the type if the box has run out of frame to grow into.
 *
 * The brand template's title is box text sized for a short film name, so
 * "Forgotten Island" wrapped and the second word fell outside -- the card read
 * FORGOTTEN. Nothing warned, because a text layer that overflows its box still
 * renders perfectly happily.
 *
 * IT READ FORGOTTEN A SECOND TIME after this existed, because the measurement
 * ignored the layer's All Caps: see measureUnwrapped. The arithmetic here was
 * never wrong -- it was being handed a width 28% short of what AE would draw.
 *
 * SHRINKING WAS THE WRONG FIRST MOVE. It was all this did, and what artists
 * actually did by hand was drag the box wider and recentre it -- because the
 * type size is the designer's decision and the box is just the container it
 * was given. A title set two points smaller than every other card in the
 * campaign is a subtle inconsistency nobody catches; a wider box is invisible.
 * So: grow, recentre, and only then shrink.
 *
 * MEASURED, NOT PROBED-AND-STEPPED. This used to grow the box in steps and ask
 * after each one whether the layer still overflowed -- a question box text does
 * not answer, so the loop exited on its first pass and the box never moved. One
 * measurement of what the title actually wants gives the answer outright, and
 * the arithmetic below is the whole decision. See measureUnwrapped for why that
 * measurement has to be taken on the layer rather than modelled from it.
 *
 * THE BOX GROWS ABOUT ITS OWN CENTRE. boxTextPos is the box's TOP-LEFT, so
 * widening alone would push the text right rather than out both ways -- the
 * layer would fit and sit off-centre, which is worse than overflowing because
 * it looks deliberate.
 *
 * Bounded by the comp, not by taste: it will not widen past FRONTCARD_BOX_MAX
 * of the frame.
 */
function fitFrontcardText(layer: Layer, time: number): string {
  try {
    const prop = layer.property("Source Text") as Property;
    if (!prop) return "";
    const doc = prop.value as TextDocument;
    if (!doc || !doc.boxText) return "";

    const startWidth = doc.boxTextSize[0];
    const boxHeight = doc.boxTextSize[1];
    const startSize = doc.fontSize;
    if (!startWidth || !boxHeight || !startSize) return "";

    let comp: CompItem | null = null;
    try {
      comp = (layer as AVLayer).containingComp;
    } catch (e) {
      comp = null;
    }
    if (!comp || !comp.width) return "";
    const maxWidth = comp.width * FRONTCARD_BOX_MAX;

    const line = measureUnwrapped(layer, doc, comp);
    if (!line) return "";

    // HOW MANY LINES THE BOX CAN SHOW, which is the difference between a title
    // that must fit on one line and one the designer built a two-line box for.
    let lines = Math.floor(boxHeight / line.h + 0.01);
    if (lines < 1) lines = 1;

    // What the title needs. One line is the real case and is exact, plus a
    // hair so the last glyph is not resting on the box edge. A taller box is
    // an APPROXIMATION -- wrapping never divides evenly, so it asks for a fifth
    // more than the even split rather than pretending to know where the break
    // lands.
    // AE needs a shade more box than the ink it draws -- bisected on the real
    // card, the narrowest box that does not wrap is the ink width + 8.5px
    // (0.89%). 3% clears that with room for a longer title's larger absolute
    // slack, and is nowhere near the 0.9-of-frame cap.
    const pad = Math.max(8, line.w * 0.03);
    let need = line.w + pad;
    if (lines > 1) need = (line.w / lines) * 1.2;

    let endWidth = startWidth;
    if (need > startWidth) {
      const grown = Math.min(maxWidth, Math.ceil(need));
      const delta = grown - startWidth;
      if (delta > 0) {
        try {
          const next = prop.value as TextDocument;
          const pos = next.boxTextPos;
          next.boxTextSize = [grown, boxHeight];
          // Half the growth taken off the left edge, so the box expands about
          // its centre instead of only rightwards.
          next.boxTextPos = [pos[0] - delta / 2, pos[1]];
          prop.setValue(next);
          endWidth = grown;
        } catch (e) {
          // boxTextPos/boxTextSize not writable on this host: leave the box
          // alone rather than grown but shifted off-centre.
        }
      }
    }

    // ONLY NOW, SHRINK, and only when the cap genuinely cannot hold the title.
    // Scaled in one step rather than stepped down two points at a time: the
    // measurement is linear in font size, so the right size is arithmetic.
    let endSize = startSize;
    if (need > maxWidth) {
      const scaled = Math.floor(startSize * (maxWidth / need));
      let wanted = scaled;
      if (wanted < 10) wanted = 10;
      if (wanted < startSize) {
        try {
          const next = prop.value as TextDocument;
          next.fontSize = wanted;
          prop.setValue(next);
          endSize = wanted;
        } catch (e) {
          // Type size refused: the box is still wider than it was.
        }
      }
    }

    const notes: string[] = [];
    if (endWidth > startWidth) {
      notes.push("box widened from " + Math.round(startWidth) + "px to " + Math.round(endWidth) + "px and recentred");
    }
    if (endSize < startSize) {
      // SAID SEPARATELY, and second, because it is the compromise. A card whose
      // type no longer matches its siblings is worth a human look.
      notes.push("type shrunk from " + startSize + "pt to " + endSize + "pt -- it would not fit even at full width");
    }
    return notes.join("; ");
  } catch (e) {
    return "";
  }
}

function frontcardLayerTextIndices(variantA: boolean) {
  return variantA
    ? { title: 8, artwork: 7, version: 6, campaignLine: 5, territory: 4, date: 3 }
    : { title: 16, artwork: 15, version: 14, campaignLine: 13, territory: 12, date: 11 };
}

// =============================================================================
// FRONTCARD TERRITORY -- candidate-and-validate, not one regex.
//
// parseFilenameMeta's /_([A-Z]{2})(?:_|$)/ takes the FIRST two-letter token in
// the whole name, which goes wrong three different ways on real files:
//   _15s_BE_DE   -> "BE"  (Belgium, on a Belgium GERMAN asset)
//   _15s_DOM     -> ""    (three letters never match)
//   _HD_..._IT   -> "HD"  (a stray token upstream wins)
// It is also not simply "the last token": real names end _DE_V02, with the
// version AFTER the territory.
//
// So: strip a trailing version, then try candidates longest-first and keep the
// first one that RESOLVES against TC_COUNTRIES. Validation is what makes this
// safe -- a compound guess that isn't a real territory falls through instead of
// being stamped on a deliverable.
export function frontcardTerritory(name: string): { token: string; name: string | null } {
  let base = String(name);
  // Trailing version token: "..._DE_V02" -> "..._DE".
  const vTail = base.match(/_V\d+$/);
  if (vTail) base = base.substring(0, base.length - vTail[0].length);

  const candidates: string[] = [];
  const compound = base.match(/_([A-Z]{2}_[A-Z]{2})$/);
  if (compound) candidates.push(compound[1]);
  const tail = base.match(/_([A-Z]{2,3})$/);
  if (tail) candidates.push(tail[1]);
  // Last resort: the old first-match behaviour, so a name shaped unlike any of
  // the above still gets whatever it used to get rather than nothing.
  const legacy = base.match(/_([A-Z]{2})(?:_|$)/);
  if (legacy) candidates.push(legacy[1]);

  for (let i = 0; i < candidates.length; i++) {
    const resolved = territoryCheck(candidates[i]);
    if (resolved) return { token: candidates[i], name: resolved };
  }
  return { token: candidates.length ? candidates[0] : "", name: null };
}

interface FrontcardTarget {
  source: CompItem;
  idx: { title: number; artwork: number; version: number; campaignLine: number; territory: number; date: number };
}

/** Every Frontcard precomp in `comp`, with its resolved layer-index map. */
function frontcardTargets(comp: CompItem): FrontcardTarget[] {
  const out: FrontcardTarget[] = [];
  for (let i = 1; i <= comp.numLayers; i++) {
    const layer = comp.layer(i);
    // indexOf, not .match() -- deliver.ts already identifies frontcards this
    // way and a layer name is not a regex.
    if (String(layer.name).indexOf("Frontcard") === -1) continue;
    const source = (layer as AVLayer).source as CompItem;
    if (!source || typeof source.numLayers !== "number") continue;
    const variantA = source.layer(2).name === "XYi_Logo_V20_[0000-0250].png";
    out.push({ source: source, idx: frontcardLayerTextIndices(variantA) });
  }
  return out;
}

/**
 * The brand template's own unfilled title, as it ships.
 *
 * Kept here rather than in the panel because every other fact about the
 * template's text layers lives on this side, and a second copy in the React
 * code is one more thing to forget when the template changes.
 */
const FRONTCARD_TITLE_PLACEHOLDERS = ["film title", "title", "campaign title"];

function isFrontcardTitlePlaceholder(current: string): boolean {
  const v = String(current == null ? "" : current).replace(/^\s+|\s+$/g, "").toLowerCase();
  if (v === "") return true;
  for (let i = 0; i < FRONTCARD_TITLE_PLACEHOLDERS.length; i++) {
    if (v === FRONTCARD_TITLE_PLACEHOLDERS[i]) return true;
  }
  return false;
}

function frontcardSet(target: FrontcardTarget, which: string, value: string): string {
  const idx = (target.idx as any)[which];
  if (!idx) return "";
  const layer = target.source.layer(idx);
  if (!layer) return "";
  const prop = layer.property("Source Text") as Property;
  if (!prop) return "";
  prop.setValue(String(value));
  // THE FIT BELONGS HERE, not at the call sites. Cheeky T fitted its title and
  // Cheeky DT did not, so typing a real name into the panel overflowed the box
  // and had to be dragged wider by hand -- the same card, the same layer, two
  // different behaviours depending on which button wrote it. Doing it inside
  // the setter means every write path gets it, including any added later.
  if (which === "title") return fitFrontcardText(layer, 0);
  return "";
}

// =============================================================================
// FRONTCARD FIELDS -- read what's on the card, write only what was edited.
//
// Cheeky DT's checkboxes only ever said WHICH fields to re-derive from the
// filename; there was no way to say what to write. These two calls back the
// live-editing version: read gives the panel what the card currently says (plus
// what the name would give), write takes only the fields a human touched.
// =============================================================================

// EVERY inch mark the cards actually use. Real frontcards are authored with the
// TYPOGRAPHIC "  (U+201D), not the ASCII one, so a straight-quote-only test left
// the duration welded to the campaign: "Trio 15" came back as campaign "Trio 15"
// with a blank duration, which is what put a duration in the campaign field.
const INCH_MARKS = "\"\u201C\u201D\u2033\u0027\u2018\u2019\u2032";

function stripInch(v: string): string {
  const t = String(v);
  if (!t.length) return t;
  return INCH_MARKS.indexOf(t.charAt(t.length - 1)) !== -1 ? t.substring(0, t.length - 1) : t;
}

/**
 * The inch mark THIS card already uses, so writing never silently swaps it.
 *
 * The original tool took the line's last character and put it back verbatim --
 * deliberately, because the studio's cards are not all authored with the same
 * glyph. Hardcoding one would rewrite every card it touched.
 */
function inchMarkOf(line: string, fallback: string): string {
  const t = String(line);
  if (!t.length) return fallback;
  const last = t.charAt(t.length - 1);
  return INCH_MARKS.indexOf(last) !== -1 ? last : fallback;
}

function readText(target: FrontcardTarget, which: string): string {
  const idx = (target.idx as any)[which];
  if (!idx) return "";
  const layer = target.source.layer(idx);
  if (!layer) return "";
  const prop = layer.property("Source Text") as Property;
  if (!prop) return "";
  return String(prop.value);
}

/**
 * Splits "MULTIPLE ART 15\"" back into campaign and duration.
 *
 * This is the same guess the old code made, and it is still a guess -- but it
 * is now only a PREFILL that a human sees and can correct, never a value
 * written back unseen. The old version used the guessed fragment as a split
 * delimiter and silently truncated any campaign containing the duration digits.
 */
function splitCampaignLine(line: string): { campaign: string; duration: string } {
  const raw = String(line);
  // THE MARK IS NEVER PART OF THE CAMPAIGN. Both bail-outs below used to hand
  // the raw line back, mark and all -- and the caller appends a mark of its own,
  // so every run on a line this could not parse added another one. A card left
  // reading `Multiple Art ”` grew `Multiple Art ” ”` on the next pass, then
  // another, and each looked like a successful update.
  const bail = (): { campaign: string; duration: string } => ({
    campaign: stripInch(raw).replace(/\s+$/, ""),
    duration: "",
  });
  const parts = raw.split(" ");
  if (parts.length < 2) return bail();
  const last = stripInch(parts[parts.length - 1]);
  // Only treat the last token as a duration if it actually looks like one.
  let numeric = last.length > 0;
  for (let i = 0; i < last.length; i++) {
    const c = last.charAt(i);
    if (c < "0" || c > "9") { numeric = false; break; }
  }
  if (!numeric) return bail();
  parts.length = parts.length - 1;
  return { campaign: parts.join(" "), duration: last };
}

/** A name is usable when it carries the tokens the frontcard needs. */
function frontcardNameUsable(name: string): boolean {
  const meta = parseFilenameMeta(name);
  return meta.artworkType !== "" && meta.size !== "";
}

/**
 * The name to derive frontcard values FROM, which is not always the comp's own.
 *
 * A master's main comp is called "_V01" and carries nothing -- the real name
 * lives on the comp it WRAPS ("FID_INTL_Trio_DOOH_1920x1080px_15s_OV"), sitting
 * right there as a layer. So every "from name" reset was permanently greyed out
 * on exactly the files where the name was most obviously available.
 *
 * Layers before folder siblings: a layer inside this comp is a real structural
 * link, while a sibling merely shares a folder and could belong to a different
 * deliverable entirely.
 */
function frontcardSourceName(comp: CompItem): { name: string; from: string } {
  if (frontcardNameUsable(comp.name)) return { name: comp.name, from: "" };

  for (let i = 1; i <= comp.numLayers; i++) {
    const layer = comp.layer(i);
    const src = (layer as AVLayer).source;
    // Duck-typed, never instanceof -- see the note on frontcardTargets.
    if (src && typeof (src as CompItem).numLayers === "number" && frontcardNameUsable(src.name)) {
      return { name: src.name, from: src.name };
    }
  }

  const folder = comp.parentFolder;
  if (folder) {
    for (let i = 1; i <= folder.numItems; i++) {
      const item = folder.item(i);
      if (item && typeof (item as CompItem).numLayers === "number" && frontcardNameUsable(item.name)) {
        return { name: item.name, from: item.name };
      }
    }
  }
  return { name: comp.name, from: "" };
}

export interface FrontcardFields {
  success: boolean;
  error?: string;
  frontcards?: number;
  compName?: string;
  /** What the card says right now. */
  current?: { title: string; artwork: string; version: string; campaign: string; duration: string; territory: string; date: string };
  /** What the filename would give -- what the per-field reset button applies. */
  derived?: { title: string; artwork: string; version: string; campaign: string; duration: string; territory: string; date: string };
  /** Derived fields the name couldn't answer. */
  unresolved?: string[];
  /** True when the card's title is still the brand template's unfilled slot,
   *  so the panel can offer the campaign instead of echoing "Film Title". */
  titlePlaceholder?: boolean;
  territoryToken?: string;
  countries?: { name: string; code: string }[];
  /** Set when the values were derived from a DIFFERENT comp's name than the
   *  active one -- a master's "_V01" reading off the comp it wraps. */
  derivedFrom?: string;
}

export const frontcardReadFields = (): FrontcardFields => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const targets = frontcardTargets(comp);
    if (!targets.length) return { success: false, error: "No Frontcard layer in this comp." };

    // Read from the FIRST frontcard. Multiple frontcards in one comp are all
    // written together, so any of them answers "what does it say now".
    const t0 = targets[0];
    const line = splitCampaignLine(readText(t0, "campaignLine"));
    let ter = readText(t0, "territory");
    if (ter.length > 1 && ter.charAt(0) === "(" && ter.charAt(ter.length - 1) === ")") {
      ter = ter.substring(1, ter.length - 1);
    }

    // The comp's own name where it carries anything, otherwise the comp it
    // wraps -- see frontcardSourceName.
    const src = frontcardSourceName(comp);
    const name = src.name;
    const meta = parseFilenameMeta(name);
    const terMatch = frontcardTerritory(name);

    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth() + 1;
    const year = String(today.getFullYear()).slice(2, 4);
    const fullDate = (day < 10 ? "0" : "") + day + "." + (month < 10 ? "0" : "") + month + "." + year;

    // THE CAMPAIGN FOLDER, which is what the title actually is:
    //   /Volumes/.../Forgotten_Island/Digital/INT/...  ->  "Forgotten Island"
    //
    // GUARDED ON "/Digital" BEING THERE. split() returns the whole string when
    // the separator is absent, so a project saved anywhere else took the last
    // path segment -- the .aep FILENAME -- and offered
    // "FID INTL MultipleArt DOOH MotionPoster 1080x1526px 10s DE V01.aep" as a
    // film title. An empty derivation is honest and lands in `unresolved`; that
    // one looks like an answer.
    let derivedTitle = "";
    if (app.project.file) {
      const projPath = String(app.project.file);
      if (projPath.indexOf("/Digital") !== -1) {
        derivedTitle = projPath.split("/Digital")[0].split("/").slice(-1)[0].split("_").join(" ");
      }
    }

    const unresolved: string[] = [];
    if (!meta.artworkType) unresolved.push("artwork");
    if (!meta.version) unresolved.push("version");
    if (!terMatch.name) unresolved.push("territory");
    if (!meta.campaign) unresolved.push("campaign");
    if (!derivedTitle) unresolved.push("title");

    // Name AND code: the picker matches on either, so "DE" finds Germany
    // without anyone having to remember the long-form country name.
    const names: { name: string; code: string }[] = [];
    for (let i = 0; i < TC_COUNTRIES.length; i++) {
      let seen = false;
      for (let j = 0; j < names.length; j++) {
        if (names[j].name === TC_COUNTRIES[i].name) { seen = true; break; }
      }
      if (!seen) names.push({ name: TC_COUNTRIES[i].name, code: TC_COUNTRIES[i].code });
    }

    return {
      success: true,
      frontcards: targets.length,
      compName: name,
      // IS THE CARD'S TITLE STILL THE TEMPLATE'S PLACEHOLDER? Cheeky DT prefills
      // from what the card says, on the principle that you are correcting
      // reality rather than re-deriving from a filename that may be wrong. A
      // placeholder is not reality: nobody chose it, it is the brand template's
      // unfilled slot, and offering it as the current value is how "FILM TITLE"
      // reaches a deliverable. Reported rather than silently swapped, so the
      // panel decides what to do with it and the rule stays visible.
      titlePlaceholder: isFrontcardTitlePlaceholder(readText(t0, "title")),
      current: {
        title: readText(t0, "title"),
        artwork: readText(t0, "artwork"),
        version: readText(t0, "version"),
        campaign: line.campaign,
        duration: line.duration,
        territory: ter,
        date: readText(t0, "date"),
      },
      derived: {
        title: derivedTitle,
        artwork: meta.artworkType || "",
        // VERSION comes from whichever name has one. A master wraps a comp
        // called "FID_..._OV" that carries no version at all, inside a comp
        // called "_V01" that is nothing BUT the version -- so taking it from
        // the wrapped name alone threw away the one thing the outer name knew.
        version: meta.version || (comp.name.match(/V\d+/) ? String(comp.name.match(/V\d+/)) : ""),
        campaign: campaignWords(meta.campaign || ""),
        duration: (meta.duration || "").replace("sec", ""),
        territory: terMatch.name || "",
        date: fullDate,
      },
      unresolved: unresolved,
      territoryToken: terMatch.token,
      countries: names,
      derivedFrom: src.from,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Writes ONLY the keys present in the payload, to every Frontcard in the comp.
 *
 * Campaign and duration share one text layer, so both must be supplied together
 * when either is being written -- the line is composed from the two values
 * rather than reverse-engineered out of itself, which is the whole reason the
 * old read-back-and-split could silently lose text.
 */
export const frontcardWriteFields = (payload: string): Result => {
  try {
    const v = JSON.parse(payload) as Record<string, string>;
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const targets = frontcardTargets(comp);
    if (!targets.length) return { success: false, error: "No Frontcard layer in this comp." };

    const has = (k: string) => {
      // hasOwnProperty rather than truthiness: an intentionally emptied field
      // is still a field, and must be distinguishable from one never sent.
      return v.hasOwnProperty(k) && String(v[k]) !== "";
    };

    // What the fit had to do, so the panel can say it. WAS READ OUT OF
    // cheekyDTCheck'S SCOPE by mistake -- the same unbound-identifier bug as
    // compFor, caught this time by scripts/audit-unbound-globals.cjs.
    let titleNote = "";
    app.beginUndoGroup("Frontcard fields");
    try {
      for (let i = 0; i < targets.length; i++) {
        if (has("title")) {
          const fitted = frontcardSet(targets[i], "title", v.title);
          if (fitted !== "") titleNote = " Title " + fitted + ".";
        }
        if (has("artwork")) frontcardSet(targets[i], "artwork", v.artwork);
        if (has("version")) frontcardSet(targets[i], "version", v.version);
        if (has("territory")) frontcardSet(targets[i], "territory", "(" + v.territory + ")");
        if (has("date")) frontcardSet(targets[i], "date", v.date);
        if (has("campaign") || has("duration")) {
          // The panel holds a BARE number and the mark is appended here, so it
          // can never be doubled or missed. Which mark comes from the card
          // itself -- see inchMarkOf: rewriting a card's " as a " would change
          // every line this tool ever touched.
          const existing = readText(targets[i], "campaignLine");
          const mark = inchMarkOf(existing, "\u201D");
          // THE HALF NOT SENT COMES OFF THE CARD, not out of thin air. Editing
          // only the creative used to blank the seconds, which is the stranded
          // `”` from the other direction -- and the modal sends one field at a
          // time as you type.
          const split = splitCampaignLine(existing);
          const dur = has("duration") ? stripInch(String(v.duration)) : split.duration;
          const camp = has("campaign") ? String(v.campaign) : split.campaign;
          if (camp !== "" || dur !== "") {
            frontcardSet(
              targets[i], "campaignLine",
              (camp + " " + dur + mark).replace(/^ +/, "").replace(/  +/g, " "),
            );
          }
        }
      }
    } finally {
      app.endUndoGroup();
    }
    return { success: true, message: titleNote !== "" ? "Title" + titleNote.replace(" Title", "") : undefined };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export interface CheekyTInspection {
  success: boolean;
  error?: string;
  frontcards?: number;
  compName?: string;
  /** The short-name path: only "(HO Approved)" is written, nothing is parsed. */
  shortName?: boolean;
  values?: { artwork: string; version: string; territory: string; date: string; campaign: string; duration: string };
  /** Field keys the filename could not answer. Drives the review modal. */
  unresolved?: string[];
  /** What was in the name where a territory should have been. */
  territoryToken?: string;
  countries?: { name: string; code: string }[];
}

/** Resolves everything Cheeky T would write, WITHOUT writing any of it. */
export const cheekyTInspect = (): CheekyTInspection => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const targets = frontcardTargets(comp);
    if (!targets.length) return { success: false, error: "No Frontcard layer in this comp." };

    const names: { name: string; code: string }[] = [];
    for (let i = 0; i < TC_COUNTRIES.length; i++) {
      let seen = false;
      for (let j = 0; j < names.length; j++) {
        if (names[j].name === TC_COUNTRIES[i].name) { seen = true; break; }
      }
      if (!seen) names.push({ name: TC_COUNTRIES[i].name, code: TC_COUNTRIES[i].code });
    }

    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth() + 1;
    const year = String(today.getFullYear()).slice(2, 4);
    const fullDate = (day < 10 ? "0" : "") + day + "." + (month < 10 ? "0" : "") + month + "." + year;

    const name = comp.name;
    // IS THE NAME USABLE, not how many underscores are in it.
    //
    // This was `split("_").length < 8`, a token COUNT standing in for "does
    // this name carry what a frontcard needs". It was calibrated on the legacy
    // convention, which spends a token on DGTL and usually another on a site:
    // ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV is nine. The current
    // convention drops DGTL, and a deliverable with no site token is SEVEN --
    // FID_INTL_MultipleArt_DOOH_1920x640px_30s_BR -- so every one of those fell
    // down the short-name path and had nothing parsed from it at all. That is
    // the "it retrieves nothing" the studio reported: not a failed lookup, a
    // name the tool never agreed to read.
    //
    // frontcardNameUsable asks the real question -- an artwork type and a size
    // -- and it was already here, used by the "from name" reset.
    if (!frontcardNameUsable(name)) {
      return {
        success: true, frontcards: targets.length, compName: name, shortName: true,
        values: { artwork: "", version: "", territory: "(HO Approved)", date: fullDate, campaign: "", duration: "" },
        unresolved: [], countries: names,
      };
    }

    const meta = parseFilenameMeta(name);
    const ter = frontcardTerritory(name);
    // The creative is campaign OR siteName -- see the note in cheekyDTCheck.
    const creative = campaignWords(meta.campaign !== "" ? meta.campaign : meta.siteName);
    const seconds = meta.duration.replace("sec", "");
    const unresolved: string[] = [];
    if (!meta.artworkType) unresolved.push("artwork");
    if (!meta.version) unresolved.push("version");
    if (!ter.name) unresolved.push("territory");
    // ASKED FOR RATHER THAN STRANDED. These two used to be outside what Cheeky
    // T looked at, so a name that answered neither left the campaign line as a
    // lone inch mark and reported success. Now they are collected like any
    // other field the name could not resolve.
    if (!creative) unresolved.push("campaign");
    if (!seconds) unresolved.push("duration");

    return {
      success: true,
      frontcards: targets.length,
      compName: name,
      shortName: false,
      values: {
        artwork: meta.artworkType || "",
        version: meta.version || "",
        territory: ter.name || "",
        date: fullDate,
        campaign: creative,
        duration: seconds,
      },
      unresolved: unresolved,
      territoryToken: ter.token,
      countries: names,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Writes the four fields Cheeky T owns to every Frontcard in the active comp.
 * Called on every keystroke in the review modal, so it is deliberately a plain
 * idempotent overwrite -- no read-back, no string surgery, and the campaign
 * line is not touched at all.
 *
 * A blank value is SKIPPED, never written: half-filling the modal must not
 * blank a field that was already correct on the card.
 */
export const cheekyTApplyFields = (payload: string): Result => {
  // Cheeky T's four fields, through the same writer Cheeky DT uses. Kept as its
  // own export because the modal calls it by name; the logic lives in one place
  // so the two can never disagree about how a field is written.
  return frontcardWriteFields(payload);
};

export interface CheekyDTResult {
  success: boolean;
  error?: string;
  /** What actually happened -- shown verbatim, never a generic "Complete." */
  message?: string;
  frontcards?: number;
  /** Territory was asked for and could not be resolved, so it was LEFT ALONE. */
  territorySkipped?: boolean;
  territoryToken?: string;
}

export const cheekyDTCheck = (
  doTitle: boolean,
  doArtwork: boolean,
  doVersion: boolean,
  doCampaign: boolean,
  doDuration: boolean,
  doTerritoryCheck: boolean,
  doDate: boolean
): CheekyDTResult => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const name = comp.name;

    // A name with nothing to read: only the territory-check parenthetical gets
    // touched, nothing else. See the note in cheekyTInspect for why this is a
    // question about the name's CONTENT and not its underscore count.
    if (!frontcardNameUsable(name)) {
      let shortCards = 0;
      for (let i = 1; i <= comp.numLayers; i++) {
        const layer = comp.layer(i);
        if (String(layer.name).indexOf("Frontcard") === -1) continue;
        shortCards++;
        const source = (layer as AVLayer).source as CompItem;
        const variantA = source.layer(2).name === "XYi_Logo_V20_[0000-0250].png";
        if (doTerritoryCheck) {
          const idx = variantA ? 4 : 12;
          (source.layer(idx).property("Source Text") as Property).setValue("(HO Approved)");
        }
      }
      // A comp with no Frontcard is a real failure, not a quiet success. This
      // returned `{success: true}` either way, so running it on the wrong comp
      // looked exactly like running it on the right one.
      if (shortCards === 0) return { success: false, error: "No Frontcard layer in this comp." };
      return {
        success: true, frontcards: shortCards,
        // Says WHY, not "short". The gate is about what the name carries, and
        // "short comp name" sent people counting underscores at a name that was
        // simply missing its artwork type or its size.
        message: "This comp's name has no artwork type and size to read — stamped (HO Approved) on " +
          shortCards + (shortCards === 1 ? " Frontcard" : " Frontcards") + ". Nothing else was touched.",
      };
    }

    if (!app.project.file) return { success: false, error: "Save this project once first." };
    const meta = parseFilenameMeta(name);
    const projPath = String(app.project.file);
    const filmTitle = projPath.split("/Digital")[0].split("/").slice(-1)[0].split("_").join(" ");
    const artworkType = meta.artworkType;
    // THE CREATIVE IS `campaign` OR `siteName`, in that order. Current names put
    // it left of the artwork type; legacy _DGTL_ names have the artwork type
    // FIRST in the descriptive run, so nothing sits left of it and the creative
    // is in siteName. Reading only `campaign` is what broke Campaign Rename for
    // twelve days and what Bespoke's solo rename hit the same afternoon -- this
    // is the third consumer of the same field to want the same thing.
    let campaign = campaignWords(meta.campaign !== "" ? meta.campaign : meta.siteName);
    let duration = meta.duration.replace("sec", "");
    const version = meta.version;

    // Same as `new Date(Date(0))` in the original -- that's just today's
    // date via a roundabout string round-trip; simplified to `new Date()`.
    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth() + 1;
    const year = String(today.getFullYear()).slice(2, 4);
    const fullDate = (day < 10 ? "0" : "") + day + "." + (month < 10 ? "0" : "") + month + "." + year;

    // frontcardTerritory, not territoryCheck(meta.territory): the meta token is
    // the FIRST two-letter run in the name, which truncates BE_DE to BE and
    // misses DOM entirely. See the note on frontcardTerritory above.
    const territoryMatch = frontcardTerritory(name).name;

    let cards = 0;
    let titleNote = "";
    /** Frontcards whose campaign line was left alone because nothing resolved. */
    let campaignLeft = 0;
    for (let i = 1; i <= comp.numLayers; i++) {
      const layer = comp.layer(i);
      // indexOf, not .match() -- a layer name is not a regex pattern.
      if (String(layer.name).indexOf("Frontcard") !== -1) {
        cards++;
        const source = (layer as AVLayer).source as CompItem;
        const variantA = source.layer(2).name === "XYi_Logo_V20_[0000-0250].png";
        const idx = frontcardLayerTextIndices(variantA);

        if (doTitle) {
          const titleLayer = source.layer(idx.title);
          (titleLayer.property("Source Text") as Property).setValue(filmTitle);
          // Measured AFTER the write, since the fit depends on the new text.
          const fitted = fitFrontcardText(titleLayer, 0);
          if (fitted !== "") titleNote = " Title " + fitted + ".";
        }
        if (doArtwork) (source.layer(idx.artwork).property("Source Text") as Property).setValue(String(artworkType));
        if (doVersion) (source.layer(idx.version).property("Source Text") as Property).setValue(String(version));

        const campaignLineProp = source.layer(idx.campaignLine).property("Source Text") as Property;
        const existingLine = String(campaignLineProp.value);
        const split = splitCampaignLine(existingLine);
        const mark = inchMarkOf(existingLine, "\u201D");

        // PRESERVE WHAT WE ARE NOT WRITING, without the old string surgery.
        //
        // That took the line's last word, dropped its final character to get the
        // duration, then used the result as a SPLIT DELIMITER to recover the
        // campaign. On the brand template's placeholder -- CREATIVE NAME " --
        // the last word is the inch mark alone, so the "duration" came out as an
        // empty string and split("") exploded the line into characters: the
        // campaign became its first letter and the card read C". splitCampaignLine
        // answers both halves properly and returns blanks when it cannot.
        // FALL BACK TO THE CARD when the name could not answer. `doCampaign`
        // says "re-derive this", not "blank it if you can't" -- and a name that
        // parses to nothing is exactly when what is already on the card is the
        // better answer.
        if (!doCampaign || campaign === "") campaign = split.campaign;
        if (!doDuration || duration === "") duration = split.duration;

        // NOTHING TO SAY IS NOT A LINE. With both halves empty this wrote the
        // inch mark on its own -- the stranded `”` with no seconds in front of
        // it -- and reported a clean update. Leaving the line exactly as found
        // and saying so is the only honest answer: a blank campaign line is
        // fixable, a card that quietly lost its own is not.
        if (campaign === "" && duration === "") {
          campaignLeft++;
        } else {
          campaignLineProp.setValue(
            String(campaign + " " + duration + mark).replace(/^ +/, "").replace(/  +/g, " "),
          );
        }

        // NEVER stamp an unresolved territory. This used to write whatever
        // String(null) gave it, so a name the parser couldn't read put a
        // literal "(null)" -- and before the lookup was fixed, a confident
        // "(Afghanistan)" -- onto a finished frontcard. A blank field is
        // fixable; a plausible wrong country ships.
        if (doTerritoryCheck && territoryMatch) {
          (source.layer(idx.territory).property("Source Text") as Property).setValue("(" + territoryMatch + ")");
        }
        if (doDate) (source.layer(idx.date).property("Source Text") as Property).setValue(String(fullDate));
      }
    }

    if (cards === 0) return { success: false, error: "No Frontcard layer in this comp." };

    // SAYS WHAT IT SKIPPED. An unresolved territory is left untouched rather
    // than stamped, which is right -- but reporting a plain success afterwards
    // is the Auto AR failure exactly: a rig that half-applies and claims it
    // worked. The message names the token so it can be fixed at the source.
    const skipped = doTerritoryCheck && !territoryMatch;
    const where = cards === 1 ? "Frontcard" : cards + " Frontcards";
    if (skipped) {
      const token = frontcardTerritory(name).token;
      return {
        success: true, frontcards: cards, territorySkipped: true, territoryToken: token,
        message: "Updated " + where + ", but the territory was left as-is — " +
          (token ? "\"" + token + "\" isn't a territory we know." : "the name has no territory in it."),
      };
    }
    const leftNote = campaignLeft === 0
      ? ""
      : " The campaign line was left as it was on " +
        (campaignLeft === 1 ? "one card" : campaignLeft + " cards") +
        " — the name gave no creative or duration to write.";
    return { success: true, frontcards: cards, message: "Updated " + where + "." + titleNote + leftNote };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// The "Cheeky T Check" button's exact fixed args from XYi_Toolbox.jsx:
// (title=false, artwork=true, version=true, campaign=false, duration=false,
// territoryCheck=true, date=true).
// CAMPAIGN AND DURATION ARE ON, which the original's fixed args had off. Cheeky
// T checks everything the FILENAME can answer -- artwork, version, territory,
// date, and now the creative and its seconds. The title stays off because it is
// the one field derived from the PROJECT PATH rather than the name, and it
// carries its own box-fit; that remains Cheeky DT's.
//
// Turning them on is what makes a MultipleArt build read "Multiple Art":
// campaignWords splits the token the same way it splits PortalToParadise.
export const cheekyTCheck = (): Result => cheekyDTCheck(false, true, true, true, true, true, true);

// =============================================================================
// Replicator -- ported from toolset/XYI_Replicator.jsx, wired to the
// "Replicator" button. Recursively copies a source folder's contents into a
// destination folder (skipping files that already exist there), writing a
// file_list.txt log into the destination. Pure filesystem copy, no AE
// project touched, never overwrites an existing destination file.
// =============================================================================
interface ReplicatorResult {
  success: boolean;
  error?: string;
  message?: string;
}

export const replicator = (): ReplicatorResult => {
  try {
    const srcFolder = Folder.selectDialog("Select Source Folder");
    if (!srcFolder) return { success: false, error: "No source folder selected." };
    const destFolder = Folder.selectDialog("Select Destination Folder");
    if (!destFolder) return { success: false, error: "No destination folder selected." };

    const logFile = new File(destFolder.fsName + "/file_list.txt");
    logFile.open("w");

    let copied = 0;
    let skipped = 0;

    const copyFiles = (src: Folder, dest: Folder) => {
      const items = src.getFiles();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item instanceof File) {
          const destFile = new File(dest.fsName + "/" + item.name);
          if (!destFile.exists) {
            item.copy(destFile.fsName);
            logFile.writeln("Copied: " + destFile.fsName);
            copied++;
          } else {
            logFile.writeln("Skipped: " + destFile.fsName);
            skipped++;
          }
        } else if (item instanceof Folder) {
          const newDestFolder = new Folder(dest.fsName + "/" + item.name);
          if (!newDestFolder.exists) newDestFolder.create();
          copyFiles(item, newDestFolder);
        }
      }
    };

    copyFiles(srcFolder, destFolder);
    logFile.close();

    return { success: true, message: `Copied ${copied} file(s), skipped ${skipped} already present.` };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Transform Apply -- ported from toolset/XYi_TransApply.jsx's
// moveTransformsToEffect(), wired to the "Transform Apply" button (called
// there with all defaults true -- move anchor, position, rotation, scale,
// and opacity). Moves each selected layer's Transform properties onto a
// Transform *effect* instead, resetting the layer's own transform to
// default, preserving keyframes/interpolation/easing along the way.
// =============================================================================
// doAnchor/doPos/doRot/doScale/doOp default to true (the plain "Transform
// Apply" grid button calls this with no args) -- Master Tools' "Transform
// Apply - Scale"/"Transform Apply - Position" buttons pass explicit flags
// to move just one property, matching XYi_TransApply.jsx's
// moveTransformsToEffect(doAnchor, doPos, doRot, doScale, doOp) exactly.
export const transformApply = (doAnchor = true, doPos = true, doRot = true, doScale = true, doOp = true): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    if (comp.selectedLayers.length === 0) return { success: false, error: "Please select at least one layer." };

    app.beginUndoGroup("Move Transform Properties to Transform Effect");

    const selectedLayers = comp.selectedLayers;
    for (let i = 0; i < selectedLayers.length; i++) {
      const layer = selectedLayers[i];
      const transformEffect = (layer.property("ADBE Effect Parade") as Property).addProperty("Transform") as Property;

      const propertiesToTransfer: { layerProp: string; effectProp: string }[] = [];
      if (doAnchor) propertiesToTransfer.push({ layerProp: "Anchor Point", effectProp: "Anchor Point" });
      if (doPos) propertiesToTransfer.push({ layerProp: "Position", effectProp: "Position" });
      if (doRot) propertiesToTransfer.push({ layerProp: "Rotation", effectProp: "Rotation" });
      if (doOp) propertiesToTransfer.push({ layerProp: "Opacity", effectProp: "Opacity" });

      for (let j = 0; j < propertiesToTransfer.length; j++) {
        const layerPropName = propertiesToTransfer[j].layerProp;
        const effectPropName = propertiesToTransfer[j].effectProp;
        const layerProp = (layer.property("Transform") as Property).property(layerPropName) as Property;
        const effectProp = transformEffect.property(effectPropName) as Property;

        const isPosNoScale = layerPropName === "Position" && doPos && !doScale;
        const layerScale = (layer.property("Transform") as Property).property("Scale") as Property;
        const defVal = [layer.width / 2, layer.height / 2];

        if (layerProp.numKeys > 0) {
          for (let k = 1; k <= layerProp.numKeys; k++) {
            const time = layerProp.keyTime(k);
            let value = layerProp.keyValue(k);
            const inInterp = layerProp.keyInInterpolationType(k);
            const outInterp = layerProp.keyOutInterpolationType(k);
            const easeIn = layerProp.keyInTemporalEase(k);
            const easeOut = layerProp.keyOutTemporalEase(k);

            if (value instanceof Array && value.length > 2) value = [value[0], value[1]];

            if (isPosNoScale) {
              const sVal = layerScale.valueAtTime(time, false);
              let sX = sVal[0] / 100;
              let sY = sVal[1] / 100;
              if (sX === 0) sX = 0.0001;
              if (sY === 0) sY = 0.0001;
              value = [defVal[0] + (value[0] - defVal[0]) / sX, defVal[1] + (value[1] - defVal[1]) / sY];
            }

            const keyIndex = effectProp.addKey(time);
            effectProp.setValueAtKey(keyIndex, value);
            effectProp.setTemporalEaseAtKey(keyIndex, easeIn, easeOut);
            effectProp.setInterpolationTypeAtKey(keyIndex, inInterp, outInterp);
          }
        } else {
          let value = layerProp.value;
          if (value instanceof Array && value.length > 2) value = [value[0], value[1]];

          if (isPosNoScale) {
            const sVal = layerScale.value;
            let sX = sVal[0] / 100;
            let sY = sVal[1] / 100;
            if (sX === 0) sX = 0.0001;
            if (sY === 0) sY = 0.0001;
            value = [defVal[0] + (value[0] - defVal[0]) / sX, defVal[1] + (value[1] - defVal[1]) / sY];
          }

          effectProp.setValue(value);
        }

        if (layerProp.numKeys > 0) {
          for (let k = layerProp.numKeys; k >= 1; k--) layerProp.removeKey(k);
        }

        if (layerPropName === "Anchor Point" || layerPropName === "Position") {
          let originalValue = layerProp.value;
          if (originalValue instanceof Array && originalValue.length > 2) originalValue = [originalValue[0], originalValue[1]];
          const defaultValue = [layer.width / 2, layer.height / 2];

          if (effectProp.numKeys > 0) {
            for (let k = 1; k <= effectProp.numKeys; k++) {
              const value = effectProp.valueAtTime(effectProp.keyTime(k), false);
              effectProp.setValueAtKey(k, [value[0], value[1]]);
            }
          } else {
            const value = effectProp.value;
            effectProp.setValue([value[0], value[1]]);
          }
          layerProp.setValue(defaultValue);
        } else if (layerPropName === "Rotation") {
          layerProp.setValue(0);
        } else if (layerPropName === "Opacity") {
          layerProp.setValue(100);
        }
      }

      if (doScale) {
        transformEffect.property("Uniform Scale")!.setValue(false);
        const layerScale = (layer.property("Transform") as Property).property("Scale") as Property;
        const effectScaleWidth = transformEffect.property("Scale Width") as Property;
        const effectScaleHeight = transformEffect.property("Scale Height") as Property;

        if (layerScale.numKeys > 0) {
          for (let k = 1; k <= layerScale.numKeys; k++) {
            const time = layerScale.keyTime(k);
            const value = layerScale.keyValue(k);
            const inInterp = layerScale.keyInInterpolationType(k);
            const outInterp = layerScale.keyOutInterpolationType(k);
            const easeIn = layerScale.keyInTemporalEase(k);
            const easeOut = layerScale.keyOutTemporalEase(k);

            const keyIndexWidth = effectScaleWidth.addKey(time);
            effectScaleWidth.setValueAtKey(keyIndexWidth, value[0]);
            effectScaleWidth.setTemporalEaseAtKey(keyIndexWidth, [easeIn[0]], [easeOut[0]]);
            effectScaleWidth.setInterpolationTypeAtKey(keyIndexWidth, inInterp, outInterp);

            const keyIndexHeight = effectScaleHeight.addKey(time);
            effectScaleHeight.setValueAtKey(keyIndexHeight, value[1]);
            effectScaleHeight.setTemporalEaseAtKey(keyIndexHeight, [easeIn[1]], [easeOut[1]]);
            effectScaleHeight.setInterpolationTypeAtKey(keyIndexHeight, inInterp, outInterp);
          }
        } else {
          const value = layerScale.value;
          effectScaleWidth.setValue(value[0]);
          effectScaleHeight.setValue(value[1]);
        }

        if (layerScale.numKeys > 0) {
          for (let k = layerScale.numKeys; k >= 1; k--) layerScale.removeKey(k);
        }
        layerScale.setValue([100, 100]);
      }
    }

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Swapper -- ported from toolset/XYi_Swapper.jsx (replaceLayerMatchWidth),
// wired to the "Swapper" button. Replaces the single selected layer's
// source with whatever's selected in the Project panel, then rescales/
// repositions to preserve the original visual width, anchor ratio, and
// position.
// =============================================================================
export const swapper = (): Result => {
  try {
    const proj = app.project;
    const comp = proj.activeItem;
    if (!(comp instanceof CompItem) || comp.selectedLayers.length !== 1) {
      return { success: false, error: "Please select exactly one layer in your composition." };
    }

    const targetLayer = comp.selectedLayers[0] as AVLayer;
    const replacementAsset = proj.selection[0] as AVItem;
    if (!replacementAsset || (replacementAsset === (comp as unknown as AVItem))) {
      return { success: false, error: "Please select the replacement asset (footage or comp) in the Project panel." };
    }

    app.beginUndoGroup("Replace Layer and Match Width");

    const oldVisualWidth = targetLayer.width * (targetLayer.scale.value[0] / 100);
    const anchorRatioX = targetLayer.anchorPoint.value[0] / targetLayer.width;
    const anchorRatioY = targetLayer.anchorPoint.value[1] / targetLayer.height;
    const oldPos = targetLayer.position.value;

    targetLayer.replaceSource(replacementAsset, false);

    const newScaleFactor = (oldVisualWidth / replacementAsset.width) * 100;
    targetLayer.scale.setValue([newScaleFactor, newScaleFactor]);

    targetLayer.anchorPoint.setValue([replacementAsset.width * anchorRatioX, replacementAsset.height * anchorRatioY]);
    targetLayer.position.setValue(oldPos);

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Make Textless -- ported from toolset/XYi_MakeTXTLS.jsx, wired to the
// "Make Textless" button. Recursively disables every layer labelled 2
// (yellow, by studio convention) inside the first comp found in a "Main"
// folder, descending into nested comps on labels 1/10.
// =============================================================================
function turnOffYellowLayers(comp: CompItem) {
  for (let i = 1; i <= comp.numLayers; i++) {
    const lyr = comp.layer(i);
    if (lyr.label === 2) {
      lyr.enabled = false;
    }
    if ((lyr.label === 10 || lyr.label === 1) && (lyr as AVLayer).source instanceof CompItem) {
      turnOffYellowLayers((lyr as AVLayer).source as CompItem);
    }
  }
}

export const makeTextless = (): Result => {
  try {
    app.beginUndoGroup("Turn Off Yellow Layers Recursively");

    const proj = app.project;
    let mainFolder: FolderItem | null = null;
    for (let i = 1; i <= proj.numItems; i++) {
      const item = proj.item(i);
      if (item instanceof FolderItem && item.name.toLowerCase() === "main") {
        mainFolder = item;
        break;
      }
    }
    if (!mainFolder) {
      app.endUndoGroup();
      return { success: false, error: 'No folder named "Main" found in project root.' };
    }

    let mainComp: CompItem | null = null;
    for (let j = 1; j <= mainFolder.numItems; j++) {
      const item = mainFolder.item(j);
      if (item instanceof CompItem) {
        mainComp = item;
        break;
      }
    }
    if (!mainComp) {
      app.endUndoGroup();
      return { success: false, error: 'No comp found inside "Main" folder.' };
    }

    turnOffYellowLayers(mainComp);

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Scale Fit -- ported from toolset/XYi_Scale_Exp.jsx's fitAndScale(), wired
// to the "Scale Fit" button. For each selected layer: adds a "Checkbox
// Control" effect renamed "Extreme", adds an expression to Scale that fits
// (checkbox off) or fills (checkbox on) the layer to the comp, then sets
// Scale to a fixed 24.
//
// NOTE (faithfully preserved, not fixed): the original's comment says step
// 3 "disables the expression" to bake the fit-to-comp value before step 4
// overrides it with 24 -- but the actual code sets `expressionEnabled =
// true`, not false. Since the expression stays enabled, it keeps
// overriding whatever setValue(24) writes, so the final "scale to 24" step
// likely has no visible effect. Ported exactly as the original behaves,
// not as its comment claims -- flag to the studio if 24 was actually meant
// to stick.
// =============================================================================
const SCALE_FIT_EXPRESSION =
  "//Always have PNG’s scaled to fit within a comp\n" +
  "// Get the layer and comp sizes\n" +
  "var compSize = [thisComp.width, thisComp.height];\n" +
  "var layerSize = sourceRectAtTime(time, false).width > 0 && sourceRectAtTime(time, false).height > 0 \n" +
  "    ? [sourceRectAtTime(time, false).width, sourceRectAtTime(time, false).height] \n" +
  "    : [width, height]; // fallback if sourceRect is zero\n" +
  "// Calculate scaling factors for width and height\n" +
  "var scaleFactor = [\n" +
  "    compSize[0] / layerSize[0],\n" +
  "    compSize[1] / layerSize[1]\n" +
  "];\n" +
  "// Pick the smaller scale factor to fit inside (if checkbox is on) or the larger to fill the comp.\n" +
  "if(effect(\"Extreme\")(1).value){\n" +
  "    var finalScale = Math.min(scaleFactor[0], scaleFactor[1]);\n" +
  "}else{\n" +
  "    var finalScale = Math.max(scaleFactor[0], scaleFactor[1]);\n" +
  "}\n" +
  "// Apply the scale uniformly\n" +
  "[finalScale * 100, finalScale * 100];";

export const scaleFit = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Please select a composition first." };
    const selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return { success: false, error: "Please select one or more layers." };

    for (let i = 0; i < selectedLayers.length; i++) {
      const currentLayer = selectedLayers[i];
      if (currentLayer.property("Transform") === null) continue;

      const extremeCheckbox = (currentLayer.property("Effects") as Property).addProperty("Checkbox Control") as Property;
      if (extremeCheckbox) extremeCheckbox.name = "Extreme";

      const scaleProp = (currentLayer.property("Transform") as Property).property("Scale") as Property;
      scaleProp.expression = SCALE_FIT_EXPRESSION;
      scaleProp.expressionEnabled = true;
      scaleProp.setValue([24, 24, 24]);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Loc it -- ported from toolset/XYi_LocIt.jsx, wired to the "Loc it" button.
// Recursively scans a source folder for .aep files, sorts them into
// "_<aspectRatio>_" subfolders under a destination folder, skipping any
// (campaign, duration) combination already present there. COPY only --
// never touches/removes the source files.
// =============================================================================
interface LocItResult {
  success: boolean;
  error?: string;
  message?: string;
}

export const locIt = (): LocItResult => {
  try {
    const src = Folder.selectDialog("Select Source Folder");
    if (!src) return { success: false, error: "No source folder selected." };
    const dst = Folder.selectDialog("Select Destination Folder");
    if (!dst) return { success: false, error: "No destination folder selected." };

    const skipFoldersPattern = /(auto-save|_archive|_old)/i;

    const calculateAspectRatio = (size: string): string | null => {
      const dimensions = size.split("x");
      if (dimensions.length !== 2) return null;
      const width = parseInt(dimensions[0], 10);
      const height = parseInt(dimensions[1], 10);
      if (!width || !height) return null;
      return (width / height).toFixed(2);
    };

    const combinationExists = (folder: Folder, campaign: string, duration: string): boolean => {
      const files = folder.getFiles("*.aep");
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f instanceof File && String(f.name.match(campaign)) === campaign && String(f.name.match(duration)) === duration) {
          return true;
        }
      }
      return false;
    };

    let copiedCount = 0;

    const processFolder = (folder: Folder) => {
      const items = folder.getFiles();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it instanceof Folder) {
          if (!skipFoldersPattern.test(it.name)) processFolder(it);
        } else if (it instanceof File && it.name.slice(-4).toLowerCase() === ".aep") {
          const meta = parseFilenameMeta(it.name);
          const campaign = meta.campaign;
          const size = meta.size;
          const duration = meta.duration;

          const aspectRatio = calculateAspectRatio(size);
          if (!aspectRatio) continue;

          const ratioFolder = new Folder(dst.fsName + "/_" + aspectRatio + "_");
          if (!ratioFolder.exists) ratioFolder.create();

          if (!combinationExists(ratioFolder, campaign, duration)) {
            const destFile = new File(ratioFolder.fsName + "/" + it.name);
            if (!destFile.exists) {
              it.copy(destFile.fsName);
              copiedCount++;
            }
          }
        }
      }
    };

    processFolder(src);

    return { success: true, message: `Copied ${copiedCount} unique (aspect ratio, campaign, duration) file(s).` };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Mask Separator -- ported from XYi_Toolbox.jsx's MasSep() (originally by
// Christopher R. Green, via aenhancers.com). Splits a layer with 2+ masks
// into one duplicate layer per mask, each keeping only its own mask.
// Optionally recenters each new layer's anchor point to its mask's bounds,
// and optionally renames layers from a delimited string instead of using
// existing mask names. `recenter` and `nameString` are collected via
// window.confirm()/window.prompt() on the React side (same pattern OV
// Library uses for "New Campaign"), then passed in here -- no dialogs are
// triggered from ExtendScript itself.
// =============================================================================
export const maskSeparator = (recenter: boolean, nameString: string): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "You need to select one layer first." };

    const selectedLayers = comp.selectedLayers;
    if (selectedLayers.length !== 1) {
      return { success: false, error: (selectedLayers.length === 0 ? "No" : String(selectedLayers.length)) + " layers selected. You need to select one layer." };
    }

    const baseLayer = selectedLayers[0] as AVLayer;
    if ((baseLayer as any).adjustmentLayer === undefined) {
      return { success: false, error: "Selected layer not valid (camera or light?)." };
    }

    const maskCount = (baseLayer.property("Masks") as Property).numProperties;
    if (maskCount < 2) return { success: false, error: "Selected layer must have at least two masks." };

    let nameArray: string[] = [];
    let userNameFlag = false;
    if (nameString && nameString.length > 3) {
      const sepr = nameString.charAt(0);
      nameArray = nameString.split(sepr);
      userNameFlag = true;
    }

    const getAndSortVerts = (layer: AVLayer, axis: 0 | 1): number[] => {
      const verts: number[] = (layer.mask(1).property("ADBE Mask Shape") as Property).value.vertices;
      const out: number[] = [];
      for (let v = 0; v < verts.length; v++) out.push((verts[v] as unknown as number[])[axis]);
      return out.sort((a, b) => a - b);
    };

    const recenterMask = (layer: AVLayer) => {
      const startingPos = layer.position.value as number[];
      const startingAP = layer.anchorPoint.value as number[];
      let posOffset = [0, 0];
      if (startingPos !== startingAP) posOffset = [-1 * (startingAP[0] - startingPos[0]), -1 * (startingAP[1] - startingPos[1])];

      const vx = getAndSortVerts(layer, 0);
      const vy = getAndSortVerts(layer, 1);
      const xLen = vx[vx.length - 1] - vx[0];
      const yLen = vy[vy.length - 1] - vy[0];
      const newCenter = [vx[0] + xLen / 2, vy[0] + yLen / 2];

      layer.anchorPoint.setValue(newCenter);
      layer.position.setValue([newCenter[0] + posOffset[0], newCenter[1] + posOffset[1]]);
    };

    app.beginUndoGroup("Mask-separation");

    let lastIndex = 0;
    for (let i = 1; i < maskCount; i++) {
      const newLayer = baseLayer.duplicate() as AVLayer;
      for (let m = maskCount; m > 0; m--) {
        if (i !== m) newLayer.mask(m).remove();
      }
      if (recenter) recenterMask(newLayer);
      newLayer.mask(1).maskMode = MaskMode.ADD;

      if (userNameFlag && i <= nameArray.length - 1 && nameArray[i] !== "") {
        newLayer.name = nameArray[i];
      } else {
        newLayer.name = newLayer.mask(1).name;
      }
      lastIndex = i;
    }

    for (let m = maskCount; m > 0; m--) {
      if (m !== maskCount) baseLayer.mask(m).remove();
    }
    if (recenter) recenterMask(baseLayer);
    baseLayer.mask(1).maskMode = MaskMode.ADD;

    if (userNameFlag && lastIndex <= nameArray.length - 1 && nameArray[lastIndex] !== "") {
      baseLayer.name = nameArray[lastIndex];
    } else {
      baseLayer.name = baseLayer.mask(1).name;
    }

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Rotate 90CC -- ported from XYi_Toolbox.jsx's rotNinty(), wired to the
// "Rotate 90CC" button. For each selected item, creates a new comp with
// width/height swapped and the item rotated -90deg inside it. The original
// item is untouched -- this only adds a new wrapper comp.
// =============================================================================
export const rotate90cc = (): Result => {
  try {
    if (app.project.selection.length === 0) return { success: false, error: "Please select compositions first." };
    app.beginUndoGroup("XYi Comp Rotation");
    for (let i = 0; i < app.project.selection.length; i++) {
      const activeItem = app.project.selection[i] as AVItem;
      const newName = activeItem.name + "_90CC";
      const oldWidth = activeItem.width;
      const oldHeight = activeItem.height;
      const oldDuration = activeItem.duration;
      const frameRate = activeItem.frameRate;
      const pixcor = Math.round(oldWidth * activeItem.pixelAspect);

      const myComp = app.project.items.addComp(newName, oldHeight, pixcor, 1, oldDuration, frameRate);
      const mySolid = myComp.layers.add(activeItem);
      (mySolid.property("rotation") as Property).setValue(-90);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Edit Markers -- ported from XYi_Toolbox.jsx's EdiMar(), wired to the
// "Edit Markers" button. Adds a transparent "Edit_Points" solid to the
// active comp and drops a marker at every layer's inPoint.
// =============================================================================
export const editMarkers = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    app.beginUndoGroup("XYi Edit Marker Generator");

    const editPointsSolid = comp.layers.addSolid([1, 1, 1], "Edit_Points", comp.width, comp.height, 1);
    (editPointsSolid.property("Opacity") as Property).setValue(0);

    for (let i = 1; i <= comp.numLayers; i++) {
      const spec = comp.layer(i).inPoint;
      const myMarker = new MarkerValue(String(i));
      (editPointsSolid.property("Marker") as Property).setValueAtTime(spec, myMarker);
    }

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Toggle By Label -- new tool, ported from ToggleByLabel.jsx (found
// separately from the original 22-listbox-tab/Toolset survey, not part of
// either). Toggles enabled/disabled on every layer in the active comp
// whose label color matches the one the user picks. `labelIndex` is the
// same 0-16 scheme AE's own Label Color preferences swatches use (0 =
// None) -- the picker itself lives in Toolset.tsx via the new
// `selectDialog()` (Dialog.tsx), matching the order the original
// ScriptUI's dropdown listed them in. Active-comp-only, no file access --
// zero master-file risk.
// =============================================================================
export const toggleLayersByLabel = (labelIndex: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    app.beginUndoGroup("Toggle Layers by Label");
    for (let i = 1; i <= comp.numLayers; i++) {
      const layer = comp.layer(i);
      if (layer.label === labelIndex) layer.enabled = !layer.enabled;
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Comp Duration -- new tool, ported from XYi_CompDuration.jsx. Sets the
// active comp's own duration to a preset (10/15/20/30s) or a custom value,
// picked via Toolset.tsx's new selectDialog()/promptDialog() combo rather
// than a dedicated tool page (no persistent state, fits the existing
// one-click-grid convention once the picker step is factored into the
// button's own `run()`). **Preserved the original's one non-obvious
// business rule exactly, not just the headline preset behavior**: a comp
// named with an unversioned/"_v0N" tag AND labelled red (label 1) gets
// +5 seconds added on top of whatever duration was requested -- a studio
// convention baked into the original script, not something to silently
// drop while porting. Active-comp-only, no file access.
// =============================================================================
const COMP_DURATION_BONUS_REGEX = /_v0\d*|_v(?!\d)/i;

export const setCompDuration = (seconds: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    app.beginUndoGroup("Change Comp Duration");

    let secs = seconds;
    if (COMP_DURATION_BONUS_REGEX.test(comp.name) && comp.label === 1) secs += 5;

    const displayFrameRate = Math.round(comp.frameRate);
    const totalFrames = secs * displayFrameRate;
    comp.duration = totalFrames * comp.frameDuration;

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// DRQR -- ported from toolset/XYi_DRQR.jsx, wired to the "DRQR" button.
// Automatically scales a small active comp up to double (under 1000px) or
// quad (under 500px) resolution for a better preview, using the same
// null-parent scale-to-fit technique as XYi_Scaler.jsx's onScaleClick(),
// then runs the per-layer post-pass above (see its own comment for the
// selectedLayers[1] bug this deliberately reproduces).
// =============================================================================
export const drqr = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    if (!/\d+x\d+/.test(comp.name)) return { success: false, error: "Comp name doesn't match the expected WxH naming convention." };

    app.beginUndoGroup("XYi DRQR");
    const width = comp.width;
    const height = comp.height;

    // Suffix strings come from the shared constants (defined near
    // renameMainComp) so DRQR and the tools that READ the suffix can never
    // drift. Values are byte-identical to the original literals -- behaviour
    // unchanged, just single-sourced.
    if (width < 500 && height < 500) {
      comp.name += RES_QUAD_SUFFIX;
      scaleCompToFit(comp, comp.width * 4, comp.height * 4);
    } else if (width < 1000 && height < 1000) {
      comp.name += RES_DOUBLE_SUFFIX;
      scaleCompToFit(comp, comp.width * 2, comp.height * 2);
    } else {
      app.endUndoGroup();
      return { success: false, error: "Comp is already 1000px or larger in both dimensions -- nothing to do." };
    }

    drqrProcessLayers(comp, comp.width, comp.height);

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Campaign Rename -- ported from toolset/XYI_Campaign_Renamer.jsx, wired to
// the "Campaign Rename" button. Matches PDF filenames against AE project/
// QuickTime files by their shared size (WxH) token -- confirmed with the
// studio this is intentional (PDFs carry the screen name, renders/AE files
// don't yet; size is the shared anchor to line them up) -- then borrows the
// PDF's SITE tokens (parseFilenameMeta's siteName, everything right of the
// artwork type) into the AE-side filename, inserted between the 4-token
// prefix and the resolution-onward suffix.
//
// siteName, NOT campaign. This read meta.campaign, which was the whole
// descriptive part until d0653f6 re-cut it as the creative alone -- correct
// for the frontcard it was fixing, silently wrong here. The AE file's site
// slot then rebuilt from the PDF's CREATIVE, so on a real Colombia folder
// FID_INTL_PortalToParadise_DOOH_MULTIART_1180x228px_10s_CO_V01 rebuilt to
// itself and the exists-loop renamed it ..._V01_copy. Legacy _DGTL_ names
// broke the other way: DOOH is the first descriptive token there, nothing
// sits left of it, campaign came back "" and an empty token spliced in as
// ODY_INTL_DGTL_DOOH__1920x858_10sec_OV.
//
// The 4-token prefix ends ON the artwork type in BOTH conventions
// (FID_INTL_PortalToParadise_DOOH, ODY_INTL_DGTL_DOOH), which is why "right
// of the PDF's artwork type" is exactly "after the AE file's prefix" -- the
// creative stays where it is and only the site is replaced. A shorter name
// caps the prefix at the resolution rather than duplicating it.
//
// Renames in place when exactly one PDF matches an AE file (copy-then-
// verify-then-remove-original, so content is never lost even on the
// fallback path -- .remove() only runs after .copy() has already
// succeeded); duplicates (copies, never removes) when multiple PDFs match
// the same AE file.
// =============================================================================
interface CampaignRenameResult {
  success: boolean;
  error?: string;
  message?: string;
}

export const campaignRename = (): CampaignRenameResult => {
  try {
    const pdfFolder = Folder.selectDialog("Select the PDF folder");
    if (!pdfFolder) return { success: false, error: "No PDF folder selected." };
    const aeFolder = Folder.selectDialog("Select the AE project/QuickTime folder");
    if (!aeFolder) return { success: false, error: "No AE project/QuickTime folder selected." };

    const pdfFiles = pdfFolder.getFiles("*.pdf") as File[];
    const aeFiles = (aeFolder.getFiles() as (File | Folder)[]).filter(
      (f): f is File => f instanceof File && /\.(aep|mov|mp4)$/i.test(f.name)
    );

    interface Parsed {
      file: File;
      size: string;
      /** Everything RIGHT of the artwork type -- see the header note. */
      site: string;
    }

    const pdfData: Parsed[] = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const meta = parseFilenameMeta(pdfFiles[i].name);
      pdfData.push({ file: pdfFiles[i], size: meta.size, site: meta.siteName });
    }

    const aeData: Parsed[] = [];
    for (let j = 0; j < aeFiles.length; j++) {
      const meta = parseFilenameMeta(aeFiles[j].name);
      aeData.push({ file: aeFiles[j], size: meta.size, site: meta.siteName });
    }

    let renamedCount = 0;
    let duplicatedCount = 0;
    let alreadyNamedCount = 0;
    let errorCount = 0;

    for (let p = 0; p < pdfData.length; p++) {
      const pdfSize = pdfData[p].size;
      // ORIGINAL CASING. The .toUpperCase() this replaces was a no-op on the
      // names it was written for -- legacy sites were already caps (HORSE_LOS)
      // -- but the current convention spells them CamelCase, and SalitreWheel
      // is how that site is written in every other name in the tree.
      const rawTokens = pdfData[p].site.split(/[_\s-]+/);
      const pdfTokens: string[] = [];
      for (let rt = 0; rt < rawTokens.length; rt++) {
        if (rawTokens[rt] !== "") pdfTokens.push(rawTokens[rt]);
      }
      // Nothing to borrow: a PDF whose name has no site part cannot contribute
      // one. Splicing the empty string in is what produced ODY_INTL_DGTL_DOOH__
      // 1920x858_10sec_OV.
      if (pdfTokens.length === 0) continue;

      for (let a = 0; a < aeData.length; a++) {
        if (aeData[a].size !== pdfSize) continue;

        const aeFile = aeData[a].file;
        const oldName = aeFile.name;
        const baseName = oldName.replace(/\.[^.]+$/, "");
        const ext = oldName.substring(oldName.lastIndexOf("."));
        const parts = baseName.split("_");

        // THREE DIGITS EACH SIDE, ANCHORED, matching firstSizeToken. `parts`
        // is already split on "_", so the token boundary is free -- but the old
        // /\d{2,4}x\d{2,4}/ still read a JPG_PNG ratio token (_16x9_) as the
        // resolution and cut the name there.
        let resIndex = -1;
        for (let idx = 0; idx < parts.length; idx++) {
          if (/^\d{3,}x\d{3,}(?:px)?$/i.test(parts[idx])) {
            resIndex = idx;
            break;
          }
        }

        let newBase: string;
        if (resIndex !== -1) {
          // Four tokens is the documented prefix (FID_INTL_PortalToParadise_
          // DOOH, ODY_INTL_DGTL_DOOH), and it ends on the artwork type in both
          // conventions -- which is why the PDF's siteName, everything right of
          // ITS artwork type, is exactly what belongs after it. Capped at
          // resIndex so a shorter name cannot splice the resolution in twice.
          const prefixEnd = resIndex < 4 ? resIndex : 4;
          const aePrefix = parts.slice(0, prefixEnd);
          const aeSuffix = parts.slice(resIndex);
          newBase = aePrefix.concat(pdfTokens, aeSuffix).join("_");
        } else {
          newBase = baseName;
          for (let t = 0; t < pdfTokens.length; t++) {
            if (newBase.toUpperCase().indexOf(pdfTokens[t].toUpperCase()) === -1) {
              newBase += "_" + pdfTokens[t];
            }
          }
        }
        const newName = newBase + ext;

        // ALREADY THE RIGHT NAME. Without this, the target path is the file
        // itself, the exists-loop walks past it and the AEP gets renamed to
        // ..._V01_copy.aep -- which is precisely what the whole folder did
        // while this read meta.campaign. Reported rather than silently passed
        // over, so "nothing happened" is a sentence and not a guess.
        if (newName === oldName) {
          alreadyNamedCount++;
          continue;
        }

        const folderPath = aeFile.parent.fsName;
        let targetFile = new File(folderPath + "/" + newName);
        let counter = 1;
        while (targetFile.exists) {
          const suffix = "_copy" + (counter > 1 ? counter : "");
          targetFile = new File(folderPath + "/" + newBase + suffix + ext);
          counter++;
        }

        let matchesCount = 0;
        for (let pp = 0; pp < pdfData.length; pp++) {
          if (pdfData[pp].size === aeData[a].size) matchesCount++;
        }

        if (matchesCount === 1) {
          let renamedOK = false;
          try {
            renamedOK = aeFile.rename(targetFile.name);
          } catch (e) {
            renamedOK = false;
          }

          if (!renamedOK) {
            if (aeFile.copy(targetFile.fsName)) {
              try {
                aeFile.remove();
              } catch (e) {
                // ignore remove errors, matching original
              }
              renamedCount++;
            } else {
              errorCount++;
              continue;
            }
          } else {
            renamedCount++;
          }

          aeData[a].file = targetFile;
        } else {
          if (aeFile.copy(targetFile.fsName)) {
            duplicatedCount++;
          } else {
            errorCount++;
          }
        }
      }
    }

    return {
      success: true,
      message: `Renamed ${renamedCount}, duplicated ${duplicatedCount}${
        alreadyNamedCount > 0 ? `, ${alreadyNamedCount} already named` : ""
      }${errorCount > 0 ? `, ${errorCount} error(s)` : ""}.`,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// MC It! -- ported from toolset/XYi_pingLoc.jsx, wired to the "MC It!"
// button (MCItBut.onClick = pingLoc in XYi_Toolbox.jsx -- NOT the trivial
// XYi_MCIt.jsx alert file the button's name suggests; that file is loaded
// by a same-named but entirely unused MCIt() function nothing calls).
//
// Batch-replaces image footage across a folder of .aep files: for each
// AEP, finds its Footage/{PNG,JPG,JPEG,Images} folder(s) and replaces each
// image footage item with the best-scoring match (resolution + trailing-
// number token match, filtered to the SAME extension type, then the
// shared findBestComponentFile() hybrid scorer) from a second folder of
// images, then saves each project IN PLACE.
//
// **Re-ported to widen scope from PNG-only to PNG+JPG/JPEG**, matching
// the studio's current XYi_pingLoc.jsx -- the old port only ever looked
// inside a single hardcoded "PNG" subfolder and only matched .png files.
// The upgraded source scans multiple candidate folder names (PNG/JPG/
// JPEG/Images) and both extensions, with an explicit same-extension-type
// guard (mcItGetExt()) so a .png footage item can never get replaced by a
// .jpg candidate or vice versa -- that guard wasn't needed before since
// PNG was the only type in play, but is now that both coexist. Also adds
// the source's own $.sleep() pacing between replace()/save() calls (AE UI
// stability on larger batches), which the PNG-only port never had.
//
// Deliberately NOT copy-first, unlike other tools that touch a scanned
// .aep -- confirmed with the studio that this is always run against a
// folder of already-localised, territory-specific working copies, never
// the pristine masters CLAUDE.md's safety rule protects. In-place save is
// the correct, intended behavior here, not an oversight -- don't add a
// copy-first wrapper back without re-confirming real usage first.
// =============================================================================
interface McItParsed {
  firstOne: string;
  secondOne: string;
  thirdOne: string;
  pngNumber: string;
}

function mcItParseFilename(filename: string): McItParsed {
  // ANCHORED, AND THE "px" IS WHAT'S OPTIONAL -- NOT THE "p".
  //
  // This was /\d+x\d+px?/i, which reads as "\d+x\d+" then a REQUIRED "p"
  // then an optional "x". So it only ever fired on the new "1920x1080px"
  // spelling: on a legacy "..._1920x1080_10sec_OV" name nothing stopped the
  // token walk and `firstOne` swallowed the size, the duration and the
  // territory, and on a JPG_PNG name it walked straight past the "9x16" ratio
  // token and welded it onto the identity -- PORTALTOPARADISE_DUFRYEZ_9X16
  // against the deliverable's PORTALTOPARADISE_DUFRYEZ, so the creative filter
  // rejected the one file that was right.
  //
  // Anchored per token so a SITE name keeps its grid: "Hoyts3x3" is part of
  // the identity and must not end the walk (see firstSizeToken).
  const resolutionRegex = /^\d+x\d+(?:px)?$/i;
  let secondOne = "";
  if (filename.indexOf("DOOH") !== -1) secondOne = "DOOH";
  else if (filename.indexOf("DINTH") !== -1) secondOne = "DINTH";
  else if (filename.indexOf("DFOH") !== -1) secondOne = "DFOH";

  const parts = filename.split("_");
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) tokens.push(parts[i]);
  }

  const validTokens: string[] = [];
  for (let j = 0; j < tokens.length; j++) {
    if (resolutionRegex.test(tokens[j])) break;
    validTokens.push(tokens[j]);
  }
  if (validTokens.length > 0) validTokens.shift();

  const finalTokens: string[] = [];
  for (let k = 0; k < validTokens.length; k++) {
    if (validTokens[k] !== secondOne) finalTokens.push(validTokens[k]);
  }
  if (finalTokens.length > 1 && /^[A-Z]{2,4}$/.test(finalTokens[0])) finalTokens.shift();
  if (finalTokens.length > 1 && /^[A-Z]{2}$/.test(finalTokens[finalTokens.length - 1])) finalTokens.pop();

  const firstOne = finalTokens.join("_").toUpperCase();
  // Delimited first, for the same reason as firstSizeToken: a "3x3" welded
  // into a site name is not this file's resolution.
  const thirdOne = firstSizeToken(filename);
  const pngNumberMatch = filename.match(/\d+\./);
  const pngNumber = pngNumberMatch ? pngNumberMatch[0].replace(".", "") : "";

  return { firstOne, secondOne, thirdOne, pngNumber };
}

/** The creative alone, i.e. the first token of the identity. The artwork being
 *  replaced carries the MASTER's identity -- no site token, the master's size
 *  and the master's duration ("..._PortalToParadise_DOOH_3840x586px_10s_OV1")
 *  against a deliverable's "..._PortalToParadise_DOOH_DufryEZ_512x96px_15s" --
 *  so only the creative is common to both. Comparing the whole identity would
 *  reject the very case this tool exists for. */
function mcItCreativeOf(identity: string): string {
  const bits = String(identity || "").split("_");
  return mcItNormaliseIdentity(bits.length > 0 ? bits[0] : "");
}

/** Separators and case dropped, so PortalToParadise and PORTAL_TO_PARADISE are
 *  the same creative and Trio is not. */
function mcItNormaliseIdentity(name: string): string {
  return String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The project's OWN top-level folder of this name.
 *
 * `app.project.item(i)` enumerates every item at EVERY depth, flat, so
 * "the first FolderItem called Footage" is not the project's Footage -- it is
 * whichever one the enumeration reaches first, and an imported sibling project
 * brings its own. Measured in a real Brazil working copy: four folders named
 * Footage, and the winner was #30, inside the imported
 * FID_INTL_Portal_2L_DATE_BR_RGB.aep, holding a single stray logo PNG. The
 * project's own Footage -- six PNGs, nine Artwork items -- was #60 and was
 * never looked at, so MC It! reported "0/1 replaced" on eleven projects and
 * every filter downstream got blamed for it.
 *
 * CLAUDE.md already records this hazard for comps ("exclude comps whose
 * ancestor folder name ends .aep"); it applies to folders identically.
 *
 * Root is identified by `parentFolder` being null on the root folder itself,
 * NOT by its name -- "Root" is a display name and display names are the thing
 * that changes between AE versions and languages.
 */
export function ownProjectFolder(proj: Project, name: string): FolderItem | null {
  let fallback: FolderItem | null = null;
  for (let i = 1; i <= proj.numItems; i++) {
    const item = proj.item(i) as FolderItem;
    // Duck-typed rather than `instanceof FolderItem`: numItems is the property
    // we are about to use, and CompItem/FootageItem do not have it.
    if (typeof (item as any).numItems !== "number") continue;
    if (item.name !== name) continue;
    const parent = item.parentFolder;
    if (parent && !parent.parentFolder) return item;
    // A project that nests its Footage is unusual but not wrong; take the
    // first such folder ONLY if it is not inside an imported project.
    if (!fallback && !underImportedProject(item)) fallback = item;
  }
  return fallback;
}

/** True when any ancestor folder is an imported `.aep`'s own tree. */
function underImportedProject(item: Item): boolean {
  let f = item.parentFolder;
  let guard = 0;
  while (f && f.parentFolder && guard < 50) {
    const n = String(f.name).toLowerCase();
    if (n.length > 4 && n.substring(n.length - 4) === ".aep") return true;
    f = f.parentFolder;
    guard++;
  }
  return false;
}

/**
 * The CREATIVE token of a master or deliverable filename.
 *
 *   FID_INTL_Trio_DOOH_Ingresso_1920x1080px_10s_BR  ->  "TRIO"
 *   FID_INTL_PortalToParadise_DOOH_3840x586px_10s_OV1 -> "PORTALTOPARADISE"
 *
 * One wrapper over the two functions MC It! already uses, exported so the
 * workflow board identifies a creative EXACTLY the way the localiser does. A
 * second parser here would drift, and the drift would show as "no workflow for
 * this creative" on a creative that has one -- which is indistinguishable from
 * nobody having written it yet.
 */
export function creativeTokenOf(filename: string): string {
  return mcItCreativeOf(mcItParseFilename(String(filename || "")).firstOne);
}

function mcItGetAllImageFiles(folder: Folder): File[] {
  const out: File[] = [];
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item instanceof Folder) {
      out.push(...mcItGetAllImageFiles(item));
    } else if (item instanceof File && /\.(png|jpe?g)$/i.test(item.name)) {
      out.push(item);
    }
  }
  return out;
}

// Strict extension check (not just "is this an image") so a .png footage
// item is never replaced with a .jpg candidate or vice versa -- .jpg/.jpeg
// count as the same type as each other, matching the source's own
// isSameType check.
function mcItGetExt(filename: string): string {
  const match = filename.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

// Structured run report, returned through the CEP bridge so the panel can
// render a proper results modal (replaces the old Desktop .txt diagnostic).
export interface McItItemReport {
  folder: string; // project subfolder ("PNG", "Artwork", ...)
  name: string; // original footage filename
  action: "replaced" | "no-match" | "skipped";
  newName?: string; // for "replaced"
  reason?: string; // for "no-match" / "skipped"
  // Stable per-item id (folder|name) the preview modal keys a MANUAL override
  // by. Sent back into mcIt()'s overridesJson so the real run replaces exactly
  // the item the user fixed, without re-deriving anything from the report text.
  key?: string;
  // Dry run + "no-match" only: plausible files from the image folder, so the
  // user can fix a misspelling by hand instead of the item silently being
  // dropped. Ranked (see mcItRankCandidates) and capped -- a suggestion list,
  // not a second matcher: nothing here is ever applied automatically.
  candidates?: { name: string; path: string }[];
  // true when this replacement came from a user override rather than the
  // matcher, so the modal (and the run report) can say so.
  manual?: boolean;
}

export interface McItProjectReport {
  aep: string;
  resolution: string; // parsed from the AEP filename
  skipped?: string; // project-level skip reason (couldn't open / no Footage...)
  items: McItItemReport[];
}

interface McItResult {
  success: boolean;
  error?: string;
  message?: string;
  aepFolder?: string;
  imageFolder?: string;
  imageCount?: number;
  processed?: number;
  replaced?: number;
  projects?: McItProjectReport[];
  finishedAt?: string;
  runId?: string; // unique per run -- lets the panel suppress re-shows
  dryRun?: boolean; // preview pass: nothing replaced, nothing saved
}

// <Territory>/AE/Batch_01 -> the matching <Territory>/JPG_PNG batch folder.
// Batch names differ in zero-padding across the tree (AE/Batch_01 vs
// JPG_PNG/Batch_1), so compare on a canonical form (alphanumerics only,
// leading zeros stripped from digit runs). Returns "" when the layout
// doesn't match -- caller falls back to a picker.
function mcItDeriveImageFolder(aepFolder: Folder): string {
  const parent = aepFolder.parent; // .../<Territory>/AE
  if (!parent) return "";
  if (String(parent.name).toUpperCase() !== "AE") return "";
  const territory = parent.parent; // .../<Territory>
  if (!territory) return "";
  const jpgRoot = new Folder(territory.fsName + "/JPG_PNG");
  if (!jpgRoot.exists) return "";

  const canon = (s: string) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/0+(\d)/g, "$1");
  const want = canon(decode(aepFolder.name));

  const kids = jpgRoot.getFiles();
  const folders: Folder[] = [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (typeof (k as any).getFiles !== "function") continue;
    if (String(k.name).charAt(0) === "_") continue;      // _Old, _Delivered
    folders.push(k as Folder);
  }

  // Exact first, and it stays the only thing that can win outright.
  for (let i = 0; i < folders.length; i++) {
    if (canon(decode(folders[i].name)) === want) return folders[i].fsName;
  }

  // A SUFFIXED BATCH IS STILL THAT BATCH. Real tree: AE/Batch_1 beside
  // JPG_PNG/Batch_1_PRE, which failed outright and swapped no footage at all.
  // The suffix says something about the batch (a pre-run, a re-cut); it does
  // not make it a different one.
  //
  // THE NEXT CHARACTER MUST NOT BE A DIGIT, or "Batch_1" would match
  // "Batch_10" -- canon strips the separators, so the two are one character
  // apart and the wrong pairing swaps another batch's artwork in.
  const hits: Folder[] = [];
  for (let i = 0; i < folders.length; i++) {
    const have = canon(decode(folders[i].name));
    let prefixed = false;
    if (have.length > want.length && have.substring(0, want.length) === want) {
      prefixed = "0123456789".indexOf(have.charAt(want.length)) === -1;
    }
    // And the other way round: AE/Batch_1_PRE beside JPG_PNG/Batch_1.
    if (!prefixed && want.length > have.length && want.substring(0, have.length) === have) {
      prefixed = "0123456789".indexOf(want.charAt(have.length)) === -1;
    }
    if (prefixed) hits.push(folders[i]);
  }
  // Exactly one, or none: two candidates is a question, and guessing at it
  // would put another batch's artwork into a finished deliverable.
  if (hits.length === 1) return hits[0].fsName;
  return "";
}

// Suggestion list for an item the matcher could NOT place -- shown in the dry
// run modal so a misspelt/oddly-named file can be fixed by hand.
//
// DELIBERATELY NOT findBestComponentFile(): that function answers "which ONE
// file is the match", exposes no score, and is the load-bearing matcher three
// tools depend on -- refactoring it to also rank would put real replacement
// behaviour at risk for a cosmetic list. This is a cheap, self-contained
// ordering (same extension first, then the AEP's resolution, then the trailing
// number, then shared name tokens) whose only job is to put the likely file
// near the top of ~8 options the user reads anyway. Nothing here is ever
// applied automatically.
function mcItRankCandidates(originalName: string, parsedAEP: McItParsed, imageFiles: File[], limit: number): { name: string; path: string }[] {
  const originalExt = mcItGetExt(originalName);
  const parsedOriginal = mcItParseFilename(originalName);

  function tokensOf(s: string): string[] {
    const cleaned = String(s || "").toLowerCase().replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^a-z0-9]+/g, " ");
    const parts = cleaned.split(" ");
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].length > 1) out.push(parts[i]);
    }
    return out;
  }
  const origTokens = tokensOf(originalName);

  const scored: { name: string; path: string; score: number }[] = [];
  for (let i = 0; i < imageFiles.length; i++) {
    const cand = imageFiles[i];
    const candExt = mcItGetExt(cand.name);
    const origIsJpg = originalExt === "jpg" || originalExt === "jpeg";
    const candIsJpg = candExt === "jpg" || candExt === "jpeg";
    let isSameType = originalExt === candExt;
    if (!isSameType) isSameType = origIsJpg && candIsJpg;
    // Cross-type files are never offered: replacing a .png footage item with a
    // .jpg is the one thing MC It! has always refused outright, and offering it
    // by hand here would quietly reintroduce it.
    if (!isSameType) continue;

    const parsedCand = mcItParseFilename(cand.name);
    let score = 0;
    if (parsedAEP.thirdOne && parsedCand.thirdOne === parsedAEP.thirdOne) score += 100;
    if (parsedOriginal.pngNumber && parsedCand.pngNumber === parsedOriginal.pngNumber) score += 40;
    const candTokens = tokensOf(cand.name);
    for (let a = 0; a < origTokens.length; a++) {
      for (let b = 0; b < candTokens.length; b++) {
        if (origTokens[a] === candTokens[b]) { score += 1; break; }
      }
    }
    scored.push({ name: cand.name, path: cand.fsName, score: score });
  }

  // Plain insertion sort (small n, and Array.sort's comparator behaviour is
  // one more thing not worth trusting in this engine).
  for (let i = 1; i < scored.length; i++) {
    const cur = scored[i];
    let j = i - 1;
    while (j >= 0 && scored[j].score < cur.score) {
      scored[j + 1] = scored[j];
      j--;
    }
    scored[j + 1] = cur;
  }

  const out: { name: string; path: string }[] = [];
  for (let i = 0; i < scored.length && i < limit; i++) out.push({ name: scored[i].name, path: scored[i].path });
  return out;
}

// The per-project half of MC It!, extracted so it can run against a project
// that is ALREADY OPEN. Two callers:
//   1. mcIt() below -- opens each .aep itself, then calls this (unchanged
//      behaviour; this is a pure extraction, not a rewrite).
//   2. csvLocaliserRun() (localise.ts) -- the generated working copy is
//      already open and about to be saved, so the swap happens in that same
//      session instead of costing a second open/save cycle per file.
// Does NOT open, save or close anything -- the caller owns the project's
// lifecycle. `aepFileName` is the filename the resolution token is parsed
// from (mcItParseFilename finds \d+x\d+ anywhere in it), NOT a path.
// `overrides` maps an item key (folder + "|" + original filename, the same
// `key` the report carries) to an absolute image path the USER picked in the
// preview modal. An override wins over the matcher outright -- that is the
// point: it exists for the cases the matcher got wrong or couldn't place.
export function mcItApplyToOpenProject(
  proj: Project,
  aepFileName: string,
  imageFiles: File[],
  dryRun?: boolean,
  overrides?: Record<string, string>
): McItProjectReport {
  const parsedAEP = mcItParseFilename(aepFileName);
  const projReport: McItProjectReport = { aep: aepFileName, resolution: parsedAEP.thirdOne || "", items: [] };

  // THE PROJECT'S OWN Footage, not an imported sibling's -- see
  // ownProjectFolder, which is the whole reason this tool reported
  // "0 would be replaced" across a batch.
  const footageFolder = ownProjectFolder(proj, "Footage");
  if (!footageFolder) {
    projReport.skipped = "No project folder named exactly 'Footage'.";
    return projReport;
  }

  // "Artwork" added beyond the original pingLoc list: campaign projects
  // keep their mechanical PSDs plus the raster poster (a lone
  // "...MotionPoster_..._OVn.jpg/png") in Footage/Artwork, which neither
  // MC It! nor JPEG Loc used to scan -- so that JPG never got localised.
  // Safe to include: only .png/.jpe?g footage items are considered below
  // (PSDs untouched), and the same-type guard still applies.
  const targetFolders: FolderItem[] = [];
  for (let i = 1; i <= footageFolder.numItems; i++) {
    const item = footageFolder.item(i);
    if (item instanceof FolderItem && (item.name === "PNG" || item.name === "JPG" || item.name === "JPEG" || item.name === "Images" || item.name === "Artwork")) {
      targetFolders.push(item);
    }
  }
  if (targetFolders.length === 0) {
    projReport.skipped = "No PNG/JPG/JPEG/Images/Artwork subfolder inside 'Footage'.";
    return projReport;
  }

  for (let tf = 0; tf < targetFolders.length; tf++) {
    const targetFolder = targetFolders[tf];
    // Artwork is a MIXED folder (mechanical PSDs, textures, grabs...), so
    // unlike the dedicated PNG/JPG folders -- where everything is a target
    // by design -- only items whose filename carries an OV token ("_OV.",
    // "_OV_", "_OV3.") are considered there. Without this, ANY stray
    // numbered JPG (e.g. "Sky_Grade_2.jpg") would pass the trailing-number
    // filter and get silently swapped for a localised poster, because the
    // fuzzy matcher's accept-threshold is a no-op (inherited 1:1 from
    // XYi_Detectives.jsx) and never vetoes on name dissimilarity.
    // Deliberately NOT hasIsolatedOvToken(): that helper rejects "OV3"
    // (digits after OV), and changing it would alter copy-first decisions
    // in losOpenForEdit()/jpegLoc(). Scoped to Artwork so re-running on an
    // already-localised project (footage renamed "..._HU1.png", no OV
    // left) still re-matches fine in the dedicated folders.
    const isArtworkFolder = targetFolder.name === "Artwork";
    for (let j = 1; j <= targetFolder.numItems; j++) {
      const footageItem = targetFolder.item(j) as FootageItem;
      if (footageItem.file && /\.(png|jpe?g)$/i.test(footageItem.file.name)) {
        const itemKey = targetFolder.name + "|" + footageItem.file.name;
        const overridePath = overrides ? overrides[itemKey] : undefined;

        // A manual override bypasses EVERY filter below, including the
        // Artwork OV-token gate -- the user has looked at this exact item and
        // named the exact file, which is a stronger signal than any heuristic
        // here. The one thing it can't bypass is the file not existing.
        if (overridePath) {
          const chosen = new File(overridePath);
          if (!chosen.exists) {
            projReport.items.push({
              folder: targetFolder.name,
              name: footageItem.file.name,
              action: "no-match",
              reason: "The file you picked no longer exists: " + overridePath,
              key: itemKey,
            });
            continue;
          }
          if (!dryRun) {
            footageItem.replace(chosen);
            $.sleep(500);
          }
          projReport.items.push({
            folder: targetFolder.name,
            name: footageItem.file.name,
            action: "replaced",
            newName: chosen.name,
            manual: true,
            key: itemKey,
          });
          continue;
        }

        if (isArtworkFolder && !/(^|[_\s])OV\d*[_\s.]/i.test(footageItem.file.name)) {
          projReport.items.push({
            folder: targetFolder.name,
            name: footageItem.file.name,
            action: "skipped",
            reason: "No OV token — not a localisation target.",
            key: itemKey,
          });
          continue;
        }
        const originalName = footageItem.file.name;
        const originalExt = mcItGetExt(originalName);
        const parsedOriginal = mcItParseFilename(originalName);

        // IS THIS FOOTAGE EVEN A LOCALISATION TARGET?
        //
        // A dedicated PNG/JPG folder is NOT all targets, which is the
        // assumption this tool shipped with. The real one, measured:
        //
        //   402065-1_K1c_006_FORGOTTEN_ISLAND_Logo_..._OutlinewGlow.png
        //   402065-1_K1c_006_FORGOTTEN_ISLAND_Logo_..._OutlinewGlow_1.png
        //   402065-1_K1c_006_FORGOTTEN_ISLAND_Logo_..._OutlinewGlow_REV.png
        //   Asset 1@4x.png
        //   FID_INTL_PortalToParadise_DOOH_3840x586px_10s_OV1.png   <- target
        //   FID_INTL_PortalToParadise_DOOH_3840x586px_10s_OV2.png   <- target
        //
        // Four design elements beside the two artwork slots, and the "_1" on
        // that logo is the trailing number the matcher pairs on -- so without
        // this gate it is swapped for the deliverable's _BR1 export and
        // reported as a clean replacement.
        //
        // THE CREATIVE ONLY. The target carries the MASTER's identity: no site
        // token, the master's size, the master's duration. PORTALTOPARADISE is
        // all it shares with PORTALTOPARADISE_DUFRYEZ, and it is enough --
        // K1C and an unparseable "Asset 1@4x" are both rejected by it.
        //
        // SKIPPED, not no-match: these files are not this deliverable's
        // artwork and never will be, so they are not a failure to report. The
        // preview's count reads "2/2 replaced" rather than "2/6" with four red
        // warnings that mean nothing.
        //
        // (Briefly removed on the strength of a preview that showed only the
        // logo. That preview was reading an IMPORTED SIBLING PROJECT's Footage
        // folder -- see ownProjectFolder -- and the project's own artwork was
        // never in it. The filter was never the problem.)
        const aepCreativeToken = mcItCreativeOf(parsedAEP.firstOne);
        const origCreativeToken = mcItCreativeOf(parsedOriginal.firstOne);
        if (aepCreativeToken !== "" && origCreativeToken !== aepCreativeToken) {
          projReport.items.push({
            folder: targetFolder.name,
            name: originalName,
            action: "skipped",
            reason: "Not this deliverable's artwork — it is "
              + (parsedOriginal.firstOne || "unnamed") + ", the deliverable is "
              + parsedAEP.firstOne + ".",
            key: itemKey,
          });
          continue;
        }

        // Count how many candidates survive each successive filter, so the
        // log shows exactly which filter is the wall.
        let cSameType = 0;
        let cPlusRes = 0;
        let cPlusCreative = 0;
        const creativesSeen: string[] = [];
        const resSeenSameType: string[] = [];
        const validCandidates: File[] = [];
        for (let k = 0; k < imageFiles.length; k++) {
          const candidate = imageFiles[k];
          const candidateExt = mcItGetExt(candidate.name);
          const parsedCandidate = mcItParseFilename(candidate.name);
          // ExtendScript BUG (root cause of "sameType=0 with 24 png
          // candidates on disk"): the engine evaluates `A || B && C`
          // LEFT-TO-RIGHT as `(A || B) && C`, not standard JS's
          // `A || (B && C)`. The TS source had correct parentheses, but
          // Babel strips redundant parens on emit, so the one-line
          // `ext === ext || (jpgFamily && jpgFamily)` compiled into the
          // broken form and returned FALSE for png===png. Keep this as
          // separate statements -- never a mixed ||/&& expression.
          const origIsJpg = originalExt === "jpg" || originalExt === "jpeg";
          const candIsJpg = candidateExt === "jpg" || candidateExt === "jpeg";
          let isSameType = originalExt === candidateExt;
          if (!isSameType) isSameType = origIsJpg && candIsJpg;
          if (!isSameType) continue;
          cSameType++;
          if (parsedCandidate.thirdOne && resSeenSameType.join(",").indexOf(parsedCandidate.thirdOne) === -1) resSeenSameType.push(parsedCandidate.thirdOne);
          if (parsedAEP.thirdOne !== parsedCandidate.thirdOne) continue;
          cPlusRes++;

          // THE CANDIDATE HAS TO BE FOR THIS DELIVERABLE'S CREATIVE.
          //
          // Nothing above this line looks at WHICH creative a file belongs to:
          // same file type, same resolution and same trailing number were the
          // whole test. On a PortalToParadise deliverable that let
          // FID_INTL_Trio_..._IT1.png through every filter -- it is a PNG, it
          // is 1920x1080, it ends in 1 -- and findBestComponentFile then took
          // it, because its accept threshold is 0.01 and an unrelated logo
          // resembles both candidates equally badly. The result was another
          // creative's artwork inside a finished deliverable, reported as a
          // clean replacement.
          //
          // `firstOne` is the creative and site tokens the parser already
          // extracts, so this is an exact comparison of the thing that
          // identifies a deliverable, not another guess on top of the guessing.
          const candCreative = mcItNormaliseIdentity(parsedCandidate.firstOne);
          const aepCreative = mcItNormaliseIdentity(parsedAEP.firstOne);
          if (creativesSeen.join(",").indexOf(parsedCandidate.firstOne) === -1) {
            creativesSeen.push(parsedCandidate.firstOne);
          }
          if (aepCreative !== "" && candCreative !== aepCreative) continue;
          cPlusCreative++;

          // THE ARTWORK SLOT, AND NO NUMBER IS ITSELF A SLOT.
          //
          // "..._OV2.png" is replaced by "..._BR2.png", and "..._OV.jpg" by
          // "..._BR.jpg" -- the absence of a number is as much a slot as a "2",
          // so this stays an EXACT comparison. Measured against the real Batch_2
          // mech output, where the jpg candidates for one deliverable are
          // _BR.jpg, _BR2.jpg, _BR_ARTWORK_1.jpg and _BR_ARTWORK_2.jpg:
          // exact equality picks _BR.jpg for the unnumbered original and leaves
          // nothing to guess at. Relaxing it to "skip the filter when the
          // original has no number" turned that one exact answer into four
          // candidates and a question.
          if (parsedOriginal.pngNumber !== parsedCandidate.pngNumber) continue;
          validCandidates.push(candidate);
        }

        const bestFile = findBestComponentFile(originalName, validCandidates);
        if (bestFile) {
          if (!dryRun) {
            footageItem.replace(bestFile);
            $.sleep(500);
          }
          projReport.items.push({
            folder: targetFolder.name,
            name: originalName,
            action: "replaced",
            newName: bestFile.name,
            key: itemKey,
          });
        } else {
          let reason = "No candidate survived the filters.";
          if (cSameType === 0) reason = "No same-type (" + originalExt + ") candidate in the image folder.";
          else if (cPlusRes === 0) reason = "No candidate at the AEP's resolution " + (parsedAEP.thirdOne || "?") + " — sizes seen: " + resSeenSameType.join(", ") + ".";
          else if (cPlusCreative === 0) reason = "No candidate for " + (parsedAEP.firstOne || "this deliverable")
            + " at that resolution — found " + creativesSeen.join(", ") + ".";
          else if (validCandidates.length === 0) reason = "No candidate for artwork slot '" + (parsedOriginal.pngNumber || "<none>") + "' at that resolution.";
          projReport.items.push({
            folder: targetFolder.name,
            name: originalName,
            action: "no-match",
            reason: reason,
            key: itemKey,
            // Only on a dry run: the real run's report is a record of what
            // happened, and every unmatched item carrying 8 paths would bloat
            // the persisted JSON for no one to read.
            candidates: dryRun ? mcItRankCandidates(originalName, parsedAEP, imageFiles, 8) : undefined,
          });
        }
      }
    }
  }

  return projReport;
}

// Count "replaced" entries in a project report -- both callers tally the
// same way, so the counting rule lives in one place.
export function mcItCountReplaced(report: McItProjectReport): number {
  let n = 0;
  for (let i = 0; i < report.items.length; i++) {
    if (report.items[i].action === "replaced") n++;
  }
  return n;
}

// Exposed for csvLocaliserRun(), which derives the same
// <Territory>/AE/<Batch> -> <Territory>/JPG_PNG/<Batch> mapping and gathers
// the candidate images ONCE for the whole run rather than per generated file.
export function mcItCollectImages(folder: Folder): File[] {
  return mcItGetAllImageFiles(folder);
}

export function mcItDeriveImageFolderFor(aepFolder: Folder): string {
  return mcItDeriveImageFolder(aepFolder);
}

// aepFolderPath/imageFolderPath skip the dialogs when the caller already
// knows them (the CSV Localiser scan UI passes both per batch). With no
// image path, the standard tree layout is tried first
// (<Territory>/AE/Batch_01 -> <Territory>/JPG_PNG/Batch_1) and the dialog
// only appears when derivation fails. dryRun walks the identical matching
// logic but replaces/saves NOTHING -- the report comes back flagged so the
// modal can offer "Apply".
// onlyAepsJson: a JSON array of .aep FILENAMES to restrict this run to, sent
// by the preview modal when the user has unticked some projects. Omitted (or
// an empty array) means "every .aep in the folder", so every existing caller
// -- Toolset's card, Campaign Localiser, the CSV Localiser's inline pass --
// is unaffected. Filenames, not paths: they come straight back from the
// report the dry run produced for this same folder.
// overridesJson: { "<file.aep>": { "<folder>|<original.png>": "/abs/path.png" } }
// -- the manual fixes the user made in the preview modal for items the matcher
// couldn't place. Absent for every other caller, so nothing else changes.
export const mcIt = (aepFolderPath?: string, imageFolderPath?: string, dryRun?: boolean, onlyAepsJson?: string, overridesJson?: string): McItResult => {
  try {
    let projectFolder: Folder | null = null;
    if (aepFolderPath) {
      const f = new Folder(aepFolderPath);
      if (!f.exists) return { success: false, error: "AEP folder not found: " + aepFolderPath };
      projectFolder = f;
    } else {
      projectFolder = Folder.selectDialog("Select a folder containing After Effects Project files");
    }
    if (!projectFolder) return { success: false, error: "No project folder selected." };
    let aepFiles = (projectFolder.getFiles() as (File | Folder)[]).filter((f): f is File => f instanceof File && /\.aep$/i.test(f.name));
    if (aepFiles.length === 0) return { success: false, error: "No AEP files found in that folder." };

    // Restrict to the projects the user kept ticked in the preview, if any.
    if (onlyAepsJson) {
      let only: string[] = [];
      try { only = JSON.parse(onlyAepsJson) as string[]; } catch (parseErr) { only = []; }
      if (only.length > 0) {
        const keep: File[] = [];
        for (let i = 0; i < aepFiles.length; i++) {
          for (let j = 0; j < only.length; j++) {
            if (String(only[j]) === String(aepFiles[i].name)) { keep.push(aepFiles[i]); break; }
          }
        }
        aepFiles = keep;
        if (aepFiles.length === 0) return { success: false, error: "None of the selected projects were found in that folder." };
      }
    }

    let overrides: Record<string, Record<string, string>> = {};
    if (overridesJson) {
      try { overrides = JSON.parse(overridesJson) as Record<string, Record<string, string>>; } catch (ovErr) { overrides = {}; }
    }

    let imageRootFolder: Folder | null = null;
    if (imageFolderPath) {
      const f = new Folder(imageFolderPath);
      if (!f.exists) return { success: false, error: "Image folder not found: " + imageFolderPath };
      imageRootFolder = f;
    } else {
      const derived = mcItDeriveImageFolder(projectFolder);
      if (derived) imageRootFolder = new Folder(derived);
      else imageRootFolder = Folder.selectDialog("Select a folder containing Image files (PNG/JPG) (search includes subfolders)");
    }
    if (!imageRootFolder) return { success: false, error: "No Image folder selected." };
    const imageFiles = mcItGetAllImageFiles(imageRootFolder);
    if (imageFiles.length === 0) return { success: false, error: "No Image files found in " + imageRootFolder.fsName };

    let processedCount = 0;
    let changedCount = 0;   // projects with at least one replacement
    let replacedCount = 0;

    // Structured run report. Accumulated in this script-scope array (survives
    // every app.open()/proj.save() in the loop -- ExtendScript vars aren't
    // reset by opening a project) and returned through the bridge at the end,
    // where the panel renders it as a results modal. Each footage item records
    // where its candidates dropped off (same-type -> +resolution -> +number),
    // which pinpoints why a swap didn't happen.
    const projects: McItProjectReport[] = [];

    for (let p = 0; p < aepFiles.length; p++) {
      const aepFile = aepFiles[p];

      const proj = app.open(aepFile);
      if (!proj) {
        projects.push({ aep: aepFile.name, resolution: mcItParseFilename(aepFile.name).thirdOne || "", items: [], skipped: "Could not open this project." });
        continue;
      }

      // Identical matching/replacement logic the CSV Localiser's inline pass
      // uses -- shared, not duplicated (see mcItApplyToOpenProject above).
      const projReport = mcItApplyToOpenProject(proj, aepFile.name, imageFiles, dryRun, overrides[aepFile.name]);
      projects.push(projReport);
      const thisProject = mcItCountReplaced(projReport);
      replacedCount += thisProject;
      // Counted separately from processedCount, which is every project that
      // OPENED. A project can process cleanly and change nothing, so reporting
      // "N images across <processed> projects" reads as though the work were
      // spread over all of them -- 20 images across 11 projects, while the
      // Apply button correctly offered 8. Two right numbers describing
      // different sets, one of them worded as if it described the other.
      if (thisProject > 0) changedCount++;

      if (projReport.skipped) continue;

      if (!dryRun) {
        proj.save();
        $.sleep(1500);
      }
      processedCount++;
    }

    const result: McItResult = {
      success: true,
      message: dryRun
        ? "Dry run — would replace " + replacedCount + " image(s) in " + changedCount + " of " + processedCount + " project(s). Nothing was saved."
        : "Replaced " + replacedCount + " image(s) in " + changedCount + " of " + processedCount + " project(s).",
      aepFolder: projectFolder.fsName,
      imageFolder: imageRootFolder.fsName,
      imageCount: imageFiles.length,
      processed: processedCount,
      replaced: replacedCount,
      projects: projects,
      finishedAt: new Date().toString(),
      runId: "" + new Date().getTime(),
      dryRun: !!dryRun,
    };

    // Persist the report before returning: a long batch outlives a closed
    // panel (the ExtendScript keeps running inside AE, but the evalTS callback
    // lands in a destroyed page and the result is lost). The panel's poller
    // recovers it. Dry runs persist too -- their callback can be lost the
    // same way, the modal clearly labels them, and Apply still works because
    // the report carries both folder paths.
    try {
      const dir = new Folder(Folder.userData.fsName + "/XYiToolbox");
      if (!dir.exists) dir.create();
      const f = new File(dir.fsName + "/mcit_last_report.json");
      f.encoding = "UTF-8";
      if (f.open("w")) {
        f.write(JSON.stringify(result));
        f.close();
      }
    } catch (e) {
      /* persistence must never break the run */
    }

    return result;
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// "Choose a file…" in the preview modal, for an unmatched item whose right
// image isn't in the suggestion list at all (a misspelling far enough off, or
// a file living outside the derived batch folder). Returns the picked path so
// the modal can add it as an override; a cancel is success:true with no file,
// not an error.
export const mcItPickImage = (startFolder?: string): { success: boolean; path?: string; name?: string; error?: string } => {
  try {
    let start: Folder | null = null;
    if (startFolder) {
      const f = new Folder(startFolder);
      if (f.exists) start = f;
    }
    const picked = start
      ? start.openDlg("Pick the image to use", undefined, false)
      : File.openDialog("Pick the image to use");
    const file = picked instanceof Array ? picked[0] : picked;
    if (!file) return { success: true };
    if (!/\.(png|jpe?g)$/i.test(file.name)) return { success: false, error: "Pick a PNG or JPG — got " + file.name };
    return { success: true, path: file.fsName, name: file.name };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Panel-side recovery for a run that finished while the panel was closed.
export const mcItLoadLastReport = (): { success: boolean; json?: string } => {
  try {
    const f = new File(Folder.userData.fsName + "/XYiToolbox/mcit_last_report.json");
    if (!f.exists) return { success: true };
    if (!f.open("r")) return { success: true };
    f.encoding = "UTF-8";
    const json = f.read();
    f.close();
    if (json === "") return { success: true };
    return { success: true, json: json };
  } catch (e) {
    return { success: false };
  }
};

export const mcItClearLastReport = (): { success: boolean } => {
  try {
    const f = new File(Folder.userData.fsName + "/XYiToolbox/mcit_last_report.json");
    if (f.exists) f.remove();
    return { success: true };
  } catch (e) {
    return { success: false };
  }
};

// =============================================================================
// Campaign Localiser (Generate Files / Generate Files, don't replace) --
// ported from toolset/XYi_Campaign_Scanner.jsx's campLoc(path, sartre,
// false), wired to the "Generate Files"/"Generate Files but don't replace"
// buttons. Confirmed with the studio: this tool intentionally reads real
// master .aep files (the "Master/loc folder" is the actual masters root)
// and its logic is preserved EXACTLY as the original, including opening
// the matched master directly via app.open() rather than importFile() --
// NOT a copy-first wrapper. This is safe in practice because the result is
// always saved to a brand-new file (<newCompName>_V01.aep) in the
// LOCALISATION FILE's folder (the per-market output folder), never back
// to the master's own path, and the in-memory project is closed with
// CloseOptions.DO_NOT_SAVE_CHANGES afterward -- the master's bytes on disk
// are never modified. If this logic is ever changed to save in place,
// that would become a real violation; don't add one.
//
// Flow: prompts for the masters root folder, then a "localisation file"
// (comma-separated lines: artworkType,campaign,WIDTHxHEIGHT,duration --
// this is the "CSV" in studio parlance, though it's read as plain text,
// not parsed as formal CSV). For each line: finds the best-matching
// master by campaign+duration+closest-aspect-ratio (scanMastersForBestMatch,
// ported from toolset/XYI_Scan.jsx), opens it, duplicates+rescales its
// comp to the target size via the same null-parent technique as
// scaleCompToFit/DRQR (reusing makeParentLayerOfAllUnparented/
// scaleAllCameraZooms already defined above), runs the same Cheeky T
// Check + DRQR this project already ported (reused directly, not
// reimplemented) on the result, removes the old comp, and saves to the
// new per-market file.
// =============================================================================
// Does `path` name a master of this duration? Replaces a bare
// `path.indexOf(duration)`, which had TWO problems:
//
//  1. It was an UNBOUNDED substring test, so a 5-second row false-matched a
//     15-second master ("5sec" is inside "15sec") -- a real bug that existed
//     for as long as this function has.
//  2. It only ever matched the "sec" form. Masters are not renamed today, but
//     if they ever move to the new "<n>s" convention this silently stops
//     finding them, and the failure looks like "no master matched" rather
//     than anything pointing here.
//
// Accepts BOTH conventions and requires the digits not to be preceded by
// another digit, which is exactly what kills the 5-vs-15 false match. The
// TRAILING side is deliberately left loose (any non-digit) rather than
// requiring a clean separator: a real master named "..._10secOV.aep" with no
// separator still matches, so this can only ever REMOVE matches where the
// duration was preceded by a digit -- i.e. matches that were wrong anyway.
//
// An empty duration means "no duration constraint" and matches everything,
// preserving what `path.indexOf("")` did before.
export function durationMatchesPath(path: string, duration: string): boolean {
  const digits = String(duration == null ? "" : duration).match(/\d+/);
  if (!digits) return true;
  const re = new RegExp("(^|[^0-9])" + digits[0] + "s(ec)?([^0-9]|$)", "i");
  return re.test(path);
}

// One entry per candidate master, built by ONE walk of the tree.
export interface MasterIndexEntry {
  file: File;
  path: string;
  name: string;
  canonPath: string;
  ratio: number;
  orientation: string;
}

// Exported so the campaign locator can canonicalise a token the SAME way the
// master picker does. A second canonicaliser would drift, and the drift would
// show up as "that campaign has no masters" about one that does.
export function mastersCanon(s: string): string {
  return String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Walk the masters tree ONCE and pre-compute everything the scoring needs.
//
// This exists because `scanMastersForBestMatch` walks the WHOLE tree per call,
// and a localise run calls it once PER ROW -- a 14-row batch walked the tree 14
// times. Building the index once and scoring against it in memory is the same
// answer for a fraction of the network I/O, which matters on the NAS.
//
// ORDER IS LOAD-BEARING: the scoring below keeps a candidate on `diff <= min`
// (not `<`), so among equally-good matches the LAST one wins. This walk must
// therefore visit files in exactly the order the original single-pass version
// did -- depth-first, recursing at the point a folder is encountered.
// =============================================================================
// Masters index cache
// -----------------------------------------------------------------------------
// One walk of a campaign's AE tree costs ~2s against the studio NAS (measured:
// Forgotten Island 296 masters / 2757 files / 570 dirs; Paw Patrol 410 / 2146 /
// 419). Nothing cached that, so every preview, every run, and every debounced
// keystroke in Build-a-batch paid it again.
//
// LIFETIME: a plain module variable in the ExtendScript engine. It therefore
// lives for the AE session and is gone when AE quits -- and is ALSO reset when
// the panel reloads, because that re-evaluates this bundle and rebuilds the
// namespace. There is no on-disk copy, deliberately: a persisted index that
// misses a newly-added master produces a false "no master", and one holding a
// renamed file points a copy at a path that no longer exists. Both are silent.
//
// FRESHNESS POLICY, and it is the important part:
//   - LOOKUPS (previews, the specs table, Build-a-batch typing, review
//     matching) read the cache. Worst case they show a slightly stale answer
//     on screen, which the next refresh corrects.
//   - RUNS refresh first via refreshMastersIndex(). Anything that COPIES or
//     WRITES gets a walk it can trust, and repopulates the cache for everyone
//     else at the same time.
// Callers that know the tree changed (campaign switch, "Re-check") should call
// invalidateMastersIndex().
// =============================================================================
var mastersIndexCache: { [root: string]: MasterIndexEntry[] } = {};

// =============================================================================
// THE SHARED INDEX
//
// mastersIndexCache above is per SESSION -- a module variable that dies with
// AE -- so the first lookup of every session paid a full recursive walk of the
// masters tree over the NAS. That is the wait everyone sees on open.
//
// This layer persists the same index to the team folder, so the walk is paid
// once by whoever triggers it and read as a single file by everyone else.
//
// IT IS NOT MAINTAINED BY HAND. Anything that copies or writes already calls
// refreshMastersIndex() for a walk it can trust; that walk now writes the
// shared file as a side effect. Normal use keeps it warm, and
// mastersReindex() is a fallback, not the mechanism.
//
// IT IS NOT TRUSTED EITHER. A stale index points an import at a master that
// has moved, and that fails silently at copy time -- the exact class of bug
// this codebase keeps getting bitten by. So each entry set is stored with the
// modified time of every folder near the top of the tree, and a read
// re-stats just those. A handful of stats is nothing against thousands of
// directory enumerations, and it catches the two changes that actually
// happen: a master added to a creative, and a creative added or removed.
//
// LIMIT, stated plainly: stamps stop at STAMP_DEPTH. A change deeper than
// that is not detected, because stamping every folder would cost as much as
// the walk it replaces and defeat the point. Deep reshuffles need the
// re-index button.
// =============================================================================
const MASTERS_INDEX_DIR = "misc/masters-index";
const STAMP_DEPTH = 2;

interface MastersStamp { path: string; modified: number; }

function teamFolderRoot(): Folder | null {
  try {
    if (!app.settings.haveSetting(SETTINGS_SECTION, "TeamFolderPath")) return null;
    const p = app.settings.getSetting(SETTINGS_SECTION, "TeamFolderPath");
    if (!p) return null;
    const f = new Folder(p);
    // .exists is only trustworthy on a DIRECTORY -- which this is.
    return f.exists ? f : null;
  } catch (e) {
    return null;
  }
}

/** One file per masters root, named from the root so two roots never collide. */
function mastersIndexFileFor(mastersRoot: string): File | null {
  const root = teamFolderRoot();
  if (!root) return null;
  const key = mastersCanon(mastersRoot);
  const short = key.length > 60 ? key.slice(0, 60) + String(key.length) : key;
  return new File(root.fsName + "/" + MASTERS_INDEX_DIR + "/" + short + ".json");
}

/** Modified times of the folders near the top of the tree. */
function mastersStamps(mastersRoot: string): MastersStamp[] {
  const out: MastersStamp[] = [];
  const visit = (folder: Folder, depth: number) => {
    try {
      out.push({ path: folder.fsName, modified: Number(folder.modified) || 0 });
    } catch (e) {
      return;
    }
    if (depth >= STAMP_DEPTH) return;
    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (typeof (item as Folder).getFiles !== "function") continue;
      if (mastersSkipFolder((item as Folder).name)) continue;
      visit(item as Folder, depth + 1);
    }
  };
  try {
    const root = new Folder(mastersRoot);
    if (root.exists) visit(root, 0);
  } catch (e) {
    return [];
  }
  return out;
}

function mastersStampsMatch(saved: MastersStamp[], now: MastersStamp[]): boolean {
  if (!saved || !now || saved.length !== now.length) return false;
  for (let i = 0; i < saved.length; i++) {
    if (saved[i].path !== now[i].path) return false;
    if (Number(saved[i].modified) !== Number(now[i].modified)) return false;
  }
  return true;
}

/**
 * NULL MEANS "I DID NOT GET AN INDEX", never "there are no masters".
 * A caller that flattens null to [] turns an unmounted share into a confident
 * "no master matched", which is the failure this whole file guards against.
 */
function readSharedMastersIndex(mastersRoot: string): MasterIndexEntry[] | null {
  try {
    const f = mastersIndexFileFor(mastersRoot);
    if (!f) return null;
    // NEVER gate a team-folder FILE operation on .exists -- it returns false
    // for files that plainly exist on the NAS. Attempt the open and let its
    // failure be the answer.
    if (!f.open("r")) return null;
    let raw = "";
    try { raw = f.read(); } finally { f.close(); }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { root: string; stamps: MastersStamp[]; entries: MasterIndexEntry[] };
    if (!parsed || !parsed.entries || parsed.entries.length === 0) return null;
    if (String(parsed.root) !== String(mastersRoot)) return null;
    if (!mastersStampsMatch(parsed.stamps, mastersStamps(mastersRoot))) return null;

    // .file is a live File object and cannot survive JSON -- rebuild it, and
    // keep the stored ORDER exactly: the scorer keeps `diff <= min`, so walk
    // order decides tie-breaks and a reordered index silently picks a
    // different master.
    const out: MasterIndexEntry[] = [];
    for (let i = 0; i < parsed.entries.length; i++) {
      const e = parsed.entries[i];
      out.push({
        file: new File(e.path),
        path: e.path,
        name: e.name,
        canonPath: e.canonPath,
        ratio: Number(e.ratio),
        orientation: e.orientation,
      });
    }
    return out;
  } catch (e) {
    return null;
  }
}

function writeSharedMastersIndex(mastersRoot: string, entries: MasterIndexEntry[]): void {
  try {
    if (!entries || entries.length === 0) return;
    const root = teamFolderRoot();
    if (!root) return;
    // Folder.create() does not make intermediate levels -- one at a time.
    const parts = MASTERS_INDEX_DIR.split("/");
    let sofar = root.fsName;
    for (let i = 0; i < parts.length; i++) {
      sofar = sofar + "/" + parts[i];
      const dir = new Folder(sofar);
      if (!dir.exists) { try { dir.create(); } catch (e) { return; } }
    }
    const slim: { path: string; name: string; canonPath: string; ratio: number; orientation: string }[] = [];
    for (let i = 0; i < entries.length; i++) {
      slim.push({
        path: entries[i].path,
        name: entries[i].name,
        canonPath: entries[i].canonPath,
        ratio: entries[i].ratio,
        orientation: entries[i].orientation,
      });
    }
    const f = mastersIndexFileFor(mastersRoot);
    if (!f) return;
    if (!f.open("w")) return;
    try {
      f.write(JSON.stringify({ root: mastersRoot, stamps: mastersStamps(mastersRoot), entries: slim }));
    } finally {
      f.close();
    }
  } catch (e) {
    // An unmounted share is a normal state, never an error. The walk already
    // succeeded; failing to share it costs the next person a walk, nothing more.
  }
}

/** Forces a walk and republishes the shared index. The manual fallback. */
export const mastersReindex = (mastersRoot: string): Result => {
  try {
    if (!mastersRoot) return { success: false, error: "No masters folder set." };
    const built = refreshMastersIndex(mastersRoot);
    return { success: true, message: "Indexed " + built.length + " masters." } as Result;
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Cached read. Walks only on a miss.
export function getMastersIndex(mastersRoot: string): MasterIndexEntry[] {
  const key = String(mastersRoot);
  if (mastersIndexCache.hasOwnProperty(key)) return mastersIndexCache[key];
  // The shared file first: one read instead of a recursive walk, and it
  // validates its own freshness before it is believed.
  const shared = readSharedMastersIndex(key);
  if (shared) {
    mastersIndexCache[key] = shared;
    return shared;
  }
  const built = buildMastersIndex(key);
  mastersIndexCache[key] = built;
  // Publish it so the next person on the same root does not pay for it.
  writeSharedMastersIndex(key, built);
  return built;
}

// Forced walk. Use before anything that writes files.
export function refreshMastersIndex(mastersRoot: string): MasterIndexEntry[] {
  const key = String(mastersRoot);
  const built = buildMastersIndex(key);
  mastersIndexCache[key] = built;
  // A RUN's walk is the trustworthy one, so it is also the one worth sharing.
  // This is why the shared index needs no daily human pass: ordinary use of
  // anything that writes files keeps it current.
  writeSharedMastersIndex(key, built);
  return built;
}

// Drop one root, or everything when called with no argument.
export const invalidateMastersIndex = (mastersRoot?: string): Result => {
  try {
    if (mastersRoot) delete mastersIndexCache[String(mastersRoot)];
    else mastersIndexCache = {};
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Folders whose CONTENTS are discarded by the file filter below. The walk used
// to descend into them anyway, enumerate every .aep inside, and throw the lot
// away -- and AE's Auto-Save folders are routinely the largest directories in a
// masters tree. Every subfolder is a separate round trip to the NAS, so this is
// where the wait on a cold session actually came from. Pruning here is
// behaviour-preserving: the file filter stays, so a FILE that happens to carry
// one of these tokens is still excluded exactly as before.
const MASTERS_SKIP_FOLDERS = ["Auto-Save", "_Archive", "_Old", "_DEV"];

/**
 * Shared by BOTH masters scanners -- this index and OV Library's own walk in
 * review.ts, which had drifted to its own list.
 *
 * CASE-INSENSITIVE. OV Library compared `nm === "_old"` and `nm === "_archive"`
 * exactly and in lowercase, so the studio's real folders -- `_Old`, `_Archive`
 * -- never matched and it walked them in full, both paying for the scan and
 * surfacing archived masters in the library. `_DEV` was absent from its list
 * entirely.
 *
 * Widening this also makes exclusion consistent here: a lowercase `_old`
 * folder used to be pruned by neither the folder walk nor the file filter, so
 * its contents were indexed as live masters. They now aren't. That is the
 * intent of the list, but it IS a behaviour change -- a master genuinely
 * living under a lowercase archive folder stops being found.
 */
export function mastersSkipFolder(name: string): boolean {
  // indexOf, never .match() -- a folder name is not a regex and real ones
  // carry ( + [.
  const lower = String(name).toLowerCase();
  for (let i = 0; i < MASTERS_SKIP_FOLDERS.length; i++) {
    if (lower.indexOf(MASTERS_SKIP_FOLDERS[i].toLowerCase()) !== -1) return true;
  }
  return false;
}

export function buildMastersIndex(mastersRoot: string): MasterIndexEntry[] {
  const out: MasterIndexEntry[] = [];
  const walk = (folder: Folder) => {
    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // DUCK-TYPED, not instanceof: two accesses to the same AE object return
      // different wrappers, so instanceof against a host class is banned
      // (CLAUDE.md section 2). A Folder is the thing that can list itself.
      if (typeof (item as Folder).getFiles === "function") {
        if (mastersSkipFolder((item as Folder).name)) continue;
        walk(item as Folder);
      } else {
        const path = (item as File).fsName;
        if (
          path.slice(-4) === ".aep" &&
          path.indexOf("Auto-Save") === -1 &&
          path.indexOf("_Archive") === -1 &&
          path.indexOf("_Old") === -1 &&
          path.indexOf("_DEV") === -1
        ) {
          const sizeMatch = path.match(/\d+x\d+/);
          if (!sizeMatch) continue;
          const destParts = sizeMatch[0].split("x");
          const ratio = Number(destParts[0]) / Number(destParts[1]);
          out.push({
            file: item as File,
            path: path,
            name: (item as File).name,
            canonPath: mastersCanon(path),
            ratio: ratio,
            orientation: ratio >= 1 ? "Landscape" : "Portrait",
          });
        }
      }
    }
  };
  const root = new Folder(mastersRoot);
  if (root.exists) walk(root);
  return out;
}

// The scoring half, extracted verbatim from scanMastersForBestMatch so both the
// real run and the read-only preview can never disagree about which master wins.
export function pickBestMasterFromIndex(
  index: MasterIndexEntry[],
  campaign: string,
  size: string,
  duration: string
): MasterIndexEntry | null {
  const sizeParts = size.split("x");
  const aspectRatioRef = Number(sizeParts[0]) / Number(sizeParts[1]);
  const plRef = aspectRatioRef >= 1 ? "Landscape" : "Portrait";
  const campaignCanon = mastersCanon(campaign);

  let best: MasterIndexEntry | null = null;
  let min = 1000;
  for (let i = 0; i < index.length; i++) {
    const e = index[i];
    if (e.canonPath.indexOf(campaignCanon) === -1) continue;
    if (!durationMatchesPath(e.path, duration)) continue;
    if (e.orientation !== plRef) continue;
    const diff = Math.abs(aspectRatioRef - e.ratio);
    if (diff <= min) {
      best = e;
      min = diff;
    }
  }
  return best;
}

// A deliverable whose duration has no master of its own, but IS an exact
// integer multiple of one that exists -- a 30sec slot filled by playing the
// 15sec master twice, or the 10sec three times. The studio does this by hand
// today; this only FINDS the candidate, it never selects it (that is an
// explicit per-row opt-in in the panel).
//
// Smallest factor first, so 30sec prefers 15sec x2 over 10sec x3: fewer
// repeats means the longest available cut of the actual creative.
//
// Exact division only. A 20sec master is not a candidate for a 30sec slot at
// 1.5x -- there is no sane automatic way to play something one and a half
// times, and offering it would be worse than offering nothing.
export const MAX_DURATION_MULTIPLE = 4;

export interface MultipleMasterMatch {
  entry: MasterIndexEntry;
  factor: number;
  sourceDuration: string; // the master's own duration, e.g. "15sec"
}

// EVERY viable factor, ascending, so the panel can cycle 2x -> 3x -> off for a
// 30sec row that has both a 15sec and a 10sec master. Ascending order matters:
// the first entry is the fewest repeats, i.e. the longest real cut, and is
// what the UI offers first.
export function multipleMasterOptions(
  index: MasterIndexEntry[],
  campaign: string,
  size: string,
  duration: string,
  maxFactor: number
): MultipleMasterMatch[] {
  const out: MultipleMasterMatch[] = [];
  const digits = String(duration == null ? "" : duration).match(/\d+/);
  if (!digits) return out;
  const target = parseInt(digits[0], 10);
  if (!target || target <= 0) return out;
  const cap = maxFactor && maxFactor > 1 ? maxFactor : MAX_DURATION_MULTIPLE;
  for (let f = 2; f <= cap; f++) {
    if (target % f !== 0) continue;
    const sub = String(target / f) + "sec";
    const m = pickBestMasterFromIndex(index, campaign, size, sub);
    if (m) out.push({ entry: m, factor: f, sourceDuration: sub });
  }
  return out;
}

// The one option matching a factor the user explicitly chose, or null if that
// factor is no longer available (masters can change between the preview and
// the run). Never silently substitutes a different factor -- the row falls
// back to "no master", which is honest.
export function multipleMasterForFactor(
  index: MasterIndexEntry[],
  campaign: string,
  size: string,
  duration: string,
  factor: number
): MultipleMasterMatch | null {
  const options = multipleMasterOptions(index, campaign, size, duration, MAX_DURATION_MULTIPLE);
  for (let i = 0; i < options.length; i++) {
    if (options[i].factor === factor) return options[i];
  }
  return null;
}

// Unchanged contract: same arguments, same answer, same File back. Now just
// index-then-score rather than one fused pass, so the two callers below and the
// batch preview all share one definition of "best master".
export function scanMastersForBestMatch(mastersRoot: string, campaign: string, size: string, duration: string): File | null {
  // Cached: campaignLocaliserGenerate calls this once PER ROW, so before the
  // cache a 14-row batch meant 14 full tree walks. That run refreshes the
  // index once up front, so every row after the first is now a memory hit.
  const best = pickBestMasterFromIndex(getMastersIndex(mastersRoot), campaign, size, duration);
  return best ? best.file : null;
}

export interface CampaignLocaliserResult {
  success: boolean;
  error?: string;
  message?: string;
}

export const campaignLocaliserGenerate = (skipExisting: boolean): LocGenResult => {
  try {
    const mastersPath = Folder.selectDialog("Please select the Master / loc folder to scan");
    if (!mastersPath) return { success: false, error: "No masters folder selected." };

    const locFile = File.openDialog("Please select the File to Localise.");
    if (!locFile) return { success: false, error: "No localisation file selected." };
    if (!locFile.open("r")) return { success: false, error: "Could not open the localisation file." };

    const scanRegV = /V\d\d/;
    let myComp: CompItem | null = app.project.activeItem instanceof CompItem ? app.project.activeItem : null;
    const rows: LocGenRowReport[] = [];

    while (!locFile.eof) {
      const line = locFile.readln();
      if (!line || line.replace(/^\s+|\s+$/g, "") === "") continue;
      if (line.match(/^"?Artwork/i)) continue; // header row
      const rep: LocGenRowReport = { source: line, artwork: "", campaign: "", size: "", duration: "", status: "error" };
      rows.push(rep);
      try {
        const texLoc = line.split(",");
        if (texLoc.length < 4) {
          rep.error = "Malformed row (fewer than 4 columns).";
          continue;
        }
        const sizeParts = texLoc[2].replace(/"/g, "").split("x");
        // Campaign keeps the casing the loc file gave it. The old scanner
        // upper-cased here; XYi_Campaign_Scanner.jsx (2026-07-31) dropped that
        // to preserve CamelCase, and every downstream comparison in this
        // codebase canonicalises case anyway, so nothing depends on it.
        //
        // Case was already safe here, but SEPARATORS were not: a loc file
        // written by hand can carry "Portal To Paradise", and the spaces went
        // straight into the .aep filename. camelCaseName collapses them and
        // applies the one shared casing rule, matching the CSV Localiser path.
        const campaign = camelCaseName(texLoc[1].replace(/"/g, ""));
        const width = Math.floor(Number(sizeParts[0]));
        const height = Math.floor(Number(sizeParts[1]));
        const size = width + "x" + height;
        // Kept with the "sec" suffix for the MASTER LOOKUP below -- masters
        // still carry the old naming and scanMastersForBestMatch tests the
        // duration as a plain substring of the path, where a bare "10" also
        // matches inside "1080x1920". The written name gets bare digits via
        // buildDeliverableName().
        const duration = durationForMasterLookup(String(texLoc[3]).replace(/"/g, ""));
        // 5th column, added to the loc CSV by XYi_PDF_to_CSV.jsx in the same
        // handover. Absent in every pre-existing loc file, which is why this
        // tolerates a short row rather than indexing blindly.
        // Sanitised, not just de-quoted: this column is normally written by
        // XYi_PDF_to_CSV.jsx from an already-tokenised name, but a hand-edited
        // loc file can carry anything, and an unsanitised site here would put
        // a space or an unfolded accent straight into a filename on the NAS.
        // Same sanitiser as the CSV Localiser and Name Generator paths.
        const siteToken = texLoc.length > 4 ? sanitiseSiteToken(texLoc[4].replace(/"/g, "")) : "";
        rep.artwork = texLoc[0].replace(/"/g, "");
        rep.campaign = campaign;
        rep.size = size;
        rep.duration = duration;

        const bestMatch = scanMastersForBestMatch(mastersPath.fsName, campaign, size, duration);
        if (!bestMatch) {
          rep.status = "no-master";
          rep.error = "No master matched " + campaign + " / " + size + " / " + duration + ".";
          continue;
        }

        const textMasterPath = bestMatch.fsName;
        const linesMaster = textMasterPath.split("/");
        let masterName = linesMaster[linesMaster.length - 1];
        const ratioPattern = /^_(\d+\.\d+)_/;
        if (ratioPattern.test(masterName)) {
          masterName = masterName.split(ratioPattern)[2];
        }
        rep.master = masterName;

        const masterSizeMatch = masterName.match(/\d+x\d+/);
        if (!masterSizeMatch) {
          rep.error = "Matched master '" + masterName + "' has no WxH in its name.";
          continue;
        }
        const masterDims = masterSizeMatch[0].split("x");
        const masterWidth = Math.floor(Number(masterDims[0]));
        const masterHeight = Math.floor(Number(masterDims[1]));
        const plm = masterWidth < masterHeight ? "PORTRAIT" : "LANDSCAPE";

        const scanFilmTitle = masterName.split("_")[0];
        const scanIndo = masterName.split("_")[1];
        const scanArtworkType = texLoc[0].replace(/"/g, "");
        const locFileNameParts = locFile.name.split("_");
        const scanTerritory = locFileNameParts[locFileNameParts.length - 1].slice(0, 2);

        const newCompName = buildDeliverableName({
          filmTitle: scanFilmTitle,
          region: scanIndo,
          campaign: campaign,
          artworkType: scanArtworkType,
          site: siteToken,
          width: width,
          height: height,
          duration: duration,
          territory: scanTerritory,
        });
        rep.output = newCompName + "_V01.aep";

        const outputFile = new File(locFile.parent.fsName + "/" + newCompName + "_V01.aep");
        if (skipExisting && outputFile.exists) {
          rep.status = "skipped-existing";
          continue;
        }

        // Opens the matched master directly, exactly as the original --
        // see the block comment above for why this is confirmed safe here.
        const masterFile = new File(textMasterPath);
        const proj = app.open(masterFile);
        if (!proj) {
          rep.error = "Could not open the matched master.";
          continue;
        }

        const masterStem = masterName.split(".")[0];
        for (let i = 1; i <= proj.numItems; i++) {
          const item = proj.item(i);
          if (item instanceof CompItem && item.name === masterStem) {
            myComp = item;
            break;
          }
        }
        if (!myComp) {
          rep.status = "no-comp";
          rep.error = "Master opened but comp '" + masterStem + "' not found inside.";
          continue;
        }

        // --- nameGen() equivalent: duplicate, rescale, propagate into Main ---
        const myName = myComp.name;
        const oldWidth = myComp.width;
        const oldHeight = myComp.height;
        const newComp = myComp.duplicate();
        newComp.name = newCompName;

        const newRatio = width / height;
        const oldRatio = oldWidth / oldHeight;
        const scaleFactor = newRatio > oldRatio ? width / oldWidth : height / oldHeight;

        const null3DLayer = newComp.layers.addNull();
        null3DLayer.threeDLayer = true;
        null3DLayer.position.setValue([0, 0, 0]);
        makeParentLayerOfAllUnparented(newComp, null3DLayer);

        newComp.width = Math.floor(width);
        newComp.height = Math.floor(height);
        scaleAllCameraZooms(newComp, scaleFactor);

        const superParentScale = null3DLayer.scale.value as number[];
        const superParentPosition = null3DLayer.position.value as number[];
        superParentScale[0] *= scaleFactor;
        superParentScale[1] *= scaleFactor;
        superParentScale[2] *= scaleFactor;
        null3DLayer.scale.setValue(superParentScale);

        if (newRatio > oldRatio) {
          const posHeight = (width / oldWidth) * oldHeight;
          superParentPosition[1] = -0.5 * (posHeight - height);
        } else {
          const posWidth = (height / oldHeight) * oldWidth;
          superParentPosition[0] = -0.5 * (posWidth - width);
        }
        null3DLayer.position.setValue(superParentPosition);
        null3DLayer.remove();

        for (let i = 1; i <= app.project.numItems; i++) {
          const item = app.project.item(i);
          if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && scanRegV.test(item.name)) {
            item.width = width;
            item.height = height;
            for (let j = 1; j <= item.numLayers; j++) {
              const layer = item.layer(j) as AVLayer;
              if (layer.name === myComp.name) {
                layer.replaceSource(newComp, false);
              } else if (plm === "PORTRAIT") {
                layer.scale.setValue([(100 / 1920) * height, (100 / 1920) * height]);
              } else if (plm === "LANDSCAPE") {
                layer.scale.setValue([(100 / 1080) * height, (100 / 1080) * height]);
              }
              layer.position.setValue([width / 2, height / 2]);
            }
          }
        }

        for (let i = 1; i <= app.project.numItems; i++) {
          const item = app.project.item(i);
          if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && scanRegV.test(item.name)) {
            item.name = String(newComp.name) + "_V01";
          }
        }

        for (let i = 1; i <= app.project.numItems; i++) {
          const item = app.project.item(i);
          if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && scanRegV.test(item.name + "_V01")) {
            item.openInViewer();
            cheekyDTCheck(false, true, true, false, false, true, true);
            if (item.name === newCompName + "_V01") {
              app.project.showWindow(true);
              drqr();
            }
          }
        }

        for (let i = 1; i <= app.project.numItems; i++) {
          const item = app.project.item(i);
          if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && item.name === myName) {
            item.remove();
          }
        }

        const newFile = new File(locFile.parent.fsName + "/" + newCompName + "_V01.aep");
        app.project.save(newFile);
        app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        app.newProject();

        rep.status = "generated";
      } catch (lineErr) {
        rep.status = "error";
        rep.error = lineErr.toString();
      }
    }

    locFile.close();
    return finishLocGenReport("Generate Files", rows, locFile.parent.fsName);
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Scale Composition -- ported from XYi_Toolbox.jsx's scaleWidth()/
// scaleHeight()/scaleComp()/scaleFact()/multiScaleComp()/scaleDetect()/
// scaleName(), all backed by XYi_Scaler.jsx's onScaleClick(), which is the
// exact same null-parent scale-to-fit technique already ported as
// scaleCompToFit()/scaleAllCameraZooms() above for DRQR -- reused here
// rather than re-implemented.
// =============================================================================
export const scaleCompositionExplicit = (newWidth: number, newHeight: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
    app.beginUndoGroup("XYi Scale Composition");
    scaleCompToFit(comp, newWidth, newHeight);
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Guide Scale -- ported from toolset/XYI_Guide_Scaler.jsx's guider(). Reads the
// active comp's ruler guides (AE 23.0+ `CompItem.guides`) to derive a target
// region, repositions the selected PRE-COMP layer so its top-left sits at that
// region's top-left, then scales the layer's SOURCE comp to fill the region.
// The standalone script only ever returned [width, height] and left the actual
// scaling to a separate scaler, so we finish it here with scaleCompToFit() --
// the same null-parent technique the other scale modes use.
//
// Guide math is unchanged from the original:
//   - one vertical guide     -> width  = guide X   (region starts at 0)
//   - two+ vertical guides    -> width  = X2 - X1  (region starts at X1)
//   - one horizontal guide   -> height = guide Y   (region starts at 0)
//   - two+ horizontal guides  -> height = Y2 - Y1  (region starts at Y1)
export const guideScale = (): Result => {
  try {
    const activeComp = app.project.activeItem;
    if (!activeComp || !(activeComp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };

    const selectedLayers = activeComp.selectedLayers;
    if (selectedLayers.length !== 1) return { success: false, error: "Please select exactly one layer." };

    const targetLayer = selectedLayers[0];
    if (!(targetLayer instanceof AVLayer) || !targetLayer.source || !(targetLayer.source instanceof CompItem)) {
      return { success: false, error: "The selected layer must be a pre-composition." };
    }

    // CompItem.guides is AE 23.0+ only; older typings/hosts don't expose it.
    const guides = (activeComp as any).guides;
    if (guides === undefined) {
      return { success: false, error: "This version of After Effects is too old to read ruler guides (needs 23.0+)." };
    }

    const vGuidePositions: number[] = [];
    const hGuidePositions: number[] = [];
    for (let i = 0; i < guides.length; i++) {
      const g = guides[i];
      const pos = Number(g.position);
      if (g.orientationType === 1) vGuidePositions.push(pos); // Vertical
      else if (g.orientationType === 0) hGuidePositions.push(pos); // Horizontal
    }

    if (vGuidePositions.length === 0 && hGuidePositions.length === 0) {
      return { success: false, error: "No ruler guides on the active comp — drag guides from the rulers first." };
    }

    vGuidePositions.sort((a, b) => a - b);
    hGuidePositions.sort((a, b) => a - b);

    const anchor = targetLayer.property("Anchor Point").value as number[];
    const position = targetLayer.property("Position").value as number[];

    let widthStore = activeComp.width;
    let heightStore = activeComp.height;

    if (vGuidePositions.length === 1) {
      widthStore = vGuidePositions[0];
      anchor[0] = 0;
      position[0] = 0;
    } else if (vGuidePositions.length >= 2) {
      widthStore = vGuidePositions[1] - vGuidePositions[0];
      anchor[0] = 0;
      position[0] = vGuidePositions[0];
    }

    if (hGuidePositions.length === 1) {
      heightStore = hGuidePositions[0];
      anchor[1] = 0;
      position[1] = 0;
    } else if (hGuidePositions.length >= 2) {
      heightStore = hGuidePositions[1] - hGuidePositions[0];
      anchor[1] = 0;
      position[1] = hGuidePositions[0];
    }

    if (widthStore <= 0 || heightStore <= 0) {
      return { success: false, error: "Guides produced a zero/negative size — check the guide positions." };
    }

    app.beginUndoGroup("XYi Guide Scale");
    targetLayer.property("Anchor Point").setValue(anchor);
    targetLayer.property("Position").setValue(position);
    scaleCompToFit(targetLayer.source, widthStore, heightStore);
    app.endUndoGroup();

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const scaleCompositionByWidth = (targetWidth: number): Result => {
  const comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
  const factor = targetWidth / comp.width;
  return scaleCompositionExplicit(comp.width * factor, comp.height * factor);
};

export const scaleCompositionByHeight = (targetHeight: number): Result => {
  const comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
  const factor = targetHeight / comp.height;
  return scaleCompositionExplicit(comp.width * factor, comp.height * factor);
};

export const scaleCompositionByFactor = (factor: number): Result => {
  const comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
  return scaleCompositionExplicit(comp.width * factor, comp.height * factor);
};

// Scales every selected layer's source pre-comp to match the active comp's
// current size, then resets that layer's own Scale to 100% -- for lining up
// several differently-sized pre-comps to the same frame in one pass.
export const scaleCompositionMulti = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
    const selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return { success: false, error: "Please select one or more pre-comp layers first." };

    app.beginUndoGroup("XYi Scale Multiple Composition");
    for (let m = 0; m < selectedLayers.length; m++) {
      const layer = selectedLayers[m];
      if (!layer.source || !(layer.source instanceof CompItem)) continue;
      scaleCompToFit(layer.source, comp.width, comp.height);
      (layer as AVLayer).scale.setValue([100, 100]);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface ScaleDetectResult extends Result {
  width?: number;
  height?: number;
}

export const scaleCompositionDetect = (): ScaleDetectResult => {
  const comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
  return { success: true, width: comp.width, height: comp.height };
};

// Parses a "...1920x1080..." token out of the active comp's own name and
// scales to that -- for snapping a comp back to what its filename says it
// should be after manual resizing drifted it.
// Re-render the single inner "edits" precomp at the target size, so a
// res-suffixed comp scaled by name is natively sharp double/quad res -- not
// just its outer canvas scaled up with soft inner content. This is DRQR's
// sharpening step, but GUARDED to only fire on the clean, known-good
// structure (see the user-confirmed convention: a Frontcard on top plus ONE
// edits precomp below it):
//   - Skips every Frontcard layer (matches DRQR).
//   - Fires ONLY when exactly one non-Frontcard layer remains AND its source
//     is a comp. If the structure is anything else (several content layers, a
//     part-frame element like a corner logo, plain footage), it does NOTHING
//     and returns false -- resizing the wrong source would blow a part-frame
//     element up to fullscreen, which is exactly the damage DRQR's own
//     selectedLayers[1] bug happened to avoid by only ever touching one layer.
// Returns true if it re-ressed the inner comp, false if it left the structure
// untouched (caller reports which happened).
function upresInnerEditsComp(comp: CompItem, targetW: number, targetH: number): boolean {
  let editsLayer: AVLayer | null = null;
  let nonFrontcardCount = 0;
  for (let i = 1; i <= comp.numLayers; i++) {
    const layer = comp.layer(i);
    if (layer.name.indexOf("Frontcard") !== -1) continue;
    nonFrontcardCount++;
    if (layer instanceof AVLayer && layer.source instanceof CompItem) editsLayer = layer;
  }
  if (nonFrontcardCount !== 1 || !editsLayer) return false;
  // Re-render the edits precomp's own SOURCE at full target size, then reset
  // the layer to 100% so it fills the frame natively rather than being scaled.
  scaleCompToFit(editsLayer.source as CompItem, targetW, targetH);
  editsLayer.scale.setValue([100, 100]);
  return true;
}

interface ScaleByNameResult extends Result {
  message?: string;
}

export const scaleCompositionByName = (): ScaleByNameResult => {
  let undoOpen = false;
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
    const match = comp.name.match(/(\d+)x(\d+)/);
    if (!match) return { success: false, error: "Comp name doesn't contain a WIDTHxHEIGHT token." };
    const nominalW = parseInt(match[1], 10);
    const nominalH = parseInt(match[2], 10);

    // Scale the comp to the size its NAME claims. A _DOUBLE_RES / _QUAD_RES
    // name means 2x / 4x the nominal token (so "..._600x300_..._DOUBLE_RES"
    // -> 1200x600); a bare name scales to nominal. Never ADDS a suffix and
    // never runs DRQR on a bare comp -- promoting the single-res base comp to
    // double-res is DRQR's own button, not a silent side effect here.
    const resSuffix = resSuffixOf(comp.name);
    const mult = resSuffix === RES_QUAD_SUFFIX ? 4 : resSuffix === RES_DOUBLE_SUFFIX ? 2 : 1;
    const targetW = nominalW * mult;
    const targetH = nominalH * mult;

    app.beginUndoGroup("XYi Scale by Name");
    undoOpen = true;

    scaleCompToFit(comp, targetW, targetH);

    // For a res-suffixed comp, also re-render the inner edits precomp at the
    // new size so it's natively sharp -- but only on the clean Frontcard+one-
    // precomp structure (upresInnerEditsComp no-ops otherwise). A bare comp
    // (mult === 1) never gets this: there's nothing to "double-res".
    let innerReRessed = false;
    if (mult > 1) innerReRessed = upresInnerEditsComp(comp, targetW, targetH);

    app.endUndoGroup();
    undoOpen = false;

    const sizeMsg = targetW + "x" + targetH;
    let message: string;
    if (mult === 1) {
      message = "Scaled to " + sizeMsg + ".";
    } else if (innerReRessed) {
      message = "Scaled to " + sizeMsg + " and re-rendered the inner comp at native res.";
    } else {
      message = "Scaled to " + sizeMsg + " (outer only — inner isn't a single Frontcard+precomp, so it wasn't re-ressed).";
    }
    return { success: true, message };
  } catch (e) {
    if (undoOpen) app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Adjust -- ported from XYi_Toolbox.jsx's adjustWidth()/adjustHeight()/
// adjustDuration()/adjustRate()/adjustAspect(), backed by XYi_Adj.jsx.
// Unlike Scale Composition, these change ONE property directly (no
// null-parent layer scaling) -- e.g. width alone, which will visually
// stretch layer content rather than scale it proportionally. That's the
// original tool's actual behavior, not a bug introduced in porting.
// =============================================================================
function adjWidth(w: number) {
  const sel = app.project.selection;
  for (let i = 0; i < sel.length; i++) (sel[i] as CompItem).width = Math.floor(w);
}
function adjHeight(h: number) {
  const sel = app.project.selection;
  for (let i = 0; i < sel.length; i++) (sel[i] as CompItem).height = Math.floor(h);
}
function adjAspect(a: number) {
  const sel = app.project.selection;
  for (let i = 0; i < sel.length; i++) (sel[i] as CompItem).pixelAspect = a;
}
function adjFrameRate(f: number) {
  const sel = app.project.selection;
  for (let i = 0; i < sel.length; i++) (sel[i] as CompItem).frameRate = f;
}
// Recursively extends any layer (including nested pre-comps) whose outPoint
// falls short of the new comp duration, up to its own source's natural
// length -- so shortening then lengthening a comp doesn't leave gaps.
function adjustLayersForDuration(comp: CompItem, parentDuration: number, prevDuration: number) {
  comp.duration = parentDuration;
  for (let i = 1; i <= comp.numLayers; i++) {
    const layer = comp.layer(i);
    const wasShortAlready = layer.outPoint < prevDuration;

    if (layer instanceof AVLayer && layer.source instanceof CompItem) {
      adjustLayersForDuration(layer.source, comp.duration, comp.duration);
    }

    let maxOutPoint = comp.duration;
    if (layer instanceof AVLayer && layer.source && layer.source.duration) {
      const sourceDuration = layer.source.duration / (layer.stretch / 100);
      maxOutPoint = Math.min(comp.duration, layer.inPoint + sourceDuration);
    }

    const layerDuration = layer.outPoint - layer.inPoint;
    if (layerDuration < comp.duration - layer.inPoint && !wasShortAlready) {
      layer.outPoint = maxOutPoint;
    }
  }
}
function adjDuration(d: number) {
  const sel = app.project.selection;
  for (let i = 0; i < sel.length; i++) {
    const item = sel[i] as CompItem;
    const prevDuration = item.duration;
    const prevFrameRate = item.frameRate;
    const frameDuration = 1 / Math.round(prevFrameRate);
    const roundedDuration = Math.round(d / frameDuration) * frameDuration;
    item.duration = roundedDuration;
    adjustLayersForDuration(item, roundedDuration, prevDuration);
    item.frameRate = prevFrameRate;
  }
}

export const adjustWidth = (width: number): Result => {
  const sel = app.project.selection;
  if (sel.length === 0) return { success: false, error: "Please select one or more compositions first." };
  app.beginUndoGroup("XYi Adjust Width");
  adjWidth(width);
  app.endUndoGroup();
  return { success: true };
};
export const adjustHeight = (height: number): Result => {
  const sel = app.project.selection;
  if (sel.length === 0) return { success: false, error: "Please select one or more compositions first." };
  app.beginUndoGroup("XYi Adjust Height");
  adjHeight(height);
  app.endUndoGroup();
  return { success: true };
};
export const adjustDuration = (durationSeconds: number): Result => {
  const sel = app.project.selection;
  if (sel.length === 0) return { success: false, error: "Please select one or more compositions first." };
  app.beginUndoGroup("XYi Adjust Duration");
  adjDuration(durationSeconds);
  app.endUndoGroup();
  return { success: true };
};
export const adjustFrameRate = (frameRate: number): Result => {
  const sel = app.project.selection;
  if (sel.length === 0) return { success: false, error: "Please select one or more compositions first." };
  app.beginUndoGroup("XYi Adjust Frame Rate");
  adjFrameRate(frameRate);
  app.endUndoGroup();
  return { success: true };
};
export const adjustAspectRatio = (aspect: number): Result => {
  const sel = app.project.selection;
  if (sel.length === 0) return { success: false, error: "Please select one or more compositions first." };
  app.beginUndoGroup("XYi Adjust Aspect Ratio");
  adjAspect(aspect);
  app.endUndoGroup();
  return { success: true };
};

// =============================================================================
// Safe Generator -- ported from XYi_Toolbox.jsx's XYi_SafeGen()/
// XYi_SafeGenFull(), backed by XYi_SafeGen.jsx. Draws two red solids into
// the active comp: a full-frame "ViewSafe" solid used purely as an alpha-
// inverted track matte, and a "SafeZone" solid sized to the safe area --
// the matte makes only the OUTSIDE of the safe area show at 50% opacity,
// a standard broadcast-safe visualization technique.
// =============================================================================
export const safeGenerate = (marginWidth: number, marginHeight: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
    app.beginUndoGroup("XYi Safe Generator");
    const safeWidth = comp.width - marginWidth * 2;
    const safeHeight = comp.height - marginHeight * 2;
    const viewSolid = comp.layers.addSolid([1, 0, 0], "ViewSafe", comp.width, comp.height, 1);
    comp.layers.addSolid([1, 0, 0], "SafeZone", safeWidth, safeHeight, 1);
    viewSolid.trackMatteType = TrackMatteType.ALPHA_INVERTED;
    viewSolid.property("Opacity").setValue(50);
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const safeGenerateFull = (totalWidth: number, totalHeight: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
    app.beginUndoGroup("XYi Full Safe Generator");
    const viewSolid = comp.layers.addSolid([1, 0, 0], "ViewSafe", comp.width, comp.height, 1);
    comp.layers.addSolid([1, 0, 0], "SafeZone", totalWidth, totalHeight, 1);
    viewSolid.trackMatteType = TrackMatteType.ALPHA_INVERTED;
    viewSolid.property("Opacity").setValue(50);
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Master of Nulls -- ported from XYi_Toolbox.jsx's MasNul()/
// MasterNullSelected()/ParentInformer(), backed by XYI_MasterNullSelected.jsx
// and XYI_ParentInformer.jsx. All operate on the active comp/its layers only.
// =============================================================================
export const masterNullAll = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
    app.beginUndoGroup("XYi Master Null Maker");
    const null3DLayer = comp.layers.addNull();
    null3DLayer.threeDLayer = true;
    null3DLayer.position.setValue([comp.width / 2, comp.height / 2, 0]);
    makeParentLayerOfAllUnparented(comp, null3DLayer);
    null3DLayer.name = "MASTER_CONTROL_NULL";
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Parents only the currently-selected layers to a new null placed above the
// topmost of them, preserving any hierarchy the selected layers already had
// (a layer already parented to something else is left alone).
export const masterNullSelected = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select a composition." };
    const selectedLayers = comp.selectedLayers;
    if (selectedLayers.length < 2) return { success: false, error: "Please select at least two layers." };

    app.beginUndoGroup("XYi Master Selected Null");
    const sorted = selectedLayers.slice().sort((a, b) => b.index - a.index);

    const masterNull = comp.layers.addNull();
    masterNull.name = "Master Null";
    masterNull.position.setValue([comp.width / 2, comp.height / 2]);
    masterNull.moveBefore(sorted[0]);
    masterNull.inPoint = sorted[0].inPoint;
    masterNull.outPoint = sorted[sorted.length - 1].outPoint;

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].parent === null) sorted[i].parent = masterNull;
      sorted[i].selected = false;
    }
    masterNull.selected = true;
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface ParentInformerResult extends Result {
  message?: string;
}

// Read-only report: for each selected layer, lists every other layer in the
// comp that's parented to it. No undo group needed -- nothing is changed.
export const parentInformer = (): ParentInformerResult => {
  const comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please open a composition to run this on." };
  const selectedLayers = comp.selectedLayers;
  if (selectedLayers.length === 0) return { success: false, error: "Please select one or more layers in the composition." };

  const parentedLayers: { [name: string]: string[] } = {};
  for (let i = 1; i <= comp.numLayers; i++) {
    const currentLayer = comp.layer(i);
    for (let j = 0; j < selectedLayers.length; j++) {
      const selectedLayer = selectedLayers[j];
      if (currentLayer.parent === selectedLayer) {
        if (!parentedLayers[selectedLayer.name]) parentedLayers[selectedLayer.name] = [];
        parentedLayers[selectedLayer.name].push(currentLayer.index + ". " + currentLayer.name);
      }
    }
  }

  let message = "";
  for (let k = 0; k < selectedLayers.length; k++) {
    const selectedLayer = selectedLayers[k];
    if (parentedLayers[selectedLayer.name] && parentedLayers[selectedLayer.name].length > 0) {
      message += "Layers parented to '" + selectedLayer.name + "':\n" + parentedLayers[selectedLayer.name].join("\n") + "\n\n";
    } else {
      message += "No layers are parented to '" + selectedLayer.name + "'.\n\n";
    }
  }
  return { success: true, message: message.trim() };
};

// =============================================================================
// Edit Tools -- ported from XYi_Toolbox.jsx's "Edit Tools" tab. Only
// Fuse Shots (`XYi_EdDec.jsx`'s gateFuse()) and Snuggle Layers
// (`XYi_Sunggle.jsx`) are ported here. **"Detect Edit (Old)"
// (gateDetect()) is deliberately NOT ported** -- the button is explicitly
// labeled "(Old)" in the source itself (implying the studio already
// considers it superseded), and its logic is an unusually fragile,
// precompose-based frame-difference analysis with several edge cases
// (single-layer assumption inside a loop that only ever uses the LAST
// selected layer, a temporary comp that must be cleaned up exactly right,
// expression-driven sampling). Given the "(Old)" label, porting it
// faithfully wasn't judged worth the risk of a subtly-broken result --
// revisit only if the studio actually still uses this specific button.
// =============================================================================
export const editToolsFuseShots = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };

    app.beginUndoGroup("XYi Edit Detect - Fuse Shots");
    const begin = comp.workAreaStart;
    const end = comp.workAreaStart + comp.workAreaDuration;
    let totalLayers = comp.numLayers;

    for (let i = totalLayers; i > 0; i--) {
      const layer = comp.layer(i);
      if (layer.inPoint > begin && layer.outPoint < end) {
        layer.remove();
      }
    }
    totalLayers = comp.numLayers;

    let one = 0;
    let two = 0;
    let countA = 0;
    let countB = 0;
    for (let j = 1; j <= totalLayers; j++) {
      const layer = comp.layer(j);
      if (layer.outPoint > begin && layer.outPoint < end && countA === 0) {
        one = layer.outPoint;
        countA++;
      }
      if (layer.inPoint > begin && countB === 0) {
        two = layer.inPoint;
        countB++;
      }
    }

    let newLayer: Layer | null = null;
    let countC = 0;
    for (let j = 1; j <= totalLayers; j++) {
      const layer = comp.layer(j);
      if (layer.outPoint > begin && layer.outPoint < end && countC === 0) {
        newLayer = layer.duplicate();
        newLayer.moveAfter(comp.layer(j + 1));
        countC++;
      }
    }
    if (newLayer) {
      newLayer.inPoint = one;
      newLayer.outPoint = two;
    }

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const editToolsSnuggleLayers = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select a composition." };
    const selectedLayers = comp.selectedLayers;
    if (selectedLayers.length < 2) return { success: false, error: "Please select two or more layers in the desired order." };

    app.beginUndoGroup("XYi Snuggle Layers");
    const frameRate = comp.frameRate;
    let currentStartTime = selectedLayers[0].inPoint;

    for (let i = 0; i < selectedLayers.length; i++) {
      const layer = selectedLayers[i];
      const offset = currentStartTime - layer.inPoint;
      layer.startTime += offset;
      currentStartTime = Math.floor(layer.outPoint * frameRate) / frameRate;
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Find and Replace -- ported from XYi_Toolbox.jsx's "Find and Replace" tab
// (gate()/gate_All()/gateClose()). **Correction to an earlier survey note
// in this file**: this tab was flagged as "possibly unfinished" because
// its `FinAndRepTab.add(...)` calls for the two text fields and three
// buttons are ~900 lines further down in the source than the tab's own
// group declaration (added later, out of the original declaration order)
// -- easy to miss on a first pass, but the feature IS fully wired and
// finished. Renames every CompItem (or literally every project item, for
// "Replace All") whose name contains the search string. Runs the pass 10
// times over, same as the original -- harmless (a no-op once no more
// matches exist) but kept to match behavior exactly.
// =============================================================================
export const findReplace = (original: string, replaceWith: string, allItems: boolean): Result => {
  try {
    app.beginUndoGroup(allItems ? "XYi find and Replace All" : "XYi find and Replace Comps");
    for (let a = 0; a <= 10; a++) {
      for (let i = 1; i <= app.project.numItems; i++) {
        const item = app.project.item(i);
        if (allItems || item instanceof CompItem) {
          item.name = item.name.replace(original, replaceWith);
        }
      }
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Wall Tools -- ported from XYi_Toolbox.jsx's "Wall Tools" tab. Generate
// Wall/Generate Wall Aspect Ratio are backed by XYi_WallGen.jsx's
// createGrid(); Focal Organiser is XYi_DistCalc.jsx (renames+reorders
// layers by distance from a reference layer). **"Wall Queue"
// (Wall_Queue_Update(), XYI_Wall_Queue.jsx) is deliberately NOT ported**
// -- its logic re-runs a full nested comp-copy pass once per selected
// layer inside an outer loop, which reads as an unintentional side effect
// of how the original script was structured (calling a whole standalone
// script's top-level code repeatedly) rather than deliberate per-layer
// behavior, and is confusing enough that porting it faithfully risks
// reproducing a bug rather than a feature. Flag to the studio if this
// button turns out to be load-bearing for something not obvious from the
// source.
// =============================================================================
interface WallGenerateResult extends Result {
  computedAspectRatio?: number;
}

function wallCreateGrid(gridWidth: number, gridHeight: number, numX: number, numY: number) {
  const gridComp = app.project.items.addComp("Grid Composition", gridWidth, gridHeight, 1, 10, 30);
  let compWidth = Math.max(Math.round(gridWidth / numX), 1);
  let compHeight = Math.max(Math.round(gridHeight / numY), 1);

  for (let row = 0; row < numY; row++) {
    for (let col = 0; col < numX; col++) {
      const compName = "Comp " + (row * numX + col + 1);
      const comp = app.project.items.addComp(compName, compWidth, compHeight, 1, 10, 30);
      const layer = gridComp.layers.add(comp);
      layer.property("Position")!.setValue([col * compWidth + compWidth / 2, row * compHeight + compHeight / 2]);
    }
  }
  return gridComp;
}

export const wallGenerate = (gridWidth: number, gridHeight: number, numX: number, numY: number): WallGenerateResult => {
  try {
    app.beginUndoGroup("Create Grid");
    wallCreateGrid(gridWidth, gridHeight, numX, numY);
    app.endUndoGroup();
    return { success: true, computedAspectRatio: (gridWidth / numX) / (gridHeight / numY) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface WallGenerateAspectResult extends Result {
  computedWidth?: number;
}

export const wallGenerateAspect = (gridWidth: number, gridHeight: number, numY: number, aspectRatio: number): WallGenerateAspectResult => {
  try {
    const numX = Math.round(gridWidth / ((gridHeight / numY) * aspectRatio));
    app.beginUndoGroup("Create Grid");
    wallCreateGrid(gridWidth, gridHeight, numX, numY);
    app.endUndoGroup();
    return { success: true, computedWidth: numX };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const focalOrganiser = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please open a composition and select it before running this." };
    const selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return { success: false, error: "Please select a layer to use as the reference point." };

    app.beginUndoGroup("XYi Dist Calc");
    const refPoint = selectedLayers[0].property("Position")!.value as number[];

    const layersWithDistances: { layer: Layer; distance: number }[] = [];
    for (let i = 1; i <= comp.layers.length; i++) {
      const layer = comp.layers[i];
      const pos = layer.property("Position")!.value as number[];
      const distance = Math.sqrt(Math.pow(pos[0] - refPoint[0], 2) + Math.pow(pos[1] - refPoint[1], 2));
      layersWithDistances.push({ layer, distance });
      layer.name = "Distance_" + distance.toFixed(2);
    }

    layersWithDistances.sort((a, b) => a.distance - b.distance);
    for (let j = 0; j < layersWithDistances.length; j++) {
      layersWithDistances[j].layer.moveBefore(comp.layers[1]);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Extreme Tools 01 -- ported from XYi_Toolbox.jsx's "Extreme Tools 01" tab
// (landscape: XYi_ExtremeTools.jsx's createCompsWithAspectRatios();
// portrait: XYi_ExtremeTools_Port.jsx's createCompsWithAspectRatiosPortrait()).
// Builds a "Main Comp" containing however many video panels (at an
// automatically-computed aspect ratio within the given min/max) fit
// between fixed-width surround/mid panels, all brand-new comps/solids --
// no file access at all. Opens the resulting Main Comp in the viewer via
// openCompInViewer() (ported from XYi_OpenComp.jsx -- a normal AE
// comp-viewer action, unrelated to the master-file "never open" rule,
// which is specifically about opening a PROJECT file).
// =============================================================================
export const openCompInViewer = (compName: string): Result => {
  let target: CompItem | null = null;
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.name === compName) {
      target = item;
      break;
    }
  }
  if (!target) return { success: false, error: "No composition found named '" + compName + "'." };
  app.beginUndoGroup("Open Comp");
  target.openInViewer();
  app.endUndoGroup();
  return { success: true };
};

interface ExtremeToolsResult extends Result {
  message?: string;
}

export const extremeToolsLandscape = (
  leftAspectRatio: number,
  midAspectRatio: number,
  rightAspectRatio: number,
  totalWidth: number,
  totalHeight: number,
  minVideoAspectRatio: number,
  maxVideoAspectRatio: number
): ExtremeToolsResult => {
  try {
    const frameRate = 23.976;
    const duration = 15;
    const TW = totalWidth;
    const TH = totalHeight;
    const L = leftAspectRatio;
    const R = rightAspectRatio;
    const M = midAspectRatio;
    const minAR = minVideoAspectRatio;
    const maxAR = maxVideoAspectRatio;

    app.beginUndoGroup("XYi Extreme Tools (Landscape)");
    const mainComp = app.project.items.addComp("Main Comp", TW, TH, 1, duration, frameRate);

    const layoutAR = TW / TH;
    const surroundTotal = L + R;
    let nVideos = 1;
    let finalVideoAR = 0;
    while (true) {
      const usedBySurrounds = surroundTotal + (nVideos - 1) * M;
      const leftover = layoutAR - usedBySurrounds;
      if (leftover <= 0) {
        app.endUndoGroup();
        return { success: false, error: "Surround widths exceed total width. Cannot proceed." };
      }
      finalVideoAR = leftover / nVideos;
      if (finalVideoAR > maxAR) {
        nVideos++;
        continue;
      }
      if (finalVideoAR < minAR) {
        app.endUndoGroup();
        return { success: false, error: "Cannot maintain the minimum video aspect ratio. Try different inputs." };
      }
      break;
    }

    let xOffset = 0;
    function placeCompInMain(comp: CompItem, compWidth: number) {
      const layer = mainComp.layers.add(comp);
      layer.property("Anchor Point")!.setValue([0, TH / 2]);
      layer.property("Position")!.setValue([xOffset, TH / 2]);
      xOffset += compWidth;
    }

    const leftWidth = Math.floor(L * TH);
    const rightWidth = Math.floor(R * TH);
    const midWidth = Math.floor(M * TH);
    const videoWidth = Math.floor(finalVideoAR * TH);

    function createMasterComp(name: string, width: number, colorRGB: number[]) {
      const c = app.project.items.addComp(name, width, TH, 1, duration, frameRate);
      c.layers.addSolid(colorRGB, name + " Solid", width, TH, 1);
      return c;
    }

    const leftMaster = leftWidth > 0 ? createMasterComp("Left Surround", leftWidth, [1, 0, 0]) : null;
    const midMaster = midWidth > 0 ? createMasterComp("Mid Surround", midWidth, [0, 0, 1]) : null;
    const rightMaster = rightWidth > 0 ? createMasterComp("Right Surround", rightWidth, [1, 1, 0]) : null;
    const videoMaster = createMasterComp("Video Master", videoWidth, [0, 1, 0]);

    if (leftMaster) placeCompInMain(leftMaster, leftWidth);
    for (let i = 1; i <= nVideos; i++) {
      placeCompInMain(videoMaster, videoWidth);
      if (i < nVideos && midMaster) placeCompInMain(midMaster, midWidth);
    }
    if (rightMaster) placeCompInMain(rightMaster, rightWidth);

    openCompInViewer("Main Comp");
    app.endUndoGroup();
    return {
      success: true,
      message: "Compositions created. Videos: " + nVideos + ", Final Video AR: " + finalVideoAR.toFixed(3) + ", Layout filled: " + xOffset + "px (target ~" + TW + ")",
    };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

export const extremeToolsPortrait = (
  leftAspectRatio: number,
  midAspectRatio: number,
  rightAspectRatio: number,
  totalWidth: number,
  totalHeight: number,
  minVideoAspectRatio: number,
  maxVideoAspectRatio: number
): ExtremeToolsResult => {
  try {
    const frameRate = 23.976;
    const duration = 15;
    const PW = totalWidth;
    const PH = totalHeight;
    if (!(PW > 0) || !(PH > 0)) return { success: false, error: "Invalid totalWidth/totalHeight. They must be positive numbers." };

    function safeInvert(v: number) {
      if (isNaN(v) || v <= 0) return 0;
      return 1 / v;
    }
    const L = safeInvert(leftAspectRatio);
    const M = safeInvert(midAspectRatio);
    const R = safeInvert(rightAspectRatio);

    if (!(minVideoAspectRatio > 0) || !(maxVideoAspectRatio > 0)) {
      return { success: false, error: "Invalid minVideoAspectRatio or maxVideoAspectRatio. Both must be > 0." };
    }
    let minAR = 1 / minVideoAspectRatio;
    let maxAR = 1 / maxVideoAspectRatio;
    if (minAR > maxAR) {
      const tmp = minAR;
      minAR = maxAR;
      maxAR = tmp;
    }

    app.beginUndoGroup("XYi Extreme Tools (Portrait)");
    const mainComp = app.project.items.addComp("Main Comp Portrait", PW, PH, 1, duration, frameRate);

    const layoutAR = PH / PW;
    const surroundTotal = L + R;
    if (surroundTotal >= layoutAR && M === 0) {
      app.endUndoGroup();
      return { success: false, error: "Surround heights (top + bottom) already exceed total layout height. Cannot proceed." };
    }

    let nVideos = 1;
    let finalVideoAR = 0;
    while (true) {
      const usedBySurrounds = surroundTotal + (nVideos - 1) * M;
      const leftover = layoutAR - usedBySurrounds;
      if (leftover <= 0) {
        app.endUndoGroup();
        return { success: false, error: "Surround & mid heights exceed total height. Cannot proceed with given inputs." };
      }
      finalVideoAR = leftover / nVideos;
      if (finalVideoAR > maxAR) {
        nVideos++;
        if (nVideos > 1000) {
          app.endUndoGroup();
          return { success: false, error: "Unable to meet maxVideoAspectRatio constraint (loop limit reached)." };
        }
        continue;
      }
      if (finalVideoAR < minAR) {
        app.endUndoGroup();
        return { success: false, error: "Cannot maintain the minimum video aspect ratio with these inputs. Try different inputs." };
      }
      break;
    }

    let yOffset = 0;
    function placeCompInMain(comp: CompItem, compHeight: number) {
      const layer = mainComp.layers.add(comp);
      layer.property("Anchor Point")!.setValue([PW / 2, 0]);
      layer.property("Position")!.setValue([PW / 2, yOffset]);
      yOffset += compHeight;
    }

    const leftHeight = L > 0 ? Math.round(L * PW) : 0;
    const midHeight = M > 0 ? Math.round(M * PW) : 0;
    const rightHeight = R > 0 ? Math.round(R * PW) : 0;
    const videoHeight = Math.round(finalVideoAR * PW);
    if (videoHeight < 1) {
      app.endUndoGroup();
      return { success: false, error: "Computed video panel height < 1px (unexpected). Check inputs." };
    }

    function createMasterComp(name: string, height: number, colorRGB: number[]) {
      const c = app.project.items.addComp(name, PW, height, 1, duration, frameRate);
      c.layers.addSolid(colorRGB, name + " Solid", PW, height, 1);
      return c;
    }

    const topMaster = leftHeight > 0 ? createMasterComp("Top Surround", leftHeight, [1, 0, 0]) : null;
    const midMaster = midHeight > 0 ? createMasterComp("Mid Surround", midHeight, [0, 0, 1]) : null;
    const bottomMaster = rightHeight > 0 ? createMasterComp("Bottom Surround", rightHeight, [1, 1, 0]) : null;
    const videoMaster = createMasterComp("Video Master", videoHeight, [0, 1, 0]);

    if (topMaster) placeCompInMain(topMaster, leftHeight);
    for (let i = 1; i <= nVideos; i++) {
      placeCompInMain(videoMaster, videoHeight);
      if (i < nVideos && midMaster) placeCompInMain(midMaster, midHeight);
    }
    if (bottomMaster) placeCompInMain(bottomMaster, rightHeight);

    openCompInViewer("Main Comp Portrait");
    app.endUndoGroup();
    return {
      success: true,
      message: "Portrait compositions created. Videos: " + nVideos + ", Final Video AR (h/w): " + finalVideoAR.toFixed(4) + ", Video height: " + videoHeight + "px (target ~" + PH + "px)",
    };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Master Tools -- ported from XYi_Toolbox.jsx's "Master Tools" tab. Auto AR
// (XYi_AutAR.jsx), Velocity Scaler (XYi_VelSca.jsx), the Aspect Ratio/
// Extreme-format one-click comp resizers (XYi_CompSize.jsx's
// resizeCompCentered(), shared by both button grids), and Transform Apply
// - Scale/Position (reuse the already-ported transformApply() with
// explicit flags -- see its comment). All operate on the active
// comp/selected layers only.
// =============================================================================
// The offset math below is a faithful port of XYi_CompSize.jsx's
// resizeCompCentered(). The "content not staying centered on resize" bug
// this was once instrumented with a diagnostic build to chase was NOT in
// here -- it was (a) MasterTools.tsx passing reconstructed-from-aspect-ratio
// pixel sizes instead of the original buttons' real ones, and (b) an
// auto-center point injected into Auto AR's Position expression that the
// original rig never had. Both fixed at their own sites; the diagnostic
// message-building is reverted. The one intentional addition kept here: the
// catch block calls app.endUndoGroup(), which the original never did -- an
// exception mid-loop would otherwise leave the undo group open indefinitely.
export const resizeCompositionCentered = (newWidth: number, newHeight: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select a Composition active in the timeline." };
    if (isNaN(newWidth) || isNaN(newHeight)) return { success: false, error: "Invalid dimensions. Please enter valid numbers." };

    app.beginUndoGroup("Resize Composition Centered");
    const oldWidth = comp.width;
    const oldHeight = comp.height;
    const widthOffset = (newWidth - oldWidth) / 2;
    const heightOffset = (newHeight - oldHeight) / 2;

    for (let i = 1; i <= comp.numLayers; i++) {
      const layer = comp.layer(i);
      if (layer.parent !== null || layer.locked) continue;

      // Access transform properties as ATTRIBUTES (layer.transform.position),
      // exactly like XYi_CompSize.jsx -- NOT via layer.property("name")
      // string lookup. This distinction is load-bearing, found from a real
      // broken resize: Point of Interest and Anchor Point share the same
      // matchName ("ADBE Anchor Point"), so layer.property("Point of
      // Interest") on a normal footage/precomp layer resolves to that
      // layer's ANCHOR POINT -- the old code here silently shifted every
      // layer's anchor by (widthOffset, heightOffset) on each resize,
      // wrecking rigged layers. transform.pointOfInterest is falsy on
      // non-camera/light layers, matching the original's guard.
      const tf = (layer as any).transform;
      if (tf.position.dimensionsSeparated) {
        tf.xPosition.setValue((tf.xPosition.value as number) + widthOffset);
        tf.yPosition.setValue((tf.yPosition.value as number) + heightOffset);
      } else {
        const curPos = tf.position.value as number[];
        if ((layer as any).threeDLayer) {
          tf.position.setValue([curPos[0] + widthOffset, curPos[1] + heightOffset, curPos[2]]);
        } else {
          tf.position.setValue([curPos[0] + widthOffset, curPos[1] + heightOffset]);
        }
      }

      // Belt-and-braces on top of the original's own truthiness guard:
      // only cameras/lights genuinely have a Point of Interest, and they're
      // also the only layer types without sourceRectAtTime (same duck-type
      // rule motionTools.ts established for the inverse check).
      const isCameraOrLight = typeof (layer as any).sourceRectAtTime !== "function";
      if (isCameraOrLight) {
        const poiProp = tf.pointOfInterest;
        if (poiProp && poiProp.numKeys === 0) {
          const curPOI = poiProp.value as number[];
          poiProp.setValue([curPOI[0] + widthOffset, curPOI[1] + heightOffset, curPOI[2]]);
        }
      }
    }

    comp.width = Math.floor(newWidth);
    comp.height = Math.floor(newHeight);
    app.endUndoGroup();
    return { success: true, message: "Resized " + oldWidth + "x" + oldHeight + " -> " + comp.width + "x" + comp.height + "." };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

export const velocityScaler = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem) || comp.selectedLayers.length === 0) return { success: false, error: "Please select at least one layer." };

    app.beginUndoGroup("Add Velocity Transform");
    const exprCode =
      "vel = effect('Velocity')('Slider');\r" +
      "startVal = 100 - ((thisLayer.outPoint - thisLayer.inPoint)) * vel;\r" +
      "sin_frame = thisComp.frameDuration;\r" +
      "inP = thisLayer.inPoint - sin_frame;\r" +
      "outP = thisLayer.outPoint - sin_frame;\r" +
      "linear(time, inP, outP, startVal, 100);";

    for (let i = 0; i < comp.selectedLayers.length; i++) {
      const layer = comp.selectedLayers[i];
      const effects = layer.property("Effects") as Property;
      effects.addProperty("ADBE Geometry2");
      const slider = effects.addProperty("ADBE Slider Control") as Property;
      slider.name = "Velocity";
      (slider.property("Slider") as Property).setValue(1.39);
      ((layer.property("Effects") as Property).property("Transform") as Property).property("Scale")!.expression = exprCode;
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Ported 1:1 from XYi_AutAR.jsx -- builds a set of Point/Slider Control
// "rig" effects (one Position + one Scale control per named landscape/
// portrait aspect-ratio preset, plus an Over_Ride slider) on each selected
// layer, then drives a real Transform effect's Position/Scale via a
// generated expression that interpolates between whichever of those
// controls have been manually set, based on the comp's current aspect
// ratio. Entirely expression/effects-based -- touches no files.
// Aspect-ratio keys, copied EXACTLY from the LIVE installed XYi_AutAR.jsx
// ("/Applications/Adobe After Effects 2026/Scripts/toolset/XYi_AutAR.jsx",
// header "AspectRig_Universal_v2"). CRITICAL VERSION TRAP, hit twice now:
// ~/Documents/toolset/XYi_AutAR.jsx is the OLDER v1 ("AspectRig_Universal")
// with different keys (96 = 2305/576, Extreme = 3550/458 = 7.751) and no
// auto-center logic -- a previous session "fixed" this file toward v1 and
// broke real studio rigs. The live v2's keys line up with the live
// toolbox's Aspect Ratio button sizes (96 = 4.0 = 5760/1440, Extreme =
// 6.552901024 = 3840/586). Always diff against the LIVE install, not the
// Documents copy.
const AUTO_AR_LANDSCAPE = {
  labels: ["Square", "Quad", "1920x1080", "48", "30", "96", "Extreme"],
  w: { Square: 1.0, Quad: 1.333333, "1920x1080": 1.777778, "48": 2.0, "30": 2.237762, "96": 4.0, Extreme: 6.552901024 } as Record<string, number>,
};
// The original's portrait set also carried a "Square" (1.0) entry, but it
// only ever built ONE set (landscape OR portrait, per the comp's current
// orientation). This port builds both and interpolates over the union, so a
// [P] Square would sit at the exact same aspect as [L] Square -- two points
// at an identical w, i.e. a degenerate zero-width interpolation segment.
// Dropped deliberately; [L] Square already covers 1.0.
const AUTO_AR_PORTRAIT = {
  labels: ["1Sheet", "1080x1920", "Tall-Port", "6Sheet"],
  w: { "1Sheet": 1080 / 1600, "1080x1920": 1080 / 1920, "Tall-Port": 844 / 2382, "6Sheet": 1080 / 1620 } as Record<string, number>,
};

function autoArAddControl(effectsGroup: Property, type: "point" | "slider", name: string, val: any): Property {
  const matchName = type === "point" ? "ADBE Point Control" : "ADBE Slider Control";
  const existing = effectsGroup.property(name) as Property | null;
  if (existing) return existing;
  const p = effectsGroup.addProperty(matchName) as Property;
  p.name = name;
  if (val !== undefined) {
    if (type === "point") (p.property("Point") as Property).setValue(val);
    else (p.property("Slider") as Property).setValue(val);
  }
  return p;
}

// Resolve a Transform-effect parameter by MATCHNAME first, display name only
// as a fallback.
//
// This is not defensive tidying -- the display name is version-dependent and
// it silently broke the rig. On AE 26.2 and earlier the Transform effect's
// uniform-scale slot reports its name as "Scale" while Uniform Scale is
// ticked; on 26.3 it reports "Scale Height" unconditionally. So
// `transformFx.property("Scale")` returned null on a 26.3 station, the
// `if (scaleProp)` guard below skipped the entire scale half of the rig, and
// the artist got a correct-looking Auto AR with no scale expression and no
// error -- for months, across both this port and the original XYi_AutAR.jsx.
// Confirmed by probe on the 26.3 machine (scripts/diagnostics/auto-ar-probe.jsx):
// Uniform Scale = 1, property('Scale') NULL, property('Scale Height') FOUND.
//
// `ADBE Geometry2-000n` is stable across versions AND languages, which is the
// same reason CLAUDE.md §2 already bans display-name property lookups.
// Display names are kept as a fallback purely in case the effect the rig
// latched onto isn't ADBE Geometry2 at all (it matches by the name
// "Transform", so it can pick up a renamed effect).
function autoArTransformParam(transformFx: Property, matchName: string, displayNames: string[]): Property | null {
  const byMatch = transformFx.property(matchName) as Property | null;
  if (byMatch) return byMatch;
  for (var i = 0; i < displayNames.length; i++) {
    const byName = transformFx.property(displayNames[i]) as Property | null;
    if (byName) return byName;
  }
  return null;
}

function autoArBuildExpression(type: "position" | "scale", landscapeObj: typeof AUTO_AR_LANDSCAPE, portraitObj: typeof AUTO_AR_PORTRAIT): string {
  const isPos = type === "position";
  let expr = "";
  expr += "// Automatic Aspect Interpolation (" + type + ")\n";
  expr += "var compW = thisComp.width; var compH = thisComp.height;\n";
  expr += "var w = compW/compH;\n\n";
  expr += "var labelW = {};\n";
  for (const key in landscapeObj.w) expr += "labelW['" + key + "'] = " + Number(landscapeObj.w[key]).toFixed(6) + ";\n";
  for (const key in portraitObj.w) expr += "labelW['" + key + "'] = " + Number(portraitObj.w[key]).toFixed(6) + ";\n";
  expr += "\nvar points = [];\n";

  const suffix = isPos ? " Pos" : " Scale";
  const controlType = isPos ? "Point" : "Slider";
  expr += "var labelsL = " + JSON.stringify(landscapeObj.labels) + ";\n";
  expr += "for (var i=0; i<labelsL.length; i++){\n";
  expr += "  var lab = labelsL[i];\n";
  expr += "  try { var val = effect('[L] ' + lab + '" + suffix + "')('" + controlType + "').value; } catch(e){ continue; }\n";
  expr += "  var wv = labelW[lab];\n";
  expr += "  if(wv !== undefined) points.push([wv, val]);\n";
  expr += "}\n";
  expr += "var labelsP = " + JSON.stringify(portraitObj.labels) + ";\n";
  expr += "for (var i=0; i<labelsP.length; i++){\n";
  expr += "  var lab = labelsP[i];\n";
  expr += "  try { var val = effect('[P] ' + lab + '" + suffix + "')('" + controlType + "').value; } catch(e){ continue; }\n";
  expr += "  var wv = labelW[lab];\n";
  expr += "  if(wv !== undefined) points.push([wv, val]);\n";
  expr += "}\n";

  // AUTO-CENTER LOGIC -- part of the LIVE v2 XYi_AutAR.jsx (position only):
  // injects one extra interpolation point at the layer SOURCE's own aspect
  // ratio, valued at the source's center. This is what recenters a layer
  // when the comp is resized to (or near) the source's own aspect. A
  // previous session removed this as a "phantom point the original never
  // had" -- it diffed against the OLD v1 in ~/Documents/toolset, which
  // indeed never had it; the studio's live v2 DOES. Keep it. (The
  // hypotheticalHeight line is dead code in v2 too -- kept verbatim.)
  if (isPos) {
    expr += "\n// --- AUTO-CENTER LOGIC ---\n";
    expr += "try {\n";
    expr += "    if (thisLayer.source) {\n";
    expr += "        var srcAspect = thisLayer.source.width / thisLayer.source.height;\n";
    expr += "        var centerX = thisLayer.source.width / 2;\n";
    expr += "        var hypotheticalHeight = thisComp.width / srcAspect;\n";
    expr += "        var centerY = thisLayer.source.height / 2;\n";
    expr += "        points.push([srcAspect, [centerX, centerY]]);\n";
    expr += "    }\n";
    expr += "} catch(err) { /* Layer has no source, ignore */ }\n";
  }

  expr += "\nvar res = " + (isPos ? "value" : "100") + ";\n";
  expr += "if(points.length === 1){ res = points[0][1]; }\n";
  expr += "else if(points.length > 1) {\n";
  expr += "  points.sort(function(a,b){return a[0]-b[0];});\n";
  expr += "  if(w <= points[0][0]) res = points[0][1];\n";
  expr += "  else if(w >= points[points.length-1][0]) res = points[points.length-1][1];\n";
  expr += "  else {\n";
  expr += "    for(var j=0;j<points.length-1;j++){\n";
  expr += "      var wA=points[j][0], vA=points[j][1];\n";
  expr += "      var wB=points[j+1][0], vB=points[j+1][1];\n";
  expr += "      if(w >= wA && w <= wB){\n";
  expr += "        var range = wB - wA;\n";
  expr += "        if (range < 0.0001) { res = vA; }\n";
  expr += "        else {\n";
  expr += "          var t = (w - wA) / range;\n";
  expr += "          res = vA + (vB - vA) * t;\n";
  expr += "        }\n";
  expr += "        break;\n";
  expr += "      }\n";
  expr += "    }\n";
  expr += "  }\n";
  expr += "}\n";

  if (!isPos) {
    expr += "try { var over = effect('Over_Ride')('Slider').value; } catch(e) { var over = 100; }\n";
    expr += "res * (over/100);\n";
  } else {
    expr += "res;\n";
  }
  return expr;
}

export const autoAspectRatio = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please open/select a composition." };
    const selLayers = comp.selectedLayers;
    if (!selLayers || selLayers.length === 0) return { success: false, error: "Please select one or more layers." };

    app.beginUndoGroup("Apply Aspect Rig (Universal v2)");
    // Parameters the rig couldn't resolve, reported at the end instead of
    // being swallowed -- see the return below.
    const skipped: string[] = [];
    for (let li = 0; li < selLayers.length; li++) {
      const layer = selLayers[li];
      const effects = layer.property("Effects") as Property;
      if (!effects) { skipped.push(layer.name + " (no Effects group)"); continue; }

      // layer.property("Anchor Point").value is [x,y,z] (3 elements) for a
      // 3D layer, but both places this feeds into below -- the Point
      // Control effect's "Point" and the Transform effect's own "Anchor
      // Point" -- are fixed 2D properties regardless of the layer's 3D
      // status, so passing the raw 3-element value throws "Value array
      // does not have 2 elements". Truncate to X/Y explicitly; Z isn't
      // part of what this rig interpolates anyway.
      const rawAnchor = (layer.property("Anchor Point") as Property).value as number[];
      const layerAnchor: [number, number] = [rawAnchor[0], rawAnchor[1]];

      for (let k = 0; k < AUTO_AR_LANDSCAPE.labels.length; k++) {
        const lab = AUTO_AR_LANDSCAPE.labels[k];
        autoArAddControl(effects, "point", "[L] " + lab + " Pos", layerAnchor);
        autoArAddControl(effects, "slider", "[L] " + lab + " Scale", 100);
      }
      for (let p = 0; p < AUTO_AR_PORTRAIT.labels.length; p++) {
        const lab = AUTO_AR_PORTRAIT.labels[p];
        autoArAddControl(effects, "point", "[P] " + lab + " Pos", layerAnchor);
        autoArAddControl(effects, "slider", "[P] " + lab + " Scale", 100);
      }
      autoArAddControl(effects, "slider", "Over_Ride", 100);

      const transformFx = (effects.property("Transform") as Property) || (effects.addProperty("ADBE Geometry2") as Property);
      if (!transformFx) { skipped.push(layer.name + " (no Transform effect)"); continue; }
      transformFx.name = "Transform";

      const tfAnchor = autoArTransformParam(transformFx, "ADBE Geometry2-0001", ["Anchor Point"]);
      if (tfAnchor) tfAnchor.setValue(layerAnchor);

      const posProp = autoArTransformParam(transformFx, "ADBE Geometry2-0002", ["Position"]);
      // "Scale" is what 26.2 and earlier call this; "Scale Height" is 26.3+.
      const scaleProp = autoArTransformParam(transformFx, "ADBE Geometry2-0003", ["Scale", "Scale Height"]);
      if (posProp) {
        posProp.expression = autoArBuildExpression("position", AUTO_AR_LANDSCAPE, AUTO_AR_PORTRAIT);
        posProp.expressionEnabled = true;
      } else {
        skipped.push(layer.name + " (Position)");
      }
      if (scaleProp) {
        const scaleExpr = autoArBuildExpression("scale", AUTO_AR_LANDSCAPE, AUTO_AR_PORTRAIT);
        scaleProp.expression = scaleExpr;
        scaleProp.expressionEnabled = true;
        // The slot above is Scale HEIGHT. With Uniform Scale ticked (the
        // default, and what the rig assumes) Width follows it and one
        // expression scales uniformly -- exactly the behaviour every station
        // has had. With it UNticked, Width is independent, and driving height
        // alone would stretch the layer. Drive both so an unticked checkbox
        // produces uniform scaling rather than a visibly wrong rig; before
        // this the same case just silently did nothing at all.
        const uniform = autoArTransformParam(transformFx, "ADBE Geometry2-0011", ["Uniform Scale"]);
        // Truthiness, not `!== 0`: an AE checkbox param reads back as 1/0 on
        // current builds, but `false !== 0` is TRUE under strict comparison,
        // so a boolean would invert this test. `!!` reads both correctly.
        let isUniform = true;
        if (uniform) isUniform = !!uniform.value;
        if (!isUniform) {
          const widthProp = autoArTransformParam(transformFx, "ADBE Geometry2-0004", ["Scale Width"]);
          if (widthProp) {
            widthProp.expression = scaleExpr;
            widthProp.expressionEnabled = true;
          }
        }
      } else {
        skipped.push(layer.name + " (Scale)");
      }
    }
    app.endUndoGroup();
    // A rig that half-applies must never report success. The silent
    // `if (scaleProp)` skip is precisely how the 26.3 breakage went unnoticed
    // for months -- every control appeared, position worked, and nothing
    // anywhere said the scale expression had not been written.
    if (skipped.length > 0) {
      return {
        success: false,
        error: "Auto AR could not find these Transform parameters, so their expressions were NOT applied: " +
          skipped.join(", ") + ". Check the Transform effect on those layers.",
      };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Project Buttons -- ported from XYi_Toolbox.jsx's "Project Buttons" tab.
// Shape to Masks (XYi_ShapeCon.jsx), C4D Line Art (XYi_C4DLineart_Front.jsx
// -- reads a C4D-exported ASCII/CSV file via a normal open-file dialog,
// no master files touched), Optimal Placement (XYi_Optimal_Placement.jsx),
// and Detail-Preserving Scale (the inline PreDetSca()). **"Midcarder"
// (MidCard(), XYi_MidCarder.jsx) is deliberately NOT ported** -- it opens
// a CSV, then for each row calls `app.project.save()` on the CURRENTLY
// OPEN file under a new name, closes without saving, and re-opens
// `app.project.file` (whatever was open when the tool was run) directly
// via `app.open()`, repeated once per row. If that file is ever a master
// (not already a working copy), this repeatedly opens a master directly,
// which is exactly what this project's core safety rule forbids. Needs
// explicit confirmation from the studio on real-world usage (is this
// tool ever run with a master open?) before porting, same pattern as
// MC It!/Campaign Localiser/Campaign Rename.
// =============================================================================
export const shapeToMasks = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select a composition." };
    const selectedLayer = comp.selectedLayers[0];
    if (!selectedLayer || !(selectedLayer instanceof ShapeLayer)) return { success: false, error: "Please select a shape layer." };

    app.beginUndoGroup("Convert Shape Paths to Masks");
    const solidLayer = comp.layers.addSolid([1, 1, 1], selectedLayer.name + " Masks", comp.width, comp.height, comp.pixelAspect);
    const contents = selectedLayer.property("Contents") as Property;
    if (!contents) {
      app.endUndoGroup();
      return { success: false, error: "No shape contents found." };
    }

    function extractPaths(group: Property, accumulatedPosition: number[]) {
      for (let i = 1; i <= group.numProperties; i++) {
        const property = group.property(i) as Property;
        if (property.matchName === "ADBE Vector Group") {
          const transform = property.property("Transform") as Property;
          let groupPosition = [0, 0];
          if (transform) groupPosition = (transform.property("Position") as Property).value as number[];
          const updatedPosition = [accumulatedPosition[0] + groupPosition[0], accumulatedPosition[1] + groupPosition[1]];
          extractPaths(property.property("Contents") as Property, updatedPosition);
        }
        if (property.matchName === "ADBE Vector Shape - Group") {
          const path = property.property("Path") as Property;
          if (path && path.numKeys === 0) {
            const mask = (solidLayer.property("Masks") as Property).addProperty("Mask") as Property;
            const maskPath = path.value as Shape;
            const vertices: number[][] = [];
            for (let j = 0; j < maskPath.vertices.length; j++) {
              vertices.push([maskPath.vertices[j][0] + accumulatedPosition[0], maskPath.vertices[j][1] + accumulatedPosition[1]]);
            }
            maskPath.vertices = vertices;
            (mask.property("Mask Path") as Property).setValue(maskPath);
          }
        }
      }
    }
    extractPaths(contents, [0, 0]);
    app.endUndoGroup();
    return { success: true, message: "Shape paths converted to masks with transform positions applied." } as Result & { message: string };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const c4dLineArt = (): Result => {
  try {
    const c4dFile = File.openDialog("Please select the C4D ASCII converted CSV...");
    if (!c4dFile) return { success: false, error: "No file selected." };

    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select a composition." };
    const selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return { success: false, error: "Please select one or more layers." };

    c4dFile.open("r");
    const allVertices: number[][] = [];
    const allInPoints: number[][] = [];
    const allOutPoints: number[][] = [];
    let count = 0;
    while (!c4dFile.eof) {
      try {
        const texLoc = c4dFile.readln().split(",");
        count++;
        if (count > 1) {
          const x = parseFloat(texLoc[1]);
          const y = parseFloat(texLoc[2]) * -1;
          const xIn = parseFloat(texLoc[4]);
          const yIn = parseFloat(texLoc[5]) * -1;
          const xOut = parseFloat(texLoc[7]);
          const yOut = parseFloat(texLoc[8]) * -1;
          allVertices.push([x, y]);
          allInPoints.push([xIn, yIn]);
          allOutPoints.push([xOut, yOut]);
        }
      } catch (e) {
        // matches original: malformed row silently skipped
      }
    }
    c4dFile.close();

    app.beginUndoGroup("XYi C4D Line Art");
    for (let i = 0; i < selectedLayers.length; i++) {
      const newMask = (selectedLayers[i].property("Masks") as Property).addProperty("Mask") as Property;
      const myMaskShape = newMask.property("Mask Path") as Property;
      const myShape = new Shape();
      myShape.vertices = allVertices;
      myShape.inTangents = allInPoints;
      myShape.outTangents = allOutPoints;
      myShape.closed = true;
      myMaskShape.setValue(myShape);
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface OptimalPlacementResult extends Result {
  message?: string;
}

export const optimalPlacement = (): OptimalPlacementResult => {
  try {
    const activeItem = app.project.activeItem as CompItem;
    if (!activeItem || !(activeItem instanceof CompItem)) return { success: false, error: "Please select a composition." };
    const selectedLayer = activeItem.selectedLayers;
    if (selectedLayer.length === 0) return { success: false, error: "Please select one or more layers with a 'Crop' mask." };

    app.beginUndoGroup("XYi Optimal Placement");
    let minAspectRatio = 0;
    let maxAspectRatio = 100;
    let maxHeight = activeItem.height;

    for (let i = 0; i < selectedLayer.length; i++) {
      let minX = 30000;
      let maxX = 0;
      let minY = 30000;
      let maxY = 0;
      try {
        const layer = selectedLayer[i];
        if (layer.mask(1).name !== "Crop") continue;
        const verts = ((layer.mask(1).property("Mask Path") as Property).value as Shape).vertices;
        const scaleX = ((layer.property("Scale") as Property).value as number[])[0] / 100;
        const scaleY = ((layer.property("Scale") as Property).value as number[])[1] / 100;
        const posX = ((layer.property("Position") as Property).value as number[])[0];
        const posY = ((layer.property("Position") as Property).value as number[])[1];
        const ancX = ((layer.property("Anchor Point") as Property).value as number[])[0];
        const ancY = ((layer.property("Anchor Point") as Property).value as number[])[1];
        const maxLayerX = layer.width;
        const maxLayerY = layer.height;

        for (let j = 0; j < verts.length; j++) {
          const x = posX + verts[j][0] * scaleX - ancX * scaleX;
          const y = posY + verts[j][1] * scaleY - ancY * scaleY;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }

        const midX = (maxX - minX) / 2 + minX;
        const midY = (maxY - minY) / 2 + minY;
        const compMaxWidth = activeItem.width;
        maxHeight = activeItem.height;

        if (minX < 0) {
          const revision = Math.abs(midX - compMaxWidth / 2);
          (layer.property("Position") as Property).setValue([posX + revision, posY]);
        }
        if (maxX > compMaxWidth) {
          const revision = Math.abs(midX - compMaxWidth / 2);
          (layer.property("Position") as Property).setValue([posX - revision, posY]);
        }
        if (minY < 0) {
          const revision = Math.abs(midY - maxHeight / 2);
          (layer.property("Position") as Property).setValue([posX, posY + revision]);
        }
        if (maxY > maxHeight) {
          const revision = Math.abs(midY - maxHeight / 2);
          (layer.property("Position") as Property).setValue([posX, posY - revision]);
        }

        const xWidth = (maxX - minX) / scaleX;
        const yHeight = (maxY - minY) / scaleY;
        const minRat = xWidth / maxLayerY;
        const maxRat = maxLayerX / yHeight;
        if (minRat > minAspectRatio) minAspectRatio = minRat;
        if (maxRat < maxAspectRatio) maxAspectRatio = maxRat;
      } catch (e) {
        // matches original: a layer without a "Crop" mask is silently skipped
      }
    }
    app.endUndoGroup();

    const message =
      "Minimum Aspect Ratio: " + minAspectRatio + " (try " + Math.floor(maxHeight * minAspectRatio) + "x" + maxHeight + " or " + maxHeight + "x" + Math.floor(maxHeight / minAspectRatio) + ")\n" +
      "Maximum Aspect Ratio: " + maxAspectRatio + " (try " + Math.floor(maxHeight * maxAspectRatio) + "x" + maxHeight + " or " + maxHeight + "x" + Math.floor(maxHeight / maxAspectRatio) + ")";
    return { success: true, message };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const detailPreservingScale = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select a composition." };
    const layerSelect = comp.selectedLayers;
    if (layerSelect.length === 0) return { success: false, error: "Please select one or more layers." };

    app.beginUndoGroup("XYi Scale to Detail-preserving Upscale");
    for (let i = 0; i < layerSelect.length; i++) {
      const scaleProp = layerSelect[i].property("Scale") as Property;
      const newScaleNum = (scaleProp.value as number[])[0];
      if (newScaleNum > 100) {
        const upscale = (layerSelect[i].property("Effects") as Property).addProperty("Detail-preserving Upscale") as Property;
        (upscale.property("Scale") as Property).setValue(newScaleNum);
        scaleProp.setValue([100, 100]);
      }
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Midcarder -- ported from toolset/XYi_MidCarder.jsx, Project Buttons tab
// ("Midcarder" button). Batch-localises the Midcard ("MC_0N") and Endcard
// ("EC") text layers of the CURRENTLY OPEN project from a CSV: for each
// territory row, replaces each MC/EC comp's matching Source Text with the
// row's value, then saves the result under a territory-named file and
// reopens the original to localise the next territory.
//
// **CONFIRMED EXCEPTION, authorised by the studio ("bring it in as is").**
// This directly `app.open()`s `app.project.file` (the project that was open
// when the tool was run), which could be a master. It's safe in practice
// the same way MC It!/Campaign Localiser are: each territory's result is
// written to a NEW file (`<stem-minus-2-chars><territory>.aep`) via
// save-as, the in-memory project is then closed with
// DO_NOT_SAVE_CHANGES, and the original is only ever RE-OPENED, never
// written -- so the master's on-disk bytes are untouched. Ported 1:1
// including that reopen-the-original loop; do not "harden" it to
// copy-first without asking, the studio explicitly wanted it as-is.
// =============================================================================
export const midcarder = (): Result => {
  try {
    const locFile = File.openDialog("Please select the File to Localise.");
    if (!locFile) return { success: true };
    if (!app.project.file) return { success: false, error: "Save/open a project first -- Midcarder localises the currently open project." };
    if (!locFile.open("r")) return { success: false, error: "Could not open the localisation file." };

    const name = app.project.file.name.split(".")[0];

    // Replaces, inside the comp named `val` (e.g. "MC_01" / "EC"), any text
    // layer whose Source Text (uppercased) equals `reference` with `ref`.
    function cardCheck(reference: string, ref: string, val: string) {
      for (let j = 1; j <= app.project.numItems; j++) {
        const item = app.project.item(j);
        if (item.name !== val || !(item instanceof CompItem)) continue;
        for (let k = 1; k <= item.layers.length; k++) {
          const layer = item.layer(k);
          if (layer instanceof TextLayer) {
            const srcText = layer.property("Source Text") as Property;
            if (String(srcText.value).toUpperCase() === String(reference).toUpperCase()) {
              srcText.setValue(String(ref));
            }
          }
        }
      }
    }

    // Save the current project under a territory-named file, close without
    // writing the original, then reopen the original for the next row.
    function saveFileAndMoveOn(ter: string) {
      const projFile = app.project.file!;
      const folderCur = projFile.parent;
      const newCompName = String(name.slice(0, -2)) + String(ter);
      const myNewFile = new File(folderCur.toString() + "/" + newCompName + ".aep");
      app.project.save(myNewFile);
      app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
      app.newProject();
      const fileToOpen = new File(String(projFile));
      app.open(fileToOpen);
    }

    let count = 0;
    let referenceLine: string[] = [];
    while (!locFile.eof) {
      try {
        const texLoc = locFile.readln().split(",");
        count += 1;
        if (count === 2) referenceLine = texLoc;
        if (texLoc[0].length < 9) {
          const ter = String(texLoc[0]);
          for (let i = 0; i < texLoc.length; i++) {
            const ref = texLoc[i];
            const referenceCol = referenceLine[i];
            let cardCheckVal = "MC_0" + String(i);
            if (i === texLoc.length - 1) cardCheckVal = "EC";
            cardCheck(referenceCol, ref, cardCheckVal);
            if (i === texLoc.length - 1) saveFileAndMoveOn(ter);
          }
        }
      } catch (err) {
        // matches original: a malformed row is silently skipped
      }
    }
    locFile.close();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Wall Queue -- ported from XYi_Toolbox.jsx's Wall_Queue_Update() + the
// nested toolset/XYI_Wall_Queue.jsx, the Wall Tools tab's "Wall Queue"
// button. Treats the active comp as a video wall (a comp whose layers'
// sources are sub-comp "panels") and advances it like a conveyor: each
// panel takes the previous panel's contents, the first panel is emptied,
// and the selected layer is fed into that now-empty first panel and
// removed from the wall. The original repeats this once per selected
// layer (feeding each in turn, advancing the queue each time) -- that
// per-layer repeat is preserved here as the intended behaviour.
//
// **Faithful port with ONE latent bug hardened**: the original's nested
// script removes selected layers while iterating FORWARD over the live
// `selectedLayers` array (mutation-during-iteration, which skips layers).
// It only worked because the wrapper selected exactly one layer at a time
// before each run. This port collects the selected layers up front into a
// stable array and processes that, so it behaves identically for the
// single-select case the original actually used, but also does the right
// thing if more than one layer is selected -- rather than reproducing a
// skip-every-other bug. Single-select behaviour is unchanged.
// =============================================================================
export const wallQueueUpdate = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select a composition in the project panel." };

    // Snapshot the selected layers up front (stable across the removals below).
    const selected: Layer[] = [];
    for (let i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).selected) selected.push(comp.layer(i));
    }
    if (selected.length === 0) return { success: false, error: "Please select at least one layer in the active composition." };

    // Collect the wall's panel comps (layers in the active comp whose
    // source is itself a comp), in layer order -- same as collectCompItems().
    function collectPanelComps(): CompItem[] {
      const panels: CompItem[] = [];
      for (let i = 1; i <= comp!.numLayers; i++) {
        const layer = comp!.layer(i);
        if (layer instanceof AVLayer && layer.source instanceof CompItem) panels.push(layer.source);
      }
      return panels;
    }

    function replaceCompLayers(sourceComp: CompItem, destComp: CompItem) {
      while (destComp.numLayers > 0) destComp.layer(1).remove();
      for (let i = 1; i <= sourceComp.numLayers; i++) {
        (sourceComp.layer(i) as AVLayer).copyToComp(destComp);
      }
    }

    app.beginUndoGroup("Update Compositions");

    // One conveyor advance per selected layer -- matches the original's
    // once-per-selected-layer repeat.
    for (let s = 0; s < selected.length; s++) {
      const panels = collectPanelComps();
      if (panels.length === 0) break;

      // Cascade: comp[j] takes comp[j-1]'s layers, walking from the back;
      // comp[0] is emptied to receive the new content.
      for (let j = panels.length - 1; j >= 0; j--) {
        if (j >= 1) {
          replaceCompLayers(panels[j - 1], panels[j]);
        } else {
          while (panels[0].numLayers > 0) panels[0].layer(1).remove();
        }
      }

      // Feed the selected layer into the (now-empty) first panel, then
      // remove it from the wall.
      (selected[s] as AVLayer).copyToComp(panels[0]);
      selected[s].remove();
    }

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// LOS Tools -- ported from XYi_Toolbox.jsx's "LOS Tools" tab, backed by
// XYi_LOSCsv.jsx's applyCSVToProjects(). Already safety-patched at the
// source-file level earlier this session (copy-first via
// `ov_safeOpenMasterCopy()` before any `app.open()`), so this port just
// carries that same, already-verified logic across -- no new safety work
// needed, only wiring. For each .aep in the chosen project folder: matches
// a same-size-token CSV, opens a VERSIONED COPY of the project (never the
// original file), replaces a named target layer's source in every comp
// under a "Main" folder with the best-matching component file for the
// CSV's last-page "ART" row, then saves and closes that copy. The
// project's own on-disk bytes are never touched -- only the new `_VNN`
// copy this function creates and saves.
// =============================================================================
function losSafeOpenMasterCopy(masterFile: File): Project {
  const folder = masterFile.parent;
  const stem = masterFile.name.replace(/\.aep$/i, "");
  let n = 1;
  let candidate: File;
  do {
    const suffix = "_V" + (n < 10 ? "0" + n : n);
    candidate = new File(folder.fsName + "/" + stem + suffix + ".aep");
    n++;
  } while (candidate.exists);
  if (!masterFile.copy(candidate.fsName)) {
    throw new Error("Could not copy master file to a working copy: " + candidate.fsName);
  }
  return app.open(candidate);
}

// True if `name` carries "OV" as its own isolated token -- matching the
// established Masters naming suffix documented in CLAUDE.md (e.g.
// "ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV.aep"), not a substring
// match -- "MOVE", "COVER", "APPROVED" etc. must NOT trip this.
export function hasIsolatedOvToken(name: string): boolean {
  return /(^|[_\s])OV([_\s.]|$)/i.test(name);
}

// Used by LOS Tools and JPGLoc (both "batch-replace footage across a
// folder of .aep files" tools): opens `file` copy-first ONLY if its name
// still carries the OV master-suffix token; otherwise opens it directly
// so the caller's own save() writes back to that same file. Confirmed
// with the user: once a batch has been renamed for a territory (e.g.
// "..._FR_..." with no "_OV" suffix left), those are the user's own
// working copies at that point in their real workflow, safe to edit and
// save in place -- exactly the same reasoning already established for
// MC It!/pingLoc, just decided per-FILE via its own name here rather than
// per-tool. A stray file that still has the OV suffix (e.g. one that
// hasn't been localised into this batch yet, sitting in the same folder
// by mistake) still goes through the existing copy-first path -- this is
// a per-file guard, not a blanket "trust whatever folder was picked."
export function losOpenForEdit(file: File): Project | null {
  if (hasIsolatedOvToken(file.name)) return losSafeOpenMasterCopy(file);
  return app.open(file);
}

function losCollectFilesRecursive(folder: Folder, list: File[], fileFilter: (f: File) => boolean) {
  const files = folder.getFiles();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f instanceof Folder) losCollectFilesRecursive(f, list, fileFilter);
    else if (f instanceof File && fileFilter(f)) list.push(f);
  }
}

interface LosCsvRow {
  pageLabel: string;
  type: string;
  name: string;
  filePath: string;
  x_px: number;
  y_px: number;
  width_px: number;
  height_px: number;
  maskX_px: number;
  maskY_px: number;
  maskWidth_px: number;
  maskHeight_px: number;
}

function losParseCSV(file: File): LosCsvRow[] {
  const data: LosCsvRow[] = [];
  if (!file || !(file instanceof File) || !file.open("r")) return data;
  try {
    file.readln(); // header
    while (!file.eof) {
      const line = file.readln();
      if (!line) continue;
      const cols = line.split(",").map((v) => v.replace(/^\s*"(.*)"\s*$/, "$1").replace(/^\s+|\s+$/g, ""));
      data.push({
        pageLabel: cols[0],
        type: cols[1],
        name: cols[2],
        filePath: cols[3],
        x_px: parseFloat(cols[4]),
        y_px: parseFloat(cols[5]),
        width_px: parseFloat(cols[6]),
        height_px: parseFloat(cols[7]),
        maskX_px: parseFloat(cols[8]),
        maskY_px: parseFloat(cols[9]),
        maskWidth_px: parseFloat(cols[10]),
        maskHeight_px: parseFloat(cols[11]),
      });
    }
  } finally {
    file.close();
  }
  return data;
}

function losApplyMaskSolid(comp: CompItem, row: LosCsvRow, footageLayer: Layer) {
  const mw = Number(row.maskWidth_px) || 0;
  const mh = Number(row.maskHeight_px) || 0;
  if (mw <= 0 || mh <= 0) return null;
  const maskSolid = comp.layers.addSolid([1, 1, 1], footageLayer.name + "_mask", mw, mh, comp.pixelAspect, comp.duration);
  const anchorProp = (maskSolid.property("Transform") as Property).property("Anchor Point") as Property;
  if (anchorProp) {
    const av = anchorProp.value as number[];
    anchorProp.setValue(av && av.length === 3 ? [0, 0, 0] : [0, 0]);
  }
  const posProp = (maskSolid.property("Transform") as Property).property("Position") as Property;
  if (posProp) {
    const pv = posProp.value as number[];
    posProp.setValue(pv && pv.length === 3 ? [Number(row.maskX_px) || 0, Number(row.maskY_px) || 0, pv[2]] : [Number(row.maskX_px) || 0, Number(row.maskY_px) || 0]);
  }
  maskSolid.moveBefore(footageLayer);
  try {
    (footageLayer as AVLayer).trackMatteType = TrackMatteType.ALPHA;
  } catch (e) {
    // matches original: silently ignored if the layer type doesn't support a track matte
  }
  return maskSolid;
}

function losImportAepAndFindComp(proj: Project, aepFile: File, desiredCompName: string): CompItem | null {
  if (!aepFile || !(aepFile instanceof File) || !aepFile.exists) return null;
  const beforeCount = proj.numItems;
  const io = new ImportOptions(aepFile);
  try {
    io.importAs = ImportAsType.PROJECT;
  } catch (e) {
    // some AE versions may ignore importAs -- matches original
  }
  try {
    proj.importFile(io);
  } catch (e) {
    return null;
  }
  const newComps: CompItem[] = [];
  for (let ii = beforeCount + 1; ii <= proj.numItems; ii++) {
    const it = proj.item(ii);
    if (it instanceof CompItem) newComps.push(it);
  }
  const base = String(desiredCompName || "").replace(/\.[^.]+$/, "");
  for (let k = 0; k < newComps.length; k++) {
    if (newComps[k].name === desiredCompName || newComps[k].name === base) return newComps[k];
  }
  for (let k2 = 0; k2 < newComps.length; k2++) {
    if (newComps[k2].name.indexOf(base) !== -1) return newComps[k2];
  }
  for (let z = 1; z <= proj.numItems; z++) {
    const itz = proj.item(z);
    if (!(itz instanceof CompItem)) continue;
    // Split into separate statements: ExtendScript mis-evaluates a bare
    // `A || B || C && D` left-to-right as `((A || B) || C) && D`, and Babel
    // strips the source's grouping parens on emit (same engine bug that broke
    // MC It!'s isSameType -- see mcIt()). Never mix ||/&& in one expression
    // in this codebase.
    if (itz.name === desiredCompName) return itz;
    if (itz.name === base) return itz;
    if (base !== "" && itz.name.indexOf(base) !== -1) return itz;
  }
  return null;
}

export const selectLosCsvFolder = (): string | null => {
  const folder = Folder.selectDialog("Select folder containing CSV files (will search subfolders)");
  return folder ? folder.fsName : null;
};
export const selectLosAepFolder = (): string | null => {
  const folder = Folder.selectDialog("Select folder containing After Effects project files (.aep)");
  return folder ? folder.fsName : null;
};
export const selectLosComponentsFolder = (): string | null => {
  const folder = Folder.selectDialog("Select folder containing component assets (will search subfolders)");
  return folder ? folder.fsName : null;
};

type LosApplyResult = Result;

// Ported to match the original EXACTLY, including its interactive alert()
// calls and continue-vs-break control flow on failure paths -- the user
// explicitly asked that this safety-patched tool's logic not be altered
// beyond the already-applied copy-first fix. This deviates from the rest
// of this port's usual {success,error}-return convention (no alert()
// elsewhere in aeft.ts) on purpose: fidelity to the original was
// prioritized over that convention here. Each alert() will show as a
// native AE dialog mid-batch, blocking until dismissed, exactly as it did
// in the original ScriptUI tool.
export const losApplyCsvToProjects = (targetLayerName: string, csvFolderPath: string, aepFolderPath: string, componentsFolderPath: string): LosApplyResult => {
  try {
    app.beginUndoGroup("Apply CSV Data to Projects");

    const csvFolder = new Folder(csvFolderPath);
    const aepFolder = new Folder(aepFolderPath);
    const componentsFolder = new Folder(componentsFolderPath);

    const csvFiles: File[] = [];
    losCollectFilesRecursive(csvFolder, csvFiles, (f) => /\.csv$/i.test(f.name));

    const aepFiles = aepFolder.getFiles((f) => f instanceof File && /\.aep$/i.test((f as File).name)) as File[];

    const componentsFiles: File[] = [];
    losCollectFilesRecursive(componentsFolder, componentsFiles, (f) => /\.(aep|ai|eps|png|jpg|jpeg|tif|tiff|psd|mov|mp4|avi|exr)$/i.test(f.name));

    for (let p = 0; p < aepFiles.length; p++) {
      const projFile = aepFiles[p];
      const projName = projFile.name;
      const sizeMatch = projName.match(/(\d+x\d+)/);
      if (!sizeMatch) continue;
      const sizeToken = sizeMatch[1];

      let matchingCSV: File | null = null;
      for (let si = 0; si < csvFiles.length; si++) {
        if (csvFiles[si].name.indexOf(sizeToken) !== -1) {
          matchingCSV = csvFiles[si];
          break;
        }
      }
      if (!matchingCSV) {
        alert("No matching CSV for project: " + projName);
        continue;
      }

      const proj = losOpenForEdit(projFile);
      if (!proj) continue;

      const csvData = losParseCSV(matchingCSV);
      let targetRow: LosCsvRow | null = null;
      const lastPageLabel = csvData.length > 0 ? csvData[csvData.length - 1].pageLabel : "";
      if (lastPageLabel) {
        for (let r = csvData.length - 1; r >= 0; r--) {
          const rData = csvData[r];
          if (rData.pageLabel !== lastPageLabel) break;
          if (rData.type && (rData.type + "").indexOf("ART") !== -1) {
            targetRow = rData;
            break;
          }
        }
      }
      if (!targetRow) {
        alert("Could not find an 'ART' row for the last page (" + lastPageLabel + ") in CSV: " + matchingCSV.name);
        proj.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        continue;
      }

      let mainFolder: FolderItem | null = null;
      for (let fi = 1; fi <= proj.numItems; fi++) {
        const item = proj.item(fi);
        if (item instanceof FolderItem && item.name === "Main") {
          mainFolder = item;
          break;
        }
      }
      if (!mainFolder) {
        alert("No 'Main' folder in project: " + projName);
        proj.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        continue;
      }

      const comps: CompItem[] = [];
      for (let j = 1; j <= proj.numItems; j++) {
        const item = proj.item(j);
        if (item instanceof CompItem && item.parentFolder === mainFolder) comps.push(item);
      }

      for (let ci = 0; ci < comps.length; ci++) {
        const comp = comps[ci];
        for (let li = 1; li <= comp.numLayers; li++) {
          const layer = comp.layer(li);
          if (!layer || layer.name !== targetLayerName) continue;

          const row = targetRow;
          const compMatch = findBestComponentFile(row.name, componentsFiles);
          let footFile: File | null = compMatch instanceof File ? compMatch : row.filePath ? new File(row.filePath) : null;

          if (!footFile || !footFile.exists) {
            alert("Missing source file (component fallback): " + (compMatch && compMatch.name ? compMatch.name : row.filePath || "undefined"));
            continue; // Skip this layer -- matches original: keeps scanning this comp for another layer of the same name.
          }

          const extMatch = footFile.name.match(/\.([^.]+)$/);
          const ext = extMatch ? extMatch[0].toLowerCase() : "";
          let replacementSource: AVItem | null = null;

          if (ext === ".aep") {
            const desiredCompName = footFile.name.replace(/\.aep$/i, "");
            const foundComp = losImportAepAndFindComp(proj, footFile, desiredCompName);
            if (foundComp) {
              replacementSource = foundComp;
            } else {
              $.writeln("Imported AEP but could not find comp matching '" + desiredCompName + "' inside " + footFile.fullName);
              continue; // do not replace the layer (avoid throwing) -- matches original.
            }
          } else {
            try {
              replacementSource = proj.importFile(new ImportOptions(footFile)) as AVItem;
            } catch (e) {
              alert("Failed to import: " + footFile.fullName + "\nError: " + e.toString());
              continue;
            }
            if (!replacementSource) {
              alert("Import returned null for: " + footFile.fullName);
              continue;
            }
          }

          try {
            (layer as AVLayer).replaceSource(replacementSource, false);
          } catch (e) {
            alert("Failed to replace source on layer: " + layer.name + " (" + e.toString() + ")");
            continue;
          }

          try {
            if (replacementSource instanceof CompItem) {
              const srcW = replacementSource.width || 1;
              const srcH = replacementSource.height || 1;
              const targetW = Number(row.width_px) || srcW;
              const targetH = Number(row.height_px) || srcH;
              const sx = (targetW / srcW) * 100;
              const sy = (targetH / srcH) * 100;
              const scaleProp = (layer.property("Transform") as Property).property("Scale") as Property;
              const curScale = scaleProp.value as number[];
              scaleProp.setValue(curScale && curScale.length === 3 ? [sx, sy, curScale[2]] : [sx, sy]);
            } else {
              const targetW2 = Number(row.width_px) || 0;
              const layerSource = (layer as AVLayer).source;
              if (targetW2 > 0 && layerSource && typeof layerSource.width === "number") {
                const srcW2 = layerSource.width || 1;
                const sxx = (targetW2 / srcW2) * 100;
                const scaleProp2 = (layer.property("Transform") as Property).property("Scale") as Property;
                const curScale2 = scaleProp2.value as number[];
                scaleProp2.setValue(curScale2 && curScale2.length === 3 ? [sxx, sxx, curScale2[2]] : [sxx, sxx]);
              }
            }
          } catch (e) {
            // matches original: scaling failure shouldn't abort the whole pass
          }

          if (Number(row.maskWidth_px) > 0 && Number(row.maskHeight_px) > 0) losApplyMaskSolid(comp, row, layer);

          const oldParent = layer.parent;
          layer.parent = null;
          const anchorProp = (layer.property("Transform") as Property).property("Anchor Point") as Property;
          if (anchorProp) {
            const av = anchorProp.value as number[];
            anchorProp.setValue(av && av.length === 3 ? [0, 0, 0] : [0, 0]);
          }
          const posProp = (layer.property("Transform") as Property).property("Position") as Property;
          if (posProp) {
            const cp = posProp.value as number[];
            posProp.setValue(cp && cp.length === 3 ? [Number(row.x_px) || 0, Number(row.y_px) || 0, cp[2] || 0] : [Number(row.x_px) || 0, Number(row.y_px) || 0]);
          }
          layer.parent = oldParent;
          break;
        }
      }

      try {
        proj.save();
      } catch (e) {
        try {
          proj.save(new File(proj.file.fullName));
        } catch (ignore) {
          // matches original: give up silently on the fallback save too
        }
      }
      proj.close(CloseOptions.SAVE_CHANGES);
    }

    // The original has no closing alert/summary here -- it just finishes
    // silently once every .aep has been processed (or skipped, each with
    // its own alert() already shown above). Not adding one to match.
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};


// =============================================================================
// Timesheet Tracker -- ported from toolset/XYi_AE_Timesheet_Link.jsx. Tracks
// time against a job (auto-detected from the saved project's folder path:
// nearest "XY<digits>" folder = job code, nearest folder exactly matching a
// known territory name = territory) and exports a React-app-compatible JSON
// payload. The timer itself lives in React (tools/TimesheetTracker.tsx --
// setInterval replaces the original's app.scheduleTask() label-update hack);
// ExtendScript only supplies what genuinely needs AE: the path-based job/
// territory detection, the active comp / project file names, and the
// clipboard copy (same pbcopy/clip system-command trick as the original).
// The three data arrays below are extracted VERBATIM from the original by
// scripts-side tooling -- do not hand-edit them here; when the studio
// updates the job list in XYi_AE_Timesheet_Link.jsx, re-extract.
// =============================================================================
const TS_DEFAULT_JOBS: string[] = [
        "Disclosure Day : XY025523, INT - DOOH Outdoor Campaign", "Disclosure Day : XY025729, UK - DOOH", "Disclosure Day : XY025732, UK - LSQ Digital", "Scary Movie 6 : XY025692, INT - DOOH Outdoor Campaign", "The Odyssey : XY025716, INT - DOOH Outdoor Campaign", "XYi Design House Job : XY014384, Showreel", "XYi Internal Use : XY016319, XYi - Time Off", "XYi Internal Use : XY020179, XYi - Training", "XYi Internal Use : XY025256, XYi - MAGI Marketing", "Angry Birds 3 Movie : XY025741, INT - Titles", "Better Man : XY022694, INT - Digital OV Mechs", "Bridget Jones Diary 25th Anniversary : XY025429, AUS - 1 SHEET - TEASER - PRINT - UPIM", "Bridget Jones Diary 25th Anniversary : XY025430, AUS - QUAD - PRINT - TEASER - UPIM", "By Any Means : XY025860, ITM Digital - Custom Lobby Display", "By Any Means : XY025877, ITM Print - Custom Lobby Display", "Children of Blood and Bone : XY025537, INT - Teaser Titles", "Cocomelon: The Movie : XY025855, INT - Titles", "Digger : XY025824, AUS - 1 SHEET - TEASER - PRINT - UPIM", "Disclosure Day : XY025153, AUS - Character 1 Sheets", "Disclosure Day : XY025290, UK - PRESS AD - Print", "Disclosure Day : XY025313, UK - INTH - QUAD", "Disclosure Day : XY025405, UK - INTH - LARGE FORMATS - VUE", "Disclosure Day : XY025421, AUS - 1 SHEET - PRINT - MAIN - UPIM", "Disclosure Day : XY025448, UK - On Screen Press Ad", "Disclosure Day : XY025490, INT - Outdoor Campaign Masters", "Disclosure Day : XY025492, INT - Outdoor Campaign", "Disclosure Day : XY025509, AUS - FOH - PRINT", "Disclosure Day : XY025526, IRE - PRESS AD - PRINT", "Disclosure Day : XY025529, Aus - Event Naming Rights", "Disclosure Day : XY025530, AUS - DOOH - EVENT", "Disclosure Day : XY025535, AUS - QUAD - PRINT - MAIN - UPIM", "Disclosure Day : XY025543, UK - Odeon Canvas - Round 2", "Disclosure Day : XY025545, UK - REGIONAL BESPOKES - PRINT", "Disclosure Day : XY025552, AUS - INTH DOORS", "Disclosure Day : XY025554, AUS - DOOH - HOYTS", "Disclosure Day : XY025555, AUS - Event HPTO", "Disclosure Day : XY025556, AUS - Hoyts Billboard", "Disclosure Day : XY025585, UK - Mockups", "Disclosure Day : XY025586, INT - Digital OV Masters", "Disclosure Day : XY025590, UK - Digital - Premiere Invite", "Disclosure Day : XY025593, AUS - Hoyts Ident", "Disclosure Day : XY025600, UK - OOH - T-SIDES", "Disclosure Day : XY025607, IRE - OOH", "Disclosure Day : XY025608, UK - DIGITAL - EXHIBITOR", "Disclosure Day : XY025610, NM - Digital - Packshots - Final Window", "Disclosure Day : XY025613, INT - Titles - Stacked", "Disclosure Day : XY025618, UK - OOH - 6 Sheets", "Disclosure Day : XY025622, UK - Digital Adapt", "Disclosure Day : XY025624, UK - Orbit Domination", "Disclosure Day : XY025626, AUS - DIGITAL - ONLINE", "Disclosure Day : XY025627, AUS - Crown Digi Screens", "Disclosure Day : XY025634, UK - INTH PANAFLEXES - PRINT", "Disclosure Day : XY025639, UK - OOH - London Underground", "Disclosure Day : XY025643, AUS - Email Footer", "Disclosure Day : XY025646, IRE - DOOH STATICS", "Disclosure Day : XY025647, UK - OOH - 96 SHEET", "Disclosure Day : XY025648, UK - OOH - MANCHESTER PICCADILLY", "Disclosure Day : XY025649, IRE - DOOH Motion", "Disclosure Day : XY025650, UK - Picturehouse Takeover", "Disclosure Day : XY025651, UK - CINEWORLD LSQ - PRINT", "Disclosure Day : XY025655, AUS - Squeeze Back", "Disclosure Day : XY025662, AUS - Split Audio", "Disclosure Day : XY025665, AUS - DIGITAL - DOOH", "Disclosure Day : XY025666, AUS - Pull Through", "Disclosure Day : XY025669, UK - Online", "Disclosure Day : XY025673, UK - Pub Quiz and Q&A Invite", "Disclosure Day : XY025676, UK - DIGITAL - MULTIMEDIA INVITE", "Disclosure Day : XY025678, UK - CW Book To Win", "Disclosure Day : XY025689, AUS - Premiere Art", "Disclosure Day : XY025694, UK - Curzon Soho", "Disclosure Day : XY025704, UK - OLLS Screen", "Disclosure Day : XY025711, AUS - Sydney Media Wall", "Disclosure Day : XY025715, UK - D96", "Disclosure Day : XY025727, UK - OOH - CROMINATION", "Disclosure Day : XY025730, UK - Screening Holding Slide", "Disclosure Day : XY025733, IRE - Premiere Invite", "Disclosure Day : XY025735, UK - Premiere Holding Slide", "Disclosure Day : XY025736, UK - INTH - Standee & Tent Card", "Disclosure Day : XY025760, UK - Bauer Static", "Disclosure Day : XY025762, IRE - Premiere Assets", "Disclosure Day : XY025766, AUS - PREMIERE ASSETS", "Disclosure Day : XY025769, UK - BSF Creative", "Disclosure Day : XY025772, IRE - Trade", "Disclosure Day : XY025778, Uk - PREMIERE ASSETS", "Disclosure Day : XY025780, UK - MM SCREENING ASSETS - PRINT", "Disclosure Day : XY025782, UK - MM Screening - Motion", "Disclosure Day : XY025788, AUS - DIGITAL - INSTAGRAM", "Disclosure Day : XY025790, UK - Odeon 70mm Digital", "Disclosure Day : XY025814, UK - BSF LSQ Placements", "Disclosure Day : XY025815, UK - DIGITAL - SOCIAL SKINS", "Disclosure Day : XY025880, UK - PRESS AD - Print", "Disclosure Day : XY025885, UK - Review Quote 4x5", "Finding Emily : XY025485, NM - Digital - Packshots - Final Window", "Finding Emily : XY025620, NM - Titles", "Focker In-Law : XY024810, INT - Titles", "Focker In-Law : XY025507, INT - Digital OV Mechs", "Focker In-Law : XY025522, INT - Print OV Mechs", "Forgotten Island : XY025165, INT - Print OV Masters", "Forgotten Island : XY025381, INT - Digital OV Masters", "Forgotten Island : XY025465, INT - Digital - Assets", "Forgotten Island : XY025474, AUS - 1 SHEET - TEASER - PRINT - UPIM", "Forgotten Island : XY025510, AUS - QUAD - PRINT - MAIN - UPIM", "Forgotten Island : XY025687, INT - Cine Europe", "Forgotten Island : XY025722, INT - 1 Sheet - Digital - Trio", "Forgotten Island : XY025723, INT - Digital - Instagram - Trio", "Forgotten Island : XY025724, INT - 1 Sheet - Print - Trio", "Forgotten Island : XY025726, UK - INTH Quad", "Forgotten Island : XY025761, INT - Cine Europe Photo Booth", "Forgotten Island : XY025804, INT - DOOH - FLIGHTCHECKING", "Forgotten Island : XY025808, INT - Standee", "Forgotten Island : XY025813, INT - Outdoor Campaign", "Forgotten Island : XY025835, UK - INTH PANAFLEXES - PRINT", "Forgotten Island : XY025836, UK - INTH - LARGE FORMATS - VUE", "Heart Of The Beast : XY025604, INT - Titles", "Heart Of The Beast : XY025841, INT - Digital OV Mechs", "Heart Of The Beast : XY025842, INT - Print OV Mechs", "Heart Of The Beast : XY025843, INT - Outdoor Campaign Masters", "Heart Of The Beast : XY025844, INT - Outdoor Campaign Markets", "Heart Of The Beast : XY025845, INT - Outdoor Campaign Bespokes", "Heart Of The Beast : XY025846, INT - Asset Chart", "Heart Of The Beast : XY025847, INT - Green Launch Digital Assets", "Heart Of The Beast : XY025849, INT - Teaser P1S", "Heart Of The Beast : XY025850, DOM - French Canada Assets", "Heart Of The Beast : XY025861, DOM - Outdoor Digital Billboards", "Heart Of The Beast : XY025876, GER Launch Assets", "Iron Maiden - Burning Ambition : XY025525, UK - Premiere Invite", "Jackass: Best and Last : XY025589, INT - Teaser Titles", "Jackass: Best and Last : XY025603, INT - Digital OV Mechs", "Jackass: Best and Last : XY025623, INT - Launch - French Canada Assets", "Jackass: Best and Last : XY025686, INT - Print OV Mechs", "Jackass: Best and Last : XY025709, DOM - Outdoor Digital Billboards", "Jackass: Best and Last : XY025719, INT - Outdoor Campaign Masters", "Jackass: Best and Last : XY025720, INT - Outdoor Campaign Markets", "Jackass: Best and Last : XY025721, INT - Outdoor Campaign Bespokes", "Jackass: Best and Last : XY025744, INT - Cart Digital Launch", "Jackass: Best and Last : XY025745, INT - Cart Print Launch", "Jackass: Best and Last : XY025746, INT - Outdoor Title Adjustment", "Jackass: Best and Last : XY025751, GER Launch Assets", "Jackass: Best and Last : XY025759, DOM CANFR Launch Assets", "Jackass: Best and Last : XY025774, ITM Digital - Custom Lobby Display", "Jackass: Best and Last : XY025776, AUS - Outdoor Campaign", "Jackass: Best and Last : XY025783, ITM Print - Custom Lobby Display", "Jackass: Best and Last : XY025789, DOM - Digital PLF Mechs", "Jackass: Best and Last : XY025791, DOM - Print - PLF", "Jackass: Best and Last : XY025803, INT - CMYK Conversion", "Jackass: Best and Last : XY025854, INT - DIGITAL - ENTERPRISE UPLOADS", "Jackass: Best and Last : XY025859, NZ - Digital Online", "KPOP Superstar : XY025561, INT - Teaser Titles", "Lorne : XY025679, NM - Digital - Packshots - Final Window", "Lorne : XY025797, NM - Titles", "Minions & Monsters : XY025094, INT - Titles", "Minions & Monsters : XY025283, AUS - Split Audio", "Minions & Monsters : XY025358, AUS - Toolkits", "Minions & Monsters : XY025642, AUS - Email Footer", "Minions & Monsters : XY025675, AUS - DIGITAL - ONLINE", "Minions & Monsters : XY025681, AUS - 1 SHEET - PRINT - MAIN - UPIM", "Minions & Monsters : XY025682, NM - Digital - Packshots - Final Window", "Minions & Monsters : XY025700, AUS - QUAD - PRINT - MAIN - UPIM", "Minions & Monsters : XY025705, AUS - Comic Con Social", "Minions & Monsters : XY025706, INT - Cine Europe", "Minions & Monsters : XY025810, AUS - Pull Through", "Minions & Monsters : XY025838, AUS - Premiere Dooh", "Minions The Rise Of Gru : XY016704, Cinepolis Presentation Mock-ups", "Not Alone : XY025853, INT - Titles", "Obsession : XY025451, NM - Digital - Packshots - EPO", "Obsession : XY025562, NM - Digital - Packshots - Final Window", "Obsession : XY025581, NM - Titles", "One Night Only : XY025701, AUS - QUAD - PRINT - TEASER - UPIM", "One Night Only : XY025708, INT - Cine Europe", "One Night Only : XY025869, NM - Digital - Packshots - Final Window", "One Night Only : XY025874, NM - Titles", "Passenger : XY025488, INT - Print OV Mechs", "Passenger : XY025521, INT - CMYK Conversion", "Paw Patrol: The Dino Movie : XY025368, INT - Digital OV Mechs", "Paw Patrol: The Dino Movie : XY025370, INT - Print OV Mechs", "Paw Patrol: The Dino Movie : XY025454, INT - Rock Launch Assets", "Paw Patrol: The Dino Movie : XY025476, GER Launch Assets", "Paw Patrol: The Dino Movie : XY025482, INT - Asset Chart", "Paw Patrol: The Dino Movie : XY025539, INT - DIGITAL - ENTERPRISE UPLOADS", "Paw Patrol: The Dino Movie : XY025742, INT - DIGITAL - PAN REGIONAL", "Paw Patrol: The Dino Movie : XY025775, ITM Digital - Custom Lobby Display", "Paw Patrol: The Dino Movie : XY025792, INT - Outdoor Campaign Masters", "Paw Patrol: The Dino Movie : XY025793, INT - Outdoor Campaign Markets", "Paw Patrol: The Dino Movie : XY025794, INT - Outdoor Campaign Bespokes", "Paw Patrol: The Dino Movie : XY025809, INT - Collage Digital Assets", "Paw Patrol: The Dino Movie : XY025820, INT - Character D1S", "Paw Patrol: The Dino Movie : XY025821, INT - Character Instagrams", "Paw Patrol: The Dino Movie : XY025822, INT - Character P1S", "Paw Patrol: The Dino Movie : XY025851, DOM - Outdoor Digital Billboards", "Paw Patrol: The Dino Movie : XY025864, INT - Print Payoff Quad Creation", "Paw Patrol: The Dino Movie : XY025868, ITM Print - Custom Lobby Display", "Paw Patrol: The Dino Movie : XY025871, INT - Prehistoric Launch Print Assets", "Pressure : XY025690, NM - Digital - Packshots - Final Window", "Scary Movie 6 : XY025382, INT - DIGITAL - ENTERPRISE UPLOADS", "Scary Movie 6 : XY025437, DOM - Outdoor Digital Billboards", "Scary Movie 6 : XY025587, INT - Print Teaser Quad Creation", "Scary Movie 6 : XY025635, INT - DIGITAL - PAN REGIONAL", "Scary Movie 6 : XY025641, INT - Theatre Art Finishing", "Scary Movie 6 : XY025671, DOM - Digital - AV_LOGO", "Scary Movie 6 : XY025684, AUS - Outdoor Campaign", "Scary Movie 6 : XY025697, INT - DOOH Outdoor Campaign - Bespoke", "Scary Movie 6 : XY025728, AUS - DOOH Campaign", "Shrek 25th Anniversary : XY025427, AUS - 1 SHEET - TEASER - PRINT - UPIM", "Shrek 5 : XY023362, INT - Titles", "Shrek 5 : XY023390, INT - Digital OV Masters", "Shrek 5 : XY023391, INT - Print OV Masters", "Shrek 5 : XY025707, INT - Cine Europe", "Sonic The Hedgehog 4 : XY025357, INT - Titles", "Street Fighter : XY025124, INT - Teaser Titles", "Street Fighter : XY025126, INT - Digital OV Mechs", "Street Fighter : XY025141, INT - DIGITAL - ENTERPRISE UPLOADS", "Street Fighter : XY025557, INT - Multiple Artwork Launch", "Street Fighter : XY025559, INT - Teaser Artwork Print One Sheet", "Street Fighter : XY025601, INT - Print OV Mechs", "Street Fighter : XY025657, ITM Digital - Custom Lobby Display", "Street Fighter : XY025812, INT - Creative Legendary Adapt", "Supergirl : XY025502, AUS - Split Audio", "Supergirl : XY025515, AUS - 1 SHEET - PRINT - MAIN - UPIM", "Supergirl : XY025516, AUS - QUAD - PRINT - MAIN - UPIM", "Supergirl : XY025527, AUS - DIGITAL - ONLINE", "Supergirl : XY025591, AUS - OOH - Mural", "Supergirl : XY025617, AUS - OOH", "Supergirl : XY025628, AUS - DOOH - HOYTS", "Supergirl : XY025629, AUS - DOOH - VILLAGE", "Supergirl : XY025630, Aus - Event Naming Rights", "Supergirl : XY025631, AUS - Hoyts Billboard", "Supergirl : XY025632, AUS - DOOH - EVENT", "Supergirl : XY025633, AUS - Hoyts Ident", "Supergirl : XY025644, AUS - Email Footer", "Supergirl : XY025737, AUS - Supanova", "Supergirl : XY025768, AUS - IMAX Signage", "Supergirl : XY025770, AUS - IMAX Light Projection", "Supergirl : XY025787, AUS - BLB DOOH", "Supergirl : XY025857, AUS - Premiere Dooh", "Supergirl : XY025858, AUS - Event HPTO", "Tad and the Magic Lamp : XY025781, INT - Titles", "Tad and the Magic Lamp : XY025829, INT - Digital OV Mechs", "Tad and the Magic Lamp : XY025830, INT - Print OV Mechs", "Tad and the Magic Lamp : XY025831, INT - Outdoor Campaign Masters", "Tad and the Magic Lamp : XY025832, INT - Outdoor Campaign Markets", "Tad and the Magic Lamp : XY025833, INT - Online Launch Assets", "Tad and the Magic Lamp : XY025834, INT - Print Launch Assets", "Tad and the Magic Lamp : XY025873, INT - Finishing", "The AI Doc Or How I Became An Apocaloptimist : XY025541, NM - Digital - Packshots - Final Window", "The AI Doc Or How I Became An Apocaloptimist : XY025577, NM - Titles", "The AI Doc Or How I Became An Apocaloptimist : XY025656, UK - Launch Assets", "The Comeback King : XY025517, INT - Print - Flightcheck", "The Comeback King : XY025531, AUS - Insta Localisations", "The Fast And The Furious: 25th Anniversary : XY025865, UK - Digital - Localisations", "The Fast And The Furious: 25th Anniversary : XY025866, UK - INTH - QUAD", "The Fast And The Furious: 25th Anniversary : XY025867, UK - Print 1 Sheet", "The Fast And The Furious: 25th Anniversary : XY025878, AUS - Digital 1 Sheets & Instagrams", "The Fast And The Furious: 25th Anniversary : XY025879, AUS - Trailer Localise", "The Holiday 20th Anninversary : XY025504, AUS - 1 SHEET - PRINT - MAIN - UPIM", "The Odyssey : XY023441, INT - Titles", "The Odyssey : XY023474, INT - Digital OV Masters", "The Odyssey : XY025116, INT - Outdoor Campaign Masters", "The Odyssey : XY025156, AUS - 1 SHEET - PRINT - MAIN - UPIM", "The Odyssey : XY025619, AUS - FOYER BOLLARDS", "The Odyssey : XY025654, AUS - 1 SHEET - PRINT - MAIN - UPIM", "The Odyssey : XY025658, UK - VUE LARGE FORMATS", "The Odyssey : XY025660, AUS - QUAD - PRINT - MAIN - UPIM", "The Odyssey : XY025661, UK - BFI Bespoke", "The Odyssey : XY025663, AUS - Split Audio", "The Odyssey : XY025667, UK - PRESS AD - Print", "The Odyssey : XY025668, UK - Science Museum Bespokes", "The Odyssey : XY025674, INT - Outdoor Campaign", "The Odyssey : XY025683, UK - INTH PANAFLEXES - PRINT", "The Odyssey : XY025685, AUS - Press Ad", "The Odyssey : XY025698, UK - Mockups", "The Odyssey : XY025699, UK - INTH - Odeon Canvas", "The Odyssey : XY025702, INT - Standee", "The Odyssey : XY025712, UK - Sky VIP Assets", "The Odyssey : XY025713, INT - Cine Europe", "The Odyssey : XY025714, UK - Premiere Invite", "The Odyssey : XY025717, INT - DOOH Outdoor Campaign - Masters", "The Odyssey : XY025725, UK - OOH - Bus Wrap", "The Odyssey : XY025731, UK - 6 Sheet and Tent Cards", "The Odyssey : XY025739, UK - OOH - Alpha Banner", "The Odyssey : XY025740, UK - OOH - Liverpool Holiday Inn", "The Odyssey : XY025747, AUS - Print - Banner", "The Odyssey : XY025748, UK - OOH - BIRMINGHAM ARCHWAY BANNER", "The Odyssey : XY025749, UK - Everyman Cover", "The Odyssey : XY025750, UK - 240 Sheet", "The Odyssey : XY025752, AUS - DOOH - HOYTS", "The Odyssey : XY025753, Aus - Event Naming Rights", "The Odyssey : XY025754, AUS - Event HPTO", "The Odyssey : XY025755, AUS - Hoyts Ident", "The Odyssey : XY025756, AUS - Hoyts Billboard", "The Odyssey : XY025757, AUS - DOOH - VILLAGE", "The Odyssey : XY025758, AUS - DOOH - EVENT", "The Odyssey : XY025764, AUS - INTH DOORS", "The Odyssey : XY025765, AUS - Postcard", "The Odyssey : XY025767, UK - Online", "The Odyssey : XY025771, UK - OOH - T-SIDES", "The Odyssey : XY025773, UK - OOH - IMAX Wrap", "The Odyssey : XY025777, UK - Everyman Gift Card", "The Odyssey : XY025779, IRE - OOH", "The Odyssey : XY025795, UK - DIGITAL - EXHIBITOR", "The Odyssey : XY025798, IRE - DOOH Motion", "The Odyssey : XY025799, IRE - Digital Skybridge", "The Odyssey : XY025800, IRE - PRESS AD", "The Odyssey : XY025801, UK - OOH - LUG 48 Sheet", "The Odyssey : XY025802, UK - CW LSQ Print", "The Odyssey : XY025805, UK - REGIONAL BESPOKES - PRINT", "The Odyssey : XY025807, UK - TOS Assets", "The Odyssey : XY025811, AUS - Online Campaign", "The Odyssey : XY025816, OOH - Glasgow Central Station Banner", "The Odyssey : XY025837, AUS - IMAX Signage", "The Odyssey : XY025839, UK - IMAX 6 Sheets", "The Odyssey : XY025840, AUS - Screening Assets", "The Odyssey : XY025852, UK - CW Book To Win", "The Odyssey : XY025856, INT - DOOH - Airport Affinity Takeovers", "The Odyssey : XY025862, AUS - Print - Magazine", "The Odyssey : XY025863, AUS - FOH - PRINT", "The Odyssey : XY025870, UK - Rotunda DOOH Masters", "The Odyssey : XY025872, AUS - QUAD - PRINT - MAIN - UPIM", "The Odyssey : XY025875, CineEurope 2026 - ODY - Coke Screen", "The Odyssey : XY025881, AUS - Press Ad", "The Odyssey : XY025882, AUS - PRINT - IMAX TAKEOVER", "The Odyssey : XY025883, UK - Premiere Tickets", "The Odyssey : XY025884, UK - INTH - QUAD", "The Odyssey : XY025886, UK - Picturehouse Takeover", "The Odyssey : XY025887, UK - Curzon Soho", "The Super Mario Galaxy Movie : XY025215, NM - Digital - Packshots - Final Window", "The Super Mario Galaxy Movie : XY025386, INTL - Digital - Media Banners - Boats", "The Super Mario Galaxy Movie : XY025406, IT - Digital - Web Banners", "The Super Mario Galaxy Movie : XY025738, UK - Half Term Exhibs", "XYi Design House Job : XY016893, XYi Brand Guidelines", "XYi Design House Job : XY017029, Territory Showreel Presentation", "XYi Design House Job : XY017030, XYi Presentation Templates", "XYi Design House Job : XY017031, Universal Credential Pitch", "XYi Design House Job : XY017078, Seasons Greetings", "XYi Design House Job : XY017137, XYI - SOCIAL CONTENT", "XYi Design House Job : XY019647, Christmas Card", "XYi Design House Job : XY022852, RC - Logo", "XYi Design House Job : XY023118, XYi - Internal Screens", "XYi Internal Use : XY016776, XYi - R&D and Training", "XYi Internal Use : XY016914, Birthday_Cards", "XYi Internal Use : XY018140, Website Updates", "XYi Internal Use : XY018540, Digital Housekeeping", "XYi Internal Use : XY019253, Studio Admin - Master Mechs Housekeeping", "XYi Internal Use : XY019420, XYi - Recruitment/Appraisals", "XYi Internal Use : XY019639, XYi - Meetings", "XYi Internal Use : XY019979, XYi - Office Management", "XYi Internal Use : XY020027, XYi - Event Planning", "XYi Internal Use : XY022578, XYi - Budgeting", "XYi Internal Use : XY022674, XYi - End of Campaign Process", "XYi Internal Use : XY024803, XYi - Process Development", "XYi Internal Use : XY025889, XYi - Angel Studios", "You, Me & Tuscany : XY025216, NM - Digital - Packshots - EPO"
    ];

export const TS_TERRITORIES: string[] = [
        "_XYi_", "Albania", "Arabic", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Belgium", "Bolivia", "Bosnia", "Brazil", "Bulgaria", "Cambodia", "Canada", "Canadian-French", "Chile", "China", "CIS", "Colombia", "Croatia", "Cyprus", "Czech", "Denmark", "Domestic", "Dubai", "Ecuador", "Egypt", "Estonia", "Finland", "France", "Georgia", "Germany", "Greece", "Hong Kong", "Hungary", "Iceland", "India - English", "India - Hindi", "India - Tamil", "India - Telugu", "Indonesia", "INTL - UNI", "Ireland", "Israel", "Italy", "Japan", "Kazakhstan", "Korea", "Kyrgyzstan", "Laos", "Latam / Las", "Latvia", "Lebanon", "Lithuania", "Macedonia", "Malaysia", "Malta", "Mexico", "Middle East", "Moldova", "Mongolia", "Netherlands", "New Zealand", "Norway", "OV", "OV Suite Build", "Pakistan", "Panama", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Puerto Rico (Domestic)", "Romania", "Russia", "Serbia & Montenegro", "Singapore", "Slovakia", "Slovenia", "South Africa", "Spain", "Spain - Catalan", "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Thailand", "Trinidad", "Türkiye", "UK", "Ukraine", "United Arab Emirates", "Uruguay", "USA", "Uzbekistan", "Venezuela", "Vietnam", "Yoruba (West Africa)"
    ];

const TS_CATEGORIES: string[] = [
        "Additional hours waiting time", "Digital - Build/Production", "Digital - Conceptualising", "Digital - Creating Masters", "Digital - Production/Localisation", "Digital - Rendering", "XYi - Sick", "XYi - Training - Demonstrations", "XYi - Training - Planning", "Budgeting", "End of Campaign Process", "Internationalising", "Pitching", "Quoting/Estimating", "Watermarking", "Digital - Approval Site Management/Maintenance", "Digital - Client Revisions/Amends", "Digital - Creative Approvals", "Digital - Flight Checking", "Digital - Instagram", "Digital - Layouts/Visualising", "Digital - Optimisation", "Digital - OV Mechanicals", "Digital - Packaging for Delivery", "Digital - Project Management", "Digital - Project Management - Studio", "Digital - Proofreading", "Digital - Research & Development", "Digital - Retouching", "Digital - Upload/Downloading", "Project Management - Translations", "XYi - Appraisals", "XYi - Client Meetings", "XYi - H&S", "XYi - Holiday", "XYi - HR", "XYi - IT", "XYi - Management Meetings", "XYi - Office", "XYi - Process Development - Client", "XYi - Process Development - Internal", "XYi - Recruitment", "XYi - Time Off", "XYi - Training - Challenges", "XYi - Training - External Training", "XYi - Training - Induction", "XYi - Training - Review"
    ];

interface TimesheetLists {
  success: boolean;
  territories: string[];
  categories: string[];
}

export const timesheetGetLists = (): TimesheetLists => {
  return { success: true, territories: TS_TERRITORIES, categories: TS_CATEGORIES };
};

// Ported 1:1 from extractInfoFromPath(): walk up the saved project file's
// folder tree looking for the job code and territory.
function tsExtractInfoFromPath(fileObj: File): { jobString: string; territory: string | null; jobCode: string | null } {
  const result: { jobString: string; territory: string | null; jobCode: string | null } = { jobString: "", territory: null, jobCode: null };
  if (!fileObj) return result;

  let currentFolder: Folder | null = fileObj.parent;
  let xyCode: string | null = null;
  let terr: string | null = null;

  while (currentFolder !== null) {
    const folderName = decodeURI(currentFolder.name);

    const xyMatch = folderName.match(/(XY\d+)/);
    if (xyMatch && !xyCode) xyCode = xyMatch[1];

    if (!terr) {
      const lowerFolder = folderName.toLowerCase();
      for (let t = 0; t < TS_TERRITORIES.length; t++) {
        if (TS_TERRITORIES[t].toLowerCase() === lowerFolder) {
          terr = TS_TERRITORIES[t];
          break;
        }
      }
    }

    if (currentFolder.parent && currentFolder.parent.absoluteURI !== currentFolder.absoluteURI) {
      currentFolder = currentFolder.parent;
    } else {
      break;
    }
  }

  result.jobCode = xyCode;
  result.territory = terr;

  if (xyCode) {
    for (let i = 0; i < TS_DEFAULT_JOBS.length; i++) {
      if (TS_DEFAULT_JOBS[i].indexOf(xyCode) !== -1) {
        result.jobString = TS_DEFAULT_JOBS[i];
        break;
      }
    }
    if (!result.jobString) result.jobString = "Unknown Job (Code: " + xyCode + ")";
  }

  return result;
}

interface TimesheetStartInfo extends Result {
  jobString?: string;
  territory?: string | null;
  compName?: string;
  projFileName?: string;
}

export const timesheetStartInfo = (): TimesheetStartInfo => {
  const projFile = app.project.file;
  if (!projFile) {
    return {
      success: false,
      error: "Please Save your After Effects project first!\nThe script needs a saved file path to figure out the Job Number and Territory.",
    };
  }
  const activeItem = app.project.activeItem;
  const extracted = tsExtractInfoFromPath(projFile);
  return {
    success: true,
    jobString: extracted.jobString || "Unknown Job",
    territory: extracted.territory,
    compName: activeItem ? activeItem.name : "No Active Comp",
    projFileName: decodeURI(projFile.name),
  };
};

// The original reads app.project.file.name fresh at Generate time (not the
// one captured at Start) -- kept as its own call for that reason.
export const timesheetProjectFileName = (): string | null => {
  const projFile = app.project.file;
  return projFile ? decodeURI(projFile.name) : null;
};

// Lightweight poll for the currently-open project file -- used by the
// Timesheet Tracker's Batch mode to auto-attribute elapsed time to whichever
// .aep is open right now (and to suggest a batch name from its parent
// folder). Deliberately cheap (no alerts, no heavy work) since it's called
// on a short interval while a batch is running. `hasFile` is false (not an
// error) when nothing is saved/open, so the poller can just skip that tick.
interface TimesheetActiveFile extends Result {
  hasFile: boolean;
  path: string | null;       // full fsName, the stable per-file key
  name: string | null;       // filename with extension (decoded)
  folderName: string | null; // parent folder name -> batch-name suggestion
  jobString: string | null;
  territory: string | null;
  compName: string | null;
}

export const timesheetActiveFile = (): TimesheetActiveFile => {
  const projFile = app.project.file;
  if (!projFile) {
    return { success: true, hasFile: false, path: null, name: null, folderName: null, jobString: null, territory: null, compName: null };
  }
  const activeItem = app.project.activeItem;
  const extracted = tsExtractInfoFromPath(projFile);
  return {
    success: true,
    hasFile: true,
    path: projFile.fsName,
    name: decodeURI(projFile.name),
    folderName: projFile.parent ? decodeURI(projFile.parent.name) : null,
    jobString: extracted.jobString || "Unknown Job",
    territory: extracted.territory,
    compName: activeItem ? activeItem.name : null,
  };
};

// Batch persistence -- the whole set of tracked batches is stored as one JSON
// blob under the shared "XYiToolbox" settings section, so an in-progress
// batch survives closing the panel AND restarting AE (same store campaigns/
// favorites/tool-order use). The React side owns the JSON shape; ExtendScript
// just reads/writes the opaque string, keeping the bridge simple.
const TIMESHEET_BATCHES_KEY = "TimesheetBatches";

export const loadTimesheetBatches = (): string => {
  if (app.settings.haveSetting(SETTINGS_SECTION, TIMESHEET_BATCHES_KEY)) {
    return app.settings.getSetting(SETTINGS_SECTION, TIMESHEET_BATCHES_KEY);
  }
  return "";
};

export const saveTimesheetBatches = (json: string): Result => {
  try {
    app.settings.saveSetting(SETTINGS_SECTION, TIMESHEET_BATCHES_KEY, json);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Same cross-platform clipboard trick as the original (temp file + pbcopy/clip).
// Generic over any string despite the name -- also reused directly by
// ReviewHub.tsx's Wrike-format export (Review Session tab) rather than
// duplicating this same temp-file/pbcopy/clip logic a second time.
export const timesheetCopyToClipboard = (text: string): Result => {
  try {
    const isMac = $.os.indexOf("Mac") !== -1;
    const tempFile = new File(Folder.temp.fsName + "/xyi_clip_" + Date.now() + "_" + Math.floor(Math.random() * 1e6) + ".txt");
    tempFile.open("w");
    tempFile.write(text);
    tempFile.close();
    if (isMac) {
      system.callSystem("pbcopy < '" + tempFile.fsName + "'");
    } else {
      system.callSystem('clip < "' + tempFile.fsName + '"');
    }
    tempFile.remove();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Extreme Tools 02 -- ported from XYi_Toolbox.jsx's "Extreme Tools 02" tab:
// Build CSV (XYi_BuildExtCsv.jsx's buildCompFromCSV()) and Adjust CSV
// (XYi_AdjustExtCsv.jsx's applyCSVToProjects()).
// =============================================================================

// --- Build CSV ---------------------------------------------------------
// Builds a single new comp from a CSV of Page/Type/Name/FilePath/position/
// size/mask rows: imports each referenced asset (or a red placeholder
// solid if missing/oversized), sequences layers in time by Page, reverses
// stacking order, applies a color-keyed rectangle special case, and slices
// "ART"-type masked regions into their own sub-comps. Import-only -- no
// project file is ever opened, so this one carries none of the
// master-file risk Adjust CSV (below) does.
//
// **`page`/`art`/`TT` parameters are accepted but never used** -- this
// matches the original exactly: `BuildCSVBut.onClick` passes all four
// toolbox fields (Page/Art/TT/Duration) into `buildCompFromCSV(dur, page,
// art, TT)`, but only `dur` (renamed `duration` here) is ever read inside
// the function body; the other three do nothing in the current toolbox,
// same as Edit Generator's dead checkbox. Kept as real no-op parameters
// rather than dropped, so the UI/signature stays faithful to the original.
// =============================================================================
interface ExtBuildCsvResult extends Result {
  missingFiles?: string[];
}

export const extBuildCompFromCsv = (duration: number, page: string, art: string, tt: string): ExtBuildCsvResult => {
  try {
    const csvFile = File.openDialog("Select a CSV file", "*.csv");
    if (!csvFile) return { success: false, error: "No CSV file selected." };

    app.beginUndoGroup("Build Comp from CSV");
    const DEFAULT_FPS = 23.976;

    function pad2(n: number): string {
      n = Math.max(0, Math.floor(n));
      return (n < 10 ? "0" : "") + n;
    }

    function hexToColor(hexStr: string): number[] {
      if (!hexStr || hexStr === "Transparent" || hexStr.charAt(0) !== "#") return [0.5, 0.5, 0.5];
      const hex = hexStr.replace("#", "");
      if (hex.length === 6) {
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        return [r, g, b];
      }
      return [0.5, 0.5, 0.5];
    }

    function findOrCreateFolder(name: string, parentFolder: FolderItem | null): FolderItem {
      for (let i = 1; i <= app.project.numItems; i++) {
        const it = app.project.item(i);
        if (it instanceof FolderItem && it.name === name && (!parentFolder || it.parentFolder === parentFolder)) return it;
      }
      const f = app.project.items.addFolder(name);
      if (parentFolder) f.parentFolder = parentFolder;
      return f;
    }

    function splitCSVLine(line: string): string[] {
      const out: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line.charAt(i);
        if (ch === '"') {
          if (inQuotes && i + 1 < line.length && line.charAt(i + 1) === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      for (let j = 0; j < out.length; j++) {
        let v = out[j];
        if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') v = v.substring(1, v.length - 1);
        out[j] = v;
      }
      return out;
    }

    interface BuildCsvRow {
      pageLabel: string;
      type: string;
      name: string;
      filePath: string;
      x_px: number;
      y_px: number;
      width_px: number;
      height_px: number;
      maskX_px: number;
      maskY_px: number;
      maskWidth_px: number;
      maskHeight_px: number;
    }

    function parseCSV(file: File): BuildCsvRow[] {
      const rows: BuildCsvRow[] = [];
      file.open("r");
      let raw = file.read();
      file.close();
      if (!raw || !raw.length) return rows;
      raw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = raw.split("\n");
      if (lines.length === 0) return rows;
      if (lines[0] && lines[0].charCodeAt(0) === 0xfeff) lines[0] = lines[0].substring(1);

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || /^\s*$/.test(line)) continue;
        const cols = splitCSVLine(line);
        const num = (v: string) => {
          const n = parseFloat(v);
          return isNaN(n) ? NaN : n;
        };
        rows.push({
          pageLabel: cols[0] || "",
          type: cols[1] || "",
          name: cols[2] || "",
          filePath: cols[3] || "",
          x_px: num(cols[4]),
          y_px: num(cols[5]),
          width_px: num(cols[6]),
          height_px: num(cols[7]),
          maskX_px: num(cols[8]),
          maskY_px: num(cols[9]),
          maskWidth_px: num(cols[10]),
          maskHeight_px: num(cols[11]),
        });
      }
      return rows;
    }

    const missingFiles: string[] = [];

    function importOnce(path: string, assetsFolder: FolderItem, cache: Record<string, AVItem | "ERROR">): AVItem | "ERROR" | null {
      if (!path) return null;
      if (path === "[Native InDesign Object]" || path.charAt(0) === "#") return null;

      const file = new File(path);
      const key = file.fsName;
      if (cache[key]) return cache[key];

      if (!file.exists) {
        const msg = path + " (MISSING FILE)";
        if (missingFiles.indexOf(msg) === -1) missingFiles.push(msg);
        return null;
      }

      try {
        const opts = new ImportOptions(file);
        const item = app.project.importFile(opts) as AVItem;
        item.parentFolder = assetsFolder;
        cache[key] = item;
        return item;
      } catch (e) {
        const msg = path + " (IMPORT FAILED - LIKELY TOO LARGE)";
        if (missingFiles.indexOf(msg) === -1) missingFiles.push(msg);
        return "ERROR";
      }
    }

    function applyMaskSolid(comp: CompItem, row: BuildCsvRow, footageLayer: AVLayer) {
      const w = Math.round(row.maskWidth_px);
      const h = Math.round(row.maskHeight_px);
      if (!(w > 0 && h > 0)) return;

      const solidName = footageLayer.name + "_mask";
      const matte = comp.layers.addSolid([1, 1, 1], solidName, w, h, comp.pixelAspect, comp.duration);
      const mt = matte.property("Transform") as Property;
      (mt.property("Anchor Point") as Property).setValue([0, 0]);
      if (!isNaN(row.maskX_px) && !isNaN(row.maskY_px)) (mt.property("Position") as Property).setValue([row.maskX_px, row.maskY_px]);

      matte.moveBefore(footageLayer);
      footageLayer.trackMatteType = TrackMatteType.ALPHA;
      matte.inPoint = footageLayer.inPoint;
      matte.outPoint = footageLayer.outPoint;
    }

    const csvData = parseCSV(csvFile);
    if (!csvData.length) {
      app.endUndoGroup();
      return { success: false, error: "CSV appears empty or invalid." };
    }

    const uniquePages: string[] = [];
    for (let u = 0; u < csvData.length; u++) {
      const pName = csvData[u].pageLabel;
      if (pName && pName !== "" && uniquePages.indexOf(pName) === -1) uniquePages.push(pName);
    }
    if (uniquePages.length === 0) uniquePages.push("Page1");

    const wh = csvFile.name.match(/(\d+)[xX](\d+)/);
    let compW: number;
    let compH: number;
    if (wh) {
      compW = parseInt(wh[1], 10);
      compH = parseInt(wh[2], 10);
    } else {
      compW = parseInt(prompt("Comp width (px)?", "1920") || "0", 10);
      compH = parseInt(prompt("Comp height (px)?", "1080") || "0", 10);
      if (isNaN(compW) || isNaN(compH) || compW <= 0 || compH <= 0) {
        app.endUndoGroup();
        return { success: false, error: "Invalid comp size." };
      }
    }

    const fps = app.project.activeItem && app.project.activeItem instanceof CompItem ? (app.project.activeItem as CompItem).frameRate : DEFAULT_FPS;

    const mainFolder = findOrCreateFolder("Main", app.project.rootFolder);
    const compName = csvFile.displayName.replace(/\.[^.]+$/, "");
    const compFolder = findOrCreateFolder(compName, mainFolder);
    const assetsFolder = findOrCreateFolder("Assets_" + compName, compFolder);

    const comp = app.project.items.addComp(compName, compW, compH, 1.0, duration, fps);
    comp.parentFolder = compFolder;

    const cache: Record<string, AVItem | "ERROR"> = {};
    let maxDur = 0;
    for (let i = 0; i < csvData.length; i++) {
      const item = importOnce(csvData[i].filePath, assetsFolder, cache);
      if (item && item !== "ERROR" && item.duration && item.duration > maxDur) maxDur = item.duration;
    }
    comp.duration = maxDur > 0 ? maxDur : duration;

    const segmentDuration = comp.duration / uniquePages.length;
    const typeCounters: Record<string, number> = {};

    for (let r = 0; r < csvData.length; r++) {
      const rowObj = csvData[r];
      let lyr: AVLayer | null = null;
      let srcW = 0;
      let srcH = 0;

      const objType = String(rowObj.type);
      const typeUpper = objType.toUpperCase();
      if (!typeCounters[typeUpper]) typeCounters[typeUpper] = 0;
      typeCounters[typeUpper]++;
      let layerName = objType + " " + pad2(typeCounters[typeUpper]);

      if (typeUpper === "RECTANGLE" && String(rowObj.filePath).toUpperCase() === "#E6007D") layerName = "edit";

      if (typeUpper === "RECTANGLE") {
        const sw = Math.max(1, Math.round(rowObj.width_px));
        const sh = Math.max(1, Math.round(rowObj.height_px));
        const rgbColor = hexToColor(String(rowObj.filePath));
        lyr = comp.layers.addSolid(rgbColor, layerName, sw, sh, comp.pixelAspect, comp.duration);
        srcW = sw;
        srcH = sh;
      } else if (rowObj.filePath === "[Native InDesign Object]") {
        continue;
      } else {
        const src = importOnce(rowObj.filePath, assetsFolder, cache);
        if (!src || src === "ERROR") {
          const phW = 1000;
          const phH = 1000;
          lyr = comp.layers.addSolid([1, 0, 0], layerName + " _PLACEHOLDER", phW, phH, comp.pixelAspect, comp.duration);
          srcW = phW;
          srcH = phH;
        } else {
          lyr = comp.layers.add(src) as AVLayer;
          lyr.name = layerName;
          srcW = src.width;
          srcH = src.height;
        }
      }

      lyr.moveToEnd();
      const tr = lyr.property("Transform") as Property;
      (tr.property("Anchor Point") as Property).setValue([0, 0]);
      if (!isNaN(rowObj.x_px) && !isNaN(rowObj.y_px)) (tr.property("Position") as Property).setValue([rowObj.x_px, rowObj.y_px]);
      if (srcW > 0 && srcH > 0 && !isNaN(rowObj.width_px) && !isNaN(rowObj.height_px)) {
        const sx = (rowObj.width_px / srcW) * 100;
        const sy = (rowObj.height_px / srcH) * 100;
        (tr.property("Scale") as Property).setValue([sx, sy]);
      }

      let pIndex = 0;
      for (let idx = 0; idx < uniquePages.length; idx++) {
        if (uniquePages[idx] === rowObj.pageLabel) {
          pIndex = idx;
          break;
        }
      }
      lyr.inPoint = pIndex * segmentDuration;
      lyr.outPoint = (pIndex + 1) * segmentDuration;

      if (!isNaN(rowObj.maskWidth_px) && !isNaN(rowObj.maskHeight_px) && !isNaN(rowObj.maskX_px) && !isNaN(rowObj.maskY_px)) {
        applyMaskSolid(comp, rowObj, lyr);
      }
    }

    // --- Create slice comps from ART masks ---
    function createArtSlices(mainComp: CompItem, csvRows: BuildCsvRow[], compWidth: number, compHeight: number, destFolder: FolderItem) {
      const artRows: BuildCsvRow[] = [];
      for (let i = 0; i < csvRows.length; i++) {
        const row = csvRows[i];
        if (!row || !row.type) continue;
        if (String(row.type).toUpperCase().indexOf("ART") === -1) continue;
        if (isNaN(row.maskX_px) || isNaN(row.maskWidth_px) || row.maskWidth_px <= 0) continue;
        artRows.push(row);
      }
      if (artRows.length === 0) return;

      let edges = [0];
      for (let j = 0; j < artRows.length; j++) {
        const a = artRows[j];
        let left = Math.round(a.maskX_px);
        let right = Math.round(a.maskX_px + a.maskWidth_px);
        if (left < 0) left = 0;
        if (right > compWidth) right = compWidth;
        edges.push(left);
        edges.push(right);
      }
      edges.push(compWidth);
      edges = edges.sort((x, y) => x - y);
      const uniq: number[] = [];
      for (let k = 0; k < edges.length; k++) {
        if (k === 0 || edges[k] !== edges[k - 1]) uniq.push(edges[k]);
      }
      edges = uniq;

      let maskPosXs: number[] = [];
      try {
        for (let li = 1; li <= mainComp.numLayers; li++) {
          const L = mainComp.layer(li);
          if (!L || !L.name) continue;
          if (String(L.name).indexOf("_mask") !== -1) {
            try {
              const posVal = (L.property("Transform") as Property).property("Position")!.value as number[];
              if (posVal && !isNaN(posVal[0])) maskPosXs.push(Math.round(posVal[0]));
            } catch (e) {
              // matches original: a layer whose Position can't be read is silently skipped
            }
          }
        }
      } catch (e) {
        // matches original
      }
      maskPosXs = maskPosXs.sort((a, b) => a - b);
      const mpUnique: number[] = [];
      for (let mi = 0; mi < maskPosXs.length; mi++) {
        if (mi === 0 || maskPosXs[mi] !== maskPosXs[mi - 1]) mpUnique.push(maskPosXs[mi]);
      }
      maskPosXs = mpUnique;

      for (let s = 0; s < edges.length - 1; s++) {
        const leftX = edges[s];
        const rightX = edges[s + 1];
        const width = rightX - leftX;
        if (width <= 0) continue;

        let skipDueToMaskSolid = false;
        for (let mp = 0; mp < maskPosXs.length; mp++) {
          if (maskPosXs[mp] === leftX) {
            skipDueToMaskSolid = true;
            break;
          }
        }
        if (skipDueToMaskSolid) continue;

        const sliceName = mainComp.name + "_slice_" + pad2(s + 1);
        const sliceComp = app.project.items.addComp(sliceName, width, compHeight, mainComp.pixelAspect, mainComp.duration, mainComp.frameRate);
        sliceComp.parentFolder = destFolder;

        const sliceLayer = mainComp.layers.add(sliceComp);
        sliceLayer.name = sliceName;
        const tr = sliceLayer.property("Transform") as Property;
        (tr.property("Anchor Point") as Property).setValue([0, 0]);
        (tr.property("Position") as Property).setValue([leftX, 0]);
      }
    }

    createArtSlices(comp, csvData, compW, compH, compFolder);

    app.endUndoGroup();
    if (missingFiles.length > 0) {
      alert("Build Complete, but the following assets triggered placeholders:\n\n" + missingFiles.join("\n"));
    }
    return { success: true, missingFiles };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// --- Adjust CSV ----------------------------------------------------------
// Ported from toolset/XYi_AdjustExtCsv.jsx's applyCSVToProjects() --
// **already safety-patched at the source-file level** (copy-first via
// `ov_safeOpenMasterCopy()`, the same helper LOS Tools uses -- reused
// directly here rather than redefined, since it's the identical function
// body). For each .aep in a chosen project folder: matches a same-size-
// token CSV, opens a VERSIONED COPY, and for every layer in every comp
// under "Main" whose name equals `<pageLabel>_<type>` for some CSV row,
// replaces its source with that row's file, applies a mask-solid alpha
// matte, and repositions/rescales it from the row's x/y/width/height.
// Ported with the same alert()-per-failure behavior as the original and
// LOS Tools, for the same fidelity reason.
// =============================================================================
interface ExtAdjustCsvRow {
  pageLabel: string;
  type: string;
  name: string;
  filePath: string;
  x_px: number;
  y_px: number;
  width_px: number;
  height_px: number;
  maskX_px: number;
  maskY_px: number;
  maskWidth_px: number;
  maskHeight_px: number;
}

function extAdjustParseCSV(file: File): ExtAdjustCsvRow[] {
  const data: ExtAdjustCsvRow[] = [];
  file.open("r");
  file.readln(); // skip header
  while (!file.eof) {
    const line = file.readln();
    if (!line) continue;
    const cols = line.split(",").map((v) => {
      let s = v + "";
      if (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') s = s.substring(1, s.length - 1);
      return s;
    });
    data.push({
      pageLabel: cols[0],
      type: cols[1],
      name: cols[2],
      filePath: cols[3],
      x_px: parseFloat(cols[4]),
      y_px: parseFloat(cols[5]),
      width_px: parseFloat(cols[6]),
      height_px: parseFloat(cols[7]),
      maskX_px: parseFloat(cols[8]),
      maskY_px: parseFloat(cols[9]),
      maskWidth_px: parseFloat(cols[10]),
      maskHeight_px: parseFloat(cols[11]),
    });
  }
  file.close();
  return data;
}

function extAdjustApplyMaskSolid(comp: CompItem, row: ExtAdjustCsvRow, footageLayer: AVLayer) {
  const maskSolid = comp.layers.addSolid([1, 1, 1], footageLayer.name + "_mask", row.maskWidth_px, row.maskHeight_px, comp.pixelAspect, comp.duration);
  (maskSolid.property("Transform") as Property).property("Anchor Point")!.setValue([0, 0, 0]);
  (maskSolid.property("Transform") as Property).property("Position")!.setValue([row.maskX_px, row.maskY_px]);
  maskSolid.moveBefore(footageLayer);
  footageLayer.trackMatteType = TrackMatteType.ALPHA;
  maskSolid.moveToEnd();
}

// Matches the original exactly: the "Adjust From CSV" button has no
// pre-selection fields in the toolbox tab at all -- clicking it pops
// these two folder dialogs directly, and silently does nothing (no
// alert) if either is cancelled.
export const extAdjustCsvApplyToProjects = (): Result => {
  const csvFolder = Folder.selectDialog("Select folder containing CSV files (will search subfolders)");
  if (!csvFolder) return { success: true };
  const aepFolder = Folder.selectDialog("Select folder containing After Effects project files (.aep)");
  if (!aepFolder) return { success: true };

  app.beginUndoGroup("Apply CSV Data to Projects");

  const csvFiles: File[] = [];
  losCollectFilesRecursive(csvFolder, csvFiles, (f) => /\.csv$/i.test(f.name));
  const aepFiles = aepFolder.getFiles((f) => f instanceof File && /\.aep$/i.test((f as File).name)) as File[];

  for (let p = 0; p < aepFiles.length; p++) {
    const projFile = aepFiles[p];
    const projName = projFile.name;
    const sizeMatch = projName.match(/(\d+x\d+)/);
    if (!sizeMatch) continue;
    const sizeToken = sizeMatch[1];

    let matchingCSV: File | null = null;
    for (let si = 0; si < csvFiles.length; si++) {
      if (csvFiles[si].name.indexOf(sizeToken) !== -1) {
        matchingCSV = csvFiles[si];
        break;
      }
    }
    if (!matchingCSV) {
      alert("No matching CSV for project: " + projName);
      continue;
    }

    // Open a versioned copy, never the master itself -- same helper LOS Tools uses.
    const proj = losSafeOpenMasterCopy(projFile);
    if (!proj) continue;

    const csvData = extAdjustParseCSV(matchingCSV);

    let mainFolder: FolderItem | null = null;
    for (let fi = 1; fi <= proj.numItems; fi++) {
      const item = proj.item(fi);
      if (item instanceof FolderItem && item.name === "Main") {
        mainFolder = item;
        break;
      }
    }
    if (!mainFolder) {
      alert("No 'Main' folder in project: " + projName);
      continue;
    }

    const comps: CompItem[] = [];
    for (let j = 1; j <= proj.numItems; j++) {
      const item = proj.item(j);
      if (item instanceof CompItem && item.parentFolder === mainFolder) comps.push(item);
    }

    for (let ci = 0; ci < comps.length; ci++) {
      const comp = comps[ci];
      const originalLayerCount = comp.numLayers;
      for (let li = 1; li <= originalLayerCount; li++) {
        const layer = comp.layer(li) as AVLayer;

        for (let ri = 0; ri < csvData.length; ri++) {
          const row = csvData[ri];
          const targetName = row.pageLabel + "_" + row.type;
          if (layer.name !== targetName) continue;

          const footFile = new File(row.filePath);
          if (!footFile.exists) {
            alert("Missing source file: " + row.filePath);
            continue;
          }
          const newFoot = proj.importFile(new ImportOptions(footFile)) as AVItem;
          layer.replaceSource(newFoot, false);

          extAdjustApplyMaskSolid(comp, row, layer);

          const oldParent = layer.parent;
          layer.parent = null;
          (layer.property("Transform") as Property).property("Anchor Point")!.setValue([0, 0]);
          (layer.property("Transform") as Property).property("Position")!.setValue([row.x_px, row.y_px]);

          const srcWidth = newFoot.width;
          const srcHeight = newFoot.height;
          const sx = (row.width_px / srcWidth) * 100;
          const sy = (row.height_px / srcHeight) * 100;
          (layer.property("Transform") as Property).property("Scale")!.setValue([sx, sy]);

          layer.parent = oldParent;
        }
      }
    }

    proj.save();
    proj.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  }

  app.endUndoGroup();
  return { success: true };
};

// =============================================================================
// Script Playground — run arbitrary ExtendScript in AE from a textarea.
// =============================================================================

export const runScript = (code: string): Result => {
  try {
    // eslint-disable-next-line no-eval
    const result = eval(code);
    let output: string;
    if (result === undefined) {
      output = "(undefined)";
    } else if (result === null) {
      output = "(null)";
    } else if (typeof result === "object") {
      try {
        output = result.toSource ? result.toSource() : JSON.stringify(result);
      } catch {
        output = String(result);
      }
    } else {
      output = String(result);
    }
    return { success: true, message: output };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

// =============================================================================
// Custom Tools — scripts saved from Script Playground as a permanent
// one-click Toolset button ("button") or a listed, run-on-demand entry in
// Script Playground's own "My Tools" panel ("page"). Persisted as ONE JSON
// blob (unlike the tab/pipe flat-list convention most other Toolset
// personalisation keys use) because a script's own code can freely contain
// literal tabs and "|" (e.g. bitwise OR, or just the text "a | b") -- either
// would silently corrupt a field-split format. React does the
// JSON.parse/stringify on its side; this is just a pass-through string
// store, so there's nothing here that can be corrupted by the script's own
// content.
// =============================================================================
const CUSTOM_TOOLS_SECTION = "XYiToolbox";
const CUSTOM_TOOLS_KEY = "OVCustomTools";

export const loadCustomTools = (): Result => {
  try {
    const raw = app.settings.haveSetting(CUSTOM_TOOLS_SECTION, CUSTOM_TOOLS_KEY)
      ? app.settings.getSetting(CUSTOM_TOOLS_SECTION, CUSTOM_TOOLS_KEY)
      : "";
    return { success: true, message: raw && raw.length > 0 ? raw : "[]" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const saveCustomTools = (entriesJson: string): Result => {
  try {
    app.settings.saveSetting(CUSTOM_TOOLS_SECTION, CUSTOM_TOOLS_KEY, entriesJson);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

// Export/import a subset of custom tools to/from a .json file so they can
// be shared with colleagues (whose app.settings this can't reach directly).
// Both just move an opaque JSON string the React side builds/parses -- the
// selection of WHICH tools, the file-format wrapper, id-stripping on export
// and merge-by-name on import all live in React (MyTools.tsx); these two
// only do the AE-side file dialog + read/write that a browser context
// can't. A message of "" from either means the user cancelled the dialog
// (distinct from a real failure, which sets success:false).
export const exportCustomToolsToFile = (json: string): Result => {
  try {
    let file = File.saveDialog("Export tools to a shareable file", "JSON:*.json");
    if (!file) return { success: true, message: "" }; // cancelled
    // AE's save dialog doesn't force an extension -- add .json if missing so
    // the colleague's Import dialog (filtered to *.json) can see it.
    if (file.name.toLowerCase().indexOf(".json") === -1) {
      file = new File(file.fsName + ".json");
    }
    file.encoding = "UTF-8";
    if (!file.open("w")) return { success: false, error: "Could not open the file for writing." };
    file.write(json);
    file.close();
    return { success: true, message: file.fsName };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const importCustomToolsFromFile = (): Result => {
  try {
    const file = File.openDialog("Import tools from a shared file", "JSON:*.json");
    if (!file) return { success: true, message: "" }; // cancelled
    file.encoding = "UTF-8";
    if (!file.open("r")) return { success: false, error: "Could not open the file for reading." };
    const content = file.read();
    file.close();
    // A genuinely empty file reads as "" -- treat it the same as cancel
    // (nothing to import) rather than erroring on it.
    return { success: true, message: content || "" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

// =============================================================================
// Expressions Bank — team-shared expression snippets, persisted via
// app.settings (section "XYiToolbox", key "ExpressionsBank").
//
// STORAGE IS JSON, NOT DELIMITED TEXT -- and must never go back. The original
// format packed each entry as `id|name|tag|code|uses|description` and joined
// entries with "\t", which silently corrupted or DESTROYED any expression
// whose code contained either delimiter:
//   * a TAB anywhere in the code (i.e. anything pasted from a real editor)
//     split one entry into fragments; every fragment failed the `>= 5` parts
//     test on load and the whole entry was dropped WITHOUT ANY ERROR. This is
//     the "I saved it, moved page, and it was gone" report from the studio.
//   * a `|` in the code -- `||` is ordinary expression syntax -- truncated the
//     code at the first pipe and shifted uses/description into garbage.
// Neither failure surfaced anywhere: the save reported success, and the loss
// only appeared on the next load. Same reasoning (and same fix) as
// saveCustomTools above, which stores an opaque JSON string.
//
// AE escapes newlines/tabs in its prefs file as hex ("0A"/"09"), so a JSON
// blob with embedded newlines round-trips through app.settings intact.
// =============================================================================

// Where the raw pre-JSON value is parked when it turns out to contain
// fragments the legacy reader can't reassemble. NOT in team.ts's PROFILE_KEYS:
// it is one machine's recovery scrap, not personalisation, and has no business
// travelling to a colleague with a profile.
const EXPRESSIONS_LEGACY_BACKUP_KEY = "ExpressionsBankLegacyRaw";

// Legacy pipe/tab reader, kept ONLY so a store written before the JSON switch
// still loads (artists have entries under this key -- see CLAUDE.md on never
// dropping live app.settings data). Lossy by nature; the first save after this
// migrates whatever survived into JSON. Do not extend it.
//
// `dropped` counts fragments that couldn't be read as a record -- i.e. the
// wreckage of an expression whose code contained a tab. Their TEXT is still
// present in the raw setting, just unsplittable back into fields with any
// confidence, so this reports the loss instead of guessing at a reassembly
// that could hand an artist a silently mangled expression to paste into AE.
function expressionsBankParseLegacy(raw: string) {
  const entries: { id: string; name: string; tag: string; code: string; uses: number; description: string }[] = [];
  let dropped = 0;
  const lines = raw.split("\t");
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].length === 0) continue;
    var parts = lines[i].split("|");
    if (parts.length >= 5) {
      // description (parts[5]) is optional -- entries saved before that field
      // existed still load fine, just with an empty description.
      entries.push({
        id: parts[0],
        name: parts[1],
        tag: parts[2],
        code: parts[3],
        uses: parseInt(parts[4]) || 0,
        description: parts.length >= 6 ? parts[5] : "",
      });
    } else {
      dropped++;
    }
  }
  return { entries: entries, dropped: dropped };
}

// Declared rather than riding on `Result` alone: `legacyDropped` is read by
// the frontend to warn about a lossy migration, and this file gets NO type
// checking during a build (tsconfig-build excludes src/jsx entirely -- see
// CLAUDE.md §6), so the shape is worth writing down where it's returned.
interface ExpressionsBankLoadResult extends Result {
  message?: string;
  /** Legacy-format rows that could not be read back. 0 on a JSON store. */
  legacyDropped?: number;
}

export const expressionsBankLoad = (): ExpressionsBankLoadResult => {
  try {
    const raw = app.settings.haveSetting("XYiToolbox", "ExpressionsBank")
      ? app.settings.getSetting("XYiToolbox", "ExpressionsBank")
      : "";
    if (!raw || raw.length === 0) return { success: true, message: "[]" };
    // We always write a bare JSON array, so the first character identifies the
    // format. A legacy row starts with an id, never with "[".
    if (raw.charAt(0) === "[") {
      // Hand the stored JSON straight back rather than parse-and-restringify:
      // unknown fields added by a newer panel (origin/author) survive a read
      // on an older one instead of being silently stripped.
      return { success: true, message: raw };
    }
    const legacy = expressionsBankParseLegacy(raw);
    if (legacy.dropped > 0) {
      // Park the original text before the first JSON save overwrites this key
      // -- the wreckage of a lost expression is still readable in there by
      // hand. Written once and never overwritten, so a later, more degraded
      // read can't replace a good backup.
      try {
        if (!app.settings.haveSetting("XYiToolbox", EXPRESSIONS_LEGACY_BACKUP_KEY)) {
          app.settings.saveSetting("XYiToolbox", EXPRESSIONS_LEGACY_BACKUP_KEY, raw);
        }
      } catch (e2) {
        // A failed backup must not stop the bank from loading.
      }
    }
    return { success: true, message: JSON.stringify(legacy.entries), legacyDropped: legacy.dropped };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const expressionsBankSave = (entriesJson: string): Result => {
  try {
    // Validate before writing: a malformed payload must not overwrite a good
    // store with something the next load can't read.
    var entries = JSON.parse(entriesJson);
    if (!(entries instanceof Array)) return { success: false, error: "Expression data was not a list." };
    app.settings.saveSetting("XYiToolbox", "ExpressionsBank", JSON.stringify(entries));
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

// =============================================================================
// Comp Inspector — read-only report of the active comp's layers, effects,
// and key properties. Returns a JSON string the React side parses.
// =============================================================================

export const compInspectorInspect = (): Result => {
  try {
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "No active comp." };

    var info: any = {
      name: comp.name,
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      duration: comp.duration,
      pixelAspect: comp.pixelAspect,
      bgColor: [comp.bgColor[0], comp.bgColor[1], comp.bgColor[2]],
      layers: []
    };

    for (var i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      var layerInfo: any = {
        index: i,
        name: layer.name,
        enabled: layer.enabled,
        solo: layer.solo,
        locked: layer.locked,
        shy: layer.shy,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        startTime: layer.startTime,
        duration: layer.outPoint - layer.inPoint,
        sourceName: "",
        typeName: "",
       Effects: []
      };

      var src = layer.source;
      if (src) layerInfo.sourceName = src.name;

      if (src instanceof CompItem) layerInfo.typeName = "Comp";
      else if (src instanceof FootageItem) {
        if (src.mainSource && src.mainSource instanceof FileSource) {
          layerInfo.typeName = src.mainSource.isFile ? "Footage (File)" : "Footage (Solid)";
        } else {
          layerInfo.typeName = "Footage";
        }
      } else if (src instanceof ShapeLayerItem) layerInfo.typeName = "Shape";
      else if (src instanceof TextLayerItem) layerInfo.typeName = "Text";
      else if (src instanceof AVLayerItem) layerInfo.typeName = "AV Layer";
      else layerInfo.typeName = "Other";

      // Effects
      var effectsProp = layer.property("ADBE Effect Parade");
      if (effectsProp) {
        for (var j = 1; j <= effectsProp.numProperties; j++) {
          var eff = effectsProp.property(j);
          if (eff) {
            layerInfo.Effects.push({ name: eff.name, matchName: eff.matchName, enabled: eff.enabled });
          }
        }
      }

      info.layers.push(layerInfo);
    }

    return { success: true, message: JSON.stringify(info) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

// =============================================================================
// Render Queue Manager — list/skip/duplicate items in the render queue.
// =============================================================================

export const renderQueueList = (): Result => {
  try {
    var items: any[] = [];
    for (var i = 1; i <= app.project.renderQueue.numItems; i++) {
      var item = app.project.renderQueue.item(i);
      items.push({
        id: i,
        compName: item.comp ? item.comp.name : "(unknown)",
        status: item.status,
        startTime: String(item.startTime),
        elapsedTime: String(item.elapsedTime),
        outputModuleName: "",
        outputPath: "",
        skip: item.skip,
        numOutputModules: item.numOutputModules
      });
      if (item.numOutputModules > 0) {
        var om = item.outputModule(1);
        items[i - 1].outputModuleName = om.name;
        var file = om.file;
        if (file) items[i - 1].outputPath = file.fsName;
      }
    }
    return { success: true, message: JSON.stringify(items) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const renderQueueSetSkip = (index: number, skip: boolean): Result => {
  try {
    if (index < 1 || index > app.project.renderQueue.numItems) return { success: false, error: "Out of range." };
    app.project.renderQueue.item(index).skip = skip;
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const renderQueueClear = (): Result => {
  try {
    while (app.project.renderQueue.numItems > 0) {
      app.project.renderQueue.item(app.project.renderQueue.numItems).remove();
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const renderQueueRemoveItem = (index: number): Result => {
  try {
    if (index < 1 || index > app.project.renderQueue.numItems) return { success: false, error: "Out of range." };
    app.project.renderQueue.item(index).remove();
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

// Remove a render queue item by its comp's unique ID (stable), not by
// positional index (which shifts when items are removed). Iterates the
// queue, finds the item whose comp.id matches, removes it.
export const renderQueueRemoveByCompId = (compId: number): Result => {
  try {
    const rq = app.project.renderQueue;
    for (let i = rq.numItems; i >= 1; i--) {
      const item = rq.item(i);
      if (item.comp && item.comp.id === compId) {
        item.remove();
        return { success: true };
      }
    }
    return { success: false, error: "Comp not found in render queue." };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

// =============================================================================
// True Comp Duplicator -- duplicates selected compositions while maintaining
// all layer references, effects, and expressions. Handles nested pre-comps
// recursively and updates expressions to reference the new duplicated comps.
// =============================================================================
export const trueCompDuplicator = (options: {
  suffix: string;
  includeNested: boolean;
  updateExpressions: boolean;
}): Result => {
  try {
    const { suffix = "_DUP", includeNested = true, updateExpressions = true } = options;

    // Get selected items from the project panel
    const selectedItems = app.project.selection;
    if (selectedItems.length === 0) {
      return { success: false, error: "Please select one or more compositions in the Project panel." };
    }

    // Filter to only compositions
    const selectedComps: CompItem[] = [];
    for (let i = 0; i < selectedItems.length; i++) {
      if (selectedItems[i] instanceof CompItem) {
        selectedComps.push(selectedItems[i] as CompItem);
      }
    }

    if (selectedComps.length === 0) {
      return { success: false, error: "No compositions selected. Please select at least one comp." };
    }

    app.beginUndoGroup("True Comp Duplicator");

    const duplicatedComps: string[] = [];
    const compMapping: Record<number, CompItem> = {}; // Maps original comp ID to duplicated comp

    // Helper function to duplicate a comp and its nested pre-comps
    const duplicateComp = (originalComp: CompItem): CompItem => {
      // Check if we already duplicated this comp
      if (compMapping[originalComp.id]) {
        return compMapping[originalComp.id];
      }

      // Duplicate the comp
      const duplicatedComp = originalComp.duplicate();
      duplicatedComp.name = originalComp.name + suffix;
      compMapping[originalComp.id] = duplicatedComp;

      // Process layers if we need to handle nested pre-comps or update expressions
      if (includeNested || updateExpressions) {
        for (let i = 1; i <= duplicatedComp.layers.length; i++) {
          const layer = duplicatedComp.layer(i);

          // Handle nested pre-comps
          if (includeNested && layer.source instanceof CompItem) {
            const originalSource = originalComp.layer(i).source as CompItem;
            const duplicatedSource = duplicateComp(originalSource);
            layer.replaceSource(duplicatedSource, false);
          }

          // Update expressions
          if (updateExpressions) {
            updateLayerExpressions(layer, originalComp, duplicatedComp, compMapping);
          }
        }
      }

      return duplicatedComp;
    };

    // Helper function to update expressions in a layer
    const updateLayerExpressions = (
      layer: Layer,
      originalComp: CompItem,
      duplicatedComp: CompItem,
      compMapping: Record<number, CompItem>
    ): void => {
      try {
        // Get all properties that might have expressions
        const properties = getAllProperties(layer);

        for (let i = 0; i < properties.length; i++) {
          const prop = properties[i];
          if (prop.canSetExpression && prop.expression) {
            const originalExpr = prop.expression;
            const updatedExpr = updateExpressionString(
              originalExpr,
              originalComp,
              duplicatedComp,
              compMapping
            );

            if (updatedExpr !== originalExpr) {
              try {
                prop.expression = updatedExpr;
              } catch (e) {
                // If expression update fails, leave the original expression
                // This can happen if the expression references something that
                // doesn't exist in the duplicated comp
              }
            }
          }
        }
      } catch (e) {
        // Silently continue if we can't update expressions for this layer
      }
    };

    // Helper to get all properties from a layer (including nested properties)
    const getAllProperties = (layer: Layer): Property[] => {
      const properties: Property[] = [];

      const collectProperties = (obj: any): void => {
        if (obj instanceof Property) {
          properties.push(obj);
        }

        // Recurse into CHILDREN only. `numProperties`/`property(i)` walks
        // downward and already reaches every descendant on its own.
        //
        // This function used to ALSO call `obj.propertyGroup(1)` here --
        // but PropertyBase.propertyGroup(countUp) returns the PARENT of
        // obj, not a child. Calling it recursed UPWARD: every leaf
        // property re-visited its parent group, which re-visited ALL of
        // its children (including the leaf just visited) via the
        // numProperties loop above, each of which recursed into the
        // parent again -- exponential blow-up on any layer with a normal
        // property tree depth (Transform/Effects/Masks, an effect's own
        // parameters, etc.). This was the exact cause of a real-AE report:
        // True Comp Duplicator would run, then hang AE solid, with an
        // "error executing script at line N" dialog on force-exit (AE's
        // response to killing a runaway ExtendScript call). Removed the
        // upward branch entirely -- it added no reachable properties the
        // downward walk didn't already cover.
        if (obj.numProperties !== undefined) {
          for (let i = 1; i <= obj.numProperties; i++) {
            try {
              collectProperties(obj.property(i));
            } catch (e) {
              // Skip inaccessible properties
            }
          }
        }
      };

      collectProperties(layer);
      return properties;
    };

    // Helper to update expression string with new comp references
    const updateExpressionString = (
      expression: string,
      originalComp: CompItem,
      duplicatedComp: CompItem,
      compMapping: Record<number, CompItem>
    ): string => {
      let updatedExpr = expression;

      // Replace comp() references
      // Pattern: comp("Original Comp Name") -> comp("Duplicated Comp Name")
      const compRegex = /comp\(["']([^"']+)["']\)/g;
      updatedExpr = updatedExpr.replace(compRegex, (match, compName) => {
        // Find the original comp by name
        for (let i = 1; i <= app.project.numItems; i++) {
          const item = app.project.item(i);
          if (item instanceof CompItem && item.name === compName) {
            const duplicated = compMapping[item.id];
            if (duplicated) {
              return `comp("${duplicated.name}")`;
            }
          }
        }
        return match;
      });

      // Replace thisComp references if needed
      // thisComp in the original should become the duplicated comp in the duplicate
      // However, thisComp is a special keyword that refers to the comp containing the layer,
      // so it will automatically refer to the duplicated comp. No replacement needed.

      return updatedExpr;
    };

    // Duplicate all selected comps
    for (let i = 0; i < selectedComps.length; i++) {
      const duplicatedComp = duplicateComp(selectedComps[i]);
      duplicatedComps.push(duplicatedComp.name);
    }

    app.endUndoGroup();

    return {
      success: true,
      duplicatedComps,
      message: `Successfully duplicated ${duplicatedComps.length} composition(s).`,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Edit In Context — edit a layer that lives inside a precomp WITHOUT leaving
// the comp you're looking at.
//
// THE POINT, and why the first version didn't work: the tedium being solved is
// "go into the precomp, tweak, come back out, look, repeat". The first version
// made you stand INSIDE the precomp and searched UPWARD for parents, which
// assumes the exact navigation it was meant to remove. This one runs the other
// way — you stay in your main comp and reach DOWN into nested layers.
//
// It also can't be solved with viewers. AE's `Viewer` class exposes only
// type/active/views/activeViewIndex/maximized/setActive() — there is NO lock
// property and no window positioning, so the "two viewers, one locked" setup
// people picture is not scriptable at all. Verified against the AE typings.
// Editing from the parent sidesteps the whole problem: never navigate away and
// the viewer never changes, so every write lands in front of you.
//
// SAFETY: touches only transform properties of layers in the ALREADY-OPEN
// project. No app.open(), no save, no file access of any kind.
// =============================================================================

interface EicLayerInfo {
  index: number;
  name: string;
  isPrecomp: boolean;
  sourceCompId: number;
  transformable: boolean;
}

interface EicResolved {
  comp: CompItem;       // the comp the target layer lives in
  layer: Layer;         // the target layer itself
  chain: Layer[];       // precomp layers traversed, outermost first
}

/** Cameras/lights have no scale; duck-type on the capability we actually use. */
function eicTransformable(layer: Layer): boolean {
  try { return typeof (layer as any).sourceRectAtTime === "function"; } catch (e) { return false; }
}

/**
 * Walk a path of layer indices from a root comp down to a nested layer.
 * path[0] indexes into the root comp; each earlier entry must be a precomp
 * layer. Indices (not object identity) because AE DOM objects can't be
 * compared with === across calls.
 */
function eicResolve(rootId: number, path: number[]): EicResolved | null {
  try {
    const root = app.project.itemByID(rootId);
    if (!root || !(root instanceof CompItem)) return null;
    if (!path || path.length === 0) return null;

    let comp: CompItem = root as CompItem;
    const chain: Layer[] = [];
    for (let i = 0; i < path.length; i++) {
      const idx = path[i];
      if (idx < 1 || idx > comp.numLayers) return null;
      const layer = comp.layer(idx);
      if (i === path.length - 1) return { comp: comp, layer: layer, chain: chain };
      const src = (layer as any).source;
      if (!src || !(src instanceof CompItem)) return null;   // path says descend, but it isn't a precomp
      chain.push(layer);
      comp = src as CompItem;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Convert a POSITION delta expressed in the root comp's pixels into the target
 * layer's own comp pixels.
 *
 * Maps two points through the chain and subtracts, rather than dividing by a
 * scale factor: the subtraction cancels the translation, leaving scale AND
 * rotation correctly applied at every level. `fromComp` on a precomp layer maps
 * that layer's containing-comp space into the precomp's own space.
 */
function eicRootDeltaToLocal(chain: Layer[], dx: number, dy: number): number[] {
  let p0: number[] = [0, 0];
  let p1: number[] = [dx, dy];
  for (let i = 0; i < chain.length; i++) {
    const L = chain[i] as any;
    try {
      p0 = L.fromComp(p0);
      p1 = L.fromComp(p1);
    } catch (e) {
      return [dx, dy];   // best effort: unconvertible level, pass the delta through
    }
  }
  return [p1[0] - p0[0], p1[1] - p0[1]];
}

/** Product of the chain's scales, per axis, as a factor (100% -> 1). */
function eicCumulativeScale(chain: Layer[]): number[] {
  let sx = 1;
  let sy = 1;
  for (let i = 0; i < chain.length; i++) {
    try {
      const s = (chain[i] as any).transform.scale.value;
      sx = sx * (s[0] / 100);
      sy = sy * (s[1] / 100);
    } catch (e) { /* leave this level at 1 */ }
  }
  return [sx, sy];
}

/** Where the user is standing. Everything else hangs off this. */
export const editInContextRoot = (): Result & { compId?: number; compName?: string } => {
  try {
    const item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
      return { success: false, error: "Open the comp you want to work in first." };
    }
    const comp = item as CompItem;
    return { success: true, compId: comp.id, compName: comp.name };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * The comp the artist is standing in, and the ONE layer selected in it.
 *
 * POLLED, so it is deliberately the cheapest call in this file: two reads and
 * no undo group, no viewer touch, nothing written. The panel follows the
 * selection live, and a call that cost anything would be felt on every tick.
 *
 * ONE layer, not many. "The selected layer" has no meaning when three are
 * selected, and picking the first of them would be a guess the artist never
 * made -- the panel leaves its target alone instead.
 *
 * Duck-typed rather than `instanceof CompItem`, per CLAUDE.md section 2: two
 * accesses of the same AE object come back as different wrappers, and this one
 * runs about once a second.
 */
export const editInContextSelection = (): Result & {
  compId?: number;
  compName?: string;
  selectedCount?: number;
  layerIndex?: number;
  layerName?: string;
  isPrecomp?: boolean;
  sourceCompId?: number;
} => {
  try {
    const item = app.project.activeItem as any;
    if (!item || typeof item.numLayers !== "number") {
      return { success: false, error: "No comp is open." };
    }
    const comp = item as CompItem;
    const sel = comp.selectedLayers;
    const count = sel ? sel.length : 0;
    if (count !== 1) {
      return { success: true, compId: comp.id, compName: comp.name, selectedCount: count, layerIndex: 0 };
    }
    const layer = sel[0] as any;
    const src = layer.source;
    // Duck-typed for the same reason, and it is the whole question the panel
    // asks: a layer with layers inside it is a doorway.
    const isPre = !!(src && typeof src.numLayers === "number");
    return {
      success: true,
      compId: comp.id,
      compName: comp.name,
      selectedCount: 1,
      layerIndex: layer.index,
      layerName: layer.name,
      isPrecomp: isPre,
      sourceCompId: isPre ? src.id : 0,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** The layers of one comp, flagged so the UI knows which can be drilled into. */
export const editInContextLayers = (compId: number): Result & { layers?: EicLayerInfo[]; compName?: string } => {
  try {
    const item = app.project.itemByID(compId);
    if (!item || !(item instanceof CompItem)) return { success: false, error: "That comp no longer exists." };
    const comp = item as CompItem;
    const out: EicLayerInfo[] = [];
    for (let i = 1; i <= comp.numLayers; i++) {
      const layer = comp.layer(i);
      const src = (layer as any).source;
      const isPre = !!(src && src instanceof CompItem);
      out.push({
        index: i,
        name: layer.name,
        isPrecomp: isPre,
        sourceCompId: isPre ? (src as CompItem).id : 0,
        transformable: eicTransformable(layer),
      });
    }
    return { success: true, layers: out, compName: comp.name };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Current state of the targeted nested layer.
 *
 * `rootScale` is what the layer's scale LOOKS LIKE in the root comp (its own
 * scale times everything above it) -- the number the artist is actually
 * judging by eye.
 */
export const editInContextTarget = (rootId: number, pathJson: string): Result & {
  layerName?: string; compName?: string;
  position?: number[]; scale?: number[]; rotation?: number; opacity?: number;
  rootScale?: number[]; cumScale?: number[];
  positionKeyed?: boolean; scaleKeyed?: boolean; locked?: boolean;
} => {
  try {
    let path: number[] = [];
    try { path = JSON.parse(pathJson) as number[]; } catch (e2) { return { success: false, error: "Bad layer path." }; }
    const r = eicResolve(rootId, path);
    if (!r) return { success: false, error: "That layer is no longer where it was -- re-pick it." };
    if (!eicTransformable(r.layer)) return { success: false, error: "That layer has no scale/position (camera, light or audio)." };

    const t = (r.layer as any).transform;
    const cum = eicCumulativeScale(r.chain);
    const sc = t.scale.value;
    return {
      success: true,
      layerName: r.layer.name,
      compName: r.comp.name,
      position: t.position.value,
      scale: sc,
      rotation: t.rotation ? t.rotation.value : 0,
      opacity: t.opacity ? t.opacity.value : 100,
      rootScale: [sc[0] * cum[0], sc[1] * cum[1]],
      cumScale: cum,
      positionKeyed: t.position.numKeys > 0,
      scaleKeyed: t.scale.numKeys > 0,
      locked: r.layer.locked,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Nudge one transform property of the nested layer.
 *
 * `kind`: "position" | "scale" | "rotation" | "opacity".
 * `inRootSpace`: interpret the delta in the ROOT comp's pixels/percent rather
 * than the nested comp's, so "move it 10px right" means 10px as seen on the
 * screen the artist is looking at.
 *
 * A KEYFRAMED property gets a key at the current time instead of a setValue --
 * setValue on an animated property throws, and silently flattening someone's
 * animation would be worse than either.
 */
export const editInContextNudge = (
  rootId: number, pathJson: string, kind: string, dx: number, dy: number, inRootSpace: boolean
): Result & { position?: number[]; scale?: number[]; rotation?: number; opacity?: number; rootScale?: number[]; keyed?: boolean } => {
  let undoOpen = false;
  try {
    let path: number[] = [];
    try { path = JSON.parse(pathJson) as number[]; } catch (e2) { return { success: false, error: "Bad layer path." }; }
    const r = eicResolve(rootId, path);
    if (!r) return { success: false, error: "That layer is no longer where it was -- re-pick it." };
    if (r.layer.locked) return { success: false, error: '"' + r.layer.name + '" is locked in its comp.' };
    if (!eicTransformable(r.layer)) return { success: false, error: "That layer has no scale/position." };

    const t = (r.layer as any).transform;
    const time = r.comp.time;

    app.beginUndoGroup("Edit In Context nudge");
    undoOpen = true;

    let keyed = false;
    const write = (prop: any, value: any) => {
      if (prop.numKeys > 0) { prop.setValueAtTime(time, value); keyed = true; }
      else { prop.setValue(value); }
    };

    if (kind === "position") {
      let d = [dx, dy];
      if (inRootSpace && r.chain.length > 0) d = eicRootDeltaToLocal(r.chain, dx, dy);
      const cur = t.position.value;
      const next = cur.length > 2 ? [cur[0] + d[0], cur[1] + d[1], cur[2]] : [cur[0] + d[0], cur[1] + d[1]];
      write(t.position, next);
    } else if (kind === "scale") {
      const cum = eicCumulativeScale(r.chain);
      // A root-space percentage has to be divided by everything above it: at a
      // 50% precomp, +10 on screen is +20 on the layer itself.
      const ax = inRootSpace && cum[0] !== 0 ? dx / cum[0] : dx;
      const ay = inRootSpace && cum[1] !== 0 ? dy / cum[1] : dy;
      const cur = t.scale.value;
      const next = cur.length > 2 ? [cur[0] + ax, cur[1] + ay, cur[2]] : [cur[0] + ax, cur[1] + ay];
      write(t.scale, next);
    } else if (kind === "rotation") {
      // Rotation composes additively down the chain, so no space conversion.
      write(t.rotation, t.rotation.value + dx);
    } else if (kind === "opacity") {
      let v = t.opacity.value + dx;
      if (v < 0) v = 0;
      if (v > 100) v = 100;
      write(t.opacity, v);
    } else {
      app.endUndoGroup();
      return { success: false, error: "Unknown nudge kind: " + kind };
    }

    app.endUndoGroup();
    undoOpen = false;

    const cum2 = eicCumulativeScale(r.chain);
    const sc2 = t.scale.value;
    return {
      success: true,
      position: t.position.value,
      scale: sc2,
      rotation: t.rotation ? t.rotation.value : 0,
      opacity: t.opacity ? t.opacity.value : 100,
      rootScale: [sc2[0] * cum2[0], sc2[1] * cum2[1]],
      keyed: keyed,
    };
  } catch (e) {
    if (undoOpen) { try { app.endUndoGroup(); } catch (e3) {} }
    return { success: false, error: e.toString() };
  }
};

/**
 * Select the nested layer in AE's own timeline, for when the artist does want
 * to go in and do something this panel can't. Opens the nested comp's viewer
 * deliberately -- the one place navigation is the point rather than the problem.
 */
export const editInContextReveal = (rootId: number, pathJson: string): Result => {
  try {
    let path: number[] = [];
    try { path = JSON.parse(pathJson) as number[]; } catch (e2) { return { success: false, error: "Bad layer path." }; }
    const r = eicResolve(rootId, path);
    if (!r) return { success: false, error: "That layer is no longer where it was." };
    app.beginUndoGroup("Edit In Context reveal");
    try {
      for (let i = 1; i <= r.comp.numLayers; i++) r.comp.layer(i).selected = false;
      r.layer.selected = true;
      r.comp.openInViewer();
    } catch (eSel) { /* selection is a convenience, not the point */ }
    app.endUndoGroup();
    return { success: true, message: 'Selected "' + r.layer.name + '" in ' + r.comp.name + "." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Darken -- generates a scrim layer to sit behind a CTA / TT / midcard.
//
// Why a solid + feathered mask rather than the obvious alternatives:
//   - A comp-sized solid with a feathered mask CLIPS its own feather at the
//     layer bounds, which is the hard edge you get doing this by hand. So the
//     solid here is deliberately oversized by the feather amount on every
//     side and the mask's outer edges are pushed outside the frame -- only
//     the edge facing INTO frame ever shows its falloff.
//   - Shape-layer gradient fills would be smoother still, but gradient stop
//     colours ("ADBE Vector Grad Colors") are effectively unwritable from
//     ExtendScript, so they'd need hand-editing after generation anyway.
//   - Gradient Ramp on a solid ramps RGB, not alpha -- useless for a scrim.
//
// Placement: directly BEHIND the selected layer (moveAfter), so selecting the
// CTA and hitting Darken lands the scrim in the right slot with the pool
// already sized to that layer. With nothing selected it goes to the top of
// the stack, where it's visible and obvious rather than lost at the bottom.
// =============================================================================
function darkenEllipse(cx: number, cy: number, rx: number, ry: number): Shape {
  // 0.5523 -- the standard cubic-bezier circle approximation constant.
  const k = 0.5523;
  const s = new Shape();
  s.vertices = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
  s.inTangents = [[-rx * k, 0], [0, -ry * k], [rx * k, 0], [0, ry * k]];
  s.outTangents = [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]];
  s.closed = true;
  return s;
}

export const generateDarken = (style: string, opacityPct: number, featherPx: number, coveragePct: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Please open a composition first." };

    const feather = Math.max(0, featherPx || 0);
    const opacity = Math.max(0, Math.min(100, opacityPct || 0));
    const coverage = Math.max(1, Math.min(100, coveragePct || 33));

    // The selected layer (if any) both positions the scrim in the stack and
    // sizes the "pool" style. Anything beyond the first selection is ignored.
    const sel = comp.selectedLayers;
    const anchorLayer = sel.length > 0 ? (sel[0] as AVLayer) : null;

    app.beginUndoGroup("Generate Darken");

    const flat = style === "flat";
    // Oversize so the mask feather never meets the layer edge. Flat needs no
    // mask at all, so it stays exactly comp-sized.
    const pad = flat ? 0 : Math.ceil(feather) + 8;
    const sw = comp.width + pad * 2;
    const sh = comp.height + pad * 2;

    const label = style === "pool" ? "Pool" : style === "bottom" ? "Bottom" : style === "top" ? "Top" : "Flat";
    const solid = comp.layers.addSolid([0, 0, 0], "Darken - " + label, sw, sh, comp.pixelAspect, comp.duration);
    solid.property("Position").setValue([comp.width / 2, comp.height / 2]);
    (solid.property("Opacity") as Property).setValue(opacity);
    solid.label = 11;

    if (!flat) {
      const masks = solid.property("Masks") as Property;
      const mask = masks.addProperty("Mask") as MaskPropertyGroup;
      mask.maskMode = MaskMode.ADD;

      // Layer space: comp point (x, y) sits at (x + pad, y + pad).
      let shape: Shape;
      if (style === "pool") {
        let cx = comp.width / 2;
        let cy = comp.height / 2;
        let rx = comp.width / 4;
        let ry = comp.height / 4;
        if (anchorLayer) {
          try {
            const pos = (anchorLayer.property("Position") as Property).value as number[];
            const sc = (anchorLayer.property("Scale") as Property).value as number[];
            const r = anchorLayer.sourceRectAtTime(comp.time, false);
            // Approximate: assumes the layer is unparented and unrotated. The
            // generous feather padding absorbs the error in practice.
            cx = pos[0];
            cy = pos[1];
            rx = Math.abs(r.width * (sc[0] / 100)) / 2 + feather * 0.75 + 40;
            ry = Math.abs(r.height * (sc[1] / 100)) / 2 + feather * 0.75 + 40;
          } catch (e) {
            // Fall through to the comp-centred default above.
          }
        }
        shape = darkenEllipse(cx + pad, cy + pad, rx, ry);
      } else {
        const band = comp.height * (coverage / 100);
        // Every edge except the one facing into frame is pushed outside the
        // solid's own bounds, so only that edge's feather is ever visible.
        const top = style === "bottom" ? pad + (comp.height - band) : -pad;
        const bottom = style === "bottom" ? sh + pad : pad + band;
        shape = new Shape();
        shape.vertices = [[-pad, top], [sw + pad, top], [sw + pad, bottom], [-pad, bottom]];
        shape.closed = true;
      }

      (mask.property("Mask Path") as Property).setValue(shape);
      (mask.property("Mask Feather") as Property).setValue([feather, feather]);
    }

    if (anchorLayer) solid.moveAfter(anchorLayer);
    else solid.moveToBeginning();

    app.endUndoGroup();
    return {
      success: true,
      message: anchorLayer ? "Scrim added behind \"" + anchorLayer.name + "\"." : "Scrim added at the top of the stack.",
    } as Result & { message: string };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Ask agent -- what the artist is looking at right now.
//
// READ-ONLY, and deliberately NOT in agentWrites.ts: that file's header claims
// to be the whole of what the agent can change, and it only stays true if
// nothing read-only moves in beside it.
//
// Sent with every question rather than fetched on demand, so it has to be cheap
// and it has to be quiet. No comp open is a normal state, not an error.
// =============================================================================

export interface AgentContextSnapshot {
  success: boolean;
  compName?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  seconds?: number;
  selectedCount?: number;
  /** A few names, not all of them -- this rides on every question. */
  selectedNames?: string[];
  /** Which expression dialect is legal, so set_expression need not ask. */
  expressionEngine?: string;
}

/** How many selected layer names to name before saying "and N more". */
const CONTEXT_NAME_LIMIT = 5;

export const agentContextSnapshot = (): AgentContextSnapshot => {
  try {
    if (!app || !app.project) return { success: true };

    const item = app.project.activeItem;
    // Duck-typed, never instanceof against a host class (CLAUDE.md section 2).
    if (!item || typeof (item as CompItem).layers === "undefined") {
      return { success: true, expressionEngine: app.project.expressionEngine };
    }
    const comp = item as CompItem;

    const names: string[] = [];
    const sel = comp.selectedLayers;
    for (let i = 0; i < sel.length && i < CONTEXT_NAME_LIMIT; i++) names.push(sel[i].name);

    return {
      success: true,
      compName: comp.name,
      width: comp.width,
      height: comp.height,
      frameRate: Math.round(comp.frameRate * 1000) / 1000,
      seconds: Math.round(comp.duration * 1000) / 1000,
      selectedCount: sel.length,
      selectedNames: names.length ? names : undefined,
      expressionEngine: app.project.expressionEngine,
    };
  } catch (e) {
    // Context is a nicety. A question must never fail because the snapshot did.
    return { success: true };
  }
};
