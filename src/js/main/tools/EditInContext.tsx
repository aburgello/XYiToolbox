// =============================================================================
// src/js/main/tools/EditInContext.tsx
// -----------------------------------------------------------------------------
// Frontend for the "Edit In Context" tool.  Solves the tedium of editing a
// nested precomp while watching it in the parent: reverse-lookup which comps
// use the active precomp (or a selected precomp layer), open the chosen
// parent in a second viewer with its layers LOCKED so accidental edits can't
// land in it, and sync the playhead between the two.
//
// AE updates every open viewer live when you edit a nested comp, so the
// "watch your edit in context" part is free — this tool just removes the
// setup friction: finding the parent, opening it, locking it, losing your
// place.  The one thing it can't do is tile the two viewers side-by-side on
// screen (the Viewer API has no screen coordinates) — the artist drags the
// second viewer next to the first once; AE remembers the layout.
//
// Backend: editInContextFindParents / editInContextOpen / editInContextUnlock
// in tools.ts.  All read-only on files: openInViewer() only, no app.open(),
// no saves.  Locking is a reversible layer flag.
// =============================================================================
import React, { useEffect, useState } from "react";
import { Layers, Unlock, Lock } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";
import "./EditInContext.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

interface ParentEntry {
    compId: number;
    compName: string;
    layerName: string;
    layerIndex: number;
    scale: number[] | null;
    position: number[] | null;
}

const EditInContextTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);
    const [parents, setParents] = useState<ParentEntry[] | null>(null);
    const [activeName, setActiveName] = useState<string | null>(null);
    const [selectedParent, setSelectedParent] = useState<number | null>(null);
    const [lockedParentId, setLockedParentId] = useState<number | null>(null);

    const run = async (label: string, fn: () => Promise<any>) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: result.message || `${label} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const findParents = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const r = await evalTS("editInContextFindParents");
            if (r === undefined) throw new Error("no bridge");
            if (!r.success) { setStatus({ text: r.error || "Something went wrong.", type: "error" }); setParents(null); return; }
            setParents(r.parents || []);
            setActiveName(r.activeName || null);
            setSelectedParent(null);
            setStatus({ text: r.parents && r.parents.length > 0 ? `"${r.activeName}" is used by ${r.parents.length} comp(s).` : `"${r.activeName}" is not used by any other comp.`, type: r.parents && r.parents.length > 0 ? "success" : "error" });
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const openParent = async () => {
        if (selectedParent === null) return;
        // precompId 0 tells the backend to use the currently active comp as
        // the precomp — the normal flow, since you're inside it to begin with.
        await run("Open In Context", () => evalTS("editInContextOpen", selectedParent, 0));
        setLockedParentId(selectedParent);
    };

    const unlockParent = async () => {
        if (lockedParentId === null) return;
        await run("Unlock Parent", () => evalTS("editInContextUnlock", lockedParentId));
        setLockedParentId(null);
    };

    const fmtVec = (v: number[] | null): string => (v && v.length ? v.map((n) => Math.round(n * 100) / 100).join(", ") : "—");

    return (
        <div className="form-tool eic-tool">
            <h3>Edit In Context</h3>
            <p className="eic-hint">
                Work inside a precomp while watching it in its parent comp. AE updates the parent's viewer live as you edit
                the nested comp — this tool just gets both open, locks the parent so you can't edit it by accident, and
                syncs the playhead.
            </p>

            <div className="button-row">
                <button disabled={busy} onClick={findParents}>
                    <Layers size={14} /> Find Parent Comp(s)
                </button>
            </div>

            {parents && (
                <div className="eic-parents">
                    <div className="eic-caption">
                        {activeName ? (
                            <>Used by <strong>{parents.length}</strong> comp{parents.length !== 1 ? "s" : ""}:</>
                        ) : (
                            "No parent comps found."
                        )}
                    </div>
                    {parents.map((p) => (
                        <div
                            key={p.compId}
                            className={"eic-parent-row" + (selectedParent === p.compId ? " selected" : "")}
                            onClick={() => setSelectedParent(p.compId)}
                        >
                            <span className="eic-parent-name">{p.compName}</span>
                            <span className="eic-parent-meta">layer {p.layerIndex} · {p.layerName}</span>
                            <span className="eic-parent-meta">scale {fmtVec(p.scale)}</span>
                            <span className="eic-parent-meta">pos {fmtVec(p.position)}</span>
                        </div>
                    ))}
                </div>
            )}

            {parents && parents.length > 0 && (
                <div className="button-row">
                    <button disabled={busy || selectedParent === null} onClick={openParent}>
                        <Lock size={14} /> Open Parent + Lock Layers
                    </button>
                </div>
            )}

            {lockedParentId !== null && (
                <div className="button-row">
                    <button disabled={busy} onClick={unlockParent}>
                        <Unlock size={14} /> Unlock Parent Layers
                    </button>
                </div>
            )}

            <p className="eic-note">
                Tip: drag the second viewer next to the first once — AE remembers the layout. The parent's layers stay
                locked until you hit "Unlock Parent Layers", so edits only land inside the precomp.
            </p>

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default EditInContextTool;
