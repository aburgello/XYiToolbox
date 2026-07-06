// =============================================================================
// src/js/main/hooks/useToolOrder.ts
// -----------------------------------------------------------------------------
// Loads and persists per-category tool ordering from ExtendScript storage.
// Silently falls back to TOOLS' declared order on any failure (no bridge,
// AE busy, etc.) -- this is a background preference load, not a user action.
// =============================================================================
import { useState, useEffect } from "react";
import { evalTS } from "../../lib/utils/bolt";
import type { ToolEntry } from "../toolRegistry";

export function useToolOrder(allTools: ToolEntry[]) {
    const [toolOrder, setToolOrder] = useState<Record<string, string[]>>({});

    useEffect(() => {
        (async () => {
            try {
                const orders = await evalTS("loadAllToolOrders");
                if (orders) setToolOrder(orders);
            } catch {
                // No bridge or genuine failure -- fall back to TOOLS' declared order.
            }
        })();
    }, []);

    const saveToolOrder = (categoryId: string, newOrder: ToolEntry[]) => {
        const ids = newOrder.map((t) => t.id);
        setToolOrder((prev) => ({ ...prev, [categoryId]: ids }));
        evalTS("saveToolOrder", categoryId, ids).catch(() => {
            // Failed save only means the order won't survive a restart.
        });
    };

    /** Returns the tools for a given category in the user's saved order,
     *  with any newly-added tools (not yet in saved order) appended at end. */
    const getOrderedTools = (categoryId: string): ToolEntry[] => {
        const toolsInCategory = allTools.filter((t) => t.categories.includes(categoryId));
        const savedOrder = toolOrder[categoryId];
        if (!savedOrder) return toolsInCategory;
        return [
            ...savedOrder
                .map((id) => toolsInCategory.find((t) => t.id === id))
                .filter((t): t is ToolEntry => !!t),
            ...toolsInCategory.filter((t) => !savedOrder.includes(t.id)),
        ];
    };

    return { toolOrder, saveToolOrder, getOrderedTools };
}
