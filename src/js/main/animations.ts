// =============================================================================
// src/js/main/animations.ts
// -----------------------------------------------------------------------------
// Shared Framer Motion variant definitions used across main.tsx and
// Toolset.tsx (and any future tools that need the same motion language).
// Import what you need -- don't redefine locally.
// =============================================================================
import type { Variants } from "motion/react";

// Icon "wiggle" on hover -- propagates from the parent motion element's
// whileHover="hover" to this child automatically via Framer Motion variant
// propagation. No per-icon hover listeners needed.
export const iconWiggle: Variants = {
    rest: { rotate: 0, scale: 1 },
    hover: { rotate: [0, -12, 10, -6, 0], scale: 1.12, transition: { duration: 0.45, ease: "easeInOut" } },
};

// Subtle lift applied to a card/button itself (separate from iconWiggle,
// which only ever targets the icon child).
export const cardLift: Variants = {
    rest: { y: 0, scale: 1 },
    hover: { y: -3, scale: 1.02, transition: { duration: 0.2, ease: "easeOut" } },
};

// Slightly more lift -- for the bigger home-screen category cards.
export const categoryLift: Variants = {
    rest: { y: 0, scale: 1 },
    hover: { y: -4, scale: 1.03, transition: { duration: 0.2, ease: "easeOut" } },
};

// Minimal lift for small action buttons (Toolset grid).
export const buttonLift: Variants = {
    rest: { y: 0 },
    hover: { y: -2, transition: { duration: 0.15, ease: "easeOut" } },
};
