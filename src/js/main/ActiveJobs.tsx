// =============================================================================
// src/js/main/ActiveJobs.tsx
// -----------------------------------------------------------------------------
// The home screen's full-width "Active Jobs" card: what still needs localising,
// one row per territory/batch, click to open it.
//
// IT DOES NOT SCAN. A specs scan walks every territory folder and parses every
// PDF; doing that on the home screen would make the panel's first screen the
// slowest thing in it. CSV Localiser publishes a snapshot whenever it scans,
// runs or re-checks (see its saveActiveJobs effect), and this reads it. That is
// why the header says WHEN it was captured rather than pretending to be live --
// a card that quietly shows week-old numbers as if they were current is worse
// than one that admits its age.
//
// Numbers come from the SAME matchBuiltRows() that tints the rows and unticks
// the built ones in the specs table, so this can never disagree with the tool.
//
// Deliberately no perpetual animation: the entrance is one-shot, matching the
// rest of the always-visible home screen (CLAUDE.md §3).
// =============================================================================
import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Briefcase, ChevronDown, ChevronRight, MapPin, RefreshCw } from "lucide-react";
import { evalTS } from "../lib/utils/bolt";
import Tooltip from "./Tooltip";
import { fetchJobs, refreshJobs, parseJobTitle, type WrikeJob } from "./lib/jobsFeed";

interface ActiveJob {
    territory: string;
    batch: string;
    pdfName: string;
    sourceFolder: string;
    total: number;
    built: number;
}

interface Snapshot {
    capturedAt: number;
    jobs: ActiveJob[];
}

// "3 minutes ago" / "2 days ago". Deliberately coarse: the point is to convey
// staleness at a glance, not a timestamp anyone reads precisely.
function relativeAge(ms: number): string {
    const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (secs < 90) return "just now";
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

interface Props {
    onOpen: () => void;
}

export const ActiveJobs: React.FC<Props> = ({ onOpen }) => {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [loaded, setLoaded] = useState(false);
    // Wrike is the source of TRUTH for what needs doing: a PM can forget to
    // drop a specs PDF, but a task assigned to someone is real work regardless.
    // The specs snapshot stays as the second half of the picture -- it is the
    // only thing that knows what is actually BUILT on disk.
    const [jobs, setJobs] = useState<WrikeJob[] | null>(null);
    const [jobsMock, setJobsMock] = useState(false);
    const [jobsError, setJobsError] = useState<string | undefined>(undefined);
    const [busy, setBusy] = useState(false);
    // Which member this station belongs to, so "assigned to me" is a local
    // filter rather than an auth question -- every member can read the whole
    // studio's Wrike, so the feed returns everything and we narrow it here.
    const [owner, setOwner] = useState("");
    const [mineOnly, setMineOnly] = useState(true);
    // Collapsed by default. The four category cards are the home screen's
    // primary navigation and this must not compete with them -- as a standing
    // open panel it read as a permanent slab of text under the nav. As a
    // closed button it joins that row and only spends space when asked to.
    //
    // Declared with the other hooks, ABOVE the early returns below: this
    // component returns null until the snapshot loads, so a useState placed
    // after those returns would change the hook COUNT between renders and
    // React would throw "rendered fewer hooks than expected" the moment a
    // snapshot arrived.
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const raw = await evalTS("loadActiveJobs");
            if (typeof raw === "string" && raw !== "") {
                const parsed = JSON.parse(raw) as Snapshot;
                if (parsed && parsed.jobs instanceof Array) setSnapshot(parsed);
            }
        } catch (e) {
            // No bridge (browser preview), or a snapshot written by an older
            // build. Either way the empty state is the honest answer -- this
            // card must never toast or block the home screen.
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const state = await evalTS("teamGetMachineState");
                if (!cancelled && state && (state as { owner?: string }).owner) {
                    setOwner((state as { owner: string }).owner);
                }
            } catch (e) {
                /* untagged machine or no bridge -- "mine" simply matches nothing */
            }
            const res = await fetchJobs();
            if (cancelled) return;
            setJobs(res.jobs);
            setJobsMock(res.mock);
            setJobsError(res.error);
        })();
        return () => { cancelled = true; };
    }, []);

    const doRefresh = useCallback(async (e: React.MouseEvent) => {
        // The refresh control lives inside the toggle button, so its click must
        // not also collapse/expand the card.
        e.stopPropagation();
        setBusy(true);
        try {
            const res = await refreshJobs();
            setJobs(res.jobs);
            setJobsMock(res.mock);
            setJobsError(res.error);
        } finally {
            setBusy(false);
        }
    }, []);

    // Nothing to show and nothing scanned yet: stay out of the way entirely
    // rather than occupying the home screen with an empty box. Once a scan has
    // happened the card persists, because "0 outstanding" is real information.
    // Render as soon as EITHER source has something. Waiting for both would
    // hide the card on a machine that has never scanned but does have jobs.
    if (!loaded) return null;
    if (!jobs && !snapshot) return null;

    const built = snapshot ? snapshot.jobs.filter((j) => j.built < j.total) : [];
    const allJobs = jobs || [];
    const mine = owner ? allJobs.filter((j) => j.assignee === owner) : [];
    // An untagged machine has no "me", so showing an empty list would read as
    // "no work" rather than "we don't know who you are". Fall back to all.
    const shown = mineOnly && owner && mine.length > 0 ? mine : allJobs;
    const openCount = shown.filter((j) => (j.subtasksDone ?? 0) < (j.subtaskCount ?? 0)).length;

    return (
        <motion.div
            className="active-jobs"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.28 }}
        >
            <button
                type="button"
                className={open ? "active-jobs-toggle is-open" : "active-jobs-toggle"}
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
            >
                <span className="active-jobs-icon">
                    <Briefcase size={16} />
                </span>
                <span className="active-jobs-title">Active Jobs</span>
                <span className="active-jobs-count">
                    {shown.length === 0
                        ? "Nothing assigned"
                        : `${shown.length} job${shown.length === 1 ? "" : "s"}${openCount ? ` · ${openCount} to build` : ""}`}
                </span>
                {jobsMock && (
                    <Tooltip text={jobsError || "No jobs feed configured — showing sample data so the layout is visible."}>
                        <span className="active-jobs-pill">sample</span>
                    </Tooltip>
                )}
                <span className="active-jobs-spacer" />
                <Tooltip text="Re-read the jobs feed">
                    <span
                        className={busy ? "active-jobs-age is-busy" : "active-jobs-age"}
                        role="button"
                        tabIndex={-1}
                        onClick={doRefresh}
                    >
                        <RefreshCw size={10} /> {busy ? "…" : "refresh"}
                    </span>
                </Tooltip>
                <ChevronDown size={15} className="active-jobs-caret" />
            </button>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        className="active-jobs-body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                        {owner && mine.length > 0 && (
                            <div className="active-jobs-filter">
                                <button
                                    type="button"
                                    className={mineOnly ? "active-jobs-chip is-on" : "active-jobs-chip"}
                                    onClick={() => setMineOnly((v) => !v)}
                                >
                                    {mineOnly ? `Assigned to ${owner}` : "Everyone"}
                                </button>
                                <span className="active-jobs-filter-hint">
                                    {mineOnly ? `${allJobs.length - mine.length} more across the team` : `${mine.length} yours`}
                                </span>
                            </div>
                        )}

                        {shown.length === 0 ? (
                            <p className="active-jobs-empty">No active jobs in the feed.</p>
                        ) : (
                            <ul className="active-jobs-list">
                                {shown.map((job) => {
                                    const parts = parseJobTitle(job.title);
                                    const total = job.subtaskCount ?? 0;
                                    const done = job.subtasksDone ?? 0;
                                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                                    return (
                                        <li key={job.id}>
                                            <button
                                                type="button"
                                                className="active-jobs-row"
                                                onClick={onOpen}
                                                title={job.title}
                                            >
                                                <MapPin size={12} className="active-jobs-pin" />
                                                <span className="active-jobs-terr">
                                                    {parts.territory || parts.film || "—"}
                                                </span>
                                                <span className="active-jobs-name">{parts.name || job.title}</span>
                                                {parts.batch && <span className="active-jobs-batch">{parts.batch}</span>}
                                                {total > 0 ? (
                                                    <>
                                                        {/* A bar, not a percentage: "how much is
                                                            left" reads faster as a length. */}
                                                        <span className="active-jobs-bar" aria-hidden="true">
                                                            <span className="active-jobs-bar-fill" style={{ width: `${pct}%` }} />
                                                        </span>
                                                        <span className="active-jobs-left">
                                                            {total - done} left
                                                            <span className="active-jobs-of"> / {total}</span>
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className="active-jobs-bar" aria-hidden="true" />
                                                )}
                                                <ChevronRight size={13} className="active-jobs-chev" />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {/* The other half of the picture: Wrike knows what was
                            ASKED FOR, the specs scan knows what is BUILT. Stated
                            plainly rather than merged, because a mismatch between
                            them is itself the useful signal (a missed specs PDF). */}
                        {snapshot && built.length > 0 && (
                            <p className="active-jobs-foot">
                                Last specs scan: {built.length} batch{built.length === 1 ? "" : "es"} with
                                {" "}
                                {built.reduce((n, j) => n + (j.total - j.built), 0)} deliverable(s) not yet built
                                <span className="active-jobs-of"> · {relativeAge(snapshot.capturedAt)}</span>
                            </p>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default ActiveJobs;
