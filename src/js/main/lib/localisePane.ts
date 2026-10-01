// =============================================================================
// src/js/main/lib/localisePane.ts
// -----------------------------------------------------------------------------
// WHICH PANE THE LOCALISE LANDING SHOWS, askable from outside it. The Tracker
// is a pane of that page with no page of its own, so a shortcut that goes "to
// the Tracker" has to say so two ways: the remembered pane (read when the
// page mounts) and, when the page is already on screen, a nudge to the one
// mounted. Browser storage, a per-viewer convenience like the pane itself.
// =============================================================================
export type LocalisePane = "csv" | "batch" | "tracker";

export const PANE_KEY = "xyi.localise.pane";

let listener: ((p: LocalisePane) => void) | null = null;

/** The mounted Localise screen registers here; returns its own unregister. */
export function onLocalisePaneRequest(cb: (p: LocalisePane) => void): () => void {
    listener = cb;
    return () => { if (listener === cb) listener = null; };
}

export function requestLocalisePane(p: LocalisePane): void {
    try { window.localStorage.setItem(PANE_KEY, p); } catch { /* storage off: the nudge still lands */ }
    if (listener) listener(p);
}
