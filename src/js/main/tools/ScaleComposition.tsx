// =============================================================================
// src/js/main/tools/ScaleComposition.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Scale Composition" tab, backed by
// XYi_Scaler.jsx's onScaleClick() -- the same null-parent scale-to-fit
// technique already used by DRQR (scaleCompToFit() in aeft.ts), reused here
// rather than reimplemented. Guide Scale (ruler-guide-driven layer sizing,
// XYi_Guide_Scaler.jsx) is NOT ported -- a separate, more involved feature;
// see CLAUDE.md.
// =============================================================================
import React, { useState } from "react";
import { Maximize2, MoveHorizontal, MoveVertical, Percent, Copy, ScanSearch, Tag, RotateCcw } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const ScaleCompositionTool = () => {
    const [width, setWidth] = useState("");
    const [height, setHeight] = useState("");
    const [factor, setFactor] = useState("1.0");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, fn: () => Promise<any>, onResult?: (r: any) => void) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            if (result.success && onResult) onResult(result);
            setStatus(result.success ? { text: `${label} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="field-with-button">
                <div className="field-row">
                    <label htmlFor="sc-width">Width</label>
                    <input id="sc-width" type="text" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="Edit Width" />
                </div>
                <Tooltip text="Scale by Width">
                    <button className="icon-btn" disabled={busy} onClick={() => run("Scale by Width", () => evalTS("scaleCompositionByWidth", parseFloat(width)))}>
                        <MoveHorizontal size={14} />
                    </button>
                </Tooltip>
            </div>

            <div className="field-with-button">
                <div className="field-row">
                    <label htmlFor="sc-height">Height</label>
                    <input id="sc-height" type="text" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="Edit Height" />
                </div>
                <Tooltip text="Scale by Height">
                    <button className="icon-btn" disabled={busy} onClick={() => run("Scale by Height", () => evalTS("scaleCompositionByHeight", parseFloat(height)))}>
                        <MoveVertical size={14} />
                    </button>
                </Tooltip>
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Scale Composition", () => evalTS("scaleCompositionExplicit", parseFloat(width), parseFloat(height)))}>
                    <Maximize2 size={14} /> Scale Composition (Width + Height)
                </button>
            </div>

            <hr className="divider" />

            <div className="field-with-button">
                <div className="field-row">
                    <label htmlFor="sc-factor">Scale By Factor</label>
                    <input id="sc-factor" type="text" value={factor} onChange={(e) => setFactor(e.target.value)} />
                </div>
                <Tooltip text="Scale by Factor">
                    <button className="icon-btn" disabled={busy} onClick={() => run("Scale by Factor", () => evalTS("scaleCompositionByFactor", parseFloat(factor)))}>
                        <Percent size={14} />
                    </button>
                </Tooltip>
            </div>

            <hr className="divider" />

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Multi Comp Scale", () => evalTS("scaleCompositionMulti"))}>
                    <Copy size={14} /> Multi Comp Scale
                </button>
            </div>

            <hr className="divider" />

            <div className="button-row">
                <button
                    disabled={busy}
                    onClick={() =>
                        run("Scale Detect", () => evalTS("scaleCompositionDetect"), (r) => {
                            setWidth(String(r.width));
                            setHeight(String(r.height));
                        })
                    }
                >
                    <ScanSearch size={14} /> Scale Detect
                </button>
                <button disabled={busy} onClick={() => run("Scale by Name", () => evalTS("scaleCompositionByName"))}>
                    <Tag size={14} /> Scale by Name
                </button>
                <button
                    disabled={busy}
                    onClick={() => {
                        setWidth("");
                        setHeight("");
                        setFactor("1.0");
                        setStatus(null);
                    }}
                >
                    <RotateCcw size={14} /> Scale Reset
                </button>
            </div>

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default ScaleCompositionTool;
