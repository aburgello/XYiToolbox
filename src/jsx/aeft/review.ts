// =============================================================================
// src/jsx/aeft/review.ts -- backend for the Review-category tool (OV
// Library, embedded inside ReviewHub.tsx). Split out of aeft.ts, which is
// now a thin barrel -- see its header comment for context.
// =============================================================================
import { Result, SETTINGS_SECTION, decode } from "./shared";
import { getMastersIndex, pickBestMasterFromIndex, mastersSkipFolder, mastersCanon, parseFilenameMeta, MasterIndexEntry, multipleMasterOptions, MAX_DURATION_MULTIPLE } from "./tools";



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

export interface RenderEntry {
  stem: string;
  path: string;
}
const CAMPAIGNS_KEY = "OVLibCampaigns";
// The campaign OV Library reopens on. Campaigns are stored in the order they
// were ADDED, so defaulting to the first one meant always landing on the
// oldest campaign on the machine and hand-picking the current one every time.
// Deliberately NOT in team.ts's PROFILE_KEYS: which campaign you had open is
// per-machine state like usage history, not a panel preference worth carrying
// to someone else's setup.
const LAST_CAMPAIGN_KEY = "OVLibLastCampaign";

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

// Returns "" when nothing has been remembered yet -- the caller falls back to
// the most recently ADDED campaign rather than the first one.
export const loadLastCampaign = (): string => {
  try {
    if (!app.settings.haveSetting(SETTINGS_SECTION, LAST_CAMPAIGN_KEY)) return "";
    return app.settings.getSetting(SETTINGS_SECTION, LAST_CAMPAIGN_KEY) || "";
  } catch (e) {
    return "";
  }
};

export const saveLastCampaign = (name: string): Result => {
  try {
    app.settings.saveSetting(SETTINGS_SECTION, LAST_CAMPAIGN_KEY, name == null ? "" : String(name));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
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
    // Don't leave the reopen-on key pointing at a campaign that no longer
    // exists -- the frontend would fall through to its default anyway, but a
    // stale name here reads as a bug the next time anyone looks at it.
    if (loadLastCampaign() === name) saveLastCampaign("");
    clearCampaignBanner(name);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Campaign hero banner ---------------------------------------------
// The banner behind the campaign title normally borrows whichever creative
// thumbnail is in play, which makes it change as you click around and gives
// a campaign no identity of its own. This pins one file per campaign.
//
// Unlike OVLibThumbOverrides, this one is SHARED: teamShareCampaign() sends
// it with the campaign and teamSyncShared() applies it, so a campaign set up
// once looks the same on everyone's panel. That is only meaningful while the
// path resolves on every machine -- i.e. a file on the NAS, not on someone's
// Desktop. Nothing enforces that (there is no reliable "is this a shared
// volume" test across Mac and Windows), so a local path shares fine and
// simply falls back to the automatic banner for everyone else, which is the
// graceful failure rather than a broken image.
const CAMPAIGN_BANNER_KEY = "OVLibCampaignBanners";

interface CampaignBanner {
  campaign: string;
  path: string;
}

function loadCampaignBannersRaw(): CampaignBanner[] {
  const out: CampaignBanner[] = [];
  if (app.settings.haveSetting(SETTINGS_SECTION, CAMPAIGN_BANNER_KEY)) {
    const raw = app.settings.getSetting(SETTINGS_SECTION, CAMPAIGN_BANNER_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length >= 2) out.push({ campaign: parts[0], path: parts[1] });
    }
  }
  return out;
}

function saveCampaignBannersRaw(arr: CampaignBanner[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const c = String(arr[i].campaign).replace(/[\t\n\r]/g, " ");
    const p = String(arr[i].path).replace(/[\t\n\r]/g, " ");
    lines.push(c + "\t" + p);
  }
  app.settings.saveSetting(SETTINGS_SECTION, CAMPAIGN_BANNER_KEY, lines.join("\n"));
}

// "" when this campaign has no pinned banner -- the frontend falls back to
// its creative-thumbnail heuristic.
export const loadCampaignBanner = (campaign: string): string => {
  try {
    const all = loadCampaignBannersRaw();
    for (let i = 0; i < all.length; i++) {
      if (all[i].campaign === campaign) return all[i].path;
    }
    // Exact first; then case/whitespace-insensitive. OV Library and the
    // Localise tools keep two campaign lists (OVLibCampaigns / LocLibCampaigns)
    // and pairing leaves an existing name alone, so "Forgotten Island" in one
    // can be "FORGOTTEN ISLAND" in the other -- the same job, one banner.
    const want = String(campaign).replace(/^\s+|\s+$/g, "").toLowerCase();
    for (let j = 0; j < all.length; j++) {
      if (String(all[j].campaign).replace(/^\s+|\s+$/g, "").toLowerCase() === want) return all[j].path;
    }
    return "";
  } catch (e) {
    return "";
  }
};

export const setCampaignBanner = (campaign: string, path: string): Result => {
  try {
    if (!campaign || !path) return { success: false, error: "No campaign or file given." };
    const all = loadCampaignBannersRaw();
    let found = false;
    for (let i = 0; i < all.length; i++) {
      if (all[i].campaign === campaign) {
        all[i].path = path;
        found = true;
        break;
      }
    }
    if (!found) all.push({ campaign: campaign, path: path });
    saveCampaignBannersRaw(all);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const clearCampaignBanner = (campaign: string): Result => {
  try {
    const remaining = loadCampaignBannersRaw().filter((b) => b.campaign !== campaign);
    saveCampaignBannersRaw(remaining);
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
      // DUCK-TYPED, not instanceof: two accesses to the same AE object return
      // different wrappers, so instanceof against a host class is banned
      // (CLAUDE.md section 2). A Folder is the thing that can list itself.
      if (typeof (items[i] as Folder).getFiles === "function") {
        // mastersSkipFolder, shared with buildMastersIndex, instead of the
        // exact lowercase compare this used to do -- `_Old` and `_Archive` are
        // the studio's actual casing and never matched, so this walked the
        // archives in full and let archived masters into the library.
        if (mastersSkipFolder((items[i] as Folder).name)) continue;
        walk(items[i] as Folder);
      } else {
        out.push(items[i] as File);
      }
    }
  }
  if (rootFolder.exists) walk(rootFolder);
  return out;
}

// =============================================================================
// Per-folder scan cache
// -----------------------------------------------------------------------------
// Opening a campaign used to re-walk the same folders over and over: the
// creatives loop calls scanMastersForCreative AND scanRendersForCreative for
// every creative, and scanRendersForCreative calls scanMastersForCreative again
// internally for its stem filter. A 6-creative campaign was ~18 subtree walks
// (and 18 bridge round-trips) to show one grid.
//
// This memoises findAllFiles PER FOLDER PATH. It deliberately does NOT reuse
// tools.ts's buildMastersIndex, even though that also walks masters: the two
// exclude different things (`_old`/`_archive` matched case-sensitively on the
// FOLDER NAME here, vs `_Old`/`_Archive`/`_DEV`/`Auto-Save` matched anywhere in
// the PATH there), and buildMastersIndex drops any file without a WxH token.
// Routing OV Library through it would quietly change which files come back,
// which is exactly what this refactor must not do. Same walker, same filters,
// same order -- only fewer times.
//
// Lifetime is the AE session (module variable, gone when AE quits or the panel
// reloads), same as the masters index cache. Re-picking a campaign in the
// dropdown clears it, which is the escape hatch when files change on disk.
//
// The cached array is returned BY REFERENCE. Every caller below only reads it.
// =============================================================================
var ovScanCache: { [path: string]: File[] } = {};

function findAllFilesCached(rootFolder: Folder): File[] {
  var key: string;
  try {
    key = rootFolder.fsName;
  } catch (e) {
    return findAllFiles(rootFolder);
  }
  if (ovScanCache.hasOwnProperty(key)) return ovScanCache[key];
  const walked = findAllFiles(rootFolder);
  ovScanCache[key] = walked;
  return walked;
}

// Clears OV Library's cached folder scans. Called when a campaign is picked
// from the dropdown, so re-selecting the one you are already on is a refresh.
export const invalidateOvLibraryCache = (): Result => {
  try {
    ovScanCache = {};
    ovMp4FolderCache = {};
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

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
  // Reads BOTH naming conventions, same as nameGeneratorParse() does:
  //   legacy   …_1920x858_10sec_OV        (masters written before 2026-07-31)
  //   current  …_1920x858px_10s_FR        (everything written since)
  // The "px" and the short "s" are the only two shape differences that reach
  // this parser -- the token REORDER (campaign/artwork swap, optional site)
  // all lands inside group 1, which OV Library only ever uses as an opaque
  // grouping key. `duration` is still normalised to the "10sec" form so the
  // sort key below and every stored/displayed value stay unchanged.
  const pattern = /^(.*)_(\d+)x(\d+)(?:px)?_(\d+)(?:sec|s)(.*)$/i;
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
  const allFiles = findAllFilesCached(creativeFolder);
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
// Resolved path per masters root, or "" for "this campaign doesn't use the
// layout" -- cached because the lookup costs three shallow directory listings
// and is called once PER CREATIVE plus once for scanAllRenders. Same cache
// lifetime and same invalidation as ovScanCache.
var ovMp4FolderCache: { [root: string]: string } = {};

function findMotionComponentsMp4Folder(mastersRoot: string): Folder | null {
  const key = String(mastersRoot);
  if (ovMp4FolderCache.hasOwnProperty(key)) {
    const hit = ovMp4FolderCache[key];
    return hit === "" ? null : new Folder(hit);
  }
  const resolved = findMotionComponentsMp4FolderUncached(key);
  // Cache the MISS too -- a campaign on the older layout would otherwise pay
  // the three listings again for every creative, which is the common case.
  ovMp4FolderCache[key] = resolved ? resolved.fsName : "";
  return resolved;
}

function findMotionComponentsMp4FolderUncached(mastersRoot: string): Folder | null {
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
  if (rendersFolder.exists) pushVideos(findAllFilesCached(rendersFolder), null);

  // 2. Support/Motion_Components/_mp4 (newer flat layout) -- filter to this
  // creative's own master stems.
  const mp4Folder = findMotionComponentsMp4Folder(mastersRoot);
  if (mp4Folder && mp4Folder.exists) {
    const masters = scanMastersForCreative(mastersRoot, creative);
    const stems: { [stem: string]: boolean } = {};
    for (let i = 0; i < masters.length; i++) stems[masters[i].stem.toLowerCase()] = true;
    pushVideos(findAllFilesCached(mp4Folder), stems);
  }

  return out;
};

// Campaign-wide render scan — every video file across every creative, one
// flat {stem, path}[] map. Used by the Review Session tab to match imported
// .mov files against their .mp4 renders regardless of which creative each
// belongs to. No stem filter — the caller builds its own lookup map from
// this and keys whatever stems it needs against it.
export const scanAllRenders = (mastersRoot: string): RenderEntry[] => {
  const out: RenderEntry[] = [];
  const seen: { [path: string]: boolean } = {};

  const addVideos = function (files: File[]) {
    for (let i = 0; i < files.length; i++) {
      const fName = files[i].name;
      if (!isVideoFile(fName)) continue;
      const dot = fName.lastIndexOf(".");
      const fStem = dot === -1 ? fName : fName.substring(0, dot);
      const path = files[i].fsName;
      if (seen[path]) continue;
      seen[path] = true;
      out.push({ stem: fStem, path: path });
    }
  };

  // 1. Renders/ — all creatives, unfiltered.
  const rendersFolder = new Folder(mastersRoot + "/Renders");
  if (rendersFolder.exists) addVideos(findAllFilesCached(rendersFolder));

  // 2. Support/Motion_Components/_mp4 — campaign-wide flat folder.
  const mp4Folder = findMotionComponentsMp4Folder(mastersRoot);
  if (mp4Folder && mp4Folder.exists) addVideos(findAllFilesCached(mp4Folder));

  return out;
};

/**
 * Every master render of a campaign, for Review's "Change master": the list a
 * reviewer picks from when the scorer's answer is not the one they want to
 * compare against (a portrait deliverable the scorer paired with a landscape
 * master). One entry per stem -- the web-playable .mp4 when a stem has both,
 * the same preference the rows' own previews take.
 *
 * Read-only, and the cached scan: nothing here walks the share a second time.
 */
export const reviewMasterRenders = (mastersRoot: string): Result & { renders?: { name: string; path: string }[] } => {
  try {
    if (!mastersRoot) return { success: false, error: "No campaign picked." };
    var all = scanAllRenders(mastersRoot);
    var at: { [stem: string]: number } = {};
    var out: { name: string; path: string }[] = [];
    for (var i = 0; i < all.length; i++) {
      // .name is URI-encoded (CLAUDE.md); a stray % must not lose the list.
      var stem = String(all[i].stem);
      try { stem = decodeURI(stem); } catch (eDec) {}
      var key = stem.toLowerCase();
      var isMp4 = /\.(mp4|m4v)$/i.test(all[i].path);
      if (at.hasOwnProperty(key)) {
        if (isMp4) out[at[key]].path = all[i].path;
        continue;
      }
      at[key] = out.length;
      out.push({ name: stem, path: all[i].path });
    }
    return { success: true, renders: out };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Any video file as a row's master, for one the list does not hold. The
 * dialog starts in the campaign's masters folder (openDlg on a File inside
 * it; File.openDialog opens wherever AE was last). "" on cancel, never an
 * error.
 */
export const reviewPickMasterFile = (mastersRoot: string): string => {
  try {
    var picked: File | null = null;
    var start = mastersRoot ? new Folder(mastersRoot) : null;
    // .exists is trustworthy on a DIRECTORY (CLAUDE.md), which this is.
    if (start && start.exists) picked = new File(start.fsName + "/master.mp4").openDlg("Pick the render to compare against") as File | null;
    else picked = File.openDialog("Pick the render to compare against") as File | null;
    return picked ? picked.fsName : "";
  } catch (e) {
    return "";
  }
};

// ── Review Session: match local .mov files to master .mp4 renders ────────
// Reuses the same master-lookup pipeline the Localise tools already use:
//   buildMastersIndex()  — one walk of the AE/ tree, campaign/size/duration
//                          pre-computed per .aep
//   pickBestMasterFromIndex() — campaign + duration + orientation + closest
//                               aspect-ratio scoring
// That pipeline handles territory-code vs OV, dual naming conventions
// (DGTL vs new), format keywords, and everything else the studio's real
// filenames actually contain — none of which a flat stem match covers.
//
// Takes a JSON array of {name, sourcePath?} (the localised items the user
// selected in the Project panel) and returns the same array with mp4Path
// set for each item that matched a master render.

interface ReviewMatchEntry {
  name: string;
  sourcePath: string | null;
  mp4Path: string | null;
  masterStem: string | null;
  /** >1 when the master is a SHORTER cut played this many times (a 20s
   *  deliverable of a creative whose masters are 10s and 15s). */
  repeat?: number;
}

/** True when every master's path carries this token (canonicalised the way
 *  the scorer compares), so matching on it would accept all of them. */
function reviewTokenInEveryMaster(index: MasterIndexEntry[], token: string, cache: { [k: string]: boolean }): boolean {
  var c = mastersCanon(token);
  if (!c) return true;
  if (cache.hasOwnProperty(c)) return cache[c];
  var all = index.length > 1;
  for (var i = 0; all && i < index.length; i++) if (index[i].canonPath.indexOf(c) === -1) all = false;
  cache[c] = all;
  return all;
}

export const reviewMatchToMaster = (mastersRoot: string, itemsJson: string): Result & { items?: ReviewMatchEntry[] } => {
  try {
    var items: { name: string; sourcePath: string | null }[] = JSON.parse(itemsJson);
    if (!items || items.length === 0) return { success: false, error: "No items to match." };

    // 1. Build the masters index — one walk, reused by every item.
    // Cached: read-only matching, nothing here writes.
    var index = getMastersIndex(mastersRoot);
    if (!index || index.length === 0) return { success: false, error: "No masters found under " + mastersRoot + "/AE/." };

    // 2. Build the render map — every video file under Renders/ and _mp4/,
    //    keyed by lowercase stem so we can look up the .mp4 from the master
    //    .aep's own stem.
    var renders = scanAllRenders(mastersRoot);
    var renderMap: { [stem: string]: string } = {};
    for (var ri = 0; ri < renders.length; ri++) {
      renderMap[renders[ri].stem.toLowerCase()] = renders[ri].path;
    }

    // 3. For each local item: extract size + duration from its filename,
    //    try each filename token as a campaign, and score through the
    //    existing pickBestMasterFromIndex.
    var out: ReviewMatchEntry[] = [];
    var tokenCache: { [k: string]: boolean } = {};

    for (var ii = 0; ii < items.length; ii++) {
      var item = items[ii];
      // Use the source filename (from disk) if available, else the AE
      // item name.  The source filename carries the real convention tokens.
      var rawName = item.sourcePath || item.name;
      // Strip path and extension to get the bare filename.
      var lastSlash = Math.max(rawName.lastIndexOf("/"), rawName.lastIndexOf("\\"));
      var fileName = lastSlash >= 0 ? rawName.substring(lastSlash + 1) : rawName;
      var dotIdx = fileName.lastIndexOf(".");
      var stem = dotIdx >= 0 ? fileName.substring(0, dotIdx) : fileName;

      // Extract size: _<W>x<H>_ or _<W>x<H>px_  -- BOTH conventions, same as
      // parseMasterFilename above.
      //
      // The "px" was missing here until 2026-08-10, and the failure was
      // completely silent. Masters written before 2026-08 say "_1920x858_" and
      // matched; everything written since says "_1920x1080px_" and did not, so
      // `size` came out "". pickBestMasterFromIndex then divides ""/undefined
      // into NaN, calls every master "Portrait", and its `diff <= min` accept
      // test is false for NaN -- so NO master ever scored, no .mp4 was found,
      // and no comparison comp was built. A campaign on the old naming worked
      // perfectly while a new one silently produced plain review rows.
      var sizeMatch = stem.match(/_(\d+)x(\d+)(?:px)?_/i);
      var size = sizeMatch ? (sizeMatch[1] + "x" + sizeMatch[2]) : "";

      // Extract duration: _<N>sec_ or _<N>s_  (durationMatchesPath handles both)
      var durMatch = stem.match(/_(\d+)(sec|s)_/i);
      var duration = durMatch ? (durMatch[1] + durMatch[2].toLowerCase()) : "";

      // Extract campaign: try every underscore-delimited token that
      // isn't purely numeric, a known format keyword, or a two-letter
      // territory code.  pickBestMasterFromIndex matches campaign as a
      // substring of the master's canonPath, so whichever token is the
      // real creative name will hit and the rest will miss harmlessly.
      // THE CREATIVE FIRST, as parsed -- the same field every other caller of
      // the scorer passes. This loop used to start at the FIRST token, which
      // is the film title (`FID`), and the scorer accepts a creative as a
      // substring anywhere in a master's path: `FID` is in every Forgotten
      // Island master, so the first try always "matched", the closest ASPECT
      // won, and a whole PortalToParadise batch came back paired with
      // InternationalPayoff.
      var creative = parseFilenameMeta(stem).campaign || "";
      var tokens = stem.split("_");
      var candidates: string[] = [];
      if (creative) candidates.push(creative);
      for (var ci = 0; ci < tokens.length; ci++) if (tokens[ci] !== creative) candidates.push(tokens[ci]);
      var mp4Path: string | null = null;
      var masterStem: string | null = null;

      for (var ti = 0; ti < candidates.length; ti++) {
        var token = candidates[ti];
        // Skip tokens that can't possibly be a creative name.
        if (!token) continue;
        if (/^\d+$/.test(token)) continue;                          // all digits
        if (/^\d+x\d+(?:px)?$/i.test(token)) continue;              // WxH, both conventions
        if (/^\d+(sec|s)$/i.test(token)) continue;                  // duration
        if (/^[A-Z]{2}$/.test(token)) continue;                     // territory code
        if (token === "OV") continue;                                // master suffix
        if (token === "DGTL" || token === "INTL" || token === "DOM") continue;  // fixed convention tokens
        if (token === "DOOH" || token === "DFOH" || token === "DINTH" || token === "FOH") continue;  // artwork types
        // A word EVERY master carries tells them apart not at all (the film
        // title, INTL): skip it rather than let it match the lot.
        if (reviewTokenInEveryMaster(index, token, tokenCache)) continue;

        var match = pickBestMasterFromIndex(index, token, size, duration);
        if (match) {
          // The master .aep's own stem (name without .aep) IS the stem
          // of the matching .mp4 render — identical filename, extension
          // aside.  This is the OV Library convention.
          var aepStem = match.name.replace(/\.aep$/i, "").toLowerCase();
          var found = renderMap[aepStem];
          if (found) {
            mp4Path = found;
            masterStem = aepStem;
            break;
          }
        }
      }

      // A DURATION MULTIPLE when no master has this length: Street Fighter's
      // Trio masters are 10s and 15s only, so every 20s Trio deliverable
      // (Peru's RealPlaza batch) paired with nothing. The same helper CSV
      // Localiser builds those deliverables with, on the PARSED creative only
      // -- never the token loop, which is what paired FID with everything.
      // Fewest repeats first: 20s is the 10s twice, not the 5s four times.
      var repeat = 1;
      if (!mp4Path && creative && size && duration) {
        var opts = multipleMasterOptions(index, creative, size, duration, MAX_DURATION_MULTIPLE);
        for (var oi = 0; oi < opts.length && !mp4Path; oi++) {
          var mStem = opts[oi].entry.name.replace(/\.aep$/i, "").toLowerCase();
          if (renderMap[mStem]) { mp4Path = renderMap[mStem]; masterStem = mStem; repeat = opts[oi].factor; }
        }
      }

      out.push({ name: item.name, sourcePath: item.sourcePath, mp4Path: mp4Path, masterStem: masterStem, repeat: repeat > 1 ? repeat : undefined });
    }

    return { success: true, items: out };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- File actions -- import only, never open; reveal/play never touch the
// source file's contents. ---
export const importFile = (filePath: string): Result => {
  const f = new File(filePath);
  // No File.exists gate: it answers false for files plainly on the NAS
  // (CLAUDE.md). The import is the test.
  try {
    app.project.importFile(new ImportOptions(f));
    return { success: true };
  } catch (impErr) {
    return { success: false, error: impErr.toString() };
  }
};

export const revealFile = (filePath: string): Result => {
  const f = new File(filePath);
  // No File.exists gate (NAS): `open` on a folder that isn't there does nothing.
  const p = f.parent.fsName;
  if ($.os.indexOf("Windows") !== -1) {
    system.callSystem('explorer "' + p + '"');
  } else {
    system.callSystem('open "' + p + '"');
  }
  return { success: true };
};

export const playFile = (filePath: string): Result => {
  // No File.exists gate (NAS): it refused to play renders that were there.
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
/**
 * WHERE THE TWO SIDES OF A COMPARISON GO -- one answer for every builder
 * (Review Session, 67's compare icon, OV Library), so they can't disagree.
 * Side by side, unless the frame is wider than COMPARE_STACK_RATIO: then
 * STACKED, the reference on top and the local below (2026-09-30). A 4480x384
 * banner side by side was an 8960px-wide comp with two slivers in it.
 *
 * `maxDim` caps the comp's LONGER side (0 = no cap): three full layers per
 * frame (reference, local, DIFF), so the memory is the comp's area times
 * three. `first` is the reference's centre, `second` the local's.
 */
export const COMPARE_STACK_RATIO = 2;
export function compareLayout(srcW: number, srcH: number, maxDim: number) {
  var w = srcW > 0 ? srcW : 1920;
  var h = srcH > 0 ? srcH : 1080;
  var stacked = w / h > COMPARE_STACK_RATIO;
  var rawW = stacked ? w : w * 2;
  var rawH = stacked ? h * 2 : h;
  var longest = Math.max(rawW, rawH);
  var scale = maxDim > 0 && longest > maxDim ? maxDim / longest : 1;
  var compW = Math.round(rawW * scale);
  var compH = Math.round(rawH * scale);
  var boxW = stacked ? compW : Math.round(compW / 2);
  var boxH = stacked ? Math.round(compH / 2) : compH;
  return {
    stacked: stacked,
    compW: compW,
    compH: compH,
    boxW: boxW,
    boxH: boxH,
    first: [boxW / 2, boxH / 2],
    second: stacked ? [boxW / 2, boxH + boxH / 2] : [boxW + boxW / 2, boxH / 2],
  };
}

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
    // No File.exists gate: the import below is the test (NAS -- CLAUDE.md).

    app.beginUndoGroup("OV Library: Create Comparison Comp");

    let ovFootage: AVItem;
    try {
      ovFootage = app.project.importFile(new ImportOptions(f)) as AVItem;
    } catch (impErr) {
      app.endUndoGroup();
      return { success: false, error: "Could not import render: " + impErr.toString() };
    }

    // Side by side, or stacked past 2:1 (compareLayout). No size cap here, as
    // before: this comp has two layers, not Review's three.
    const L = compareLayout(width, height, 0);
    const compWidth = L.compW;
    const compHeight = L.compH;
    const frameRate = ovFootage.frameRate > 0 ? ovFootage.frameRate : 25;
    const duration = Math.max(ovFootage.duration || 0, selectedItem.duration || 0) || 10;
    const compName = "Compare_" + f.name.replace(/\.[^.]+$/, "");

    const comp = app.project.items.addComp(compName, compWidth, compHeight, 1, duration, frameRate);

    // Right half (or the bottom, stacked): the user's own localised render/comp.
    const rightLayer = comp.layers.add(selectedItem);
    fitLayerIntoBox(rightLayer, L.boxW, L.boxH, L.second[0], L.second[1]);

    // Left half (or the top): the freshly-imported OV render -- after the
    // local's frontcard, when it has one (frontcardOffset), so both show one beat.
    const leftLayer = comp.layers.add(ovFootage);
    fitLayerIntoBox(leftLayer, L.boxW, L.boxH, L.first[0], L.first[1]);
    const offset = frontcardOffset(selectedItem.duration || 0, ovFootage.duration || 0, frameRate);
    if (offset > 0) {
      try {
        leftLayer.startTime = offset;
        comp.displayStartTime = -offset;
        comp.markerProperty.setValueAtTime(offset, new MarkerValue("Frontcard ends · master starts"));
        comp.workAreaStart = offset;
        comp.workAreaDuration = Math.max(1 / frameRate, duration - offset);
        comp.time = offset;
      } catch (eOff) { /* the comp is still usable unaligned */ }
    }

    comp.openInViewer();
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// ── Review Session: load selected items ────────────────────────────────────
// Purpose-built for the Review Session workflow.  Unlike the Deliver
// section's deliveryChecklistLoadComps() — which only accepts CompItems —
// this accepts BOTH CompItems and FootageItems, because imported .mov
// renders are FootageItems in AE's Project panel, not comps.

interface ReviewLoadResult extends Result {
  items?: { id: number; name: string; sourcePath: string | null; duration: number; frameRate: number }[];
}

/** A master render (OV token last, before any extension) or a comparison
 *  comp this tool built. Read off the FILE's name where there is one. */
export function reviewIsOwnByProduct(name: string, sourcePath: string | null): boolean {
  if (/^Compare_/.test(String(name || ""))) return true;
  var base = String(sourcePath || name || "");
  base = base.substring(Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\")) + 1).replace(/\.[^.]+$/, "");
  return /_OV\d*$/i.test(base);
}

export const reviewLoadSelectedItems = (): ReviewLoadResult => {
  try {
    const sel = app.project.selection;
    const items: ReviewLoadResult["items"] = [];
    var skipped = 0;

    for (var i = 0; i < sel.length; i++) {
      var item = sel[i];
      var name = "";
      var sourcePath: string | null = null;
      var duration = 0;
      var frameRate = 0;

      if (item instanceof CompItem) {
        name = item.name;
        duration = item.duration;
        frameRate = item.frameRate;
        // Walk the comp's layers for a footage source — the .mov this
        // comp was built from.  Same approach deliveryBuildCompEntry uses.
        for (var l = 1; l <= item.numLayers; l++) {
          var layer = item.layer(l);
          try {
            var src = (layer as any).source;
            if (src && src.file && src.file.fsName) {
              sourcePath = src.file.fsName;
              break;
            }
          } catch (eL) { /* layer has no source */ }
        }
      } else if (item instanceof FootageItem) {
        name = item.name;
        duration = item.duration;
        frameRate = item.frameRate;
        try {
          if (item.file && item.file.fsName) sourcePath = item.file.fsName;
        } catch (eF) { /* generated/placeholder footage has no file */ }
      } else {
        // FolderItem or unknown — skip.
        continue;
      }

      // NOT THE REVIEW'S OWN BY-PRODUCTS. Compare imports each master render
      // into the project, and AE leaves an import SELECTED -- so the next
      // Import & Compare took eleven master .mp4s in as eleven rows to
      // review. A master (`…_OV.mp4`, `…_OV1`) and a Compare_ comp are never
      // what is under review; they are what it is compared against.
      if (reviewIsOwnByProduct(name, sourcePath)) { skipped++; continue; }
      // An earlier version or PRE twin a comparison imported: filed under
      // REVIEW_REFERENCE_FOLDER, and never itself under review.
      try {
        if (item.parentFolder && item.parentFolder.name === REVIEW_REFERENCE_FOLDER) { skipped++; continue; }
      } catch (ePF) { /* no parent */ }

      items.push({ id: item.id, name: name, sourcePath: sourcePath, duration: duration, frameRate: frameRate });
    }

    if (items.length === 0) {
      return { success: false, error: skipped
        ? "Only master renders and comparison comps are selected. Select the localised renders to review."
        : "Select one or more comps or footage items in the Project panel first." };
    }
    return { success: true, items: items };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// ── Review Session: enriched comparison comp ──────────────────────────────
// Built for the Review Session workflow — finds the local render by AE
// project item ID (no "select exactly one item" step), and layers on
// everything useful for frame-accurate QC in one comp.
//
// What it adds over the basic createComparisonComp():
//   1. Finds local by ID     — no manual selection step
//   2. Layout                 — side by side, or STACKED past 2:1
//                               (compareLayout, shared with OV Library)
//   4. Difference matte       — third track on top, Difference blending,
//                               pixel-level deltas light up instantly
//   5. Timecode overlay       — burnt-in source TC on both sides
//   6. Meaningful naming      — "Compare_<localName>"
//
// Returns { success, compName?, compId? } so the React side can store the
// comp reference and let the user jump back to it later.

// Find a folder at the project root by name, or create it if it doesn't
// exist — the same find-or-create pattern Organise Folders (tools.ts) uses,
// so running this repeatedly never stacks duplicate folders.
function reviewFindOrCreateFolder(name: string): FolderItem {
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (it instanceof FolderItem && it.name === name && it.parentFolder === app.project.rootFolder) return it;
  }
  return app.project.items.addFolder(name);
}

interface ReviewComparisonResult extends Result {
  compName?: string;
  compId?: number;
  // The comparison comp's actual frame rate — read from the master footage
  // (23.976, 25, 30, etc.), so the in-panel player's frame math matches the
  // AE comp instead of assuming 25.
  compFps?: number;
  // Diagnostics: "divider:ok | master-label:ok | local-label:ok | diff:no-blend ... | tc-master:FAIL ..."
  // lets the UI (and a debugging session) see which enrichment steps actually
  // ran on the real AE install instead of failing silently.
  enrichNotes?: string;
}

/**
 * THE FRONTCARD OFFSET. A localised render carries the frontcard at its START
 * (5s is usual) and the master does not, so side by side at the same comp
 * time they show different moments and the frame counters -- identical,
 * because they read comp time -- line up nothing. When the local is longer,
 * the extra is taken as frontcard and the master starts that much later, so
 * both halves show the same beat at the same frame.
 *
 * Under half a second is left alone: that is rounding between two renders,
 * not a frontcard, and shifting by it would misalign what already lines up.
 * Snapped to whole frames of `fps`.
 */
export function frontcardOffset(localDur: number, masterDur: number, fps: number): number {
  var d = (Number(localDur) || 0) - (Number(masterDur) || 0);
  if (!(d >= 0.5)) return 0;
  var f = fps > 0 ? fps : 25;
  return Math.round(d * f) / f;
}

/** What the left half of a comparison is. "master" is the OV render (the
 *  default, and the only kind with a frontcard offset); "amend" is an earlier
 *  version of the same deliverable; "prepost" is its PRE-batch twin. */
export type ReviewCompareKind = "master" | "amend" | "prepost";

/** The folder a comparison's reference file is filed in, so the next Import &
 *  Compare can tell it apart from what is under review -- AE leaves an import
 *  selected, exactly the trap reviewIsOwnByProduct handles for masters. */
export const REVIEW_REFERENCE_FOLDER = "Review References";

export const createReviewComparison = (mp4Path: string, localItemId: number, localItemName: string, kind?: string, repeat?: number, replaceCompId?: number): ReviewComparisonResult => {
  // A master played `times` times end to end (a 20s deliverable of a 10s cut).
  var times = kind && kind !== "master" ? 1 : Math.max(1, Math.min(MAX_DURATION_MULTIPLE, Math.floor(Number(repeat) || 1)));
  var isMaster = !kind || kind === "master";
  var refLabel = kind === "amend" ? "BEFORE" : kind === "prepost" ? "PRE" : "MASTER";
  // WHICH STEP FAILED, in the error: AE's own message ("property is hidden")
  // names no property, and four rows of one batch failed with it while the
  // rest of the batch, same master, same codec, built fine.
  var step = "starting";
  try {
    // 1. Find the local item in the project.
    const localItem = app.project.itemByID(localItemId);
    if (!localItem) {
      return { success: false, error: "Local render no longer in the project (item " + localItemId + ").  Re-import the list." };
    }
    if (!(localItem instanceof CompItem) && !(localItem instanceof FootageItem)) {
      return { success: false, error: "\"" + localItemName + "\" is not a comp or footage item." };
    }
    // A render AE CAN'T SEE INTO. Imported, listed, and no picture: a layer
    // made from it has its Transform hidden, so the first setValue failed
    // with AE's "property or a parent property is hidden" -- which reads as
    // this tool's bug and is really the file's. Measured on a Denmark batch:
    // the four that failed were exactly the four with a blank Media Duration.
    var li: any = localItem;
    if (li.footageMissing === true) {
      return { success: false, error: "The render is offline in this project. Relink or re-import it." };
    }
    if (li.hasVideo === false) {
      return { success: false, error: "After Effects can't read the picture in this render (no video, blank Media Duration). Re-render it, or check it opens in QuickTime, then re-import." };
    }

    // 2. Import the master .mp4 — read-only, same safety rule as every other
    //    import in this codebase.
    // NO File.exists GATE. It answers false for files plainly on the NAS,
    // and not even consistently: one 1080x1920 master built comps for four
    // Denmark rows and "no longer existed" for two others, which then showed
    // no Compare button at all. The import is the test, and its error says why.
    const f = new File(mp4Path);

    var masterFootage: AVItem;
    try {
      masterFootage = app.project.importFile(new ImportOptions(f)) as AVItem;
    } catch (impErr) {
      return { success: false, error: "Could not import master render: " + impErr.toString() };
    }
    if ((masterFootage as any).hasVideo === false) {
      try { masterFootage.remove(); } catch (eRm) {}
      return { success: false, error: "After Effects can't read the picture in the master render " + decodeURI(String(f.name)) + "." };
    }
    // Auto-file the imported OV master into an "OV" project folder so a
    // review session doesn't scatter every master render loose in the root.
    try {
      masterFootage.parentFolder = reviewFindOrCreateFolder(isMaster ? "OV" : REVIEW_REFERENCE_FOLDER);
    } catch (eFolder) { /* folder move is best-effort — never fail the import */ }

    // 3. Determine comp dimensions from the master's source.  Capped at a
    //    max total width to keep frame-buffer memory inside what AE can
    //    allocate reliably — the side-by-side comp is three full layers
    //    (master, local, difference matte), each ~ (compW × compH × 4) bytes,
    //    so a 5760px-wide source doubled to 11520px can push past 200 MB per
    //    frame.  Capping at 3840 gives reliable behaviour for the common case
    //    (≤1920px sources fit at 1:1) and proportionally scales anything
    //    wider.
    //    Past 2:1 the two are STACKED instead (compareLayout), and the cap
    //    applies to the comp's longer side either way.
    var srcW = masterFootage.width || 1920;
    var srcH = masterFootage.height || 1080;
    var L = compareLayout(srcW, srcH, 3840);
    var compW = L.compW;
    var compH = L.compH;
    var fps = masterFootage.frameRate > 0 ? masterFootage.frameRate : 25;
    var dur = Math.max((masterFootage.duration || 0) * times, localItem.duration || 0) || 10;

    // 4. Create the comparison comp.
    var stem = localItemName.replace(/_[Vv]\d+$/, "").replace(/[\\\/:*?"<>|]/g, "-");
    var compName = "Compare_" + stem + (kind === "amend" ? "_AMEND" : kind === "prepost" ? "_PRE_POST" : "");
    // Deduplicate: if a comp with that name already exists, append _2, _3, …
    var finalName = compName;
    var dupIdx = 1;
    var dedupGuard = 0;
    while (dedupGuard++ < 50) {
      var collision = false;
      for (var ci = 1; ci <= app.project.numItems; ci++) {
        var existing = app.project.item(ci);
        if (existing && existing.name === finalName) { collision = true; break; }
      }
      if (!collision) break;
      dupIdx++;
      finalName = compName + "_" + dupIdx;
    }

    app.beginUndoGroup("Review: Compare \"" + localItemName + "\"");

    step = "creating the comp (" + compW + "x" + compH + ", " + dur + "s)";
    var comp = app.project.items.addComp(finalName, compW, compH, 1, dur, fps);
    // Auto-file the comparison comp into a "Comparison" project folder so
    // review sessions don't clutter the root with every Compare_* comp.
    try {
      comp.parentFolder = reviewFindOrCreateFolder("Comparison");
    } catch (eFolder) { /* folder move is best-effort — never fail the comp */ }

    // 5. Place master on the LEFT half -- starting after the local's
    //    frontcard, so the two halves show the same moment (frontcardOffset).
    // ONLY AGAINST A MASTER. An earlier version or a PRE twin opens with its
    // own frontcard, so the two already line up at 0; a length difference
    // between them is a real change to review, not a card to skip.
    var offset = isMaster ? frontcardOffset(localItem.duration || 0, (masterFootage.duration || 0) * times, fps) : 0;
    step = "placing the master";
    var masterLayer = comp.layers.add(masterFootage);
    fitLayerIntoBox(masterLayer, L.boxW, L.boxH, L.first[0], L.first[1]);
    masterLayer.name = isMaster ? "MASTER (.mp4)" : refLabel + " (" + decodeURI(String(f.name)) + ")";
    if (offset > 0) {
      try { masterLayer.startTime = offset; } catch (eOff) { /* stays at 0 */ }
    }


    // 6. Place local render on the RIGHT half.
    step = "placing the local render";
    var localLayer = comp.layers.add(localItem);
    fitLayerIntoBox(localLayer, L.boxW, L.boxH, L.second[0], L.second[1]);
    step = "after placing both";
    localLayer.name = kind === "amend" ? "AFTER (imported render)" : kind === "prepost" ? "POST (imported render)" : "LOCAL (imported render)";

    // 7-10. The enrichment block — divider, labels, difference matte,
    //       timecode overlay.  EACH step is independently guarded so one
    //       failure never kills the rest, and each appends to `notes` so the
    //       caller can see what actually happened.  The core comp (master +
    //       local, correctly sized) is already in place above, so it's useful
    //       even if every enrichment step fails.
    var enrichNotes: string[] = [];

    // 7. Difference matte — the local render over the MASTER's half with
    //     Difference blending.  BlendingMode is a Types-for-Adobe ambient
    //     enum, NOT necessarily a real ExtendScript runtime global (same
    //     trap as `instanceof AVItem`, documented in CLAUDE.md) — so the
    //     whole step is guarded and the layer is still useful even if the
    //     blend mode can't be set.
    try {
      var diffLayer = comp.layers.add(localItem);
      fitLayerIntoBox(diffLayer, L.boxW, L.boxH, L.first[0], L.first[1]);
      diffLayer.name = "DIFF (local over master)";
      // Starts hidden — the artist toggles it on (eyeball in the timeline)
      // when they want to see the difference pass, rather than it washing
      // over the master half on open.  Set BOTH the video switch (eyeball)
      // AND enabled=false (the same disable trick makeTextless uses) because
      // video alone silently failed to stick on a freshly-added layer in real
      // AE.  enabled=false greys the layer out AND stops it rendering, which
      // is exactly the "hidden by default" behaviour wanted; the artist turns
      // the layer back on via its checkbox when they want the diff pass.
      var diffHidden = false;
      try { diffLayer.video = false; diffHidden = true; } catch (eVideo) {}
      try { diffLayer.enabled = false; } catch (eEnabled) {}
      try {
        diffLayer.blendingMode = BlendingMode.DIFFERENCE;
        enrichNotes.push("diff:ok" + (diffHidden ? " hidden" : ""));
      } catch (eBlend) {
        enrichNotes.push("diff:no-blend " + eBlend.toString());
      }
      try { (diffLayer.property("Transform")!.property("Opacity") as Property).setValue(100); } catch (eOp) {}
    } catch (eDiff) {
      enrichNotes.push("diff:FAIL " + eDiff.toString());
    }

    // 8. Timecode overlay — the Timecode effect on each main render, with its
    //    Display Format set to FRAMES (option 2) so it shows frame numbers
    //    (0, 1, 2, ...) rather than SMPTE 00:00:00:00.
    //
    //    Each property is set in its OWN try/catch.  The first version grouped
    //    them in one block: the very first setValue ("Timecode Source") threw,
    //    the whole block aborted before ever reaching "Display Format", and
    //    the effect stayed at its default SMPTE display — which is exactly the
    //    symptom reported.  Guarding each property independently guarantees
    //    the Display Format change lands even if an earlier property name
    //    differs on a given AE version.
    // Text Size and Opacity tuned for a visible burn-in counter, not the
    // effect's faint small default.  srcH<500 (small formats) get a smaller
    // but still legible size; anything larger gets a clear 30px.
    var tcSize = srcH < 500 ? 22 : 30;
    var addTimecode = function (layer: AVLayer): boolean {
      try {
        var effectsGroup = layer.property("Effects");
        if (!effectsGroup) return false;
        var tc = (effectsGroup as any).addProperty("ADBE Timecode");
        if (!tc) return false;
        // BY MATCHNAME, measured in AE 26.2 (display names drift between
        // releases -- CLAUDE.md). This used to ask for "Timecode Source",
        // which does not exist: the real one is "Time Source", so every
        // counter silently stayed on its default, LAYER SOURCE, and each
        // half counted its own file -- the local always ahead by its
        // frontcard (292 against the master's 172, 120 frames = 5s).
        //   -0002 Display Format: 1 Timecode, 2 Frames
        //   -0009 Time Source:    1 Layer Source, 2 Composition, 3 Custom
        // COMPOSITION on both, so the two halves always read one number; the
        // comp's own start is moved back by the frontcard below, so that
        // number is the MASTER's frame and the frontcard reads negative.
        // (Rendered and read back: comp start -5s, Composition source reads
        // 47 at 7s and -61 inside the card.)
        try { tc.property("ADBE Timecode-0002")!.setValue(2); } catch (eDF) { /* stays timecode */ }
        var sourced = false;
        try { tc.property("ADBE Timecode-0009")!.setValue(2); sourced = true; } catch (eTS) { /* stays layer source */ }
        try { tc.property("ADBE Timecode-0006")!.setValue(tcSize); } catch (eSZ) { /* default */ }
        try { tc.property("ADBE Timecode-0012")!.setValue(100); } catch (eOp) { /* default */ }
        return sourced;
      } catch (eTc) { return false; }
    };
    enrichNotes.push("tc-master:" + (addTimecode(masterLayer) ? "ok" : "FAIL"));
    enrichNotes.push("tc-local:" + (addTimecode(localLayer) ? "ok" : "FAIL"));

    // The repeats, end to end after the first, so the master half plays the
    // whole deliverable -- and the DIFF lines up for all of it, not the first
    // pass only. Made AFTER the counter, so every pass carries it.
    if (times > 1) {
      step = "repeating the master";
      var mDur = masterFootage.duration || 0;
      for (var rp = 1; rp < times && mDur > 0; rp++) {
        var again = masterLayer.duplicate() as AVLayer;
        again.startTime = offset + rp * mDur;
        again.name = "MASTER (.mp4) x" + (rp + 1);
      }
      enrichNotes.push("repeat:" + times);
    }

    // Where the comparison starts: a marker at the end of the frontcard, the
    // work area from there, and the playhead parked on it -- so pressing play
    // plays the part the two renders share.
    if (offset > 0) {
      try {
        // The comp's timeline -- and so both counters -- read 0 on the
        // master's first frame; the frontcard runs negative before it.
        try { comp.displayStartTime = -offset; } catch (eStart) { enrichNotes.push("start:refused"); }
        comp.markerProperty.setValueAtTime(offset, new MarkerValue("Frontcard ends · master starts"));
        comp.workAreaStart = offset;
        comp.workAreaDuration = Math.max(1 / fps, dur - offset);
        comp.time = offset;
        enrichNotes.push("frontcard:" + offset.toFixed(2) + "s");
      } catch (eWa) {
        enrichNotes.push("frontcard:shifted, no marker " + eWa.toString());
      }
    }

    // Don't auto-open — avoids an immediate frame-buffer allocation in AE
    // (this comp is three full layers: master, local, difference matte).
    // In a batch import several of these can be created at once, and
    // opening them all would spike memory for no good reason.  The artist
    // clicks the purple comparison chip in the review row to open one at a
    // time via focusReviewComp().

    // A REBUILD AGAINST ANOTHER MASTER takes the old comparison's place: the
    // row points at one comp, and a `Compare_…_2` beside the one it replaced
    // is a comp nobody can tell apart from it. Only ever a comp this tool
    // made (named Compare_…), only after the new one exists, and inside the
    // undo group -- Ctrl+Z brings the old one back.
    if (replaceCompId) {
      try {
        var old: any = app.project.itemByID(replaceCompId);
        if (old && old.id !== comp.id && typeof old.openInViewer === "function" && String(old.name).indexOf("Compare_") === 0) {
          var oldName = String(old.name);
          old.remove();
          if (oldName === compName && finalName !== compName) { comp.name = compName; finalName = compName; }
          enrichNotes.push("replaced");
        }
      } catch (eOld) { enrichNotes.push("replace:FAIL " + eOld.toString()); }
    }
    app.endUndoGroup();
    return { success: true, compName: finalName, compId: comp.id, compFps: fps, enrichNotes: enrichNotes.join(" | ") };
  } catch (e) {
    try { app.endUndoGroup(); } catch (eU) {}
    return { success: false, error: e.toString() + " -- while " + step + ((e as any).line ? " (line " + (e as any).line + ")" : "") };
  }
};

// Open a comparison comp in the viewer.  createReviewComparison deliberately
// does NOT auto-open (to avoid the three-layer frame-buffer allocation across
// a batch), so this is the only path that opens one — called when the artist
// clicks the purple comparison chip on a review row.
export const focusReviewComp = (compId: number): Result => {
  try {
    var comp = app.project.itemByID(compId);
    if (!comp || !(comp instanceof CompItem)) {
      return { success: false, error: "That comparison comp no longer exists — it may have been deleted." };
    }
    comp.openInViewer();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Toggle the DIFF layer's visibility inside a comparison comp.  The diff
// matte is created hidden (enabled = false); this flips it on/off so the
// artist can reveal it from the panel without hunting the timeline checkbox.
// Returns the new state (true = visible) so the UI can reflect it.
export const reviewToggleDiff = (compId: number): Result & { visible?: boolean } => {
  try {
    var comp = app.project.itemByID(compId);
    if (!comp || !(comp instanceof CompItem)) {
      return { success: false, error: "That comparison comp no longer exists — it may have been deleted." };
    }
    for (var l = 1; l <= comp.numLayers; l++) {
      var layer = comp.layer(l);
      if (String(layer.name).indexOf("DIFF") === 0) {
        var next = layer.enabled ? false : true;
        layer.enabled = next;
        // Mirror to the video switch so the eyeball follows the toggle.
        try { layer.video = next; } catch (eVideo) {}
        return { success: true, visible: next };
      }
    }
    return { success: false, error: "No DIFF layer found in that comparison comp." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Move a comparison comp's playhead to a specific frame.  Called when the
// artist clicks a frame in the in-panel video preview, so the AE comp and
// the panel preview agree on the exact frame being reviewed.
export const reviewJumpComp = (compId: number, frame: number): Result => {
  try {
    var comp = app.project.itemByID(compId);
    if (!comp || !(comp instanceof CompItem)) {
      return { success: false, error: "That comparison comp no longer exists — it may have been deleted." };
    }
    var time = frame / comp.frameRate;
    comp.time = time;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Batch version — takes JSON arrays so the frontend makes one evalTS round-
// trip for all the comparison comps at once rather than one per item.
// matchesJson: '[{"mp4Path":"...","localItemId":1,"localItemName":"..."}, ...]'
export const createReviewComparisons = (matchesJson: string): ReviewComparisonResult & { results?: ReviewComparisonResult[] } => {
  var matches: { mp4Path: string; localItemId: number; localItemName: string; kind?: string; repeat?: number }[];
  try {
    matches = JSON.parse(matchesJson);
  } catch (eParse) {
    return { success: false, error: "Could not read the comparison list." };
  }
  if (!matches || matches.length === 0) {
    return { success: false, error: "No items to compare." };
  }

  var results: ReviewComparisonResult[] = [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    results.push(createReviewComparison(m.mp4Path, m.localItemId, m.localItemName, m.kind, m.repeat));
  }
  return { success: true, results: results };
};

// -- Review Session: what else a render can be compared against -------------
//
// Two references besides the master, both found ON DISK beside the render:
//
//   AMEND   -- an earlier version of the same deliverable. "..._CL_V02.mov" is
//              compared against "..._CL_V01.mov" in its own folder or that
//              folder's _Old. The nearest lower version wins (V03 takes V02).
//   PREPOST -- a POST render's PRE twin. POST batches carry a whole "Post"
//              token ("..._1248x416px_Post_10s_CL_V01.mov") and are otherwise
//              named as the PRE render, so the twin is the same name with that
//              token removed, in a SIBLING batch folder. Paired by FILENAME,
//              never by folder name: Chile's PRE batch is "Batch_02" and its
//              POST is "Batch_2_POST", so no folder rule would have found it.
//              The version is ignored (PRE may be at V02 and POST at V01) and
//              the highest PRE version wins; a _DOUBLE_RES/_QUAD_RES suffix
//              must match, since it is part of what the deliverable is.
//
// No File.exists / getFiles(mask) -- the NAS rules. getFiles() with no mask
// and names compared after decoding.

interface ReviewNameParts {
  /** Everything before the _Vnn token, decoded, upper-cased. */
  head: string;
  version: number;
  /** Whatever follows the version ("_DOUBLE_RES"), upper-cased. */
  tail: string;
  ext: string;
}

/** A render name split around its version token, or null without one. */
export function reviewSplitVersion(fileName: string): ReviewNameParts | null {
  var n = String(fileName || "");
  try { n = decodeURI(n); } catch (eD) { /* already plain */ }
  var dot = n.lastIndexOf(".");
  var ext = dot === -1 ? "" : n.substring(dot + 1).toLowerCase();
  var stem = dot === -1 ? n : n.substring(0, dot);
  var toks = stem.split("_");
  for (var i = toks.length - 1; i >= 0; i--) {
    var m = /^[Vv](\d{1,3})$/.exec(toks[i]);
    if (!m) continue;
    return {
      head: toks.slice(0, i).join("_").toUpperCase(),
      version: parseInt(m[1], 10),
      tail: toks.slice(i + 1).join("_").toUpperCase(),
      ext: ext,
    };
  }
  return null;
}

/** The PRE name's head for a POST head: the whole "Post" token removed, or ""
 *  when there is no such token. Whole-token only -- a site called
 *  "PostOffice" is not a POST render. */
export function reviewPreHeadOf(head: string): string {
  var toks = String(head || "").split("_");
  var out: string[] = [];
  var found = false;
  for (var i = 0; i < toks.length; i++) {
    if (!found && toks[i].toUpperCase() === "POST") { found = true; continue; }
    out.push(toks[i]);
  }
  return found ? out.join("_") : "";
}

function reviewIsVideoExt(ext: string): boolean {
  return ext === "mov" || ext === "mp4";
}

function reviewListFiles(folder: Folder): File[] {
  var out: File[] = [];
  try {
    var all = folder.getFiles();
    for (var i = 0; i < all.length; i++) if (all[i] instanceof File) out.push(all[i] as File);
  } catch (e) { /* unreadable: nothing */ }
  return out;
}

function reviewListFolders(folder: Folder): Folder[] {
  var out: Folder[] = [];
  try {
    var all = folder.getFiles();
    for (var i = 0; i < all.length; i++) if (all[i] instanceof Folder) out.push(all[i] as Folder);
  } catch (e) { /* unreadable: nothing */ }
  return out;
}

function reviewDecodedName(f: File | Folder): string {
  var n = String(f.name || "");
  try { n = decodeURI(n); } catch (eD) {}
  return n;
}

export interface ReviewCounterpart {
  name: string;
  amendPath?: string;
  amendName?: string;
  prePath?: string;
  preName?: string;
  /** The PRE file's folder, for the row's "vs PRE · Batch_02". */
  preFolder?: string;
}

export const reviewFindCounterparts = (itemsJson: string): Result & { items?: ReviewCounterpart[] } => {
  var list: { name: string; sourcePath: string | null }[];
  try { list = JSON.parse(itemsJson); } catch (eP) { return { success: false, error: "Could not read the item list." }; }
  var out: ReviewCounterpart[] = [];
  for (var i = 0; i < list.length; i++) {
    var entry: ReviewCounterpart = { name: list[i].name };
    out.push(entry);
    var sp = list[i].sourcePath;
    if (!sp) continue;
    var file = new File(sp);
    var me = reviewSplitVersion(file.name);
    if (!me || !reviewIsVideoExt(me.ext)) continue;
    var own = file.parent;
    if (!own) continue;

    // AMEND: the nearest lower version, here or in _Old.
    var places: Folder[] = [own];
    var subs = reviewListFolders(own);
    for (var s = 0; s < subs.length; s++) {
      if (reviewDecodedName(subs[s]).toUpperCase() === "_OLD") places.push(subs[s]);
    }
    var bestV = 0;
    for (var p = 0; p < places.length; p++) {
      var files = reviewListFiles(places[p]);
      for (var f = 0; f < files.length; f++) {
        var o = reviewSplitVersion(files[f].name);
        if (!o || !reviewIsVideoExt(o.ext)) continue;
        if (o.head !== me.head || o.tail !== me.tail) continue;
        if (o.version >= me.version || o.version <= bestV) continue;
        bestV = o.version;
        entry.amendPath = files[f].fsName;
        entry.amendName = reviewDecodedName(files[f]);
      }
    }

    // PREPOST: a POST render's twin in a sibling batch folder.
    var preHead = reviewPreHeadOf(me.head);
    var batchParent = own.parent;
    if (preHead === "" || !batchParent) continue;
    var siblings = reviewListFolders(batchParent);
    var bestPre = 0;
    for (var b = 0; b < siblings.length; b++) {
      var sib = siblings[b];
      var sibName = reviewDecodedName(sib);
      if (sibName.charAt(0) === "_") continue;
      if (sib.fsName === own.fsName) continue;
      var sibFiles = reviewListFiles(sib);
      for (var k = 0; k < sibFiles.length; k++) {
        var q = reviewSplitVersion(sibFiles[k].name);
        if (!q || !reviewIsVideoExt(q.ext)) continue;
        if (q.head !== preHead || q.tail !== me.tail) continue;
        if (q.version <= bestPre) continue;
        bestPre = q.version;
        entry.prePath = sibFiles[k].fsName;
        entry.preName = reviewDecodedName(sibFiles[k]);
        entry.preFolder = sibName;
      }
    }
  }
  return { success: true, items: out };
};

/**
 * WHICH CAMPAIGN OWNS A FILENAME TOKEN.
 *
 * A deliverable is called `FID_INTL_PortalToParadise_DOOH_...`, and the
 * campaign list holds "Forgotten Island". Those are two different identifiers
 * for one campaign -- a filename token and a human label -- and nothing mapped
 * between them, so the agent could read a job's deliverables and still not know
 * which masters folder to look in.
 *
 * NOT AN ALIAS LIST. A hand-maintained token -> campaign table is a second
 * source of truth that drifts the first time somebody adds a campaign and
 * forgets the alias, and the symptom is the panel saying a campaign does not
 * exist when it does. The data already answers the question: a campaign owns a
 * token if its MASTERS carry it, which is what the build uses to pick a master
 * in the first place.
 *
 * Matched with pickBestMasterFromIndex's own test -- mastersCanon'd substring
 * against canonPath -- so a token that locates a campaign here is by
 * construction a token that will find masters there.
 *
 * ONE CALL, not one per campaign: this walks the list host-side over the cached
 * index rather than making the agent ask about each campaign in turn and spend
 * its step budget doing it.
 *
 * An unreachable campaign is skipped and REPORTED, never silently treated as
 * empty -- an unmounted share is a normal state, and "no masters here" and
 * "couldn't look" are different answers (CLAUDE.md).
 */
export const locateCampaignForToken = (
  token: string
): {
  success: boolean;
  error?: string;
  token?: string;
  matches?: { name: string; mastersRoot: string; masterCount: number }[];
  unreachable?: string[];
} => {
  try {
    const canon = mastersCanon(String(token || ""));
    if (!canon) return { success: false, error: "No campaign token to look for." };

    const camps = loadCampaignsRaw();
    const matches: { name: string; mastersRoot: string; masterCount: number }[] = [];
    const unreachable: string[] = [];

    for (let i = 0; i < camps.length; i++) {
      const c = camps[i];
      if (!c.mastersRoot) continue;

      // `.exists` on a DIRECTORY is the one case CLAUDE.md allows it, and it is
      // what keeps an unmounted campaign out of the "has no masters" bucket.
      const root = new Folder(c.mastersRoot);
      if (!root.exists) { unreachable.push(c.name); continue; }

      const index = getMastersIndex(c.mastersRoot);
      let count = 0;
      for (let n = 0; n < index.length; n++) {
        if (index[n].canonPath.indexOf(canon) !== -1) count++;
      }
      if (count > 0) matches.push({ name: c.name, mastersRoot: c.mastersRoot, masterCount: count });
    }

    return {
      success: true,
      token: String(token),
      matches: matches,
      unreachable: unreachable.length ? unreachable : undefined,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
