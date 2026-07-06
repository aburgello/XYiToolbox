import React, { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const JPEGLocTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("jpegLoc");
            if (result === undefined) {
                setStatus({ text: "No CEP bridge — open inside After Effects.", type: "error" });
                return;
            }
            setStatus({
                text: result.success ? result.message : result.error || "Something went wrong.",
                type: result.success ? "success" : "error",
            });
        } catch (e: any) {
            setStatus({ text: e?.message || "Could not run JPEG Loc.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">
            <p className="hint">
                Batch-replaces <code>.jpg</code> footage across a folder of <code>.aep</code> files with the
                best-matching JPG (by resolution + number) from a second folder &mdash; the JPG sibling of MC It!.
                Each project is edited on a versioned copy; the originals are never opened.
            </p>
            <div className="button-row">
                <button disabled={busy} onClick={run}>
                    <ImageIcon size={14} /> JPEG Loc
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

export default JPEGLocTool;
