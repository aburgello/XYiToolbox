// =============================================================================
// src/js/main/TeamDroplet.tsx
// -----------------------------------------------------------------------------
// Home-screen "Team" menu -- a Users icon in the search row (same
// trigger-in-a-Droplet pattern as SfxDroplet/TimeTrackerDroplet) gathering
// every Team Folder feature in one place:
//   - Set/change the team folder (a shared NAS location -- aeft/team.ts).
//   - PROFILES: save this panel's whole personalisation (Toolset layout,
//     rail customisation, favorites, theme, pinned effects, combos...) under
//     a name; click a colleague's name to apply THEIR setup on this machine.
//     Applying reloads the panel so every screen re-reads its settings.
//   - Update nudge: when toolbox-version.txt in the team folder is newer
//     than this build, the trigger gets a dot and the panel says so.
//   - Shared-library sync note: teamSyncShared() runs once per session on
//     mount (pulls new team combos/expressions into the local stores) and
//     reports what arrived here.
//
// The once-per-session guards are module-scope on purpose -- navigating
// home -> tool -> home remounts this component, and re-running a NAS scan +
// version check on every home visit would be wasteful and re-toast the same
// sync results.
// =============================================================================
import React, { useEffect, useState } from "react";
import { Users, FolderCog, Trash2, Save, RefreshCw, Home, Undo2 } from "lucide-react";
import Droplet from "./Droplet";
import Tooltip from "./Tooltip";
import CheckboxToggle from "./CheckboxToggle";
import { confirmDialog } from "./Dialog";
import { evalTS } from "../lib/utils/bolt";
import { requestSoftReload } from "./softReload";
import "./TeamDroplet.scss";

// The version THIS build is. Hand-bumped -- nothing in `yarn build`/`yarn
// zxp` derives it: package.json's version feeds the CEP manifest only (see
// cep.config.ts) and never reaches the frontend, so this constant and the
// manifest version are independent on purpose.
//
// FORMAT IS LOAD-BEARING: fixed-width YYYYMMDD, no separators. The update
// check below is a plain STRING compare against the team folder's
// toolbox-version.txt, so a fixed-width all-digit format is the only shape
// where "sorts later" and "is later" can't disagree. Anything with a
// separator or a variable-width field silently mis-orders:
//   "2026.7" > "2026.678"   (true -- but 678 was meant to be the newer one)
//   "2026.08" > "2026.678"  (FALSE -- a padded month reads as older)
//   "2026.10" > "2026.9"    (FALSE -- October reads as older than September)
// The two legacy values this replaced ("2026.07", then "2026.678") both hit
// that; a digit outranks "." in ASCII, which is what lets any YYYYMMDD value
// still register as newer than either of them on machines mid-transition.
//
// To bump: set today's date and update toolbox-version.txt on the team
// folder to the same string. Keep in step with HomeScreen.tsx's
// "Toolbox {version}" hover text, which renders it via formatVersion().
export const TOOLBOX_VERSION = "20260820";

// YYYYMMDD -> "2026.07.30" for display only. The raw fixed-width string is
// what gets compared; this is purely so the panel doesn't show a bare
// 8-digit number. Anything not matching the expected shape (e.g. a legacy
// "2026.678" read off an older team folder) is passed through untouched
// rather than mangled.
export const formatVersion = (v: string): string =>
  /^\d{8}$/.test(v) ? v.slice(0, 4) + "." + v.slice(4, 6) + "." + v.slice(6, 8) : v;

// Mirrors team.ts's TeamProfileInfo: a member is a SUBFOLDER of the team
// folder (Antonio/, Jacqui/, ...); hasProfile says whether that member has
// saved a setup snapshot yet (a pre-created folder with no profile.json
// still lists, greyed, so the studio can scaffold the roster up front).
interface ProfileInfo {
    name: string;
    hasProfile: boolean;
}

// Per-person accent, keyed by lowercased member name (studio roster). A row
// wears its person's colour BRIGHT once their profile is saved, and stays a
// muted grey while it's still "NO SETUP YET" -- so a filled-in roster reads
// as a wall of distinct colours and the empty slots recede. Unknown names
// (someone added later) fall back to a neutral accent rather than breaking.
const MEMBER_COLORS: Record<string, string> = {
    jacqui: "#f472b6",   // pink
    antonio: "#60a5fa",  // blue
    turk: "#ef4444",     // red
    luke: "#fb923c",     // orange
    maria: "#4ade80",    // green
    nicholas: "#2dd4bf", // teal
    aaron: "#a78bfa",    // purple
};
const memberColor = (name: string): string => MEMBER_COLORS[name.trim().toLowerCase()] || "#8a8a8a";

// Once-per-session results, surviving home-screen remounts.
let sessionChecked = false;
let cachedLatestVersion = "";
let cachedSyncNote = "";

const TeamDroplet: React.FC = () => {
    const [folderPath, setFolderPath] = useState("");
    const [mounted, setMounted] = useState(false);
    const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
    const [nameDraft, setNameDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; isError: boolean } | null>(null);
    const [latestVersion, setLatestVersion] = useState(cachedLatestVersion);
    const [syncNote, setSyncNote] = useState(cachedSyncNote);
    // Per-machine identity state (aeft/team.ts's Machine ownership section):
    // whose station this is, whether their profile live-syncs to the NAS on
    // open, and whether a colleague's setup is currently applied as a guest.
    const [machineOwner, setMachineOwner] = useState("");
    const [liveSync, setLiveSync] = useState(false);
    const [guestProfile, setGuestProfile] = useState("");

    const refresh = async () => {
        try {
            const folder = await evalTS("teamGetFolder");
            if (folder && folder.success) {
                setFolderPath(folder.path || "");
                setMounted(!!folder.mounted);
            }
            const list = await evalTS("teamListProfiles");
            if (list && list.success) setProfiles(list.profiles || []);
            const machine = await evalTS("teamGetMachineState");
            if (machine && machine.success) {
                setMachineOwner(machine.owner || "");
                setLiveSync(!!machine.liveSync);
                setGuestProfile(machine.guestProfile || "");
            }
        } catch (e) {
            // browser preview -- no bridge, panel just shows "not set"
        }
    };

    useEffect(() => {
        refresh();
        if (sessionChecked) return;
        sessionChecked = true;
        (async () => {
            try {
                const version = await evalTS("teamCheckVersion");
                if (version && version.success && version.latest && version.latest > TOOLBOX_VERSION) {
                    cachedLatestVersion = version.latest;
                    setLatestVersion(version.latest);
                }
                const sync = await evalTS("teamSyncShared");
                if (sync && sync.success && ((sync.newCombos || 0) > 0 || (sync.newExpressions || 0) > 0 || (sync.newTools || 0) > 0 || (sync.newCampaigns || 0) > 0 || (sync.newLocCampaigns || 0) > 0)) {
                    const parts: string[] = [];
                    if (sync.newCombos) parts.push(`${sync.newCombos} new team combo${sync.newCombos === 1 ? "" : "s"}`);
                    if (sync.newExpressions) parts.push(`${sync.newExpressions} new expression${sync.newExpressions === 1 ? "" : "s"}`);
                    if (sync.newTools) parts.push(`${sync.newTools} new tool${sync.newTools === 1 ? "" : "s"}`);
                    if (sync.newCampaigns) parts.push(`${sync.newCampaigns} new campaign${sync.newCampaigns === 1 ? "" : "s"}`);
                    // Counted separately from newCampaigns because they land in
                    // a different list (LocLibCampaigns, behind Localised
                    // Library and CSV Localiser) -- "3 new campaigns" that only
                    // half showed up in OV Library would be a puzzle.
                    if (sync.newLocCampaigns) parts.push(`${sync.newLocCampaigns} new localise campaign${sync.newLocCampaigns === 1 ? "" : "s"}`);
                    cachedSyncNote = `Synced from team: ${parts.join(" · ")}.`;
                    setSyncNote(cachedSyncNote);
                }
                // Live profile sync: pushes this station's setup to its tagged
                // owner's NAS profile (aeft/team.ts gates it on owner + opt-in
                // toggle + no-guest-session + NAS mounted, and never errors) --
                // deliberately silent on success, it's background housekeeping.
                const synced = (await evalTS("teamAutoSyncProfile")) as { success?: boolean; message?: string } | undefined;
                // Always re-list after the startup housekeeping, not only when
                // auto-sync reported a save. TWO real races this catches, both
                // seen on the office NAS install: (1) the initial refresh()
                // above can fire before the network share finishes mounting
                // right after AE launches (the folder reads as empty for a
                // beat, so every member shows "NO SETUP YET"); (2) auto-sync
                // may have just created the owner's profile.json. By this point
                // the version/sync/auto-sync round-trips have completed, so the
                // share is definitely reachable -- a second listing now shows
                // the real state without the user reopening the panel.
                void synced;
                refresh();
            } catch (e) {
                // no bridge / NAS unreachable -- quiet, same as every background load
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const showNote = (text: string, isError: boolean) => setNote({ text, isError });

    const pickFolder = async () => {
        try {
            const result = await evalTS("teamSelectFolder");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showNote(result.error || "Something went wrong.", true);
                return;
            }
            if (result.path) {
                setFolderPath(result.path);
                setMounted(true);
                showNote("Team folder set.", false);
                refresh();
            }
        } catch (e) {
            showNote("No CEP bridge detected. Open this panel inside After Effects.", true);
        }
    };

    const saveProfile = async () => {
        const name = nameDraft.trim();
        if (!name) return;
        setBusy(true);
        try {
            const result = await evalTS("teamSaveProfile", name);
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showNote(result.error || "Something went wrong.", true);
                return;
            }
            setProfiles(result.profiles || []);
            setNameDraft("");
            showNote(`Saved "${name}". Pick it from any machine's Team menu to apply this setup there.`, false);
        } catch (e) {
            showNote("No CEP bridge detected. Open this panel inside After Effects.", true);
        } finally {
            setBusy(false);
        }
    };

    const setOwner = async (name: string) => {
        try {
            // Clicking the tagged owner's own home icon untags the machine.
            const next = machineOwner === name ? "" : name;
            const result = await evalTS("teamSetMachineOwner", next);
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showNote(result.error || "Something went wrong.", true);
                return;
            }
            setMachineOwner(next);
            showNote(next ? `This Mac is now tagged as ${next}'s station.` : "Machine untagged.", false);
        } catch (e) {
            showNote("No CEP bridge detected. Open this panel inside After Effects.", true);
        }
    };

    const toggleLiveSync = async (enabled: boolean) => {
        setLiveSync(enabled); // optimistic -- a toggle should feel instant
        try {
            const result = await evalTS("teamSetLiveSync", enabled);
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                setLiveSync(!enabled);
                showNote(result.error || "Something went wrong.", true);
            }
        } catch (e) {
            setLiveSync(!enabled);
            showNote("No CEP bridge detected. Open this panel inside After Effects.", true);
        }
    };

    const restoreSetup = async () => {
        setBusy(true);
        try {
            const result = await evalTS("teamRestoreLocalSetup");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showNote(result.error || "Something went wrong.", true);
                return;
            }
            // Soft remount, NOT window.location.reload() -- see softReload.ts.
            // A hard reload in a CEP panel can come back with a broken base
            // URL (unstyled white page); remounting re-runs every hook's
            // settings read with none of that risk.
            requestSoftReload();
        } catch (e) {
            showNote("No CEP bridge detected. Open this panel inside After Effects.", true);
        } finally {
            setBusy(false);
        }
    };

    const applyProfile = async (profile: ProfileInfo) => {
        // The scary "save first!" wording is gone -- a guest apply now backs
        // the machine's own setup up automatically (aeft/team.ts), and the
        // owner reclaiming their machine (applying their own profile on a
        // station tagged theirs) ends the guest session instead.
        const isOwnerReclaim = machineOwner !== "" && profile.name === machineOwner;
        const ok = await confirmDialog(
            isOwnerReclaim
                ? `Load ${profile.name}'s setup from the team folder and reload the panel?`
                : `Apply "${profile.name}"'s setup on this machine? The current setup is backed up automatically. Restore it any time from this Team menu.`
        );
        if (!ok) return;
        setBusy(true);
        try {
            const result = await evalTS("teamApplyProfile", profile.name);
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showNote(result.error || "Something went wrong.", true);
                return;
            }
            // Soft remount, NOT window.location.reload() -- see softReload.ts.
            // Every screen/hook re-reads its settings fresh on the remount,
            // the same outcome a panel reopen gives, without the CEP hard-
            // reload hazard that returned an unstyled white panel.
            requestSoftReload();
        } catch (e) {
            showNote("No CEP bridge detected. Open this panel inside After Effects.", true);
        } finally {
            setBusy(false);
        }
    };

    const deleteProfile = async (profile: ProfileInfo) => {
        const ok = await confirmDialog(`Delete "${profile.name}"'s saved setup for the whole team? (Removes only the snapshot, their folder stays, and nobody's live setup changes.)`);
        if (!ok) return;
        try {
            const result = await evalTS("teamDeleteProfile", profile.name);
            if (result === undefined) throw new Error("no bridge");
            if (result.success) setProfiles(result.profiles || []);
            else showNote(result.error || "Something went wrong.", true);
        } catch (e) {
            showNote("No CEP bridge detected. Open this panel inside After Effects.", true);
        }
    };

    const updateAvailable = latestVersion !== "";
    const guestActive = guestProfile !== "";

    return (
        <Droplet
            panelClassName="team-droplet-panel"
            trigger={({ open, toggle }) => (
                <Tooltip
                    text={
                        guestActive
                            ? `Team, using ${guestProfile}'s setup (guest)`
                            : updateAvailable
                              ? `Team. Toolbox ${latestVersion} is available`
                              : "Team"
                    }
                >
                    {/* Re-list on OPEN (open is the state BEFORE toggle, so
                        !open means we're about to show it) -- guarantees the
                        member rows reflect the live folder every time the menu
                        is viewed, independent of the mount-time fetch that can
                        race the NAS mount. */}
                    <button className="favorites-toggle team-trigger" onClick={() => { if (!open) refresh(); toggle(); }}>
                        <Users size={14} />
                        {guestActive ? <span className="team-guest-dot" /> : updateAvailable && <span className="team-update-dot" />}
                    </button>
                </Tooltip>
            )}
        >
            {() => (
                <div className="team-droplet-body">
                    <p className="droplet-title">Team</p>

                    {updateAvailable && (
                        <div className="team-update-banner">
                            <RefreshCw size={12} />
                            Toolbox {formatVersion(latestVersion)} is available. This machine runs {formatVersion(TOOLBOX_VERSION)}. Ask for the new installer.
                        </div>
                    )}

                    {guestActive && (
                        <div className="team-guest-banner">
                            <span>
                                Using <strong>{guestProfile}</strong>'s setup{machineOwner ? ` on ${machineOwner}'s Mac` : ""}.
                            </span>
                            <button type="button" className="team-guest-restore" disabled={busy} onClick={restoreSetup}>
                                <Undo2 size={12} />
                                Restore {machineOwner ? `${machineOwner}'s` : "previous"} setup
                            </button>
                        </div>
                    )}

                    <div className="team-folder-row">
                        <span className="team-folder-path" title={folderPath || undefined}>
                            {folderPath ? (mounted ? folderPath : `${folderPath} (not reachable)`) : "Team folder not set"}
                        </span>
                        <button type="button" className="team-folder-btn" onClick={pickFolder}>
                            <FolderCog size={12} />
                            {folderPath ? "Change…" : "Set…"}
                        </button>
                    </div>

                    {folderPath !== "" && (
                        <>
                            <span className="team-section-label">Members</span>
                            {profiles.length === 0 ? (
                                <p className="hint">No members yet. Each member is a subfolder of the team folder (create them by hand, or just save your setup below and your folder is created for you).</p>
                            ) : (
                                <div className="team-profile-list">
                                    {profiles.map((p) => (
                                        <div
                                            key={p.name}
                                            className="team-profile-row"
                                            style={{ "--member-color": memberColor(p.name) } as React.CSSProperties}
                                        >
                                            <button
                                                type="button"
                                                className={p.hasProfile ? "team-profile-apply team-profile-apply--set" : "team-profile-apply team-profile-apply--empty"}
                                                disabled={busy || !p.hasProfile}
                                                title={p.hasProfile ? `Apply ${p.name}'s setup on this machine` : `${p.name} hasn't saved a setup yet`}
                                                onClick={() => applyProfile(p)}
                                            >
                                                <span className="team-profile-dot" />
                                                {p.name}
                                                {!p.hasProfile && <span className="team-profile-empty-tag">no setup yet</span>}
                                            </button>
                                            <button
                                                type="button"
                                                className={machineOwner === p.name ? "team-profile-home team-profile-home--owner" : "team-profile-home"}
                                                title={machineOwner === p.name ? `This is ${p.name}'s Mac. Click to untag` : `Tag this Mac as ${p.name}'s station`}
                                                onClick={() => setOwner(p.name)}
                                            >
                                                <Home size={12} />
                                            </button>
                                            {p.hasProfile && (
                                                <button type="button" className="team-profile-del" title="Delete saved setup" onClick={() => deleteProfile(p)}>
                                                    <Trash2 size={12} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {machineOwner !== "" && (
                                <div className="team-livesync-row">
                                    <CheckboxToggle
                                        checked={liveSync}
                                        onChange={toggleLiveSync}
                                        label={`Keep ${machineOwner}'s profile synced`}
                                    />
                                    <span className="team-livesync-hint">Saves this station's setup to the team folder on panel open, so it's always current elsewhere.</span>
                                </div>
                            )}

                            <div className="team-save-row">
                                <input
                                    type="text"
                                    placeholder="Save current setup as…"
                                    value={nameDraft}
                                    onChange={(e) => setNameDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") saveProfile();
                                    }}
                                />
                                <button type="button" className="team-save-btn" disabled={busy || !nameDraft.trim()} onClick={saveProfile} title="Save profile">
                                    <Save size={13} />
                                </button>
                            </div>
                        </>
                    )}

                    {syncNote && <p className="team-sync-note">{syncNote}</p>}
                    {note && <p className={note.isError ? "team-note team-note--error" : "team-note"}>{note.text}</p>}
                </div>
            )}
        </Droplet>
    );
};

export default TeamDroplet;
