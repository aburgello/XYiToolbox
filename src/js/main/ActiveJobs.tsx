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
import { fetchJobs, refreshJobs, saveJobsFeedConfig, parseJobTitle, type WrikeJob } from "./lib/jobsFeed";
import ActiveJobModal from "./ActiveJobModal";

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
    // Clicking a batch opens it here rather than jumping straight to Localise:
    // the useful first question is "what is actually in this job", and the
    // subtask names answer it without leaving home.
    const [openJob, setOpenJob] = useState<WrikeJob | null>(null);
    // Setup lives inside the card rather than in a settings screen: the only
    // moment anyone wants it is when they are looking at the "sample" badge
    // wondering why the data is not real.
    const [setupOpen, setSetupOpen] = useState(false);
    const [setupUrl, setSetupUrl] = useState("");
    const [setupKey, setSetupKey] = useState("");
    const [setupBusy, setSetupBusy] = useState(false);
    const [setupNote, setSetupNote] = useState("");

    const saveSetup = useCallback(async () => {
        const url = setupUrl.trim();
        const key = setupKey.trim();
        if (!url || !key) {
            setSetupNote("Both the URL and the key are needed.");
            return;
        }
        setSetupBusy(true);
        setSetupNote("");
        try {
            const ok = await saveJobsFeedConfig({ url, key });
            if (!ok) {
                setSetupNote("Couldn't save — no bridge to After Effects.");
                return;
            }
            // Fetch straight away so a wrong URL or key is reported HERE, while
            // the fields are still on screen to correct, rather than silently
            // falling back to sample data.
            const res = await refreshJobs(owner);
            setJobs(res.jobs);
            setJobsMock(res.mock);
            setJobsError(res.error);
            if (res.mock) setSetupNote(res.error || "Saved, but the feed didn't answer.");
            else {
                setSetupNote("");
                setSetupOpen(false);
                setSetupKey("");
            }
        } finally {
            setSetupBusy(false);
        }
    }, [setupUrl, setupKey, owner]);
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
        // Resolved before the fetch: the Worker filters by member, so asking
        // before we know who this machine is would return nothing.
        let who = "";
        (async () => {
            try {
                const state = await evalTS("teamGetMachineState");
                if (!cancelled && state && (state as { owner?: string }).owner) {
                    who = (state as { owner: string }).owner;
                    setOwner(who);
                }
            } catch (e) {
                /* untagged machine or no bridge -- "mine" simply matches nothing */
            }
            const res = await fetchJobs(who);
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
            const res = await refreshJobs(owner);
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
    // YOURS ONLY -- no "everyone" toggle. The whole point of the card is a
    // short, glanceable list of what you personally have to build; the feed
    // returns the studio's jobs only because filtering server-side would need
    // per-user auth we deliberately avoided.
    //
    // An untagged machine can't answer "mine", so it says so rather than
    // showing an empty list, which would read as "no work" instead of "we
    // don't know who you are".
    const shown = owner ? allJobs.filter((j) => j.assignee === owner) : [];
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
                    {!owner
                        ? "Machine not tagged"
                        : shown.length === 0
                        ? "Nothing assigned to you"
                        : `${shown.length} job${shown.length === 1 ? "" : "s"}${openCount ? ` · ${openCount} to build` : ""}`}
                </span>
                {jobsMock && (
                    <Tooltip text={jobsError || "No jobs feed connected — showing sample data. Click to connect."}>
                        <span
                            className="active-jobs-pill"
                            role="button"
                            tabIndex={-1}
                            onClick={(e) => {
                                e.stopPropagation();
                                setOpen(true);
                                setSetupOpen(true);
                            }}
                        >
                            sample
                        </span>
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
                        {(setupOpen || (jobsMock && open)) && (
                            <div className="active-jobs-setup">
                                <p className="active-jobs-setup-lead">
                                    Connect the jobs feed. Both values come from the studio Worker —{" "}
                                    <strong>this is not a Wrike token</strong>, and it's stored on this machine only.
                                </p>
                                <label className="active-jobs-field">
                                    <span>Feed URL</span>
                                    <input
                                        type="text"
                                        value={setupUrl}
                                        placeholder="https://your-worker-url/api/panel/jobs"
                                        onChange={(e) => setSetupUrl(e.target.value)}
                                    />
                                </label>
                                <label className="active-jobs-field">
                                    <span>Panel key</span>
                                    <input
                                        type="password"
                                        value={setupKey}
                                        placeholder="the PANEL_KEY you set with wrangler"
                                        onChange={(e) => setSetupKey(e.target.value)}
                                    />
                                </label>
                                <div className="active-jobs-setup-actions">
                                    {setupNote && <span className="active-jobs-setup-note">{setupNote}</span>}
                                    <span className="active-jobs-spacer" />
                                    <button type="button" className="active-jobs-save" disabled={setupBusy} onClick={saveSetup}>
                                        {setupBusy ? "Checking…" : "Connect"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {!owner ? (
                            <p className="active-jobs-empty">
                                This machine isn't tagged with a member name, so there's no "you" to filter by. Tag it
                                from the Team menu and your jobs will appear here.
                            </p>
                        ) : shown.length === 0 ? (
                            <p className="active-jobs-empty">
                                Nothing in the feed is assigned to {owner}.
                            </p>
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
                                                onClick={() => setOpenJob(job)}
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
            {openJob && (
                <ActiveJobModal
                    job={openJob}
                    onClose={() => setOpenJob(null)}
                    onOpenLocaliser={() => {
                        setOpenJob(null);
                        onOpen();
                    }}
                />
            )}
        </motion.div>
    );
};

export default ActiveJobs;
