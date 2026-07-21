// =============================================================================
// src/js/main/tools/WallTools.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Wall Tools" tab. Generate Wall / Generate
// Wall Aspect Ratio (XYi_WallGen.jsx), Focal Organiser (XYi_DistCalc.jsx),
// and Wall Queue (XYI_Wall_Queue.jsx) are all real -- see wallQueueUpdate()'s
// comment in aeft.ts for the conveyor-advance behaviour and the one latent
// multi-select bug that was hardened in the port.
//
// LIVE PREVIEW (WallPreview below): a mini grid generated from the actual
// field values -- the frame's aspect follows Comp Width/Height and the cells
// follow the panel counts, so "did I mean 3x4 or 4x3" is answered before the
// comp exists. The per-panel size/AR caption mirrors wallGenerate()'s own
// math exactly ((gridWidth/numX)/(gridHeight/numY) -- the same value it
// returns as computedAspectRatio), and the aspect-ratio section's "N panels
// across" hint mirrors wallGenerateAspect()'s Math.round formula 1:1 -- keep
// both in sync with tools.ts if the backend ever changes.
// =============================================================================
import React, { useState } from "react";
import { Grid3x3, Target, ListVideo } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";
import "./WallTools.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

// Guard against a typo'd "100" panels exploding the DOM -- above this the
// preview shows a caption-only fallback instead of a thousand cells.
const MAX_PREVIEW_CELLS_PER_AXIS = 30;

const WallPreview: React.FC<{ w: number; h: number; nx: number; ny: number }> = ({ w, h, nx, ny }) => {
    const haveCounts = nx >= 1 && ny >= 1 && isFinite(nx) && isFinite(ny);
    const tooMany = haveCounts && (nx > MAX_PREVIEW_CELLS_PER_AXIS || ny > MAX_PREVIEW_CELLS_PER_AXIS);

    const aspect = w > 0 && h > 0 ? w / h : 16 / 9;
    let pw = 170;
    let ph = pw / aspect;
    if (ph > 110) { ph = 110; pw = ph * aspect; }
    if (ph < 30) { ph = 30; }

    const panelW = haveCounts ? w / nx : 0;
    const panelH = haveCounts ? h / ny : 0;
    // Same expression wallGenerate() returns as computedAspectRatio.
    const panelAR = haveCounts && panelH > 0 ? panelW / panelH : 0;

    const cells: React.ReactNode[] = [];
    if (haveCounts && !tooMany) {
        for (let row = 0; row < ny; row++) {
            for (let col = 0; col < nx; col++) {
                cells.push(
                    <span
                        key={row + "-" + col}
                        className="wt-preview-cell"
                        style={{ animationDelay: ((row + col) * 0.03).toFixed(2) + "s" }}
                    />
                );
            }
        }
    }

    return (
        <div className="wt-preview-wrap">
            {haveCounts && !tooMany ? (
                <span
                    // Any value change remounts the grid, replaying the one-shot cascade
                    key={nx + "x" + ny + "@" + w + "x" + h}
                    className="wt-preview"
                    style={{
                        width: Math.round(pw),
                        height: Math.round(ph),
                        gridTemplateColumns: "repeat(" + nx + ", 1fr)",
                        gridTemplateRows: "repeat(" + ny + ", 1fr)",
                    }}
                    aria-hidden="true"
                >
                    {cells}
                </span>
            ) : (
                <span className="wt-preview" style={{ width: Math.round(pw), height: Math.round(ph) }} aria-hidden="true" />
            )}
            <div className="wt-preview-caption">
                {haveCounts ? (
                    tooMany ? (
                        <span>{nx}×{ny} panels — too many to draw, but the math below is real.</span>
                    ) : (
                        <span><strong>{nx}×{ny}</strong> panels</span>
                    )
                ) : (
                    <span>Enter panel counts to preview the wall.</span>
                )}
                {haveCounts && panelW > 0 && panelH > 0 && (
                    <>
                        <span>Each panel <strong>{Math.round(panelW)}×{Math.round(panelH)} px</strong></span>
                        <span>Panel AR <strong>{panelAR.toFixed(2)}</strong></span>
                    </>
                )}
            </div>
        </div>
    );
};

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

    const gw = parseFloat(gridWidth) || 0;
    const gh = parseFloat(gridHeight) || 0;
    const nx = Math.floor(parseFloat(numX));
    const ny = Math.floor(parseFloat(numY));

    // Mirrors wallGenerateAspect()'s numX derivation exactly.
    const ar = parseFloat(aspectRatio);
    const aspectNumX =
        gw > 0 && gh > 0 && ny >= 1 && isFinite(ny) && ar > 0
            ? Math.round(gw / ((gh / ny) * ar))
            : null;

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

            <WallPreview w={gw} h={gh} nx={nx} ny={ny} />

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
            {aspectNumX !== null && (
                <p className="wt-aspect-hint">
                    → <strong>{aspectNumX} panels across</strong> at this ratio (uses Comp Width/Height + Number in the height above)
                </p>
            )}
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
