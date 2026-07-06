// =============================================================================
// src/js/main/tools/Check.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Check" tab -- a QC grab-bag: aspect-ratio
// rename, effects-used report, comp/footage detail report, filename-
// convention check, marker guide export, and a render timecode checker.
// =============================================================================
import React, { useState } from "react";
import { RatioIcon, ListChecks, FileSearch, FileSignature, Tags, Clapperboard } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const CheckTool = () => {
    const [marker7, setMarker7] = useState("0:00:00:00");
    const [marker8, setMarker8] = useState("0:00:00:00");
    const [marker9, setMarker9] = useState("0:00:00:00");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, fn: () => Promise<any>) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: result.message || `${label} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Aspect Ratio Rename", () => evalTS("checkAspectRatioRename"))}>
                    <RatioIcon size={14} /> Aspect Ratio Rename
                </button>
                <button disabled={busy} onClick={() => run("Effects Used", () => evalTS("checkEffectsUsed"))}>
                    <ListChecks size={14} /> Effects Used
                </button>
                <button disabled={busy} onClick={() => run("Comp / Footage Details", () => evalTS("checkCompFootageDetails"))}>
                    <FileSearch size={14} /> Comp / Footage Details
                </button>
                <button disabled={busy} onClick={() => run("File Name Check", () => evalTS("checkFileNameCheck"))}>
                    <FileSignature size={14} /> File Name Check
                </button>
                <button disabled={busy} onClick={() => run("Marker Comment Guide", () => evalTS("checkMarkerGuide"))}>
                    <Tags size={14} /> Marker Comment Guide
                </button>
            </div>

            <hr className="divider" />

            <p className="hint">Enter Timecode Below</p>
            <div className="field-row">
                <label htmlFor="chk-m7">Marker 07</label>
                <input id="chk-m7" type="text" value={marker7} onChange={(e) => setMarker7(e.target.value)} />
            </div>
            <div className="field-row">
                <label htmlFor="chk-m8">Marker 08</label>
                <input id="chk-m8" type="text" value={marker8} onChange={(e) => setMarker8(e.target.value)} />
            </div>
            <div className="field-row">
                <label htmlFor="chk-m9">Marker 09</label>
                <input id="chk-m9" type="text" value={marker9} onChange={(e) => setMarker9(e.target.value)} />
            </div>
            <div className="button-row">
                <button disabled={busy} onClick={() => run("Render Check", () => evalTS("checkRenderCheck", marker7, marker8, marker9))}>
                    <Clapperboard size={14} /> Render Check
                </button>
            </div>

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span style={{ whiteSpace: "pre-wrap" }}>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default CheckTool;
