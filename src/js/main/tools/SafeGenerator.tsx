// =============================================================================
// src/js/main/tools/SafeGenerator.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Safe Generator" tab, backed by
// XYi_SafeGen.jsx. Draws two red solids into the active comp: a full-frame
// "ViewSafe" solid used as an alpha-inverted track matte, and a "SafeZone"
// solid sized to the safe area -- the matte makes only the OUTSIDE of the
// safe area show at 50% opacity, a standard broadcast-safe visualization.
// =============================================================================
import React, { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const SafeGeneratorTool = () => {
    const [marginWidth, setMarginWidth] = useState("");
    const [marginHeight, setMarginHeight] = useState("");
    const [totalWidth, setTotalWidth] = useState("");
    const [totalHeight, setTotalHeight] = useState("");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, fn: () => Promise<any>) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: `${label} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <h3>From Composition Edge</h3>
            <div className="field-row">
                <label htmlFor="sg-mw">Width (margin, each side)</label>
                <input id="sg-mw" type="text" value={marginWidth} onChange={(e) => setMarginWidth(e.target.value)} />
            </div>
            <div className="field-row">
                <label htmlFor="sg-mh">Height (margin, each side)</label>
                <input id="sg-mh" type="text" value={marginHeight} onChange={(e) => setMarginHeight(e.target.value)} />
            </div>
            <div className="button-row">
                <button disabled={busy} onClick={() => run("Generate Safe", () => evalTS("safeGenerate", parseFloat(marginWidth), parseFloat(marginHeight)))}>
                    <ShieldCheck size={14} /> Generate Safe
                </button>
            </div>

            <hr className="divider" />

            <h3>As Total Size of Safe Area Required</h3>
            <div className="field-row">
                <label htmlFor="sg-tw">Width</label>
                <input id="sg-tw" type="text" value={totalWidth} onChange={(e) => setTotalWidth(e.target.value)} />
            </div>
            <div className="field-row">
                <label htmlFor="sg-th">Height</label>
                <input id="sg-th" type="text" value={totalHeight} onChange={(e) => setTotalHeight(e.target.value)} />
            </div>
            <div className="button-row">
                <button disabled={busy} onClick={() => run("Generate Full Safe", () => evalTS("safeGenerateFull", parseFloat(totalWidth), parseFloat(totalHeight)))}>
                    <ShieldCheck size={14} /> Generate Full Safe
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

export default SafeGeneratorTool;
