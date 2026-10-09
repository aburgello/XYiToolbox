// =============================================================================
// src/js/main/tools/EocResearch.tsx
// -----------------------------------------------------------------------------
// EOC RESEARCH -- the end-of-campaign archive, and the way to look through it.
//
// The studio keeps a small mp4 and a still of everything a campaign shipped in
// Project_Research/<Film>/<Section>/, so a past campaign can be looked up long
// after its renders are purged. Two halves, one tool:
//
//   BROWSE   reads the archive from the panel's own Node and lays it out like
//            Size Finder: a film, its sections, a search, a size. A card
//            SCRUBS under the mouse; picking one plays it beside its stills.
//   ADD      renders a campaign's Renders down into that folder. It ADDS TO
//            THE RESEARCH FOLDER and does nothing to the campaign: no file
//            there is moved, changed or retired, and it is not the panel's
//            "retire a campaign". Run it whenever there is more to add.
//             It began as
//            a saved script that did the whole run in one call; here the
//            panel scans, AE renders ONE PASS at a time (research.ts), and
//            what is done is read off the destination folder after each.
//
// WHY ONE PASS AT A TIME. A run is a thousand renders and an hour or more; a
// call that long comes back to a page that is gone. A pass is minutes, Stop
// works between passes, and a crash costs one pass: open the tool again and
// the run is offered from where it stopped.
//
// DONE MEANS THE FILE IS THERE. Never the manifest's word for it, and never
// the render queue's alone. The manifest is a record (it is what tells Browse
// which market a clip came from), not the state.
//
// Mouse events throughout, never pointer events (CLAUDE.md).
// =============================================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Film, FolderOpen, Maximize2, Play, RefreshCw, Search, Square, Wrench } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { child_process, fs, path as nodePath } from "../../lib/cep/node";
import { toFileUrl } from "../lib/fileUrl";
import { usePosterFrame } from "../lib/renderPreview";
import { byCloseness, closeness, Closeness, parseWanted, ratioLabel } from "../lib/sizeMatch";
import {
    archived, FilmScan, Job, Kid, listFilms, MANIFEST_NAME, manifestText, ManifestRow, newestOnly, parseManifest,
    ResearchItem, safeName, scanFilm, scanSource, Still, tidyPlan,
} from "../lib/research";
import { alertDialog, confirmDialog, promptDialog } from "../Dialog";
import CheckboxToggle from "../CheckboxToggle";
import Dropdown from "../Dropdown";
import SegmentedToggle from "../SegmentedToggle";
import VideoOverlay from "../VideoOverlay";
import "../shared.scss";
import "./EocResearch.scss";

const hasNode = typeof window !== "undefined" && typeof (window as any).cep !== "undefined";

// --- Node, asynchronously ----------------------------------------------------

/** One folder's children, or NULL when it can't be listed (never [] for a failure). */
const listStrict = (dir: string): Promise<Kid[] | null> =>
    new Promise((resolve) => {
        try {
            (fs as any).readdir(dir, { withFileTypes: true }, (err: any, list: any[]) => {
                if (err || !list) { resolve(null); return; }
                resolve(list.map((d) => ({ name: d.name, path: nodePath.join(dir, d.name), dir: d.isDirectory() })));
            });
        } catch { resolve(null); }
    });
const listDir = async (dir: string): Promise<Kid[]> => (await listStrict(dir)) || [];
const readText = (p: string): Promise<string> =>
    new Promise((resolve) => { try { (fs as any).readFile(p, "utf8", (e: any, t: string) => resolve(e ? "" : t || "")); } catch { resolve(""); } });
const renameFile = (from: string, to: string): Promise<boolean> =>
    new Promise((resolve) => { try { (fs as any).rename(from, to, (e: any) => resolve(!e)); } catch { resolve(false); } });
const makeDir = (p: string): Promise<void> =>
    new Promise((resolve) => { try { (fs as any).mkdir(p, () => resolve()); } catch { resolve(); } });
/** Each level under `base` in turn. One that is already there is not an error; the listing afterwards is the test. */
const makeDirs = async (base: string, levels: string[]): Promise<void> => {
    let at = base;
    for (const l of levels) { at = nodePath.join(at, l); await makeDir(at); }
};
/** Written beside itself and renamed in, so a reader never meets half a file. */
const writeText = (p: string, text: string): Promise<boolean> =>
    new Promise((resolve) => {
        try {
            const tmp = p + ".tmp";
            (fs as any).writeFile(tmp, text, "utf8", (e: any) => {
                if (e) { resolve(false); return; }
                (fs as any).rename(tmp, p, (e2: any) => resolve(!e2));
            });
        } catch { resolve(false); }
    });

const openPath = (p: string, reveal = false) => {
    if (!p) return;
    try { child_process.spawn("open", reveal ? ["-R", p] : [p], { detached: true }); } catch { /* nothing to do */ }
};

const stored = (key: string) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const store = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* a convenience only */ } };

const fitBox = (w: number, h: number, maxW: number, maxH: number) => {
    const s = Math.min(maxW / w, maxH / h);
    return { width: Math.max(10, Math.round(w * s)), height: Math.max(10, Math.round(h * s)) };
};
const pretty = (s: string) => String(s || "").replace(/_/g, " ");
const count = (n: number, one: string, many?: string) => n.toLocaleString() + " " + (n === 1 ? one : many || one + "s");
const squash = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const span = (secs: number) => {
    if (!(secs > 0)) return "";
    const m = Math.round(secs / 60);
    return m < 1 ? "under a minute" : m < 60 ? m + " min" : Math.floor(m / 60) + "h " + (m % 60) + "m";
};

// What this session has read, so a tab switch or a second visit draws at once.
const kept: Record<string, FilmScan> = {};
const ALL = "__all__";

// =============================================================================
// BROWSE
// =============================================================================

interface Hit { item: ResearchItem; near: Closeness | null }

/**
 * A card. With a still it shows the still and loads no video until the mouse
 * is over it; then moving across the picture SCRUBS the clip, left edge the
 * first frame, right edge the last. A seek is only asked for once the last
 * one has landed, or a clip on the share falls behind the mouse.
 */
const Card: React.FC<{ hit: Hit; active: boolean; showFilm: boolean; onPick: () => void }> = ({ hit, active, showFilm, onPick }) => {
    const { item, near } = hit;
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const want = useRef<number | null>(null);
    const [over, setOver] = useState(false);
    const [ready, setReady] = useState(false);
    const [frac, setFrac] = useState(0);
    const [brokenStill, setBrokenStill] = useState(false);
    const poster = usePosterFrame(videoRef, () => setReady(true));
    const still: Still | null = item.stills.length && !brokenStill ? item.stills[item.stills.length - 1] : null;
    const box = fitBox(item.w || 16, item.h || 9, 150, 92);
    const withVideo = !!item.clip && (over || !still);

    const seek = () => {
        const v = videoRef.current;
        if (!v || want.current === null || v.seeking || !isFinite(v.duration) || v.duration <= 0) return;
        const t = want.current * v.duration;
        want.current = null;
        try { v.currentTime = Math.min(v.duration - 0.04, Math.max(0, t)); } catch { /* not seekable yet */ }
    };
    const onMove = (e: React.MouseEvent<HTMLSpanElement>) => {
        if (!item.clip) return;
        const r = e.currentTarget.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
        want.current = f;
        setFrac(f);
        seek();
    };

    const where = [showFilm ? pretty(item.film) : "", item.territory ? pretty(item.territory) : item.market, item.section && !showFilm ? pretty(item.section) : ""].filter(Boolean).join(" · ");
    return (
        <button type="button" className={"eoc-card" + (active ? " is-active" : "")} onClick={onPick} title={item.name}>
            <span className="eoc-thumb">
                <span
                    className="eoc-thumb-shape"
                    style={box}
                    onMouseEnter={() => setOver(true)}
                    onMouseMove={onMove}
                    onMouseLeave={() => { setOver(false); setFrac(0); want.current = null; if (!still) poster.restToPoster(); }}
                >
                    {still && <img src={toFileUrl(still.path)} alt="" draggable={false} onError={() => setBrokenStill(true)} />}
                    {withVideo && (
                        <video
                            ref={videoRef}
                            className={ready && (over || !still) ? "is-ready" : ""}
                            src={toFileUrl(item.clip)}
                            muted
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={() => { if (still) seek(); else poster.onLoadedMetadata(); }}
                            onLoadedData={() => { if (still) setReady(true); else poster.onLoadedData(); }}
                            onSeeked={() => { setReady(true); if (!still) poster.onSeeked(); seek(); }}
                        />
                    )}
                    {over && item.clip && <i className="eoc-scrub" style={{ width: Math.round(frac * 100) + "%" }} />}
                    {!item.clip && <em className="eoc-flag">stills</em>}
                </span>
            </span>
            <span className="eoc-card-size">
                {item.w ? `${item.w}×${item.h}` : "No size in the name"}
                {item.seconds ? <em> · {item.seconds}s</em> : null}
            </span>
            {near && <span className="eoc-card-near">{near.label}</span>}
            <span className="eoc-card-where">{where || " "}</span>
        </button>
    );
};

const Detail: React.FC<{ item: ResearchItem; near: Closeness | null; onPlay: () => void }> = ({ item, near, onPlay }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [at, setAt] = useState(0);
    useEffect(() => { setAt(0); }, [item.id]);
    const stills = item.stills;
    const cur = stills[Math.min(at, stills.length - 1)] || null;
    const show = (i: number) => {
        const n = (i + stills.length) % stills.length;
        setAt(n);
        // A timecoded still is a place in the clip: go there.
        const v = videoRef.current;
        const s = stills[n];
        if (v && s && s.at >= 0 && isFinite(v.duration)) {
            try { v.pause(); v.currentTime = Math.min(Math.max(0, v.duration - 0.04), s.at); } catch { /* not seekable */ }
        }
    };
    const facts = [
        pretty(item.film),
        item.section ? pretty(item.section) : "",
        item.territory ? pretty(item.territory) : item.market,
        item.batch ? pretty(item.batch) : "",
        item.w ? `${item.w}×${item.h} (${ratioLabel(item.w, item.h)})` : "",
        item.seconds ? item.seconds + "s" : "",
        near ? near.label : "",
    ].filter(Boolean).join(" · ");
    return (
        <div className="eoc-detail">
            <div className="eoc-detail-head">
                <strong title={item.name}>{item.name}</strong>
                <span>{facts}</span>
            </div>
            <div className={"eoc-pair" + (item.clip && stills.length ? "" : " is-single")}>
                {item.clip && (
                    <div className="eoc-pane">
                        <video ref={videoRef} key={item.clip} src={toFileUrl(item.clip)} controls muted loop autoPlay playsInline />
                        <div className="eoc-pane-actions">
                            <button type="button" className="eoc-btn" onClick={onPlay}><Maximize2 size={12} /> Play large</button>
                            <button type="button" className="eoc-btn" onClick={() => openPath(item.clip, true)}><FolderOpen size={12} /> Show in Finder</button>
                        </div>
                    </div>
                )}
                {cur && (
                    <div className="eoc-pane">
                        <img className="eoc-still" src={toFileUrl(cur.path)} alt="" draggable={false} onClick={() => stills.length > 1 && show(at + 1)} />
                        <div className="eoc-pager">
                            {stills.length > 1 && <button type="button" onClick={() => show(at - 1)} title="Previous still"><ChevronLeft size={13} /></button>}
                            <span className="eoc-stills">
                                {stills.map((s, i) => (
                                    <button type="button" key={s.path} className={i === at ? "is-on" : ""} onClick={() => show(i)}>
                                        {s.label || "still " + (i + 1)}
                                    </button>
                                ))}
                            </span>
                            {stills.length > 1 && <button type="button" onClick={() => show(at + 1)} title="Next still"><ChevronRight size={13} /></button>}
                        </div>
                        {!item.clip && (
                            <div className="eoc-pane-actions">
                                <button type="button" className="eoc-btn" onClick={() => openPath(cur.path, true)}><FolderOpen size={12} /> Show in Finder</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const PAGE = 48;

const Browse: React.FC<{ root: string; films: Kid[] | null; rev: number; onResume: (r: Resume) => void }> = ({ root, films, rev, onResume }) => {
    const [film, setFilm] = useState<string>(() => stored("xyi.eoc.film"));
    const [scans, setScans] = useState<FilmScan[] | null>(null);
    const [busy, setBusy] = useState("");
    const [text, setText] = useState("");
    const [size, setSize] = useState("");
    const [section, setSection] = useState("");
    const [where, setWhere] = useState("");
    const [clipsOnly, setClipsOnly] = useState(false);
    const [picked, setPicked] = useState("");
    const [limit, setLimit] = useState(PAGE);
    const [playing, setPlaying] = useState<ResearchItem | null>(null);
    const [fixing, setFixing] = useState(false);

    // The film on show: the stored one while it still exists, else the first.
    useEffect(() => {
        if (!films || !films.length) return;
        if (film === ALL || films.some((f) => f.name === film)) return;
        setFilm(films[0].name);
    }, [films, film]);

    const load = useCallback(async (force: boolean) => {
        if (!films || !film) return;
        const wanted = film === ALL ? films : films.filter((f) => f.name === film);
        const out: FilmScan[] = [];
        for (let i = 0; i < wanted.length; i++) {
            const f = wanted[i];
            if (force || !kept[f.path]) {
                setBusy(`Reading ${pretty(f.name)}…` + (wanted.length > 1 ? ` (${i + 1} of ${wanted.length})` : ""));
                kept[f.path] = await scanFilm(f, listDir, readText);
            }
            out.push(kept[f.path]);
        }
        setBusy("");
        setScans(out);
    }, [films, film]);

    // Another film: its own filters, and nothing of the last one on screen.
    useEffect(() => {
        setScans(null);
        setSection("");
        setWhere("");
        setPicked("");
        setLimit(PAGE);
        if (film) store("xyi.eoc.film", film);
    }, [film]);
    // `rev` moves when a run has added to a film, or Re-read was pressed: what
    // was kept is gone by then, so this reads the folders again and leaves
    // the filters and the picked card where they are.
    useEffect(() => { load(false); }, [film, load, rev]);

    const items = useMemo(() => (scans ? ([] as ResearchItem[]).concat(...scans.map((s) => s.items)) : []), [scans]);
    const sections = useMemo(() => {
        const n: Record<string, number> = {};
        items.forEach((it) => { const top = it.section.split("/")[0] || "(loose)"; n[top] = (n[top] || 0) + 1; });
        return Object.keys(n).sort().map((name) => ({ name, n: n[name] }));
    }, [items]);
    const places = useMemo(() => {
        const n: Record<string, true> = {};
        items.forEach((it) => { const p = it.territory || it.market; if (p) n[p] = true; });
        return Object.keys(n).sort((a, b) => a.localeCompare(b));
    }, [items]);

    const wanted = parseWanted(size);
    const hits: Hit[] = useMemo(() => {
        const words = text.toLowerCase().split(/\s+/).filter(Boolean);
        const rows = items.filter((it) => {
            if (clipsOnly && !it.clip) return false;
            if (section && (it.section.split("/")[0] || "(loose)") !== section) return false;
            if (where && (it.territory || it.market) !== where) return false;
            if (wanted && !it.w) return false;
            if (words.length) {
                const hay = (it.name + " " + it.section + " " + it.territory + " " + it.batch + " " + it.film).toLowerCase().replace(/_/g, " ");
                for (const w of words) if (hay.indexOf(w.replace(/_/g, " ")) === -1) return false;
            }
            return true;
        });
        const out = rows.map((item) => ({ item, near: wanted ? closeness(wanted, { w: item.w, h: item.h }) : null }));
        if (wanted) out.sort((a, b) => byCloseness(a.near as Closeness, b.near as Closeness) || a.item.name.localeCompare(b.item.name));
        return out;
    }, [items, text, size, section, where, clipsOnly]);

    useEffect(() => { setLimit(PAGE); }, [text, size, section, where, clipsOnly]);

    const selected = hits.find((h) => h.item.id === picked) || null;
    const misnamed = scans ? ([] as { from: string; to: string }[]).concat(...scans.map((s) => s.misnamed)) : [];
    const runs = scans ? scans.map((s) => s.runs.filter((r) => r.todo > 0).map((r) => ({ ...r, film: s.film }))).reduce((a, b) => a.concat(b), []) : [];
    const clips = items.filter((it) => it.clip).length;

    const fixNames = async () => {
        const ok = await confirmDialog({
            title: `Fix ${count(misnamed.length, "still")}?`,
            body: "After Effects left its frame number on them (…_LASTFRAME.jpg00359), so Finder does not open them as pictures. They are renamed to …_LASTFRAME.jpg. Nothing else is touched.",
            confirm: "Fix names",
        });
        if (!ok) return;
        setFixing(true);
        let failed = 0;
        for (const p of misnamed) if (!(await renameFile(p.from, p.to))) failed++;
        setFixing(false);
        if (failed) await alertDialog({ title: `${count(failed, "still")} could not be renamed`, body: "The rest were. Somebody may have one open, or the share dropped." });
        await load(true);
    };

    if (!films) return <div className="eoc-none">Reading {root}…</div>;
    if (!films.length) return <div className="eoc-none">Nothing in {root}. Is the share mounted?</div>;

    return (
        <>
            <div className="eoc-films">
                {films.map((f) => (
                    <button type="button" key={f.path} className={"eoc-chip" + (film === f.name ? " is-on" : "")} onClick={() => setFilm(f.name)}>{pretty(f.name)}</button>
                ))}
                <button type="button" className={"eoc-chip eoc-chip--all" + (film === ALL ? " is-on" : "")} onClick={() => setFilm(ALL)}>Every film</button>
            </div>

            <div className="eoc-bar">
                <label className="eoc-field eoc-field--wide">
                    <Search size={13} />
                    <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search names: glass 15sec, arch, gutter…" spellCheck={false} />
                </label>
                <label className="eoc-field eoc-field--size" title="A size ranks everything by how close its shape is, like Size Finder">
                    <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="1080x1920" spellCheck={false} />
                    {wanted && <em>{ratioLabel(wanted.w, wanted.h)}</em>}
                </label>
                {places.length > 1 && (
                    <Dropdown
                        className="eoc-drop"
                        value={where}
                        onChange={setWhere}
                        options={[{ value: "", label: "Every market" }].concat(places.map((p) => ({ value: p, label: pretty(p) })))}
                    />
                )}
                <CheckboxToggle checked={clipsOnly} onChange={setClipsOnly} label="Clips only" title="Leave out what was archived as stills alone" />
            </div>

            {sections.length > 1 && (
                <div className="eoc-sections">
                    <button type="button" className={"eoc-chip" + (!section ? " is-on" : "")} onClick={() => setSection("")}>Everything<em>{items.length.toLocaleString()}</em></button>
                    {sections.map((s) => (
                        <button type="button" key={s.name} className={"eoc-chip" + (section === s.name ? " is-on" : "")} onClick={() => setSection(section === s.name ? "" : s.name)}>
                            {pretty(s.name)}<em>{s.n.toLocaleString()}</em>
                        </button>
                    ))}
                </div>
            )}

            {busy && <div className="eoc-status">{busy}</div>}

            {!busy && scans && (
                <div className="eoc-status">
                    {count(hits.length, "result")} of {items.length.toLocaleString()} · {count(clips, "clip")}, {count(items.length - clips, "set", "sets")} of stills only
                </div>
            )}

            {!busy && misnamed.length > 0 && (
                <div className="eoc-notice">
                    <span>{count(misnamed.length, "still")} kept After Effects' frame number after .jpg, so Finder won't open them as pictures. They show here regardless.</span>
                    <button type="button" className="eoc-btn" disabled={fixing} onClick={fixNames}><Wrench size={12} /> {fixing ? "Renaming…" : "Fix names"}</button>
                </div>
            )}
            {!busy && runs.map((r) => (
                <div className="eoc-notice" key={r.folder}>
                    <span>{pretty(r.film)}: a run stopped with {r.todo.toLocaleString()} of {r.total.toLocaleString()} renders still to add.</span>
                    <button type="button" className="eoc-btn" onClick={() => onResume({ source: r.sourceRoot, film: r.film, section: r.section })}><Play size={12} /> Pick it up</button>
                </div>
            ))}

            {selected && <Detail item={selected.item} near={selected.near} onPlay={() => setPlaying(selected.item)} />}

            {!busy && scans && hits.length === 0 && <div className="eoc-none">Nothing matches. Clear a filter, or look in Every film.</div>}

            {hits.length > 0 && (
                <>
                    <div className="eoc-grid">
                        {hits.slice(0, limit).map((h) => (
                            <Card key={h.item.id} hit={h} active={picked === h.item.id} showFilm={film === ALL} onPick={() => setPicked(picked === h.item.id ? "" : h.item.id)} />
                        ))}
                    </div>
                    {hits.length > limit && (
                        <button type="button" className="eoc-btn eoc-more" onClick={() => setLimit(limit + PAGE)}>
                            Show {Math.min(PAGE, hits.length - limit)} more ({(hits.length - limit).toLocaleString()} left)
                        </button>
                    )}
                </>
            )}

            {playing && playing.clip && <VideoOverlay path={playing.clip} title={playing.name} onClose={() => setPlaying(null)} />}
        </>
    );
};

// =============================================================================
// ARCHIVE
// =============================================================================

interface Resume { source: string; film: string; section: string }
interface Campaign { name: string; marketsRoot: string }
interface Progress { pass: number; passes: number; done: number; failed: number; total: number; secs: number; rendered: number; stopping: boolean }
interface Failure { prefix: string; note: string }

const SECTIONS = ["LOCALISED", "MASTER_OV", "BESPOKES"];
// Each needs its own H264_<n>MBPS_MOS output module template, as Delivery's do.
const MBPS = ["0.6", "1", "2"];
const LAST = "xyi.eoc.lastRun";
const NEW = "__new__";
const PICK = "__pick__";

const Archiver: React.FC<{ root: string; films: Kid[] | null; resume: Resume | null; onArchived: (film: string) => void; onFilmsChanged: () => void }> = ({ root, films, resume, onArchived, onFilmsChanged }) => {
    const last = useMemo(() => { try { return JSON.parse(stored(LAST) || "{}"); } catch { return {}; } }, []);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [source, setSource] = useState<string>(String(last.source || ""));
    const [film, setFilm] = useState<string>(String(last.film || ""));
    const [section, setSection] = useState<string>(String(last.section || "LOCALISED"));
    const [newest, setNewest] = useState<boolean>(last.newest !== false);
    const [still, setStill] = useState<boolean>(last.still !== false);
    const [mbps, setMbps] = useState<string>(MBPS.indexOf(String(last.mbps)) !== -1 ? String(last.mbps) : "1");
    const [chunk, setChunk] = useState<string>(String(last.chunk || "10"));
    const [jobs, setJobs] = useState<Job[] | null>(null);
    const [reading, setReading] = useState(false);
    const [off, setOff] = useState<Record<string, true>>({});
    const [open, setOpen] = useState<Record<string, true>>({});
    const [have, setHave] = useState<string[] | null>(null);
    const [filmSections, setFilmSections] = useState<string[]>([]);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [failures, setFailures] = useState<Failure[]>([]);
    const [summary, setSummary] = useState("");
    const stop = useRef(false);
    const running = !!progress;

    useEffect(() => {
        (async () => {
            try { setCampaigns((((await evalTS("loadLocLibCampaigns")) as unknown as Campaign[]) || []).filter((c) => c && c.marketsRoot)); } catch { /* no list, the folder picker still works */ }
        })();
    }, []);

    // A run handed over from Browse replaces whatever was here.
    useEffect(() => {
        if (!resume) return;
        setSource(resume.source);
        setFilm(resume.film);
        setSection(resume.section || "LOCALISED");
        setOff({});
    }, [resume]);

    const dest = film && section ? nodePath.join(root, film, ...section.split("/")) : "";

    // The source's renders.
    useEffect(() => {
        let alive = true;
        setJobs(null);
        setSummary("");
        setFailures([]);
        if (!source) return;
        setReading(true);
        (async () => {
            const found = await scanSource(source, listDir);
            if (!alive) return;
            setJobs(found);
            setReading(false);
        })();
        return () => { alive = false; };
    }, [source]);

    // What the film folder holds, and what the destination already has.
    const refreshDest = useCallback(async () => {
        if (!film) { setFilmSections([]); setHave(null); return; }
        const kids = await listDir(nodePath.join(root, film));
        setFilmSections(kids.filter((k) => k.dir && k.name.charAt(0) !== "_" && k.name.charAt(0) !== ".").map((k) => k.name));
        const names = dest ? await listStrict(dest) : null;
        setHave(names ? names.filter((k) => !k.dir).map((k) => k.name) : []);
    }, [root, film, dest]);
    useEffect(() => { refreshDest(); }, [refreshDest]);

    // A campaign picked with no film chosen: the film whose name it shares.
    const guessFilm = (name: string) => {
        const want = squash(name);
        if (!want || !films) return "";
        const hit = films.find((f) => { const s = squash(f.name); return s === want || s.indexOf(want) !== -1 || want.indexOf(s) !== -1; });
        return hit ? hit.name : "";
    };

    const pickSource = async (v: string) => {
        if (v === PICK) {
            const p = String((await evalTS("researchSelectFolder" as any, source || "", "Pick the Markets folder, one market, or any folder of renders")) || "");
            if (p) { setSource(p); setOff({}); }
            return;
        }
        const c = campaigns.find((x) => x.marketsRoot === v);
        setSource(v);
        setOff({});
        if (c) setFilm(guessFilm(c.name) || film);
    };

    const pickFilm = async (v: string) => {
        if (v !== NEW) { setFilm(v); return; }
        const typed = await promptDialog({ title: "Name the film's folder", body: "It is made inside " + root + " when the run starts.", confirm: "Use it" }, "");
        const name = safeName(String(typed || ""));
        if (name) { setFilm(name); onFilmsChanged(); }
    };
    const pickSection = async (v: string) => {
        if (v !== NEW) { setSection(v); return; }
        const typed = await promptDialog({ title: "Name the folder inside the film", body: "LOCALISED, MASTER_OV and BESPOKES are what the other films use.", confirm: "Use it" }, section);
        const name = String(typed || "").split("/").map(safeName).filter(Boolean).join("/");
        if (name) setSection(name);
    };

    // Markets and their batches, as the tick list.
    const groups = useMemo(() => {
        const g: { market: string; batches: { batch: string; n: number }[]; n: number }[] = [];
        const at: Record<string, number> = {};
        (jobs || []).forEach((j) => {
            if (at[j.market] === undefined) { at[j.market] = g.length; g.push({ market: j.market, batches: [], n: 0 }); }
            const m = g[at[j.market]];
            m.n++;
            const b = m.batches.find((x) => x.batch === j.batch);
            if (b) b.n++; else m.batches.push({ batch: j.batch, n: 1 });
        });
        return g;
    }, [jobs]);
    const keyOf = (market: string, batch: string) => market + "\n" + batch;
    const marketOn = (m: { market: string; batches: { batch: string }[] }) => m.batches.some((b) => !off[keyOf(m.market, b.batch)]);
    const toggleMarket = (m: { market: string; batches: { batch: string }[] }) => {
        const next = { ...off };
        const on = marketOn(m);
        m.batches.forEach((b) => { if (on) next[keyOf(m.market, b.batch)] = true; else delete next[keyOf(m.market, b.batch)]; });
        setOff(next);
    };
    const toggleBatch = (market: string, batch: string) => {
        const next = { ...off };
        const k = keyOf(market, batch);
        if (next[k]) delete next[k]; else next[k] = true;
        setOff(next);
    };
    const setAll = (on: boolean) => {
        const next: Record<string, true> = {};
        if (!on) groups.forEach((m) => m.batches.forEach((b) => { next[keyOf(m.market, b.batch)] = true; }));
        setOff(next);
    };

    const chosen = useMemo(() => {
        const picked = (jobs || []).filter((j) => !off[keyOf(j.market, j.batch)]);
        return newest ? newestOnly(picked) : picked;
    }, [jobs, off, newest]);
    const done = useMemo(() => archived(have || []), [have]);
    const todo = chosen.filter((j) => !done.clip[j.prefix]);
    const older = (jobs || []).filter((j) => !off[keyOf(j.market, j.batch)]).length - chosen.length;

    const run = async (only?: Job[]) => {
        if (running || !dest) return;
        const work = (only || todo).slice();
        if (!work.length) return;

        // An empty project, or nothing starts: a pass renders the whole queue
        // and clears it.
        let state: any = null;
        try { state = await evalTS("researchProjectState" as any); } catch { state = null; }
        if (!state || !state.success) { await alertDialog({ title: "After Effects did not answer", body: "Open the panel inside After Effects and try again." }); return; }
        if (state.items > 0 || state.queued > 0) {
            if (state.dirty) {
                await alertDialog({ title: "Save or close the open project first", body: "EOC Research runs in an empty project: each pass renders the whole render queue and clears it afterwards." });
                return;
            }
            const ok = await confirmDialog({
                title: `Close ${state.name || "the open project"} and start?`,
                body: "EOC Research runs in an empty project. Nothing in the open one is unsaved.",
                confirm: "Close and start",
            });
            if (!ok) return;
            const made: any = await evalTS("researchNewProject" as any);
            if (!made || !made.success) { await alertDialog({ title: "Could not start a new project", body: (made && made.error) || "" }); return; }
        }

        await makeDirs(root, [film].concat(section.split("/")));
        if (!(await listStrict(dest))) { await alertDialog({ title: "The research folder can't be reached", body: dest }); return; }
        store(LAST, JSON.stringify({ source, film, section, newest, still, mbps, chunk }));
        onFilmsChanged();

        const per = Math.max(1, parseInt(chunk, 10) || 10);
        const passes = Math.ceil(work.length / per);
        const failed: Failure[] = [];
        let rendered = 0;
        let secs = 0;
        let fatal = "";
        stop.current = false;
        setFailures([]);
        setSummary("");
        setProgress({ pass: 0, passes, done: 0, failed: 0, total: work.length, secs: 0, rendered: 0, stopping: false });

        // The record: what an older run wrote about other renders is kept.
        const manifestPath = nodePath.join(dest, MANIFEST_NAME);
        const earlier = parseManifest(await readText(manifestPath));
        const mine: Record<string, true> = {};
        chosen.forEach((j) => { mine[j.prefix] = true; });
        const writeManifest = async (names: Record<string, true>) => {
            const notes: Record<string, string> = {};
            failed.forEach((f) => { notes[f.prefix] = f.note; });
            const rows: ManifestRow[] = earlier.filter((r) => !mine[r.prefix]).concat(
                chosen.map((j) => ({ status: names[j.prefix] ? "DONE" : notes[j.prefix] ? "FAILED" : "TODO", prefix: j.prefix, path: j.src, note: names[j.prefix] ? "" : notes[j.prefix] || "" }))
            );
            await writeText(manifestPath, manifestText(rows, new Date().toString()));
        };

        for (let p = 0; p < passes && !fatal; p++) {
            if (stop.current) break;
            const batch = work.slice(p * per, (p + 1) * per);
            setProgress((cur) => cur && { ...cur, pass: p + 1 });
            let res: any = null;
            try {
                // No timeout: a pass legitimately holds AE for minutes.
                res = await evalTS("researchRenderChunk" as any, JSON.stringify({
                    dest, still, mp4Template: `H264_${mbps}MBPS_MOS`, jpgTemplate: "JPEG_1FRAME",
                    rows: batch.map((j) => ({ prefix: j.prefix, src: j.src })),
                }));
            } catch (e) {
                res = { success: false, error: String(e), rows: [] };
            }
            if (res && res.fatal) fatal = String(res.fatal);

            // What is there now is the answer. AE's frame number comes off the
            // stills first, so they are counted under their real names.
            let kids = await listStrict(dest);
            if (!kids) { fatal = "The research folder stopped answering part-way. Is the share still mounted?"; break; }
            const plan = tidyPlan(kids.filter((k) => !k.dir).map((k) => k.name));
            if (plan.length) {
                for (const t of plan) await renameFile(nodePath.join(dest, t.from), nodePath.join(dest, t.to));
                kids = (await listStrict(dest)) || kids;
            }
            const names = archived(kids.filter((k) => !k.dir).map((k) => k.name));
            const said: Record<string, string> = {};
            ((res && res.rows) || []).forEach((r: any) => { said[r.prefix] = String(r.note || ""); });
            batch.forEach((j) => {
                if (names.clip[j.prefix]) rendered++;
                else failed.push({ prefix: j.prefix, note: said[j.prefix] || (res && res.error) || fatal || "No clip was written." });
            });
            secs += (res && res.seconds) || 0;
            await writeManifest(names.clip);
            setHave(kids.filter((k) => !k.dir).map((k) => k.name));
            setFailures(failed.slice());
            setProgress((cur) => cur && { ...cur, done: rendered, failed: failed.length, secs, rendered, stopping: stop.current });
        }

        setProgress(null);
        await refreshDest();
        onArchived(film);
        const left = work.length - rendered - failed.length;
        setSummary(
            `${count(rendered, "clip")} added` +
            (failed.length ? `, ${failed.length.toLocaleString()} failed` : "") +
            (left > 0 ? `, ${left.toLocaleString()} not reached` : "") +
            (secs ? ` · ${span(secs)}` : "") + "."
        );
        if (fatal) await alertDialog({ title: "The run stopped", body: fatal });
    };

    const sourceOptions = campaigns.map((c) => ({ value: c.marketsRoot, label: c.name }))
        .concat(source && !campaigns.some((c) => c.marketsRoot === source) ? [{ value: source, label: nodePath.basename(source) }] : [])
        .concat([{ value: PICK, label: "Pick a folder…" }]);
    const filmOptions = (films || []).map((f) => ({ value: f.name, label: pretty(f.name) }))
        .concat(film && !(films || []).some((f) => f.name === film) ? [{ value: film, label: pretty(film) + " (new)" }] : [])
        .concat([{ value: NEW, label: "New film folder…" }]);
    const sectionNames = filmSections.concat(SECTIONS.filter((s) => filmSections.indexOf(s) === -1));
    const sectionOptions = sectionNames.concat(section && sectionNames.indexOf(section) === -1 ? [section] : []).map((s) => ({ value: s, label: s }))
        .concat([{ value: NEW, label: "Another folder…" }]);

    const eta = progress && progress.rendered > 0 ? span((progress.secs / progress.rendered) * (progress.total - progress.done - progress.failed)) : "";

    return (
        <div className="eoc-arch">
            <div className="eoc-step">
                <h4>1 · What to add</h4>
                <div className="eoc-row">
                    <Dropdown className="eoc-drop eoc-drop--wide" value={source} onChange={pickSource} options={sourceOptions} placeholder="A campaign's Markets folder…" disabled={running} />
                    {source && <button type="button" className="eoc-btn" onClick={() => openPath(source)} title={source}><FolderOpen size={12} /> Open</button>}
                </div>
                {source && <div className="eoc-path">{source}</div>}
                <div className="eoc-path">Only reads the campaign's Renders. Nothing in the campaign is moved, changed or retired: this makes small copies in the research folder, and can be run again whenever there is more to add.</div>
                {reading && <div className="eoc-status">Reading the Renders folders…</div>}
                {jobs && !jobs.length && !reading && (
                    <div className="eoc-none">No .mov renders under that folder. It reads &lt;Market&gt;/Renders/&lt;Batch&gt;, leaving out folders that start with “_”.</div>
                )}
                {jobs && jobs.length > 0 && (
                    <>
                        <div className="eoc-row eoc-row--tight">
                            <span className="eoc-status">{count(jobs.length, "render")} in {count(groups.length, "market")}</span>
                            <button type="button" className="eoc-link" disabled={running} onClick={() => setAll(true)}>All</button>
                            <button type="button" className="eoc-link" disabled={running} onClick={() => setAll(false)}>None</button>
                        </div>
                        <div className="eoc-markets">
                            {groups.map((m) => (
                                <div className="eoc-market" key={m.market}>
                                    <div className="eoc-market-head">
                                        <CheckboxToggle checked={marketOn(m)} onChange={() => !running && toggleMarket(m)} label={pretty(m.market) || "(this folder)"} />
                                        <button type="button" className="eoc-link" onClick={() => setOpen((o) => { const n = { ...o }; if (n[m.market]) delete n[m.market]; else n[m.market] = true; return n; })}>
                                            {count(m.batches.length, "batch", "batches")} · {m.n.toLocaleString()}
                                        </button>
                                    </div>
                                    {open[m.market] && (
                                        <div className="eoc-batches">
                                            {m.batches.map((b) => (
                                                <CheckboxToggle key={b.batch} checked={!off[keyOf(m.market, b.batch)]} onChange={() => !running && toggleBatch(m.market, b.batch)} label={<>{pretty(b.batch) || "(loose in Renders)"} <em>{b.n}</em></>} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <div className="eoc-step">
                <h4>2 · Where it goes</h4>
                <div className="eoc-row">
                    <Dropdown className="eoc-drop" value={film} onChange={pickFilm} options={filmOptions} placeholder="Film…" disabled={running} icon={<Film size={13} />} />
                    <Dropdown className="eoc-drop" value={section} onChange={pickSection} options={sectionOptions} placeholder="Folder…" disabled={running} />
                    {dest && <button type="button" className="eoc-btn" onClick={() => openPath(dest)} title={dest}><FolderOpen size={12} /> Open</button>}
                </div>
                <div className="eoc-path">{dest || "Pick the film this campaign belongs to."}</div>
            </div>

            <div className="eoc-step">
                <h4>3 · How</h4>
                <div className="eoc-row">
                    <CheckboxToggle checked={newest} onChange={(v) => !running && setNewest(v)} label="Newest version only" title="One clip per deliverable in each batch: its highest _Vnn. Off archives every version in Renders." />
                    <CheckboxToggle checked={still} onChange={(v) => !running && setStill(v)} label="Last-frame still" title="A JPG of each clip's final frame beside it (needs the JPEG_1FRAME template)" />
                    <Dropdown className="eoc-drop eoc-drop--small" value={mbps} onChange={setMbps} disabled={running} options={MBPS.map((m) => ({ value: m, label: m + " Mbps" }))} />
                    <Dropdown className="eoc-drop eoc-drop--small" value={chunk} onChange={setChunk} disabled={running} options={[{ value: "5", label: "5 a pass" }, { value: "10", label: "10 a pass" }, { value: "20", label: "20 a pass" }]} />
                </div>
                <div className="eoc-path">
                    Uses the H264_{mbps}MBPS_MOS{still ? " and JPEG_1FRAME" : ""} output module template{still ? "s" : ""}. Fewer a pass is slower and loses less if After Effects falls over.
                </div>
            </div>

            <div className="eoc-go">
                {!running && jobs && jobs.length > 0 && dest && (
                    <div className="eoc-tally">
                        <strong>{count(todo.length, "clip")} to add</strong>
                        <span>
                            {(chosen.length - todo.length).toLocaleString()} of {chosen.length.toLocaleString()} already there
                            {newest && older > 0 ? ` · ${count(older, "older version")} left out` : ""}
                        </span>
                    </div>
                )}
                {!running && (
                    <button type="button" className="eoc-btn eoc-btn--go" disabled={!dest || !todo.length} onClick={() => run()}>
                        <Archive size={13} /> {todo.length ? `Add ${count(todo.length, "clip")}` : "Nothing to add"}
                    </button>
                )}
                {running && progress && (
                    <div className="eoc-run">
                        <div className="eoc-meter"><i style={{ width: Math.round(((progress.done + progress.failed) / Math.max(1, progress.total)) * 100) + "%" }} /></div>
                        <div className="eoc-run-line">
                            <span>
                                Pass {Math.max(1, progress.pass)} of {progress.passes} · {progress.done.toLocaleString()} of {progress.total.toLocaleString()} added
                                {progress.failed ? ` · ${progress.failed} failed` : ""}{eta ? ` · about ${eta} left` : ""}
                            </span>
                            <button type="button" className="eoc-btn" disabled={progress.stopping} onClick={() => { stop.current = true; setProgress((c) => c && { ...c, stopping: true }); }}>
                                <Square size={11} /> {progress.stopping ? "Stopping after this pass…" : "Stop"}
                            </button>
                        </div>
                        <div className="eoc-path">After Effects is busy during a pass. If it falls over, open this tool again: the run carries on from what is already in the folder.</div>
                    </div>
                )}
                {!running && summary && <div className="eoc-status eoc-status--done">{summary}</div>}
                {!running && failures.length > 0 && (
                    <div className="eoc-fails">
                        <div className="eoc-row eoc-row--tight">
                            <strong>{count(failures.length, "render")} failed</strong>
                            <button type="button" className="eoc-btn" onClick={() => { const set: Record<string, true> = {}; failures.forEach((f) => { set[f.prefix] = true; }); run(todo.filter((j) => set[j.prefix])); }}>
                                <RefreshCw size={12} /> Retry failed
                            </button>
                        </div>
                        {failures.slice(0, 12).map((f) => <div key={f.prefix} className="eoc-fail"><b>{f.prefix}</b><span>{f.note}</span></div>)}
                        {failures.length > 12 && <div className="eoc-path">…and {failures.length - 12} more, written into {MANIFEST_NAME}.</div>}
                    </div>
                )}
            </div>
        </div>
    );
};

// =============================================================================

const EocResearchTool: React.FC = () => {
    const [tab, setTab] = useState<string>("browse");
    const [root, setRoot] = useState("");
    const [films, setFilms] = useState<Kid[] | null>(null);
    const [resume, setResume] = useState<Resume | null>(null);
    const [rev, setRev] = useState(0);
    const [opened, setOpened] = useState<Record<string, true>>({ browse: true });

    const readFilms = useCallback(async (at: string) => { if (at) setFilms(await listFilms(at, listDir)); }, []);

    useEffect(() => {
        if (!hasNode) return;
        (async () => {
            let at = "";
            try { at = String((await evalTS("researchGetRoot" as any)) || ""); } catch { at = ""; }
            setRoot(at);
            readFilms(at);
        })();
    }, [readFilms]);

    const changeRoot = async () => {
        const p = String((await evalTS("researchSelectFolder" as any, root, "Pick the Project_Research folder")) || "");
        if (!p || p === root) return;
        await evalTS("researchSetRoot" as any, p);
        Object.keys(kept).forEach((k) => { delete kept[k]; });
        setFilms(null);
        setRoot(p);
        readFilms(p);
    };
    const show = (t: string) => { setTab(t); setOpened((o) => (o[t] ? o : { ...o, [t]: true })); };

    if (!hasNode) return <div className="eoc"><div className="eoc-none">Open this panel inside After Effects to read the research archive.</div></div>;

    return (
        <div className="eoc">
            <div className="eoc-top">
                <SegmentedToggle name="eoc-tabs" value={tab} onChange={show} options={[{ value: "browse", label: "Browse" }, { value: "archive", label: "Add a campaign" }]} />
                <span className="eoc-top-right">
                {tab === "browse" && (
                    <button type="button" className="eoc-root" onClick={() => { Object.keys(kept).forEach((k) => { delete kept[k]; }); readFilms(root); setRev((n) => n + 1); }} title="Read the folders again">
                        <RefreshCw size={12} /> <span>Re-read</span>
                    </button>
                )}
                <button type="button" className="eoc-root" onClick={changeRoot} title={"The archive: " + root + "\nPress to point this machine at another folder."}>
                    <FolderOpen size={12} /> <span>{root ? nodePath.basename(root) : "…"}</span>
                </button>
                </span>
            </div>
            {/* Both halves stay alive once opened: a run in progress must not be unmounted by a look at Browse. */}
            <div className="eoc-tab" style={{ display: tab === "browse" ? undefined : "none" }}>
                {root && <Browse root={root} films={films} rev={rev} onResume={(r) => { setResume({ ...r }); show("archive"); }} />}
            </div>
            {opened.archive && (
                <div className="eoc-tab" style={{ display: tab === "archive" ? undefined : "none" }}>
                    {root && <Archiver root={root} films={films} resume={resume} onFilmsChanged={() => readFilms(root)} onArchived={(film) => {
                        Object.keys(kept).forEach((k) => { if (nodePath.basename(k) === film) delete kept[k]; });
                        readFilms(root);
                        setRev((n) => n + 1);
                    }} />}
                </div>
            )}
        </div>
    );
};

export default EocResearchTool;
