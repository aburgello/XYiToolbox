// =============================================================================
// src/js/main/tools/SafeGenerator.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Safe Generator" tab, backed by
// XYi_SafeGen.jsx. Draws two red solids into the active comp: a full-frame
// "ViewSafe" solid used as an alpha-inverted track matte, and a "SafeZone"
// solid sized to the safe area -- the matte makes only the OUTSIDE of the
// safe area show at 50% opacity, a standard broadcast-safe visualization.
//
// LIVE PREVIEW (SafePreview below): each section shows the exact geometry its
// button will draw, recomputed as you type -- same generated-from-real-values
// philosophy as XYTools' ease/excite previews (see XYToolsDroplet.tsx). The
// math is a 1:1 mirror of tools.ts's safeGenerate()/safeGenerateFull()
// (safe = comp - margin*2, centered / safe = the explicit size, centered) --
// keep them in sync if the backend ever changes. The active comp's real size
// comes from the existing scaleCompositionDetect() bridge call, fetched
// QUIETLY on mount (no toast -- no comp open, or no bridge in browser
// preview, are normal states, not errors); without it the preview assumes
// 1920x1080 and says so in its caption rather than silently pretending.
// =============================================================================
import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";
import "./SafeGenerator.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

interface CompDims {
    width: number;
    height: number;
}

const FALLBACK_COMP: CompDims = { width: 1920, height: 1080 };

// Renders the frame at a fixed footprint, aspect-matched to the comp (clamped
// so a 5760x448 extreme still shows up as more than a sliver).
const SafePreview: React.FC<{
    comp: CompDims | null;
    safeWidth: number;
    safeHeight: number;
}> = ({ comp, safeWidth, safeHeight }) => {
    const c = comp ?? FALLBACK_COMP;
    const aspect = c.width / c.height;
    let w = 150;
    let h = w / aspect;
    if (h > 100) { h = 100; w = h * aspect; }
    if (h < 30) { h = 30; }

    const invalid = safeWidth <= 0 || safeHeight <= 0;
    const oversized = !invalid && (safeWidth > c.width || safeHeight > c.height);
    const swPct = Math.max(0, Math.min(safeWidth / c.width, 1)) * 100;
    const shPct = Math.max(0, Math.min(safeHeight / c.height, 1)) * 100;

    return (
        <div className="sg-preview-wrap">
            <span
                className={"sg-preview" + (invalid ? " sg-preview--invalid" : "")}
                style={{ width: Math.round(w), height: Math.round(h) }}
                aria-hidden="true"
            >
                <span className="sg-preview-safe" style={{ width: swPct + "%", height: shPct + "%" }} />
            </span>
            <div className="sg-preview-caption">
                <span>
                    {comp
                        ? <>Active comp <strong>{c.width}×{c.height}</strong></>
                        : <>No comp detected — previewing on <strong>1920×1080</strong></>}
                </span>
                {invalid ? (
                    <span className="sg-preview-warn">Safe area would be {Math.round(safeWidth)}×{Math.round(safeHeight)} — nothing left to protect.</span>
                ) : (
                    <span>Safe area <strong>{Math.round(safeWidth)}×{Math.round(safeHeight)} px</strong></span>
                )}
                {oversized && <span className="sg-preview-warn">Larger than the comp — the matte won't dim anything.</span>}
            </div>
        </div>
    );
};

const SafeGeneratorTool = () => {
    const [marginWidth, setMarginWidth] = useState("");
    const [marginHeight, setMarginHeight] = useState("");
    const [totalWidth, setTotalWidth] = useState("");
    const [totalHeight, setTotalHeight] = useState("");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);
    const [compDims, setCompDims] = useState<CompDims | null>(null);

    // Quiet fetch of the active comp's size for the previews -- reuses Scale
    // Composition's existing detect call rather than adding a new bridge fn.
    useEffect(() => {
        (async () => {
            try {
                const r = await evalTS("scaleCompositionDetect");
                if (r && r.success && r.width && r.width > 0 && r.height && r.height > 0) {
                    setCompDims({ width: r.width, height: r.height });
                }
            } catch {
                // no bridge (browser preview) or no comp -- fallback caption handles it
            }
        })();
    }, []);

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

    const c = compDims ?? FALLBACK_COMP;
    // Mirrors safeGenerate(): safe = comp - margin*2 (empty fields read as 0,
    // i.e. full-frame -- matches what the button would send via parseFloat).
    const mW = parseFloat(marginWidth) || 0;
    const mH = parseFloat(marginHeight) || 0;
    // Mirrors safeGenerateFull(): safe = the explicit size; empty fields fall
    // back to the comp's own size so the preview isn't a red void before typing.
    const tW = parseFloat(totalWidth) || c.width;
    const tH = parseFloat(totalHeight) || c.height;

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
            <SafePreview comp={compDims} safeWidth={c.width - mW * 2} safeHeight={c.height - mH * 2} />
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
            <SafePreview comp={compDims} safeWidth={tW} safeHeight={tH} />
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
