// =============================================================================
// src/js/main/hooks/useFavorites.ts
// -----------------------------------------------------------------------------
// Loads and persists favorite tool/action pins from ExtendScript storage.
// Silently falls back to an empty list on any failure.
// =============================================================================
import { useState, useEffect } from "react";
import { evalTS } from "../../lib/utils/bolt";
import type { ToolEntry } from "../toolRegistry";

/** Composite key: "toolId" for a whole tool, "toolId::action" for one action. */
export function favoriteKey(toolId: string, action?: string): string {
    return action ? `${toolId}::${action}` : toolId;
}

export function parseFavoriteKey(key: string): { toolId: string; action?: string } {
    const i = key.indexOf("::");
    return i === -1 ? { toolId: key } : { toolId: key.slice(0, i), action: key.slice(i + 2) };
}

export function useFavorites(allTools: ToolEntry[]) {
    const [favoriteIds, setFavoriteIds] = useState<string[]>([]);

    useEffect(() => {
        (async () => {
            try {
                const ids = await evalTS("loadFavoriteTools");
                if (ids) setFavoriteIds(ids);
            } catch {
                // No bridge or genuine failure -- empty favorites is a fine default.
            }
        })();
    }, []);

    const toggleFavorite = (toolId: string, action?: string) => {
        const key = favoriteKey(toolId, action);
        setFavoriteIds((prev) => {
            const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
            evalTS("saveFavoriteTools", next).catch(() => {
                // Failed save only means favorites won't survive a restart.
            });
            return next;
        });
    };

    /** Resolves stored keys to { tool, action? } pairs, silently dropping
     *  any entry whose tool id no longer exists in TOOLS. */
    const favoriteEntries = favoriteIds
        .map((key) => {
            const { toolId, action } = parseFavoriteKey(key);
            const tool = allTools.find((t) => t.id === toolId);
            return tool ? { tool, action } : null;
        })
        // Matches the actual shape .map() produces above ({ tool, action })
        // -- `action` is always a present property there (possibly
        // `undefined`, from parseFavoriteKey's optional field spread into a
        // literal), not an *optional* property. `action?: string` in the
        // predicate describes a different shape than what's really being
        // filtered, which is what TS's type-predicate soundness check was
        // catching.
        .filter((e): e is { tool: ToolEntry; action: string | undefined } => !!e);

    return { favoriteIds, favoriteEntries, toggleFavorite };
}
