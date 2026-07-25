// The chain rules, kept as PURE FUNCTIONS with no React and no network.
//
// Deliberate split: everything here is decidable from data already in hand, so
// it's directly unit-testable without a bridge, a DOM or a TMDB key -- which
// matters because these rules (especially the 3-use limit) are where a subtle
// bug would silently make the game unfair rather than visibly break it.
// tmdb.ts fetches, CineChain.tsx renders, this file decides.
import type { MovieCredits, Person } from "./tmdb";

/** How many times one person may be used as a link across a whole game.
 *  Cine2Nerdle's own rule, and the mechanic that turns this from trivia into
 *  a strategy game -- burning Samuel L. Jackson three times early is how you
 *  lose later. */
export const MAX_USES_PER_PERSON = 3;

export interface ChainLink {
    movie: { id: number; title: string; year: string; poster: string };
    /** Who connected this film to the previous one. Null for the opening film. */
    via: Person | null;
    /** Which side played it. Turn 0 is the given starting film, owned by nobody. */
    player: 1 | 2 | null;
}

/** personId -> times already used as a link. */
export type UsageTally = Record<number, number>;

export interface MoveCheck {
    ok: boolean;
    /** Every shared person, best-first, for display and for the picker. */
    shared: Person[];
    /** The one that will actually be spent (first with uses remaining). */
    via: Person | null;
    reason?: string;
}

/**
 * Rank shared people for display: a link through a director or a lead actor
 * reads as a *real* connection, whereas one through the 10th-billed cast
 * member feels like a technicality. Ordering is cosmetic -- validity doesn't
 * depend on it -- but it decides which link gets spent, so it's ranked rather
 * than arbitrary.
 */
const ROLE_RANK: Record<string, number> = {
    Director: 0,
    cast: 1,
    Writer: 2,
    Screenplay: 3,
    "Original Music Composer": 4,
    "Director of Photography": 5,
};

const rank = (p: Person) => (ROLE_RANK[p.role] === undefined ? 9 : ROLE_RANK[p.role]);

export const usesLeft = (tally: UsageTally, personId: number): number =>
    MAX_USES_PER_PERSON - (tally[personId] || 0);

/**
 * Can `candidate` follow `previous`?
 *
 * Order of checks matters for the message the player sees: "already played"
 * and "exhausted link" are different mistakes from "no connection at all",
 * and lumping them together as one rejection is what makes a game like this
 * feel arbitrary.
 */
export function checkMove(
    previous: MovieCredits,
    candidate: MovieCredits,
    playedIds: number[],
    tally: UsageTally
): MoveCheck {
    if (candidate.id === previous.id) {
        return { ok: false, shared: [], via: null, reason: "That's the same film." };
    }
    if (playedIds.indexOf(candidate.id) !== -1) {
        return { ok: false, shared: [], via: null, reason: `"${candidate.title}" has already been played.` };
    }

    const prevIds: Record<number, boolean> = {};
    for (const p of previous.people) prevIds[p.id] = true;

    // Dedupe by person: someone credited as both Director and Writer is ONE
    // link with one usage count, not two.
    const sharedById: Record<number, Person> = {};
    for (const p of candidate.people) {
        if (!prevIds[p.id]) continue;
        const held = sharedById[p.id];
        if (!held || rank(p) < rank(held)) sharedById[p.id] = p;
    }
    const shared: Person[] = [];
    for (const k in sharedById) if (sharedById.hasOwnProperty(k)) shared.push(sharedById[k]);
    shared.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    if (!shared.length) {
        return {
            ok: false,
            shared: [],
            via: null,
            reason: `No shared cast, director, writer, composer or cinematographer with "${previous.title}".`,
        };
    }

    const usable = shared.filter((p) => usesLeft(tally, p.id) > 0);
    if (!usable.length) {
        const names = shared.map((p) => p.name).join(", ");
        return {
            ok: false,
            shared,
            via: null,
            reason: `Only linked by ${names}, already used ${MAX_USES_PER_PERSON}x.`,
        };
    }

    return { ok: true, shared, via: usable[0] };
}

/** Spend a link. Returns a NEW tally -- callers keep it in React state, so
 *  mutating in place would skip re-renders. */
export const spend = (tally: UsageTally, personId: number): UsageTally => {
    const next: UsageTally = {};
    for (const k in tally) if (tally.hasOwnProperty(k)) next[Number(k)] = tally[Number(k)];
    next[personId] = (next[personId] || 0) + 1;
    return next;
};
