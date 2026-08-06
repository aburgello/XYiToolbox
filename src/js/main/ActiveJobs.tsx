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

    // Nothing to show and nothing scanned yet: stay out of the way entirely
    // rather than occupying the home screen with an empty box. Once a scan has
    // happened the card persists, because "0 outstanding" is real information.
    if (!loaded) return null;
    if (!snapshot) return null;

    const outstanding = snapshot.jobs.filter((j) => j.built < j.total);
    const totalLeft = outstanding.reduce((n, j) => n + (j.total - j.built), 0);

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
                {totalLeft > 0 ? (
                    <span className="active-jobs-count">
                        {outstanding.length} batch{outstanding.length === 1 ? "" : "es"} · {totalLeft} deliverable
                        {totalLeft === 1 ? "" : "s"} to build
                    </span>
                ) : (
                    <span className="active-jobs-count">Nothing outstanding</span>
                )}
                <span className="active-jobs-spacer" />
                <Tooltip text="From the last specs scan — open Localise and re-scan to refresh">
                    <span className="active-jobs-age">
                        <RefreshCw size={10} /> {relativeAge(snapshot.capturedAt)}
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
                        {outstanding.length === 0 ? (
                            <p className="active-jobs-empty">
                                Everything in the last scan is built.
                            </p>
                        ) : (
                            <ul className="active-jobs-list">
                                {outstanding.map((job) => {
                                    const left = job.total - job.built;
                                    const pct = job.total > 0 ? Math.round((job.built / job.total) * 100) : 0;
                                    return (
                                        <li key={`${job.territory}/${job.pdfName}`}>
                                            <button
                                                type="button"
                                                className="active-jobs-row"
                                                onClick={onOpen}
                                                title={job.pdfName}
                                            >
                                                <MapPin size={12} className="active-jobs-pin" />
                                                <span className="active-jobs-terr">{job.territory}</span>
                                                <span className="active-jobs-batch">{job.batch}</span>
                                                {/* A bar, not a percentage: "how much is
                                                    left" reads faster as a length. */}
                                                <span className="active-jobs-bar" aria-hidden="true">
                                                    <span className="active-jobs-bar-fill" style={{ width: `${pct}%` }} />
                                                </span>
                                                <span className="active-jobs-left">
                                                    {left} left
                                                    <span className="active-jobs-of"> / {job.total}</span>
                                                </span>
                                                <ChevronRight size={13} className="active-jobs-chev" />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default ActiveJobs;
