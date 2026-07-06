// =============================================================================
// src/js/main/tools/ExtremeTools02.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Extreme Tools 02" tab. Build CSV
// (XYi_BuildExtCsv.jsx, import-only, no master risk) builds a single new
// comp from a CSV of positioned/masked assets. Adjust CSV
// (XYi_AdjustExtCsv.jsx, already safety-patched copy-first) replaces named
// layers across a folder of .aep projects from a CSV mapping.
// =============================================================================
import React, { useState } from "react";
import { LayoutTemplate, Repeat } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const ExtremeTools02Tool = () => {
    const [page, setPage] = useState("");
    const [art, setArt] = useState("");
    const [tt, setTt] = useState("");
    const [duration, setDuration] = useState("15");
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

            <p className="hint">More Extreme Tools</p>
            <div className="field-grid">
                <div className="field-row">
                    <label htmlFor="et2-page">Page</label>
                    <input id="et2-page" type="text" value={page} onChange={(e) => setPage(e.target.value)} />
                </div>
                <div className="field-row">
                    <label htmlFor="et2-art">Art</label>
                    <input id="et2-art" type="text" value={art} onChange={(e) => setArt(e.target.value)} />
                </div>
                <div className="field-row">
                    <label htmlFor="et2-tt">TT</label>
                    <input id="et2-tt" type="text" value={tt} onChange={(e) => setTt(e.target.value)} />
                </div>
                <div className="field-row">
                    <label htmlFor="et2-dur">Duration</label>
                    <input id="et2-dur" type="text" value={duration} onChange={(e) => setDuration(e.target.value)} />
                </div>
            </div>
            <div className="button-row">
                <button disabled={busy} onClick={() => run("Adjust From CSV", () => evalTS("extAdjustCsvApplyToProjects"))}>
                    <Repeat size={14} /> Adjust From CSV
                </button>
            </div>

            <hr className="divider" />

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Build From CSV", () => evalTS("extBuildCompFromCsv", parseFloat(duration), page, art, tt))}>
                    <LayoutTemplate size={14} /> Build From CSV
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

export default ExtremeTools02Tool;
