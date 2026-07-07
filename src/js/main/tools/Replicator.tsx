// =============================================================================
// src/js/main/tools/Replicator.tsx
// -----------------------------------------------------------------------------
// Ported from toolset/XYI_Replicator.jsx. Recursively copies a source
// folder's contents into a destination folder, skipping files that already
// exist there, writing a file_list.txt log. Never overwrites, no AE project
// touched. Moved here from Toolset.tsx's one-click grid -- same aeft.ts
// function (`replicator()`, no arguments; it pops its own source/destination
// Folder.selectDialog()s internally) either way, just a dedicated page
// instead of a grid button, same precedent as Mask Separator's own move.
// =============================================================================
import React, { useState } from "react";
import { Copy } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const ReplicatorTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("replicator");
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: result.message || "Copy complete.", type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">
            <p className="hint">Recursively copies a source folder's contents into a destination folder, skipping files that already exist there. Writes a file_list.txt log to the destination.</p>

            <div className="button-row">
                <button disabled={busy} onClick={run}>
                    <Copy size={14} /> Copy
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

export default ReplicatorTool;
