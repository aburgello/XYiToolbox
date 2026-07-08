// =============================================================================
// src/js/main/MotionToolsDroplet.tsx
// -----------------------------------------------------------------------------
// "Motion Tools" -- a quick-access popover to the LEFT of the home screen's
// search box (HomeScreen.tsx), giving the layer-transform actions motion
// designers reach for constantly. Modeled on the tools people actually rate
// (Mister Horse's Motion 2, aescripts' Motion Tools Pro) rather than a port
// of any one of them -- a polished tabbed panel: Anchor, Align, Move,
// Stagger, Ease.
//
// Backend: src/jsx/aeft/motionTools.ts -- every button is a real evalTSSafe
// call on the active comp's selectedLayers (or selectedProperties, for
// Excite). No file dialogs, no master files -- pure in-comp edits.
//
// Every hover label in this panel goes through the shared <Tooltip>, not a
// native `title` attribute, for the same styled-bubble look as the rest of
// the app -- EXCEPT the tab bar, which deliberately has none: each tab
// already shows its own label right under the icon, so a bubble repeating
// the same word on hover would be pure noise, not information. Everywhere
// else (icon-only buttons: grid cells, repeat buttons, fill-row icon
// buttons) the tooltip is the only place the label lives, so it earns its
// keep. Those need Tooltip's `grow` prop when wrapping them: Tooltip's
// inner span otherwise forces flex:0 0 auto !important (needed for its own
// positioning fix, see Tooltip.tsx), which silently defeats any
// flex:1/grid-stretch sizing on the wrapped element -- that exact bug
// shipped twice here (anchor cells floating tiny, then the tab bar smashed
// to one side) before `grow` existed to fix it properly. Fixed-size
// triggers that were never meant to stretch (e.g. the Excite eraser
// button) use plain <Tooltip> without `grow`.
//
// Visual polish is Framer Motion (the app's animation standard, imported
// from "motion/react"): a sliding `layoutId` tab indicator (same technique
// as SegmentedToggle) and a per-tab pane fade/slide keyed on the active
// tab. Deliberately NO AnimatePresence mode="wait" for the panes -- that
// pattern wedges under the preview harness's rAF throttling (documented in
// CLAUDE.md); a plain key-remount fade avoids relying on exit animations
// firing at all.
//
// Nudge buttons are HOLD-TO-REPEAT (RepeatButton below): click once for one
// step, hold to keep stepping -- "click a million times" was the exact
// complaint with plain onClick buttons. A Step field sets the per-tick
// amount; Shift multiplies by 10 (AE's own arrow-key convention).
//
// The whole panel sets the shared --cat-* accent vars to Motion Tools' teal
// so SegmentedToggle/CheckboxToggle (which key off those vars) adopt the
// tool's colour instead of the generic fallback blue.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
    Move, Crosshair, ArrowRightLeft, Sparkles, Group,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Minus, Plus, RotateCcw, RotateCw,
    AlignStartVertical, AlignCenterVertical, AlignEndVertical,
    AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
    AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
    Eraser, Copy, ClipboardPaste,
} from "lucide-react";
import Droplet from "./Droplet";
import Tooltip from "./Tooltip";
import SegmentedToggle from "./SegmentedToggle";
import CheckboxToggle from "./CheckboxToggle";
import { evalTSSafe } from "../lib/utils/evalTSSafe";
import "./MotionToolsDroplet.scss";

type Tab = "anchor" | "align" | "transform" | "sequence" | "ease";

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "anchor",    label: "Anchor",  Icon: Crosshair },
    { id: "align",     label: "Align",   Icon: AlignCenterHorizontal },
    { id: "transform", label: "Move",    Icon: Move },
    { id: "sequence",  label: "Stagger", Icon: ArrowRightLeft },
    { id: "ease",      label: "Ease",    Icon: Sparkles },
];

const ANCHOR_GRID: { relX: number; relY: number; label: string }[] = [
    { relX: 0,   relY: 0,   label: "Top Left" },
    { relX: 0.5, relY: 0,   label: "Top Center" },
    { relX: 1,   relY: 0,   label: "Top Right" },
    { relX: 0,   relY: 0.5, label: "Middle Left" },
    { relX: 0.5, relY: 0.5, label: "Center" },
    { relX: 1,   relY: 0.5, label: "Middle Right" },
    { relX: 0,   relY: 1,   label: "Bottom Left" },
    { relX: 0.5, relY: 1,   label: "Bottom Center" },
    { relX: 1,   relY: 1,   label: "Bottom Right" },
];

const EASE_PROPERTIES = [
    { value: "position", label: "Pos" },
    { value: "scale", label: "Scale" },
    { value: "rotation", label: "Rot" },
    { value: "opacity", label: "Opac" },
];

// Teal accent, fed into the shared --cat-* vars so SegmentedToggle /
// CheckboxToggle pick it up. Mirrors MotionToolsDroplet.scss's $mt-accent.
const MT_ACCENT_VARS: React.CSSProperties = {
    ["--cat-grad" as any]: "linear-gradient(135deg, #2b8f85 0%, #1c6b63 100%)",
    ["--cat-border" as any]: "#4fd1c5",
    ["--cat-glow" as any]: "rgba(79, 209, 197, 0.35)",
    ["--cat-icon" as any]: "#7fe0d8",
};

// Hold-to-repeat: fires once on press, then after an initial delay keeps
// firing while held. Repeat ticks are gated on the previous evalTS call
// having settled (`busyRef`) so a slow bridge doesn't pile up a queue of
// stale nudges that keep applying after the pointer is released.
//
// Mouse events, not Pointer events -- deliberately. This used to be
// onPointerDown/Up/Leave/Cancel, which silently did nothing at all when
// clicked inside a real macOS AE CEP panel (confirmed: worked fine when
// the exact same panel was mirrored through a separate Chrome DevTools
// remote-debug window, which is a full modern Chrome renderer, not the
// panel's own embedded CEF host) -- every OTHER button in this panel
// uses plain onClick and worked on the same machine, and onClick is
// itself built on mouse-event dispatch, so mouse events are the known-
// working input path for this panel host. Pointer events are the more
// "correct" modern API, but they're not the one this app can rely on --
// don't switch back without confirming on a real macOS AE panel first.
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 90;

const RepeatButton: React.FC<{
    title: string;
    onStep: (shiftKey: boolean) => Promise<void> | void;
    children: React.ReactNode;
}> = ({ title, onStep, children }) => {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const busyRef = useRef(false);

    const fire = async (shiftKey: boolean) => {
        if (busyRef.current) return;
        busyRef.current = true;
        try { await onStep(shiftKey); } finally { busyRef.current = false; }
    };

    const stop = () => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };

    useEffect(() => stop, []);

    return (
        <Tooltip text={title} grow>
            <button
                className="mt-icon-btn"
                onMouseDown={(e) => {
                    const shiftKey = e.shiftKey; // captured at press; a hold keeps using it
                    fire(shiftKey);
                    timerRef.current = setTimeout(() => {
                        intervalRef.current = setInterval(() => fire(shiftKey), REPEAT_INTERVAL_MS);
                    }, REPEAT_DELAY_MS);
                }}
                onMouseUp={stop}
                onMouseLeave={stop}
            >
                {children}
            </button>
        </Tooltip>
    );
};

const MotionToolsDroplet: React.FC = () => {
    const reduced = useReducedMotion();
    const [tab, setTab] = useState<Tab>("anchor");
    const [error, setError] = useState<string | null>(null);
    const [easeProperty, setEaseProperty] = useState("position");
    const [alignTo, setAlignTo] = useState("comp");
    const [seqFrames, setSeqFrames] = useState("2");
    const [seqReverse, setSeqReverse] = useState(false);
    const [exciteStrength, setExciteStrength] = useState(5);
    const [nudgeStep, setNudgeStep] = useState("1");
    // Held in React state, not app.settings -- a copied ease is meant to
    // live only as long as this session/panel is open, same lifetime as an
    // OS clipboard copy, not a persisted preference.
    const [copiedEase, setCopiedEase] = useState<Record<string, unknown> | null>(null);

    // Centralised call + error surface for every action -- same "no bridge /
    // thrown exception -> inline message" reasoning as this app's other
    // droplets, just a local error line instead of a shared toast stack.
    const run = async (fnName: string, ...args: any[]) => {
        setError(null);
        const result = await evalTSSafe(fnName as any, ...args);
        if (!result.success) setError(result.error || "Something went wrong.");
    };

    const handleCopyEase = async () => {
        setError(null);
        const result = await evalTSSafe("motionToolsCopyEase", easeProperty);
        if (!result.success) { setError(result.error || "Something went wrong."); return; }
        setCopiedEase((result.ease as Record<string, unknown>) || null);
    };

    const handlePasteEase = async () => {
        if (!copiedEase) return;
        setError(null);
        const result = await evalTSSafe("motionToolsPasteEase", easeProperty, copiedEase as any);
        if (!result.success) setError(result.error || "Something went wrong.");
    };

    // Per-tick nudge amount: the Step field's value, x10 with Shift held.
    const stepAmount = (shiftKey: boolean) => {
        const base = parseFloat(nudgeStep) || 1;
        return shiftKey ? base * 10 : base;
    };

    const alignBtn = (edge: string, label: string, Icon: React.ComponentType<{ size?: number }>) => (
        <Tooltip key={edge} text={label} grow>
            <button className="mt-icon-btn" onClick={() => run("motionToolsAlign", edge, alignTo)}>
                <Icon size={15} />
            </button>
        </Tooltip>
    );

    const paneTransition = reduced ? { duration: 0 } : { duration: 0.18, ease: "easeOut" as const };

    return (
        <Droplet
            panelClassName="motion-tools-panel"
            trigger={({ open, toggle }) => (
                <Tooltip text="XYTools">
                    <button className={"favorites-toggle" + (open ? " active" : "")} onClick={toggle}>
                        <Move size={14} />
                    </button>
                </Tooltip>
            )}
        >
            {() => (
                <div className="mt-droplet-body" style={MT_ACCENT_VARS}>
                    <div className="mt-droplet-head">
                        <span className="mt-droplet-head-icon"><Move size={13} /></span>
                        <span>Motion Tools</span>
                    </div>

                    {/* No Tooltip here -- each tab already shows its own
                        label right under the icon, so a hover bubble
                        repeating the same word would be pure noise. The
                        active pill is a shared-layout motion.span that
                        slides between tabs. */}
                    <div className="mt-tabs" role="tablist">
                        {TABS.map(({ id, label, Icon }) => (
                            <button
                                key={id}
                                role="tab"
                                aria-selected={tab === id}
                                className={"mt-tab" + (tab === id ? " active" : "")}
                                onClick={() => { setTab(id); setError(null); }}
                            >
                                {tab === id && (
                                    <motion.span
                                        className="mt-tab-ind"
                                        layoutId="mt-tab-ind"
                                        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
                                    />
                                )}
                                <span className="mt-tab-inner">
                                    <Icon size={16} />
                                    <span className="mt-tab-label">{label}</span>
                                </span>
                            </button>
                        ))}
                    </div>

                    <div className="mt-tab-content">
                        <motion.div
                            key={tab}
                            className="mt-tab-pane"
                            initial={reduced ? false : { opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={paneTransition}
                        >
                            {tab === "anchor" && (
                                <div className="mt-section">
                                    <div className="mt-section-label">Snap Anchor Point</div>
                                    <div className="mt-anchor-grid">
                                        {ANCHOR_GRID.map((cell) => (
                                            <Tooltip key={cell.label} text={cell.label} grow>
                                                <button
                                                    className={"mt-anchor-cell" + (cell.relX === 0.5 && cell.relY === 0.5 ? " mt-anchor-cell--center" : "")}
                                                    onClick={() => run("motionToolsSnapAnchor", cell.relX, cell.relY)}
                                                >
                                                    <span className="mt-anchor-dot" />
                                                </button>
                                            </Tooltip>
                                        ))}
                                    </div>
                                    <p className="mt-hint">Moves the anchor without shifting the layer.</p>
                                </div>
                            )}

                            {tab === "align" && (
                                <div className="mt-section">
                                    <div className="mt-section-label">Align to</div>
                                    <SegmentedToggle
                                        name="mt-align-to"
                                        value={alignTo}
                                        onChange={setAlignTo}
                                        options={[{ value: "comp", label: "Composition" }, { value: "selection", label: "Selection" }]}
                                    />
                                    <div className="mt-row mt-row--fill">
                                        {alignBtn("left", "Align Left", AlignStartVertical)}
                                        {alignBtn("hcenter", "Align Center", AlignCenterVertical)}
                                        {alignBtn("right", "Align Right", AlignEndVertical)}
                                        <span className="mt-divider" />
                                        {alignBtn("top", "Align Top", AlignStartHorizontal)}
                                        {alignBtn("vcenter", "Align Middle", AlignCenterHorizontal)}
                                        {alignBtn("bottom", "Align Bottom", AlignEndHorizontal)}
                                    </div>
                                    <div className="mt-section-label mt-section-label--sub">Distribute · Group</div>
                                    <div className="mt-row mt-row--fill">
                                        <Tooltip text="Distribute Horizontally (3+ layers)" grow>
                                            <button className="mt-icon-btn" onClick={() => run("motionToolsDistribute", "horizontal")}>
                                                <AlignHorizontalDistributeCenter size={15} />
                                            </button>
                                        </Tooltip>
                                        <Tooltip text="Distribute Vertically (3+ layers)" grow>
                                            <button className="mt-icon-btn" onClick={() => run("motionToolsDistribute", "vertical")}>
                                                <AlignVerticalDistributeCenter size={15} />
                                            </button>
                                        </Tooltip>
                                        <span className="mt-divider" />
                                        <button className="mt-text-btn mt-text-btn--grow" onClick={() => run("motionToolsGroup")}>
                                            <Group size={14} /> Group into Null
                                        </button>
                                    </div>
                                </div>
                            )}

                            {tab === "transform" && (
                                <div className="mt-section">
                                    <div className="mt-transform-toolbar">
                                        <label className="mt-field mt-field--step">
                                            <span>Step</span>
                                            <input type="number" min="0" value={nudgeStep} onChange={(e) => setNudgeStep(e.target.value)} />
                                        </label>
                                        <span className="mt-shift-hint">hold to repeat · Shift ×10</span>
                                    </div>

                                    <div className="mt-section-label mt-section-label--sub">Position</div>
                                    <div className="mt-row mt-row--fill">
                                        <RepeatButton title="Left" onStep={(s) => run("motionToolsNudgePosition", -stepAmount(s), 0)}><ArrowLeft size={15} /></RepeatButton>
                                        <RepeatButton title="Right" onStep={(s) => run("motionToolsNudgePosition", stepAmount(s), 0)}><ArrowRight size={15} /></RepeatButton>
                                        <RepeatButton title="Up" onStep={(s) => run("motionToolsNudgePosition", 0, -stepAmount(s))}><ArrowUp size={15} /></RepeatButton>
                                        <RepeatButton title="Down" onStep={(s) => run("motionToolsNudgePosition", 0, stepAmount(s))}><ArrowDown size={15} /></RepeatButton>
                                    </div>

                                    <div className="mt-section-label mt-section-label--sub">Scale · Rotate · Opacity</div>
                                    <div className="mt-row mt-row--fill">
                                        <RepeatButton title="Scale down" onStep={(s) => run("motionToolsNudgeScale", -stepAmount(s))}><Minus size={15} /></RepeatButton>
                                        <RepeatButton title="Scale up" onStep={(s) => run("motionToolsNudgeScale", stepAmount(s))}><Plus size={15} /></RepeatButton>
                                        <span className="mt-divider" />
                                        <RepeatButton title="Rotate CCW" onStep={(s) => run("motionToolsNudgeRotation", -stepAmount(s))}><RotateCcw size={15} /></RepeatButton>
                                        <RepeatButton title="Rotate CW" onStep={(s) => run("motionToolsNudgeRotation", stepAmount(s))}><RotateCw size={15} /></RepeatButton>
                                        <span className="mt-divider" />
                                        <RepeatButton title="Opacity down" onStep={(s) => run("motionToolsNudgeOpacity", -stepAmount(s))}><Minus size={15} /></RepeatButton>
                                        <RepeatButton title="Opacity up" onStep={(s) => run("motionToolsNudgeOpacity", stepAmount(s))}><Plus size={15} /></RepeatButton>
                                    </div>
                                </div>
                            )}

                            {tab === "sequence" && (
                                <div className="mt-section">
                                    <div className="mt-section-label">Stagger in Time</div>
                                    <div className="mt-seq-row">
                                        <label className="mt-field">
                                            <span>Offset</span>
                                            <input type="number" value={seqFrames} onChange={(e) => setSeqFrames(e.target.value)} />
                                            <span className="mt-field-unit">frames</span>
                                        </label>
                                    </div>
                                    <div className="mt-seq-row">
                                        <CheckboxToggle checked={seqReverse} onChange={setSeqReverse} label="Reverse order" />
                                    </div>
                                    <button className="mt-primary-btn" onClick={() => run("motionToolsSequence", parseFloat(seqFrames) || 0, seqReverse)}>
                                        <ArrowRightLeft size={14} /> Sequence Layers
                                    </button>
                                    <p className="mt-hint">Cascades selected layers in time, top to bottom.</p>
                                </div>
                            )}

                            {tab === "ease" && (
                                <div className="mt-section">
                                    <div className="mt-section-label">Easy Ease</div>
                                    <SegmentedToggle name="mt-ease-prop" value={easeProperty} onChange={setEaseProperty} options={EASE_PROPERTIES} />
                                    <div className="mt-row mt-row-ease">
                                        <button className="mt-ease-btn" onClick={() => run("motionToolsApplyEase", easeProperty, "in")}>In</button>
                                        <button className="mt-ease-btn" onClick={() => run("motionToolsApplyEase", easeProperty, "out")}>Out</button>
                                        <button className="mt-ease-btn" onClick={() => run("motionToolsApplyEase", easeProperty, "both")}>Both</button>
                                    </div>

                                    <div className="mt-section-label mt-section-label--sub">Copy Ease</div>
                                    <div className="mt-row mt-row-ease">
                                        <Tooltip text="Copy this keyframe's ease" grow>
                                            <button className="mt-text-btn mt-text-btn--grow" onClick={handleCopyEase}>
                                                <Copy size={13} /> Copy
                                            </button>
                                        </Tooltip>
                                        <Tooltip text={copiedEase ? "Paste the copied ease onto the selected keyframe(s)" : "Copy an ease first"} grow>
                                            <button
                                                className="mt-text-btn mt-text-btn--grow"
                                                disabled={!copiedEase}
                                                onClick={handlePasteEase}
                                            >
                                                <ClipboardPaste size={13} /> Paste
                                            </button>
                                        </Tooltip>
                                    </div>
                                    {copiedEase && <p className="mt-hint mt-hint--copied">Ease copied -- paste onto any other keyframe(s).</p>}

                                    <div className="mt-section-label mt-section-label--sub">Excite</div>
                                    <label className="mt-slider-row">
                                        <span>Strength</span>
                                        <input
                                            type="range"
                                            min={1}
                                            max={10}
                                            value={exciteStrength}
                                            onChange={(e) => setExciteStrength(parseInt(e.target.value, 10))}
                                            className="mt-slider"
                                        />
                                        <span className="mt-slider-value">{exciteStrength}</span>
                                    </label>
                                    <div className="mt-row mt-row-ease">
                                        <button className="mt-ease-btn" onClick={() => run("motionToolsExcite", "overshoot", exciteStrength)}>Overshoot</button>
                                        <button className="mt-ease-btn" onClick={() => run("motionToolsExcite", "bounce", exciteStrength)}>Bounce</button>
                                        <Tooltip text="Remove expression from the selected properties">
                                            <button className="mt-ease-btn mt-ease-btn--remove" onClick={() => run("motionToolsExciteRemove")}>
                                                <Eraser size={13} />
                                            </button>
                                        </Tooltip>
                                    </div>
                                    <p className="mt-hint">
                                        Select an animated property (2+ keyframes), then apply. The spring rings
                                        out <em>after the last keyframe</em> — scrub past it to see it.
                                    </p>
                                </div>
                            )}
                        </motion.div>
                    </div>

                    {error && <p className="mt-error">{error}</p>}
                </div>
            )}
        </Droplet>
    );
};

export default MotionToolsDroplet;
