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

    // A SPENT PERSON BLOCKS THE WHOLE FILM, not just their own link.
    //
    // This is the fix for a real loophole: the first version only filtered
    // spent people OUT of the candidate links, so once Scorsese was used 3x
    // you could keep playing Scorsese films by linking them through DiCaprio
    // instead -- a fourth, fifth, sixth Scorsese round, which is exactly what
    // the 3-use cap exists to stop. Now, if a spent person appears ANYWHERE in
    // the candidate's credits, the film itself is off the table.
    //
    // Deliberately stricter than Cine2Nerdle, which only bars using that
    // person as the link. It also compounds hard with the BAN tool (which
    // spends a film's entire cast and crew at once), so the board closes down
    // faster than the original game's -- that's the intended trade, not an
    // oversight.
    const spentNames: string[] = [];
    const seenSpent: Record<number, boolean> = {};
    for (const p of candidate.people) {
        if (seenSpent[p.id] || usesLeft(tally, p.id) > 0) continue;
        seenSpent[p.id] = true;
        spentNames.push(p.name);
    }
    if (spentNames.length) {
        return {
            ok: false,
            shared,
            via: null,
            reason: `"${candidate.title}" features ${spentNames.join(", ")} - already used ${MAX_USES_PER_PERSON}x.`,
        };
    }

    // Every shared person is usable by this point (the block above returned if
    // any of the candidate's credits were spent), so the best-ranked link wins.
    const usable = shared;

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

/**
 * Burn a whole set of people to their cap in one go -- what the BAN tool does
 * to the film it rejects.
 *
 * Sets each to MAX rather than incrementing, so the effect is the same whether
 * the person was untouched or already part-used: after a ban, nobody from that
 * film can ever be a link again. Same new-object rule as `spend`.
 */
export const exhaustAll = (tally: UsageTally, personIds: number[]): UsageTally => {
    const next: UsageTally = {};
    for (const k in tally) if (tally.hasOwnProperty(k)) next[Number(k)] = tally[Number(k)];
    for (let i = 0; i < personIds.length; i++) next[personIds[i]] = MAX_USES_PER_PERSON;
    return next;
};
