// =============================================================================
// src/js/main/tools/EditTools.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Edit Tools" tab. Fuse Shots and Snuggle
// Layers are real. The tab's third button, "Detect Edit (Old)", is
// intentionally dropped -- it's explicitly labelled "(Old)"/deprecated in
// the original toolbox, and the studio confirmed it should not carry over.
// =============================================================================
import React, { useState } from "react";
import { Combine, AlignHorizontalJustifyStart } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const EditToolsTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

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

    return (
        <div className="form-tool">

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Fuse Shots", () => evalTS("editToolsFuseShots"))}>
                    <Combine size={14} /> Fuse Shots
                </button>
                <button disabled={busy} onClick={() => run("Snuggle Layers", () => evalTS("editToolsSnuggleLayers"))}>
                    <AlignHorizontalJustifyStart size={14} /> Snuggle Layers
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

export default EditToolsTool;
