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
//
// PERSONALISATION (edit mode) — the SAME long-press "keep pressing a row
// until it shakes" system tools/Toolset.tsx already has for its one-click
// grid, applied here to the rail's tool rows: HIDE a tool, drag it into a
// DIFFERENT stage, drag to reorder within/across stages, and rename a
// stage's label. Long-pressing a row's own label/icon (not just anywhere
// in the rail) is the ONLY entry point, matching Toolset's "no Edit button
// in normal mode" choice — see its own comment for why. State:
//   - hidden:        tool ids the user hid from this category's rail.
//   - stageOverride: toolId -> stageId, once a tool has been dragged into a
//                    different stage than `stages` prop's own toolIds say.
//   - labelOverride: stageId -> renamed label (including the synthetic
//                    "more" bucket for tools not in any explicit stage).
// All three are keyed by categoryId and persisted via shell.ts's
// loadAllRail*/saveRail* (see that file's own comment for the JSON-blob
// format) — reordering itself reuses the EXISTING useToolOrder hook
// unchanged, no new order storage needed.
// =============================================================================
import React, { Suspense, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
    DndContext,
    DragOverlay,
    closestCorners,
    MouseSensor,
    TouchSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    useDroppable,
    DragEndEvent,
    DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, Check, Minus, Plus } from "lucide-react";
import gsap from "gsap";
import { TOOLS, categoryStyleVars, type ToolEntry } from "../toolRegistry";
import { iconWiggle } from "../animations";
import { useToolOrder } from "../hooks/useToolOrder";
import { ToolErrorBoundary } from "../ToolErrorBoundary";
import { GsapContentSwap } from "../gsap/components/GsapContentSwap";
import { PaletteTrigger, triggerPalette } from "../CommandPalette";
import { evalTS } from "../../lib/utils/bolt";
import { sfx } from "../../lib/utils/sfx";
import "../shared.scss";
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

// The synthetic bucket id for tools that belong to this category but aren't
// listed in any of `stages`' own toolIds arrays (and haven't been dragged
// into a real stage via edit mode either).
const MORE_STAGE_ID = "more";

// =============================================================================
// Edit-mode sortable pieces — MODULE SCOPE ON PURPOSE, not defined inside
// RailScreen. Same reasoning as Toolset.tsx's SortableTile/SortableGroup:
// onDragStart sets `activeId` state (for the DragOverlay), which re-renders
// RailScreen; a component defined inside RailScreen's body would get a
// fresh function identity every render and React would unmount/remount
// every row mid-drag, breaking the gesture.
// =============================================================================
const RailSortableRow: React.FC<{
    tool: ToolEntry;
    stageId: string;
    isHidden: boolean;
    jiggle: boolean;
    onToggleHidden: (id: string) => void;
}> = ({ tool, stageId, isHidden, jiggle, onToggleHidden }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: tool.id,
        data: { stage: stageId },
    });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.25 : 1,
    };
    const Icon = tool.icon;
    return (
        <div ref={setNodeRef} style={style} className="rail-edit-item" {...attributes} {...listeners}>
            <div className={"rail-tool-row rail-tool-row-editing" + (isHidden ? " is-hidden" : "") + (jiggle ? " jiggle" : "")}>
                <span className="rail-tool-icon"><Icon size={13} /></span>
                <span className="rail-tool-label">{tool.label}</span>
                <button
                    type="button"
                    className={"rail-hide-btn" + (isHidden ? " is-hidden" : "")}
                    title={isHidden ? "Restore" : "Hide"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onToggleHidden(tool.id); }}
                >
                    {isHidden ? <Plus size={11} /> : <Minus size={11} />}
                </button>
            </div>
        </div>
    );
};

const RailSortableStage: React.FC<{
    stageId: string;
    label: string;
    tools: ToolEntry[];
    hiddenSet: Set<string>;
    jiggle: boolean;
    onToggleHidden: (id: string) => void;
    onRename: (stageId: string, label: string) => void;
}> = ({ stageId, label, tools, hiddenSet, jiggle, onToggleHidden, onRename }) => {
    // The whole stage's tool list is a droppable, so a row can be dropped
    // onto empty space (not only onto another row) — lets a currently-empty
    // stage still receive a drop, same reasoning as Toolset's SortableGroup.
    const { setNodeRef, isOver } = useDroppable({ id: "container:" + stageId, data: { stage: stageId, container: true } });
    return (
        <div className="rail-stage">
            <div className="rail-stage-label">
                <span className="rail-stage-dot" />
                <input
                    className="rail-stage-label-input"
                    value={label}
                    onChange={(e) => onRename(stageId, e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                    spellCheck={false}
                    aria-label="Stage name"
                />
            </div>
            <SortableContext items={tools.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <div ref={setNodeRef} className={"rail-stage-tools editing" + (isOver ? " drop-target" : "")}>
                    {tools.map((tool) => (
                        <RailSortableRow
                            key={tool.id}
                            tool={tool}
                            stageId={stageId}
                            isHidden={hiddenSet.has(tool.id)}
                            jiggle={jiggle}
                            onToggleHidden={onToggleHidden}
                        />
                    ))}
                    {tools.length === 0 && <p className="rail-stage-empty-hint">Drop tools here</p>}
                </div>
            </SortableContext>
        </div>
    );
};

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
    const { getOrderedTools, saveToolOrder } = useToolOrder(TOOLS);
    const ordered = getOrderedTools(categoryId);

    // --- Personalisation (edit mode) state — see file header comment. -----
    const [editMode, setEditMode] = useState(false);
    const [hidden, setHidden] = useState<string[]>([]);
    const [stageOverride, setStageOverride] = useState<Record<string, string>>({});
    const [labelOverride, setLabelOverride] = useState<Record<string, string>>({});
    const [activeId, setActiveId] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const h = await evalTS("loadAllRailHidden" as any);
                if (h && Array.isArray(h[categoryId])) setHidden(h[categoryId]);
                const s = await evalTS("loadAllRailStages" as any);
                if (s && s[categoryId]) setStageOverride(s[categoryId]);
                const l = await evalTS("loadAllRailLabels" as any);
                if (l && l[categoryId]) setLabelOverride(l[categoryId]);
            } catch {
                /* no bridge (preview) -- defaults are correct */
            }
        })();
    }, [categoryId]);

    // Escape leaves edit mode -- only wired while actually editing.
    useEffect(() => {
        if (!editMode) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditMode(false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [editMode]);

    const hiddenSet = new Set(hidden);
    const persistHidden = (next: string[]) => {
        setHidden(next);
        evalTS("saveRailHidden" as any, categoryId, next).catch(() => { /* preview */ });
    };
    const toggleHidden = (id: string) => {
        persistHidden(hiddenSet.has(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);
    };

    // Effective stage of a tool: user override, else whichever `stages`
    // entry's toolIds lists it, else the synthetic "more" bucket.
    const stageOf = (toolId: string): string => {
        const o = stageOverride[toolId];
        if (o) return o;
        const s = stages.find((st) => st.toolIds.includes(toolId));
        return s ? s.id : MORE_STAGE_ID;
    };
    const stageDefaultLabel = (stageId: string): string => {
        const s = stages.find((st) => st.id === stageId);
        return s ? s.label : "More";
    };
    const stageLabelOf = (stageId: string): string => {
        if (Object.prototype.hasOwnProperty.call(labelOverride, stageId)) return labelOverride[stageId];
        return stageDefaultLabel(stageId);
    };
    const setStageLabel = (stageId: string, label: string) => {
        const next = { ...labelOverride, [stageId]: label };
        setLabelOverride(next);
        evalTS("saveRailLabels" as any, categoryId, next).catch(() => { /* preview */ });
    };

    // Order within each stage follows the user's saved (whole-category,
    // flat) tool order — same source useToolOrder already provided before
    // personalisation existed; only WHICH stage a tool falls into is new.
    const grouped: Group[] = stages.map((s) => ({
        id: s.id,
        label: stageLabelOf(s.id),
        tools: ordered.filter((t) => stageOf(t.id) === s.id && !hiddenSet.has(t.id)),
    }));
    const leftovers = ordered.filter((t) => stageOf(t.id) === MORE_STAGE_ID && !hiddenSet.has(t.id));
    if (leftovers.length > 0) grouped.push({ id: MORE_STAGE_ID, label: stageLabelOf(MORE_STAGE_ID), tools: leftovers });

    const flat = grouped.flatMap((g) => g.tools);
    const selectedId = selectedToolId ?? flat[0]?.id;
    // Search `ordered` (the full category, hidden tools included), not the
    // hidden-filtered `flat` -- a tool hidden from the rail should still
    // open normally via direct search/⌘K/a deep link, it just doesn't show
    // as a row here.
    const selectedTool = ordered.find((t) => t.id === selectedId);

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

    // --- Edit-mode drag-and-drop --------------------------------------------
    // Same sensor set as Toolset.tsx's grid: MouseSensor + TouchSensor cover
    // mouse/touch input, since AE's CEP panel doesn't reliably fire the
    // Pointer Events API's press-and-hold the way a real browser tab does.
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

    // One DndContext spans every stage (including the synthetic "more"
    // bucket, always rendered while editing so it stays a valid drop
    // target even when currently empty), so a row can move within its
    // stage OR into a different one. See Toolset.tsx's handleDragEnd for
    // the identical container-vs-item drop-target logic this mirrors.
    const handleDragEnd = (event: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = event;
        if (!over) return;
        const draggedId = String(active.id);
        const overId = String(over.id);
        if (draggedId === overId) return;

        const isContainer = overId.indexOf("container:") === 0;
        const targetStage = isContainer ? overId.slice("container:".length) : stageOf(overId);

        const flatIds = ordered.map((t) => t.id);
        const without = flatIds.filter((id) => id !== draggedId);

        let insertIndex: number;
        if (isContainer) {
            let lastIdx = -1;
            for (let i = 0; i < without.length; i++) {
                if (stageOf(without[i]) === targetStage) lastIdx = i;
            }
            insertIndex = lastIdx === -1 ? without.length : lastIdx + 1;
        } else {
            insertIndex = without.indexOf(overId);
            if (insertIndex === -1) insertIndex = without.length;
        }

        const newOrderIds = without.slice(0, insertIndex).concat(draggedId, without.slice(insertIndex));
        const newOrderTools = newOrderIds
            .map((id) => TOOLS.find((t) => t.id === id))
            .filter((t): t is ToolEntry => !!t);
        saveToolOrder(categoryId, newOrderTools);

        if (stageOf(draggedId) !== targetStage) {
            const nextStages = { ...stageOverride, [draggedId]: targetStage };
            setStageOverride(nextStages);
            evalTS("saveRailStages" as any, categoryId, nextStages).catch(() => { /* preview */ });
        }
    };

    // Long-press (out of edit mode) enters edit mode -- "keep pressing a
    // row until it shakes", identical gesture to Toolset.tsx's grid tiles.
    // See that file's own comment for why both Pointer AND Mouse handlers
    // are wired (AE's CEP panel doesn't reliably fire one or the other for
    // a press-and-hold) and why guardClick unconditionally calls endPress().
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressed = useRef(false);
    const beginPress = () => {
        if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
        longPressed.current = false;
        pressTimer.current = setTimeout(() => { longPressed.current = true; setEditMode(true); }, 500);
    };
    const endPress = () => {
        if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    };
    const pressProps = {
        onPointerDown: beginPress, onPointerUp: endPress, onPointerLeave: endPress, onPointerCancel: endPress,
        onMouseDown: beginPress, onMouseUp: endPress, onMouseLeave: endPress,
    };
    const guardClick = (fn: () => void) => () => {
        endPress();
        if (longPressed.current) { longPressed.current = false; return; }
        fn();
    };

    // Every stage id worth rendering while editing: `stages`' own ids plus
    // the synthetic "more" bucket, always present so a tool can be dragged
    // into/out of it even when it's currently empty.
    const editStageIds = [...stages.map((s) => s.id), MORE_STAGE_ID];
    const editToolsForStage = (stageId: string): ToolEntry[] => ordered.filter((t) => stageOf(t.id) === stageId);
    const activeTool = activeId ? ordered.find((t) => t.id === activeId) : null;

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
                    <div className={editMode ? "rail-nav editing" : "rail-nav"} ref={railRef}>
                        <div className="rail-header rail-anim">
                            <span className="rail-badge"><BadgeIcon size={15} /></span>
                            <div className="rail-header-text">
                                <div className="rail-title">{title}</div>
                                <div className="rail-sub">{subtitle}</div>
                            </div>
                        </div>

                        {/* No Edit affordance in normal mode -- long-press a
                            row's label to enter edit mode. Done bar only
                            exists WHILE editing, matching Toolset.tsx's grid. */}
                        {editMode && (
                            <div className="rail-editbar">
                                <p className="rail-edit-hint">Drag to reorder or move to another stage · tap − to hide, + to restore.</p>
                                <button className="rail-done-btn" onClick={() => setEditMode(false)}>
                                    <Check size={12} /> Done
                                </button>
                            </div>
                        )}

                        {editMode ? (
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCorners}
                                onDragStart={handleDragStart}
                                onDragEnd={handleDragEnd}
                            >
                                {editStageIds.map((stageId) => (
                                    <RailSortableStage
                                        key={stageId}
                                        stageId={stageId}
                                        label={stageLabelOf(stageId)}
                                        tools={editToolsForStage(stageId)}
                                        hiddenSet={hiddenSet}
                                        jiggle={!reduced}
                                        onToggleHidden={toggleHidden}
                                        onRename={setStageLabel}
                                    />
                                ))}
                                <DragOverlay>
                                    {activeTool ? (
                                        <div className="rail-tool-row rail-edit-overlay" style={categoryStyleVars(categoryId)}>
                                            <span className="rail-tool-icon"><activeTool.icon size={13} /></span>
                                            <span className="rail-tool-label">{activeTool.label}</span>
                                        </div>
                                    ) : null}
                                </DragOverlay>
                            </DndContext>
                        ) : (
                            grouped.map((group) =>
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
                                                        {...pressProps}
                                                        onClick={guardClick(() => {
                                                            if (!isSelected) sfx.menu();
                                                            onSelectTool(tool.id);
                                                        })}
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
