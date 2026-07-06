// =============================================================================
// src/js/main/tools/GenerateCueSheet.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Generate Cue Sheet" tab (CueSheeter()/
// CueSheetGen(), backed by XYi_Cue.jsx). Writes a cue sheet .txt to the
// Desktop. Also removes duplicate layers from the active comp as a side
// effect -- the original's actual behavior, surfaced here explicitly.
// =============================================================================
import React, { useState } from "react";
import { FileText } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import CheckboxToggle from "../CheckboxToggle";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const GenerateCueSheetTool = () => {
    const [includeDuration, setIncludeDuration] = useState(true);
    const [includeFootageInOut, setIncludeFootageInOut] = useState(true);
    const [includeCompInOut, setIncludeCompInOut] = useState(true);
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("generateCueSheet", includeDuration, includeFootageInOut, includeCompInOut);
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: "Cue sheet written to " + result.filePath, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="radio-row" style={{ flexDirection: "column", gap: 8 }}>
                <CheckboxToggle checked={includeCompInOut} onChange={setIncludeCompInOut} label="In and Out point for COMP" />
                <CheckboxToggle checked={includeFootageInOut} onChange={setIncludeFootageInOut} label="In and Out point for FOOTAGE" />
                <CheckboxToggle checked={includeDuration} onChange={setIncludeDuration} label="Duration" />
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={run}>
                    <FileText size={14} /> Generate Cue Sheet
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

export default GenerateCueSheetTool;
