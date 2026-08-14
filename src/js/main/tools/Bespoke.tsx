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
import { AlertCircle, Copy, Globe2, LayoutGrid, Library, Plus, RectangleHorizontal, RectangleVertical, RefreshCw, Square as SquareIcon, Trash2, X } from "lucide-react";
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

interface Region {
    id: number;
    master: BespokeMaster;
    x: number;
    y: number;
    w: number;
    h: number;
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
    const [mode, setMode] = useState<"multi" | "regions">("multi");
    const [regions, setRegions] = useState<Region[]>([]);
    const [selRegion, setSelRegion] = useState(0);
    const [refPath, setRefPath] = useState("");
    // Constraints while dragging a corner. Ratio keeps a region from ever
    // introducing a crop it did not have; locking a side is for the common case
    // of a panel that must stay the full height or width of the screen.
    const [refMismatch, setRefMismatch] = useState("");
    // Rulers. Region edges snap to these while dragging, which is how you sit a
    // master exactly between two lines rather than nearly between them.
    const [guidesX, setGuidesX] = useState<number[]>([]);
    const [guidesY, setGuidesY] = useState<number[]>([]);
    const [lockRatio, setLockRatio] = useState(true);
    const [lockW, setLockW] = useState(false);
    const [lockH, setLockH] = useState(false);
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

    const pickReference = async () => {
        try {
            const picked = await evalTS("bespokeSelectReference");
            if (typeof picked === "string" && picked) {
                setRefPath(picked);
                setRefMismatch("");
                // THE REFERENCE IS NAMED AFTER THE DELIVERABLE, so it carries
                // the canvas, the runtime and the name -- typing them again
                // from the same string is three chances to get one wrong.
                // Both naming conventions, per the masters rule: size with or
                // without "px", duration as "s" or "sec".
                const stem = (picked.split("/").pop() || "").replace(/\.(jpe?g|png)$/i, "");
                const size = stem.match(/(\d+)x(\d+)(?:px)?/);
                if (size) { setCanvasW(size[1]); setCanvasH(size[2]); }
                const dur = stem.match(/_(\d+)s(?:ec)?(?:_|$)/);
                if (dur) setRuntime(dur[1]);
                if (!nameTouched && stem) setOutName(stem);
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
            id: nextSegId++, master: m,
            x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2),
            w: Math.max(24, w), h: Math.max(24, h),
        }]);
        setSelRegion(regions.length);
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

    const patchRegion = (i: number, patch: Partial<Region>) =>
        setRegions((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));

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
                if (bits[0] === "guideX") setGuidesX((g) => g.map((v, n) => (n === i ? Math.round(d.start.x + dx) : v)));
                else setGuidesY((g) => g.map((v, n) => (n === i ? Math.round(d.start.y + dy) : v)));
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
                const edgeX = snapTo(west ? Math.round(s0.x + dx) : Math.round(s0.x + s0.w + dx), guidesX, cw);
                const edgeY = snapTo(north ? Math.round(s0.y + dy) : Math.round(s0.y + s0.h + dy), guidesY, ch);
                const nx = west ? edgeX : s0.x;
                const ny = north ? edgeY : s0.y;
                let nw = west ? s0.x + s0.w - edgeX : edgeX - s0.x;
                let nh = north ? s0.y + s0.h - edgeY : edgeY - s0.y;

                // A locked side simply does not move; ratio drives the other
                // axis from the one being dragged, using the region's CURRENT
                // shape so a lock preserves what you already have rather than
                // snapping it to the master's.
                if (lockW) nw = s0.w;
                if (lockH) nh = s0.h;
                if (lockRatio && !lockW && !lockH) {
                    const aspect = s0.w / Math.max(1, s0.h);
                    if (Math.abs(nw - s0.w) >= Math.abs(nh - s0.h)) nh = Math.round(nw / aspect);
                    else nw = Math.round(nh * aspect);
                }

                // Below this a region collapses and can never be grabbed again.
                const fw = Math.max(24, nw);
                const fh = Math.max(24, nh);
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
    }, [mode, selRegion, canvasW, canvasH, lockRatio, lockW, lockH, guidesX, guidesY]);

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

    /** Reshapes the region to its master's native ratio, so nothing is cropped. */
    const matchMasterRatio = () => {
        const r = regions[selRegion];
        if (!r || !r.master.width || !r.master.height) return;
        const aspect = r.master.width / r.master.height;
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
                regions: regions.map((r) => ({ path: r.master.path, x: r.x, y: r.y, w: r.w, h: r.h })),
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
            <div className="bsp-head">
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

            {/* --- the deliverable being built ------------------------------ */}
            <div className="bsp-target">
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

            <div className="bsp-modes">
                <button className={"bsp-mode" + (mode === "multi" ? " is-on" : "")} onClick={() => setMode("multi")}>
                    <b>Multi Art</b><span>Equal panels, segments over time</span>
                </button>
                <button className={"bsp-mode" + (mode === "regions" ? " is-on" : "")} onClick={() => setMode("regions")}>
                    <b>Bespoke</b><span>A master anywhere on the canvas</span>
                </button>
            </div>

            {/* --- where it lands ------------------------------------------ */}
            <div className="bsp-dest">
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

            <label className="bsp-field">
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
            <p className="bsp-path">
                {territory && marketsRoot
                    ? `${marketsRoot}/${territory}/AE/${batch.trim() || "AE"}/${outName || "…"}_V01.aep`
                    : "No country chosen — it will be built and left unsaved."}
            </p>

            {mode === "regions" && (
                <>
                    <p className="bsp-lbl bsp-lbl--section">
                        Trace over the reference
                        <button className="bsp-reflink" onClick={pickReference}>
                            {refPath ? refPath.split("/").pop() : "pick the reference JPG…"}
                        </button>
                    </p>
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
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    const cw = Number(canvasW) || 0;
                                    const ch = Number(canvasH) || 0;
                                    setRefMismatch(
                                        cw && ch && (img.naturalWidth !== cw || img.naturalHeight !== ch)
                                            ? `Reference is ${img.naturalWidth}×${img.naturalHeight} but the name says ${cw}×${ch} — tracing over it will be off.`
                                            : ""
                                    );
                                }}
                                onError={() => setRefMismatch("Couldn't load that reference image.")}
                            />
                        )}
                        {regions.map((r, i) => {
                            const cw = Number(canvasW) || 1920;
                            const ch = Number(canvasH) || 1080;
                            const cover = Math.max(r.w / r.master.width, r.h / r.master.height);
                            const lost = Math.round((1 - Math.min(r.w / (r.master.width * cover), r.h / (r.master.height * cover))) * 100);
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
                                    <span className="bsp-region-tag">
                                        {r.master.creative || r.master.name}
                                        {lost > 0 ? ` · ${lost}% cropped` : ""}
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
                                className="bsp-guide bsp-guide--h"
                                style={{ top: `${(g / (Number(canvasH) || 1080)) * 100}%` }}
                                onMouseDown={(e) => {
                                    const box = stageRef.current?.getBoundingClientRect();
                                    if (!box) return;
                                    dragRef.current = { handle: `guideY:${i}`, sx: e.clientX, sy: e.clientY, box, start: { id: 0, master: regions[0]?.master as BespokeMaster, x: 0, y: g, w: 0, h: 0 } };
                                    e.preventDefault();
                                }}
                                onDoubleClick={() => setGuidesY((gs) => gs.filter((_, n) => n !== i))}
                                title={`y ${g} — drag to move, double-click to remove`}
                            />
                        ))}
                        {guidesX.map((g, i) => (
                            <span
                                key={"gx" + i}
                                className="bsp-guide bsp-guide--v"
                                style={{ left: `${(g / (Number(canvasW) || 1920)) * 100}%` }}
                                onMouseDown={(e) => {
                                    const box = stageRef.current?.getBoundingClientRect();
                                    if (!box) return;
                                    dragRef.current = { handle: `guideX:${i}`, sx: e.clientX, sy: e.clientY, box, start: { id: 0, master: regions[0]?.master as BespokeMaster, x: g, y: 0, w: 0, h: 0 } };
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

                    <div className="bsp-guidebar">
                        <span className="bsp-lbl">Guides</span>
                        <button className="bsp-btn bsp-btn--ghost" onClick={() => setGuidesY((g) => [...g, Math.round((Number(canvasH) || 1080) / 2)])}>
                            + Horizontal
                        </button>
                        <button className="bsp-btn bsp-btn--ghost" onClick={() => setGuidesX((g) => [...g, Math.round((Number(canvasW) || 1920) / 2)])}>
                            + Vertical
                        </button>
                        {(guidesX.length > 0 || guidesY.length > 0) && (
                            <button className="bsp-btn bsp-btn--ghost" onClick={() => { setGuidesX([]); setGuidesY([]); }}>
                                Clear
                            </button>
                        )}
                        <span className="bsp-guidehint">drag a line to place it · region edges snap to it</span>
                    </div>

                    {refMismatch !== "" && (
                        <ul className="bsp-problems">
                            <li><AlertCircle size={10} /> {refMismatch}</li>
                        </ul>
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
                                <CheckboxToggle checked={lockW} onChange={setLockW} label="Lock width" />
                                <CheckboxToggle checked={lockH} onChange={setLockH} label="Lock height" />
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
            <p className="bsp-lbl bsp-lbl--section">
                {mode === "regions" ? "Add a master as a region" : "Add a master to this segment"}
            </p>
            <div className="bsp-picker">
                {/* Creative first, the way OV Library asks it -- the question is
                    "which artwork", not "what was that file called". */}
                <div className="bsp-creatives">
                    <button
                        className={"bsp-creative" + (creative === "" ? " is-on" : "")}
                        onClick={() => setCreative("")}
                    >
                        All<em>{(masters || []).length}</em>
                    </button>
                    {creatives.map((c) => (
                        <button
                            key={c.name}
                            className={"bsp-creative" + (creative === c.name ? " is-on" : "")}
                            onClick={() => setCreative(creative === c.name ? "" : c.name)}
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
                        <button className="bsp-master" key={m.path} onClick={() => (mode === "regions" ? addRegion(m) : addTile(m))}>
                            <span className="bsp-master-sw" style={{ background: hueFor(m.creative) }} />
                            <span className="bsp-master-name">{m.creative || m.name}</span>
                            <span className="bsp-master-tag">{m.size || "?"}</span>
                            <span className="bsp-master-tag">{m.duration ? `${m.duration}s` : "?"}</span>
                        </button>
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
            <div className="bsp-pending">
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
