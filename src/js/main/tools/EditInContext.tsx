// =============================================================================
// src/js/main/tools/EditInContext.tsx
// -----------------------------------------------------------------------------
// Frontend for the "Edit In Context" tool.  Two things:
//
// 1. OPEN BOTH: find which comps use the active precomp (or a selected
//    precomp layer), open the chosen parent in a second viewer, sync the
//    playhead.  AE updates the parent's viewer LIVE as you edit the nested
//    comp, so watching your edit in context is free once both are open.
//    (The Viewer API can't position the two windows side-by-side — the
//    artist drags them together once; AE remembers the layout.)
//
// 2. EDIT IN PARENT SPACE: select a layer inside the precomp, read its
//    scale/position converted to what they LOOK LIKE in the parent comp,
//    edit those numbers, and write back correctly — no mental math about
//    the precomp's own scale/position.
//
// Backend: editInContextFindParents / editInContextOpen /
// editInContextReadLayer / editInContextApplyLayer in tools.ts.  Read-only
// on files: openInViewer() only, no app.open(), no saves.
// =============================================================================
import React, { useState } from "react";
import { Layers, Eye } from "lucide-react";
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

interface LayerRead {
    layerName?: string;
    parentScale?: number[];
    parentPosition?: number[];
    localScale?: number[];
    localPosition?: number[];
}

const fmt = (v: number[] | null | undefined): string => (v && v.length ? v.map((n) => Math.round(n * 100) / 100).join(", ") : "—");

const EditInContextTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);
    const [parents, setParents] = useState<ParentEntry[] | null>(null);
    const [activeName, setActiveName] = useState<string | null>(null);
    const [selectedParent, setSelectedParent] = useState<number | null>(null);
    const [layerRead, setLayerRead] = useState<LayerRead | null>(null);
    // Editable parent-space fields (as text so the user types freely).
    const [scaleX, setScaleX] = useState("");
    const [scaleY, setScaleY] = useState("");
    const [posX, setPosX] = useState("");
    const [posY, setPosY] = useState("");

    const run = async (label: string, fn: () => Promise<any>, onSuccess?: (r: any) => void) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                setStatus({ text: result.error || `${label} failed.`, type: "error" });
                return;
            }
            onSuccess?.(result);
            setStatus({ text: result.message || `${label} complete.`, type: "success" });
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const findParents = () =>
        run("Find Parent Comps", () => evalTS("editInContextFindParents"), (r) => {
            setParents(r.parents || []);
            setActiveName(r.activeName || null);
            setSelectedParent(null);
            setLayerRead(null);
        });

    const openParent = () => {
        if (selectedParent === null) return;
        run("Open Parent", () => evalTS("editInContextOpen", selectedParent, 0));
    };

    const readLayer = () => {
        if (selectedParent === null) return;
        run("Read Layer", () => evalTS("editInContextReadLayer", selectedParent), (r) => {
            setLayerRead({
                layerName: r.layerName,
                parentScale: r.parentScale,
                parentPosition: r.parentPosition,
                localScale: r.localScale,
                localPosition: r.localPosition,
            });
            // Pre-fill the editable fields with the parent-space values.
            setScaleX(r.parentScale && r.parentScale.length > 0 ? String(Math.round(r.parentScale[0] * 100) / 100) : "");
            setScaleY(r.parentScale && r.parentScale.length > 1 ? String(Math.round(r.parentScale[1] * 100) / 100) : "");
            setPosX(r.parentPosition && r.parentPosition.length > 0 ? String(Math.round(r.parentPosition[0] * 100) / 100) : "");
            setPosY(r.parentPosition && r.parentPosition.length > 1 ? String(Math.round(r.parentPosition[1] * 100) / 100) : "");
        });
    };

    const applyLayer = () => {
        if (selectedParent === null) return;
        const sX = parseFloat(scaleX);
        const sY = parseFloat(scaleY);
        const pX = parseFloat(posX);
        const pY = parseFloat(posY);
        if (isNaN(sX) || isNaN(sY) || isNaN(pX) || isNaN(pY)) {
            setStatus({ text: "Fill in Scale (X, Y) and Position (X, Y) first.", type: "error" });
            return;
        }
        run("Apply", () => evalTS("editInContextApplyLayer", selectedParent, [sX, sY], [pX, pY]));
    };

    return (
        <div className="form-tool eic-tool">
            <h3>Edit In Context</h3>
            <p className="eic-hint">
                Work inside a precomp while watching it in its parent — and edit a layer's scale/position using the
                numbers <strong>as they appear in the parent comp</strong>, no mental math about the precomp's own transform.
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
                            <span className="eic-parent-meta">scale {fmt(p.scale)} · pos {fmt(p.position)}</span>
                        </div>
                    ))}
                </div>
            )}

            {parents && parents.length > 0 && (
                <div className="button-row">
                    <button disabled={busy || selectedParent === null} onClick={openParent}>
                        <Eye size={14} /> Open Parent Alongside (live update)
                    </button>
                </div>
            )}

            <hr className="divider" />

            <h3>Edit Selected Layer in Parent Space</h3>
            <p className="eic-hint">
                Select exactly one layer inside the precomp, pick a parent above, then Read. Its scale/position are shown
                as they appear in the parent — edit those numbers and Apply.
            </p>

            <div className="button-row">
                <button disabled={busy || selectedParent === null} onClick={readLayer}>
                    <Layers size={14} /> Read Selected Layer
                </button>
            </div>

            {layerRead && (
                <div className="eic-layer">
                    <div className="eic-layer-head">
                        Editing <strong>{layerRead.layerName}</strong>
                    </div>
                    <div className="eic-layer-meta">
                        <span>In parent: scale {fmt(layerRead.parentScale)} · pos {fmt(layerRead.parentPosition)}</span>
                        <span>Raw in precomp: scale {fmt(layerRead.localScale)} · pos {fmt(layerRead.localPosition)}</span>
                    </div>

                    <div className="eic-field-row">
                        <label>Scale % (X, Y) — in parent</label>
                        <div className="eic-two">
                            <input type="text" value={scaleX} onChange={(e) => setScaleX(e.target.value)} placeholder="X" />
                            <input type="text" value={scaleY} onChange={(e) => setScaleY(e.target.value)} placeholder="Y" />
                        </div>
                    </div>
                    <div className="eic-field-row">
                        <label>Position px (X, Y) — in parent</label>
                        <div className="eic-two">
                            <input type="text" value={posX} onChange={(e) => setPosX(e.target.value)} placeholder="X" />
                            <input type="text" value={posY} onChange={(e) => setPosY(e.target.value)} placeholder="Y" />
                        </div>
                    </div>

                    <div className="button-row">
                        <button disabled={busy} onClick={applyLayer}>
                            <Layers size={14} /> Apply to Layer
                        </button>
                    </div>
                </div>
            )}

            <p className="eic-note">
                Tip: open the parent alongside first (button above) — AE updates its viewer live as you edit, so you see
                each Apply land in context. The transform conversion uses AE's own toComp/fromComp, so rotation on the
                precomp layer is accounted for; 3D layers are best-effort.
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
