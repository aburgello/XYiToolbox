// =============================================================================
// src/js/main/tools/MasterTools.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Master Tools" tab. Auto AR (XYi_AutAR.jsx),
// Velocity Scaler (XYi_VelSca.jsx), the Aspect Ratio/Extreme-format one-
// click comp resizers (XYi_CompSize.jsx's resizeCompCentered(), shared by
// both grids below), and Transform Apply - Scale/Position (reuse the
// already-ported transformApply() with explicit flags).
// =============================================================================
import React, { useState } from "react";
import { Wand2, Gauge, Move, MoveHorizontal } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

interface SizePreset {
    label: string;
    w: number;
    h: number;
}

const ASPECT_RATIOS_LEFT: SizePreset[] = [
    { label: "[L] Square", w: 1920, h: 1920 },
    { label: "[L] Quad", w: 1440, h: 1080 },
    { label: "[L] 1920x1080", w: 1920, h: 1080 },
    { label: "[L] 48 Sheet", w: 1920, h: 960 },
    { label: "[L] 30 Sheet", w: 1920, h: 858 },
    { label: "[L] 96 Sheet", w: 5760, h: 1440 },
    { label: "[L] Extreme", w: 3840, h: 586 },
];
const ASPECT_RATIOS_RIGHT: SizePreset[] = [
    { label: "[P] Square", w: 1920, h: 1920 },
    { label: "[P] 1 Sheet", w: 1080, h: 1600 },
    { label: "[P] 6 Sheet", w: 1080, h: 1620 },
    { label: "[P] 1080x1920", w: 1080, h: 1920 },
    { label: "[P] Tall Portrait", w: 844, h: 2382 },
];
const EXTREME_FORMATS: SizePreset[] = [
    { label: "Extreme Tall (1080x5760)", w: 1080, h: 5760 },
    { label: "Single Panel (5760x1920)", w: 5760, h: 1920 },
    { label: "Double Panel (5760x1440)", w: 5760, h: 1440 },
    { label: "Double Plus Panel (5760x1080)", w: 5760, h: 1080 },
    { label: "Loop (7424x448)", w: 7424, h: 448 },
];

const MasterToolsTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, fn: () => Promise<any>) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            // TEMPORARY: surfaces result.message when present (currently
            // only resizeCompositionCentered's diagnostic build sets one)
            // instead of the generic "complete" text, so the centering-bug
            // debug output is actually visible here -- revert to the plain
            // `${label} complete.` text once that diagnostic is removed.
            setStatus(
                result.success
                    ? { text: result.message ? `${label}: ${result.message}` : `${label} complete.`, type: "success" }
                    : { text: result.error || "Something went wrong.", type: "error" }
            );
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Auto AR", () => evalTS("autoAspectRatio"))}>
                    <Wand2 size={14} /> Auto AR
                </button>
                <button disabled={busy} onClick={() => run("Velocity Scaler", () => evalTS("velocityScaler"))}>
                    <Gauge size={14} /> Velocity Scaler
                </button>
            </div>

            <hr className="divider" />

            <h3>Aspect Ratios</h3>
            <div className="button-row">
                {ASPECT_RATIOS_LEFT.map((p) => (
                    <button key={p.label} disabled={busy} onClick={() => run(p.label, () => evalTS("resizeCompositionCentered", p.w, p.h))}>
                        {p.label}
                    </button>
                ))}
            </div>
            <div className="button-row">
                {ASPECT_RATIOS_RIGHT.map((p) => (
                    <button key={p.label} disabled={busy} onClick={() => run(p.label, () => evalTS("resizeCompositionCentered", p.w, p.h))}>
                        {p.label}
                    </button>
                ))}
            </div>

            <hr className="divider" />

            <div className="button-row">
                {EXTREME_FORMATS.map((p) => (
                    <button key={p.label} disabled={busy} onClick={() => run(p.label, () => evalTS("resizeCompositionCentered", p.w, p.h))}>
                        {p.label}
                    </button>
                ))}
            </div>

            <hr className="divider" />

            <h3>Transform Apply</h3>
            <div className="button-row">
                <button disabled={busy} onClick={() => run("Transform Apply - Scale", () => evalTS("transformApply", false, false, false, true, false))}>
                    <MoveHorizontal size={14} /> Transform Apply - Scale
                </button>
                <button disabled={busy} onClick={() => run("Transform Apply - Position", () => evalTS("transformApply", false, true, false, false, false))}>
                    <Move size={14} /> Transform Apply - Position
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

export default MasterToolsTool;
