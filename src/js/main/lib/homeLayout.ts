// =============================================================================
// src/js/main/lib/homeLayout.ts
// -----------------------------------------------------------------------------
// The home screen as blocks the artist arranges: the Toolset, the four
// category cards, Active Jobs. Order, hidden, and the cards' layout (a row of
// four, a 2x2 grid, or a slim bar). Per machine in app.settings
// ("OVHomeLayout", in PROFILE_KEYS so it travels with a profile).
//
// Stored as app-generated tokens (never user text, so a tab list is safe):
// block ids in order, "-<id>" for a hidden block, "cards:<layout>".
// A block the saved order doesn't know is APPENDED, never lost -- the same
// merge-over-default rule as the Toolset's own order.
// =============================================================================
import { evalTS } from "../../lib/utils/bolt";

export type HomeBlockId = "toolset" | "cards" | "jobs";
export type CardsLayout = "row" | "grid" | "bar";

export const HOME_BLOCKS: { id: HomeBlockId; label: string }[] = [
    { id: "toolset", label: "Toolset" },
    { id: "cards", label: "Localise · Review · Deliver · Tools" },
    { id: "jobs", label: "Active Jobs" },
];

export interface HomeLayout {
    order: HomeBlockId[];
    hidden: HomeBlockId[];
    cards: CardsLayout;
}

export const DEFAULT_HOME_LAYOUT: HomeLayout = { order: ["toolset", "cards", "jobs"], hidden: [], cards: "row" };

const isBlock = (s: string): s is HomeBlockId => HOME_BLOCKS.some((b) => b.id === s);

export function parseHomeLayout(tokens: string[] | null | undefined): HomeLayout {
    const order: HomeBlockId[] = [];
    const hidden: HomeBlockId[] = [];
    let cards: CardsLayout = "row";
    for (const raw of tokens || []) {
        const t = String(raw || "").trim();
        if (t.indexOf("cards:") === 0) {
            const v = t.slice(6);
            if (v === "row" || v === "grid" || v === "bar") cards = v;
            continue;
        }
        const hid = t.charAt(0) === "-";
        const id = hid ? t.slice(1) : t;
        if (!isBlock(id) || order.indexOf(id) !== -1) continue;
        order.push(id);
        if (hid) hidden.push(id);
    }
    for (const b of DEFAULT_HOME_LAYOUT.order) if (order.indexOf(b) === -1) order.push(b);
    return { order, hidden, cards };
}

export function serialiseHomeLayout(l: HomeLayout): string[] {
    return l.order.map((id) => (l.hidden.indexOf(id) !== -1 ? "-" + id : id)).concat(["cards:" + l.cards]);
}

export async function loadHomeLayout(): Promise<HomeLayout> {
    try {
        const raw = (await evalTS("loadHomeLayout")) as unknown as string[];
        return parseHomeLayout(Array.isArray(raw) ? raw : []);
    } catch {
        return DEFAULT_HOME_LAYOUT;
    }
}

export function saveHomeLayout(l: HomeLayout): void {
    Promise.resolve(evalTS("saveHomeLayout", serialiseHomeLayout(l))).catch(() => { /* preview */ });
}

// --- the last tool opened, per category, for the Tools card ---------------
// A per-viewer convenience, so browser storage (guarded) rather than
// app.settings: losing it costs a line of text.
const LAST_KEY = "xyi.home.lastTool";
export function recordToolOpened(categoryId: string, toolId: string): void {
    try {
        const all = JSON.parse(localStorage.getItem(LAST_KEY) || "{}");
        all[categoryId] = toolId;
        localStorage.setItem(LAST_KEY, JSON.stringify(all));
    } catch { /* private window */ }
}
export function lastToolIn(categoryId: string): string {
    try { return (JSON.parse(localStorage.getItem(LAST_KEY) || "{}") || {})[categoryId] || ""; } catch { return ""; }
}
