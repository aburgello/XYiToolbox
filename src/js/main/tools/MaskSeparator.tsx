// =============================================================================
// src/js/main/tools/MaskSeparator.tsx
// -----------------------------------------------------------------------------
// Ported from `MasSep()` (originally by Christopher R. Green via
// aenhancers.com). Splits a layer with 2+ masks into one duplicate layer per
// mask. Moved here from Toolset.tsx's one-click grid (it used to collect its
// two inputs via confirmDialog()/promptDialog() before running) to give it a
// real dedicated page under Tools -- freeing a slot on the home screen's grid.
// Same aeft.ts function (`maskSeparator(recenter, nameString)`) either way,
// just real inline fields instead of blocking dialogs now that it has room.
// =============================================================================
import React, { useState } from "react";
import { Scissors } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import CheckboxToggle from "../CheckboxToggle";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const MaskSeparatorTool = () => {
    const [recenter, setRecenter] = useState(false);
    const [nameString, setNameString] = useState("");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("maskSeparator", recenter, nameString);
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: "Masks separated.", type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <CheckboxToggle checked={recenter} onChange={setRecenter} label="Give each layer a new anchor point based on its mask" />

            <div className="field-row">
                <label htmlFor="ms-name-string">Name String (optional)</label>
                <input
                    id="ms-name-string"
                    type="text"
                    value={nameString}
                    onChange={(e) => setNameString(e.target.value)}
                    placeholder="e.g. /name1/name2 — first char is the separator"
                />
                <p className="hint">Leave blank to use each mask's own name. Start with a separator character, e.g. "/name1/name2".</p>
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={run}>
                    <Scissors size={14} /> Separate Masks
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

export default MaskSeparatorTool;
