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
// TO AMEND puts "Amend" on the folded line: an amend is the subtask you're
// most likely to open next, so it's one press from the list rather than open
// row, then Open in AE. The open project's own row says it's open instead.
//
// A JOB IN TO AMEND brings its AMENDS comment (fetchJobComment, one Wrike
// call, cached): the newest comment BY SOMEBODY ELSE that names this batch's
// deliverables, else one naming any, else the newest. Both halves measured on
// NO 2 (2026-09-30): a hand-off landed after the amends, and the motioner's
// own "amends are in:" reply repeats every filename and note -- it is the
// amends DONE, and the newest comment naming deliverables. Your own comments
// are replies; the amends are the reviewer's. Amends are written on the PARENT task, per deliverable
// -- filenames, then the note -- so lib/amendNotes.ts splits it and each note
// lands on the row it names, matched through the disk's own spelling too (a
// comment naming Trio_POST_DOOH finds the row Wrike calls Trio_DOOH_POST).
// Those rows count as to amend and get the Amend press; a note on a version
// older than the newest render says a newer one exists since. What sits under
// no filename ("The others are approved") shows once, for the job.
//
// SPEED (2026-09-30). The NAS listings are cheap from Node (18 in ~40ms) but
// every trip into AE's engine is not, and the page used to make a lot: wait
// for the feed, scan, then one full scan PER JOB CHIP queued behind it in
// AE's single-threaded engine, all of it again when the live Wrike read
// landed, and all of it again on every tab switch. Now: the scan draws from
// the feed already in memory (or from the disk alone, Wrike merged in after);
// AE keeps each batch's listing a minute (tracker.ts) so a re-merge lists
// nothing; the chips are ONE call after the batch on screen; the tag and
// country code are asked once a session; and the session's last view comes
// back at once on remount while it re-checks behind it. Refresh forces a real
// read. The refresh button's tooltip says how long each part took.
//
// "Wrike looks behind" (rendered, Wrike still Backlog/Motion) is a HINT, not a
// problem: the panel can't write to Wrike, and a row that is fine must not
// read as broken.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, FileBox, Film, PackageCheck, FileText, RefreshCw, Loader2, AlertTriangle, MapPin, Search, ChevronRight, Check, HardDrive, FolderOpen, Hammer, Truck, PenLine, ArrowUpRight, Play, MessageSquare, MessageSquarePlus, Info, UploadCloud } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import Dropdown from "../Dropdown";
import { fetchJobs, fetchJobsFresh, fetchJobsLive, fetchJobComment, peekJobs, jobReadiness, territoryFlag, parseJobTitle, isLocaliseJob, statusTint, DELIVERABLE_STATUSES, AMEND_STATUSES, REVISED_STATUSES, type WrikeJob } from "../lib/jobsFeed";
import { loadJobRows, stageBatchFromJob, classifyRows } from "../lib/jobRows";
import { navigateToTool } from "../lib/navigation";
import { confirmDialog } from "../Dialog";
import { parseAmends, amendKey, showShortcodes, type AmendNote, type ParsedAmends } from "../lib/amendNotes";
import type { JobComment } from "../lib/jobsFeed";
import VideoOverlay from "../VideoOverlay";
import ActiveJobModal from "../ActiveJobModal";
import { usePosterFrame } from "../lib/renderPreview";
import { toFileUrl } from "../lib/fileUrl";
import type { ToolProps } from "../toolRegistry";
import { jobTerritory, setPendingDeliverJob } from "./DeliveryJobs";
import { readFinderColors, revealInFinder, type FinderColor } from "../lib/finderLabels";
import { mastersRendersFor } from "../lib/mastersRoot";
import TrackerMessage from "./TrackerMessage";
import { uploadNameFor } from "../lib/wrikeMessage";
import { loadUploadRoots, saveUploadRoot, uploadRootFor, uploadFolderFor, campaignKeyOf } from "../lib/uploadRoots";
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
interface Scan { territory: string; batch: string; folders: { art: string; aep: string; renders: string; delivered: string[]; specs: string; pdfs?: string }; rows: Row[] }

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

/** Wrike asks for changes to this one. */
export const toAmend = (r: Row): boolean => !!(r.wrike && AMEND_STATUSES.test(r.wrike.status.trim()));

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

/** "12:45" today, "29 Sep" before. */
const whenOf = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    return d.toDateString() === now.toDateString()
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString([], { day: "numeric", month: "short" });
};

const stem = (p: string) => (p.split(/[\\/]/).pop() || p).replace(/\.[^.]+$/, "").replace(/_V\d+$/i, "").toUpperCase();

/** SESSION MEMORY, module scope: what the page last showed, so a tab switch
 *  (a remount) draws at once and re-checks behind it. Plus the two answers
 *  that never change in a session: this machine's tag, a territory's code. */
type CommentView = { comment: JobComment | null; parsed: ParsedAmends; error?: string; newer?: JobComment };
const memo: {
    owner: string | null;
    codes: Record<string, string>;
    view: { territoryPath: string; territory: string; batches: string[]; batch: string } | null;
    scans: Record<string, { scan: Scan; colors: Record<string, FinderColor>; comments: Record<string, CommentView>; jobs: WrikeJob[] }>;
    myJobs: WrikeJob[];
    located: Record<string, Located>;
    sums: Record<string, JobSummary>;
    /** When each batch was last scanned, and with which Wrike statuses. */
    scanAt: Record<string, number>;
    scanSig: Record<string, string>;
    /** Job ids already looked for on disk (found or not): folders don't move. */
    lookedUp: Record<string, boolean>;
    /** When the chips were last summarised, and for which jobs and statuses. */
    sumsAt: number;
    sumsSig: string;
} = { owner: null, codes: {}, view: null, scans: {}, myJobs: [], located: {}, sums: {}, scanAt: {}, scanSig: {}, lookedUp: {}, sumsAt: 0, sumsSig: "" };
/** DON'T RE-CHECK WHAT WAS JUST CHECKED (2026-09-30). Localise remembers the
 *  Tracker as the last tab, so every visit mounted it, and every mount redid
 *  the batch, the jobs' folders and every chip -- in AE's one-at-a-time,
 *  main-thread engine, where the rest of the panel (and AE's own UI) waits
 *  behind it. A batch read in the last SCAN_FRESH_MS isn't read again, the
 *  chips aren't re-summarised within CHIPS_FRESH_MS unless the jobs or their
 *  statuses changed, and a job's folder is looked for once a session.
 *  Refresh always reads everything. */
const SCAN_FRESH_MS = 2 * 60 * 1000;
const CHIPS_FRESH_MS = 5 * 60 * 1000;
const subsSig = (subs: { name: string; status: string }[]) => subs.map((x) => x.name + "=" + x.status).sort().join("|");
const viewKey = (tp: string, b: string) => tp + "|" + loose(b);

interface Props extends ToolProps {
    /** From the Localise page's job chips: open on this job's batch. The tick
     *  changes on every press, so pressing the same chip again still lands. */
    openJob?: { id: string; tick: number } | null;
}

const BatchTracker: React.FC<Props> = ({ onSelectTool, openJob: wantJob }) => {
    const [territoryPath, setTerritoryPath] = useState(memo.view ? memo.view.territoryPath : "");
    const [territory, setTerritory] = useState(memo.view ? memo.view.territory : "");
    const [batches, setBatches] = useState<string[]>(memo.view ? memo.view.batches : []);
    const [batch, setBatch] = useState(memo.view ? memo.view.batch : "");
    const [openProject, setOpenProject] = useState("");
    const memoScan = memo.view ? memo.scans[viewKey(memo.view.territoryPath, memo.view.batch)] : undefined;
    const [scan, setScan] = useState<Scan | null>(memoScan ? memoScan.scan : null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [colors, setColors] = useState<Record<string, FinderColor>>(memoScan ? memoScan.colors : {});
    const [onlyIssues, setOnlyIssues] = useState(false);
    const [ready, setReady] = useState(false);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [showExtra, setShowExtra] = useState(false);
    /** The batch's Wrike jobs, kept for the hand-offs (Build it, Deliver). */
    const [jobs, setJobs] = useState<WrikeJob[]>(memoScan ? memoScan.jobs : []);
    const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
    const [acting, setActing] = useState("");
    /** Comps in the open project still carrying a name its file no longer has. */
    const [staleComps, setStaleComps] = useState<string[]>([]);
    /** Every Wrike job assigned to you, where it is on disk, and how far along. */
    const [myJobs, setMyJobs] = useState<WrikeJob[]>(memo.myJobs);
    const [located, setLocated] = useState<Record<string, Located>>(memo.located);
    const [sums, setSums] = useState<Record<string, JobSummary>>(memo.sums);
    const [jobsBusy, setJobsBusy] = useState(false);
    const [playing, setPlaying] = useState<{ path: string; title: string } | null>(null);
    /** The Wrike job window (ActiveJobModal): names Wrike didn't send, and the
     *  whole-job Send to Localise, one press from the batch it belongs to. */
    const [detailsJob, setDetailsJob] = useState<WrikeJob | null>(null);
    const wantTickDone = useRef(0);
    /** The latest Wrike comment of each To amend job on screen, split. */
    const [comments, setComments] = useState<Record<string, CommentView>>(memoScan ? memoScan.comments : {});
    /** How long the last read took, for the refresh button's tooltip. */
    const [timing, setTiming] = useState<{ folders?: number; engine?: number; cached?: boolean; wrike?: number; chips?: number }>({});
    /** Set by the refresh button: the next scan reads the disk, not AE's copy. */
    const forceNext = useRef(false);
    /** Resolves once the batch on screen has been scanned: the job chips wait
     *  for it, so they never queue in front of it in AE's engine. */
    const firstScan = useRef<{ done: Promise<void>; resolve: () => void } | null>(null);
    if (!firstScan.current) {
        let resolve: () => void = () => {};
        const done = new Promise<void>((r) => { resolve = r; });
        firstScan.current = { done, resolve };
    }
    const shownKey = useRef(memo.view ? viewKey(memo.view.territoryPath, memo.view.batch) : "");
    const [showFullComment, setShowFullComment] = useState(false);
    // Message for Wrike: the card, and the one fact it needs that the scan
    // doesn't carry (the masters' Renders folder, two listings, read on open).
    const [showMessage, setShowMessage] = useState(false);
    const [mastersRenders, setMastersRenders] = useState("");
    // The campaign's shared uploads folder, and this batch's folder under it.
    const [uploadRoot, setUploadRoot] = useState("");
    const [upload, setUpload] = useState<{ folder: string; open: string }>({ folder: "", open: "" });
    useEffect(() => {
        if (!territoryPath) { setUploadRoot(""); return; }
        let dead = false;
        void loadUploadRoots().then((roots) => { if (!dead) setUploadRoot(uploadRootFor(roots, territoryPath)); });
        return () => { dead = true; };
    }, [territoryPath]);
    useEffect(() => {
        const t = setTimeout(() => setUpload(uploadFolderFor(uploadRoot, territoryPath, batch)), 0);
        return () => clearTimeout(t);
    }, [uploadRoot, territoryPath, batch]);
    const pickUploadRoot = async () => {
        const campaign = campaignKeyOf(territoryPath);
        if (!campaign) return;
        const picked = (await evalTS("uploadRootPick", campaign)) as unknown as string;
        if (!picked) return;
        const why = await saveUploadRoot(territoryPath, picked);
        if (why) { setMsg({ text: why, bad: true }); return; }
        setUploadRoot(picked);
        setMsg({ text: `Uploads folder shared for ${campaign}. Everyone's Tracker uses it from now on.` });
    };
    useEffect(() => {
        if (!showMessage || !scan || !territoryPath) return;
        const names = scan.rows.map((r) => (r.wrike ? r.wrike.name : r.name));
        const t = setTimeout(() => setMastersRenders(mastersRendersFor(territoryPath, names)), 0);
        return () => clearTimeout(t);
    }, [showMessage, scan, territoryPath]);
    /** Set by the refresh button: the next comment read goes to Wrike. */
    const freshComments = useRef(false);
    /** This machine's tag ("Antonio"): the author whose comments are replies. */
    const ownerRef = useRef("");

    // Where the open project sits decides the first view.
    useEffect(() => {
        (async () => {
            try {
                const c = (await evalTS("trackerContext")) as any;
                // The session's last view wins over the open project: coming
                // back to the tab should be where you left it.
                if (c && c.territoryPath && !memo.view) {
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
    // Nothing to scan (no batch yet): the chips have nothing to wait for.
    useEffect(() => { if (ready && !(territoryPath && batch) && firstScan.current) firstScan.current.resolve(); }, [ready, territoryPath, batch]);

    // The Wrike subtasks of THIS territory's job for THIS batch, if the feed
    // has one: same code, same batch number (a title with none is batch 1).
    const ownerOf = async (): Promise<string> => {
        if (memo.owner !== null) return memo.owner;
        try {
            const state = (await evalTS("teamGetMachineState")) as { owner?: string } | undefined;
            memo.owner = (state && state.owner) || "";
        } catch { return ""; }
        return memo.owner || "";
    };
    const codeOf = async (terr: string): Promise<string> => {
        if (memo.codes[terr] !== undefined) return memo.codes[terr];
        try { memo.codes[terr] = String((await evalTS("getTerritoryCountryCode", terr)) || "").toUpperCase(); } catch { return ""; }
        return memo.codes[terr];
    };
    /** `peek`: only what's already in memory -- never wait on the network. */
    const wrikeFor = async (terr: string, b: string, peek = false): Promise<{ subs: { name: string; status: string }[]; jobs: WrikeJob[]; missing?: boolean }> => {
        const none = { subs: [], jobs: [] };
        try {
            const owner = await ownerOf();
            if (!owner) return none;
            const code = await codeOf(terr);
            if (!code) return none;
            const held = peekJobs(owner);
            if (peek && !held) return { subs: [], jobs: [], missing: true };
            const res = held || (await fetchJobs(owner));
            if (res.mock) return none;
            const out: { name: string; status: string }[] = [];
            // jobBatch, not the title's raw batch: a title with no number is Batch 1
            // (studio decision), and the raw "" matched no batch at all.
            const mine = res.jobs.filter((j: WrikeJob) => jobTerritory(j) === code && loose(jobBatch(j).replace(/_?POST$/i, "")) === loose(b.replace(/_?POST$/i, "")));
            mine.forEach((j) => (j.subtasks || []).forEach((st) => { if (st.name) out.push({ name: st.name, status: st.customStatusName || st.status || "" }); }));
            return { subs: out, jobs: mine };
        } catch {
            return none;
        }
    };

    const run = async (tp = territoryPath, b = batch, terr = territory) => {
        if (!tp || !b) return;
        const key = viewKey(tp, b);
        const force = forceNext.current;
        forceNext.current = false;
        // Scanned moments ago with the same Wrike statuses: show that, ask AE
        // nothing. (A different batch's recent scan is shown the same way.)
        if (!force && memo.scans[key] && Date.now() - (memo.scanAt[key] || 0) < SCAN_FRESH_MS) {
            const peek = await wrikeFor(terr, b, true);
            if (!peek.missing && subsSig(peek.subs) === memo.scanSig[key]) {
                const m = memo.scans[key];
                setScan(m.scan); setColors(m.colors); setComments(m.comments); setJobs(m.jobs);
                if (shownKey.current !== key) { setOpen({}); setShowExtra(false); shownKey.current = key; }
                memo.view = { territoryPath: tp, territory: terr, batches, batch: b };
                if (firstScan.current) firstScan.current.resolve();
                return;
            }
        }
        setBusy(true);
        setError("");
        try {
            // Draw from the feed already in memory; with none, draw from the
            // disk alone and merge Wrike in when it lands (a re-merge lists
            // nothing: AE keeps the listing).
            let w = await wrikeFor(terr, b, true);
            const scanOnce = async (subs: { name: string; status: string }[], forceDisk: boolean) =>
                (await evalTSSafe("trackerScan", JSON.stringify({ territoryPath: tp, batch: b, wrike: subs, force: forceDisk }))) as any;
            const t0 = performance.now();
            let r = await scanOnce(w.subs, force);
            const folders = performance.now() - t0;
            if (!r || !r.success) { setError((r && r.error) || "Couldn't read the batch."); return; }
            let wrikeMs: number | undefined;
            const show = (res: any, jobList: WrikeJob[]) => {
                setJobs(jobList);
                setScan({ territory: res.territory, batch: res.batch, folders: res.folders, rows: res.rows || [] });
            };
            show(r, w.jobs);
            if (w.missing) {
                const tw = performance.now();
                w = await wrikeFor(terr, b);
                wrikeMs = performance.now() - tw;
                const r2 = await scanOnce(w.subs, false);
                if (r2 && r2.success) { r = r2; show(r, w.jobs); }
            }
            setTiming((t) => ({ ...t, folders, engine: r.took ? r.took.disk : undefined, cached: r.took ? r.took.cached : undefined, wrike: wrikeMs }));
            if (firstScan.current) firstScan.current.resolve();
            // Rows fold when the BATCH changes, not every time Wrike refreshes
            // under a row somebody has open.
            if (shownKey.current !== key) { setOpen({}); setShowExtra(false); shownKey.current = key; }
            // The amends: only for jobs Wrike has as To amend, one read each.
            const fresh = freshComments.current;
            freshComments.current = false;
            const next: Record<string, CommentView> = {};
            // Every key a comment could name a row by: Wrike's, and the disk's.
            const onDisk = new Set<string>();
            (r.rows || []).forEach((x: Row) => {
                [x.key, x.claimed && amendKey(x.claimed.name), x.aep && amendKey(x.aep.name), x.render && amendKey(x.render.name)]
                    .forEach((k) => { if (k) onDisk.add(k as string); });
            });
            for (const j of w.jobs) {
                if (!AMEND_STATUSES.test(String(j.status || "").trim())) continue;
                const c = await fetchJobComment(j.id, fresh);
                const pool = c.recent && c.recent.length ? c.recent : c.comment ? [c.comment] : [];
                // "Antonio" is "Antonio Burgello": first name or the whole name.
                const me = ownerRef.current.trim().toLowerCase();
                const byMe = (cm: JobComment) => {
                    const a = cm.author.trim().toLowerCase();
                    return !!me && !!a && (a === me || a.indexOf(me + " ") === 0);
                };
                const theirs = pool.filter((cm) => !byMe(cm));
                const parsedPool = (theirs.length ? theirs : pool).map((cm) => ({ cm, p: parseAmends(cm.text) }));
                const pick =
                    parsedPool.find((x) => Object.keys(x.p.byKey).some((k) => onDisk.has(k))) ||
                    parsedPool.find((x) => Object.keys(x.p.byKey).length > 0) ||
                    parsedPool[0];
                next[j.id] = {
                    comment: pick ? pick.cm : null,
                    parsed: pick ? pick.p : parseAmends(""),
                    error: c.error,
                    newer: pick && pool[0] && pick.cm !== pool[0] ? pool[0] : undefined,
                };
            }
            setComments(next);
            // The page's own scan is fresher than the chip's: keep them agreeing.
            if (w.jobs.length) setSums((prev) => {
                const next = { ...prev };
                for (const j of w.jobs) {
                    const names = new Set(subsOf(j).map((x) => x.name));
                    next[j.id] = summarise((r.rows || []).filter((x: Row) => x.wrike && names.has(x.wrike.name)));
                }
                return next;
            });
            // Finder colours on the newest renders: green/orange good, red not.
            const paths = (r.rows || []).filter((x: Row) => x.render).map((x: Row) => x.render!.path);
            const cols = await readFinderColors(paths);
            setColors(cols);
            memo.view = { territoryPath: tp, territory: terr, batches, batch: b };
            memo.scans[key] = { scan: { territory: r.territory, batch: r.batch, folders: r.folders, rows: r.rows || [] }, colors: cols, comments: next, jobs: w.jobs };
            memo.scanAt[key] = Date.now();
            memo.scanSig[key] = subsSig(w.subs);
        } finally {
            setBusy(false);
            if (firstScan.current) firstScan.current.resolve();
        }
    };

    useEffect(() => { if (ready && territoryPath && batch) void run(); }, [ready, territoryPath, batch]);

    // YOUR JOBS: listed, located on disk, then summarised one at a time.
    const locateAndSummarise = async (list: WrikeJob[], force = false) => {
        if (!list.length) return;
        // The same jobs with the same statuses, summarised minutes ago: done.
        const sig = list.map((j) => j.id + ":" + subsSig(subsOf(j))).sort().join(";");
        if (!force && sig === memo.sumsSig && Date.now() - memo.sumsAt < CHIPS_FRESH_MS) return;
        // The batch on screen first: the chips never queue in front of it.
        if (firstScan.current) await Promise.race([firstScan.current.done, new Promise((r) => setTimeout(r, 15000))]);
        // Folders don't move: look for a job once a session (refresh: again).
        const toFind = list.filter((j) => force || !memo.lookedUp[j.id]);
        const map: Record<string, Located> = force ? {} : { ...memo.located };
        if (toFind.length) {
            const loc = (await evalTS("trackerLocate", JSON.stringify(toFind.map((j) => ({
                id: j.id, code: jobTerritory(j), batch: jobBatch(j), prefix: (subsOf(j)[0].name.split("_")[0] || "").toUpperCase(),
            }))))) as any;
            // An engine error here used to vanish, leaving every chip "not found".
            if (!loc || !loc.success) setMsg({ text: `Couldn't look for your jobs' folders: ${(loc && loc.error) || "no answer from AE"}`, bad: true });
            else toFind.forEach((j) => { memo.lookedUp[j.id] = true; });
            ((loc && loc.jobs) || []).forEach((x: Located) => { map[x.id] = x; });
        }
        setLocated(map);
        memo.located = map;
        // Every chip in ONE trip to AE, reusing the listings it keeps.
        const wanted = list.filter((j) => map[j.id]).map((j) => ({ id: j.id, territoryPath: map[j.id].territoryPath, batch: map[j.id].batch, wrike: subsOf(j), force }));
        if (!wanted.length) return;
        const t0 = performance.now();
        try {
            const many = (await evalTS("trackerScanMany", JSON.stringify(wanted))) as any;
            const got: Record<string, JobSummary> = {};
            if (many && many.success) Object.keys(many.results || {}).forEach((id) => {
                const r = many.results[id];
                if (r && r.success) got[id] = summarise(r.rows || []);
            });
            setSums((prev) => { const next = { ...prev, ...got }; memo.sums = next; return next; });
            if (many && many.success) { memo.sumsAt = Date.now(); memo.sumsSig = sig; }
        } catch { /* a folder unreadable: its chip just shows no bar */ }
        setTiming((t) => ({ ...t, chips: performance.now() - t0 }));
    };

    /** Bumped whenever a LIVE Wrike read lands (on open or from refresh): the
     *  batch on screen is re-read so its rows carry the new statuses. The rows
     *  used to keep whatever the snapshot said while the chips moved on --
     *  "Prep for delivery" beside a Wrike that said Delivered. */
    const [freshTick, setFreshTick] = useState(0);
    const loadJobs = async (live: boolean) => {
        setJobsBusy(true);
        try {
            const owner = await ownerOf();
            ownerRef.current = owner;
            if (!owner) { setMyJobs([]); memo.myJobs = []; return; }
            const pick = (res: Awaited<ReturnType<typeof fetchJobs>>) => {
                if (res.mock) return [] as WrikeJob[];
                const who = res.viewingAs || owner;
                return res.jobs.filter((j) => j.assignee === who && isLocaliseJob(j) && (j.subtaskCount ?? 0) > 0 && jobReadiness(j.status) !== "done" && subsOf(j).length > 0);
            };
            // Refresh: Wrike, live, now. Open: the snapshot at once and a live
            // read behind it (throttled panel-wide), which re-reads on landing.
            const res = live
                ? await fetchJobsLive(owner)
                : await fetchJobsFresh(owner, (r) => {
                    const fresh = pick(r);
                    setMyJobs(fresh);
                    memo.myJobs = fresh;
                    setFreshTick((t) => t + 1);
                    void locateAndSummarise(fresh);
                });
            const list = pick(res);
            setMyJobs(list);
            memo.myJobs = list;
            if (live) { freshComments.current = true; forceNext.current = true; setFreshTick((t) => t + 1); }
            await locateAndSummarise(list, live);
        } finally {
            setJobsBusy(false);
        }
    };
    useEffect(() => { if (ready) void loadJobs(false); }, [ready]);
    // Fresh Wrike statuses landed: re-read the batch on screen with them.
    useEffect(() => { if (freshTick && territoryPath && batch) void run(); }, [freshTick]);

    const openJob = (j: WrikeJob) => {
        const at = located[j.id];
        if (!at) { setMsg({ text: `Couldn't find ${jobLabel(j)} under any campaign's Markets folder.`, bad: true }); return; }
        setTerritoryPath(at.territoryPath);
        setTerritory(at.territory);
        setBatches(at.batches.some((b) => loose(b) === loose(at.batch)) ? at.batches : at.batches.concat([at.batch]));
        setBatch(at.batch);
        setMsg(null);
    };
    // A chip on the Localise page asked for this job: open it once it's located.
    useEffect(() => {
        if (!wantJob || wantJob.tick === wantTickDone.current) return;
        const j = myJobs.find((x) => x.id === wantJob.id);
        if (!j || !located[j.id]) {
            // Still reading your jobs: this runs again when they land.
            if (!jobsBusy && myJobs.length && j) { wantTickDone.current = wantJob.tick; openJob(j); }
            return;
        }
        wantTickDone.current = wantJob.tick;
        openJob(j);
    }, [wantJob && wantJob.tick, located, myJobs, jobsBusy]);

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
    // On arrival the open project is already known (the context read above):
    // only the comp check is left to ask.
    useEffect(() => {
        if (!ready) return;
        (async () => {
            try {
                const cc = (await evalTS("trackerCompCheck")) as any;
                setStaleComps((cc && cc.success && cc.comps) || []);
            } catch { /* preview */ }
        })();
    }, [ready]);

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
            // The disk just changed under this batch: a real read, not the
            // two-minute-old scan the freshness rule would otherwise show.
            forceNext.current = true;
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
    /** A row's notes from its job's amend comment -- matched on Wrike's name
     *  AND the disk's (a comment names the file, which may not be Wrike's). */
    const amendsFor = (r: Row): AmendNote[] => {
        const keys = [r.key, r.claimed && amendKey(r.claimed.name), r.aep && amendKey(r.aep.name), r.render && amendKey(r.render.name)].filter(Boolean) as string[];
        const out: AmendNote[] = [];
        const seen = new Set<string>();
        Object.keys(comments).forEach((id) => {
            const byKey = comments[id].parsed.byKey;
            for (const k of keys) for (const n of byKey[k] || []) {
                if (seen.has(n.text)) continue;
                seen.add(n.text);
                out.push(n);
            }
        });
        return out;
    };
    // A note on a version OLDER than the newest render has likely been done:
    // it still shows on the row, but doesn't make the row "to amend".
    const openAmends = (r: Row) => amendsFor(r).filter((n) => !(r.render && n.version && r.render.version > n.version));
    const isAmend = (r: Row) => toAmend(r) || openAmends(r).length > 0;
    const shownComments = Object.keys(comments).map((id) => ({ id, ...comments[id] })).filter((c) => c.comment || c.error);
    const toBuild = rows.filter((r) => r.wrike && !r.aep && !r.claimed && jobOf(r));
    const behindCount = count(wrikeBehind);
    const amendCount = count(isAmend);

    // What the hand-off message is written from (lib/wrikeMessage.ts TOKENS).
    // A count of zero is "", so its block is left out rather than reading "0 x".
    // REVISED = every deliverable that was sent back and has a render: Wrike
    // says To amend or Revised, or the amend comment names it. Its NEWEST
    // render is what the message lists. It used to count only a render newer
    // than the version the comment reviewed, which read 0 on the batch it was
    // written for: the message is sent by the person who just did the amend,
    // and a render re-made over the same version is still the amended one.
    // A render no newer than the one reviewed is SAID (messageWarnings), not
    // left out.
    const sentBack = (r: Row) => !!r.render && (isAmend(r) || amendsFor(r).length > 0 || !!(r.wrike && REVISED_STATUSES.test(r.wrike.status.trim())));
    const revised = rows.filter(sentBack);
    const sameVersion = revised.filter((r) => {
        const reviewed = Math.max(0, ...amendsFor(r).map((n) => n.version));
        return reviewed ? r.render!.version <= reviewed : false;
    });
    const messageWarnings: string[] = [];
    if (sameVersion.length) {
        const v = (r: Row) => "V" + String(r.render!.version).padStart(2, "0");
        messageWarnings.push(sameVersion.length === 1
            ? `The revised render is still ${v(sameVersion[0])}, the version the amends were written on. Fine if you rendered over it; otherwise render the new version first.`
            : `${sameVersion.length} of the revised renders are still the version the amends were written on. Fine if you rendered over them; otherwise render the new versions first.`);
    }
    const n = (k: number) => (k > 0 ? String(k) : "");
    const messageData: Record<string, string> = scan ? {
        territory: territory.replace(/_/g, " "),
        batch,
        "renders.count": n(count((r) => !!r.render)),
        "renders.folder": scan.folders.renders,
        "renders.list": rows.filter((r) => r.render).map((r) => r.render!.path).join("\n"),
        "revised.count": n(revised.length),
        "revised.paths": revised.map((r) => r.render!.path).join("\n"),
        "pdfs.folder": scan.folders.pdfs || "",
        "masters.renders": mastersRenders,
        "delivered.count": n(count((r) => !!r.delivered)),
        "delivered.folder": scan.folders.delivered[0] || "",
        "specs.folder": scan.folders.specs,
        "ae.folder": scan.folders.aep,
        "upload.name": uploadNameFor(territoryPath),
        "upload.folder": upload.folder,
    } : {};

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
                    {/* An amend with a project shows the Amend press instead of the
                        pill: both say To amend, and a docked panel can't spare it. */}
                    {r.wrike && !(isAmend(r) && r.aep) && (
                        <span className={"bt-wrike" + (wrikeBehind(r) ? " is-behind" : "")} style={{ color: statusTint(r.wrike.status).color, background: statusTint(r.wrike.status).background }}
                            title={wrikeBehind(r) ? `Rendered, but Wrike still says ${r.wrike.status}` : "Wrike"}>
                            {wrikeBehind(r) && <ArrowUpRight size={10} />}{r.wrike.status || "Wrike"}
                        </span>
                    )}
                </button>
                {isAmend(r) && r.aep && (isHere
                    ? <span className="bt-amend is-here" title="This project is open in AE">Open</span>
                    : (
                        <button type="button" className="bt-amend" disabled={!!acting} onClick={() => void openInAE(r)} title={`Open ${r.aep.name} to amend it`}>
                            {acting === "open:" + r.key ? <Loader2 size={11} className="spin" /> : <FolderOpen size={11} />} Amend
                        </button>
                    ))}
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
                        {(() => {
                            const notes = amendsFor(r);
                            if (!notes.length) return null;
                            const reviewed = Math.max(...notes.map((n) => n.version));
                            const newer = !!(r.render && reviewed && r.render.version > reviewed);
                            const c = shownComments.find((x) => x.comment)?.comment;
                            return (
                                <div className="bt-amends">
                                    <span className="bt-amends-head">
                                        <MessageSquare size={11} /> Amends{c && c.author ? ` · ${c.author}` : ""}{c && c.date ? ` · ${whenOf(c.date)}` : ""}{reviewed ? ` · on V${String(reviewed).padStart(2, "0")}` : ""}
                                    </span>
                                    {notes.map((n, i) => <p key={i} className="bt-amend-note">{n.text}</p>)}
                                    {newer && <span className="bt-amends-newer">V{String(r.render!.version).padStart(2, "0")} rendered since — may already be done.</span>}
                                </div>
                            );
                        })()}
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
                                <button key="op" type="button" className={"bt-act" + (isAmend(r) ? " is-primary" : "")} disabled={!!acting} onClick={() => void openInAE(r)}>
                                    {acting === "open:" + r.key ? <Loader2 size={12} className="spin" /> : <FolderOpen size={12} />} {isAmend(r) ? "Open to amend" : "Open in AE"}
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

    // A remembered view draws at once; only a first-ever open waits for AE.
    if (!ready && !scan) return <div className="bt"><p className="bt-note"><Loader2 size={13} className="spin" /> Reading where the open project is…</p></div>;

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
                <button type="button" className="bt-btn bt-icon" disabled={busy || jobsBusy} onClick={() => void loadJobs(true)} aria-label="Refresh" title={"Read Wrike live and the folders again" + (timing.folders !== undefined ? `\nLast read: folders ${(timing.folders / 1000).toFixed(1)}s` + (timing.engine !== undefined ? ` (AE ${(timing.engine / 1000).toFixed(1)}s${timing.cached ? ", kept listing" : ""})` : "") + (timing.wrike !== undefined ? ` · Wrike ${(timing.wrike / 1000).toFixed(1)}s` : "") + (timing.chips !== undefined ? ` · job chips ${(timing.chips / 1000).toFixed(1)}s` : "") : "")}>
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
                        {upload.open && <Link icon={<UploadCloud size={13} />} label="Uploads" path={upload.open} folder />}
                        <button type="button" className={"bt-link" + (showMessage ? " is-on" : "")} onClick={() => setShowMessage(!showMessage)} title="Write the hand-off comment for Wrike from this batch">
                            <MessageSquarePlus size={13} /><span>Message</span>
                        </button>
                        {jobs.map((j) => (
                            <button key={j.id} type="button" className="bt-link" onClick={() => setDetailsJob(j)} title={`${j.title}: every subtask, and Send to Localise`}>
                                <Info size={13} /><span>{jobs.length > 1 ? `${jobLabel(j)} details` : "Job details"}</span>
                            </button>
                        ))}
                    </div>
                    {showMessage && (
                        <TrackerMessage data={messageData} warnings={messageWarnings} uploadRoot={uploadRoot} onPickUploadRoot={() => void pickUploadRoot()} onClose={() => setShowMessage(false)} onCopied={(text, bad) => setMsg({ text, bad })} />
                    )}
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
                        {amendCount > 0 && <span className="bt-count is-amend" title="Subtasks Wrike has back as To amend">{amendCount} to amend</span>}
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

                    {shownComments.map((c) => (
                        <div key={c.id} className="bt-comment">
                            <span className="bt-comment-head">
                                <MessageSquare size={12} /> {c.newer ? "Amends in Wrike" : "Latest in Wrike"}{c.comment && c.comment.author ? ` · ${c.comment.author}` : ""}{c.comment && c.comment.date ? ` · ${whenOf(c.comment.date)}` : ""}
                                {c.comment && (
                                    <button type="button" className="bt-comment-toggle" onClick={() => setShowFullComment(!showFullComment)}>
                                        {showFullComment ? "Hide" : "Full comment"}
                                    </button>
                                )}
                            </span>
                            {c.error && !c.comment && <span className="bt-comment-err">{c.error}</span>}
                            {c.newer && <span className="bt-comment-sum">A newer comment follows it{c.newer.author ? ` (${c.newer.author}${c.newer.date ? `, ${whenOf(c.newer.date)}` : ""})` : ""}, with no amends in it.</span>}
                            {c.comment && Object.keys(c.parsed.byKey).length > 0 && (
                                <span className="bt-comment-sum">{Object.keys(c.parsed.byKey).length} deliverable{Object.keys(c.parsed.byKey).length === 1 ? "" : "s"} with amends, shown on their rows.</span>
                            )}
                            {c.parsed.general.map((g, i) => <p key={i} className="bt-comment-general">{g}</p>)}
                            {c.comment && !Object.keys(c.parsed.byKey).length && !c.parsed.general.length && <p className="bt-comment-general">{showShortcodes(c.comment.text)}</p>}
                            {showFullComment && c.comment && <p className="bt-comment-full">{showShortcodes(c.comment.text)}</p>}
                        </div>
                    ))}
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
            {detailsJob && (
                <ActiveJobModal
                    job={detailsJob}
                    onClose={() => setDetailsJob(null)}
                    onOpenLocaliser={() => {
                        setDetailsJob(null);
                        if (onSelectTool) onSelectTool("");
                        else setMsg({ text: "Staged for Build a Batch -- open Localise to see it." });
                    }}
                />
            )}
            {playing && <VideoOverlay path={playing.path} title={playing.title} onClose={() => setPlaying(null)} errorHint="The preview in _mp4 couldn't be played. It may still be rendering, or have moved." />}
            {busy && !scan && <p className="bt-note"><Loader2 size={13} className="spin" /> Reading the batch…</p>}
        </div>
    );
};

export default BatchTracker;
