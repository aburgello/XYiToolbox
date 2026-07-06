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

const UTILITY_TOOLS: UtilityEntry[] = [
    { id: "name-generator",    label: "Name Generator",  icon: FileSignature },
    { id: "cheeky-dt",        label: "Cheeky DT",       icon: Stamp },
    { id: "check",            label: "Check",           icon: ClipboardCheck },
    { id: "edit-generator",   label: "Edit Generator",  icon: Clapperboard },
    { id: "generate-cue-sheet", label: "Cue Sheet",     icon: FileText },
    { id: "aep-thief",        label: "AEP Thief",       icon: Copy },
    { id: "jpeg-loc",         label: "JPEG Loc",        icon: ImageIcon },
    { id: "pdf-to-csv",       label: "PDF to CSV",      icon: FileSpreadsheet },
];

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
        const ctx = gsap.context(() => {
            const cards = gsap.utils.toArray<HTMLElement>(".ls-card");
            const gridItems = gsap.utils.toArray<HTMLElement>(".ls-grid-item");
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

                    <div className="ls-utilities">
                        <span className="ls-grid-label">Utilities</span>
                        <div className="ls-grid">
                            {UTILITY_TOOLS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    className="ls-grid-item"
                                    onClick={() => { sfx.click(); handleSelect(id); }}
                                >
<Icon size={14} />
                                <span>{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
};


