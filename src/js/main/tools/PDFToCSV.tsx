import React, { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const PDFToCSVTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("pdfToCsvGenerate");
            if (result === undefined) {
                setStatus({ text: "No CEP bridge — open inside After Effects.", type: "error" });
                return;
            }
            setStatus({
                text: result.success ? result.message : result.error || "Something went wrong.",
                type: result.success ? "success" : "error",
            });
        } catch (e: any) {
            setStatus({ text: e?.message || "Could not run PDF to CSV.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">
            <p className="hint">
                Scans a folder of PDFs sitting under a <code>PDFs</code> folder, matches each PDF to a master
                by campaign/size/duration, and writes a <code>Campaign_Data.csv</code> next to the PDFs'
                mirrored AE output folder. Never opens any project &mdash; filename scan only.
            </p>
            <div className="button-row">
                <button disabled={busy} onClick={run}>
                    <FileSpreadsheet size={14} /> PDF to CSV
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

export default PDFToCSVTool;
