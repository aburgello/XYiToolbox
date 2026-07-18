// =============================================================================
// src/js/main/ThemeDecoration.tsx
// -----------------------------------------------------------------------------
// Optional per-theme background flourish -- e.g. Blossom gets small twinkling
// stars. Off by default; switched on by double-clicking a theme's name in
// ThemePicker.tsx (see useTheme's decoratedThemes/toggleThemeDecoration).
// Rendered as a sibling layer inside HomeScreen's existing `.home-ambient-bg`
// (same z-index-0-behind-content layer the four category ambient blobs
// already live in) -- this is purely an additional decorative pass, not a
// replacement for those blobs.
//
// DELIBERATELY calm: particles are scattered across the whole area in 2D
// (each gets its own randomized top AND left, so they never read as a row),
// and every one runs the SAME single, very slow wander (see the shimmer
// keyframe in ThemeDecoration.scss) -- a gentle opacity/scale pulse while it
// slowly drifts through three randomized waypoints and back to its origin
// over a long cycle, so it genuinely relocates over time instead of pulsing
// in place, yet the loop is still seamless (0%/100% share the origin, no
// reset "jump"). There is intentionally NO fast/screen-traversing motion --
// this stays out of the way of daily work rather than pulling the eye.
// `drift` only biases the wander direction slightly (rise = tends up, fall =
// tends down, twinkle = free).
//
// Plain CSS keyframe animation per particle, not Framer Motion per-particle --
// a dozen+ independently-driven `motion` instances is unnecessary overhead
// for a background flourish; a few CSS custom properties per particle
// (position/duration/delay/drift) make each feel independent while staying
// cheap. `prefers-reduced-motion` is handled in the stylesheet, not here.
// =============================================================================
import React, { useMemo } from "react";
import {
    Star,
    Droplet,
    Sparkle,
    Flame,
    Snowflake,
    Sparkles,
    Flower2,
    Leaf,
    Hexagon,
    type LucideIcon,
} from "lucide-react";
import type { ThemeMotif } from "./themes";
import "./ThemeDecoration.scss";

interface MotifConfig {
    Icon: LucideIcon;
    // Only biases the tiny drift direction now (see file header) -- "rise"
    // floats up a few px, "fall" drifts down a few px, "twinkle" barely
    // moves. Nothing traverses the panel anymore.
    drift: "rise" | "fall" | "twinkle";
    // Filled icons read as "points of light" (stars, sparkles); outlined
    // ones as soft shapes (petals, snowflakes) -- purely which looks right
    // for that motif, unrelated to drift.
    solid: boolean;
    count: number;
}

const MOTIF_CONFIG: Record<ThemeMotif, MotifConfig> = {
    stars: { Icon: Star, drift: "twinkle", solid: true, count: 16 },
    bubbles: { Icon: Droplet, drift: "rise", solid: false, count: 14 },
    fireflies: { Icon: Sparkle, drift: "twinkle", solid: true, count: 16 },
    embers: { Icon: Flame, drift: "rise", solid: true, count: 12 },
    snowflakes: { Icon: Snowflake, drift: "fall", solid: false, count: 14 },
    sparkles: { Icon: Sparkles, drift: "twinkle", solid: true, count: 14 },
    petals: { Icon: Flower2, drift: "fall", solid: false, count: 12 },
    leaves: { Icon: Leaf, drift: "fall", solid: false, count: 12 },
    dots: { Icon: Hexagon, drift: "twinkle", solid: true, count: 14 },
};

// Deterministic "random enough" spread, no seeded-RNG dependency -- same
// approach as everything else in this app that just needs per-item variety,
// not true randomness (e.g. the ambient blobs' hand-picked per-corner delays).
function pseudo(i: number, salt: number): number {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

interface Props {
    motif: ThemeMotif;
    accent: string;
}

const ThemeDecoration: React.FC<Props> = ({ motif, accent }) => {
    const { Icon, drift, solid, count } = MOTIF_CONFIG[motif];

    const particles = useMemo(() => {
        const salt = motif.length + count;
        // One wander waypoint offset (px): horizontal is free, vertical is
        // biased by the motif's drift so e.g. bubbles tend upward overall.
        const waypoint = (i: number, s: number) => {
            const x = (pseudo(i, s) - 0.5) * 90;
            const yMag = pseudo(i, s + 100) * 55;
            const y = drift === "rise" ? -yMag : drift === "fall" ? yMag : (pseudo(i, s + 100) - 0.5) * 80;
            return { x, y };
        };
        return Array.from({ length: count }, (_, i) => {
            // Scatter across the WHOLE area in 2D -- randomized top as well
            // as left is what stops them lining up in a row.
            const left = pseudo(i, salt) * 94 + 3;
            const top = pseudo(i, salt + 6) * 90 + 3;
            const size = 8 + pseudo(i, salt + 1) * 8;
            // Very slow: 26-46s per full wander cycle. A negative
            // animation-delay starts each one already partway through, so
            // they never move or pulse in unison.
            const duration = 26 + pseudo(i, salt + 2) * 20;
            const delay = pseudo(i, salt + 3) * duration;
            // Three drift waypoints it eases through before returning to
            // origin -- the actual "phase into different positions".
            const w1 = waypoint(i, salt + 10);
            const w2 = waypoint(i, salt + 20);
            const w3 = waypoint(i, salt + 30);
            return { left, top, size, duration, delay, w1, w2, w3 };
        });
    }, [motif, count, drift]);

    return (
        <div className="theme-decor" aria-hidden="true">
            {particles.map((p, i) => (
                <span
                    key={i}
                    className="theme-decor-particle"
                    style={{
                        left: `${p.left}%`,
                        top: `${p.top}%`,
                        color: accent,
                        animationDuration: `${p.duration}s`,
                        animationDelay: `${-p.delay}s`,
                        "--decor-x1": `${p.w1.x}px`,
                        "--decor-y1": `${p.w1.y}px`,
                        "--decor-x2": `${p.w2.x}px`,
                        "--decor-y2": `${p.w2.y}px`,
                        "--decor-x3": `${p.w3.x}px`,
                        "--decor-y3": `${p.w3.y}px`,
                    } as React.CSSProperties}
                >
                    <Icon size={p.size} strokeWidth={1.5} fill={solid ? accent : "none"} />
                </span>
            ))}
        </div>
    );
};

export default ThemeDecoration;
