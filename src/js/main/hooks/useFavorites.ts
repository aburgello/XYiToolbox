// =============================================================================
// src/js/main/hooks/useFavorites.ts
// -----------------------------------------------------------------------------
// Loads and persists favorite tool/action pins from ExtendScript storage.
// Silently falls back to an empty list on any failure.
//
// SHARED MODULE-LEVEL STORE, not per-component state. Three components read
// this list at once -- HomeScreen (the star badge on each search result),
// Toolset (the gold Favourites group) and CommandPalette -- and HomeScreen
// RENDERS Toolset, so both are mounted simultaneously. With per-instance
// useState, starring a tool in the search results updated HomeScreen's copy
// and left Toolset's Favourites group stale until a remount. One store plus a
// subscriber set keeps every consumer in sync, and collapses what used to be
// three separate loadFavoriteTools bridge calls on mount into one.
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

let store: string[] = [];
const subscribers = new Set<(ids: string[]) => void>();
let loadStarted = false;

function publish(next: string[]) {
    store = next;
    subscribers.forEach((fn) => fn(next));
}

/** One-shot load, whichever consumer mounts first. */
function ensureLoaded() {
    if (loadStarted) return;
    loadStarted = true;
    (async () => {
        try {
            const ids = await evalTS("loadFavoriteTools");
            if (ids) publish(ids);
        } catch {
            // No bridge or genuine failure -- empty favorites is a fine default.
        }
    })();
}

export function useFavorites(allTools: ToolEntry[]) {
    const [favoriteIds, setFavoriteIds] = useState<string[]>(store);

    useEffect(() => {
        // useState setters are stable, so this identity is safe as a set key.
        subscribers.add(setFavoriteIds);
        ensureLoaded();
        // A consumer mounting after the load already resolved would otherwise
        // sit on the empty initial snapshot forever.
        if (store !== favoriteIds) setFavoriteIds(store);
        return () => {
            subscribers.delete(setFavoriteIds);
        };
    }, []);

    const toggleFavorite = (toolId: string, action?: string) => {
        const key = favoriteKey(toolId, action);
        const next = store.includes(key) ? store.filter((k) => k !== key) : [...store, key];
        publish(next);
        evalTS("saveFavoriteTools", next).catch(() => {
            // Failed save only means favorites won't survive a restart.
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
