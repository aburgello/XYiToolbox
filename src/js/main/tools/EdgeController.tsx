// =============================================================================
// src/js/main/tools/EdgeController.tsx
// -----------------------------------------------------------------------------
// Panel half of jsx/aeft/edgeController.ts. The values here are STARTING
// POSITIONS -- the rig hangs them all on an EDGE CTRL null, which is where
// they get dialled in against the picture.
// =============================================================================
import React, { useState } from "react";
import { Scan } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";
import "./EdgeController.scss";

interface StatusMsg { text: string; type: "success" | "error" }

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
                useOuter: false,
                useInner: false,
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

        </div>
    );
};

export default EdgeControllerTool;
