// =============================================================================
// src/js/main/tools/SizeFinder.tsx
// -----------------------------------------------------------------------------
// SIZE FINDER -- "have we already made something this shape?"
//
// Type a size and get the approved deliverables closest to it, across every
// campaign in the Localised Library list: its delivered file playing beside
// its mech sheet, so the thing on screen can be matched to the thing in mind.
//
// THE SHEET IS THE JPG, NOT THE PDF. The panel cannot draw a PDF: in CEP
// pdf.js sees Node, takes its Node branch and asks for a `canvas` module that
// is not there ("createCanvas is not a function"). The mech team exports the
// same sheet as a JPG into the deliverable's JPG_PNG folder, named as the
// folder is, so that is shown and the PDF is a button that opens it.
//
// APPROVED MEANS DELIVERED: a file in a `_Delivery` folder under a territory's
// Renders (lib/sizeScan.ts). SHAPE COMES FIRST: 400x400 answers with squares
// of any size before it offers a 400x420 (lib/sizeMatch.ts).
//
// It READS FOLDER LISTINGS AND NOTHING ELSE, from the panel's own Node --
// After Effects is only asked for the campaign list. So it needs the panel
// inside AE (browser preview has no Node), and an unmounted share is a normal
// state: that campaign is left out and counted, never an error.
//
// The one player is VideoOverlay ("Play large"). The clip beside the PDF is an
// inline preview, like a master's card in OV Library.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, FolderOpen, Maximize2, Pin, RefreshCw, Search } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { child_process, path as nodePath } from "../../lib/cep/node";
import { toFileUrl } from "../lib/fileUrl";
import { usePosterFrame } from "../lib/renderPreview";
import { byCloseness, closeness, Closeness, marketOfName, parseWanted, ratioLabel, repeatFor, RowSpec, sheetImages, activeFirst } from "../lib/sizeMatch";
import { Approved, findApprovedProject, findRowArt } from "../lib/sizeScan";
import { hasNode, isChecking, listDir, onApprovedChange, peekApproved, readApproved } from "../lib/sizeFinderStore";
import Dropdown from "../Dropdown";
import VideoOverlay from "../VideoOverlay";
import "../shared.scss";
import "./SizeFinder.scss";

interface Campaign { name: string; marketsRoot: string }

const STORE = "xyi.sizefinder.size";
const readStored = () => { try { return localStorage.getItem(STORE) || ""; } catch { return ""; } };
const writeStored = (v: string) => { try { localStorage.setItem(STORE, v); } catch { /* a convenience only */ } };

const openPath = (p: string, reveal = false) => {
    if (!p) return;
    try { child_process.spawn("open", reveal ? ["-R", p] : [p], { detached: true }); } catch { /* nothing to do */ }
};

/** A box of the deliverable's own shape, fitted inside maxW x maxH. */
const fitBox = (w: number, h: number, maxW: number, maxH: number) => {
    const s = Math.min(maxW / w, maxH / h);
    return { width: Math.max(8, Math.round(w * s)), height: Math.max(8, Math.round(h * s)) };
};

interface Hit { row: Approved; near: Closeness | null }

/** What a creative is filed under: upper-cased, and a name carrying none is its own group. */
const creativeKey = (r: Approved) => (r.creative || "").toUpperCase() || "__OTHER__";

const SizeCard: React.FC<{ hit: Hit; active: boolean; onPick: () => void; showCampaign: boolean }> = ({ hit, active, onPick, showCampaign }) => {
    const { row, near } = hit;
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [ready, setReady] = useState(false);
    const poster = usePosterFrame(videoRef, () => setReady(true));
    const box = fitBox(row.w, row.h, 136, 88);
    return (
        <button
            type="button"
            className={"szf-card" + (active ? " is-active" : "") + (near ? " szf-card--" + near.kind : "")}
            onClick={onPick}
            onMouseEnter={() => { const v = videoRef.current; if (v) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } }}
            onMouseLeave={poster.restToPoster}
        >
            <span className="szf-thumb">
                <span className="szf-thumb-shape" style={box}>
                    {row.preview ? (
                        <video
                            ref={videoRef}
                            className={ready ? "is-ready" : ""}
                            src={toFileUrl(row.preview)}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={poster.onLoadedMetadata}
                            onSeeked={poster.onSeeked}
                            onLoadedData={poster.onLoadedData}
                        />
                    ) : null}
                </span>
            </span>
            <span className="szf-card-size">{row.w}×{row.h}{row.seconds ? <em> · {row.seconds}s</em> : null}</span>
            {near && <span className="szf-card-near">{near.label}</span>}
            <span className="szf-card-where">{row.creative ? row.creative + " · " : ""}{row.territory}{showCampaign ? " · " + row.campaign : ""}</span>
            <span className="szf-card-flags">
                {!row.preview && <i>no preview</i>}
                {!row.artFolder && <i>no sheet</i>}
            </span>
        </button>
    );
};

/**
 * The pictures in one deliverable's JPG_PNG folder, the mech sheet first: the
 * JPG named as the folder is. A folder usually holds more than the sheet (the
 * artwork slots, ARTWORK_ONLY's extras), so they page. Listed when the
 * deliverable is picked -- the folder and one level under it -- not for every
 * row of the scan.
 */
interface Pic { name: string; path: string }

/** The pictures in one JPG_PNG folder, the sheet first, then what is one level under it. */
async function folderPics(folder: string, folderName: string): Promise<Pic[]> {
    if (!folder) return [];
    const kids = await listDir(folder);
    const own = sheetImages(folderName, kids.filter((k) => !k.dir).map((k) => k.name))
        .map((name) => ({ name, path: nodePath.join(folder, name) }));
    // ARTWORK_ONLY and the like, after the folder's own.
    const subs = kids.filter((k) => k.dir && k.name.charAt(0) !== "_" && k.name.charAt(0) !== ".");
    const inside = await Promise.all(subs.map((d) => listDir(d.path)));
    const deeper: Pic[] = [];
    subs.forEach((d, i) => {
        sheetImages("", inside[i].filter((k) => !k.dir).map((k) => k.name))
            .forEach((name) => deeper.push({ name: d.name + "/" + name, path: nodePath.join(d.path, name) }));
    });
    return own.concat(deeper);
}

const SheetPane: React.FC<{ row: Approved }> = ({ row }) => {
    const [pics, setPics] = useState<Pic[] | null>(null); // null = looking
    const [at, setAt] = useState(0);
    const [broken, setBroken] = useState<Record<string, true>>({});

    useEffect(() => {
        let alive = true;
        setPics(null);
        setAt(0);
        setBroken({});
        folderPics(row.artFolder, row.artFolderName).then((p) => { if (alive) setPics(p); });
        return () => { alive = false; };
    }, [row.id]);

    if (pics === null) return <div className="szf-none">Looking for the sheet…</div>;
    if (!pics.length) {
        return (
            <div className="szf-none">
                {row.artFolder
                    ? "No JPG or PNG in this deliverable's JPG_PNG folder."
                    : `No JPG_PNG folder named after this deliverable in ${row.territory}.`}
            </div>
        );
    }
    const cur = pics[at % pics.length];
    const step = (by: number) => setAt((at + by + pics.length) % pics.length);
    return (
        <div className="szf-sheets">
            {broken[cur.path] ? (
                <div className="szf-none">This picture couldn't be shown.</div>
            ) : (
                <img
                    className={"szf-sheet" + (pics.length > 1 ? " is-paged" : "")}
                    key={cur.path}
                    src={toFileUrl(cur.path)}
                    alt=""
                    onClick={() => { if (pics.length > 1) step(1); }}
                    onError={() => setBroken((prev) => ({ ...prev, [cur.path]: true }))}
                />
            )}
            {pics.length > 1 && (
                <div className="szf-pager">
                    <button type="button" onClick={() => step(-1)} aria-label="Previous picture"><ChevronLeft size={14} /></button>
                    <span className="szf-pager-count">{at + 1} of {pics.length}</span>
                    <button type="button" onClick={() => step(1)} aria-label="Next picture"><ChevronRight size={14} /></button>
                    <span className="szf-pager-name" title={cur.name}>{cur.name}</span>
                </div>
            )}
        </div>
    );
};

/** One side of the compare: a picture fitted to its box, or why there is none. */
const ComparePic: React.FC<{ pic: Pic | null; none: string }> = ({ pic, none }) => {
    const [broken, setBroken] = useState(false);
    useEffect(() => { setBroken(false); }, [pic && pic.path]);
    if (!pic) return <span className="szf-cmp-none">{none}</span>;
    if (broken) return <span className="szf-cmp-none">This picture couldn't be shown.</span>;
    return <img src={toFileUrl(pic.path)} alt="" draggable={false} onError={() => setBroken(true)} />;
};

/**
 * THE ROW'S OWN PICTURES AGAINST THE APPROVED ONE'S, WIPED. Opened from a
 * batch row, the question is "is this the same layout", and that is answered
 * by laying one mech sheet over the other with a divider to drag. Not a pixel
 * difference: two markets' sheets differ in language, date and usually size,
 * so a difference image lights up everywhere and says nothing.
 *
 * ONE MODE, AND IT PAGES. It shipped with a three-way toggle over it (side by
 * side, wipe, the approved sheets), which pushed the wipe down beside a clip
 * that starts at the top, and the wipe only ever showed the first picture.
 * Both folders list the same way (the sheet, then the numbered slots, then
 * ARTWORK_ONLY), so picture N of one is wiped over picture N of the other,
 * and a side with nothing at N says so.
 *
 * The row has no filename until it is built, so its JPG_PNG folder is found by
 * what the row states (findRowArt) and used only when exactly ONE matches.
 * None (the artwork has not landed) or several (the row does not say enough)
 * is said, and the approved sheets are shown alone as they always were.
 */
const ComparePane: React.FC<{ row: Approved; use: UseAsMaster }> = ({ row, use }) => {
    const spec = use.row as RowSpec;
    const [mine, setMine] = useState<{ pics: Pic[]; folders: number } | null>(null); // null = looking
    const [theirs, setTheirs] = useState<Pic[] | null>(null);
    const [split, setSplit] = useState(50);
    const [at, setAt] = useState(0);
    const boxRef = useRef<HTMLDivElement | null>(null);

    // The row's own pictures: looked for once per window, they do not change with the card picked.
    useEffect(() => {
        let alive = true;
        setMine(null);
        (async () => {
            const folders = await findRowArt(use.territoryPath || "", spec, listDir);
            const pics = folders.length === 1 ? await folderPics(folders[0].path, folders[0].name) : [];
            if (alive) setMine({ pics, folders: folders.length });
        })();
        return () => { alive = false; };
    }, [use.territoryPath, spec.creative, spec.site, spec.w, spec.h, spec.seconds]);

    useEffect(() => {
        let alive = true;
        setTheirs(null);
        setAt(0);
        folderPics(row.artFolder, row.artFolderName).then((p) => { if (alive) setTheirs(p); });
        return () => { alive = false; };
    }, [row.id]);

    // Mouse events, not pointer events: the macOS CEP host doesn't reliably send those.
    const drag = (e: React.MouseEvent) => {
        e.preventDefault();
        const move = (ev: MouseEvent) => {
            const el = boxRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (r.width > 0) setSplit(Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)));
        };
        const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        move(e.nativeEvent);
    };

    if (mine === null || theirs === null) return <div className="szf-none">Looking for the two sheets…</div>;
    const here = use.territory || "this market";
    if (!mine.pics.length) {
        // Nothing of the row's to compare with: the approved sheets alone, and why.
        const why = mine.folders > 1
            ? `${mine.folders} JPG_PNG folders in ${here} could be this row's, so none is compared. A site on the row narrows it.`
            : mine.folders === 1
                ? `This row's JPG_PNG folder in ${here} has no picture in it yet.`
                : `No JPG_PNG folder for this row in ${here} yet, so there is nothing to compare with.`;
        return (
            <>
                <div className="szf-cmp-note">{why}</div>
                <SheetPane row={row} />
            </>
        );
    }
    const count = Math.max(mine.pics.length, theirs.length);
    const n = at % count;
    const a = mine.pics[n] || null;
    const b = theirs[n] || null;
    const step = (by: number) => setAt((n + by + count) % count);
    const noneB = theirs.length
        ? `${row.territory} has no picture ${n + 1}.`
        : row.artFolder ? "No JPG or PNG in its JPG_PNG folder." : `No JPG_PNG folder for it in ${row.territory}.`;
    // The row's own shape, as a share of the pane's WIDTH (padding-bottom:
    // chrome74 has no aspect-ratio), kept between a strip and a tall card so
    // an extreme format neither vanishes nor runs off the window.
    const tall = Math.max(0.3, Math.min(1.25, spec.h / spec.w));
    const name = (a || b || { name: "" }).name;
    return (
        <div className="szf-cmp">
            <div className="szf-cmp-wipe" ref={boxRef} style={{ paddingBottom: tall * 100 + "%" }} onMouseDown={drag}>
                <span className="szf-cmp-layer"><ComparePic pic={b} none={noneB} /></span>
                <span className="szf-cmp-layer szf-cmp-layer--top" style={{ clipPath: `inset(0 ${100 - split}% 0 0)`, WebkitClipPath: `inset(0 ${100 - split}% 0 0)` }}>
                    <ComparePic pic={a} none={`${here} has no picture ${n + 1}.`} />
                </span>
                <span className="szf-cmp-divider" style={{ left: split + "%" }}><i /></span>
            </div>
            <div className="szf-cmp-legend">
                <span><b>This row</b> · {here}</span>
                <span>{row.territory} · <b>approved</b></span>
            </div>
            {count > 1 && (
                <div className="szf-pager">
                    <button type="button" onClick={() => step(-1)} aria-label="Previous picture"><ChevronLeft size={14} /></button>
                    <span className="szf-pager-count">{n + 1} of {count}</span>
                    <button type="button" onClick={() => step(1)} aria-label="Next picture"><ChevronRight size={14} /></button>
                    <span className="szf-pager-name" title={name}>{name}</span>
                </div>
            )}
        </div>
    );
};

/**
 * `initial*` open it ON a size, a creative and a campaign -- how Build a
 * Batch's "seen before" hint shows what a row has been made as before. It is
 * then mounted in a window over the builder, not navigated to: opening a
 * Localise tool drops the page's panes, and a half-edited batch with them.
 */
/**
 * Offered only from a Build a Batch row: build THAT row from the deliverable
 * on screen instead of a master. Same campaign only (two films can share a
 * creative's name, never its artwork), another market, a length the row can
 * be built from (its own, or one that goes into it exactly 2 or 3 times and
 * is played that often), and only once its project is found on disk.
 */
export interface UseAsMaster {
    campaign: string;
    marketsRoot: string;
    /** The row's length in seconds; 0 when the row doesn't say. */
    seconds: number;
    /** The territory folder the row is being built for. */
    territory: string;
    /** That territory's folder on disk, where the row's own JPG_PNG is looked for. "" if unknown. */
    territoryPath?: string;
    /** What the row states, to find its own mech sheet and compare it with the approved one. */
    row?: RowSpec;
    /** `repeat`: how many times the deliverable is played to fill the row (1, 2 or 3). */
    onUse: (row: Approved, project: { name: string; path: string }, market: string, repeat: number) => void;
}

interface SizeFinderProps { initialSize?: string; initialCreative?: string; initialCampaign?: string; onSelectTool?: (toolId: string) => void; useAsMaster?: UseAsMaster }

/**
 * "Use as this row's master", as a BAR over the clip and the sheet: it is the
 * one thing in the window that changes the batch, and as a fourth small
 * button under the clip it read as another way to open a folder. The bar says
 * what will be built from what; when it can't be, it says why instead.
 */
const UseAsMasterBar: React.FC<{ row: Approved; use: UseAsMaster }> = ({ row, use }) => {
    const [state, setState] = useState<"idle" | "looking" | "missing">("idle");
    useEffect(() => { setState("idle"); }, [row.id]);
    const market = marketOfName(row.name);
    const repeat = repeatFor(use.seconds, row.seconds);
    let why = "";
    if (row.campaign !== use.campaign) why = `It's ${row.campaign}'s. Only this campaign's deliverables can be built from.`;
    else if (row.territory === use.territory) why = `It's already ${row.territory}'s.`;
    else if (!market) why = "Its name doesn't say which market it was made for, so its artwork can't be swapped.";
    else if (!repeat) why = `It's ${row.seconds}s and the row is ${use.seconds}s. A row is built from its own length, or one that goes into it 2 or 3 times.`;
    else if (state === "missing") why = `No project for it in ${row.territory}/AE${row.batch ? "/" + row.batch : ""}.`;
    const pick = async () => {
        setState("looking");
        const proj = await findApprovedProject(use.marketsRoot, row, listDir);
        if (!proj) { setState("missing"); return; }
        setState("idle");
        use.onUse(row, proj, market, repeat);
    };
    return (
        <div className={"szf-use" + (why ? " is-off" : "")}>
            <span className="szf-use-mark"><Pin size={15} /></span>
            <span className="szf-use-text">
                <strong>{why ? "Can't build the row from this one" : `Build the row from ${row.territory}'s ${row.w}×${row.h}`}</strong>
                <span className="szf-use-why">
                    {why || (
                        (repeat > 1 ? `${row.seconds}s, played ${repeat}× to fill ${use.seconds}s. ` : "")
                        + `Its ${market} artwork is swapped for ${use.territory || "this market"}'s as it builds.`
                    )}
                </span>
            </span>
            <button type="button" className="szf-use-btn" disabled={!!why || state === "looking"} onClick={pick}>
                {state === "looking" ? "Finding its project…" : <>Use as this row's master{repeat > 1 ? <em>×{repeat}</em> : null}</>}
            </button>
        </div>
    );
};

const SizeFinderTool = ({ initialSize, initialCreative, initialCampaign, useAsMaster }: SizeFinderProps) => {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [rows, setRows] = useState<Approved[] | null>(null);
    const [missing, setMissing] = useState<string[]>([]);
    const [busy, setBusy] = useState("");
    const [note, setNote] = useState("");
    const [text, setText] = useState(() => initialSize || readStored());
    const [campaign, setCampaign] = useState(initialCampaign || "");
    // One creative at a time ("" = all). Keyed upper-case: TRIO and Trio are one.
    const [creative, setCreative] = useState((initialCreative || "").toUpperCase());
    const [picked, setPicked] = useState<string | null>(null);
    const [limit, setLimit] = useState(24);
    const [playing, setPlaying] = useState<Approved | null>(null);

    const scan = async (list: Campaign[], force = false) => {
        const out: Approved[] = [];
        const gone: string[] = [];
        for (const c of list) {
            if (!c.marketsRoot) continue;
            setBusy(`Reading ${c.name}…`);
            const read = await readApproved(c.name, c.marketsRoot, force);
            if (!read.mounted) gone.push(c.name);
            read.rows.forEach((r) => out.push(r));
            // The first campaign is the one being worked on: on screen as it lands.
            setRows(out.slice());
        }
        setRows(out); setMissing(gone); setBusy("");
    };

    // A team copy is shown at once and checked against the disk behind it:
    // when the check lands (or starts), redraw from what the store now holds,
    // quietly -- no "Reading…", nothing the person did.
    const [checking, setChecking] = useState(isChecking());
    const campaignsRef = useRef<Campaign[]>([]);
    campaignsRef.current = campaigns;
    useEffect(() => onApprovedChange(() => {
        setChecking(isChecking());
        const list = campaignsRef.current.filter((c) => c.marketsRoot);
        const reads = list.map((c) => peekApproved(c.name, c.marketsRoot));
        if (!list.length || reads.some((r) => !r)) return; // a first read is still on its way
        const out: Approved[] = [];
        reads.forEach((r) => (r as { rows: Approved[] }).rows.forEach((x) => out.push(x)));
        setRows(out);
        setMissing(list.filter((c, i) => !(reads[i] as { mounted: boolean }).mounted).map((c) => c.name));
    }), []);

    useEffect(() => {
        let alive = true;
        if (!hasNode) { setNote("Open this panel inside After Effects to read the Markets folders."); return; }
        (async () => {
            let list: Campaign[] = [];
            try { list = ((await evalTS("loadLocLibCampaigns")) as unknown as Campaign[]) || []; } catch { list = []; }
            // ACTIVE campaigns only, and the one being worked on first. A
            // retired campaign's previews are archived and purged, so its
            // clips are gone. A board that can't be read retires nothing.
            let here = initialCampaign || "";
            try {
                const board = (await evalTS("teamCampaignBoard")) as { read?: boolean; rows?: { name: string; retiredBy: string }[] } | undefined;
                if (!here) here = String((await evalTS("csvLocaliserLoadLastCampaign")) || "");
                list = activeFirst(list, board && board.read ? (board.rows || []).filter((r) => r.retiredBy).map((r) => r.name) : [], here);
            } catch { /* no team folder: every campaign, as listed */ }
            if (!alive) return;
            setCampaigns(list);
            // Opens ON the campaign being worked on; "Every campaign" is one pick away.
            if (!initialCampaign && here && list.length > 1 && list[0].name === here && list[0].marketsRoot) setCampaign(here);
            if (!list.length) { setNote("No campaigns yet. Add one in Big Guy Localiser and its Markets folder is read here."); return; }
            await scan(list);
        })();
        return () => { alive = false; };
    }, []);

    const wanted = parseWanted(text);
    useEffect(() => { if (wanted) writeStored(text.trim()); }, [text]);
    useEffect(() => { setLimit(24); }, [text, campaign, creative]);

    // Opened from a batch row: only lengths that row can be built from (its
    // own, or one played 2 or 3 times). The rest are counted, not listed.
    const rowSeconds = useAsMaster ? useAsMaster.seconds : 0;
    const ofCampaign = useMemo(() => (rows || []).filter((r) => !campaign || r.campaign === campaign), [rows, campaign]);
    const inCampaign = useMemo(() => (rowSeconds ? ofCampaign.filter((r) => repeatFor(rowSeconds, r.seconds) > 0) : ofCampaign), [ofCampaign, rowSeconds]);
    const otherLengths = ofCampaign.length - inCampaign.length;
    // The creatives this campaign (or all of them) has delivered, most first.
    const creatives = useMemo(() => {
        const seen: Record<string, { label: string; n: number }> = {};
        inCampaign.forEach((r) => {
            const k = creativeKey(r);
            if (!seen[k]) seen[k] = { label: r.creative || "Other", n: 0 };
            seen[k].n++;
        });
        return Object.keys(seen).map((k) => ({ key: k, label: seen[k].label, n: seen[k].n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    }, [inCampaign]);
    // A creative the campaign just switched to doesn't have: back to all.
    // Matched squashed, so a builder row's "PORTAL_TO_PARADISE" finds the
    // files' "PortalToParadise".
    const squashed = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const creativeHit = creative !== "" ? creatives.filter((c) => squashed(c.key) === squashed(creative))[0] : undefined;
    const creativeOn = creativeHit ? creativeHit.key : "";
    const inScope = useMemo(
        () => (creativeOn === "" ? inCampaign : inCampaign.filter((r) => creativeKey(r) === creativeOn)),
        [inCampaign, creativeOn]
    );

    const hits: Hit[] = useMemo(() => {
        if (!wanted) return [];
        return inScope
            .map((row) => ({ row, near: closeness(wanted, row) }))
            .sort((a, b) => byCloseness(a.near as Closeness, b.near as Closeness) || a.row.name.localeCompare(b.row.name));
    }, [inScope, wanted && wanted.w, wanted && wanted.h]);

    // With nothing typed: the sizes made most often, as a way in.
    const common = useMemo(() => {
        const count: Record<string, number> = {};
        inScope.forEach((r) => { const k = r.w + "x" + r.h; count[k] = (count[k] || 0) + 1; });
        return Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b)).slice(0, 16).map((k) => ({ size: k, n: count[k] }));
    }, [inScope]);

    const sizes = useMemo(() => { const s: Record<string, true> = {}; inScope.forEach((r) => { s[r.w + "x" + r.h] = true; }); return Object.keys(s).length; }, [inScope]);
    const selected = (picked && hits.filter((h) => h.row.id === picked)[0]) || hits[0] || null;
    const exact = hits.filter((h) => h.near && h.near.kind === "exact").length;
    const sameShape = hits.filter((h) => h.near && h.near.kind === "same-shape").length;

    const options = [{ value: "", label: "Every campaign" }].concat(
        campaigns.filter((c) => c.marketsRoot).map((c) => ({ value: c.name, label: c.name }))
    );

    return (
        <div className="szf">
            <div className="szf-bar">
                <label className="szf-size">
                    <Search size={14} />
                    <input
                        type="text"
                        value={text}
                        placeholder="400x400"
                        spellCheck={false}
                        onChange={(e) => { setText(e.target.value); setPicked(null); }}
                    />
                    {wanted && (
                        <span className="szf-ratio" title="The ratio of the size you typed">
                            <i style={fitBox(wanted.w, wanted.h, 26, 18)} />
                            {ratioLabel(wanted.w, wanted.h)}
                        </span>
                    )}
                </label>
                {campaigns.length > 1 && (
                    <Dropdown value={campaign} onChange={(v) => { setCampaign(v); setPicked(null); }} options={options} className="szf-campaign" />
                )}
                <button type="button" className="szf-btn" disabled={!!busy || !campaigns.length} onClick={() => scan(campaigns, true)}>
                    <RefreshCw size={13} className={busy ? "spin" : ""} /> {busy ? "Reading…" : "Re-read"}
                </button>
            </div>

            {creatives.length > 1 && (
                <div className="szf-creatives">
                    <button type="button" className={"szf-chip" + (creativeOn === "" ? " is-on" : "")} onClick={() => { setCreative(""); setPicked(null); }}>
                        Every creative<em>{inCampaign.length}</em>
                    </button>
                    {creatives.map((c) => (
                        <button
                            type="button"
                            key={c.key}
                            className={"szf-chip" + (creativeOn === c.key ? " is-on" : "")}
                            onClick={() => { setCreative(c.key); setPicked(null); }}
                        >
                            {c.label}<em>{c.n}</em>
                        </button>
                    ))}
                </div>
            )}

            <div className="szf-sum">
                {busy
                    ? busy
                    : note
                        ? note
                        : rows
                            ? `${inScope.length} approved ${creativeOn ? (creatives.filter((c) => c.key === creativeOn)[0] || { label: "" }).label + " " : ""}deliverable${inScope.length === 1 ? "" : "s"} in ${sizes} size${sizes === 1 ? "" : "s"}`
                              + (otherLengths > 0 ? ` · ${otherLengths} at lengths a ${rowSeconds}s row can't be built from left out` : "")
                              + (missing.length ? ` · not mounted: ${missing.join(", ")}` : "")
                              + (checking ? " · checking for new deliveries…" : "")
                            : ""}
                {wanted && !busy && rows ? (
                    <strong>
                        {exact > 0 ? ` · ${exact} at exactly ${wanted.w}×${wanted.h}` : ` · none at exactly ${wanted.w}×${wanted.h}`}
                        {sameShape > 0 ? `, ${sameShape} more at the same ratio` : ""}
                    </strong>
                ) : null}
            </div>

            {!wanted && rows && rows.length > 0 && (
                <div className="szf-common">
                    <span className="szf-common-label">{text.trim() ? "That isn't a size. Try 400x400, or one of these:" : "Type a size, or start from one made often:"}</span>
                    <div className="szf-chips">
                        {common.map((c) => (
                            <button type="button" key={c.size} className="szf-chip" onClick={() => setText(c.size)}>
                                {c.size.replace("x", "×")}<em>{c.n}</em>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {wanted && selected && (
                <div className="szf-detail">
                    <div className="szf-detail-head">
                        <strong title={selected.row.name}>{selected.row.name}</strong>
                        <span>
                            {selected.row.creative ? selected.row.creative + " · " : ""}{selected.row.territory} · {selected.row.campaign}
                            {selected.row.batch ? ` · ${selected.row.batch}` : ""}
                            {selected.near ? ` · ${selected.near.label}` : ""}
                        </span>
                    </div>
                    {useAsMaster && <UseAsMasterBar row={selected.row} use={useAsMaster} />}
                    <div className="szf-pair">
                        <div className="szf-pane">
                            {selected.row.preview ? (
                                <video key={selected.row.preview} src={toFileUrl(selected.row.preview)} controls muted loop autoPlay playsInline />
                            ) : (
                                <div className="szf-none">Delivered as a .mov with no mp4 in the batch's _mp4, so it can't play here.</div>
                            )}
                            <div className="szf-pane-actions">
                                {selected.row.preview && (
                                    <button type="button" className="szf-btn" onClick={() => setPlaying(selected.row)}><Maximize2 size={12} /> Play large</button>
                                )}
                                <button type="button" className="szf-btn" onClick={() => openPath(selected.row.delivered, true)}><FolderOpen size={12} /> Show in Finder</button>
                            </div>
                        </div>
                        <div className="szf-pane">
                            {useAsMaster && useAsMaster.row ? <ComparePane row={selected.row} use={useAsMaster} /> : <SheetPane row={selected.row} />}
                            <div className="szf-pane-actions">
                                {selected.row.artFolder && (
                                    <button type="button" className="szf-btn" onClick={() => openPath(selected.row.artFolder)}><FolderOpen size={12} /> Open JPG_PNG</button>
                                )}
                                {selected.row.pdf ? (
                                    <button type="button" className="szf-btn" onClick={() => openPath(selected.row.pdf)}><FileText size={12} /> Open the PDF</button>
                                ) : selected.row.pdfFolder ? (
                                    <button type="button" className="szf-btn" onClick={() => openPath(selected.row.pdfFolder)}><FolderOpen size={12} /> Open the PDFs folder</button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {wanted && rows && hits.length === 0 && !busy && (
                <div className="szf-none">Nothing delivered yet in {campaign || "any campaign"}.</div>
            )}

            {wanted && hits.length > 0 && (
                <>
                    <div className="szf-grid">
                        {hits.slice(0, limit).map((h) => (
                            <SizeCard key={h.row.id} hit={h} active={!!selected && selected.row.id === h.row.id} onPick={() => setPicked(h.row.id)} showCampaign={!campaign && campaigns.length > 1} />
                        ))}
                    </div>
                    {hits.length > limit && (
                        <button type="button" className="szf-btn szf-more" onClick={() => setLimit(limit + 24)}>
                            Show 24 more ({hits.length - limit} further off)
                        </button>
                    )}
                </>
            )}

            {playing && playing.preview && (
                <VideoOverlay path={playing.preview} title={playing.name} onClose={() => setPlaying(null)} />
            )}
        </div>
    );
};

export default SizeFinderTool;
