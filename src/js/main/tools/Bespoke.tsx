// =============================================================================
// src/js/main/tools/Bespoke.tsx
// -----------------------------------------------------------------------------
// BESPOKE -- deliverables that aren't one master.
//
// Named for where it is going, not for what it does first. Every other localise
// path answers "which single master fits this row"; the ones that land here are
// the rows where that question has no answer. MultipleArt is the first, and the
// section is deliberately general so the next kind doesn't need a rename -- a
// tool id can't be changed once it ships without orphaning whatever is saved
// under it.
//
// THE MODEL, and it is the whole design: a row is a list of SEGMENTS played in
// order, and each segment is a list of masters laid ACROSS the canvas. That one
// shape covers tiling (one segment, several masters), sequencing (several
// segments, one master each) and the real case -- three portrait panels filling
// a 3240x1920 METROBUS, then a different creative as an endcard, which is both
// at once.
//
// A normal single-master row is one segment holding one master, which is
// today's behaviour expressed in the new shape rather than a special case.
//
// ASSEMBLY INTO AE IS NOT WIRED YET, on purpose. How masters are placed --
// scaled to their panel, or laid in at native size with the canvas built around
// them -- decides whether a size mismatch is a harmless scale or a soft
// deliverable, and that is a studio decision rather than a coding one. The
// composition is designed, checked and saved here; building it is the next
// step. Shipping a Build button that guessed would be worse than not having one.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, ChevronRight, Copy, Globe2, Layers, LayoutGrid, Library, Plus, RectangleHorizontal, RectangleVertical, RefreshCw, Square as SquareIcon, Trash2, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import Dropdown from "../Dropdown";
import CheckboxToggle from "../CheckboxToggle";
import LoadingChatter from "../LoadingChatter";
import "../shared.scss";
import "./Bespoke.scss";

/** Mirrors aeft/localise.ts's BespokeMaster. */
interface BespokeMaster {
    path: string;
    name: string;
    creative: string;
    artwork: string;
    site: string;
    size: string;
    width: number;
    height: number;
    duration: string;
    territory: string;
    film: string;
    region: string;
    orientation: string;
}

interface Campaign { name: string; marketsRoot: string; reachable?: boolean }

/** OV Library's four, same order and same icons, so the two read alike. */
type OrientationKey = "LANDSCAPE" | "PORTRAIT" | "SQUARE" | "QUAD";
const ORIENTATION_ORDER: OrientationKey[] = ["LANDSCAPE", "PORTRAIT", "SQUARE", "QUAD"];
const ORIENTATION_ICON: Record<OrientationKey, React.ComponentType<{ size?: number }>> = {
    LANDSCAPE: RectangleHorizontal,
    PORTRAIT: RectangleVertical,
    SQUARE: SquareIcon,
    QUAD: LayoutGrid,
};

/**
 * One master in the picker.
 *
 * The list used to be full-width rows of "PortalToParadise", twenty of them,
 * with the size — the only thing that actually differed — set small at the far
 * right. The shape IS the information here, so the card leads with a proxy
 * drawn at the master's true ratio: a 5760x1440 strip and a 1080x1920 portrait
 * are told apart at a glance, before reading a single number.
 *
 * The proxy is sized in JS rather than CSS because aspect-ratio is Chrome 88
 * and this builds for chrome74 — and the padding-box trick can't express
 * "fit inside a square box either way round" without a wrapper per case.
 */
const MasterCard: React.FC<{ master: BespokeMaster; swapping: boolean; used: number; onPick: () => void }> = ({
    master, swapping, used, onPick,
}) => {
    const BOX = 38;
    const aspect = master.width && master.height ? master.width / master.height : 1;
    const pw = aspect >= 1 ? BOX : Math.max(4, BOX * aspect);
    const ph = aspect >= 1 ? Math.max(4, BOX / aspect) : BOX;
    const tint = hueFor(master.creative || master.name);
    return (
        <button
            className={"bsp-master" + (swapping ? " is-swap" : "") + (used > 0 ? " is-used" : "")}
            onClick={onPick}
            title={master.name}
        >
            <span className="bsp-master-proxy">
                <span style={{ width: `${pw}px`, height: `${ph}px`, background: tint }} />
                {/* ALREADY ON THE CANVAS. Twenty near-identical cards and no
                    memory of which have been placed is how a region gets added
                    twice, or a master gets missed entirely on a board with
                    eight of them. */}
                {used > 0 && <span className="bsp-master-used">{used > 1 ? `×${used}` : "✓"}</span>}
            </span>
            <span className="bsp-master-size">{master.size || "?"}</span>
            <span className="bsp-master-meta">
                <span className="bsp-master-name">{master.creative || master.name}</span>
                <span className="bsp-master-dur">{master.duration ? `${master.duration}s` : "?"}</span>
            </span>
        </button>
    );
};

/** Below this a region collapses and can never be grabbed again. */
const MIN_REGION = 24;

interface Region {
    id: number;
    master: BespokeMaster;
    x: number;
    y: number;
    w: number;
    h: number;
    /**
     * Quarter turns only -- 0, 90, 180, 270. Bespoke screens are sometimes fed
     * a master turned on its side, and the studio only ever does right angles,
     * so this stays an enumeration rather than a free angle: anything else
     * would leave the region no longer axis-aligned with its own crop.
     */
    rotation: number;
}

interface Segment {
    id: number;
    /** Laid across the canvas, left to right. */
    tiles: BespokeMaster[];
    seconds: number;
}

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

/** Colour per creative, so the same artwork reads the same across the frame. */
const TILE_HUES = ["#2f6f63", "#4a5f8a", "#7a5a86", "#8a6440", "#3f6b7a", "#6f7a3f"];
function hueFor(creative: string): string {
    let n = 0;
    for (let i = 0; i < creative.length; i++) n = (n * 31 + creative.charCodeAt(i)) >>> 0;
    return TILE_HUES[n % TILE_HUES.length];
}

const MAX_MATCHES = 40;
let nextSegId = 1;



export const BespokeTool = () => {
    const reduced = useReducedMotion();

    const [mastersPath, setMastersPath] = useState("");
    const [masters, setMasters] = useState<BespokeMaster[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [report, setReport] = useState<string | null>(null);
    const [building, setBuilding] = useState(false);

    // The deliverable being composed. Canvas and runtime come from the row this
    // is being built for; typed by hand until the row picker is wired.
    const [canvasW, setCanvasW] = useState("3240");
    const [canvasH, setCanvasH] = useState("1920");
    const [runtime, setRuntime] = useState("10");

    // WHERE IT LANDS. Same three answers Build a Batch asks for, and the same
    // convention underneath: <marketsRoot>/<territory>/AE/<batch>.
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [campaign, setCampaign] = useState("");
    const [territories, setTerritories] = useState<string[]>([]);
    const [territory, setTerritory] = useState("");
    const [batch, setBatch] = useState("Batch_1");
    // The media site, same field Build a Batch offers. Blank is legitimate and
    // produces a name with no site token at all.
    const [site, setSite] = useState("");
    const [siteTouched, setSiteTouched] = useState(false);
    // Shared by default: most of the time every panel of a master is the same
    // creative, so editing it once should show up everywhere. Duplicating is
    // the opt-in, for when panels genuinely need to differ.
    const [duplicatePanels, setDuplicatePanels] = useState(false);

    // TWO MODES. Multi Art is the equal-panel tiling that ships today; Bespoke
    // places a master anywhere on the canvas, traced over the deliverable's own
    // reference JPG. They share everything except the placement.
    // UNSET until chosen. Which kind of build this is gets decided once per
    // deliverable and never revisited, so it is a question asked at the door
    // rather than a switch sat permanently above the work.
    const [mode, setMode] = useState<"multi" | "regions" | null>(null);
    const [regions, setRegions] = useState<Region[]>([]);
    const [selRegion, setSelRegion] = useState(0);
    const [refPath, setRefPath] = useState("");
    // EVERY REFERENCE IN THE PICKED FOLDER, because one job is many bespoke
    // deliverables and they sit side by side. Each has its OWN canvas and its
    // own regions -- a 3840x2816 board and a 13536x3072 ceiling share nothing
    // but the campaign -- so the layouts are kept per reference path and
    // restored on the way back, rather than carried across and quietly wrong.
    const [refs, setRefs] = useState<{ path: string; name: string }[]>([]);
    // Which region is waiting for a replacement master, or -1. Swapping keeps
    // the region's coordinates, so a placement traced by eye is not lost just
    // because the master in it turned out to be the wrong length.
    const [swapTarget, setSwapTarget] = useState(-1);
    // Which ruler is selected, so it can be typed rather than dragged. Dragging
    // is fine for roughing a line in and useless for landing it on 2380.
    const [selGuide, setSelGuide] = useState<{ axis: "x" | "y"; i: number } | null>(null);
    const [destOpen, setDestOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [layouts, setLayouts] = useState<Record<string, { regions: Region[]; guidesX: number[]; guidesY: number[] }>>({});
    // Constraints while dragging a corner. Ratio keeps a region from ever
    // introducing a crop it did not have; locking a side is for the common case
    // of a panel that must stay the full height or width of the screen.
    const [refMismatch, setRefMismatch] = useState("");
    // Rulers. Region edges snap to these while dragging, which is how you sit a
    // master exactly between two lines rather than nearly between them.
    const [guidesX, setGuidesX] = useState<number[]>([]);
    const [guidesY, setGuidesY] = useState<number[]>([]);
    const [lockRatio, setLockRatio] = useState(true);
    const stageRef = React.useRef<HTMLDivElement>(null);
    const dragRef = React.useRef<{ handle: string; sx: number; sy: number; box: DOMRect; start: Region } | null>(null);
    // The folder is a country NAME ("Germany"); the filename wants its code.
    // Resolved by the host's own getTerritoryCountryCode rather than guessed
    // here -- a wrong code on a deliverable is the bug that shipped BELGIUM
    // GERMAN, and there is no reason to have two answers to one question.
    const [territoryCode, setTerritoryCode] = useState("");
    const [outName, setOutName] = useState("");
    const [nameTouched, setNameTouched] = useState(false);

    const [segments, setSegments] = useState<Segment[]>([{ id: 0, tiles: [], seconds: 10 }]);
    const [current, setCurrent] = useState(0);

    // FILTERS, in OV Library's shape: pick a creative, then narrow by
    // orientation. A flat search box over 200 filenames was the thing that made
    // this feel unlike the rest of the app -- you had to already know the name.
    const [creative, setCreative] = useState("");
    const [orients, setOrients] = useState<Record<OrientationKey, boolean>>({
        LANDSCAPE: false, PORTRAIT: false, SQUARE: false, QUAD: false,
    });
    const [durFilter, setDurFilter] = useState("");

    // --- masters -----------------------------------------------------------
    const load = useCallback(async (root: string) => {
        if (!root) return;
        setLoading(true);
        setStatus(null);
        try {
            const res = (await evalTS("bespokeListMasters", root)) as unknown as
                { success: boolean; error?: string; masters?: BespokeMaster[] } | undefined;
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) {
                setStatus({ text: res.error || "Couldn't read the masters folder.", type: "error" });
                // An unreadable folder must not wipe a list already on screen --
                // "couldn't ask" and "there are none" are different answers.
                return;
            }
            setMasters(res.masters || []);
            if (!res.masters || res.masters.length === 0) {
                setStatus({ text: "No masters found in that folder.", type: "error" });
            }
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const saved = await evalTS("csvLocaliserLoadLastPath");
                if (typeof saved === "string" && saved) {
                    setMastersPath(saved);
                    load(saved);
                }
            } catch {
                /* no bridge -- the folder button still works */
            }
        })();
    }, [load]);

    // Campaigns, then that campaign's territories -- the same two host calls
    // the localiser makes, so the two always offer the same list.
    useEffect(() => {
        (async () => {
            try {
                const camps = (await evalTS("loadLocLibCampaigns")) as unknown as Campaign[] | undefined;
                if (camps && camps.length) {
                    setCampaigns(camps);
                    const last = await evalTS("csvLocaliserLoadLastCampaign");
                    const pick = typeof last === "string" && last
                        && camps.some((c) => c.name === last) ? last : camps[0].name;
                    setCampaign(pick);
                }
            } catch {
                /* no bridge -- the composer still works, it just can't file it */
            }
        })();
    }, []);

    const marketsRoot = useMemo(
        () => campaigns.find((c) => c.name === campaign)?.marketsRoot || "",
        [campaigns, campaign]
    );

    useEffect(() => {
        if (!marketsRoot) { setTerritories([]); return; }
        (async () => {
            try {
                const terrs = (await evalTS("scanTerritories", marketsRoot)) as unknown as string[] | undefined;
                setTerritories(terrs || []);
                // An unreachable share is a normal state, not an error -- leave
                // whatever was chosen rather than clearing it.
                if (terrs && terrs.length && !terrs.some((t) => t === territory)) setTerritory("");
            } catch {
                setTerritories([]);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [marketsRoot]);

    useEffect(() => {
        if (!territory) { setTerritoryCode(""); return; }
        (async () => {
            try {
                const code = await evalTS("getTerritoryCountryCode", territory);
                setTerritoryCode(typeof code === "string" ? code : "");
            } catch {
                setTerritoryCode("");
            }
        })();
    }, [territory]);

    const pickFolder = async () => {
        try {
            const picked = await evalTS("selectCsvLocaliserAepFolder");
            if (typeof picked === "string" && picked) {
                setMastersPath(picked);
                load(picked);
            }
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        }
    };

    /**
     * Switches to a reference, banking the layout on the way out.
     *
     * THE REFERENCE IS NAMED AFTER THE DELIVERABLE, so it carries the canvas,
     * the runtime and the name -- typing them again from the same string is
     * three chances to get one wrong. Both naming conventions, per the masters
     * rule: size with or without "px", duration as "s" or "sec".
     */
    const adoptReference = (path: string) => {
        if (!path || path === refPath) return;
        // Bank what is on screen FIRST. Rotating away and back is meant to be
        // free; losing an hour of placement to a misclick is not.
        if (refPath) {
            setLayouts((prev) => ({ ...prev, [refPath]: { regions, guidesX, guidesY } }));
        }
        setRefPath(path);
        setRefMismatch("");
        const stem = (path.split("/").pop() || "").replace(/\.(jpe?g|png)$/i, "");
        const size = stem.match(/(\d+)x(\d+)(?:px)?/);
        if (size) { setCanvasW(size[1]); setCanvasH(size[2]); }
        const dur = stem.match(/_(\d+)s(?:ec)?(?:_|$)/);
        if (dur) setRuntime(dur[1]);
        if (!nameTouched && stem) setOutName(stem);
        const kept = layouts[path];
        setRegions(kept ? kept.regions : []);
        setGuidesX(kept ? kept.guidesX : []);
        setGuidesY(kept ? kept.guidesY : []);
        setSelRegion(0);
    };

    /** Where the current reference sits in the folder, or -1 if it is alone. */
    const refIndex = refs.findIndex((r) => r.path === refPath);

    const pickReference = async () => {
        try {
            const picked = await evalTS("bespokeSelectReference");
            if (typeof picked === "string" && picked) {
                adoptReference(picked);
                // Picking one file is really picking the folder -- pull its
                // siblings in so the rest of the job needs no more dialogs.
                try {
                    const listed = await evalTS("bespokeListReferences", picked);
                    if (listed && listed.success && listed.refs && listed.refs.length > 0) {
                        setRefs(listed.refs);
                    } else {
                        setRefs([{ path: picked, name: picked.split("/").pop() || picked }]);
                    }
                } catch {
                    setRefs([{ path: picked, name: picked.split("/").pop() || picked }]);
                }
            }
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        }
    };

    const addRegion = (m: BespokeMaster) => {
        const cw = Number(canvasW) || 1920;
        const ch = Number(canvasH) || 1080;
        // AT THE MASTER'S OWN RATIO, so it starts uncropped. It used to arrive
        // as a half-canvas rectangle at whatever shape that happened to be,
        // which meant reaching for "Match master ratio" every single time.
        // Sized to fit inside half the canvas, never scaled up past it.
        const aspect = m.width && m.height ? m.width / m.height : 1;
        let w = Math.round(cw * 0.5);
        let h = Math.round(w / aspect);
        if (h > ch * 0.8) { h = Math.round(ch * 0.8); w = Math.round(h * aspect); }
        setRegions((prev) => [...prev, {
            id: nextSegId++, master: m, rotation: 0,
            x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2),
            w: Math.max(24, w), h: Math.max(24, h),
        }]);
        setSelRegion(regions.length);
    };

    /**
     * A short, unambiguous name for a master: its creative and its native size.
     * Falls back through the filename stem so it is never blank, and never the
     * full path, which does not fit in a region and tells you nothing new.
     */
    const regionLabel = (m: BespokeMaster) => {
        const stem = (m.name || "").replace(/\.aep$/i, "");
        let who = m.creative || "";
        if (!who) {
            // The orientation token and size are noise here; the creative is
            // the third underscore field in the studio convention.
            const bits = stem.split("_");
            who = bits.length > 2 ? bits[2] : stem;
        }
        const size = m.width && m.height ? `${m.width}×${m.height}` : "";
        return size ? `${who} · ${size}` : who;
    };

    /**
     * Seconds a master runs past the board, or 0.
     *
     * The runtime comes from the reference filename, so a 15s master in a 10s
     * board is a real mismatch and not a rounding artefact. AE happily lets the
     * layer outlive the comp -- it simply renders the first 10s and drops the
     * rest, which on these deliverables is the endcard, the logo and the legal.
     * Nothing anywhere said so, which is the actual defect: the build looked
     * like it worked.
     */
    const overrunOf = (m: BespokeMaster) => {
        const have = Number(m.duration);
        const want = Number(runtime);
        if (!have || !want || have <= want) return 0;
        return Math.round((have - want) * 10) / 10;
    };

    const overrunRegions = regions
        .map((r, i) => ({ i, r, over: overrunOf(r.master) }))
        .filter((x) => x.over > 0);

    /**
     * Puts a different master into a region, KEEPING ITS COORDINATES.
     *
     * The position is the expensive part -- it was traced against the
     * reference by hand -- and it is independent of which master fills it.
     * The ratio may now differ, so the crop is recomputed and shown, but
     * nothing moves.
     */
    const swapRegion = (m: BespokeMaster) => {
        if (swapTarget < 0) return;
        const at = swapTarget;
        setRegions((prev) => prev.map((r, i) => (i === at ? { ...r, master: m } : r)));
        setSelRegion(at);
        setSwapTarget(-1);
        setStatus(null);
    };

    /**
     * The master's dimensions AS THE CANVAS SEES THEM.
     *
     * A quarter turn swaps them, and everything downstream -- the aspect a new
     * region takes, Match master ratio, the cover scale and the crop
     * percentage -- has to reason about the turned footprint, not the file's
     * own. Getting this wrong does not error; it silently crops the wrong axis.
     */
    const facing = (r: { master: BespokeMaster; rotation: number }) => {
        const turned = r.rotation === 90 || r.rotation === 270;
        return {
            w: turned ? r.master.height : r.master.width,
            h: turned ? r.master.width : r.master.height,
        };
    };

    /**
     * A guide off the board is a line you can snap to but never see, and it
     * drags region edges to coordinates the build cannot honour. Same rule as
     * the regions themselves: the reference IS the extent of the work.
     *
     * Used by BOTH the numeric field and the drag, so the mouse cannot reach
     * anywhere the keyboard is refused. It previously fell back to 1920/1080
     * when the canvas fields were mid-edit, which would pin a guide to the
     * wrong span on a 3840-wide board the moment someone cleared the box to
     * retype it; an unparsable canvas now leaves the value alone instead.
     */
    const clampGuide = (axis: "x" | "y", value: number) => {
        const span = axis === "x" ? Number(canvasW) : Number(canvasH);
        if (!span || span <= 0) return Math.round(value);
        return Math.max(0, Math.min(span, Math.round(value)));
    };

    /** Moves a guide to an exact pixel, held inside the canvas. */
    const setGuideAt = (axis: "x" | "y", i: number, value: number) => {
        const at = clampGuide(axis, value);
        if (axis === "x") setGuidesX((g) => g.map((v, n) => (n === i ? at : v)));
        else setGuidesY((g) => g.map((v, n) => (n === i ? at : v)));
    };

    /** Nearest guide within reach, or the value untouched. */
    const snapTo = (v: number, guides: number[], span: number) => {
        const reach = Math.max(6, span * 0.01);
        let best = v;
        let dist = reach;
        for (const g of guides) {
            const d = Math.abs(g - v);
            if (d <= dist) { dist = d; best = g; }
        }
        return best;
    };

    /**
     * The only way a region ever changes, so it is the only place the board
     * edge has to be enforced: dragging, the corner handles, the x/y/w/h
     * fields, Fit to guides, Match master ratio, align and rotate all come
     * through here. Clamping at the choke point means no path can put a
     * region somewhere the build cannot honour.
     *
     * A region outside the board is not a layout, it is a mistake -- the
     * canvas IS the deliverable, so anything past its edge renders as
     * nothing. Stuck to a corner now means stuck.
     *
     * NOT clamped while the canvas fields are mid-edit. Clearing the width
     * box to retype it would otherwise fall back to a default and quietly
     * crush every region to fit a board size nobody asked for.
     */
    const patchRegion = (i: number, patch: Partial<Region>) =>
        setRegions((prev) => prev.map((r, n) => {
            if (n !== i) return r;
            const merged = { ...r, ...patch };
            const cw = Number(canvasW);
            const ch = Number(canvasH);
            if (!cw || !ch || cw <= 0 || ch <= 0) return merged;
            // Size first: a region can be no larger than the board, and never
            // so small it cannot be grabbed again.
            const w = Math.max(MIN_REGION, Math.min(merged.w, cw));
            const h = Math.max(MIN_REGION, Math.min(merged.h, ch));
            // Then position, against the size that survived.
            return {
                ...merged,
                w, h,
                x: Math.max(0, Math.min(merged.x, cw - w)),
                y: Math.max(0, Math.min(merged.y, ch - h)),
            };
        }));

    // Mouse events, not pointer: the macOS AE CEP host does not dispatch
    // Pointer Events reliably, which is this codebase's standing rule for
    // anything beyond a plain click.
    useEffect(() => {
        if (mode !== "regions") return;
        const move = (e: MouseEvent) => {
            const d = dragRef.current;
            if (!d) return;
            const cw = Number(canvasW) || 1920;
            const ch = Number(canvasH) || 1080;
            const dx = ((e.clientX - d.sx) / d.box.width) * cw;
            const dy = ((e.clientY - d.sy) / d.box.height) * ch;
            const s0 = d.start;
            if (d.handle.indexOf("guide") === 0) {
                const bits = d.handle.split(":");
                const i = Number(bits[1]);
                // Through the same clamp the field uses -- dragging must not
                // reach where typing is refused.
                if (bits[0] === "guideX") {
                    const at = clampGuide("x", d.start.x + dx);
                    setGuidesX((g) => g.map((v, n) => (n === i ? at : v)));
                } else {
                    const at = clampGuide("y", d.start.y + dy);
                    setGuidesY((g) => g.map((v, n) => (n === i ? at : v)));
                }
            } else if (d.handle === "move") {
                // Both edges are offered to the ruler, so a region can land
                // flush against a line from either side.
                const rawX = Math.round(s0.x + dx);
                const rawY = Math.round(s0.y + dy);
                const sx = snapTo(rawX, guidesX, cw);
                const sx2 = snapTo(rawX + s0.w, guidesX, cw) - s0.w;
                const sy = snapTo(rawY, guidesY, ch);
                const sy2 = snapTo(rawY + s0.h, guidesY, ch) - s0.h;
                patchRegion(selRegion, {
                    x: Math.abs(sx - rawX) <= Math.abs(sx2 - rawX) ? sx : sx2,
                    y: Math.abs(sy - rawY) <= Math.abs(sy2 - rawY) ? sy : sy2,
                });
            } else {
                const west = d.handle.indexOf("w") !== -1;
                const north = d.handle.indexOf("n") !== -1;
                // The moving EDGE snaps, not the size -- that is what lets a
                // height sit exactly between two horizontal guides.
                // The edge is held inside the board before anything is derived
                // from it. patchRegion clamps as a backstop, but doing it here
                // too keeps w/h honest: an unclamped edge dragged past 0 makes
                // a width larger than the canvas, which then gets clamped and
                // detaches the box from the cursor.
                const edgeX = Math.max(0, Math.min(cw,
                    snapTo(west ? Math.round(s0.x + dx) : Math.round(s0.x + s0.w + dx), guidesX, cw)));
                const edgeY = Math.max(0, Math.min(ch,
                    snapTo(north ? Math.round(s0.y + dy) : Math.round(s0.y + s0.h + dy), guidesY, ch)));
                const nx = west ? edgeX : s0.x;
                const ny = north ? edgeY : s0.y;
                let nw = west ? s0.x + s0.w - edgeX : edgeX - s0.x;
                let nh = north ? s0.y + s0.h - edgeY : edgeY - s0.y;

                // A locked side simply does not move; ratio drives the other
                // axis from the one being dragged, using the region's CURRENT
                // shape so a lock preserves what you already have rather than
                // snapping it to the master's.
                if (lockRatio) {
                    const aspect = s0.w / Math.max(1, s0.h);
                    if (Math.abs(nw - s0.w) >= Math.abs(nh - s0.h)) nh = Math.round(nw / aspect);
                    else nw = Math.round(nh * aspect);
                }

                // Below this a region collapses and can never be grabbed again.
                const fw = Math.max(MIN_REGION, nw);
                const fh = Math.max(MIN_REGION, nh);
                patchRegion(selRegion, {
                    // A west/north handle moves the origin by however much the
                    // size actually changed, not by the raw pointer delta --
                    // otherwise a constrained drag detaches from the cursor.
                    x: west ? Math.round(s0.x + (s0.w - fw)) : nx,
                    y: north ? Math.round(s0.y + (s0.h - fh)) : ny,
                    w: fw, h: fh,
                });
            }
        };
        const up = () => { dragRef.current = null; };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
    }, [mode, selRegion, canvasW, canvasH, lockRatio, guidesX, guidesY]);

    /** Snaps a region to one of the canvas's nine anchor points. */
    const alignRegion = (hx: 0 | 0.5 | 1, vy: 0 | 0.5 | 1) => {
        const r = regions[selRegion];
        if (!r) return;
        const cw = Number(canvasW) || 1920;
        const ch = Number(canvasH) || 1080;
        patchRegion(selRegion, {
            x: Math.round((cw - r.w) * hx),
            y: Math.round((ch - r.h) * vy),
        });
    };

    /** Same master, same size, nudged clear so it can be grabbed. */
    const duplicateRegion = () => {
        const r = regions[selRegion];
        if (!r) return;
        const cw = Number(canvasW) || 1920;
        const ch = Number(canvasH) || 1080;
        const step = Math.round(Math.min(cw, ch) * 0.03);
        setRegions((prev) => [...prev, {
            ...r, id: nextSegId++,
            x: Math.min(r.x + step, Math.max(0, cw - r.w)),
            y: Math.min(r.y + step, Math.max(0, ch - r.h)),
        }]);
        setSelRegion(regions.length);
    };

    /**
     * The bounds either side of a point on one axis, or null.
     *
     * THE BOARD'S OWN EDGES COUNT AS GUIDES. Regions are already clamped to
     * the reference, so its edges are real boundaries and not merely where the
     * picture stops -- one horizontal and one vertical guide divide the board
     * into four usable cells, and it took two more guides laid along the top
     * and left to say what the edges already said.
     *
     * They only count once there is at least one REAL guide on the axis: with
     * none, the answer is "this axis has nothing to say", not "fill the whole
     * board", which would turn Fit to guides into a maximise button.
     *
     * Shared by Fit to guides and the on-canvas highlight, so what is drawn is
     * literally the rectangle the button produces rather than a second guess
     * at it -- two implementations of "which pair" would eventually disagree,
     * and that would surface as the button doing something other than what you
     * were looking at.
     */
    const bracketGuides = (guides: number[], centre: number, span: number) => {
        if (guides.length === 0) return null;
        if (!span || span <= 0) return null;
        let lo = 0;
        let hi = span;
        for (const g of guides) {
            if (g <= centre && g > lo) lo = g;
            if (g >= centre && g < hi) hi = g;
        }
        if (hi - lo < MIN_REGION) return null;
        return { lo, hi };
    };

    /**
     * The cell the selected region would land in, or null.
     *
     * Exactly what fitToGuides will do: an axis with no bracketing pair keeps
     * the region's current position and size on that axis, so the highlight
     * shows the real outcome including the parts that will not move.
     */
    const guideCell = () => {
        const r = regions[selRegion];
        if (!r) return null;
        if (guidesX.length === 0 && guidesY.length === 0) return null;
        const v = bracketGuides(guidesY, r.y + r.h / 2, Number(canvasH));
        const h = bracketGuides(guidesX, r.x + r.w / 2, Number(canvasW));
        if (!v && !h) return null;
        return {
            x: h ? h.lo : r.x,
            w: h ? h.hi - h.lo : r.w,
            y: v ? v.lo : r.y,
            h: v ? v.hi - v.lo : r.h,
        };
    };

    /**
     * Sizes the region to span the guides that BRACKET it, per axis.
     *
     * Dragging an edge onto a line was the only way to use a guide, which meant
     * doing it twice per axis and reaching a hairline each time. This takes the
     * nearest line either side of the region's own centre, so which pair it
     * means is whichever pair it is already sitting between.
     *
     * Each axis is independent: two horizontal lines and no vertical ones sets
     * the height and leaves the width alone.
     */
    const fitToGuides = () => {
        const r = regions[selRegion];
        if (!r) return;
        const v = bracketGuides(guidesY, r.y + r.h / 2, Number(canvasH));
        const h = bracketGuides(guidesX, r.x + r.w / 2, Number(canvasW));
        if (!v && !h) {
            setStatus({ text: "Add a guide first — a region fits between two guides, or between a guide and the edge of the board.", type: "error" });
            return;
        }
        setStatus(null);
        patchRegion(selRegion, {
            ...(h ? { x: h.lo, w: h.hi - h.lo } : {}),
            ...(v ? { y: v.lo, h: v.hi - v.lo } : {}),
        });
    };

    /** Reshapes the region to its master's native ratio, so nothing is cropped. */
    const matchMasterRatio = () => {
        const r = regions[selRegion];
        if (!r || !r.master.width || !r.master.height) return;
        const face = facing(r);
        const aspect = face.w / face.h;
        // Keeps the region's area roughly as it was rather than jumping to the
        // master's pixel size, which on a 13536px master would fill the screen.
        const area = r.w * r.h;
        const w = Math.round(Math.sqrt(area * aspect));
        patchRegion(selRegion, { w, h: Math.round(w / aspect) });
    };

    /** Assembles the region layout and, when a country is set, files it. */
    const runBuildRegions = async () => {
        setBuilding(true);
        setReport(null);
        setStatus(null);
        try {
            const plan = {
                canvasWidth: Number(canvasW) || 0,
                canvasHeight: Number(canvasH) || 0,
                seconds: Number(runtime) || 0,
                name: outName.trim(),
                marketsRoot, territory, batch: batch.trim(),
                regions: regions.map((r) => ({ path: r.master.path, x: r.x, y: r.y, w: r.w, h: r.h, rotation: r.rotation || 0 })),
                // The reference and the rulers travel with the plan so the
                // built comp opens looking like the panel it was traced in.
                // Arrays of scalars survive the bridge; the whole plan is
                // already a JSON string, which is the rule for anything nested.
                refPath: refPath,
                guidesX: guidesX,
                guidesY: guidesY,
            };
            const res = (await evalTS("bespokeBuildRegions", JSON.stringify(plan))) as unknown as
                { success: boolean; error?: string; report?: string; saved?: boolean; savedTo?: string } | undefined;
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) { setStatus({ text: res.error || "The build failed.", type: "error" }); return; }
            setReport(res.report || "(built)");
            setStatus({
                text: res.saved
                    ? `Built and saved to ${(res.savedTo || "").split("/").slice(-2).join("/")}`
                    : "Built — no country set, so it hasn't been filed.",
                type: "success",
            });
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBuilding(false);
        }
    };

    /** Assembles the whole composition and, when a country is set, files it. */
    const runBuild = async () => {
        setBuilding(true);
        setReport(null);
        setStatus(null);
        try {
            const plan = {
                canvasWidth: Number(canvasW) || 0,
                canvasHeight: Number(canvasH) || 0,
                name: outName.trim(),
                marketsRoot,
                territory,
                batch: batch.trim(),
                duplicatePanels,
                segments: segments.map((sg) => ({
                    seconds: sg.seconds,
                    tiles: sg.tiles.map((t) => ({ path: t.path })),
                })),
            };
            const res = (await evalTS("bespokeBuild", JSON.stringify(plan))) as unknown as
                { success: boolean; error?: string; report?: string; saved?: boolean; savedTo?: string } | undefined;
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) {
                setStatus({ text: res.error || "The build failed.", type: "error" });
                return;
            }
            setReport(res.report || "(built)");
            // What actually happened, from the host rather than inferred here --
            // a territory being set is not the same as the save succeeding.
            setStatus({
                text: res.saved
                    ? `Built and saved to ${(res.savedTo || "").split("/").slice(-2).join("/")}`
                    : "Built — no country set, so it hasn't been filed.",
                type: "success",
            });
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBuilding(false);
        }
    };

    // --- filters ------------------------------------------------------------
    /** Every creative on the shelf, with how many masters each has. */
    const creatives = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const m of masters || []) {
            const key = m.creative || m.name;
            counts[key] = (counts[key] || 0) + 1;
        }
        return Object.keys(counts).sort().map((name) => ({ name, count: counts[name] }));
    }, [masters]);

    // ONE CREATIVE IS ALWAYS SELECTED. A bespoke board is built from one
    // campaign's masters, so "All" only ever offered a mixed list nobody
    // wants -- 34 masters across six unrelated creatives, with the twenty
    // that matter buried in it. Removing the chip means the empty filter
    // state has to be filled, or the picker would open showing nothing.
    //
    // The busiest creative is the default: on a real masters folder that is
    // the campaign the job is for, and the long tail is other work that
    // happens to share the root.
    useEffect(() => {
        if (creative !== "") return;
        if (creatives.length === 0) return;
        let best = creatives[0];
        for (const c of creatives) if (c.count > best.count) best = c;
        setCreative(best.name);
    }, [creatives, creative]);

    /** Orientation counts WITHIN the chosen creative, so a pill that would
     *  return nothing reads as empty rather than looking available. */
    const orientCounts = useMemo(() => {
        const counts: Record<string, number> = { LANDSCAPE: 0, PORTRAIT: 0, SQUARE: 0, QUAD: 0 };
        for (const m of masters || []) {
            if (creative && (m.creative || m.name) !== creative) continue;
            if (counts[m.orientation] !== undefined) counts[m.orientation]++;
        }
        return counts;
    }, [masters, creative]);

    const durations = useMemo(() => {
        const out: string[] = [];
        for (const m of masters || []) {
            if (creative && (m.creative || m.name) !== creative) continue;
            if (m.duration && out.indexOf(m.duration) === -1) out.push(m.duration);
        }
        return out.sort((a, b) => Number(a) - Number(b));
    }, [masters, creative]);

    const anyOrient = ORIENTATION_ORDER.some((k) => orients[k]);

    const matches = useMemo(() => {
        const out: BespokeMaster[] = [];
        for (const m of masters || []) {
            if (creative && (m.creative || m.name) !== creative) continue;
            // No pill selected means no orientation filter, not "none of them".
            if (anyOrient && !orients[m.orientation as OrientationKey]) continue;
            if (durFilter && m.duration !== durFilter) continue;
            out.push(m);
            if (out.length >= MAX_MATCHES) break;
        }
        // Widest first, then longest: a tile picker is usually reaching for the
        // biggest thing that fits.
        return out.sort((a, b) => b.width - a.width || Number(b.duration) - Number(a.duration));
    }, [masters, creative, orients, anyOrient, durFilter]);

    // --- composition -------------------------------------------------------
    const seg = segments[Math.min(current, segments.length - 1)];

    /** The output name, composed the way every other deliverable name is. */
    const suggestedName = useMemo(() => {
        const first = segments[0]?.tiles[0];
        if (!first) return "";
        const code = territoryCode || first.territory || "OV";
        const siteToken = site.trim();
        const bits = [
            first.film || "",
            first.region || "INTL",
            "MultipleArt",
            first.artwork || "DOOH",
            siteToken,
            `${canvasW}x${canvasH}px`,
            `${Math.round(Number(runtime) || 0)}s`,
            code,
        ].filter((b) => b !== "");
        return bits.join("_");
    }, [segments, territoryCode, canvasW, canvasH, runtime, site]);

    // Prefilled from the first tile's own site, then left alone once touched --
    // the masters usually carry the right one already.
    useEffect(() => {
        const first = segments[0]?.tiles[0];
        if (!siteTouched && first && first.site) setSite(first.site);
    }, [segments, siteTouched]);

    useEffect(() => {
        if (!nameTouched) setOutName(suggestedName);
    }, [suggestedName, nameTouched]);
    const totalSecs = segments.reduce((n, s) => n + s.seconds, 0);
    const wantSecs = Number(runtime) || 0;
    const canvasWidth = Number(canvasW) || 0;
    const tileWidth = seg && seg.tiles.length ? Math.round(canvasWidth / seg.tiles.length) : 0;
    const naturalWidth = seg ? seg.tiles.reduce((n, m) => n + m.width, 0) : 0;

    const setSeg = (fn: (s: Segment) => Segment) =>
        setSegments((prev) => prev.map((s, i) => (i === current ? fn(s) : s)));

    const addTile = (m: BespokeMaster) => setSeg((s) => ({ ...s, tiles: [...s.tiles, m] }));
    const removeTile = (idx: number) => setSeg((s) => ({ ...s, tiles: s.tiles.filter((_, i) => i !== idx) }));

    const addSegment = () => {
        setSegments((prev) => [...prev, { id: nextSegId++, tiles: [], seconds: 2 }]);
        setCurrent(segments.length);
    };
    const removeSegment = () => {
        if (segments.length <= 1) return;
        setSegments((prev) => prev.filter((_, i) => i !== current));
        setCurrent((c) => Math.max(0, c - 1));
    };

    // BLOCKERS vs NOTES. Only a segment with nothing in it genuinely cannot be
    // built; everything else is a layout the artist may well have meant. Tiles
    // that do not fill the canvas are centred with space around them, which is
    // a legitimate composition rather than an error to refuse.
    const blockers: string[] = [];
    if (segments.some((s) => s.tiles.length === 0)) blockers.push("a segment has no creatives in it");

    const notes: string[] = [];
    if (wantSecs > 0 && Math.abs(totalSecs - wantSecs) > 0.001) {
        notes.push(`segments total ${totalSecs}s, the row asks for ${wantSecs}s`);
    }
    if (seg && seg.tiles.length > 0 && canvasWidth > 0 && naturalWidth !== canvasWidth) {
        notes.push(naturalWidth > canvasWidth
            ? `this segment is ${naturalWidth}px across a ${canvasWidth}px canvas — it will be scaled down to fit`
            : `this segment is ${naturalWidth}px across a ${canvasWidth}px canvas — it will be centred with space either side`);
    }

    return (
        <div className="form-tool bsp">
            {/* The masters folder belongs to the work, not to the question at the
                door -- picking a build type has nothing to do with which folder
                the masters came from. */}
            <div className="bsp-head" hidden={!mode}>
                <div className="bsp-head-text">
                    <p className="bsp-masters">{mastersPath || "No masters folder set"}</p>
                    <p className="bsp-count">
                        {loading
                            ? "Walking the masters folder — slow the first time, instant after"
                            : masters ? `${masters.length} masters` : "not loaded"}
                    </p>
                </div>
                <Tooltip text="Pick the AEP masters folder">
                    <button className="bsp-btn bsp-btn--ghost" onClick={pickFolder}>Folder</button>
                </Tooltip>
                <Tooltip text="Re-read the masters folder">
                    <button className="bsp-btn bsp-btn--icon" onClick={() => load(mastersPath)} disabled={loading || !mastersPath}>
                        <RefreshCw size={12} className={loading ? "spin" : ""} />
                    </button>
                </Tooltip>
            </div>

            {!mode && (
                <div className="bsp-choose">
                    <p className="bsp-choose-ask">What kind of build is this?</p>
                    <div className="bsp-choose-cards">
                        {/* Name and icon only. The team already knows which is
                            which, and two paragraphs at the door is reading
                            imposed on someone who has decided before arriving. */}
                        <button className="bsp-choose-card" onClick={() => setMode("multi")}>
                            <LayoutGrid size={30} />
                            <b>Multi Art</b>
                        </button>
                        <button className="bsp-choose-card" onClick={() => setMode("regions")}>
                            <Layers size={30} />
                            <b>Bespoke</b>
                        </button>
                    </div>
                </div>
            )}


            {/* --- where it lands ------------------------------------------ */}
            {/* COLLAPSED BY DEFAULT. Four fields that are set once per batch
                and then ignored were taking a quarter of the panel above the
                thing you actually work in. The summary line keeps the answer
                visible while closed, so nothing is hidden -- only folded. */}
            <button
                className={"bsp-fold" + (destOpen ? " is-on" : "")}
                onClick={() => setDestOpen((v) => !v)}
                hidden={!mode}
            >
                <ChevronRight size={11} className="bsp-fold-caret" />
                <span className="bsp-fold-label">Where it lands</span>
                <span className="bsp-fold-summary">
                    {territory
                        ? `${territory}${batch.trim() ? " · " + batch.trim() : ""}${site.trim() ? " · " + site.trim() : ""}`
                        : "no country chosen"}
                </span>
            </button>
            <div className="bsp-dest" hidden={!mode || !destOpen}>
                {/* The house Dropdown, the same one the localiser's campaign
                    picker uses. A native <select> renders its popup through the
                    OS, so no amount of CSS reaches the open list -- it arrived
                    as a white system menu in the middle of a black panel. */}
                <div className="bsp-field">
                    <span className="bsp-lbl">Campaign</span>
                    <Dropdown
                        icon={<Library size={13} />}
                        value={campaign}
                        onChange={setCampaign}
                        options={campaigns.map((c) => ({
                            value: c.name,
                            label: c.name,
                            // Only claimed when the check actually ran: an
                            // absent entry means "not asked", which must not
                            // render as "not mounted".
                            hint: c.reachable === false ? "not mounted" : undefined,
                        }))}
                        placeholder="Select a campaign…"
                        emptyMessage="No campaigns yet — add one in the localiser."
                    />
                </div>
                <div className="bsp-field">
                    <span className="bsp-lbl">Country</span>
                    <Dropdown
                        icon={<Globe2 size={13} />}
                        value={territory}
                        onChange={setTerritory}
                        options={[{ value: "", label: "Build it here, don't file it" }]
                            .concat(territories.map((t) => ({ value: t, label: t })))}
                        placeholder="Build it here, don't file it"
                        emptyMessage={marketsRoot ? "No territories in that campaign's markets folder." : "Pick a campaign first."}
                    />
                </div>
                <label className="bsp-field">
                    <span className="bsp-lbl">Batch</span>
                    <input className="bsp-input bsp-input--b" value={batch} onChange={(e) => setBatch(e.target.value)} />
                </label>
                <label className="bsp-field">
                    <span className="bsp-lbl">Site</span>
                    <input
                        className="bsp-input bsp-input--b"
                        value={site}
                        placeholder="METROBUS"
                        onChange={(e) => { setSite(e.target.value); setSiteTouched(true); }}
                    />
                </label>
            </div>

            <label className="bsp-field" hidden={!mode}>
                <span className="bsp-lbl">Deliverable name</span>
                <input
                    className="bsp-input"
                    value={outName}
                    placeholder="Add a master to compose a name"
                    onChange={(e) => { setOutName(e.target.value); setNameTouched(true); }}
                />
            </label>

            {/* The exact path, before anything is written. A batch that lands in
                the wrong market is a redelivery, and this is the one place it
                can be caught for free. */}
            <p className="bsp-path" hidden={!mode}>
                {territory && marketsRoot
                    ? `${marketsRoot}/${territory}/AE/${batch.trim() || "AE"}/${outName || "…"}_V01.aep`
                    : "No country chosen — it will be built and left unsaved."}
            </p>

            {/* CANVAS AND RUNTIME SIT WITH THE PANE THEY DESCRIBE, not at the
                top of the form. In Bespoke both are read straight off the
                reference filename, so asking for them before the reference has
                even been picked put the answer above the question -- there they
                live in the bar above the canvas instead, which is why this
                renders for Multi Art only. */}
            <div className="bsp-target" hidden={mode !== "multi"}>
                <label className="bsp-field">
                    <span className="bsp-lbl">Canvas</span>
                    <span className="bsp-size">
                        <input className="bsp-input bsp-input--n" value={canvasW} onChange={(e) => setCanvasW(e.target.value)} />
                        <span className="bsp-x">×</span>
                        <input className="bsp-input bsp-input--n" value={canvasH} onChange={(e) => setCanvasH(e.target.value)} />
                    </span>
                </label>
                <label className="bsp-field">
                    <span className="bsp-lbl">Runtime</span>
                    <span className="bsp-size">
                        <input className="bsp-input bsp-input--n" value={runtime} onChange={(e) => setRuntime(e.target.value)} />
                        <span className="bsp-x">s</span>
                    </span>
                </label>
            </div>

            {mode === "regions" && (
                <>
                    {/* ONE BAR. "Trace over the reference" as a heading said
                        nothing the file name below it did not, and each of the
                        reference, the canvas and the guides had its own row --
                        three bands of chrome above the thing being worked in.
                        They are one wrapping row now, ordered the way they are
                        used: pick the reference, confirm what it says the board
                        is, then lay lines on it. */}
                    <div className="bsp-bar">
                        {/* Once a reference is chosen the button stops being a
                            call to action and becomes a statement of fact, so
                            it changes colour and shortens to the stem -- the
                            full path is on hover. */}
                        <button
                            className={"bsp-reflink" + (refPath ? " is-set" : "")}
                            onClick={pickReference}
                            title={refPath || "Pick the reference JPG for this deliverable"}
                        >
                            {refPath
                                ? (refPath.split("/").pop() || "").replace(/\.(jpe?g|png)$/i, "")
                                : "Pick the reference JPG…"}
                        </button>
                        <span className="bsp-bar-sep" />
                        <span className="bsp-size">
                            <input className="bsp-input bsp-input--n" value={canvasW} onChange={(e) => setCanvasW(e.target.value)} title="Canvas width" />
                            <span className="bsp-x">×</span>
                            <input className="bsp-input bsp-input--n" value={canvasH} onChange={(e) => setCanvasH(e.target.value)} title="Canvas height" />
                        </span>
                        <span className="bsp-size">
                            <input className="bsp-input bsp-input--n" value={runtime} onChange={(e) => setRuntime(e.target.value)} title="Runtime in seconds" />
                            <span className="bsp-x">s</span>
                        </span>
                        <span className="bsp-bar-sep" />
                        <span className="bsp-bar-lbl">Guides</span>
                        <button className="bsp-btn bsp-btn--ghost" onClick={() => setGuidesY((g) => [...g, Math.round((Number(canvasH) || 1080) / 2)])}>
                            + Horizontal
                        </button>
                        <button className="bsp-btn bsp-btn--ghost" onClick={() => setGuidesX((g) => [...g, Math.round((Number(canvasW) || 1920) / 2)])}>
                            + Vertical
                        </button>
                        {(guidesX.length > 0 || guidesY.length > 0) && (
                            <button className="bsp-btn bsp-btn--ghost" onClick={() => { setGuidesX([]); setGuidesY([]); setSelGuide(null); }}>
                                Clear
                            </button>
                        )}
                    </div>
                    {refs.length > 1 && (
                        // THE WHOLE FOLDER, because a job is many deliverables.
                        // Each keeps its own regions, so stepping through them
                        // is free -- the dot marks the ones already laid out.
                        <div className="bsp-refbar">
                            <button
                                className="bsp-refstep"
                                disabled={refIndex <= 0}
                                onClick={() => adoptReference(refs[refIndex - 1].path)}
                                title="Previous reference"
                            >‹</button>
                            <select
                                className="bsp-refpick"
                                value={refPath}
                                onChange={(e) => adoptReference(e.target.value)}
                            >
                                {refs.map((r) => (
                                    <option key={r.path} value={r.path}>
                                        {(layouts[r.path] && layouts[r.path].regions.length > 0) || (r.path === refPath && regions.length > 0) ? "● " : "○ "}
                                        {r.name}
                                    </option>
                                ))}
                            </select>
                            <button
                                className="bsp-refstep"
                                disabled={refIndex < 0 || refIndex >= refs.length - 1}
                                onClick={() => adoptReference(refs[refIndex + 1].path)}
                                title="Next reference"
                            >›</button>
                            <span className="bsp-refcount">
                                {refIndex >= 0 ? refIndex + 1 : "–"} / {refs.length}
                            </span>
                        </div>
                    )}
                    <div
                        className="bsp-canvas"
                        ref={stageRef}
                        style={{ paddingBottom: `${((Number(canvasH) || 1080) / (Number(canvasW) || 1920)) * 100}%` }}
                    >
                        {/* file:// because the panel is itself a file:// page --
                            CEP has no server to fetch a local image through. */}
                        {refPath && (
                            <img
                                className="bsp-canvas-ref"
                                src={`file://${refPath}`}
                                alt=""
                                // The FILENAME is the deliverable's spec, so it
                                // wins; the image is checked against it rather
                                // than trusted. A reference exported at the
                                // wrong size would otherwise silently become
                                // the thing everything is traced over.
                                //
                                // ONLY THE ASPECT MATTERS, NOT THE PIXELS. These
                                // JPGs come out of the PDF at whatever the export
                                // felt like -- 8000x5867 for a 3840x2816 board is
                                // normal -- and the backdrop is stretched to the
                                // stage while every region coordinate is computed
                                // from the NAMED canvas size. A uniform rescale
                                // therefore cannot move anything by a pixel.
                                // Comparing dimensions flagged every one of those
                                // as broken, which trains people to ignore the
                                // one case that is genuinely wrong: a different
                                // SHAPE, where the image really is skewed against
                                // the canvas and tracing off it lands wide.
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    const cw = Number(canvasW) || 0;
                                    const ch = Number(canvasH) || 0;
                                    if (!cw || !ch || !img.naturalWidth || !img.naturalHeight) {
                                        setRefMismatch("");
                                        return;
                                    }
                                    const refAspect = img.naturalWidth / img.naturalHeight;
                                    const canAspect = cw / ch;
                                    // 0.5% covers rounding in the export; a real
                                    // wrong-shape reference is out by far more.
                                    const skew = Math.abs(refAspect - canAspect) / canAspect;
                                    setRefMismatch(
                                        skew > 0.005
                                            ? `Reference is ${img.naturalWidth}×${img.naturalHeight} (${refAspect.toFixed(2)}:1) but the name says ${cw}×${ch} (${canAspect.toFixed(2)}:1) — different shape, so tracing over it will be off.`
                                            : ""
                                    );
                                }}
                                onError={() => setRefMismatch("Couldn't load that reference image.")}
                            />
                        )}
                        {(() => {
                            // THE AREA A REGION WOULD SNAP INTO, drawn before
                            // the regions so it reads as ground rather than as
                            // another box on top of them. Nothing interactive:
                            // it is a preview of Fit to guides, computed by the
                            // same bracket the button uses.
                            const cell = guideCell();
                            if (!cell) return null;
                            const cw = Number(canvasW) || 1920;
                            const ch = Number(canvasH) || 1080;
                            return (
                                <span
                                    className="bsp-cell"
                                    style={{
                                        left: `${(cell.x / cw) * 100}%`,
                                        top: `${(cell.y / ch) * 100}%`,
                                        width: `${(cell.w / cw) * 100}%`,
                                        height: `${(cell.h / ch) * 100}%`,
                                    }}
                                />
                            );
                        })()}
                        {regions.map((r, i) => {
                            const cw = Number(canvasW) || 1920;
                            const ch = Number(canvasH) || 1080;
                            const face = facing(r);
                            const cover = Math.max(r.w / face.w, r.h / face.h);
                            const lost = Math.round((1 - Math.min(r.w / (face.w * cover), r.h / (face.h * cover))) * 100);
                            return (
                                <div
                                    key={r.id}
                                    className={"bsp-region" + (i === selRegion ? " is-on" : "")}
                                    style={{
                                        left: `${(r.x / cw) * 100}%`, top: `${(r.y / ch) * 100}%`,
                                        width: `${(r.w / cw) * 100}%`, height: `${(r.h / ch) * 100}%`,
                                        background: hueFor(r.master.creative || r.master.name),
                                    }}
                                    onMouseDown={(e) => {
                                        const box = stageRef.current?.getBoundingClientRect();
                                        if (!box) return;
                                        setSelRegion(i);
                                        const handle = (e.target as HTMLElement).getAttribute("data-h") || "move";
                                        dragRef.current = { handle, sx: e.clientX, sy: e.clientY, box, start: r };
                                        e.preventDefault();
                                    }}
                                >
                                    {/* A MASTER IS AN .aep WITH NO THUMBNAIL, so
                                        there is no artwork in here to turn --
                                        the region is a flat colour block and a
                                        rotated block looks identical. These two
                                        marks are what a quarter turn can
                                        visibly move: the dashed outline is the
                                        master's WHOLE footprint at the cover
                                        scale, so it flips portrait to landscape
                                        and shows exactly what is spilling out
                                        of the region; the solid bar is the
                                        master's own top edge, which walks round
                                        the sides as it turns. */}
                                    {i === selRegion && (
                                    <span
                                        className="bsp-region-extent"
                                        style={{
                                            width: `${(face.w * cover / r.w) * 100}%`,
                                            height: `${(face.h * cover / r.h) * 100}%`,
                                            left: `${(1 - (face.w * cover / r.w)) * 50}%`,
                                            top: `${(1 - (face.h * cover / r.h)) * 50}%`,
                                        }}
                                    />
                                    )}
                                    <span className={`bsp-region-top bsp-region-top--${r.rotation || 0}`} />
                                    {/* WHICH WAY IS UP, stated outright. On a
                                        SQUARE master a quarter turn changes no
                                        geometry at all -- same footprint, same
                                        crop, identical extent box -- so the
                                        edge bar was the only cue, and it sat in
                                        the guides' own colour. An arrow that
                                        turns with the master is unambiguous
                                        whatever its shape. */}
                                    {r.rotation ? (
                                        <span
                                            className="bsp-region-up"
                                            style={{ transform: `rotate(${r.rotation}deg)` }}
                                        >
                                            ↑
                                        </span>
                                    ) : null}
                                    <span className="bsp-region-tag" title={r.master.name}>
                                        {/* WHICH MASTER THIS IS, not just its
                                            campaign. Two regions of the same
                                            creative at different sizes were
                                            indistinguishable, and the creative
                                            is empty often enough that this fell
                                            back to the whole filename. */}
                                        {regionLabel(r.master)}
                                        {lost > 0 ? ` · ${lost}% cropped` : ""}
                                        {overrunOf(r.master) > 0 ? ` · ${r.master.duration}s in ${runtime}s` : ""}
                                        {r.rotation ? ` · ${r.rotation}°` : ""}
                                    </span>
                                    {i === selRegion && ["nw", "ne", "sw", "se"].map((h) => (
                                        <span className={`bsp-h bsp-h--${h}`} data-h={h} key={h} />
                                    ))}
                                </div>
                            );
                        })}
                        {guidesY.map((g, i) => (
                            <span
                                key={"gy" + i}
                                className={"bsp-guide bsp-guide--h" + (selGuide?.axis === "y" && selGuide.i === i ? " is-on" : "")}
                                style={{ top: `${(g / (Number(canvasH) || 1080)) * 100}%` }}
                                onMouseDown={(e) => {
                                    const box = stageRef.current?.getBoundingClientRect();
                                    if (!box) return;
                                    setSelGuide({ axis: "y", i });
                                    dragRef.current = { handle: `guideY:${i}`, sx: e.clientX, sy: e.clientY, box, start: { id: 0, master: regions[0]?.master as BespokeMaster, rotation: 0, x: 0, y: g, w: 0, h: 0 } };
                                    e.preventDefault();
                                }}
                                onDoubleClick={() => setGuidesY((gs) => gs.filter((_, n) => n !== i))}
                                title={`y ${g} — drag to move, double-click to remove`}
                            />
                        ))}
                        {guidesX.map((g, i) => (
                            <span
                                key={"gx" + i}
                                className={"bsp-guide bsp-guide--v" + (selGuide?.axis === "x" && selGuide.i === i ? " is-on" : "")}
                                style={{ left: `${(g / (Number(canvasW) || 1920)) * 100}%` }}
                                onMouseDown={(e) => {
                                    const box = stageRef.current?.getBoundingClientRect();
                                    if (!box) return;
                                    setSelGuide({ axis: "x", i });
                                    dragRef.current = { handle: `guideX:${i}`, sx: e.clientX, sy: e.clientY, box, start: { id: 0, master: regions[0]?.master as BespokeMaster, rotation: 0, x: g, y: 0, w: 0, h: 0 } };
                                    e.preventDefault();
                                }}
                                onDoubleClick={() => setGuidesX((gs) => gs.filter((_, n) => n !== i))}
                                title={`x ${g} — drag to move, double-click to remove`}
                            />
                        ))}
                        {regions.length === 0 && (
                            <span className="bsp-canvas-empty">Pick a master below to drop the first region in.</span>
                        )}
                    </div>

                    {/* What is LEFT of the old guides row: the buttons moved
                        into the bar above, so this appears only when there is
                        something to say about a guide you have selected. */}
                    <div className="bsp-guidebar">
                        {selGuide && (
                            // TYPED, NOT DRAGGED. Dragging roughs a line in;
                            // landing it on an exact pixel from a brief is what
                            // it is actually for, and no amount of snapping
                            // makes a mouse hit 2380 on a 2816px canvas.
                            <span className="bsp-guidenum">
                                <label>
                                    {selGuide.axis === "y" ? "Horizontal at y" : "Vertical at x"}
                                    <input
                                        type="number"
                                        value={String(selGuide.axis === "y" ? guidesY[selGuide.i] : guidesX[selGuide.i])}
                                        onChange={(e) => setGuideAt(selGuide.axis, selGuide.i, Number(e.target.value))}
                                    />
                                </label>
                                <span className="bsp-guidenum-max">
                                    of {selGuide.axis === "y" ? canvasH : canvasW}
                                </span>
                                <button
                                    className="bsp-swaplink"
                                    onClick={() => {
                                        if (selGuide.axis === "y") setGuidesY((g) => g.filter((_, n) => n !== selGuide.i));
                                        else setGuidesX((g) => g.filter((_, n) => n !== selGuide.i));
                                        setSelGuide(null);
                                    }}
                                >
                                    remove
                                </button>
                            </span>
                        )}
                        <span className="bsp-guidehint">
                            {selGuide
                                ? "drag to place · double-click to remove"
                                : "add a guide, then select a master and Fit to guides"}
                        </span>
                    </div>

                    {(refMismatch !== "" || overrunRegions.length > 0) && (
                        <ul className="bsp-problems">
                            {refMismatch !== "" && <li><AlertCircle size={10} /> {refMismatch}</li>}
                            {/* SAID OUT LOUD, BEFORE THE BUILD. AE renders the
                                first N seconds of an over-long layer without
                                complaint, so the only thing standing between a
                                dropped endcard and a delivered file is this
                                line. Both ways out are offered rather than one
                                being chosen silently. */}
                            {overrunRegions.map(({ i, r, over }) => (
                                <li key={r.id}>
                                    <AlertCircle size={10} />
                                    <span>
                                        R{i + 1} {regionLabel(r.master)} is {r.master.duration}s in a {runtime}s board —
                                        its last {over}s won't render.
                                    </span>
                                    <button
                                        className="bsp-swaplink"
                                        onClick={() => { setSwapTarget(i); setSelRegion(i); }}
                                    >
                                        swap the master
                                    </button>
                                    <span className="bsp-problems-or">or keep it and it plays from the start</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {swapTarget >= 0 && (
                        <p className="bsp-swapbar">
                            Pick a master below to drop into R{swapTarget + 1}. Its position and size stay put.
                            <button className="bsp-swaplink" onClick={() => setSwapTarget(-1)}>cancel</button>
                        </p>
                    )}

                    {regions[selRegion] && (
                        <div className="bsp-segctl">
                            <span className="bsp-lbl">Region {selRegion + 1}</span>
                            {(["x", "y", "w", "h"] as const).map((k) => (
                                <input
                                    key={k}
                                    className="bsp-input bsp-input--n"
                                    value={String(regions[selRegion][k])}
                                    onChange={(e) => patchRegion(selRegion, { [k]: Math.round(Number(e.target.value) || 0) } as Partial<Region>)}
                                />
                            ))}
                            <button className="bsp-btn bsp-btn--ghost" onClick={duplicateRegion}>
                                <Copy size={11} /> Duplicate
                            </button>
                            <button
                                className="bsp-btn bsp-btn--ghost"
                                onClick={() => {
                                    setRegions((prev) => prev.filter((_, n) => n !== selRegion));
                                    setSelRegion((n) => Math.max(0, n - 1));
                                }}
                            >
                                <Trash2 size={11} /> Remove region
                            </button>
                        </div>
                    )}

                    {regions[selRegion] && (
                        <div className="bsp-align">
                            {/* Nine anchors, laid out as they sit on the canvas --
                                a 3x3 grid needs no labels to be read. */}
                            <span className="bsp-align-grid">
                                {([0, 0.5, 1] as const).map((vy) =>
                                    ([0, 0.5, 1] as const).map((hx) => (
                                        <button
                                            key={`${hx}-${vy}`}
                                            className="bsp-anchor"
                                            title={`Snap to ${vy === 0 ? "top" : vy === 1 ? "bottom" : "middle"} ${hx === 0 ? "left" : hx === 1 ? "right" : "centre"}`}
                                            onClick={() => alignRegion(hx, vy)}
                                        />
                                    ))
                                )}
                            </span>
                            <span className="bsp-locks">
                                <CheckboxToggle checked={lockRatio} onChange={setLockRatio} label="Keep ratio" />
                                <Tooltip text={`Size ${regions[selRegion]?.master.name || "this region"} to the guides either side of it — each axis independently`}>
                                    <button className="bsp-btn bsp-btn--ghost" onClick={fitToGuides}>
                                        Fit to guides
                                    </button>
                                </Tooltip>
                                <Tooltip text="Turn the master a quarter clockwise inside this region — the region itself stays put">
                                    <button
                                        className="bsp-btn bsp-btn--ghost"
                                        onClick={() => patchRegion(selRegion, {
                                            rotation: ((regions[selRegion].rotation + 90) % 360),
                                        })}
                                    >
                                        Rotate 90° {regions[selRegion].rotation ? `(${regions[selRegion].rotation}°)` : ""}
                                    </button>
                                </Tooltip>
                                <Tooltip text="Reshape this region to its master's own ratio, so nothing is cropped">
                                    <button className="bsp-btn bsp-btn--ghost" onClick={matchMasterRatio}>
                                        Match master ratio
                                    </button>
                                </Tooltip>
                            </span>
                        </div>
                    )}
                </>
            )}

            {mode === "multi" && (<>
            {/* --- the frame ----------------------------------------------- */}
            <p className="bsp-lbl bsp-lbl--section">This segment fills the frame</p>
            <div className="bsp-stage">
                <div className="bsp-tiles">
                    {seg && seg.tiles.map((m, i) => (
                        <motion.div
                            className="bsp-tile"
                            key={`${m.path}-${i}`}
                            style={{ background: hueFor(m.creative) }}
                            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                        >
                            <span className="bsp-tile-name">{m.creative || m.name}</span>
                            <span className="bsp-tile-spec">{m.size} · {m.duration}s</span>
                            <button className="bsp-tile-x" onClick={() => removeTile(i)} title="Remove from this segment">
                                <X size={9} />
                            </button>
                        </motion.div>
                    ))}
                    {(!seg || seg.tiles.length === 0) && (
                        <span className="bsp-tiles-empty">Pick a master below to fill the frame.</span>
                    )}
                </div>
                <div className="bsp-stage-foot">
                    <span>
                        {seg && seg.tiles.length
                            ? `${seg.tiles.length} × ${tileWidth}px`
                            : "empty segment"}
                    </span>
                    <span>canvas {canvasW} × {canvasH}</span>
                </div>
            </div>

            <div className="bsp-segctl">
                <span className="bsp-lbl">Holds for</span>
                <input
                    className="bsp-input bsp-input--n"
                    value={seg ? String(seg.seconds) : ""}
                    onChange={(e) => setSeg((s) => ({ ...s, seconds: Math.max(0, Number(e.target.value) || 0) }))}
                />
                <span className="bsp-x">s</span>
                <button className="bsp-btn bsp-btn--ghost" onClick={removeSegment} disabled={segments.length <= 1}>
                    <Trash2 size={11} /> Remove segment
                </button>
                <Tooltip text={duplicatePanels
                    ? "Each panel gets its own copy — edit one without touching the others"
                    : "Every panel of a master shares one comp — edit it once and they all follow"}>
                    <span className="bsp-toggle">
                        <CheckboxToggle
                            checked={duplicatePanels}
                            onChange={setDuplicatePanels}
                            label="Separate comp per panel"
                        />
                    </span>
                </Tooltip>
            </div>

            {/* --- running order ------------------------------------------- */}
            <p className="bsp-lbl bsp-lbl--section">Running order</p>
            <div className="bsp-timeline">
                {segments.map((s, i) => {
                    const name = s.tiles.length === 0 ? "empty"
                        : s.tiles.length === 1 ? (s.tiles[0].creative || s.tiles[0].name)
                        : `${s.tiles.length} × ${s.tiles[0].creative || s.tiles[0].name}`;
                    return (
                        <button
                            key={s.id}
                            className={"bsp-seg" + (i === current ? " is-on" : "")}
                            // GROW-proportional, not a percentage basis. Bases of
                            // 70% + 30% already fill the row, so the gaps and the
                            // fixed-width + button pushed it past the panel edge.
                            // Growing from a zero basis shares whatever is LEFT
                            // after those, which is the actual space available --
                            // and keeps each segment's width proportional to its
                            // duration, which is the point of the strip.
                            style={{ flex: `${Math.max(s.seconds, 0.5)} 1 0%` }}
                            onClick={() => setCurrent(i)}
                        >
                            <span className="bsp-seg-name">{name}</span>
                            <span className="bsp-seg-secs">{s.seconds}s</span>
                        </button>
                    );
                })}
                <Tooltip text="Add a segment after this one">
                    <button className="bsp-seg-add" onClick={addSegment}><Plus size={12} /></button>
                </Tooltip>
            </div>

            </>)}

            {(mode === "multi") && (blockers.length > 0 || notes.length > 0) && (
                <ul className="bsp-problems">
                    {blockers.map((p) => (
                        <li key={p}><AlertCircle size={10} /> {p}</li>
                    ))}
                    {notes.map((p) => (
                        <li className="is-note" key={p}><AlertCircle size={10} /> {p}</li>
                    ))}
                </ul>
            )}

            {/* --- the picker ----------------------------------------------- */}
            {/* FOLDED BY DEFAULT. The grid is the tallest thing in the tool and
                it is only needed at the moment you add a master -- the rest of
                the time it pushes the canvas off screen. The summary carries
                the state that matters while it is shut: which creative is
                filtered, and how many masters that leaves.
                It opens itself for a SWAP, because a swap is a request to pick
                something and closing the list you were sent to would be
                perverse. */}
            <button
                className={"bsp-fold" + (pickerOpen || swapTarget >= 0 ? " is-on" : "")}
                onClick={() => setPickerOpen((v) => !v)}
                hidden={!mode}
            >
                <ChevronRight size={11} className="bsp-fold-caret" />
                <span className="bsp-fold-label">
                    {swapTarget >= 0
                        ? `Replace R${swapTarget + 1}`
                        : mode === "regions" ? "Add a master as a region" : "Add a master to this segment"}
                </span>
                <span className="bsp-fold-summary">
                    {swapTarget >= 0
                        ? "its position is kept"
                        : `${creative || "no creative"} · ${matches.length} master${matches.length === 1 ? "" : "s"}`}
                </span>
            </button>
            <div className="bsp-picker" hidden={!mode || (!pickerOpen && swapTarget < 0)}>
                {/* Creative first, the way OV Library asks it -- the question is
                    "which artwork", not "what was that file called". */}
                <div className="bsp-creatives">
                    {creatives.map((c) => (
                        <button
                            key={c.name}
                            className={"bsp-creative" + (creative === c.name ? " is-on" : "")}
                            onClick={() => setCreative(c.name)}
                        >
                            <span className="bsp-creative-sw" style={{ background: hueFor(c.name) }} />
                            {c.name}<em>{c.count}</em>
                        </button>
                    ))}
                </div>

                <div className="bsp-filters">
                    {ORIENTATION_ORDER.map((key) => {
                        const Icon = ORIENTATION_ICON[key];
                        const n = orientCounts[key] || 0;
                        return (
                            <button
                                key={key}
                                className={"bsp-chip" + (orients[key] ? " is-on" : "")}
                                disabled={n === 0}
                                onClick={() => setOrients({ ...orients, [key]: !orients[key] })}
                            >
                                <Icon size={11} />
                                {key.charAt(0) + key.slice(1).toLowerCase()}
                            </button>
                        );
                    })}
                    <Dropdown
                        className="bsp-dur"
                        value={durFilter}
                        onChange={setDurFilter}
                        options={[{ value: "", label: "Any duration" }]
                            .concat(durations.map((d) => ({ value: d, label: `${d}s` })))}
                        placeholder="Any duration"
                        emptyMessage="No durations to filter by."
                    />
                </div>
                <div className="bsp-list">
                    {/* SKELETON, not a spinner. The walk is one synchronous
                        evalTS -- ExtendScript blocks AE for its whole duration,
                        so there is no channel to report progress through and a
                        percentage would have to be invented. Showing the SHAPE
                        of what is coming is honest about that, and the copy
                        says why the wait happens once. */}
                    {loading && Array.from({ length: 6 }).map((_, i) => (
                        <span className="bsp-skel" key={i} style={{ animationDelay: reduced ? undefined : `${i * 0.08}s` }}>
                            <span className="bsp-skel-sw" />
                            <span className="bsp-skel-name" style={{ width: `${52 + ((i * 13) % 34)}%` }} />
                            <span className="bsp-skel-tag" />
                        </span>
                    ))}
                    {loading && (
                        <LoadingChatter
                            className="bsp-chatter"
                            lines={[
                                "Walking the masters folder…",
                                "Every .aep under it gets opened for its name",
                                "On a big campaign this is a few hundred files",
                                "It's cached after this — the next open is instant",
                                "Still going…",
                            ]}
                        />
                    )}
                    {!loading && !masters && <p className="bsp-none">Pick a masters folder to browse.</p>}
                    {!loading && masters && matches.length === 0 && <p className="bsp-none">No master matches those filters.</p>}
                    {!loading && matches.map((m) => (
                        <MasterCard
                            key={m.path}
                            master={m}
                            swapping={swapTarget >= 0}
                            used={regions.filter((r) => r.master.path === m.path).length}
                            onPick={() => {
                                // Shuts behind you: the master is placed and the
                                // canvas is what you need to see next.
                                if (swapTarget >= 0) { swapRegion(m); setPickerOpen(false); return; }
                                if (mode === "regions") { addRegion(m); setPickerOpen(false); return; }
                                addTile(m);
                                setPickerOpen(false);
                            }}
                        />
                    ))}
                </div>
            </div>

            {status && (
                <p className={"bsp-status is-" + status.type}>
                    <StatusIcon type={status.type} size={12} /> {status.text}
                </p>
            )}

            {/* Says plainly what this does NOT do yet, rather than offering a
                Build button that would have to guess how masters are placed. */}
            <div className="bsp-pending" hidden={!mode}>
                <Tooltip text={mode === "regions"
                    ? (regions.length ? "Import the masters and assemble the regions" : "Add a region first")
                    : (blockers.length ? "Every segment needs at least one creative" : "Import the masters and assemble the composition")}>
                    <button
                        className="bsp-btn"
                        onClick={mode === "regions" ? runBuildRegions : runBuild}
                        disabled={building || (mode === "regions" ? regions.length === 0 : blockers.length > 0)}
                    >
                        {building ? "Building…" : "Build composition"}
                    </button>
                </Tooltip>
            </div>

            {report && (
                <div className="bsp-probe">
                    <div className="bsp-probe-head">
                        <span>What the build did</span>
                        <button className="bsp-probe-x" onClick={() => setReport(null)} title="Dismiss"><X size={11} /></button>
                    </div>
                    <pre className="bsp-probe-body">{report}</pre>
                </div>
            )}
        </div>
    );
};

export default BespokeTool;
