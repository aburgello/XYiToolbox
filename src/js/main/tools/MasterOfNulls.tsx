// =============================================================================
// src/js/main/tools/MasterOfNulls.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Master of Nulls" tab, backed by
// XYI_MasterNullSelected.jsx / XYI_ParentInformer.jsx (Master Null itself,
// MasNul(), was already inline in the toolbox). All three operate on the
// active comp/its layers only -- no file access at all.
// =============================================================================
import React, { useState } from "react";
import { Target, Link2, Info } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const MasterOfNullsTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, fn: () => Promise<any>) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: result.message || `${label} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Master Null", () => evalTS("masterNullAll"))}>
                    <Target size={14} /> Master Null
                </button>
                <button disabled={busy} onClick={() => run("Master Selected Null", () => evalTS("masterNullSelected"))}>
                    <Link2 size={14} /> Master Selected Null
                </button>
                <button disabled={busy} onClick={() => run("Parental Guidance", () => evalTS("parentInformer"))}>
                    <Info size={14} /> Parental Guidance
                </button>
            </div>

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span style={{ whiteSpace: "pre-wrap" }}>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default MasterOfNullsTool;
