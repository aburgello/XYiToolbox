// =============================================================================
// src/js/main/XYToolsDroplet.tsx
// -----------------------------------------------------------------------------
// "XYTools" -- a quick-access popover to the LEFT of the home screen's
// search box (HomeScreen.tsx), giving the layer-transform actions motion
// designers reach for constantly. Modeled on the tools people actually rate
// (Mister Horse's Motion 2, aescripts' Motion Tools Pro) rather than a port
// of any one of them -- a polished tabbed panel: Anchor, Align, Fit, Move,
// Stagger, Ease.
//
// NAMING: the panel was called "Motion Tools" while it was being built and
// was renamed to XYTools (studio branding). Only the USER-FACING strings and
// this file's own name changed -- the ExtendScript bridge functions are still
// `motionTools*` (src/jsx/aeft/motionTools.ts) and the ease presets still
// persist under the app.settings key "MotionToolsEasePresets". Renaming
// either would be churn with a real cost: the settings key in particular is
// live on artists' machines, and changing it would silently orphan every
// preset they've already saved. Don't "finish" the rename there.
//
// Backend: src/jsx/aeft/motionTools.ts -- every button is a real evalTSSafe
// call on the active comp's selectedLayers (or selectedProperties, for
// Excite/Reverse Keyframes). No file dialogs, no master files -- pure in-comp
// edits.
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
// The whole panel sets the shared --cat-* accent vars to XYTools' teal
// so SegmentedToggle/CheckboxToggle (which key off those vars) adopt the
// tool's colour instead of the generic fallback blue.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
    Move, Crosshair, ArrowRightLeft, Sparkles, Group, Maximize,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Minus, Plus, RotateCcw, RotateCw,
    AlignStartVertical, AlignCenterVertical, AlignEndVertical,
    AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
    AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
    FlipHorizontal, FlipVertical,
    Eraser, Copy, ClipboardPaste, BookmarkPlus, Trash2, Undo2,
    ArrowRightToLine, ArrowLeftToLine,
} from "lucide-react";
import Droplet from "./Droplet";
import Tooltip from "./Tooltip";
import SegmentedToggle from "./SegmentedToggle";
import CheckboxToggle from "./CheckboxToggle";
import { evalTSSafe } from "../lib/utils/evalTSSafe";
import "./XYToolsDroplet.scss";

type Tab = "anchor" | "align" | "fit" | "transform" | "sequence" | "ease";

interface EasePresetDTO {
    id: string;
    name: string;
    isBuiltIn: boolean;
    // Already present in the bridge payload -- motionToolsListEasePresets
    // returns whole EasePreset objects -- just never declared here before.
    // Optional/defensive: a payload without them still renders (as linear).
    inInfluence?: number;
    outInfluence?: number;
}

// AE temporal ease -> CSS cubic-bezier, derived from the SAME influence values
// the preset actually applies, so a preview can never drift from the result.
// A preset is ONE ease shape applied to every target key, so a two-key segment
// leaves the start key on its OUT ease and arrives at the end key on its IN
// ease -- exactly cubic-bezier(outInf, 0, 1 - inInf, 1). Preset speed is always
// 0 (see motionToolsSaveEasePreset's speed normalisation), so both handles are
// horizontal and y stays 0/1. Sanity: Linear 0/0 -> (0,0,1,1); Standard 33/33
// -> (0.33,0,0.67,1); Strong 75/75 -> (0.75,0,0.25,1).
const easeCurve = (p: EasePresetDTO): string => {
    const clamp01 = (n: number) => (isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
    const x1 = clamp01((p.outInfluence ?? 0) / 100);
    const x2 = 1 - clamp01((p.inInfluence ?? 0) / 100);
    return "cubic-bezier(" + x1.toFixed(3) + ", 0, " + x2.toFixed(3) + ", 1)";
};

// A tiny looping demo of what each preset actually does -- a dot crossing a
// track on that preset's own curve. The idea is lifted from Rebound's animated
// tool cards, but GENERATED from preset data rather than hand-authored art, so
// it covers user-saved presets too and stays truthful for free.
// Pure CSS animation, deliberately not Framer/GSAP: nothing here can stall
// under CEP's flaky rAF (the bug class that plagued the screen transitions),
// and the droplet only exists while it's open, so looping costs nothing at
// rest -- no conflict with this app's "no perpetual motion on always-visible
// surfaces" rule.
const EasePreview: React.FC<{ preset: EasePresetDTO }> = ({ preset }) => (
    <span className="mt-ease-preview" aria-hidden="true">
        <span className="mt-ease-preview-dot" style={{ animationTimingFunction: easeCurve(preset) }} />
    </span>
);

// --- Excite preview ----------------------------------------------------------
// Same generated-from-real-values idea as EasePreview, but a damped oscillation
// can't be expressed as one cubic-bezier -- so the ring-out is SAMPLED into a
// @keyframes rule generated at runtime and injected once per (type, strength)
// combo (max 20 tiny rules, lazily). The freq/decay constants are copied from
// motionTools.ts's exciteExpression() -- the preview is a truthful miniature of
// the exact expression the button will attach, including how the Strength
// slider changes it. Keep the two formula copies in sync.
// Still a plain CSS animation once injected (no rAF fragility); dynamic
// generation is only used because strength is a live slider value.
const EXCITE_PREVIEW_DUR_S = 1.8; // keep in sync with .mt-excite-preview-dot's animation-duration
const EXCITE_TARGET_PX = 18;      // travel to the "last keyframe" tick
const EXCITE_AMP_PX = 8;          // ring-out amplitude (fits the 34px track: 1+6+18+8=33)

const exciteKfInjected: { [name: string]: true } = {};
function exciteAnimationName(type: "overshoot" | "bounce", strength: number): string {
    const s = Math.max(1, Math.min(10, Math.round(strength) || 1));
    const name = "mt-excite-" + type + "-" + s;
    if (exciteKfInjected[name]) return name;

    // exciteExpression()'s own constants (motionTools.ts) -- do not retune here.
    const freq = (type === "bounce" ? 1.5 : 2.0) + s * 0.4;
    const decay = Math.max(1, (type === "bounce" ? 9 : 10) - s * 0.7);
    const w = freq * Math.PI * 2;

    const travelEnd = 0.18; // fraction of the loop spent travelling to the tick
    const ringEnd = 0.93;
    const ringSec = EXCITE_PREVIEW_DUR_S * (ringEnd - travelEnd);
    const frames: string[] = [
        // accelerate INTO the last key, like the real keyframed move the
        // expression rings out of
        "0% { transform: translateX(0); opacity: 1; animation-timing-function: cubic-bezier(0.6, 0, 1, 1); }",
        (travelEnd * 100).toFixed(1) + "% { transform: translateX(" + EXCITE_TARGET_PX + "px); animation-timing-function: linear; }",
    ];
    const SAMPLES = 26;
    for (let i = 1; i <= SAMPLES; i++) {
        const t = (ringSec * i) / SAMPLES;
        // overshoot: signed sine, swings BOTH sides of the tick;
        // bounce: abs(sine), pokes past and returns from ONE side -- the same
        // one-line difference the two expressions have.
        const osc = type === "bounce" ? Math.abs(Math.sin(t * w)) : Math.sin(t * w);
        const x = EXCITE_TARGET_PX + EXCITE_AMP_PX * osc * Math.exp(-decay * t);
        const pct = (travelEnd + (ringEnd - travelEnd) * (i / SAMPLES)) * 100;
        frames.push(pct.toFixed(2) + "% { transform: translateX(" + x.toFixed(2) + "px); }");
    }
    // settle on the tick, fade out there, reappear at the start -- the loop
    // restart never reads as a teleport
    frames.push("96% { transform: translateX(" + EXCITE_TARGET_PX + "px); opacity: 1; }");
    frames.push("98.5% { transform: translateX(" + EXCITE_TARGET_PX + "px); opacity: 0; }");
    frames.push("98.6% { transform: translateX(0); opacity: 0; }");
    frames.push("100% { transform: translateX(0); opacity: 1; }");

    let styleEl = document.getElementById("mt-excite-keyframes") as HTMLStyleElement | null;
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "mt-excite-keyframes";
        document.head.appendChild(styleEl);
    }
    // The <style> element outlives a dev-HMR module swap while the injected-set
    // resets with the module -- re-check the element itself so a swap doesn't
    // append duplicate (identical) rules.
    if ((styleEl.textContent || "").indexOf("@keyframes " + name + " ") === -1) {
        styleEl.appendChild(document.createTextNode("@keyframes " + name + " { " + frames.join(" ") + " }"));
    }
    exciteKfInjected[name] = true;
    return name;
}

const ExcitePreview: React.FC<{ type: "overshoot" | "bounce"; strength: number }> = ({ type, strength }) => (
    <span className="mt-excite-preview" aria-hidden="true">
        <span className="mt-excite-preview-tick" />
        <span className="mt-excite-preview-dot" style={{ animationName: exciteAnimationName(type, strength) }} />
    </span>
);

// --- Fit preview -------------------------------------------------------------
// A tiny frame with a "photo" (rect + round subject) morphing to each mode's
// real result. Values are the honest cover/contain/stretch math for a 10x8
// source in the frame's 22x13 interior (see the SCSS keyframes): Fill crops
// against the frame's overflow, Fit letterboxes, Stretch squashes the subject
// circle into an ellipse -- the distortion IS the explanation. Static keyframes
// in the stylesheet; nothing dynamic per instance beyond the mode class.
const FitPreview: React.FC<{ mode: "cover" | "contain" | "stretch" }> = ({ mode }) => (
    <span className={"mt-fit-preview mt-fit-preview--" + mode} aria-hidden="true">
        <span className="mt-fit-preview-rect">
            <span className="mt-fit-preview-subject" />
        </span>
    </span>
);

// --- Stagger preview ---------------------------------------------------------
// Three bars sliding in one after another. The stagger itself is just
// animation-delay: with an infinite loop, per-bar delays hold as a permanent
// phase shift, so the cascade repeats without any JS sequencing. Reverse order
// flips which bar leads -- driven by the same seqReverse state the real
// Sequence call uses.
const StaggerPreview: React.FC<{ reverse: boolean }> = ({ reverse }) => (
    <span className="mt-stagger-preview" aria-hidden="true">
        {[0, 1, 2].map((i) => (
            <span
                key={i}
                className="mt-stagger-preview-bar"
                style={{ animationDelay: ((reverse ? 2 - i : i) * 0.22).toFixed(2) + "s" }}
            />
        ))}
    </span>
);

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "anchor",    label: "Anchor",  Icon: Crosshair },
    { id: "align",     label: "Align",   Icon: AlignCenterHorizontal },
    { id: "fit",       label: "Fit",     Icon: Maximize },
    { id: "transform", label: "Move",    Icon: Move },
    { id: "sequence",  label: "Time",    Icon: ArrowRightLeft },
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

// Teal accent, fed into the shared --cat-* vars so SegmentedToggle /
// CheckboxToggle pick it up. Mirrors XYToolsDroplet.scss's $mt-accent.
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

const XYToolsDroplet: React.FC = () => {
    const reduced = useReducedMotion();
    const [tab, setTab] = useState<Tab>("anchor");
    const [error, setError] = useState<string | null>(null);
    const [alignTo, setAlignTo] = useState("comp");
    const [seqFrames, setSeqFrames] = useState("2");
    const [seqReverse, setSeqReverse] = useState(false);
    const [exciteStrength, setExciteStrength] = useState(5);
    const [nudgeStep, setNudgeStep] = useState("1");
    // Held in React state, not app.settings -- a copied ease is meant to
    // live only as long as this session/panel is open, same lifetime as an
    // OS clipboard copy, not a persisted preference. This is an ARRAY of
    // per-keyframe eases (one entry per selected source keyframe), so a
    // multi-keyframe ease profile pastes key-for-key.
    const [copiedKeys, setCopiedKeys] = useState<unknown[] | null>(null);
    // Last copy/paste confirmation from the backend (which key(s) it read /
    // wrote, and whether it used the timeline selection or the playhead-
    // nearest fallback). This IS the fix for "paste does nothing": paste was
    // silently succeeding onto a key the user wasn't looking at -- this makes
    // what it did visible.
    const [easeStatus, setEaseStatus] = useState<string | null>(null);
    // Built-in + user-saved ease presets (single ease shapes, applied to
    // every selected target key at once -- see motionToolsApplyEasePreset).
    // Loaded once on mount rather than lazily on first Ease-tab visit: it's
    // one cheap evalTSSafe call reading app.settings, and having the list
    // ready the instant the Ease tab is opened beats a load flicker there.
    const [presets, setPresets] = useState<EasePresetDTO[]>([]);
    const [presetName, setPresetName] = useState("");

    // Centralised call + error surface for every action -- same "no bridge /
    // thrown exception -> inline message" reasoning as this app's other
    // droplets, just a local error line instead of a shared toast stack.
    const run = async (fnName: string, ...args: any[]) => {
        setError(null);
        const result = await evalTSSafe(fnName as any, ...args);
        if (!result.success) setError(result.error || "Something went wrong.");
    };

    useEffect(() => {
        evalTSSafe("motionToolsListEasePresets").then((result) => {
            if (result.success) setPresets((result.presets as EasePresetDTO[]) || []);
        });
    }, []);

    const handleCopyEase = async () => {
        setError(null);
        setEaseStatus(null);
        // Fully generic now -- no property argument. The backend reads
        // whatever's actually selected in the Timeline/Graph Editor
        // (comp.selectedProperties), so this works on Position just as well
        // as Mask Path, an effect's own parameter, a Text Animator property,
        // anything with keyframes. See motionToolsCopyEase's comment.
        const result = await evalTSSafe("motionToolsCopyEase");
        if (!result.success) { setError(result.error || "Something went wrong."); return; }
        setCopiedKeys((result.keys as unknown[]) || null);
        setEaseStatus((result.message as string) || "Ease copied.");
    };

    const handlePasteEase = async () => {
        if (!copiedKeys) return;
        setError(null);
        setEaseStatus(null);
        // Pass the copied eases as a JSON STRING, not a nested array/object.
        // evalTS splices JSON.stringify(arg) into the ExtendScript source, and
        // a nested array-of-objects arrives there as a source-code literal
        // whose inner speed/influence values were silently dropped -- which
        // made paste apply AE's DEFAULT ease. A string survives the splice
        // intact and motionToolsPasteEase JSON.parses it back. See that fn.
        // Also fully generic now -- pastes onto whatever property/properties
        // are currently selected, batching across all of them at once.
        const result = await evalTSSafe("motionToolsPasteEase", JSON.stringify(copiedKeys));
        if (!result.success) { setError(result.error || "Something went wrong."); return; }
        setEaseStatus((result.message as string) || "Ease pasted.");
    };

    const handleApplyPreset = async (id: string) => {
        setError(null);
        setEaseStatus(null);
        const result = await evalTSSafe("motionToolsApplyEasePreset", id);
        if (!result.success) { setError(result.error || "Something went wrong."); return; }
        setEaseStatus((result.message as string) || "Preset applied.");
    };

    const handleSavePreset = async () => {
        const name = presetName.trim();
        if (!name || !copiedKeys) return;
        setError(null);
        const result = await evalTSSafe("motionToolsSaveEasePreset", name, JSON.stringify(copiedKeys));
        if (!result.success) { setError(result.error || "Something went wrong."); return; }
        setPresets((result.presets as EasePresetDTO[]) || []);
        setPresetName("");
        setEaseStatus("Saved \"" + name + "\" as a preset.");
    };

    const handleDeletePreset = async (id: string) => {
        setError(null);
        const result = await evalTSSafe("motionToolsDeleteEasePreset", id);
        if (!result.success) { setError(result.error || "Something went wrong."); return; }
        setPresets((result.presets as EasePresetDTO[]) || []);
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
            panelClassName="xytools-panel"
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
                        <span>XYTools</span>
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
                                onClick={() => { setTab(id); setError(null); setEaseStatus(null); }}
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

                            {tab === "fit" && (
                                <div className="mt-section">
                                    <div className="mt-section-label">Fit to Composition</div>
                                    <div className="mt-row mt-row--fill">
                                        <button className="mt-text-btn mt-text-btn--grow" onClick={() => run("motionToolsFit", "cover")}>
                                            <FitPreview mode="cover" /> Fill
                                        </button>
                                        <button className="mt-text-btn mt-text-btn--grow" onClick={() => run("motionToolsFit", "contain")}>
                                            <FitPreview mode="contain" /> Fit
                                        </button>
                                        <button className="mt-text-btn mt-text-btn--grow" onClick={() => run("motionToolsFit", "stretch")}>
                                            <FitPreview mode="stretch" /> Stretch
                                        </button>
                                    </div>
                                    <p className="mt-hint">
                                        <strong>Fill</strong> covers the frame (crops the overflow),
                                        <strong> Fit</strong> sits inside it, <strong>Stretch</strong> hits
                                        the exact size and distorts. All three re-center the layer.
                                    </p>

                                    <div className="mt-section-label mt-section-label--sub">Flip</div>
                                    <div className="mt-row mt-row--fill">
                                        <button className="mt-text-btn mt-text-btn--grow" onClick={() => run("motionToolsFlip", "horizontal")}>
                                            <FlipHorizontal size={13} /> Horizontal
                                        </button>
                                        <button className="mt-text-btn mt-text-btn--grow" onClick={() => run("motionToolsFlip", "vertical")}>
                                            <FlipVertical size={13} /> Vertical
                                        </button>
                                    </div>
                                    <p className="mt-hint">Flips around the anchor point — set that first on the Anchor tab.</p>
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
                                    <div className="mt-section-label">
                                        Stagger in Time
                                        <StaggerPreview reverse={seqReverse} />
                                    </div>
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

                                    <div className="mt-section-label mt-section-label--sub">Keyframes · Trim</div>
                                    <div className="mt-row mt-row--fill">
                                        <Tooltip text="Reverse the selected keyframes (or every animated property on the selected layers)" grow>
                                            <button className="mt-text-btn mt-text-btn--grow" onClick={() => run("motionToolsReverseKeyframes")}>
                                                <Undo2 size={13} /> Reverse Keys
                                            </button>
                                        </Tooltip>
                                        <span className="mt-divider" />
                                        <Tooltip text="Trim layer In to the playhead" grow>
                                            <button className="mt-icon-btn" onClick={() => run("motionToolsTrim", "in")}>
                                                <ArrowRightToLine size={15} />
                                            </button>
                                        </Tooltip>
                                        <Tooltip text="Trim layer Out to the playhead" grow>
                                            <button className="mt-icon-btn" onClick={() => run("motionToolsTrim", "out")}>
                                                <ArrowLeftToLine size={15} />
                                            </button>
                                        </Tooltip>
                                    </div>
                                    <p className="mt-hint">
                                        Reverse mirrors keys about the span they already occupy — the animation
                                        plays backwards without moving in the timeline.
                                    </p>
                                </div>
                            )}

                            {tab === "ease" && (
                                <div className="mt-section">
                                    <div className="mt-section-label">Easy Ease</div>
                                    <div className="mt-row mt-row-ease">
                                        <button className="mt-ease-btn" onClick={() => run("motionToolsApplyEase", "in")}>In</button>
                                        <button className="mt-ease-btn" onClick={() => run("motionToolsApplyEase", "out")}>Out</button>
                                        <button className="mt-ease-btn" onClick={() => run("motionToolsApplyEase", "both")}>Both</button>
                                    </div>

                                    <div className="mt-section-label mt-section-label--sub">Copy Ease</div>
                                    <div className="mt-row mt-row-ease">
                                        <Tooltip text="Copy the selected property's keyframe ease" grow>
                                            <button className="mt-text-btn mt-text-btn--grow" onClick={handleCopyEase}>
                                                <Copy size={13} /> Copy
                                            </button>
                                        </Tooltip>
                                        <Tooltip text={copiedKeys ? "Paste the copied ease onto the selected keyframe(s), any property" : "Copy an ease first"} grow>
                                            <button
                                                className="mt-text-btn mt-text-btn--grow"
                                                disabled={!copiedKeys}
                                                onClick={handlePasteEase}
                                            >
                                                <ClipboardPaste size={13} /> Paste
                                            </button>
                                        </Tooltip>
                                    </div>
                                    {easeStatus && <p className="mt-hint mt-hint--copied">{easeStatus}</p>}
                                    {!easeStatus && copiedKeys && <p className="mt-hint mt-hint--copied">Ease copied -- select the target keyframe(s) on any property, then Paste.</p>}

                                    <div className="mt-section-label mt-section-label--sub">Presets</div>
                                    <div className="mt-preset-list">
                                        {presets.map((p) => (
                                            <div key={p.id} className="mt-preset-chip">
                                                <Tooltip text={"Apply \"" + p.name + "\" to the selected keyframe(s)"}>
                                                    <button className="mt-preset-chip-btn" onClick={() => handleApplyPreset(p.id)}>
                                                        <EasePreview preset={p} />
                                                        {p.name}
                                                    </button>
                                                </Tooltip>
                                                {!p.isBuiltIn && (
                                                    <Tooltip text="Delete this preset">
                                                        <button className="mt-preset-chip-del" onClick={() => handleDeletePreset(p.id)}>
                                                            <Trash2 size={11} />
                                                        </button>
                                                    </Tooltip>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    {copiedKeys && (
                                        <div className="mt-preset-save-row">
                                            <input
                                                type="text"
                                                placeholder="Save copied ease as..."
                                                value={presetName}
                                                onChange={(e) => setPresetName(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") handleSavePreset(); }}
                                            />
                                            <Tooltip text="Save the copied ease as a new preset" grow>
                                                <button className="mt-icon-btn" disabled={!presetName.trim()} onClick={handleSavePreset}>
                                                    <BookmarkPlus size={14} />
                                                </button>
                                            </Tooltip>
                                        </div>
                                    )}

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
                                        <button className="mt-ease-btn mt-ease-btn--excite" onClick={() => run("motionToolsExcite", "overshoot", exciteStrength)}>
                                            <ExcitePreview type="overshoot" strength={exciteStrength} />
                                            Overshoot
                                        </button>
                                        <button className="mt-ease-btn mt-ease-btn--excite" onClick={() => run("motionToolsExcite", "bounce", exciteStrength)}>
                                            <ExcitePreview type="bounce" strength={exciteStrength} />
                                            Bounce
                                        </button>
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

export default XYToolsDroplet;
