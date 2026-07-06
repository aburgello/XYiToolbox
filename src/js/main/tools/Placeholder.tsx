// =============================================================================
// src/js/main/tools/Placeholder.tsx
// -----------------------------------------------------------------------------
// Generic "not wired up yet" page for a listbox-tab tool that's been placed
// into its category but doesn't have real logic ported yet -- the full-page
// equivalent of Toolset.tsx's stub() helper. Swap makePlaceholder(...) for a
// real component in main.tsx's TOOLS array once a tool's aeft.ts logic
// lands; nothing else needs to change.
// =============================================================================
import React from "react";
import { Construction } from "lucide-react";
import "../shared.scss";
import "./Placeholder.scss";

export function makePlaceholder(title: string, description: string): React.ComponentType {
    return function PlaceholderTool() {
        return (
            <div className="placeholder-tool">
                <h2>{title}</h2>
                <div className="placeholder-notice">
                    <Construction size={16} />
                    <span>Not wired up yet.</span>
                </div>
                <p className="hint">{description}</p>
            </div>
        );
    };
}
