// =============================================================================
// src/js/main/hooks/useTheme.ts
// -----------------------------------------------------------------------------
// Loads and persists the hidden theme picker's current selection. Called
// independently wherever it's needed (HomeScreen's picker UI) -- same
// each-call-loads-its-own-copy convention as useFavorites/useCustomTools
// elsewhere in this app, not a single shared context. Applying is cheap and
// idempotent (themes.ts's applyTheme just sets two CSS custom properties),
// so redundant loads across call sites cost nothing visible.
// =============================================================================
import { useState, useEffect, useCallback } from "react";
import { evalTS } from "../../lib/utils/bolt";
import { applyTheme, DEFAULT_THEME_ID } from "../themes";

export function useTheme() {
    const [themeId, setThemeIdState] = useState(DEFAULT_THEME_ID);

    useEffect(() => {
        (async () => {
            try {
                const result = await evalTS("loadTheme");
                if (result && result.success && result.message) {
                    setThemeIdState(result.message);
                    applyTheme(result.message);
                }
            } catch {
                // No bridge (preview) or never saved -- default theme is a fine default.
            }
        })();
    }, []);

    const setTheme = useCallback((id: string) => {
        setThemeIdState(id);
        applyTheme(id);
        evalTS("saveTheme", id).catch(() => {
            // Failed save only means the choice won't survive a restart.
        });
    }, []);

    return { themeId, setTheme };
}
