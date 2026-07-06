// =============================================================================
// src/js/main/screens/CategoryScreen.tsx
// -----------------------------------------------------------------------------
// GENERIC master-detail view for a category: draggable tool list on the
// left, selected tool's content mounted on the right. Order is persisted via
// the useToolOrder hook. Tool components are wrapped in ToolErrorBoundary +
// Suspense so lazy loading and rendering errors are both handled gracefully.
//
// NOTE: as of the Localise/Tools overhaul, NO category renders through this
// screen anymore -- Review/Deliver route to their hub tools, Localise/Tools
// to their bespoke screens (LocaliseScreen/ToolsScreen). Kept as main.tsx's
// fallback for any future category that doesn't have its own design yet.
//
// Tool-content transitions use GSAP (GsapContentSwap, shared with the
// bespoke screens) to avoid the AnimatePresence "mode" bugs that caused
// flash/snap on tool switch.
// =============================================================================
import React, { Suspense, useCallback, useRef, useState, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Reorder, useDragControls } from "motion/react";
import { ArrowLeft, GripVertical } from "lucide-react";
import { CATEGORIES, TOOLS, categoryStyleVars, type ToolEntry } from "../toolRegistry";
import { iconWiggle } from "../animations";
import { useToolOrder } from "../hooks/useToolOrder";
import { ToolErrorBoundary } from "../ToolErrorBoundary";
import { GsapContentSwap } from "../gsap/components/GsapContentSwap";
import Tooltip from "../Tooltip";
import { PaletteTrigger, triggerPalette } from "../CommandPalette";

interface Props {
    categoryId: string;
    selectedToolId?: string;
    onSelectTool: (toolId: string) => void;
    onBack: () => void;
}

// One row in the draggable tool list. Pulled out as its own component
// because useDragControls() needs a fresh hook instance per row.
const ToolListEntry: React.FC<{
    tool: ToolEntry;
    isSelected: boolean;
    categoryId: string;
    onSelect: () => void;
}> = ({ tool, isSelected, categoryId, onSelect }) => {
    const Icon = tool.icon;
    const dragControls = useDragControls();

    return (
        <Reorder.Item
            value={tool}
            as="div"
            dragListener={false}
            dragControls={dragControls}
            className={isSelected ? "tool-list-entry selected" : "tool-list-entry"}
            style={categoryStyleVars(categoryId)}
            initial="rest"
            whileHover="hover"
        >
            {isSelected && (
                <motion.div
                    className="tool-list-highlight"
                    layoutId="tool-list-highlight"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
            )}
            <Tooltip text="Drag to reorder">
                <span
                    className="tool-list-drag-handle"
                    onPointerDown={(e) => dragControls.start(e)}
                >
                    <GripVertical size={12} />
                </span>
            </Tooltip>
            <span className="tool-list-entry-content" onClick={onSelect}>
                <motion.span variants={iconWiggle} className="tool-card-icon">
                    <Icon size={14} />
                </motion.span>
                {tool.label}
            </span>
        </Reorder.Item>
    );
};

const SIDEBAR_MIN = 120;
const SIDEBAR_MAX = 260;
const SIDEBAR_DEFAULT = 170;

export const CategoryScreen: React.FC<Props> = ({ categoryId, selectedToolId, onSelectTool, onBack }) => {
    const reduced = useReducedMotion();
    const category = CATEGORIES.find((c) => c.id === categoryId);
    const { getOrderedTools, saveToolOrder } = useToolOrder(TOOLS);
    const orderedTools = getOrderedTools(categoryId);
    const selectedId = selectedToolId ?? orderedTools[0]?.id;
    const selectedTool = orderedTools.find((t) => t.id === selectedId);

    // --- Resizable sidebar -------------------------------------------
    const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
    const draggingRef = useRef(false);
    const startXRef = useRef(0);
    const startWidthRef = useRef(SIDEBAR_DEFAULT);

    // Track previous tool ID for transition direction
    const prevToolIdRef = useRef(selectedId);
    const [transitionDirection, setTransitionDirection] = useState<"forward" | "backward">("forward");

    useEffect(() => {
        if (prevToolIdRef.current && prevToolIdRef.current !== selectedId) {
            const prevIdx = orderedTools.findIndex((t) => t.id === prevToolIdRef.current);
            const currIdx = orderedTools.findIndex((t) => t.id === selectedId);
            setTransitionDirection(currIdx > prevIdx ? "forward" : "backward");
        }
        prevToolIdRef.current = selectedId;
    }, [selectedId, orderedTools]);

    const onResizePointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        draggingRef.current = true;
        startXRef.current = e.clientX;
        startWidthRef.current = sidebarWidth;

        const onMove = (ev: PointerEvent) => {
            if (!draggingRef.current) return;
            const delta = ev.clientX - startXRef.current;
            setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidthRef.current + delta)));
        };
        const onUp = () => {
            draggingRef.current = false;
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    }, [sidebarWidth]);

    const handleReorder = (newOrder: ToolEntry[]) => {
        saveToolOrder(categoryId, newOrder);
    };

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
                <h2>{category?.label}</h2>
                <div className="category-master-detail">
                    {orderedTools.length === 0 ? (
                        <div className="category-tool-list" style={{ width: sidebarWidth }}>
                            <p className="hint">No tools in this category yet.</p>
                        </div>
                    ) : (
                        <Reorder.Group
                            as="div"
                            axis="y"
                            values={orderedTools}
                            onReorder={handleReorder}
                            className="category-tool-list"
                            style={{ width: sidebarWidth }}
                        >
                            {orderedTools.map((tool) => (
                                <ToolListEntry
                                    key={tool.id}
                                    tool={tool}
                                    isSelected={tool.id === selectedId}
                                    categoryId={categoryId}
                                    onSelect={() => onSelectTool(tool.id)}
                                />
                            ))}
                        </Reorder.Group>
                    )}

                    <Tooltip text="Drag to resize">
                        <div
                            className="category-resize-handle"
                            onPointerDown={onResizePointerDown}
                        />
                    </Tooltip>

                    <div className="category-tool-content" style={{ ...categoryStyleVars(categoryId), position: "relative", overflow: "hidden" }}>
                        {selectedTool ? (
                            <GsapContentSwap key={selectedId} direction={transitionDirection}>
                                <ToolErrorBoundary toolLabel={selectedTool.label}>
                                    <Suspense fallback={<div style={{ width: "100%", height: "100%", minHeight: "100%" }} />}>
                                        {/* ── Tool header ─────────────────────────── */}
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
                                        {/* ── Tool body ───────────────────────────── */}
                                        <div className="tool-content-body">
                                            <selectedTool.Component onSelectTool={onSelectTool} />
                                        </div>
                                    </Suspense>
                                </ToolErrorBoundary>
                            </GsapContentSwap>
                        ) : (
                            <p className="hint">Select a tool from the list.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
