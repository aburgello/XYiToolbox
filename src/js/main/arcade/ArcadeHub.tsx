// The arcade: ONE door to every game, and the standings that come with them.
//
// WHY THIS REPLACED FOUR TRIGGER WORDS. Each game used to have its own hidden
// search word ("timeline", "daily", "xyinerdle", and DOOM's "doom"). A game was
// only findable by someone who already knew its word, and nothing tied them
// together or showed who was winning. Typing "arcade" now opens this, and
// adding a game is one entry in MACHINES below.
//
// THE SHAPE IS A CABINET SELECT, not a card grid. You pick a machine from the
// rack on the left and its high-score table fills the screen on the right --
// which is how you actually choose a game in an arcade, and it gives the
// leaderboard the whole panel instead of a footnote inside a card. The score
// table is the one loud element: monospace, rank-first, champion marked. Every
// game's accent drives the screen it's selected on, so switching machines
// re-tints the whole right-hand side.
//
// SCORING IS PER-GAME, and the difference is real rather than cosmetic:
//   - "wins"  -- a versus game posts one row per win, so the board COUNTS rows
//                (ties broken by the best chain in those wins).
//   - "best"  -- a solo game posts every attempt, so the board takes the MAX.
// Ranking a versus game by chain length would crown whoever had one lucky long
// game over someone who has beaten everyone all month.
//
// The board degrades quietly. No Team Folder, or an unmounted NAS, is a NORMAL
// state (a laptop away from the studio): the games still play, and the "how do
// I get on the board" line only appears for someone who hasn't tagged their
// machine -- it's guidance for the unset, not a permanent caption.
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import KeyframeSnake from "./KeyframeSnake";
import DailyWord from "./DailyWord";
import CineChain from "./cine/CineChain";
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
    /** Shown on the rack and as the screen's title. */
    name: string;
    /** Column header over the numbers -- the noun the score is counted in. */
    metric: string;
    /** See the scoring note in the header. */
    mode: "wins" | "best";
    accent: string;
    Game: React.ComponentType<{ onClose: () => void }>;
}

const MACHINES: Machine[] = [
    { id: "xyinerdle", name: "XYiNerdle",        metric: "Wins",   mode: "wins", accent: "#2dd4bf", Game: CineChain },
    { id: "daily",     name: "Daily Word",       metric: "Streak", mode: "best", accent: "#a78bfa", Game: DailyWord },
    { id: "timeline",  name: "Push the Playhead", metric: "Score",  mode: "best", accent: "#fb923c", Game: KeyframeSnake },
];

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
            return m.mode === "wins"
                ? { name, value: mine.length, detail: best }
                : { name, value: best };
        })
        .sort((a, b) => b.value - a.value || (b.detail || 0) - (a.detail || 0))
        .slice(0, 8);
}

export const ArcadeHub = ({ onClose }: { onClose: () => void }) => {
    const [scores, setScores] = useState<ArcadeScore[] | null>(null);
    const [me, setMe] = useState("");
    const [loading, setLoading] = useState(true);
    const [tagged, setTagged] = useState(true);
    const [selected, setSelected] = useState(MACHINES[0].id);
    const [playing, setPlaying] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await evalTS("teamArcadeScores");
            const r = res as unknown as { success?: boolean; me?: string; scores?: ArcadeScore[] } | undefined;
            setScores(r?.scores || []);
            setMe(r?.me || "");
            setTagged(!!r?.me);
        } catch {
            setScores([]);       // browser preview / no bridge
            setTagged(false);
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

    const machine = MACHINES.find((m) => m.id === selected) || MACHINES[0];
    const board = useMemo(() => (scores ? standingsFor(scores, machine) : []), [scores, machine]);
    const champion = (id: string) => {
        if (!scores) return null;
        const m = MACHINES.find((x) => x.id === id)!;
        return standingsFor(scores, m)[0]?.name || null;
    };

    const Active = MACHINES.find((m) => m.id === playing)?.Game;
    // Leaving a game returns to the rack and re-reads the board, since the game
    // may have just posted to it.
    if (Active) return <Active onClose={() => { setPlaying(null); refresh(); }} />;

    return (
        <motion.div
            className="arc-hub"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
        >
            <div className="arc-cab" style={{ ["--arc" as any]: machine.accent }}>
                {/* Marquee: the lit sign over a cabinet. Centred and full-width
                    rather than a title stranded in the top-left corner. */}
                <div className="arc-marquee">
                    <span className="arc-marquee-name">ARCADE</span>
                    <button className="arc-x" onClick={onClose} title="Close (Esc)"><X size={13} /></button>
                </div>

                <div className="arc-body">
                    <nav className="arc-rack" aria-label="Games">
                        {MACHINES.map((m) => {
                            const champ = champion(m.id);
                            return (
                                <button
                                    key={m.id}
                                    className={"arc-machine" + (m.id === selected ? " arc-machine--on" : "")}
                                    style={{ ["--arc" as any]: m.accent }}
                                    onClick={() => setSelected(m.id)}
                                >
                                    <span className="arc-machine-name">{m.name}</span>
                                    <span className="arc-machine-champ">{champ ? `${champ} holds it` : "unclaimed"}</span>
                                </button>
                            );
                        })}
                    </nav>

                    <section className="arc-screen" key={machine.id}>
                        <header className="arc-screen-head">
                            <h2 className="arc-screen-title">{machine.name}</h2>
                            <button className="arc-refresh" onClick={refresh} title="Refresh standings">
                                <RefreshCw size={11} className={loading ? "spin" : ""} />
                            </button>
                        </header>

                        <div className="arc-table">
                            <div className="arc-table-head">
                                <span className="arc-c-rank">#</span>
                                <span className="arc-c-name">Player</span>
                                <span className="arc-c-val">{machine.metric}</span>
                            </div>

                            {loading && !scores && (
                                <div className="arc-blank"><Loader2 size={12} className="spin" /> Reading the board…</div>
                            )}
                            {!loading && !board.length && (
                                <div className="arc-blank">Nobody on the board. Go first.</div>
                            )}

                            {board.map((row, i) => (
                                <motion.div
                                    // Champion is an explicit class, NOT
                                    // :first-of-type -- the table head is a div
                                    // too, so it wins that selector and the top
                                    // line never got its accent.
                                    className={"arc-line" + (i === 0 ? " arc-line--champ" : "") + (row.name === me ? " arc-line--me" : "")}
                                    key={row.name}
                                    initial={{ opacity: 0, x: -6 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.035, duration: 0.2 }}
                                >
                                    <span className="arc-c-rank">{String(i + 1).padStart(2, "0")}</span>
                                    <span className="arc-c-name">{row.name}</span>
                                    <span className="arc-c-val">
                                        {row.value}
                                        {machine.mode === "wins" && row.detail ? <em>{row.detail} best</em> : null}
                                    </span>
                                </motion.div>
                            ))}
                        </div>

                        <button className="arc-play" onClick={() => setPlaying(machine.id)}>
                            Play {machine.name}
                        </button>

                        {/* Only for someone who can't get on the board yet. */}
                        {!tagged && (
                            <p className="arc-note">
                                Tag this machine with your name in the Team menu to appear here.
                            </p>
                        )}
                    </section>
                </div>
            </div>
        </motion.div>
    );
};

export default ArcadeHub;
