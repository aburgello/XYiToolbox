// =============================================================================
// src/jsx/aeft/deliver.ts -- backend for the Deliver-category tool
// (DeliveryHub: Delivery, Delivery Checklist). Split out of aeft.ts, which
// is now a thin barrel -- see its header comment for context.
// =============================================================================
import { Result, decode } from "./shared";
import { TS_TERRITORIES, parseFilenameMeta } from "./tools";
import { getTerritoryCountryCode } from "./localise";



// =============================================================================
// Delivery -- ported from XYi_Toolbox.jsx's DelPre(), wired to the
// "Delivery" button. For each selected item, strips its "_VNN" version
// suffix from the name, parses the target size from that name (via
// parseFilenameMeta, same helper Cheeky T Check uses), and wraps it in a
// new comp scaled to that target size, trimmed to its work area.
// =============================================================================
export const delivery = (): Result => {
  try {
    if (app.project.selection.length === 0) return { success: false, error: "Please select compositions first." };
    app.beginUndoGroup("XYi Prep for Delivery");

    for (let i = 0; i < app.project.selection.length; i++) {
      const activeItem = app.project.selection[i] as AVItem;
      const stem = activeItem.name.slice(0, -4);
      const versionMatch = stem.match(/_V\d\d/);
      const newName = versionMatch ? stem.split(versionMatch[0])[0] : stem;

      const meta = parseFilenameMeta(newName);
      const targetSize = meta.size.split("x");
      const targetWidth = Number(targetSize[0]);
      const targetHeight = Number(targetSize[1]);

      const scaler = (targetWidth / activeItem.width) * 100;
      const frameRate = activeItem.frameRate;
      const pixcor = Math.round(targetHeight * activeItem.pixelAspect);

      const myComp = app.project.items.addComp(newName, targetWidth, pixcor, 1, activeItem.duration, frameRate);
      const mySolid = myComp.layers.add(activeItem);
      (mySolid.property("Transform")!.property("Scale") as Property).setValue([scaler, scaler, scaler]);

      mySolid.inPoint = 5;
      myComp.workAreaStart = 5;
      myComp.openInViewer();
      app.executeCommand(app.findMenuCommandId("Trim Comp to Work Area"));
      myComp.displayStartTime = 0;
    }

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// RenderMe! -- new Toolset one-click action, NOT a port of anything in
// toolset/. "Similar to how Deliver works" turned out to mean "a one-click
// Toolset button that does its thing and reports a toast" (the UX shape),
// not Delivery's own logic -- Delivery operates on `app.project.selection`
// and never touches the filesystem or render queue at all (confirmed by
// reading its actual body above); RenderMe! is filesystem/render-queue
// work end to end, so it's its own function, not a variant of delivery().
//
// What it does: for the CURRENTLY OPEN, SAVED project, walks up from the
// .aep file to find a "Renders" folder as a SIBLING of some ancestor
// folder (the studio convention confirmed from real folder screenshots:
// AE/JPG_PNG/Masters/Mechs/PDFs/PSD/Renders/Support_Motion all sit as
// siblings under one territory/market root) -- same "walk up, check
// siblings at each level" technique detectCurrentTerritory() (localise.ts)
// already uses, not llFindContainerFolder's breadth-first DOWNWARD search
// (there's nothing to search downward here; we already know exactly where
// we're starting from, we just don't know how many levels up "Renders"
// sits). Creates (if missing) a same-named subfolder inside Renders,
// matching whatever folder the .aep itself is directly inside of, adds the
// active comp to the render queue with AE's own DEFAULT output module
// settings (no template applied -- "default" is taken literally), and
// redirects just the output FOLDER to that new Renders subfolder, keeping
// AE's own default filename/extension exactly as it already proposed it.
//
// **Also queues a second output** (added later, not part of the original
// single-row version): the studio's standard "H264_16MBPS_MOS" Output
// Module Template, output into a "_mp4" subfolder created inside that
// same batch folder -- so one click leaves both the default/master
// render AND a ready-to-share MP4 queued together. Tries to STACK this
// as a second Output Module on the SAME render-queue row first (matching
// AE's own "Composition > Add Output Module" convention -- see the big
// comment right above the `omMp4` block below for exactly why that's an
// unreliable, best-effort scripting operation, not a documented one),
// falling back to a second separate queued row if the stacking attempt
// doesn't visibly succeed. Either way, a missing/renamed template on the
// local machine doesn't abort the click; that output still queues (with
// AE's default settings) and the toast says so, same non-fatal handling
// deliveryChecklistQueue() below already uses for its own applyTemplate().
//
// **Two assumptions, unverified against the real "AE" side of the folder
// tree (only JPG_PNG's batch-folder structure has been confirmed from
// real screenshots so far) -- flag and revisit if a real test trips
// either one**:
//   1. The .aep's own immediate parent folder IS the batch folder (i.e.
//      projects sit directly inside e.g. ".../AE/Batch_3/file.aep", not
//      nested another level deeper). If real projects sit one level
//      deeper than that, the created Renders subfolder will be named
//      after the wrong (too-deep) folder.
//   2. "The active comp" (app.project.activeItem) is the one meant to be
//      queued -- there's no "Main" folder / selection-based picker here
//      the way some other tools use, since this is a single-click action
//      with no picker UI. If a project's real deliverable comp is never
//      the active one when this gets clicked, this will queue the wrong
//      comp.
// =============================================================================
function llIsRendersFolderName(name: string): boolean {
  const norm = String(name).toLowerCase().replace(/[_\s]+/g, "");
  return norm === "renders" || norm === "render";
}

// Walks up from the saved project file, and at EACH level checks whether
// "Renders" exists as a SIBLING of the current folder (i.e. a child of
// its parent) -- not a downward search into any subtree, so there's no
// risk of the "found a same-named decoy buried somewhere else" bug class
// scanJpgPngBatches had to fix (see localise.ts) -- we only ever look at
// flat sibling lists while ascending from a known starting point.
function llFindRendersFolder(fileObj: File): Folder | null {
  let currentFolder: Folder | null = fileObj.parent;
  while (currentFolder !== null) {
    const parent: Folder | null = currentFolder.parent;
    if (parent) {
      const siblings = parent.getFiles();
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] instanceof Folder && llIsRendersFolderName(siblings[i].name)) {
          return siblings[i] as Folder;
        }
      }
    }
    if (parent && parent.absoluteURI !== currentFolder.absoluteURI) {
      currentFolder = parent;
    } else {
      break;
    }
  }
  return null;
}

// Same underscore-prefixed "generated subfolder" convention
// deliveryEnsureDeliveryFolder() already uses for "_Delivery" -- kept as
// its own tiny helper rather than generalizing that one, since this one
// nests inside a batch folder (RenderMe!'s own), not a .MOV source folder
// (Delivery Checklist's).
function renderMeEnsureMp4Folder(batchFolder: Folder): Folder | null {
  const mp4Folder = new Folder(batchFolder.fsName + "/_mp4");
  if (!mp4Folder.exists) {
    if (!mp4Folder.create()) return null;
  }
  return mp4Folder;
}

const RENDER_ME_MP4_TEMPLATE = "H264_16MBPS_MOS";

interface RenderMeResult extends Result {
  message?: string; // the Renders batch folder path, on success -- shown in the button's toast
}

export const renderMe = (): RenderMeResult => {
  try {
    const projFile = app.project.file;
    if (!projFile) return { success: false, error: "Save your After Effects project first -- RenderMe! needs a saved file path to find the Renders folder." };

    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };

    const rendersFolder = llFindRendersFolder(projFile);
    if (!rendersFolder) {
      return { success: false, error: 'Could not find a "Renders" folder near this project -- expected it as a sibling of the AE folder in the market/territory root.' };
    }

    const batchName = projFile.parent ? decode(projFile.parent.name) : "";
    if (!batchName) return { success: false, error: "Could not determine which batch folder this project is in." };

    const batchFolder = new Folder(rendersFolder.fsName + "/" + batchName);
    if (!batchFolder.exists) {
      if (!batchFolder.create()) return { success: false, error: 'Could not create "' + batchName + '" inside Renders.' };
    }

    app.beginUndoGroup("RenderMe!");

    // Row 1: AE's own default output module, redirected into the batch
    // folder -- unchanged from before.
    const rqItem = app.project.renderQueue.items.add(comp);
    const om = rqItem.outputModule(1);
    // Read AE's own just-assigned default filename (comp name + whatever
    // extension the currently-default Output Module Template produces)
    // BEFORE overwriting it, so only the FOLDER changes -- the filename/
    // extension stay exactly what "default" actually means.
    const defaultFileName = om.file ? om.file.name : comp.name + ".mov";
    om.file = new File(batchFolder.fsName + "/" + defaultFileName);

    // Second output: the studio's standard H264_16MBPS_MOS delivery
    // preset, output into a "_mp4" subfolder of that same batch folder.
    //
    // **EXPERIMENTAL, best-effort stacking onto the SAME render-queue
    // row** (added at direct request, to match AE's own "Composition >
    // Add Output Module" look -- one comp, two Output Module sub-rows --
    // instead of a second separate queued item). This is NOT a
    // documented/reliable scripting operation: `RenderQueueItem
    // .outputModules` is READ-ONLY from script (its own doc comment says
    // it "does not provide any additional functionality" beyond index
    // lookup) -- there is no `.add()`. The only way to add a second
    // Output Module at all is the `Add Output Module` menu command
    // (`_CommandID.AddOutputModule`), which operates on whatever's
    // SELECTED in the Render Queue panel -- a state this script cannot
    // directly set (no `RenderQueueItem.selected` property exists). This
    // relies on AE's own unconfirmed tendency to leave a just-added
    // render-queue item as the selected one, and is verified AFTER the
    // fact (`rqItem.numOutputModules` actually grew) before trusting the
    // result -- if it didn't, this silently falls back to the previous,
    // always-reliable behavior (a second separate queued row for the
    // same comp) rather than leaving the MP4 output half-configured.
    // **Known accepted risk**: if some OTHER render-queue item happened
    // to be the selected one, the menu command still fires and adds a
    // stray, unconfigured Output Module to THAT item -- a harmless but
    // real side effect this fallback can't detect or undo, since there's
    // no way to know which item the command actually targeted. If this
    // proves unreliable in real studio use, drop the executeCommand
    // attempt and always use the fallback path (the previous behavior).
    let mp4Note = "";
    const mp4Folder = renderMeEnsureMp4Folder(batchFolder);
    if (mp4Folder) {
      let omMp4: OutputModule | null = null;
      try {
        app.project.renderQueue.showWindow(true);
        const beforeCount = rqItem.numOutputModules;
        // Literal 2154, not `_CommandID.AddOutputModule` -- that's a
        // `const enum` (types-for-adobe/AfterEffects), which only exists
        // at compile time and needs the REAL tsc to inline it as a
        // number. This project's actual build (vite-cep-plugin, via
        // esbuild) strips/transpiles this file WITHOUT running tsc at
        // all, and esbuild has a documented limitation: it can't inline
        // a const enum declared in a separate .d.ts file, so it leaves
        // the reference as a plain runtime property access on an object
        // that was never emitted anywhere -- `_CommandID.AddOutputModule`
        // would throw "_CommandID is not defined" the instant this ran
        // in real AE. Confirmed by grepping the actual compiled
        // dist/cep/jsx/index.js output, not assumed. AE's own
        // `KeyframeInterpolationType`/`CloseOptions` etc. used elsewhere
        // in this codebase are safe because those are plain `declare
        // enum` (no `const`), which ARE real runtime objects AE itself
        // provides -- `_CommandID` is the one exception, since AE has no
        // actual runtime object for menu command IDs, only numbers.
        app.executeCommand(2154 /* Composition > Add Output Module */);
        if (rqItem.numOutputModules > beforeCount) {
          omMp4 = rqItem.outputModule(rqItem.numOutputModules);
        }
      } catch (e) {
        omMp4 = null;
      }

      if (!omMp4) {
        const rqItemMp4 = app.project.renderQueue.items.add(comp);
        omMp4 = rqItemMp4.outputModule(1);
      }

      // Same applyTemplate()-then-explicit-filename pattern as
      // deliveryChecklistQueue() above -- applying a template doesn't
      // reliably rename the output file's own extension on its own, so
      // ".mp4" is set explicitly here rather than trusted to follow from
      // the template. A missing template (not installed/renamed on this
      // machine -- see CLAUDE.md's Output Module Template caveat)
      // doesn't abort the whole action; the output still queues with
      // AE's default settings and the toast says so, matching how a
      // template miss is handled everywhere else in this file rather
      // than failing the batch.
      try {
        omMp4.applyTemplate(RENDER_ME_MP4_TEMPLATE);
      } catch (e) {
        mp4Note = " (\"" + RENDER_ME_MP4_TEMPLATE + "\" template not found -- MP4 output queued with default settings, apply manually)";
      }
      omMp4.file = new File(mp4Folder.fsName + "/" + comp.name + ".mp4");
    } else {
      mp4Note = ' (could not create "_mp4" folder -- MP4 output not queued)';
    }

    app.endUndoGroup();

    return { success: true, message: batchFolder.fsName + mp4Note };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Shared scale-to-fit helper, ported from XYi_Scaler.jsx's onScaleClick()
// (the "whole comp" branch only -- n!=1, i.e. resize the active comp
// itself, not a single layer's source). Uses a temporary null-parent layer
// so every layer -- including cameras, via their zoom -- scales together,
// then removes the null. Shared by DRQR; Scale Fit/Scale Composition can
// reuse this too once ported.
// =============================================================================
export function makeParentLayerOfAllUnparented(comp: CompItem, newParent: Layer) {
  for (let i = 1; i <= comp.numLayers; i++) {
    const cur = comp.layer(i);
    if (cur !== newParent && cur.parent === null) {
      cur.parent = newParent;
    }
  }
}

export function scaleAllCameraZooms(comp: CompItem, scaleBy: number) {
  for (let i = 1; i <= comp.numLayers; i++) {
    const cur = comp.layer(i);
    if (cur.matchName === "ADBE Camera Layer") {
      const curZoom = (cur as CameraLayer).zoom;
      if (curZoom.numKeys === 0) {
        curZoom.setValue(curZoom.value * scaleBy);
      } else {
        for (let j = 1; j <= curZoom.numKeys; j++) {
          curZoom.setValueAtKey(j, curZoom.keyValue(j) * scaleBy);
        }
      }
    }
  }
}

export function scaleCompToFit(comp: CompItem, newWidth: number, newHeight: number) {
  const oldWidth = comp.width;
  const oldHeight = comp.height;
  const newRatio = newWidth / newHeight;
  const oldRatio = oldWidth / oldHeight;
  const scaleFactor = newRatio > oldRatio ? newWidth / oldWidth : newHeight / oldHeight;

  const null3DLayer = comp.layers.addNull();
  null3DLayer.threeDLayer = true;
  null3DLayer.position.setValue([0, 0, 0]);
  makeParentLayerOfAllUnparented(comp, null3DLayer);

  comp.width = Math.floor(newWidth);
  comp.height = Math.floor(newHeight);
  scaleAllCameraZooms(comp, scaleFactor);

  const superParentScale = null3DLayer.scale.value as number[];
  const superParentPosition = null3DLayer.position.value as number[];
  superParentScale[0] *= scaleFactor;
  superParentScale[1] *= scaleFactor;
  superParentScale[2] *= scaleFactor;
  null3DLayer.scale.setValue(superParentScale);

  if (newRatio > oldRatio) {
    const posHeight = (newWidth / oldWidth) * oldHeight;
    superParentPosition[1] = -0.5 * (posHeight - newHeight);
  } else {
    const posWidth = (newHeight / oldHeight) * oldWidth;
    superParentPosition[0] = -0.5 * (posWidth - newWidth);
  }
  null3DLayer.position.setValue(superParentPosition);

  null3DLayer.remove();
}

// Ported from XYi_DRQR.jsx's processLayers(), reusing onScaleClick's n=1
// ("single layer's source") branch via scaleCompToFit() above -- that
// helper is generic over any CompItem, not just the active one, so it
// works unchanged for a layer's source comp too. Selects every layer in
// the comp cumulatively (nothing is ever deselected, exactly like the
// original), and for every layer whose name doesn't contain "Frontcard",
// resizes a layer's SOURCE comp to the new dimensions and resets that
// loop iteration's layer's own Scale property back to 100/100.
//
// FAITHFULLY REPRODUCES A REAL BUG in the original, deliberately not
// fixed here -- the studio asked for exact behavioral parity with
// XYi_DRQR.jsx, not a corrected version. `onScaleClick(1, newWidth,
// newHeight, 1)` is called with a fixed m=1 every iteration, i.e. it
// always targets `comp.selectedLayers[1]` -- the SECOND layer added to
// the selection, since selection accumulates layer-by-layer across this
// same loop -- never the layer actually being iterated. In practice this
// means only one layer's source (whichever ends up at selection index 1)
// ever actually gets resized, repeatedly, while every OTHER non-Frontcard
// layer still gets its own Scale reset to 100/100 regardless. If fewer
// than 2 layers end up selected at the point this runs (e.g. a comp with
// only one non-Frontcard layer), or that second layer's source isn't a
// CompItem (plain footage has no .layers to add a null to), this throws
// -- same as the original, caught by drqr()'s own try/catch below like
// any other failure, not specially guarded around.
export function drqrProcessLayers(comp: CompItem, newWidth: number, newHeight: number) {
  for (let i = 1; i <= comp.numLayers; i++) {
    const layer = comp.layer(i);
    layer.selected = true;
    if (layer.name.indexOf("Frontcard") === -1) {
      const targetSource = comp.selectedLayers[1].source as CompItem;
      scaleCompToFit(targetSource, newWidth, newHeight);
      layer.scale.setValue([100, 100]);
    }
  }
}

// =============================================================================
// Delivery Checklist -- ported from toolset/XYi_Delivery_Checklist.jsx
// ("Bitrate Delivery Panel"). Loads selected comps, takes a target file
// size (MB) per comp, calculates the required bitrate, queues each comp in
// the render queue with the matching H264_*MBPS_MOS Output Module template
// applied, and points the output at a "_Delivery" subfolder next to the
// comp's .mov source footage. Render-queue only -- no project file is ever
// opened or saved. The ScriptUI original's row UI lives in React
// (tools/DeliveryChecklist.tsx); the constants and per-comp math below are
// ported 1:1.
// =============================================================================
// Curated list of 29 (replaces the earlier ad-hoc set), matching the REAL
// Output Module Templates actually built in AE 1:1, taken directly from a
// screenshot of that template list rather than a hand-guessed sequence --
// notably NOT an even/round progression (2.4 and 3.4 exist but not 3 or
// 4; there's a gap from 8 straight to 5... i.e. 5 and 7 exist but 4/6/9
// don't; 40 jumps straight to 48, skipping 42-46). Every value here needs
// a REAL, identically-named Output Module Template already saved in AE
// (Edit > Templates > Output Module) on whatever machine runs this --
// there's no scripting path to create or enumerate one (confirmed, see
// CLAUDE.md), so this array is the only place that knows what "exists".
// Adding a bitrate here without also building its template in AE just
// means applyTemplate() silently falls through to AE's defaults for that
// row (see appliedOK below) -- and building a template in AE without
// adding its value here makes it invisible to this picker even though it
// exists. If the studio's template set ever changes again, re-derive this
// list from a fresh screenshot/export of the actual template names rather
// than assuming a "nice" numeric progression continues to hold.
const DELIVERY_TEMPLATE_BITRATES_MBPS = [
  0.6, 0.8, 1, 1.4, 2, 2.4, 2.8, 3.4, 5, 7, 8, 10, 12, 14, 16, 18, 20, 22,
  24, 25, 26, 28, 30, 32, 36, 40, 48, 50, 60,
];
const DELIVERY_AUDIO_RESERVE_KBPS = 192;

// All templates in the curated list use consistent uppercase "MBPS" --
// the previous list's one-off lowercase "Mbps" exception at 50 no longer
// applies (that was tied to a specific already-existing template name;
// the 50 in this curated list is a fresh, consistently-named one).
function deliveryFormatTemplateName(mbpsVal: number): string {
  return "H264_" + String(mbpsVal) + "MBPS_MOS";
}

function deliveryFindTemplateName(targetMbps: number): string {
  // Round DOWN to nearest available template (never exceed target size).
  let best: number | null = null;
  for (let i = 0; i < DELIVERY_TEMPLATE_BITRATES_MBPS.length; i++) {
    const val = DELIVERY_TEMPLATE_BITRATES_MBPS[i];
    if (val <= targetMbps && (best === null || val > best)) best = val;
  }
  if (best === null) best = DELIVERY_TEMPLATE_BITRATES_MBPS[0];
  return deliveryFormatTemplateName(best);
}

function deliveryCalcRequiredBitrateMbps(fileSizeMB: number, durationSec: number, includeAudio: boolean): number {
  const totalBits = fileSizeMB * 8 * 1000 * 1000; // MB -> bits (decimal convention)
  let totalKbps = totalBits / durationSec / 1000;
  if (includeAudio) totalKbps -= DELIVERY_AUDIO_RESERVE_KBPS;
  let videoMbps = totalKbps / 1000;
  if (videoMbps < 0) videoMbps = 0.1; // safety floor
  return videoMbps;
}

// Find the first layer in a comp whose source is a .mov footage file, and
// return that file. Null if none. Shared by deliveryFindMovSourceFolder()
// below (unchanged callers just want the parent "Batch_XX" folder) and
// deliveryChecklistLoadComps() (which also wants the full path, for
// Review Session's Wrike-format export -- see ReviewHub.tsx).
function deliveryFindMovSourceFile(comp: CompItem): File | null {
  for (let i = 1; i <= comp.numLayers; i++) {
    const layer = comp.layer(i);
    if (layer instanceof AVLayer && layer.source && layer.source instanceof FootageItem) {
      const srcFile = layer.source.file;
      if (srcFile && srcFile.fsName) {
        const lower = srcFile.fsName.toLowerCase();
        if (lower.indexOf(".mov") === lower.length - 4) {
          return srcFile;
        }
      }
    }
  }
  return null;
}

function deliveryFindMovSourceFolder(comp: CompItem): Folder | null {
  const file = deliveryFindMovSourceFile(comp);
  return file ? file.parent : null;
}

function deliveryEnsureDeliveryFolder(baseFolder: Folder): Folder | null {
  const deliveryFolder = new Folder(baseFolder.fsName + "/_Delivery");
  if (!deliveryFolder.exists) {
    if (!deliveryFolder.create()) return null;
  }
  return deliveryFolder;
}

interface DeliveryCompEntry {
  id: number;
  name: string;
  folderName: string | null; // the .mov source folder's name, or null if none found
  batchFolder: string | null; // the .mov source folder's parent folder name (e.g. "Batch_01"), or null
  sourcePath: string | null; // the .mov source file's full path, or null if none found
  duration: number; // comp duration in seconds
  frameRate: number; // comp frame rate
  territoryCode: string | null; // 2-letter country code from project file's folder tree, or null
}

interface DeliveryLoadResult extends Result {
  comps?: DeliveryCompEntry[];
}

export const deliveryChecklistLoadComps = (): DeliveryLoadResult => {
  const sel = app.project.selection;
  const comps: DeliveryCompEntry[] = [];

  // Detect territory from the project file's folder tree (same approach as tsExtractInfoFromPath)
  let territoryCode: string | null = null;
  const projFile = app.project.file;
  if (projFile) {
    let folder: Folder | null = projFile.parent;
    while (folder) {
      const folderName = decode(folder.name);
      const lowerFolder = folderName.toLowerCase();
      for (let t = 0; t < TS_TERRITORIES.length; t++) {
        if (TS_TERRITORIES[t].toLowerCase() === lowerFolder) {
          const code = getTerritoryCountryCode(TS_TERRITORIES[t]);
          if (code) territoryCode = code;
          break;
        }
      }
      if (territoryCode) break;
      if (folder.parent && folder.parent.absoluteURI !== folder.absoluteURI) {
        folder = folder.parent;
      } else {
        break;
      }
    }
  }

  for (let i = 0; i < sel.length; i++) {
    const item = sel[i];
    if (item instanceof CompItem) {
      const srcFile = deliveryFindMovSourceFile(item);
      const srcParent = srcFile ? srcFile.parent : null;
      comps.push({
        id: item.id,
        name: item.name,
        folderName: srcFile ? decode(srcFile.parent.name) : null,
        batchFolder: srcParent && srcParent.parent ? decode(srcParent.parent.name) : null,
        sourcePath: srcFile ? srcFile.fsName : null,
        duration: item.duration,
        frameRate: item.frameRate,
        territoryCode,
      });
    }
  }
  if (comps.length === 0) return { success: false, error: "Select one or more comps in the Project panel first." };
  return { success: true, comps };
};

interface DeliveryQueueResult extends Result {
  log?: string;
}

export const deliveryChecklistQueue = (
  rows: { id: number; sizeMB: number; maxMbps?: number | null; fps?: number | null; includeAudio?: boolean }[]
): DeliveryQueueResult => {
  try {
    app.beginUndoGroup("Bitrate Delivery Queue");
    const proj = app.project;
    let log = "";

    for (let c = 0; c < rows.length; c++) {
      const comp = proj.itemByID(rows[c].id);
      if (!comp || !(comp instanceof CompItem)) {
        log += "*** Comp no longer exists (reload the list) ***\n\n";
        continue;
      }
      const targetMB = rows[c].sizeMB;
      const maxMbps = rows[c].maxMbps;
      const fps = rows[c].fps;
      const includeAudio = rows[c].includeAudio !== false; // default true
      if (fps != null && fps > 0) {
        comp.frameRate = fps;
      }
      const duration = comp.duration;

      const requiredMbps = deliveryCalcRequiredBitrateMbps(targetMB, duration, includeAudio);
      // A max-bitrate cap is a hard spec constraint (e.g. an ad network's
      // "must stay under 30 Mbps") -- it always wins over the file-size
      // target if the two conflict. Capping means the resulting file will
      // likely land BELOW the requested target size, which is the correct
      // tradeoff (never breaking the cap) rather than hiding it -- the log
      // line below says so explicitly when that happens.
      const capped = maxMbps != null && maxMbps > 0 && requiredMbps > maxMbps;
      const effectiveMbps = capped ? maxMbps! : requiredMbps;
      const templateName = deliveryFindTemplateName(effectiveMbps);

      const rqItem = proj.renderQueue.items.add(comp);
      const om = rqItem.outputModule(1);

      let appliedOK = true;
      try {
        om.applyTemplate(templateName);
      } catch (e) {
        appliedOK = false;
      }

      const srcFolder = deliveryFindMovSourceFolder(comp);
      let pathLine: string;
      if (srcFolder) {
        const deliveryFolder = deliveryEnsureDeliveryFolder(srcFolder);
        if (deliveryFolder) {
          const outFile = new File(deliveryFolder.fsName + "/" + comp.name + ".mp4");
          om.file = outFile;
          pathLine = "  Output: " + outFile.fsName + "\n";
        } else {
          pathLine = "  *** Could not create _Delivery folder — output path NOT set, check manually ***\n";
        }
      } else {
        pathLine = "  *** No .MOV source found in this comp — output path NOT set, check manually ***\n";
      }

      log += comp.name + "\n";
      log += "  Target size: " + targetMB + "MB" + (includeAudio ? " (incl. audio)" : "") + "\n";
      log += "  Required bitrate: " + requiredMbps.toFixed(2) + " Mbps" + (maxMbps != null ? " (cap: " + maxMbps + " Mbps)" : "") + "\n";
      if (capped) {
        log += "  *** Capped to " + maxMbps + " Mbps -- resulting file will likely be SMALLER than the " + targetMB + "MB target ***\n";
      }
      log += "  Applied template: " + templateName + (appliedOK ? "" : "  *** TEMPLATE NOT FOUND - apply manually ***") + "\n";
      log += pathLine + "\n";
    }

    app.endUndoGroup();
    return { success: true, log };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};