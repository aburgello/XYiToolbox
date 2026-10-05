// =============================================================================
// src/js/main/tools/BespokeGuided.tsx
// -----------------------------------------------------------------------------
// BESPOKE, GUIDED: the board is READ, not drawn.
//
// The tracing board asked a person to redo in a panel what the mech team had
// already done in InDesign: draw each panel over a reference, then pick a
// master for it. It was slower than doing it in After Effects, on a canvas a
// docked panel is too small for. The mech's own CSV, sitting beside every
// deliverable's sheet, already holds the canvas (in the name), every panel
// (each ART row's mask) and whose artwork is in it (the path) -- see
// lib/bespokeCsv.ts.
//
// So this page is a PROPOSAL TO CORRECT. Point it at a deliverable's folder:
// it draws the mech sheet with the panels it read outlined on it, proposes a
// master for each, and builds. What a person does here is fix what it got
// wrong -- another master, a panel's numbers, a panel the CSV could not see --
// and nothing is ever dragged.
//
// WHAT THE CSV COULD NOT SEE IS ADDED BY POINTING AT THE GAP. Artwork that is
// a film clip has no ART row, so an arch arrives as its two legs and nothing
// along the lintel. Moving over an empty part of the sheet shows the gap that
// would be filled (the band's height from what was read, across until a panel
// or the edge); a press makes it a panel. A panel can be COPIED, the copy
// landing in the next gap of its band (against the far leg, mirrored). Between
// them an arch's lintel is three presses and no typing.
//
// A PANEL THAT IS NEARLY RIGHT IS DRAGGED, WITH MAGNETIC SIDES. Its body moves
// it and its edges and corners size it, and a side that comes near a line it
// could sit on (another panel's side, a run-on window's, the board's edge)
// takes it, with the line drawn while it holds. That is the half of tracing
// worth keeping: nudging a box, never drawing a board. The X/Y/W/H fields take
// sums (`2817+2430`, `7680/3`) through the same NumField the rest of Bespoke
// uses. Mouse events throughout: CEP on macOS does not reliably send pointer
// events.
// A new panel takes the creative of the title sitting in it; one with no
// title in it starts EMPTY, because that is what a hole for a PNG is.
//
// THE MASTER FOR A PANEL IS THE LOCALISER'S ANSWER. `csvLocaliserListMasters`
// is the same ranked list Build a Batch's master picker shows (creative tiers
// first, then the closest shape), asked for the panel's own size and the
// board's length. A creative with no master at that length is offered one that
// goes into it exactly 2 or 3 times and is played that often (`repeatFor`, the
// rule a batch row built from an approved deliverable follows). Another
// creative's master is listed and never proposed.
//
// THE BUILD IS `bespokeBuildRegions`, unchanged: the engine the tracing board
// drove. Each panel is a region with a master, scaled to the panel's size in
// its own comp (`scalePanels`), with the mech sheet attached as a locked guide
// layer. Only how the regions are arrived at is new.
//
// It needs the panel inside After Effects: the CSV and the folders are read by
// the panel's own Node.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CopyPlus, FolderOpen, Hammer, Plus, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { fs, path as nodePath } from "../../lib/cep/node";
import { toFileUrl } from "../lib/fileUrl";
import { hasNode, listDir } from "../lib/sizeFinderStore";
import { closeness, creativeOfName, repeatFor, sizeOfName } from "../lib/sizeMatch";
import { boardFromRows, copySpot, creativeIn, CsvTitle, gapAt, parseBespokeCsv, Rect, Sides, snapMove, snapResize, whereItFiles } from "../lib/bespokeCsv";
import CheckboxToggle from "../CheckboxToggle";
import Dropdown from "../Dropdown";
import Tooltip from "../Tooltip";
import { NumField } from "../NumField";
import "./BespokeGuided.scss";

/** One master a panel could be built from. */
interface Cand {
    path: string;
    name: string;
    creative: string;
    /** The panel's own creative's. Another creative's is listed, never proposed. */
    own: boolean;
    /** How many times it is played to fill the board. */
    repeat: number;
    /** How its shape sits against the panel's ("Same ratio · 9:16", "16:9 · 12% wider"). */
    fit: string;
}

interface Panel {
    id: number;
    page: string;
    creative: string;
    /** What the CSV called the artwork. "" for a panel somebody added. */
    family: string;
    masks: Rect[];
    /** The same artwork's other windows (a lintel beside its leg): drawn, not built. */
    extras: Rect[];
    x: number;
    y: number;
    w: number;
    h: number;
    /** undefined follows the proposal, "" leaves the panel empty, else a master's path. */
    pick?: string;
}

interface Loaded {
    csvPath: string;
    folder: string;
    name: string;
    canvasW: number;
    canvasH: number;
    pages: string[];
    titles: CsvTitle[];
    /** page -> the mech's picture of it, when the folder holds one. */
    pictures: Record<string, string>;
    /** The other deliverables filed beside this one that have a CSV too. */
    siblings: { name: string; path: string }[];
    where: { marketsRoot: string; territory: string; batch: string } | null;
    /** Its _V01.aep is already in the batch's AE folder. */
    built: boolean;
}

const STORE = "xyi.bespoke.guided.path";
const HUES = ["#5eead4", "#fbbf24", "#f472b6", "#60a5fa", "#a3e635", "#fb923c", "#c084fc", "#f87171"];
const STAGE_MAX_H = 460;
/** The four sides and four corners a panel is sized by. */
const HANDLES: { k: string; sides: Sides }[] = [
    { k: "l", sides: { l: true } }, { k: "r", sides: { r: true } }, { k: "t", sides: { t: true } }, { k: "b", sides: { b: true } },
    { k: "tl", sides: { t: true, l: true } }, { k: "tr", sides: { t: true, r: true } }, { k: "bl", sides: { b: true, l: true } }, { k: "br", sides: { b: true, r: true } },
];

const readText = (p: string): Promise<string | null> =>
    new Promise((resolve) => {
        try { (fs as any).readFile(p, "utf8", (err: any, txt: string) => resolve(err ? null : String(txt || ""))); } catch { resolve(null); }
    });

/**
 * A master, said by what tells it from its neighbours: its SIZE first, then
 * its length, then the site or format between the artwork type and the size.
 * Every master of a creative starts `SF_INTL_Trio_DOOH_…`, so the filename
 * in a list cut to fit showed the same eleven characters on every row.
 */
const masterLabel = (name: string): string => {
    const stem = name.replace(/\.aep$/i, "");
    const info = sizeOfName(stem);
    if (!info) return stem;
    const toks = stem.split(/[_ ]+/);
    const sizeAt = toks.findIndex((t) => /^\d{3,}x\d{3,}(?:px)?$/i.test(t));
    const typeAt = toks.findIndex((t) => /^(DOOH|DINTH|D?FOH|OOH|DGTL)$/i.test(t));
    const what = typeAt !== -1 && sizeAt > typeAt + 1 ? toks.slice(typeAt + 1, sizeAt).join(" ") : "";
    return `${info.w}×${info.h}` + (info.seconds ? ` · ${info.seconds}s` : "") + (what ? ` · ${what}` : "");
};

const candKey = (p: Panel, seconds: number) => [p.creative, p.w, p.h, seconds].join("|");

/** The master a panel is built from, given what somebody chose: null is an empty panel. */
const chosen = (p: Panel, cands: Cand[] | undefined): Cand | null => {
    if (p.pick === "") return null;
    const list = cands || [];
    if (p.pick) return list.filter((c) => c.path === p.pick)[0] || null;
    return list.filter((c) => c.own)[0] || null;
};

interface Props {
    /** The campaign's masters folder, as Bespoke resolved it. */
    mastersPath: string;
    /** The campaign's creatives (its AE folders), so a panel's can be changed. */
    creatives: string[];
    onBack: () => void;
}

const BespokeGuided: React.FC<Props> = ({ mastersPath, creatives, onBack }) => {
    const [text, setText] = useState(() => { try { return localStorage.getItem(STORE) || ""; } catch { return ""; } });
    const [board, setBoard] = useState<Loaded | null>(null);
    const [panels, setPanels] = useState<Panel[]>([]);
    const [seconds, setSeconds] = useState(0);
    const [page, setPage] = useState("");
    const [focus, setFocus] = useState<number | null>(null);
    const [saveIt, setSaveIt] = useState(true);
    const [busy, setBusy] = useState("");
    const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
    const [report, setReport] = useState("");
    // A picture that would not draw is left out, not shown as a broken image.
    const [noPicture, setNoPicture] = useState<Record<string, true>>({});
    // The gap under the pointer: what a press on the sheet would make a panel.
    const [ghost, setGhost] = useState<Rect | null>(null);
    const boardRef = useRef<HTMLDivElement | null>(null);
    // A panel being dragged: where it is NOW, and the lines holding it. Kept
    // apart from `panels` until the mouse comes up, so a drag asks about a
    // master once, for where the panel ends, and not for every pixel on the way.
    const [live, setLive] = useState<{ id: number; rect: Rect; atX: number | null; atY: number | null } | null>(null);
    const dragged = useRef(false);
    // Which deliverable is on the page NOW, for a build that answers after
    // somebody has moved on to the next one.
    const showing = useRef("");
    showing.current = board ? board.csvPath : "";
    const nextId = useRef(1);
    // What the localiser's ranking answered, kept per creative|size|length so a
    // panel edited back to a size already asked about costs nothing.
    const asked = useRef<Record<string, Cand[] | "asking">>({});
    const [, setTick] = useState(0);

    const load = async (raw: string) => {
        let target = String(raw || "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
        if (!target) return;
        setBusy("Reading…");
        setNote(null);
        setReport("");
        try {
            let csvPath = "";
            if (/\.csv$/i.test(target)) {
                csvPath = target;
                target = nodePath.dirname(target);
            }
            const kids = await listDir(target);
            const folderName = nodePath.basename(target);
            if (!csvPath) {
                const csvs = kids.filter((k) => !k.dir && /\.csv$/i.test(k.name) && k.name.charAt(0) !== ".");
                // The CSV named as the folder is, else the only one in it.
                const named = csvs.filter((k) => k.name.replace(/\.csv$/i, "") === folderName)[0];
                const one = named || (csvs.length === 1 ? csvs[0] : null);
                if (!one) {
                    setNote({ text: csvs.length ? `${csvs.length} CSVs in ${folderName} and none named after it. Point at the one you mean.` : `No CSV in ${folderName || "that folder"}. Point at a deliverable's folder inside the mech's PNGs.`, bad: true });
                    return;
                }
                csvPath = one.path;
            }
            const stem = nodePath.basename(csvPath).replace(/\.csv$/i, "");
            // The folder is the deliverable; a CSV can carry a revision tail (`…_MY_v2.csv`).
            const name = sizeOfName(folderName) ? folderName : stem;
            const info = sizeOfName(name);
            if (!info) {
                setNote({ text: `${name} has no size in its name, so there is no canvas to build on.`, bad: true });
                return;
            }
            const csv = await readText(csvPath);
            if (csv === null) {
                setNote({ text: `Couldn't read ${nodePath.basename(csvPath)}.`, bad: true });
                return;
            }
            const read = boardFromRows(parseBespokeCsv(csv), info.w, info.h);
            const pages = read.pages.length ? read.pages : ["Page1"];
            // The mech's picture of each page: `<name>.jpg`, then `<name>2.jpg`…
            const pictures: Record<string, string> = {};
            pages.forEach((pg, i) => {
                const want = (name + (i === 0 ? "" : String(i + 1))).toLowerCase();
                const hit = kids.filter((k) => !k.dir && /\.(jpe?g|png)$/i.test(k.name) && k.name.replace(/\.[A-Za-z]+$/, "").toLowerCase() === want)
                    .sort((a, b) => (/\.jpe?g$/i.test(a.name) ? 0 : 1) - (/\.jpe?g$/i.test(b.name) ? 0 : 1))[0];
                if (hit) pictures[pg] = hit.path;
            });
            // The rest of the batch, so the next deliverable is one press away.
            const around = (await listDir(nodePath.dirname(target))).filter((k) => k.dir && k.name.charAt(0) !== "_" && k.name.charAt(0) !== ".");
            const inside = await Promise.all(around.map((k) => listDir(k.path)));
            const siblings = around.filter((k, i) => inside[i].some((f) => !f.dir && /\.csv$/i.test(f.name) && f.name.charAt(0) !== "."))
                .map((k) => ({ name: k.name, path: k.path }));
            const where = whereItFiles(csvPath);
            let built = false;
            if (where) {
                const ae = await listDir(nodePath.join(where.marketsRoot, where.territory, "AE", where.batch));
                built = ae.some((k) => !k.dir && k.name.toLowerCase() === (name + "_V01.aep").toLowerCase());
            }
            const fallback = creativeOfName(name);
            nextId.current = 1;
            setPanels(read.panels.map((p) => ({
                id: nextId.current++, page: p.page, creative: p.creative || fallback, family: p.family, masks: p.masks, extras: p.extras,
                x: p.box.x, y: p.box.y, w: p.box.w, h: p.box.h,
            })));
            setBoard({ csvPath, folder: target, name, canvasW: info.w, canvasH: info.h, pages, titles: read.titles, pictures, siblings, where, built });
            setSeconds(info.seconds || 0);
            // Open on the page that has panels: a title-only first page shows nothing to check.
            setPage((read.panels[0] && read.panels[0].page) || pages[0]);
            setFocus(null);
            setSaveIt(!built);
            setText(target);
            try { localStorage.setItem(STORE, target); } catch { /* a convenience only */ }
        } finally {
            setBusy("");
        }
    };

    const browse = async () => {
        let picked = "";
        try { picked = ((await evalTS("bespokeSelectCsv", board ? board.folder : "")) as unknown as string) || ""; } catch { picked = ""; }
        if (picked) await load(picked);
    };

    // Ask the localiser's ranking about every panel it has not been asked about.
    const wanted = panels.map((p) => candKey(p, seconds)).join("\n");
    useEffect(() => {
        if (!board || !mastersPath) return;
        let alive = true;
        (async () => {
            for (const p of panels) {
                const key = candKey(p, seconds);
                if (asked.current[key] || !(p.w > 0) || !(p.h > 0)) continue;
                asked.current[key] = "asking";
                let res: any = null;
                try { res = await evalTS("csvLocaliserListMasters", mastersPath, p.creative, `${Math.round(p.w)}x${Math.round(p.h)}`, seconds ? `${seconds}sec` : ""); } catch { res = null; }
                const out: Cand[] = [];
                const fitOf = (n: string) => { const m = sizeOfName(n); return m ? closeness({ w: p.w, h: p.h }, m).label : ""; };
                if (res && res.success) {
                    const same = (res.candidates || []) as { name: string; path: string; creative: string; tier: number }[];
                    same.filter((c) => c.tier > 0).forEach((c) => out.push({ path: c.path, name: c.name, creative: c.creative, own: true, repeat: 1, fit: fitOf(c.name) }));
                    // The creative's own at a length that goes into the board 2 or 3 times: fewest passes first.
                    const others = ((res.otherDurations || []) as { name: string; path: string; creative: string; seconds: string }[])
                        .map((c) => ({ c, repeat: repeatFor(seconds, parseInt(c.seconds, 10) || 0) }))
                        .filter((x) => x.repeat > 1)
                        .sort((a, b) => a.repeat - b.repeat);
                    others.forEach(({ c, repeat }) => out.push({ path: c.path, name: c.name, creative: c.creative, own: true, repeat, fit: fitOf(c.name) }));
                    same.filter((c) => !(c.tier > 0)).forEach((c) => out.push({ path: c.path, name: c.name, creative: c.creative, own: false, repeat: 1, fit: fitOf(c.name) }));
                }
                asked.current[key] = out;
                if (!alive) return;
                setTick((t) => t + 1);
            }
        })();
        return () => { alive = false; };
    }, [wanted, mastersPath, board && board.csvPath]);

    const candsOf = (p: Panel): Cand[] | undefined => {
        const a = asked.current[candKey(p, seconds)];
        return a && a !== "asking" ? a : undefined;
    };

    const patch = (id: number, change: Partial<Panel>) => setPanels((prev) => prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...change };
        // A panel reshaped by hand is no longer the windows the CSV drew, and a
        // master picked for the old shape may not be offered for the new one.
        if (change.w !== undefined || change.h !== undefined || change.x !== undefined || change.y !== undefined) next.masks = [];
        if ((change.w !== undefined || change.h !== undefined) && p.pick) next.pick = undefined;
        // Typed or dragged, a panel stays on the board.
        // A size typed too big stops at the edge and leaves the panel where it
        // is; a position typed too far stops there and leaves its size.
        if (board) {
            next.x = Math.max(0, Math.min(board.canvasW - 1, next.x));
            next.y = Math.max(0, Math.min(board.canvasH - 1, next.y));
            if (change.w !== undefined && change.x === undefined) next.w = Math.min(next.w, board.canvasW - next.x);
            if (change.h !== undefined && change.y === undefined) next.h = Math.min(next.h, board.canvasH - next.y);
            next.w = Math.max(1, Math.min(board.canvasW, next.w));
            next.h = Math.max(1, Math.min(board.canvasH, next.h));
            next.x = Math.min(next.x, board.canvasW - next.w);
            next.y = Math.min(next.y, board.canvasH - next.h);
        }
        return next;
    }));

    const addPanel = () => {
        if (!board) return;
        const id = nextId.current++;
        setPanels((prev) => prev.concat([{ id, page, creative: creativeOfName(board.name), family: "", masks: [], extras: [], x: 0, y: 0, w: board.canvasW, h: board.canvasH }]));
        setFocus(id);
    };

    /** One of a panel's run-on windows becomes a panel of its own, after it in the list. */
    const promote = (from: Panel, e: Rect) => {
        const id = nextId.current++;
        setPanels((prev) => {
            const out: Panel[] = [];
            prev.forEach((p) => {
                if (p.id !== from.id) { out.push(p); return; }
                out.push({ ...p, extras: p.extras.filter((x) => x !== e) });
                out.push({ id, page: p.page, creative: p.creative, family: p.family, masks: [e], extras: [], x: e.x, y: e.y, w: e.w, h: e.h });
            });
            return out;
        });
        setFocus(id);
    };

    const onPage = useMemo(() => panels.filter((p) => p.page === page), [panels, page]);

    /** The gap a point on the sheet sits in, in the board's own pixels. Mouse events: CEP on macOS. */
    const gapUnder = (e: React.MouseEvent): Rect | null => {
        const el = boardRef.current;
        if (!el || !board) return null;
        const r = el.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return null;
        const px = ((e.clientX - r.left) / r.width) * board.canvasW;
        const py = ((e.clientY - r.top) / r.height) * board.canvasH;
        const lines: Rect[] = [];
        onPage.forEach((p) => p.extras.forEach((x) => lines.push(x)));
        return gapAt(px, py, onPage, lines, board.canvasW, board.canvasH);
    };

    /**
     * Drag a panel by its body (no sides) or by the sides named. Every other
     * panel's sides on the page, every run-on window's and the board's own are
     * the lines it can take; within eight screen pixels it does.
     */
    const startDrag = (e: React.MouseEvent, p: Panel, sides: Sides | null) => {
        const el = boardRef.current;
        if (!el || !board || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        setFocus(p.id);
        setGhost(null);
        const box = el.getBoundingClientRect();
        if (!(box.width > 0)) return;
        const perPx = board.canvasW / box.width;
        const xs = [0, board.canvasW];
        const ys = [0, board.canvasH];
        onPage.forEach((o) => {
            if (o.id !== p.id) { xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h); }
            o.extras.forEach((x) => { xs.push(x.x, x.x + x.w); ys.push(x.y, x.y + x.h); });
        });
        const from: Rect = { x: p.x, y: p.y, w: p.w, h: p.h };
        const sx = e.clientX;
        const sy = e.clientY;
        let last: Rect = from;
        const move = (ev: MouseEvent) => {
            const dx = (ev.clientX - sx) * perPx;
            const dy = (ev.clientY - sy) * perPx;
            if (!dragged.current && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
            dragged.current = true;
            const s = sides ? snapResize(from, sides, dx, dy, xs, ys, 8 * perPx, board.canvasW, board.canvasH) : snapMove(from, dx, dy, xs, ys, 8 * perPx, board.canvasW, board.canvasH);
            last = s.rect;
            setLive({ id: p.id, rect: s.rect, atX: s.atX, atY: s.atY });
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            setLive(null);
            if (dragged.current && (last.x !== from.x || last.y !== from.y || last.w !== from.w || last.h !== from.h)) patch(p.id, last);
            // The click that follows a drag must not be read as a press on a gap.
            setTimeout(() => { dragged.current = false; }, 0);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    /** A panel in a gap. The title sitting in it says whose; no title, and it starts empty. */
    const fillGap = (gap: Rect) => {
        if (!board) return;
        const whose = creativeIn(gap, board.titles, page);
        const id = nextId.current++;
        setPanels((prev) => prev.concat([{
            id, page, creative: whose || creativeOfName(board.name), family: "", masks: [], extras: [],
            x: gap.x, y: gap.y, w: gap.w, h: gap.h, pick: whose ? undefined : "",
        }]));
        setFocus(id);
        setGhost(null);
    };

    const copyPanel = (p: Panel) => {
        if (!board) return;
        const spot = copySpot(p, panels.filter((x) => x.page === p.page && x.id !== p.id), board.canvasW);
        if (!spot) { setNote({ text: `No room beside panel ${panels.indexOf(p) + 1} for a copy its size. Add a panel and type where it goes.`, bad: true }); return; }
        const id = nextId.current++;
        setPanels((prev) => {
            const out: Panel[] = [];
            prev.forEach((x) => { out.push(x); if (x.id === p.id) out.push({ ...p, id, masks: [], extras: [], x: spot.x, y: spot.y }); });
            return out;
        });
        setFocus(id);
        setNote(null);
    };

    const filled = panels.filter((p) => !!chosen(p, candsOf(p))).length;
    const waiting = panels.some((p) => !candsOf(p));

    const build = async () => {
        if (!board) return;
        setBusy("Building…");
        setNote(null);
        setReport("");
        try {
            const filing = saveIt && board.where && !board.built ? board.where : null;
            const plan = {
                canvasWidth: board.canvasW,
                canvasHeight: board.canvasH,
                seconds,
                name: board.name,
                marketsRoot: filing ? filing.marketsRoot : "",
                territory: filing ? filing.territory : "",
                batch: filing ? filing.batch : "",
                useLocalised: false,
                scalePanels: true,
                regions: panels.map((p, i) => {
                    const c = chosen(p, candsOf(p));
                    return { path: c ? c.path : "", x: p.x, y: p.y, w: p.w, h: p.h, rotation: 0, label: c ? undefined : `PANEL ${i + 1}`, repeat: c ? c.repeat : 1 };
                }),
                refPath: board.pictures[page] || board.pictures[board.pages[0]] || "",
                // Each panel's comp gets its own piece of the mech sheet, in
                // Difference, to line the master up against.
                refInPanels: true,
                guidesX: [],
                guidesY: [],
            };
            const res = (await evalTS("bespokeBuildRegions", JSON.stringify(plan))) as unknown as
                { success: boolean; error?: string; report?: string; saved?: boolean; savedTo?: string } | undefined;
            if (!res) { setNote({ text: "No answer from After Effects. Open this panel inside After Effects to build.", bad: true }); return; }
            // A BUILD CAN ANSWER AFTER THE PAGE HAS MOVED ON to the next
            // deliverable. Its answer is still said, under its own name, but its
            // report is not laid over a board it does not describe.
            const here = showing.current === board.csvPath;
            const whose = here ? "" : board.name + ": ";
            if (!res.success) { setNote({ text: whose + (res.error || "The build failed."), bad: true }); return; }
            if (here) setReport(res.report || "");
            setNote({ text: whose + (res.saved ? `Built and saved to ${(res.savedTo || "").split("/").slice(-3).join("/")}` : "Built, and left open in After Effects. Not saved.") });
            // Only if this board is still the one on the page: the build takes a
            // while, and another deliverable may have been opened meanwhile.
            if (res.saved) setBoard((now) => (now && now.csvPath === board.csvPath ? { ...now, built: true } : now));
        } catch {
            setNote({ text: "No answer from After Effects. Open this panel inside After Effects to build.", bad: true });
        } finally {
            setBusy("");
        }
    };

    const pct = (v: number, of: number) => (of > 0 ? (v / of) * 100 : 0) + "%";
    const rectStyle = (r: Rect) => board ? { left: pct(r.x, board.canvasW), top: pct(r.y, board.canvasH), width: pct(r.w, board.canvasW), height: pct(r.h, board.canvasH) } : {};
    // Sums are welcome (`2817+2430`, `7680/3`); a panel never leaves the board or turns inside out.
    const numField = (p: Panel, key: "x" | "y" | "w" | "h", label: string) => (
        <label className="bsg-num">
            <span>{label}</span>
            <NumField
                className="bsp-input"
                ariaLabel={`${label} of panel ${panels.indexOf(p) + 1}`}
                value={live && live.id === p.id ? live.rect[key] : p[key]}
                onFocus={() => setFocus(p.id)}
                onCommit={(v) => patch(p.id, { [key]: Math.max(key === "w" || key === "h" ? 1 : 0, Math.round(v)) } as Partial<Panel>)}
            />
        </label>
    );

    return (
        <div className="bsg">
            <div className="bsg-top">
                <button className="bsp-btn bsp-btn--ghost" onClick={onBack}><ArrowLeft size={12} /> Back</button>
                <input
                    className="bsp-input bsg-path"
                    type="text"
                    spellCheck={false}
                    value={text}
                    placeholder="Paste a deliverable's folder from the mech's PNGs, or its CSV"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void load(text); }}
                />
                <button className="bsp-btn" onClick={() => void load(text)} disabled={!!busy || !text.trim()}>Read</button>
                <button className="bsp-btn bsp-btn--ghost" onClick={() => void browse()} disabled={!!busy}><FolderOpen size={12} /> Browse…</button>
            </div>

            {!hasNode && <p className="bsg-note is-bad">Open this panel inside After Effects: the CSV is read from disk.</p>}
            {hasNode && !mastersPath && <p className="bsg-note is-bad">No masters folder is set, so no master can be proposed. Go back and pick the campaign.</p>}
            {note && <p className={"bsg-note" + (note.bad ? " is-bad" : "")}>{note.text}</p>}

            {!board && !note && hasNode && (
                <div className="bsg-empty">
                    <b>The board is read from the mech's CSV.</b>
                    <span>Every deliverable's folder in the mech's PNGs holds one beside its sheet. Point at the folder: the canvas, the panels and a master for each are proposed, and you correct what's wrong.</span>
                </div>
            )}

            {board && (
                <>
                    {board.siblings.length > 1 && (
                        <div className="bsg-siblings">
                            {board.siblings.map((s) => (
                                <button key={s.path} className={"bsg-sib" + (s.path === board.folder ? " is-on" : "")} onClick={() => { if (s.path !== board.folder) void load(s.path); }} title={s.name}>
                                    {(sizeOfName(s.name) ? s.name.replace(/^.*?_(?:DOOH|DINTH|FOH|DFOH)_/, "") : s.name)}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="bsg-head">
                        <strong title={board.name}>{board.name}</strong>
                        <span>{board.canvasW}×{board.canvasH}</span>
                        <label className="bsg-num bsg-num--secs">
                            <input className="bsp-input" type="text" value={seconds ? String(seconds) : ""} onChange={(e) => setSeconds(parseInt(e.target.value.replace(/[^0-9]/g, ""), 10) || 0)} />
                            <span>seconds</span>
                        </label>
                        {board.pages.length > 1 && (
                            <span className="bsg-pages">
                                {board.pages.map((pg) => (
                                    <button key={pg} className={"bsg-sib" + (pg === page ? " is-on" : "")} onClick={() => setPage(pg)}>
                                        {pg}<em>{panels.filter((p) => p.page === pg).length}</em>
                                    </button>
                                ))}
                            </span>
                        )}
                    </div>

                    {/* The mech's own sheet, with what was read off its CSV drawn on
                        it: check it against the picture, change the numbers below. */}
                    <div className="bsg-stage" style={{ maxWidth: Math.max(120, Math.round((STAGE_MAX_H * board.canvasW) / board.canvasH)) }}>
                        <div
                            className={"bsg-board" + (ghost ? " has-ghost" : "")}
                            ref={boardRef}
                            style={{ paddingBottom: (board.canvasH / board.canvasW) * 100 + "%" }}
                            onMouseMove={(e) => {
                                if (live) return;
                                const g = gapUnder(e);
                                if ((g && ghost && g.x === ghost.x && g.y === ghost.y && g.w === ghost.w && g.h === ghost.h) || (!g && !ghost)) return;
                                setGhost(g);
                            }}
                            onMouseLeave={() => setGhost(null)}
                            onClick={(e) => { if (dragged.current) return; const g = gapUnder(e); if (g) fillGap(g); }}
                        >
                            {board.pictures[page] && !noPicture[board.pictures[page]] && (
                                <img src={toFileUrl(board.pictures[page])} alt="" draggable={false} onError={() => setNoPicture((prev) => ({ ...prev, [board.pictures[page]]: true }))} />
                            )}
                            {board.titles.filter((t) => t.page === page).map((t, i) => (
                                <span key={"t" + i} className="bsg-title" style={rectStyle(t.box)} title={`Title: ${t.name}`} />
                            ))}
                            {live && live.atX !== null && <span className="bsg-snap bsg-snap--x" style={{ left: pct(live.atX, board.canvasW) }} />}
                            {live && live.atY !== null && <span className="bsg-snap bsg-snap--y" style={{ top: pct(live.atY, board.canvasH) }} />}
                            {ghost && (
                                <span className="bsg-ghost" style={rectStyle(ghost)}>
                                    <i><Plus size={11} /> {ghost.w}×{ghost.h}</i>
                                </span>
                            )}
                            {onPage.map((p) => {
                                const n = panels.indexOf(p);
                                const hue = HUES[n % HUES.length];
                                return (
                                    <React.Fragment key={p.id}>
                                        {p.masks.map((m, i) => <span key={i} className="bsg-window" style={{ ...rectStyle(m), background: hue }} />)}
                                        {p.extras.map((m, i) => <span key={"e" + i} className="bsg-extra" style={{ ...rectStyle(m), borderColor: hue }} />)}
                                        <span
                                            className={"bsg-panel" + (focus === p.id ? " is-on" : "") + (live && live.id === p.id ? " is-dragging" : "")}
                                            style={{ ...rectStyle(live && live.id === p.id ? live.rect : p), borderColor: hue, color: hue }}
                                            onMouseDown={(e) => startDrag(e, p, null)}
                                        >
                                            <b style={{ background: hue }}>{n + 1}</b>
                                            {live && live.id === p.id && <em>{live.rect.w}×{live.rect.h} at {live.rect.x}, {live.rect.y}</em>}
                                            {HANDLES.map((h) => (
                                                <i key={h.k} className={"bsg-handle bsg-handle--" + h.k} onMouseDown={(e) => startDrag(e, p, h.sides)} />
                                            ))}
                                        </span>
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </div>
                    <p className="bsg-hint">
                        Press an empty part of the sheet to make that gap a panel. Drag a panel to move it, its edges to size it: sides catch on each other. The number fields take sums.
                        {!board.pictures[page] ? ` No picture of ${page} in the folder, so the panels are drawn on an empty board.` : ""}
                    </p>

                    {panels.length === 0 && (
                        <p className="bsg-note">
                            This CSV places no artwork{board.titles.length ? ", only titles" : ""}, so there is nothing to size a panel from. Add one and type where it sits.
                        </p>
                    )}

                    <div className="bsg-rows">
                        {panels.map((p, n) => {
                            const cands = candsOf(p);
                            const c = chosen(p, cands);
                            const options = (cands || []).map((x) => ({
                                value: x.path,
                                label: masterLabel(x.name) + (x.own ? "" : ` · ${x.creative}`),
                                hint: [x.fit, x.repeat > 1 ? `×${x.repeat}` : ""].filter(Boolean).join(" · "),
                            })).concat([{ value: "", label: "Leave it empty", hint: "an empty comp to build later" }]);
                            return (
                                <div key={p.id} className={"bsg-row" + (focus === p.id ? " is-on" : "")} onMouseDown={() => { setFocus(p.id); if (p.page !== page) setPage(p.page); }}>
                                    <span className="bsg-row-n" style={{ background: HUES[n % HUES.length] }}>{n + 1}</span>
                                    <div className="bsg-row-main">
                                        <div className="bsg-row-what">
                                            {creatives.length > 1 ? (
                                                <Dropdown
                                                    className="bsg-creative"
                                                    value={creatives.filter((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "") === p.creative.toUpperCase().replace(/[^A-Z0-9]/g, ""))[0] || p.creative}
                                                    onChange={(v) => patch(p.id, { creative: v, pick: undefined })}
                                                    options={(creatives.indexOf(p.creative) === -1 && !creatives.some((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "") === p.creative.toUpperCase().replace(/[^A-Z0-9]/g, "")) && p.creative ? [p.creative] : []).concat(creatives).map((c) => ({ value: c, label: c }))}
                                                />
                                            ) : (
                                                <b>{p.creative || "No creative"}</b>
                                            )}
                                            <span>{(live && live.id === p.id ? live.rect : p).w}×{(live && live.id === p.id ? live.rect : p).h}{board.pages.length > 1 ? ` · ${p.page}` : ""}</span>
                                            {p.family ? <em title={p.family}>{p.family}</em> : <em>added by hand</em>}
                                        </div>
                                        <Dropdown
                                            className="bsg-pick"
                                            panelClassName="bsg-pick-panel"
                                            value={c ? c.path : p.pick === "" ? "" : "__none__"}
                                            onChange={(v) => patch(p.id, { pick: v })}
                                            options={options}
                                            placeholder={!cands ? "Finding a master…" : `No ${p.creative || "creative's"} master at this length. Pick one, or leave it empty.`}
                                            emptyMessage="No masters at this length."
                                        />
                                        {c && (
                                            <span className="bsg-row-fit" title={c.name}>
                                                {c.name.replace(/\.aep$/i, "")} · {c.fit}{c.fit && !/^(Exact|Same)/.test(c.fit) ? ", cropped to the panel" : ""}{c.repeat > 1 ? ` · played ${c.repeat}× to fill ${seconds}s` : ""}{p.pick ? " · picked" : ""}
                                            </span>
                                        )}
                                        {p.extras.map((e, i) => (
                                            <span key={i} className="bsg-row-extra">
                                                Its artwork also runs on at {e.x}, {e.y} · {e.w}×{e.h}, which isn't built.
                                                <button type="button" className="bsg-link" onClick={() => promote(p, e)}>Make it a panel</button>
                                            </span>
                                        ))}
                                    </div>
                                    <div className="bsg-row-nums">
                                        {numField(p, "x", "X")}
                                        {numField(p, "y", "Y")}
                                        {numField(p, "w", "W")}
                                        {numField(p, "h", "H")}
                                    </div>
                                    <Tooltip text="Copy it into the next gap along (against the far side, mirrored)">
                                        <button className="bsp-btn bsp-btn--ghost bsp-btn--icon" aria-label={`Copy panel ${n + 1}`} onClick={() => copyPanel(p)}><CopyPlus size={12} /></button>
                                    </Tooltip>
                                    <button className="bsp-btn bsp-btn--ghost bsp-btn--icon bsp-btn--danger" aria-label={`Remove panel ${n + 1}`} onClick={() => setPanels((prev) => prev.filter((x) => x.id !== p.id))}><X size={12} /></button>
                                </div>
                            );
                        })}
                    </div>

                    <div className="bsg-foot">
                        <button className="bsp-btn bsp-btn--ghost" onClick={addPanel}><Plus size={12} /> Add a panel</button>
                        <span className="bsg-foot-sum">
                            {panels.length} panel{panels.length === 1 ? "" : "s"}
                            {panels.length ? ` · ${filled} with a master` : ""}
                            {panels.length - filled > 0 && !waiting ? ` · ${panels.length - filled} left empty` : ""}
                        </span>
                        <button className="bsp-btn bsg-build" onClick={() => void build()} disabled={!!busy || !panels.length || !(seconds > 0) || waiting}>
                            <Hammer size={13} /> {busy === "Building…" ? "Building…" : "Build it"}
                        </button>
                    </div>

                    <div className="bsg-filing">
                        {board.where ? (
                            board.built ? (
                                <span>{board.name}_V01.aep is already in {board.where.territory}/AE/{board.where.batch}, so this build is left open and not saved over it.</span>
                            ) : (
                                <CheckboxToggle checked={saveIt} onChange={setSaveIt} label={`Save it to ${board.where.territory}/AE/${board.where.batch}`} />
                            )
                        ) : (
                            <span>This CSV isn't under a territory's PNGs folder, so the build is left open and not saved.</span>
                        )}
                        <span className="bsg-hint">It builds into the project open in After Effects{saveIt && board.where && !board.built ? ", and saves that project under the deliverable's name" : ""}. Titles in the CSV are drawn dashed and not built: a master carries its own. The mech sheet goes on the board and inside each panel's comp as a Difference guide layer, to line things up against; guide layers never render.{mastersPath ? ` Masters from ${nodePath.basename(mastersPath)}.` : ""}</span>
                    </div>

                    {report && <pre className="bsg-report">{report}</pre>}
                </>
            )}
        </div>
    );
};

export default BespokeGuided;
