// =============================================================================
// src/js/main/tools/FindReplace.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Find and Replace" tab (gate()/gate_All()/
// gateClose()). Renames every CompItem (or every project item, for
// "Replace All") whose name contains the search string.
// =============================================================================
import React, { useState } from "react";
import { Replace, ReplaceAll, RotateCcw } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const FindReplaceTool = () => {
    const [original, setOriginal] = useState("");
    const [replaceWith, setReplaceWith] = useState("");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, allItems: boolean) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("findReplace", original, replaceWith, allItems);
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: `${label} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="field-row">
                <label htmlFor="fr-original">Original String</label>
                <input id="fr-original" type="text" value={original} onChange={(e) => setOriginal(e.target.value)} placeholder="Enter original string to find" />
            </div>

            <div className="field-row">
                <label htmlFor="fr-replace">Replace With</label>
                <input id="fr-replace" type="text" value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} placeholder="Enter string to replace" />
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Replace String (Comps)", false)}>
                    <Replace size={14} /> Replace String (Comps)
                </button>
                <button disabled={busy} onClick={() => run("Replace String (All Items)", true)}>
                    <ReplaceAll size={14} /> Replace String (All Items)
                </button>
                <button
                    disabled={busy}
                    onClick={() => {
                        setOriginal("");
                        setReplaceWith("");
                        setStatus(null);
                    }}
                >
                    <RotateCcw size={14} /> Reset
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

export default FindReplaceTool;
