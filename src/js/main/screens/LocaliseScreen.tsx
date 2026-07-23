// =============================================================================
// src/js/main/screens/LocaliseScreen.tsx
// -----------------------------------------------------------------------------
// Bespoke Localise landing: a prominent Localised Library hero (opens
// full-width), a two-pane "localise a campaign" work surface (CSV Localiser /
// Trott & Batch), and a flat tools row below, instead of the shared vertical
// rail. When a tool is selected it renders full-width in place.
// =============================================================================
import React, { Suspense, useState, useRef, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import gsap from "gsap";
import { ArrowLeft, ArrowRight, BookOpen, FileSignature, Stamp, ClipboardCheck, Clapperboard, FileText, Copy, Image as ImageIcon, FileSpreadsheet, Rabbit, Play } from "lucide-react";
import { TOOLS, categoryStyleVars, type ToolProps } from "../toolRegistry";
import { ToolErrorBoundary } from "../ToolErrorBoundary";
import { PaletteTrigger, triggerPalette } from "../CommandPalette";
import Tooltip from "../Tooltip";
import StatusIcon from "../StatusIcon";
import { evalTS } from "../../lib/utils/bolt";
import CSVLocaliserTool from "../tools/CSVLocaliser";
import CampaignLocaliserTool from "../tools/CampaignLocaliser";
import { sfx } from "../../lib/utils/sfx";
import "./LocaliseScreen.scss";

interface Props {
    selectedToolId?: string;
    onSelectTool: (toolId: string) => void;
    onBack: () => void;
}

interface UtilityEntry {
    id: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
}

// The work surface holds the two halves of ONE job -- "localise a campaign":
// CSV Localiser and Trott/Batch. The Localised Library used to be a third,
// co-equal pane here, but it's a genuinely different job (browsing/importing
// existing localised components per territory), and being sandwiched between
// the two campaign-localisation tools flattened that distinction. It's now
// pulled out into its own prominent hero above the surface (opens full-width),
// so it reads as its own first-class destination rather than a middle tab.
type Pane = "csv" | "batch";
const PANES: { id: Pane; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "csv",   label: "CSV Localiser", icon: FileSpreadsheet },
    { id: "batch", label: "Trott & Batch", icon: Rabbit },
];

// ONE flat list of tools. Previously this was split into a numbered
// "Localisation Workflow" strip with -> arrows plus a separate utilities
// grid, which implied a rigid pipeline nobody actually follows in order.
// They're just tools, so they're presented as tools -- plain rounded buttons,
// separated by a divider rather than arrows. `run` marks the ones that are a
// single parameterless call and so execute in place instead of opening a page
// whose only content is that button.
const TOOLS_ROW: (UtilityEntry & { run?: string })[] = [
    { id: "pdf-to-csv",        label: "PDF to CSV",     icon: FileSpreadsheet, run: "pdfToCsvGenerate" },
    { id: "jpeg-loc",          label: "JPEG Loc",       icon: ImageIcon,       run: "jpegLoc" },
    { id: "aep-thief",         label: "AEP Thief",      icon: Copy,            run: "copyAep" },
    { id: "cheeky-dt",         label: "Cheeky DT",      icon: Stamp },
    { id: "check",             label: "Check",          icon: ClipboardCheck },
    { id: "generate-cue-sheet",label: "Cue Sheet",      icon: FileText },
    { id: "name-generator",    label: "Name Generator", icon: FileSignature },
    { id: "edit-generator",    label: "Edit Generator", icon: Clapperboard },
];

const toolDescription = (id: string): string =>
    TOOLS.find((t) => t.id === id)?.description || "";

// One-shot landing cascade per session -- returning from a tool used to
// replay the full stagger every time (the effect is keyed on [tool]).
let lsEntranceDone = false;

export const LocaliseScreen: React.FC<Props> = ({ selectedToolId: parentToolId, onSelectTool, onBack }) => {
    const reduced = useReducedMotion();
    const [localToolId, setLocalToolId] = useState<string | null>(null);
    const effectiveToolId = parentToolId ?? localToolId;
    const tool = effectiveToolId ? TOOLS.find((t) => t.id === effectiveToolId) : null;
    const landingRef = useRef<HTMLDivElement>(null);

    // Run-in-place state for the parameterless one-shots (see WORKFLOW_STAGES /
    // SUPPORT_TOOLS `run`): a single status line under the spine, so clicking
    // "JPEG Loc" does the job right here instead of navigating to a page whose
    // only content is that same button.
    const [runningId, setRunningId] = useState<string | null>(null);
    const [runStatus, setRunStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [pane, setPane] = useState<Pane>("csv");

    const runInPlace = async (id: string, label: string, fnName: string) => {
        setRunningId(id);
        setRunStatus(null);
        try {
            const result = await evalTS(fnName as Parameters<typeof evalTS>[0]);
            if (result === undefined) throw new Error("no bridge");
            const r = result as { success?: boolean; message?: string; error?: string };
            if (r.success) {
                sfx.success();
                setRunStatus({ type: "success", text: r.message || `${label} finished.` });
            } else {
                sfx.error();
                setRunStatus({ type: "error", text: r.error || `${label} failed.` });
            }
        } catch (e) {
            sfx.error();
            setRunStatus({ type: "error", text: "No CEP bridge detected — open this panel inside After Effects." });
        } finally {
            setRunningId(null);
        }
    };

    const handleSelect = (toolId: string) => {
        setLocalToolId(toolId);
    };

    const handleBack = () => {
        if (effectiveToolId) {
            setLocalToolId(null);
        } else {
            onBack();
        }
    };

    const env = categoryStyleVars("localise");

    useEffect(() => {
        if (tool || !landingRef.current) return;
        if (lsEntranceDone) return; // already cascaded this session -- render static
        lsEntranceDone = true;
        const ctx = gsap.context(() => {
            // The hero + the work surface are the "cards" tier now (the old two
            // big .ls-card tiles are gone); tools row cascades after.
            const cards = gsap.utils.toArray<HTMLElement>(".ls-library-hero, .ls-main");
            const gridItems = gsap.utils.toArray<HTMLElement>(".ls-grid-item, .ls-stage");
            const gridLabel = gsap.utils.toArray<HTMLElement>(".ls-grid-label");

            gsap.set([...cards, ...gridLabel, ...gridItems], { opacity: 0, y: 24 });

            const tl = gsap.timeline();
            tl.to(cards, {
                opacity: 1,
                y: 0,
                duration: 0.5,
                ease: "back.out(1.4)",
                stagger: 0.08,
            })
            .to(gridLabel, {
                opacity: 1,
                y: 0,
                duration: 0.3,
                ease: "power2.out",
            }, "-=0.3")
            .to(gridItems, {
                opacity: 1,
                y: 0,
                duration: 0.25,
                ease: "power2.out",
                stagger: 0.02,
            }, "-=0.2");
        }, landingRef);

        return () => ctx.revert();
    }, [tool]);

    if (tool) {
        const Component = tool.Component as React.ComponentType<ToolProps>;
        return (
            <div className="drill-screen">
                <div className="category-ambient-bg" aria-hidden="true">
                    <motion.div
                        className="category-ambient-blob category-ambient-blob--tl category-ambient-blob--localise"
                        animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <motion.div
                        className="category-ambient-blob category-ambient-blob--br category-ambient-blob--localise"
                        animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 4 }}
                    />
                </div>
                <div className="drill-page-content">
                    <div className="drill-header-row">
                        <motion.button className="back-button" onClick={handleBack} whileHover={{ x: -2 }}>
                            <ArrowLeft size={14} /> Back
                        </motion.button>
                        <PaletteTrigger onClick={triggerPalette} />
                    </div>
                    <div className="ls-frame">
                        <div className="ls-tool-wrap" style={env}>
                        <ToolErrorBoundary toolLabel={tool.label}>
                            <Suspense fallback={<p className="hint" style={{ padding: "16px" }}>Loading…</p>}>
                                <div className="tool-content-header ls-tool-header" style={env}>
                                    <motion.span
                                        className="ls-header-icon"
                                        whileHover={{ scale: 1.15, rotate: 8 }}
                                        transition={{ type: "spring", stiffness: 300, damping: 15 }}
                                    >
                                        <tool.icon size={24} />
                                    </motion.span>
                                    <h3 className="tool-content-header-title">{tool.label}</h3>
                                    <motion.div
                                        className="ls-header-line"
                                        initial={{ scaleX: 0 }}
                                        animate={{ scaleX: 1 }}
                                        transition={{ duration: 0.5, ease: "easeOut" }}
                                    />
                                </div>
                                <div className="tool-content-body">
                                    <Component onSelectTool={handleSelect} />
                                </div>
                            </Suspense>
                        </ToolErrorBoundary>
                    </div>
                </div>
                </div>
            </div>
        );
    }

    return (
        <div className="drill-screen">
            <div className="category-ambient-bg" aria-hidden="true">
                <motion.div
                    className="category-ambient-blob category-ambient-blob--tl category-ambient-blob--localise"
                    animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                    className="category-ambient-blob category-ambient-blob--br category-ambient-blob--localise"
                    animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 4 }}
                />
            </div>
            <div className="drill-page-content">
                <div className="drill-header-row">
                    <motion.button className="back-button" onClick={handleBack} whileHover={{ x: -2 }}>
                        <ArrowLeft size={14} /> Back
                    </motion.button>
                    <PaletteTrigger onClick={triggerPalette} />
                </div>

                <div className="ls-frame" style={env}>
                    <div className="ls-landing" ref={landingRef}>
                    {/* 1. Localised Library -- its own prominent destination, not a
                        tab wedged between the two campaign-localisation tools.
                        Opens full-width like any other tool page. */}
                    <button
                        className="ls-library-hero"
                        onClick={() => { sfx.click(); handleSelect("localised-library"); }}
                    >
                        <span className="ls-library-hero-glow" aria-hidden="true" />
                        <span className="ls-library-hero-icon"><BookOpen size={26} /></span>
                        <span className="ls-library-hero-text">
                            <span className="ls-library-hero-eyebrow">Library</span>
                            <span className="ls-library-hero-title">Localised Library</span>
                            <span className="ls-library-hero-desc">
                                Browse &amp; import localised components, per territory.
                            </span>
                        </span>
                        <span className="ls-library-hero-arrow"><ArrowRight size={20} /></span>
                    </button>

                    {/* 2. The work surface: the two halves of "localise a
                        campaign" as panes, switched by a toggle -- no nesting. */}
                    <div className="ls-main">
                        <div className="ls-main-head">
                            <span className="ls-section-caption">Localise a campaign</span>
                            <div className="ls-pane-tabs" role="tablist">
                                {PANES.map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        role="tab"
                                        aria-selected={pane === id}
                                        className={pane === id ? "ls-pane-tab active" : "ls-pane-tab"}
                                        onClick={() => { sfx.click(); setPane(id); }}
                                    >
                                        <Icon size={13} />
                                        <span>{label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="ls-main-surface">
                            {pane === "csv" && <CSVLocaliserTool />}
                            {pane === "batch" && <CampaignLocaliserTool />}
                        </div>
                    </div>

                    {/* 3. Tools -- one flat row of plain rounded buttons, split
                        by a divider rather than the old numbered ->arrow
                        pipeline (which implied an order nobody works in). */}
                    <div className="ls-utilities">
                        <span className="ls-grid-label">Tools</span>
                        <div className="ls-grid">
                            {TOOLS_ROW.map(({ id, label, icon: Icon, run }, i) => (
                                <React.Fragment key={id}>
                                    {i > 0 && <span className="ls-tool-divider" aria-hidden="true" />}
                                    <Tooltip text={run ? `${toolDescription(id)} (runs here)` : toolDescription(id)} delay={500}>
                                        <button
                                            className={run ? "ls-grid-item ls-grid-item--runnable" : "ls-grid-item"}
                                            disabled={runningId === id}
                                            onClick={() => {
                                                if (run) { sfx.click(); runInPlace(id, label, run); }
                                                else { sfx.click(); handleSelect(id); }
                                            }}
                                        >
                                            <Icon size={14} />
                                            <span>{runningId === id ? "Running…" : label}</span>
                                            {run && <Play size={9} className="ls-stage-run" />}
                                        </button>
                                    </Tooltip>
                                </React.Fragment>
                            ))}
                        </div>
                        {runStatus && (
                            <div className={`loc-status loc-status-${runStatus.type} ls-run-status`}>
                                <StatusIcon type={runStatus.type} />
                                <span>{runStatus.text}</span>
                            </div>
                        )}
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
};


