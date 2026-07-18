// =============================================================================
// src/jsx/aeft/shell.ts -- app-shell prefs: Useful Folders, custom tool
// order, home-screen favorites, SFX settings. Split out of aeft.ts, which
// is now a thin barrel -- see its header comment for context.
// =============================================================================
import { Result } from "./shared";



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
// Toolset grid personalisation -- the one-click grid on the home screen
// (tools/Toolset.tsx's ACTIONS) can be per-machine customised via a
// long-press "edit mode": HIDE actions you never use, and REORDER them
// within their group. Both are stored the same tab-separated app.settings
// way as everything else in this file. Two independent keys:
//   - OVToolsetHidden: action ids the user has hidden.
//   - OVToolsetOrder:  a flat ordered list of action ids; Toolset.tsx sorts
//     each group by this and appends any not-yet-seen action at the end
//     (same merge-over-default rule as loadAllToolOrders), so a newly
//     added grid action never vanishes just because it isn't in a saved
//     order yet.
// Same "OV" key prefix and no-Result-wrapper-on-load reasoning as
// favorites/tool-order above.
// =============================================================================
const TOOLSET_SETTINGS_SECTION = "XYiToolbox";
const TOOLSET_HIDDEN_KEY = "OVToolsetHidden";
const TOOLSET_ORDER_KEY = "OVToolsetOrder";
// Group membership + label overrides -- once a grid action can be dragged
// into a DIFFERENT group and groups can be renamed in edit mode, both a
// tool's group and a group's label become user data, not the fixed
// group/label baked into Toolset.tsx's ACTIONS/GROUPS. Stored as a flat
// [key, value, key, value, ...] list (tab-joined, same as every other key
// here) -- the React side pairs them back into a map. Membership: actionId
// -> groupId. Labels: groupId -> displayed label.
const TOOLSET_GROUPS_KEY = "OVToolsetGroups";
const TOOLSET_LABELS_KEY = "OVToolsetLabels";
// Full-page tools the user has pinned into the Toolset grid as a button
// (via edit mode's "Add tool" search), beyond the fixed one-click ACTIONS.
// Stores raw tool ids from toolRegistry.tsx's TOOLS list -- Toolset.tsx
// namespaces them (a "link:" prefix) only in its own in-memory order/group
// keys, not here.
const TOOLSET_PINNED_KEY = "OVToolsetPinned";

function loadTabList(key: string): string[] {
  if (app.settings.haveSetting(TOOLSET_SETTINGS_SECTION, key)) {
    const raw = app.settings.getSetting(TOOLSET_SETTINGS_SECTION, key);
    if (raw === "") return [];
    return raw.split("\t");
  }
  return [];
}

function saveTabList(key: string, ids: string[]): Result {
  try {
    const cleaned: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      cleaned.push(String(ids[i]).replace(/[\t\n\r]/g, " "));
    }
    app.settings.saveSetting(TOOLSET_SETTINGS_SECTION, key, cleaned.join("\t"));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

export const loadHiddenToolsetActions = (): string[] => loadTabList(TOOLSET_HIDDEN_KEY);
export const saveHiddenToolsetActions = (ids: string[]): Result => saveTabList(TOOLSET_HIDDEN_KEY, ids);

export const loadToolsetOrder = (): string[] => loadTabList(TOOLSET_ORDER_KEY);
export const saveToolsetOrder = (ids: string[]): Result => saveTabList(TOOLSET_ORDER_KEY, ids);

// Flat [actionId, groupId, actionId, groupId, ...]; React pairs into a map.
export const loadToolsetGroups = (): string[] => loadTabList(TOOLSET_GROUPS_KEY);
export const saveToolsetGroups = (flatPairs: string[]): Result => saveTabList(TOOLSET_GROUPS_KEY, flatPairs);

// Flat [groupId, label, groupId, label, ...]; React pairs into a map.
export const loadToolsetLabels = (): string[] => loadTabList(TOOLSET_LABELS_KEY);
export const saveToolsetLabels = (flatPairs: string[]): Result => saveTabList(TOOLSET_LABELS_KEY, flatPairs);

export const loadPinnedToolsetLinks = (): string[] => loadTabList(TOOLSET_PINNED_KEY);
export const savePinnedToolsetLinks = (ids: string[]): Result => saveTabList(TOOLSET_PINNED_KEY, ids);

// =============================================================================
// RailScreen personalisation -- the SAME long-press "edit mode" concept as
// the Toolset grid above (HIDE a tool, drag it into a different STAGE
// group, rename a stage's label), applied to RailScreen's vertical rail
// (currently only ToolsScreen -- "Size & Format"/"Layers & Rigging"/etc --
// but written generically since RailScreen.tsx is a shared component and
// LocaliseScreen could adopt it later). Reordering within/across stages
// reuses the EXISTING saveToolOrder()/loadAllToolOrders() above unchanged
// (a stage's tool list is just that category's flat saved order filtered
// to the stage's membership, same as RailScreen already derives its rows
// today) -- only hide/stage-membership/stage-label are new state.
//
// Keyed by categoryId (unlike the Toolset keys above, which are global --
// there's only one Toolset grid, but RailScreen is reused per category),
// stored as one JSON blob per key covering every category's map in one
// round trip -- same "load everything once, category screens read their
// own slice" shape as loadAllToolOrders(). JSON is a deliberate choice
// over the tab-separated convention used elsewhere in this file: a stage
// override needs a real toolId->stageId MAP per category, and this
// codebase already has precedent for JSON-in-app.settings (motionTools.ts's
// ease presets) rather than inventing a third delimiter scheme.
// =============================================================================
const RAIL_SETTINGS_SECTION = "XYiToolbox";
const RAIL_HIDDEN_KEY = "OVRailHidden"; // { [categoryId]: toolId[] }
const RAIL_STAGE_KEY = "OVRailStage"; // { [categoryId]: { [toolId]: stageId } }
const RAIL_LABELS_KEY = "OVRailLabels"; // { [categoryId]: { [stageId]: label } }

function loadRailJSON(key: string): Record<string, any> {
  if (!app.settings.haveSetting(RAIL_SETTINGS_SECTION, key)) return {};
  try {
    const raw = app.settings.getSetting(RAIL_SETTINGS_SECTION, key);
    if (raw === "") return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveRailJSON(key: string, data: Record<string, any>): Result {
  try {
    app.settings.saveSetting(RAIL_SETTINGS_SECTION, key, JSON.stringify(data));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

export const loadAllRailHidden = (): Record<string, string[]> => loadRailJSON(RAIL_HIDDEN_KEY) as Record<string, string[]>;
export const saveRailHidden = (categoryId: string, toolIds: string[]): Result => {
  const all = loadRailJSON(RAIL_HIDDEN_KEY);
  all[categoryId] = toolIds;
  return saveRailJSON(RAIL_HIDDEN_KEY, all);
};

export const loadAllRailStages = (): Record<string, Record<string, string>> => loadRailJSON(RAIL_STAGE_KEY) as Record<string, Record<string, string>>;
export const saveRailStages = (categoryId: string, overrides: Record<string, string>): Result => {
  const all = loadRailJSON(RAIL_STAGE_KEY);
  all[categoryId] = overrides;
  return saveRailJSON(RAIL_STAGE_KEY, all);
};

export const loadAllRailLabels = (): Record<string, Record<string, string>> => loadRailJSON(RAIL_LABELS_KEY) as Record<string, Record<string, string>>;
export const saveRailLabels = (categoryId: string, labels: Record<string, string>): Result => {
  const all = loadRailJSON(RAIL_LABELS_KEY);
  all[categoryId] = labels;
  return saveRailJSON(RAIL_LABELS_KEY, all);
};

// =============================================================================
// Hidden theme picker (triggered by typing "jacqui" into the home search box)
// -- a single theme id, or "" for the default/host-matched look. Same
// section as everything else here; deliberately its own single string key
// rather than the tab-list convention, since there's only ever one value.
// =============================================================================
const THEME_KEY = "OVTheme";

export const loadTheme = (): Result => {
  try {
    const raw = app.settings.haveSetting(TOOLSET_SETTINGS_SECTION, THEME_KEY)
      ? app.settings.getSetting(TOOLSET_SETTINGS_SECTION, THEME_KEY)
      : "";
    return { success: true, message: raw };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const saveTheme = (themeId: string): Result => {
  try {
    app.settings.saveSetting(TOOLSET_SETTINGS_SECTION, THEME_KEY, themeId);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

// Which themes have their background decoration (stars/bubbles/etc, see
// themes.ts's per-theme motif) switched on -- toggled by double-clicking a
// theme's name in ThemePicker.tsx. Tab-separated list of theme ids, same
// convention as every other multi-value app.settings key in this file.
const THEME_DECORATIONS_KEY = "OVThemeDecorations";

export const loadThemeDecorations = (): Result => {
  try {
    const raw = app.settings.haveSetting(TOOLSET_SETTINGS_SECTION, THEME_DECORATIONS_KEY)
      ? app.settings.getSetting(TOOLSET_SETTINGS_SECTION, THEME_DECORATIONS_KEY)
      : "";
    return { success: true, message: raw };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const saveThemeDecorations = (themeIds: string): Result => {
  try {
    app.settings.saveSetting(TOOLSET_SETTINGS_SECTION, THEME_DECORATIONS_KEY, themeIds);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
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

// A one-time-per-artist preference (their own Wrike user ID), not tied to
// any one campaign/batch -- set once in Timesheet Tracker's own field,
// persisted here the same way, then embedded into every JSON export from
// then on so the Supabase import path can attribute the row to a real
// Wrike user instead of leaving it null.
const WRIKE_USER_SETTINGS_SECTION = "XYiToolbox";
const WRIKE_USER_ID_KEY = "WrikeUserId";

export const loadWrikeUserId = (): string => {
  if (app.settings.haveSetting(WRIKE_USER_SETTINGS_SECTION, WRIKE_USER_ID_KEY)) {
    return app.settings.getSetting(WRIKE_USER_SETTINGS_SECTION, WRIKE_USER_ID_KEY);
  }
  return "";
};

export const saveWrikeUserId = (id: string): Result => {
  try {
    app.settings.saveSetting(WRIKE_USER_SETTINGS_SECTION, WRIKE_USER_ID_KEY, id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Wrike API permanent token (Wrike Tasks tool) -- distinct from
// WRIKE_USER_ID_KEY above, which is a free-typed ID used only to label
// Timesheet Tracker exports. This key holds a real Wrike API credential
// (Bearer token, calls go out over Node's https module from
// wrikeApi.ts -- see that file's header for why this doesn't go through
// ExtendScript/evalTS the way every other Wrike-adjacent feature does),
// so it's stored under its own key rather than reusing WrikeUserId.
// Same app.settings section/persistence convention as everything else in
// this file -- this is a per-machine credential, not campaign data.
// =============================================================================
const WRIKE_API_TOKEN_KEY = "WrikeApiToken";

export const loadWrikeApiToken = (): string => {
  if (app.settings.haveSetting(WRIKE_USER_SETTINGS_SECTION, WRIKE_API_TOKEN_KEY)) {
    return app.settings.getSetting(WRIKE_USER_SETTINGS_SECTION, WRIKE_API_TOKEN_KEY);
  }
  return "";
};

export const saveWrikeApiToken = (token: string): Result => {
  try {
    app.settings.saveSetting(WRIKE_USER_SETTINGS_SECTION, WRIKE_API_TOKEN_KEY, token);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
