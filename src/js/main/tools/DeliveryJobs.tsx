// =============================================================================
// src/js/main/tools/DeliveryJobs.tsx
// -----------------------------------------------------------------------------
// READY TO DELIVER: your Wrike jobs in "Prep for delivery", and the renders
// they mean, without Finder.
//
// A chip per job. Opening one asks deliveryFindRenders for the territory's
// Renders folder in every campaign and shows the folder that holds the job's
// MOVs, as Finder would: every file, the ones the job names ticked (latest
// version only), anything else shown and unticked. Import brings the ticked
// ones in read-only and SELECTS them, so the Delivery button beside it makes
// the comps -- this page's own algorithm, untouched.
//
// The pairing is exact (subtask name vs file stem, version and case aside):
// a wrong pair delivers another screen's film; an unticked row costs a click.
//
// QUIET WHEN THERE IS NOTHING: untagged, no feed, or no job in that status.
// =============================================================================
import React, { useEffect, useState } from "react";
import { RefreshCw, Download, Loader2, Truck, Check, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import { fetchJobs, fetchJobsFresh, parseJobTitle, territoryFlag, commonTitlePrefix, DELIVERABLE_STATUSES, type WrikeJob } from "../lib/jobsFeed";
import CheckboxToggle from "../CheckboxToggle";
import FileBadge from "../FileBadge";
import "./DeliveryJobs.scss";

interface RenderFile { path: string; name: string; key: string; version: number; matched: boolean; latest: boolean }
interface RenderFolder { campaign: string; territory: string; label: string; path: string; files: RenderFile[] }
interface Found { folders: RenderFolder[]; missing: string[]; noTerritory?: boolean; error?: string }

interface Props {
    pushToast: (text: string, type?: "success" | "error") => void;
    /** The page's own Delivery: makes comps from the Project-panel selection. */
    onDeliver: () => void | Promise<void>;
}

/** The subtasks this delivery is about: those in Prep for delivery when the
 *  feed says, every named one when it doesn't. */
export function deliverableNames(job: WrikeJob): string[] {
    const subs = (job.subtasks || []).filter((s) => s.name);
    const flagged = subs.filter((s) => DELIVERABLE_STATUSES.test(s.customStatusName || ""));
    return (flagged.length ? flagged : subs).map((s) => s.name);
}

export function isDeliverable(job: WrikeJob): boolean {
    if (DELIVERABLE_STATUSES.test(job.status || "")) return true;
    return (job.subtasks || []).some((s) => DELIVERABLE_STATUSES.test(s.customStatusName || ""));
}

/** Territory off the title, else the last two-letter token of a subtask name. */
export function jobTerritory(job: WrikeJob): string {
    const t = parseJobTitle(job.title).territory;
    if (t) return t;
    for (const n of deliverableNames(job)) {
        const toks = n.split("_");
        for (let i = toks.length - 1; i > 0; i--) if (/^[A-Z]{2}$/.test(toks[i]) && toks[i] !== "OV") return toks[i];
    }
    return "";
}

const DeliveryJobs: React.FC<Props> = ({ pushToast, onDeliver }) => {
    const [jobs, setJobs] = useState<WrikeJob[]>([]);
    const [mock, setMock] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const [found, setFound] = useState<Found | null>(null);
    const [looking, setLooking] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [importing, setImporting] = useState(false);
    /** The last import: the file list folds away once it lands, leaving the
     *  page's own delivery UI -- this one line keeps the next step in reach. */
    const [done, setDone] = useState<{ jobId: string; label: string; count: number } | null>(null);
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
            setJobs(res.jobs.filter((j) => j.assignee === listFor && isDeliverable(j) && deliverableNames(j).length > 0));
        };
        // Refresh button: the cache re-read. On open: the cache, then a live
        // read behind it (throttled panel-wide -- see fetchJobsFresh).
        apply(force ? await fetchJobs(owner, true) : await fetchJobsFresh(owner, apply));
    };

    useEffect(() => { void load(false); }, []);

    const open = async (job: WrikeJob) => {
        if (openId === job.id) { setOpenId(null); return; }
        setOpenId(job.id);
        setFound(null);
        setLooking(true);
        try {
            const r = (await evalTSSafe("deliveryFindRenders", JSON.stringify({
                code: jobTerritory(job),
                names: deliverableNames(job),
            }))) as any;
            if (!r || !r.success) { setFound({ folders: [], missing: [], error: (r && r.error) || "Couldn't look for the renders." }); return; }
            const f: Found = { folders: r.folders || [], missing: r.missing || [], noTerritory: r.noTerritory };
            setFound(f);
            const next = new Set<string>();
            f.folders.forEach((fo) => fo.files.forEach((x) => { if (x.matched && x.latest) next.add(x.path); }));
            setPicked(next);
        } finally {
            setLooking(false);
        }
    };

    const toggle = (path: string) => setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
    });

    const doImport = async (job: WrikeJob) => {
        if (!found || picked.size === 0) return;
        setImporting(true);
        try {
            const first = found.folders.find((f) => f.files.some((x) => picked.has(x.path)));
            const bin = first ? `${first.territory} ${first.label.split("/").pop()}` : parseJobTitle(job.title).name || "Renders";
            const r = (await evalTSSafe("deliveryImportRenders", JSON.stringify({ paths: Array.from(picked), folder: bin }))) as any;
            if (!r || !r.success) { pushToast((r && r.error) || "Couldn't import them.", "error"); return; }
            const bits = [`Imported ${r.imported}`];
            if (r.reused) bits.push(`${r.reused} already in the project`);
            pushToast(bits.join(", ") + ". They're selected, ready for Delivery.");
            if (r.failed && r.failed.length) pushToast(`Couldn't open ${r.failed.length}: ${r.failed[0]}`, "error");
            // FOLD AWAY: the list has done its job, and what's left to do is
            // the delivery UI underneath. The chip and one line remember it.
            setDone({ jobId: job.id, label: first ? `${first.territory} ${first.label.split("/").pop()}` : job.title, count: picked.size });
            setOpenId(null);
        } finally {
            setImporting(false);
        }
    };

    if (jobs.length === 0) return null;

    // Said once in the heading, not on every chip.
    const shared = commonTitlePrefix(jobs.map((j) => j.title));

    return (
        <div className="dj">
            <div className="dj-head">
                <span className="dj-label">
                    Ready to deliver
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
            {/* WRAPS, never scrolls sideways: AE's panel gives a mouse no
                horizontal wheel, so a chip past the edge could not be reached. */}
            <div className="dj-chips">
                    {jobs.map((job) => {
                        const code = jobTerritory(job);
                        const flag = territoryFlag(code);
                        const n = deliverableNames(job).length;
                        const isOpen = openId === job.id;
                        return (
                            <button
                                key={job.id}
                                type="button"
                                className={"dj-chip" + (isOpen ? " is-open" : "") + (done && done.jobId === job.id ? " is-done" : "")}
                                onClick={() => void open(job)}
                                title={`${job.title} · ${n} ready to deliver`}
                            >
                                {flag && <span className="dj-flag">{flag}</span>}
                                {/* What's left of the title after the shared words:
                                    "SI 2" -- the trailing 2 is the batch people say. */}
                                <span className="dj-name">{shared ? job.title.slice(shared.length).trim() : job.title}</span>
                                <span className="dj-count">{n}</span>
                            </button>
                        );
                    })}
            </div>

            {done && openId === null && (
                <div className="dj-done">
                    <Check size={13} />
                    <span className="dj-done-text">Imported {done.count} into <strong>{done.label}</strong>. Selected, ready for Delivery.</span>
                    <button type="button" className="dj-deliver" onClick={() => { setDone(null); void onDeliver(); }}>
                        <Truck size={13} /> <span>Make delivery comps</span>
                    </button>
                    <button type="button" className="dj-dismiss" aria-label="Dismiss" onClick={() => setDone(null)}>
                        <X size={12} />
                    </button>
                </div>
            )}
            {openId && (() => {
                const job = jobs.find((j) => j.id === openId);
                if (!job) return null;
                return (
                    <div className="dj-panel">
                        {looking && <p className="dj-note"><Loader2 size={12} className="spin" /> Looking in Renders…</p>}
                        {found && found.error && <p className="dj-note is-bad">{found.error}</p>}
                        {found && !found.error && found.folders.length === 0 && (
                            <p className="dj-note is-bad">
                                {found.noTerritory
                                    ? `No ${jobTerritory(job)} folder in any campaign on this machine.`
                                    : `No renders for this job under ${jobTerritory(job)}'s Renders folder yet.`}
                            </p>
                        )}
                        {found && found.folders.map((fo) => (
                            <div key={fo.path} className="dj-folder">
                                <div className="dj-folder-head" title={fo.path}>
                                    <span className="dj-folder-name">{fo.label}</span>
                                    <span className="dj-folder-where">{fo.territory} · {fo.campaign}</span>
                                </div>
                                {fo.files.map((f) => {
                                    const on = picked.has(f.path);
                                    const note = !f.matched ? "not in this job" : !f.latest ? "older version" : "";
                                    return (
                                        <div key={f.path} className={"dj-row" + (f.matched ? "" : " is-other") + (on ? " is-on" : "")}>
                                            <CheckboxToggle checked={on} onChange={() => toggle(f.path)} />
                                            <FileBadge of={f.name} />
                                            <span className="dj-file" title={f.path}>{f.name}</span>
                                            {note && <span className="dj-tag">{note}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                        {found && found.missing.length > 0 && (
                            <p className="dj-note is-warn" title={found.missing.join("\n")}>
                                No render yet for {found.missing.length}: {found.missing.slice(0, 2).join(", ")}{found.missing.length > 2 ? "…" : ""}
                            </p>
                        )}
                        {found && found.folders.length > 0 && (
                            <div className="dj-actions">
                                <button type="button" className="dj-import" disabled={importing || picked.size === 0} onClick={() => void doImport(job)}>
                                    {importing ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                                    <span>{importing ? "Importing…" : `Import ${picked.size}`}</span>
                                </button>
                            </div>
                        )}
                    </div>
                );
            })()}
        </div>
    );
};

export default DeliveryJobs;
