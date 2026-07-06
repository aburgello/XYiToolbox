// =============================================================================
// src/js/main/tools/WallTools.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Wall Tools" tab. Generate Wall / Generate
// Wall Aspect Ratio (XYi_WallGen.jsx), Focal Organiser (XYi_DistCalc.jsx),
// and Wall Queue (XYI_Wall_Queue.jsx) are all real -- see wallQueueUpdate()'s
// comment in aeft.ts for the conveyor-advance behaviour and the one latent
// multi-select bug that was hardened in the port.
// =============================================================================
import React, { useState } from "react";
import { Grid3x3, Target, ListVideo } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const WallToolsTool = () => {
    const [numX, setNumX] = useState("");
    const [numY, setNumY] = useState("");
    const [gridWidth, setGridWidth] = useState("1920");
    const [gridHeight, setGridHeight] = useState("1080");
    const [aspectRatio, setAspectRatio] = useState("0.56");
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

            <div className="field-grid">
                <div className="field-row">
                    <label htmlFor="wt-numx">Number in the width</label>
                    <input id="wt-numx" type="text" value={numX} onChange={(e) => setNumX(e.target.value)} placeholder="x" />
                </div>
                <div className="field-row">
                    <label htmlFor="wt-numy">Number in the height</label>
                    <input id="wt-numy" type="text" value={numY} onChange={(e) => setNumY(e.target.value)} placeholder="y" />
                </div>
                <div className="field-row">
                    <label htmlFor="wt-gw">Comp Width</label>
                    <input id="wt-gw" type="text" value={gridWidth} onChange={(e) => setGridWidth(e.target.value)} />
                </div>
                <div className="field-row">
                    <label htmlFor="wt-gh">Comp Height</label>
                    <input id="wt-gh" type="text" value={gridHeight} onChange={(e) => setGridHeight(e.target.value)} />
                </div>
            </div>

            <div className="button-row">
                <button
                    disabled={busy}
                    onClick={() =>
                        run("Generate Wall", () => evalTS("wallGenerate", parseFloat(gridWidth), parseFloat(gridHeight), parseFloat(numX), parseFloat(numY)), (r) =>
                            setAspectRatio(String(r.computedAspectRatio))
                        )
                    }
                >
                    <Grid3x3 size={14} /> Generate Wall
                </button>
            </div>

            <hr className="divider" />

            <div className="field-row">
                <label htmlFor="wt-ar">Aspect Ratio</label>
                <input id="wt-ar" type="text" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} />
            </div>
            <div className="button-row">
                <button
                    disabled={busy}
                    onClick={() =>
                        run("Generate Wall Aspect Ratio", () => evalTS("wallGenerateAspect", parseFloat(gridWidth), parseFloat(gridHeight), parseFloat(numY), parseFloat(aspectRatio)), (r) =>
                            setNumX(String(r.computedWidth))
                        )
                    }
                >
                    <Grid3x3 size={14} /> Generate Wall Aspect Ratio
                </button>
            </div>

            <hr className="divider" />

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Focal Organiser", () => evalTS("focalOrganiser"))}>
                    <Target size={14} /> Focal Organiser
                </button>
                <button disabled={busy} onClick={() => run("Wall Queue", () => evalTS("wallQueueUpdate"))}>
                    <ListVideo size={14} /> Wall Queue
                </button>
            </div>
            <p className="hint">
                Wall Queue advances a video-wall comp like a conveyor: each panel takes the previous one's content, and each selected layer is
                fed into the front panel in turn.
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

export default WallToolsTool;
