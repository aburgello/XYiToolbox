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
import { AlertCircle, LayoutGrid, Layers, Plus, RectangleHorizontal, RectangleVertical, RefreshCw, Square as SquareIcon, Trash2, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
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
    orientation: string;
}

/** OV Library's four, same order and same icons, so the two read alike. */
type OrientationKey = "LANDSCAPE" | "PORTRAIT" | "SQUARE" | "QUAD";
const ORIENTATION_ORDER: OrientationKey[] = ["LANDSCAPE", "PORTRAIT", "SQUARE", "QUAD"];
const ORIENTATION_ICON: Record<OrientationKey, React.ComponentType<{ size?: number }>> = {
    LANDSCAPE: RectangleHorizontal,
    PORTRAIT: RectangleVertical,
    SQUARE: SquareIcon,
    QUAD: LayoutGrid,
};

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
    const [probe, setProbe] = useState<string | null>(null);
    const [probing, setProbing] = useState(false);

    // The deliverable being composed. Canvas and runtime come from the row this
    // is being built for; typed by hand until the row picker is wired.
    const [canvasW, setCanvasW] = useState("3240");
    const [canvasH, setCanvasH] = useState("1920");
    const [runtime, setRuntime] = useState("10");

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
     * Imports the masters in this segment and reports what actually arrives.
     *
     * REPORT ONLY -- see bespokeProbeImport. It answers the questions the real
     * builder cannot be written without: how much a master drags in with it,
     * which comp inside is the one to place, whether footage resolves here, and
     * whether the frame rates agree. Run it in a scratch project; one undo puts
     * everything back.
     */
    const runProbe = async () => {
        const seg0 = segments[current];
        const paths = seg0 ? seg0.tiles.map((t) => t.path) : [];
        if (paths.length === 0) {
            setStatus({ text: "Add a master to this segment first — the probe imports what's in it.", type: "error" });
            return;
        }
        setProbing(true);
        setProbe(null);
        setStatus(null);
        try {
            const res = (await evalTS("bespokeProbeImport", JSON.stringify(paths))) as unknown as
                { success: boolean; error?: string; report?: string } | undefined;
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) {
                setStatus({ text: res.error || "The probe failed.", type: "error" });
                return;
            }
            setProbe(res.report || "(no report)");
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setProbing(false);
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

    // Everything wrong with the composition, said plainly and live rather than
    // discovered at build time.
    const problems: string[] = [];
    if (segments.some((s) => s.tiles.length === 0)) problems.push("a segment has no creatives in it");
    if (wantSecs > 0 && Math.abs(totalSecs - wantSecs) > 0.001) {
        problems.push(`segments total ${totalSecs}s, the row asks for ${wantSecs}s`);
    }
    if (seg && seg.tiles.length > 0 && canvasWidth > 0 && naturalWidth !== canvasWidth) {
        problems.push(`this segment's masters total ${naturalWidth}px across a ${canvasWidth}px canvas`);
    }

    return (
        <div className="form-tool bsp">
            <div className="bsp-head">
                <div className="bsp-head-text">
                    <p className="bsp-masters">{mastersPath || "No masters folder set"}</p>
                    <p className="bsp-count">
                        {loading ? "Reading masters…" : masters ? `${masters.length} masters` : "not loaded"}
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
            </div>

            {/* --- running order ------------------------------------------- */}
            <p className="bsp-lbl bsp-lbl--section">Running order</p>
            <div className="bsp-timeline">
                {segments.map((s, i) => {
                    const span = Math.max(9, (s.seconds / Math.max(totalSecs, wantSecs || 1)) * 100);
                    const name = s.tiles.length === 0 ? "empty"
                        : s.tiles.length === 1 ? (s.tiles[0].creative || s.tiles[0].name)
                        : `${s.tiles.length} × ${s.tiles[0].creative || s.tiles[0].name}`;
                    return (
                        <button
                            key={s.id}
                            className={"bsp-seg" + (i === current ? " is-on" : "")}
                            style={{ flex: `0 0 ${span}%` }}
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

            {problems.length > 0 && (
                <ul className="bsp-problems">
                    {problems.map((p) => (
                        <li key={p}><AlertCircle size={10} /> {p}</li>
                    ))}
                </ul>
            )}

            {/* --- the picker ----------------------------------------------- */}
            <p className="bsp-lbl bsp-lbl--section">Add a master to this segment</p>
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
                    <select className="bsp-input bsp-input--sel" value={durFilter} onChange={(e) => setDurFilter(e.target.value)}>
                        <option value="">Any duration</option>
                        {durations.map((d) => <option key={d} value={d}>{d}s</option>)}
                    </select>
                </div>
                <div className="bsp-list">
                    {!masters && <p className="bsp-none">Pick a masters folder to browse.</p>}
                    {masters && matches.length === 0 && <p className="bsp-none">No master matches those filters.</p>}
                    {matches.map((m) => (
                        <button className="bsp-master" key={m.path} onClick={() => addTile(m)}>
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
                <p className="bsp-pending-note">
                    <Layers size={11} /> Composition only for now — assembling this into an AE
                    project is the next step, once how masters sit in their panel is settled.
                </p>
                <Tooltip text="Imports this segment's masters and reports what arrives. Changes nothing — run it in a scratch project and undo once after.">
                    <button className="bsp-btn bsp-btn--ghost" onClick={runProbe} disabled={probing}>
                        {probing ? "Probing…" : "Probe import"}
                    </button>
                </Tooltip>
            </div>

            {probe && (
                <div className="bsp-probe">
                    <div className="bsp-probe-head">
                        <span>What actually arrived</span>
                        <button className="bsp-probe-x" onClick={() => setProbe(null)} title="Dismiss"><X size={11} /></button>
                    </div>
                    <pre className="bsp-probe-body">{probe}</pre>
                </div>
            )}
        </div>
    );
};

export default BespokeTool;
