// =============================================================================
// src/jsx/aeft/aeft.ts
// -----------------------------------------------------------------------------
// ExtendScript backend for the XYi Toolbox CEP panel. One section per ported
// tool, each ported 1:1 from its original standalone XYi_*.jsx in toolset/.
// Every function here is called from a tool's React view via
// evalTS("functionName", ...args).
//
// READ-ONLY / IMPORT-ONLY BY DESIGN where a tool touches a master .aep --
// see CLAUDE.md's "Non-negotiable safety constraint":
//   - Scanning only ever lists folder contents (Folder.getFiles()). Nothing
//     is opened or written during a scan.
//   - Masters are brought in via app.project.importFile(), which only reads
//     the source file -- there is no app.open() anywhere for a master, and
//     deliberately no "open" action is exported for one.
//   - Renders can be played via the OS's default video player (read-only)
//     or imported as footage the same read-only way.
//
// Every function that can fail across the CEP bridge returns a defensive
// {success, error} shape rather than throwing, per CLAUDE.md's ExtendScript
// style convention.
// =============================================================================

// =============================================================================
// ES5 Array polyfills -- ExtendScript's JS engine is missing several
// Array.prototype methods everywhere else takes for granted (indexOf,
// filter, map), even though String.prototype.indexOf and Array.prototype.sort
// have always been there. This is a well-known, long-documented ExtendScript
// gotcha, not a bug in the logic below -- it surfaced as a real
// "Function X.indexOf is undefined" error the first time this code actually
// ran inside After Effects. Browser preview mode NEVER executes ExtendScript
// at all (see CLAUDE.md's Testing section, mock-data fallback) -- it only
// exercises the React side -- so this whole class of bug is invisible until
// tested for real in AE, no matter how much preview testing is done first.
// Guarded by a feature check so this is a harmless no-op on any engine that
// already has the real method (don't remove this "just in case AE has it by
// now" without actually testing in the real app -- that's exactly the
// assumption that let this ship broken the first time).
// =============================================================================
if (!Array.prototype.indexOf) {
  Array.prototype.indexOf = function (searchElement: unknown, fromIndex?: number): number {
    const len = this.length;
    let start = fromIndex || 0;
    if (start < 0) start = Math.max(0, len + start);
    for (let i = start; i < len; i++) {
      if (this[i] === searchElement) return i;
    }
    return -1;
  };
}

if (!Array.prototype.filter) {
  Array.prototype.filter = function (callback: (value: unknown, index: number, arr: unknown[]) => boolean, thisArg?: unknown): unknown[] {
    const result: unknown[] = [];
    for (let i = 0; i < this.length; i++) {
      if (i in this && callback.call(thisArg, this[i], i, this)) result.push(this[i]);
    }
    return result;
  };
}

if (!Array.prototype.map) {
  // Cast to `any`, not typed to match lib.es5.d.ts's generic <U> signature
  // for Array.prototype.map -- this polyfill only needs to be correct JS at
  // runtime (the ES3 ExtendScript engine that's actually missing this
  // method has no type checker), and a hand-written generic here fights
  // TypeScript's own built-in declaration under any tsconfig that also
  // happens to include real DOM/ES5 lib types (e.g. if this file is ever
  // type-checked under the frontend's tsconfig.json instead of the
  // ExtendScript-specific tsconfig-build.json).
  (Array.prototype as any).map = function (callback: (value: unknown, index: number, arr: unknown[]) => unknown, thisArg?: unknown): unknown[] {
    const result: unknown[] = [];
    for (let i = 0; i < this.length; i++) {
      if (i in this) result[i] = callback.call(thisArg, this[i], i, this);
    }
    return result;
  };
}

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

interface Result {
  success: boolean;
  error?: string;
}

// --- Persistence (campaigns only -- nothing else needs to be saved, since
// this entire library is derived live from disk). Same app.settings section
// and key as XYi_OV_Library.jsx, so campaigns set up in either tool show up
// in the other automatically. ---
const SETTINGS_SECTION = "XYiToolbox";
const CAMPAIGNS_KEY = "OVLibCampaigns";

function decode(str: string): string {
  try {
    return decodeURI(str);
  } catch (e) {
    return str;
  }
}

function loadCampaignsRaw(): Campaign[] {
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

// Scans the mirrored Renders/<Creative> tree once, returning a flat list of
// stem -> fsName pairs so main.tsx can build its own lookup map. This
// render <-> master pairing (identical filename stem) is UNVERIFIED against
// a real render filename -- see CLAUDE.md.
export const scanRendersForCreative = (mastersRoot: string, creative: string): RenderEntry[] => {
  const rendersFolder = new Folder(mastersRoot + "/Renders/" + creative);
  const out: RenderEntry[] = [];
  if (!rendersFolder.exists) return out;
  const allFiles = findAllFiles(rendersFolder);
  for (let i = 0; i < allFiles.length; i++) {
    const fName = allFiles[i].name;
    if (!isVideoFile(fName)) continue;
    const dot = fName.lastIndexOf(".");
    const fStem = dot === -1 ? fName : fName.substring(0, dot);
    out.push({ stem: fStem, path: allFiles[i].fsName });
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
    for (let i = 1; i <= proj.numItems; i++) {
      const item = proj.item(i);
      if (item instanceof CompItem) {
        const m = item.name.match(TURK_IT_VERSION_REGEX);
        if (m) {
          const current = parseInt(m[1], 10);
          const next = direction === "up" ? current + 1 : current - 1;
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
    return { success: true };
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

    // Repeated 10x, matching the original -- a single pass can miss items
    // whose folder just got created/moved this same pass.
    for (let pass = 1; pass <= 10; pass++) {
      for (let i = 1; i <= app.project.numItems; i++) {
        const item = app.project.item(i);
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
    }

    // PNG stills get their own pass -- either explicitly labelled (11) or
    // named with a .png extension.
    for (let pass = 1; pass <= 5; pass++) {
      for (let i = 1; i <= app.project.numItems; i++) {
        const item = app.project.item(i);
        const source = item instanceof FootageItem ? item.mainSource : null;
        const isPngByExt = item.name.slice(-3).toLowerCase() === "png";
        if (source instanceof FileSource && source.isStill && (item.label === 11 || isPngByExt)) {
          item.parentFolder = png!;
        }
      }
    }

    for (let i = 1; i <= app.project.numItems; i++) {
      const item = app.project.item(i);
      if (item instanceof FolderItem && (item.name === "Composition" || item.name === "Footage")) {
        item.parentFolder = app.project.rootFolder;
      }
    }

    // Remove whatever folders ended up empty, repeated 10x for the same
    // reason as above.
    for (let pass = 1; pass <= 10; pass++) {
      for (let i = 1; i <= app.project.numItems; i++) {
        const item = app.project.item(i);
        if (item instanceof FolderItem && item.numItems === 0) {
          item.remove();
        }
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

function parseFilenameMeta(name: string): FilenameMeta {
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

const TC_COUNTRIES: { name: string; code: string }[] = [
  { name: "Afghanistan", code: "AF" }, { name: "Åland Islands", code: "AX" }, { name: "Albania", code: "AL" },
  { name: "Algeria", code: "DZ" }, { name: "American Samoa", code: "AS" }, { name: "Andorra", code: "AD" },
  { name: "Angola", code: "AO" }, { name: "Anguilla", code: "AI" }, { name: "Antarctica", code: "AQ" },
  { name: "Antigua and Barbuda", code: "AG" }, { name: "Argentina", code: "AR" }, { name: "Armenia", code: "AM" },
  { name: "Aruba", code: "AW" }, { name: "Australia", code: "AU" }, { name: "Austria", code: "AT" },
  { name: "Azerbaijan", code: "AZ" }, { name: "Bahamas", code: "BS" }, { name: "Bahrain", code: "BH" },
  { name: "Bangladesh", code: "BD" }, { name: "Barbados", code: "BB" }, { name: "Belarus", code: "BY" },
  { name: "Belgium", code: "BE" }, { name: "Belize", code: "BZ" }, { name: "Benin", code: "BJ" },
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
  { name: "Kuwait", code: "KW" }, { name: "Kyrgyzstan", code: "KG" }, { name: "Lao People's Democratic Republic", code: "LA" },
  { name: "Latvia", code: "LV" }, { name: "Lebanon", code: "LB" }, { name: "Lesotho", code: "LS" },
  { name: "Liberia", code: "LR" }, { name: "Libya", code: "LY" }, { name: "Liechtenstein", code: "LI" },
  { name: "Lithuania", code: "LT" }, { name: "Luxembourg", code: "LU" }, { name: "Macao", code: "MO" },
  { name: "Madagascar", code: "MG" }, { name: "Malawi", code: "MW" }, { name: "Malaysia", code: "MY" },
  { name: "Maldives", code: "MV" }, { name: "Mali", code: "ML" }, { name: "Malta", code: "MT" },
  { name: "Marshall Islands", code: "MH" }, { name: "Master OV", code: "OV" }, { name: "Martinique", code: "MQ" },
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
  { name: "Switzerland", code: "CH" }, { name: "Syrian Arab Republic", code: "SY" }, { name: "Taiwan", code: "TW" },
  { name: "Tajikistan", code: "TJ" }, { name: "Tanzania, United Republic of", code: "TZ" }, { name: "Thailand", code: "TH" },
  { name: "Timor-Leste", code: "TL" }, { name: "Togo", code: "TG" }, { name: "Tokelau", code: "TK" },
  { name: "Tonga", code: "TO" }, { name: "Trinidad and Tobago", code: "TT" }, { name: "Tunisia", code: "TN" },
  { name: "Turkey", code: "TR" }, { name: "Turkmenistan", code: "TM" }, { name: "Turks and Caicos Islands", code: "TC" },
  { name: "Tuvalu", code: "TV" }, { name: "Uganda", code: "UG" }, { name: "Ukraine", code: "UA" },
  { name: "United Arab Emirates", code: "AE" }, { name: "United Kingdom", code: "GB/UK" }, { name: "United States of America", code: "US" },
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
// Shared scale-to-fit helper, ported from XYi_Scaler.jsx's onScaleClick()
// (the "whole comp" branch only -- n!=1, i.e. resize the active comp
// itself, not a single layer's source). Uses a temporary null-parent layer
// so every layer -- including cameras, via their zoom -- scales together,
// then removes the null. Shared by DRQR; Scale Fit/Scale Composition can
// reuse this too once ported.
// =============================================================================
function makeParentLayerOfAllUnparented(comp: CompItem, newParent: Layer) {
  for (let i = 1; i <= comp.numLayers; i++) {
    const cur = comp.layer(i);
    if (cur !== newParent && cur.parent === null) {
      cur.parent = newParent;
    }
  }
}

function scaleAllCameraZooms(comp: CompItem, scaleBy: number) {
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

function scaleCompToFit(comp: CompItem, newWidth: number, newHeight: number) {
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
function drqrProcessLayers(comp: CompItem, newWidth: number, newHeight: number) {
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
// Batch-replaces PNG footage across a folder of .aep files: for each AEP,
// finds its Footage/PNG folder and replaces each PNG footage item with the
// best-scoring match (resolution + PNG-number token match, then Jaccard/
// Levenshtein-hybrid filename similarity) from a second folder of PNGs,
// then saves each project IN PLACE.
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

function mcItJaccard(inputA: string, inputB: string): number {
  const JACCARD_WEIGHT = 0.7;
  const LEVENSHTEIN_WEIGHT = 0.3;

  const tokenize = (filename: string): string[] => {
    let cleanName = String(filename).replace(/\.png|_V\d+/gi, "");
    cleanName = cleanName.replace(/([a-z])([A-Z])/g, "$1 $2");
    const tokens = cleanName.toLowerCase().split(/[_\-\s]+/);
    const stopWords = ["dgtl", "digital", "master", "ov", "en", "the", "dooh", "dinth", "dfoh"];
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token && stopWords.indexOf(token) === -1 && !/^\d+x\d+$/.test(token) && !/^\d+$/.test(token)) {
        out.push(token);
      }
    }
    return out;
  };

  const levenshteinDistance = (s: string, t: string): number => {
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    const arr: number[][] = [];
    for (let i = 0; i <= t.length; i++) {
      arr[i] = [i];
      for (let j = 1; j <= s.length; j++) {
        arr[i][j] = i === 0 ? j : Math.min(arr[i - 1][j] + 1, arr[i][j - 1] + 1, arr[i - 1][j - 1] + (s[j - 1] === t[i - 1] ? 0 : 1));
      }
    }
    return arr[t.length][s.length];
  };

  const tokensA = tokenize(String(inputA || ""));
  const tokensB = tokenize(String(inputB || ""));
  if (!tokensA.length && !tokensB.length) return 0;

  const setA: Record<string, boolean> = {};
  for (let i = 0; i < tokensA.length; i++) setA[tokensA[i]] = true;
  const setB: Record<string, boolean> = {};
  for (let j = 0; j < tokensB.length; j++) setB[tokensB[j]] = true;

  let intersection = 0;
  let union = 0;
  for (const k in setA) {
    if (setA.hasOwnProperty(k)) {
      union++;
      if (setB[k]) intersection++;
    }
  }
  for (const k in setB) {
    if (setB.hasOwnProperty(k) && !setA[k]) union++;
  }

  const jaccardScore = union === 0 ? 0 : intersection / union;
  const cleanStrA = tokensA.join(" ");
  const cleanStrB = tokensB.join(" ");
  const maxLen = Math.max(cleanStrA.length, cleanStrB.length);
  if (maxLen === 0) return jaccardScore;

  const levenshteinScore = 1 - levenshteinDistance(cleanStrA, cleanStrB) / maxLen;
  return jaccardScore * JACCARD_WEIGHT + levenshteinScore * LEVENSHTEIN_WEIGHT;
}

function mcItGetAllPngFiles(folder: Folder): File[] {
  const out: File[] = [];
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item instanceof Folder) {
      out.push(...mcItGetAllPngFiles(item));
    } else if (item instanceof File && /\.png$/i.test(item.name)) {
      out.push(item);
    }
  }
  return out;
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

    const pngRootFolder = Folder.selectDialog("Select a folder containing PNG files (search includes subfolders)");
    if (!pngRootFolder) return { success: false, error: "No PNG folder selected." };
    const pngFiles = mcItGetAllPngFiles(pngRootFolder);
    if (pngFiles.length === 0) return { success: false, error: "No PNG files found in that folder." };

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

      let pngFolderInProject: FolderItem | null = null;
      for (let i = 1; i <= footageFolder.numItems; i++) {
        const item = footageFolder.item(i);
        if (item instanceof FolderItem && item.name === "PNG") {
          pngFolderInProject = item;
          break;
        }
      }
      if (!pngFolderInProject) continue;

      for (let j = 1; j <= pngFolderInProject.numItems; j++) {
        const footageItem = pngFolderInProject.item(j) as FootageItem;
        if (footageItem.file && /\.png$/i.test(footageItem.file.name)) {
          const originalName = footageItem.file.name;
          const parsedOriginal = mcItParseFilename(originalName);

          let bestFile: File | null = null;
          let bestScore = -1;

          for (let k = 0; k < pngFiles.length; k++) {
            const candidate = pngFiles[k];
            const parsedCandidate = mcItParseFilename(candidate.name);
            if (parsedAEP.thirdOne === parsedCandidate.thirdOne && parsedOriginal.pngNumber === parsedCandidate.pngNumber) {
              const score = mcItJaccard(originalName, candidate.name);
              if (score > bestScore) {
                bestScore = score;
                bestFile = candidate;
              }
            }
          }

          if (bestFile) {
            footageItem.replace(bestFile);
            replacedCount++;
          }
        }
      }

      proj.save();
      processedCount++;
    }

    return {
      success: true,
      message: `Processed ${processedCount} project(s), replaced ${replacedCount} PNG(s). Files were updated and saved in place.`,
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
function scanMastersForBestMatch(mastersRoot: string, campaign: string, size: string, duration: string): File | null {
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

interface CampaignLocaliserResult {
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
// AEP Thief -- ported from toolset/XYi_Copy_AEP.jsx, part of the Campaign
// Localiser tab. Pure filesystem copy (recursive, skips existing, logs to
// two CSVs) -- no AE project touched, no master ever opened.
// =============================================================================
export const copyAep = (): CampaignLocaliserResult => {
  try {
    const sourceFolder = Folder.selectDialog("Select the source folder");
    if (!sourceFolder) return { success: false, error: "No source folder selected." };
    const destinationFolder = Folder.selectDialog("Select the destination folder");
    if (!destinationFolder) return { success: false, error: "No destination folder selected." };

    const copiedFiles: string[] = [];
    const skippedFiles: string[] = [];

    const copyAepFiles = (src: Folder, dest: Folder) => {
      const files = src.getFiles();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file instanceof File && file.name.toLowerCase().indexOf(".aep") !== -1) {
          const newFile = new File(dest.fsName + "/" + file.name);
          if (!newFile.exists) {
            file.copy(newFile.fsName);
            if (newFile.exists) copiedFiles.push(file.name);
            else skippedFiles.push(file.name);
          } else {
            skippedFiles.push(file.name);
          }
        } else if (file instanceof Folder) {
          if (!/auto-save|_archive|_old/i.test(file.name)) {
            copyAepFiles(file, dest);
          }
        }
      }
    };

    copyAepFiles(sourceFolder, destinationFolder);

    const exportToFile = (fileName: string, data: string[]) => {
      const csvFile = new File(fileName);
      if (csvFile.open("w")) {
        csvFile.write(data.join("\r\n"));
        csvFile.close();
      }
    };
    exportToFile(destinationFolder.fsName + "/Copied_Files.csv", copiedFiles);
    exportToFile(destinationFolder.fsName + "/Skipped_Files.csv", skippedFiles);

    return { success: true, message: `Copied ${copiedFiles.length} file(s), skipped ${skippedFiles.length}.` };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Trotting Along / Trotting Along 2.0 / PDF to CSV -- ported from Campaign
// Localiser's "Trotting Along" section (XYi_Campaign_Trotter.jsx,
// XYi_Campaign_Trotting2.jsx) and the CSV-export sibling
// (XYi_PDF_to_CSV.jsx). All three walk a folder of client-supplied PDFs
// sitting in a "PDFs" folder somewhere under a territory root, matching
// each PDF to the best master by filename, and mirror the PDFs folder's
// relative path into a sibling "AE" folder for output -- e.g.
// ".../France/PDFs/Teasers/foo.pdf" -> ".../France/AE/Teasers/foo_V01.aep".
//
// Trotting Along and Trotting Along 2.0 both directly `app.open()` the
// matched master (no copy-first) -- this is the SAME confirmed, deliberate
// exception Campaign Localiser's "Generate Files" already has: the result
// is always saved to a brand-new `_V01.aep` file under the derived AE
// folder, never back to the master's own path, and the project is closed
// with DO_NOT_SAVE_CHANGES immediately after. Same safety reasoning
// applies here -- see Campaign Localiser's own comment for the fuller
// explanation. PDF to CSV never opens any project at all (just scans
// filenames and writes a CSV), so it carries no master-file risk.
// =============================================================================

// Shared by all three -- identical in every one of the three original
// files (not a meaningful behavioral fork), so ported once.
function trotFindTerrFolder(folder: Folder): string {
  if (folder.name === "PDFs") return folder.parent ? folder.parent.name : "Master OV";
  if (folder.parent !== null) return trotFindTerrFolder(folder.parent);
  return "Master OV";
}

function trotFindPDFsFolder(startFolder: Folder): string {
  let currentFolder: Folder | null = startFolder;
  let aeFolderPath = "";
  let relativePath = "";
  while (currentFolder !== null) {
    if (currentFolder.name === "PDFs") {
      const parentFolder = currentFolder.parent;
      aeFolderPath = (parentFolder ? parentFolder.fsName : "") + "/AE" + relativePath;
      break;
    }
    relativePath = "/" + currentFolder.name + relativePath;
    currentFolder = currentFolder.parent;
  }
  return aeFolderPath;
}

// PDF to CSV's OWN findPDFsFolder -- NOT identical to trotFindPDFsFolder
// above despite looking it at a glance. XYi_PDF_to_CSV.jsx's copy has an
// extra fallback (save alongside the PDFs folder itself if no "PDFs"
// ancestor is found) that neither XYi_Campaign_Trotter.jsx nor
// XYi_Campaign_Trotting2.jsx has. Caught by diffing the three original
// files directly rather than assuming three near-identical-looking
// functions were the same -- kept as its own function rather than folded
// into trotFindPDFsFolder to preserve that real behavioral difference.
function pdfCsvFindPDFsFolder(startFolder: Folder): string {
  const aeFolderPath = trotFindPDFsFolder(startFolder);
  return aeFolderPath === "" ? startFolder.fsName : aeFolderPath;
}

function trotCreateFolderStructure(folderPath: string): void {
  const folder = new Folder(folderPath);
  if (!folder.exists) {
    const parentFolder = folder.parent;
    if (parentFolder && !parentFolder.exists) trotCreateFolderStructure(parentFolder.fsName);
    folder.create();
  }
}

// Ported 1:1 from XYi_Campaign_Trotter.jsx's gimme() -- a simpler,
// non-Jaccard filename tokenizer specific to Trotting Along (v1). Distinct
// from Trotting Along 2.0's Jaccard-based gimme(), which is its own
// separate function below -- the two tools genuinely use different
// matching strategies in the original, not the same logic twice.
function trotGimmeV1(filename: string): [string, string] {
  const resolutionRegex = /\d+x\d+px?/i;
  let secondOne = "";
  if (filename.indexOf("DOOH") !== -1) secondOne = "DOOH";
  else if (filename.indexOf("DINTH") !== -1) secondOne = "DINTH";
  else if (filename.indexOf("DFOH") !== -1) secondOne = "DFOH";

  const parts = filename.split("_");
  const tokens = parts.filter((p) => p.length > 0);

  const validTokens: string[] = [];
  for (let j = 0; j < tokens.length; j++) {
    if (resolutionRegex.test(tokens[j])) break;
    validTokens.push(tokens[j]);
  }
  if (validTokens.length > 0) validTokens.shift();

  const finalTokens = validTokens.filter((t) => t !== secondOne);
  if (finalTokens.length > 1 && /^[A-Z]{2,4}$/.test(finalTokens[0])) finalTokens.shift();
  if (finalTokens.length > 1 && /^[A-Z]{2}$/.test(finalTokens[finalTokens.length - 1])) finalTokens.pop();

  const firstOne = finalTokens.join("_").toUpperCase();
  return [firstOne, secondOne];
}

// Shared nameGen() logic across Trotting Along / Trotting Along 2.0 --
// duplicate the matched master comp, rescale via the same null-parent
// technique as DRQR/Scale Composition/CSV Localiser, propagate into every
// V## comp under "Main", auto-run Cheeky DT Check + DRQR, then save to the
// derived AE folder path and close. The only difference between v1 and
// v2's own nameGen() in the originals is v1 removes the ORIGINAL comp by
// matching its name after the fact, v2 removes `myComp` directly if it
// still exists -- both ported exactly as their own file has it.
function trotNameGen(myComp: CompItem, width: number, height: number, newCompName: string, plm: "PORTRAIT" | "LANDSCAPE", pdfFile: File, removeByName: boolean): void {
  const scanRegV = /V\d\d/;
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

  if (removeByName) {
    for (let i = 1; i <= app.project.numItems; i++) {
      const item = app.project.item(i);
      if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && item.name === myName) {
        item.remove();
      }
    }
  } else if (myComp) {
    myComp.remove();
  }

  const aeFolderPath = trotFindPDFsFolder(pdfFile.parent);
  trotCreateFolderStructure(aeFolderPath);
  const myNewFile = new File(aeFolderPath + "/" + newCompName + "_V01.aep");
  app.project.save(myNewFile);
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  app.newProject();
}

// Ported 1:1 from XYi_Campaign_Trotter.jsx's campLoc(). **`sartre` from
// the original's 7-arg signature is dropped here -- confirmed dead in the
// original body (never referenced anywhere inside campLoc()), and there's
// no corresponding UI control for it either (TroAlo() just hardcodes
// `sartre = true` before calling in), so there's nothing for a param to
// carry.** TroDur/TroArt/TroArtOn/TroCamp/TroCampOn are all real and used.
// Matches the original exactly: TroAlo() prompts for the Master/loc folder
// FIRST, then calls campLoc(), which prompts a SECOND time for the PDF
// folder -- both dialogs happen inside this one function/button click,
// not a masters-path param collected ahead of time in React.
export const campaignLocaliserTrott = (troDur: string, troArt: string, troArtOn: boolean, troCamp: string, troCampOn: boolean): Result => {
  const mastersPathFolder = Folder.selectDialog("Please select the Master / loc folder to scan");
  if (!mastersPathFolder) return { success: true };
  const mastersPath = mastersPathFolder.fsName;

  const folder = Folder.selectDialog("Select a folder containing PDF files");
  if (folder === null) {
    alert("No folder selected");
    return { success: true };
  }

  const pdfFiles = (folder.getFiles("*.pdf") as File[]) || [];
  let count = 0;
  const scanTerritory = getTerritoryCountryCode(trotFindTerrFolder(folder)) || "XX";
  const regex = /\d*[x]\d*/;

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    if (!(pdfFile instanceof File) || !pdfFile.name.match(/\.pdf$/i)) continue;
    count++;

    try {
      const fileName = pdfFile.name;
      let artworkType = troArt;
      if (troArtOn) artworkType = trotGimmeV1(fileName)[1];

      let funcCampaign = troCamp;
      if (troCampOn) funcCampaign = trotGimmeV1(fileName)[0];

      const sizeParts = String(fileName.match(regex)).split("x");
      const width = Math.floor(Number(sizeParts[0]));
      const height = Math.floor(Number(sizeParts[1]));
      const size = String(width) + "x" + String(height);
      const funcDuration = troDur;

      const pl: "PORTRAIT" | "LANDSCAPE" = width < height ? "PORTRAIT" : "LANDSCAPE";
      const duration = funcDuration + "sec";

      const bestMatch = scanMastersForBestMatch(mastersPath, funcCampaign, size, duration);
      if (!bestMatch) continue;
      const textMaster = bestMatch.fsName;

      const linesMaster = textMaster.split("/");
      let masterName = linesMaster[linesMaster.length - 1];
      const ratioPattern = /^_(\d+\.\d+)_/;
      if (ratioPattern.test(masterName)) masterName = masterName.split(ratioPattern)[2];

      const masterSizeMatch = String(masterName.match(regex));
      const masterSizeParts = masterSizeMatch.split("x");
      const masterWidth = Math.floor(Number(masterSizeParts[0]));
      const masterHeight = Math.floor(Number(masterSizeParts[1]));
      const plm: "PORTRAIT" | "LANDSCAPE" = masterWidth < masterHeight ? "PORTRAIT" : "LANDSCAPE";

      const scanFilmTitle = masterName.split("_")[0];
      const scanIndo = masterName.split("_")[1];

      const newCompName = scanFilmTitle + "_" + scanIndo + "_DGTL_" + artworkType + "_" + funcCampaign + "_" + width + "x" + height + "_" + duration + "_" + scanTerritory;

      const aeFolder = trotFindPDFsFolder(pdfFile.parent);
      const outputFile = new File(aeFolder + "/" + newCompName + "_V01.aep");
      if (outputFile.exists) {
        alert(newCompName + ".aep already exists. Skipping.");
        continue;
      }

      const fileToOpen = new File(textMaster);
      if (!fileToOpen.exists) {
        alert("Master file not found: " + textMaster);
        continue;
      }

      const proj = app.open(fileToOpen);
      let myComp: CompItem | null = null;
      const masterStem = masterName.split(".")[0].replace(/_V\d+$/, "");
      for (let j = 1; j <= proj.numItems; j++) {
        const item = proj.item(j);
        if (item instanceof CompItem && item.name === masterStem) myComp = item;
      }
      if (!myComp) continue;

      trotNameGen(myComp, width, height, newCompName, plm, pdfFile, true);
    } catch (err) {
      alert("Row failed: " + err.toString());
    }
  }

  alert("Total PDF files processed: " + count);
  return { success: true };
};

// Ported 1:1 from XYi_Campaign_Trotting2.jsx's campLoc()/gimme()/jaccard().
// **TroDur/TroArt/TroArtOn/TroCamp/TroCampOn are accepted but never used**
// -- confirmed dead in the original body; Trotting Along 2.0 auto-detects
// campaign/artwork/duration entirely from Jaccard-matching the PDF's own
// filename against every master .aep under the masters path (via
// nameGeneratorParse(), reusing the same parser Name Generator/PDF to CSV
// use, rather than duplicating TC_nameBox() a third/fourth time), instead
// of trusting the override fields at all. Kept as real no-op parameters
// for the same reason as Build From CSV's page/art/tt -- the toolbox tab
// shares one set of Duration/Art/TT fields across both Trott!/Trott 2.0
// buttons, so the signature needs to match even though this version
// ignores them.
function trotJaccardHybrid(inputA: string, inputB: string): number {
  const JACCARD_WEIGHT = 0.7;
  const LEVENSHTEIN_WEIGHT = 0.3;
  const stopWords = ["dgtl", "digital", "master", "ov", "en", "the", "6sheet", "30sheet", "48sheet", "96sheet", "extreme", "horizontal", "square", "quad", "tall", "portrait"];

  function tokenize(filename: string): string[] {
    const cleanName = String(filename || "")
      .replace(/\.aep|_V\d+/gi, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
    const tokens = cleanName.toLowerCase().split(/[_\-\s]+/);
    return tokens.filter((t) => t && stopWords.indexOf(t) === -1 && !/^\d+x\d+$/.test(t));
  }
  function levenshteinDistance(s: string, t: string): number {
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    const arr: number[][] = [];
    for (let i = 0; i <= t.length; i++) {
      arr[i] = [i];
      for (let j = 1; j <= s.length; j++) {
        arr[i][j] = i === 0 ? j : Math.min(arr[i - 1][j] + 1, arr[i][j - 1] + 1, arr[i - 1][j - 1] + (s.charAt(j - 1) === t.charAt(i - 1) ? 0 : 1));
      }
    }
    return arr[t.length][s.length];
  }

  const tokensA = tokenize(inputA);
  const tokensB = tokenize(inputB);
  if (!tokensA.length && !tokensB.length) return 0;
  const setA: Record<string, boolean> = {};
  const setB: Record<string, boolean> = {};
  for (let i = 0; i < tokensA.length; i++) setA[tokensA[i]] = true;
  for (let j = 0; j < tokensB.length; j++) setB[tokensB[j]] = true;
  let intersection = 0;
  let union = 0;
  for (const k in setA) {
    union++;
    if (setB[k]) intersection++;
  }
  for (const k in setB) {
    if (!setA[k]) union++;
  }
  const jaccardScore = union === 0 ? 0 : intersection / union;
  const cleanStrA = tokensA.join(" ");
  const cleanStrB = tokensB.join(" ");
  const maxLen = Math.max(cleanStrA.length, cleanStrB.length);
  if (maxLen === 0) return jaccardScore;
  return jaccardScore * JACCARD_WEIGHT + (1 - levenshteinDistance(cleanStrA, cleanStrB) / maxLen) * LEVENSHTEIN_WEIGHT;
}

function trotRemoveStopwords(inputString: string): string {
  const stopwords = ["6SHEET", "30SHEET", "48SHEET", "96SHEET", "HORIZONTAL", "SQUARE", "EXTREME", "TALL", "PORTRAIT", "QUAD"];
  return inputString
    .split("_")
    .filter((p) => stopwords.indexOf(p) === -1)
    .join("_");
}

function trotFindAllAeps(rootPath: string): File[] {
  const aepFiles: File[] = [];
  const startFolder = new Folder(rootPath);
  function scanFolder(folder: Folder) {
    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item instanceof Folder) {
        if (item.name !== "_old" && item.name !== "_archive" && item.name.indexOf("Auto-Save") === -1) scanFolder(item);
      } else if (item instanceof File) {
        if (item.name.slice(-4).toLowerCase() === ".aep") aepFiles.push(item);
      }
    }
  }
  if (startFolder.exists) scanFolder(startFolder);
  return aepFiles;
}

interface TrotMasterInfo {
  name: string; // campaign tokens string (the original's "tokens", reused as the campaign name)
  originalName: string;
  tokens: string;
  orientation: "PORTRAIT" | "LANDSCAPE";
}

function trotPreprocessMasters(rootPath: string): TrotMasterInfo[] {
  const allAepFiles = trotFindAllAeps(rootPath);
  const processed: TrotMasterInfo[] = [];
  const regexForSize = /\d*[x]\d*/;
  for (let idx = 0; idx < allAepFiles.length; idx++) {
    const originalFileName = allAepFiles[idx].name;
    const info = nameGeneratorParse(originalFileName);
    if (!info.success || !info.campaign) continue;

    let orientation: "PORTRAIT" | "LANDSCAPE" = "LANDSCAPE";
    const sizeMatch = originalFileName.match(regexForSize);
    if (sizeMatch) {
      const sizeParts = String(sizeMatch).split("x");
      if (sizeParts.length === 2) {
        const w = parseInt(sizeParts[0], 10);
        const h = parseInt(sizeParts[1], 10);
        if (!isNaN(w) && !isNaN(h) && w < h) orientation = "PORTRAIT";
      }
    }
    processed.push({ name: info.campaign, originalName: originalFileName, tokens: info.campaign, orientation });
  }
  return processed;
}

function trotGimmeV2(filename: string, masterAeFiles: TrotMasterInfo[]): [string, string, string] {
  const fileInfo = nameGeneratorParse(filename);
  if (!fileInfo.success) return ["Parsing Error", "Parsing Error", "Parsing Error"];

  const fileTokens = fileInfo.campaign || "";
  const secondOne = fileInfo.artworkType || "";
  const thirdOne = fileInfo.duration || " ";

  let bestScore = -1;
  let campName = "";
  for (let i = 0; i < masterAeFiles.length; i++) {
    const score = trotJaccardHybrid(fileTokens, masterAeFiles[i].tokens);
    if (score > bestScore) {
      bestScore = score;
      campName = masterAeFiles[i].tokens;
    }
  }
  return [campName, secondOne, thirdOne];
};

// Same two-sequential-dialogs shape as campaignLocaliserTrott() above --
// TroAloTwo() prompts for the Master/loc folder first, then campLoc()
// prompts for the PDF folder.
export const campaignLocaliserTrott2 = (_troDur: string, _troArt: string, _troArtOn: boolean, _troCamp: string, _troCampOn: boolean): Result => {
  const mastersPathFolder = Folder.selectDialog("Please select the Master / loc folder to scan");
  if (!mastersPathFolder) return { success: true };
  const mastersPath = mastersPathFolder.fsName;

  const folder = Folder.selectDialog("Select a folder containing PDF files");
  if (folder === null) {
    alert("No folder selected");
    return { success: true };
  }

  const pdfFiles = (folder.getFiles("*.pdf") as File[]) || [];
  let count = 0;
  const scanTerritory = getTerritoryCountryCode(trotFindTerrFolder(folder)) || "XX";
  const regex = /\d*[x]\d*/;

  const processedMasterFiles = trotPreprocessMasters(mastersPath);

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    if (!(pdfFile instanceof File) || !pdfFile.name.match(/\.pdf$/i)) continue;
    count++;

    try {
      const fileName = pdfFile.name;
      const sizeParts = String(fileName.match(regex)).split("x");
      const width = Math.floor(Number(sizeParts[0]));
      const height = Math.floor(Number(sizeParts[1]));
      const size = String(width) + "x" + String(height);
      const pl: "PORTRAIT" | "LANDSCAPE" = width < height ? "PORTRAIT" : "LANDSCAPE";

      const filteredMasterFiles = processedMasterFiles.filter((m) => m.orientation === pl);
      const matchInfo = trotGimmeV2(fileName, filteredMasterFiles);
      const funcCampaign = trotRemoveStopwords(matchInfo[0]);
      const artworkType = matchInfo[1];
      const duration = matchInfo[2];

      const bestMatch = scanMastersForBestMatch(mastersPath, funcCampaign, size, duration);
      if (!bestMatch) continue;
      const textMaster = bestMatch.fsName;

      const linesMaster = textMaster.split("/");
      let masterName = linesMaster[linesMaster.length - 1];
      const ratioPattern = /^_(\d+\.\d+)_/;
      if (ratioPattern.test(masterName)) masterName = masterName.split(ratioPattern)[2];

      const masterSizeMatch = String(masterName.match(regex));
      const masterSizeParts = masterSizeMatch.split("x");
      const masterWidth = Math.floor(Number(masterSizeParts[0]));
      const masterHeight = Math.floor(Number(masterSizeParts[1]));
      const plm: "PORTRAIT" | "LANDSCAPE" = masterWidth < masterHeight ? "PORTRAIT" : "LANDSCAPE";

      const scanFilmTitle = masterName.split("_")[0];
      const scanIndo = masterName.split("_")[1];

      const newCompName = scanFilmTitle + "_" + scanIndo + "_DGTL_" + artworkType + "_" + funcCampaign + "_" + width + "x" + height + "_" + duration + "_" + scanTerritory;

      const aeFolder = trotFindPDFsFolder(pdfFile.parent);
      const outputFile = new File(aeFolder + "/" + newCompName + "_V01.aep");
      if (outputFile.exists) {
        alert(newCompName + ".aep already exists. Skipping.");
        continue;
      }

      const fileToOpen = new File(textMaster);
      if (!fileToOpen.exists) {
        alert("Master file not found: " + textMaster);
        continue;
      }

      const proj = app.open(fileToOpen);
      let myComp: CompItem | null = null;
      const masterStem = masterName.split(".")[0].replace(/_V\d+$/, "");
      for (let j = 1; j <= proj.numItems; j++) {
        const item = proj.item(j);
        if (item instanceof CompItem && item.name === masterStem) myComp = item;
      }
      if (!myComp) continue;

      trotNameGen(myComp, width, height, newCompName, plm, pdfFile, false);
    } catch (err) {
      alert("Row failed: " + err.toString());
    }
  }

  alert("Total PDF files processed: " + count);
  return { success: true };
};

// Ported 1:1 from XYi_PDF_to_CSV.jsx's generateCSV() -- no project is ever
// opened, just scans filenames and writes a CSV, so this carries none of
// the master-file risk the two Trotting Along tools above do. Reuses the
// same Jaccard matching / master pre-processing as Trotting Along 2.0
// (trotJaccardHybrid()/trotPreprocessMasters()/trotFindAllAeps()) since
// it's the same "match PDFs to masters by filename" logic the original's
// own Trotting Along 2.0-derived comment block says it's "Based on
// Campaign Localiser Logic" -- not duplicated a third time.
interface PdfToCsvResult extends Result {
  filePath?: string;
  matched?: number;
}

export const pdfToCsvGenerate = (): PdfToCsvResult => {
  const mastersFolder = Folder.selectDialog("Select the MASTERS folder (containing .aep files)");
  if (!mastersFolder) {
    alert("No Masters folder selected. Script cancelled.");
    return { success: false, error: "No Masters folder selected." };
  }
  const pdfFolder = Folder.selectDialog("Select the PDF folder (containing input PDFs)");
  if (!pdfFolder) {
    alert("No PDF folder selected. Script cancelled.");
    return { success: false, error: "No PDF folder selected." };
  }

  const processedMasterFiles = trotPreprocessMasters(mastersFolder.fsName);
  const regexForSize = /\d*[x]\d*/;
  const pdfFiles = (pdfFolder.getFiles("*.pdf") as File[]) || [];
  let csvOutputString = "Artwork:,Campaign:,Size:,Duration:\n";
  let count = 0;

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    if (!(pdfFile instanceof File) || !pdfFile.name.match(/\.pdf$/i)) continue;
    count++;

    const fileName = pdfFile.name;
    const sizeMatch = String(fileName.match(regexForSize));
    const sizeParts = sizeMatch.split("x");

    let width = 1920;
    let height = 1080;
    let size = "1920x1080";
    if (sizeParts.length === 2) {
      width = Math.floor(Number(sizeParts[0]));
      height = Math.floor(Number(sizeParts[1]));
      size = String(width) + "x" + String(height);
    }
    const pl: "PORTRAIT" | "LANDSCAPE" = width < height ? "PORTRAIT" : "LANDSCAPE";

    const filteredMasterFiles = processedMasterFiles.filter((m) => m.orientation === pl);
    const matchInfo = trotGimmeV2(fileName, filteredMasterFiles);
    const funcCampaign = trotRemoveStopwords(String(matchInfo[0]));
    const artworkType = matchInfo[1];
    const duration = matchInfo[2];

    csvOutputString += artworkType + "," + funcCampaign + "," + size + "," + duration + "\n";
  }

  if (count === 0) {
    alert("No PDF files found in the selected folder.");
    return { success: false, error: "No PDF files found in the selected folder." };
  }

  const aeFolderPath = pdfCsvFindPDFsFolder(pdfFolder);
  trotCreateFolderStructure(aeFolderPath);
  const csvFile = new File(aeFolderPath + "/Campaign_Data.csv");
  csvFile.encoding = "UTF-8";
  csvFile.open("w");
  csvFile.write(csvOutputString);
  csvFile.close();

  alert("Process Complete.\nMatched " + count + " files.\nCSV saved to:\n" + csvFile.fsName);
  return { success: true, filePath: csvFile.fsName, matched: count };
};

// =============================================================================
// JPEG Loc -- ported from toolset/XYi_jpgLoc.jsx, the Campaign Localiser
// tab's "JPEG Loc" button (pngLocBut -> jpgLoc). The JPG sibling of MC It!
// (PNG replacement): batch-replaces .jpg footage inside a folder of .aep
// projects with the best-matching JPG (by resolution + trailing number)
// from a second folder.
//
// **This was MISSED in the initial Campaign Localiser port** (found by a
// reverse audit of every .onClick handler in XYi_Toolbox.jsx against the
// port) -- same class of miss as Trotting Along: a sub-button of the
// Campaign Localiser tab, not a top-level listbox tab, so it slipped past
// the tab-level "all wired" check. Lesson recorded in CLAUDE.md: audit
// per-button, not per-tab.
//
// **Already copy-first in the source** (safety-patched earlier this
// session, same `ov_safeOpenMasterCopy()` LOS Tools uses -- reused here
// via `losSafeOpenMasterCopy()`), so no new safety work, only wiring.
// Unlike MC It!/pingLoc (which the studio confirmed always runs on
// working copies, so was reverted to in-place save), jpgLoc was KEPT
// copy-first -- do not "align" the two; they're deliberately different.
// Ported with the original's alert()s intact, same fidelity rule as LOS
// Tools/CSV Localiser.
// =============================================================================
interface JpegLocParsed {
  firstOne: string;
  secondOne: string;
  thirdOne: string;
  pngNumber: string;
}

// Ported 1:1 from XYi_jpgLoc.jsx's gimme() -- returns resolution
// (`thirdOne`) and the trailing number (`pngNumber`), the two tokens the
// match compares on. NOT the same as trotGimmeV1() (which returns only
// [firstOne, secondOne] and skips resolution/number), so ported fresh
// rather than reused.
function jpegLocGimme(filename: string): JpegLocParsed {
  const resolutionRegex = /\d+x\d+px?/i;
  let secondOne = "";
  if (filename.indexOf("DOOH") !== -1) secondOne = "DOOH";
  else if (filename.indexOf("DINTH") !== -1) secondOne = "DINTH";
  else if (filename.indexOf("DFOH") !== -1) secondOne = "DFOH";

  const parts = filename.split("_");
  const tokens = parts.filter((p) => p.length > 0);

  const validTokens: string[] = [];
  for (let j = 0; j < tokens.length; j++) {
    if (resolutionRegex.test(tokens[j])) break;
    validTokens.push(tokens[j]);
  }
  if (validTokens.length > 0) validTokens.shift();

  const finalTokens = validTokens.filter((t) => t !== secondOne);
  if (finalTokens.length > 1 && /^[A-Z]{2,4}$/.test(finalTokens[0])) finalTokens.shift();
  if (finalTokens.length > 1 && /^[A-Z]{2}$/.test(finalTokens[finalTokens.length - 1])) finalTokens.pop();
  const firstOne = finalTokens.join("_").toUpperCase();

  const resMatch = filename.match(/\d+x\d+/i);
  const thirdOne = resMatch ? resMatch[0] : "";
  const pngNumberMatch = filename.match(/\d+\./);
  const pngNumber = pngNumberMatch ? pngNumberMatch[0].replace(".", "") : "";

  return { firstOne, secondOne, thirdOne, pngNumber };
}

function jpegLocGetAllJpgFiles(folder: Folder): File[] {
  let fileList: File[] = [];
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item instanceof Folder) fileList = fileList.concat(jpegLocGetAllJpgFiles(item));
    else if (item instanceof File && item.name.match(/\.jpg$/i)) fileList.push(item);
  }
  return fileList;
}

function jpegLocGetAllAepFiles(folder: Folder): File[] {
  const aepFiles: File[] = [];
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item instanceof File && item.name.match(/\.aep$/i)) aepFiles.push(item);
  }
  return aepFiles;
}

function jpegLocFindProjectFolderByName(name: string): FolderItem | null {
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof FolderItem && item.name === name) return item;
  }
  return null;
}

export const jpegLoc = (): Result => {
  const projectFolder = Folder.selectDialog("Select a folder containing After Effects Project files");
  if (!projectFolder) {
    alert("No project folder selected. Exiting.");
    return { success: true };
  }
  const aepFiles = jpegLocGetAllAepFiles(projectFolder);
  if (aepFiles.length === 0) {
    alert("No AEP files found in the selected folder. Exiting.");
    return { success: true };
  }

  const jpgRootFolder = Folder.selectDialog("Select a folder containing PNG files (search includes subfolders)");
  if (!jpgRootFolder) {
    alert("No PNG folder selected. Exiting.");
    return { success: true };
  }
  const jpgFiles = jpegLocGetAllJpgFiles(jpgRootFolder);
  if (jpgFiles.length === 0) {
    alert("No PNG files found in the selected folder. Exiting.");
    return { success: true };
  }

  let copiedCount = 0;
  let replacedInPlaceCount = 0;

  for (let p = 0; p < aepFiles.length; p++) {
    const masterFile = aepFiles[p];

    // Copy-first only if this file's name still carries the OV master
    // suffix (see hasIsolatedOvToken/losOpenForEdit above) -- an
    // already-localised working copy (e.g. "..._FR_...", no "_OV" left)
    // is opened and saved directly.
    const openedProj = losOpenForEdit(masterFile);
    if (hasIsolatedOvToken(masterFile.name)) copiedCount++;
    else replacedInPlaceCount++;
    if (!openedProj) {
      alert("Could not open project: " + masterFile.name);
      continue;
    }

    const parsedAEP = jpegLocGimme(masterFile.name);

    const footageFolder = jpegLocFindProjectFolderByName("Footage");
    if (!footageFolder) {
      alert("Footage folder not found in project: " + masterFile.name);
      continue;
    }

    let pngFolderInProject: FolderItem | null = null;
    for (let i = 1; i <= footageFolder.numItems; i++) {
      const item = footageFolder.item(i);
      if (item instanceof FolderItem && item.name === "PNG") {
        pngFolderInProject = item;
        break;
      }
    }
    if (!pngFolderInProject) {
      alert("PNG folder not found inside Footage in project: " + masterFile.name);
      continue;
    }

    for (let j = 1; j <= pngFolderInProject.numItems; j++) {
      const footageItem = pngFolderInProject.item(j) as FootageItem;
      if (footageItem.file && footageItem.file.name.match(/\.jpg$/i)) {
        const parsedOriginal = jpegLocGimme(footageItem.file.name);

        for (let k = 0; k < jpgFiles.length; k++) {
          const candidate = jpgFiles[k];
          const parsedCandidate = jpegLocGimme(candidate.name);
          if (parsedAEP.thirdOne === parsedCandidate.thirdOne && parsedOriginal.pngNumber === parsedCandidate.pngNumber) {
            footageItem.replace(candidate);
            $.sleep(500);
            break;
          }
        }
      }
    }

    app.project.save();
    $.sleep(1500);
  }

  let summary = "PNG replacement process complete!";
  if (replacedInPlaceCount > 0) summary += " " + replacedInPlaceCount + " file(s) replaced in place.";
  if (copiedCount > 0) summary += " " + copiedCount + " master(s) (still carrying an \"_OV\" filename) were left untouched -- written to a new \"_V0N.aep\" copy instead.";
  alert(summary);
  return { success: true };
};

// =============================================================================
// Localised Library -- ported 1:1 from XYi_Localised_Library.jsx (a
// standalone ScriptUI palette, launched next to the search bar in the
// original toolbox, not part of the vertical listbox -- see CLAUDE.md).
// A campaign -> territory -> component library, manually curated (or
// auto-populated from a "Support_Motion"/"Motion_Components" folder).
// Territories are auto-detected by scanning the campaign's Markets root.
// Read-only: importFile()/revealFile() (shared with OV Library, reused
// directly below) are the only file actions -- nothing here ever opens a
// file for editing.
// =============================================================================
interface LocLibCampaign {
  name: string;
  marketsRoot: string;
}

interface LocLibComponent {
  campaign: string;
  territory: string;
  label: string;
  path: string;
}

const LL_CAMPAIGNS_KEY = "LocLibCampaigns";
const LL_COMPONENTS_KEY = "LocLibComponents";

function loadLocLibCampaignsRaw(): LocLibCampaign[] {
  const out: LocLibCampaign[] = [];
  if (app.settings.haveSetting(SETTINGS_SECTION, LL_CAMPAIGNS_KEY)) {
    const raw = app.settings.getSetting(SETTINGS_SECTION, LL_CAMPAIGNS_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length >= 2) out.push({ name: parts[0], marketsRoot: parts[1] });
    }
  }
  return out;
}

function saveLocLibCampaignsRaw(arr: LocLibCampaign[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const nm = String(arr[i].name).replace(/[\t\n\r]/g, " ");
    const rt = String(arr[i].marketsRoot).replace(/[\t\n\r]/g, " ");
    lines.push(nm + "\t" + rt);
  }
  app.settings.saveSetting(SETTINGS_SECTION, LL_CAMPAIGNS_KEY, lines.join("\n"));
}

function loadLocLibComponentsRaw(): LocLibComponent[] {
  const out: LocLibComponent[] = [];
  if (app.settings.haveSetting(SETTINGS_SECTION, LL_COMPONENTS_KEY)) {
    const raw = app.settings.getSetting(SETTINGS_SECTION, LL_COMPONENTS_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length >= 4) out.push({ campaign: parts[0], territory: decode(parts[1]), label: parts[2], path: parts[3] });
    }
  }
  return out;
}

function saveLocLibComponentsRaw(arr: LocLibComponent[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const c = String(arr[i].campaign).replace(/[\t\n\r]/g, " ");
    const t = String(arr[i].territory).replace(/[\t\n\r]/g, " ");
    const l = String(arr[i].label).replace(/[\t\n\r]/g, " ");
    const p = String(arr[i].path).replace(/[\t\n\r]/g, " ");
    lines.push(c + "\t" + t + "\t" + l + "\t" + p);
  }
  app.settings.saveSetting(SETTINGS_SECTION, LL_COMPONENTS_KEY, lines.join("\n"));
}

export const loadLocLibCampaigns = (): LocLibCampaign[] => loadLocLibCampaignsRaw();

export const saveLocLibCampaign = (name: string, marketsRoot: string): Result => {
  try {
    const camps = loadLocLibCampaignsRaw();
    for (let i = 0; i < camps.length; i++) {
      if (camps[i].name === name) {
        return { success: false, error: 'A campaign named "' + name + '" already exists.' };
      }
    }
    camps.push({ name: name, marketsRoot: marketsRoot });
    saveLocLibCampaignsRaw(camps);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const removeLocLibCampaign = (name: string): Result => {
  try {
    const camps = loadLocLibCampaignsRaw();
    for (let i = 0; i < camps.length; i++) {
      if (camps[i].name === name) {
        camps.splice(i, 1);
        break;
      }
    }
    saveLocLibCampaignsRaw(camps);

    const remaining = loadLocLibComponentsRaw().filter((c) => c.campaign !== name);
    saveLocLibComponentsRaw(remaining);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const selectMarketsFolder = (): string | null => {
  const folder = Folder.selectDialog('Select the campaign\'s "Markets" (territories) root folder:');
  return folder ? folder.fsName : null;
};

export const scanTerritories = (marketsRoot: string): string[] => {
  const out: string[] = [];
  const folder = new Folder(marketsRoot);
  if (!folder.exists) return out;
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    if (items[i] instanceof Folder && items[i].name.charAt(0) !== "_") {
      out.push(decode(items[i].name));
    }
  }
  out.sort();
  return out;
};

export const loadLocLibComponents = (): LocLibComponent[] => loadLocLibComponentsRaw();

export const addLocLibComponent = (campaign: string, territory: string, label: string, path: string): Result => {
  try {
    const all = loadLocLibComponentsRaw();
    all.push({ campaign, territory, label, path });
    saveLocLibComponentsRaw(all);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const removeLocLibComponent = (campaign: string, territory: string, label: string, path: string): Result => {
  try {
    const all = loadLocLibComponentsRaw();
    for (let k = 0; k < all.length; k++) {
      if (all[k].campaign === campaign && all[k].territory === territory && all[k].label === label && all[k].path === path) {
        all.splice(k, 1);
        break;
      }
    }
    saveLocLibComponentsRaw(all);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const selectComponentFile = (territoryName: string): string | null => {
  const f = File.openDialog("Select the file for this component (" + territoryName + "):");
  return f ? f.fsName : null;
};

// --- Auto-populate: find every file under a "Support_Motion" or
// "Motion_Components" folder (either name, underscore or space,
// case-insensitive) anywhere within a territory's tree. Read-only --
// only ever lists folder contents.
function llIsComponentsContainerName(name: string): boolean {
  const norm = String(name).toLowerCase().replace(/[_\s]+/g, "");
  return norm === "supportmotion" || norm === "motioncomponents";
}

function llCollectAllFiles(folder: Folder, results: File[]) {
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    if (items[i] instanceof Folder) {
      llCollectAllFiles(items[i] as Folder, results);
    } else if (items[i] instanceof File) {
      results.push(items[i] as File);
    }
  }
}

function llFindComponentFiles(territoryFolder: Folder, maxSearchDepth: number): File[] {
  const results: File[] = [];
  const search = (folder: Folder, depth: number) => {
    if (depth > maxSearchDepth) return;
    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      if (items[i] instanceof Folder) {
        if (llIsComponentsContainerName(items[i].name)) {
          llCollectAllFiles(items[i] as Folder, results);
        } else {
          search(items[i] as Folder, depth + 1);
        }
      }
    }
  };
  if (territoryFolder.exists) search(territoryFolder, 0);
  return results;
}

interface AutoPopulateResult {
  success: boolean;
  error?: string;
  added?: number;
  skippedExisting?: number;
  territoriesWithNoMatch?: string[];
}

export const autoPopulateLocLib = (campaignName: string, marketsRoot: string): AutoPopulateResult => {
  try {
    const territories = scanTerritories(marketsRoot);
    const existing = loadLocLibComponentsRaw();
    let added = 0;
    let skippedExisting = 0;
    const territoriesWithNoMatch: string[] = [];

    for (let i = 0; i < territories.length; i++) {
      const terrName = territories[i];
      const terrFolder = new Folder(marketsRoot + "/" + terrName);
      const files = llFindComponentFiles(terrFolder, 4);

      if (files.length === 0) {
        territoriesWithNoMatch.push(terrName);
        continue;
      }

      for (let j = 0; j < files.length; j++) {
        const fPath = files[j].fsName;
        let alreadyThere = false;
        for (let k = 0; k < existing.length; k++) {
          if (existing[k].campaign === campaignName && existing[k].territory === terrName && existing[k].path === fPath) {
            alreadyThere = true;
            break;
          }
        }
        if (alreadyThere) {
          skippedExisting++;
          continue;
        }

        const label = decode(files[j].name).replace(/\.[^.]+$/, "");
        existing.push({ campaign: campaignName, territory: terrName, label: label, path: fPath });
        added++;
      }
    }

    saveLocLibComponentsRaw(existing);
    return { success: true, added, skippedExisting, territoriesWithNoMatch };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Batch import -- two related actions for the Localised Library.
//
// Feature 1 (importLocLibComponentsBatch) imports the checked components
// into the CURRENT project, read-only, same as every other import in this
// app -- no exception to the masters rule needed here.
//
// Feature 2 (importComponentsIntoBatchFolder) is a deliberate, narrow
// EXCEPTION to this file's usual "import only, never open, never save"
// rule -- see the big comment above it for why that's safe here and what
// guards it.
// =============================================================================
interface BatchImportResult extends Result {
  imported?: number;
  failed?: string[]; // "filename (reason)" entries for the summary toast
}

// Shared by both actions below. Reports per-file failures instead of
// aborting the whole batch on the first bad file -- a batch of 8 where 1
// file went missing should still bring in the other 7, matching how
// autoPopulateLocLib() above already treats a batch operation as
// "do as much as you can, tell me what didn't work" rather than all-or-
// nothing.
function importFilesRaw(paths: string[]): BatchImportResult {
  let imported = 0;
  const failed: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    const f = new File(paths[i]);
    if (!f.exists) {
      failed.push(f.displayName + " (missing)");
      continue;
    }
    try {
      app.project.importFile(new ImportOptions(f));
      imported++;
    } catch (e) {
      failed.push(f.displayName + " (" + e.toString() + ")");
    }
  }
  return { success: true, imported: imported, failed: failed };
}

// Feature 1: batch-import whichever components the user checked in the
// current territory. Just a thin wrapper over importFilesRaw -- exported
// separately (rather than making callers always go through the batch-
// folder variant below with an empty folder) since "import just what I
// selected" is the more common, simpler case.
export const importLocLibComponentsBatch = (paths: string[]): BatchImportResult => {
  return importFilesRaw(paths);
};

// Recursively finds every .aep file under a folder -- same "_"-prefix
// exclusion convention as every other scan in this toolset (CLAUDE.md:
// "Folders starting with _ ... are excluded from every scan across this
// whole toolset, not just this panel"), same maxSearchDepth=4 convention
// as llFindComponentFiles() above for consistency within this file.
function findAepFilesRecursive(folder: Folder, depth: number, maxDepth: number, results: File[]) {
  if (depth > maxDepth) return;
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item instanceof Folder) {
      if (item.name.charAt(0) === "_") continue;
      findAepFilesRecursive(item, depth + 1, maxDepth, results);
    } else if (item instanceof File && /\.aep$/i.test(item.name)) {
      results.push(item);
    }
  }
}

// Feature 2: user explicitly picks the batch folder via a native dialog
// -- deliberately NOT derived from the component's own path by guessing
// at a naming/folder convention. This project has been burned before by
// baking in an unverified real-world folder convention (see the OV
// Library render-pairing and QUAD-detection caveats elsewhere in
// CLAUDE.md); a folder picker sidesteps that risk entirely and works
// regardless of how a given studio's batch folders are actually named
// or nested relative to the components.
export const selectBatchFolder = (): string | null => {
  const folder = Folder.selectDialog("Select the batch folder to open, inject the selected components into, and save:");
  if (!folder) return null;
  return folder.fsName;
};

// Normalises a path for prefix comparison: backslashes -> forward slashes,
// lowercased (Windows paths are case-insensitive; matching loosely on Mac
// too is harmless -- worst case it's slightly over-cautious, never under-),
// single trailing slash so "…/Masters" can't accidentally prefix-match
// "…/MastersOverflow".
function normPathForCompare(p: string): string {
  let out = p.replace(/\\/g, "/").toLowerCase();
  if (out.charAt(out.length - 1) !== "/") out += "/";
  return out;
}

// Guards importComponentsIntoBatchFolder against ever being pointed at a
// Masters tree. Masters and localised batch folders are two genuinely
// different things in this studio's workflow (confirmed with the user,
// not assumed): Masters are the OV/English versions approved by HO and
// meant to stay untouched read-only source-of-truth (OV Library's whole
// existence enforces that); a "batch folder" is a localised delivery
// batch (e.g. "Batch_01" for France) that's expected to be opened, have
// components dropped in, and saved as a normal part of the job. Localised
// Library has no direct knowledge of which folders are Masters roots, but
// OV Library's own saved campaigns do -- reusing that list here catches
// the realistic mistake (picking the wrong folder in the dialog) even
// though the two tools are otherwise independent.
function findMastersRootCollision(batchFolderPath: string): string | null {
  const target = normPathForCompare(batchFolderPath);
  const masters = loadCampaignsRaw();
  for (let i = 0; i < masters.length; i++) {
    const root = normPathForCompare(masters[i].mastersRoot);
    if (target.indexOf(root) === 0 || root.indexOf(target) === 0) {
      return masters[i].mastersRoot;
    }
  }
  return null;
}

export interface BatchFolderPreview {
  success: boolean;
  error?: string;
  blocked?: boolean;
  blockedReason?: string;
  count?: number;
}

// Dry run -- scans and safety-checks the picked folder WITHOUT opening or
// saving anything, so the React side can show the user an accurate count
// and get their confirmation before importComponentsIntoBatchFolder does
// anything irreversible.
export const previewBatchFolderAep = (batchFolderPath: string): BatchFolderPreview => {
  try {
    const folder = new Folder(batchFolderPath);
    if (!folder.exists) return { success: false, error: "That folder no longer exists." };
    const collision = findMastersRootCollision(batchFolderPath);
    if (collision) {
      return {
        success: true,
        blocked: true,
        blockedReason:
          'That folder is inside (or contains) a Masters root ("' +
          collision +
          '") saved in OV Library. Masters must never be opened or saved over -- pick a localised batch delivery folder instead.',
      };
    }
    const aepFiles: File[] = [];
    findAepFilesRecursive(folder, 0, 4, aepFiles);
    return { success: true, blocked: false, count: aepFiles.length };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Feature 2, for real: opens every .aep found in the batch folder, imports
// the selected components into it, and saves it in place -- so the
// components are already sitting in the project the next time someone
// opens that file normally. This is a deliberate, narrow exception to
// this file's usual "import only, never open, never save" rule, safe only
// because batch-folder files are confirmed-with-the-user localised
// delivery copies, never the Masters (see findMastersRootCollision above,
// re-checked here rather than trusting the caller already ran the preview
// -- defence in depth, since this function is the one that actually
// writes to disk).
//
// AE is single-document: opening file 2 silently replaces file 1 as the
// active project. Whatever project the user had open when this started is
// restored at the end (best-effort) -- but any UNSAVED changes in that
// original project are discarded the moment the first batch file opens,
// since ExtendScript has no reliable "unsaved changes" flag to check
// first. The confirmation dialog on the React side warns about this
// before calling here; this function does not re-warn, it just proceeds.
export const importComponentsIntoBatchFolder = (componentPaths: string[], batchFolderPath: string): BatchImportResult => {
  const collision = findMastersRootCollision(batchFolderPath);
  if (collision) {
    return {
      success: false,
      error: 'That folder is inside (or contains) a Masters root ("' + collision + '"). Refusing to open/save into it.',
    };
  }

  const folder = new Folder(batchFolderPath);
  if (!folder.exists) return { success: false, error: "That folder no longer exists." };

  const aepFiles: File[] = [];
  findAepFilesRecursive(folder, 0, 4, aepFiles);

  const originalProjectFile = app.project && app.project.file ? app.project.file : null;

  let imported = 0;
  const failed: string[] = [];
  for (let i = 0; i < aepFiles.length; i++) {
    const target = aepFiles[i];
    try {
      const opened = app.open(target);
      if (!opened) {
        failed.push(target.displayName + " (failed to open)");
        continue;
      }
    } catch (e) {
      failed.push(target.displayName + " (" + e.toString() + ")");
      continue;
    }

    let importFailure: string | null = null;
    for (let c = 0; c < componentPaths.length; c++) {
      const compFile = new File(componentPaths[c]);
      if (!compFile.exists) {
        importFailure = compFile.displayName + " missing";
        continue;
      }
      try {
        app.project.importFile(new ImportOptions(compFile));
      } catch (e) {
        importFailure = compFile.displayName + " (" + e.toString() + ")";
      }
    }

    try {
      app.project.save();
      if (importFailure) {
        failed.push(target.displayName + " (saved, but " + importFailure + ")");
      } else {
        imported++;
      }
    } catch (e) {
      failed.push(target.displayName + " (save failed: " + e.toString() + ")");
    }
  }

  if (originalProjectFile) {
    try {
      app.open(originalProjectFile);
    } catch (e) {
      failed.push("(could not reopen your original project -- reopen it manually: " + originalProjectFile.fsName + ")");
    }
  }

  return { success: true, imported: imported, failed: failed };
};

// Cosmetic-only territory -> country-code badge (reuses the same
// TC_COUNTRIES table Cheeky T Check's territoryCheck() already has,
// just the reverse lookup direction -- name to code instead of code to
// name). Ported from XYi_Cheeky_InvT_Check.jsx's getCountryCode().
export const getTerritoryCountryCode = (territoryName: string): string | null => {
  const userInput = territoryName.toLowerCase().replace("_", " ");
  for (let i = 0; i < TC_COUNTRIES.length; i++) {
    // Plain substring check, not .match() -- unlike territoryCheck() above,
    // territoryName here is a REAL FOLDER NAME straight off disk (Localised
    // Library calls this once per territory in a campaign's Markets folder,
    // and Trotting Along calls it via trotFindTerrFolder()), not a fixed
    // set of clean country codes. .match() treats its argument as a regex
    // pattern, so a folder named e.g. "APAC (ex. China)" throws a
    // SyntaxError (unbalanced parens) instead of just not matching --
    // that's a real bug that was surfacing as spurious "CEP not connected"
    // toasts in the UI (the generic evalTS catch-all can't tell a genuine
    // missing bridge apart from a thrown ExtendScript exception). indexOf
    // has no such risk and is exactly what a substring check needs.
    if (TC_COUNTRIES[i].name.toLowerCase().indexOf(userInput) !== -1) {
      return TC_COUNTRIES[i].code;
    }
  }
  return null;
};

// =============================================================================
// Name Generator -- ported from XYi_Toolbox.jsx's nameGen()/nameBox()/
// TC_nameBox() (the latter from XYi_Cheeky_N_Check.jsx). Builds a standard
// comp/filename from form fields, or reverse-parses one of those names back
// into the fields ("Detect Name"). Pure metadata: renames the selected
// project item(s), never touches a master file on disk.
// =============================================================================
interface NameGeneratorResult extends Result {
  newName?: string;
}

export const nameGeneratorGenerate = (
  filmTitle: string,
  isInternational: boolean,
  artworkType: string,
  campaign: string,
  territory: string
): NameGeneratorResult => {
  try {
    const sel = app.project.selection;
    if (sel.length === 0) return { success: false, error: "Please select one or more compositions first." };

    app.beginUndoGroup("XYi Name Generator");
    let lastName = "";
    for (let i = 0; i < sel.length; i++) {
      const item = sel[i];
      const indo = isInternational ? "INTL" : "DOM";
      const newName = filmTitle + "_" + indo + "_DGTL_" + artworkType + "_" + campaign + "_" + item.width + "x" + item.height + "_" + Math.round(item.duration) + "sec_" + territory;
      item.name = newName;
      lastName = newName;
    }
    app.endUndoGroup();
    return { success: true, newName: lastName };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface NameDetectResult extends Result {
  filmTitle?: string;
  artworkType?: string;
  campaign?: string;
  territory?: string;
  isInternational?: boolean;
  duration?: string;
}

// Ported 1:1 from TC_nameBox() in XYi_Cheeky_N_Check.jsx -- reverse-parses a
// standard name back into its component fields. Pure string parsing, reads
// nothing from disk. `duration` was added to the returned object (the
// original's index-4 return value, TC_Duration) when Trotting Along 2.0
// and PDF to CSV were ported -- both need it and both call this same
// parser (as `FilNameChe()`/`gimme()` did in the original) rather than
// duplicating TC_nameBox() a third time. Existing callers (Name Generator)
// simply don't read the new field, so this is purely additive.
function nameGeneratorParse(name: string): NameDetectResult {
  const artworkTypes = ["DOOH", "DFOH", "DINTH", "FOH"];
  const regSize = /(\d+x\d+)(?:px)?/;
  const regDur = /(\d+)s(?:ec)?/;
  const durMatch = name.match(regDur);
  const duration = durMatch ? durMatch[1] + "sec" : "";
  const regionMatch = name.match(/_(INTL|DOM)_/);

  let filmTitle = "";
  let indom = "";
  if (regionMatch) {
    indom = regionMatch[1];
    filmTitle = name.substring(0, regionMatch.index);
  }

  const sizeMatch = name.match(regSize);

  let artworkType = "";
  let campaign = "";
  if (regionMatch && sizeMatch) {
    let startOfDesc = regionMatch.index! + regionMatch[0].length;
    const dgtlMarker = "_DGTL_";
    const dgtlIndex = name.indexOf(dgtlMarker, regionMatch.index);
    if (dgtlIndex !== -1) startOfDesc = dgtlIndex + dgtlMarker.length;

    const endOfDesc = name.indexOf("_" + sizeMatch[0]);
    if (endOfDesc > startOfDesc) {
      const middlePart = name.substring(startOfDesc, endOfDesc);
      const middleParts = middlePart.split("_").filter((p) => p !== "");

      let artworkIndex = -1;
      for (let j = 0; j < middleParts.length; j++) {
        if (artworkTypes.indexOf(middleParts[j].toUpperCase()) !== -1) {
          artworkIndex = j;
          break;
        }
      }
      if (artworkIndex !== -1) {
        artworkType = middleParts.splice(artworkIndex, 1)[0];
      }
      campaign = middleParts.join("_");
    }
  }

  // Territory: 2-letter token surrounded by underscores (or trailing).
  const terMatch = name.match(/_([A-Z]{2})(?:_|$)/);
  const territory = terMatch ? terMatch[1] : "";

  return { success: true, filmTitle, artworkType, campaign, territory, isInternational: indom === "INTL", duration };
}

export const nameGeneratorDetect = (): NameDetectResult => {
  const sel = app.project.selection;
  if (sel.length === 0) return { success: false, error: "Please select a composition first." };
  return nameGeneratorParse(sel[0].name);
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
export const resizeCompositionCentered = (newWidth: number, newHeight: number): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select a Composition active in the timeline." };
    if (isNaN(newWidth) || isNaN(newHeight)) return { success: false, error: "Invalid dimensions. Please enter valid numbers." };

    app.beginUndoGroup("Resize Composition Centered");
    const widthOffset = (newWidth - comp.width) / 2;
    const heightOffset = (newHeight - comp.height) / 2;

    for (let i = 1; i <= comp.numLayers; i++) {
      const layer = comp.layer(i);
      if (layer.parent !== null || layer.locked) continue;

      const posProp = layer.property("Position") as Property;
      if (posProp.dimensionsSeparated) {
        const xProp = layer.property("X Position") as Property;
        const yProp = layer.property("Y Position") as Property;
        xProp.setValue((xProp.value as number) + widthOffset);
        yProp.setValue((yProp.value as number) + heightOffset);
      } else {
        const curPos = posProp.value as number[];
        if (layer.threeDLayer) {
          posProp.setValue([curPos[0] + widthOffset, curPos[1] + heightOffset, curPos[2]]);
        } else {
          posProp.setValue([curPos[0] + widthOffset, curPos[1] + heightOffset]);
        }
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
    return { success: true };
  } catch (e) {
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

      const layerAnchor = (layer.property("Anchor Point") as Property).value as number[];

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
// Useful Folders -- ported from XYi_Toolbox.jsx's "Useful Folders" tab
// (UF_loadFolders()/UF_saveFolders()/etc). A user-curatable list of folder
// shortcuts, persisted via the SAME app.settings section/key
// (`"XYiToolbox"` / `"UsefulFolders"`) the still-live ScriptUI tab uses --
// shortcuts added in either show up in both. Click reveals the folder in
// Explorer/Finder (reuses the same OS-native reveal command as
// revealFile()); nothing here reads or writes inside the folder itself.
// =============================================================================
interface UsefulFolder {
  label: string;
  path: string;
}

const UF_SETTINGS_SECTION = "XYiToolbox";
const UF_SETTINGS_KEY = "UsefulFolders";

function loadUsefulFoldersRaw(): UsefulFolder[] {
  const out: UsefulFolder[] = [];
  if (app.settings.haveSetting(UF_SETTINGS_SECTION, UF_SETTINGS_KEY)) {
    const raw = app.settings.getSetting(UF_SETTINGS_SECTION, UF_SETTINGS_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length >= 2) out.push({ label: parts[0], path: parts[1] });
    }
  }
  return out;
}

function saveUsefulFoldersRaw(arr: UsefulFolder[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const label = String(arr[i].label).replace(/[\t\n\r]/g, " ");
    const path = String(arr[i].path).replace(/[\t\n\r]/g, " ");
    lines.push(label + "\t" + path);
  }
  app.settings.saveSetting(UF_SETTINGS_SECTION, UF_SETTINGS_KEY, lines.join("\n"));
}

export const loadUsefulFolders = (): UsefulFolder[] => loadUsefulFoldersRaw();

export const selectUsefulFolder = (): string | null => {
  const folder = Folder.selectDialog("Select a folder to add:");
  if (!folder) return null;
  return folder.fsName;
};

export const addUsefulFolder = (label: string, path: string): Result => {
  try {
    const arr = loadUsefulFoldersRaw();
    arr.push({ label, path });
    saveUsefulFoldersRaw(arr);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const renameUsefulFolder = (index: number, newLabel: string): Result => {
  try {
    const arr = loadUsefulFoldersRaw();
    if (index < 0 || index >= arr.length) return { success: false, error: "Folder not found." };
    arr[index].label = newLabel;
    saveUsefulFoldersRaw(arr);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const removeUsefulFolder = (index: number): Result => {
  try {
    const arr = loadUsefulFoldersRaw();
    if (index < 0 || index >= arr.length) return { success: false, error: "Folder not found." };
    arr.splice(index, 1);
    saveUsefulFoldersRaw(arr);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const revealUsefulFolder = (path: string): Result => {
  const fol = new Folder(path);
  if (!fol.exists) return { success: false, error: "This folder no longer exists:\n" + path };
  const p = fol.fsName;
  if ($.os.indexOf("Windows") !== -1) {
    system.callSystem('explorer "' + p + '"');
  } else {
    system.callSystem('open "' + p + '"');
  }
  return { success: true };
};

// =============================================================================
// Custom tool order -- lets the user drag-and-drop reorder each category's
// vertical tool list (main.tsx's Reorder.Group) instead of being stuck with
// whatever order TOOLS is declared in there. Shell-level preference, not
// tied to OV Library specifically (unlike campaigns/thumbnail overrides
// above) -- grouped with Useful Folders since both are general app-shell
// features rather than one tool's own data. No ScriptUI equivalent exists
// to stay compatible with (the original toolbox's tabs weren't
// reorderable), so this is CEP-only, but still persisted via the same
// app.settings section as everything else for consistency.
// =============================================================================
const TOOL_ORDER_SETTINGS_SECTION = "XYiToolbox";
const TOOL_ORDER_KEY = "OVToolOrder";

interface ToolOrderEntry {
  categoryId: string;
  toolIds: string[];
}

function loadToolOrderRaw(): ToolOrderEntry[] {
  const out: ToolOrderEntry[] = [];
  if (app.settings.haveSetting(TOOL_ORDER_SETTINGS_SECTION, TOOL_ORDER_KEY)) {
    const raw = app.settings.getSetting(TOOL_ORDER_SETTINGS_SECTION, TOOL_ORDER_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length >= 2) out.push({ categoryId: parts[0], toolIds: parts[1].split(",") });
    }
  }
  return out;
}

function saveToolOrderRaw(arr: ToolOrderEntry[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const categoryId = String(arr[i].categoryId).replace(/[\t\n\r]/g, " ");
    lines.push(categoryId + "\t" + arr[i].toolIds.join(","));
  }
  app.settings.saveSetting(TOOL_ORDER_SETTINGS_SECTION, TOOL_ORDER_KEY, lines.join("\n"));
}

// One round-trip for every category's order at once (there are only 4),
// rather than a separate call per category -- main.tsx loads this once at
// app mount, before any category screen is even visible.
export const loadAllToolOrders = (): Record<string, string[]> => {
  const all = loadToolOrderRaw();
  const out: Record<string, string[]> = {};
  for (let i = 0; i < all.length; i++) {
    out[all[i].categoryId] = all[i].toolIds;
  }
  return out;
};

export const saveToolOrder = (categoryId: string, toolIds: string[]): Result => {
  try {
    const all = loadToolOrderRaw();
    let found = false;
    for (let i = 0; i < all.length; i++) {
      if (all[i].categoryId === categoryId) {
        all[i].toolIds = toolIds;
        found = true;
        break;
      }
    }
    if (!found) all.push({ categoryId: categoryId, toolIds: toolIds });
    saveToolOrderRaw(all);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Home-screen favorites (pinned tools) -- same bucket as tool order above:
// a general app-shell preference, not tied to one specific tool's own data.
// No ScriptUI equivalent -- the original toolbox had no favorites/pinning
// concept at all -- so this is CEP-only, but still persisted via the same
// app.settings section as everything else for consistency. Key keeps the
// "OV" prefix for the same historical reason TOOL_ORDER_KEY does (see its
// own comment above) -- this toolbox's settings all started life under OV
// Library specifically, before it became one tool among many.
// =============================================================================
const FAVORITES_SETTINGS_SECTION = "XYiToolbox";
const FAVORITES_KEY = "OVFavoriteTools";

function loadFavoriteToolsRaw(): string[] {
  if (app.settings.haveSetting(FAVORITES_SETTINGS_SECTION, FAVORITES_KEY)) {
    const raw = app.settings.getSetting(FAVORITES_SETTINGS_SECTION, FAVORITES_KEY);
    if (raw === "") return [];
    return raw.split("\t");
  }
  return [];
}

// Plain array, no Result wrapper -- same reasoning as loadAllToolOrders
// above: main.tsx just no-ops on a thrown/missing value (an empty
// favorites list is a perfectly fine default), so there's nothing a
// {success, error} shape would add here.
export const loadFavoriteTools = (): string[] => {
  return loadFavoriteToolsRaw();
};

export const saveFavoriteTools = (toolIds: string[]): Result => {
  try {
    const cleaned: string[] = [];
    for (let i = 0; i < toolIds.length; i++) {
      cleaned.push(String(toolIds[i]).replace(/[\t\n\r]/g, " "));
    }
    app.settings.saveSetting(FAVORITES_SETTINGS_SECTION, FAVORITES_KEY, cleaned.join("\t"));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// UI sound effects (sfx.ts) -- persisted on/off toggle, same section as
// every other app-shell preference. Defaults to OFF (loadSfxEnabled returns
// false when the setting has never been saved) -- a shared studio-floor tool
// making noise by default is presumptuous; this is opt-in.
// =============================================================================
const SFX_SETTINGS_SECTION = "XYiToolbox";
const SFX_ENABLED_KEY = "SfxEnabled";

export const loadSfxEnabled = (): boolean => {
  if (app.settings.haveSetting(SFX_SETTINGS_SECTION, SFX_ENABLED_KEY)) {
    return app.settings.getSetting(SFX_SETTINGS_SECTION, SFX_ENABLED_KEY) === "1";
  }
  return false;
};

export const saveSfxEnabled = (enabled: boolean): Result => {
  try {
    app.settings.saveSetting(SFX_SETTINGS_SECTION, SFX_ENABLED_KEY, enabled ? "1" : "0");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Master volume, 0-1. Defaults to 1 (each preset's own gain in sfx.ts was
// already tuned quiet -- 1 here means "use those tuned values as-is", not
// "full blast") when never saved.
const SFX_VOLUME_KEY = "SfxVolume";

export const loadSfxVolume = (): number => {
  if (app.settings.haveSetting(SFX_SETTINGS_SECTION, SFX_VOLUME_KEY)) {
    const raw = parseFloat(app.settings.getSetting(SFX_SETTINGS_SECTION, SFX_VOLUME_KEY));
    if (!isNaN(raw)) return Math.max(0, Math.min(1, raw));
  }
  return 1;
};

export const saveSfxVolume = (volume: number): Result => {
  try {
    const clamped = Math.max(0, Math.min(1, volume));
    app.settings.saveSetting(SFX_SETTINGS_SECTION, SFX_VOLUME_KEY, String(clamped));
    return { success: true };
  } catch (e) {
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
function hasIsolatedOvToken(name: string): boolean {
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
function losOpenForEdit(file: File): Project | null {
  if (hasIsolatedOvToken(file.name)) return losSafeOpenMasterCopy(file);
  return app.open(file);
}

function losFindBestComponentFile(targetName: string, candidates: File[]): File | null {
  const ACCEPT_THRESHOLD = 0.01;
  const NUMERIC_BOOST = 0.25;
  const SUBSTRING_BOOST = 0.15;

  function norm(s: string): string {
    if (!s) return "";
    s = (s + "").toLowerCase();
    s = s.replace(/\.[a-z0-9]{1,5}$/i, "");
    s = s.replace(/[^a-z0-9]+/g, " ");
    s = s.replace(/\s+/g, " ");
    return s.replace(/^\s+|\s+$/g, "");
  }
  function splitDigitsAlpha(tok: string): string[] {
    const out = [tok];
    let m = tok.match(/^([0-9]+)([a-z]+)$/i);
    if (m) return [tok, m[1], m[2]];
    m = tok.match(/^([a-z]+)([0-9]+)$/i);
    if (m) return [tok, m[1], m[2]];
    return out;
  }
  function tokenizeSimple(s: string): string[] {
    const base = norm(s);
    const raw = base ? base.split(" ") : [];
    const enriched: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      const parts = splitDigitsAlpha(raw[i]);
      for (let j = 0; j < parts.length; j++) if (parts[j]) enriched.push(parts[j]);
    }
    const seen: Record<string, boolean> = {};
    const tokens: string[] = [];
    for (let k = 0; k < enriched.length; k++) {
      if (!seen[enriched[k]]) {
        seen[enriched[k]] = true;
        tokens.push(enriched[k]);
      }
    }
    return tokens;
  }
  function numbersIn(s: string): string[] {
    const m = (s + "").match(/\d+/g);
    if (!m) return [];
    const seen: Record<string, boolean> = {};
    const arr: string[] = [];
    for (let i = 0; i < m.length; i++) {
      if (!seen[m[i]]) {
        seen[m[i]] = true;
        arr.push(m[i]);
      }
    }
    return arr;
  }

  function jaccardHybrid(inputA: string, inputB: string): number {
    const JACCARD_WEIGHT = 0.7;
    const LEVENSHTEIN_WEIGHT = 0.3;
    function tokenize(filename: string): string[] {
      const cleanName = String(filename || "")
        .replace(/\.aep|_V\d+/gi, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2");
      const tokens = cleanName.toLowerCase().split(/[_\-\s]+/);
      const stopWords = ["dgtl", "digital", "master", "ov", "en", "the"];
      const finalTokens: string[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token && stopWords.indexOf(token) === -1 && !/^\d+x\d+$/.test(token)) finalTokens.push(token);
      }
      return finalTokens;
    }
    function levenshteinDistance(s: string, t: string): number {
      s = String(s || "");
      t = String(t || "");
      if (!s.length) return t.length;
      if (!t.length) return s.length;
      const arr: number[][] = [];
      for (let i = 0; i <= t.length; i++) {
        arr[i] = [];
        arr[i][0] = i;
      }
      for (let j = 0; j <= s.length; j++) arr[0][j] = j;
      for (let i = 1; i <= t.length; i++) {
        for (let j = 1; j <= s.length; j++) {
          const cost = s.charAt(j - 1) === t.charAt(i - 1) ? 0 : 1;
          let min = arr[i - 1][j] + 1;
          if (arr[i][j - 1] + 1 < min) min = arr[i][j - 1] + 1;
          if (arr[i - 1][j - 1] + cost < min) min = arr[i - 1][j - 1] + cost;
          arr[i][j] = min;
        }
      }
      return arr[t.length][s.length];
    }
    const tokensA = tokenize(inputA);
    const tokensB = tokenize(inputB);
    if (!tokensA.length && !tokensB.length) return 0;
    const setA: Record<string, boolean> = {};
    const setB: Record<string, boolean> = {};
    for (let i = 0; i < tokensA.length; i++) setA[tokensA[i]] = true;
    for (let j = 0; j < tokensB.length; j++) setB[tokensB[j]] = true;
    let intersection = 0;
    let union = 0;
    for (const k in setA) {
      union++;
      if (setB[k]) intersection++;
    }
    for (const k in setB) {
      if (!setA[k]) union++;
    }
    const jaccardScore = union === 0 ? 0 : intersection / union;
    let finalScore = jaccardScore;
    const cleanStrA = tokensA.join(" ");
    const cleanStrB = tokensB.join(" ");
    const maxLen = Math.max(cleanStrA.length, cleanStrB.length);
    if (maxLen > 0) finalScore = jaccardScore * JACCARD_WEIGHT + (1 - levenshteinDistance(cleanStrA, cleanStrB) / maxLen) * LEVENSHTEIN_WEIGHT;
    return finalScore;
  }

  function jaroWinkler(s1: string, s2: string): number {
    s1 = String(s1 || "");
    s2 = String(s2 || "");
    if (s1 === s2) return 1;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0;
    const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
    const matches1: boolean[] = new Array(len1);
    const matches2: boolean[] = new Array(len2);
    let m = 0;
    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, len2);
      for (let j = start; j < end; j++) {
        if (!matches2[j] && s1.charAt(i) === s2.charAt(j)) {
          matches1[i] = true;
          matches2[j] = true;
          m++;
          break;
        }
      }
    }
    if (m === 0) return 0;
    let t = 0;
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (matches1[i]) {
        while (!matches2[k]) k++;
        if (s1.charAt(i) !== s2.charAt(k)) t++;
        k++;
      }
    }
    t = t / 2.0;
    let jaro = (m / len1 + m / len2 + (m - t) / m) / 3.0;
    if (jaro > 0.7) {
      let prefix = 0;
      for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
        if (s1.charAt(i) === s2.charAt(i)) prefix++;
        else break;
      }
      jaro += prefix * 0.1 * (1 - jaro);
    }
    return jaro;
  }

  const targetNorm = norm(targetName);
  if (!targetNorm) return null;
  const targetNums = numbersIn(targetName);

  for (let e = 0; e < candidates.length; e++) {
    if (norm(candidates[e].name) === targetNorm) return candidates[e];
  }

  let best: File | null = null;
  let bestScore = -1;
  for (let c = 0; c < candidates.length; c++) {
    const cname = candidates[c].name;
    const cbase = norm(cname);
    const jaccardLevScore = jaccardHybrid(targetName, cname);
    const jwScore = jaroWinkler(targetNorm, cbase);
    const blendedBaseScore = jwScore * 0.6 + jaccardLevScore * 0.4;

    let substringBonus = 0;
    if (cbase.indexOf(targetNorm) !== -1 || targetNorm.indexOf(cbase) !== -1) substringBonus = SUBSTRING_BOOST;

    const cNums = numbersIn(cname);
    let numInter = 0;
    if (targetNums.length && cNums.length) {
      for (let a = 0; a < targetNums.length; a++) {
        for (let b = 0; b < cNums.length; b++) {
          if (targetNums[a] === cNums[b]) {
            numInter++;
            break;
          }
        }
      }
    }
    const numRatio = targetNums.length ? numInter / targetNums.length : 0;
    const score = blendedBaseScore + NUMERIC_BOOST * numRatio + substringBonus;
    if (score > bestScore) {
      bestScore = score;
      best = candidates[c];
    }
  }
  if (best && bestScore >= ACCEPT_THRESHOLD) return best;
  return best;
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
          const compMatch = losFindBestComponentFile(row.name, componentsFiles);
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
const DELIVERY_TEMPLATE_BITRATES_MBPS = [2.8, 5, 7, 8, 10, 12, 14, 16, 18, 20, 25, 26, 30, 36, 50];
const DELIVERY_AUDIO_RESERVE_KBPS = 192;

function deliveryFormatTemplateName(mbpsVal: number): string {
  // Most templates use "MBPS" except 50 which uses "Mbps" -- handle both.
  if (mbpsVal === 50) return "H264_" + String(mbpsVal) + "Mbps_MOS";
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

// =============================================================================
// Edit Generator -- ported from XYi_Toolbox.jsx's "Edit Generator" tab
// (EdGen()/gate(), backed by XYi_EdGen.jsx's EditGen()/EditGenNoFirst()).
// Auto-arranges the currently SELECTED layers into a cutdown of a given
// duration, with optional opacity fade and scale growth.
//
// **Bug fix vs. the original**: `XYi_EdGen.jsx` set `var excl =
// checkbox3.text` (the checkbox's STRING LABEL, not the checkbox object)
// and then checked `excl.value` -- always `undefined` on a string, so the
// "Exclude First Image / Sequence" checkbox never actually did anything;
// `gate()` always ran the plain `EditGen()` path. Fixed here to take
// `excludeFirst` as its own real boolean parameter, same class of fix as
// Rename Main Comp's regex mismatch earlier this session.
// =============================================================================
export const editGeneratorArrange = (duration: number, useFade: boolean, fadeDuration: number, useScale: boolean, scalePercent: number, excludeFirst: boolean): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
    const selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return { success: false, error: "Please select layers first." };

    app.beginUndoGroup("XYi Edit Generator");
    const frameRate = comp.frameRate;
    const percentageCalc = Math.floor(scalePercent) / 100;

    for (let i = 0; i < selectedLayers.length; i++) selectedLayers[i].startTime = 0;

    if (!excludeFirst) {
      for (let i = 0; i < selectedLayers.length; i++) {
        const layer = selectedLayers[i];
        const selectScale = layer.property("Scale") as Property;
        const startPoint = layer.inPoint;
        const spec = (duration / selectedLayers.length) * i;
        const specB = (duration / selectedLayers.length) * (i + 1);
        const scaleA = (selectScale.value as number[])[0];

        if (useFade) {
          (layer.property("Opacity") as Property).setValueAtTime(startPoint, 0);
          (layer.property("Opacity") as Property).setValueAtTime(startPoint + Math.ceil(fadeDuration), 100);
        }
        layer.startTime = Math.floor((spec - startPoint) * frameRate) / frameRate;
        layer.outPoint = Math.floor((startPoint + (specB - startPoint)) * frameRate) / frameRate;
        if (useFade) layer.outPoint = specB + Math.ceil(fadeDuration);
        if (useScale) {
          selectScale.setValueAtTime(layer.inPoint, [scaleA, scaleA, scaleA]);
          selectScale.setValueAtTime(layer.outPoint, [scaleA + scaleA * percentageCalc, scaleA + scaleA * percentageCalc, scaleA + scaleA * percentageCalc]);
        }
      }
    } else {
      const fade = 1 * fadeDuration;
      const newLength = (duration - fade * (selectedLayers.length - 1)) / selectedLayers.length;
      for (let i = 0; i < selectedLayers.length; i++) {
        const layer = selectedLayers[i];
        const selectScale = layer.property("Scale") as Property;
        const startPoint = layer.inPoint;
        const spec = (newLength + fade) * i - fade;
        const specB = (newLength + fade) * (i + 1) - fade;
        const scaleA = (selectScale.value as number[])[0];

        if (useFade && i > 0) {
          (layer.property("Opacity") as Property).setValueAtTime(Math.floor(startPoint * frameRate) / frameRate, 0);
          (layer.property("Opacity") as Property).setValueAtTime(Math.floor((startPoint + fade) * frameRate) / frameRate, 100);
        }
        layer.startTime = Math.floor((spec - startPoint) * frameRate) / frameRate;
        if (layer.startTime < 0) layer.startTime = 0;
        layer.outPoint = Math.floor((startPoint + (specB - startPoint)) * frameRate) / frameRate;
        if (useFade) layer.outPoint = specB + fade;
        if (useScale) {
          selectScale.setValueAtTime(layer.inPoint, [scaleA, scaleA, scaleA]);
          selectScale.setValueAtTime(layer.outPoint, [scaleA + scaleA * percentageCalc, scaleA + scaleA * percentageCalc, scaleA + scaleA * percentageCalc]);
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
// Generate Cue Sheet -- ported from XYi_Toolbox.jsx's "Generate Cue Sheet"
// tab (CueSheeter()/CueSheetGen(), backed by XYi_Cue.jsx). Writes a
// comma-separated cue sheet (layer name + optional duration/footage-in-out/
// comp-in-out columns) to a .txt file on the Desktop, named after the
// active comp. **Also removes duplicate layers from the active comp as a
// side effect** -- this is the original's actual behavior (it identifies
// "duplicate" layers by an identical name+in/out-point signature and
// deletes all but the first), not something added in porting; the tool
// page should make this destructive side effect visible to the user.
// =============================================================================
interface CueSheetResult extends Result {
  filePath?: string;
}

export const generateCueSheet = (includeDuration: boolean, includeFootageInOut: boolean, includeCompInOut: boolean): CueSheetResult => {
  try {
    const activeItem = app.project.activeItem;
    if (!activeItem || !(activeItem instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };

    app.beginUndoGroup("XYi Generate Cue Sheet");
    const fpsComp = activeItem.frameRate;

    // Remove duplicate layers (identical name + footage-in/comp-out/comp-in signature).
    for (let x = 1; x <= activeItem.numLayers; x++) {
      const rIn = activeItem.layer(x).inPoint;
      const rOut = activeItem.layer(x).outPoint;
      const timeStart = timeToCurrentFormat(rIn, fpsComp);
      const timeEnd = timeToCurrentFormat(rOut, fpsComp);
      const footStart = timeToCurrentFormat(rIn - activeItem.layer(x).startTime, fpsComp);
      const xSig = activeItem.layer(x).name + "_" + footStart + "_" + timeEnd + "_" + timeStart;

      for (let i = 1; i <= activeItem.numLayers; i++) {
        const iIn = activeItem.layer(i).inPoint;
        const iOut = activeItem.layer(i).outPoint;
        const iTimeStart = timeToCurrentFormat(iIn, fpsComp);
        const iTimeEnd = timeToCurrentFormat(iOut, fpsComp);
        const iFootStart = timeToCurrentFormat(iIn - activeItem.layer(i).startTime, fpsComp);
        const iSig = activeItem.layer(i).name + "_" + iFootStart + "_" + iTimeEnd + "_" + iTimeStart;
        if (xSig === iSig && i !== x) activeItem.layer(i).remove();
      }
    }

    const myFileName = "Cue_Sheet_" + activeItem.name + ".txt";
    const myFilePath = "~/desktop/" + escape(myFileName);
    const myFile = new File(myFilePath);
    myFile.open("w");
    myFile.writeln("Cue Sheet for " + activeItem.name);
    myFile.writeln("");

    myFile.write("Track Name");
    if (includeDuration) myFile.write(", Duration");
    if (includeFootageInOut) myFile.write(", Footage In , Footage Out");
    if (includeCompInOut) myFile.write(", Comp In , Comp Out ");
    myFile.writeln("");

    for (let x = 1; x <= activeItem.numLayers; x++) {
      const layer = activeItem.layer(x);
      const rIn = layer.inPoint;
      const rOut = layer.outPoint;
      const timeStart = timeToCurrentFormat(rIn, fpsComp);
      const timeEnd = timeToCurrentFormat(rOut, fpsComp);
      const footStart = timeToCurrentFormat(rIn - layer.startTime, fpsComp);
      const footEnd = timeToCurrentFormat(rOut - layer.startTime, fpsComp);
      const durInOut = timeToCurrentFormat(rOut - rIn, fpsComp);

      myFile.write((layer as AVLayer).source ? (layer as AVLayer).source.name : layer.name);
      if (includeDuration) myFile.write(" , " + durInOut);
      if (includeFootageInOut) myFile.write(" , " + footStart + " , " + footEnd);
      if (includeCompInOut) myFile.write(" , " + timeStart + " , " + timeEnd);
      myFile.writeln("");
    }
    myFile.close();
    app.endUndoGroup();
    return { success: true, filePath: myFile.fsName };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Check -- ported from XYi_Toolbox.jsx's "Check" tab, a QC grab-bag.
// Aspect Ratio Rename, Effects Used, Comp / Footage Details, File Name
// Check, and Marker Comment Guide are all real. Render Check
// (RenderChecker(), XYi_Render_Check.jsx) is real too -- imports MOVs and
// matching images from two chosen folders into new comps, never touches
// an existing project file.
// =============================================================================
interface CheckMessageResult extends Result {
  message?: string;
}

// Ported from XYi_EffCheck.jsx -- read-only report, no undo group needed.
export const checkEffectsUsed = (): CheckMessageResult => {
  const comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
  const selectedLayers = comp.selectedLayers;
  if (selectedLayers.length === 0) return { success: false, error: "Please select one or more layers." };

  let message = "";
  for (let i = 0; i < selectedLayers.length; i++) {
    message += selectedLayers[i].index + ". " + selectedLayers[i].name + "\n";
    const effects = selectedLayers[i].property("Effects") as Property;
    for (let j = 0; j < effects.numProperties; j++) {
      message += (effects.property(j + 1) as Property).name + "\n";
    }
    message += "\n";
  }
  return { success: true, message: message.trim() };
};

// Ported from XYi_Aspect_Rename.jsx -- adds or strips a "_<ratio>_" prefix
// on every file in a chosen folder whose name contains a WIDTHxHEIGHT
// token. Renames files on disk (not project items) -- prompts its own
// folder picker rather than taking a path param, matching the original's
// single-button flow.
interface AspectRenameResult extends Result {
  added?: boolean;
  removed?: boolean;
}

export const checkAspectRatioRename = (): AspectRenameResult => {
  const folder = Folder.selectDialog("Select a folder to scan");
  if (!folder) return { success: false, error: "No folder selected." };

  const files = folder.getFiles();
  const pattern = /(\d+)x(\d+)/;
  const ratioPattern = /^_(\d+\.\d+)_/;
  let added = false;
  let removed = false;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!(file instanceof File)) continue;
    const fileName = file.name;
    const ratioMatch = fileName.match(ratioPattern);
    const resolutionMatch = fileName.match(pattern);

    if (ratioMatch && resolutionMatch) {
      file.rename(fileName.replace(ratioPattern, ""));
      removed = true;
    } else if (resolutionMatch) {
      const width = parseInt(resolutionMatch[1], 10);
      const height = parseInt(resolutionMatch[2], 10);
      const ratio = width / height;
      file.rename("_" + ratio.toFixed(2) + "_" + fileName);
      added = true;
    }
  }
  return { success: true, added, removed };
};

// Ported from XYi_CompCheck.jsx -- read-only report on every selected
// project item, no undo group needed.
export const checkCompFootageDetails = (): CheckMessageResult => {
  const sel = app.project.selection;
  if (sel.length === 0) return { success: false, error: "Please select compositions first." };

  let message = "";
  for (let i = 0; i < sel.length; i++) {
    const item = sel[i] as CompItem;
    const format = item.width > item.height ? "Landscape" : item.width < item.height ? "Portrait" : "Square";
    message +=
      "Comp name: " + item.name + "\n" +
      "Width: " + item.width + "  Height: " + item.height + "\n" +
      "Duration: " + item.duration + "  FPS: " + item.frameRate + "\n" +
      "Format: " + format + "\n\n";
  }
  return { success: true, message: message.trim() };
};

// Ported from XYi_Cheeky_N_Check.jsx's usage in FilNameChe() -- reuses the
// SAME nameGeneratorParse() helper Name Generator's "Detect Name" uses,
// just against a browsed file's name instead of a selected project item's.
export const checkFileNameCheck = (): CheckMessageResult => {
  const file = File.openDialog("Select a file", "*.*", false);
  if (!file) return { success: false, error: "No file selected." };
  const parsed = nameGeneratorParse(file.name);
  return {
    success: true,
    message: "Film Title: " + parsed.filmTitle + "\nArtwork: " + parsed.artworkType + "\nCampaign: " + parsed.campaign + "\nTerritory: " + parsed.territory + "\nInternational: " + parsed.isInternational,
  };
};

// Ported from XYi_Markers.jsx -- read-only report, writes every comp/layer
// marker's comment across the whole project to a .txt file on the Desktop.
export const checkMarkerGuide = (): CheckMessageResult => {
  const markerComments: string[] = [];
  for (let i = 1; i <= app.project.items.length; i++) {
    const item = app.project.items[i];
    if (!(item instanceof CompItem)) continue;
    for (let j = 1; j <= item.numLayers; j++) {
      const layer = item.layer(j);
      const markerProp = layer.property("Marker") as Property;
      if (markerProp && markerProp.numKeys > 0) {
        for (let k = 1; k <= markerProp.numKeys; k++) {
          const marker = markerProp.keyValue(k) as MarkerValue;
          markerComments.push("Comp: " + item.name + "\nLayer " + j + " Marker " + k + ":\n" + marker.comment + "\n\n");
        }
      }
    }
    if (item.markerProperty.numKeys > 0) {
      for (let m = 1; m <= item.markerProperty.numKeys; m++) {
        const compMarker = item.markerProperty.keyValue(m) as MarkerValue;
        markerComments.push("Comp: " + item.name + " | Composition Marker " + m + ":\n" + compMarker.comment + "\n\n");
      }
    }
  }
  const file = new File("~/Desktop/marker_comments.txt");
  file.open("w");
  file.write(markerComments.join("\n"));
  file.close();
  return { success: true, message: "Marker comments written to " + file.fsName };
};

// Ported from XYi_Render_Check.jsx's RenderChecker(). Imports every .mov in
// a chosen folder, wraps each in its own comp, adds three named markers at
// the given timecodes, then (if a second folder is chosen) imports
// matching PDF/JPEG/PNG files from it and layers them into comps whose
// name shares a WIDTHxHEIGHT token with the image. Only ever imports into
// the CURRENT project -- no existing project file is opened.
export const checkRenderCheck = (marker7: string, marker8: string, marker9: string): Result => {
  try {
    const movFolder = Folder.selectDialog("Select a folder with MOV files");
    if (!movFolder) return { success: false, error: "No folder selected." };

    app.beginUndoGroup("XYi Render Check");
    const movFiles = movFolder.getFiles("*.mov") as File[];
    const importedMOVs: AVItem[] = [];
    for (let i = 0; i < movFiles.length; i++) {
      const importOptions = new ImportOptions(movFiles[i]);
      if (importOptions.canImportAs(ImportAsType.FOOTAGE)) {
        importedMOVs.push(app.project.importFile(importOptions) as AVItem);
      }
    }

    const comps: CompItem[] = [];
    let compFrameRate = 30;
    for (let j = 0; j < importedMOVs.length; j++) {
      const mov = importedMOVs[j];
      compFrameRate = mov.frameRate;
      const comp = app.project.items.addComp(mov.name, mov.width, mov.height, 1, mov.duration, mov.frameRate);
      comp.layers.add(mov);
      comps.push(comp);
    }

    if (comps.length > 0) {
      const t1 = marker7.split(":");
      const t2 = marker8.split(":");
      const t3 = marker9.split(":");
      const marker7Time = parseInt(t1[2], 10) + parseInt(t1[3], 10) / compFrameRate;
      const marker8Time = parseInt(t2[2], 10) + parseInt(t2[3], 10) / compFrameRate;
      const marker9Time = parseInt(t3[2], 10) + parseInt(t3[3], 10) / compFrameRate;
      const markers = [
        { name: "7", time: marker7Time },
        { name: "8", time: marker8Time },
        { name: "9", time: marker9Time },
      ];
      for (let k = 0; k < comps.length; k++) {
        for (let m = 0; m < markers.length; m++) {
          comps[k].markerProperty.setValueAtTime(markers[m].time, new MarkerValue(markers[m].name));
        }
      }
    }

    const imageFolder = Folder.selectDialog("Select a folder with PDF, JPEG, and PNG files");
    if (imageFolder) {
      function getAllFiles(folder: Folder): File[] {
        let fileArray: File[] = [];
        const files = folder.getFiles();
        for (let i = 0; i < files.length; i++) {
          if (files[i] instanceof Folder) fileArray = fileArray.concat(getAllFiles(files[i] as Folder));
          else if (files[i] instanceof File && /\.(pdf|jpe?g|png)$/i.test(files[i].name)) fileArray.push(files[i] as File);
        }
        return fileArray;
      }
      const imageFiles = getAllFiles(imageFolder);
      const importedImages: AVItem[] = [];
      for (let l = 0; l < imageFiles.length; l++) {
        const importOptions = new ImportOptions(imageFiles[l]);
        if (importOptions.canImportAs(ImportAsType.FOOTAGE)) {
          importedImages.push(app.project.importFile(importOptions) as AVItem);
        }
      }

      const regex = /(\d+)x(\d+)/;
      function extractDimensions(name: string): string | null {
        const match = name.match(regex);
        return match ? match[0] : null;
      }

      for (let n = 0; n < comps.length; n++) {
        const comp = comps[n];
        const movDimensions = extractDimensions(comp.name);
        if (!movDimensions) continue;
        for (let p = 0; p < importedImages.length; p++) {
          if (movDimensions === extractDimensions(importedImages[p].name)) {
            const imageLayer = comp.layers.add(importedImages[p]);
            imageLayer.startTime = 0;
          }
        }
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

const TS_TERRITORIES: string[] = [
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
// CSV Localiser -- ported from toolset/XYi_Campaign_CSV.jsx's campLocCSV(),
// wired to the "CSV Localiser" tab's "Run CSV Localiser" button. Takes
// pasted CSV text (a [METADATA]/[/METADATA] block with Territory:/Batch:/
// Source Folder: lines, then Artwork/Campaign/Size/Duration rows), scans an
// AEP source path for the best-matching master per row via the SAME
// scanMastersForBestMatch() Campaign Localiser uses, then generates a
// localised comp per row.
//
// **This one was ALREADY copy-first in the original** -- unlike Campaign
// Localiser (a confirmed, deliberate exception that opens the matched
// master directly), XYi_Campaign_CSV.jsx copies the master to the
// destination filename FIRST and only ever opens that copy
// (`masterFile.copy(workingCopy.fsName)` then `app.open(workingCopy)`).
// No safety patch was needed here; this is actually the reference
// copy-first pattern this whole project's core safety constraint is
// modeled on. Ported with the same alert()-per-row-failure /
// alert()-on-final-count behavior as LOS Tools, for the same reason: the
// user asked for exact fidelity on tools like this, not the rest of this
// port's usual {success,error}-return convention.
// =============================================================================
const CSV_LOC_SETTINGS_SECTION = "XYiToolbox";
const CSV_LOC_LAST_PATH_KEY = "CSVLocLastPath";

export const csvLocaliserLoadLastPath = (): string | null => {
  if (app.settings.haveSetting(CSV_LOC_SETTINGS_SECTION, CSV_LOC_LAST_PATH_KEY)) {
    return app.settings.getSetting(CSV_LOC_SETTINGS_SECTION, CSV_LOC_LAST_PATH_KEY);
  }
  return null;
};

// Exact prompt text from the tab's own Browse button (CSVLocBrowseBut) --
// deliberately not reusing selectMastersFolder()'s differently-worded
// prompt from OV Library.
export const selectCsvLocaliserAepFolder = (): string | null => {
  const folder = Folder.selectDialog("Select the AEP source folder:");
  return folder ? folder.fsName : null;
};

function csvLocSaveLastPath(path: string): void {
  if (path !== "") app.settings.saveSetting(CSV_LOC_SETTINGS_SECTION, CSV_LOC_LAST_PATH_KEY, path);
}

function csvLocTrim(str: string): string {
  return String(str).replace(/^\s+|\s+$/g, "");
}

// Ported 1:1 from campLocCSV()'s nameGen() -- duplicates the matched master
// comp, rescales it via the same null-parent technique as DRQR/Scale
// Composition, propagates the new size into every V## comp under "Main",
// runs Cheeky DT Check + DRQR automatically on the new comp, removes the
// original pre-localise master comp, then saves the (already-a-copy)
// project in place and closes it.
function csvLocNameGen(myComp: CompItem, width: number, height: number, newCompName: string, plm: "PORTRAIT" | "LANDSCAPE"): void {
  const scanRegV = /V\d\d/;
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

  // The project was opened from a working copy already sitting at the
  // correct destination filename (copied from the master before opening),
  // so just save in place -- matches original exactly.
  app.project.save();
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  app.newProject();
}

export const csvLocaliserRun = (mastersPath: string, rawCsvText: string, skipExisting: boolean): Result => {
  csvLocSaveLastPath(mastersPath);

  if (rawCsvText === "") {
    alert("Please paste the CSV data first.");
    return { success: false, error: "No CSV data pasted." };
  }

  let territory = "";
  let batchName = "";
  let sourceFolder = "";
  const lines = rawCsvText.split(/\r\n|\n|\r/);

  for (let m = 0; m < lines.length; m++) {
    const metaLine = csvLocTrim(lines[m]);
    const tLineMatch = metaLine.match(/^Territory:\s*(.*)$/i);
    if (tLineMatch) {
      territory = csvLocTrim(tLineMatch[1]);
      continue;
    }
    const bLineMatch = metaLine.match(/^Batch:\s*(.*)$/i);
    if (bLineMatch) {
      batchName = csvLocTrim(bLineMatch[1]);
      continue;
    }
    const fLineMatch = metaLine.match(/^Source Folder:\s*(.*)$/i);
    if (fLineMatch) {
      sourceFolder = csvLocTrim(fLineMatch[1]);
      continue;
    }
  }

  // Resolve the output folder automatically: <Source Folder>/AE/<Batch Name>,
  // creating either level if it doesn't exist yet. Only falls back to a
  // manual picker if that folder is missing or wasn't in the CSV metadata.
  let outputFolder: Folder;
  if (sourceFolder !== "") {
    const sourceFolderObj = new Folder(sourceFolder);
    if (!sourceFolderObj.exists) {
      alert("The Source Folder from the CSV couldn't be found on disk:\n" + sourceFolder + "\n\nPlease select the output folder manually.");
      const picked = Folder.selectDialog("Please select a folder to save the Output Files:");
      if (!picked) return { success: false, error: "No output folder selected." };
      outputFolder = picked;
    } else {
      const aeFolder = new Folder(sourceFolderObj.fsName + "/AE");
      if (!aeFolder.exists) aeFolder.create();
      if (batchName !== "") {
        outputFolder = new Folder(aeFolder.fsName + "/" + batchName);
        if (!outputFolder.exists) outputFolder.create();
      } else {
        outputFolder = aeFolder;
      }
    }
  } else {
    alert("No Source Folder was found in the CSV metadata. Please select the output folder manually.");
    const picked = Folder.selectDialog("Please select a folder to save the Output Files:");
    if (!picked) return { success: false, error: "No output folder selected." };
    outputFolder = picked;
  }

  // Convert the territory name into its country code prefix (e.g. "Spain"
  // -> "ES") -- reuses the already-ported getTerritoryCountryCode() rather
  // than duplicating XYi_Cheeky_InvT_Check.jsx's getCountryCode() a second
  // time (same table, same lookup direction).
  let territoryCode = "XX";
  if (territory !== "") {
    territoryCode = getTerritoryCountryCode(territory) || "XX";
  }

  let rowsAttempted = 0;
  let isMetadata = false;
  const regex = /\d*[x]\d*/;

  for (let l = 0; l < lines.length; l++) {
    const currentLine = csvLocTrim(lines[l]);
    if (currentLine === "") continue;
    if (currentLine.indexOf("[METADATA]") !== -1) {
      isMetadata = true;
      continue;
    }
    if (currentLine.indexOf("[/METADATA]") !== -1) {
      isMetadata = false;
      continue;
    }
    if (isMetadata) continue;
    if (currentLine.match(/^"?Artwork/i)) continue;

    rowsAttempted++;

    try {
      const cleanLine = currentLine.replace(/"/g, "");
      const texLoc = cleanLine.split(",");
      if (texLoc.length < 4) continue;

      const sizeArr = csvLocTrim(texLoc[2]).split("x");
      const campaign = csvLocTrim(texLoc[1]).toUpperCase();
      const width = Math.floor(Number(sizeArr[0]));
      const height = Math.floor(Number(sizeArr[1]));
      const size = String(width) + "x" + String(height);
      const duration = csvLocTrim(texLoc[3]) + "sec";

      const bestMatch = scanMastersForBestMatch(mastersPath, campaign, size, duration);
      if (!bestMatch) continue;
      const textMaster = bestMatch.fsName;

      const linesMaster = textMaster.split("/");
      let masterName = linesMaster[linesMaster.length - 1];
      const ratioPattern = /^_(\d+\.\d+)_/;
      if (ratioPattern.test(masterName)) {
        masterName = masterName.split(ratioPattern)[2];
      }

      const masterSizeMatch = String(masterName.match(regex));
      const masterSizeParts = masterSizeMatch.split("x");
      const masterWidth = Math.floor(Number(masterSizeParts[0]));
      const masterHeight = Math.floor(Number(masterSizeParts[1]));
      const plm: "PORTRAIT" | "LANDSCAPE" = masterWidth < masterHeight ? "PORTRAIT" : "LANDSCAPE";

      const scanFilmTitle = masterName.split("_")[0];
      const scanIndo = masterName.split("_")[1];
      const scanArtworkType = csvLocTrim(texLoc[0]);
      const batchStr = batchName !== "" ? "_" + batchName : "";

      const newCompName = scanFilmTitle + "_" + scanIndo + "_DGTL_" + scanArtworkType + "_" + campaign + "_" + width + "x" + height + "_" + duration + batchStr + "_" + territoryCode;

      const outputFile = new File(outputFolder.toString() + "/" + newCompName + "_V01.aep");
      if (skipExisting && outputFile.exists) {
        alert(newCompName + ".aep already exists. Skipping.");
        continue;
      }

      // Copy the master .aep to the destination first, then open the COPY.
      // The original master file is never opened, so it stays untouched.
      const masterFile = new File(textMaster);
      const workingCopy = new File(outputFolder.toString() + "/" + newCompName + "_V01.aep");
      if (!masterFile.copy(workingCopy.fsName)) {
        throw new Error("Could not copy master file to destination: " + workingCopy.fsName);
      }

      const proj = app.open(workingCopy);

      let myComp: CompItem = proj.activeItem as CompItem;
      const masterStem = String(masterName.split(".")[0]).replace(/_V\d+$/, "");
      for (let i = 1; i <= proj.numItems; i++) {
        const item = proj.item(i);
        if (item instanceof CompItem && item.name === masterStem) {
          myComp = item;
        }
      }

      csvLocNameGen(myComp, width, height, newCompName, plm);
    } catch (err) {
      alert("Row " + rowsAttempted + " failed: " + err.toString());
    }
  }

  alert("CSV Import Complete! Rows attempted: " + rowsAttempted);
  return { success: true };
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
