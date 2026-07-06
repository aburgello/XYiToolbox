import React, { useState } from "react";
import { RefreshCw, Trash2, Play, Pause } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import { confirmDialog } from "../Dialog";
import "../shared.scss";
import "./formTool.scss";

interface RQItem {
    id: number;
    compName: string;
    status: number;
    startTime: string;
    elapsedTime: string;
    outputModuleName: string;
    outputPath: string;
    skip: boolean;
    numOutputModules: number;
}

const STATUS_NAMES: Record<number, string> = {
    1: "QUEUED",
    2: "WILL NEEDS",
    3: "UNQUEUED",
    4: "RENDERING",
    5: "USER STOPPED",
    6: "DONE",
    7: "FAILED",
};

const MOCK_ITEMS: RQItem[] = [
    { id: 1, compName: "HORSE_master", status: 1, startTime: "", elapsedTime: "", outputModuleName: "H264_10MBPS_MOS", outputPath: "/ Renders / HORSE_master.mov", skip: false, numOutputModules: 1 },
    { id: 2, compName: "Logo_Endcard", status: 6, startTime: "1.234", elapsedTime: "5.678", outputModuleName: "LOSSLESS", outputPath: "/ Renders / Logo_Endcard.mov", skip: false, numOutputModules: 1 },
];

const RenderQueueManager: React.FC = () => {
    const [items, setItems] = useState<RQItem[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const refresh = async () => {
        setBusy(true); setStatus(null);
        try {
            const result = await evalTS("renderQueueList");
            if (result === undefined) throw new Error("no bridge");
            if (result.success) {
                const parsed = JSON.parse(result.message);
                setItems(parsed);
                if (!loaded && parsed.length === 0) setItems(MOCK_ITEMS);
            } else {
                setItems(MOCK_ITEMS);
                setStatus({ type: "error", text: result.error || "Failed." });
            }
        } catch {
            setItems(MOCK_ITEMS);
            setStatus({ type: "error", text: "No bridge — showing mock data." });
        } finally {
            setLoaded(true);
            setBusy(false);
        }
    };

    const setSkip = async (id: number, skip: boolean) => {
        setBusy(true);
        try {
            const result = await evalTS("renderQueueSetSkip", id, skip);
            if (result === undefined) throw new Error("no bridge");
            if (result.success) {
                setItems((prev) => prev.map((it) => it.id === id ? { ...it, skip } : it));
            } else {
                setStatus({ type: "error", text: result.error || "Failed." });
            }
        } catch { /* preview */ }
        finally { setBusy(false); }
    };

    const removeItem = async (id: number) => {
        setBusy(true);
        try {
            const result = await evalTS("renderQueueRemoveItem", id);
            if (result && result.success) {
                // AE's render queue is 1-based positional -- removing item N
                // shifts every item after it down by one. `id` here IS that
                // position (assigned at renderQueueList time), so every
                // remaining row with a higher id needs to shift too, or a
                // second removal (without an intervening refresh) would
                // target the wrong queue position.
                setItems((prev) => prev.filter((it) => it.id !== id).map((it) => (it.id > id ? { ...it, id: it.id - 1 } : it)));
                setStatus({ type: "success", text: "Removed from queue." });
            } else if (result) {
                setStatus({ type: "error", text: result.error || "Failed." });
            }
        } catch { /* preview */ }
        finally { setBusy(false); }
    };

    const clearAll = async () => {
        const ok = await confirmDialog("Clear the entire render queue?\n\nThis will remove all queued items.");
        if (!ok) return;
        setBusy(true);
        try {
            const result = await evalTS("renderQueueClear");
            if (result === undefined) throw new Error("no bridge");
            if (result.success) {
                setItems([]);
                setStatus({ type: "success", text: "Queue cleared." });
            } else {
                setStatus({ type: "error", text: result.error || "Failed." });
            }
        } catch { /* preview */ }
        finally { setBusy(false); }
    };

    return (
        <div className="form-tool rqm">

            <div className="button-row rqm-buttons">
                <button disabled={busy} onClick={refresh}>
                    <RefreshCw size={14} /> {loaded ? "Refresh" : "Load Queue"}
                </button>
                {items.length > 0 && (
                    <button disabled={busy} onClick={clearAll} className="rqm-clear-btn">
                        <Trash2 size={14} /> Clear All
                    </button>
                )}
            </div>

            {status && (
                <div className={`loc-status loc-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}

            {loaded && items.length > 0 && (
                <div className="rqm-list">
                    {items.map((item) => (
                        <div key={item.id} className={"rqm-row" + (item.skip ? " rqm-row--skip" : "")}>
                            <div className="rqm-row-main">
                                <span className="rqm-row-name">{item.compName}</span>
                                <span className={"rqm-row-status rqm-status--" + item.status}>
                                    {STATUS_NAMES[item.status] || ("STATUS_" + item.status)}
                                </span>
                            </div>
                            <div className="rqm-row-meta">
                                {item.outputModuleName && <span>{item.outputModuleName}</span>}
                                {item.outputPath && <span className="rqm-row-path" title={item.outputPath}>{item.outputPath}</span>}
                            </div>
                            <div className="rqm-row-actions">
                                <button onClick={() => setSkip(item.id, !item.skip)} disabled={busy} title={item.skip ? "Un-skip" : "Skip"}>
                                    {item.skip ? <Play size={12} /> : <Pause size={12} />}
                                </button>
                                <button onClick={() => removeItem(item.id)} disabled={busy} title="Remove">
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {loaded && items.length === 0 && (
                <p className="hint" style={{ padding: "12px 0" }}>Render queue is empty.</p>
            )}
        </div>
    );
};

export default RenderQueueManager;