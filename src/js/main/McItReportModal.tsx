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
import { Image as ImageIcon, X, CheckCircle2, AlertTriangle, CircleSlash, CheckSquare, Square, Wrench, FolderSearch, Undo2 } from "lucide-react";
import { evalTS } from "../lib/utils/bolt";
import "./McItReportModal.scss";

export interface McItemRep {
    folder: string;
    name: string;
    action: "replaced" | "no-match" | "skipped";
    newName?: string;
    reason?: string;
    key?: string; // folder|name — what an override is keyed by (see mcIt())
    candidates?: { name: string; path: string }[]; // dry run + no-match only
    manual?: boolean; // this replacement came from a user override
}

// A manual fix the user made in the preview, keyed aep -> itemKey.
type Overrides = Record<string, Record<string, { name: string; path: string }>>;

// Reports persisted before item keys existed still open fine — derive the same
// key the host would have written.
const itemKey = (it: McItemRep) => it.key || it.folder + "|" + it.name;

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
    // dialogs). `selected` is the list of .aep filenames still ticked in the
    // preview; the host passes it straight through so an unticked project is
    // never opened at all (the filtering happens in mcIt(), not by running
    // everything and discarding results).
    const apply = async (selected: string[], overrides: Overrides) => {
        if (!report) return;
        setApplying(true);
        try {
            // Overrides go over as {aep: {itemKey: path}} — the display name is
            // panel-side only; the host re-reads the file itself.
            const paths: Record<string, Record<string, string>> = {};
            Object.keys(overrides).forEach((aep) => {
                const forAep: Record<string, string> = {};
                Object.keys(overrides[aep]).forEach((k) => { forAep[k] = overrides[aep][k].path; });
                if (Object.keys(forAep).length) paths[aep] = forAep;
            });
            const res = await evalTS("mcIt", report.aepFolder || "", report.imageFolder || "", false, JSON.stringify(selected), JSON.stringify(paths));
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

const McItReportModal: React.FC<{ report: McReport; onClose: () => void; onApply?: (selected: string[], overrides: Overrides) => void; applying?: boolean }> = ({ report, onClose, onApply, applying }) => {
    // Which projects are UNticked, keyed by .aep filename. Absent = included,
    // so a fresh preview starts with everything selected (the previous
    // behaviour) and unticking is the deliberate act.
    const [excluded, setExcluded] = useState<Record<string, boolean>>({});
    // Manual fixes for items the matcher couldn't place — see the "Fix" row
    // rendered under each no-match item below.
    const [overrides, setOverrides] = useState<Overrides>({});
    // Which no-match item currently has its candidate list open (aep + key).
    const [fixing, setFixing] = useState<string | null>(null);
    const [pickError, setPickError] = useState<string | null>(null);

    const setOverride = (aep: string, key: string, choice: { name: string; path: string } | null) =>
        setOverrides((prev) => {
            const forAep = { ...(prev[aep] || {}) };
            if (choice) forAep[key] = choice;
            else delete forAep[key];
            return { ...prev, [aep]: forAep };
        });

    // Native file picker, for when the right image isn't in the suggestions at
    // all. Starts in the folder this run scanned so it's one click away.
    const browseFor = async (aep: string, key: string) => {
        setPickError(null);
        try {
            const res = await evalTS("mcItPickImage", report.imageFolder || "");
            if (!res?.success) { setPickError(res?.error || "Couldn't open the file picker."); return; }
            if (!res.path) return; // cancelled
            setOverride(aep, key, { name: res.name || res.path, path: res.path });
            setFixing(null);
        } catch (e) {
            setPickError("No connection to After Effects — can't open a file picker from here.");
        }
    };

    const projects = report.projects || [];
    const ovOf = (aep: string, key: string) => overrides[aep]?.[key];
    const manualCount = (p: McProjectRep) =>
        p.items.filter((i) => i.action === "no-match" && ovOf(p.aep, itemKey(i))).length;
    // A project with nothing to replace can't be "applied" either way, so only
    // ones that would actually change something are selectable — including one
    // whose ONLY change is a manual fix the user just made.
    const actionable = projects.filter((p) => !p.skipped && (p.items.some((i) => i.action === "replaced") || manualCount(p) > 0));
    const isOn = (aep: string) => !excluded[aep];
    const selected = actionable.filter((p) => isOn(p.aep)).map((p) => p.aep);
    const selectedReplacements = actionable
        .filter((p) => isOn(p.aep))
        .reduce((n, p) => n + p.items.filter((i) => i.action === "replaced").length + manualCount(p), 0);
    const allOn = selected.length === actionable.length;
    const totalManual = projects.reduce((n, p) => n + manualCount(p), 0);

    return (
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
                {onApply && actionable.length > 1 && (
                    <button
                        className="mcit-selectall"
                        onClick={() => {
                            const next: Record<string, boolean> = {};
                            if (allOn) actionable.forEach((p) => { next[p.aep] = true; });
                            setExcluded(next);
                        }}
                    >
                        {allOn ? "Deselect all" : "Select all"}
                    </button>
                )}
                <button className="mcit-close" onClick={onClose}><X size={16} /></button>
            </div>

            <div className="mcit-body">
                {projects.map((proj) => {
                    const replaced = proj.items.filter((i) => i.action === "replaced").length;
                    const misses = proj.items.filter((i) => i.action === "no-match").length;
                    const selectable = onApply && !proj.skipped && replaced > 0;
                    const off = selectable && !isOn(proj.aep);
                    return (
                        <div key={proj.aep} className={"mcit-proj" + (off ? " mcit-proj--off" : "")}>
                            <div className="mcit-proj-head">
                                {selectable && (
                                    <button
                                        type="button"
                                        className="mcit-proj-check"
                                        onClick={() => setExcluded((prev) => ({ ...prev, [proj.aep]: !prev[proj.aep] }))}
                                        title={off ? "Skip this project — click to include it" : "Included — click to skip it"}
                                        aria-label={off ? `Include ${proj.aep}` : `Skip ${proj.aep}`}
                                    >
                                        {off ? <Square size={13} /> : <CheckSquare size={13} />}
                                    </button>
                                )}
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
                            {proj.items.map((it, idx) => {
                                const key = itemKey(it);
                                const fix = it.action === "no-match" ? ovOf(proj.aep, key) : undefined;
                                // Manual fixing is only offered while previewing:
                                // after a real run there is nothing left to apply.
                                const fixable = !!onApply && it.action === "no-match";
                                const openId = proj.aep + " " + key;
                                return (
                                <div key={idx} className={"mcit-item mcit-item--" + (fix ? "replaced" : it.action)}>
                                    {fix || it.action === "replaced" ? <CheckCircle2 size={13} /> : it.action === "no-match" ? <AlertTriangle size={13} /> : <CircleSlash size={13} />}
                                    <div className="mcit-item-text">
                                        <span className="mcit-item-name">{it.name}</span>
                                        {it.action === "replaced" && it.newName && (
                                            <span className="mcit-item-detail">→ {it.newName}{it.manual ? " · picked by hand" : ""}</span>
                                        )}
                                        {fix && (
                                            <span className="mcit-item-detail">
                                                → {fix.name}
                                                <span className="mcit-manual-tag">your pick</span>
                                                <button type="button" className="mcit-fix-undo" onClick={() => setOverride(proj.aep, key, null)} title="Undo this pick">
                                                    <Undo2 size={11} /> undo
                                                </button>
                                            </span>
                                        )}
                                        {!fix && it.action !== "replaced" && it.reason && (
                                            <span className="mcit-item-detail">{it.reason}</span>
                                        )}
                                        {fixable && !fix && (
                                            <div className="mcit-fix">
                                                <button
                                                    type="button"
                                                    className="mcit-fix-toggle"
                                                    onClick={() => setFixing(fixing === openId ? null : openId)}
                                                    aria-expanded={fixing === openId}
                                                >
                                                    <Wrench size={11} /> {fixing === openId ? "Close" : "Pick the right file…"}
                                                </button>
                                                {fixing === openId && (
                                                    <div className="mcit-fix-panel">
                                                        {it.candidates && it.candidates.length > 0 ? (
                                                            <>
                                                                <div className="mcit-fix-hint">Closest files in the image folder — click one to use it:</div>
                                                                {it.candidates.map((c) => (
                                                                    <button
                                                                        key={c.path}
                                                                        type="button"
                                                                        className="mcit-fix-cand"
                                                                        title={c.path}
                                                                        onClick={() => { setOverride(proj.aep, key, c); setFixing(null); }}
                                                                    >
                                                                        {c.name}
                                                                    </button>
                                                                ))}
                                                            </>
                                                        ) : (
                                                            <div className="mcit-fix-hint">No same-type images to suggest from that folder.</div>
                                                        )}
                                                        <button type="button" className="mcit-fix-browse" onClick={() => browseFor(proj.aep, key)}>
                                                            <FolderSearch size={11} /> Choose a file…
                                                        </button>
                                                        {pickError && <div className="mcit-fix-error">{pickError}</div>}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <span className="mcit-item-folder">{it.folder}</span>
                                </div>
                                );
                            })}
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
                        <button className="mcit-done" disabled={applying || selected.length === 0} onClick={() => onApply(selected, overrides)}>
                            {applying
                                ? "Applying…"
                                : selected.length === 0
                                    ? "Nothing selected"
                                    : `Apply — replace ${selectedReplacements} image${selectedReplacements === 1 ? "" : "s"}${totalManual > 0 ? ` (${totalManual} by hand)` : ""} in ${selected.length} project${selected.length === 1 ? "" : "s"}`}
                        </button>
                    </>
                ) : (
                    <button className="mcit-done" onClick={onClose}>Done</button>
                )}
            </div>
        </div>
    </div>
    );
};

export default McItReportModal;
