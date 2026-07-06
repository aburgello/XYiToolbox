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

const AEPThiefTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("copyAep");
            if (result === undefined) {
                setStatus({ text: "No CEP bridge — open inside After Effects.", type: "error" });
                return;
            }
            setStatus({
                text: result.success ? result.message : result.error || "Something went wrong.",
                type: result.success ? "success" : "error",
            });
        } catch (e: any) {
            setStatus({ text: e?.message || "Could not run AEP Thief.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">
            <p className="hint">
                Recursively copies <code>.aep</code> files from a source folder into a destination
                folder, skipping ones already there. Writes two CSV logs (<em>Copied_Files.csv</em>
                , <em>Skipped_Files.csv</em>) to the destination folder.
            </p>
            <div className="button-row">
                <button disabled={busy} onClick={run}>
                    <Copy size={14} /> Copy AEPs
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

export default AEPThiefTool;
