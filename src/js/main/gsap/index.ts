// =============================================================================
// src/js/main/gsap/index.ts
// -----------------------------------------------------------------------------
// GSAP registration and shared configuration for the toolbox panel.
//
// All GSAP usage flows through this module so we can:
//   - Register ScrollTrigger once (even though we don't use it much)
//   - Set global defaults (ease, duration) in one place
//   - Export reusable animation helpers
// =============================================================================
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Register plugins (ScrollTrigger not used in CEP but registered for future use)
gsap.registerPlugin(ScrollTrigger);

// Global defaults — tuned for the toolbox's dark, compact UI
// Shorter durations than GSAP's defaults because CEP panels feel sluggish
// with long animations (Chrome 74 CEF is less performant than a real browser)
gsap.defaults({
    ease: "power2.out",
    duration: 0.4,
});

// Easing presets used across the panel
export const easings = {
    // Smooth, slightly elastic — for entrances
    spring: "back.out(1.7)",
    // Gentle ease-out — for most UI transitions
    easeOut: "power2.out",
    // Smooth ease-in-out — for progress bars
    smooth: "sine.inOut",
    // Quick snap — for micro-interactions
    snap: "power3.inOut",
    // Calm ease-in — for exits
    easeIn: "power2.in",
    // Custom spring — for status icons
    statusPop: { type: "spring", stiffness: 400, damping: 24 },
} as const;

// Animation variants for screen transitions
export const screenVariants = {
    enter: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { duration: 0.18, ease: "power2.out" as const },
    },
    exit: {
        opacity: 0,
        y: 8,
        scale: 0.98,
        transition: { duration: 0.15, ease: "power2.in" as const },
    },
};

// Animation variants for tool cards
export const cardVariants = {
    hidden: { opacity: 0, y: 12, scale: 0.97 },
    visible: (i: number) => ({
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
            duration: 0.3,
            ease: "back.out(1.2)" as const,
            delay: i * 0.05,
        },
    }),
    hover: {
        y: -4,
        scale: 1.02,
        transition: { duration: 0.15, ease: "power2.out" as const },
    },
    tap: {
        scale: 0.97,
        transition: { duration: 0.1, ease: "power2.in" as const },
    },
};

// Animation variants for category cards
export const categoryCardVariants = {
    hidden: { opacity: 0, y: 16, scale: 0.95 },
    visible: (i: number) => ({
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
            duration: 0.35,
            ease: "back.out(1.3)" as const,
            delay: i * 0.08,
        },
    }),
    hover: {
        y: -5,
        scale: 1.03,
        transition: { duration: 0.2, ease: "power2.out" as const },
    },
    tap: {
        scale: 0.96,
        transition: { duration: 0.1, ease: "power2.in" as const },
    },
};

// Stagger configuration for list animations
export const staggerConfig = {
    list: { amount: 0.05, from: "start" },
    cards: { amount: 0.08, from: "center" },
    quick: { amount: 0.03, from: "start" },
};

export default gsap;
