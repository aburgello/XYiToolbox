// =============================================================================
// src/js/main/lib/toolUsage.ts
// -----------------------------------------------------------------------------
// WHICH TOOLS THIS PERSON USES, so ⌘K can offer them before a word is typed:
// the last few opened (Recent) and the ones opened most (Most used).
//
// Keys are app-generated, never user text: "tool:<registry id>",
// "action:<Toolset action id>" (custom buttons included -- their action id
// carries its own prefix), "custompage:<script id>". Recorded wherever the
// thing is USED, not only from the palette: main.tsx on every screen change,
// LocaliseScreen's own tool picks, Toolset's and the palette's action runs.
//
// PER VIEWER, in browser storage: a convenience (CLAUDE.md), so it survives a
// panel reload, degrades to "nothing yet" when storage is unavailable, and is
// never shared. Capped so it can't grow without bound.
// =============================================================================
const KEY = "xyi.toolUsage";
const CAP = 120;
type Usage = Record<string, { n: number; t: number }>;

function load(): Usage {
    try {
        const raw = JSON.parse(window.localStorage.getItem(KEY) || "{}");
        return raw && typeof raw === "object" ? (raw as Usage) : {};
    } catch {
        return {};
    }
}

/** Two records of one thing within this long are one use (a remount, a
 *  screen re-render), not two. */
const SAME_USE_MS = 1500;

export function recordUse(key: string): void {
    if (!key) return;
    try {
        const u = load();
        const now = Date.now();
        const prev = u[key];
        if (prev && now - prev.t < SAME_USE_MS) return;
        u[key] = { n: (prev ? prev.n : 0) + 1, t: now };
        const keys = Object.keys(u);
        if (keys.length > CAP) {
            keys.sort((a, b) => u[a].t - u[b].t).slice(0, keys.length - CAP).forEach((k) => delete u[k]);
        }
        window.localStorage.setItem(KEY, JSON.stringify(u));
    } catch {
        /* storage off: nothing remembered, nothing broken */
    }
}

/** Newest first. */
export function recentUses(limit: number): string[] {
    const u = load();
    return Object.keys(u).sort((a, b) => u[b].t - u[a].t).slice(0, limit);
}

/** Most uses first (ties: most recent), at least twice -- once is not a habit. */
export function mostUsed(limit: number, skip: string[] = []): string[] {
    const u = load();
    return Object.keys(u)
        .filter((k) => u[k].n >= 2 && skip.indexOf(k) === -1)
        .sort((a, b) => u[b].n - u[a].n || u[b].t - u[a].t)
        .slice(0, limit);
}
