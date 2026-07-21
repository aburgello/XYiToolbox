// =============================================================================
// src/js/main/McItReportModal.tsx
// -----------------------------------------------------------------------------
// Results modal for MC It! -- renders the structured report mcIt()
// (aeft/tools.ts) returns through the bridge. Mounted ONCE at the app root as
// <McItReportHost/> (same pattern as DialogHost/PreFlightHost), so the modal
// pops over WHATEVER screen is up -- homepage included -- no matter which
// entry point launched the run (Campaign Localiser's button or the Toolset
// card), via the module-level showMcItReport() below.
//
// The host also recovers orphaned runs: mcIt() persists every report to
// userData before returning (a long batch outlives a closed panel -- the
// evalTS callback dies with the page), and on mount this loads any unseen
// report and auto-opens the modal. Closing it clears the stored copy either
// way. The report interfaces mirror McItResult host-side.
// =============================================================================
import React, { useEffect, useState } from "react";
import { Image as ImageIcon, X, CheckCircle2, AlertTriangle, CircleSlash } from "lucide-react";
import { evalTS } from "../lib/utils/bolt";
import "./McItReportModal.scss";

export interface McItemRep {
    folder: string;
    name: string;
    action: "replaced" | "no-match" | "skipped";
    newName?: string;
    reason?: string;
}

export interface McProjectRep {
    aep: string;
    resolution: string;
    skipped?: string;
    items: McItemRep[];
}

export interface McReport {
    message?: string;
    aepFolder?: string;
    imageFolder?: string;
    imageCount?: number;
    processed?: number;
    replaced?: number;
    projects?: McProjectRep[];
    finishedAt?: string;
    runId?: string;
    dryRun?: boolean;
}

let pushMcItReport: ((report: McReport) => void) | null = null;

// Show the MC It! results modal over whatever screen is currently up.
// Call from any tool after a successful run.
export function showMcItReport(report: McReport): void {
    pushMcItReport?.(report);
}

export const McItReportHost: React.FC = () => {
    const [report, setReport] = useState<McReport | null>(null);
    // runId of the report currently/last shown -- the polling below uses it to
    // never re-open a report the user has already seen this session.
    const shownRunIdRef = React.useRef<string>("");
    const reportOpenRef = React.useRef(false);
    reportOpenRef.current = report !== null;

    useEffect(() => {
        pushMcItReport = (r) => {
            shownRunIdRef.current = r.runId || r.finishedAt || "";
            setReport(r);
        };

        // The persisted report file is the SOURCE OF TRUTH: mcIt() writes it
        // inside AE at run end no matter what the panel is doing. Polling it
        // (every few seconds + on window focus) means the modal appears within
        // moments of completion even when the live evalTS callback was lost --
        // panel closed mid-run, page reloaded, or the run was started from a
        // panel instance predating this code. The mount check is just the
        // first poll.
        const checkStored = async () => {
            if (reportOpenRef.current) return; // never yank a modal the user is reading
            try {
                const res = await evalTS("mcItLoadLastReport");
                if (!res?.json) return;
                const parsed = JSON.parse(res.json) as McReport;
                const id = parsed.runId || parsed.finishedAt || "stored";
                if (id === shownRunIdRef.current) return; // already seen
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
            pushMcItReport = null;
            clearInterval(interval);
            window.removeEventListener("focus", checkStored);
        };
    }, []);

    const [applying, setApplying] = useState(false);

    const close = () => {
        if (applying) return;
        setReport(null);
        // Seen (live or recovered) — drop the persisted copy so it's never
        // offered again. shownRunIdRef keeps guarding against the tiny window
        // where a poll reads the file before this delete lands.
        evalTS("mcItClearLastReport").catch(() => {});
    };

    // Dry run -> real run, reusing the exact folders the preview scanned (no
    // dialogs). The fresh report replaces the preview in place.
    const apply = async () => {
        if (!report) return;
        setApplying(true);
        try {
            const res = await evalTS("mcIt", report.aepFolder || "", report.imageFolder || "", false);
            if (res?.success) {
                const r = res as McReport;
                shownRunIdRef.current = r.runId || r.finishedAt || "";
                setReport(r);
            }
        } catch (e) {
            /* bridge lost mid-apply — the poller will recover the real report */
        } finally {
            setApplying(false);
        }
    };

    if (!report) return null;
    return <McItReportModal report={report} onClose={close} onApply={report.dryRun ? apply : undefined} applying={applying} />;
};

const McItReportModal: React.FC<{ report: McReport; onClose: () => void; onApply?: () => void; applying?: boolean }> = ({ report, onClose, onApply, applying }) => (
    <div className="mcit-overlay" onClick={onClose}>
        <div className="mcit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mcit-head">
                <div className="mcit-head-icon"><ImageIcon size={16} /></div>
                <div className="mcit-head-text">
                    <div className="mcit-title">
                        {report.dryRun ? "MC It! — preview (nothing saved)" : "MC It! — run complete"}
                    </div>
                    <div className="mcit-subtitle">
                        {report.processed ?? 0} project{(report.processed ?? 0) === 1 ? "" : "s"} ·{" "}
                        <span className="mcit-replaced-count">{report.replaced ?? 0} {report.dryRun ? "would be replaced" : "replaced"}</span> ·{" "}
                        {report.imageCount ?? 0} candidate images
                        {report.finishedAt ? <span className="mcit-finished"> · {report.finishedAt}</span> : null}
                    </div>
                </div>
                <button className="mcit-close" onClick={onClose}><X size={16} /></button>
            </div>

            <div className="mcit-body">
                {(report.projects || []).map((proj) => {
                    const replaced = proj.items.filter((i) => i.action === "replaced").length;
                    const misses = proj.items.filter((i) => i.action === "no-match").length;
                    return (
                        <div key={proj.aep} className="mcit-proj">
                            <div className="mcit-proj-head">
                                <span className="mcit-proj-name">{proj.aep}</span>
                                {proj.resolution && <span className="mcit-proj-res">{proj.resolution}</span>}
                                {proj.skipped ? (
                                    <span className="mcit-pill mcit-pill--warn">skipped</span>
                                ) : (
                                    <span className={"mcit-pill " + (misses === 0 && replaced > 0 ? "mcit-pill--ok" : replaced > 0 ? "mcit-pill--mixed" : "mcit-pill--warn")}>
                                        {replaced}/{proj.items.filter((i) => i.action !== "skipped").length} replaced
                                    </span>
                                )}
                            </div>
                            {proj.skipped && <div className="mcit-proj-skip">{proj.skipped}</div>}
                            {proj.items.map((it, idx) => (
                                <div key={idx} className={"mcit-item mcit-item--" + it.action}>
                                    {it.action === "replaced" ? <CheckCircle2 size={13} /> : it.action === "no-match" ? <AlertTriangle size={13} /> : <CircleSlash size={13} />}
                                    <div className="mcit-item-text">
                                        <span className="mcit-item-name">{it.name}</span>
                                        {it.action === "replaced" && it.newName && (
                                            <span className="mcit-item-detail">→ {it.newName}</span>
                                        )}
                                        {it.action !== "replaced" && it.reason && (
                                            <span className="mcit-item-detail">{it.reason}</span>
                                        )}
                                    </div>
                                    <span className="mcit-item-folder">{it.folder}</span>
                                </div>
                            ))}
                            {!proj.skipped && proj.items.length === 0 && (
                                <div className="mcit-proj-skip">No PNG/JPG footage items found in its target folders.</div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="mcit-foot">
                <span className="mcit-foot-paths" title={(report.aepFolder || "") + "\n" + (report.imageFolder || "")}>
                    {report.message}
                </span>
                {onApply ? (
                    <>
                        <button className="mcit-cancel" disabled={applying} onClick={onClose}>Cancel</button>
                        <button className="mcit-done" disabled={applying} onClick={onApply}>
                            {applying ? "Applying…" : `Apply — replace ${report.replaced ?? 0} image${(report.replaced ?? 0) === 1 ? "" : "s"}`}
                        </button>
                    </>
                ) : (
                    <button className="mcit-done" onClick={onClose}>Done</button>
                )}
            </div>
        </div>
    </div>
);

export default McItReportModal;
