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
import { expressionsBankLoad, expressionsBankSave, loadCustomTools, saveCustomTools } from "./tools";
import { loadCombos, saveCombos, EffectComboEntry } from "./effects";
import { loadCampaignsRaw, saveCampaign } from "./review";

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
const SHARED_TOOLS_FILE = "shared-tools.json";
const SHARED_CAMPAIGNS_FILE = "shared-campaigns.json";
const SHARED_WORDGAME_FILE = "shared-wordgame.json";
const SHARED_COMBOS_TYPE = "xyi-shared-combos";
const SHARED_EXPRESSIONS_TYPE = "xyi-shared-expressions";
const SHARED_TOOLS_TYPE = "xyi-shared-tools";
const SHARED_CAMPAIGNS_TYPE = "xyi-shared-campaigns";
const SHARED_WORDGAME_TYPE = "xyi-shared-wordgame";

// OV Library campaign: just a name + the masters-root path. Sharing these is
// safe/useful here specifically because the masters live on the studio NAS at
// a path that resolves identically on every artist's Mac (same consistent-
// mount assumption Frontcard's hardcoded template path relies on) -- so one
// person's saved campaign points every other machine at the same real folder.
interface SharedCampaign {
  name: string;
  mastersRoot: string;
}

interface ExpressionEntry {
  id: string;
  name: string;
  tag: string;
  code: string;
  uses: number;
  description: string;
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

function miscFolder(): Folder | null {
  const root = teamFolder();
  if (!root) return null;
  return new Folder(root.fsName + "/" + MISC_DIR);
}

function readSharedFile<T>(fileName: string, expectedType: string): T[] | null {
  const root = teamFolder();
  if (!root) return null;
  // misc/ first, then the legacy root location.
  let content = readTextFile(new File(root.fsName + "/" + MISC_DIR + "/" + fileName));
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
    : expectedType === SHARED_WORDGAME_TYPE ? "result"
    : expectedType === SHARED_NERDLE_INVITES_TYPE ? "invite"
    : expectedType === SHARED_NERDLE_RESULTS_TYPE ? "match"
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
  // Always write to misc/, creating it on first use. If the folder can't be
  // created (permissions, unmounted share), fall back to the root rather than
  // failing the share outright -- a shared combo landing in the old place is
  // far better than losing it.
  const misc = miscFolder();
  if (misc && !misc.exists) {
    try { misc.create(); } catch (e) { /* fall through to the root path below */ }
  }
  const target = misc && misc.exists
    ? new File(misc.fsName + "/" + fileName)
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
        if (names[camp.name.toLowerCase()]) continue;
        const r = saveCampaign(camp.name, camp.mastersRoot);
        if (r.success) {
          names[camp.name.toLowerCase()] = true;
          newCampaigns++;
        }
      }
    }

    return { success: true, newCombos: newCombos, newExpressions: newExpressions, newTools: newTools, newCampaigns: newCampaigns };
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
    for (let i = 0; i < shared.length; i++) {
      if (shared[i].name.toLowerCase() === entry.name.toLowerCase()) {
        return { success: true, message: '"' + entry.name + '" is already in the team library.' };
      }
    }
    shared.push({ name: entry.name, mastersRoot: entry.mastersRoot });
    if (!writeSharedFile(SHARED_CAMPAIGNS_FILE, SHARED_CAMPAIGNS_TYPE, shared)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: 'Shared "' + entry.name + '" with the team.' };
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
export const teamLoadWordBoard = (): { success: boolean; entries?: WordResultEntry[]; error?: string } => {
  try {
    if (!teamFolder()) return { success: true, entries: [] };
    const entries = readSharedFile<WordResultEntry>(SHARED_WORDGAME_FILE, SHARED_WORDGAME_TYPE) || [];
    return { success: true, entries: entries };
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
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };

    const owner = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!owner) return { success: false, error: "Tag this machine with your name in the Team menu first, so the board knows who posted." };

    let incoming: WordResultEntry | null = null;
    try {
      incoming = JSON.parse(resultJson) as WordResultEntry;
    } catch (e2) {
      return { success: false, error: "Could not read the result data." };
    }
    if (!incoming || !incoming.day) return { success: false, error: "Result has no day to file it under." };
    incoming.member = owner;
    incoming.streak = Number(incoming.streak) || 0;
    incoming.postedAt = new Date().toString();

    const board = readSharedFile<WordResultEntry>(SHARED_WORDGAME_FILE, SHARED_WORDGAME_TYPE) || [];
    const kept: WordResultEntry[] = [];
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
    const trimmed: WordResultEntry[] = [];
    const seenDays: string[] = [];
    for (let i = 0; i < kept.length; i++) {
      if (seenDays.indexOf(kept[i].day) === -1) {
        if (seenDays.length >= 30) break;
        seenDays.push(kept[i].day);
      }
      trimmed.push(kept[i]);
    }

    if (!writeSharedFile(SHARED_WORDGAME_FILE, SHARED_WORDGAME_TYPE, trimmed)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: "Posted to the team board." };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
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
const SHARED_NERDLE_RESULTS_FILE = "xyinerdle-results.json";
const SHARED_NERDLE_INVITES_TYPE = "xyi-nerdle-invites";
const SHARED_NERDLE_RESULTS_TYPE = "xyi-nerdle-results";

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
 */
export const teamNerdleInvite = (toMember: string, room: string): Result => {
  try {
    if (!teamFolder()) return { success: false, error: "Team folder not set -- set it in the Team menu on the home screen first." };
    const from = loadLocalSetting(MACHINE_OWNER_KEY);
    if (!from) return { success: false, error: "Tag this machine with your name in the Team menu first, so they know who's asking." };
    if (!toMember) return { success: false, error: "Pick someone to invite." };
    if (toMember.toLowerCase() === from.toLowerCase()) return { success: false, error: "You can't invite yourself." };

    const list = readSharedFile<NerdleInvite>(SHARED_NERDLE_INVITES_FILE, SHARED_NERDLE_INVITES_TYPE) || [];
    const kept: NerdleInvite[] = [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row || !row.room) continue;
      // One live invite per pair -- re-inviting replaces rather than stacks.
      const samePair = String(row.from).toLowerCase() === from.toLowerCase() && String(row.to).toLowerCase() === toMember.toLowerCase();
      if (!samePair) kept.push(row);
    }
    kept.push({ room: room, from: from, to: toMember, createdAt: new Date().toString(), stamp: nowStamp() });
    kept.sort(function (a, b) { return a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0; });
    const trimmed = kept.length > NERDLE_INVITE_KEEP ? kept.slice(0, NERDLE_INVITE_KEEP) : kept;

    if (!writeSharedFile(SHARED_NERDLE_INVITES_FILE, SHARED_NERDLE_INVITES_TYPE, trimmed)) {
      return { success: false, error: "Could not write to the team folder (is the NAS mounted?)." };
    }
    return { success: true, message: "Invited " + toMember + " to room " + room + "." };
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
    const results = readSharedFile<NerdleResult>(SHARED_NERDLE_RESULTS_FILE, SHARED_NERDLE_RESULTS_TYPE) || [];
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

const BATTLE_DIR = "misc/battle";

/**
 * Ensure `misc/battle/<room>/` exists, creating each level in turn.
 *
 * Folder.create() is not reliable for nested paths in ExtendScript, so the
 * levels are walked deliberately rather than hoping one call does it.
 */
function battleRoomFolder(room: string, create: boolean): Folder | null {
  const root = teamFolder();
  if (!root) return null;
  const levels = [root.fsName + "/misc", root.fsName + "/" + BATTLE_DIR, root.fsName + "/" + BATTLE_DIR + "/" + room];
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
    const p1 = f1 ? readTextFile(f1) : null;
    const p2 = f2 ? readTextFile(f2) : null;
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
 */
export const teamBattleCleanup = (room: string): Result => {
  try {
    const folder = battleRoomFolder(room, false);
    if (!folder) return { success: true };
    const files = folder.getFiles() || [];
    for (let i = 0; i < files.length; i++) {
      try { (files[i] as File).remove(); } catch (e) { /* leave it */ }
    }
    try { folder.remove(); } catch (e) { /* leave it */ }
    return { success: true };
  } catch (e) {
    return { success: true };
  }
};

// =============================================================================
// Arcade scoreboard -- ONE store for every game, not one per game.
// -----------------------------------------------------------------------------
// The arcade hub shows standings for all games together, so scores live in a
// single `misc/arcade-scores.json` keyed by `game`. Adding a game means posting
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
 * Every score plus who this machine is, in ONE round trip -- the hub renders
 * all games' boards together, and each read is a NAS hit.
 *
 * An unmounted share is a NORMAL state (a laptop away from the studio), so it
 * returns success with an empty board rather than an error the hub would have
 * to render as a failure.
 */
export const teamArcadeScores = (): { success: boolean; me?: string; scores?: ArcadeScore[]; error?: string } => {
  try {
    const me = loadLocalSetting(MACHINE_OWNER_KEY) || "";
    if (!teamFolder()) return { success: true, me: me, scores: [] };
    const list = readSharedFile<ArcadeScore>(SHARED_ARCADE_SCORES_FILE, SHARED_ARCADE_SCORES_TYPE) || [];
    return { success: true, me: me, scores: list };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};
