// =============================================================================
// src/js/main/tools/EdgeController.tsx
// -----------------------------------------------------------------------------
// EDGE CONTROLLER -- the panel half of jsx/aeft/edgeController.ts.
//
// WHAT THIS SCREEN IS FOR, and what it is deliberately not. The numbers here
// are STARTING POSITIONS: pressing Rig builds the stack inside a precomp and
// hangs every one of them on an EDGE CTRL null, where they are adjusted with
// the picture in front of you. A panel cannot show you an edge, so it does not
// pretend to be the place you dial one in -- it is the place you say what kind
// of edge you want, once.
//
// The halo and the inner tint are OFF by default. Cleaning up a harsh cutout
// is the everyday job; neon outlines are the occasional one, and two colour
// pickers in front of the common case is the tax that stops people opening a
// tool at all.
// =============================================================================
import React, { useState } from "react";
import { Scan, Sparkles } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import CheckboxToggle from "../CheckboxToggle";
import "../shared.scss";
import "./formTool.scss";
import "./EdgeController.scss";

interface StatusMsg { text: string; type: "success" | "error" }

/** AE colours are 0-1 per channel; the input gives us "#rrggbb". */
const hexToRgb = (hex: string): number[] => {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    if (isNaN(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const NumField: React.FC<{
    id: string; label: string; value: string; onChange: (v: string) => void; hint: string; step?: string;
}> = ({ id, label, value, onChange, hint, step }) => (
    <label className="ec-field" htmlFor={id}>
        <Tooltip text={hint}><span>{label}</span></Tooltip>
        <input id={id} type="number" step={step || "1"} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
);

const EdgeControllerTool = () => {
    const [choke, setChoke] = useState("0");
    const [blur, setBlur] = useState("2");
    const [direction, setDirection] = useState("0");

    const [useOuter, setUseOuter] = useState(false);
    const [outerSize, setOuterSize] = useState("4");
    const [outerColour, setOuterColour] = useState("#22d3ee");
    const [outerOpacity, setOuterOpacity] = useState("100");

    const [useInner, setUseInner] = useState(false);
    const [innerSize, setInnerSize] = useState("3");
    const [innerFeather, setInnerFeather] = useState("4");
    const [innerColour, setInnerColour] = useState("#ffffff");
    const [innerOpacity, setInnerOpacity] = useState("60");

    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const num = (v: string) => {
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    };

    const rig = async () => {
        setStatus(null);
        setBusy(true);
        try {
            // ONE JSON STRING, per the bridge rule: nested values spliced into
            // eval'd ExtendScript source do not survive as an object.
            const payload = JSON.stringify({
                choke: num(choke),
                blur: Math.max(0, num(blur)),
                direction: num(direction),
                outerSize: Math.max(0, num(outerSize)),
                outerColour: hexToRgb(outerColour),
                outerOpacity: num(outerOpacity),
                innerSize: Math.max(0, num(innerSize)),
                innerFeather: Math.max(0, num(innerFeather)),
                innerColour: hexToRgb(innerColour),
                innerOpacity: num(innerOpacity),
                useOuter,
                useInner,
            });
            const r = await evalTS("edgeControllerApply", payload);
            if (r === undefined) throw new Error("no bridge");
            if (!r.success) { setStatus({ text: r.error || "Couldn't rig that layer.", type: "error" }); return; }
            const skipped = (r as { skipped?: string[] }).skipped || [];
            setStatus({
                text: (r.message || "Rigged.") + (skipped.length ? ` Skipped ${skipped.join(", ")}.` : ""),
                type: "success",
            });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected. Open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool ec-tool">
            <p className="hint">
                Builds an edge rig around the selected layer: choke the matte, soften where it ends
                without softening the picture, and optionally lay a coloured halo outside it or a tint
                inside. Everything lands on an <strong>EDGE CTRL</strong> null in the new precomp, so
                these are starting values — you dial it in against the picture.
            </p>

            <div className="ec-row">
                <NumField
                    id="ec-choke" label="Dilate / Erode" value={choke} onChange={setChoke}
                    hint="Pixels to expand the matte by. Negative contracts it — the usual way to eat a fringe off a cutout."
                />
                <NumField
                    id="ec-blur" label="Edge Blur" value={blur} onChange={setBlur}
                    hint="Softens the alpha only, so the boundary goes soft and the picture inside stays sharp."
                />
                <NumField
                    id="ec-dir" label="Direction" value={direction} onChange={setDirection}
                    hint="0 both · 1 horizontal · 2 vertical. Directional softening is for edges that only need to lose one axis — a wipe, or a panel butting up to another."
                />
            </div>

            <div className="ec-opt">
                <CheckboxToggle checked={useOuter} onChange={setUseOuter} label="Coloured halo outside" />
                {useOuter && (
                    <div className="ec-row ec-row--sub">
                        <NumField id="ec-osize" label="Size" value={outerSize} onChange={setOuterSize} hint="How far the halo spreads past the edge, in pixels." />
                        <label className="ec-field" htmlFor="ec-ocol">
                            <span>Colour</span>
                            <input id="ec-ocol" type="color" value={outerColour} onChange={(e) => setOuterColour(e.target.value)} />
                        </label>
                        <NumField id="ec-oop" label="Opacity" value={outerOpacity} onChange={setOuterOpacity} hint="Percent." />
                    </div>
                )}
            </div>

            <div className="ec-opt">
                <CheckboxToggle checked={useInner} onChange={setUseInner} label="Tint inside the edge" />
                {useInner && (
                    <div className="ec-row ec-row--sub">
                        <NumField id="ec-isize" label="Band" value={innerSize} onChange={setInnerSize} hint="How far in from the edge the tint reaches, in pixels." />
                        <NumField id="ec-ifea" label="Feather" value={innerFeather} onChange={setInnerFeather} hint="Blends the tint back into the subject." />
                        <label className="ec-field" htmlFor="ec-icol">
                            <span>Colour</span>
                            <input id="ec-icol" type="color" value={innerColour} onChange={(e) => setInnerColour(e.target.value)} />
                        </label>
                        <NumField id="ec-iop" label="Opacity" value={innerOpacity} onChange={setInnerOpacity} hint="Percent." />
                    </div>
                )}
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={rig}>
                    <Scan size={14} /> Rig Selected Layer
                </button>
            </div>

            {status && (
                <p className={status.type === "error" ? "status-error" : "status-success"}>
                    <StatusIcon type={status.type} /> {status.text}
                </p>
            )}

            <p className="hint ec-note">
                <Sparkles size={11} /> The rig is native effects only — Simple Choker, Channel Blur on
                the alpha, and Fill — so it renders anywhere After Effects does and needs nothing
                installed. A dedicated C++ plugin will beat it for speed on heavy 4K comps.
            </p>
        </div>
    );
};

export default EdgeControllerTool;
