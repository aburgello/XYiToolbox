// =============================================================================
// src/js/main/lib/keyInterest.ts
// -----------------------------------------------------------------------------
// WHICH KEYS AE HANDS THE PANEL instead of keeping (⌘K, and a lone Control
// for the palette's double-tap). ⌘K is AE's own
// Composition Settings, so while the panel has focus AE took it before the
// palette ever saw it; the panel now claims it (Ctrl+K on Windows) for as long
// as it is loaded.
//
// ONE list, because registerKeyEventsInterest REPLACES the whole set: a tool
// claiming its arrows and releasing with "[]" would have silently dropped ⌘K.
// Tools set THEIR keys here (setToolKeys) and release with setToolKeys(null);
// the palette's key stays either way.
//
// Nothing reaches a panel while AE's own windows have focus -- that is CEP,
// not something any registration changes. Hence the search button too.
// =============================================================================
import { csi } from "../../lib/utils/bolt";

const isMac = () => {
    try { return /^Mac/i.test(navigator.platform); } catch { return true; }
};

/** ⌘K / Ctrl+K (macOS virtual key 40 is K; Windows/HTML 75), and Control
 *  pressed ALONE for the double-tap (macOS 59 left, 62 right; Windows 17) --
 *  claimed with and without the ctrl flag, since hosts report a lone
 *  modifier either way. */
function paletteKeys(): Record<string, unknown>[] {
    const ctrl = isMac() ? [59, 62] : [17];
    const lone: Record<string, unknown>[] = [];
    ctrl.forEach((k) => { lone.push({ keyCode: k, ctrlKey: true }); lone.push({ keyCode: k, ctrlKey: false }); });
    return (isMac() ? [{ keyCode: 40, metaKey: true }] : [{ keyCode: 75, ctrlKey: true }] as Record<string, unknown>[]).concat(lone);
}

let toolKeys: Record<string, unknown>[] = [];

function apply(): void {
    try { csi.registerKeyEventsInterest(JSON.stringify(paletteKeys().concat(toolKeys))); } catch { /* no host (browser preview) */ }
}

/** Called once at startup: ⌘K reaches the palette whenever the panel has focus. */
export function claimPaletteKey(): void {
    apply();
}

/** A tool's own keys, on top of the palette's; null releases them. Accepts the
 *  JSON string the tools already build. */
export function setToolKeys(keys: string | Record<string, unknown>[] | null): void {
    if (!keys) toolKeys = [];
    else if (typeof keys === "string") {
        try { toolKeys = JSON.parse(keys) || []; } catch { toolKeys = []; }
    } else toolKeys = keys;
    apply();
}
