// =============================================================================
// src/js/main/lib/fuzzySearch.ts
// -----------------------------------------------------------------------------
// Shared fuse.js configuration for the app's two search surfaces -- the
// home-screen search box (HomeScreen.tsx) and the global ⌘K Command Palette
// (CommandPalette.tsx). Both used to do plain `.toLowerCase().includes(q)`
// substring matching; this swaps in fuzzy scoring so typos ("localsied
// libary" -> Localised Library) and partial words still find the right tool,
// while a shared config keeps the two boxes behaving identically instead of
// drifting apart. NOTE: default Fuse matches the query as one contiguous
// (fuzzy) string -- it does NOT tokenize, so out-of-order multi-word queries
// ("library localised") won't match. Verified behavior, not a bug; enabling
// `useExtendedSearch` would add per-token matching but changes the scoring
// semantics, so it's deliberately left off unless that's actually wanted.
//
// The ranking TIERS both files layer on top of Fuse (tool-name match beats
// action-label match beats inner-action match beats description-only match)
// are intentionally preserved -- Fuse decides "how well does this text match
// the query" within a tier; the tier decides which kind of match wins the
// top slot. See each caller's own record-building for the tier assignment.
// =============================================================================
import Fuse, { type IFuseOptions } from "fuse.js";

// ignoreLocation: match anywhere in the string (substring-like, not anchored
//   to the start) -- preserves the old `.includes()` feel.
// threshold 0.4: a middle-ground fuzziness -- forgiving of a typo or two on a
//   short label without matching almost anything. Tune here, once, for both
//   search boxes at the same time.
export const FUZZY_OPTIONS: IFuseOptions<unknown> = {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.4,
    keys: ["text"],
};

// A flat searchable record: `text` is the one field Fuse scores against,
// `tier` is the caller's priority band (lower = ranked higher), and `hit`
// is whatever result object that caller wants back for a match.
export interface FuzzyRecord<H> {
    text: string;
    tier: number;
    hit: H;
    hitKey: string;
}

// Simple fuzzy filter for a flat list matched across one or more of its own
// fields (no tiering/dedupe) -- e.g. QuickFX's effect lists matched on
// label/category/matchName at once. Returns the matched items in Fuse's own
// relevance order; an empty query returns the list unchanged (browse mode).
// Builds a fresh index per call, which is fine for the low-hundreds-of-items
// lists this is used on; memoize the call in the component (keyed on the
// source array + query) so it only re-runs when those change.
export function fuzzyFilter<T>(items: T[], query: string, keys: string[]): T[] {
    const q = query.trim();
    if (!q) return items;
    const fuse = new Fuse(items, { ...FUZZY_OPTIONS, keys } as IFuseOptions<T>);
    return fuse.search(q).map((r) => r.item);
}

// Run Fuse over the records, then order by (tier, Fuse score) and dedupe by
// hitKey keeping each result's BEST (lowest-tier / best-scoring) appearance.
// This is what lets a single entity be indexed under several fields/tiers
// (its label AND its description, say) yet appear once, at its strongest
// match -- replacing the hand-written "exclude things whose label already
// matched" negative filters the substring version needed.
export function rankedFuzzySearch<H>(records: FuzzyRecord<H>[], query: string): H[] {
    const fuse = new Fuse(records, FUZZY_OPTIONS as IFuseOptions<FuzzyRecord<H>>);
    const results = fuse.search(query);
    results.sort((a, b) => {
        if (a.item.tier !== b.item.tier) return a.item.tier - b.item.tier;
        return (a.score || 0) - (b.score || 0);
    });
    const seen: { [key: string]: boolean } = {};
    const out: H[] = [];
    for (const r of results) {
        if (seen[r.item.hitKey]) continue;
        seen[r.item.hitKey] = true;
        out.push(r.item.hit);
    }
    return out;
}
