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
// A theme's optional decorative background motif -- off by default, switched
// on by double-clicking that theme's name in ThemePicker.tsx (see
// ThemeDecoration.tsx for how each motif renders). Purely cosmetic, no
// relation to --ov-accent/--ov-bg.
export type ThemeMotif =
    | "stars"
    | "bubbles"
    | "fireflies"
    | "embers"
    | "snowflakes"
    | "sparkles"
    | "petals"
    | "leaves"
    | "dots";

export interface Theme {
    id: string;
    name: string;
    accent: string;
    bg: string;
    motif: ThemeMotif;
}

export const DEFAULT_THEME_ID = "default";

// -----------------------------------------------------------------------------
// Two modifiers that sit ALONGSIDE the theme choice rather than inside it --
// a theme still means "accent + background tint", these say how the surfaces
// wear it. Both default to exactly today's look, so a user who never opens
// the picker sees no change at all.
//
//   surface : "panel" = the lifted grey surfaces (#2a2a2a tiles/cards) that
//                       ship today
//             "oled"  = every SURFACE drops to true black -- Toolset tiles,
//                       category cards, tool-page panels, inputs, rows. The
//                       page GROUND behind them keeps the active theme's own
//                       tint (only the Default theme, which has no tint to
//                       keep, goes fully black) -- picking OLED shouldn't
//                       cost you the theme you picked.
//
//   edge    : where a button's border colour comes from AT REST. Hover and
//             starred are NOT affected by this and always stay on the group
//             palette -- that's the "which section is this" cue, and it has
//             to survive whatever the resting edge is doing.
//               "neutral" = the plain grey edge that ships today
//               "group"   = that group's own accent, worn at rest
//               "theme"   = the active theme's accent, uniform across groups
// -----------------------------------------------------------------------------
export type Surface = "panel" | "oled";
export type EdgeMode = "neutral" | "group" | "theme";

export const DEFAULT_SURFACE: Surface = "panel";
export const DEFAULT_EDGE_MODE: EdgeMode = "neutral";

// The 6 group hues, mirrored from Toolset.tsx's PALETTE. Kept here because
// applyTheme has to publish them as CSS vars (see PALETTE_SLOTS below);
// Toolset.tsx still owns the literal fallback values used when nothing has
// set those vars yet.
const PALETTE_HUES = ["#2dd4bf", "#a78bfa", "#fb923c", "#f472b6", "#60a5fa", "#facc15"];
// Hand-tuned hover fills over the grey tile -- NOT a formula (they were
// picked by eye and are the shipped look), so they're reproduced verbatim
// rather than recomputed. Only the OLED variants below are derived.
const PALETTE_BG_PANEL = ["#20403e", "#352b4d", "#43301c", "#40263a", "#233348", "#403a1c"];

export const PALETTE_SLOTS = PALETTE_HUES.length;

// How strongly a resting accent edge reads. Full strength is reserved for
// hover and starred, so a resting edge has to sit clearly below both or
// every tile looks permanently hovered.
const REST_EDGE_ALPHA = 0.5;

// color-mix() is unavailable on this project's chrome74 build target (see
// CLAUDE.md), so every blended shade in this app is precomputed. These are
// computed in JS at apply time rather than by hand, since the theme-accent
// mode can't know its hue in advance.
function parseHex(hex: string): number[] {
    const s = hex.replace("#", "");
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function mixHex(hex: string, base: string, amount: number): string {
    const a = parseHex(hex);
    const b = parseHex(base);
    const out = a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount)));
    return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function rgba(hex: string, alpha: number): string {
    const c = parseHex(hex);
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

// ── the notes hue ───────────────────────────────────────────────────────────
//
// Workflows' notes carry their own colour, because steps and notes were reading
// as one list: same fill, same radius, and the note's left bar was the accent
// at FULL strength against the current step's 35%, so a note was more accented
// than the step you were standing on.
//
// DERIVED FROM THE ACCENT, NOT A LITERAL. A fixed amber was the first plan and
// it collides head-on with two shipping themes -- Ember is #fb923c and Gold is
// #facc15, so under either of those the steps and the notes would have been the
// same hue and the distinction would have quietly cost those users everything
// it bought everyone else. Rotating off the accent guarantees the separation in
// every theme, present and future.
//
// -134 DEGREES, not the complement. It is chosen so the DEFAULT teal lands on
// amber -- hsl(172) - 134 = hsl(38) -- which is the colour the design was
// signed off on; 180 would have given magenta. Every other theme lands
// somewhere clearly its own: Ember -> violet, Gold -> purple, Emerald ->
// orange, Blossom -> cyan.
//
// SATURATION IS CLAMPED AT BOTH ENDS. The floor keeps Slate usable: at 0.20
// saturation a rotated hue is a grey with an opinion, which is not a second
// colour at all. The ceiling keeps the loud themes bearable -- unclamped, Dusk
// gave the notes an acid #32f635 and Ember an electric #5a2dfb, which is a
// primary accent, and notes are supporting furniture. The band puts every
// theme's notes hue within a shade of the same weight.
//
// The accent every `var(--ov-accent, #hex)` in the app falls back to when no
// theme is picked. Named here so the notes hue is derived from the same colour
// the steps are actually drawn in, rather than from nothing.
const DEFAULT_ACCENT = "#2dd4bf";
const NOTE_HUE_SHIFT = -134;
const NOTE_MIN_SAT = 0.5;
const NOTE_MAX_SAT = 0.6;
const NOTE_L_SOLID = 0.58;
const NOTE_L_SOFT = 0.72;

function hexToHsl(hex: string): number[] {
    const c = parseHex(hex).map((v) => v / 255);
    const max = Math.max(c[0], c[1], c[2]);
    const min = Math.min(c[0], c[1], c[2]);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === c[0]) h = (c[1] - c[2]) / d + (c[1] < c[2] ? 6 : 0);
    else if (max === c[1]) h = (c[2] - c[0]) / d + 2;
    else h = (c[0] - c[1]) / d + 4;
    return [h * 60, sat, l];
}

function hslToHex(h: number, sat: number, l: number): string {
    const hh = ((h % 360) + 360) % 360;
    const chroma = (1 - Math.abs(2 * l - 1)) * sat;
    const x = chroma * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = l - chroma / 2;
    let rgb = [0, 0, 0];
    if (hh < 60) rgb = [chroma, x, 0];
    else if (hh < 120) rgb = [x, chroma, 0];
    else if (hh < 180) rgb = [0, chroma, x];
    else if (hh < 240) rgb = [0, x, chroma];
    else if (hh < 300) rgb = [x, 0, chroma];
    else rgb = [chroma, 0, x];
    return "#" + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

/** The notes accent for a given theme accent, solid and soft. */
function noteHues(accent: string): { solid: string; soft: string } {
    const hsl = hexToHsl(accent);
    const sat = Math.min(Math.max(hsl[1], NOTE_MIN_SAT), NOTE_MAX_SAT);
    const hue = hsl[0] + NOTE_HUE_SHIFT;
    return { solid: hslToHex(hue, sat, NOTE_L_SOLID), soft: hslToHex(hue, sat, NOTE_L_SOFT) };
}

// A group's hover fill: the shipped hand-tuned value on the grey surface,
// and a much lower lift on black -- a fill blended for #2a2a2a reads as a
// lit patch floating on #000.
function hoverBg(hex: string, slot: number, surface: Surface): string {
    return surface === "oled" ? mixHex(hex, "#080808", 0.17) : PALETTE_BG_PANEL[slot];
}

export const THEMES: Theme[] = [
    { id: "blossom",  name: "Blossom",  accent: "#f472b6", bg: "#241a1f", motif: "stars" },
    { id: "lagoon",   name: "Lagoon",   accent: "#2dd4bf", bg: "#14201f", motif: "bubbles" },
    { id: "dusk",     name: "Dusk",     accent: "#a78bfa", bg: "#1e1a26", motif: "fireflies" },
    { id: "ember",    name: "Ember",    accent: "#fb923c", bg: "#211a14", motif: "embers" },
    { id: "sapphire", name: "Sapphire", accent: "#60a5fa", bg: "#171e26", motif: "snowflakes" },
    // Gold completes the PALETTE cycle (Toolset.tsx) -- the one hue in
    // that 6-color set that never got a matching theme here. The other
    // three are new hues (not in PALETTE) chosen to actually round out the
    // spread rather than just adding more variations on what's already
    // covered -- a warm red, a cool green, and a low-saturation neutral
    // for anyone who wants "recolored" without "colorful".
    { id: "gold",     name: "Gold",     accent: "#facc15", bg: "#241f14", motif: "sparkles" },
    { id: "crimson",  name: "Crimson",  accent: "#f87171", bg: "#251717", motif: "petals" },
    { id: "emerald",  name: "Emerald",  accent: "#34d399", bg: "#132420", motif: "leaves" },
    { id: "slate",    name: "Slate",    accent: "#94a3b8", bg: "#1c2024", motif: "dots" },
];

// Set once a user picks a non-default theme -- lets OVLibrary.tsx's own
// runtime accent-setter (it matches AE's host panel skin colour) know to
// back off instead of silently overwriting the user's choice the next time
// that tool happens to mount.
let userThemeActive = false;
export const hasUserTheme = (): boolean => userThemeActive;

export function applyTheme(
    themeId: string,
    surface: Surface = DEFAULT_SURFACE,
    edgeMode: EdgeMode = DEFAULT_EDGE_MODE,
): void {
    const root = document.documentElement.style;
    const theme = !themeId || themeId === DEFAULT_THEME_ID ? null : THEMES.find((t) => t.id === themeId) || null;

    userThemeActive = !!theme;
    if (theme) {
        root.setProperty("--ov-accent", theme.accent);
        // The theme's own tint SURVIVES OLED. OLED is about the surfaces
        // sitting on the ground, not about erasing the ground -- blacking
        // this out too would mean picking OLED silently cancelled the theme.
        root.setProperty("--ov-bg", theme.bg);
    } else {
        root.removeProperty("--ov-accent");
        // No theme means no tint to preserve, so OLED goes all the way.
        if (surface === "oled") {
            root.setProperty("--ov-bg", "#000000");
        } else {
            root.removeProperty("--ov-bg");
        }
    }

    applySurface(root, surface);
    applyPalette(root, surface, edgeMode, theme ? theme.accent : null);
}

// Surface tokens, read across the app's stylesheets as
// `var(--surface-N, <the shipped grey>)`. Left UNSET on the panel surface so
// every one of those falls through to its own literal -- nothing changes for
// a user who never touches this.
//
//   --surface-0       recessed wells (inputs, code blocks, list grounds)
//   --surface-1       the standard raised surface (tiles, cards, rows)
//   --surface-2       the layer above that (open dropdowns, hovered rows)
//   --surface-edge    CONTAINER edges -- panels, cards, section boxes
//   --surface-border  ELEMENT edges -- tiles, inputs, chips
//   --surface-divider faint internal rules between sections
//
// The --tile-* names are the Toolset grid's older, narrower aliases, kept
// because that file was tokenised first; they resolve to the same values.
//
// **Edge weights are the load-bearing part of OLED, not an afterthought.**
// The first cut used one flat #262626 for every edge and the studio's read
// was "everything is washed out": once the fill difference between a card
// and its ground is gone, the border is the ONLY thing left saying where a
// container ends, and it has to work on a theme's tinted ground as well as
// on black. So containers are pushed hardest (--surface-edge), elements sit
// a step below, and only genuine internal rules stay faint. If OLED ever
// looks flat again, raise --surface-edge before touching anything else.
function applySurface(root: CSSStyleDeclaration, surface: Surface): void {
    const OLED_TOKENS: { [k: string]: string } = {
        "--surface-0": "#000000",
        "--surface-1": "#000000",
        // Not black: this is the layer meant to read as ABOVE --surface-1
        // (an open dropdown, a hovered row), which needs something to
        // separate it from the black underneath.
        "--surface-2": "#101010",
        "--surface-edge": "#424242",
        "--surface-border": "#303030",
        // Raised from #212121 after seeing it for real: the section rules
        // were tuned before the tiles gained resting edges, and ended up the
        // faintest thing on a screen full of loud outlines.
        "--surface-divider": "#2a2a2a",
        // NOT a colour -- an indirection. Elements that carry their own
        // category vars (the home screen's four cards) resolve --cat-edge in
        // their OWN context, so this one root token yields four different
        // accents. Set only on OLED, so nothing changes on the panel surface.
        "--surface-cat-edge": "var(--cat-edge)",
        "--tile-bg": "#000000",
        "--tile-border": "#303030",
        "--tile-divider": "#2a2a2a",
        // The Toolset panel is a container, so it takes the container weight.
        "--tile-panel-border": "#424242",
        // With no fill difference at rest, hover needs a crisp edge to read
        // as a state change rather than just a faint glow.
        "--tile-hover-ring": "1px",
    };
    Object.keys(OLED_TOKENS).forEach((k) => {
        if (surface === "oled") {
            root.setProperty(k, OLED_TOKENS[k]);
        } else {
            root.removeProperty(k);
        }
    });
}

// Publishes the 6 group accents as CSS vars (--pal-N-border/-bg/-glow/-edge)
// that Toolset.tsx's per-group inline styles point at. Doing it through the
// cascade rather than through React state is deliberate: the picker and the
// Toolset grid are mounted on the home screen AT THE SAME TIME, so a change
// has to reach the grid live, with no prop threading between two unrelated
// subtrees.
//
// -border/-bg/-glow are the group's own hue ALWAYS -- hover and starred read
// those, and the edge mode must not touch them. Only -edge (the resting
// border) varies, and it's left UNSET on "neutral" so the tile falls back to
// its plain grey border.
function applyPalette(
    root: CSSStyleDeclaration,
    surface: Surface,
    edgeMode: EdgeMode,
    accent: string | null,
): void {
    for (let i = 0; i < PALETTE_SLOTS; i++) {
        const hue = PALETTE_HUES[i];
        root.setProperty(`--pal-${i}-border`, hue);
        root.setProperty(`--pal-${i}-bg`, hoverBg(hue, i, surface));
        root.setProperty(`--pal-${i}-glow`, rgba(hue, 0.35));

        // "Theme" with no theme picked has no hue to borrow -- fall back to
        // the group's own rather than inventing one.
        const edgeHue = edgeMode === "theme" ? accent || hue : edgeMode === "group" ? hue : null;
        if (edgeHue) {
            root.setProperty(`--pal-${i}-edge`, rgba(edgeHue, REST_EDGE_ALPHA));
        } else {
            root.removeProperty(`--pal-${i}-edge`);
        }
    }

    // THE NOTES HUE, written on every apply -- including with no theme picked,
    // where the accent everything else falls back to is the default teal. The
    // alpha variants are computed HERE rather than in the stylesheet because
    // color-mix() is Chrome 111 and the target is chrome74, so CSS cannot
    // derive a translucent fill from a custom property's hex.
    const note = noteHues(accent || DEFAULT_ACCENT);
    root.setProperty("--ov-note", note.solid);
    root.setProperty("--ov-note-soft", note.soft);
    root.setProperty("--ov-note-edge", rgba(note.solid, 0.18));
    root.setProperty("--ov-note-fill", rgba(note.solid, 0.055));
    root.setProperty("--ov-note-wash", rgba(note.solid, 0.03));
}
