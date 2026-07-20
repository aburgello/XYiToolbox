// =============================================================================
// src/js/main/PreFlightModal.tsx
// -----------------------------------------------------------------------------
// The interactive result view for the Pre-Flight audit (Toolset grid, "qc"
// group -> preflight.ts's preflightAudit()). Replaces the old plain
// alertDialog() text dump: missing footage is now a proper per-item list with
// the full filename, its expected on-disk path, and two actions --
//   - Reveal:  opens the nearest existing ancestor folder of the expected
//              path in Finder/Explorer (the file itself is gone, so we can't
//              reveal it directly) -> preflightRevealMissing(id).
//   - Replace: native file picker to relink the item, THEN auto-relinks any
//              other missing item whose expected filename matches a file in
//              the same folder you picked from -> preflightReplaceMissing(id).
//
// Same singleton-via-module-scope + <Host/> pattern as Dialog.tsx (mounted
// once in main.tsx's app-shell): openPreFlight(report) shows the modal and
// resolves when it's dismissed. Effects/fonts stay read-only summaries --
// a missing plugin/font can't be relinked from a file the way footage can.
// =============================================================================
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FolderOpen, RefreshCw, FileWarning, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { evalTSSafe } from "../lib/utils/evalTSSafe";
import { evalTS } from "../lib/utils/bolt";
import "./PreFlightModal.scss";

export interface PreflightFootageIssue {
    id: number;
    name: string;
    path: string;
    fileName: string;
}
export interface PreflightEffectIssue {
    matchName: string;
    label: string;
    usedIn: string[];
}
export interface PreflightReport {
    projectName: string;
    compCount: number;
    footageCount: number;
    missingFootage: PreflightFootageIssue[];
    missingEffects: PreflightEffectIssue[];
    fontsChecked: boolean;
    missingFonts: string[];
    fontsUsed: number;
}

let pushReport: ((report: PreflightReport, resolve: () => void) => void) | null = null;

// Show the interactive Pre-Flight modal; resolves once the user closes it.
export function openPreFlight(report: PreflightReport): Promise<void> {
    return new Promise((resolve) => {
        pushReport?.(report, resolve);
    });
}

type RowState = { busy?: "reveal" | "replace"; done?: string; error?: string };

export const PreFlightHost: React.FC = () => {
    const [report, setReport] = useState<PreflightReport | null>(null);
    const [resolveFn, setResolveFn] = useState<{ fn: () => void } | null>(null);
    const [rowStates, setRowStates] = useState<{ [id: number]: RowState }>({});
    const [rescanning, setRescanning] = useState(false);

    useEffect(() => {
        pushReport = (r, resolve) => {
            setReport(r);
            setRowStates({});
            setResolveFn({ fn: resolve });
        };
        return () => {
            pushReport = null;
        };
    }, []);

    useEffect(() => {
        if (!report) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [report]);

    if (!report) return null;

    const close = () => {
        resolveFn?.fn();
        setReport(null);
        setResolveFn(null);
    };

    const setRow = (id: number, s: RowState) => setRowStates((prev) => ({ ...prev, [id]: s }));

    const handleReveal = async (item: PreflightFootageIssue) => {
        setRow(item.id, { busy: "reveal" });
        const res = (await evalTSSafe("preflightRevealMissing", item.id)) as { success?: boolean; error?: string } | undefined;
        if (!res) setRow(item.id, { error: "No connection to After Effects." });
        else if (!res.success) setRow(item.id, { error: res.error || "Could not reveal folder." });
        else setRow(item.id, {});
    };

    const handleReplace = async (item: PreflightFootageIssue) => {
        setRow(item.id, { busy: "replace" });
        // Raw evalTS, NOT evalTSSafe: preflightReplaceMissing pops a native
        // File.openDialog that BLOCKS the bridge until the user picks/cancels,
        // and evalTSSafe's 15s timeout would misfire (reporting "AE busy"
        // while the relink actually succeeded) if they take their time in the
        // picker -- same reasoning DeliveryHub's render-watch uses raw evalTS.
        let res:
            | { success?: boolean; error?: string; cancelled?: boolean; relinked?: string[] }
            | undefined;
        try {
            res = (await evalTS("preflightReplaceMissing", item.id as any)) as any;
        } catch (e: any) {
            setRow(item.id, { error: e?.message || "No connection to After Effects." });
            return;
        }
        if (res === undefined) {
            setRow(item.id, { error: "No connection to After Effects." });
            return;
        }
        if (res.cancelled) {
            setRow(item.id, {}); // user dismissed the picker -- no fuss
            return;
        }
        if (!res.success) {
            setRow(item.id, { error: res.error || "Relink failed." });
            return;
        }
        // Drop every relinked item (the clicked one AND auto-relinked siblings)
        // from the missing list; show a small confirmation on any that remain.
        const relinkedNames = res.relinked || [item.name];
        setReport((prev) =>
            prev
                ? { ...prev, missingFootage: prev.missingFootage.filter((f) => relinkedNames.indexOf(f.name) === -1) }
                : prev
        );
        const siblingCount = relinkedNames.length - 1;
        setRow(item.id, {
            done:
                siblingCount > 0
                    ? `Relinked, plus ${siblingCount} sibling${siblingCount === 1 ? "" : "s"} in that folder`
                    : "Relinked",
        });
    };

    const handleRescan = async () => {
        setRescanning(true);
        const res = (await evalTSSafe("preflightAudit")) as { success?: boolean; report?: PreflightReport } | undefined;
        setRescanning(false);
        if (res && res.success && res.report) {
            setReport(res.report);
            setRowStates({});
        }
    };

    const footageClear = report.missingFootage.length === 0;
    const effectsClear = report.missingEffects.length === 0;

    return (
        <AnimatePresence>
            <motion.div
                className="preflight-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={close}
            >
                <motion.div
                    className="preflight-card"
                    initial={{ opacity: 0, scale: 0.96, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="preflight-head">
                        <div className="preflight-title-row">
                            <FileWarning size={16} className="preflight-title-icon" />
                            <h2 className="preflight-title">Pre-Flight</h2>
                            <button
                                className="preflight-rescan"
                                onClick={handleRescan}
                                disabled={rescanning}
                                title="Re-run the audit"
                            >
                                {rescanning ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                                Re-scan
                            </button>
                        </div>
                        <p className="preflight-project" title={report.projectName}>
                            {report.projectName}
                        </p>
                        <p className="preflight-counts">
                            {report.compCount} comp{report.compCount === 1 ? "" : "s"} · {report.footageCount} footage item
                            {report.footageCount === 1 ? "" : "s"}
                        </p>
                    </div>

                    <div className="preflight-body">
                        {/* Missing footage -- the interactive section */}
                        <section className="preflight-section">
                            <div className={"preflight-section-head " + (footageClear ? "ok" : "bad")}>
                                {footageClear ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                                {footageClear
                                    ? "Footage: nothing missing"
                                    : `Missing footage (${report.missingFootage.length})`}
                            </div>
                            {!footageClear && (
                                <ul className="preflight-list">
                                    {report.missingFootage.map((item) => {
                                        const st = rowStates[item.id] || {};
                                        return (
                                            <li className="preflight-item" key={item.id}>
                                                <div className="preflight-item-info">
                                                    <span className="preflight-item-name" title={item.name}>
                                                        {item.name}
                                                    </span>
                                                    {item.path && (
                                                        <span className="preflight-item-path" title={item.path}>
                                                            {item.path}
                                                        </span>
                                                    )}
                                                    {st.done && (
                                                        <span className="preflight-item-done">
                                                            <CheckCircle2 size={11} /> {st.done}
                                                        </span>
                                                    )}
                                                    {st.error && (
                                                        <span className="preflight-item-error">
                                                            <AlertCircle size={11} /> {st.error}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="preflight-item-actions">
                                                    <button
                                                        onClick={() => handleReveal(item)}
                                                        disabled={!!st.busy}
                                                        title="Open the nearest existing folder in Finder"
                                                    >
                                                        {st.busy === "reveal" ? (
                                                            <Loader2 size={12} className="spin" />
                                                        ) : (
                                                            <FolderOpen size={12} />
                                                        )}
                                                        Reveal
                                                    </button>
                                                    <button
                                                        className="preflight-replace"
                                                        onClick={() => handleReplace(item)}
                                                        disabled={!!st.busy}
                                                        title="Pick the correct file (also relinks matching siblings in that folder)"
                                                    >
                                                        {st.busy === "replace" ? (
                                                            <Loader2 size={12} className="spin" />
                                                        ) : (
                                                            <RefreshCw size={12} />
                                                        )}
                                                        Replace…
                                                    </button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>

                        {/* Effects -- read-only */}
                        <section className="preflight-section">
                            <div className={"preflight-section-head " + (effectsClear ? "ok" : "bad")}>
                                {effectsClear ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                                {effectsClear
                                    ? "Effects: everything used is installed here"
                                    : `Effects not installed on this machine (${report.missingEffects.length})`}
                            </div>
                            {!effectsClear && (
                                <ul className="preflight-list">
                                    {report.missingEffects.map((fx, i) => (
                                        <li className="preflight-item preflight-item--static" key={i}>
                                            <div className="preflight-item-info">
                                                <span className="preflight-item-name">{fx.label}</span>
                                                <span className="preflight-item-path">in {fx.usedIn.join(", ")}</span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        {/* Fonts -- read-only */}
                        <section className="preflight-section">
                            <div
                                className={
                                    "preflight-section-head " +
                                    (!report.fontsChecked ? "neutral" : report.missingFonts.length === 0 ? "ok" : "bad")
                                }
                            >
                                {!report.fontsChecked ? (
                                    <AlertCircle size={14} />
                                ) : report.missingFonts.length === 0 ? (
                                    <CheckCircle2 size={14} />
                                ) : (
                                    <AlertCircle size={14} />
                                )}
                                {!report.fontsChecked
                                    ? "Fonts: not checkable on this AE version"
                                    : report.missingFonts.length === 0
                                    ? `Fonts: all ${report.fontsUsed} resolve`
                                    : `Missing fonts (${report.missingFonts.length})`}
                            </div>
                            {report.fontsChecked && report.missingFonts.length > 0 && (
                                <ul className="preflight-list">
                                    {report.missingFonts.map((f, i) => (
                                        <li className="preflight-item preflight-item--static" key={i}>
                                            <div className="preflight-item-info">
                                                <span className="preflight-item-name">{f}</span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </div>

                    <div className="preflight-foot">
                        <button className="preflight-done" onClick={close}>
                            Done
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
