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
    ArrowLeft, ArrowRight, ArrowUp, ArrowDown, RotateCcw, RotateCw,
    Plus, Minus, ChevronRight, Layers, Crosshair, RefreshCw, Loader2, Lock,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import CheckboxToggle from "../CheckboxToggle";
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
    const [path, setPath] = useState<number[]>([]);          // layer indices, root -> target
    const [target, setTarget] = useState<TargetState | null>(null);
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState("2");
    const [rootSpace, setRootSpace] = useState(true);

    const say = (text: string, type: "success" | "error" = "error") => setStatus({ text, type });

    const call = useCallback(async (fn: string, ...args: unknown[]) => {
        try {
            const res = await (evalTS as any)(fn, ...args);
            if (res === undefined) throw new Error("no bridge");
            return res as any;
        } catch (e) {
            say("No CEP bridge detected — open this panel inside After Effects.");
            return null;
        }
    }, []);

    // ── load the comp the artist is standing in, and its layers ─────────────
    const loadRoot = useCallback(async () => {
        setLoading(true);
        setStatus(null);
        setTarget(null);
        setPath([]);
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
        setStatus(null);
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
        setStatus(null);
    };

    // ── pick the layer to edit ──────────────────────────────────────────────
    const pick = async (layer: LayerInfo) => {
        if (!rootId) return;
        if (!layer.transformable) { say("That layer has no scale/position (camera, light or audio)."); return; }
        const full = [...path, layer.index];
        const r = await call("editInContextTarget", rootId, JSON.stringify(full));
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't read that layer."); return; }
        setTarget({
            layerName: r.layerName, compName: r.compName,
            position: r.position, scale: r.scale, rotation: r.rotation, opacity: r.opacity,
            rootScale: r.rootScale, positionKeyed: r.positionKeyed, scaleKeyed: r.scaleKeyed,
            locked: r.locked,
        });
        setPath(full);
        setStatus(null);
    };

    const amount = (shift: boolean) => {
        const n = parseFloat(step);
        const base = isNaN(n) || n === 0 ? 1 : n;
        return shift ? base * 10 : base;     // Shift = 10x, matching AE's own arrow-key convention
    };

    const nudge = async (kind: string, ax: number, ay: number) => {
        if (!rootId || !target || path.length === 0) return;
        const r = await call("editInContextNudge", rootId, JSON.stringify(path), kind, ax, ay, rootSpace);
        if (!r) return;
        if (!r.success) { say(r.error || "Nudge failed."); return; }
        setTarget((t) => t ? {
            ...t, position: r.position, scale: r.scale,
            rotation: r.rotation, opacity: r.opacity, rootScale: r.rootScale,
        } : t);
        if (r.keyed) setStatus({ text: "Property is animated — set a keyframe at the playhead.", type: "success" });
    };

    const reveal = async () => {
        if (!rootId || path.length === 0) return;
        const r = await call("editInContextReveal", rootId, JSON.stringify(path));
        if (r && r.success) say(r.message || "Selected.", "success");
        else if (r) say(r.error || "Couldn't select it.");
    };

    const atRoot = trail.length <= 1;

    return (
        <div className="form-tool eic-tool">
            <p className="eic-hint">
                Stay in the comp you're looking at and reach <strong>down</strong> into a precomp. Nudges apply
                immediately, so you watch the result in context — no diving in and out, no second viewer.
            </p>

            <div className="eic-bar">
                <div className="eic-crumbs">
                    {trail.map((c, i) => (
                        <React.Fragment key={c.compId + "-" + i}>
                            {i > 0 && <ChevronRight size={11} className="eic-crumb-sep" />}
                            <button
                                className={"eic-crumb" + (i === trail.length - 1 ? " eic-crumb--on" : "")}
                                onClick={() => goTo(i)}
                            >
                                {c.compName}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
                <button className="eic-refresh" title="Reload from the active comp" onClick={loadRoot}>
                    {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
                </button>
            </div>

            {!rootId && !loading && (
                <p className="eic-empty">Open a comp in After Effects, then hit refresh.</p>
            )}

            {rootId && (
                <div className="eic-layers">
                    {layers.length === 0 && <p className="eic-empty">This comp has no layers.</p>}
                    {layers.map((l) => {
                        const isTarget = target !== null && path.length > 0 && path[path.length - 1] === l.index && trail.length - 1 === path.length - 1;
                        return (
                            <div className={"eic-layer-row" + (isTarget ? " eic-layer-row--on" : "")} key={l.index}>
                                <button
                                    className="eic-layer-main"
                                    onClick={() => pick(l)}
                                    disabled={!l.transformable}
                                    title={l.transformable ? "Edit this layer's transform" : "No transform to edit"}
                                >
                                    <span className="eic-layer-idx">{l.index}</span>
                                    <span className="eic-layer-name">{l.name}</span>
                                    {l.isPrecomp && <span className="eic-tag">precomp</span>}
                                </button>
                                {l.isPrecomp && (
                                    <button className="eic-drill" title="Look inside" onClick={() => drill(l)}>
                                        <Layers size={12} />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {target && (
                <div className="eic-editor">
                    <div className="eic-editor-head">
                        <span className="eic-editor-title">{target.layerName}</span>
                        <span className="eic-editor-sub">in {target.compName}</span>
                        {target.locked && <span className="eic-locked"><Lock size={10} /> locked</span>}
                    </div>

                    {!atRoot && (
                        <CheckboxToggle
                            checked={rootSpace}
                            onChange={setRootSpace}
                            label={`Nudge in ${trail[0].compName} pixels`}
                        />
                    )}

                    <div className="eic-readout">
                        <span>pos <b>{fmt2(target.position)}</b></span>
                        <span>scale <b>{fmt2(target.scale)}</b></span>
                        {!atRoot && <span className="eic-readout-root">looks like <b>{fmt2(target.rootScale)}</b> in {trail[0].compName}</span>}
                    </div>

                    <div className="eic-step">
                        <label>Step</label>
                        <input type="text" value={step} onChange={(e) => setStep(e.target.value)} />
                        <span className="eic-step-note">Shift = ×10</span>
                    </div>

                    <div className="eic-group">
                        <span className="eic-group-label">Position{target.positionKeyed ? " · animated" : ""}</span>
                        <div className="eic-pad">
                            <NudgeButton title="Left" disabled={target.locked} onStep={(s) => nudge("position", -amount(s), 0)}><ArrowLeft size={14} /></NudgeButton>
                            <NudgeButton title="Up" disabled={target.locked} onStep={(s) => nudge("position", 0, -amount(s))}><ArrowUp size={14} /></NudgeButton>
                            <NudgeButton title="Down" disabled={target.locked} onStep={(s) => nudge("position", 0, amount(s))}><ArrowDown size={14} /></NudgeButton>
                            <NudgeButton title="Right" disabled={target.locked} onStep={(s) => nudge("position", amount(s), 0)}><ArrowRight size={14} /></NudgeButton>
                        </div>
                    </div>

                    <div className="eic-group">
                        <span className="eic-group-label">Scale{target.scaleKeyed ? " · animated" : ""}</span>
                        <div className="eic-pad">
                            <NudgeButton title="Smaller" disabled={target.locked} onStep={(s) => nudge("scale", -amount(s), -amount(s))}><Minus size={14} /></NudgeButton>
                            <NudgeButton title="Bigger" disabled={target.locked} onStep={(s) => nudge("scale", amount(s), amount(s))}><Plus size={14} /></NudgeButton>
                            <NudgeButton title="Rotate CCW" disabled={target.locked} onStep={(s) => nudge("rotation", -amount(s), 0)}><RotateCcw size={14} /></NudgeButton>
                            <NudgeButton title="Rotate CW" disabled={target.locked} onStep={(s) => nudge("rotation", amount(s), 0)}><RotateCw size={14} /></NudgeButton>
                        </div>
                    </div>

                    <div className="button-row">
                        <button onClick={reveal}>
                            <Crosshair size={13} /> Select it in AE
                        </button>
                    </div>
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
