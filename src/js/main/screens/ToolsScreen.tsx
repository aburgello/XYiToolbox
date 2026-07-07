// =============================================================================
// src/js/main/screens/ToolsScreen.tsx
// -----------------------------------------------------------------------------
// Tools category screen — a thin config wrapper over the shared RailScreen.
// The general-utility tools are grouped by what they DO (Size & Format /
// Layers & Rigging / Utility) so the rail scans quickly in a narrow docked
// panel — replaces the earlier centered-tile "workbench" grid, which was
// slow to scan at panel width. See RailScreen for the rail mechanics.
// =============================================================================
import React from "react";
import { Wrench } from "lucide-react";
import { RailScreen, type RailStage } from "./RailScreen";

interface Props {
    selectedToolId?: string;
    onSelectTool: (toolId: string) => void;
    onBack: () => void;
}

// Grouped by function, not by original toolbox tab. Order within each group
// follows the user's saved tool order (RailScreen merges via useToolOrder);
// any tools/-category tool not listed here lands in a trailing auto "More"
// group (RailScreen's fallback for a newly-registered tool nobody's sorted
// yet) -- "Scripting" is an explicit stage, not that fallback renamed, so it
// only ever contains these ExtendScript-facing tools, never silently
// absorbs some unrelated future tool the way relying on "More" would.
const TOOLS_STAGES: RailStage[] = [
    { id: "size",      label: "Size & Format",    toolIds: ["scale-composition", "adjust", "wall-tools", "extreme-tools-01", "extreme-tools-02"] },
    { id: "layers",    label: "Layers & Rigging", toolIds: ["random-layers", "master-of-nulls", "master-tools", "edit-tools", "mask-separator"] },
    { id: "utility",   label: "Utility",          toolIds: ["safe-generator", "find-and-replace", "project-buttons", "los-tools", "timesheet-tracker", "replicator"] },
    { id: "scripting", label: "Scripting",        toolIds: ["script-playground", "my-tools", "expressions-bank", "comp-inspector", "render-queue-manager"] },
];

export const ToolsScreen: React.FC<Props> = (props) => (
    <RailScreen
        categoryId="tools"
        title="Tools"
        subtitle="General AE utilities"
        badgeIcon={Wrench}
        stages={TOOLS_STAGES}
        {...props}
    />
);

export default ToolsScreen;
