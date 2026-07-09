// =============================================================================
// src/jsx/aeft/tools.ts -- backend catch-all: every Tools-category tool
// (Scale Composition, Adjust, Safe Generator, Master of Nulls, Edit Tools,
// Find and Replace, Wall Tools, Extreme Tools 01/02, LOS Tools, Master
// Tools, Project Buttons, Timesheet Tracker, Mask Separator) plus the
// Toolset one-click grid (Turk It, Frontcard, Cheeky T Check, DRQR, MC It!,
// etc.). Split out of aeft.ts, which is now a thin barrel -- see its header
// comment for context.
// =============================================================================
import { Result, SETTINGS_SECTION, findBestComponentFile } from "./shared";
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
        const lastToken = String(compName.split("_").slice(-1));
        item.name = lastToken.length < 3 ? name : name + version;
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

    if (!isValid(composition)) composition = app.project.items.addFolder("Composition");
    if (!isValid(preComp)) preComp = app.project.items.addFolder("PreComp");
    if (!isValid(main)) main = app.project.items.addFolder("Main");
    if (!isValid(assets)) assets = app.project.items.addFolder("Footage");
    if (!isValid(footage)) footage = app.project.items.addFolder("MOVs");
    if (!isValid(artwork)) artwork = app.project.items.addFolder("Artwork");
    if (!isValid(solids)) solids = app.project.items.addFolder("Solids");
    if (!isValid(png)) png = app.project.items.addFolder("PNG");

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

export const frontcard = (): Result => {
  try {
    app.beginUndoGroup("XYi Frontcard");
    const activeItem = app.project.activeItem;
    if (!(activeItem instanceof CompItem)) {
      app.endUndoGroup();
      return { success: false, error: "Select or open a composition first." };
    }

    const newName = activeItem.name + "_V01";
    const width = activeItem.width;
    const height = activeItem.height;
    const duration = activeItem.duration;
    const frameRate = activeItem.frameRate;
    const format = width / height > 1.2 ? "Landscape" : "Portrait";

    app.project.importFile(new ImportOptions(new File(format === "Landscape" ? FRONTCARD_LANDSCAPE_TEMPLATE : FRONTCARD_PORTRAIT_TEMPLATE)));

    const newComp = app.project.items.addComp(newName, width, height, 1, duration + 5, frameRate);
    const compLayer = newComp.layers.add(activeItem);
    compLayer.startTime = 5;

    for (let i = 1; i <= app.project.numItems; i++) {
      const item = app.project.item(i);
      if (item.name === "Portrait_Frontcard" || item.name === "Landscape_Frontcard") {
        newComp.layers.add(item as AVItem);
      }
    }

    const frameDuration = 1 / frameRate;
    compLayer.startTime = Math.round(compLayer.startTime / frameDuration) * frameDuration;

    newComp.openInViewer();

    app.endUndoGroup();
    return { success: true };
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
  campaign: string;
  size: string;
  duration: string;
  territory: string;
  version: string;
  region: string;
}

export function parseFilenameMeta(name: string): FilenameMeta {
  const artworkTypes = ["DOOH", "DFOH", "DINTH", "FOH"];
  const regSize = /(\d+x\d+)(?:px)?/;
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

  const regionMatch = name.match(/_(INTL|DOM)_/);
  if (regionMatch && regionMatch.index !== undefined) {
    region = regionMatch[1];
    filmTitle = name.substring(0, regionMatch.index);
  }

  const sizeMatch = name.match(regSize);
  if (sizeMatch) size = sizeMatch[1];

  const durMatch = name.match(regDur);
  if (durMatch) duration = durMatch[1] + "sec";

  const terMatch = name.match(regTerPart);
  if (terMatch) territory = terMatch[1];

  const verMatch = name.match(regVPart);
  if (verMatch) version = verMatch[1];

  if (regionMatch && regionMatch.index !== undefined && sizeMatch) {
    let startOfDesc = regionMatch.index + regionMatch[0].length;
    const dgtlMarker = "_DGTL_";
    const dgtlIndex = name.indexOf(dgtlMarker, regionMatch.index);
    if (dgtlIndex !== -1) startOfDesc = dgtlIndex + dgtlMarker.length;

    const endOfDesc = name.indexOf("_" + sizeMatch[0]);

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
      if (artworkIndex !== -1) artworkType = middleParts.splice(artworkIndex, 1)[0];
      campaign = middleParts.join("_");
    }
  }

  return { filmTitle, artworkType, campaign, size, duration, territory, version, region };
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

function territoryCheck(input: string): string | null {
  const userInput = input.toLowerCase().replace("_", " ");
  for (let i = 0; i < TC_COUNTRIES.length; i++) {
    // Plain substring check, not .match() -- userInput ultimately comes from
    // real folder/file names on disk (not a fixed set of clean country
    // codes), and .match() treats its argument as a regex pattern. A name
    // containing regex-special characters (parentheses, +, etc. -- common
    // in real territory folder names like "APAC (ex. China)") would throw a
    // SyntaxError instead of just not matching. indexOf has no such risk
    // and is exactly what a substring check needs.
    if (TC_COUNTRIES[i].code.toLowerCase().indexOf(userInput) !== -1) {
      return TC_COUNTRIES[i].name;
    }
  }
  return null;
}

function frontcardLayerTextIndices(variantA: boolean) {
  return variantA
    ? { title: 8, artwork: 7, version: 6, campaignLine: 5, territory: 4, date: 3 }
    : { title: 16, artwork: 15, version: 14, campaignLine: 13, territory: 12, date: 11 };
}

export const cheekyDTCheck = (
  doTitle: boolean,
  doArtwork: boolean,
  doVersion: boolean,
  doCampaign: boolean,
  doDuration: boolean,
  doTerritoryCheck: boolean,
  doDate: boolean
): Result => {
  try {
    const comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return { success: false, error: "Select or open a composition first." };
    const name = comp.name;

    // Short names (<8 underscore tokens): only the territory-check
    // parenthetical gets touched, nothing else.
    if (name.split("_").length < 8) {
      for (let i = 1; i <= comp.numLayers; i++) {
        const layer = comp.layer(i);
        if (String(layer.name.match("Frontcard")) === "Frontcard") {
          const source = (layer as AVLayer).source as CompItem;
          const variantA = source.layer(2).name === "XYi_Logo_V20_[0000-0250].png";
          if (doTerritoryCheck) {
            const idx = variantA ? 4 : 12;
            (source.layer(idx).property("Source Text") as Property).setValue("(HO Approved)");
          }
        }
      }
      return { success: true };
    }

    if (!app.project.file) return { success: false, error: "Save this project once first." };
    const meta = parseFilenameMeta(name);
    const projPath = String(app.project.file);
    const filmTitle = projPath.split("/Digital")[0].split("/").slice(-1)[0].split("_").join(" ");
    const artworkType = meta.artworkType;
    let campaign = meta.campaign.split("_").join(" ") + " ";
    let duration = meta.duration.replace("sec", "");
    const version = meta.version;

    // Same as `new Date(Date(0))` in the original -- that's just today's
    // date via a roundabout string round-trip; simplified to `new Date()`.
    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth() + 1;
    const year = String(today.getFullYear()).slice(2, 4);
    const fullDate = (day < 10 ? "0" : "") + day + "." + (month < 10 ? "0" : "") + month + "." + year;

    const territoryMatch = territoryCheck(meta.territory);

    for (let i = 1; i <= comp.numLayers; i++) {
      const layer = comp.layer(i);
      if (String(layer.name.match("Frontcard")) === "Frontcard") {
        const source = (layer as AVLayer).source as CompItem;
        const variantA = source.layer(2).name === "XYi_Logo_V20_[0000-0250].png";
        const idx = frontcardLayerTextIndices(variantA);

        if (doTitle) (source.layer(idx.title).property("Source Text") as Property).setValue(filmTitle);
        if (doArtwork) (source.layer(idx.artwork).property("Source Text") as Property).setValue(String(artworkType));
        if (doVersion) (source.layer(idx.version).property("Source Text") as Property).setValue(String(version));

        const campaignLineProp = source.layer(idx.campaignLine).property("Source Text") as Property;
        let ender = String(campaignLineProp.value).split(" ").pop() as string;
        ender = ender.slice(0, -1);
        if (!doCampaign) campaign = String(campaignLineProp.value).split(ender)[0];
        if (!doDuration) duration = ender;
        ender = String(campaignLineProp.value).slice(-1);
        campaignLineProp.setValue(String(campaign + "" + duration + ender));

        if (doTerritoryCheck) (source.layer(idx.territory).property("Source Text") as Property).setValue("(" + String(territoryMatch) + ")");
        if (doDate) (source.layer(idx.date).property("Source Text") as Property).setValue(String(fullDate));
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// The "Cheeky T Check" button's exact fixed args from XYi_Toolbox.jsx:
// (title=false, artwork=true, version=true, campaign=false, duration=false,
// territoryCheck=true, date=true).
export const cheekyTCheck = (): Result => cheekyDTCheck(false, true, true, false, false, true, true);

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

    if (width < 500 && height < 500) {
      comp.name += "_QUAD_RES";
      scaleCompToFit(comp, comp.width * 4, comp.height * 4);
    } else if (width < 1000 && height < 1000) {
      comp.name += "_DOUBLE_RES";
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
// PDF's descriptive tokens (its "campaign" field from parseFilenameMeta)
// into the AE-side filename, inserted between a fixed 4-token prefix and
// the resolution-onward suffix.
//
// ASSUMES the AE-side filename has at least 4 tokens before its descriptive
// part, matching the documented studio convention (e.g.
// ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV -- ODY/INTL/DGTL/DOOH is
// the fixed prefix). A shorter filename (fewer than 4 tokens before the
// resolution) will duplicate the resolution token in the output name --
// this is a faithful port of that exact assumption, not a new bug.
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
      campaign: string;
    }

    const pdfData: Parsed[] = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const meta = parseFilenameMeta(pdfFiles[i].name);
      pdfData.push({ file: pdfFiles[i], size: meta.size, campaign: meta.campaign });
    }

    const aeData: Parsed[] = [];
    for (let j = 0; j < aeFiles.length; j++) {
      const meta = parseFilenameMeta(aeFiles[j].name);
      aeData.push({ file: aeFiles[j], size: meta.size, campaign: meta.campaign });
    }

    let renamedCount = 0;
    let duplicatedCount = 0;
    let errorCount = 0;

    for (let p = 0; p < pdfData.length; p++) {
      const pdfSize = pdfData[p].size;
      const pdfTokens = pdfData[p].campaign.toUpperCase().split(/[_\s-]+/);

      for (let a = 0; a < aeData.length; a++) {
        if (aeData[a].size !== pdfSize) continue;

        const aeFile = aeData[a].file;
        const oldName = aeFile.name;
        const baseName = oldName.replace(/\.[^.]+$/, "");
        const ext = oldName.substring(oldName.lastIndexOf("."));
        const parts = baseName.split("_");

        let resIndex = -1;
        for (let idx = 0; idx < parts.length; idx++) {
          if (/\d{2,4}x\d{2,4}/.test(parts[idx])) {
            resIndex = idx;
            break;
          }
        }

        let newBase: string;
        if (resIndex !== -1) {
          const aePrefix = parts.slice(0, 4);
          const aeSuffix = parts.slice(resIndex);
          newBase = aePrefix.concat(pdfTokens, aeSuffix).join("_");
        } else {
          newBase = baseName;
          for (let t = 0; t < pdfTokens.length; t++) {
            if (newBase.toUpperCase().indexOf(pdfTokens[t]) === -1) newBase += "_" + pdfTokens[t];
          }
        }
        const newName = newBase + ext;

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
      message: `Renamed ${renamedCount}, duplicated ${duplicatedCount}${errorCount > 0 ? `, ${errorCount} error(s)` : ""}.`,
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
  const resolutionRegex = /\d+x\d+px?/i;
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
  const resMatch = filename.match(/\d+x\d+/i);
  const thirdOne = resMatch ? resMatch[0] : "";
  const pngNumberMatch = filename.match(/\d+\./);
  const pngNumber = pngNumberMatch ? pngNumberMatch[0].replace(".", "") : "";

  return { firstOne, secondOne, thirdOne, pngNumber };
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

interface McItResult {
  success: boolean;
  error?: string;
  message?: string;
}

export const mcIt = (): McItResult => {
  try {
    const projectFolder = Folder.selectDialog("Select a folder containing After Effects Project files");
    if (!projectFolder) return { success: false, error: "No project folder selected." };
    const aepFiles = (projectFolder.getFiles() as (File | Folder)[]).filter((f): f is File => f instanceof File && /\.aep$/i.test(f.name));
    if (aepFiles.length === 0) return { success: false, error: "No AEP files found in that folder." };

    const imageRootFolder = Folder.selectDialog("Select a folder containing Image files (PNG/JPG) (search includes subfolders)");
    if (!imageRootFolder) return { success: false, error: "No Image folder selected." };
    const imageFiles = mcItGetAllImageFiles(imageRootFolder);
    if (imageFiles.length === 0) return { success: false, error: "No Image files found in that folder." };

    let processedCount = 0;
    let replacedCount = 0;

    for (let p = 0; p < aepFiles.length; p++) {
      const aepFile = aepFiles[p];
      const proj = app.open(aepFile);
      if (!proj) continue;

      const parsedAEP = mcItParseFilename(aepFile.name);

      let footageFolder: FolderItem | null = null;
      for (let i = 1; i <= proj.numItems; i++) {
        const item = proj.item(i);
        if (item instanceof FolderItem && item.name === "Footage") {
          footageFolder = item;
          break;
        }
      }
      if (!footageFolder) continue;

      const targetFolders: FolderItem[] = [];
      for (let i = 1; i <= footageFolder.numItems; i++) {
        const item = footageFolder.item(i);
        if (item instanceof FolderItem && (item.name === "PNG" || item.name === "JPG" || item.name === "JPEG" || item.name === "Images")) {
          targetFolders.push(item);
        }
      }
      if (targetFolders.length === 0) continue;

      for (let tf = 0; tf < targetFolders.length; tf++) {
        const targetFolder = targetFolders[tf];
        for (let j = 1; j <= targetFolder.numItems; j++) {
          const footageItem = targetFolder.item(j) as FootageItem;
          if (footageItem.file && /\.(png|jpe?g)$/i.test(footageItem.file.name)) {
            const originalName = footageItem.file.name;
            const originalExt = mcItGetExt(originalName);
            const parsedOriginal = mcItParseFilename(originalName);

            const validCandidates: File[] = [];
            for (let k = 0; k < imageFiles.length; k++) {
              const candidate = imageFiles[k];
              const candidateExt = mcItGetExt(candidate.name);
              const parsedCandidate = mcItParseFilename(candidate.name);
              const isSameType = originalExt === candidateExt || ((originalExt === "jpg" || originalExt === "jpeg") && (candidateExt === "jpg" || candidateExt === "jpeg"));
              if (isSameType && parsedAEP.thirdOne === parsedCandidate.thirdOne && parsedOriginal.pngNumber === parsedCandidate.pngNumber) {
                validCandidates.push(candidate);
              }
            }

            const bestFile = findBestComponentFile(originalName, validCandidates);
            if (bestFile) {
              footageItem.replace(bestFile);
              replacedCount++;
              $.sleep(500);
            }
          }
        }
      }

      proj.save();
      processedCount++;
      $.sleep(1500);
    }

    return {
      success: true,
      message: `Processed ${processedCount} project(s), replaced ${replacedCount} image(s) (PNG/JPG). Files were updated and saved in place.`,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
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
export function scanMastersForBestMatch(mastersRoot: string, campaign: string, size: string, duration: string): File | null {
  const sizeParts = size.split("x");
  const aspectRatioRef = Number(sizeParts[0]) / Number(sizeParts[1]);
  const plRef = aspectRatioRef >= 1 ? "Landscape" : "Portrait";

  let best: File | null = null;
  let min = 1000;

  const walk = (folder: Folder) => {
    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item instanceof Folder) {
        walk(item);
      } else if (item instanceof File) {
        const path = item.fsName;
        if (
          path.slice(-4) === ".aep" &&
          path.indexOf(campaign) !== -1 &&
          path.indexOf("Auto-Save") === -1 &&
          path.indexOf("_Archive") === -1 &&
          path.indexOf("_Old") === -1 &&
          path.indexOf("_DEV") === -1 &&
          path.indexOf(duration) !== -1
        ) {
          const sizeMatch = path.match(/\d+x\d+/);
          if (!sizeMatch) continue;
          const destParts = sizeMatch[0].split("x");
          const widthDest = Number(destParts[0]);
          const heightDest = Number(destParts[1]);
          const aspectRatioDest = widthDest / heightDest;
          const plDest = aspectRatioDest >= 1 ? "Landscape" : "Portrait";
          if (plDest === plRef) {
            const diff = Math.abs(aspectRatioRef - aspectRatioDest);
            if (diff <= min) {
              best = item;
              min = diff;
            }
          }
        }
      }
    }
  };

  const root = new Folder(mastersRoot);
  if (root.exists) walk(root);
  return best;
}

export interface CampaignLocaliserResult {
  success: boolean;
  error?: string;
  message?: string;
}

export const campaignLocaliserGenerate = (skipExisting: boolean): CampaignLocaliserResult => {
  try {
    const mastersPath = Folder.selectDialog("Please select the Master / loc folder to scan");
    if (!mastersPath) return { success: false, error: "No masters folder selected." };

    const locFile = File.openDialog("Please select the File to Localise.");
    if (!locFile) return { success: false, error: "No localisation file selected." };
    if (!locFile.open("r")) return { success: false, error: "Could not open the localisation file." };

    const scanRegV = /V\d\d/;
    let myComp: CompItem | null = app.project.activeItem instanceof CompItem ? app.project.activeItem : null;
    let generatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    while (!locFile.eof) {
      try {
        const line = locFile.readln();
        const texLoc = line.split(",");
        const sizeParts = texLoc[2].split("x");
        const campaign = texLoc[1].toUpperCase();
        const width = Math.floor(Number(sizeParts[0]));
        const height = Math.floor(Number(sizeParts[1]));
        const size = width + "x" + height;
        const duration = String(texLoc[3]) + "sec";

        const bestMatch = scanMastersForBestMatch(mastersPath.fsName, campaign, size, duration);
        if (!bestMatch) {
          errorCount++;
          continue;
        }

        const textMasterPath = bestMatch.fsName;
        const linesMaster = textMasterPath.split("/");
        let masterName = linesMaster[linesMaster.length - 1];
        const ratioPattern = /^_(\d+\.\d+)_/;
        if (ratioPattern.test(masterName)) {
          masterName = masterName.split(ratioPattern)[2];
        }

        const masterSizeMatch = masterName.match(/\d+x\d+/);
        if (!masterSizeMatch) {
          errorCount++;
          continue;
        }
        const masterDims = masterSizeMatch[0].split("x");
        const masterWidth = Math.floor(Number(masterDims[0]));
        const masterHeight = Math.floor(Number(masterDims[1]));
        const plm = masterWidth < masterHeight ? "PORTRAIT" : "LANDSCAPE";

        const scanFilmTitle = masterName.split("_")[0];
        const scanIndo = masterName.split("_")[1];
        const scanArtworkType = texLoc[0];
        const locFileNameParts = locFile.name.split("_");
        const scanTerritory = locFileNameParts[locFileNameParts.length - 1].slice(0, 2);

        const newCompName =
          scanFilmTitle + "_" + scanIndo + "_DGTL_" + scanArtworkType + "_" + campaign + "_" + width + "x" + height + "_" + duration + "_" + scanTerritory;

        const outputFile = new File(locFile.parent.fsName + "/" + newCompName + "_V01.aep");
        if (skipExisting && outputFile.exists) {
          skippedCount++;
          continue;
        }

        // Opens the matched master directly, exactly as the original --
        // see the block comment above for why this is confirmed safe here.
        const masterFile = new File(textMasterPath);
        const proj = app.open(masterFile);
        if (!proj) {
          errorCount++;
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
          errorCount++;
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

        generatedCount++;
      } catch (lineErr) {
        errorCount++;
      }
    }

    locFile.close();

    return {
      success: true,
      message: `Generated ${generatedCount}, skipped ${skippedCount}${errorCount > 0 ? `, ${errorCount} error(s)/no-match` : ""}.`,
    };
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
export const scaleCompositionByName = (): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
    const match = comp.name.match(/(\d+)x(\d+)/);
    if (!match) return { success: false, error: "Comp name doesn't contain a WIDTHxHEIGHT token." };
    return scaleCompositionExplicit(parseInt(match[1], 10), parseInt(match[2], 10));
  } catch (e) {
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
// TEMPORARY diagnostic build -- reports exactly what happened on each
// click (old/new size, computed offset, and each layer's skip reason or
// before/after Position) via the Result's `message`, surfaced by
// MasterTools.tsx's status banner. Added to track down a real user-
// reported bug (content not staying centered on resize, confirmed via
// screenshots against a layer that WAS centered beforehand) that couldn't
// be found by static code comparison against the original XYi_CompSize.jsx
// (the offset math is textually identical) -- revert the diagnostic
// message-building once the root cause is confirmed from real output.
// Also fixes a real latent gap found while touching this: the catch block
// never called app.endUndoGroup(), unlike every other function in this
// file -- an exception mid-loop would leave the undo group open
// indefinitely, silently merging unrelated later operations into it.
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

    let debugLog = "old=" + oldWidth + "x" + oldHeight + " new=" + newWidth + "x" + newHeight + " offset=(" + widthOffset + "," + heightOffset + ") layers=" + comp.numLayers + " | ";

    for (let i = 1; i <= comp.numLayers; i++) {
      const layer = comp.layer(i);
      if (layer.parent !== null || layer.locked) {
        debugLog += layer.name + ":SKIP(parent=" + (layer.parent !== null) + ",locked=" + layer.locked + ") ";
        continue;
      }

      const posProp = layer.property("Position") as Property;
      if (posProp.dimensionsSeparated) {
        const xProp = layer.property("X Position") as Property;
        const yProp = layer.property("Y Position") as Property;
        const beforeX = xProp.value as number;
        const beforeY = yProp.value as number;
        xProp.setValue(beforeX + widthOffset);
        yProp.setValue(beforeY + heightOffset);
        debugLog += layer.name + ":SEP before=(" + beforeX + "," + beforeY + ") after=(" + xProp.value + "," + yProp.value + ") ";
      } else {
        const curPos = posProp.value as number[];
        if (layer.threeDLayer) {
          posProp.setValue([curPos[0] + widthOffset, curPos[1] + heightOffset, curPos[2]]);
        } else {
          posProp.setValue([curPos[0] + widthOffset, curPos[1] + heightOffset]);
        }
        const afterPos = posProp.value as number[];
        debugLog += layer.name + ":before=(" + curPos[0] + "," + curPos[1] + ") after=(" + afterPos[0] + "," + afterPos[1] + ") numKeys=" + posProp.numKeys + " ";
      }

      const poiProp = layer.property("Point of Interest") as Property | null;
      if (poiProp && poiProp.numKeys === 0) {
        const curPOI = poiProp.value as number[];
        poiProp.setValue([curPOI[0] + widthOffset, curPOI[1] + heightOffset, curPOI[2]]);
      }
    }

    comp.width = Math.floor(newWidth);
    comp.height = Math.floor(newHeight);
    app.endUndoGroup();
    return { success: true, message: debugLog };
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
const AUTO_AR_LANDSCAPE = {
  labels: ["Square", "Quad", "1920x1080", "48", "30", "96", "Extreme"],
  w: { Square: 1.0, Quad: 1.333333, "1920x1080": 1.777778, "48": 2.0, "30": 2.237762, "96": 4.0, Extreme: 6.552901024 } as Record<string, number>,
};
const AUTO_AR_PORTRAIT = {
  labels: ["1Sheet", "1080x1920", "Tall-Port", "6Sheet"],
  w: { "1Sheet": 0.675, "1080x1920": 0.5625, "Tall-Port": 0.354324, "6Sheet": 0.666667 } as Record<string, number>,
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

  if (isPos) {
    expr += "\n// --- AUTO-CENTER LOGIC ---\n";
    expr += "try {\n";
    expr += "    if (thisLayer.source) {\n";
    expr += "        var srcAspect = thisLayer.source.width / thisLayer.source.height;\n";
    expr += "        var centerX = thisLayer.source.width / 2;\n";
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
    for (let li = 0; li < selLayers.length; li++) {
      const layer = selLayers[li];
      const effects = layer.property("Effects") as Property;
      if (!effects) continue;

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
      if (!transformFx) continue;
      transformFx.name = "Transform";

      const tfAnchor = transformFx.property("Anchor Point") as Property;
      if (tfAnchor) tfAnchor.setValue(layerAnchor);

      const posProp = transformFx.property("Position") as Property;
      const scaleProp = transformFx.property("Scale") as Property;
      if (posProp) {
        posProp.expression = autoArBuildExpression("position", AUTO_AR_LANDSCAPE, AUTO_AR_PORTRAIT);
        posProp.expressionEnabled = true;
      }
      if (scaleProp) {
        scaleProp.expression = autoArBuildExpression("scale", AUTO_AR_LANDSCAPE, AUTO_AR_PORTRAIT);
        scaleProp.expressionEnabled = true;
      }
    }
    app.endUndoGroup();
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
    if (itz instanceof CompItem && (itz.name === desiredCompName || itz.name === base || (base && itz.name.indexOf(base) !== -1))) return itz;
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
// =============================================================================

export const expressionsBankLoad = (): Result => {
  try {
    const raw = app.settings.getSetting("XYiToolbox", "ExpressionsBank", "");
    let entries: { id: string; name: string; tag: string; code: string; uses: number; description: string }[] = [];
    if (raw && raw.length > 0) {
      const lines = raw.split("\t");
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].length === 0) continue;
        var parts = lines[i].split("|");
        if (parts.length >= 5) {
          // description (parts[5]) is optional -- entries saved before this
          // field existed still load fine, just with an empty description.
          entries.push({ id: parts[0], name: parts[1], tag: parts[2], code: parts[3], uses: parseInt(parts[4]) || 0, description: parts.length >= 6 ? parts[5] : "" });
        }
      }
    }
    return { success: true, message: JSON.stringify(entries) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const expressionsBankSave = (entriesJson: string): Result => {
  try {
    var entries = JSON.parse(entriesJson);
    var lines: string[] = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      lines.push([e.id, e.name, e.tag, e.code, String(e.uses || 0), e.description || ""].join("|"));
    }
    app.settings.saveSetting("XYiToolbox", "ExpressionsBank", lines.join("\t"));
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

        // Check for indexed properties (like mask group, effect group, etc.)
        if (obj.numProperties !== undefined) {
          for (let i = 1; i <= obj.numProperties; i++) {
            try {
              collectProperties(obj.property(i));
            } catch (e) {
              // Skip inaccessible properties
            }
          }
        }

        // Check for named property groups
        if (obj.propertyGroup) {
          try {
            collectProperties(obj.propertyGroup(1));
          } catch (e) {
            // Not a property group
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