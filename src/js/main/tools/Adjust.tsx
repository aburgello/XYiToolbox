// =============================================================================
// src/js/main/tools/Adjust.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Adjust" tab, backed by XYi_Adj.jsx. Unlike
// Scale Composition, each field here changes ONE property directly with no
// null-parent layer scaling. CORRECTED (2026-07, verified against tools.ts's
// adjWidth/adjHeight): setting comp.width/height CROPS or EXTENDS the canvas
// -- layers keep their size and position, nothing stretches. An earlier
// version of this header (and CLAUDE.md) claimed width alone "visually
// stretches layer content"; that's wrong -- the only field that genuinely
// distorts is Aspect Ratio (pixelAspect), which stretches the RENDERED image
// horizontally. The live preview below shows exactly this split.
//
// LIVE PREVIEW (AdjustPreview): same generated-from-real-values pattern as
// Safe Generator / Wall Tools -- the frame is the NEW canvas from the
// Width/Height fields, the inner block is the ORIGINAL comp's content
// anchored top-left (where AE keeps layer coordinates), so shrinking crops
// the right/bottom edge and growing exposes empty canvas. The Aspect Ratio
// field scales the content horizontally, squashing/stretching the subject
// circle -- the distortion IS the explanation, same trick as XYTools' Fit
// stretch preview. Comp size comes from scaleCompositionDetect() quietly on
// mount (fallback 1920x1080, labelled).
// =============================================================================
import React, { useEffect, useState } from "react";
import { MoveHorizontal, MoveVertical, Clock, Gauge, RectangleHorizontal } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";
import "./Adjust.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

interface FieldDef {
    id: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
    action: string;
    fnName: string;
}

const FIELDS: FieldDef[] = [
    { id: "width", label: "Width", icon: MoveHorizontal, action: "Adjust Width", fnName: "adjustWidth" },
    { id: "height", label: "Height", icon: MoveVertical, action: "Adjust Height", fnName: "adjustHeight" },
    { id: "duration", label: "Duration", icon: Clock, action: "Adjust Duration", fnName: "adjustDuration" },
    { id: "frameRate", label: "Frame Rate", icon: Gauge, action: "Adjust Frame Rate", fnName: "adjustFrameRate" },
    { id: "aspectRatio", label: "Aspect Ratio", icon: RectangleHorizontal, action: "Adjust Aspect Ratio", fnName: "adjustAspectRatio" },
];

interface CompDims {
    width: number;
    height: number;
}

const FALLBACK_COMP: CompDims = { width: 1920, height: 1080 };

const AdjustPreview: React.FC<{
    comp: CompDims | null;
    newWidth: number;
    newHeight: number;
    pixelAspect: number;
}> = ({ comp, newWidth, newHeight, pixelAspect }) => {
    const c = comp ?? FALLBACK_COMP;
    const changedW = newWidth !== c.width;
    const changedH = newHeight !== c.height;
    const par = pixelAspect > 0 && isFinite(pixelAspect) ? pixelAspect : 1;

    // One scale for both canvases, so old-vs-new size difference stays visible.
    const maxW = Math.max(c.width, newWidth);
    const maxH = Math.max(c.height, newHeight);
    const s = Math.min(150 / maxW, 90 / maxH);
    const frameW = Math.max(10, Math.round(newWidth * s));
    const frameH = Math.max(10, Math.round(newHeight * s));

    const crops = newWidth < c.width || newHeight < c.height;
    const extends_ = newWidth > c.width || newHeight > c.height;

    return (
        <div className="adj-preview-wrap">
            <span className="adj-preview" style={{ width: frameW, height: frameH }} aria-hidden="true">
                <span
                    className="adj-preview-content"
                    style={{
                        width: Math.round(c.width * s),
                        height: Math.round(c.height * s),
                        transform: par !== 1 ? "scaleX(" + par.toFixed(3) + ")" : undefined,
                    }}
                >
                    <span className="adj-preview-subject" />
                </span>
            </span>
            <div className="adj-preview-caption">
                <span>
                    {comp
                        ? <>Active comp <strong>{c.width}×{c.height}</strong></>
                        : <>No comp detected — previewing on <strong>1920×1080</strong></>}
                </span>
                {(changedW || changedH) && (
                    <span>
                        Canvas → <strong>{Math.floor(newWidth)}×{Math.floor(newHeight)}</strong>
                        {crops && !extends_ && " — content keeps its size, the edge crops"}
                        {extends_ && !crops && " — content keeps its size, empty canvas is added"}
                        {crops && extends_ && " — content keeps its size (crops one way, extends the other)"}
                    </span>
                )}
                {par !== 1 && (
                    <span>Pixel AR <strong>{par}</strong> — the rendered image stretches {par > 1 ? "wider" : "narrower"}</span>
                )}
                <span className="adj-preview-note">Nothing rescales here — for proportional scaling use Scale Composition.</span>
            </div>
        </div>
    );
};

const AdjustTool = () => {
    const [values, setValues] = useState<Record<string, string>>({});
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);
    const [compDims, setCompDims] = useState<CompDims | null>(null);

    // Quiet comp-size fetch for the preview -- same pattern as Safe Generator.
    useEffect(() => {
        (async () => {
            try {
                const r = await evalTS("scaleCompositionDetect");
                if (r && r.success && r.width && r.width > 0 && r.height && r.height > 0) {
                    setCompDims({ width: r.width, height: r.height });
                }
            } catch {
                // no bridge / no comp -- fallback caption handles it
            }
        })();
    }, []);

    const run = async (field: FieldDef) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS(field.fnName as any, parseFloat(values[field.id] || "0"));
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: `${field.action} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const c = compDims ?? FALLBACK_COMP;
    // Mirrors adjWidth/adjHeight's Math.floor; empty/invalid fields preview as
    // "unchanged" rather than a zero-size canvas.
    const wVal = parseFloat(values["width"]);
    const hVal = parseFloat(values["height"]);
    const parVal = parseFloat(values["aspectRatio"]);
    const newWidth = wVal > 0 ? Math.floor(wVal) : c.width;
    const newHeight = hVal > 0 ? Math.floor(hVal) : c.height;
    const pixelAspect = parVal > 0 ? parVal : 1;

    return (
        <div className="form-tool">

            {FIELDS.map((field) => {
                const Icon = field.icon;
                return (
                    <div className="field-with-button" key={field.id}>
                        <div className="field-row">
                            <label htmlFor={`adj-${field.id}`}>{field.label}</label>
                            <input
                                id={`adj-${field.id}`}
                                type="text"
                                value={values[field.id] || ""}
                                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                            />
                        </div>
                        <Tooltip text={field.action}>
                            <button className="icon-btn" disabled={busy} onClick={() => run(field)}>
                                <Icon size={14} />
                            </button>
                        </Tooltip>
                    </div>
                );
            })}

            <AdjustPreview comp={compDims} newWidth={newWidth} newHeight={newHeight} pixelAspect={pixelAspect} />

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default AdjustTool;
