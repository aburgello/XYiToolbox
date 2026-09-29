// =============================================================================
// src/js/main/tools/ReviewJobs.tsx
// -----------------------------------------------------------------------------
// YOUR WRIKE JOBS, AS REVIEW SEES THEM. Deliver's "Ready to deliver" strip,
// asked two different questions:
//
//   To amend  -- somebody asked for changes, so a new version will be rendered.
//                Offered once the new version is on disk; a deliverable whose
//                newest render is still V01 is listed as "not re-rendered yet",
//                not ticked -- reviewing the old version again helps nobody.
//   Motion / Backlog -- being made. The strip says which have reached Renders
//                and offers those; the rest are listed as not rendered yet, so
//                the job is a reminder as well as a way in.
//
// Everything below the status test is Deliver's: deliveryFindRenders pairs
// subtask names to files EXACTLY (version and case aside), the Finder colour
// picks the version, deliveryImportRenders imports read-only and SELECTS. Then
// the session's own Import & Compare runs on that selection, so the sections
// (vs Master / Amends / Pre vs Post) sort them exactly as a hand import would.
//
// QUIET WHEN THERE IS NOTHING: untagged, no feed, or no job in either status.
// =============================================================================
import React, { useEffect, useState } from "react";
import { RefreshCw, Download, Loader2, Play } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import { fetchJobs, fetchJobsFresh, territoryFlag, commonTitlePrefix, statusTint, AMEND_STATUSES, IN_MOTION_STATUSES, type WrikeJob } from "../lib/jobsFeed";
import CheckboxToggle from "../CheckboxToggle";
import FileBadge from "../FileBadge";
import { readFinderColors, openInDefaultApp, isBadColor, type FinderColor } from "../lib/finderLabels";
import { defaultPicks, grouped, jobTerritory, type RenderFile, type RenderFolder } from "./DeliveryJobs";
import "./DeliveryJobs.scss";

type Why = "amend" | "motion";

/** The job's subtasks in each review status. Only subtasks the feed actually
 *  labels count: unlike Deliver there is no "every subtask" fallback, because
 *  a job with no status on its subtasks says nothing about what needs review. */
function reviewNames(job: WrikeJob): { amend: string[]; motion: string[] } {
    const subs = (job.subtasks || []).filter((s) => s.name);
    return {
        amend: subs.filter((s) => AMEND_STATUSES.test(s.customStatusName || "")).map((s) => s.name),
        motion: subs.filter((s) => IN_MOTION_STATUSES.test(s.customStatusName || "")).map((s) => s.name),
    };
}

interface Found { folders: RenderFolder[]; missing: string[]; noTerritory?: boolean; error?: string }

interface Props {
    pushToast: (text: string, type?: "success" | "error") => void;
    /** The session's own Import & Compare, run on what this just selected. */
    onImported: () => void | Promise<void>;
}

const ReviewJobs: React.FC<Props> = ({ pushToast, onImported }) => {
    const [jobs, setJobs] = useState<WrikeJob[]>([]);
    const [mock, setMock] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const [found, setFound] = useState<Found | null>(null);
    const [looking, setLooking] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [colors, setColors] = useState<Record<string, FinderColor>>({});
    const [importing, setImporting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const load = async (force: boolean) => {
        let owner = "";
        try {
            const state = (await evalTS("teamGetMachineState")) as { owner?: string } | undefined;
            owner = (state && state.owner) || "";
        } catch { /* untagged or no bridge */ }
        if (!owner) { setJobs([]); return; }
        const apply = (res: Awaited<ReturnType<typeof fetchJobs>>) => {
            const listFor = res.viewingAs || owner;
            setMock(res.mock);
            setJobs(res.jobs.filter((j) => {
                if (j.assignee !== listFor) return false;
                const n = reviewNames(j);
                return n.amend.length + n.motion.length > 0;
            }));
        };
        apply(force ? await fetchJobs(owner, true) : await fetchJobsFresh(owner, apply));
    };

    useEffect(() => { void load(false); }, []);

    /** Which review status a render's deliverable is in, by its key. */
    const whyByKey = (job: WrikeJob): Record<string, Why> => {
        const n = reviewNames(job);
        const out: Record<string, Why> = {};
        n.motion.forEach((m) => { out[m.toUpperCase()] = "motion"; });
        n.amend.forEach((m) => { out[m.toUpperCase()] = "amend"; });
        return out;
    };

    const open = async (job: WrikeJob) => {
        if (openId === job.id) { setOpenId(null); return; }
        setOpenId(job.id);
        setFound(null);
        setLooking(true);
        try {
            const n = reviewNames(job);
            const r = (await evalTSSafe("deliveryFindRenders", JSON.stringify({
                code: jobTerritory(job),
                names: n.amend.concat(n.motion),
            }))) as any;
            if (!r || !r.success) { setFound({ folders: [], missing: [], error: (r && r.error) || "Couldn't look for the renders." }); return; }
            // Only this job's renders: Review is not a folder browser, and the
            // unmatched rest of a batch is Deliver's business.
            const folders: RenderFolder[] = (r.folders || [])
                .map((fo: RenderFolder) => ({ ...fo, files: grouped((fo.files || []).filter((f) => f.matched)) }))
                .filter((fo: RenderFolder) => fo.files.length > 0);
            const f: Found = { folders, missing: r.missing || [], noTerritory: r.noTerritory };
            const c = await readFinderColors(folders.reduce<string[]>((acc, fo) => acc.concat(fo.files.map((x) => x.path)), []));
            setColors(c);
            setFound(f);
            // Deliver's pick (newest good, else newest not red), minus an amend
            // still sitting at V01: that is the version the amends are ABOUT.
            const why = whyByKey(job);
            const base = defaultPicks(folders, c);
            folders.forEach((fo) => fo.files.forEach((x) => {
                if (why[x.key] === "amend" && x.latest && x.version <= 1) base.delete(x.path);
            }));
            setPicked(base);
        } finally {
            setLooking(false);
        }
    };

    const toggle = (file: RenderFile) => setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(file.path)) { next.delete(file.path); return next; }
        if (found) found.folders.forEach((fo) => fo.files.forEach((x) => { if (x.key === file.key) next.delete(x.path); }));
        next.add(file.path);
        return next;
    });

    const doImport = async () => {
        if (!found || picked.size === 0) return;
        setImporting(true);
        try {
            const first = found.folders.find((f) => f.files.some((x) => picked.has(x.path)));
            // Deliver's bin name, on purpose: the same renders are delivered
            // later, and the import is idempotent by path, so they are one set.
            const bin = first ? `${first.territory} ${first.label.split("/").pop()}` : "Renders";
            const r = (await evalTSSafe("deliveryImportRenders", JSON.stringify({ paths: Array.from(picked), folder: bin }))) as any;
            if (!r || !r.success) { pushToast((r && r.error) || "Couldn't import them.", "error"); return; }
            if (r.failed && r.failed.length) pushToast(`Couldn't open ${r.failed.length}: ${r.failed[0]}`, "error");
            setOpenId(null);
            await onImported();
        } finally {
            setImporting(false);
        }
    };

    if (jobs.length === 0) return null;
    const shared = commonTitlePrefix(jobs.map((j) => j.title));
    const amendTint = statusTint("to amend");
    const motionTint = statusTint("motion");

    return (
        <div className="dj rv-jobs">
            <div className="dj-head">
                <span className="dj-label">
                    Your jobs
                    {shared && <span className="dj-shared">{shared}</span>}
                </span>
                {mock && <span className="dj-sample">SAMPLE</span>}
                <span className="dj-spacer" />
                <button
                    type="button"
                    className="dj-refresh"
                    aria-label="Refresh jobs"
                    title="Refresh jobs"
                    disabled={refreshing}
                    onClick={async () => { setRefreshing(true); try { await load(true); } finally { setRefreshing(false); } }}
                >
                    <RefreshCw size={12} className={refreshing ? "spin" : ""} />
                </button>
            </div>
            <div className="dj-chips">
                {jobs.map((job) => {
                    const code = jobTerritory(job);
                    const flag = territoryFlag(code);
                    const n = reviewNames(job);
                    const isOpen = openId === job.id;
                    return (
                        <button
                            key={job.id}
                            type="button"
                            className={"dj-chip" + (isOpen ? " is-open" : "")}
                            onClick={() => void open(job)}
                            title={`${job.title} · ${n.amend.length} to amend · ${n.motion.length} in motion`}
                        >
                            {flag && <span className="dj-flag">{flag}</span>}
                            <span className="dj-name">{shared ? job.title.slice(shared.length).trim() : job.title}</span>
                            {n.amend.length > 0 && <span className="dj-count" style={amendTint} title="To amend">{n.amend.length}</span>}
                            {n.motion.length > 0 && <span className="dj-count" style={motionTint} title="Motion / Backlog">{n.motion.length}</span>}
                        </button>
                    );
                })}
            </div>

            {openId && (() => {
                const job = jobs.find((j) => j.id === openId);
                if (!job) return null;
                const why = whyByKey(job);
                const notYet = found ? found.missing.filter((m) => why[m.toUpperCase()] === "motion") : [];
                const noNew: string[] = [];
                if (found) {
                    found.folders.forEach((fo) => fo.files.forEach((x) => {
                        if (why[x.key] === "amend" && x.latest && x.version <= 1) noNew.push(x.name);
                    }));
                    found.missing.forEach((m) => { if (why[m.toUpperCase()] === "amend") noNew.push(m); });
                }
                return (
                    <div className="dj-panel">
                        {looking && <p className="dj-note"><Loader2 size={12} className="spin" /> Looking in Renders…</p>}
                        {found && found.error && <p className="dj-note is-bad">{found.error}</p>}
                        {found && !found.error && found.folders.length === 0 && (
                            <p className="dj-note is-bad">
                                {found.noTerritory
                                    ? `No ${jobTerritory(job)} folder in any campaign on this machine.`
                                    : `Nothing from this job has reached ${jobTerritory(job)}'s Renders folder yet.`}
                            </p>
                        )}
                        {found && found.folders.map((fo) => (
                            <div key={fo.path} className="dj-folder">
                                <div className="dj-folder-head" title={fo.path}>
                                    <span className="dj-folder-name">{fo.label}</span>
                                    <span className="dj-folder-where">{fo.territory} · {fo.campaign}</span>
                                </div>
                                {fo.files.map((f, i) => {
                                    const on = picked.has(f.path);
                                    const color = colors[f.path] || "";
                                    const sibling = i > 0 && fo.files[i - 1].key === f.key;
                                    const kind = why[f.key];
                                    const note = isBadColor(color) ? "marked red"
                                        : kind === "amend" ? (f.latest && f.version <= 1 ? "to amend · not re-rendered" : f.latest ? "to amend · new version" : "older")
                                        : f.latest ? "in motion" : "older";
                                    return (
                                        <div key={f.path} className={"dj-row" + (on ? " is-on" : "") + (sibling ? " is-version" : "") + (isBadColor(color) ? " is-bad" : "")}>
                                            <CheckboxToggle checked={on} onChange={() => toggle(f)} />
                                            <FileBadge of={f.name} />
                                            <span className="dj-file" title={f.path}>{f.name}</span>
                                            {color && <span className={"dj-dot is-" + color} title={`Marked ${color} in Finder`} />}
                                            <span className="dj-tag" style={kind === "amend" ? amendTint : undefined}>{note}</span>
                                            <button type="button" className="dj-play" onClick={() => openInDefaultApp(f.path)} aria-label="Play" title="Open in QuickTime">
                                                <Play size={11} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                        {/* THE REMINDER HALF: what the job still owes. */}
                        {found && notYet.length > 0 && (
                            <div className="dj-missing">
                                <p className="dj-note">Not rendered yet ({notYet.length}):</p>
                                {notYet.map((m) => <div key={m} className="dj-missing-row"><span className="dj-missing-name" title={m}>{m}</span></div>)}
                            </div>
                        )}
                        {found && noNew.length > 0 && (
                            <div className="dj-missing">
                                <p className="dj-note is-warn">To amend, no new version yet ({noNew.length}):</p>
                                {noNew.map((m) => <div key={m} className="dj-missing-row"><span className="dj-missing-name" title={m}>{m}</span></div>)}
                            </div>
                        )}
                        {found && found.folders.length > 0 && (
                            <div className="dj-actions">
                                <button type="button" className="dj-import" disabled={importing || picked.size === 0} onClick={() => void doImport()}>
                                    {importing ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                                    <span>{importing ? "Importing…" : `Import & Compare ${picked.size}`}</span>
                                </button>
                            </div>
                        )}
                    </div>
                );
            })()}
        </div>
    );
};

export default ReviewJobs;
export { reviewNames };
