// =============================================================================
// src/js/main/themes.ts
// -----------------------------------------------------------------------------
// Named accent themes for the hidden theme picker (type "jacqui" into the
// home screen's search box). Deliberately non-invasive: only overrides
// --ov-accent and --ov-bg at the document root, the two tokens most of this
// app's accent-fallback-aware components (var(--ov-accent, #hex)) and
// background-fallback-aware components (var(--ov-bg, #1e1e1e)) already
// inherit. The four category color schemes (Localise/Review/Deliver/Tools)
// and the Toolset grid's own PALETTE are a deliberate, separate identity --
// this feature doesn't touch either, so it reads as "the neutral chrome got
// tinted," not a full reskin.
//
// Accent hues match the app's existing PALETTE cycle (Toolset.tsx) for
// visual consistency; --ov-bg per theme is a near-black tint of that hue
// (not the more saturated PALETTE bg tones, which are meant for small tile
// hover-glow contexts, not a whole-app background).
// =============================================================================
export interface Theme {
    id: string;
    name: string;
    accent: string;
    bg: string;
}

export const DEFAULT_THEME_ID = "default";

export const THEMES: Theme[] = [
    { id: "blossom",  name: "Blossom",  accent: "#f472b6", bg: "#241a1f" },
    { id: "lagoon",   name: "Lagoon",   accent: "#2dd4bf", bg: "#14201f" },
    { id: "dusk",     name: "Dusk",     accent: "#a78bfa", bg: "#1e1a26" },
    { id: "ember",    name: "Ember",    accent: "#fb923c", bg: "#211a14" },
    { id: "sapphire", name: "Sapphire", accent: "#60a5fa", bg: "#171e26" },
    // Gold completes the PALETTE cycle (Toolset.tsx) -- the one hue in
    // that 6-color set that never got a matching theme here. The other
    // three are new hues (not in PALETTE) chosen to actually round out the
    // spread rather than just adding more variations on what's already
    // covered -- a warm red, a cool green, and a low-saturation neutral
    // for anyone who wants "recolored" without "colorful".
    { id: "gold",     name: "Gold",     accent: "#facc15", bg: "#241f14" },
    { id: "crimson",  name: "Crimson",  accent: "#f87171", bg: "#251717" },
    { id: "emerald",  name: "Emerald",  accent: "#34d399", bg: "#132420" },
    { id: "slate",    name: "Slate",    accent: "#94a3b8", bg: "#1c2024" },
];

// Set once a user picks a non-default theme -- lets OVLibrary.tsx's own
// runtime accent-setter (it matches AE's host panel skin colour) know to
// back off instead of silently overwriting the user's choice the next time
// that tool happens to mount.
let userThemeActive = false;
export const hasUserTheme = (): boolean => userThemeActive;

export function applyTheme(themeId: string): void {
    const root = document.documentElement.style;
    if (!themeId || themeId === DEFAULT_THEME_ID) {
        userThemeActive = false;
        root.removeProperty("--ov-accent");
        root.removeProperty("--ov-bg");
        return;
    }
    const theme = THEMES.find((t) => t.id === themeId);
    if (!theme) return;
    userThemeActive = true;
    root.setProperty("--ov-accent", theme.accent);
    root.setProperty("--ov-bg", theme.bg);
}
