// =============================================================================
// src/js/main/tools/MyTools.tsx
// -----------------------------------------------------------------------------
// Browse/run/delete every tool saved from Script Playground's "Save as
// Tool..." form -- both kinds ("button" ones ALSO live as a real tile in
// the Toolset grid's "Custom Tools" group; "page" ones live only here).
// This page IS the "submenu in tools" a saved script gets -- there's no
// separate per-script navigation entry, which would need each script to
// carry its own lazy-loaded component the way real registered tools do.
// Reuses ScriptPlayground's .sp-tool-list styling (formTool.scss) since
// this is functionally the same list, just standalone instead of tucked
// under an editor.
//
// Also the home for SHARING custom tools with colleagues. This used to be a
// file export/import (tick tools -> write a .json -> a colleague imports it);
// it's now the SAME "Share to team" flow the effect combos and Expressions
// Bank use -- one click per tool pushes it into the team folder's
// shared-tools.json (aeft/team.ts's teamShareCustomTool), from which every
// colleague's panel pulls automatically on open (teamSyncShared, merge by
// name, fresh local ids). Needs a Team Folder set in the home-screen Team
// menu; without one the Share button reports so, same as the combo/expression
// share buttons.
// =============================================================================
import React from "react";
import { Play, Terminal, X, Pencil, Users } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { confirmDialog } from "../Dialog";
import { useCustomTools, type CustomToolEntry } from "../hooks/useCustomTools";
import StatusIcon from "../StatusIcon";
import type { ToolProps } from "../toolRegistry";
import "../shared.scss";
import "./formTool.scss";

const MyTools: React.FC<ToolProps> = ({ onSelectTool }) => {
    const { customTools, loaded, persist } = useCustomTools();
    const [status, setStatus] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
    const [sharingId, setSharingId] = React.useState<string | null>(null);

    const run = async (t: CustomToolEntry) => {
        setStatus(null);
        try {
            const result = await evalTS("runScript", t.code);
            if (result === undefined) throw new Error("no bridge");
            setStatus({
                type: result.success ? "success" : "error",
                text: result.success ? `"${t.name}" ran: ${result.message || "(no output)"}` : `"${t.name}" failed: ${result.error || "Unknown error."}`,
            });
        } catch {
            setStatus({ type: "error", text: "No CEP bridge detected — open this panel inside After Effects to run tools." });
        }
    };

    const remove = async (t: CustomToolEntry) => {
        if (!(await confirmDialog(`Delete "${t.name}"? This can't be undone.`))) return;
        await persist(customTools.filter((x) => x.id !== t.id));
    };

    // One-click "share to team" -- pushes a single tool into the team folder's
    // shared-tools.json (aeft/team.ts), from which every colleague's panel
    // pulls automatically on open (teamSyncShared). Passes the full entry as a
    // JSON payload (id stripped backend-side), same shape as the Expressions
    // Bank / combo share flows.
    const shareTool = async (t: CustomToolEntry) => {
        setStatus(null);
        setSharingId(t.id);
        try {
            const payload = JSON.stringify({ name: t.name, description: t.description, code: t.code, kind: t.kind });
            const result = await evalTS("teamShareCustomTool", payload);
            if (result === undefined) throw new Error("no bridge");
            setStatus({
                type: result.success ? "success" : "error",
                text: result.success ? result.message || "Shared with the team." : result.error || "Something went wrong.",
            });
        } catch {
            setStatus({ type: "error", text: "No CEP bridge detected — open this panel inside After Effects to share." });
        } finally {
            setSharingId(null);
        }
    };

    return (
        <div className="form-tool sp">
            <p className="hint">
                Every script you've saved as a tool. Toolset-button ones also run from the home screen's
                "Custom Tools" group. Use <strong>Share to team</strong> on a tool to add it to the shared
                team library — a colleague's panel picks it up automatically on open. (Set a Team Folder from
                the home-screen Team menu first.)
            </p>

            {status && (
                <div className={`loc-status loc-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}

            {customTools.length === 0 ? (
                <p className="hint">{loaded ? "No saved tools yet -- save one from Script Playground." : "Loading…"}</p>
            ) : (
                <div className="sp-tool-list">
                    {customTools.map((t) => (
                        <div key={t.id} className="sp-tool-row">
                            <span className="sp-tool-icon"><Terminal size={13} /></span>
                            <div className="sp-tool-info">
                                <span className="sp-tool-name">{t.name}</span>
                                {t.description && <span className="sp-tool-desc">{t.description}</span>}
                            </div>
                            <span className={"sp-tool-kind sp-tool-kind-" + t.kind}>
                                {t.kind === "button" ? "Toolset button" : "My Tools"}
                            </span>
                            <button className="sp-tool-icon-btn" title="Run" onClick={() => run(t)}>
                                <Play size={12} />
                            </button>
                            <button
                                className="sp-tool-icon-btn"
                                title="Share to team library"
                                onClick={() => shareTool(t)}
                                disabled={sharingId === t.id}
                            >
                                <Users size={12} />
                            </button>
                            <button
                                className="sp-tool-icon-btn"
                                title="Edit in Script Playground"
                                onClick={() => onSelectTool?.("script-playground")}
                            >
                                <Pencil size={12} />
                            </button>
                            <button className="sp-tool-icon-btn" title="Delete" onClick={() => remove(t)}>
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MyTools;
