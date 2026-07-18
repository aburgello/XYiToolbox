// =============================================================================
// src/js/main/ThemePicker.tsx
// -----------------------------------------------------------------------------
// The payoff for typing "jacqui" into the home screen's search box --
// HomeScreen.tsx swaps its normal search-results grid for this instead.
// Picking a swatch applies immediately (themes.ts's applyTheme) and
// persists (useTheme's setTheme) -- no separate "Save" step, consistent
// with every other droplet/picker in this app.
// =============================================================================
import React from "react";
import { Sparkles, Check, Wand2 } from "lucide-react";
import { THEMES, DEFAULT_THEME_ID } from "./themes";
import "./ThemePicker.scss";

interface Props {
    themeId: string;
    onPick: (id: string) => void;
    decoratedThemes?: Set<string>;
    onToggleDecoration?: (id: string) => void;
}

const ThemePicker: React.FC<Props> = ({ themeId, onPick, decoratedThemes, onToggleDecoration }) => (
    <div className="theme-picker">
        <p className="theme-picker-title">
            <Sparkles size={13} /> You found the secret theme picker.
        </p>
        <p className="hint">Recolors just the neutral chrome (buttons, focus rings, backgrounds) -- Localise/Review/Deliver/Tools keep their own colors.</p>
        <p className="hint">Double-click a theme's name to toggle a matching background decoration on the home screen.</p>
        <div className="theme-swatch-grid">
            <button
                type="button"
                className={themeId === DEFAULT_THEME_ID ? "theme-swatch selected" : "theme-swatch"}
                onClick={() => onPick(DEFAULT_THEME_ID)}
            >
                <span className="theme-swatch-dot theme-swatch-dot-default" />
                Default
                {themeId === DEFAULT_THEME_ID && <Check size={12} className="theme-swatch-check" />}
            </button>
            {THEMES.map((t) => {
                const decorated = decoratedThemes?.has(t.id) ?? false;
                return (
                    <button
                        type="button"
                        key={t.id}
                        className={themeId === t.id ? "theme-swatch selected" : "theme-swatch"}
                        onClick={() => onPick(t.id)}
                        onDoubleClick={(e) => {
                            e.preventDefault();
                            onToggleDecoration?.(t.id);
                        }}
                        title={`Double-click to ${decorated ? "remove" : "add"} ${t.name}'s background decoration`}
                        style={{ "--swatch-accent": t.accent } as React.CSSProperties}
                    >
                        <span className="theme-swatch-dot" />
                        {t.name}
                        {decorated && <Wand2 size={11} className="theme-swatch-decorated" />}
                        {themeId === t.id && <Check size={12} className="theme-swatch-check" />}
                    </button>
                );
            })}
        </div>
    </div>
);

export default ThemePicker;
