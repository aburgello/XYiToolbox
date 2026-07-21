// =============================================================================
// src/js/main/LocGenReportModal.tsx
// -----------------------------------------------------------------------------
// Results modal for the row-based localisers -- Generate Files, Trott, and
// Trott 2.0 (campaignLocaliserGenerate / campaignLocaliserTrott[2] in the host).
// Same pattern as McItReportModal: mounted ONCE at the app root as
// <LocGenReportHost/> so it pops over whatever screen is up, and it recovers a
// run whose live callback was lost (long batch, panel closed) by polling the
// persisted report (finishLocGenReport writes locgen_last_report.json). Reuses
// the mcit-* styles for a consistent look; adds a couple of loc-specific ones.
// =============================================================================
import React, { useEffect, useState } from "react";
import { FolderInput, X, CheckCircle2, AlertTriangle, CircleSlash, SkipForward } from "lucide-react";
import { evalTS } from "../lib/utils/bolt";
import "./McItReportModal.scss";
import "./LocGenReportModal.scss";

export interface LocGenRow {
    source: string;
    artwork: string;
    campaign: string;
    size: string;
    duration: string;
    status: "generated" | "skipped-existing" | "no-master" | "no-comp" | "error";
    master?: string;
    output?: string;
    error?: string;
}

export interface LocGenReport {
    message?: string;
    tool?: string;
    outputFolder?: string;
    rows?: LocGenRow[];
    finishedAt?: string;
    runId?: string;
}

let pushLocGenReport: ((report: LocGenReport) => void) | null = null;

// Show the localiser results modal over whatever screen is currently up.
export function showLocGenReport(report: LocGenReport): void {
    pushLocGenReport?.(report);
}

export const LocGenReportHost: React.FC = () => {
    const [report, setReport] = useState<LocGenReport | null>(null);
    const shownRunIdRef = React.useRef<string>("");
    const reportOpenRef = React.useRef(false);
    reportOpenRef.current = report !== null;

    useEffect(() => {
        pushLocGenReport = (r) => {
            shownRunIdRef.current = r.runId || r.finishedAt || "";
            setReport(r);
        };
        // Poll the persisted report (source of truth, written inside AE at run
        // end) so the modal appears even when the live callback was lost.
        const checkStored = async () => {
            if (reportOpenRef.current) return;
            try {
                const res = await evalTS("locGenLoadLastReport");
                if (!res?.json) return;
                const parsed = JSON.parse(res.json) as LocGenReport;
                const id = parsed.runId || parsed.finishedAt || "stored";
                if (id === shownRunIdRef.current) return;
                shownRunIdRef.current = id;
                setReport(parsed);
            } catch (e) {
                /* browser preview — no bridge */
            }
        };
        checkStored();
        const interval = setInterval(checkStored, 4000);
        window.addEventListener("focus", checkStored);
        return () => {
            pushLocGenReport = null;
            clearInterval(interval);
            window.removeEventListener("focus", checkStored);
        };
    }, []);

    const close = () => {
        setReport(null);
        evalTS("locGenClearLastReport").catch(() => {});
    };

    if (!report) return null;
    return <LocGenReportModal report={report} onClose={close} />;
};

const STATUS_ICON: Record<LocGenRow["status"], React.ReactNode> = {
    generated: <CheckCircle2 size={13} />,
    "skipped-existing": <SkipForward size={13} />,
    "no-master": <AlertTriangle size={13} />,
    "no-comp": <AlertTriangle size={13} />,
    error: <CircleSlash size={13} />,
};

const LocGenReportModal: React.FC<{ report: LocGenReport; onClose: () => void }> = ({ report, onClose }) => {
    const rows = report.rows || [];
    const gen = rows.filter((r) => r.status === "generated").length;
    const skip = rows.filter((r) => r.status === "skipped-existing").length;
    const problems = rows.filter((r) => r.status === "no-master" || r.status === "no-comp" || r.status === "error").length;

    return (
        <div className="mcit-overlay" onClick={onClose}>
            <div className="mcit-modal" onClick={(e) => e.stopPropagation()}>
                <div className="mcit-head">
                    <div className="mcit-head-icon"><FolderInput size={16} /></div>
                    <div className="mcit-head-text">
                        <div className="mcit-title">{report.tool || "Localiser"} — run complete</div>
                        <div className="mcit-subtitle">
                            <span className="mcit-replaced-count">{gen} generated</span>
                            {skip > 0 ? <> · {skip} already existed</> : null}
                            {problems > 0 ? <span className="locgen-problem-count"> · {problems} unresolved</span> : null}
                            {report.finishedAt ? <span className="mcit-finished"> · {report.finishedAt}</span> : null}
                        </div>
                    </div>
                    <button className="mcit-close" onClick={onClose}><X size={16} /></button>
                </div>

                <div className="mcit-body">
                    {rows.length === 0 && <div className="mcit-proj-skip">No rows to process.</div>}
                    {rows.map((r, idx) => (
                        <div key={idx} className={"locgen-row locgen-row--" + r.status}>
                            {STATUS_ICON[r.status]}
                            <div className="locgen-row-text">
                                <span className="locgen-row-source">{r.source}</span>
                                <span className="locgen-row-meta">
                                    {r.campaign || "—"} · {r.size || "—"} · {r.duration || "—"}
                                    {r.status === "generated" && r.output ? <span className="locgen-row-ok"> → {r.output}</span> : null}
                                    {r.status === "skipped-existing" ? <span className="locgen-row-muted"> → already exists</span> : null}
                                    {(r.status === "no-master" || r.status === "no-comp" || r.status === "error") && r.error ? (
                                        <span className="locgen-row-bad"> — {r.error}</span>
                                    ) : null}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mcit-foot">
                    <span className="mcit-foot-paths" title={report.outputFolder || ""}>
                        {report.message}{report.outputFolder ? ` · ${report.outputFolder}` : ""}
                    </span>
                    <button className="mcit-done" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
};

export default LocGenReportModal;
