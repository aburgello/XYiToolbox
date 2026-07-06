// =============================================================================
// src/js/main/tools/RandomLayers.tsx
// -----------------------------------------------------------------------------
// "Random Layers" tab, ported from XYi_RandomZ.jsx + XYi_RSP.jsx. Both share
// the same Minimum/Range fields in the original ScriptUI tab, so they're one
// tool here too. Acts on whatever layers are currently selected in the
// active comp -- no file dialogs, no master files touched.
// =============================================================================
import React, { useState } from "react";
import { Shuffle } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./RandomLayers.scss";

const RandomLayersTool = () => {
    const [minimum, setMinimum] = useState("0");
    const [range, setRange] = useState("1");
    const [status, setStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);

    const run = async (action: "randomZ" | "randomStartingPoint", label: string) => {
        setStatus(null);
        const min = parseFloat(minimum) || 0;
        const rng = parseFloat(range) || 0;
        try {
            const result = await evalTS(action, min, rng);
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: `${label} applied.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        }
    };

    return (
        <div className="random-layers">

            <div className="field-row">
                <label>Minimum</label>
                <input type="number" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
            </div>
            <div className="field-row">
                <label>Range</label>
                <input type="number" value={range} onChange={(e) => setRange(e.target.value)} />
            </div>

            <div className="random-buttons">
                <button onClick={() => run("randomZ", "Random Z")}>
                    <Shuffle size={14} /> Random Z
                </button>
                <button onClick={() => run("randomStartingPoint", "Random Starting Point")}>
                    <Shuffle size={14} /> Random Starting Point
                </button>
            </div>

            {status && (
                <div className={`random-status random-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default RandomLayersTool;
