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
import { Result, SETTINGS_SECTION, decode } from "./shared";
import { expressionsBankLoad, expressionsBankSave, loadCustomTools, saveCustomTools, mastersSkipFolder, creativeTokenOf, TC_COUNTRIES } from "./tools";
import { loadCombos, saveCombos, EffectComboEntry } from "./effects";
import { loadCampaignsRaw, saveCampaign, loadCampaignBanner, setCampaignBanner } from "./review";
import { loadLocLibCampaigns, saveLocLibCampaign, scanTerritories } from "./localise";

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

// Reads a text file WITHOUT gating on File.exists.
//
// THIS WAS THE ROOT CAUSE of the long-running "NO SETUP YET" bug. On the
// studio's network-mounted team folder, File.exists returns FALSE for files
// that plainly exist (confirmed: Antonio/profile.json visible in Finder,
// .exists false). Because every read in this file funnels through here, that
// one stat silently broke the whole feature at once:
//   - profile detection -> hasProfile false -> every row "NO SETUP YET"
//   - teamApplyProfile  -> null content -> "hasn't saved a setup yet",
//     i.e. importing a colleague's setup was impossible
//   - version check / shared-library sync -> quietly no-op'd
// Fixing detection alone never worked because detection AND consumption both
// sat behind this same gate.
//
// file.open("r") is the authoritative test: if it opens, the file is there
// and readable; if it doesn't, it's unusable no matter what .exists claims.
// So just attempt the open and let that be the answer. (open() on a missing
// file returns false, so the "not there" case still returns null -- we lose
// nothing by dropping the stat.)
function readTextFile(file: File): string | null {
  try {
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
  "OVToolsetStarred",
  "OVRailHidden",
  "OVRailStage",
  "OVRailLabels",
  "OVToolOrder",
  "OVFavoriteTools",
  "OVTheme",
  "OVThemeDecorations",
  "OVThemeSurface",
  "OVThemeBorders",
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
      // Match by NAME only -- do NOT gate on `it instanceof File`. A profile
      // is only ever a file, and host-class instanceof isn't fully trustable
      // in this engine (see CLAUDE.md's motionTools instanceof-AVLayer note);
      // a folder literally named "profile.json" can't collide in practice.
      // Hand back a File pointed at the OS-provided fsName (a full, correctly
      // encoded path -- not the fsName+"/name" reconstruction that was flaky).
      if (it && String(it.name).toLowerCase() === PROFILE_FILE_NAME) {
        return new File(it.fsName);
      }
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
// Returns a member's profile.json CONTENT, or null if there isn't a usable
// one. Detection deliberately uses the exact same mechanism as consumption
// (an actual read) rather than a separate existence probe -- that mismatch is
// what let the list say "NO SETUP YET" while a perfectly good profile sat
// there, and conversely would have let a row look ready when applying it
// couldn't actually load it. If this returns a string, teamApplyProfile can
// definitely read it too.
function memberProfileContent(folder: Folder): string | null {
  const viaListing = folderProfileFile(folder);
  if (viaListing) {
    const c = readTextFile(viaListing);
    if (c && c.length > 0) return c;
  }
  // Fall back to the constructed path -- no stat, just try to open it.
  const c2 = readTextFile(new File(folder.fsName + "/" + PROFILE_FILE_NAME));
  return c2 && c2.length > 0 ? c2 : null;
}

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
      // hasProfile == "a profile is genuinely readable here", proven by
      // actually reading it (see memberProfileContent) -- never a stat.
      const legacy = legacyProfileFile(name);
      const memberContent = memberProfileContent(item as Folder);
      const legacyContent = memberContent === null && legacy !== null ? readTextFile(legacy) : null;
      profiles.push({ name: name, hasProfile: memberContent !== null || legacyContent !== null });
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

    // Count only the keys that actually carry a value, so the header reflects
    // how much of the setup this snapshot really holds (empty keys = defaults).
    let savedCount = 0;
    for (let k = 0; k < PROFILE_KEYS.length; k++) {
      if (settings[PROFILE_KEYS[k]] !== "") savedCount++;
    }

    const file = new File(memberFolder.fsName + "/" + PROFILE_FILE_NAME);
    // Pretty-printed with a `summary`/`count` header at the top for the same
    // readability reason as the shared library files above.
    const payload = JSON.stringify(
      {
        type: PROFILE_FILE_TYPE,
        version: 2,
        name: trimmed,
        summary: trimmed + "'s setup -- " + savedCount + " of " + PROFILE_KEYS.length + " preferences saved",
        count: savedCount,
        savedAt: new Date().toString(),
        settings: settings,
      },
      null,
      2
    );
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
    // Read the SAME way teamListProfiles decides hasProfile (memberProfileContent
    // -> readTextFile, never a stat), so a row that shows as ready always
    // applies. The old version gated the legacy fallback on legacy.exists,
    // which -- like readTextFile's removed .exists gate -- returns false on the
    // studio's network mount and made importing a colleague's setup impossible.
    const memberFolder = memberFolderByName(memberName);
    let content: string | null = memberFolder ? memberProfileContent(memberFolder) : null;
    if (content === null) {
      const legacy = legacyProfileFile(memberName);
      if (legacy) content = readTextFile(legacy);
    }
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
    // Just attempt the remove -- never gate on .exists (it lies on the studio's
    // network mount, which would silently make Delete a no-op). remove()
    // returning false for an absent file is the harmless case.
    const memberFolder = memberFolderByName(memberName);
    const file = memberFolder ? folderProfileFile(memberFolder) : null;
    if (file) { try { file.remove(); } catch (e2) { /* absent or locked */ } }
    // Also try the constructed path: folderProfileFile can come back null when
    // the listing misses it, and we still want Delete to land.
    if (memberFolder) {
      try { new File(memberFolder.fsName + "/" + PROFILE_FILE_NAME).remove(); } catch (e4) { /* already gone */ }
    }
    const legacy = legacyProfileFile(memberName);
    if (legacy) { try { legacy.remove(); } catch (e3) { /* absent */ } }
    return teamListProfiles();
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Version nudge ---------------------------------------------------------
// <team>/toolbox-version.txt holds the newest distributed version string,
// written by `yarn release`. Same fixed-width YYYYMMDD shape as
// TOOLBOX_VERSION, e.g. "20260804" -- NOT a dotted form: "2026.08" string-
// compares as older than "20260804" ('.' < '0'), so the nudge would never
// fire. Comparison happens frontend-side against the TOOLBOX_VERSION
// constant compiled into the bundle.
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
const SHARED_TOOLS_FILE = "shared-tools.json";
const SHARED_CAMPAIGNS_FILE = "shared-campaigns.json";
const SHARED_WORDGAME_FILE = "shared-wordgame.json";
const SHARED_POSTERGAME_FILE = "shared-postergame.json";
const SHARED_COMBOS_TYPE = "xyi-shared-combos";
const SHARED_EXPRESSIONS_TYPE = "xyi-shared-expressions";
const SHARED_TOOLS_TYPE = "xyi-shared-tools";
const SHARED_CAMPAIGNS_TYPE = "xyi-shared-campaigns";
const SHARED_WORDGAME_TYPE = "xyi-shared-wordgame";
const SHARED_POSTERGAME_TYPE = "xyi-shared-postergame";

// OV Library campaign: just a name + the masters-root path. Sharing these is
// safe/useful here specifically because the masters live on the studio NAS at
// a path that resolves identically on every artist's Mac (same consistent-
// mount assumption Frontcard's hardcoded template path relies on) -- so one
// person's saved campaign points every other machine at the same real folder.
interface SharedCampaign {
  name: string;
  mastersRoot: string;
  // Optional: entries written before campaign banners existed have no such
  // field, so every read must treat it as possibly absent.
  banner?: string;
  // The MARKETS root -- the other half of the same campaign, used by
  // Localised Library and CSV Localiser (LocLibCampaigns) rather than OV
  // Library. Optional for the same reason `banner` is: every entry written
  // before this existed has neither, and one campaign may legitimately be
  // known to the team by only one of its two roots. A row can also carry a
  // marketsRoot and an EMPTY mastersRoot -- that's a campaign shared from
  // CSV Localiser by someone who never added it to OV Library.
  marketsRoot?: string;
  // Retired = the volume has been archived and nobody should be pointed at
  // this campaign any more. A FLAG, never a deletion: a retired row keeps
  // its paths so a machine that still has the volume mounted is not lied
  // to, and so retiring can be undone. Rows are marked in every picker
  // rather than hidden -- see teamSetCampaignRetired.
  retiredBy?: string;
  retiredAt?: string;
}

interface ExpressionEntry {
  id: string;
  name: string;
  tag: string;
  code: string;
  uses: number;
  description: string;
  // Provenance, so the Expressions Bank can section "yours" from "the team's"
  // from the shipped built-ins instead of showing one undifferentiated list.
  // Both optional: entries shared before these existed simply have no author,
  // and the frontend infers an origin for anything unmarked.
  origin?: string; // "builtin" | "mine" | "team"
  author?: string; // member name of the machine that shared it, "" if untagged
}

// Mirrors the frontend's CustomToolEntry (useCustomTools.ts). The `id` is
// machine-local -- stripped on share, re-minted on pull -- so it's optional
// on the shared-file shape.
interface SharedCustomTool {
  id?: string;
  name: string;
  description: string;
  code: string;
  kind: string;
}

// Shared libraries live in a "misc" SUBFOLDER of the team folder rather than
// loose at its root -- asked for directly, so the odds and ends (game boards,
// whatever else gets bolted on) have somewhere to live without cluttering the
// folder people actually navigate for profiles.
//
// MIGRATION, and why reads check two places: the v1 files are already sitting
// at the team folder ROOT on the studio NAS. Moving the write path alone
// would silently orphan every combo and expression already shared. So reads
// prefer misc/ and FALL BACK to the root, writes always go to misc/ -- which
// means the first time anyone shares anything, that library's content is
// read from the old location and written to the new one, migrating itself
// with nothing lost and no manual step. Same legacy-fallback shape
// teamApplyProfile already uses for the flat profiles/ layout.
const MISC_DIR = "misc";

// GAME files get their own subfolder under misc/, so misc/ doesn't end up
// reading as "the arcade folder" when it's meant to hold whatever odds and
// ends get bolted on. Same migration shape as misc/ itself: reads walk
// arcade/ -> misc/ -> root and take the first hit, writes always go to
// arcade/, so a live board/invite file relocates itself the first time
// anything writes to it. Nothing to move by hand, nothing orphaned.
//
// NOTE: a machine still running an OLDER build only looks in misc/ and the
// root, so once a file has migrated it stops seeing it. That's fine for what
// lives here (a rolling 30-day board, ephemeral invites and battle rooms) but
// don't move a file anyone would miss into a new subfolder without also
// leaving the read fallback in place on BOTH sides.
const ARCADE_DIR = MISC_DIR + "/arcade";

// Which shared files belong to the arcade. Kept as one list rather than a flag
// per call site so adding a game means touching exactly this line.
// Bespoke layouts. THE SCREEN IS THE STABLE THING and the campaign is what
// changes: two campaigns on the same peculiar screen want the same regions and
// the same guides, with different artwork in them. So a layout stores geometry
// and the SHAPE of the master each region wants -- never the master itself.
const SHARED_BESPOKE_FILE = "shared-bespoke-layouts.json";
const SHARED_BESPOKE_TYPE = "bespoke-layouts";

export interface BespokeTemplate {
  id: string;
  name: string;
  territory: string;
  site: string;
  canvasW: number;
  canvasH: number;
  guidesX: number[];
  guidesY: number[];
  /** Geometry plus what KIND of master goes there, never which one. */
  slots: {
    x: number; y: number; w: number; h: number; rotation: number;
    masterW: number; masterH: number; masterDuration: string;
  }[];
  savedBy: string;
  stamp: string;

  // ── Added with the screen library. ALL OPTIONAL, and read defensively
  // everywhere, because entries written before it shipped are already on the
  // share and must keep loading unchanged. Absent `kind` means "layout" --
  // that is all there was.
  /**
   * "layout" carries real geometry and draws a wireframe. "template" is an
   * INDEX CARD over an .aep in the old templates folder: it knows where the
   * file is and nothing about what is inside it.
   */
  kind?: "layout" | "template";
  /** kind:"template" only -- the .aep this points at. */
  templatePath?: string;
  /** The venue folder ("GRAND_REX"). `name` stays the display name. */
  screen?: string;
  /**
   * The in-situ / spec image found INSIDE the template by aep_screens.py --
   * the thing an artist would otherwise go hunting for. Bespoke adopts it as
   * the reference when the screen is loaded, so a template becomes traceable
   * without anybody opening it.
   */
  referencePath?: string;
  /**
   * EVERY plausible reference in that template, best first, `referencePath`
   * being the current pick. The scoring is a heuristic and gets it wrong often
   * enough that the artist has to be able to step to the next one -- with a
   * single stored path a wrong guess meant the screen was a dead end.
   */
  referencePaths?: string[];
  /** Retired screens stay in the file and drop out of the default view. */
  status?: "active" | "archive";
  /**
   * THE IN-SITU FOR THIS SCREEN, if one has been laid out.
   *
   * One entry, two layouts: the regions a Bespoke build uses and the faces an
   * in-situ places on a photograph are both about the same physical screen, so
   * they belong on the same card rather than in two libraries that have to be
   * kept in step by hand. Optional and read defensively, like everything else
   * added after this file shipped.
   *
   * `faces` is a JSON STRING rather than an array of objects: the panel hands
   * this straight across `evalTS`, where nested arrays of objects lose their
   * values in transit (CLAUDE.md section 2).
   */
  insitu?: {
    backdrop: string;
    faces: string;
    compName: string;
    stamp: string;
  };
}

/**
 * NULL MEANS "COULD NOT READ", never "there are none".
 *
 * `read` carries that distinction to the panel, the same way teamCampaignBoard
 * and teamLoadWordBoard do. It matters more since the library shipped: an
 * EMPTY library still needs its front door, because seeding is how it stops
 * being empty -- but an UNREACHABLE one must show nothing at all. Collapsing
 * both to `templates: []` made those two states indistinguishable.
 */
export const bespokeTemplateList = (): { success: boolean; read?: boolean; templates?: BespokeTemplate[]; error?: string } => {
  try {
    const entries = readSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE);
    if (entries !== null) return { success: true, read: true, templates: entries };

    // NULL IS THREE DIFFERENT THINGS HERE, and only one of them should hide
    // the library. readSharedFile returns null for an unreachable share, for a
    // corrupt file AND for a file that has simply never been written -- and
    // that last case is the NORMAL state of a studio that has not saved a
    // layout yet, which is exactly who needs the seeding button most. Reporting
    // it as unreadable hid the feature from everybody it was built for.
    //
    // The real question is whether the team folder is reachable, and that is a
    // DIRECTORY, which is the one place .exists can be trusted (section 2).
    const reachable = teamFolder() !== null;
    return { success: true, read: reachable, templates: [] };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Has this shared file ever been written?
 *
 * readSharedFile() collapses three states into one null: share unreachable,
 * file corrupt, and file simply not there yet. Only the last one is safe to
 * treat as "an empty list" -- the other two mean a write would DESTROY rows
 * we failed to read. Attempting the read and believing its failure is the
 * section 2 rule; `.exists` is not consulted on the file itself.
 */
function sharedFileIsAbsent(fileName: string): boolean {
  const root = teamFolder();
  if (!root) return false; // unreachable, not absent -- never safe to overwrite
  const dir = sharedDirFor(fileName);
  if (readTextFile(new File(root.fsName + "/" + dir + "/" + fileName))) return false;
  if (dir !== MISC_DIR && readTextFile(new File(root.fsName + "/" + MISC_DIR + "/" + fileName))) return false;
  if (readTextFile(new File(root.fsName + "/" + fileName))) return false;
  return true;
}

/**
 * Upsert by id, read-modify-write.
 *
 * Last writer wins on the whole file, the same as every other shared list
 * here. A failed READ must not be treated as "the file is empty" -- that
 * would republish one layout over everyone else's, so it refuses instead.
 */
export const bespokeTemplateSave = (entryJson: string): { success: boolean; error?: string; count?: number } => {
  try {
    const entry = JSON.parse(entryJson) as BespokeTemplate;
    if (!entry || !entry.id || !entry.name) return { success: false, error: "A layout needs a name." };
    // WHO SAVED IT, from the machine tag rather than the panel. `savedBy` was
    // always written as "" from the frontend, so the library could not say who
    // laid a screen out -- and an untagged machine simply leaves it blank rather
    // than refusing, because a layout is the artist's own work, not a post to a
    // shared board.
    if (!entry.savedBy) entry.savedBy = loadLocalSetting(MACHINE_OWNER_KEY);
    const existing = readSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE);
    // A null read that is NOT simply "no file yet" must never be treated as an
    // empty list: writing the result would replace everyone else's layouts with
    // this one. Previously any null fell through to the loop below being
    // skipped and `out` being written as a single entry.
    if (existing === null && !sharedFileIsAbsent(SHARED_BESPOKE_FILE)) {
      return { success: false, error: "Couldn't read the saved layouts -- nothing was changed." };
    }
    const out: BespokeTemplate[] = [];
    let replaced = false;
    if (existing !== null) {
      for (let i = 0; i < existing.length; i++) {
        if (String(existing[i].id) === String(entry.id)) { out.push(entry); replaced = true; }
        else out.push(existing[i]);
      }
    }
    if (!replaced) out.push(entry);
    if (!writeSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE, out)) {
      return { success: false, error: "Couldn't write to the team folder -- is the share mounted?" };
    }
    return { success: true, count: out.length };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const bespokeTemplateDelete = (id: string): { success: boolean; error?: string } => {
  try {
    const existing = readSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE);
    // Distinguish "nothing there" from "couldn't read": deleting against a
    // failed read would write back a file missing everyone else's layouts.
    if (existing === null) return { success: false, error: "Couldn't read the saved layouts -- nothing was changed." };
    const out: BespokeTemplate[] = [];
    for (let i = 0; i < existing.length; i++) {
      if (String(existing[i].id) !== String(id)) out.push(existing[i]);
    }
    if (!writeSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE, out)) {
      return { success: false, error: "Couldn't write to the team folder." };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// THE SCREEN LIBRARY -- seeding it from the templates folder.
//
// SEEDING, NOT CONVERTING. Most spec folders have no reference JPG, so a
// layout cannot be derived from disk: the geometry only exists inside the
// template .aep, and getting it out means opening one, which section 1 of
// CLAUDE.md does not let us do casually. So the library starts as an INDEX
// over the templates folder -- territory, screen, filename, walked from the
// path -- and nothing is opened, copied or written to that folder at any
// point below.
//
// A template entry therefore has no slots and draws no wireframe, and that
// is deliberate and visible: a screen reads as UN-TRACED until somebody lays
// it out in Bespoke and saves, at which point the layout supersedes the
// template and the folder has one less reason to exist. The library is the
// index first and the replacement second, so it is useful on day one without
// anybody migrating anything.
// =============================================================================

export interface BespokeScanCandidate {
  id: string;
  territory: string;
  screen: string;
  name: string;
  templatePath: string;
  canvasW: number;
  canvasH: number;
  /** Already in the library -- seeding skips these rather than re-adding. */
  known: boolean;
  /** Already in the library AS A LAYOUT -- seeding must never overwrite it. */
  superseded: boolean;
}

/**
 * The screen's name and size, out of the .aep FILENAME.
 *
 * Both naming conventions, per section 5. Size is zero when it does not parse
 * -- a template that cannot be sized is still a template, and dropping it
 * silently is exactly the failure that rule warns about. A literal regex over
 * a filename is the established idiom here (parseMasterFilename does the
 * same); the banned thing is passing a NAME as the regex argument.
 *
 * NOT the parent folder. A survey of the real tree (103 templates) settled
 * this: the folders are 19 files at Country/x.aep, 46 at Country/Venue/x.aep
 * and 38 deeper still, so no fixed depth names the screen and the shallow ones
 * would every one of them be called after their country. The filename carries
 * the identity in 80% of cases and is present in 100% -- it is the only part
 * of the path that is consistently about the SCREEN.
 *
 *   Template_INTL_DGTL_DOOH_5_TOTEM_5400x1920_15sec_FR  ->  5_TOTEM
 *   template_INTL_DGTL_DOOH_MALL_PLAZA_VESPUCIO_2390x…  ->  MALL_PLAZA_VESPUCIO
 *   Template_INTL_DGTL_LED_GATE_3840x1080_10sec_HU      ->  LED_GATE
 *   chongqing                                           ->  chongqing
 *
 * Everything before the size token is the name; the studio's fixed prefix
 * tokens are then dropped. LED is NOT in that list -- `LED_GATE` is a screen
 * called LED Gate, not a stray prefix.
 */
const TEMPLATE_NAME_PREFIXES = ["TEMPLATED", "TEMPLATE", "INTL", "DOM", "DGTL", "DOOH", "DINTH", "DFOH"];

/** Folder levels that are scaffolding rather than a venue. */
const TEMPLATE_BOILERPLATE_DIRS = [
  "AE", "AEP", "AE_TEMPLATE", "AE_TEMPLATES", "AE_BESPOKE", "AE_BESPOKES",
  "TEMPLATE", "TEMPLATES", "PROJECT", "PROJECTS", "WORKING", "FOLDER",
];

/** A name that does not say WHICH screen this is. */
const TEMPLATE_GENERIC_NAMES = ["", "BESPOKE", "AE", "TEMPLATE", "INSITU", "PROJECT", "COMP_1"];

function isInList(value: string, list: string[]): boolean {
  const up = String(value).toUpperCase();
  for (let i = 0; i < list.length; i++) if (up === list[i]) return true;
  return false;
}

/**
 * SIZE IS PART OF THE IDENTITY, not just a detail on the card.
 *
 * Verified against the real tree: `BARCO_PANORAMA` alone named FIVE different
 * screens (1920x1080, 2160x3840, 3840x2160 ×9, 3840x2160 ×16, 5760x1080) and
 * merging them into one card would have lost four. The tokens between size and
 * duration (`X9_SCREENS`, `X16_SCREENS`) separate the two that share a size.
 *
 * With name + size + that discriminator, 103 template files resolve to 95
 * screens, the 8 collapses all being duration variants of one screen
 * (…_15sec / …_20sec), which is exactly what should collapse.
 */
function parseTemplateFileName(fileName: string): { name: string; w: number; h: number } {
  const stem = String(fileName).replace(/\.aep$/i, "").replace(/^\s+/, "").replace(/\s+$/, "");
  const m = stem.match(/^(.*?)_(\d{2,5})x(\d{2,5})(?:px)?_(.*)$/i);
  let head = m ? m[1] : stem;
  const w = m ? parseInt(m[2], 10) : 0;
  const h = m ? parseInt(m[3], 10) : 0;

  let mid = "";
  if (m) {
    // Whatever sits between the size and the duration discriminates two
    // screens of identical pixel size.
    const d = m[4].match(/^(.*?)_?\d{1,4}(?:sec|s)(?:_|$)/i);
    if (d && d[1]) mid = d[1].replace(/^_+/, "").replace(/_+$/, "");
  }

  // Prefix tokens are dropped WHEREVER they appear, not only leading: a file
  // named after a campaign (CR2_INTL_DGTL_DOOH_CHENGDU…) keeps the whole
  // boilerplate otherwise, because position 0 is the campaign code.
  // `filter` is polyfilled (shared.ts); `some`/`includes` are not.
  let parts = head.split(/[_\s]+/).filter((t: string) => !!t && !isInList(t, TEMPLATE_NAME_PREFIXES));
  // A leading BESPOKE is noise ONLY when something survives it --
  // `Template_INTL_DGTL_BESPOKE_1824x164_15sec_DK` has nothing else to be
  // called, so it keeps it.
  if (parts.length > 1 && parts[0].toUpperCase() === "BESPOKE") parts = parts.slice(1);
  // Trailing version / "folder" noise, e.g. `…_TW_V01 folder`.
  while (parts.length > 1 && /^(v\d+|folder)$/i.test(parts[parts.length - 1])) parts.pop();

  // Separate statements, never a nested ternary: parentheses do not survive
  // the ES3 emit (audit-jsx-precedence.cjs enforces this).
  const base = parts.join("_");
  let name = base;
  if (mid) {
    if (base) name = base + "_" + mid;
    else name = mid;
  }
  return { name: name, w: w, h: h };
}

/**
 * The screen, from the WHOLE PATH -- because neither end of it is reliable
 * alone, and the two real trees disagree about which end carries the name:
 *
 *   DOOH_AE_Bespoke_Templates : Country/<descriptive file>.aep   -> the FILE
 *   DOOH_Specs                : Country/Venue/AE_Template/<generic file>.aep
 *                                                                -> the FOLDER
 *
 * Seeding DOOH_Specs with a filename-first rule produced AE_TEMPLATE,
 * AE_PROJECT and AE as screen names; seeding the templates tree with a
 * folder-first rule named every screen after its country. So: the venue folder
 * when there is one and it says something, the filename otherwise, with the
 * same cleaner over whichever wins -- venue folders are themselves sometimes
 * filename-shaped (`…/Template_INTL_DGTL_DOOH_BESPOKE_4000x128_10sec_UA/`).
 *
 * The SIZE always comes from the file first: a venue folder often has none.
 *
 * Verified over both real trees -- 103 files -> 89 screens, 223 -> 177, with
 * the only remaining generic names being screens genuinely called BESPOKE that
 * have no venue folder at all. Those stay distinct because size is in the id.
 *
 * `midDirs` is the folder path between the territory and the file.
 */
function deriveTemplateScreen(
  midDirs: string[],
  fileName: string
): { name: string; w: number; h: number } {
  let venue = "";
  for (let i = 0; i < midDirs.length; i++) {
    const d = String(midDirs[i]).replace(/^\s+/, "").replace(/\s+$/, "");
    if (!isInList(d, TEMPLATE_BOILERPLATE_DIRS)) venue = d;
  }

  const fromFile = parseTemplateFileName(fileName);
  const fromVenue = venue ? parseTemplateFileName(venue) : { name: "", w: 0, h: 0 };

  let name = fromVenue.name;
  if (isInList(name, TEMPLATE_GENERIC_NAMES)) name = fromFile.name;
  // If BOTH reduce to something generic, keep the generic word rather than
  // falling back to a raw folder string -- size is part of the id, so
  // UKRAINE::BESPOKE::4000x128 and ::6592x96 stay distinct anyway.
  if (isInList(name, TEMPLATE_GENERIC_NAMES)) {
    name = fromVenue.name || fromFile.name || String(fileName).replace(/\.aep$/i, "");
  }

  return { name: name, w: fromFile.w || fromVenue.w, h: fromFile.h || fromVenue.h };
}

/**
 * Walks a templates root and reports what it found. WRITES NOTHING -- the
 * panel shows the candidates and the artist commits them, so a mis-picked
 * folder costs a look rather than 400 junk rows on everyone's share.
 *
 * Territory is the first level under the root and screen is the folder the
 * .aep actually sits in, which is the shape of DOOH_Specs (Country/Venue).
 * A template loose in the territory folder takes its own stem as the screen
 * rather than being skipped.
 */
export const bespokeLibraryScan = (
  rootPath: string
): { success: boolean; candidates?: BespokeScanCandidate[]; scanned?: number; error?: string } => {
  try {
    if (!rootPath) return { success: false, error: "No templates folder given." };
    const root = new Folder(rootPath);
    // .exists on a DIRECTORY is the one trustworthy case (section 2).
    if (!root.exists) return { success: false, error: "That folder isn't reachable:\n" + rootPath };

    const existing = readSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE);
    const knownIds: string[] = [];
    const layoutIds: string[] = [];
    if (existing !== null) {
      for (let i = 0; i < existing.length; i++) {
        const id = String(existing[i].id);
        knownIds.push(id);
        // Absent kind means layout -- that is all there was before this.
        if (!existing[i].kind || existing[i].kind === "layout") layoutIds.push(id);
      }
    }

    const out: BespokeScanCandidate[] = [];
    let scanned = 0;

    // Depth-first, plain for loops, duck-typed folder test -- no forEach, no
    // instanceof, per section 2.
    // `midDirs` is the folder path BELOW the territory -- the venue lives in
    // there, and which level it is varies by tree, so the whole path is
    // carried rather than a fixed depth being assumed.
    const walk = (folder: Folder, territory: string, midDirs: string[], depth: number) => {
      // A templates tree is Country/Venue/[Batch]/file. Six is generous and
      // stops a stray symlink loop dead.
      if (depth > 6) return;
      const items = folder.getFiles();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof (item as Folder).getFiles === "function") {
          // DECODED. Folder.name / File.name come back URI-ENCODED from
          // ExtendScript, so a folder called "AE Template" arrives as
          // "AE%20Template" and got filed as a screen under that name -- along
          // with every territory and venue containing a space or an accent
          // ("ICONICO DA SÉ"). tools.ts:5854 already does this; the scan did
          // not.
          const fname = decodeURI((item as Folder).name);
          // The house rule: `_` folders are out of every scan. That takes
          // `_archive` and `_Template` with it, which is the intent -- an
          // archived screen is not a template anybody wants offered.
          if (fname.substring(0, 1) === "_") continue;
          if (mastersSkipFolder(fname)) continue;
          // The FIRST level below the root is the territory; everything deeper
          // is path on the way to the file.
          if (!territory) walk(item as Folder, fname, [], depth + 1);
          else walk(item as Folder, territory, midDirs.concat([fname]), depth + 1);
        } else {
          const fileName = decodeURI((item as File).name);
          const dot = fileName.lastIndexOf(".");
          if (dot === -1) continue;
          if (fileName.substring(dot + 1).toLowerCase() !== "aep") continue;
          scanned++;
          const parsed = deriveTemplateScreen(midDirs, fileName);
          const screen = parsed.name;
          const size = { w: parsed.w, h: parsed.h };
          const id = (territory + "::" + screen + "::" + (parsed.w ? parsed.w + "x" + parsed.h : "?")).toUpperCase();
          let dupe = false;
          for (let k = 0; k < out.length; k++) if (out[k].id === id) { dupe = true; break; }
          // Two files that reduce to the same screen name in the same territory
          // are versions of one screen, so the first wins and the rest are not
          // new rows. Different screens in one folder now stay distinct, which
          // they did not when the FOLDER supplied the name.
          if (dupe) continue;
          out.push({
            id: id,
            territory: territory,
            screen: screen,
            name: screen,
            templatePath: (item as File).fsName,
            canvasW: size.w,
            canvasH: size.h,
            known: knownIds.indexOf(id) !== -1,
            superseded: layoutIds.indexOf(id) !== -1,
          });
        }
      }
    };

    walk(root, "", [], 0);
    return { success: true, candidates: out, scanned: scanned };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Commits scanned candidates as kind:"template" entries.
 *
 * A LAYOUT IS NEVER OVERWRITTEN BY A TEMPLATE. That is the whole direction of
 * this feature -- layouts supersede templates, never the reverse -- and a
 * re-scan after somebody has traced a screen must not undo their work. Same
 * refusal-on-failed-read contract as every other shared write here: null is
 * "couldn't read", not "the file is empty", and republishing over everyone
 * else's library is worse than doing nothing.
 */
export const bespokeLibrarySeed = (
  entriesJson: string
): { success: boolean; added?: number; skipped?: number; error?: string } => {
  try {
    const incoming = JSON.parse(entriesJson) as BespokeScanCandidate[];
    if (!incoming || !incoming.length) return { success: false, error: "Nothing to add." };

    const existing = readSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE);
    // THE FIRST SEED HAPPENS AGAINST NO FILE AT ALL, which is the whole point
    // of seeding -- refusing every null made the feature impossible to use for
    // exactly the studio it was built for. An unreachable or corrupt library
    // still refuses, because writing over it would lose real rows.
    if (existing === null && !sharedFileIsAbsent(SHARED_BESPOKE_FILE)) {
      return { success: false, error: "Couldn't read the library -- nothing was changed." };
    }

    const me = loadLocalSetting(MACHINE_OWNER_KEY);
    const out: BespokeTemplate[] = [];
    if (existing !== null) for (let i = 0; i < existing.length; i++) out.push(existing[i]);

    let added = 0;
    let skipped = 0;
    for (let i = 0; i < incoming.length; i++) {
      const c = incoming[i];
      if (!c || !c.id) { skipped++; continue; }
      let clash = -1;
      for (let k = 0; k < out.length; k++) if (String(out[k].id) === String(c.id)) { clash = k; break; }
      if (clash !== -1) {
        const kind = out[clash].kind;
        // Absent kind means layout. Leave it alone.
        if (!kind || kind === "layout") { skipped++; continue; }
        // An existing template row just gets its path refreshed -- the file
        // may well have moved inside the folder since the last scan.
        out[clash].templatePath = c.templatePath;
        out[clash].canvasW = c.canvasW;
        out[clash].canvasH = c.canvasH;
        skipped++;
        continue;
      }
      out.push({
        id: c.id,
        name: c.name || c.screen,
        territory: c.territory || "",
        site: c.screen || "",
        screen: c.screen || "",
        canvasW: c.canvasW || 0,
        canvasH: c.canvasH || 0,
        guidesX: [],
        guidesY: [],
        slots: [],
        savedBy: me || "",
        // Sliced to the date, so a seeded row and a saved layout carry the
        // same shape of stamp and sort against each other.
        stamp: nowStamp().slice(0, 10),
        kind: "template",
        templatePath: c.templatePath,
        status: "active",
      });
      added++;
    }

    if (!writeSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE, out)) {
      return { success: false, error: "Couldn't write to the team folder -- is the share mounted?" };
    }
    return { success: true, added: added, skipped: skipped };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Files the references aep_screens.py found back onto their entries.
 *
 * Takes `[{id, referencePath}]` as JSON, and touches NOTHING else on the row --
 * enrichment is additive, so re-running it can never disturb geometry somebody
 * has traced by hand. Same refusal-on-unreadable contract as every other write
 * here; an absent file is fine, an unreadable one is not.
 */
export const bespokeLibrarySetReferences = (
  entriesJson: string
): { success: boolean; updated?: number; error?: string } => {
  try {
    const incoming = JSON.parse(entriesJson) as {
      id: string; referencePath: string; referencePaths?: string[];
    }[];
    if (!incoming || !incoming.length) return { success: false, error: "Nothing to file." };

    const existing = readSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE);
    if (existing === null) {
      return { success: false, error: "Couldn't read the library -- nothing was changed." };
    }

    // An EMPTY referencePath is an instruction to CLEAR, not a row to skip.
    // Without that a re-run could never correct itself: 23 screens were filed
    // with a .psd reference the panel cannot display, and once the scoring was
    // fixed to reject those formats they simply stopped appearing in the
    // results -- so the stale path would have sat there forever.
    let updated = 0;
    let cleared = 0;
    for (let i = 0; i < incoming.length; i++) {
      const row = incoming[i];
      if (!row || !row.id) continue;
      for (let k = 0; k < existing.length; k++) {
        if (String(existing[k].id) !== String(row.id)) continue;
        if (row.referencePath) {
          existing[k].referencePath = row.referencePath;
          if (row.referencePaths && row.referencePaths.length) {
            existing[k].referencePaths = row.referencePaths;
          }
          updated++;
        } else if (existing[k].referencePath) {
          existing[k].referencePath = "";
          existing[k].referencePaths = [];
          cleared++;
        }
        break;
      }
    }
    if (updated === 0 && cleared === 0) return { success: true, updated: 0 };

    if (!writeSharedFile<BespokeTemplate>(SHARED_BESPOKE_FILE, SHARED_BESPOKE_TYPE, existing)) {
      return { success: false, error: "Couldn't write to the team folder." };
    }
    return { success: true, updated: updated };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Brings a template into the CURRENT project, read-only.
 *
 * importFile() is the blessed path in section 1: the template is never
 * opened as its own editable project, never saved, and its bytes are never
 * written. The artist gets its comps to work from and the master on the
 * server is untouchable by construction -- no copy step to get wrong, no
 * destination to validate, no save-as to forget.
 */
export const bespokeLibraryImport = (
  templatePath: string
): { success: boolean; name?: string; error?: string } => {
  try {
    if (!templatePath) return { success: false, error: "This entry has no template file." };
    if (!app.project) return { success: false, error: "No project is open to import into." };
    const f = new File(templatePath);
    // Attempt the operation and let it fail -- .exists lies on the NAS for
    // files (section 2), so gating on it would refuse reachable templates.
    let item: any = null;
    try {
      item = app.project.importFile(new ImportOptions(f));
    } catch (inner) {
      return {
        success: false,
        error: "Couldn't import that template -- is the share mounted?\n" + templatePath,
      };
    }
    if (!item) return { success: false, error: "After Effects imported nothing from:\n" + templatePath };
    return { success: true, name: item.name };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** Selects the template in Finder/Explorer rather than opening it. */
export const bespokeLibraryReveal = (templatePath: string): Result => {
  try {
    if (!templatePath) return { success: false, error: "This entry has no template file." };
    const f = new File(templatePath);
    const p = f.fsName;
    if ($.os.indexOf("Windows") !== -1) {
      system.callSystem('explorer /select,"' + p + '"');
    } else {
      system.callSystem('open -R "' + p + '"');
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** Folder picker for the templates root. Empty string on cancel, never an error. */
export const bespokeSelectTemplatesRoot = (): string => {
  const picked = Folder.selectDialog("Choose the folder your bespoke templates live in");
  return picked ? picked.fsName : "";
};

function isArcadeFile(fileName: string): boolean {
  return (
    fileName === SHARED_WORDGAME_FILE ||
    fileName === SHARED_POSTERGAME_FILE ||
    fileName === SHARED_NERDLE_INVITES_FILE ||
    fileName === SHARED_ARCADE_SCORES_FILE
  );
}

// Where a given shared file is WRITTEN. Reads try this first, then the older
// locations (see readSharedFile).
function sharedDirFor(fileName: string): string {
  return isArcadeFile(fileName) ? ARCADE_DIR : MISC_DIR;
}

function miscFolder(): Folder | null {
  const root = teamFolder();
  if (!root) return null;
  return new Folder(root.fsName + "/" + MISC_DIR);
}

// Create misc/ (and misc/arcade/ when that's the target) level by level --
// Folder.create() won't make intermediate levels. Returns the folder if it
// exists afterwards, else null so the caller can fall back.
function ensureSharedFolder(dir: string): Folder | null {
  const root = teamFolder();
  if (!root) return null;
  const parts = dir.split("/");
  let pathSoFar = root.fsName;
  let folder: Folder | null = null;
  for (let i = 0; i < parts.length; i++) {
    pathSoFar = pathSoFar + "/" + parts[i];
    folder = new Folder(pathSoFar);
    if (!folder.exists) {
      try { folder.create(); } catch (e) { return null; }
    }
  }
  return folder && folder.exists ? folder : null;
}

/**
 * NULL MEANS "I DID NOT GET THE CONTENTS", NOT "THERE ARE NONE".
 *
 * It covers a file that genuinely isn't there yet AND a read that failed --
 * an unmounted share, a NAS blip, or the panel asking while AE is busy (a
 * render finishing was the real report). A caller that flattens null to `[]`
 * hands the UI a legitimately-empty board, which is how a leaderboard full of
 * rows went blank until the panel was reopened. Callers that hold state must
 * pass this distinction on (see teamArcadeScores' `read` flag) so the UI can
 * keep what it already has instead of destroying it on one bad read.
 */
function readSharedFile<T>(fileName: string, expectedType: string): T[] | null {
  const root = teamFolder();
  if (!root) return null;
  // Preferred location first (misc/arcade/ for games, misc/ otherwise), then
  // each older location in turn.
  const dir = sharedDirFor(fileName);
  let content = readTextFile(new File(root.fsName + "/" + dir + "/" + fileName));
  if (!content && dir !== MISC_DIR) content = readTextFile(new File(root.fsName + "/" + MISC_DIR + "/" + fileName));
  if (!content) content = readTextFile(new File(root.fsName + "/" + fileName));
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || parsed.type !== expectedType || !(parsed.entries instanceof Array)) return null;
    return parsed.entries as T[];
  } catch (e) {
    return null;
  }
}

// Human-readable noun per shared-file type, used to build the plain-English
// `summary` header so someone opening the raw JSON immediately sees "3 combos
// shared" without having to count array items by eye.
function sharedTypeNoun(expectedType: string, count: number): string {
  const singular =
    expectedType === SHARED_COMBOS_TYPE ? "combo"
    : expectedType === SHARED_EXPRESSIONS_TYPE ? "expression"
    : expectedType === SHARED_TOOLS_TYPE ? "custom tool"
    : expectedType === SHARED_CAMPAIGNS_TYPE ? "campaign"
    : expectedType === SHARED_BESPOKE_TYPE ? "saved layout"
    : expectedType === SHARED_WORDGAME_TYPE ? "result"
    : expectedType === SHARED_POSTERGAME_TYPE ? "result"
    : expectedType === SHARED_NERDLE_INVITES_TYPE ? "invite"
    : expectedType === SHARED_WORKFLOWS_TYPE ? "creative workflow"
    : "item";
  return count === 1 ? singular : singular + "s";
}

function writeSharedFile<T>(fileName: string, expectedType: string, entries: T[]): boolean {
  const root = teamFolder();
  if (!root) return false;
  const count = entries.length;
  // `count` + `summary` sit ABOVE `entries` (json2.js preserves key insertion
  // order) so they read as a header/divider at the top of the file. Pretty-
  // printed (2-space indent) so the whole thing is legible in any text editor,
  // not one unreadable line. readSharedFile only checks `type` + `entries`, so
  // the extra header keys are safe to add.
  const payload = {
    type: expectedType,
    version: 1,
    summary: count + " " + sharedTypeNoun(expectedType, count) + " shared",
    count: count,
    updatedAt: new Date().toString(),
    entries: entries,
  };
  // Always write to the file's own folder (misc/arcade/ for games, misc/
  // otherwise), creating it on first use. If it can't be created (permissions,
  // unmounted share), fall back to the root rather than failing the share
  // outright -- a shared combo landing in the old place is far better than
  // losing it.
  const folder = ensureSharedFolder(sharedDirFor(fileName));
  const target = folder
    ? new File(folder.fsName + "/" + fileName)
    : new File(root.fsName + "/" + fileName);
  return writeTextFile(target, JSON.stringify(payload, null, 2));
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

function loadLocalCustomTools(): SharedCustomTool[] {
  const result = loadCustomTools();
  if (!result.success || !(result as { message?: string }).message) return [];
  try {
    return JSON.parse((result as { message: string }).message) as SharedCustomTool[];
  } catch (e) {
    return [];
  }
}

interface SyncResult extends Result {
  newCombos?: number;
  newExpressions?: number;
  newTools?: number;
  newCampaigns?: number;
  // Localise (markets-root) campaigns pulled, counted separately from
  // newCampaigns: they land in a different list and a summary that merged
  // them would overstate what OV Library gained.
  newLocCampaigns?: number;
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
          // Marked as team-pulled so the bank can section it away from the
          // artist's own saves. The author is whoever shared it, NOT this
          // machine's owner -- it travels with the shared file.
          origin: "team",
          author: entry.author || "",
        });
        names[entry.name.toLowerCase()] = true;
        newExpressions++;
      }
      if (newExpressions > 0) expressionsBankSave(JSON.stringify(local));
    }

    // Custom tools (Script Playground scripts): shared -> local, merge by
    // name, fresh local ids. Same rules as combos/expressions above.
    let newTools = 0;
    const sharedTools = readSharedFile<SharedCustomTool>(SHARED_TOOLS_FILE, SHARED_TOOLS_TYPE);
    if (sharedTools && sharedTools.length > 0) {
      const local = loadLocalCustomTools();
      const names: { [lower: string]: boolean } = {};
      for (let i = 0; i < local.length; i++) names[local[i].name.toLowerCase()] = true;
      for (let i = 0; i < sharedTools.length; i++) {
        const tool = sharedTools[i];
        if (!tool || !tool.name || !tool.code) continue;
        if (names[tool.name.toLowerCase()]) continue;
        local.push({
          id: "tool-" + new Date().getTime() + "-" + Math.floor(Math.random() * 100000) + "-" + i,
          name: tool.name,
          description: tool.description || "",
          code: tool.code,
          kind: tool.kind === "button" ? "button" : "page",
        });
        names[tool.name.toLowerCase()] = true;
        newTools++;
      }
      if (newTools > 0) saveCustomTools(JSON.stringify(local));
    }

    // OV Library campaigns: shared -> local, merge by name (saveCampaign
    // already refuses a duplicate name, so this only ever ADDS new ones --
    // it never overwrites a local campaign's path).
    let newCampaigns = 0;
    const sharedCampaigns = readSharedFile<SharedCampaign>(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE);
    if (sharedCampaigns && sharedCampaigns.length > 0) {
      const localCamps = loadCampaignsRaw();
      const names: { [lower: string]: boolean } = {};
      for (let i = 0; i < localCamps.length; i++) names[localCamps[i].name.toLowerCase()] = true;
      for (let i = 0; i < sharedCampaigns.length; i++) {
        const camp = sharedCampaigns[i];
        if (!camp || !camp.name || !camp.mastersRoot) continue;
        // Retired campaigns are not pulled into EITHER list -- the flag is
        // studio-wide, so a campaign the team has retired must not keep
        // arriving on new machines through the masters half after someone
        // retired it from the markets half. Not even the banner: a retired
        // campaign should stop spreading entirely.
        if (camp.retiredBy) continue;
        // The banner is applied even for a campaign this machine ALREADY
        // has, and only when nothing is pinned locally. A shared banner is
        // campaign identity rather than personal preference, so it should
        // reach people who added the campaign by hand before it was shared
        // -- but it must never overwrite a banner someone chose themselves.
        if (camp.banner && loadCampaignBanner(camp.name) === "") {
          setCampaignBanner(camp.name, camp.banner);
        }
        if (names[camp.name.toLowerCase()]) continue;
        const r = saveCampaign(camp.name, camp.mastersRoot);
        if (r.success) {
          names[camp.name.toLowerCase()] = true;
          newCampaigns++;
        }
      }
    }

    // Localise campaigns (LocLibCampaigns -- Localised Library / CSV
    // Localiser): the same merge over the OTHER root on the same rows.
    // Separate loop rather than folded into the one above because the two
    // lists are genuinely independent -- a row may carry either root, both,
    // or (for a retire-only marker) neither, and this machine may already
    // hold one list and not the other.
    //
    // A RETIRED campaign is never pulled. Adding a row the team has just
    // declared dead would be the panel undoing the retirement, and the whole
    // point of retiring is that new machines stop picking it up. Machines
    // that already have it keep it -- see teamSetCampaignRetired on why this
    // never deletes anything local.
    let newLocCampaigns = 0;
    if (sharedCampaigns && sharedCampaigns.length > 0) {
      const localLoc = loadLocLibCampaigns();
      const locNames: { [lower: string]: boolean } = {};
      for (let i = 0; i < localLoc.length; i++) locNames[localLoc[i].name.toLowerCase()] = true;
      for (let i = 0; i < sharedCampaigns.length; i++) {
        const camp = sharedCampaigns[i];
        if (!camp || !camp.name || !camp.marketsRoot) continue;
        if (camp.retiredBy) continue;
        if (locNames[camp.name.toLowerCase()]) continue;
        const r = saveLocLibCampaign(camp.name, camp.marketsRoot);
        if (r.success) {
          locNames[camp.name.toLowerCase()] = true;
          newLocCampaigns++;
        }
      }
    }

    return {
      success: true,
      newCombos: newCombos,
      newExpressions: newExpressions,
      newTools: newTools,
      newCampaigns: newCampaigns,
      newLocCampaigns: newLocCampaigns,
    };
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
    // Stamp who shared it so colleagues' banks can show "from Aaron" rather
    // than an anonymous row. An untagged station still shares (unlike the word
    // board / invites, which refuse) -- this is a library, not a post, and the
    // pre-existing behaviour of sharing without a name is deliberately kept;
    // it just lands with a blank author.
    entry.origin = "team";
    if (!entry.author) entry.author = loadLocalSetting(MACHINE_OWNER_KEY) || "";
    shared.push(entry);
    if (!writeSharedFile(SHARED_EXPRESSIONS_FILE, SHARED_EXPRESSIONS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: 'Shared "' + entry.name + '" with the team.' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Share ONE custom tool (Script Playground script) to the team library. Takes
// the full entry as a JSON payload -- same reasoning as teamShareExpression:
// the frontend already holds everything the shared file needs, so no store
// lookup. The machine-local `id` is dropped on the way out (pull re-mints one).
export const teamShareCustomTool = (entryJson: string): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };
    let entry: SharedCustomTool | null = null;
    try {
      entry = JSON.parse(entryJson) as SharedCustomTool;
    } catch (e2) {
      return { success: false, error: "Could not read the tool data." };
    }
    if (!entry || !entry.name || !entry.code) return { success: false, error: "Tool has no name/code to share." };

    const shared = readSharedFile<SharedCustomTool>(SHARED_TOOLS_FILE, SHARED_TOOLS_TYPE) || [];
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].name.toLowerCase() === entry.name.toLowerCase()) {
        return { success: true, message: '"' + entry.name + '" is already in the team library.' };
      }
    }
    shared.push({
      name: entry.name,
      description: entry.description || "",
      code: entry.code,
      kind: entry.kind === "button" ? "button" : "page",
    });
    if (!writeSharedFile(SHARED_TOOLS_FILE, SHARED_TOOLS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: 'Shared "' + entry.name + '" with the team.' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Share ONE OV Library campaign (name + masters-root path) to the team, so
// everyone points at the same masters folder instead of each adding it by
// hand. Takes the full entry as a JSON payload, same pattern as the others.
export const teamShareCampaign = (campaignJson: string): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };
    let entry: SharedCampaign | null = null;
    try {
      entry = JSON.parse(campaignJson) as SharedCampaign;
    } catch (e2) {
      return { success: false, error: "Could not read the campaign data." };
    }
    if (!entry || !entry.name || !entry.mastersRoot) return { success: false, error: "Campaign has no name/path to share." };

    const shared = readSharedFile<SharedCampaign>(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE) || [];
    const banner = entry.banner ? String(entry.banner) : "";
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].name.toLowerCase() === entry.name.toLowerCase()) {
        // Already shared. Re-sharing is how you push a banner you pinned
        // AFTER the first share, so update that field rather than treating
        // the whole call as a no-op -- otherwise the banner could never
        // reach anyone. The masters root is left alone: someone re-sharing
        // should not silently repoint a campaign the team already has.
        const existingBanner = shared[i].banner ? String(shared[i].banner) : "";
        if (banner && banner !== existingBanner) {
          shared[i].banner = banner;
          if (!writeSharedFile(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE, shared)) {
            return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
          }
          return { success: true, message: 'Updated the banner for "' + entry.name + '".' };
        }
        return { success: true, message: '"' + entry.name + '" is already in the team library.' };
      }
    }
    shared.push({ name: entry.name, mastersRoot: entry.mastersRoot, banner: banner });
    if (!writeSharedFile(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: 'Shared "' + entry.name + '" with the team.' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Share a LOCALISE campaign (name + markets root) -- the LocLibCampaigns list
// behind Localised Library's and CSV Localiser's pickers, which until now had
// no team route at all while OV Library's masters-root list did.
//
// Writes into the SAME shared-campaigns file rather than a second one: it is
// one campaign with two roots, and two files would immediately raise "which
// one is authoritative when the names disagree?". A row shared from OV Library
// gains a marketsRoot here; a row shared from CSV Localiser first may have an
// empty mastersRoot until someone shares that half.
//
// NEVER REPOINTS an existing root, exactly as teamShareCampaign doesn't:
// re-sharing is how you fill in a missing half, not how you overwrite the
// path the team already agreed on. Someone whose local path genuinely differs
// should say so out loud, not silently move everyone.
export const teamShareLocCampaign = (campaignJson: string): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };
    let entry: { name?: string; marketsRoot?: string } | null = null;
    try {
      entry = JSON.parse(campaignJson);
    } catch (e2) {
      return { success: false, error: "Could not read the campaign data." };
    }
    if (!entry || !entry.name || !entry.marketsRoot) return { success: false, error: "Campaign has no name/path to share." };

    const shared = readSharedFile<SharedCampaign>(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE) || [];
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].name.toLowerCase() === entry.name.toLowerCase()) {
        const existing = shared[i].marketsRoot ? String(shared[i].marketsRoot) : "";
        if (existing) {
          return { success: true, message: '"' + entry.name + '" is already in the team library.' };
        }
        shared[i].marketsRoot = entry.marketsRoot;
        if (!writeSharedFile(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE, shared)) {
          return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
        }
        return { success: true, message: 'Added the Markets path for "' + entry.name + '".' };
      }
    }
    shared.push({ name: entry.name, mastersRoot: "", marketsRoot: entry.marketsRoot, banner: "" });
    if (!writeSharedFile(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: 'Shared "' + entry.name + '" with the team.' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Mark a campaign retired studio-wide (or un-retire it). This is the answer to
// "the volume got archived and now everyone's picker has a dead row" -- one
// person says so once and every panel marks it, instead of each artist
// discovering it separately and deleting it locally.
//
// DELIBERATELY NOT A DELETE, on either side:
//   - It never removes the shared row, so the paths survive for anyone who
//     still has that volume mounted, and retiring is reversible.
//   - It never touches anyone's LOCAL campaign list. A machine's own settings
//     are its own; the team file is advisory. Pickers mark a retired campaign
//     and let the user decide -- silently deleting local rows from a shared
//     file would be this panel reaching into someone's setup uninvited.
//
// Refuses from an untagged machine rather than posting anonymously (CLAUDE.md:
// never post to a shared board from an untagged machine).
export const teamSetCampaignRetired = (name: string, retired: boolean): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };
    const owner = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!owner) return { success: false, error: "Tag this machine with your name in the Team menu first -- a retired campaign says who retired it." };
    const target = String(name || "");
    if (!target) return { success: false, error: "No campaign given." };

    const shared = readSharedFile<SharedCampaign>(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE) || [];
    let found = false;
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].name.toLowerCase() !== target.toLowerCase()) continue;
      found = true;
      if (retired) {
        shared[i].retiredBy = owner;
        shared[i].retiredAt = new Date().toString();
      } else {
        shared[i].retiredBy = "";
        shared[i].retiredAt = "";
      }
      break;
    }
    // Retiring a campaign nobody ever shared is a real case -- everyone added
    // it by hand. Record it so the mark still reaches the team; the roots stay
    // empty because this machine's local path is not necessarily theirs.
    if (!found) {
      if (!retired) return { success: true, message: '"' + target + '" was not marked retired.' };
      shared.push({ name: target, mastersRoot: "", marketsRoot: "", retiredBy: owner, retiredAt: new Date().toString() });
    }
    if (!writeSharedFile(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return {
      success: true,
      message: retired ? 'Marked "' + target + '" retired for the team.' : 'Un-retired "' + target + '".',
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export interface TeamCampaignRow {
  name: string;
  mastersRoot: string;
  marketsRoot: string;
  retiredBy: string;
  retiredAt: string;
}

// The team's campaign board, for pickers that want to mark their rows. Returns
// an EMPTY list with read:false when the team folder isn't reachable, so the
// caller can tell "nothing is retired" from "we couldn't ask" -- CLAUDE.md's
// rule that an empty or failed read must never be presented as data.
export const teamCampaignBoard = (): { success: boolean; read?: boolean; rows?: TeamCampaignRow[]; error?: string } => {
  try {
    if (!teamFolder()) return { success: true, read: false, rows: [] };
    const shared = readSharedFile<SharedCampaign>(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE);
    if (shared === null) return { success: true, read: false, rows: [] };
    const rows: TeamCampaignRow[] = [];
    for (let i = 0; i < shared.length; i++) {
      const s = shared[i];
      if (!s || !s.name) continue;
      rows.push({
        name: s.name,
        mastersRoot: s.mastersRoot ? String(s.mastersRoot) : "",
        marketsRoot: s.marketsRoot ? String(s.marketsRoot) : "",
        retiredBy: s.retiredBy ? String(s.retiredBy) : "",
        retiredAt: s.retiredAt ? String(s.retiredAt) : "",
      });
    }
    return { success: true, read: true, rows: rows };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- Daily word puzzle: the shared board -----------------------------------
// The game itself is src/js/main/arcade/DailyWord.tsx; per-machine progress
// lives in wordGame.ts. Only the TEAM half is here, because it needs this
// file's Team Folder plumbing (teamFolder/readSharedFile/writeSharedFile are
// private to this module and duplicating them elsewhere is exactly the drift
// this codebase has been bitten by before).
//
// POSTING IS OPT-IN, PER DAY, BY DESIGN. This board lands on a drive the
// whole studio can read, so a result must never be published as a side effect
// of playing -- the frontend only calls this when someone clicks "Share".
// Same rule (and same reasoning) as sharing a combo or an expression: nothing
// leaves this machine without a deliberate click.
//
// Entries are keyed by day + member, and a repost REPLACES that member's row
// for that day rather than appending -- otherwise replaying would stack
// duplicate rows for one person.

interface WordResultEntry {
  day: string;      // the puzzle's day key, e.g. "2026-07-24"
  member: string;   // display name, from the machine owner tag
  guesses: number;  // attempts used; 0 means "didn't get it"
  solved: boolean;
  // The poster's streak AT THAT MOMENT. Carried in the row because a streak
  // is counted on each person's own machine -- the board has no other way to
  // know it. The leaderboard reads it off each member's most recent row.
  streak: number;
  postedAt: string;
}

/** Read the shared board. Null (not an error) when there's no team folder. */
export const teamLoadWordBoard = (): { success: boolean; entries?: WordResultEntry[]; read?: boolean; error?: string } => {
  try {
    if (!teamFolder()) return { success: true, entries: [], read: false };
    // `read` distinguishes an empty board from a failed read -- same reason as
    // teamArcadeScores, so one bad read can't blank a populated board.
    const entries = readSharedFile<WordResultEntry>(SHARED_WORDGAME_FILE, SHARED_WORDGAME_TYPE);
    return { success: true, entries: entries || [], read: entries !== null };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Publish (or replace) THIS machine's result for one day.
 *
 * The member name comes from the machine-owner tag rather than being typed:
 * the station already knows whose it is, and an untagged machine has no
 * business writing a name into a shared studio file. An unmounted NAS returns
 * a plain error rather than throwing -- a laptop off the studio network is a
 * normal state, and the caller shows it as a quiet inline note.
 */
export const teamPostWordResult = (resultJson: string): Result => {
  const parsed = parseDailyRow(resultJson);
  if (!parsed.row) return { success: false, error: parsed.error };
  const row = parsed.row as WordResultEntry;
  row.streak = Number(row.streak) || 0;
  return writeDailyBoardRow(SHARED_WORDGAME_FILE, SHARED_WORDGAME_TYPE, row);
};

// --- shared plumbing for BOTH daily boards -----------------------------------
// The word board and the poster board differ only in which numbers a row
// carries; everything around that (owner tagging, replace-this-member's-row-
// for-this-day, newest-first, 30-day trim) is identical. It lives here once so
// the two can't drift -- the word version was copied wholesale for the poster
// game first, which is exactly the duplication this file's own header warns
// about.

interface DailyBoardRow {
  day: string;
  member: string;
  postedAt: string;
}

/** JSON in, a row with a day out. Errors are the caller's message verbatim. */
function parseDailyRow(resultJson: string): { row: DailyBoardRow | null; error: string } {
  let incoming: DailyBoardRow | null = null;
  try {
    incoming = JSON.parse(resultJson) as DailyBoardRow;
  } catch (e) {
    return { row: null, error: "Could not read the result data." };
  }
  if (!incoming || !incoming.day) return { row: null, error: "Result has no day to file it under." };
  return { row: incoming, error: "" };
}

/**
 * Publish (or replace) THIS machine's row for one day on one board.
 *
 * The member name comes from the machine-owner tag rather than being typed:
 * the station already knows whose it is, and an untagged machine has no
 * business writing a name into a shared studio file. An unmounted NAS returns
 * a plain error rather than throwing -- a laptop off the studio network is a
 * normal state, and the caller shows it as a quiet inline note.
 */
function writeDailyBoardRow<T extends DailyBoardRow>(fileName: string, type: string, incoming: T): Result {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };

    const owner = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!owner) return { success: false, error: "Tag this machine with your name in the Team menu first, so the board knows who posted." };

    incoming.member = owner;
    incoming.postedAt = new Date().toString();

    const board = readSharedFile<T>(fileName, type) || [];
    const kept: T[] = [];
    for (let i = 0; i < board.length; i++) {
      const row = board[i];
      if (!row || !row.day) continue;
      // Drop this member's existing row for this day (repost replaces), and
      // keep the file from growing forever -- 30 days is plenty of banter.
      const sameSlot = row.day === incoming.day && String(row.member).toLowerCase() === owner.toLowerCase();
      if (!sameSlot) kept.push(row);
    }
    kept.push(incoming);

    // Newest first, then trim. Day keys are ISO-ish (YYYY-MM-DD) so a plain
    // string compare sorts them correctly without parsing dates.
    kept.sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : 0; });
    const trimmed: T[] = [];
    const seenDays: string[] = [];
    for (let i = 0; i < kept.length; i++) {
      if (seenDays.indexOf(kept[i].day) === -1) {
        if (seenDays.length >= 30) break;
        seenDays.push(kept[i].day);
      }
      trimmed.push(kept[i]);
    }

    if (!writeSharedFile(fileName, type, trimmed)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: "Posted to the team board." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// --- Daily poster puzzle: the shared board -----------------------------------
// The game is src/js/main/arcade/PosterDaily.tsx; per-machine progress lives in
// wordGame.ts alongside the word puzzle's.
//
// The row carries BOTH costs -- guesses AND hints bought -- because that pair
// is the whole point of this board: getting it in two with the plot handed to
// you is not the same round as getting it in two cold, and a single number
// would flatten the difference away.

interface PosterResultEntry extends DailyBoardRow {
  /** Attempts used. 0 means "didn't get it". */
  guesses: number;
  /** Hints bought, whether or not it was solved. */
  hints: number;
  solved: boolean;
  /** Streak AT THAT MOMENT -- counted on the player's own machine, since the
   *  board only ever sees the days they were at their desk. */
  streak: number;
}

/** Read the shared board. Empty (not an error) when there's no team folder. */
export const teamLoadPosterBoard = (): { success: boolean; entries?: PosterResultEntry[]; read?: boolean; error?: string } => {
  try {
    if (!teamFolder()) return { success: true, entries: [], read: false };
    const entries = readSharedFile<PosterResultEntry>(SHARED_POSTERGAME_FILE, SHARED_POSTERGAME_TYPE);
    return { success: true, entries: entries || [], read: entries !== null };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const teamPostPosterResult = (resultJson: string): Result => {
  const parsed = parseDailyRow(resultJson);
  if (!parsed.row) return { success: false, error: parsed.error };
  const row = parsed.row as PosterResultEntry;
  row.guesses = Number(row.guesses) || 0;
  row.hints = Number(row.hints) || 0;
  row.streak = Number(row.streak) || 0;
  row.solved = !!row.solved;
  return writeDailyBoardRow(SHARED_POSTERGAME_FILE, SHARED_POSTERGAME_TYPE, row);
};

// --- XYiNerdle: lobbies, invites, leaderboard -------------------------------
// The head-to-head half of arcade/cine (see CineChain.tsx). Same shared-file
// plumbing as everything else in this file, so it lands in `misc/` and
// inherits the NAS-safe read/write behaviour already proven here.
//
// SCOPE, stated plainly: this is the LOBBY layer -- who has challenged whom,
// and who has beaten whom. The live turn-by-turn match sync is deliberately
// NOT here yet; that's the next slice and wants its own per-player files (see
// the note at the bottom of CineChain.tsx). Building the lobby first means the
// social surface is real and testable before any of the hard sync work.
//
// There is no push channel on a file share, so an "invite" is a row someone
// else's panel notices when it looks. That's the honest ceiling of the
// Team Folder approach and it's fine for "fancy a game?" -- it is NOT a
// realtime doorbell, and the UI says so rather than pretending.

const SHARED_NERDLE_INVITES_FILE = "xyinerdle-invites.json";
const SHARED_NERDLE_INVITES_TYPE = "xyi-nerdle-invites";

// THE RESULTS BOARD HAS NO FILE OF ITS OWN, AND THAT'S THE FIX.
// `teamNerdleLobby` used to read `xyinerdle-results.json` -- a file NOTHING
// has ever written. The winner of a battle posts through `teamArcadePost`
// (see the arcade scoreboard section below), which is the same dead-call
// family as the old `teamNerdlePostResult`: the write went somewhere real,
// the read looked somewhere else, so the in-game leaderboard was permanently
// empty however many matches were played. Results are now DERIVED from the
// one arcade score store (`nerdleResultsFromScores`), so there is exactly one
// place a head-to-head result lives. Matches played before this landed are in
// that store already and will appear.

/** How many invites to keep. Old ones are noise, not history. */
const NERDLE_INVITE_KEEP = 40;

interface NerdleInvite {
  room: string;
  from: string;
  to: string;
  createdAt: string;
  /** ISO-ish sortable stamp used for expiry/ordering. */
  stamp: string;
}

interface NerdleResult {
  room: string;
  winner: string;
  loser: string;
  films: number;
  stamp: string;
}

const nowStamp = (): string => {
  const d = new Date();
  const p = function (n: number) { return n < 10 ? "0" + n : String(n); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
};

/**
 * Post an invite for `to`. The sender is taken from the machine-owner tag
 * rather than typed, same rule as the word-game board: an untagged station has
 * no business writing a name into a shared studio file.
 *
 * A PAIR HAS AT MOST ONE ROOM, IN EITHER DIRECTION. The first version deduped
 * only on (from -> to), so two people who challenged each other -- which is
 * exactly what happens when both are keen, or when a first attempt looked like
 * it hadn't landed -- ended up with TWO rooms. Each then saw one incoming and
 * one outgoing invite, walked into different rooms, and sat waiting for an
 * opponent who was sitting in the other room doing the same thing.
 *
 * So: if they have already challenged ME, this joins THEIR room (returning
 * seat 2) instead of opening a second one. The caller uses the returned
 * `room`/`seat` rather than the code it passed in -- never assume the room you
 * suggested is the room you got.
 */
export const teamNerdleInvite = (toMember: string, room: string): {
  success: boolean;
  room?: string;
  seat?: number;
  message?: string;
  error?: string;
} => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };
    const from = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!from) return { success: false, error: "Tag this machine with your name in the Team menu first, so they know who's asking." };
    if (!toMember) return { success: false, error: "Pick someone to invite." };
    if (toMember.toLowerCase() === from.toLowerCase()) return { success: false, error: "You can't invite yourself." };

    const meLow = from.toLowerCase();
    const themLow = toMember.toLowerCase();
    const list = readSharedFile<NerdleInvite>(SHARED_NERDLE_INVITES_FILE, SHARED_NERDLE_INVITES_TYPE) || [];
    const kept: NerdleInvite[] = [];
    let theirs: NerdleInvite | null = null;
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row || !row.room) continue;
      const f = String(row.from).toLowerCase();
      const t = String(row.to).toLowerCase();
      if (f === themLow && t === meLow) {
        // They asked first. Keep the OLDEST such row (the list is newest-first,
        // so the last one seen wins) and drop any duplicates.
        theirs = row;
        continue;
      }
      // Re-inviting the same person replaces rather than stacks.
      if (f === meLow && t === themLow) continue;
      kept.push(row);
    }

    if (theirs) kept.push(theirs);
    else kept.push({ room: room, from: from, to: toMember, createdAt: new Date().toString(), stamp: nowStamp() });

    kept.sort(function (a, b) { return a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0; });
    const trimmed = kept.length > NERDLE_INVITE_KEEP ? kept.slice(0, NERDLE_INVITE_KEEP) : kept;

    if (!writeSharedFile(SHARED_NERDLE_INVITES_FILE, SHARED_NERDLE_INVITES_TYPE, trimmed)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    if (theirs) {
      return {
        success: true,
        room: theirs.room,
        seat: 2,
        message: toMember + " had already challenged you -- joining their room " + theirs.room + ".",
      };
    }
    return { success: true, room: room, seat: 1, message: "Invited " + toMember + " to room " + room + "." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Everything the menu needs in ONE round trip: who I am, the invites waiting
 * for me, the ones I've sent, and the results board. One call rather than
 * four because each one is a NAS read and the menu shows them together.
 */
export const teamNerdleLobby = (): {
  success: boolean;
  me?: string;
  incoming?: NerdleInvite[];
  outgoing?: NerdleInvite[];
  results?: NerdleResult[];
  error?: string;
} => {
  try {
    const me = loadLocalSetting(MACHINE_OWNER_KEY) || "";
    if (!teamFolder()) return { success: true, me: me, incoming: [], outgoing: [], results: [] };
    const invites = readSharedFile<NerdleInvite>(SHARED_NERDLE_INVITES_FILE, SHARED_NERDLE_INVITES_TYPE) || [];
    const results = nerdleResultsFromScores();
    const incoming: NerdleInvite[] = [];
    const outgoing: NerdleInvite[] = [];
    const low = me.toLowerCase();
    for (let i = 0; i < invites.length; i++) {
      const row = invites[i];
      if (!row || !row.room) continue;
      if (me && String(row.to).toLowerCase() === low) incoming.push(row);
      else if (me && String(row.from).toLowerCase() === low) outgoing.push(row);
    }
    return { success: true, me: me, incoming: incoming, outgoing: outgoing, results: results };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// ── XYiNerdle battle sync ────────────────────────────────────────────────────
// One file per player at `misc/battle/<ROOM>/playerN.json`. Each side writes
// ONLY its own file and reads both, so two writers never touch the same file
// and there is nothing to lock or merge. The state model (an action log
// replayed by both sides) lives in js/main/arcade/cine/battle.ts.
//
// FOUR THINGS HERE WERE WRONG IN THE FIRST PASS AND ARE FIXED, all of the
// "compiles fine, dies in AE" family this file has been bitten by before:
//
//  1. `BATTLE_DIR` was USED BUT NEVER DEFINED. It shipped straight into the
//     built ExtendScript, so the first battle call would have thrown a
//     ReferenceError. tsc did NOT catch it under tsconfig-build (the AE type
//     defs make bare globals plausible), so don't trust a clean typecheck to
//     prove an ExtendScript identifier exists.
//  2. `Array.prototype.findIndex` -- not in the ExtendScript engine and NOT
//     among the three methods shared.ts polyfills (indexOf/filter/map). Same
//     class of runtime crash as the documented `uniquePages.indexOf` one.
//     Replaced with a plain loop.
//  3. State crossed the bridge as a NESTED OBJECT (arrays of objects inside
//     objects). evalTS splices JSON.stringify'd args into eval'd source, and
//     nested structures demonstrably do not survive that -- exactly the bug
//     that made Motion Tools' ease paste apply AE defaults. Writes now take a
//     JSON STRING and parse host-side.
//  4. Writes used `file.contents = ...` and folder creation assumed nesting.
//     Now the same `writeTextFile` helper everything else here uses, and each
//     directory level is created explicitly.

// Battle rooms moved under misc/arcade/ with the rest of the game files.
// LEGACY_BATTLE_DIR is still READ so a match already in progress when this
// build lands doesn't lose its room mid-game; writes only ever go to the new
// path. Safe to drop the legacy read once no room predates this change --
// rooms are ephemeral, so that's about a day.
const BATTLE_DIR = ARCADE_DIR + "/battle";
const LEGACY_BATTLE_DIR = MISC_DIR + "/battle";

/**
 * Ensure `misc/arcade/battle/<room>/` exists, creating each level in turn.
 *
 * Folder.create() is not reliable for nested paths in ExtendScript, so the
 * levels are walked deliberately rather than hoping one call does it.
 */
function battleRoomFolder(room: string, create: boolean): Folder | null {
  const root = teamFolder();
  if (!root) return null;
  const levels = [
    root.fsName + "/" + MISC_DIR,
    root.fsName + "/" + ARCADE_DIR,
    root.fsName + "/" + BATTLE_DIR,
    root.fsName + "/" + BATTLE_DIR + "/" + room,
  ];
  let folder: Folder | null = null;
  for (let i = 0; i < levels.length; i++) {
    folder = new Folder(levels[i]);
    if (!folder.exists) {
      if (!create) return null;
      try {
        folder.create();
      } catch (e) {
        return null;
      }
    }
  }
  return folder;
}

function battlePlayerFile(room: string, player: number, create: boolean): File | null {
  const folder = battleRoomFolder(room, create);
  if (!folder) return null;
  return new File(folder.fsName + "/player" + player + ".json");
}

/**
 * The path a player's file WOULD have, built without touching the filesystem.
 *
 * Reads must not go through battleRoomFolder(): that walks three nested levels
 * checking `Folder.exists` at each, and `.exists` has been caught lying on this
 * studio's NAS mount (the whole "NO SETUP YET" saga -- see CLAUDE.md's rule:
 * never gate a team-folder operation on .exists, attempt the real operation and
 * let its failure be the answer). A false negative on any level would make
 * teamBattleRead return two empty files, so BOTH panels would decide the
 * opponent hadn't shown up and no match could ever start.
 */
function battlePlayerPath(room: string, player: number): File | null {
  const root = teamFolder();
  if (!root) return null;
  return new File(root.fsName + "/" + BATTLE_DIR + "/" + room + "/player" + player + ".json");
}

/** Same, at the pre-misc/arcade location -- read-only fallback. */
function legacyBattlePlayerPath(room: string, player: number): File | null {
  const root = teamFolder();
  if (!root) return null;
  return new File(root.fsName + "/" + LEGACY_BATTLE_DIR + "/" + room + "/player" + player + ".json");
}

/**
 * Both player files for a room, as RAW JSON STRINGS.
 *
 * Returned unparsed on purpose: the frontend owns the action-log format and
 * can evolve it without a matching ExtendScript change -- the same "values are
 * opaque strings" rule PROFILE_KEYS and the word-game state already follow.
 */
export const teamBattleRead = (room: string): {
  success: boolean;
  me?: string;
  p1?: string;
  p2?: string;
  error?: string;
} => {
  try {
    const me = loadLocalSetting(MACHINE_OWNER_KEY) || "";
    if (!teamFolder()) return { success: false, me: me, error: "Team folder not set." };
    // Constructed paths, NOT battlePlayerFile() -- see battlePlayerPath's note.
    // readTextFile already answers "is it there?" by trying to open it.
    const f1 = battlePlayerPath(room, 1);
    const f2 = battlePlayerPath(room, 2);
    let p1 = f1 ? readTextFile(f1) : null;
    let p2 = f2 ? readTextFile(f2) : null;
    // A room started before battle files moved under misc/arcade/ -- read it
    // where it actually is rather than dropping the match. Per file, since the
    // two sides can be mid-migration on different builds for a few minutes.
    if (!p1) {
      const legacy1 = legacyBattlePlayerPath(room, 1);
      if (legacy1) p1 = readTextFile(legacy1);
    }
    if (!p2) {
      const legacy2 = legacyBattlePlayerPath(room, 2);
      if (legacy2) p2 = readTextFile(legacy2);
    }
    return { success: true, me: me, p1: p1 || "", p2: p2 || "" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** Write THIS player's file. `fileJson` is the whole BattlePlayerFile. */
export const teamBattleWrite = (room: string, player: number, fileJson: string): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set." };
    if (!room) return { success: false, error: "No room code." };
    const target = battlePlayerFile(room, player, true);
    if (!target) return { success: false, error: "Could not create the battle room folder on the team folder." };
    if (!writeTextFile(target, fileJson)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Delete a finished room's files.
 *
 * Folder.remove() only succeeds on an EMPTY folder in ExtendScript, so the
 * player files are removed first -- the previous version called remove() on a
 * populated folder and silently did nothing. Best-effort: a leftover room
 * folder is harmless clutter, never a failure worth surfacing.
 *
 * THE INVITE GOES TOO. It used to survive the match it created, so the lobby
 * kept offering "Accept"/"Open room" for a game that was already over --
 * walking back in either replayed the finished log (a game-over screen for a
 * match you'd already had) or landed you in a room whose files this function
 * had just deleted. One room, one match, one invite: they end together.
 */
export const teamBattleCleanup = (room: string): Result => {
  try {
    const root = teamFolder();
    if (!root) return { success: true };
    try {
      const invites = readSharedFile<NerdleInvite>(SHARED_NERDLE_INVITES_FILE, SHARED_NERDLE_INVITES_TYPE);
      if (invites) {
        const kept: NerdleInvite[] = [];
        for (let i = 0; i < invites.length; i++) {
          const row = invites[i];
          if (row && row.room && String(row.room) !== String(room)) kept.push(row);
        }
        if (kept.length !== invites.length) {
          writeSharedFile(SHARED_NERDLE_INVITES_FILE, SHARED_NERDLE_INVITES_TYPE, kept);
        }
      }
    } catch (e) { /* the room files matter more than the invite row */ }
    // Both locations: a room that started before battle files moved under
    // misc/arcade/ would otherwise be left behind forever.
    const dirs = [BATTLE_DIR, LEGACY_BATTLE_DIR];
    for (let d = 0; d < dirs.length; d++) {
      const folder = new Folder(root.fsName + "/" + dirs[d] + "/" + room);
      let files: (File | Folder)[] = [];
      try { files = folder.getFiles() || []; } catch (e) { files = []; }
      for (let i = 0; i < files.length; i++) {
        try { (files[i] as File).remove(); } catch (e) { /* leave it */ }
      }
      try { folder.remove(); } catch (e) { /* leave it */ }
    }
    return { success: true };
  } catch (e) {
    return { success: true };
  }
};

// ── Arcade housekeeping ──────────────────────────────────────────────────────
// teamBattleCleanup only fires when a match actually REACHES a loser AND the
// winning panel is still open at that moment. Everything else leaked: a room
// created by an invite nobody accepted, a match abandoned mid-chain, a panel
// closed before the final action landed. Those room folders sat on the NAS
// forever, and their invites sat in the list until 40 newer ones displaced
// them.
//
// This is the sweep that actually keeps the folder tidy: anything older than
// ARCADE_STALE_HOURS goes. A live game touches its player file every turn, so
// "stale" genuinely means abandoned -- but the window is deliberately much
// longer than a match (minutes) so an in-progress room can never be swept out
// from under two people playing.
const ARCADE_STALE_HOURS = 24;

/** `nowStamp()`'s format for a moment N hours ago -- comparable as a string. */
function staleCutoffStamp(hours: number): string {
  const d = new Date(new Date().getTime() - hours * 3600 * 1000);
  const p = function (n: number) { return n < 10 ? "0" + n : String(n); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

/** Newest modified time inside a room folder, or 0 if it can't be read. */
function newestFileTime(folder: Folder): number {
  let newest = 0;
  let files: (File | Folder)[] = [];
  try { files = folder.getFiles() || []; } catch (e) { return 0; }
  for (let i = 0; i < files.length; i++) {
    try {
      const m = (files[i] as File).modified;
      if (m && m.getTime() > newest) newest = m.getTime();
    } catch (e) { /* unreadable -- treat as ancient */ }
  }
  return newest;
}

/**
 * Delete abandoned battle rooms and expired invites. Best-effort and silent:
 * this is housekeeping, never something to interrupt anyone about, and an
 * unmounted NAS is a normal state.
 *
 * Called once per session from the arcade menu (not per poll) -- it enumerates
 * folders on a network share, which is not something to do every 15 seconds.
 */
export const teamArcadeSweep = (): { success: boolean; roomsRemoved?: number; invitesRemoved?: number; error?: string } => {
  try {
    const root = teamFolder();
    if (!root) return { success: true, roomsRemoved: 0, invitesRemoved: 0 };
    const cutoffTime = new Date().getTime() - ARCADE_STALE_HOURS * 3600 * 1000;

    let roomsRemoved = 0;
    const dirs = [BATTLE_DIR, LEGACY_BATTLE_DIR];
    for (let d = 0; d < dirs.length; d++) {
      const battle = new Folder(root.fsName + "/" + dirs[d]);
      let rooms: (File | Folder)[] = [];
      try { rooms = battle.getFiles() || []; } catch (e) { rooms = []; }
      for (let r = 0; r < rooms.length; r++) {
        const room = rooms[r];
        if (!(room instanceof Folder)) continue;
        const newest = newestFileTime(room);
        // newest === 0 means an empty or unreadable room folder -- either way
        // there's no game in it.
        if (newest !== 0 && newest > cutoffTime) continue;
        let files: (File | Folder)[] = [];
        try { files = room.getFiles() || []; } catch (e) { files = []; }
        for (let i = 0; i < files.length; i++) {
          try { (files[i] as File).remove(); } catch (e) { /* leave it */ }
        }
        try { if (room.remove()) roomsRemoved++; } catch (e) { /* leave it */ }
      }
    }

    // Invites carry their own `stamp` in nowStamp()'s sortable format, so age
    // is a string compare -- no re-parsing a Date out of a toString().
    let invitesRemoved = 0;
    const cutoffStamp = staleCutoffStamp(ARCADE_STALE_HOURS);
    const list = readSharedFile<NerdleInvite>(SHARED_NERDLE_INVITES_FILE, SHARED_NERDLE_INVITES_TYPE);
    if (list && list.length > 0) {
      const kept: NerdleInvite[] = [];
      for (let i = 0; i < list.length; i++) {
        const row = list[i];
        if (row && row.stamp && String(row.stamp) >= cutoffStamp) kept.push(row);
        else invitesRemoved++;
      }
      if (invitesRemoved > 0) writeSharedFile(SHARED_NERDLE_INVITES_FILE, SHARED_NERDLE_INVITES_TYPE, kept);
    }

    return { success: true, roomsRemoved: roomsRemoved, invitesRemoved: invitesRemoved };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Arcade scoreboard -- ONE store for every game, not one per game.
// -----------------------------------------------------------------------------
// The arcade hub shows standings for all games together, so scores live in a
// single `misc/arcade/arcade-scores.json` keyed by `game`. Adding a game means posting
// with a new game id; no backend change, no new file, no new read on open.
//
// FIXES A DEAD CALL: CineChainBattle posted its result to
// `teamNerdlePostResult`, which was never actually defined -- every head-to-head
// win silently went nowhere and the board could never fill. `teamArcadePost`
// replaces it, and the head-to-head shape (winner/loser) is expressed as a
// score row for the winner plus the opponent's name, so one store serves both
// "high score" games and versus games.
//
// Same NAS-safe shared-file plumbing as everything else here: reads prefer
// misc/ and fall back to the root, writes always go to misc/.
const SHARED_ARCADE_SCORES_FILE = "arcade-scores.json";
const SHARED_ARCADE_SCORES_TYPE = "xyi-arcade-scores";

/** Keep the board bounded -- it's a leaderboard, not an audit log. */
const ARCADE_SCORE_KEEP = 400;

interface ArcadeScore {
  /** Game id, e.g. "xyinerdle" | "daily" | "timeline". */
  game: string;
  name: string;
  /** Higher is better, per game (films chained, word streak, length...). */
  score: number;
  /** Beaten opponent, for versus games. Empty for solo high scores. */
  versus: string;
  stamp: string;
}

/**
 * Record one score. The player is the machine-owner tag, never typed -- same
 * rule as invites and the word board: an untagged station has no business
 * writing a name into a shared studio file.
 */
export const teamArcadePost = (game: string, score: number, versus: string): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set." };
    const me = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!me) return { success: false, error: "Tag this machine with your name in the Team menu first." };
    if (!game) return { success: false, error: "No game id given." };

    const list = readSharedFile<ArcadeScore>(SHARED_ARCADE_SCORES_FILE, SHARED_ARCADE_SCORES_TYPE) || [];
    list.push({ game: game, name: me, score: score, versus: versus || "", stamp: nowStamp() });
    list.sort(function (a, b) { return a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0; });
    const trimmed = list.length > ARCADE_SCORE_KEEP ? list.slice(0, ARCADE_SCORE_KEEP) : list;

    if (!writeSharedFile(SHARED_ARCADE_SCORES_FILE, SHARED_ARCADE_SCORES_TYPE, trimmed)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * The head-to-head rows, read back out of the one arcade store.
 *
 * A versus row IS a result: the poster is the winner, `versus` is who they
 * beat, `score` is how long the chain got. This is what `teamNerdleLobby`
 * serves the in-game leaderboard, replacing a read of a file nobody wrote --
 * see the note at the top of the XYiNerdle section.
 *
 * A plain `function` (not a const arrow) on purpose: it's declared here, next
 * to the store it reads, but called from `teamNerdleLobby` further up the
 * file, and only a function declaration hoists.
 */
function nerdleResultsFromScores(): NerdleResult[] {
  const list = readSharedFile<ArcadeScore>(SHARED_ARCADE_SCORES_FILE, SHARED_ARCADE_SCORES_TYPE) || [];
  const out: NerdleResult[] = [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!row || String(row.game) !== "xyinerdle") continue;
    // No opponent means it isn't a head-to-head row -- skip rather than
    // inventing a loser for it.
    if (!row.versus) continue;
    out.push({
      room: "",
      winner: String(row.name),
      loser: String(row.versus),
      films: Number(row.score) || 0,
      stamp: String(row.stamp || ""),
    });
  }
  return out;
}

/**
 * Every score plus who this machine is, in ONE round trip -- the hub renders
 * all games' boards together, and each read is a NAS hit.
 *
 * An unmounted share is a NORMAL state (a laptop away from the studio), so it
 * returns success with an empty board rather than an error the hub would have
 * to render as a failure.
 */
export const teamArcadeScores = (): { success: boolean; me?: string; scores?: ArcadeScore[]; read?: boolean; error?: string } => {
  try {
    const me = loadLocalSetting(MACHINE_OWNER_KEY) || "";
    if (!teamFolder()) return { success: true, me: me, scores: [], read: false };
    const list = readSharedFile<ArcadeScore>(SHARED_ARCADE_SCORES_FILE, SHARED_ARCADE_SCORES_TYPE);
    // `read` is the difference between "nobody has played yet" and "I could
    // not read the file just now" -- see sharedReadFailed's note. Without it
    // a transient NAS/AE hiccup is served as a legitimately empty board, and
    // the caller wipes a good one.
    return { success: true, me: me, scores: list || [], read: list !== null };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// CREATIVE WORKFLOWS -- the checklist a creative has to be localised BY.
// =============================================================================
//
// Every creative carries house rules that are not in any spec sheet and not
// derivable from a filename: Trio's title treatment, pedigree, tagline and date
// all come from Components rather than being rebuilt, and the person who knows
// that is whoever did it last. That knowledge currently lives in somebody's
// head, or in a Slack message from four months ago.
//
// So: the STEPS and the NOTES are shared, and the TICKS are not.
//
// That split is the whole design. Steps and notes are what the team knows about
// the creative and they belong to the creative -- one copy, on the NAS, the
// same for everyone. A tick is one artist's progress through one job: two
// people localising BR and FR of the same creative on the same afternoon must
// not be able to uncheck each other's boxes, and neither of them wants the
// board to open pre-ticked because somebody finished a different territory.
// Ticks are therefore local (app.settings), and there is a Reset for the next
// job.
//
// KEYED ON CAMPAIGN + CREATIVE, canonicalised. A creative name repeats across
// campaigns -- the thumbnail overrides already carry this exact rule and for
// the same reason -- and a component list that changed between campaigns has to
// have somewhere to live. `mastersCanon`-style folding (upper, alphanumerics
// only) so "Portal To Paradise" and "PortalToParadise" are one campaign.

const SHARED_WORKFLOWS_FILE = "shared-workflows.json";
const SHARED_WORKFLOWS_TYPE = "xyi-shared-workflows";

/** Local only -- see the header. One JSON map, because a step id is generated
 *  but a key is built from names people typed, and no delimiter is safe there. */
const WORKFLOW_TICKS_KEY = "WorkflowTicks";

export interface WorkflowStep {
  id: string;
  text: string;
}

export interface WorkflowNote {
  id: string;
  text: string;
  /** Whoever posted it. Never guessed -- an untagged machine is refused. */
  author: string;
  stamp: string;
  /** ISO-3166 alpha-2, or absent. Optional on purpose: plenty of notes are
   *  about the creative rather than one market, and forcing a territory would
   *  file those under whichever country happened to be selected. */
  territory?: string;
  /**
   * Words in this note that DO something: open a folder, or open a tool.
   *
   * A SIDE TABLE, not markup in the text. The obvious design is a link syntax
   * -- `[masters](/Volumes/...)` -- and it is wrong twice over: nobody is
   * typing a NAS path by hand into a one-line input, and a literal `[` in
   * ordinary prose would then be a broken link. CLAUDE.md's rule about
   * user-authored text and delimiters is the same rule one level up: the note
   * body stays exactly what somebody typed, and the links live beside it.
   *
   * `label` is matched against the body at render time. A label that no longer
   * appears in the text is still SHOWN, as a chip under the note -- an edited
   * sentence must not silently drop the link somebody attached to it.
   */
  links?: WorkflowNoteLink[];
  /**
   * Free-form labels: "CTA", "TT", "LEGALS".
   *
   * UPPER-CASED ON THE WAY IN, deliberately. These are a vocabulary the team
   * builds by typing, and a vocabulary that distinguishes "CTA" from "cta" from
   * "Cta" is three tags where everybody meant one -- the filter then shows
   * three chips and each hides two thirds of the notes. Same canonicalise-for-
   * matching rule the campaign keys follow, applied to something short enough
   * that the canonical form is also the readable one.
   */
  tags?: string[];
}

export interface WorkflowNoteLink {
  /** The word to make clickable, as it appears in the note. */
  label: string;
  /** A folder to open. Set for a folder link, absent for a tool one. */
  path?: string;
  /** A registry tool id. Validated PANEL-SIDE against TOOLS on every render:
   *  this file has never heard of the registry and should not learn it. */
  tool?: string;
  /** A button inside that tool, named on arrival rather than pressed. */
  action?: string;
}

export interface WorkflowEntry {
  id: string;
  /** As typed, for display. */
  campaign: string;
  creative: string;
  /** What matching actually uses: canon(campaign) + "|" + canon(creative). */
  key: string;
  steps: WorkflowStep[];
  notes: WorkflowNote[];
  author: string;
  updatedAt: string;
}

/** Upper-case alphanumerics. Same shape as mastersCanon, applied to names
 *  people type rather than to paths. */
function workflowCanon(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function workflowKeyFor(campaign: string, creative: string): string {
  return workflowCanon(campaign) + "|" + workflowCanon(creative);
}

/** Everything a shared entry must have before it is worth writing. Entries
 *  written by an older/newer panel that fail this are DROPPED on read rather
 *  than crashing the board -- one bad row must not cost the other twenty. */
function validWorkflowEntry(e: WorkflowEntry): boolean {
  if (!e) return false;
  if (!e.id) return false;
  if (!e.creative) return false;
  if (!(e.steps instanceof Array)) return false;
  return true;
}

function readWorkflowEntries(): WorkflowEntry[] | null {
  const raw = readSharedFile<WorkflowEntry>(SHARED_WORKFLOWS_FILE, SHARED_WORKFLOWS_TYPE);
  if (raw === null) return null;
  const out: WorkflowEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (!validWorkflowEntry(e)) continue;
    if (!(e.notes instanceof Array)) e.notes = [];
    // Rebuilt rather than trusted: an entry saved before the key existed, or
    // one hand-edited in the JSON, still has to match.
    e.key = workflowKeyFor(e.campaign, e.creative);
    out.push(e);
  }
  return out;
}

interface WorkflowBoardResult extends Result {
  /** FALSE means "couldn't read", which is NOT the same as an empty board --
   *  the panel keeps whatever it already had rather than blanking the screen. */
  read?: boolean;
  entries?: WorkflowEntry[];
  /** This machine's tag, so the UI can grey out posting before it is asked. */
  me?: string;
}

export const workflowBoardLoad = (): WorkflowBoardResult => {
  try {
    const me = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!teamFolder()) return { success: true, read: false, entries: [], me: me };
    const entries = readWorkflowEntries();
    if (entries === null) {
      // No file yet is a NORMAL first run, and indistinguishable here from a
      // share that went away mid-session. read:false covers both, and the
      // panel's own "did I have rows a moment ago" is what tells them apart.
      return { success: true, read: false, entries: [], me: me };
    }
    return { success: true, read: true, entries: entries, me: me };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Create or replace one creative's workflow.
 *
 * RE-READS THE SHARED FILE FIRST and replaces only this entry. Two artists
 * editing two different creatives at the same moment must not overwrite each
 * other, and a whole-board write from stale state is exactly how that happens.
 */
export const workflowSaveEntry = (entryJson: string): WorkflowBoardResult => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };
    const me = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!me) return { success: false, error: "This machine isn't tagged with your name yet -- set it in the Team menu, so the team knows who wrote this." };

    let entry: WorkflowEntry | null = null;
    try {
      entry = JSON.parse(entryJson) as WorkflowEntry;
    } catch (e2) {
      return { success: false, error: "Could not read the workflow data." };
    }
    if (!entry) return { success: false, error: "Could not read the workflow data." };
    if (!entry.creative) return { success: false, error: "A workflow needs a creative." };
    if (!(entry.steps instanceof Array)) entry.steps = [];

    const shared = readWorkflowEntries() || [];
    entry.key = workflowKeyFor(entry.campaign, entry.creative);
    entry.updatedAt = new Date().toString();
    if (!entry.author) entry.author = me;
    if (!entry.id) entry.id = "wf-" + new Date().getTime() + "-" + Math.floor(Math.random() * 100000);
    if (!(entry.notes instanceof Array)) entry.notes = [];

    let replaced = false;
    for (let i = 0; i < shared.length; i++) {
      // By KEY, not by id: two people can each create "Trio" for the same
      // campaign before either has seen the other's, and the board must end up
      // with one Trio rather than two that shadow each other forever.
      if (shared[i].key !== entry.key) continue;
      // NOTES ARE NOT THE EDITOR'S TO DISCARD. Whoever is saving steps may
      // have been holding this entry on screen while somebody else added a
      // note, and a note lost this way leaves no trace that it existed.
      const keptNotes = shared[i].notes;
      entry.notes = mergeWorkflowNotes(keptNotes, entry.notes);
      entry.id = shared[i].id;
      shared[i] = entry;
      replaced = true;
      break;
    }
    if (!replaced) shared.push(entry);

    if (!writeSharedFile(SHARED_WORKFLOWS_FILE, SHARED_WORKFLOWS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, read: true, entries: shared, me: me };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/** Union by note id, keeping the on-disk copy's order and appending anything
 *  the caller is holding that disk hasn't seen. */
function mergeWorkflowNotes(onDisk: WorkflowNote[], incoming: WorkflowNote[]): WorkflowNote[] {
  const out: WorkflowNote[] = [];
  const seen: { [id: string]: boolean } = {};
  const a = onDisk instanceof Array ? onDisk : [];
  const b = incoming instanceof Array ? incoming : [];
  for (let i = 0; i < a.length; i++) {
    if (!a[i] || !a[i].id) continue;
    if (seen[a[i].id]) continue;
    seen[a[i].id] = true;
    out.push(a[i]);
  }
  for (let j = 0; j < b.length; j++) {
    if (!b[j] || !b[j].id) continue;
    if (seen[b[j].id]) continue;
    seen[b[j].id] = true;
    out.push(b[j]);
  }
  return out;
}

export const workflowDeleteEntry = (id: string): WorkflowBoardResult => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set." };
    const shared = readWorkflowEntries();
    if (shared === null) return { success: false, error: "Nothing on the team board to delete." };
    const remaining: WorkflowEntry[] = [];
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].id === id) continue;
      remaining.push(shared[i]);
    }
    if (remaining.length === shared.length) return { success: false, error: "That workflow is no longer on the board." };
    if (!writeSharedFile(SHARED_WORKFLOWS_FILE, SHARED_WORKFLOWS_TYPE, remaining)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, read: true, entries: remaining, me: loadLocalSetting(MACHINE_OWNER_KEY) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Append one note. Its own call rather than part of a whole-entry save, so a
 * note posted while somebody else is editing the steps cannot be lost between
 * their read and their write.
 */
export const workflowAddNote = (
  entryId: string,
  text: string,
  territory?: string,
  linksJson?: string,
  tagsJson?: string,
): WorkflowBoardResult => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set." };
    const me = loadLocalSetting(MACHINE_OWNER_KEY);
    // REFUSED, NOT GUESSED. An unsigned note on a shared board is worse than
    // no note: the next person cannot tell whether it is house rule or one
    // artist's opinion, and has nobody to ask.
    if (!me) return { success: false, error: "This machine isn't tagged with your name yet -- set it in the Team menu before posting a note." };
    const body = String(text || "").replace(/^\s+|\s+$/g, "");
    if (!body) return { success: false, error: "The note is empty." };

    const shared = readWorkflowEntries();
    if (shared === null) return { success: false, error: "Couldn't read the team board -- is the NAS mounted?" };
    let found = false;
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].id !== entryId) continue;
      // Upper-cased and stripped to letters and an underscore: the codes this
      // codebase carries are not all two letters ("BE_FR"), and a code stored
      // in whatever case the caller sent would never match another panel's.
      const terr = String(territory || "").toUpperCase().replace(/[^A-Z_]/g, "");
      // A JSON STRING across the bridge, per CLAUDE.md: an array of objects
      // spliced into eval'd ExtendScript source loses its values in transit.
      const links: WorkflowNoteLink[] = [];
      if (linksJson) {
        try {
          const parsed = JSON.parse(linksJson);
          if (parsed instanceof Array) {
            for (let f = 0; f < parsed.length; f++) {
              const item = parsed[f];
              if (!item) continue;
              if (!item.label) continue;
              // A link has to go SOMEWHERE. One with neither a path nor a tool
              // renders as a word that looks clickable and is not, which is
              // worse than no link at all.
              const hasPath = !!item.path;
              const hasTool = !!item.tool;
              if (!hasPath && !hasTool) continue;
              const entryLink: WorkflowNoteLink = { label: String(item.label) };
              if (hasPath) entryLink.path = String(item.path);
              if (hasTool) entryLink.tool = String(item.tool);
              if (item.action) entryLink.action = String(item.action);
              links.push(entryLink);
            }
          }
        } catch (e3) {
          // A note with unreadable links is still a note. Posting it without
          // them beats refusing to post it at all.
        }
      }
      const tags: string[] = [];
      if (tagsJson) {
        try {
          const parsedTags = JSON.parse(tagsJson);
          if (parsedTags instanceof Array) {
            for (let t = 0; t < parsedTags.length; t++) {
              // Letters, digits, spaces and a hyphen. Anything else is
              // punctuation somebody typed by accident, and a tag that differs
              // from its neighbour by a stray full stop is a second tag.
              const tag = String(parsedTags[t] || "")
                .toUpperCase()
                .replace(/[^A-Z0-9 \-]/g, "")
                .replace(/\s+/g, " ")
                .replace(/^ +| +$/g, "");
              if (!tag) continue;
              if (tag.length > 24) continue;
              // indexOf is polyfilled; `includes` is not (CLAUDE.md §2).
              if (tags.indexOf(tag) !== -1) continue;
              tags.push(tag);
            }
          }
        } catch (e4) {
          // A note with unreadable tags is still a note.
        }
      }
      shared[i].notes.push({
        id: "note-" + new Date().getTime() + "-" + Math.floor(Math.random() * 100000),
        text: body,
        author: me,
        stamp: new Date().toString(),
        territory: terr,
        links: links,
        tags: tags,
      });
      found = true;
      break;
    }
    if (!found) return { success: false, error: "That workflow is no longer on the board -- reload and try again." };
    if (!writeSharedFile(SHARED_WORKFLOWS_FILE, SHARED_WORKFLOWS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, read: true, entries: shared, me: me };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const workflowDeleteNote = (entryId: string, noteId: string): WorkflowBoardResult => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set." };
    const shared = readWorkflowEntries();
    if (shared === null) return { success: false, error: "Couldn't read the team board -- is the NAS mounted?" };
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].id !== entryId) continue;
      const kept: WorkflowNote[] = [];
      for (let j = 0; j < shared[i].notes.length; j++) {
        if (shared[i].notes[j].id === noteId) continue;
        kept.push(shared[i].notes[j]);
      }
      shared[i].notes = kept;
      break;
    }
    if (!writeSharedFile(SHARED_WORKFLOWS_FILE, SHARED_WORKFLOWS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, read: true, entries: shared, me: loadLocalSetting(MACHINE_OWNER_KEY) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- what am I working on right now ----------------------------------------

interface WorkflowContext extends Result {
  /** The open project's filename, "" when nothing is open. */
  project?: string;
  /** Creative token read out of it, upper-cased -- what MATCHING uses. */
  creative?: string;
  /**
   * The same creative AS THE FILENAME SPELLS IT: "PortalToParadise", not
   * "PORTALTOPARADISE".
   *
   * Carried separately because upper-casing is lossy in a way nothing can undo.
   * The matcher needs one case-folded token; a person needs the word breaks,
   * and no amount of formatting recovers "Portal To Paradise" from a run of
   * seventeen capitals without a dictionary. So the parser keeps its answer and
   * the display gets the original.
   */
  creativeLabel?: string;
  /** Campaign whose masters root contains this project, "" when none does. */
  campaign?: string;
  /** Every campaign the panel knows, for the picker. One root each -- the
   *  panel only needs somewhere to scan creatives and territories from. */
  campaigns?: { name: string; mastersRoot: string }[];
}

/**
 * What the open project says it is.
 *
 * The creative comes from the FILENAME via the localiser's own parser
 * (`creativeTokenOf`), not from a folder name: a working copy can sit anywhere,
 * and the name is the thing that travels with it.
 *
 * The campaign comes from the PATH -- the campaign whose masters root this file
 * is inside. Longest root wins, so a campaign nested inside another campaign's
 * tree resolves to the inner one rather than to whichever was saved first.
 *
 * Every field can legitimately be "". Nothing open, a scratch project, a file
 * saved outside every known campaign: all normal, all answered with a picker
 * rather than an error.
 */
export const workflowContext = (): WorkflowContext => {
  try {
    let project = "";
    let projectPath = "";
    if (app.project.file) {
      project = decode(app.project.file.name);
      projectPath = app.project.file.fsName;
    }
    // Nothing saved yet -- fall back to the active comp, which on a localise
    // job is named after the deliverable anyway.
    if (!project) {
      const item = app.project.activeItem;
      if (item && typeof (item as CompItem).numLayers === "number") project = item.name;
    }

    // ONE CAMPAIGN CAN HAVE TWO ROOTS, and that was the bug.
    //
    // OV Library saves a campaign against its MASTERS tree
    // (`XY026039_…_Masters`); Localised Library saves the same campaign against
    // its MARKETS tree (`XY026040_…_Markets`). They are SIBLING folders, not
    // parent and child (CLAUDE.md §5), so a working file under
    // `…_Markets/Brazil/AE/…` shares no prefix with the masters root at all.
    // The old code kept whichever store was read first and dropped the other as
    // a duplicate name, so on any machine that has the campaign in OV Library,
    // every real working file failed to match and came back "no campaign".
    //
    // Both roots are kept now and all of them are tested.
    const camps: { name: string; mastersRoot: string; roots: string[] }[] = [];
    function addCampaign(name: string, root: string): void {
      if (!name) return;
      for (let c = 0; c < camps.length; c++) {
        if (camps[c].name.toLowerCase() !== name.toLowerCase()) continue;
        if (root && camps[c].roots.indexOf(root) === -1) camps[c].roots.push(root);
        // The FIRST root stays the primary one, because that is what
        // scanCreatives and the territory scan are handed.
        if (root && !camps[c].mastersRoot) camps[c].mastersRoot = root;
        return;
      }
      camps.push({ name: name, mastersRoot: root, roots: root ? [root] : [] });
    }
    const ov = loadCampaignsRaw();
    for (let i = 0; i < ov.length; i++) addCampaign(ov[i].name, ov[i].mastersRoot);
    const loc = loadLocLibCampaigns();
    for (let j = 0; j < loc.length; j++) addCampaign(loc[j].name, loc[j].marketsRoot);

    let campaign = "";
    let bestLen = 0;
    if (projectPath) {
      const hay = projectPath.toLowerCase();
      for (let m = 0; m < camps.length; m++) {
        for (let r = 0; r < camps[m].roots.length; r++) {
          const root = String(camps[m].roots[r] || "").toLowerCase();
          if (!root) continue;
          if (hay.indexOf(root) !== 0) continue;
          // Longest root wins, so a campaign nested inside another campaign's
          // tree resolves to the inner one.
          if (root.length <= bestLen) continue;
          bestLen = root.length;
          campaign = camps[m].name;
        }
      }

      // STILL NOTHING: MATCH THE CAMPAIGN'S NAME AGAINST THE PATH ITSELF.
      //
      // A campaign saved against one of its trees on a machine where the artist
      // works out of the other, or a root typed with a different mount prefix,
      // both land here. The real tree carries the campaign in a folder name --
      // `/Forgotten_Island/Digital/INT/XY026040_…` — so the name is in the path
      // even when no saved root is.
      //
      // Same technique detectCurrentTerritory already uses: walk the path's
      // folder names and compare them canonically. Longest name wins, so
      // "Portal" cannot claim a file belonging to "Portal To Paradise".
      if (!campaign) {
        const parts = projectPath.split("/");
        let bestName = 0;
        for (let n = 0; n < camps.length; n++) {
          const want = workflowCanon(camps[n].name);
          if (want.length < 4) continue;   // too short to be evidence
          for (let q = 0; q < parts.length; q++) {
            if (workflowCanon(parts[q]).indexOf(want) === -1) continue;
            if (want.length <= bestName) continue;
            bestName = want.length;
            campaign = camps[n].name;
            break;
          }
        }
      }
    }

    // The token in the raw name whose canon matches, kept in its own spelling.
    // A plain scan rather than another parse: whatever creativeTokenOf decided
    // is the creative, this finds that exact token again, so the two can never
    // disagree about which word it is.
    const creative = creativeTokenOf(project);
    let creativeLabel = "";
    if (creative) {
      const bits = String(project).split("_");
      for (let b = 0; b < bits.length; b++) {
        if (workflowCanon(bits[b]) !== creative) continue;
        creativeLabel = bits[b];
        break;
      }
    }

    return {
      success: true,
      project: project,
      creative: creative,
      creativeLabel: creativeLabel,
      campaign: campaign,
      campaigns: camps,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// --- ticks: local, per campaign+creative -----------------------------------

interface WorkflowTicksResult extends Result {
  /** The raw JSON map, "{}" when nothing has been ticked yet. */
  message?: string;
}

export const workflowTicksLoad = (): WorkflowTicksResult => {
  try {
    const raw = loadLocalSetting(WORKFLOW_TICKS_KEY);
    return { success: true, message: raw ? raw : "{}" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const workflowTicksSave = (json: string): Result => {
  try {
    // Parsed before it is stored, so a malformed write can never make the
    // whole store unreadable on the next open.
    JSON.parse(json);
    app.settings.saveSetting(SETTINGS_SECTION, WORKFLOW_TICKS_KEY, json);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

/**
 * Pick a folder to hang off a word in a note.
 *
 * Its own export rather than reusing `selectUsefulFolder`: that one's dialog
 * says "Select a folder to add:", which is the Useful Folders question, and a
 * file picker whose prompt is about a different feature is how somebody picks
 * the wrong thing.
 *
 * Returns "" on cancel, never an error shape -- cancelling a picker is not a
 * failure, and a one-click action must return null-ish rather than a fake
 * error (CLAUDE.md's bridge rule).
 */
export const workflowSelectFolder = (): string => {
  try {
    const folder = Folder.selectDialog("Pick the folder this word should open:");
    if (!folder) return "";
    return folder.fsName;
  } catch (e) {
    return "";
  }
};

// --- territories, for tagging a note -----------------------------------------

interface WorkflowTerritory {
  /** As the folder is spelled, or the ISO name when it came from the list. */
  name: string;
  /** ISO-3166 alpha-2, or "" when the folder name matches no country. */
  code: string;
}

interface WorkflowTerritoryResult extends Result {
  /** This campaign's own territory folders. Empty is a NORMAL answer -- an
   *  unmounted share, or a campaign whose root is the masters tree rather than
   *  the markets one. The picker falls back to `all`. */
  markets?: WorkflowTerritory[];
  all?: WorkflowTerritory[];
}

function territoryCanon(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The ISO code for a folder name, or "" when it is not a country we know.
 *  A campaign's markets folder is spelled by whoever made it -- "Brazil",
 *  "BRAZIL", "Brasil" -- so this is a normalised compare, never equality. */
function territoryCodeFor(name: string): string {
  const want = territoryCanon(name);
  if (!want) return "";
  for (let i = 0; i < TC_COUNTRIES.length; i++) {
    if (territoryCanon(TC_COUNTRIES[i].name) === want) return TC_COUNTRIES[i].code;
  }
  // A folder named by its code ("BR", "DE") is just as common as one named
  // by its country.
  for (let j = 0; j < TC_COUNTRIES.length; j++) {
    if (territoryCanon(TC_COUNTRIES[j].code) === want) return TC_COUNTRIES[j].code;
  }
  return "";
}

/**
 * Territories a note can be tagged with.
 *
 * TWO LISTS, and both are returned every time.
 *
 * `markets` is what the campaign actually has on disk -- five or six folders,
 * which is the list somebody wants 95% of the time and short enough to click
 * rather than search. It comes from `scanTerritories`, the same function
 * Localised Library already derives its territory list from, so a folder that
 * tool shows and this one does not would be a real inconsistency rather than
 * two opinions.
 *
 * `all` is ISO-3166. It exists because `markets` is EMPTY in three completely
 * normal situations -- the share is not mounted, the campaign was saved against
 * its masters root rather than its markets root (they are sibling trees, see
 * CLAUDE.md §5), or the note is about a territory whose folder does not exist
 * yet. A picker that offered nothing in any of those cases would be a picker
 * that fails exactly when somebody is writing down what they just learned.
 *
 * The FOLDER'S OWN SPELLING is kept as the name. "Brasil" on disk stays
 * "Brasil"; only its code is looked up.
 */
export const workflowTerritories = (root: string): WorkflowTerritoryResult => {
  try {
    const all: WorkflowTerritory[] = [];
    for (let i = 0; i < TC_COUNTRIES.length; i++) {
      all.push({ name: TC_COUNTRIES[i].name, code: TC_COUNTRIES[i].code });
    }

    const markets: WorkflowTerritory[] = [];
    const path = String(root || "");
    if (path) {
      const names = scanTerritories(path);
      for (let j = 0; j < names.length; j++) {
        const code = territoryCodeFor(names[j]);
        // A folder that is not a country is not a territory -- "Support",
        // "_Archive", "Motion_Components". Dropped rather than offered, or the
        // picker fills with folders nobody would tag a note with.
        if (!code) continue;
        markets.push({ name: names[j], code: code });
      }
    }

    return { success: true, markets: markets, all: all };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
