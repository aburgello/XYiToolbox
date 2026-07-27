// Battle state model for XYiNerdle head-to-head.
//
// ONE FILE PER PLAYER, under `misc/battle/<ROOM>/playerN.json` on the Team
// Folder. Each side writes ONLY its own file and reads both. That's the whole
// concurrency story: two writers never touch the same file, so there is no
// locking, no merge conflict and no lost update to reason about.
//
// EVERY TURN-CHANGING THING IS AN ACTION, and that is the important design
// decision here. The first attempt stored only `moves`, and derived whose turn
// it was from "who moved last" -- which meant SKIP (passes the turn without a
// move) and BAN (redraws and keeps the turn, while burning a whole cast) were
// invisible to the opponent. Their panel would disagree about whose turn it
// was and which people were still available. Replaying a timestamped action
// log fixes that by construction: both sides run the same reducer over the
// same events and land on the same state.
//
// ORDERING is by ISO timestamp, which sorts lexicographically. Two machines'
// clocks can disagree by a second or two, but actions strictly alternate (only
// the turn owner may act), so a mis-order would need a clock skew larger than
// a whole turn. Noted rather than defended against.
import type { Person } from "./tmdb";
import { MAX_USES_PER_PERSON, type UsageTally, type ChainLink } from "./chain";

export const TURN_SECONDS = 25;
/** What the +7s tool adds to the current turn. */
export const EXTRA_SECONDS = 7;

export interface MovieRef {
    id: number;
    title: string;
    year: string;
    poster: string;
}

/**
 * `seed`    - the opening film. Written once, by player 1, at game start.
 * `move`    - a valid link. Flips the turn.
 * `skip`    - the skip tool. Flips the turn, film unchanged.
 * `ban`     - the ban tool. Burns `burned` people to the cap, redraws
 *             `movie`, and KEEPS the turn with the actor.
 * `time`    - the +7s tool. Extends the CURRENT turn only.
 * `timeout` - the actor's clock hit zero. Ends the game; the actor loses.
 */
export type BattleAction =
    | { kind: "seed"; at: string; movie: MovieRef }
    /**
     * "I'm at the keyboard." Written when a player presses Ready.
     *
     * THE MATCH DOES NOT START UNTIL BOTH HAVE. Without a handshake, player 1
     * seeded the film and their 25s clock began immediately -- but the opponent
     * still had to open the panel, find the invite and accept, comfortably more
     * than 25 seconds, so player 1 timed out and lost to an empty room every
     * time. Inferring arrival from "their file exists" was the first fix; an
     * explicit Ready is better because a panel being OPEN doesn't mean the
     * person is looking at it.
     *
     * It carries no data because it doesn't need to: the reducer restarts the
     * turn clock on any action but `time`, so the SECOND ready is what anchors
     * the first turn -- and both panels agree because they replay the same log.
     */
    | { kind: "ready"; at: string }
    | { kind: "move"; at: string; movie: MovieRef; via: Person }
    | { kind: "skip"; at: string }
    /**
     * `burned` is ids (what the tally needs); `burnedNames` is the same people
     * for DISPLAY. Both are stored because the opponent's panel has to show who
     * a ban took out and only ever sees this log -- resolving ids to names on
     * the other side would mean a TMDB fetch per ban, for a film that panel may
     * never have loaded. Names are cheap and the log is small.
     * `burnedNames` is optional so a file written before this field existed
     * still replays (it just shows the count without the names).
     */
    | { kind: "ban"; at: string; movie: MovieRef; burned: number[]; burnedFilm?: string; burnedNames?: string[] }
    | { kind: "time"; at: string }
    | { kind: "timeout"; at: string };

/** One ban, kept for the "who's been burned" list. */
export interface BanRecord {
    /** The film that was rejected. */
    film: string;
    /** Who burned it. */
    by: 1 | 2;
    names: string[];
    count: number;
}

export interface BattlePlayerFile {
    player: 1 | 2;
    /** Display name, so the opponent can label the board without a lookup. */
    name: string;
    actions: BattleAction[];
    /** Bumped on every write; lets a poller cheaply spot "something changed". */
    version: number;
}

export interface BattleState {
    chain: ChainLink[];
    /** The film the next player must link FROM. */
    current: MovieRef | null;
    /** Whose turn it is. */
    turn: 1 | 2;
    /** When the current turn started -- the clock is derived from this. */
    turnStart: string;
    /**
     * Seconds the +7s tool added to the CURRENT turn.
     *
     * Shared state, not a local nicety: the clock is DERIVED from turnStart,
     * so if one side quietly added 7s locally the two panels would disagree
     * about when the turn ends, and the opponent would call a timeout that
     * hadn't actually happened.
     */
    extra: number;
    tally: UsageTally;
    playedIds: number[];
    toolsUsed: Record<1 | 2, Record<string, boolean>>;
    /**
     * Every ban so far, in order. Derived like everything else, so BOTH panels
     * show the same burned list -- a ban silently removes a whole cast from
     * play for both players, and without this you only find out by trying a
     * name and being told it's spent.
     */
    bans: BanRecord[];
    /** Who has pressed Ready. The match is live only when both have. */
    ready: Record<1 | 2, boolean>;
    /** Set once someone times out. */
    loser: 1 | 2 | null;
    started: boolean;
}

/** Both players at their keyboards -- the only state in which the clock runs. */
export const bothReady = (st: BattleState | null): boolean => !!st && st.ready[1] && st.ready[2];

export const freshFile = (player: 1 | 2, name: string): BattlePlayerFile => ({
    player, name, actions: [], version: 0,
});

const other = (p: 1 | 2): 1 | 2 => (p === 1 ? 2 : 1);

/**
 * Replay both action logs into one agreed state.
 *
 * PURE -- no React, no network -- so the whole turn/tool/tally model is
 * directly testable without a NAS or a bridge, which matters because a
 * desync here is the kind of bug that only shows up with two real machines.
 */
export function deriveState(p1: BattlePlayerFile | null, p2: BattlePlayerFile | null): BattleState {
    const events: { a: BattleAction; by: 1 | 2 }[] = [];
    if (p1) for (const a of p1.actions) events.push({ a, by: 1 });
    if (p2) for (const a of p2.actions) events.push({ a, by: 2 });
    events.sort((x, y) => (x.a.at < y.a.at ? -1 : x.a.at > y.a.at ? 1 : 0));

    const st: BattleState = {
        chain: [], current: null, turn: 1, turnStart: "", extra: 0,
        tally: {}, playedIds: [],
        toolsUsed: { 1: {}, 2: {} },
        bans: [],
        ready: { 1: false, 2: false },
        loser: null, started: false,
    };

    for (const { a, by } of events) {
        if (st.loser) break;                       // nothing counts after the game ends
        // Anything except the +7s tool starts a fresh turn clock, which also
        // clears any bonus bought during the previous turn.
        if (a.kind !== "time") {
            st.turnStart = a.at;
            st.extra = 0;
        }

        // The turn-clock reset above is most of `ready`'s effect: the SECOND
        // ready is what anchors the first turn, so nobody's clock runs while
        // the other person is still finding the invite.
        if (a.kind === "ready") {
            st.ready[by] = true;
        } else if (a.kind === "seed") {
            st.chain.push({ movie: a.movie, via: null, player: null });
            st.current = a.movie;
            st.playedIds.push(a.movie.id);
            st.started = true;
            st.turn = 1;                            // player 1 opens
        } else if (a.kind === "move") {
            st.chain.push({ movie: a.movie, via: a.via, player: by });
            st.current = a.movie;
            st.playedIds.push(a.movie.id);
            st.tally[a.via.id] = (st.tally[a.via.id] || 0) + 1;
            st.turn = other(by);
        } else if (a.kind === "skip") {
            st.toolsUsed[by].skip = true;
            st.turn = other(by);
        } else if (a.kind === "ban") {
            st.toolsUsed[by].ban = true;
            for (const id of a.burned) st.tally[id] = MAX_USES_PER_PERSON;
            // `st.current` is still the film being rejected at this point --
            // the redraw is assigned below -- so it's the honest fallback when
            // an older action has no `burnedFilm`.
            st.bans.push({
                film: a.burnedFilm || (st.current ? st.current.title : "a film"),
                by,
                names: a.burnedNames || [],
                count: a.burned.length,
            });
            st.chain.push({ movie: a.movie, via: null, player: by });
            st.current = a.movie;
            st.playedIds.push(a.movie.id);
            st.turn = by;                           // ban KEEPS the turn
        } else if (a.kind === "time") {
            st.toolsUsed[by].time = true;
            st.extra += EXTRA_SECONDS;
        } else if (a.kind === "timeout") {
            st.loser = by;
        }
    }

    return st;
}

/** Seconds left on the current turn, from the authoritative turn-start stamp. */
export const secondsLeft = (turnStart: string, extra: number, now: number = Date.now()): number => {
    if (!turnStart) return TURN_SECONDS;
    const started = new Date(turnStart).getTime();
    if (isNaN(started)) return TURN_SECONDS;
    return Math.max(0, TURN_SECONDS + (extra || 0) - Math.floor((now - started) / 1000));
};

/**
 * Tool usage is tracked per player, but `cast` and `time` never appear in the
 * action log (neither changes shared state), so they stay local to whoever
 * spent them. Only skip/ban are derived.
 */
export const toolSpent = (st: BattleState, seat: 1 | 2, id: string): boolean => !!st.toolsUsed[seat][id];
