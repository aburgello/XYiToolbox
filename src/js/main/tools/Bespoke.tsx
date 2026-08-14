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
import { AlertCircle, Globe2, LayoutGrid, Layers, Library, Plus, RectangleHorizontal, RectangleVertical, RefreshCw, Square as SquareIcon, Trash2, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import Dropdown from "../Dropdown";
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

    /** Assembles the whole composition. Imports read-only, saves nothing. */
    const runBuild = async () => {
        setBuilding(true);
        setProbe(null);
        setStatus(null);
        try {
            const plan = {
                canvasWidth: Number(canvasW) || 0,
                canvasHeight: Number(canvasH) || 0,
                name: outName.trim(),
                marketsRoot,
                territory,
                batch: batch.trim(),
                segments: segments.map((sg) => ({
                    seconds: sg.seconds,
                    tiles: sg.tiles.map((t) => ({ path: t.path })),
                })),
            };
            const res = (await evalTS("bespokeBuild", JSON.stringify(plan))) as unknown as
                { success: boolean; error?: string; report?: string } | undefined;
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) {
                setStatus({ text: res.error || "The build failed.", type: "error" });
                return;
            }
            setProbe(res.report || "(built)");
            setStatus({ text: "Built. Nothing was saved — save it where you mean to.", type: "success" });
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
        const bits = [
            first.film || "",
            first.region || "INTL",
            "MultipleArt",
            first.artwork || "DOOH",
            first.site || "",
            `${canvasW}x${canvasH}px`,
            `${Math.round(Number(runtime) || 0)}s`,
            code,
        ].filter((b) => b !== "");
        return bits.join("_");
    }, [segments, territoryCode, canvasW, canvasH, runtime]);

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
                    <Layers size={11} /> Masters are imported read-only and nothing is saved —
                    one undo puts the project back.
                </p>
                <Tooltip text="Imports this segment's masters and reports what arrives, without building anything.">
                    <button className="bsp-btn bsp-btn--ghost" onClick={runProbe} disabled={probing || building}>
                        {probing ? "Probing…" : "Probe import"}
                    </button>
                </Tooltip>
                <Tooltip text={problems.length ? "Fix what's flagged above first" : "Import the masters and assemble the composition"}>
                    <button className="bsp-btn" onClick={runBuild} disabled={building || probing || problems.length > 0}>
                        {building ? "Building…" : "Build composition"}
                    </button>
                </Tooltip>
            </div>

            {probe && (
                <div className="bsp-probe">
                    <div className="bsp-probe-head">
                        <span>Report</span>
                        <button className="bsp-probe-x" onClick={() => setProbe(null)} title="Dismiss"><X size={11} /></button>
                    </div>
                    <pre className="bsp-probe-body">{probe}</pre>
                </div>
            )}
        </div>
    );
};

export default BespokeTool;
