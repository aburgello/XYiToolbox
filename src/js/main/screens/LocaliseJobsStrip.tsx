// =============================================================================
// src/js/main/screens/LocaliseJobsStrip.tsx
// -----------------------------------------------------------------------------
// Your Wrike jobs, on the Localise page itself.
//
// They lived only on the home screen, so the day went: home, open the card,
// open a job, send it, get brought back here -- for the one thing this page is
// for. Now they sit under the header as one line of chips. A chip opens the
// SAME job window as the home card (ActiveJobModal), and "Send N rows to
// Localise" fills Build a Batch right here: the page bumps CSV Localiser's
// handoff tick, since that tool is already mounted and would otherwise only
// take a staged batch on its next mount.
//
// The job whose territory the open project sits in is lit and goes first --
// the same answer the Library card and the scan list give.
//
// QUIET WHEN THERE IS NOTHING: an untagged machine, no jobs, or nothing left to
// do renders no strip at all. The feed's own sample list (it could not be
// reached) is shown marked SAMPLE, exactly as the home card marks it.
// =============================================================================
import React, { useEffect, useState } from "react";
import { Briefcase, RefreshCw } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { fetchJobs, parseJobTitle, jobReadiness, territoryFlag, type WrikeJob } from "../lib/jobsFeed";
import ActiveJobModal from "../ActiveJobModal";

interface Props {
    /** ISO code of the territory the open project sits in, when known. */
    hereCode?: string;
    /** A job's rows have been staged: take them into Build a Batch now. */
    onSent: () => void;
}

const LocaliseJobsStrip: React.FC<Props> = ({ hereCode, onSent }) => {
    const [jobs, setJobs] = useState<WrikeJob[]>([]);
    const [mock, setMock] = useState(false);
    const [who, setWho] = useState("");
    const [openJob, setOpenJob] = useState<WrikeJob | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = async (live: boolean) => {
        let owner = "";
        try {
            const state = (await evalTS("teamGetMachineState")) as { owner?: string } | undefined;
            owner = (state && state.owner) || "";
        } catch { /* untagged or no bridge */ }
        if (!owner) { setWho(""); setJobs([]); return; }
        // fetchJobs is cached per member, so this costs nothing when the home
        // card already asked. Refresh re-reads the FEED'S CACHE (force), never
        // a live Wrike refresh: that is the one path that loses subtask names
        // (ActiveJobModal has the measurement), which would make the strip's
        // own button the way jobs lose their rows.
        const res = await fetchJobs(owner, live);
        const listFor = res.viewingAs || owner;
        setWho(listFor);
        setMock(res.mock);
        setJobs(res.jobs.filter((j) =>
            j.assignee === listFor
            && (j.subtaskCount ?? 0) > 0
            && jobReadiness(j.status) !== "done"
            && (j.subtasksDone ?? 0) < (j.subtaskCount ?? 0)));
    };

    useEffect(() => { void load(false); }, []);

    if (!who || jobs.length === 0) return null;

    const here = String(hereCode || "").toUpperCase();
    const ordered = jobs.slice().sort((a, b) => {
        const ah = parseJobTitle(a.title).territory === here ? 0 : 1;
        const bh = parseJobTitle(b.title).territory === here ? 0 : 1;
        return ah - bh;
    });

    return (
        <div className="ls-jobs">
            <span className="ls-jobs-label">
                <Briefcase size={13} /> Your jobs
                {mock && <span className="ls-jobs-sample">SAMPLE</span>}
            </span>
            <div className="ls-jobs-chips">
                {ordered.map((job) => {
                    const parts = parseJobTitle(job.title);
                    const flag = territoryFlag(parts.territory);
                    const left = (job.subtaskCount ?? 0) - (job.subtasksDone ?? 0);
                    const isHere = !!here && parts.territory === here;
                    return (
                        <button
                            key={job.id}
                            type="button"
                            className={"ls-jobs-chip" + (isHere ? " is-here" : "")}
                            onClick={() => setOpenJob(job)}
                        >
                            {flag && <span className="ls-jobs-flag">{flag}</span>}
                            <span className="ls-jobs-terr">{parts.territory || parts.name || job.title}</span>
                            {parts.batch && <span className="ls-jobs-batch">{parts.batch}</span>}
                            <span className="ls-jobs-left">{left} left</span>
                        </button>
                    );
                })}
            </div>
            <button
                type="button"
                className="ls-jobs-refresh"
                aria-label="Refresh jobs"
                disabled={refreshing}
                onClick={async () => { setRefreshing(true); try { await load(true); } finally { setRefreshing(false); } }}
            >
                <RefreshCw size={12} className={refreshing ? "spin" : ""} />
            </button>
            {openJob && (
                <ActiveJobModal
                    job={openJob}
                    onClose={() => setOpenJob(null)}
                    onOpenLocaliser={() => {
                        setOpenJob(null);
                        onSent();
                    }}
                />
            )}
        </div>
    );
};

export default LocaliseJobsStrip;
