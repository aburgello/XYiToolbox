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
import {
    applyTheme,
    DEFAULT_THEME_ID,
    DEFAULT_SURFACE,
    DEFAULT_EDGE_MODE,
    Surface,
    EdgeMode,
} from "../themes";

export function useTheme() {
    const [themeId, setThemeIdState] = useState(DEFAULT_THEME_ID);
    // Surface (grey vs black) + where a button's RESTING border colour comes
    // from -- two modifiers that compose with the theme rather than living
    // inside it (see themes.ts). Both are re-applied together on every
    // change, since applyTheme derives its tokens from the combination.
    const [surface, setSurfaceState] = useState<Surface>(DEFAULT_SURFACE);
    const [edgeMode, setEdgeModeState] = useState<EdgeMode>(DEFAULT_EDGE_MODE);
    // Which theme ids have their background decoration (see themes.ts's
    // per-theme motif / ThemeDecoration.tsx) switched on -- toggled by
    // double-clicking a theme's name in ThemePicker.tsx. Persisted as a
    // tab-separated list (shell.ts's saveThemeDecorations), independent of
    // which theme is actually active right now.
    const [decoratedThemes, setDecoratedThemes] = useState<Set<string>>(new Set());

    useEffect(() => {
        (async () => {
            // All three are read before anything is applied -- applying the
            // theme first and the modifiers second would flash the grey
            // surface for a frame on an OLED-configured machine.
            let id = DEFAULT_THEME_ID;
            let surf: Surface = DEFAULT_SURFACE;
            let edge: EdgeMode = DEFAULT_EDGE_MODE;
            try {
                const result = await evalTS("loadTheme");
                if (result && result.success && result.message) id = result.message;
            } catch {
                // No bridge (preview) or never saved -- default theme is a fine default.
            }
            try {
                const s = await evalTS("loadThemeSurface");
                if (s && s.success && s.message === "oled") surf = "oled";
            } catch {
                // Same: the panel surface is the shipped default.
            }
            try {
                const b = await evalTS("loadThemeBorders");
                if (b && b.success && (b.message === "group" || b.message === "theme")) edge = b.message;
            } catch {
                // Same: the plain grey edge is the shipped default.
            }
            setThemeIdState(id);
            setSurfaceState(surf);
            setEdgeModeState(edge);
            applyTheme(id, surf, edge);

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

    const setTheme = useCallback(
        (id: string) => {
            setThemeIdState(id);
            applyTheme(id, surface, edgeMode);
            evalTS("saveTheme", id).catch(() => {
                // Failed save only means the choice won't survive a restart.
            });
        },
        [surface, edgeMode],
    );

    const setSurface = useCallback(
        (next: Surface) => {
            setSurfaceState(next);
            applyTheme(themeId, next, edgeMode);
            evalTS("saveThemeSurface", next).catch(() => {
                // Failed save only means the choice won't survive a restart.
            });
        },
        [themeId, edgeMode],
    );

    const setEdgeMode = useCallback(
        (next: EdgeMode) => {
            setEdgeModeState(next);
            applyTheme(themeId, surface, next);
            evalTS("saveThemeBorders", next).catch(() => {
                // Failed save only means the choice won't survive a restart.
            });
        },
        [themeId, surface],
    );

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

    return {
        themeId,
        setTheme,
        surface,
        setSurface,
        edgeMode,
        setEdgeMode,
        decoratedThemes,
        toggleThemeDecoration,
    };
}
