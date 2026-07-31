// "WORDMARK" -- the chill one. Five letters, six guesses, one puzzle a day.
// (A wordmark is a logo made of type; this is a design studio.)
//
// The name is DISPLAY-ONLY: the file is still DailyWord.tsx, the game id is
// still "daily" and the board file is still shared-wordgame.json, because that
// id is the key every already-posted row on the NAS is filed under. Same
// partial-rename rule as XYTools and One Sheet.
//
// WHY THIS SHAPE: asked for as something non-skill-based to dip into during a
// render. One puzzle a day means there's no grind and no way to be "behind";
// it takes two minutes and then it's done.
//
// THE SYNC IS FREE, AND THAT'S THE WHOLE TRICK. The answer is derived from
// the DATE (see puzzleForDay), so every machine in the studio independently
// arrives at the same word on the same day with no server, no clock sync and
// no coordination. The only shared state is the optional scoreboard, which is
// just a small JSON file on the Team Folder the panel already uses for
// profiles and shared combos.
//
// POSTING IS AUTOMATIC once a round ends, and the leaderboard is always on.
// This REVERSES this feature's first version, which hid results behind a
// "Share with the team" click -- changed on direct instruction, on the
// reasoning that a word-game score is low stakes and a leaderboard nobody
// remembers to post to is a dead leaderboard. The tradeoff is handled by
// being open about it rather than by asking: the panel's own hint line says
// the result posts to the team board, so it's never a surprise. If this ever
// needs to become opt-in again, the honest fix is a per-member toggle, not
// silence. (teamPostWordResult still refuses to post from an UNTAGGED
// machine rather than guessing at a name -- that half is unchanged.)
//
// EVERYTHING DEGRADES QUIETLY. No CEP bridge (browser preview), no Team
// Folder, or an unmounted NAS are all NORMAL states, not errors: the game
// stays fully playable and just doesn't persist or show a board. The only
// message ever surfaced is the untagged-machine case, as a quiet inline note.
import { useCallback, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import ArcadeFrame from "./ArcadeFrame";
import { WORDS } from "./words";
import { isRealWord } from "./guessWords";
import "./DailyWord.scss";

const LEN = 5;
const MAX_GUESSES = 6;

// Letters + Enter + Backspace, claimed from AE while the game is open.
const KEY_CODES = (() => {
    const out = [13, 8];
    for (let c = 65; c <= 90; c++) out.push(c);
    return out;
})();

type Mark = "correct" | "present" | "absent";

interface SavedState {
    day: string;
    guesses: string[];
    done: boolean;
    solved: boolean;
    streak: number;
    lastSolvedDay: string;
    posted: boolean;
}

interface BoardRow {
    day: string;
    member: string;
    guesses: number;
    solved: boolean;
    streak: number;
}

/** One member's standing across the board's rolling window. */
interface Standing {
    member: string;
    played: number;
    solved: number;
    totalGuesses: number;
    best: number;      // fewest guesses on a solved day; 0 = never solved
    streak: number;    // from that member's most recent posted row
    lastDay: string;
}

/**
 * Roll the per-day rows up per member.
 *
 * Streak is read off each member's MOST RECENT row rather than recomputed
 * here: a streak is counted on each person's own machine (it knows which days
 * they actually played), and the board only ever sees days they chose to be
 * on. Recomputing from these rows would quietly under-count anyone who missed
 * a day at a weekend.
 */
const standingsFrom = (rows: BoardRow[]): Standing[] => {
    const byMember: Record<string, Standing> = {};
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r.member) continue;
        let s = byMember[r.member];
        if (!s) {
            s = { member: r.member, played: 0, solved: 0, totalGuesses: 0, best: 0, streak: 0, lastDay: "" };
            byMember[r.member] = s;
        }
        s.played++;
        if (r.solved) {
            s.solved++;
            s.totalGuesses += r.guesses;
            if (!s.best || r.guesses < s.best) s.best = r.guesses;
        }
        if (r.day > s.lastDay) {
            s.lastDay = r.day;
            s.streak = r.streak || 0;
        }
    }
    const out: Standing[] = [];
    for (const k in byMember) if (byMember.hasOwnProperty(k)) out.push(byMember[k]);
    // Longest streak first, then the best single round, then fewest total
    // guesses -- rewards showing up, not just one lucky day.
    out.sort((a, b) =>
        b.streak - a.streak ||
        (a.best || 99) - (b.best || 99) ||
        a.totalGuesses - b.totalGuesses
    );
    return out;
};

// Fallback store for when there's no CEP bridge (browser preview): the game
// still plays, it just forgets on reload. Module scope so it survives the
// double-mount this panel does on cold start.
let memoryState: SavedState | null = null;

/**
 * The day key and that day's answer.
 *
 * Day math uses the LOCAL calendar date collapsed onto a UTC timestamp, not
 * `Date.now()` directly: that way a puzzle changes at local midnight and DST
 * transitions can't produce a 23- or 25-hour "day" that skips or repeats a
 * word. Everyone in one studio shares a timezone, so this also keeps the
 * whole team on the same word.
 *
 * The stride multiplier is a prime coprime with the list length, so
 * consecutive days land far apart in the list (no alphabetical runs) while
 * still visiting every word before any repeat -- 687 days here, ~1.9 years.
 */
export const puzzleForDay = (d: Date): { dayKey: string; word: string } => {
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    const pad = (n: number) => (n < 10 ? "0" + n : String(n));
    const dayKey = y + "-" + pad(m + 1) + "-" + pad(day);

    const EPOCH = Date.UTC(2026, 0, 1);
    const dayNumber = Math.floor((Date.UTC(y, m, day) - EPOCH) / 86400000);
    // JS % keeps the sign of the dividend, so a date before the epoch would
    // index negatively -- normalise before indexing.
    const idx = (((dayNumber * 7919) % WORDS.length) + WORDS.length) % WORDS.length;
    return { dayKey, word: WORDS[idx] };
};

/**
 * Standard two-pass scoring. The second pass is the part that's easy to get
 * wrong: a letter only comes up "present" while there are still unmatched
 * copies of it left in the answer, so guessing "eerie" against "steel" marks
 * exactly the right number of E's rather than all of them.
 */
export const scoreGuess = (guess: string, answer: string): Mark[] => {
    const out: Mark[] = [];
    const left: Record<string, number> = {};
    for (let i = 0; i < LEN; i++) out.push("absent");
    for (let i = 0; i < LEN; i++) {
        const c = answer.charAt(i);
        left[c] = (left[c] || 0) + 1;
    }
    for (let i = 0; i < LEN; i++) {
        if (guess.charAt(i) === answer.charAt(i)) {
            out[i] = "correct";
            left[guess.charAt(i)]--;
        }
    }
    for (let i = 0; i < LEN; i++) {
        if (out[i] === "correct") continue;
        const c = guess.charAt(i);
        if (left[c] > 0) {
            out[i] = "present";
            left[c]--;
        }
    }
    return out;
};

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

export const DailyWord = ({ onClose }: { onClose: () => void }) => {
    const today = useRef(puzzleForDay(new Date())).current;

    const [guesses, setGuesses] = useState<string[]>([]);
    const [current, setCurrent] = useState("");
    const [done, setDone] = useState(false);
    const [solved, setSolved] = useState(false);
    const [streak, setStreak] = useState(0);
    const [lastSolvedDay, setLastSolvedDay] = useState("");
    const [posted, setPosted] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);
    // Brief shake on the row being typed when a guess isn't a real word.
    const [reject, setReject] = useState(false);
    const [board, setBoard] = useState<BoardRow[] | null>(null);
    const [postNote, setPostNote] = useState<string | null>(null);
    const loaded = useRef(false);
    // Guards the auto-post against firing twice (React re-renders, the panel's
    // known double-mount) -- a ref, not state, because it has to be true
    // synchronously before the second call can be made.
    const postingRef = useRef(false);

    // ── persistence (quiet on every failure) ─────────────────────────────────
    const persist = useCallback((s: SavedState) => {
        memoryState = s;
        evalTS("wordGameSaveState", JSON.stringify(s)).catch(() => undefined);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            let saved: SavedState | null = memoryState;
            try {
                const raw = await evalTS("wordGameLoadState");
                if (typeof raw === "string" && raw) saved = JSON.parse(raw) as SavedState;
            } catch (e) {
                /* no bridge / unreadable -- a fresh game is the right fallback */
            }
            if (cancelled) return;
            loaded.current = true;
            if (!saved) return;

            // Carry the streak across days, but only restore the BOARD if the
            // save is from today -- otherwise it's yesterday's game.
            setStreak(saved.streak || 0);
            setLastSolvedDay(saved.lastSolvedDay || "");
            if (saved.day === today.dayKey) {
                setGuesses(saved.guesses || []);
                setDone(!!saved.done);
                setSolved(!!saved.solved);
                setPosted(!!saved.posted);
            }
        })();
        return () => { cancelled = true; };
    }, [today.dayKey]);

    // The team board is read-only and decorative until someone posts, so a
    // missing folder or unmounted NAS just leaves it null (nothing rendered).
    const refreshBoard = useCallback(async () => {
        try {
            const res = await evalTS("teamLoadWordBoard");
            const r = res as { entries?: BoardRow[]; read?: boolean } | undefined;
            // `read === false` means the host could not read the shared file
            // (unmounted NAS, or AE busy mid-render). Keeping the board we
            // already have beats replacing it with an empty one -- that is
            // exactly how the arcade hub's standings went blank until the
            // panel was reopened. An older host has no flag, so undefined is
            // trusted.
            const entries = r && r.read !== false ? r.entries : undefined;
            // Keep the WHOLE window: today's rows and the standings are both
            // derived from it at render time.
            if (entries) setBoard(entries);
        } catch (e) {
            /* no bridge / no team folder -- board simply doesn't appear */
        }
    }, []);

    useEffect(() => { refreshBoard(); }, [refreshBoard]);

    // ── posting ──────────────────────────────────────────────────────────────
    // Results now go to the board AUTOMATICALLY once a round ends, rather than
    // behind a "Share" click. That's a deliberate reversal of this feature's
    // first version (see the header note in team.ts about opt-in sharing) --
    // asked for directly, on the reasoning that a word-game score is low
    // stakes and a leaderboard nobody remembers to post to is a dead
    // leaderboard. It stays honest about it in the UI: the panel says plainly
    // that finishing posts your result, so it's never a surprise.
    //
    // An untagged machine still cannot post -- the host refuses rather than
    // guessing a name -- so that case surfaces as a quiet inline note instead
    // of an error toast.
    const postResult = useCallback(async (payload: { guesses: number; solved: boolean; streak: number }) => {
        if (postingRef.current) return;
        postingRef.current = true;
        try {
            const res = await evalTS("teamPostWordResult", JSON.stringify({
                day: today.dayKey,
                member: "",                       // filled in host-side from the machine tag
                guesses: payload.solved ? payload.guesses : 0,
                solved: payload.solved,
                streak: payload.streak,
                postedAt: "",
            }));
            if (res === undefined) throw new Error("no bridge");
            const r = res as { success?: boolean; error?: string };
            if (r.success) {
                setPosted(true);
                setPostNote(null);
                refreshBoard();
                // ALSO post to the arcade rack's cross-game store. This board
                // (shared-wordgame.json) only renders inside this game; the hub
                // reads teamArcadeScores, so without this line the rack's
                // Wordmark column stayed permanently empty however many days
                // were played. Streak, because that's the metric the rack shows
                // for this machine, and its "best" mode takes the max.
                if (payload.solved) {
                    evalTS("teamArcadePost", "daily", payload.streak, "").catch(() => undefined);
                }
            } else {
                setPostNote(r.error || "Couldn't post to the team board.");
            }
        } catch (e) {
            // No bridge / no team folder: normal states, not errors.
            setPostNote(null);
        } finally {
            postingRef.current = false;
        }
    }, [refreshBoard, today.dayKey]);

    // ── play ─────────────────────────────────────────────────────────────────
    const say = useCallback((msg: string) => {
        setFlash(msg);
        setTimeout(() => setFlash(null), 1600);
    }, []);

    const submit = useCallback(() => {
        if (done) return;
        if (current.length !== LEN) { say("Needs five letters."); return; }
        // Guesses must be real words -- otherwise you can grind the answer out
        // with gibberish. The list behind isRealWord is deliberately permissive
        // (see guessWords.ts); it bounces nonsense, not unusual vocabulary.
        // Costs no guess: the row stays, shakes, and waits for a fix.
        if (!isRealWord(current)) {
            say("Not a word I know.");
            setReject(true);
            setTimeout(() => setReject(false), 450);
            return;
        }

        const nextGuesses = [...guesses, current];
        const isWin = current === today.word;
        const isEnd = isWin || nextGuesses.length >= MAX_GUESSES;

        // Streak only advances on a day you actually solved, and only once --
        // keyed on lastSolvedDay so replaying can't inflate it.
        let nextStreak = streak;
        let nextLast = lastSolvedDay;
        if (isWin && lastSolvedDay !== today.dayKey) {
            nextStreak = streak + 1;
            nextLast = today.dayKey;
        }

        setGuesses(nextGuesses);
        setCurrent("");
        if (isEnd) {
            setDone(true);
            setSolved(isWin);
            setStreak(nextStreak);
            setLastSolvedDay(nextLast);
            if (!isWin) say(today.word.toUpperCase());
        }
        persist({
            day: today.dayKey,
            guesses: nextGuesses,
            done: isEnd,
            solved: isWin,
            streak: nextStreak,
            lastSolvedDay: nextLast,
            posted: false,
        });

        // Round over -> straight to the board.
        if (isEnd && !posted) {
            postResult({ guesses: nextGuesses.length, solved: isWin, streak: nextStreak });
        }
    }, [current, done, guesses, lastSolvedDay, persist, posted, postResult, say, streak, today.dayKey, today.word]);

    const typeLetter = useCallback((c: string) => {
        if (done) return;
        setCurrent((cur) => (cur.length >= LEN ? cur : cur + c));
    }, [done]);

    const backspace = useCallback(() => {
        if (done) return;
        setCurrent((cur) => cur.slice(0, -1));
    }, [done]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); return; }
            if (e.key === "Backspace") { e.preventDefault(); backspace(); return; }
            if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
                e.preventDefault();
                typeLetter(e.key.toLowerCase());
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [submit, backspace, typeLetter]);


    // ── derived view state ───────────────────────────────────────────────────
    const rows: { letters: string; marks: Mark[] | null }[] = [];
    for (let i = 0; i < MAX_GUESSES; i++) {
        if (i < guesses.length) rows.push({ letters: guesses[i], marks: scoreGuess(guesses[i], today.word) });
        else if (i === guesses.length && !done) rows.push({ letters: current, marks: null });
        else rows.push({ letters: "", marks: null });
    }

    // Best-known state per letter for the on-screen keyboard, correct winning
    // over present winning over absent.
    const keyState: Record<string, Mark> = {};
    for (let g = 0; g < guesses.length; g++) {
        const marks = scoreGuess(guesses[g], today.word);
        for (let i = 0; i < LEN; i++) {
            const c = guesses[g].charAt(i);
            const m = marks[i];
            if (m === "correct" || (m === "present" && keyState[c] !== "correct") || !keyState[c]) {
                if (!(keyState[c] === "correct" && m !== "correct") && !(keyState[c] === "present" && m === "absent")) {
                    keyState[c] = m;
                }
            }
        }
    }

    return (
        <ArcadeFrame
            title="WORDMARK"
            // States plainly that finishing posts to the board, so an
            // automatic post is never a surprise to whoever's playing.
            hint={`Six guesses · ${today.dayKey}${streak > 0 ? ` · streak ${streak}` : ""} · result posts to the team board`}
            keyCodes={KEY_CODES}
            fluid
            onClose={onClose}
        >
            <div className="dw-wrap">
                <div className="dw-board">
                    {rows.map((r, i) => (
                        <div className={"dw-row" + (reject && i === guesses.length && !done ? " dw-row--reject" : "")} key={i}>
                            {[0, 1, 2, 3, 4].map((j) => {
                                const ch = r.letters.charAt(j);
                                const mark = r.marks ? r.marks[j] : null;
                                const cls = "dw-tile" + (mark ? " dw-tile--" + mark : ch ? " dw-tile--filled" : "");
                                return <div className={cls} key={j}>{ch.toUpperCase()}</div>;
                            })}
                        </div>
                    ))}
                </div>

                {flash && <div className="dw-flash">{flash}</div>}

                {done && (
                    <div className="dw-result">
                        <span className={solved ? "dw-win" : "dw-lose"}>
                            {solved ? `Got it in ${guesses.length}` : `It was ${today.word.toUpperCase()}`}
                        </span>
                        {posted && <span className="dw-posted">on the board</span>}
                    </div>
                )}
                {postNote && <div className="dw-note">{postNote}</div>}

                {/* On-screen keyboard. Not just a nicety: AE's key delivery to a
                    CEP panel is the flakiest part of this whole area (see
                    ArcadeFrame.tsx), so clicking must always work even if
                    keystrokes never arrive. */}
                <div className="dw-keys">
                    {KEY_ROWS.map((row, ri) => (
                        <div className="dw-keyrow" key={ri}>
                            {ri === 2 && (
                                <button className="dw-key dw-key--wide" onClick={submit}>Enter</button>
                            )}
                            {row.split("").map((c) => (
                                <button
                                    key={c}
                                    className={"dw-key" + (keyState[c] ? " dw-key--" + keyState[c] : "")}
                                    onClick={() => typeLetter(c)}
                                >
                                    {c.toUpperCase()}
                                </button>
                            ))}
                            {ri === 2 && (
                                <button className="dw-key dw-key--wide" onClick={backspace}>Del</button>
                            )}
                        </div>
                    ))}
                </div>

                {board && board.length > 0 && (() => {
                    const todayRows = board.filter((r) => r.day === today.dayKey);
                    const standings = standingsFrom(board);
                    const todayFor = (member: string) => todayRows.filter((r) => r.member === member)[0];
                    return (
                        <div className="dw-board-list">
                            <div className="dw-board-head">
                                <Users size={12} /> Leaderboard
                                <span className="dw-board-window">last 30 days</span>
                            </div>
                            <div className="dw-lb-row dw-lb-row--head">
                                <span className="dw-lb-name">Member</span>
                                <span className="dw-lb-cell">Today</span>
                                <span className="dw-lb-cell">Streak</span>
                                <span className="dw-lb-cell">Best</span>
                                <span className="dw-lb-cell">Guesses</span>
                            </div>
                            {standings.map((s) => {
                                const t = todayFor(s.member);
                                return (
                                    <div className="dw-lb-row" key={s.member}>
                                        <span className="dw-lb-name">{s.member}</span>
                                        <span className="dw-lb-cell">
                                            {t ? (t.solved ? `${t.guesses}/6` : "✗") : "–"}
                                        </span>
                                        <span className="dw-lb-cell dw-lb-streak">{s.streak || "–"}</span>
                                        <span className="dw-lb-cell">{s.best ? `${s.best}/6` : "–"}</span>
                                        <span className="dw-lb-cell">{s.totalGuesses || "–"}</span>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </div>
        </ArcadeFrame>
    );
};

export default DailyWord;
