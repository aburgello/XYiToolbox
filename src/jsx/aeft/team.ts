// =============================================================================
// src/jsx/aeft/team.ts -- Team Folder features: one user-picked folder on the
// studio NAS (a consistent mount on every artist machine -- same assumption
// the Frontcard template path already relies on) holding:
//   - profiles/<name>.json  -- named snapshots of the panel's personalisation
//     settings, so an artist can apply THEIR setup on any machine.
//   - shared-combos.json / shared-expressions.json -- team libraries merged
//     into the local stores on panel open (pull) and added to via explicit
//     per-item "Share to team" actions (push). Deliberately NOT a blind
//     bidirectional auto-sync of whole stores: sharing is opt-in per item, so
//     one artist's scratch content doesn't flood the team, and deleting a
//     local copy doesn't resurrect on next open unless it's genuinely shared.
//   - toolbox-version.txt -- the newest panel version, hand-updated when a
//     new ZXP is distributed; the panel shows a quiet update nudge when its
//     own TOOLBOX_VERSION is older.
//
// The team folder path persists in app.settings like everything else, but
// per-MACHINE ("TeamFolderPath" is where this machine mounts the share) --
// it is deliberately NOT part of a profile snapshot.
//
// SECURITY NOTE: profile snapshots go to a SHARED folder, so PROFILE_KEYS
// must never include secrets -- WrikeApiToken is explicitly excluded (and
// WrikeUserId, which is harmless but personal-machine config, not a panel
// preference). If a future setting holds a credential, keep it out of
// PROFILE_KEYS too.
// =============================================================================
import { Result, SETTINGS_SECTION } from "./shared";
import { expressionsBankLoad, expressionsBankSave } from "./tools";
import { loadCombos, saveCombos, EffectComboEntry } from "./effects";

const TEAM_FOLDER_KEY = "TeamFolderPath";

// --- Team folder path ------------------------------------------------------

function loadTeamFolderPath(): string {
  try {
    if (!app.settings.haveSetting(SETTINGS_SECTION, TEAM_FOLDER_KEY)) return "";
    return app.settings.getSetting(SETTINGS_SECTION, TEAM_FOLDER_KEY) || "";
  } catch (e) {
    return "";
  }
}

// The folder object, or null when unset / the share isn't mounted right now.
// Callers treat null as "team features quietly unavailable", not an error --
// an unmounted NAS on a laptop at home is a normal state, not a failure.
function teamFolder(): Folder | null {
  const path = loadTeamFolderPath();
  if (!path) return null;
  const folder = new Folder(path);
  return folder.exists ? folder : null;
}

interface TeamFolderResult extends Result {
  path?: string;
  mounted?: boolean;
}

export const teamGetFolder = (): TeamFolderResult => {
  try {
    const path = loadTeamFolderPath();
    return { success: true, path: path, mounted: path !== "" && new Folder(path).exists };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const teamSelectFolder = (): TeamFolderResult => {
  try {
    const picked = Folder.selectDialog("Pick the team folder (a shared location on the NAS)");
    if (!picked) return { success: true, path: "" }; // cancelled -- same ""-means-cancelled convention as file dialogs
    app.settings.saveSetting(SETTINGS_SECTION, TEAM_FOLDER_KEY, picked.fsName);
    return { success: true, path: picked.fsName, mounted: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Small file helpers ----------------------------------------------------

function readTextFile(file: File): string | null {
  try {
    if (!file.exists) return null;
    file.encoding = "UTF-8";
    if (!file.open("r")) return null;
    const content = file.read();
    file.close();
    return content;
  } catch (e) {
    return null;
  }
}

function writeTextFile(file: File, content: string): boolean {
  try {
    file.encoding = "UTF-8";
    if (!file.open("w")) return false;
    file.write(content);
    file.close();
    return true;
  } catch (e) {
    return false;
  }
}

// --- Profiles --------------------------------------------------------------
// Every personalisation setting the panel has, by app.settings key. Values
// are snapshotted/restored as OPAQUE STRINGS -- this list doesn't know or
// care about each store's own format (tab-separated, JSON, plain scalar),
// which is what keeps it robust as individual stores evolve.
//
// Excluded on purpose:
//   - WrikeApiToken (SECRET -- never write to a shared folder), WrikeUserId
//   - OVLibCampaigns / LocLib* / OVThumbOverrides (studio content libraries,
//     not personal preferences)
//   - UsefulFolders (shared with the still-live ScriptUI toolbox and
//     machine-path-shaped), CSVLocLastPath, TimesheetBatches (work state)
//   - QuickFxRecentEffects (usage history, not a chosen preference)
//   - TeamFolderPath (per-machine mount location; see header)
const PROFILE_KEYS: string[] = [
  "OVToolsetHidden",
  "OVToolsetOrder",
  "OVToolsetGroups",
  "OVToolsetLabels",
  "OVToolsetPinned",
  "OVRailHidden",
  "OVRailStage",
  "OVRailLabels",
  "OVToolOrder",
  "OVFavoriteTools",
  "OVTheme",
  "OVThemeDecorations",
  "SfxEnabled",
  "SfxVolume",
  "QuickFxUserEffects",
  "QuickFxCombos",
  "MotionToolsEasePresets",
  "OVCustomTools",
];

const PROFILE_FILE_TYPE = "xyi-toolbox-profile";
const PROFILE_FILE_NAME = "profile.json";

// Folder names come from user-typed member names -- keep only
// filesystem-safe characters; the DISPLAY name lives inside the JSON, so
// sanitising never mangles what the user sees.
function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, "_");
}

// MEMBER-SUBFOLDER LAYOUT (v2, per direct request): each team member is a
// SUBFOLDER of the team folder -- <TeamFolder>/Antonio/, /Jacqui/, ... --
// pre-created by the studio or created automatically by "Save current
// setup as". A member's profile snapshot lives at <member>/profile.json,
// and the folder is the member's home for anything per-member the app
// grows later. Excluded from the member list: "_"-prefixed folders (the
// toolset-wide archive convention) and the legacy "profiles" folder from
// this feature's first version (flat profiles/<name>.json) -- legacy files
// are still READ as a fallback so nothing already saved is orphaned, but
// saving always writes the member-folder layout.
export interface TeamProfileInfo {
  name: string;
  hasProfile: boolean;
}

interface ProfileListResult extends Result {
  profiles?: TeamProfileInfo[];
  folderSet?: boolean;
  mounted?: boolean;
}

// Finds the profile.json inside a member folder by LISTING the folder
// (folder.getFiles() with NO mask) and name-matching, rather than a string
// mask -- getFiles("profile.json") -- or a stat on a reconstructed path --
// new File(fsName + "/profile.json").exists. BOTH of those were tried and
// BOTH failed over the office's network-mounted team folder: Antonio's
// profile.json plainly existed in Finder yet every row stayed "NO SETUP
// YET". The no-mask getFiles() is the EXACT same call that reliably
// enumerates the member folders under the root (see teamListProfiles), so
// it's the one to trust everywhere -- let the OS hand us the real directory
// listing and compare names ourselves. Returns the File object straight from
// that listing (safe to read immediately); the reconstructed-path stat stays
// only as a last-resort fallback.
function folderProfileFile(folder: Folder): File | null {
  try {
    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it instanceof File && String(it.name).toLowerCase() === PROFILE_FILE_NAME) return it as File;
    }
  } catch (e) {
    // unreadable folder -- fall through to the stat fallback
  }
  try {
    const f = new File(folder.fsName + "/" + PROFILE_FILE_NAME);
    if (f.exists) return f;
  } catch (e) {
    // ignore
  }
  return null;
}

// Resolves a member NAME to its folder by matching the root's ACTUAL listing
// (case-/sanitisation-insensitive), so apply/delete land on the same folder
// the list showed even if the on-disk name differs slightly from the
// sanitised reconstruction. Falls back to the constructed path.
function memberFolderByName(name: string): Folder | null {
  const root = teamFolder();
  if (!root) return null;
  const target = sanitizeFileName(name).toLowerCase();
  try {
    const items = root.getFiles();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it instanceof Folder && sanitizeFileName(it.name).toLowerCase() === target) return it as Folder;
    }
  } catch (e) {
    // fall through to the constructed path
  }
  const direct = new Folder(root.fsName + "/" + sanitizeFileName(name));
  return direct.exists ? direct : null;
}

function legacyProfileFile(name: string): File | null {
  const root = teamFolder();
  if (!root) return null;
  return new File(root.fsName + "/profiles/" + sanitizeFileName(name) + ".json");
}

export const teamListProfiles = (): ProfileListResult => {
  try {
    const path = loadTeamFolderPath();
    const root = teamFolder();
    if (!root) return { success: true, profiles: [], folderSet: path !== "", mounted: false };

    const profiles: TeamProfileInfo[] = [];
    const seen: { [lower: string]: boolean } = {};

    const items = root.getFiles();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!(item instanceof Folder)) continue;
      const name = item.name;
      if (!name || name.charAt(0) === "_") continue;
      if (name.toLowerCase() === "profiles") continue; // legacy layout, handled below
      const legacy = legacyProfileFile(name);
      profiles.push({ name: name, hasProfile: folderProfileFile(item as Folder) !== null || (legacy !== null && legacy.exists) });
      seen[name.toLowerCase()] = true;
    }

    // Legacy-only profiles (saved before the member-folder layout) whose
    // member folder doesn't exist yet still show up, so nothing vanishes
    // from the list after updating the panel.
    const legacyFolder = new Folder(root.fsName + "/profiles");
    if (legacyFolder.exists) {
      const files = legacyFolder.getFiles("*.json");
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (!(f instanceof File)) continue;
        const content = readTextFile(f);
        if (!content) continue;
        try {
          const parsed = JSON.parse(content);
          if (parsed && parsed.type === PROFILE_FILE_TYPE && parsed.name && !seen[String(parsed.name).toLowerCase()]) {
            profiles.push({ name: parsed.name, hasProfile: true });
            seen[String(parsed.name).toLowerCase()] = true;
          }
        } catch (e2) {
          // not a profile file -- skip
        }
      }
    }

    return { success: true, profiles: profiles, folderSet: true, mounted: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const teamSaveProfile = (name: string): ProfileListResult => {
  try {
    const trimmed = name && name.length > 0 ? name : "";
    if (!trimmed) return { success: false, error: "Give the profile a name first." };
    const root = teamFolder();
    if (!root) return { success: false, error: "Team folder not set or not reachable -- set it first (is the NAS mounted?)." };

    // Reuse the member's existing folder when the root listing finds it --
    // avoids a spurious "could not create" if a network-mount .exists check
    // is flaky on an already-present folder (same class of NAS quirk the
    // profile-detection fix above works around). Only construct + create
    // when the member genuinely has no folder yet.
    let memberFolder = memberFolderByName(trimmed);
    if (!memberFolder) {
      const fresh = new Folder(root.fsName + "/" + sanitizeFileName(trimmed));
      if (!fresh.create() && !fresh.exists) {
        return { success: false, error: "Could not create the member folder on the team share." };
      }
      memberFolder = fresh;
    }

    const settings: { [key: string]: string } = {};
    for (let i = 0; i < PROFILE_KEYS.length; i++) {
      const key = PROFILE_KEYS[i];
      settings[key] = app.settings.haveSetting(SETTINGS_SECTION, key)
        ? app.settings.getSetting(SETTINGS_SECTION, key)
        : "";
    }

    const file = new File(memberFolder.fsName + "/" + PROFILE_FILE_NAME);
    const payload = JSON.stringify({ type: PROFILE_FILE_TYPE, version: 2, name: trimmed, savedAt: new Date().toString(), settings: settings });
    if (!writeTextFile(file, payload)) return { success: false, error: "Could not write the profile file." };

    return teamListProfiles();
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Machine ownership / guest sessions -------------------------------------
// Fits the studio's real workflow (everyone has their own station, but
// occasionally hops onto a colleague's Mac): applying someone ELSE's profile
// on a machine used to be destructive -- it overwrote the host machine's
// personalisation, guarded only by a confirm dialog telling the owner to
// have saved first. Now the FIRST guest apply automatically snapshots the
// machine's current setup into a LOCAL app.settings key first, and the panel
// offers one-click restore for the machine's owner when they're back.
//
// All three keys are per-MACHINE local state, never part of PROFILE_KEYS
// (a profile must not carry another machine's ownership tag or backup):
//   TeamMachineOwner   -- member name this station belongs to ("" = untagged)
//   TeamLiveSync       -- "1" = auto-save the owner's profile to the NAS once
//                         per session on panel open, so the snapshot other
//                         machines apply is always the latest, not stale
//   TeamPreGuestBackup -- JSON {type, appliedProfile, at, settings} of the
//                         machine's own setup, written by the first guest
//                         apply, cleared by restore / owner re-apply
const MACHINE_OWNER_KEY = "TeamMachineOwner";
const LIVE_SYNC_KEY = "TeamLiveSync";
const GUEST_BACKUP_KEY = "TeamPreGuestBackup";
const GUEST_BACKUP_TYPE = "xyi-guest-backup";

function loadLocalSetting(key: string): string {
  try {
    return app.settings.haveSetting(SETTINGS_SECTION, key) ? app.settings.getSetting(SETTINGS_SECTION, key) : "";
  } catch (e) {
    return "";
  }
}

function snapshotLocalSettings(): { [key: string]: string } {
  const settings: { [key: string]: string } = {};
  for (let i = 0; i < PROFILE_KEYS.length; i++) {
    const key = PROFILE_KEYS[i];
    settings[key] = app.settings.haveSetting(SETTINGS_SECTION, key)
      ? app.settings.getSetting(SETTINGS_SECTION, key)
      : "";
  }
  return settings;
}

interface MachineStateResult extends Result {
  owner?: string;
  liveSync?: boolean;
  guestProfile?: string; // member name whose setup is currently applied as a guest, "" when none
}

export const teamGetMachineState = (): MachineStateResult => {
  try {
    let guestProfile = "";
    const rawBackup = loadLocalSetting(GUEST_BACKUP_KEY);
    if (rawBackup) {
      try {
        const parsed = JSON.parse(rawBackup);
        if (parsed && parsed.type === GUEST_BACKUP_TYPE) guestProfile = parsed.appliedProfile || "";
      } catch (e2) {
        // corrupt backup -- report no guest session rather than erroring
      }
    }
    return {
      success: true,
      owner: loadLocalSetting(MACHINE_OWNER_KEY),
      liveSync: loadLocalSetting(LIVE_SYNC_KEY) === "1",
      guestProfile: guestProfile,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// name "" clears the tag (clicking the owner's own home icon toggles off).
export const teamSetMachineOwner = (name: string): Result => {
  try {
    app.settings.saveSetting(SETTINGS_SECTION, MACHINE_OWNER_KEY, name || "");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const teamSetLiveSync = (enabled: boolean): Result => {
  try {
    app.settings.saveSetting(SETTINGS_SECTION, LIVE_SYNC_KEY, enabled ? "1" : "0");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Puts the machine back the way it was before the first guest apply --
// writes the backup's values over every PROFILE_KEY and clears the backup.
// The frontend reloads the panel afterwards, same as applying a profile.
export const teamRestoreLocalSetup = (): Result => {
  try {
    const raw = loadLocalSetting(GUEST_BACKUP_KEY);
    if (!raw) return { success: false, error: "Nothing to restore -- no guest setup is active on this machine." };
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.type !== GUEST_BACKUP_TYPE || !parsed.settings) {
      return { success: false, error: "The local backup looks corrupt -- restore aborted (nothing was changed)." };
    }
    for (let i = 0; i < PROFILE_KEYS.length; i++) {
      const key = PROFILE_KEYS[i];
      const value = parsed.settings[key];
      app.settings.saveSetting(SETTINGS_SECTION, key, typeof value === "string" ? value : "");
    }
    app.settings.saveSetting(SETTINGS_SECTION, GUEST_BACKUP_KEY, "");
    const owner = loadLocalSetting(MACHINE_OWNER_KEY);
    return { success: true, message: "Restored " + (owner ? owner + "'s" : "this machine's") + " setup." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Once-per-session (frontend's mount block): if this station is tagged with
// an owner AND live sync is on AND the NAS is reachable, silently push the
// machine's current setup to the owner's NAS profile -- so the snapshot a
// colleague's machine applies is always the latest, not last month's manual
// save. Every skip condition returns success with no message (this must
// never toast an error just because a laptop is off the studio network).
// CRITICAL guard: never syncs while a guest backup is active -- that would
// overwrite the owner's NAS profile with the GUEST's setup.
export const teamAutoSyncProfile = (): Result => {
  try {
    const owner = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!owner) return { success: true };
    if (loadLocalSetting(LIVE_SYNC_KEY) !== "1") return { success: true };
    if (loadLocalSetting(GUEST_BACKUP_KEY) !== "") return { success: true };
    if (!teamFolder()) return { success: true };
    const saved = teamSaveProfile(owner);
    return saved.success ? { success: true, message: "Profile synced." } : { success: true };
  } catch (e) {
    return { success: true }; // background convenience -- never surfaces as a failure
  }
};

// Applies a member's profile by writing its snapshotted values back into
// app.settings. Keys the profile DOESN'T carry are reset to "" (which every
// loader treats as its default/empty state) -- otherwise whatever the
// machine's previous user had customised would bleed through into the
// applied profile. The frontend reloads the panel afterwards so every
// mounted component re-reads its settings.
//
// Guest-session behaviour (see the Machine ownership section above):
//   - Applying a profile that is NOT the machine's tagged owner first
//     snapshots the current local setup into TeamPreGuestBackup -- but only
//     if no backup exists yet, so back-to-back guest applies keep the
//     ORIGINAL owner setup, not guest #1's.
//   - Applying the tagged OWNER's own profile clears any backup instead
//     (the owner reclaiming their machine ends the guest session).
export const teamApplyProfile = (memberName: string): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set or not reachable (is the NAS mounted?)." };
    const memberFolder = memberFolderByName(memberName);
    let file: File | null = memberFolder ? folderProfileFile(memberFolder) : null;
    if (!file) {
      const legacy = legacyProfileFile(memberName);
      if (legacy && legacy.exists) file = legacy;
    }
    const content = file ? readTextFile(file) : null;
    if (!content) return { success: false, error: '"' + memberName + '" hasn\'t saved a setup yet -- they need to hit "Save current setup as" on their machine first.' };
    const parsed = JSON.parse(content);
    if (!parsed || parsed.type !== PROFILE_FILE_TYPE || !parsed.settings) {
      return { success: false, error: "That file isn't a toolbox profile." };
    }

    const owner = loadLocalSetting(MACHINE_OWNER_KEY);
    const isOwnerReclaim = owner !== "" && memberName === owner;
    if (isOwnerReclaim) {
      app.settings.saveSetting(SETTINGS_SECTION, GUEST_BACKUP_KEY, "");
    } else {
      const existingRaw = loadLocalSetting(GUEST_BACKUP_KEY);
      if (existingRaw === "") {
        app.settings.saveSetting(
          SETTINGS_SECTION,
          GUEST_BACKUP_KEY,
          JSON.stringify({ type: GUEST_BACKUP_TYPE, appliedProfile: memberName, at: new Date().toString(), settings: snapshotLocalSettings() })
        );
      } else {
        // Keep the original backup's settings; just track the LATEST guest
        // name so the restore banner reads correctly.
        try {
          const existing = JSON.parse(existingRaw);
          if (existing && existing.type === GUEST_BACKUP_TYPE) {
            existing.appliedProfile = memberName;
            app.settings.saveSetting(SETTINGS_SECTION, GUEST_BACKUP_KEY, JSON.stringify(existing));
          }
        } catch (e2) {
          // corrupt existing backup -- leave it as-is rather than clobbering
        }
      }
    }

    for (let i = 0; i < PROFILE_KEYS.length; i++) {
      const key = PROFILE_KEYS[i];
      const value = parsed.settings[key];
      app.settings.saveSetting(SETTINGS_SECTION, key, typeof value === "string" ? value : "");
    }
    return { success: true, message: 'Applied profile "' + parsed.name + '".' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Removes the member's saved SNAPSHOT only -- deliberately never the member
// folder itself (it's their home for future per-member data, and may have
// been pre-created by the studio).
export const teamDeleteProfile = (memberName: string): ProfileListResult => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not reachable." };
    const memberFolder = memberFolderByName(memberName);
    const file = memberFolder ? folderProfileFile(memberFolder) : null;
    if (file && file.exists) file.remove();
    const legacy = legacyProfileFile(memberName);
    if (legacy && legacy.exists) legacy.remove();
    return teamListProfiles();
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Version nudge ---------------------------------------------------------
// <team>/toolbox-version.txt holds the newest distributed version string
// (same year.month format as TOOLBOX_VERSION, e.g. "2026.08") -- updated by
// hand when a new ZXP goes out. Comparison happens frontend-side against
// its own TOOLBOX_VERSION constant.
interface VersionResult extends Result {
  latest?: string;
}

export const teamCheckVersion = (): VersionResult => {
  try {
    const root = teamFolder();
    if (!root) return { success: true, latest: "" }; // no folder -> no nudge, not an error
    const file = new File(root.fsName + "/toolbox-version.txt");
    const content = readTextFile(file);
    if (!content) return { success: true, latest: "" };
    return { success: true, latest: content.replace(/^\s+|\s+$/g, "") };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Shared libraries (combos + expressions) -------------------------------
// Pull side: teamSyncShared() runs quietly on panel open and merges anything
// new from the shared files into the local stores (merge by NAME, imported
// combos get fresh ids -- same rules as quickFxImportCombos). Push side:
// teamShareCombo/teamShareExpression add ONE item to the shared file.

const SHARED_COMBOS_FILE = "shared-combos.json";
const SHARED_EXPRESSIONS_FILE = "shared-expressions.json";
const SHARED_COMBOS_TYPE = "xyi-shared-combos";
const SHARED_EXPRESSIONS_TYPE = "xyi-shared-expressions";

interface ExpressionEntry {
  id: string;
  name: string;
  tag: string;
  code: string;
  uses: number;
  description: string;
}

function readSharedFile<T>(fileName: string, expectedType: string): T[] | null {
  const root = teamFolder();
  if (!root) return null;
  const content = readTextFile(new File(root.fsName + "/" + fileName));
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || parsed.type !== expectedType || !(parsed.entries instanceof Array)) return null;
    return parsed.entries as T[];
  } catch (e) {
    return null;
  }
}

function writeSharedFile<T>(fileName: string, expectedType: string, entries: T[]): boolean {
  const root = teamFolder();
  if (!root) return false;
  return writeTextFile(new File(root.fsName + "/" + fileName), JSON.stringify({ type: expectedType, version: 1, entries: entries }));
}

function loadLocalExpressions(): ExpressionEntry[] {
  const result = expressionsBankLoad();
  if (!result.success || !(result as { message?: string }).message) return [];
  try {
    return JSON.parse((result as { message: string }).message) as ExpressionEntry[];
  } catch (e) {
    return [];
  }
}

interface SyncResult extends Result {
  newCombos?: number;
  newExpressions?: number;
}

export const teamSyncShared = (): SyncResult => {
  try {
    if (!teamFolder()) return { success: true, newCombos: 0, newExpressions: 0 };

    // Combos: shared -> local, merge by name.
    let newCombos = 0;
    const sharedCombos = readSharedFile<EffectComboEntry>(SHARED_COMBOS_FILE, SHARED_COMBOS_TYPE);
    if (sharedCombos && sharedCombos.length > 0) {
      const local = loadCombos();
      const names: { [lower: string]: boolean } = {};
      for (let i = 0; i < local.length; i++) names[local[i].name.toLowerCase()] = true;
      for (let i = 0; i < sharedCombos.length; i++) {
        const combo = sharedCombos[i];
        if (!combo || !combo.name || !(combo.effects instanceof Array) || combo.effects.length === 0) continue;
        if (names[combo.name.toLowerCase()]) continue;
        local.push({
          id: "combo-" + new Date().getTime() + "-" + Math.floor(Math.random() * 100000) + "-" + i,
          name: combo.name,
          effects: combo.effects,
        });
        names[combo.name.toLowerCase()] = true;
        newCombos++;
      }
      if (newCombos > 0) saveCombos(local);
    }

    // Expressions: shared -> local, merge by name.
    let newExpressions = 0;
    const sharedExpr = readSharedFile<ExpressionEntry>(SHARED_EXPRESSIONS_FILE, SHARED_EXPRESSIONS_TYPE);
    if (sharedExpr && sharedExpr.length > 0) {
      const local = loadLocalExpressions();
      const names: { [lower: string]: boolean } = {};
      for (let i = 0; i < local.length; i++) names[local[i].name.toLowerCase()] = true;
      for (let i = 0; i < sharedExpr.length; i++) {
        const entry = sharedExpr[i];
        if (!entry || !entry.name || !entry.code) continue;
        if (names[entry.name.toLowerCase()]) continue;
        local.push({
          id: "expr-" + new Date().getTime() + "-" + Math.floor(Math.random() * 100000) + "-" + i,
          name: entry.name,
          tag: entry.tag || "",
          code: entry.code,
          uses: 0,
          description: entry.description || "",
        });
        names[entry.name.toLowerCase()] = true;
        newExpressions++;
      }
      if (newExpressions > 0) expressionsBankSave(JSON.stringify(local));
    }

    return { success: true, newCombos: newCombos, newExpressions: newExpressions };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const teamShareCombo = (comboId: string): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };
    const local = loadCombos();
    let combo: EffectComboEntry | null = null;
    for (let i = 0; i < local.length; i++) {
      if (local[i].id === comboId) { combo = local[i]; break; }
    }
    if (!combo) return { success: false, error: "Combo not found." };

    const shared = readSharedFile<EffectComboEntry>(SHARED_COMBOS_FILE, SHARED_COMBOS_TYPE) || [];
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].name.toLowerCase() === combo.name.toLowerCase()) {
        return { success: true, message: '"' + combo.name + '" is already in the team library.' };
      }
    }
    shared.push(combo);
    if (!writeSharedFile(SHARED_COMBOS_FILE, SHARED_COMBOS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: 'Shared "' + combo.name + '" with the team.' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Takes the FULL entry as a JSON payload, deliberately NOT an id looked up
// in the persisted store -- the Expressions Bank's 20 built-in templates
// live only in the frontend (ExpressionsBank.tsx's MOCK_ENTRIES) and are
// never written to app.settings until the user edits something, so an
// id-lookup here returned "Expression not found" the first time someone
// tried to share a template (real-AE report). The frontend already holds
// everything the shared file needs; passing it removes the store
// dependency entirely.
export const teamShareExpression = (entryJson: string): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };
    let entry: ExpressionEntry | null = null;
    try {
      entry = JSON.parse(entryJson) as ExpressionEntry;
    } catch (e2) {
      return { success: false, error: "Could not read the expression data." };
    }
    if (!entry || !entry.name || !entry.code) return { success: false, error: "Expression has no name/code to share." };

    const shared = readSharedFile<ExpressionEntry>(SHARED_EXPRESSIONS_FILE, SHARED_EXPRESSIONS_TYPE) || [];
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].name.toLowerCase() === entry.name.toLowerCase()) {
        return { success: true, message: '"' + entry.name + '" is already in the team library.' };
      }
    }
    shared.push(entry);
    if (!writeSharedFile(SHARED_EXPRESSIONS_FILE, SHARED_EXPRESSIONS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: 'Shared "' + entry.name + '" with the team.' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
