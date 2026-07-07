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
import { Sparkles, Check } from "lucide-react";
import { THEMES, DEFAULT_THEME_ID } from "./themes";
import "./ThemePicker.scss";

interface Props {
    themeId: string;
    onPick: (id: string) => void;
}

const ThemePicker: React.FC<Props> = ({ themeId, onPick }) => (
    <div className="theme-picker">
        <p className="theme-picker-title">
            <Sparkles size={13} /> You found the secret theme picker.
        </p>
        <p className="hint">Recolors just the neutral chrome (buttons, focus rings, backgrounds) -- Localise/Review/Deliver/Tools keep their own colors.</p>
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
            {THEMES.map((t) => (
                <button
                    type="button"
                    key={t.id}
                    className={themeId === t.id ? "theme-swatch selected" : "theme-swatch"}
                    onClick={() => onPick(t.id)}
                    style={{ "--swatch-accent": t.accent } as React.CSSProperties}
                >
                    <span className="theme-swatch-dot" />
                    {t.name}
                    {themeId === t.id && <Check size={12} className="theme-swatch-check" />}
                </button>
            ))}
        </div>
    </div>
);

export default ThemePicker;
