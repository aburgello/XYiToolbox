// =============================================================================
// src/js/main/tools/TimesheetTracker.tsx
// -----------------------------------------------------------------------------
// Two modes, switched via the segmented toggle at the top:
//
//  • Quick  — the original single-file timer (ported 1:1 from
//    toolset/XYi_AE_Timesheet_Link.jsx): START/STOP one project, Generate a
//    one-task version-5 JSON, Copy. Territory is auto-detected (read-only
//    badge, not a manual pick) since aeft.ts already resolves it from the
//    saved file's folder path -- there's nothing for a manual list to add
//    except a chance to pick the wrong one.
//
//  • Batch  — for working through a whole delivery batch (e.g. "Batch_01 ·
//    France") file by file. All state/timing lives in the shared
//    useTimeTracker() store (hooks/useTimeTracker.ts), NOT locally -- that's
//    what lets the HomeScreen quick-launch Droplet and this full page drive
//    the exact same running batch, and what lets tracking keep going in the
//    background while the user works in a completely different screen.
//    "Generate Batch JSON" emits ONE version-5 payload with a task PER file
//    (same shape the existing website pipeline already ingests).
//
// Category list is filtered to "Digital - …" entries only in both modes --
// this studio's AE work is never logged under the print/admin/HR categories
// TS_CATEGORIES also contains, so showing all ~47 was pure noise.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, FileJson, ClipboardCopy, AlertCircle, Plus, Trash2, X, Boxes, ChevronLeft, Circle, Briefcase, MapPin, RefreshCw, LayoutList } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import Tooltip from "../Tooltip";
import SegmentedToggle from "../SegmentedToggle";
import { promptDialog, confirmDialog } from "../Dialog";
import { useTimeTracker, digitalCategories, defaultCategoryFor, type BatchFile, type Batch } from "../hooks/useTimeTracker";
import "../shared.scss";
import "./formTool.scss";
import "./TimesheetTracker.scss";

function formatTime(totalSeconds: number): string {
    const s = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = (n: number) => (n < 10 ? "0" + n : String(n));
    return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
}

// 1:1 with the original's getISODate(): LOCAL time components with a
// hardcoded ".000Z" suffix. Not real UTC -- but the downstream React app
// expects exactly this format, so it's kept, quirk and all.
function getISODate(d: Date): string {
    const pad = (n: number) => (n < 10 ? "0" + n : String(n));
    return (
        d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" +
        pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + ".000Z"
    );
}

// Same tiny helper as DeliveryHub.tsx's codeToFlag -- duplicated rather than
// factored out, consistent with this codebase's existing convention of
// small pure helpers living next to their one real usage.
function codeToFlag(code: string): string {
    const [a, b] = code.toUpperCase();
    return String.fromCodePoint(0x1F1E6 + a.charCodeAt(0) - 65, 0x1F1E6 + b.charCodeAt(0) - 65);
}

// Shared version-5 task builder -- one task per (jobNumber, seconds) entry,
// so both Quick (one file) and Batch (many files) emit the identical shape
// the website already ingests.
function buildTask(d: Date, id: number, jobNumber: string, territory: string, category: string, notes: string, rawSeconds: number) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const m = d.getMinutes();
    const ampm = d.getHours() >= 12 ? " PM" : " AM";
    let h = d.getHours() % 12;
    h = h ? h : 12;
    const timeString = h + ":" + (m < 10 ? "0" + m : m) + ampm;
    return {
        id, jobNumber, territory, category, notes,
        dayOfWeek: days[d.getDay()],
        rawSeconds,
        additionalSeconds: 0,
        date: d.getMonth() + 1 + "/" + d.getDate() + "/" + d.getFullYear(),
        timeLogged: timeString,
    };
}

// ── Small shared bits ───────────────────────────────────────────────────────

const TerritoryBadge: React.FC<{ name: string; code: string | null; onRefresh?: () => void }> = ({ name, code, onRefresh }) => (
    <div className="ts-territory-badge">
        <MapPin size={12} className="ts-territory-icon" />
        {name ? (
            <span className="ts-territory-text">
                {code && <span className="ts-flag">{codeToFlag(code)}</span>} {name}
            </span>
        ) : (
            <span className="ts-territory-text muted">Not detected yet</span>
        )}
        {onRefresh && (
            <Tooltip text="Re-detect from the currently open file">
                <button className="ts-territory-refresh" onClick={onRefresh}><RefreshCw size={11} /></button>
            </Tooltip>
        )}
    </div>
);

const CategorySelect: React.FC<{ value: string; options: string[]; onChange: (v: string) => void; id: string }> = ({ value, options, onChange, id }) => (
    <div className="ts-category-select">
        <LayoutList size={13} className="ts-category-icon" />
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((c) => (<option key={c} value={c}>{c.replace(/^Digital - /, "")}</option>))}
        </select>
    </div>
);

const TimesheetTrackerTool = () => {
    const [mode, setMode] = useState<"quick" | "batch">("quick");
    const tracker = useTimeTracker();
    const categoryOptions = digitalCategories(tracker.categories);

    const [statusLine, setStatusLine] = useState("Ready. Open a saved project.");
    const [jobLabel, setJobLabel] = useState("Job: ...");
    const [quickTerritory, setQuickTerritory] = useState<{ name: string; code: string | null }>({ name: "", code: null });
    const [quickCategory, setQuickCategory] = useState("");
    const [displaySeconds, setDisplaySeconds] = useState(0);
    const [output, setOutput] = useState("");
    const [error, setError] = useState<string | null>(null);

    // Default the quick-mode category once the real list arrives.
    useEffect(() => {
        if (!quickCategory && categoryOptions.length) setQuickCategory(defaultCategoryFor(categoryOptions));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tracker.categories]);

    // --- Quick-mode timing (unchanged behaviour) ----------------------------
    const startTimeRef = useRef(0);
    const accumulatedRef = useRef(0);
    const jobDataRef = useRef({ jobString: "", compName: "" });
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

    const start = async () => {
        setError(null);
        try {
            const info = await evalTS("timesheetStartInfo");
            if (info === undefined) throw new Error("no bridge");
            if (!info.success) { setError(info.error || "Something went wrong."); return; }
            jobDataRef.current = { jobString: info.jobString || "Unknown Job", compName: info.compName || "No Active Comp" };

            if (info.territory) {
                let code: string | null = null;
                try { code = await evalTS("getTerritoryCountryCode", info.territory); } catch { /* decorative */ }
                setQuickTerritory({ name: info.territory, code });
            }

            startTimeRef.current = Date.now();
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => {
                setDisplaySeconds(accumulatedRef.current + Math.round((Date.now() - startTimeRef.current) / 1000));
            }, 1000);

            setStatusLine("TRACKING TIME... (Active)");
            setJobLabel(jobDataRef.current.jobString);
        } catch (e) {
            setError("No CEP bridge detected — open this panel inside After Effects to run it.");
        }
    };

    const stop = () => {
        if (startTimeRef.current === 0) return;
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        accumulatedRef.current += Math.round((Date.now() - startTimeRef.current) / 1000);
        startTimeRef.current = 0;
        setDisplaySeconds(accumulatedRef.current);
        setStatusLine("PAUSED. Total: " + accumulatedRef.current + " seconds.");
    };

    const generate = async () => {
        setError(null);
        if (!jobDataRef.current.jobString && accumulatedRef.current === 0 && startTimeRef.current === 0) {
            setError("You need to track some time first!");
            return;
        }
        if (startTimeRef.current !== 0) stop();

        let projFileName: string | null = null;
        try { projFileName = await evalTS("timesheetProjectFileName"); } catch (e) { /* preview */ }

        const d = new Date();
        const task = buildTask(
            d, d.getTime(), jobDataRef.current.jobString,
            quickTerritory.name || "INTL - UNI",
            quickCategory || defaultCategoryFor(categoryOptions),
            "Auto-logged from AE file: " + (projFileName || "Unsaved Project") + " | Comp: " + jobDataRef.current.compName,
            accumulatedRef.current
        );
        const payload = { version: 5, exportDate: getISODate(d), rawTasks: [task], jobOptions: [jobDataRef.current.jobString] };

        setOutput(JSON.stringify(payload));
        setStatusLine("JSON Generated! Ready to copy.");

        accumulatedRef.current = 0;
        jobDataRef.current = { jobString: "", compName: "" };
        setDisplaySeconds(0);
        setJobLabel("Job: --");
        setQuickTerritory({ name: "", code: null });
    };

    const copy = async () => {
        setError(null);
        if (!output) { setError("Nothing to copy! Generate JSON first."); return; }
        try {
            const result = await evalTS("timesheetCopyToClipboard", output);
            if (result === undefined) throw new Error("no bridge");
            setStatusLine(result.success ? "Copied to clipboard!" : "Copy failed: " + (result.error || "unknown error"));
        } catch (e) {
            setError("No CEP bridge detected — open this panel inside After Effects to run it.");
        }
    };

    // =====================================================================
    // Batch mode -- thin view over useTimeTracker()'s shared store
    // =====================================================================
    const newBatch = async () => {
        setError(null);
        let suggestion = "Batch";
        try {
            const info = await evalTS("timesheetActiveFile" as any);
            if (info && info.folderName) suggestion = info.folderName;
        } catch (e) { /* preview */ }
        const name = await promptDialog("Name this batch (auto-filled from the open file's folder):", suggestion);
        if (!name) return;
        await tracker.createBatch(name, defaultCategoryFor(categoryOptions));
        setOutput("");
    };

    const openBatch = (b: Batch) => { tracker.openBatch(b.id); setOutput(""); };
    const backToBatchList = () => { tracker.backToList(); setOutput(""); };

    const removeBatch = async (b: Batch) => {
        if (!(await confirmDialog(`Delete batch "${b.name}" and its tracked times?\n\nThis only clears the saved time entries — no files on disk are touched.`))) return;
        tracker.removeBatch(b.id);
    };

    const editFileMinutes = async (f: BatchFile) => {
        const current = Math.round(f.seconds / 60);
        const input = await promptDialog(`Adjust logged minutes for "${f.name}":`, String(current));
        if (input === null) return;
        const mins = parseFloat(input);
        if (isNaN(mins) || mins < 0) { setError("Enter a valid number of minutes."); return; }
        tracker.setFileSeconds(f.path, mins * 60);
    };

    const generateBatch = async () => {
        setError(null);
        const b = tracker.activeBatch;
        if (!b) return;
        if (tracker.running) tracker.pauseTracking();
        const timed = b.files.filter((f) => Math.round(tracker.fileLiveSeconds(f)) > 0);
        if (timed.length === 0) { setError("No time tracked in this batch yet."); return; }

        const d = new Date();
        const base = d.getTime();
        const rawTasks = timed.map((f, i) =>
            buildTask(
                d, base + i,
                f.jobString || "Unknown Job",
                b.territoryName || "INTL - UNI",
                b.categoryName || defaultCategoryFor(categoryOptions),
                "Batch: " + b.name + " | File: " + f.name,
                Math.round(f.seconds)
            )
        );
        const jobOptions: string[] = [];
        for (const t of rawTasks) if (jobOptions.indexOf(t.jobNumber) === -1) jobOptions.push(t.jobNumber);

        const payload = { version: 5, exportDate: getISODate(d), rawTasks, jobOptions };
        setOutput(JSON.stringify(payload));
        setStatusLine(`Batch JSON generated — ${rawTasks.length} file${rawTasks.length === 1 ? "" : "s"}.`);
    };

    const activeBatch = tracker.activeBatch;

    return (
        <div className="form-tool timesheet-tracker">
            <SegmentedToggle
                name="ts-mode"
                value={mode}
                onChange={(v) => setMode(v as "quick" | "batch")}
                options={[{ value: "quick", label: "Quick" }, { value: "batch", label: "Batch" }]}
            />

            {mode === "quick" ? (
                <>
                    <p className="ts-status">{statusLine}</p>

                    <div className="ts-info-row">
                        <div className="ts-job-chip">
                            <Briefcase size={12} />
                            <Tooltip text={jobLabel}><span>{jobLabel}</span></Tooltip>
                        </div>
                        <TerritoryBadge name={quickTerritory.name} code={quickTerritory.code} />
                    </div>

                    <label className="ts-field-label" htmlFor="ts-category">Category</label>
                    <CategorySelect id="ts-category" value={quickCategory || defaultCategoryFor(categoryOptions)} options={categoryOptions} onChange={setQuickCategory} />

                    <div className="ts-timer">{formatTime(displaySeconds)}</div>

                    <div className="button-row">
                        <button onClick={start}><Play size={14} /> START</button>
                        <button onClick={stop}><Pause size={14} /> STOP</button>
                    </div>

                    <hr className="divider" />

                    <textarea className="ts-output" readOnly value={output} placeholder="Generated JSON appears here…" />
                    <div className="button-row">
                        <button onClick={generate}><FileJson size={14} /> 1. Generate JSON</button>
                        <button onClick={copy}><ClipboardCopy size={14} /> 2. Copy to Clipboard</button>
                    </div>
                </>
            ) : !activeBatch ? (
                // ── Batch list ──────────────────────────────────────────────
                <div className="ts-batch-list">
                    <div className="ts-batch-list-head">
                        <span>Batches</span>
                        <button className="ts-new-batch" onClick={newBatch}><Plus size={14} /> New Batch</button>
                    </div>
                    {tracker.batches.length === 0 ? (
                        <div className="ts-batch-empty">
                            <Boxes size={22} />
                            <span>No batches yet. Start one for a delivery folder, then move through its files — time is tracked per file automatically.</span>
                        </div>
                    ) : (
                        tracker.batches.map((b) => (
                            <div key={b.id} className="ts-batch-card" onClick={() => openBatch(b)}>
                                <Boxes size={14} className="ts-batch-card-icon" />
                                <div className="ts-batch-card-main">
                                    <span className="ts-batch-card-name">{b.name}</span>
                                    <span className="ts-batch-card-meta">{b.files.length} file{b.files.length === 1 ? "" : "s"} · {formatTime(tracker.batchTotalSeconds(b))}</span>
                                </div>
                                <Tooltip text="Delete batch">
                                    <button className="ts-batch-card-del" onClick={(e) => { e.stopPropagation(); removeBatch(b); }}><Trash2 size={13} /></button>
                                </Tooltip>
                            </div>
                        ))
                    )}
                </div>
            ) : (
                // ── Active batch ────────────────────────────────────────────
                <div className="ts-batch">
                    <div className="ts-batch-head">
                        <button className="ts-batch-back" onClick={backToBatchList}><ChevronLeft size={14} /> Batches</button>
                        <span className="ts-batch-title">{activeBatch.name}</span>
                    </div>

                    <div className="ts-info-row">
                        <TerritoryBadge name={activeBatch.territoryName} code={activeBatch.territoryCode} onRefresh={tracker.refreshTerritory} />
                    </div>
                    <label className="ts-field-label" htmlFor="ts-b-category">Category</label>
                    <CategorySelect id="ts-b-category" value={activeBatch.categoryName || defaultCategoryFor(categoryOptions)} options={categoryOptions} onChange={tracker.setCategory} />

                    <div className="ts-timer">{formatTime(tracker.batchTotal)}</div>
                    <div className="button-row">
                        {tracker.running
                            ? <button onClick={tracker.pauseTracking}><Pause size={14} /> Pause</button>
                            : <button onClick={tracker.startTracking}><Play size={14} /> Start Tracking</button>}
                    </div>
                    <p className="ts-batch-hint">
                        {!tracker.running
                            ? "Start, then open each file in this batch. Time is auto-logged per file."
                            : tracker.activePath
                                ? "Tracking the open file. Switch files in AE and the clock follows."
                                : "Clock running — open a saved AE project to start logging time to it."}
                    </p>

                    <div className="ts-file-list">
                        {activeBatch.files.length === 0 ? (
                            <p className="ts-file-empty">No files tracked yet.</p>
                        ) : (
                            activeBatch.files.map((f) => {
                                const isActive = tracker.running && f.path === tracker.activePath;
                                return (
                                    <div key={f.path} className={isActive ? "ts-file-row active" : "ts-file-row"}>
                                        <Circle size={8} className={isActive ? "ts-file-dot live" : "ts-file-dot"} />
                                        <Tooltip text={f.path}>
                                            <span className="ts-file-name">{f.name}</span>
                                        </Tooltip>
                                        <Tooltip text="Adjust minutes">
                                            <button className="ts-file-time" onClick={() => editFileMinutes(f)}>{formatTime(tracker.fileLiveSeconds(f))}</button>
                                        </Tooltip>
                                        <Tooltip text="Remove from batch">
                                            <button className="ts-file-del" onClick={() => tracker.removeFile(f.path)}><X size={12} /></button>
                                        </Tooltip>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <hr className="divider" />

                    <textarea className="ts-output" readOnly value={output} placeholder="Generated batch JSON appears here…" />
                    <div className="button-row">
                        <button onClick={generateBatch}><FileJson size={14} /> Generate Batch JSON</button>
                        <button onClick={copy}><ClipboardCopy size={14} /> Copy</button>
                    </div>
                </div>
            )}

            {error && (
                <div className="tool-status tool-status-error">
                    <AlertCircle size={14} />
                    <span style={{ whiteSpace: "pre-wrap" }}>{error}</span>
                </div>
            )}
        </div>
    );
};

export default TimesheetTrackerTool;
