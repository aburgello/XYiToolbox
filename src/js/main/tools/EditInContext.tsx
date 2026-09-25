// =============================================================================
// src/js/main/tools/EditInContext.tsx
// -----------------------------------------------------------------------------
// Edit a layer that lives inside a precomp WITHOUT leaving the comp you're
// looking at.
//
// WHY IT WORKS THIS WAY (the first version did the opposite and was useless):
// the tedium being solved is "dive into the precomp, tweak, come back out,
// look, repeat". v1 required you to be standing INSIDE the precomp and searched
// upward for parents — i.e. it assumed the very navigation it was meant to
// remove — and then made you type numbers into four boxes and press Apply.
//
// This version starts from the comp you're already in and drills DOWN. You
// never navigate, so the viewer never changes, so every nudge lands in front of
// you. That's the whole feature.
//
// It also can't be done with viewers: AE's `Viewer` class has no lock property
// and no window positioning (verified against the typings), so the "two viewers,
// one locked" setup people picture is not scriptable. Editing from the parent
// makes the question moot.
//
// Backend: editInContextRoot / Layers / Target / Nudge / Reveal in tools.ts.
// Transform properties of the open project only — no app.open(), no saves.
// =============================================================================
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
    Plus, Minus, ChevronRight, Layers, Crosshair, RefreshCw, Loader2, Lock, Keyboard, X,
} from "lucide-react";
import { evalTS, csi } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import CheckboxToggle from "../CheckboxToggle";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";
import "./EditInContext.scss";

interface LayerInfo {
    index: number;
    name: string;
    isPrecomp: boolean;
    sourceCompId: number;
    transformable: boolean;
}

interface TargetState {
    layerName: string;
    compName: string;
    position: number[];
    scale: number[];
    rotation: number;
    opacity: number;
    rootScale: number[];
    positionKeyed: boolean;
    scaleKeyed: boolean;
    locked: boolean;
}

/** One level of the drill-down: which comp we're listing, and how we got there. */
interface Crumb {
    compId: number;
    compName: string;
    /** Layer index in the PARENT comp that led here (0 for the root). */
    viaIndex: number;
}

const HOLD_DELAY_MS = 350;
const REPEAT_MS = 100;

const round = (n: number) => Math.round(n * 100) / 100;
const fmt2 = (v: number[] | undefined) => (v && v.length >= 2 ? `${round(v[0])}, ${round(v[1])}` : "—");

/**
 * Hold-to-repeat button. MOUSE events, not pointer events — the macOS AE CEP
 * host doesn't reliably dispatch Pointer Events, which is why XYTools' nudge
 * bar uses the same pattern. `busyRef` gates repeats on the previous call
 * settling so a slow bridge can't queue stale nudges that land after release.
 */
const NudgeButton: React.FC<{
    title: string;
    disabled?: boolean;
    onStep: (shift: boolean) => Promise<void> | void;
    children: React.ReactNode;
}> = ({ title, disabled, onStep, children }) => {
    const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const repRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const busyRef = useRef(false);

    const fire = async (shift: boolean) => {
        if (busyRef.current) return;
        busyRef.current = true;
        try { await onStep(shift); } finally { busyRef.current = false; }
    };
    const stop = () => {
        if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
        if (repRef.current) { clearInterval(repRef.current); repRef.current = null; }
    };
    useEffect(() => stop, []);

    return (
        <button
            className="eic-nudge"
            title={title}
            disabled={disabled}
            onMouseDown={(e) => {
                // Do NOT let the button take focus: focus is what keeps the
                // keygrab input alive, and stealing it disarms the arrow keys
                // the instant you click an arrow.
                e.preventDefault();
                const shift = e.shiftKey;      // captured at press; a hold keeps using it
                fire(shift);
                holdRef.current = setTimeout(() => {
                    repRef.current = setInterval(() => fire(shift), REPEAT_MS);
                }, HOLD_DELAY_MS);
            }}
            onMouseUp={stop}
            onMouseLeave={stop}
        >
            {children}
        </button>
    );
};

const EditInContextTool = () => {
    const [status, setStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [rootId, setRootId] = useState<number | null>(null);
    const [trail, setTrail] = useState<Crumb[]>([]);
    const [layers, setLayers] = useState<LayerInfo[]>([]);
    // TWO SEPARATE PATHS, and keeping them separate is load-bearing.
    //   `path`       — the DRILL trail: precomp layer indices from the root down
    //                  to the comp currently being listed. Only drill/goTo change it.
    //   `targetPath` — `path` + the index of the layer being edited.
    // v1 stored one combined path and folded the selected layer into it, so
    // picking a SECOND layer at the same level built [...previousTarget, new],
    // one level too deep — the resolver then tried to descend into a layer that
    // wasn't a precomp and returned "that layer is no longer where it was".
    // Re-clicking a breadcrumb appeared to fix it only because goTo() reset the
    // path.
    const [path, setPath] = useState<number[]>([]);
    const [targetPath, setTargetPath] = useState<number[] | null>(null);
    /**
     * THE OTHER LAYERS MOVING WITH IT. Cmd/Ctrl-click adds a row here; the
     * primary target stays the one whose numbers are on screen, because six
     * layers have six different positions and showing one set of figures for
     * all of them would be a lie.
     *
     * Paths, not indices: a selection is only ever within one comp, but the
     * path is what the host resolves and what survives a drill.
     */
    const [alsoPaths, setAlsoPaths] = useState<number[][]>([]);
    const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);
    const [target, setTarget] = useState<TargetState | null>(null);
    const [loading, setLoading] = useState(false);
    // A STEP PER PROPERTY. These are different units -- 2px is a nudge, 2% is a
    // shove, 2deg is somewhere between -- so one shared field can't serve all
    // three. Defaults are tuned so a single click feels like the same size of
    // change in each.
    const [stepPos, setStepPos] = useState("2");
    const [stepScale, setStepScale] = useState("0.5");
    const [rootSpace, setRootSpace] = useState(true);

    const say = (text: string, type: "success" | "error" = "error") => setStatus({ text, type });

    // ── arrow-key nudging, deliberately OPT-IN ──────────────────────────────
    // AE binds the arrow keys to "nudge the selected layer in the comp", so a
    // panel that grabbed them permanently would quietly break that for the rest
    // of the session. Instead the pad is armed by clicking it and released the
    // moment focus leaves, so the artist decides when the panel owns the arrows.
    //
    // Two mechanisms, both needed (see ArcadeFrame's header): CEP's
    // registerKeyEventsInterest tells the host to route these combos to the
    // extension, and a FOCUSED editable field is what actually gets keystrokes
    // delivered on macOS AE. Hence the invisible input.
    const keyGrabRef = useRef<HTMLInputElement>(null);
    const [armed, setArmed] = useState(false);

    const arrowInterest = () => {
        const out: Array<Record<string, unknown>> = [];
        const codes = [37, 38, 39, 40];
        for (let i = 0; i < codes.length; i++) {
            out.push({ keyCode: codes[i], shiftKey: false });
            out.push({ keyCode: codes[i], shiftKey: true });
        }
        return JSON.stringify(out);
    };

    const claimArrows = () => {
        try { csi.registerKeyEventsInterest(arrowInterest()); } catch (e) { /* no host in preview */ }
        setArmed(true);
    };
    const releaseArrows = () => {
        try { csi.registerKeyEventsInterest("[]"); } catch (e) { /* nothing to release */ }
        setArmed(false);
    };
    // Never leave AE without its arrow keys if the tool unmounts while armed.
    useEffect(() => () => { try { csi.registerKeyEventsInterest("[]"); } catch (e) {} }, []);

    const call = useCallback(async (fn: string, ...args: unknown[]) => {
        try {
            const res = await (evalTS as any)(fn, ...args);
            if (res === undefined) throw new Error("no bridge");
            return res as any;
        } catch (e) {
            say("No CEP bridge detected. Open this panel inside After Effects.");
            return null;
        }
    }, []);

    // The same call without the toast. `call` announces a missing bridge, which
    // is right for something the artist pressed and wrong about once a second
    // in browser preview -- a poll that reports its own failure is a panel that
    // shouts at you for having no After Effects open.
    const quiet = useCallback(async (fn: string, ...args: unknown[]) => {
        try {
            const res = await (evalTS as any)(fn, ...args);
            return res === undefined ? null : (res as any);
        } catch (e) {
            return null;
        }
    }, []);

    // ── load the comp the artist is standing in, and its layers ─────────────
    const loadRoot = useCallback(async () => {
        setLoading(true);
        setStatus(null);
        setTarget(null);
        setPath([]);
        setTargetPath(null);
        setAlsoPaths([]);
        const r = await call("editInContextRoot");
        if (!r) { setLoading(false); return; }
        if (!r.success) { say(r.error || "Couldn't read the active comp."); setLoading(false); return; }
        const l = await call("editInContextLayers", r.compId);
        setLoading(false);
        if (!l || !l.success) { say((l && l.error) || "Couldn't list layers."); return; }
        setRootId(r.compId);
        setTrail([{ compId: r.compId, compName: r.compName, viaIndex: 0 }]);
        setLayers(l.layers || []);
    }, [call]);

    useEffect(() => { loadRoot(); }, [loadRoot]);

    // ── follow the selection in After Effects ───────────────────────────────
    //
    // Select a precomp in the comp you are standing in and the panel opens it,
    // instead of making you find the same layer again in the doorway list. The
    // selection is the thing you already pointed at; asking for it twice is the
    // friction this tool exists to remove.
    //
    // ONLY ON A CHANGE, never on every tick. The panel's target and AE's
    // selection are two different things and the artist moves both: if the poll
    // re-applied what it saw each time, picking a layer in the panel would be
    // undone a second later by a selection in AE that had not moved. So the
    // signature is remembered and only a genuine change in AE acts -- which is
    // also what makes this safe to run continuously.
    //
    // A PRECOMP ONLY. A plain layer selected up here has nothing to open, and
    // AE's own arrow keys already nudge it; silently doing nothing is the right
    // answer rather than inventing a target the artist did not ask for.
    const lastSeen = useRef<string>("");
    const skipNext = useRef(false);
    const rootIdRef = useRef<number | null>(null);
    const loadingRef = useRef(false);
    useEffect(() => { rootIdRef.current = rootId; }, [rootId]);
    useEffect(() => { loadingRef.current = loading; }, [loading]);

    useEffect(() => {
        let alive = true;
        let inFlight = false;
        const tick = async () => {
            // Never overlap a poll with itself or with a load: both would race
            // the same state, and the bridge is single-file anyway.
            if (!alive || inFlight || loadingRef.current) return;
            inFlight = true;
            try {
                const r = await quiet("editInContextSelection");
                if (!alive || !r || !r.success) return;
                const sig = String(r.compId) + ":" + String(r.layerIndex || 0);
                if (sig === lastSeen.current) return;
                lastSeen.current = sig;
                // Reveal selects the layer it just revealed and opens its comp,
                // which IS a selection change -- and acting on it would throw
                // away the trail the artist was working in. One tick of grace.
                if (skipNext.current) { skipNext.current = false; return; }
                if (!r.layerIndex || !r.isPrecomp || !r.sourceCompId) return;
                const ok = await openDoorway(
                    r.compId, r.compName, r.layerIndex, r.layerName, r.sourceCompId,
                );
                if (ok && alive) {
                    setStatus({ text: 'Opened "' + r.layerName + '" — selected in After Effects.', type: "success" });
                }
            } finally {
                inFlight = false;
            }
        };
        const id = window.setInterval(tick, 900);
        tick();
        return () => { alive = false; window.clearInterval(id); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quiet]);

    // ── drill into a precomp layer ──────────────────────────────────────────
    const drill = async (layer: LayerInfo) => {
        if (!layer.isPrecomp) return;
        setLoading(true);
        const l = await call("editInContextLayers", layer.sourceCompId);
        setLoading(false);
        if (!l || !l.success) { say((l && l.error) || "Couldn't open that precomp."); return; }
        setTrail((t) => [...t, { compId: layer.sourceCompId, compName: layer.name, viaIndex: layer.index }]);
        setPath((p) => [...p, layer.index]);
        setLayers(l.layers || []);
        setTarget(null);
        setTargetPath(null);
        setAlsoPaths([]);
        setStatus(null);
    };

    /**
     * Open one precomp as if it had been clicked in the doorway list, building
     * the trail from scratch. Used by the selection follower, which knows the
     * comp and the layer but has no `layers` state to look them up in -- it may
     * be acting on a comp the panel has not listed yet.
     */
    const openDoorway = async (
        compId: number, compName: string, viaIndex: number, viaName: string, sourceCompId: number,
    ) => {
        const l = await quiet("editInContextLayers", sourceCompId);
        if (!l || !l.success) return false;
        setRootId(compId);
        setTrail([
            { compId, compName, viaIndex: 0 },
            { compId: sourceCompId, compName: viaName, viaIndex },
        ]);
        setPath([viaIndex]);
        setLayers(l.layers || []);
        setTarget(null);
        setTargetPath(null);
        setAlsoPaths([]);
        return true;
    };

    /** Jump back to any crumb. Index 0 is the root comp. */
    const goTo = async (level: number) => {
        const crumb = trail[level];
        if (!crumb) return;
        setLoading(true);
        const l = await call("editInContextLayers", crumb.compId);
        setLoading(false);
        if (!l || !l.success) return;
        setTrail((t) => t.slice(0, level + 1));
        setPath((p) => p.slice(0, level));
        setLayers(l.layers || []);
        setTarget(null);
        setTargetPath(null);
        setAlsoPaths([]);
        setStatus(null);
    };

    // ── pick the layer to edit ──────────────────────────────────────────────
    const pick = async (layer: LayerInfo, additive?: boolean) => {
        if (!rootId) return;
        if (!layer.transformable) { say("That layer has no scale/position (camera, light or audio)."); return; }
        const full = [...path, layer.index];

        // ADD OR REMOVE, without disturbing the primary. Cmd/Ctrl-clicking the
        // primary itself is ignored rather than leaving a selection with no
        // figures on screen.
        if (additive && targetPath) {
            if (samePath(full, targetPath)) return;
            setAlsoPaths((prev) => prev.some((p) => samePath(p, full))
                ? prev.filter((p) => !samePath(p, full))
                : [...prev, full]);
            setStatus(null);
            return;
        }
        setAlsoPaths([]);
        const r = await call("editInContextTarget", rootId, JSON.stringify(full));
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't read that layer."); return; }
        setTarget({
            layerName: r.layerName, compName: r.compName,
            position: r.position, scale: r.scale, rotation: r.rotation, opacity: r.opacity,
            rootScale: r.rootScale, positionKeyed: r.positionKeyed, scaleKeyed: r.scaleKeyed,
            locked: r.locked,
        });
        // Record the TARGET only -- `path` (the drill trail) must not move, or
        // the next pick at this level would be resolved one level too deep.
        setTargetPath(full);
        setStatus(null);
    };

    const amount = (raw: string, shift: boolean) => {
        const n = parseFloat(raw);
        const base = isNaN(n) || n === 0 ? 1 : n;
        return shift ? base * 10 : base;     // Shift = 10x, matching AE's own arrow-key convention
    };

    const nudge = async (kind: string, ax: number, ay: number) => {
        if (!rootId || !target || !targetPath) return;

        // SEVERAL SELECTED: one host call, one undo group. A loop here would
        // be one undo step per layer, which is the thing you would want back
        // in one press.
        if (alsoPaths.length > 0) {
            const all = [targetPath, ...alsoPaths];
            const r = await call("editInContextNudgeMany", rootId, JSON.stringify(all), kind, ax, ay, rootSpace);
            if (!r) return;
            if (!r.success) { say(r.error || "Nudge failed."); return; }
            // The primary's own figures, re-read: the panel shows one layer's
            // numbers and they have just changed.
            const t2 = await call("editInContextTarget", rootId, JSON.stringify(targetPath));
            if (t2 && t2.success) {
                setTarget((t) => t ? {
                    ...t, position: t2.position, scale: t2.scale,
                    rotation: t2.rotation, opacity: t2.opacity, rootScale: t2.rootScale,
                } : t);
            }
            const skipped = (r as { skipped?: string[] }).skipped || [];
            if (skipped.length > 0) say(`Moved ${(r as { moved?: number }).moved} — skipped ${skipped.join(", ")}.`, "success");
            else if (r.keyed) setStatus({ text: "A property is animated — set a keyframe at the playhead.", type: "success" });
            return;
        }

        const r = await call("editInContextNudge", rootId, JSON.stringify(targetPath), kind, ax, ay, rootSpace);
        if (!r) return;
        if (!r.success) { say(r.error || "Nudge failed."); return; }
        setTarget((t) => t ? {
            ...t, position: r.position, scale: r.scale,
            rotation: r.rotation, opacity: r.opacity, rootScale: r.rootScale,
        } : t);
        if (r.keyed) setStatus({ text: "Property is animated — set a keyframe at the playhead.", type: "success" });
    };

    const reveal = async () => {
        if (!rootId || !targetPath) return;
        skipNext.current = true;
        const r = await call("editInContextReveal", rootId, JSON.stringify(targetPath));
        if (r && r.success) say(r.message || "Selected.", "success");
        else if (r) say(r.error || "Couldn't select it.");
    };

    const atRoot = trail.length <= 1;
    // Top level lists precomps ONLY (doorways); deeper levels list everything,
    // because that's the stuff you can't otherwise reach without navigating.
    const visible = atRoot ? layers.filter((l) => l.isPrecomp) : layers;

    // A comp name is long ("SF_INTL_Trio_DOOH_Odiseja_1665x675px_10s_SI_V01");
    // the crumbs show what tells two apart -- the site and size -- and keep the
    // whole name for the tooltip.
    const shortComp = (n: string) => {
        const m = String(n || "").match(/_([A-Za-z0-9]+)_(\d{3,}x\d{3,})(?:px)?_/);
        return m ? m[1] + " " + m[2] : n;
    };
    const rootName = trail[0]?.compName || "";

    return (
        <div className="form-tool eic-tool">
            {/* WHERE YOU ARE, as a path of names -- boxed chips cut the root's
                name off after a dozen characters, which is the one part that
                said which comp this is. */}
            <div className="eic-bar">
                <div className="eic-crumbs">
                    {trail.map((c, i) => (
                        <React.Fragment key={c.compId + "-" + i}>
                            {i > 0 && <ChevronRight size={12} className="eic-crumb-sep" />}
                            {/* A title, not <Tooltip>: its wrapper is fixed-width
                                (flex: 0 0 auto !important), and a crumb has to
                                shrink -- wrapped, every name was cut short. */}
                            <button
                                className={"eic-crumb" + (i === trail.length - 1 ? " eic-crumb--on" : "")}
                                onClick={() => goTo(i)}
                                title={c.compName}
                            >
                                {i === 0 ? shortComp(c.compName) : c.compName}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
                <Tooltip text="Reload from the active comp">
                    <button className="eic-refresh" onClick={loadRoot} aria-label="Reload from the active comp">
                        {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                    </button>
                </Tooltip>
            </div>

            {!rootId && !loading && (
                <p className="eic-empty">Open a comp in After Effects, then reload.</p>
            )}

            {rootId && (
                <div className="eic-layers">
                    {/* AT THE TOP LEVEL, ONLY PRECOMPS ARE LISTED, and they are
                        doorways rather than things to edit. Nudging a top-level
                        layer is just editing the comp you're already in, which
                        AE does perfectly well on its own -- this tool exists for
                        what's INSIDE. One level down, everything is listed and
                        editable, since that's the stuff you can't reach. */}
                    {atRoot && visible.length === 0 && (
                        <p className="eic-empty">
                            No precomps in <strong>{rootName}</strong>. This tool edits layers inside one.
                        </p>
                    )}
                    {!atRoot && visible.length === 0 && <p className="eic-empty">This precomp has no layers.</p>}

                    {visible.map((l) => {
                        // Highlight only when the selected layer is THIS row at
                        // THIS level: same depth, same drill prefix, same index.
                        const isTarget = !!targetPath
                            && targetPath.length === path.length + 1
                            && targetPath[targetPath.length - 1] === l.index;
                        const isAlso = alsoPaths.some((p) =>
                            p.length === path.length + 1 && p[p.length - 1] === l.index);

                        // Top level: the whole row opens the precomp.
                        if (atRoot) {
                            return (
                                <button className="eic-door" key={l.index} onClick={() => drill(l)}>
                                    <Layers size={14} className="eic-door-icon" />
                                    <span className="eic-door-name">{l.name}</span>
                                    <ChevronRight size={14} className="eic-door-go" />
                                </button>
                            );
                        }

                        return (
                            <div
                                className={"eic-layer-row"
                                    + (isTarget ? " eic-layer-row--on" : "")
                                    + (isAlso ? " eic-layer-row--also" : "")}
                                key={l.index}
                            >
                                <button
                                    className="eic-layer-main"
                                    onClick={(e) => pick(l, e.metaKey || e.ctrlKey)}
                                    disabled={!l.transformable}
                                    title={l.transformable
                                        ? "Edit this layer's transform. ⌘/Ctrl-click to move it with the selected one."
                                        : "No transform to edit"}
                                >
                                    <span className="eic-layer-idx">{l.index}</span>
                                    <span className="eic-layer-name">{l.name}</span>
                                    {l.isPrecomp && <Layers size={12} className="eic-layer-kind" aria-label="precomp" />}
                                </button>
                                {/* Into a precomp: a quiet chevron at the row's end,
                                    not a second big button beside every row. */}
                                {l.isPrecomp && (
                                    <Tooltip text={`Look inside ${l.name}`} delay={300}>
                                        <button className="eic-drill" onClick={() => drill(l)} aria-label={`Look inside ${l.name}`}>
                                            <ChevronRight size={15} />
                                        </button>
                                    </Tooltip>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {target && (
                <div className="eic-editor">
                    <div className="eic-editor-head">
                        <span className="eic-editor-text">
                            <span className="eic-editor-title">{target.layerName}</span>
                            <span className="eic-editor-sub">
                                in {target.compName}
                                {target.locked && <span className="eic-locked"><Lock size={10} /> locked</span>}
                            </span>
                        </span>
                        {/* WHOSE NUMBERS ARE ON SCREEN. With several selected the
                            readout below is still ONE layer's — six layers have six
                            positions — so the count says how many are actually
                            moving, and the sentence says what scale does to them. */}
                        {alsoPaths.length > 0 && (
                            <Tooltip text={`Every nudge moves all ${alsoPaths.length + 1}, in one undo step. Scale changes each about its own anchor, not about a common centre. The figures are ${target.layerName}'s.`}>
                                <button type="button" className="eic-multi" onClick={() => setAlsoPaths([])} aria-label="Clear the extra layers">
                                    +{alsoPaths.length} more <X size={10} />
                                </button>
                            </Tooltip>
                        )}
                        <button type="button" className="eic-select" onClick={reveal}>
                            <Crosshair size={13} /> Select in AE
                        </button>
                    </div>

                    <div className="eic-readout">
                        <span>Position <b>{fmt2(target.position)}</b></span>
                        <span>Scale <b>{fmt2(target.scale)}</b></span>
                        {!atRoot && (
                            <Tooltip text={`How big it is drawn in ${rootName}, through every precomp above it.`}>
                                <span className="eic-readout-root">looks like <b>{fmt2(target.rootScale)}</b> on top</span>
                            </Tooltip>
                        )}
                    </div>

                    <div className="eic-controls">
                        {/* POSITION: a pad, the step size at its centre. */}
                        <div className="eic-group">
                            <span className="eic-group-label">Position{target.positionKeyed ? <em> · animated</em> : null}</span>
                            <div className={"eic-dpad" + (armed ? " eic-dpad--armed" : "")}>
                                {/* Genuinely focusable and genuinely invisible: display:none
                                    and visibility:hidden cannot hold focus, which is the
                                    whole mechanism. */}
                                <input
                                    ref={keyGrabRef}
                                    className="eic-keygrab"
                                    aria-label="Arrow-key nudge"
                                    readOnly
                                    onFocus={claimArrows}
                                    onBlur={releaseArrows}
                                    onKeyDown={(e) => {
                                        const step = amount(stepPos, e.shiftKey);
                                        if (e.key === "ArrowLeft") { e.preventDefault(); nudge("position", -step, 0); }
                                        else if (e.key === "ArrowRight") { e.preventDefault(); nudge("position", step, 0); }
                                        else if (e.key === "ArrowUp") { e.preventDefault(); nudge("position", 0, -step); }
                                        else if (e.key === "ArrowDown") { e.preventDefault(); nudge("position", 0, step); }
                                    }}
                                />
                                <span className="eic-dpad-up"><NudgeButton title="Up" disabled={target.locked} onStep={(s) => nudge("position", 0, -amount(stepPos, s))}><ArrowUp size={15} /></NudgeButton></span>
                                <span className="eic-dpad-left"><NudgeButton title="Left" disabled={target.locked} onStep={(s) => nudge("position", -amount(stepPos, s), 0)}><ArrowLeft size={15} /></NudgeButton></span>
                                <label className="eic-dpad-step" title="Step in pixels (Shift: ×10)">
                                    <input className="eic-step-in" type="text" value={stepPos} onChange={(e) => setStepPos(e.target.value)} aria-label="Position step in pixels" style={{ width: `${Math.max(1, stepPos.length) + 0.4}ch` }} />
                                    <em>px</em>
                                </label>
                                <span className="eic-dpad-right"><NudgeButton title="Right" disabled={target.locked} onStep={(s) => nudge("position", amount(stepPos, s), 0)}><ArrowRight size={15} /></NudgeButton></span>
                                <span className="eic-dpad-down"><NudgeButton title="Down" disabled={target.locked} onStep={(s) => nudge("position", 0, amount(stepPos, s))}><ArrowDown size={15} /></NudgeButton></span>
                            </div>
                            <button
                                type="button"
                                className={"eic-armbtn" + (armed ? " eic-armbtn--on" : "")}
                                disabled={target.locked}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { if (armed) { keyGrabRef.current?.blur(); } else { keyGrabRef.current?.focus(); } }}
                            >
                                <Keyboard size={12} />
                                {armed ? "Arrow keys on. Press to give them back to AE" : "Use arrow keys"}
                            </button>
                        </div>

                        {/* SCALE: − step + */}
                        <div className="eic-group">
                            <span className="eic-group-label">Scale{target.scaleKeyed ? <em> · animated</em> : null}</span>
                            <div className="eic-scale">
                                <NudgeButton title="Smaller" disabled={target.locked} onStep={(s) => nudge("scale", -amount(stepScale, s), -amount(stepScale, s))}><Minus size={15} /></NudgeButton>
                                <label className="eic-scale-step" title="Step in percent (Shift: ×10)">
                                    <input className="eic-step-in" type="text" value={stepScale} onChange={(e) => setStepScale(e.target.value)} aria-label="Scale step in percent" style={{ width: `${Math.max(1, stepScale.length) + 0.4}ch` }} />
                                    <em>%</em>
                                </label>
                                <NudgeButton title="Bigger" disabled={target.locked} onStep={(s) => nudge("scale", amount(stepScale, s), amount(stepScale, s))}><Plus size={15} /></NudgeButton>
                            </div>
                        </div>
                    </div>

                    {/* BOTH controls answer to this, so it sits under both. With
                        it on, a step is what you SEE in the top comp: the tool
                        converts through every precomp above (scale, rotation,
                        flips) -- so at a 25% precomp, 2 px on screen is 8 px
                        inside, and → still goes right on screen. The tooltip
                        says it with this layer's own numbers. */}
                    {!atRoot && (() => {
                        const factor = target.scale && target.rootScale && target.scale[0]
                            ? target.rootScale[0] / target.scale[0] : 1;
                        const pct = Math.round(factor * 1000) / 10;
                        const step = parseFloat(stepPos) || 1;
                        const inside = factor ? Math.round((step / factor) * 100) / 100 : step;
                        const onScreen = Math.round(step * factor * 100) / 100;
                        const tip = Math.abs(factor - 1) < 0.001
                            ? `${target.compName} isn't scaled here, so both give the same result. On, the arrows still follow the screen if it's rotated.`
                            : `${target.compName} is drawn at ${pct}% here. On: ${step} px moves it ${step} px on screen (${inside} px inside), and the arrows follow the screen. Off: ${step} px inside, ${onScreen} px on screen.`;
                        return (
                            <Tooltip text={tip}>
                                <span className="eic-rootspace">
                                    <CheckboxToggle checked={rootSpace} onChange={setRootSpace} label="Steps match what you see on screen" />
                                </span>
                            </Tooltip>
                        );
                    })()}
                </div>
            )}

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default EditInContextTool;
