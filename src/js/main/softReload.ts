// =============================================================================
// src/js/main/softReload.ts
// -----------------------------------------------------------------------------
// "Soft reload" -- remount the whole React tree so every hook/screen re-reads
// its app.settings state, WITHOUT touching document.location.
//
// Replaces window.location.reload(), which is genuinely hazardous in a CEP
// panel: the panel's document is loaded by the host, and a JS-initiated hard
// reload can come back with a broken base URL so the bundled CSS/JS 404s --
// the panel returns as an unstyled white page with half-animated boxes
// (reported right after applying a team profile, which was the only caller).
// A remount achieves the same goal (all state is read on mount) with none of
// the risk: no asset re-fetch, no re-init of the CEP bridge, no white flash.
//
// Lives in its OWN module on purpose: main.tsx registers the handler and
// TeamDroplet triggers it, and having both import from here avoids the
// main -> HomeScreen -> TeamDroplet -> main import cycle.
// =============================================================================

let bump: (() => void) | null = null;

/** Called once by the app root to expose its remount trigger. */
export const registerSoftReload = (fn: (() => void) | null): void => {
    bump = fn;
};

/** Remounts the app so every mount-time settings read runs again. */
export const requestSoftReload = (): void => {
    if (bump) bump();
};
