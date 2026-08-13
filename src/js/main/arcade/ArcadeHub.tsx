// The arcade: ONE door to every game, and the standings that come with them.
//
// WHY THIS REPLACED FOUR TRIGGER WORDS. Each game used to have its own hidden
// search word ("timeline", "daily", "xyinerdle", and DOOM's "doom"). A game was
// only findable by someone who already knew its word, and nothing tied them
// together or showed who was winning. Typing "arcade" now opens this, and
// adding a game is one entry in MACHINES below.
//
// THE SHAPE IS A GRID OF CABINETS, one card per game -- REPLACING an earlier
// rack-and-screen layout (a list of machines down the left, the selected one's
// score table filling the right). That shape was a picker, not an arcade: every
// game but one was a name in a narrow column, its scores were invisible until
// you selected it, and starting a game took two clicks (select, then Play).
// Now each card carries its own accent, its own champion and its own top three,
// and THE CARD ITSELF IS THE PLAY BUTTON -- everything is visible at once and
// nothing needs selecting.
//
// SCORING IS PER-GAME, and the difference is real rather than cosmetic:
//   - "wins"  -- a versus game posts one row per win, so the board COUNTS rows
//                (ties broken by the best chain in those wins).
//   - "best"  -- a solo game posts every attempt, so the board takes the MAX.
// Ranking a versus game by chain length would crown whoever had one lucky long
// game over someone who has beaten everyone all month.
//
// EVERY GAME MUST POST OR ITS CARD IS DECORATION. The board is one shared store
// (teamArcadeScores) keyed by game id, and for a long time the ONLY writer was
// XYiNerdle's head-to-head win -- so two machines had boards that could never
// fill however much anyone played. Adding a MACHINES entry WITHOUT a matching
// `teamArcadePost` call in the game itself recreates exactly that bug.
//
// The board degrades quietly. No Team Folder, or an unmounted NAS, is a NORMAL
// state (a laptop away from the studio): the games still play, and the "how do
// I get on the board" line only appears for someone who hasn't tagged their
// machine -- it's guidance for the unset, not a permanent caption.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Crown, Loader2, Play, RefreshCw, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import KeyframeSnake from "./KeyframeSnake";
import DailyWord from "./DailyWord";
import PosterDaily from "./PosterDaily";
import CineChain from "./cine/CineChain";
import "./arcadeFont.scss";
import "./ArcadeHub.scss";

interface ArcadeScore {
    game: string;
    name: string;
    score: number;
    versus: string;
    stamp: string;
}

interface Machine {
    id: string;
    /** Shown on the cabinet's marquee. */
    name: string;
    /** Column header over the numbers -- the noun the score is counted in. */
    metric: string;
    /** See the scoring note in the header. */
    /** How this game's board is ranked:
     *   wins   -- versus game, one row per win: COUNT the rows.
     *   best   -- arcade game, every attempt posted: take the MAX.
     *   points -- daily game, one scored round per day: SUM them, so the board
     *             rewards playing well AND showing up. Ranking a daily game by
     *             its best single day would crown one lucky morning; ranking it
     *             by days played said nothing about how well any went. */
    mode: "wins" | "best" | "points";
    accent: string;
    /**
     * The accent again, pre-blended to a low alpha for the lit-screen hover.
     * A LITERAL rgba rather than a colour derived from `accent`: this project's
     * chrome74 build target has no `color-mix()`, so every blended shade in the
     * app is stored precomputed (same rule as Toolset's PALETTE).
     */
    glow: string;
    Game: React.ComponentType<{ onClose: () => void }>;
}

const MACHINES: Machine[] = [
    // NAMES ARE DISPLAY-ONLY -- the ids are the keys in the shared score files
    // already on the NAS, so a rename never touches them ("daily" is Wordmark,
    // "poster" is One Sheet). Renaming an id would orphan every posted row.
    { id: "poster", name: "One Sheet", metric: "Points", mode: "points", accent: "#fbbf24", glow: "rgba(251, 191, 36, 0.16)", Game: PosterDaily },
    { id: "daily", name: "Wordmark", metric: "Points", mode: "points", accent: "#a78bfa", glow: "rgba(167, 139, 250, 0.16)", Game: DailyWord },
    { id: "timeline", name: "Push the Playhead", metric: "Score", mode: "best", accent: "#fb923c", glow: "rgba(251, 146, 60, 0.16)", Game: KeyframeSnake },
    { id: "xyinerdle", name: "XYiNerdle", metric: "Points", mode: "points", accent: "#2dd4bf", glow: "rgba(45, 212, 191, 0.16)", Game: CineChain },
];

/** How many lines fit on a cabinet face without it becoming a spreadsheet. */
const CARD_LINES = 3;

interface Standing {
    name: string;
    value: number;
    /** For versus games: the best chain among those wins, shown small. */
    detail?: number;
}

function standingsFor(scores: ArcadeScore[], m: Machine): Standing[] {
    const rows = scores.filter((s) => s.game === m.id);
    const by: Record<string, ArcadeScore[]> = {};
    for (const r of rows) (by[r.name] = by[r.name] || []).push(r);

    return Object.keys(by)
        .map((name) => {
            const mine = by[name];
            const best = mine.reduce((n, r) => Math.max(n, r.score), 0);
            if (m.mode === "wins") return { name, value: mine.length, detail: best };
            if (m.mode === "best") return { name, value: best };
            // points: total earned, with the best single round as the tiebreak
            // and the small detail line.
            const total = mine.reduce((n, r) => n + (r.score || 0), 0);
            return { name, value: total, detail: best };
        })
        .sort((a, b) => b.value - a.value || (b.detail || 0) - (a.detail || 0));
}

// --- the overall board ------------------------------------------------------
// Scored the way a racing season is: rank within each game, pay for position.
// Second in three games (300) then beats winning one (150), which is what an
// "overall" board should reward.
// The championship pays for a POSITION, not for a total. Each game ranks its own
// players by its own metric first; only where you finished crosses over here.
//
// This is the whole reason it works. One Sheet and Wordmark accumulate ~1400 a
// month for someone who plays daily, XYiNerdle a few hundred, and Push the
// Playhead is a single best run -- summing those raw numbers would make the
// championship a register of who opened the panel most often, and would bury the
// timeline entirely. Converting to a position makes four unlike games comparable
// and keeps every one of them worth winning.
//
// Nothing below 4th scores: a place has to be worth something to be worth
// chasing, and with a team this size 5th is most of the board.
const CHAMPIONSHIP_POINTS = [150, 100, 60, 30];

// Rolling window. All-time would permanently favour whoever started first and
// give a new starter no route in; 30 days keeps it live without resetting so
// often that nothing accumulates.
const OVERALL_WINDOW_DAYS = 30;

// Ranked below anyone who has entered more games, however well they did in it:
// topping an OVERALL board off a single game is the failure mode this guards.
// Shown, never hidden -- the row says how many games it was.
const MIN_GAMES_TO_RANK = 2;

export interface OverallRow {
    name: string;
    points: number;
    games: number;
    /** Position per game id, for the row's little medal strip. 1-based. */
    places: Record<string, number>;
    ranked: boolean;
}

function withinWindow(stamp: string, days: number): boolean {
    // Stamps are "YYYY-MM-DD HH:MM" (nowStamp, team.ts). A plain string compare
    // against a cutoff of the same shape is enough and needs no parsing.
    if (!stamp) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const p = (n: number) => String(n).padStart(2, "0");
    const key = `${cutoff.getFullYear()}-${p(cutoff.getMonth() + 1)}-${p(cutoff.getDate())}`;
    return stamp.slice(0, 10) >= key;
}

export function overallStandings(scores: ArcadeScore[], machines: Machine[]): OverallRow[] {
    const recent = scores.filter((s) => withinWindow(s.stamp, OVERALL_WINDOW_DAYS));
    const acc: Record<string, OverallRow> = {};

    for (const m of machines) {
        const standings = standingsFor(recent, m);
        standings.forEach((row, idx) => {
            const r = acc[row.name] || (acc[row.name] = {
                name: row.name, points: 0, games: 0, places: {}, ranked: false,
            });
            r.points += CHAMPIONSHIP_POINTS[idx] || 0;
            r.games += 1;
            r.places[m.id] = idx + 1;
        });
    }

    return Object.keys(acc)
        .map((k) => {
            const r = acc[k];
            r.ranked = r.games >= MIN_GAMES_TO_RANK;
            return r;
        })
        // Ranked players first, then points, then breadth -- someone level on
        // points across three games is ahead of the same total off two.
        .sort((a, b) =>
            Number(b.ranked) - Number(a.ranked) ||
            b.points - a.points ||
            b.games - a.games ||
            a.name.localeCompare(b.name)
        );
}

export const ArcadeHub = ({ onClose }: { onClose: () => void }) => {
    const [scores, setScores] = useState<ArcadeScore[] | null>(null);
    const [me, setMe] = useState("");
    const [loading, setLoading] = useState(true);
    const [tagged, setTagged] = useState(true);
    const [playing, setPlaying] = useState<string | null>(null);
    // True when the board on screen is the last one we successfully read and a
    // later refresh couldn't reach the team folder.
    const [stale, setStale] = useState(false);
    const reduced = useReducedMotion();
    const overall = useMemo(() => overallStandings(scores || [], MACHINES), [scores]);
    const podium = overall.slice(0, 3);
    const rest = overall.slice(3);

    // `refresh` is stable (empty deps, so the mount effect runs once), which
    // means it can't read `scores` from its own closure. This ref is how it
    // knows whether there's anything worth protecting.
    const scoresRef = useRef<ArcadeScore[] | null>(null);
    useEffect(() => { scoresRef.current = scores; }, [scores]);

    // A REFRESH MUST NEVER DESTROY A GOOD BOARD.
    //
    // Real report: finishing a snake run while a render completed emptied every
    // cabinet's board until the panel was reopened. Leaving a game calls this,
    // and it ran straight into a busy bridge -- `evalTS` came back undefined (or
    // the host's own NAS read failed and, before the `read` flag, reported an
    // empty board), and every path here overwrote the rows we already had with
    // `[]`. Nothing retries, so it stayed blank until a remount re-read it.
    //
    // The store is append-only and trimmed, so it never legitimately goes from
    // N rows to none: an empty result when we're already holding rows is a
    // failed read, full stop. Keep what we have and say so, rather than
    // rendering a lie.
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await evalTS("teamArcadeScores");
            const r = res as unknown as { success?: boolean; me?: string; scores?: ArcadeScore[]; read?: boolean } | undefined;
            // `read === false` is the host saying it couldn't read the file.
            // `res === undefined` is the bridge itself not answering. An older
            // host predates the flag, so an undefined `read` is trusted.
            const usable = !!r && r.success !== false && r.read !== false;
            if (usable) {
                setScores(r.scores || []);
                setMe(r.me || "");
                setTagged(!!r.me);
                setStale(false);
            } else {
                // Nothing cached yet (first load, browser preview, no team
                // folder) -- an empty board is the honest thing to show.
                setScores((prev) => prev || []);
                if (r && r.me) { setMe(r.me); setTagged(true); }
                else if (!scoresRef.current) setTagged(false);
                setStale(!!scoresRef.current?.length);
            }
        } catch {
            // No bridge at all. Same rule: only fall back to empty if we have
            // nothing better to show.
            setScores((prev) => prev || []);
            if (!scoresRef.current) setTagged(false);
            setStale(!!scoresRef.current?.length);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Escape closes the arcade. Not bound while a game is running -- the game's
    // own frame owns Escape then, and closing both would drop the player all
    // the way back to the panel in one keystroke.
    useEffect(() => {
        if (playing) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [playing, onClose]);

    // One pass over the scores for every machine, rather than re-filtering the
    // whole list inside each card's render.
    const boards = useMemo(() => {
        const out: Record<string, Standing[]> = {};
        for (const m of MACHINES) out[m.id] = scores ? standingsFor(scores, m) : [];
        return out;
    }, [scores]);

    const Active = MACHINES.find((m) => m.id === playing)?.Game;
    // Leaving a game returns to the cabinets and re-reads the board, since the
    // game may have just posted to it.
    if (Active) return <Active onClose={() => { setPlaying(null); refresh(); }} />;

    return (
        <motion.div
            className="arc-hub"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
        >
            <div className="arc-cab">
                {/* Marquee: the lit sign over the room. Its glow is fixed rather
                    than tinted per game now -- with four cabinets on screen at
                    once there's no single "selected" accent to inherit. */}
                <div className="arc-marquee">
                    <span className="arc-marquee-name arcade-pixel">ARCADE</span>
                    <button className="arc-refresh" onClick={refresh} title="Refresh standings">
                        <RefreshCw size={11} className={loading ? "spin" : ""} />
                    </button>
                    <button className="arc-x" onClick={onClose} title="Close (Esc)"><X size={13} /></button>
                </div>

                <div className="arc-floor">
                    {MACHINES.map((m, i) => {
                        const board = boards[m.id] || [];
                        const champ = board[0];
                        return (
                            <motion.button
                                key={m.id}
                                className="arc-cabinet"
                                style={{ ["--arc" as any]: m.accent, ["--arc-glow" as any]: m.glow }}
                                onClick={() => setPlaying(m.id)}
                                // Per-item explicit delay rather than a stagger
                                // parent -- this codebase's documented workaround
                                // for variant propagation stalling inside an
                                // AnimatePresence wrapper.
                                initial={reduced ? false : { opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: reduced ? 0 : i * 0.05, duration: 0.22 }}
                                whileTap={reduced ? undefined : { scale: 0.99 }}
                                title={`Play ${m.name}`}
                            >
                                {/* The cabinet's own lit header. */}
                                <span className="arc-cab-marquee">
                                    <span className="arc-cab-name arcade-pixel">{m.name}</span>
                                </span>

                                <span className="arc-cab-champ">
                                    {champ ? (
                                        <>
                                            <Crown size={10} />
                                            <span className="arc-cab-champ-name">{champ.name}</span>
                                            <span className="arc-cab-champ-holds">holds it</span>
                                        </>
                                    ) : (
                                        <span className="arc-cab-champ-holds">nobody's claimed it yet</span>
                                    )}
                                </span>

                                <span className="arc-scores">
                                    <span className="arc-scores-head">
                                        <span className="arc-c-rank">#</span>
                                        <span className="arc-c-name">Player</span>
                                        <span className="arc-c-val">{m.metric}</span>
                                    </span>

                                    {loading && !scores && (
                                        <span className="arc-blank"><Loader2 size={11} className="spin" /> Reading the board…</span>
                                    )}
                                    {!loading && !board.length && (
                                        <span className="arc-blank">Be the first name on it.</span>
                                    )}

                                    {board.slice(0, CARD_LINES).map((row, r) => (
                                        <span
                                            // Champion is an explicit class, NOT
                                            // :first-of-type -- the head is a
                                            // sibling span too, so it wins that
                                            // selector and the top line never
                                            // got its accent.
                                            className={"arc-line" + (r === 0 ? " arc-line--champ" : "") + (row.name === me ? " arc-line--me" : "")}
                                            key={row.name}
                                        >
                                            <span className="arc-c-rank">{String(r + 1).padStart(2, "0")}</span>
                                            <span className="arc-c-name">{row.name}</span>
                                            <span className="arc-c-val">
                                                {row.value}
                                                {(m.mode === "wins" || m.mode === "points") && row.detail ? <em>{row.detail} best</em> : null}
                                            </span>
                                        </span>
                                    ))}
                                    {board.length > CARD_LINES && (
                                        <span className="arc-more">+{board.length - CARD_LINES} more</span>
                                    )}
                                </span>

                                {/* Not a nested <button> (invalid inside one, and
                                    it would eat the card's own click) -- the card
                                    IS the control, this is its label. */}
                                <span className="arc-cab-play"><Play size={12} /> Play</span>
                            </motion.button>
                        );
                    })}
                </div>

                {/* THE CHAMPIONSHIP. Sits under the cabinets because it is a
                    summary of them, not a fifth machine -- it has no Play. Top
                    three get a podium; the rest a plain list. Hidden entirely
                    when nobody qualifies, so a fresh team folder shows an
                    arcade rather than an empty trophy case. */}
                {overall.length > 0 && (
                    <div className="arc-overall">
                        <div className="arc-overall-head">
                            <span className="arc-overall-title arcade-pixel">CHAMPIONSHIP</span>
                            <span className="arc-overall-sub">last {OVERALL_WINDOW_DAYS} days · points for placing in each game</span>
                        </div>

                        <div className="arc-podium">
                            {podium.map((row, i) => (
                                <motion.div
                                    key={row.name}
                                    className={`arc-plinth arc-plinth--${i + 1}${row.name === me ? " is-me" : ""}`}
                                    initial={reduced ? false : { opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: reduced ? 0 : 0.28 + i * 0.07, duration: 0.3, ease: "easeOut" }}
                                >
                                    {i === 0 && <Crown size={14} className="arc-plinth-crown" />}
                                    <span className="arc-plinth-pos arcade-pixel">{i + 1}</span>
                                    <span className="arc-plinth-name">{row.name}</span>
                                    <span className="arc-plinth-pts">{row.points}<em>pts</em></span>
                                    <span className="arc-plinth-games">{row.games} of {MACHINES.length} games</span>
                                </motion.div>
                            ))}
                        </div>

                        {rest.length > 0 && (
                            <ul className="arc-overall-list">
                                {rest.map((row, i) => (
                                    <li key={row.name} className={row.name === me ? "is-me" : undefined}>
                                        <span className="arc-ol-pos">{podium.length + i + 1}</span>
                                        <span className="arc-ol-name">{row.name}</span>
                                        {/* One pip per game entered, tinted with that
                                            game's own accent, so breadth reads at a
                                            glance without another column of numbers. */}
                                        <span className="arc-ol-pips">
                                            {MACHINES.map((m) => (
                                                <span
                                                    key={m.id}
                                                    className={row.places[m.id] ? "arc-pip is-in" : "arc-pip"}
                                                    style={row.places[m.id] ? { background: m.accent } : undefined}
                                                    title={row.places[m.id] ? `${m.name}: ${row.places[m.id]}` : `${m.name}: not played`}
                                                />
                                            ))}
                                        </span>
                                        {!row.ranked && <em className="arc-ol-unranked">needs {MIN_GAMES_TO_RANK} games</em>}
                                        <span className="arc-ol-pts">{row.points}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {/* Says the board on screen is the last one we could read,
                    rather than letting it silently drift out of date. Only
                    ever shown over real rows -- with nothing cached there's
                    nothing stale to warn about. */}
                {stale && (
                    <p className="arc-note arc-note--stale">
                        Couldn't reach the team folder just now — showing the last standings I read.
                        <button className="arc-note-retry" onClick={refresh}>Try again</button>
                    </p>
                )}

                {/* Only for someone who can't get on the board yet. */}
                {!tagged && (
                    <p className="arc-note">
                        Tag this machine with your name in the Team menu to appear on these boards.
                    </p>
                )}
            </div>
        </motion.div>
    );
};

export default ArcadeHub;
