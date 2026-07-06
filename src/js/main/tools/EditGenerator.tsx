// =============================================================================
// src/js/main/tools/EditGenerator.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Edit Generator" tab (EdGen()/gate(),
// backed by XYi_EdGen.jsx). Auto-arranges selected layers into a cutdown of
// a given duration, with optional opacity fade and scale growth. Fixed a
// bug from the original where "Exclude First Image / Sequence" never
// actually did anything -- see editGeneratorArrange()'s comment in aeft.ts.
// =============================================================================
import React, { useState } from "react";
import { Clapperboard } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import CheckboxToggle from "../CheckboxToggle";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const EditGeneratorTool = () => {
    const [duration, setDuration] = useState("");
    const [useFade, setUseFade] = useState(false);
    const [fadeDuration, setFadeDuration] = useState("");
    const [useScale, setUseScale] = useState(false);
    const [scalePercent, setScalePercent] = useState("");
    const [excludeFirst, setExcludeFirst] = useState(false);
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("editGeneratorArrange", parseFloat(duration), useFade, parseFloat(fadeDuration), useScale, parseFloat(scalePercent), excludeFirst);
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: "Arrangement complete.", type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="field-row">
                <label htmlFor="eg-duration">Duration</label>
                <input id="eg-duration" type="text" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Enter duration of edit" />
            </div>

            <hr className="divider" />

            <div className="radio-row">
                <CheckboxToggle checked={useFade} onChange={setUseFade} label="Opacity" />
            </div>
            <div className="field-row">
                <label htmlFor="eg-fade">Fade Duration</label>
                <input id="eg-fade" type="text" value={fadeDuration} onChange={(e) => setFadeDuration(e.target.value)} placeholder="Enter fade duration" />
            </div>

            <div className="radio-row">
                <CheckboxToggle checked={useScale} onChange={setUseScale} label="Scale (Growth)" />
            </div>
            <div className="field-row">
                <label htmlFor="eg-scale">Scale %</label>
                <input id="eg-scale" type="text" value={scalePercent} onChange={(e) => setScalePercent(e.target.value)} placeholder="Enter scale %" />
            </div>

            <div className="radio-row">
                <CheckboxToggle checked={excludeFirst} onChange={setExcludeFirst} label="Exclude First Image / Sequence" />
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={run}>
                    <Clapperboard size={14} /> Generate Edit
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

export default EditGeneratorTool;
