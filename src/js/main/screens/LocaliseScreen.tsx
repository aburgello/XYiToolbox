// =============================================================================
// src/js/main/screens/LocaliseScreen.tsx
// -----------------------------------------------------------------------------
// Bespoke Localise landing: two big workflow cards (Batch Localisation +
// Localised Library) + a utility tool grid below, instead of the shared
// vertical rail. When a tool is selected it renders full-width in place.
// =============================================================================
import React, { Suspense, useState, useRef, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import gsap from "gsap";
import { ArrowLeft, FolderInput, BookOpen, FileSignature, Stamp, ClipboardCheck, Clapperboard, FileText, Copy, Image as ImageIcon, FileSpreadsheet } from "lucide-react";
import { TOOLS, categoryStyleVars, type ToolProps } from "../toolRegistry";
import { ToolErrorBoundary } from "../ToolErrorBoundary";
import { PaletteTrigger, triggerPalette } from "../CommandPalette";
import Tooltip from "../Tooltip";
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

// The localisation pipeline in the order it actually runs at the studio --
// shown as a numbered workflow strip so a new team member can read the
// process off the landing instead of decoding an unordered grid of slang
// names. Each stage's blurb states its ROLE in the pipeline (the registry
// description stays as the fuller reference; utilities below use it).
const WORKFLOW_STAGES: (UtilityEntry & { blurb: string })[] = [
    { id: "pdf-to-csv",         label: "PDF to CSV",   icon: FileSpreadsheet, blurb: "Start here: scan the client PDFs into a Campaign_Data.csv." },
    { id: "campaign-localiser", label: "Generate",     icon: FolderInput,     blurb: "Generate localised AEPs from the masters (Generate Files / CSV Localiser / Trotting) — same as the Batch Localisation card." },
    { id: "jpeg-loc",           label: "JPEG Loc",     icon: ImageIcon,       blurb: "Swap in each territory's JPG artwork across the generated AEPs." },
    { id: "cheeky-dt",          label: "Cheeky DT",    icon: Stamp,           blurb: "Update each Frontcard's details from its filename." },
    { id: "check",              label: "Check",        icon: ClipboardCheck,  blurb: "QC pass: names, effects, comp details, render check." },
    { id: "generate-cue-sheet", label: "Cue Sheet",    icon: FileText,        blurb: "Export the cue sheet for handover." },
];

// Standalone helpers that support the pipeline but aren't a stage of it.
const UTILITY_TOOLS: UtilityEntry[] = [
    { id: "name-generator",   label: "Name Generator", icon: FileSignature },
    { id: "edit-generator",   label: "Edit Generator", icon: Clapperboard },
    { id: "aep-thief",        label: "AEP Thief",      icon: Copy },
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
            const cards = gsap.utils.toArray<HTMLElement>(".ls-card");
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
                    <div className="ls-cards">
                        <button
                            className="ls-card ls-card--batch"
                            onClick={() => { sfx.open(); handleSelect("campaign-localiser"); }}
                        >
                            <div className="ls-card-glow" />
                            <div className="ls-card-icon"><FolderInput size={32} /></div>
                            <span className="ls-card-title">Batch Localisation</span>
                            <span className="ls-card-desc">Generate Files, CSV Localiser &amp; Trotting</span>
                            <span className="ls-card-arrow">→</span>
                        </button>

                        <button
                            className="ls-card ls-card--library"
                            onClick={() => { sfx.open(); handleSelect("localised-library"); }}
                        >
                            <div className="ls-card-glow" />
                            <div className="ls-card-icon"><BookOpen size={32} /></div>
                            <span className="ls-card-title">Localised Library</span>
                            <span className="ls-card-desc">Browse &amp; manage components per territory</span>
                            <span className="ls-card-arrow">→</span>
                        </button>
                    </div>

                    <div className="ls-utilities ls-workflow">
                        <span className="ls-grid-label">Localisation Workflow</span>
                        <div className="ls-flow">
                            {WORKFLOW_STAGES.map(({ id, label, icon: Icon, blurb }, i) => (
                                <React.Fragment key={id}>
                                    {i > 0 && <span className="ls-flow-arrow" aria-hidden="true">→</span>}
                                    <Tooltip text={blurb} delay={500}>
                                        <button
                                            className="ls-stage"
                                            onClick={() => { sfx.click(); handleSelect(id); }}
                                        >
                                            <span className="ls-stage-num">{i + 1}</span>
                                            <Icon size={13} />
                                            <span>{label}</span>
                                        </button>
                                    </Tooltip>
                                </React.Fragment>
                            ))}
                        </div>
                    </div>

                    <div className="ls-utilities">
                        <span className="ls-grid-label">More Utilities</span>
                        <div className="ls-grid">
                            {UTILITY_TOOLS.map(({ id, label, icon: Icon }) => (
                                <Tooltip key={id} text={toolDescription(id)} delay={500}>
                                    <button
                                        className="ls-grid-item"
                                        onClick={() => { sfx.click(); handleSelect(id); }}
                                    >
                                        <Icon size={14} />
                                        <span>{label}</span>
                                    </button>
                                </Tooltip>
                            ))}
                        </div>
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
};


