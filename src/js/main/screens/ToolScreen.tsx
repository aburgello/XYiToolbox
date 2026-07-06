// =============================================================================
// src/js/main/screens/ToolScreen.tsx
// -----------------------------------------------------------------------------
// Renders a single tool's full-page view (the "drill" into a tool from either
// a category list or a search result). Wraps the tool component in a
// ToolErrorBoundary and a React.Suspense fallback so lazy-loaded tools
// degrade gracefully.
// =============================================================================
import React, { Suspense } from "react";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { TOOLS, categoryStyleVars } from "../toolRegistry";
import { ToolErrorBoundary } from "../ToolErrorBoundary";
import { PaletteTrigger, triggerPalette } from "../CommandPalette";

interface Props {
    toolId: string;
    onBack: () => void;
}

// The two hub tools carry their own full-page header/tab chrome -- adding
// the generic tool-content-header above them would double up. Every other
// tool relies on this header for its title/description now that the
// per-tool internal <h2> + hint headers were removed (they duplicated it).
const HUB_TOOL_IDS = ["review-hub", "delivery-hub"];

export const ToolScreen: React.FC<Props> = ({ toolId, onBack }) => {
    const tool = TOOLS.find((t) => t.id === toolId);
    const showHeader = tool && !HUB_TOOL_IDS.includes(tool.id);

    return (
        <div className="drill-screen">
            <div className="drill-page-content">
                <div className="drill-header-row">
                    <motion.button className="back-button" onClick={onBack} whileHover={{ x: -2 }}>
                        <ArrowLeft size={14} /> Back
                    </motion.button>
                    <PaletteTrigger onClick={triggerPalette} />
                </div>
                <div className="drill-body" style={categoryStyleVars(tool?.categories[0])}>
                    {tool ? (
                        <ToolErrorBoundary toolLabel={tool.label}>
                            <Suspense fallback={<div style={{ width: "100%", height: "100%" }} />}>
                                {showHeader && (
                                    <div className="tool-content-header">
                                        <div className="tool-content-header-row">
                                            <span className="tool-content-header-icon">
                                                <tool.icon size={20} />
                                            </span>
                                            <h3 className="tool-content-header-title">{tool.label}</h3>
                                        </div>
                                        {tool.description && (
                                            <p className="tool-content-header-desc">{tool.description}</p>
                                        )}
                                    </div>
                                )}
                                <div className="tool-content-body">
                                    <tool.Component />
                                </div>
                            </Suspense>
                        </ToolErrorBoundary>
                    ) : (
                        <p className="hint">Tool not found.</p>
                    )}
                </div>
            </div>
        </div>
    );
};
