// =============================================================================
// src/js/main/tools/ExtremeTools01.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Extreme Tools 01" tab -- landscape
// (XYi_ExtremeTools.jsx) and portrait (XYi_ExtremeTools_Port.jsx) surround-
// video-wall comp generators. Builds a "Main Comp" with however many video
// panels (at an auto-computed aspect ratio) fit between fixed surround/mid
// panels -- all brand-new comps/solids, no file access.
// =============================================================================
import React, { useState } from "react";
import { Rows3, Columns3 } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

interface Fields {
    left: string;
    mid: string;
    right: string;
    width: string;
    height: string;
    minAr: string;
    maxAr: string;
}

const LANDSCAPE_DEFAULTS: Fields = { left: "2.37", mid: "2.37", right: "2.37", width: "6000", height: "384", minAr: "3.2", maxAr: "2.5" };
const PORTRAIT_DEFAULTS: Fields = { left: "0.4", mid: "0.4", right: "0.4", width: "384", height: "6000", minAr: "0.3125", maxAr: "0.4" };

const ExtremeTools01Tool = () => {
    const [landscape, setLandscape] = useState<Fields>(LANDSCAPE_DEFAULTS);
    const [portrait, setPortrait] = useState<Fields>(PORTRAIT_DEFAULTS);
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, fnName: string, f: Fields) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS(fnName as any, parseFloat(f.left), parseFloat(f.mid), parseFloat(f.right), parseFloat(f.width), parseFloat(f.height), parseFloat(f.minAr), parseFloat(f.maxAr));
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: result.message || `${label} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const fieldGrid = (f: Fields, setF: (f: Fields) => void, prefix: string) => (
        <div className="field-grid">
            <div className="field-row">
                <label htmlFor={`${prefix}-left`}>Left/Top Surround Aspect Ratio</label>
                <input id={`${prefix}-left`} type="text" value={f.left} onChange={(e) => setF({ ...f, left: e.target.value })} />
            </div>
            <div className="field-row">
                <label htmlFor={`${prefix}-mid`}>Mid Aspect Ratio</label>
                <input id={`${prefix}-mid`} type="text" value={f.mid} onChange={(e) => setF({ ...f, mid: e.target.value })} />
            </div>
            <div className="field-row">
                <label htmlFor={`${prefix}-right`}>Right/Bottom Surround Aspect Ratio</label>
                <input id={`${prefix}-right`} type="text" value={f.right} onChange={(e) => setF({ ...f, right: e.target.value })} />
            </div>
            <div className="field-row">
                <label htmlFor={`${prefix}-w`}>Total Width</label>
                <input id={`${prefix}-w`} type="text" value={f.width} onChange={(e) => setF({ ...f, width: e.target.value })} />
            </div>
            <div className="field-row">
                <label htmlFor={`${prefix}-h`}>Total Height</label>
                <input id={`${prefix}-h`} type="text" value={f.height} onChange={(e) => setF({ ...f, height: e.target.value })} />
            </div>
            <div className="field-row">
                <label htmlFor={`${prefix}-minar`}>Min Video Aspect Ratio</label>
                <input id={`${prefix}-minar`} type="text" value={f.minAr} onChange={(e) => setF({ ...f, minAr: e.target.value })} />
            </div>
            <div className="field-row">
                <label htmlFor={`${prefix}-maxar`}>Max Video Aspect Ratio</label>
                <input id={`${prefix}-maxar`} type="text" value={f.maxAr} onChange={(e) => setF({ ...f, maxAr: e.target.value })} />
            </div>
        </div>
    );

    return (
        <div className="form-tool">

            <h3>Landscape Extreme Generate</h3>
            {fieldGrid(landscape, setLandscape, "et-l")}
            <div className="button-row">
                <button disabled={busy} onClick={() => run("Landscape Generate", "extremeToolsLandscape", landscape)}>
                    <Rows3 size={14} /> Generate
                </button>
            </div>

            <hr className="divider" />

            <h3>Portrait Extreme Generate</h3>
            {fieldGrid(portrait, setPortrait, "et-p")}
            <div className="button-row">
                <button disabled={busy} onClick={() => run("Portrait Generate", "extremeToolsPortrait", portrait)}>
                    <Columns3 size={14} /> Generate
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

export default ExtremeTools01Tool;
