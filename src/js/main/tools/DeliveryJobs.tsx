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
import { RefreshCw, Download, Loader2, Truck, Check, X, Play } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import { fetchJobs, fetchJobsFresh, parseJobTitle, territoryFlag, commonTitlePrefix, DELIVERABLE_STATUSES, type WrikeJob } from "../lib/jobsFeed";
import CheckboxToggle from "../CheckboxToggle";
import FileBadge from "../FileBadge";
import { readFinderColors, openInDefaultApp, isGoodColor, isBadColor, type FinderColor } from "../lib/finderLabels";
import "./DeliveryJobs.scss";

export interface RenderFile { path: string; name: string; key: string; version: number; variant?: string; matched: boolean; latest: boolean }

/** Version first, a res variant above the plain render at the same version --
 *  the host's own order (deliveryRenderRank), repeated so the list never
 *  depends on the order a folder listing came back in. */
const rankOf = (f: RenderFile) => f.version * 10 + (f.variant ? 1 : 0);
export const grouped = (files: RenderFile[]) => files.slice().sort((a, b) => (a.key !== b.key ? (a.key < b.key ? -1 : 1) : rankOf(a) - rankOf(b)));
export interface RenderFolder { campaign: string; territory: string; label: string; path: string; files: RenderFile[] }
interface Found { folders: RenderFolder[]; missing: string[]; noTerritory?: boolean; error?: string }

/**
 * ONE PICK PER DELIVERABLE, and the Finder colour decides it. Two versions of
 * one deliverable make two delivery comps of the same name, so they are
 * exclusive. The default is the newest version marked good (green/orange);
 * failing that the newest not marked red; a deliverable whose every version
 * is red gets nothing ticked -- somebody said no, and a render is re-made
 * rather than delivered over their head.
 */
export function defaultPicks(folders: RenderFolder[], colors: Record<string, FinderColor>): Set<string> {
    const byKey: Record<string, RenderFile[]> = {};
    folders.forEach((fo) => fo.files.forEach((f) => { if (f.matched) (byKey[f.key] = byKey[f.key] || []).push(f); }));
    const out = new Set<string>();
    Object.keys(byKey).forEach((k) => {
        const vs = byKey[k].slice().sort((a, b) => rankOf(b) - rankOf(a));
        const good = vs.find((f) => isGoodColor(colors[f.path] || ""));
        const ok = good || vs.find((f) => !isBadColor(colors[f.path] || ""));
        if (ok) out.add(ok.path);
    });
    return out;
}

/**
 * WHY A FILE DIDN'T PAIR -- a hint, never a pairing. The match stays exact
 * (a wrong pair delivers another screen's film); these only put words on the
 * near misses measured on Slovenia's Batch_02:
 *   - one token apart: `…_2760x450px_10s_SI` in Wrike, `…_15s_SI_V01.mov` on
 *     disk. Either the render or the Wrike name is wrong -- worth saying.
 *   - a variant: `…_10s_SI_V01_DOUBLE_RES.mov`, the subtask plus words after
 *     the version.
 *   - the job HAS it, in another status (Revised): not "not in this job".
 */
export interface Hint { subtask: string; text: string }

function describeDiff(a: string, b: string): string {
    if (/^\d+S(EC)?$/.test(a) && /^\d+S(EC)?$/.test(b)) return `length differs: Wrike ${a.toLowerCase()}, render ${b.toLowerCase()}`;
    if (/^\d+X\d+(PX)?$/.test(a) && /^\d+X\d+(PX)?$/.test(b)) return `size differs: Wrike ${a.toLowerCase()}, render ${b.toLowerCase()}`;
    return `differs: Wrike ${a}, render ${b}`;
}

/** Hints for unmatched files, keyed by file path. `wanted` are the subtask
 *  names asked for; `others` every other subtask of the job, with its status. */
export function nearMisses(
    folders: RenderFolder[],
    wanted: string[],
    others: { name: string; status: string }[],
): Record<string, Hint & { kind: "variant" | "diff" | "status" }> {
    const out: Record<string, Hint & { kind: "variant" | "diff" | "status" }> = {};
    const want = wanted.map((n) => ({ name: n, key: n.toUpperCase() }));
    const otherByKey: Record<string, { name: string; status: string }> = {};
    others.forEach((o) => { otherByKey[o.name.toUpperCase()] = o; });
    folders.forEach((fo) => fo.files.forEach((f) => {
        if (f.matched) return;
        const o = otherByKey[f.key];
        if (o) { out[f.path] = { subtask: o.name, text: o.status ? `${o.status} in Wrike` : "not ready in Wrike", kind: "status" }; return; }
        // A variant: the file's own name with its _Vnn and anything after it off.
        const base = f.name.replace(/\.[^.]+$/, "").replace(/_V\d+(_.*)?$/i, "").toUpperCase();
        const extra = (/_V\d+_(.*)$/i.exec(f.name.replace(/\.[^.]+$/, "")) || [])[1];
        const v = want.find((w) => w.key === base);
        if (v && extra) { out[f.path] = { subtask: v.name, text: `variant (${extra})`, kind: "variant" }; return; }
        const ft = base.split("_");
        for (const w of want) {
            const wt = w.key.split("_");
            if (wt.length !== ft.length) continue;
            const diffs = wt.map((t, i) => (t === ft[i] ? -1 : i)).filter((i) => i >= 0);
            if (diffs.length === 1) { out[f.path] = { subtask: w.name, text: describeDiff(wt[diffs[0]], ft[diffs[0]]), kind: "diff" }; return; }
        }
    }));
    return out;
}

interface Props {
    pushToast: (text: string, type?: "success" | "error") => void;
    /** The page's own Delivery: makes comps from the Project-panel selection. */
    onDeliver: () => void | Promise<void>;
}

/** The subtasks this delivery is about: those in Prep for delivery when the
 *  feed says, every named one when it doesn't. `statuses` lets Review ask the
 *  same question of "To amend" and "Motion" -- one rule, two pages. */
export function deliverableNames(job: WrikeJob, statuses: RegExp = DELIVERABLE_STATUSES): string[] {
    const subs = (job.subtasks || []).filter((s) => s.name);
    const flagged = subs.filter((s) => statuses.test(s.customStatusName || ""));
    return (flagged.length ? flagged : subs).map((s) => s.name);
}

export function isDeliverable(job: WrikeJob, statuses: RegExp = DELIVERABLE_STATUSES): boolean {
    if (statuses.test(job.status || "")) return true;
    return (job.subtasks || []).some((s) => statuses.test(s.customStatusName || ""));
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

/** TAKE-ONCE: a job another page (Batch Tracker's Deliver) wants opened when
 *  this list next loads. Same discipline as localiseHandoff's pending batch. */
let pendingJobId: string | null = null;
export function setPendingDeliverJob(id: string | null): void { pendingJobId = id; }

const DeliveryJobs: React.FC<Props> = ({ pushToast, onDeliver }) => {
    const [jobs, setJobs] = useState<WrikeJob[]>([]);
    const [mock, setMock] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const [found, setFound] = useState<Found | null>(null);
    const [looking, setLooking] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [colors, setColors] = useState<Record<string, FinderColor>>({});
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
    useEffect(() => {
        if (!pendingJobId) return;
        const job = jobs.find((j) => j.id === pendingJobId);
        if (!job) return;
        pendingJobId = null;
        void open(job);
    }, [jobs]);

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
            const f: Found = {
                folders: (r.folders || []).map((fo: RenderFolder) => ({ ...fo, files: grouped(fo.files || []) })),
                missing: r.missing || [],
                noTerritory: r.noTerritory,
            };
            // The Finder colours BEFORE the list shows, since they decide
            // which version starts ticked.
            const c = await readFinderColors(f.folders.reduce<string[]>((acc, fo) => acc.concat(fo.files.map((x) => x.path)), []));
            setColors(c);
            setFound(f);
            setPicked(defaultPicks(f.folders, c));
        } finally {
            setLooking(false);
        }
    };

    // Ticking a version unticks its siblings: one deliverable, one render.
    const toggle = (file: RenderFile) => setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(file.path)) { next.delete(file.path); return next; }
        if (file.matched && found) {
            found.folders.forEach((fo) => fo.files.forEach((x) => { if (x.key === file.key) next.delete(x.path); }));
        }
        next.add(file.path);
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
                const wantedNames = deliverableNames(job);
                const hints = found ? nearMisses(
                    found.folders,
                    wantedNames,
                    (job.subtasks || []).filter((st) => st.name && wantedNames.indexOf(st.name) === -1)
                        .map((st) => ({ name: st.name, status: st.customStatusName || "" })),
                ) : {};
                // A missing subtask whose render is on disk under a near name.
                const missingWhy: Record<string, string> = {};
                Object.keys(hints).forEach((p) => {
                    const h = hints[p];
                    if (h.kind !== "status") missingWhy[h.subtask] = `${h.text} (${p.split("/").pop()})`;
                });
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
                                {fo.files.map((f, i) => {
                                    const on = picked.has(f.path);
                                    const color = colors[f.path] || "";
                                    // A later version of the row above: drawn as one group.
                                    const sibling = i > 0 && f.matched && fo.files[i - 1].key === f.key;
                                    const versions = fo.files.filter((x) => x.key === f.key).length;
                                    const hint = hints[f.path];
                                    const note = !f.matched ? (hint ? hint.text : "not in this job")
                                        : isBadColor(color) ? "marked red"
                                        : f.variant ? f.variant.replace("_", " ").toLowerCase() + (versions > 1 && f.latest ? " · newest" : "")
                                        : versions > 1 ? (f.latest ? "newest" : "older") : "";
                                    return (
                                        <div key={f.path} className={"dj-row" + (f.matched ? "" : " is-other") + (on ? " is-on" : "") + (sibling ? " is-version" : "") + (isBadColor(color) ? " is-bad" : "")}>
                                            <CheckboxToggle checked={on} onChange={() => toggle(f)} />
                                            <FileBadge of={f.name} />
                                            <span className="dj-file" title={f.path}>{f.name}</span>
                                            {color && <span className={"dj-dot is-" + color} title={`Marked ${color} in Finder`} />}
                                            {note && <span className={"dj-tag" + (hint && hint.kind !== "status" ? " is-warn" : "")} title={hint ? hint.subtask : undefined}>{note}</span>}
                                            <button type="button" className="dj-play" onClick={() => openInDefaultApp(f.path)} aria-label="Play" title="Open in QuickTime">
                                                <Play size={11} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                        {/* EVERY missing one, each on its own line with why when
                            there's a near render -- a truncated sentence hid which. */}
                        {found && found.missing.length > 0 && (
                            <div className="dj-missing">
                                <p className="dj-note is-warn">No exact render for {found.missing.length}:</p>
                                {found.missing.map((m) => (
                                    <div key={m} className="dj-missing-row">
                                        <span className="dj-missing-name" title={m}>{m}</span>
                                        {missingWhy[m] && <span className="dj-missing-why" title={missingWhy[m]}>{missingWhy[m]}</span>}
                                    </div>
                                ))}
                            </div>
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
