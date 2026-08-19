// XYiNerdle head-to-head, over the Team Folder.
//
// Rewritten from a first attempt that could not have worked between two
// machines. Recording the four faults, because each is a trap this codebase
// hits repeatedly:
//
//  1. THE SEAT WAS HARDCODED. `const myPlayer = 1` with a "for now" comment,
//     and every write was `teamBattleWrite(room, 1, ...)`. Both players wrote
//     player1.json (clobbering each other), neither ever saw an opponent, and
//     `play()` began `if (state.player !== 1) return` so player 2 could never
//     move at all. The seat now arrives as a prop: INVITER = 1, ACCEPTER = 2.
//  2. VALIDATION COULD NEVER PASS. checkMove was handed the previous film as
//     `{ ..., people: [] }` because the chain only stores a MovieRef, so there
//     were never any shared people and every move was rejected as "no shared
//     cast". The real credits are fetched (and cached) before checking.
//  3. TURN/TOOL STATE DESYNCED. Only `moves` were stored and the turn was
//     inferred from who moved last, so SKIP and BAN were invisible to the
//     opponent. Everything turn-changing is now an action in a replayed log
//     (see battle.ts).
//  4. BOTH CLIENTS POSTED THE RESULT on timeout, double-counting the
//     leaderboard. The loser writes the `timeout` action; only the WINNER
//     posts the result -- exactly one writer.
//
// The clock is DERIVED from the shared turn-start stamp rather than counted
// down locally, so a panel opened mid-turn shows the right time and neither
// side can drift.
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2, Clock, Users, RotateCcw, Eye, Timer, SkipForward, Ban, Wifi, Swords } from "lucide-react";
import ArcadeFrame from "./../ArcadeFrame";
import { evalTS } from "../../../lib/utils/bolt";
import { searchMovies, getCredits, randomStartingMovie, posterUrl, type MovieSummary } from "./tmdb";
import { checkMove, usesLeft, MAX_USES_PER_PERSON } from "./chain";
import {
    deriveState, freshFile, secondsLeft, toolSpent, bothReady,
    TURN_SECONDS, EXTRA_SECONDS, type BattleAction, type BattlePlayerFile, type BattleState, type MovieRef,
} from "./battle";
import "./CineChain.scss";

const SEARCH_DEBOUNCE_MS = 280;
const FREE_CAST_ROUNDS = 5;
/** NAS reads are cheap but not free; a turn-based game doesn't need faster. */
const POLL_MS = 1200;
/**
 * How far past zero the clock may run while one of YOUR OWN actions is still
 * in flight, before the timeout is declared anyway.
 *
 * This exists because of a real, reproducible loss: BAN does two TMDB
 * round-trips (credits for the film being burned, then a replacement film)
 * before its action can be written, and the turn clock kept draining
 * underneath. Ban with a few seconds left and you'd time out mid-request --
 * so the tool that's supposed to rescue a hopeless film handed you the game
 * instead, and the winner's panel then deleted the room, which is why it read
 * as "the room just closed for no reason". Picking a film has the same shape
 * (two credit lookups to validate the link).
 *
 * A cap rather than an open-ended hold: a wedged request must not freeze the
 * match forever. It's generous because the alternative -- losing to your own
 * network latency -- is far worse than a turn that ran slightly long.
 */
const ACTION_GRACE_SECONDS = 20;
/** Redraw attempts before accepting a film that's already in the chain. */
const REDRAW_TRIES = 4;

type ToolId = "cast" | "time" | "skip" | "ban";
const TOOLS: { id: ToolId; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "cast", label: "Cast & crew", icon: Eye },
    { id: "time", label: "+7 seconds", icon: Timer },
    { id: "skip", label: "Skip turn", icon: SkipForward },
    { id: "ban", label: "Ban film", icon: Ban },
];

const KEY_CODES = (() => {
    const out = [13, 8, 32, 38, 40, 27];
    for (let c = 48; c <= 57; c++) out.push(c);
    for (let c = 65; c <= 90; c++) out.push(c);
    return out;
})();

const parseFile = (raw: string | undefined): BattlePlayerFile | null => {
    if (!raw) return null;
    try {
        const p = JSON.parse(raw) as BattlePlayerFile;
        return p && p.actions instanceof Array ? p : null;
    } catch (e) {
        return null;
    }
};

const toRef = (m: { id: number; title: string; year: string; poster: string }): MovieRef =>
    ({ id: m.id, title: m.title, year: m.year, poster: m.poster || "" });

/**
 * A starting/replacement film that isn't already in the chain.
 *
 * The draw pool is a few hundred films, so a collision is uncommon but not
 * rare over a long chain plus bans -- and redrawing INTO a film already played
 * is a dead end for whoever inherits it (every link from it that mattered is
 * spent, and it can't be replayed). Bounded retries: a repeat is a poor draw,
 * not a reason to fail the tool.
 */
const drawUnplayed = async (playedIds: number[]) => {
    let pick = await randomStartingMovie();
    for (let i = 0; i < REDRAW_TRIES && playedIds.indexOf(pick.id) !== -1; i++) {
        pick = await randomStartingMovie();
    }
    return pick;
};

// --- scoring ----------------------------------------------------------------
// A win was worth its CHAIN LENGTH, so a one-link scrappy win scored 1 and the
// board could rank a single long game above someone who had beaten everyone all
// month. Now a win is worth a win -- flat 25 -- and the chain is a BONUS on top,
// so longevity is rewarded without being the whole story.
//
// 3 a link: a 1-link win pays 28, a 16-link marathon pays 73. Enough that a long
// game is clearly worth more, not so much that one lucky chain outweighs several
// straight wins (three 1-link wins = 84 > one 16-link win).
const WIN_BASE = 25;
const CHAIN_BONUS = 3;

function winScore(chainLength: number): number {
    return WIN_BASE + Math.max(0, chainLength) * CHAIN_BONUS;
}

export const CineChainBattle = ({
    room, against, seat, onClose, onQuit,
}: { room: string; against: string; seat: 1 | 2; onClose: () => void; onQuit: () => void }) => {
    const [me, setMe] = useState("");
    const [state, setState] = useState<BattleState | null>(null);
    const [mine, setMine] = useState<BattlePlayerFile | null>(null);
    const [oppSeen, setOppSeen] = useState(false);
    const [fatal, setFatal] = useState<string | null>(null);
    const [booting, setBooting] = useState(true);

    const [query, setQuery] = useState("");
    const [results, setResults] = useState<MovieSummary[]>([]);
    const [searching, setSearching] = useState(false);
    const [checking, setChecking] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [showCast, setShowCast] = useState(false);
    const [castSpent, setCastSpent] = useState(false);
    const [nowTick, setNowTick] = useState(Date.now());
    // Purely presentational, both cleared on a timer. `poppedTool` flashes the
    // button that was just spent; `timeBoost` is a counter (not a boolean) so
    // buying time twice replays the float instead of the second one being a
    // no-op state write.
    const [poppedTool, setPoppedTool] = useState<ToolId | null>(null);
    const [timeBoost, setTimeBoost] = useState(0);
    // Open by default: the first ban is exactly when you need to see the names.
    const [burnedOpen, setBurnedOpen] = useState(true);

    const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const boostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pop = useCallback((id: ToolId) => {
        setPoppedTool(id);
        if (popTimer.current) clearTimeout(popTimer.current);
        popTimer.current = setTimeout(() => setPoppedTool(null), 560);
    }, []);
    useEffect(() => {
        if (!timeBoost) return;
        if (boostTimer.current) clearTimeout(boostTimer.current);
        boostTimer.current = setTimeout(() => setTimeBoost(0), 1150);
    }, [timeBoost]);
    // Timers outlive the component if a game ends mid-flash.
    useEffect(() => () => {
        if (popTimer.current) clearTimeout(popTimer.current);
        if (boostTimer.current) clearTimeout(boostTimer.current);
    }, []);

    const inputRef = useRef<HTMLInputElement>(null);
    const searchSeq = useRef(0);
    const mineRef = useRef<BattlePlayerFile | null>(null);
    // `sync` is deliberately stable (the poll installs it once), so it can't
    // see `state` through its own closure -- it needs the ref to know whether
    // an empty read would be throwing a live match away.
    const stateRef = useRef<BattleState | null>(null);
    const bootedRef = useRef(false);
    const seedingRef = useRef(false);
    const postedRef = useRef(false);
    const timedOutRef = useRef(false);
    // The current film's full credits. The chain only carries a MovieRef, so
    // this is what makes validation possible at all (fault 2 above).
    const creditsRef = useRef<Awaited<ReturnType<typeof getCredits>> | null>(null);

    const opponent = seat === 1 ? 2 : 1;
    const myTurn = !!state && state.turn === seat && !state.loser;

    const writeMine = useCallback(async (file: BattlePlayerFile) => {
        mineRef.current = file;
        setMine(file);
        // JSON STRING over the bridge, never a nested object -- evalTS splices
        // args into eval'd source and nested structures don't survive it (the
        // documented Motion Tools ease-paste bug).
        const res = await evalTS("teamBattleWrite", room, seat, JSON.stringify(file));
        const r = res as { success?: boolean; error?: string } | undefined;
        if (!r || !r.success) setMessage((r && r.error) || "Couldn't reach the team folder.");
        return !!(r && r.success);
    }, [room, seat]);

    const act = useCallback(async (action: BattleAction) => {
        const base = mineRef.current || freshFile(seat, me);
        const next: BattlePlayerFile = {
            ...base,
            name: me || base.name,
            actions: [...base.actions, action],
            version: base.version + 1,
        };
        return writeMine(next);
    }, [me, seat, writeMine]);

    // ── read both files and rebuild the world ───────────────────────────────
    const sync = useCallback(async () => {
        try {
            const res = await evalTS("teamBattleRead", room);
            const r = res as { success?: boolean; me?: string; p1?: string; p2?: string; error?: string } | undefined;
            if (!r) return null;
            if (!r.success) { setFatal(r.error || "Couldn't read the battle room."); return null; }
            if (r.me) setMe(r.me);
            const p1 = parseFile(r.p1);
            const p2 = parseFile(r.p2);
            // AN EMPTY READ NEVER REPLACES A GAME IN PROGRESS. The winner's
            // panel deletes the room the moment it records the result, so the
            // LOSER's next poll read two empty files and threw the finished
            // match away -- their screen jumped from "you ran out of time"
            // straight back to the ready lobby, a second after losing. Same
            // rule the arcade leaderboard already follows: a store that can
            // only grow cannot legitimately come back empty.
            if (!p1 && !p2 && stateRef.current && stateRef.current.started) return stateRef.current;
            const own = seat === 1 ? p1 : p2;
            const opp = seat === 1 ? p2 : p1;
            if (own) { mineRef.current = own; setMine(own); }
            setOppSeen(!!opp);
            const st = deriveState(p1, p2);
            stateRef.current = st;
            setState(st);
            return st;
        } catch (e) {
            // Transient NAS/bridge hiccup -- keep the last known state and
            // let the next poll correct it rather than dumping the player out.
            return null;
        }
    }, [room, seat]);

    useEffect(() => {
        if (bootedRef.current) return;
        bootedRef.current = true;
        (async () => {
            await sync();
            setBooting(false);
        })();
    }, [sync]);

    // Player 1 owns the opening film; player 2 waits for it to appear.
    //
    // Its own effect rather than part of boot, because a rematch needs exactly
    // this again: `reset` leaves the room started-less, and whichever side
    // pressed it, P1's panel is the one that draws the new opening film.
    useEffect(() => {
        if (booting || fatal || seat !== 1) return;
        if (!state || state.started || seedingRef.current) return;
        seedingRef.current = true;
        (async () => {
            try {
                const seed = await drawUnplayed([]);
                await act({ kind: "seed", at: new Date().toISOString(), movie: toRef(seed) });
                await sync();
            } catch (e: any) {
                setFatal(e?.message || "Couldn't draw an opening film.");
            } finally {
                seedingRef.current = false;
            }
        })();
    }, [booting, fatal, seat, state, act, sync]);

    useEffect(() => {
        const id = setInterval(() => { sync(); }, POLL_MS);
        return () => clearInterval(id);
    }, [sync]);

    // Keep the derived clock ticking between polls.
    useEffect(() => {
        const id = setInterval(() => setNowTick(Date.now()), 250);
        return () => clearInterval(id);
    }, []);

    // Load the current film's credits whenever it changes.
    useEffect(() => {
        const cur = state?.current;
        if (!cur) return;
        if (creditsRef.current && creditsRef.current.id === cur.id) return;
        let cancelled = false;
        getCredits(cur.id).then((c) => { if (!cancelled) creditsRef.current = c; }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [state?.current?.id]);

    // The clock only runs once BOTH players have pressed Ready. Before that it
    // sits at full rather than draining behind a lobby screen, which looked
    // like the game was timing you out while you waited for someone.
    const live = bothReady(state) && !state?.loser;
    const clockRunning = !!state && state.started && live;
    const remaining = clockRunning && state
        ? secondsLeft(state.turnStart, state.extra, nowTick)
        : TURN_SECONDS;

    // How far past zero this turn has run -- `remaining` clamps at 0, so it
    // can't answer "how long past?" on its own.
    const overrun = state && state.turnStart
        ? Math.floor((nowTick - new Date(state.turnStart).getTime()) / 1000) - TURN_SECONDS - (state.extra || 0)
        : 0;

    // Only the player whose turn it is may declare their own timeout -- one
    // writer, and it can't be raced by the opponent's clock.
    useEffect(() => {
        if (!state || state.loser || !state.started || booting) return;
        // NOBODY LOSES TO AN EMPTY ROOM. The second Ready anchors the first
        // turn; this makes sure no timeout can be declared before that, even
        // if a stale clock value is on screen for a frame.
        if (!live) return;
        if (state.turn !== seat || remaining > 0 || timedOutRef.current) return;
        // NOBODY LOSES TO THEIR OWN NETWORK EITHER. `checking` means a move or
        // a ban is mid-flight: its action is already on its way and will reset
        // this clock, so declaring a timeout now discards a turn the player
        // genuinely took. Held only up to ACTION_GRACE_SECONDS, so a request
        // that never comes back can't stall the match.
        if (checking && overrun < ACTION_GRACE_SECONDS) return;
        timedOutRef.current = true;
        act({ kind: "timeout", at: new Date().toISOString() });
    }, [state, remaining, seat, act, booting, live, checking, overrun]);

    // Exactly one client records the result: the winner.
    useEffect(() => {
        if (!state?.loser || postedRef.current) return;
        if (state.loser === seat) return;               // I lost -- they post it
        postedRef.current = true;
        // teamArcadePost, not the old teamNerdlePostResult -- that name was
        // never actually defined on the host, so every win up to now went
        // nowhere and the board could never fill. Score is the chain length,
        // which is the honest "how good was this game" number.
        evalTS("teamArcadePost", "xyinerdle", winScore(state.chain.length), against).catch(() => undefined);
        evalTS("teamBattleCleanup", room).catch(() => undefined);
    }, [state?.loser, seat, room, me, against, state?.chain.length]);

    // ── search ──────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!myTurn) { setResults([]); return; }
        const q = query.trim();
        if (q.length < 2) { setResults([]); return; }
        const seq = ++searchSeq.current;
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const r = await searchMovies(q);
                if (seq === searchSeq.current) setResults(r);
            } catch (e) {
                if (seq === searchSeq.current) setResults([]);
            } finally {
                if (seq === searchSeq.current) setSearching(false);
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [query, myTurn]);

    const play = useCallback(async (pick: MovieSummary) => {
        if (!state || !myTurn || checking) return;
        setChecking(true);
        setMessage(null);
        setQuery("");
        setResults([]);
        searchSeq.current++;
        try {
            const prev = creditsRef.current && state.current && creditsRef.current.id === state.current.id
                ? creditsRef.current
                : state.current ? await getCredits(state.current.id) : null;
            if (!prev) { setMessage("Still loading the current film -- try again."); return; }
            const candidate = await getCredits(pick.id);
            const verdict = checkMove(prev, candidate, state.playedIds, state.tally);
            if (!verdict.ok || !verdict.via) { setMessage(verdict.reason || "Not a valid link."); return; }
            await act({ kind: "move", at: new Date().toISOString(), movie: toRef(candidate), via: verdict.via });
            setShowCast(false);
            await sync();
        } catch (e: any) {
            setMessage(e?.message || "Lookup failed -- try again.");
        } finally {
            setChecking(false);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [state, myTurn, checking, act, sync]);

    // ── tools ───────────────────────────────────────────────────────────────
    const roundsPlayed = state ? Math.max(0, state.chain.length - 1) : 0;
    const castIsFree = roundsPlayed < FREE_CAST_ROUNDS;
    const freeCastLeft = Math.max(0, FREE_CAST_ROUNDS - roundsPlayed);

    const runTool = async (id: ToolId) => {
        if (!state || !myTurn) return;
        // Feedback first, before any await: a tool's real effect can be
        // off-screen (skip hands the turn over, ban swaps the card above) or a
        // NAS round-trip away, and a button that looks inert until then reads
        // as a dropped click. Cleared by a timer so re-use replays it.
        pop(id);
        if (id === "cast") {
            if (castIsFree || castSpent) { setShowCast((v) => !v); return; }
            setCastSpent(true);
            setShowCast(true);
            return;
        }
        // Every branch below writes an action, so each one holds `checking` for
        // the round trip -- that's what suspends the timeout (see its effect).
        if (id === "time") {
            if (toolSpent(state, seat, "time")) return;
            setTimeBoost((n) => n + 1);   // floats a "+7s" off the clock
            setChecking(true);
            try {
                await act({ kind: "time", at: new Date().toISOString() });
                await sync();
            } finally { setChecking(false); }
            return;
        }
        if (id === "skip") {
            if (toolSpent(state, seat, "skip")) return;
            setChecking(true);
            try {
                await act({ kind: "skip", at: new Date().toISOString() });
                setShowCast(false);
                await sync();
            } finally { setChecking(false); }
            return;
        }
        // Ban: burn this film's whole cast and crew, redraw, keep the turn.
        if (toolSpent(state, seat, "ban") || !state.current) return;
        setChecking(true);
        try {
            const cur = creditsRef.current && creditsRef.current.id === state.current.id
                ? creditsRef.current
                : await getCredits(state.current.id);
            const seed = await drawUnplayed(state.playedIds);
            await act({
                kind: "ban", at: new Date().toISOString(),
                movie: toRef(seed),
                burned: cur.people.map((p) => p.id),
                // Carried so the OPPONENT can show who this ban removed --
                // their panel only ever sees this log (see battle.ts).
                burnedFilm: state.current.title,
                burnedNames: cur.people.map((p) => p.name),
            });
            setShowCast(false);
            await sync();
        } catch (e: any) {
            setMessage(e?.message || "Couldn't draw a replacement film.");
        } finally {
            setChecking(false);
        }
    };

    const linkable = creditsRef.current && state
        ? creditsRef.current.people.filter((p) => usesLeft(state.tally, p.id) > 0)
        : [];

    const over = !!state?.loser;
    const iWon = over && state!.loser !== seat;

    const iAmReady = !!state?.ready[seat];
    const theyAreReady = !!state?.ready[opponent];

    // Idempotent: pressing Ready twice must not write a second action, or the
    // turn clock would re-anchor and hand someone a free refill.
    const markReady = async () => {
        if (!state || iAmReady) return;
        await act({ kind: "ready", at: new Date().toISOString() });
        await sync();
    };

    /**
     * Play again in the SAME room.
     *
     * Either side may press it: `reset` is a line through the shared log (see
     * battle.ts), so one writer is enough and both panels land on an empty
     * game. P1's seed effect then draws the new opening film, and both people
     * press Ready again -- which is correct, a new match shouldn't inherit the
     * old one's "we're both here" from ten minutes ago.
     *
     * Every per-match LOCAL flag has to be cleared by hand here; they live
     * outside the replayed log precisely because they're this panel's business
     * (who posted the result, who declared the timeout, whether cast was
     * bought), and a stale one would silently break the next game.
     */
    const rematch = async () => {
        if (!state || checking) return;
        setChecking(true);
        postedRef.current = false;
        timedOutRef.current = false;
        creditsRef.current = null;
        setCastSpent(false);
        setShowCast(false);
        setMessage(null);
        setQuery("");
        setResults([]);
        try {
            await act({ kind: "reset", at: new Date().toISOString() });
            await sync();
        } finally { setChecking(false); }
    };

    return (
        <ArcadeFrame
            title="XYiNerdle"
            hint={`Room ${room} · vs ${against} · you are P${seat}`}
            keyCodes={KEY_CODES}
            fluid
            onClose={onClose}
        >
            <div className="cc-wrap">
                {booting && <div className="cc-boot"><Loader2 size={18} className="spin" /> Joining room {room}…</div>}

                {fatal && (
                    <div className="cc-fatal">
                        <span>{fatal}</span>
                        <button className="cc-btn" onClick={onQuit}>Back to menu</button>
                    </div>
                )}

                {/* READY GATE. Nothing is playable and no clock runs until both
                    people say they're at the keyboard -- see battle.ts's `ready`
                    note for the guaranteed loss this replaced. */}
                {!booting && !fatal && state && !live && !over && (
                    <div className="cc-lobby">
                        <span className="cc-lobby-room">Room {room}</span>
                        <div className="cc-lobby-seats">
                            <div className={"cc-seat" + (iAmReady ? " cc-seat--set" : "")}>
                                <span className="cc-seat-dot" />
                                <span className="cc-seat-name">{me || "You"} <em>P{seat}</em></span>
                                <span className="cc-seat-state">{iAmReady ? "Ready" : "Not ready"}</span>
                            </div>
                            <div className={"cc-seat" + (theyAreReady ? " cc-seat--set" : "")}>
                                <span className="cc-seat-dot" />
                                <span className="cc-seat-name">{against} <em>P{opponent}</em></span>
                                <span className="cc-seat-state">
                                    {theyAreReady ? "Ready" : oppSeen ? "In the room" : "Not here yet"}
                                </span>
                            </div>
                        </div>

                        {!iAmReady ? (
                            <button className="cc-ready" onClick={markReady}>I'm ready</button>
                        ) : (
                            <div className="cc-lobby-wait">
                                <Wifi size={12} /> Waiting for {against}…
                            </div>
                        )}
                        <p className="cc-lobby-note">
                            The clock starts when you're both ready.
                        </p>
                    </div>
                )}

                {!booting && !fatal && state && (live || over) && (
                    <>
                        <div className="cc-status">
                            <span className={"cc-turn" + (over ? " cc-turn--over" : "")}>
                                {over
                                    ? (iWon ? `${against} ran out of time. You win` : "You ran out of time")
                                    : myTurn ? "Your turn" : `${against}'s turn`}
                            </span>
                            <span className={"cc-clock" + (remaining <= 5 ? " cc-clock--low" : "")}>
                                <Clock size={13} /> {remaining}s
                                {/* keyed on the counter so a second purchase
                                    remounts the node and replays the float */}
                                {timeBoost > 0 && <span className="cc-timeboost" key={timeBoost}>+{EXTRA_SECONDS}s</span>}
                            </span>
                        </div>

                        <div className="cc-layout">
                            <div className="cc-main">
                                {state.current && (
                                    // Keyed on the film so the card genuinely
                                    // remounts (and re-animates) when the film
                                    // changes -- a ban under you, or the
                                    // opponent's move arriving on the poll.
                                    <div className="cc-current" key={state.current.id}>
                                        {state.current.poster
                                            ? <img className="cc-poster cc-poster--lg" src={posterUrl(state.current.poster, "w154")} alt="" />
                                            : <span className="cc-poster cc-poster--lg cc-poster--none" />}
                                        <span className="cc-current-text">
                                            <span className="cc-current-label">Link from</span>
                                            <span className="cc-current-title">{state.current.title}</span>
                                            <span className="cc-current-year">{state.current.year}</span>
                                        </span>
                                    </div>
                                )}

                                {!over && myTurn && (
                                    <div className="cc-search">
                                        <Search size={14} />
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            value={query}
                                            autoFocus
                                            placeholder="Type a film, then Enter…"
                                            onChange={(e) => setQuery(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter" && results.length) { e.preventDefault(); play(results[0]); } }}
                                            disabled={checking}
                                        />
                                        {(searching || checking) && <Loader2 size={14} className="spin" />}
                                    </div>
                                )}

                                {message && <div className="cc-message">{message}</div>}

                                {!over && myTurn && results.length > 0 && (
                                    <div className="cc-results">
                                        {results.map((r, i) => (
                                            <button className="cc-result" key={r.id} disabled={checking} onClick={() => play(r)}>
                                                {r.poster
                                                    ? <img className="cc-poster" src={posterUrl(r.poster)} alt="" />
                                                    : <span className="cc-poster cc-poster--none" />}
                                                <span className="cc-result-title">{r.title}</span>
                                                <span className="cc-result-year">{r.year}</span>
                                                {i === 0 && <span className="cc-result-enter">&crarr;</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {over && (
                                    // Rematch first: it's the common next move,
                                    // and it's what stops a pair minting a new
                                    // room (and a second invite) per game.
                                    <div className="cc-over-row">
                                        <button className="cc-btn cc-btn--go" disabled={checking} onClick={rematch}>
                                            <Swords size={13} /> Rematch
                                        </button>
                                        <button className="cc-btn" onClick={onQuit}><RotateCcw size={13} /> Back to menu</button>
                                    </div>
                                )}

                                <div className="cc-chain">
                                    <div className="cc-chain-head">
                                        <Users size={12} /> Chain
                                        <span className="cc-chain-count">{state.chain.length} film{state.chain.length === 1 ? "" : "s"}</span>
                                    </div>
                                    <div className="cc-chain-list">
                                        {state.chain.slice().reverse().map((l) => (
                                            <div className="cc-link" key={l.movie.id}>
                                                {l.movie.poster
                                                    ? <img className="cc-poster cc-poster--sm" src={posterUrl(l.movie.poster)} alt="" />
                                                    : <span className="cc-poster cc-poster--sm cc-poster--none" />}
                                                <span className="cc-link-text">
                                                    <span className="cc-link-movie">{l.movie.title} <em>{l.movie.year}</em></span>
                                                    {l.via ? (
                                                        <span className="cc-link-via">
                                                            via {l.via.name}
                                                            {l.via.role !== "cast" && <em> · {l.via.role}</em>}
                                                            <b className={"cc-link-uses" + (usesLeft(state.tally, l.via.id) === 0 ? " cc-link-uses--none" : "")}>
                                                                {usesLeft(state.tally, l.via.id) === 0 ? "spent" : usesLeft(state.tally, l.via.id) + " left"}
                                                            </b>
                                                        </span>
                                                    ) : (
                                                        <span className="cc-link-via cc-link-via--start">
                                                            {l.player ? "redrawn after ban" : "opening film"}
                                                        </span>
                                                    )}
                                                </span>
                                                {l.player && <span className={"cc-link-p cc-link-p--" + l.player}>P{l.player}</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <aside className="cc-side">
                                <div className="cc-side-head">Tools · P{seat}</div>
                                <div className="cc-tools">
                                    {TOOLS.map(({ id, label, icon: Icon }) => {
                                        const spent = id === "cast" ? castSpent : toolSpent(state, seat, id);
                                        const free = id === "cast" && castIsFree;
                                        const disabled = !myTurn || over || checking || (spent && id !== "cast");
                                        return (
                                            <button
                                                key={id}
                                                className={"cc-tool"
                                                    + (spent && !free ? " cc-tool--spent" : "")
                                                    + (free ? " cc-tool--free" : "")
                                                    + (poppedTool === id ? " cc-tool--pop" : "")}
                                                disabled={disabled}
                                                onClick={() => runTool(id)}
                                            >
                                                <Icon size={12} />
                                                <span>{id === "cast" && (spent || free) ? (showCast ? "Hide cast" : "Show cast") : label}</span>
                                                {free && <b>{freeCastLeft} free</b>}
                                                {spent && id !== "cast" && <b>used</b>}
                                            </button>
                                        );
                                    })}
                                </div>
                                {showCast ? (
                                    <div className="cc-cast">
                                        {linkable.map((p, i) => (
                                            // Stagger capped at 10 so a big
                                            // cast still finishes dealing in
                                            // well under half a second.
                                            <span
                                                className="cc-cast-chip"
                                                key={p.id + p.role}
                                                style={{ animationDelay: `${Math.min(i, 10) * 26}ms` }}
                                            >
                                                <span className="cc-cast-name">{p.name}</span>
                                                {p.role !== "cast" && <em>{p.role}</em>}
                                                {usesLeft(state.tally, p.id) < MAX_USES_PER_PERSON && (
                                                    <b>{usesLeft(state.tally, p.id)} left</b>
                                                )}
                                            </span>
                                        ))}
                                        {!linkable.length && <span className="cc-cast-empty">Every link from this film is used up.</span>}
                                    </div>
                                ) : (
                                    <p className="cc-side-note">
                                        {castIsFree
                                            ? `Cast is free for ${freeCastLeft} more round${freeCastLeft === 1 ? "" : "s"}.`
                                            : "One use each, per player, per game."}
                                    </p>
                                )}

                                {/* A ban burns a whole cast for BOTH players.
                                    Without this you only discover it by typing
                                    a name and being told it's spent -- so every
                                    ban is listed, with who fired it. */}
                                {state.bans.length > 0 && (
                                    <div className="cc-burned">
                                        <button
                                            className="cc-burned-head"
                                            onClick={() => setBurnedOpen((v) => !v)}
                                            aria-expanded={burnedOpen}
                                        >
                                            <Ban size={11} />
                                            <span>Burned by bans</span>
                                            <b>{state.bans.reduce((n, b) => n + b.count, 0)}</b>
                                        </button>
                                        {burnedOpen && state.bans.map((b, i) => (
                                            <div className="cc-burned-ban" key={i}>
                                                <div className="cc-burned-film">
                                                    <em>{b.by === seat ? "You" : against}</em> banned “{b.film}”
                                                </div>
                                                <div className="cc-burned-names">
                                                    {b.names.length
                                                        ? b.names.join(" · ")
                                                        : `${b.count} people burned`}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </aside>
                        </div>

                        <div className="cc-attrib">This product uses the TMDB API but is not endorsed or certified by TMDB.</div>
                    </>
                )}
            </div>
        </ArcadeFrame>
    );
};

export default CineChainBattle;
