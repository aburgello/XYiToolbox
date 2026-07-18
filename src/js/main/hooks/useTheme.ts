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
    // Which theme ids have their background decoration (see themes.ts's
    // per-theme motif / ThemeDecoration.tsx) switched on -- toggled by
    // double-clicking a theme's name in ThemePicker.tsx. Persisted as a
    // tab-separated list (shell.ts's saveThemeDecorations), independent of
    // which theme is actually active right now.
    const [decoratedThemes, setDecoratedThemes] = useState<Set<string>>(new Set());

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
            try {
                const decoResult = await evalTS("loadThemeDecorations");
                if (decoResult && decoResult.success && decoResult.message) {
                    setDecoratedThemes(new Set(decoResult.message.split("\t").filter(Boolean)));
                }
            } catch {
                // No bridge (preview) or never saved -- no decorations is a fine default.
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

    const toggleThemeDecoration = useCallback((id: string) => {
        setDecoratedThemes((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            evalTS("saveThemeDecorations", Array.from(next).join("\t")).catch(() => {
                // Failed save only means the toggle won't survive a restart.
            });
            return next;
        });
    }, []);

    return { themeId, setTheme, decoratedThemes, toggleThemeDecoration };
}
