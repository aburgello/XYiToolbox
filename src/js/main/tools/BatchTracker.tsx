// =============================================================================
// src/js/main/tools/BatchTracker.tsx
// -----------------------------------------------------------------------------
// ONE BATCH, LINED UP BY DELIVERABLE. Each deliverable lives in four places --
// its artwork in JPG_PNG, its project in AE, its render in Renders, its
// delivered file in _Delivery (never _mp4, which is previews) -- plus a Wrike subtask. This shows them
// side by side, so "what's left on Norway Batch_02" is one screen, and a name
// that disagrees between two of them (Norway's "Post" project against its
// "Digital MetroPOST" artwork) is flagged the moment both exist, not when MC
// It! or Deliver quietly skips it.
//
// READ-ONLY. It lists folders (tracker.ts) and opens Finder windows; it never
// moves, renames or writes anything. Near misses are POINTED OUT, never
// joined -- the rule every matcher here keeps.
//
// The strip at the top is "where is it": one press to each of the batch's
// folders and the territory's Specs, and to the open project's own art and
// render when the open project is in this batch.
//
// WRIKE LEADS. When the batch has a job in the feed, its subtasks ARE the
// list -- they are what has to be delivered -- and every row starts folded to
// one line: name, four stage pips, and either a count of problems or a tick.
// Opening a row shows its stages (each a Finder link) and the problems in
// words. What sits on disk but is not in Wrike folds into one line at the
// bottom: usually a misnamed file, which the near misses already point at.
// With no job in the feed it falls back to everything on disk.
//
// EACH PROBLEM CARRIES ITS WAY OUT, as a button on the opened row, and all but
// one hand off to the tool that already owns the job rather than redoing it:
//   Open in AE      -- openLocalisedProject (copy-first on an OV name).
//   Build it        -- stages the subtask for Build a Batch, exactly as Active
//                      Jobs does, and goes back to the Localise landing; the
//                      builder keeps every guard (skip-existing and the rest).
//   Deliver         -- opens Deliver on this job's renders (take-once handoff).
//   Rename to match -- the ONE write: a Wrike subtask whose files are on disk
//                      under another name (tracker.ts's claims) is renamed to
//                      Wrike's name, after a confirm listing what moves. The
//                      comp inside is renamed when that project is open.
// YOUR JOBS lead the page: every Wrike job assigned to you is a chip carrying
// its own progress (built / rendered / delivered of its subtasks, problems,
// how far Wrike is behind), found on disk by trackerLocate the way Deliver
// finds a territory. A chip opens that batch -- no project needs to be open,
// and with none open the chips ARE the page. Scanned once on open and on
// refresh, one job at a time; never polled.
//
// PREVIEWS: the studio renders a web-playable mp4 per deliverable into the
// batch's _mp4 (the MOVs are ProRes, which Chromium can't decode). An opened
// row shows its poster frame, playing on hover, and a press opens the ONE
// player (VideoOverlay); the folded row has a play button beside it. A preview
// older than the newest render says so. Never counted as delivered.
//
// "Wrike looks behind" (rendered, Wrike still Backlog/Motion) is a HINT, not a
// problem: the panel can't write to Wrike, and a row that is fine must not
// read as broken.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, FileBox, Film, PackageCheck, FileText, RefreshCw, Loader2, AlertTriangle, MapPin, Search, ChevronRight, Check, HardDrive, FolderOpen, Hammer, Truck, PenLine, ArrowUpRight, Play } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import Dropdown from "../Dropdown";
import { fetchJobs, fetchJobsFresh, jobReadiness, territoryFlag, parseJobTitle, statusTint, DELIVERABLE_STATUSES, type WrikeJob } from "../lib/jobsFeed";
import { loadJobRows, stageBatchFromJob, classifyRows } from "../lib/jobRows";
import { navigateToTool } from "../lib/navigation";
import { confirmDialog } from "../Dialog";
import VideoOverlay from "../VideoOverlay";
import { usePosterFrame } from "../lib/renderPreview";
import { toFileUrl } from "../lib/fileUrl";
import type { ToolProps } from "../toolRegistry";
import { jobTerritory, setPendingDeliverJob } from "./DeliveryJobs";
import { readFinderColors, revealInFinder, type FinderColor } from "../lib/finderLabels";
import "./BatchTracker.scss";

interface Row {
    key: string;
    name: string;
    art?: { path: string; files: number };
    aep?: { name: string; path: string; version: number; versions: number };
    render?: { name: string; path: string; version: number; versions: number; all: string[] };
    delivered?: { name: string; path: string };
    /** The web-playable preview in _mp4 -- never a delivery. */
    preview?: { name: string; path: string; version: number };
    wrike?: { name: string; status: string };
    near?: { stage: string; name: string; why: string }[];
    /** Wrike's subtask, found on disk under another name (tracker.ts). */
    claimed?: { name: string; why: string };
}
interface Scan { territory: string; batch: string; folders: { art: string; aep: string; renders: string; delivered: string[]; specs: string }; rows: Row[] }

const loose = (s: string) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|\D)0+(\d)/g, "$1$2");
/** A row's problems, in words. A near miss REPLACES the plain "missing" line
 *  for its stage: "the project is named X" says more than "no project". */
export function rowIssues(r: Row, color: string): string[] {
    const out: string[] = [];
    const near = r.near || [];
    const nearOn = (label: RegExp) => near.some((n) => label.test(n.stage));
    if (r.claimed) out.push(`On disk it's named ${r.claimed.name} (${r.claimed.why}). Deliver and Review pair on the exact name, so they won't find it until it's renamed.`);
    for (const n of near) out.push(`The ${n.stage} is named ${n.name}: ${n.why}.`);
    if (!r.art && !nearOn(/^art/)) out.push("No artwork folder in JPG_PNG.");
    if (!r.aep && !nearOn(/^project/)) out.push("No project in AE.");
    if (!r.render && !nearOn(/^render/) && r.wrike && /prep|deliver|review|revised/i.test(r.wrike.status)) out.push(`Not rendered, but Wrike says ${r.wrike.status}.`);
    if (r.render && color === "red") out.push("The newest render is marked red in Finder.");
    return out;
}

/** Rendered, and Wrike still at a status from before rendering. A hint only. */
export const wrikeBehind = (r: Row): boolean => !!(r.render && r.wrike && /^(backlog|motion)$/i.test(r.wrike.status.trim()));

/** What a job's chip shows: its subtasks' stages, counted. */
interface JobSummary { total: number; built: number; rendered: number; delivered: number; problems: number; behind: number }
export function summarise(rows: Row[]): JobSummary {
    const w = rows.filter((r) => !!r.wrike);
    return {
        total: w.length,
        built: w.filter((r) => !!r.aep).length,
        rendered: w.filter((r) => !!r.render).length,
        delivered: w.filter((r) => !!r.delivered).length,
        problems: w.filter((r) => rowIssues(r, "").length > 0).length,
        behind: w.filter(wrikeBehind).length,
    };
}
interface Located { id: string; territoryPath: string; territory: string; batch: string; batches: string[] }
/** A job's batch as a folder name, the way Build a Batch writes it. */
const jobBatch = (j: WrikeJob) => parseJobTitle(j.title).batch.trim().replace(/\s+/g, "_") || "Batch_1";
const subsOf = (j: WrikeJob) => (j.subtasks || []).filter((st) => st.name).map((st) => ({ name: st.name, status: st.customStatusName || st.status || "" }));
/** "NO 2", "CL 1 POST": what the chip is called. */
const jobLabel = (j: WrikeJob) => {
    const p = parseJobTitle(j.title);
    const n = (p.batch.match(/\d+/) || ["1"])[0].replace(/^0+(?=\d)/, "");
    return [p.territory || p.name || j.title, n, /POST/i.test(p.batch) ? "POST" : ""].filter(Boolean).join(" ");
};

/** A preview older than the newest render: the one on screen isn't current. */
export const previewStale = (r: Row): boolean => !!(r.preview && r.render && r.render.version > r.preview.version);

/** The preview's poster frame, as OV Library and Review show one, playing on
 *  hover; a press opens the player. */
const PreviewThumb: React.FC<{ path: string; label: string; onOpen: () => void }> = ({ path, label, onOpen }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const poster = usePosterFrame(videoRef, () => {});
    return (
        <button type="button" className={"bt-thumb" + (failed ? " is-failed" : "")} onClick={onOpen} title={`Play ${label}`}
            onMouseEnter={() => { const v = videoRef.current; if (v && !failed) { v.currentTime = 0; v.play().catch(() => {}); } }}
            onMouseLeave={() => poster.restToPoster()}>
            {!failed && (
                <video ref={videoRef} src={toFileUrl(path)} muted loop playsInline preload="metadata"
                    onLoadedMetadata={poster.onLoadedMetadata} onSeeked={poster.onSeeked} onLoadedData={poster.onLoadedData} onError={() => setFailed(true)} />
            )}
            <span className="bt-thumb-play"><Play size={12} /></span>
        </button>
    );
};

const stem = (p: string) => (p.split(/[\\/]/).pop() || p).replace(/\.[^.]+$/, "").replace(/_V\d+$/i, "").toUpperCase();

const BatchTracker: React.FC<ToolProps> = ({ onSelectTool }) => {
    const [territoryPath, setTerritoryPath] = useState("");
    const [territory, setTerritory] = useState("");
    const [batches, setBatches] = useState<string[]>([]);
    const [batch, setBatch] = useState("");
    const [openProject, setOpenProject] = useState("");
    const [scan, setScan] = useState<Scan | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [colors, setColors] = useState<Record<string, FinderColor>>({});
    const [onlyIssues, setOnlyIssues] = useState(false);
    const [ready, setReady] = useState(false);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [showExtra, setShowExtra] = useState(false);
    /** The batch's Wrike jobs, kept for the hand-offs (Build it, Deliver). */
    const [jobs, setJobs] = useState<WrikeJob[]>([]);
    const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
    const [acting, setActing] = useState("");
    /** Comps in the open project still carrying a name its file no longer has. */
    const [staleComps, setStaleComps] = useState<string[]>([]);
    /** Every Wrike job assigned to you, where it is on disk, and how far along. */
    const [myJobs, setMyJobs] = useState<WrikeJob[]>([]);
    const [located, setLocated] = useState<Record<string, Located>>({});
    const [sums, setSums] = useState<Record<string, JobSummary>>({});
    const [jobsBusy, setJobsBusy] = useState(false);
    const [playing, setPlaying] = useState<{ path: string; title: string } | null>(null);

    // Where the open project sits decides the first view.
    useEffect(() => {
        (async () => {
            try {
                const c = (await evalTS("trackerContext")) as any;
                if (c && c.territoryPath) {
                    setTerritoryPath(c.territoryPath);
                    setTerritory(c.territory || "");
                    setBatches(c.batches || []);
                    setBatch(c.batch || "");
                }
                if (c && c.projectPath) setOpenProject(c.projectPath);
            } catch { /* preview */ }
            setReady(true);
        })();
    }, []);

    // The Wrike subtasks of THIS territory's job for THIS batch, if the feed
    // has one: same code, same batch number (a title with none is batch 1).
    const wrikeFor = async (terr: string, b: string): Promise<{ subs: { name: string; status: string }[]; jobs: WrikeJob[] }> => {
        const none = { subs: [], jobs: [] };
        try {
            const state = (await evalTS("teamGetMachineState")) as { owner?: string } | undefined;
            const owner = (state && state.owner) || "";
            if (!owner) return none;
            const code = String((await evalTS("getTerritoryCountryCode", terr)) || "").toUpperCase();
            if (!code) return none;
            const res = await fetchJobs(owner);
            if (res.mock) return none;
            const out: { name: string; status: string }[] = [];
            const mine = res.jobs.filter((j: WrikeJob) => jobTerritory(j) === code && loose(parseJobTitle(j.title).batch.replace(/\s*POST$/i, "")) === loose(b.replace(/_?POST$/i, "")));
            mine.forEach((j) => (j.subtasks || []).forEach((st) => { if (st.name) out.push({ name: st.name, status: st.customStatusName || st.status || "" }); }));
            return { subs: out, jobs: mine };
        } catch {
            return none;
        }
    };

    const run = async (tp = territoryPath, b = batch, terr = territory) => {
        if (!tp || !b) return;
        setBusy(true);
        setError("");
        try {
            const w = await wrikeFor(terr, b);
            setJobs(w.jobs);
            const r = (await evalTSSafe("trackerScan", JSON.stringify({ territoryPath: tp, batch: b, wrike: w.subs }))) as any;
            if (!r || !r.success) { setError((r && r.error) || "Couldn't read the batch."); return; }
            setScan({ territory: r.territory, batch: r.batch, folders: r.folders, rows: r.rows || [] });
            // The page's own scan is fresher than the chip's: keep them agreeing.
            if (w.jobs.length) setSums((prev) => {
                const next = { ...prev };
                for (const j of w.jobs) {
                    const names = new Set(subsOf(j).map((x) => x.name));
                    next[j.id] = summarise((r.rows || []).filter((x: Row) => x.wrike && names.has(x.wrike.name)));
                }
                return next;
            });
            setOpen({});
            setShowExtra(false);
            // Finder colours on the newest renders: green/orange good, red not.
            const paths = (r.rows || []).filter((x: Row) => x.render).map((x: Row) => x.render!.path);
            setColors(await readFinderColors(paths));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => { if (ready && territoryPath && batch) void run(); }, [ready, territoryPath, batch]);

    // YOUR JOBS: listed, located on disk, then summarised one at a time.
    const loadJobs = async (live: boolean) => {
        setJobsBusy(true);
        try {
            let owner = "";
            try {
                const st = (await evalTS("teamGetMachineState")) as { owner?: string } | undefined;
                owner = (st && st.owner) || "";
            } catch { /* untagged */ }
            if (!owner) { setMyJobs([]); return; }
            const pick = (res: Awaited<ReturnType<typeof fetchJobs>>) => {
                if (res.mock) return [] as WrikeJob[];
                const who = res.viewingAs || owner;
                return res.jobs.filter((j) => j.assignee === who && (j.subtaskCount ?? 0) > 0 && jobReadiness(j.status) !== "done" && subsOf(j).length > 0);
            };
            const res = live ? await fetchJobs(owner, true) : await fetchJobsFresh(owner, (r) => setMyJobs(pick(r)));
            const list = pick(res);
            setMyJobs(list);
            if (!list.length) return;
            const loc = (await evalTS("trackerLocate", JSON.stringify(list.map((j) => ({
                id: j.id, code: jobTerritory(j), batch: jobBatch(j), prefix: (subsOf(j)[0].name.split("_")[0] || "").toUpperCase(),
            }))))) as any;
            // An engine error here used to vanish, leaving every chip "not found".
            if (!loc || !loc.success) setMsg({ text: `Couldn't look for your jobs' folders: ${(loc && loc.error) || "no answer from AE"}`, bad: true });
            const map: Record<string, Located> = {};
            ((loc && loc.jobs) || []).forEach((x: Located) => { map[x.id] = x; });
            setLocated(map);
            for (const j of list) {
                const at = map[j.id];
                if (!at) continue;
                try {
                    const r = (await evalTS("trackerScan", JSON.stringify({ territoryPath: at.territoryPath, batch: at.batch, wrike: subsOf(j) }))) as any;
                    if (r && r.success) setSums((prev) => ({ ...prev, [j.id]: summarise(r.rows || []) }));
                } catch { /* one job's folder unreadable: its chip just shows no bar */ }
            }
        } finally {
            setJobsBusy(false);
        }
    };
    useEffect(() => { if (ready) void loadJobs(false); }, [ready]);

    const openJob = (j: WrikeJob) => {
        const at = located[j.id];
        if (!at) { setMsg({ text: `Couldn't find ${jobLabel(j)} under any campaign's Markets folder.`, bad: true }); return; }
        setTerritoryPath(at.territoryPath);
        setTerritory(at.territory);
        setBatches(at.batches.some((b) => loose(b) === loose(at.batch)) ? at.batches : at.batches.concat([at.batch]));
        setBatch(at.batch);
        setMsg(null);
    };
    const isOpenJob = (j: WrikeJob) => {
        const at = located[j.id];
        return !!at && at.territoryPath === territoryPath && loose(at.batch) === loose(batch);
    };

    const jobChips = (overview: boolean) => (
        <div className={"bt-jobs" + (overview ? " is-overview" : "")}>
            {myJobs.map((j) => {
                const sm = sums[j.id];
                const at = located[j.id];
                const pct = (n: number) => (sm && sm.total ? (100 * n) / sm.total : 0);
                const flag = territoryFlag(parseJobTitle(j.title).territory);
                return (
                    <button key={j.id} type="button" className={"bt-job" + (isOpenJob(j) ? " is-on" : "") + (at ? "" : " is-lost")} onClick={() => openJob(j)}
                        title={at ? `${j.title}\n${at.territory} · ${at.batch}` : `${j.title}\nNot found under any campaign's Markets folder`}>
                        <span className="bt-job-top">
                            {flag && <span className="bt-job-flag">{flag}</span>}
                            <span className="bt-job-label">{jobLabel(j)}</span>
                            {sm && sm.problems > 0 && <span className="bt-issues"><AlertTriangle size={10} />{sm.problems}</span>}
                            {sm && sm.behind > 0 && <span className="bt-job-behind" title={`${sm.behind} rendered, Wrike still behind`}><ArrowUpRight size={10} />{sm.behind}</span>}
                            {overview && <span className="bt-job-status" style={{ color: statusTint(j.status).color }}>{j.status}</span>}
                        </span>
                        <span className="bt-job-bar" aria-label={sm ? `${sm.built} built, ${sm.rendered} rendered, ${sm.delivered} delivered of ${sm.total}` : "Reading…"}>
                            <i className="is-built" style={{ width: pct(sm ? sm.built : 0) + "%" }} />
                            <i className="is-rendered" style={{ width: pct(sm ? sm.rendered : 0) + "%" }} />
                            <i className="is-delivered" style={{ width: pct(sm ? sm.delivered : 0) + "%" }} />
                        </span>
                        {overview && (
                            <span className="bt-job-counts">
                                {sm ? `${sm.built}/${sm.total} built · ${sm.rendered} rendered · ${sm.delivered} delivered` : at ? "Reading…" : "Not found on disk"}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );

    // Which project is open, and whether its comp still has an old name.
    const refreshHere = async () => {
        try {
            const c = (await evalTS("trackerContext")) as any;
            setOpenProject((c && c.projectPath) || "");
            const cc = (await evalTS("trackerCompCheck")) as any;
            setStaleComps((cc && cc.success && cc.comps) || []);
        } catch { /* preview */ }
    };
    useEffect(() => { if (ready) void refreshHere(); }, [ready]);

    const jobOf = (r: Row): WrikeJob | undefined =>
        r.wrike ? jobs.find((j) => (j.subtasks || []).some((st) => st.name === r.wrike!.name)) : undefined;

    const openInAE = async (r: Row) => {
        if (!r.aep) return;
        setActing("open:" + r.key);
        try {
            const res = (await evalTSSafe("openLocalisedProject", r.aep.path)) as any;
            if (!res || !res.success) { setMsg({ text: (res && res.error) || "Couldn't open it.", bad: true }); return; }
            await refreshHere();
        } finally { setActing(""); }
    };

    /** Stage these subtasks for Build a Batch, exactly as Active Jobs does,
     *  and go back to the Localise landing where the builder picks them up. */
    const build = async (targets: Row[]) => {
        const job = targets.length ? jobOf(targets[0]) : undefined;
        if (!job) { setMsg({ text: "No Wrike job to build from.", bad: true }); return; }
        setActing("build");
        try {
            const names = new Set(targets.filter((t) => jobOf(t) === job).map((t) => t.wrike!.name));
            const rows = (await loadJobRows(job)).filter((x) => names.has(x.name));
            const { sendable } = classifyRows(rows);
            if (!sendable.length) {
                const why = rows[0] && rows[0].missing.length ? `its name is missing ${rows[0].missing.join(", ")}` : "its Wrike status isn't one Localise builds from";
                setMsg({ text: `Nothing to build: ${why}.`, bad: true });
                return;
            }
            stageBatchFromJob(job, sendable);
            if (onSelectTool) onSelectTool("");
            else setMsg({ text: `${sendable.length} staged for Build a Batch -- open Localise to see them.` });
        } finally { setActing(""); }
    };

    const deliver = (r: Row) => {
        const job = jobOf(r);
        if (!job) return;
        setPendingDeliverJob(job.id);
        const nav = navigateToTool("delivery-hub");
        if (!nav.ok) setMsg({ text: nav.reason || "Couldn't open Deliver.", bad: true });
    };

    const rename = async (r: Row) => {
        if (!r.claimed || !r.wrike || !scan) return;
        const req = { territoryPath, batch, from: r.claimed.name, to: r.wrike.name };
        setActing("rename:" + r.key);
        try {
            const dry = (await evalTSSafe("trackerRename", JSON.stringify({ ...req, apply: false }))) as any;
            if (!dry || !dry.success) { setMsg({ text: (dry && dry.error) || "Couldn't plan the rename.", bad: true }); return; }
            const plan = dry.plan as { from: string; to: string; kind: string }[];
            const kinds: Record<string, number> = {};
            plan.forEach((x) => { kinds[x.kind] = (kinds[x.kind] || 0) + 1; });
            const list = Object.keys(kinds).map((k) => `${kinds[k]} ${k}${kinds[k] === 1 ? "" : k.endsWith("s") ? "" : "s"}`).join(", ");
            const ok = await confirmDialog({
                title: `Rename ${plan.length} file${plan.length === 1 ? "" : "s"} to Wrike's name?`,
                body: `${list}:\n${r.claimed.name}\n→ ${r.wrike.name}\n\nVersions and suffixes stay. The artwork isn't touched. The comp inside keeps its old name until you open the project — the tracker offers to fix it then.`,
                confirm: "Rename",
            });
            if (!ok) return;
            const res = (await evalTSSafe("trackerRename", JSON.stringify({ ...req, apply: true }))) as any;
            if (!res || !res.success) { setMsg({ text: (res && res.error) || "Couldn't rename.", bad: true }); }
            else setMsg({ text: `Renamed ${res.renamed}. Open it in AE to rename the comp to match.` });
            await run();
        } finally { setActing(""); }
    };

    const renameComp = async () => {
        setActing("comp");
        try {
            const res = (await evalTSSafe("trackerRenameComp")) as any;
            if (!res || !res.success) { setMsg({ text: (res && res.error) || "Couldn't rename the comp.", bad: true }); return; }
            setMsg({ text: `Renamed ${res.renamed} comp${res.renamed === 1 ? "" : "s"} to match the file. Save when you're ready (Ctrl+Z undoes it).` });
            await refreshHere();
        } finally { setActing(""); }
    };

    const pick = async () => {
        const r = (await evalTS("trackerPickFolder")) as any;
        if (!r || !r.territoryPath) return;
        const b = (await evalTS("trackerBatches", r.territoryPath)) as any;
        setTerritoryPath(r.territoryPath);
        setTerritory(r.territoryPath.split(/[\\/]/).pop() || "");
        setBatches((b && b.batches) || []);
        setBatch(r.batch || ((b && b.batches) || [])[0] || "");
    };

    const all = scan ? scan.rows : [];
    const fromWrike = all.some((r) => !!r.wrike);
    // Wrike's subtasks are the list when there are any; the rest is extra.
    const rows = fromWrike ? all.filter((r) => !!r.wrike) : all;
    const extra = fromWrike ? all.filter((r) => !r.wrike) : [];
    const count = (f: (r: Row) => boolean) => rows.filter(f).length;
    const colorOf = (r: Row) => (r.render ? colors[r.render.path] || "" : "");
    const issuesOf = (r: Row) => rowIssues(r, colorOf(r));
    const issue = (r: Row): boolean => issuesOf(r).length > 0;
    const shown = onlyIssues ? rows.filter(issue) : rows;
    const openStem = openProject ? stem(openProject) : "";
    const openRow = all.find((r) => r.aep && stem(r.aep.path) === openStem);
    const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
    const toBuild = rows.filter((r) => r.wrike && !r.aep && !r.claimed && jobOf(r));
    const behindCount = count(wrikeBehind);

    const Link: React.FC<{ icon: React.ReactNode; label: string; path?: string; folder?: boolean }> = ({ icon, label, path, folder }) => (
        <button type="button" className="bt-link" disabled={!path} title={path || `No ${label.toLowerCase()} for this batch`} onClick={() => path && revealInFinder(path, !!folder)}>
            {icon}<span>{label}</span>
        </button>
    );

    const Dot: React.FC<{ on: boolean; label: string; title: string; path?: string; folder?: boolean; extra?: React.ReactNode; tone?: string }> = ({ on, label, title, path, folder, extra, tone }) => (
        <button type="button" className={"bt-stage" + (on ? " is-on" : "") + (tone ? " is-" + tone : "")} disabled={!path} title={title} onClick={() => path && revealInFinder(path, !!folder)}>
            <span className="bt-stage-dot" />
            <span className="bt-stage-label">{label}</span>
            {extra}
        </button>
    );

    const renderRow = (r: Row, isExtra: boolean) => {
        const c = colorOf(r);
        const isHere = !!openRow && openRow.key === r.key;
        const problems = issuesOf(r);
        const isOpen = !!open[r.key];
        const label = r.wrike ? r.wrike.name : r.name;
        const pip = (on: boolean, bad = false) => <i className={"bt-pip" + (on ? " is-on" : "") + (bad ? " is-bad" : "")} />;
        return (
            <div key={r.key} className={"bt-row" + (isHere ? " is-here" : "") + (problems.length ? " has-issue" : "") + (isOpen ? " is-open" : "") + (isExtra ? " is-extra" : "")}>
                <div className="bt-row-head">
                <button type="button" className="bt-row-top" onClick={() => toggle(r.key)} aria-expanded={isOpen}>
                    <ChevronRight size={13} className="bt-chev" />
                    {isHere && <MapPin size={12} className="bt-here-pin" aria-label="Open in AE" />}
                    <span className="bt-name" title={isHere ? label + " (open in AE)" : label}>{label}</span>
                    <span className="bt-pips" title="Art · Built · Rendered · Delivered">
                        {pip(!!r.art)}{pip(!!r.aep)}{pip(!!r.render, c === "red")}{pip(!!r.delivered)}
                    </span>
                    {problems.length > 0
                        ? <span className="bt-issues" title={problems.join("\n")}><AlertTriangle size={11} />{problems.length}</span>
                        : <span className="bt-ok" title="Nothing to look at"><Check size={12} /></span>}
                    {r.wrike && (
                        <span className={"bt-wrike" + (wrikeBehind(r) ? " is-behind" : "")} style={{ color: statusTint(r.wrike.status).color, background: statusTint(r.wrike.status).background }}
                            title={wrikeBehind(r) ? `Rendered, but Wrike still says ${r.wrike.status}` : "Wrike"}>
                            {wrikeBehind(r) && <ArrowUpRight size={10} />}{r.wrike.status || "Wrike"}
                        </span>
                    )}
                </button>
                {r.preview && (
                    <button type="button" className={"bt-play" + (previewStale(r) ? " is-stale" : "")} aria-label="Play the preview"
                        title={`Play ${r.preview.name}${previewStale(r) ? " (older than the newest render)" : ""}`}
                        onClick={() => setPlaying({ path: r.preview!.path, title: r.preview!.name })}>
                        <Play size={11} />
                    </button>
                )}
                </div>
                {isOpen && (
                    <div className="bt-detail">
                        <div className="bt-detail-top">
                        {r.preview && (
                            <PreviewThumb path={r.preview.path} label={r.preview.name} onOpen={() => setPlaying({ path: r.preview!.path, title: r.preview!.name })} />
                        )}
                        <div className="bt-stages">
                            <Dot on={!!r.art} label="Art" folder path={r.art?.path} title={r.art ? `${r.art.files} image${r.art.files === 1 ? "" : "s"} in JPG_PNG` : "No JPG_PNG folder with this name"} />
                            <Dot on={!!r.aep} label="Built" path={r.aep?.path} title={r.aep ? r.aep.name : "No project with this name in AE"} extra={r.aep && r.aep.version ? <em>V{String(r.aep.version).padStart(2, "0")}</em> : null} />
                            <Dot on={!!r.render} label="Rendered" path={r.render?.path} tone={c === "red" ? "bad" : c === "green" || c === "orange" ? "good" : ""}
                                title={r.render ? `${r.render.name}${r.render.versions > 1 ? ` (newest of ${r.render.versions})` : ""}${c ? ` · marked ${c} in Finder` : ""}` : "No render in this batch's Renders folder"}
                                extra={r.render ? <em>V{String(r.render.version).padStart(2, "0")}{c ? <i className={"bt-fc is-" + c} /> : null}</em> : null} />
                            <Dot on={!!r.delivered} label="Delivered" path={r.delivered?.path} title={r.delivered ? r.delivered.name : "Not in _Delivery yet"} />
                        </div>
                        </div>
                        {previewStale(r) && (
                            <p className="bt-hint"><Play size={11} /> <span>The preview is V{String(r.preview!.version).padStart(2, "0")}; the newest render is V{String(r.render!.version).padStart(2, "0")}.</span></p>
                        )}
                        {problems.length === 0 && <p className="bt-fine"><Check size={11} /> Nothing to look at.</p>}
                        {problems.map((t, i) => (
                            <p key={i} className="bt-near"><AlertTriangle size={11} /> <span>{t}</span></p>
                        ))}
                        {wrikeBehind(r) && (
                            <p className="bt-hint"><ArrowUpRight size={11} /> <span>Rendered V{String(r.render!.version).padStart(2, "0")}, but Wrike still says {r.wrike!.status}.</span></p>
                        )}
                        {(() => {
                            const acts: React.ReactNode[] = [];
                            if (r.claimed && r.wrike) acts.push(
                                <button key="rn" type="button" className="bt-act is-primary" disabled={!!acting} onClick={() => void rename(r)}>
                                    {acting === "rename:" + r.key ? <Loader2 size={12} className="spin" /> : <PenLine size={12} />} Rename to match Wrike
                                </button>);
                            if (r.aep && !isHere) acts.push(
                                <button key="op" type="button" className="bt-act" disabled={!!acting} onClick={() => void openInAE(r)}>
                                    {acting === "open:" + r.key ? <Loader2 size={12} className="spin" /> : <FolderOpen size={12} />} Open in AE
                                </button>);
                            if (r.wrike && !r.aep && !r.claimed && jobOf(r)) acts.push(
                                <button key="bd" type="button" className="bt-act is-primary" disabled={!!acting} onClick={() => void build([r])}>
                                    <Hammer size={12} /> Build it
                                </button>);
                            if (r.render && r.wrike && DELIVERABLE_STATUSES.test(r.wrike.status) && jobOf(r)) acts.push(
                                <button key="dl" type="button" className="bt-act is-primary" disabled={!!acting} onClick={() => deliver(r)}>
                                    <Truck size={12} /> Deliver
                                </button>);
                            return acts.length ? <div className="bt-acts">{acts}</div> : null;
                        })()}
                    </div>
                )}
            </div>
        );
    };

    if (!ready) return <div className="bt"><p className="bt-note"><Loader2 size={13} className="spin" /> Reading where the open project is…</p></div>;

    return (
        <div className="bt">
            <div className="bt-head">
                <div className="bt-where">
                    <span className="bt-title">{territory ? territory.replace(/_/g, " ") : myJobs.length ? "Pick a job" : "No territory"}</span>
                </div>
                {batches.length > 0 && (
                    <Dropdown value={batch} onChange={setBatch} options={batches.map((b) => ({ value: b, label: b }))} className="bt-batch" />
                )}
                <button type="button" className="bt-btn" onClick={() => void pick()} title="Pick a territory, or a batch in its AE folder">
                    <Search size={13} /> Other…
                </button>
                <button type="button" className="bt-btn bt-icon" disabled={busy || jobsBusy} onClick={() => { if (batch) void run(); void loadJobs(true); }} aria-label="Refresh" title="Read the folders and your Wrike jobs again">
                    <RefreshCw size={13} className={busy || jobsBusy ? "spin" : ""} />
                </button>
            </div>

            {territoryPath && myJobs.length > 0 && jobChips(false)}
            {!territoryPath && myJobs.length > 0 && (
                <>
                    <p className="bt-lead">Your jobs</p>
                    {jobChips(true)}
                </>
            )}
            {!territoryPath && myJobs.length === 0 && (
                <p className="bt-note">{jobsBusy ? <><Loader2 size={13} className="spin" /> Reading your Wrike jobs…</> : "Open a project inside a territory's AE folder, or press Other… to pick one."}</p>
            )}
            {!scan && msg && <p className={"bt-msg" + (msg.bad ? " is-bad" : "")} onClick={() => setMsg(null)}>{msg.text}</p>}
            {error && <p className="bt-note is-bad">{error}</p>}

            {scan && (
                <>
                    {/* WHERE IS IT: one press to each of the batch's folders. */}
                    <div className="bt-links">
                        <Link icon={<ImageIcon size={13} />} label="Art" path={scan.folders.art} folder />
                        <Link icon={<FileBox size={13} />} label="AE" path={scan.folders.aep} folder />
                        <Link icon={<Film size={13} />} label="Renders" path={scan.folders.renders} folder />
                        <Link icon={<PackageCheck size={13} />} label="Delivered" path={scan.folders.delivered[0]} folder />
                        <Link icon={<FileText size={13} />} label="Specs" path={scan.folders.specs} folder />
                    </div>
                    {openRow && (
                        <div className="bt-links bt-links--here">
                            <span className="bt-here"><MapPin size={12} /> Open project</span>
                            <Link icon={<ImageIcon size={13} />} label="Its art" path={openRow.art?.path} folder />
                            <Link icon={<Film size={13} />} label="Its render" path={openRow.render?.path} />
                        </div>
                    )}
                    {staleComps.length > 0 && (
                        <div className="bt-stale">
                            <AlertTriangle size={12} />
                            <span>The open project's comp is still called <strong>{staleComps[0]}</strong>{staleComps.length > 1 ? ` (+${staleComps.length - 1})` : ""}.</span>
                            <button type="button" className="bt-act is-primary" disabled={!!acting} onClick={() => void renameComp()}>
                                {acting === "comp" ? <Loader2 size={12} className="spin" /> : <PenLine size={12} />} Rename comp
                            </button>
                        </div>
                    )}
                    {msg && <p className={"bt-msg" + (msg.bad ? " is-bad" : "")} onClick={() => setMsg(null)} title="Dismiss">{msg.text}</p>}

                    <div className="bt-summary">
                        <span><strong>{rows.length}</strong> {fromWrike ? `in Wrike` : `on disk`}</span>
                        <span className="bt-count">{count((r) => !!r.art)} art</span>
                        <span className="bt-count">{count((r) => !!r.aep)} built</span>
                        <span className="bt-count">{count((r) => !!r.render)} rendered</span>
                        <span className="bt-count">{count((r) => !!r.delivered)} delivered</span>
                        {behindCount > 0 && <span className="bt-count is-behind" title="Rendered, but Wrike still says Backlog or Motion"><ArrowUpRight size={10} /> {behindCount} ahead of Wrike</span>}
                        <span className="bt-spacer" />
                        {toBuild.length > 1 && (
                            <button type="button" className="bt-btn" disabled={!!acting} onClick={() => void build(toBuild)} title="Stage every subtask with no project for Build a Batch">
                                <Hammer size={12} /> Build {toBuild.length}
                            </button>
                        )}
                        <button type="button" className={"bt-btn" + (onlyIssues ? " is-on" : "")} onClick={() => setOnlyIssues(!onlyIssues)}>
                            <AlertTriangle size={12} /> {count(issue)} to look at
                        </button>
                    </div>

                    <div className="bt-rows">
                        {!fromWrike && all.length > 0 && <p className="bt-note">No Wrike job for this batch in your feed, so this is everything on disk.</p>}
                        {shown.length === 0 && <p className="bt-note">{onlyIssues ? "Nothing to look at in this batch." : "Nothing in this batch yet."}</p>}
                        {shown.map((r) => renderRow(r, false))}
                        {extra.length > 0 && (
                            <>
                                <button type="button" className={"bt-extra" + (showExtra ? " is-open" : "")} onClick={() => setShowExtra(!showExtra)}
                                    title="Files in this batch's folders with no Wrike subtask of the same name">
                                    <ChevronRight size={13} className="bt-chev" /><HardDrive size={12} />
                                    <span>{extra.length} on disk, not in Wrike</span>
                                </button>
                                {showExtra && extra.map((r) => renderRow(r, true))}
                            </>
                        )}
                    </div>
                </>
            )}
            {playing && <VideoOverlay path={playing.path} title={playing.title} onClose={() => setPlaying(null)} errorHint="The preview in _mp4 couldn't be played. It may still be rendering, or have moved." />}
            {busy && !scan && <p className="bt-note"><Loader2 size={13} className="spin" /> Reading the batch…</p>}
        </div>
    );
};

export default BatchTracker;
