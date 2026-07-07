// =============================================================================
// src/js/main/hooks/useCustomTools.ts
// -----------------------------------------------------------------------------
// Loads and persists user-saved Script Playground scripts ("custom tools").
// Each is either a "button" (auto-added as a one-click Toolset grid tile,
// run via runScript) or a "page" (listed in Script Playground's own "My
// Tools" panel, run on demand from there -- no dedicated nav entry).
// Shared between Toolset.tsx (resolves "button" entries into grid tiles)
// and ScriptPlayground.tsx (the save/list/run/delete UI) so both read the
// same persisted list. Same silently-falls-back-to-empty-on-no-bridge
// pattern as useFavorites.ts.
// =============================================================================
import { useState, useEffect, useCallback } from "react";
import { evalTS } from "../../lib/utils/bolt";

export interface CustomToolEntry {
    id: string;
    name: string;
    description: string;
    code: string;
    kind: "button" | "page";
}

export function useCustomTools() {
    const [customTools, setCustomTools] = useState<CustomToolEntry[]>([]);
    const [loaded, setLoaded] = useState(false);

    const reload = useCallback(async () => {
        try {
            const result = await evalTS("loadCustomTools");
            if (result && result.success) {
                setCustomTools(JSON.parse(result.message || "[]"));
            }
        } catch {
            // No bridge (preview) or genuine failure -- empty list is a fine default.
        }
        setLoaded(true);
    }, []);

    useEffect(() => { reload(); }, [reload]);

    const persist = useCallback(async (next: CustomToolEntry[]) => {
        setCustomTools(next);
        try {
            await evalTS("saveCustomTools", JSON.stringify(next));
        } catch {
            // Failed save only means the change won't survive a restart.
        }
    }, []);

    return { customTools, loaded, reload, persist };
}
