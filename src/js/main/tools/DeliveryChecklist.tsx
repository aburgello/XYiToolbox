// =============================================================================
// src/js/main/tools/DeliveryChecklist.tsx
// -----------------------------------------------------------------------------
// Ported from toolset/XYi_Delivery_Checklist.jsx ("Bitrate Delivery Panel").
// Load selected comps -> set a target file size (MB) per comp -> the script
// calculates the required bitrate per comp and queues it with the matching
// H264_*MBPS_MOS Output Module template applied, output pointed at a
// "_Delivery" folder next to the comp's .mov source. The bitrate math and
// queueing live in aeft.ts (deliveryChecklistLoadComps/deliveryChecklistQueue,
// ported 1:1); this file is only the row UI the ScriptUI original drew itself.
// =============================================================================
import React, { useState } from "react";
import { ListPlus, Trash2, Rows3, Send, AlertCircle, AlertTriangle } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { sfx } from "../../lib/utils/sfx";
import "../shared.scss";
import "./formTool.scss";
import "./DeliveryChecklist.scss";

interface RowData {
    id: number;
    name: string;
    folderName: string | null;
    sizeMB: string;
}

// Same short-label rule as the original's getShortLabel(): the word
// immediately before the WIDTHxHEIGHT token, plus that token; full name
// as fallback (and always available on hover via title=).
function getShortLabel(fullName: string): string {
    const match = fullName.match(/([A-Za-z0-9]+)_(\d{2,5}x\d{2,5})/);
    if (match) return match[1] + "_" + match[2];
    return fullName;
}

const DeliveryChecklistTool = () => {
    const [rows, setRows] = useState<RowData[]>([]);
    const [includeAudio, setIncludeAudio] = useState(false);
    const [bulkSize, setBulkSize] = useState("5");
    const [log, setLog] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const loadComps = async () => {
        setError(null);
        try {
            const result = await evalTS("deliveryChecklistLoadComps");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                setError(result.error || "Something went wrong.");
                return;
            }
            setRows((result.comps || []).map((c: any) => ({ id: c.id, name: c.name, folderName: c.folderName ?? null, sizeMB: "5" })));
            if ((result.comps || []).length > 0) sfx.bop();
        } catch (e) {
            setError("No CEP bridge detected — open this panel inside After Effects to run it.");
        }
    };

    const applyBulk = () => {
        const val = parseFloat(bulkSize);
        if (isNaN(val) || val <= 0) {
            setError("Enter a valid bulk size in MB first.");
            return;
        }
        setError(null);
        setRows((r) => r.map((row) => ({ ...row, sizeMB: bulkSize })));
    };

    const queueAll = async () => {
        if (rows.length === 0) {
            setError("Load comps first, then set a size per row.");
            return;
        }
        // Validate all rows before doing anything, so a typo doesn't leave
        // half a batch queued -- same up-front check as the original.
        for (const row of rows) {
            const testVal = parseFloat(row.sizeMB);
            if (isNaN(testVal) || testVal <= 0) {
                setError(`Row "${row.name}" has an invalid size. Fix it before queuing.`);
                return;
            }
        }
        setError(null);
        setBusy(true);
        try {
            const result = await evalTS(
                "deliveryChecklistQueue",
                rows.map((r) => ({ id: r.id, sizeMB: parseFloat(r.sizeMB) })),
                includeAudio
            );
            if (result === undefined) throw new Error("no bridge");
            if (result.success) setLog(result.log || "");
            else setError(result.error || "Something went wrong.");
        } catch (e) {
            setError("No CEP bridge detected — open this panel inside After Effects to run it.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool delivery-checklist">
            <h2>Delivery Checklist</h2>
            <p className="hint">Select comp(s) in the Project panel, then Load. Set a target file size (MB) per comp — each gets queued with the closest H264 bitrate template, output into a "_Delivery" folder next to its .mov source.</p>

            <div className="button-row">
                <button disabled={busy} onClick={loadComps}>
                    <ListPlus size={14} /> Load Selected Comps
                </button>
                <button
                    disabled={busy}
                    onClick={() => {
                        setRows([]);
                        setLog("");
                        setError(null);
                    }}
                >
                    <Trash2 size={14} /> Clear List
                </button>
            </div>

            <div className="radio-row">
                <label>
                    <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} /> This batch includes audio
                </label>
            </div>

            <div className="field-with-button">
                <div className="field-row">
                    <label htmlFor="dc-bulk">Bulk-fill size (MB)</label>
                    <input id="dc-bulk" type="text" value={bulkSize} onChange={(e) => setBulkSize(e.target.value)} />
                </div>
                <button disabled={busy} onClick={applyBulk}>
                    <Rows3 size={14} /> Apply to All Rows
                </button>
            </div>

            {rows.length > 0 && (
                <div className="dc-rows">
                    {rows.map((row, i) => {
                        const missing = !row.folderName;
                        return (
                        <div className={missing ? "dc-row dc-row--missing" : "dc-row"} key={row.id}>
                            <span className="dc-row-name" title={row.name}>
                                {getShortLabel(row.name)}
                            </span>
                            <span className="dc-row-status">
                                {missing ? (
                                    <><AlertTriangle size={11} className="dc-missing-icon" /> No .MOV found</>
                                ) : (
                                    "Folder: " + row.folderName
                                )}
                            </span>
                            <label className="dc-row-size">
                                MB:{" "}
                                <input
                                    type="text"
                                    value={row.sizeMB}
                                    onChange={(e) => setRows((r) => r.map((x, xi) => (xi === i ? { ...x, sizeMB: e.target.value } : x)))}
                                />
                            </label>
                        </div>
                        );
                    })}
                </div>
            )}

            <div className="button-row" style={{ marginTop: 10 }}>
                <button disabled={busy} onClick={queueAll}>
                    <Send size={14} /> Calculate + Queue All Rows
                </button>
            </div>

            {error && (
                <div className="tool-status tool-status-error">
                    <AlertCircle size={14} />
                    <span>{error}</span>
                </div>
            )}

            {log && <pre className="dc-log">{log}</pre>}
        </div>
    );
};

export default DeliveryChecklistTool;
