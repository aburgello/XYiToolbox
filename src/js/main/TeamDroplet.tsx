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
import { Users, FolderCog, Trash2, Save, RefreshCw } from "lucide-react";
import Droplet from "./Droplet";
import Tooltip from "./Tooltip";
import { confirmDialog } from "./Dialog";
import { evalTS } from "../lib/utils/bolt";
import "./TeamDroplet.scss";

// Keep in step with HomeScreen.tsx's "Toolbox {version}" hover text -- this
// is the value compared against the team folder's toolbox-version.txt.
export const TOOLBOX_VERSION = "2026.07";

interface ProfileInfo {
    name: string;
    fileName: string;
}

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

    const refresh = async () => {
        try {
            const folder = await evalTS("teamGetFolder");
            if (folder && folder.success) {
                setFolderPath(folder.path || "");
                setMounted(!!folder.mounted);
            }
            const list = await evalTS("teamListProfiles");
            if (list && list.success) setProfiles(list.profiles || []);
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
                if (sync && sync.success && ((sync.newCombos || 0) > 0 || (sync.newExpressions || 0) > 0)) {
                    const parts: string[] = [];
                    if (sync.newCombos) parts.push(`${sync.newCombos} new team combo${sync.newCombos === 1 ? "" : "s"}`);
                    if (sync.newExpressions) parts.push(`${sync.newExpressions} new expression${sync.newExpressions === 1 ? "" : "s"}`);
                    cachedSyncNote = `Synced from team: ${parts.join(" · ")}.`;
                    setSyncNote(cachedSyncNote);
                }
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
            showNote("No CEP bridge detected — open this panel inside After Effects.", true);
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
            showNote(`Saved "${name}" — pick it from any machine's Team menu to apply this setup there.`, false);
        } catch (e) {
            showNote("No CEP bridge detected — open this panel inside After Effects.", true);
        } finally {
            setBusy(false);
        }
    };

    const applyProfile = async (profile: ProfileInfo) => {
        const ok = await confirmDialog(
            `Apply "${profile.name}"'s setup? This replaces this machine's panel personalisation (Toolset layout, favorites, theme, pinned effects…) and reloads the panel. Save the current setup as a profile first if it isn't already.`
        );
        if (!ok) return;
        setBusy(true);
        try {
            const result = await evalTS("teamApplyProfile", profile.fileName);
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showNote(result.error || "Something went wrong.", true);
                return;
            }
            // Full reload -- every screen/hook re-reads its settings fresh, the
            // same way a panel reopen would. GsapScreenTransition's sessionStorage
            // dedupe keeps the reload from replaying the entrance cascade.
            window.location.reload();
        } catch (e) {
            showNote("No CEP bridge detected — open this panel inside After Effects.", true);
        } finally {
            setBusy(false);
        }
    };

    const deleteProfile = async (profile: ProfileInfo) => {
        const ok = await confirmDialog(`Delete the profile "${profile.name}" for the whole team? (It only removes the saved snapshot, nobody's live setup changes.)`);
        if (!ok) return;
        try {
            const result = await evalTS("teamDeleteProfile", profile.fileName);
            if (result === undefined) throw new Error("no bridge");
            if (result.success) setProfiles(result.profiles || []);
            else showNote(result.error || "Something went wrong.", true);
        } catch (e) {
            showNote("No CEP bridge detected — open this panel inside After Effects.", true);
        }
    };

    const updateAvailable = latestVersion !== "";

    return (
        <Droplet
            panelClassName="team-droplet-panel"
            trigger={({ toggle }) => (
                <Tooltip text={updateAvailable ? `Team — Toolbox ${latestVersion} is available` : "Team"}>
                    <button className="favorites-toggle team-trigger" onClick={toggle}>
                        <Users size={14} />
                        {updateAvailable && <span className="team-update-dot" />}
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
                            Toolbox {latestVersion} is available — this machine runs {TOOLBOX_VERSION}. Ask for the new installer.
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
                            <span className="team-section-label">Profiles</span>
                            {profiles.length === 0 ? (
                                <p className="hint">No profiles yet — save yours below, and it becomes available on every machine that shares this team folder.</p>
                            ) : (
                                <div className="team-profile-list">
                                    {profiles.map((p) => (
                                        <div key={p.fileName} className="team-profile-row">
                                            <button type="button" className="team-profile-apply" disabled={busy} onClick={() => applyProfile(p)}>
                                                {p.name}
                                            </button>
                                            <button type="button" className="team-profile-del" title="Delete profile" onClick={() => deleteProfile(p)}>
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    ))}
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
