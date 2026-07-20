// =============================================================================
// src/jsx/aeft/review.ts -- backend for the Review-category tool (OV
// Library, embedded inside ReviewHub.tsx). Split out of aeft.ts, which is
// now a thin barrel -- see its header comment for context.
// =============================================================================
import { Result, SETTINGS_SECTION, decode } from "./shared";



// =============================================================================
// OV Library -- ported from XYi_OV_Library.jsx
// =============================================================================

interface Campaign {
  name: string;
  mastersRoot: string;
}

interface MasterRecord {
  group: string;
  width: number;
  height: number;
  duration: string;
  suffix: string;
  orientation: string;
  stem: string;
  originalName: string;
  aepPath: string;
}

interface RenderEntry {
  stem: string;
  path: string;
}
const CAMPAIGNS_KEY = "OVLibCampaigns";

export function loadCampaignsRaw(): Campaign[] {
  const out: Campaign[] = [];
  if (app.settings.haveSetting(SETTINGS_SECTION, CAMPAIGNS_KEY)) {
    const raw = app.settings.getSetting(SETTINGS_SECTION, CAMPAIGNS_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length >= 2) out.push({ name: parts[0], mastersRoot: parts[1] });
    }
  }
  return out;
}

function saveCampaignsRaw(arr: Campaign[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const nm = String(arr[i].name).replace(/[\t\n\r]/g, " ");
    const rt = String(arr[i].mastersRoot).replace(/[\t\n\r]/g, " ");
    lines.push(nm + "\t" + rt);
  }
  app.settings.saveSetting(SETTINGS_SECTION, CAMPAIGNS_KEY, lines.join("\n"));
}

export const loadCampaigns = (): Campaign[] => {
  return loadCampaignsRaw();
};

export const saveCampaign = (name: string, mastersRoot: string): Result => {
  try {
    const camps = loadCampaignsRaw();
    for (let i = 0; i < camps.length; i++) {
      if (camps[i].name === name) {
        return { success: false, error: 'A campaign named "' + name + '" already exists.' };
      }
    }
    camps.push({ name: name, mastersRoot: mastersRoot });
    saveCampaignsRaw(camps);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const removeCampaign = (name: string): Result => {
  try {
    const camps = loadCampaignsRaw();
    for (let i = 0; i < camps.length; i++) {
      if (camps[i].name === name) {
        camps.splice(i, 1);
        break;
      }
    }
    saveCampaignsRaw(camps);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const selectMastersFolder = (): string | null => {
  const folder = Folder.selectDialog(
    "Select the campaign's Masters root folder (the one containing AE/ and Renders/):"
  );
  if (!folder) return null;
  return folder.fsName;
};

// --- Custom creative card thumbnails ----------------------------------
// A creative's card preview normally comes from scanRendersForCreative()'s
// "first render found" heuristic (see that function below) -- there's no
// way for a directory scan to know which render is actually the most
// representative one. This lets a user manually pin a specific file
// instead, per campaign + creative (so two campaigns that happen to share
// a creative name, e.g. "HORSE", never leak each other's override).
// Persisted the same way campaigns are (app.settings, same
// SETTINGS_SECTION, tab-separated lines) -- read-only otherwise, this
// never touches anything on disk beyond a file picker dialog.
const THUMB_OVERRIDES_KEY = "OVLibThumbOverrides";

interface ThumbOverride {
  campaign: string;
  creative: string;
  path: string;
}

function loadThumbOverridesRaw(): ThumbOverride[] {
  const out: ThumbOverride[] = [];
  if (app.settings.haveSetting(SETTINGS_SECTION, THUMB_OVERRIDES_KEY)) {
    const raw = app.settings.getSetting(SETTINGS_SECTION, THUMB_OVERRIDES_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length >= 3) out.push({ campaign: parts[0], creative: parts[1], path: parts[2] });
    }
  }
  return out;
}

function saveThumbOverridesRaw(arr: ThumbOverride[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const c = String(arr[i].campaign).replace(/[\t\n\r]/g, " ");
    const cr = String(arr[i].creative).replace(/[\t\n\r]/g, " ");
    const p = String(arr[i].path).replace(/[\t\n\r]/g, " ");
    lines.push(c + "\t" + cr + "\t" + p);
  }
  app.settings.saveSetting(SETTINGS_SECTION, THUMB_OVERRIDES_KEY, lines.join("\n"));
}

// Returns just this campaign's overrides, keyed by creative name -- the
// React side merges this over its auto-detected previews, override wins.
export const loadThumbOverrides = (campaign: string): Record<string, string> => {
  const all = loadThumbOverridesRaw();
  const out: Record<string, string> = {};
  for (let i = 0; i < all.length; i++) {
    if (all[i].campaign === campaign) out[all[i].creative] = all[i].path;
  }
  return out;
};

export const selectCreativeThumbnail = (): string | null => {
  const f = File.openDialog("Select a file to use as this creative's card thumbnail:");
  if (!f) return null;
  return f.fsName;
};

export const setCreativeThumbnailOverride = (campaign: string, creative: string, path: string): Result => {
  try {
    const all = loadThumbOverridesRaw();
    let found = false;
    for (let i = 0; i < all.length; i++) {
      if (all[i].campaign === campaign && all[i].creative === creative) {
        all[i].path = path;
        found = true;
        break;
      }
    }
    if (!found) all.push({ campaign: campaign, creative: creative, path: path });
    saveThumbOverridesRaw(all);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const clearCreativeThumbnailOverride = (campaign: string, creative: string): Result => {
  try {
    const remaining = loadThumbOverridesRaw().filter((o) => !(o.campaign === campaign && o.creative === creative));
    saveThumbOverridesRaw(remaining);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Read-only scanning helpers ---
const VIDEO_EXTS = ["mov", "mp4", "mxf", "avi", "mts", "m4v"];

function isVideoFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = name.substring(dot + 1).toLowerCase();
  for (let i = 0; i < VIDEO_EXTS.length; i++) if (ext === VIDEO_EXTS[i]) return true;
  return false;
}

function findAllFiles(rootFolder: Folder): File[] {
  const out: File[] = [];
  function walk(folder: Folder) {
    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      if (items[i] instanceof Folder) {
        const nm = items[i].name;
        if (nm === "_old" || nm === "_archive" || nm.indexOf("Auto-Save") !== -1) continue;
        walk(items[i] as Folder);
      } else if (items[i] instanceof File) {
        out.push(items[i] as File);
      }
    }
  }
  if (rootFolder.exists) walk(rootFolder);
  return out;
}

function detectOrientation(fileName: string, w: number, h: number): string {
  // An explicit "QUAD" token in the filename is treated as authoritative --
  // consistent with how the studio's existing tooling (Trotting2.jsx's
  // stopword list) already treats QUAD as a named format keyword rather
  // than something derivable from a width/height ratio. Never confirmed
  // against a real QUAD master -- flag if it doesn't catch real examples.
  if (/\bQUAD\b/i.test(fileName)) return "QUAD";
  if (w < h) return "PORTRAIT";
  if (w > h) return "LANDSCAPE";
  return "SQUARE";
}

function parseMasterFilename(fileName: string): MasterRecord | null {
  const nameNoExt = fileName.replace(/\.aep$/i, "");
  const pattern = /^(.*)_(\d+)x(\d+)_(\d+)sec(.*)$/i;
  const m = nameNoExt.match(pattern);
  if (!m) return null;
  const w = parseInt(m[2], 10);
  const h = parseInt(m[3], 10);
  return {
    group: m[1],
    width: w,
    height: h,
    duration: m[4] + "sec",
    suffix: m[5],
    orientation: detectOrientation(fileName, w, h),
    stem: nameNoExt,
    originalName: fileName,
    aepPath: "",
  };
}

export const scanCreatives = (mastersRoot: string): string[] => {
  const out: string[] = [];
  const aeFolder = new Folder(mastersRoot + "/AE");
  if (!aeFolder.exists) return out;
  const items = aeFolder.getFiles();
  for (let i = 0; i < items.length; i++) {
    if (items[i] instanceof Folder && items[i].name.charAt(0) !== "_") {
      out.push(decode(items[i].name));
    }
  }
  out.sort();
  return out;
};

export const scanMastersForCreative = (mastersRoot: string, creative: string): MasterRecord[] => {
  const creativeFolder = new Folder(mastersRoot + "/AE/" + creative);
  const allFiles = findAllFiles(creativeFolder);
  const records: MasterRecord[] = [];
  for (let i = 0; i < allFiles.length; i++) {
    if (allFiles[i].name.slice(-4).toLowerCase() !== ".aep") continue;
    const parsed = parseMasterFilename(allFiles[i].name);
    if (parsed) {
      parsed.aepPath = allFiles[i].fsName;
      records.push(parsed);
    }
  }
  records.sort((a, b) => {
    if (a.width !== b.width) return a.width - b.width;
    if (a.height !== b.height) return a.height - b.height;
    if (a.duration < b.duration) return -1;
    if (a.duration > b.duration) return 1;
    return 0;
  });
  return records;
};

// Case-insensitive child-folder lookup -- studio folder names occasionally
// vary in case ("Support" vs "support"), so match by name rather than
// constructing an exact path and hoping the case is right.
function findChildFolderCI(parent: Folder, name: string): Folder | null {
  if (!parent || !parent.exists) return null;
  const lower = name.toLowerCase();
  const items = parent.getFiles();
  for (let i = 0; i < items.length; i++) {
    if (items[i] instanceof Folder && items[i].name.toLowerCase() === lower) return items[i] as Folder;
  }
  return null;
}

// The campaign's preview-mp4 folder: <mastersRoot>/Support/Motion_Components/_mp4.
// A newer studio layout keeps lightweight web-playable preview mp4s here
// (a flat, campaign-wide folder -- NOT per-creative like Renders/<Creative>),
// alongside the masters rather than in the Renders tree. Returns null (not an
// error) when the campaign doesn't use this layout.
function findMotionComponentsMp4Folder(mastersRoot: string): Folder | null {
  const support = findChildFolderCI(new Folder(mastersRoot), "Support");
  if (!support) return null;
  const mc = findChildFolderCI(support, "Motion_Components");
  if (!mc) return null;
  return findChildFolderCI(mc, "_mp4");
}

// Returns a flat list of stem -> fsName preview-video pairs for a creative so
// main.tsx can build its own lookup map. Two sources, merged:
//   1. The mirrored Renders/<Creative> tree (the original layout).
//   2. <mastersRoot>/Support/Motion_Components/_mp4 -- the newer flat,
//      campaign-wide preview-mp4 folder. Because that folder is NOT scoped
//      per creative, each mp4 is only included if its filename stem matches
//      one of THIS creative's own master .aep stems -- otherwise another
//      creative's mp4 could leak into this card's preview (pickPreviewRender
//      on the React side just takes the best-extension entry, it doesn't
//      re-check the stem).
// The stem <-> master pairing (identical filename stem, extension aside) is
// the same convention Renders uses and is UNVERIFIED against real preview-mp4
// filenames -- see CLAUDE.md; if previews don't appear, check the mp4 naming
// matches the master stem first.
export const scanRendersForCreative = (mastersRoot: string, creative: string): RenderEntry[] => {
  const out: RenderEntry[] = [];
  const seen: { [path: string]: boolean } = {};

  const pushVideos = function (files: File[], stemFilter: { [stem: string]: boolean } | null) {
    for (let i = 0; i < files.length; i++) {
      const fName = files[i].name;
      if (!isVideoFile(fName)) continue;
      const dot = fName.lastIndexOf(".");
      const fStem = dot === -1 ? fName : fName.substring(0, dot);
      if (stemFilter && !stemFilter[fStem.toLowerCase()]) continue;
      const path = files[i].fsName;
      if (seen[path]) continue;
      seen[path] = true;
      out.push({ stem: fStem, path: path });
    }
  };

  // 1. Renders/<Creative> (original layout) -- no stem filter, already scoped.
  const rendersFolder = new Folder(mastersRoot + "/Renders/" + creative);
  if (rendersFolder.exists) pushVideos(findAllFiles(rendersFolder), null);

  // 2. Support/Motion_Components/_mp4 (newer flat layout) -- filter to this
  // creative's own master stems.
  const mp4Folder = findMotionComponentsMp4Folder(mastersRoot);
  if (mp4Folder && mp4Folder.exists) {
    const masters = scanMastersForCreative(mastersRoot, creative);
    const stems: { [stem: string]: boolean } = {};
    for (let i = 0; i < masters.length; i++) stems[masters[i].stem.toLowerCase()] = true;
    pushVideos(findAllFiles(mp4Folder), stems);
  }

  return out;
};

// --- File actions -- import only, never open; reveal/play never touch the
// source file's contents. ---
export const importFile = (filePath: string): Result => {
  const f = new File(filePath);
  if (!f.exists) return { success: false, error: "File no longer exists:\n" + filePath };
  try {
    app.project.importFile(new ImportOptions(f));
    return { success: true };
  } catch (impErr) {
    return { success: false, error: impErr.toString() };
  }
};

export const revealFile = (filePath: string): Result => {
  const f = new File(filePath);
  if (!f.exists) return { success: false, error: "File no longer exists:\n" + filePath };
  const p = f.parent.fsName;
  if ($.os.indexOf("Windows") !== -1) {
    system.callSystem('explorer "' + p + '"');
  } else {
    system.callSystem('open "' + p + '"');
  }
  return { success: true };
};

export const playFile = (filePath: string): Result => {
  const f = new File(filePath);
  if (!f.exists) return { success: false, error: "File no longer exists:\n" + filePath };
  if ($.os.indexOf("Windows") !== -1) {
    system.callSystem('start "" "' + filePath + '"');
  } else {
    system.callSystem('open "' + filePath + '"');
  }
  return { success: true };
};

// Scales `layer` uniformly (contain-fit, preserving aspect ratio) to sit
// inside a boxWidth x boxHeight box centered at (centerX, centerY) --
// shared by createComparisonComp() below for placing the OV render and the
// user's own selected localised render side by side, each confined to its
// own half of the comparison comp regardless of the two renders' actual
// (and not necessarily identical) source dimensions.
function fitLayerIntoBox(layer: AVLayer, boxWidth: number, boxHeight: number, centerX: number, centerY: number) {
  const src = layer.source;
  const srcW = src ? src.width : boxWidth;
  const srcH = src ? src.height : boxHeight;
  const scale = Math.min(boxWidth / srcW, boxHeight / srcH) * 100;
  (layer.property("Transform")!.property("Scale") as Property).setValue([scale, scale, scale]);
  (layer.property("Transform")!.property("Position") as Property).setValue([centerX, centerY]);
}

// Ported at the user's request, not from the original ScriptUI toolbox --
// a quick side-by-side visual QC comp: OV render (this variant's own
// render file, imported read-only, same as every other render/master
// import in this tool) on the left, whatever the user currently has
// selected in the Project panel (their own localised render/comp) on the
// right, in a new comp double the OV render's width. Read-only on the OV
// side (importFile only, never opens/edits the render or any master); the
// user's own selected item is only ever ADDED as a layer, never modified.
export const createComparisonComp = (renderPath: string, width: number, height: number): Result => {
  try {
    if (app.project.selection.length !== 1) {
      return { success: false, error: "Select exactly one item (your localised render or comp) in the Project panel first." };
    }
    const selectedItem = app.project.selection[0];
    // NOT `instanceof AVItem` -- that's the only place in this whole file
    // that pattern was tried, and unlike CompItem/FootageItem (used safely
    // in 20+ other checks here), AVItem is likely only a TypeScript ambient
    // type from Types-for-Adobe, not a real ExtendScript runtime
    // constructor -- `instanceof AVItem` throwing a ReferenceError here,
    // BEFORE this function's own try/catch even started, is almost
    // certainly what made a real thrown exception look like "no CEP
    // bridge" in the UI the first time this ran for real. CompItem/
    // FootageItem cover every concrete type a Project panel selection can
    // actually be (besides a FolderItem, which this correctly still rejects).
    if (!(selectedItem instanceof CompItem) && !(selectedItem instanceof FootageItem)) {
      return { success: false, error: "The selected item isn't a footage item or composition." };
    }

    const f = new File(renderPath);
    if (!f.exists) return { success: false, error: "Render file no longer exists:\n" + renderPath };

    app.beginUndoGroup("OV Library: Create Comparison Comp");

    let ovFootage: AVItem;
    try {
      ovFootage = app.project.importFile(new ImportOptions(f)) as AVItem;
    } catch (impErr) {
      app.endUndoGroup();
      return { success: false, error: "Could not import render: " + impErr.toString() };
    }

    const compWidth = width * 2;
    const compHeight = height;
    const frameRate = ovFootage.frameRate > 0 ? ovFootage.frameRate : 25;
    const duration = Math.max(ovFootage.duration || 0, selectedItem.duration || 0) || 10;
    const compName = "Compare_" + f.name.replace(/\.[^.]+$/, "");

    const comp = app.project.items.addComp(compName, compWidth, compHeight, 1, duration, frameRate);

    // Right half: the user's own selected localised render/comp.
    const rightLayer = comp.layers.add(selectedItem);
    fitLayerIntoBox(rightLayer, width, height, width + width / 2, height / 2);

    // Left half: the freshly-imported OV render.
    const leftLayer = comp.layers.add(ovFootage);
    fitLayerIntoBox(leftLayer, width, height, width / 2, height / 2);

    comp.openInViewer();
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};