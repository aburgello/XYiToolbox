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
import { THEMES, DEFAULT_THEME_ID, Surface, EdgeMode } from "./themes";
import SegmentedToggle from "./SegmentedToggle";
import "./ThemePicker.scss";

interface Props {
    themeId: string;
    onPick: (id: string) => void;
    decoratedThemes?: Set<string>;
    onToggleDecoration?: (id: string) => void;
    // The two modifiers that compose with the theme (see themes.ts). Optional
    // so an older/simpler call site can still mount just the swatch grid.
    surface?: Surface;
    onPickSurface?: (s: Surface) => void;
    edgeMode?: EdgeMode;
    onPickEdgeMode?: (m: EdgeMode) => void;
}

const ThemePicker: React.FC<Props> = ({
    themeId,
    onPick,
    decoratedThemes,
    onToggleDecoration,
    surface,
    onPickSurface,
    edgeMode,
    onPickEdgeMode,
}) => (
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

        {onPickSurface && onPickEdgeMode && (
            <div className="theme-options">
                <div className="theme-option-row">
                    <span className="theme-option-label">Surface</span>
                    <SegmentedToggle
                        name="theme-surface"
                        value={surface || "panel"}
                        onChange={(v) => onPickSurface(v as Surface)}
                        options={[
                            { value: "panel", label: "Panel" },
                            { value: "oled", label: "OLED" },
                        ]}
                    />
                </div>
                <p className="hint">
                    OLED drops every surface -- Toolset tiles, category cards, tool panels, inputs -- to true
                    black. Your theme's own background tint stays, so the colour you picked survives.
                </p>

                <div className="theme-option-row">
                    <span className="theme-option-label">Border at rest</span>
                    <SegmentedToggle
                        name="theme-edge"
                        value={edgeMode || "neutral"}
                        onChange={(v) => onPickEdgeMode(v as EdgeMode)}
                        options={[
                            { value: "neutral", label: "Neutral" },
                            { value: "group", label: "Group" },
                            { value: "theme", label: "Theme" },
                        ]}
                    />
                </div>
                <p className="hint">
                    Whether a button's outline is visible before you touch it: plain grey, its own section colour,
                    or the theme's. Hover and starred tools always keep their section colour either way.
                    {edgeMode === "theme" && themeId === DEFAULT_THEME_ID && (
                        <span className="theme-option-warn"> Pick a theme above for this to have a colour to use.</span>
                    )}
                </p>
            </div>
        )}
    </div>
);

export default ThemePicker;
