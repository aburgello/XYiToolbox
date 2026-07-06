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
import { Play, Pause, FileJson, ClipboardCopy, AlertCircle, Plus, Trash2, X, Boxes, ChevronLeft, Circle, Briefcase, MapPin, RefreshCw, LayoutList, User } from "lucide-react";
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
// expects exactly this format, so it's kept, quirk and all. Used ONLY for
// the payload's top-level exportDate -- NOT the per-task date field below,
// which the Supabase import path needs as a plain YYYY-MM-DD (see
// getTaskDate()) -- M/D/YYYY matched neither format it recognized and
// silently vanished from view after refresh even though it was saved.
function getISODate(d: Date): string {
    const pad = (n: number) => (n < 10 ? "0" + n : String(n));
    return (
        d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" +
        pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + ".000Z"
    );
}

function getTaskDate(d: Date): string {
    const pad = (n: number) => (n < 10 ? "0" + n : String(n));
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// TS_DEFAULT_JOBS entries (and tsExtractInfoFromPath's "Unknown Job (Code:
// ...)" fallback) are one combined string, "<FilmTitle> : <JobNumber>,
// <ProjectDescription>" -- the Supabase import path does no parsing of its
// own, so these need to land as separate top-level fields. Client isn't
// present anywhere in that source string, so it's returned empty rather
// than guessed. Falls back to putting the whole string in filmTitle if the
// " : " separator isn't found (the "Unknown Job" case).
function parseJobString(jobString: string): { jobNumber: string; filmTitle: string; projectDescription: string } {
    const sepIdx = jobString.indexOf(" : ");
    if (sepIdx === -1) return { jobNumber: "", filmTitle: jobString, projectDescription: "" };
    const filmTitle = jobString.slice(0, sepIdx);
    const rest = jobString.slice(sepIdx + 3);
    const commaIdx = rest.indexOf(", ");
    if (commaIdx === -1) return { jobNumber: rest, filmTitle, projectDescription: "" };
    return { jobNumber: rest.slice(0, commaIdx), filmTitle, projectDescription: rest.slice(commaIdx + 2) };
}

// Same tiny helper as DeliveryHub.tsx's codeToFlag -- duplicated rather than
// factored out, consistent with this codebase's existing convention of
// small pure helpers living next to their one real usage.
function codeToFlag(code: string): string {
    const [a, b] = code.toUpperCase();
    return String.fromCodePoint(0x1F1E6 + a.charCodeAt(0) - 65, 0x1F1E6 + b.charCodeAt(0) - 65);
}

// Shared task builder -- one task per (jobNumber, seconds) entry, so both
// Quick (one file) and Batch (many files) emit the identical shape the
// Supabase import path expects (worked out with the xyi-timesheeter team --
// see the fields below, each here for a specific reason, not just "more
// data"). `id` is generated here rather than passed in: a plain Postgres
// primary key with no server-side generation, needs to be a structurally
// different magnitude than the receiving app's own id scheme (Date.now() +
// a 3-digit random) so collisions are impossible, hence the extra *1000.
function buildTask(
    d: Date,
    jobNumber: string,
    filmTitle: string,
    client: string,
    projectDescription: string,
    territory: string,
    category: string,
    notes: string,
    rawSeconds: number,
    wrikeUserId: string,
) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const m = d.getMinutes();
    const ampm = d.getHours() >= 12 ? " PM" : " AM";
    let h = d.getHours() % 12;
    h = h ? h : 12;
    const timeString = h + ":" + (m < 10 ? "0" + m : m) + ampm;
    return {
        id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
        source: "ae_panel",
        wrikeUserId,
        taskId: null,
        wrikeTimelogId: null,
        jobNumber, filmTitle, client, projectDescription, territory, category, notes,
        dayOfWeek: days[d.getDay()],
        date: getTaskDate(d),
        rawSeconds,
        additionalSeconds: 0,
        // No destination column on import, but harmless to keep -- the
        // receiving app derives its own display time from rawSeconds.
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

// A one-time-per-artist preference, not a per-batch/per-file field -- set
// once, persisted via app.settings (same convention as Useful Folders/tool
// order/favorites), then embedded into every export from here on so the
// Supabase import path can attribute the row to a real Wrike user instead
// of leaving it null.
const WrikeIdField: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
    <div className="ts-wrike-row">
        <User size={13} className="ts-wrike-icon" />
        <input
            className="ts-wrike-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Your Wrike User ID (e.g. IEAAKBTJ)"
            aria-label="Wrike User ID"
        />
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
    const [wrikeUserId, setWrikeUserId] = useState("");

    // Default the quick-mode category once the real list arrives.
    useEffect(() => {
        if (!quickCategory && categoryOptions.length) setQuickCategory(defaultCategoryFor(categoryOptions));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tracker.categories]);

    // Load the artist's saved Wrike User ID once on mount; save on every
    // change (cheap text setting, no need to debounce/require a blur).
    useEffect(() => {
        (async () => {
            try {
                const id = await evalTS("loadWrikeUserId");
                if (typeof id === "string") setWrikeUserId(id);
            } catch { /* preview -- no bridge */ }
        })();
    }, []);

    const updateWrikeUserId = (value: string) => {
        setWrikeUserId(value);
        evalTS("saveWrikeUserId", value).catch(() => { /* preview -- no bridge */ });
    };

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
        const { jobNumber, filmTitle, projectDescription } = parseJobString(jobDataRef.current.jobString);
        const task = buildTask(
            d, jobNumber, filmTitle, "", projectDescription,
            quickTerritory.name || "INTL - UNI",
            quickCategory || defaultCategoryFor(categoryOptions),
            "Auto-logged from AE file: " + (projFileName || "Unsaved Project") + " | Comp: " + jobDataRef.current.compName,
            accumulatedRef.current,
            wrikeUserId
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
        const rawTasks = timed.map((f) => {
            const { jobNumber, filmTitle, projectDescription } = parseJobString(f.jobString || "Unknown Job");
            return buildTask(
                d, jobNumber, filmTitle, "", projectDescription,
                b.territoryName || "INTL - UNI",
                b.categoryName || defaultCategoryFor(categoryOptions),
                "Batch: " + b.name + " | File: " + f.name,
                Math.round(f.seconds),
                wrikeUserId
            );
        });
        // jobOptions keeps the ORIGINAL combined job strings (not the now-split
        // jobNumber field above) -- an unrelated top-level payload field this
        // change didn't touch, so its existing consumer contract stays intact.
        const jobOptions: string[] = [];
        for (const f of timed) if (jobOptions.indexOf(f.jobString || "Unknown Job") === -1) jobOptions.push(f.jobString || "Unknown Job");

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

            <WrikeIdField value={wrikeUserId} onChange={updateWrikeUserId} />

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
