// =============================================================================
// src/js/main/lib/darkenDefaults.ts
// -----------------------------------------------------------------------------
// The studio-standard scrim, in one place.
//
// Read by BOTH the Darken tool page (as its initial control values, and by its
// "Quick Darken" button) and Toolset's one-click "Quick Darken" action. It
// lives in its own module rather than in Darken.tsx so Toolset can import the
// numbers without dragging the lazily-loaded tool component into its bundle.
//
// Change the numbers here and every Quick Darken surface follows.
// =============================================================================
export const DARKEN_DEFAULTS = {
    style: "pool",
    /** Percent. Enough to lift a CTA off busy artwork without reading as a wash. */
    opacity: 55,
    /** Pixels. Generous on purpose -- the falloff should never be a visible edge. */
    feather: 200,
    /** Percent of comp height. Only used by the Bottom/Top band styles. */
    coverage: 38,
} as const;
