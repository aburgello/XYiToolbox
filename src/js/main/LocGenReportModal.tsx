// =============================================================================
// src/js/main/LocGenReportModal.tsx
// -----------------------------------------------------------------------------
// Results modal for the row-based localisers -- Generate Files and Trott 2.0
// (campaignLocaliserGenerate / campaignLocaliserTrott2 in the host).
// Same pattern as McItReportModal: mounted ONCE at the app root as
// <LocGenReportHost/> so it pops over whatever screen is up, and it recovers a
// run whose live callback was lost (long batch, panel closed) by polling the
// persisted report (finishLocGenReport writes locgen_last_report.json). Reuses
// the mcit-* styles for a consistent look; adds a couple of loc-specific ones.
// =============================================================================
import React, { useEffect, useMemo, useState } from "react";
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
    // CSV Localiser's inline MC It! pass only (see csvLocaliserRun's runMcIt).
    // Optional: every other tool feeding this modal simply omits them, and the
    // row renders exactly as it did before.
    imagesReplaced?: number;
    imagesNote?: string; // why nothing was swapped for this row, if applicable
    /** CSV Localiser's inline Support Swap pass. */
    componentsSwapped?: number;
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

    /**
     * The run's headline numbers, added up from the rows.
     *
     * A pass that did nothing is left OUT rather than shown as zero: on a
     * campaign with no Masters/Support, "0 component sources" is a line about
     * something that was never going to happen, and it crowds out the two
     * numbers that matter. `message` still carries the reason it did nothing.
     */
    const stats = useMemo(() => {
        if (!rows.length) return [] as { label: string; value: number }[];
        const generated = rows.filter((r) => r.status === "generated").length;
        const images = rows.reduce((n, r) => n + (r.imagesReplaced || 0), 0);
        const components = rows.reduce((n, r) => n + (r.componentsSwapped || 0), 0);
        const problems = rows.filter((r) => r.status === "no-master" || r.status === "error").length;
        const out = [{ label: `of ${rows.length} built`, value: generated }];
        if (images > 0) out.push({ label: "images swapped", value: images });
        if (components > 0) out.push({ label: "components swapped", value: components });
        if (problems > 0) out.push({ label: "need a look", value: problems });
        return out;
    }, [rows]);

    // Which row is mid-open, so a second click cannot start a second open
    // while AE is still asking about the first one's unsaved changes.
    const [opening, setOpening] = useState<string | null>(null);
    const [openError, setOpenError] = useState<string | null>(null);

    /**
     * Open a row's output in AE, so a finished run is a list of things you can
     * start from rather than a list of filenames to go and find in Finder.
     *
     * The path is rebuilt from the report's own outputFolder plus the row's
     * filename: the host writes both, and neither is anything the modal has to
     * derive or guess.
     */
    const openRow = async (fileName: string) => {
        if (!report.outputFolder || opening) return;
        setOpenError(null);
        setOpening(fileName);
        try {
            const sep = report.outputFolder.indexOf("\\") !== -1 ? "\\" : "/";
            const res = (await evalTS("openLocalisedProject", report.outputFolder + sep + fileName)) as
                { success: boolean; error?: string } | undefined;
            if (res === undefined) setOpenError("No connection to After Effects.");
            else if (!res.success) setOpenError(res.error || "Couldn't open that project.");
        } catch (e) {
            setOpenError("No connection to After Effects.");
        } finally {
            setOpening(null);
        }
    };
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
                                    {/* THE OUTPUT IS A DOOR. A finished run is a list
                                        of things to start work on, and hunting each one
                                        down in Finder is the step this removes.
                                        Only where the file was actually written. */}
                                    {r.status === "generated" && r.output ? (
                                        report.outputFolder ? (
                                            <button
                                                type="button"
                                                className="locgen-row-open"
                                                disabled={!!opening}
                                                title={`Open ${r.output} in After Effects`}
                                                onClick={() => openRow(r.output as string)}
                                            >
                                                → {r.output}
                                            </button>
                                        ) : (
                                            <span className="locgen-row-ok"> → {r.output}</span>
                                        )
                                    ) : null}
                                    {r.status === "skipped-existing" ? <span className="locgen-row-muted"> → already exists</span> : null}
                                    {(r.status === "no-master" || r.status === "no-comp" || r.status === "error") && r.error ? (
                                        <span className="locgen-row-bad"> — {r.error}</span>
                                    ) : null}
                                    {/* Inline MC It! outcome for this row. 0 is meaningful (the
                                        pass ran and matched nothing), so test for undefined, not
                                        falsiness. */}
                                    {/* nowrap: the row meta wraps mid-word otherwise (the .aep
                                        filenames force an aggressive break rule), which rendered
                                        this as "0 imag / es swapped". */}
                                    {typeof r.imagesReplaced === "number" ? (
                                        <span
                                            className={r.imagesReplaced > 0 ? "locgen-row-ok" : "locgen-row-muted"}
                                            style={{ whiteSpace: "nowrap" }}
                                        >
                                            {" "}· {r.imagesReplaced} image{r.imagesReplaced === 1 ? "" : "s"} swapped
                                        </span>
                                    ) : null}
                                    {r.imagesNote ? <span className="locgen-row-muted"> · {r.imagesNote}</span> : null}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* COUNTED OFF THE ROWS, not parsed out of the message.
                    Three inline passes made that message a run-on sentence
                    that ellipsised away exactly the numbers somebody opened
                    the report to read. Rows carry their own counts, live and
                    recovered alike, so the totals are always available. */}
                <div className="mcit-foot">
                    <div className="lgr-foot-main">
                        {openError && <span className="locgen-open-error">{openError}</span>}
                        <div className="lgr-stats">
                            {stats.map((s) => (
                                <span key={s.label} className="lgr-stat">
                                    <strong>{s.value}</strong> {s.label}
                                </span>
                            ))}
                            {stats.length === 0 && <span className="lgr-stat">{report.message}</span>}
                        </div>
                        {report.outputFolder && (
                            <span className="mcit-foot-paths" title={report.outputFolder}>
                                {report.outputFolder}
                            </span>
                        )}
                    </div>
                    <button className="mcit-done" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
};

export default LocGenReportModal;
