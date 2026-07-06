// =============================================================================
// src/js/main/screens/RailScreen.tsx
// -----------------------------------------------------------------------------
// Shared bespoke category screen: a grouped VERTICAL rail on the left
// (workflow stages / tool groups, each a labelled section with a glowing
// dot and a connecting spine), the selected tool mounted full-width on the
// right. Powers both Localise (LocaliseScreen) and Tools (ToolsScreen) —
// they're thin config wrappers that pass their own stages/badge/title.
//
// A vertical rail of left-aligned icon+label rows is deliberately chosen
// over a centered tile grid: in a narrow AE-docked panel a grid of
// two-line centered tiles is slow to scan, whereas a single left-aligned
// column reads top-to-bottom like a normal menu. Any tool in this category
// not listed in `stages` lands in a trailing auto "More" group, so a
// newly-registered tool can never silently vanish (same merge philosophy
// as useToolOrder's saved-order handling).
//
// Animation split (deliberate — see CLAUDE.md's transform-clobber gotcha):
//   - GSAP: rail entrance stagger + tool-content swap (GsapContentSwap)
//   - Framer Motion: the sliding selection pill (layoutId) + icon wiggle
// GSAP's entrance tween targets the row elements; Framer only ever writes
// transforms to the icon span and the separate pill div, never the rows.
// =============================================================================
import React, { Suspense, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import gsap from "gsap";
import { TOOLS, categoryStyleVars, type ToolEntry } from "../toolRegistry";
import { iconWiggle } from "../animations";
import { useToolOrder } from "../hooks/useToolOrder";
import { ToolErrorBoundary } from "../ToolErrorBoundary";
import { GsapContentSwap } from "../gsap/components/GsapContentSwap";
import { PaletteTrigger, triggerPalette } from "../CommandPalette";
import { sfx } from "../../lib/utils/sfx";
import "./RailScreen.scss";

export interface RailStage {
    id: string;
    label: string;
    toolIds: string[];
}

interface Props {
    categoryId: string;
    title: string;
    subtitle: string;
    badgeIcon: React.ComponentType<{ size?: number }>;
    stages: RailStage[];
    selectedToolId?: string;
    onSelectTool: (toolId: string) => void;
    onBack: () => void;
}

interface Group {
    id: string;
    label: string;
    tools: ToolEntry[];
}

export const RailScreen: React.FC<Props> = ({
    categoryId,
    title,
    subtitle,
    badgeIcon: BadgeIcon,
    stages,
    selectedToolId,
    onSelectTool,
    onBack,
}) => {
    const reduced = useReducedMotion();
    const { getOrderedTools } = useToolOrder(TOOLS);
    const ordered = getOrderedTools(categoryId);

    // Order within each group follows the user's saved tool order.
    const grouped: Group[] = stages.map((s) => ({
        id: s.id,
        label: s.label,
        tools: ordered.filter((t) => s.toolIds.includes(t.id)),
    }));
    const leftovers = ordered.filter((t) => !stages.some((s) => s.toolIds.includes(t.id)));
    if (leftovers.length > 0) grouped.push({ id: "more", label: "More", tools: leftovers });

    const flat = grouped.flatMap((g) => g.tools);
    const selectedId = selectedToolId ?? flat[0]?.id;
    const selectedTool = flat.find((t) => t.id === selectedId);

    // Direction for the content swap: down the rail = forward.
    const prevToolIdRef = useRef(selectedId);
    const [direction, setDirection] = useState<"forward" | "backward">("forward");
    useEffect(() => {
        if (prevToolIdRef.current && prevToolIdRef.current !== selectedId) {
            const prevIdx = flat.findIndex((t) => t.id === prevToolIdRef.current);
            const currIdx = flat.findIndex((t) => t.id === selectedId);
            setDirection(currIdx > prevIdx ? "forward" : "backward");
        }
        prevToolIdRef.current = selectedId;
    }, [selectedId, flat]);

    // GSAP entrance: stagger the rail rows in from the left, once on mount.
    // No flash risk from the pre-tween frame: the whole screen arrives
    // inside GsapScreenTransition, which holds it at opacity 0 anyway.
    const railRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!railRef.current) return;
        const rows = railRef.current.querySelectorAll(".rail-anim");
        if (reduced) {
            gsap.set(rows, { opacity: 1, x: 0 });
            return;
        }
        const ctx = gsap.context(() => {
            gsap.fromTo(
                rows,
                { opacity: 0, x: -12 },
                { opacity: 1, x: 0, duration: 0.32, ease: "power2.out", stagger: 0.035 }
            );
        }, railRef);
        return () => ctx.revert();
        // Mount-only — re-running on selection would replay the entrance.
    }, [reduced]);

    return (
        <div className="drill-screen">
            <div className="category-ambient-bg" aria-hidden="true">
                <motion.div
                    className={`category-ambient-blob category-ambient-blob--tl category-ambient-blob--${categoryId}`}
                    animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                    className={`category-ambient-blob category-ambient-blob--br category-ambient-blob--${categoryId}`}
                    animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 4 }}
                />
            </div>

            <div className="drill-page-content">
                <div className="drill-header-row">
                    <motion.button className="back-button" onClick={onBack} whileHover={{ x: -2 }}>
                        <ArrowLeft size={14} /> Back
                    </motion.button>
                    <PaletteTrigger onClick={triggerPalette} />
                </div>

                <div className="rail-hub" style={categoryStyleVars(categoryId)}>
                    {/* ── Rail ──────────────────────────────────────────── */}
                    <div className="rail-nav" ref={railRef}>
                        <div className="rail-header rail-anim">
                            <span className="rail-badge"><BadgeIcon size={15} /></span>
                            <div className="rail-header-text">
                                <div className="rail-title">{title}</div>
                                <div className="rail-sub">{subtitle}</div>
                            </div>
                        </div>

                        {grouped.map((group) =>
                            group.tools.length === 0 ? null : (
                                <div className="rail-stage" key={group.id}>
                                    <div className="rail-stage-label rail-anim">
                                        <span className="rail-stage-dot" />
                                        {group.label}
                                    </div>
                                    <div className="rail-stage-tools">
                                        {group.tools.map((tool) => {
                                            const Icon = tool.icon;
                                            const isSelected = tool.id === selectedId;
                                            return (
                                                <motion.div
                                                    key={tool.id}
                                                    className={isSelected ? "rail-tool-row rail-anim selected" : "rail-tool-row rail-anim"}
                                                    initial="rest"
                                                    whileHover="hover"
                                                    onClick={() => { if (!isSelected) sfx.menu(); onSelectTool(tool.id); }}
                                                >
                                                    {isSelected && (
                                                        <motion.div
                                                            className="rail-highlight"
                                                            layoutId="rail-highlight"
                                                            transition={{ type: "spring", stiffness: 500, damping: 38 }}
                                                        />
                                                    )}
                                                    <motion.span variants={iconWiggle} className="rail-tool-icon">
                                                        <Icon size={13} />
                                                    </motion.span>
                                                    <span className="rail-tool-label">{tool.label}</span>
                                                </motion.div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )
                        )}
                    </div>

                    {/* ── Selected tool ─────────────────────────────────── */}
                    <div className="rail-content">
                        {selectedTool ? (
                            <GsapContentSwap key={selectedId} direction={direction}>
                                <ToolErrorBoundary toolLabel={selectedTool.label}>
                                    <Suspense fallback={<div style={{ width: "100%", height: "100%" }} />}>
                                        <div className="tool-content-header">
                                            <div className="tool-content-header-row">
                                                <span className="tool-content-header-icon">
                                                    <selectedTool.icon size={20} />
                                                </span>
                                                <h3 className="tool-content-header-title">{selectedTool.label}</h3>
                                            </div>
                                            {selectedTool.description && (
                                                <p className="tool-content-header-desc">{selectedTool.description}</p>
                                            )}
                                        </div>
                                        <div className="tool-content-body">
                                            <selectedTool.Component onSelectTool={onSelectTool} />
                                        </div>
                                    </Suspense>
                                </ToolErrorBoundary>
                            </GsapContentSwap>
                        ) : (
                            <p className="hint">No tools in this category yet.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RailScreen;
