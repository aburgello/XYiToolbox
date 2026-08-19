// =============================================================================
// src/js/main/tools/Darken.tsx
// -----------------------------------------------------------------------------
// Generates a black scrim layer to sit behind a CTA / TT / midcard, replacing
// the hand-built "solid + mask + feather" (or shape layer, or blur) each artist
// was improvising separately.
//
// Backed by tools.ts's generateDarken(). See that function's header for WHY it
// draws an oversized solid rather than a comp-sized one (feather clipping) and
// why it isn't a shape-layer gradient (gradient stop colours aren't writable
// from ExtendScript).
//
// LIVE PREVIEW (DarkenPreview below): CSS gradients chosen to mirror what the
// backend actually draws -- radial for Pool, linear for Bottom/Top, flat fill
// for Flat -- recomputed as you change the controls, same philosophy as
// SafeGenerator's preview and XYTools' ease previews. It is an APPROXIMATION
// of the mask feather, not a render: feather maps to a gradient midpoint, which
// reads the same way to the eye but isn't AE's actual falloff curve.
//
// The active comp's real dimensions come from the existing
// scaleCompositionDetect() bridge call, fetched quietly on mount (no comp open,
// or no bridge in browser preview, are normal states -- not errors).
// =============================================================================
import React, { useEffect, useState } from "react";
import { Moon, Zap } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import SegmentedToggle from "../SegmentedToggle";
import { DARKEN_DEFAULTS } from "../lib/darkenDefaults";
import "../shared.scss";
import "./formTool.scss";
import "./Darken.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

interface CompDims {
    width: number;
    height: number;
}

const FALLBACK_COMP: CompDims = { width: 1920, height: 1080 };

const STYLES = [
    { value: "pool", label: "Pool" },
    { value: "bottom", label: "Bottom" },
    { value: "top", label: "Top" },
    { value: "flat", label: "Flat" },
];

const STYLE_HINT: Record<string, string> = {
    pool: "A soft ellipse of shadow centred on the selected layer, sized to it. The usual choice behind a midcard or a CTA lockup.",
    bottom: "A gradient rising from the bottom edge. Standard for a lower-third CTA or a TT strip.",
    top: "A gradient falling from the top edge.",
    flat: "An even wash across the whole frame. No mask, no falloff.",
};

// Approximates the AE mask feather as a gradient midpoint: a bigger feather
// starts the falloff earlier, so the solid core shrinks.
const DarkenPreview: React.FC<{
    comp: CompDims | null;
    style: string;
    opacity: number;
    feather: number;
    coverage: number;
}> = ({ comp, style, opacity, feather, coverage }) => {
    const c = comp ?? FALLBACK_COMP;
    const aspect = c.width / c.height;
    let w = 190;
    let h = w / aspect;
    if (h > 116) { h = 116; w = h * aspect; }
    if (h < 34) { h = 34; }

    // Feather as a fraction of the frame's short edge, clamped so an extreme
    // value still leaves something visible in the preview.
    const soft = Math.max(0, Math.min(feather / Math.min(c.width, c.height), 0.5));
    const a = Math.max(0, Math.min(opacity, 100)) / 100;

    let background: string;
    if (style === "flat") {
        background = `rgba(0,0,0,${a})`;
    } else if (style === "pool") {
        const core = Math.max(4, 34 - soft * 60);
        background = `radial-gradient(ellipse ${44}% ${38}% at 50% 50%, rgba(0,0,0,${a}) ${core}%, rgba(0,0,0,0) 100%)`;
    } else {
        const band = Math.max(0, Math.min(coverage, 100));
        const dir = style === "bottom" ? "to top" : "to bottom";
        const solidTo = Math.max(0, band - soft * 100);
        const fadeTo = Math.min(100, band + soft * 100);
        background = `linear-gradient(${dir}, rgba(0,0,0,${a}) 0%, rgba(0,0,0,${a}) ${solidTo}%, rgba(0,0,0,0) ${fadeTo}%)`;
    }

    return (
        <div className="dk-preview-wrap">
            <span className="dk-preview" style={{ width: Math.round(w), height: Math.round(h) }} aria-hidden="true">
                <span className="dk-preview-plate" />
                <span className="dk-preview-scrim" style={{ background }} />
                <span className={"dk-preview-cta dk-preview-cta--" + style}>CTA</span>
            </span>
            <div className="dk-preview-caption">
                <span>
                    {comp
                        ? <>Active comp <strong>{c.width}×{c.height}</strong></>
                        : <>No comp detected — previewing on <strong>1920×1080</strong></>}
                </span>
                <span>{STYLE_HINT[style]}</span>
            </div>
        </div>
    );
};

const DarkenTool = () => {
    const [style, setStyle] = useState<string>(DARKEN_DEFAULTS.style);
    const [opacity, setOpacity] = useState(String(DARKEN_DEFAULTS.opacity));
    const [feather, setFeather] = useState(String(DARKEN_DEFAULTS.feather));
    const [coverage, setCoverage] = useState(String(DARKEN_DEFAULTS.coverage));
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);
    const [compDims, setCompDims] = useState<CompDims | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const r = await evalTS("scaleCompositionDetect");
                if (r && r.success && r.width && r.width > 0 && r.height && r.height > 0) {
                    setCompDims({ width: r.width, height: r.height });
                }
            } catch {
                // no bridge (browser preview) or no comp -- the caption says so
            }
        })();
    }, []);

    // Quick Darken deliberately ignores whatever is currently in the controls
    // and sends DARKEN_DEFAULTS -- it's the same one-click action as Toolset's
    // "Quick Darken" tile, so it has to behave identically wherever it's fired
    // from. Tweaking the fields then hitting Quick Darken silently using those
    // tweaked values would make the two surfaces disagree.
    const generate = async (quick = false) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS(
                "generateDarken",
                quick ? DARKEN_DEFAULTS.style : style,
                quick ? DARKEN_DEFAULTS.opacity : parseFloat(opacity) || 0,
                quick ? DARKEN_DEFAULTS.feather : parseFloat(feather) || 0,
                quick ? DARKEN_DEFAULTS.coverage : parseFloat(coverage) || 0,
            );
            if (result === undefined) throw new Error("no bridge");
            setStatus(
                result.success
                    ? { text: (result as any).message || "Darkening layer added.", type: "success" }
                    : { text: result.error || "Something went wrong.", type: "error" },
            );
        } catch (e) {
            setStatus({ text: "No CEP bridge detected. Open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const isBand = style === "bottom" || style === "top";

    return (
        <div className="form-tool">
            <h3>Style</h3>
            <SegmentedToggle value={style} onChange={setStyle} options={STYLES} name="dk-style" />

            <DarkenPreview
                comp={compDims}
                style={style}
                opacity={parseFloat(opacity) || 0}
                feather={parseFloat(feather) || 0}
                coverage={parseFloat(coverage) || 0}
            />

            <div className="field-row">
                <label htmlFor="dk-op">Opacity (%)</label>
                <input id="dk-op" type="text" value={opacity} onChange={(e) => setOpacity(e.target.value)} />
            </div>

            {style !== "flat" && (
                <div className="field-row">
                    <label htmlFor="dk-fe">Feather (px)</label>
                    <input id="dk-fe" type="text" value={feather} onChange={(e) => setFeather(e.target.value)} />
                </div>
            )}

            {isBand && (
                <div className="field-row">
                    <label htmlFor="dk-cv">Coverage (% of height)</label>
                    <input id="dk-cv" type="text" value={coverage} onChange={(e) => setCoverage(e.target.value)} />
                </div>
            )}

            <div className="button-row">
                <button disabled={busy} onClick={() => generate(false)}>
                    <Moon size={14} /> Generate Darkening Layer
                </button>
                <button disabled={busy} onClick={() => generate(true)}>
                    <Zap size={14} /> Quick Darken
                </button>
            </div>

            <p className="hint">Select the CTA first — the scrim goes in behind it.</p>

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default DarkenTool;
