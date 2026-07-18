// =============================================================================
// src/js/main/tools/quickFxData.ts
// -----------------------------------------------------------------------------
// Curated "effects I actually reach for" list for QuickFX.tsx -- a data
// array, not hardcoded buttons, so adding effect #21 later is a one-line
// edit here, not new component code (same split as Toolset.tsx's ACTIONS).
//
// matchName IS THE PART THAT MATTERS -- it's AE's stable internal effect
// identifier (independent of display name/UI language), what
// applyEffectToSelectedLayers() (aeft/effects.ts) actually passes to
// `effectsGroup.addProperty(matchName)`. The ones below are the widely-
// documented standard AE matchNames, but **UNVERIFIED against a real AE
// install from this session** -- same "confirm on first real test" caution
// this whole app already applies elsewhere (see CLAUDE.md). If a button
// here fails with "not recognised", the fix is almost always correcting
// that one matchName string, not the surrounding code.
//
// **How to find a real matchName if one of these is wrong (or to add a
// new effect later, including a third-party plugin)**: apply the effect
// once via AE's own native Effects & Presets search, select the layer it's
// on, then in the ExtendScript Toolkit / this app's Script Playground run:
//   alert(app.project.activeItem.selectedLayers[0].property("Effects").property(1).matchName)
// (property(1) = the first effect in the stack; bump the index if there's
// more than one already applied).
// =============================================================================
export interface QuickFxEntry {
    id: string;
    label: string;
    matchName: string;
    category: string;
}

export const QUICK_FX_CATEGORIES = ["Blur & Sharpen", "Transitions & Wipes", "Color", "Stylize", "Distort"] as const;

export const QUICK_FX: QuickFxEntry[] = [
    // --- Blur & Sharpen ------------------------------------------------
    { id: "fast-box-blur",     label: "Fast Box Blur",         matchName: "ADBE Box Blur2",              category: "Blur & Sharpen" },
    { id: "gaussian-blur",     label: "Gaussian Blur",         matchName: "ADBE Gaussian Blur 2",         category: "Blur & Sharpen" },
    { id: "directional-blur",  label: "Directional Blur",      matchName: "ADBE Motion Blur",             category: "Blur & Sharpen" },
    { id: "sharpen",           label: "Sharpen",               matchName: "ADBE Sharpen",                 category: "Blur & Sharpen" },

    // --- Transitions & Wipes --------------------------------------------
    { id: "linear-wipe",       label: "Linear Wipe",           matchName: "ADBE Linear Wipe",             category: "Transitions & Wipes" },
    { id: "gradient-wipe",     label: "Gradient Wipe",         matchName: "ADBE Gradient Wipe",           category: "Transitions & Wipes" },
    { id: "radial-wipe",       label: "Radial Wipe",           matchName: "ADBE Radial Wipe",             category: "Transitions & Wipes" },
    { id: "venetian-blinds",   label: "Venetian Blinds",       matchName: "ADBE Venetian Blinds",         category: "Transitions & Wipes" },
    { id: "block-dissolve",    label: "Block Dissolve",        matchName: "ADBE Block Dissolve",          category: "Transitions & Wipes" },

    // --- Color ------------------------------------------------------------
    { id: "lumetri-color",     label: "Lumetri Color",         matchName: "ADBE Lumetri",                 category: "Color" },
    { id: "curves",            label: "Curves",                matchName: "ADBE CurvesCustom",            category: "Color" },
    { id: "hue-saturation",    label: "Hue/Saturation",        matchName: "ADBE HUE SATURATION",          category: "Color" },
    { id: "levels",            label: "Levels",                matchName: "ADBE Easy Levels2",            category: "Color" },
    { id: "tint",              label: "Tint",                  matchName: "ADBE Tint",                    category: "Color" },
    { id: "brightness-contrast", label: "Brightness & Contrast", matchName: "ADBE Brightness & Contrast 2", category: "Color" },
    { id: "exposure",          label: "Exposure",              matchName: "ADBE Exposure2",               category: "Color" },
    { id: "vibrance",          label: "Vibrance",              matchName: "ADBE Vibrance",                category: "Color" },

    // --- Stylize ------------------------------------------------------------
    { id: "glow",              label: "Glow",                  matchName: "ADBE Glo2",                    category: "Stylize" },
    { id: "drop-shadow",       label: "Drop Shadow",           matchName: "ADBE Drop Shadow",             category: "Stylize" },

    // --- Distort ------------------------------------------------------------
    { id: "turbulent-displace", label: "Turbulent Displace",   matchName: "ADBE Turbulent Displace",      category: "Distort" },
];
