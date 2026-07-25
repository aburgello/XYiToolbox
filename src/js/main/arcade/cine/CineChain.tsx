// "CHAIN" -- link films by a shared actor, director, writer, composer or
// cinematographer, against the clock. A Cine2Nerdle Battle clone, built in
// slices: THIS IS SLICE ONE, single-machine.
//
// WHY SINGLE-MACHINE FIRST, when the ask was head-to-head over the network:
// turns here alternate between two seats played at one keyboard, which
// exercises the entire turn machine -- whose turn it is, the per-turn clock,
// the chain, the shared usage tally, losing on time -- with zero sync in the
// way. Battle mode then becomes "replace the local turn-swap with two JSON
// files on the Team Folder", on rules already proven correct. Building the
// lobby, the sync and the rules at once is how all three end up half-working.
//
// NETWORK SHAPE: everything goes through tmdb.ts, which uses Node `https` in
// the real panel (browser fetch dies on a `file://` origin -- same reason
// wrikeApi.ts exists) and falls back to `fetch` in browser preview so this is
// actually testable in `yarn dev`.
//
// RULES IMPLEMENTED HERE (from the real game): 25s per turn, links via
// cast/director/writer/composer/cinematographer, each person usable 3 times,
// no repeat films, you lose by running out of time. Bans, passes, skips and
// gamified win conditions are NOT in this slice -- see the note at the bottom
// of the file for where they'd go.
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2, Clock, Users, RotateCcw, Eye } from "lucide-react";
import ArcadeFrame from "../ArcadeFrame";
import { searchMovies, getCredits, randomStartingMovie, posterUrl, type MovieSummary, type MovieCredits } from "./tmdb";
import { checkMove, spend, usesLeft, MAX_USES_PER_PERSON, type ChainLink, type UsageTally } from "./chain";
import "./CineChain.scss";

const TURN_SECONDS = 25;
const SEARCH_DEBOUNCE_MS = 280;

// Letters/digits/space/backspace/enter/arrows -- the search box needs real
// typing, so this claims a lot more from AE than the other games do.
const KEY_CODES = (() => {
    const out = [13, 8, 32, 38, 40, 27];
    for (let c = 48; c <= 57; c++) out.push(c);
    for (let c = 65; c <= 90; c++) out.push(c);
    return out;
})();

type Phase = "loading" | "playing" | "over";

export const CineChain = ({ onClose }: { onClose: () => void }) => {
    const [phase, setPhase] = useState<Phase>("loading");
    const [fatal, setFatal] = useState<string | null>(null);

    const [chain, setChain] = useState<ChainLink[]>([]);
    const [current, setCurrent] = useState<MovieCredits | null>(null);
    const [tally, setTally] = useState<UsageTally>({});
    const [player, setPlayer] = useState<1 | 2>(1);
    const [seconds, setSeconds] = useState(TURN_SECONDS);
    const [loser, setLoser] = useState<1 | 2 | null>(null);

    const [query, setQuery] = useState("");
    const [results, setResults] = useState<MovieSummary[]>([]);
    const [searching, setSearching] = useState(false);
    const [checking, setChecking] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [showCast, setShowCast] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    // Guards against a slow search landing after a newer one (out-of-order
    // responses would otherwise repopulate the list with stale results).
    const searchSeq = useRef(0);

    const playedIds = chain.map((c) => c.movie.id);

    // ── boot ────────────────────────────────────────────────────────────────
    const start = useCallback(async () => {
        setPhase("loading");
        setFatal(null);
        try {
            const seed = await randomStartingMovie();
            const credits = await getCredits(seed.id);
            setChain([{ movie: { id: credits.id, title: credits.title, year: credits.year, poster: credits.poster }, via: null, player: null }]);
            setCurrent(credits);
            setTally({});
            setPlayer(1);
            setSeconds(TURN_SECONDS);
            setLoser(null);
            setQuery("");
            setResults([]);
            setMessage(null);
            setPhase("playing");
        } catch (e: any) {
            setFatal(e?.message || "Couldn't reach TMDB.");
            setPhase("over");
        }
    }, []);

    // START ONCE ON MOUNT, not once per effect run.
    //
    // Found in testing: the opening film was silently replaced a moment after
    // it appeared, because `start()` ran twice -- React StrictMode
    // double-invokes effects in dev, AND this panel is separately known to
    // mount React twice on a CEP cold start (see the GsapScreenTransition
    // dedupe). Each run picks a DIFFERENT random popular film, so the game you
    // were reading swapped under you and burned a second TMDB call.
    //
    // The ref guards only the MOUNT path; "New chain" / "Try again" call
    // start() directly and must still work every time.
    const bootedRef = useRef(false);
    useEffect(() => {
        if (bootedRef.current) return;
        bootedRef.current = true;
        start();
    }, [start]);

    // ── the clock ───────────────────────────────────────────────────────────
    // setInterval, not rAF: a turn clock is a fixed logical tick, and it also
    // keeps the game verifiable in the preview harness (which throttles rAF).
    useEffect(() => {
        if (phase !== "playing") return;
        const id = setInterval(() => {
            setSeconds((s) => {
                if (s <= 1) {
                    setLoser(player);
                    setPhase("over");
                    return 0;
                }
                return s - 1;
            });
        }, 1000);
        return () => clearInterval(id);
    }, [phase, player]);

    // ── search-as-you-type ──────────────────────────────────────────────────
    useEffect(() => {
        if (phase !== "playing") return;
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
    }, [query, phase]);

    // ── playing a film ──────────────────────────────────────────────────────
    const play = useCallback(async (pick: MovieSummary) => {
        if (!current || checking || phase !== "playing") return;
        setChecking(true);
        setMessage(null);
        // ONE ATTEMPT PER SEARCH. The box and the result list are cleared
        // BEFORE the verdict is known, so a rejected guess can't be followed by
        // clicking straight down the remaining suggestions until one sticks --
        // that turned the game into a brute-force lottery. You get the film you
        // committed to, then you type again.
        setQuery("");
        setResults([]);
        searchSeq.current++;   // cancels any search still in flight
        try {
            const candidate = await getCredits(pick.id);
            const verdict = checkMove(current, candidate, playedIds, tally);
            if (!verdict.ok || !verdict.via) {
                setMessage(verdict.reason || "Not a valid link.");
                return;
            }
            setChain((c) => [...c, {
                movie: { id: candidate.id, title: candidate.title, year: candidate.year, poster: candidate.poster },
                via: verdict.via,
                player,
            }]);
            setTally((t) => spend(t, verdict.via!.id));
            setCurrent(candidate);
            setPlayer((p) => (p === 1 ? 2 : 1));
            setSeconds(TURN_SECONDS);
            setShowCast(false);
        } catch (e: any) {
            setMessage(e?.message || "Lookup failed -- try again.");
        } finally {
            setChecking(false);
            // Put the caret back so the next guess can be typed immediately --
            // it matters under a 25s clock. This CANNOT be done inline above:
            // the input carries `disabled={checking}` while the lookup is in
            // flight, and a disabled field silently refuses focus. The timeout
            // defers it past the re-render that re-enables the field.
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [checking, current, phase, playedIds, player, tally]);

    // Enter plays the top result -- the whole game is typing under time
    // pressure, so reaching for the mouse to confirm would be the slowest part
    // of every turn.
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && results.length) { e.preventDefault(); play(results[0]); }
    };

    const linkable = current ? current.people.filter((p) => usesLeft(tally, p.id) > 0) : [];

    return (
        <ArcadeFrame
            title="XYiNerdle"
            hint={"Link by cast, director, writer, composer or cinematographer · each person " + MAX_USES_PER_PERSON + "x max"}
            keyCodes={KEY_CODES}
            fluid
            onClose={onClose}
        >
            <div className="cc-wrap">
                {phase === "loading" && (
                    <div className="cc-boot"><Loader2 size={18} className="spin" /> Finding an opening film&hellip;</div>
                )}

                {fatal && (
                    <div className="cc-fatal">
                        <span>{fatal}</span>
                        <button className="cc-btn" onClick={start}><RotateCcw size={13} /> Try again</button>
                    </div>
                )}

                {phase !== "loading" && !fatal && current && (
                    <>
                        <div className="cc-status">
                            <span className={"cc-turn" + (phase === "over" ? " cc-turn--over" : "")}>
                                {phase === "over"
                                    ? (loser ? "Player " + loser + " ran out of time" : "Game over")
                                    : "Player " + player + "’s turn"}
                            </span>
                            <span className={"cc-clock" + (seconds <= 5 ? " cc-clock--low" : "")}>
                                <Clock size={13} /> {seconds}s
                            </span>
                        </div>

                        {/* Two columns: play on the left, hints on the right --
                            matching where Cine2Nerdle keeps its tools. */}
                        <div className="cc-layout">
                            <div className="cc-main">
                                <div className="cc-current">
                                    {current.poster
                                        ? <img className="cc-poster cc-poster--lg" src={posterUrl(current.poster, "w154")} alt="" />
                                        : <span className="cc-poster cc-poster--lg cc-poster--none" />}
                                    <span className="cc-current-text">
                                        <span className="cc-current-label">Link from</span>
                                        <span className="cc-current-title">{current.title}</span>
                                        <span className="cc-current-year">{current.year}</span>
                                    </span>
                                </div>

                                {phase === "playing" && (
                                    <div className="cc-search">
                                        <Search size={14} />
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            value={query}
                                            autoFocus
                                            placeholder="Type a film, then Enter…"
                                            onChange={(e) => setQuery(e.target.value)}
                                            onKeyDown={onKeyDown}
                                            disabled={checking}
                                        />
                                        {(searching || checking) && <Loader2 size={14} className="spin" />}
                                    </div>
                                )}

                                {message && <div className="cc-message">{message}</div>}

                                {phase === "playing" && results.length > 0 && (
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

                                {phase === "over" && (
                                    <button className="cc-btn cc-btn--again" onClick={start}>
                                        <RotateCcw size={13} /> New XYiNerdle
                                    </button>
                                )}

                            </div>

                            {/* Hints live on the RIGHT, where Cine2Nerdle keeps
                                them. Kept behind a reveal rather than shown by
                                default -- a permanently visible cast list is an
                                answer sheet, not a hint. */}
                            <aside className="cc-side">
                                <div className="cc-side-head">Hints</div>
                                <button className="cc-hint-btn" onClick={() => setShowCast((v) => !v)}>
                                    <Eye size={12} /> {showCast ? "Hide cast & crew" : "Reveal cast & crew"}
                                </button>
                                {showCast ? (
                                    <div className="cc-cast">
                                        {linkable.map((p) => (
                                            <span className="cc-cast-chip" key={p.id + p.role}>
                                                <span className="cc-cast-name">{p.name}</span>
                                                {p.role !== "cast" && <em>{p.role}</em>}
                                                {usesLeft(tally, p.id) < MAX_USES_PER_PERSON && (
                                                    <b>{usesLeft(tally, p.id)} left</b>
                                                )}
                                            </span>
                                        ))}
                                        {!linkable.length && <span className="cc-cast-empty">Every link from this film is used up.</span>}
                                    </div>
                                ) : (
                                    <p className="cc-side-note">Who you can link through, and how many uses each has left.</p>
                                )}
                            </aside>
                            <div className="cc-chain">
                                <div className="cc-chain-head">
                                    <Users size={12} /> XYiNerdle
                                    <span className="cc-chain-count">{chain.length} film{chain.length === 1 ? "" : "s"}</span>
                                </div>
                                <div className="cc-chain-list">
                                {chain.slice().reverse().map((l) => (
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
                                                </span>
                                            ) : (
                                                <span className="cc-link-via cc-link-via--start">opening film</span>
                                            )}
                                        </span>
                                        {l.player && <span className={"cc-link-p cc-link-p--" + l.player}>P{l.player}</span>}
                                    </div>
                                ))}
                                </div>
                            </div>
                        </div>

                        <div className="cc-attrib">This product uses the TMDB API but is not endorsed or certified by TMDB.</div>
                    </>
                )}
            </div>
        </ArcadeFrame>
    );
};

// NEXT SLICES, so the shape of the thing is on record rather than in someone's
// head: (1) BATTLE -- swap the local turn-swap for two per-player JSON files
// under `misc/battle/<room>/` on the Team Folder, polled ~1s; each side writes
// only its own file, so there's no write contention to reason about. Anchor
// the clock to the move's written timestamp, not to render time, so Jump's
// screen-share latency can't shorten the remote player's turn. (2) LIFELINES
// -- skip, pass back (2 passes = draw), buy time, reveal cast. (3) BANS --
// 3 films per player their opponent can't use. (4) WIN CONDITIONS -- "play 8
// sci-fi", which needs genre ids off the same credits call.
export default CineChain;
