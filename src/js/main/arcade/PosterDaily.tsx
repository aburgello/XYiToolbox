// "ONE SHEET" -- one film poster a day, pixelated to bits. Guess the film.
// (A one-sheet is the trade term for a film poster, and 1 Sheet is also one of
// the studio's own DOOH size presets -- the joke lands both ways.)
//
// THE RENAME IS DISPLAY-ONLY, deliberately, same call the XYTools rename made:
// the file is still PosterDaily.tsx, the game id is still "poster", and the
// shared board is still shared-postergame.json. That id is the key every
// already-posted row on the NAS is filed under -- renaming it would orphan the
// board to save nothing.
//
// The fourth arcade machine, and the second daily one. Same free-sync trick as
// WORDMARK (see DailyWord.tsx): the answer is derived from the DATE, so every
// machine in the studio independently lands on the same film with no server,
// no clock sync and no coordination. The only difference is where the answer
// list comes from -- words ship as a curated array, films ship as a GENERATED
// one (arcade/films.ts, from scripts/make-poster-films.cjs). That list is
// committed rather than fetched precisely so the day's answer stays a pure
// function of the date: TMDB's `discover` ordering drifts as vote counts move,
// so deriving the film from a live query could hand two people different films
// on the same day and make the board meaningless.
//
// THE REVEAL IS PIXELATION, coarse to fine. Six stages: the poster starts as
// about half a dozen blocks of colour and doubles in resolution with each
// wrong guess (or skip) until it's readable. Drawn on a canvas rather than
// with a CSS filter because CSS has no pixelate -- an offscreen canvas the
// size of the block grid, drawn back up with smoothing OFF, is the whole
// trick. NOTE we only ever DRAW the cross-origin poster, never read pixels
// back, so the canvas being tainted doesn't matter.
//
// HINTS COST, AND THE BOARD SAYS SO. Three of them (facts -> tagline ->
// premise), bought in any order, each recorded. That's the point of this
// game's leaderboard: solving it in two with the premise handed to you is not
// the same round as solving it in two cold, so the board carries guesses AND
// hints rather than flattening them into one number. Deliberately NO
// director/cast hint -- for a film anyone knows that isn't a hint, it's the
// answer.
//
// THE PREMISE HINT IS REDACTED, and that's the whole hint. TMDB's raw
// `overview` is a synopsis, not a nudge: it names the protagonist, the place
// and usually the title itself, so buying it ended the round rather than
// narrowing it. `redactPlot` cuts it to the opening sentence or two and masks
// every proper noun (see the function). Tune the redactor if it over-masks;
// don't hand the raw `overview` back to the hint -- if a hint is worth a
// column on the board, the player should still be guessing after it.
//
// EVERYTHING DEGRADES QUIETLY, same as every other game here: no CEP bridge
// (browser preview), no Team Folder, or an unmounted NAS are NORMAL states.
// The game stays fully playable and just doesn't persist or show a board. The
// one exception is TMDB being unreachable, which IS surfaced -- without it
// there's no poster to show and no way to search for a guess.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, SkipForward, Users } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import ArcadeFrame from "./ArcadeFrame";
import { FILMS } from "./films";
import { getFilmFacts, posterUrl, searchMovies, type FilmFacts, type MovieSummary } from "./cine/tmdb";
import "./PosterDaily.scss";

const MAX_GUESSES = 6;

/**
 * Block columns per stage, indexed by guesses used.
 *
 * Roughly doubling: the early jumps have to be big or the first three stages
 * all look like the same soup, and the last two have to be close to legible or
 * a wrong sixth guess feels arbitrary rather than earned.
 */
const STAGE_COLUMNS = [7, 12, 20, 34, 56, 90];

// Poster aspect is 2:3. The canvas is drawn at this size and CSS-scaled, so it
// stays crisp on the block edges regardless of panel width.
const CANVAS_W = 320;
const CANVAS_H = 480;

// Letters, digits, space, Enter, Backspace -- the game is played through a
// text field, so it needs the lot claimed back from AE.
const KEY_CODES = (() => {
    const out = [13, 8, 32];
    for (let c = 48; c <= 57; c++) out.push(c);
    for (let c = 65; c <= 90; c++) out.push(c);
    return out;
})();

type HintId = "facts" | "tagline" | "plot";

interface HintDef {
    id: HintId;
    label: string;
    /** null = this film has nothing to show here, so the hint is free/disabled. */
    body: (f: FilmFacts) => string | null;
}

const MASK = "███";

/**
 * Capitalised words that are NOT names, so masking them would only make the
 * sentence unreadable without hiding anything. Sentence-initial words are
 * already spared by position, so this is only about mid-sentence ones.
 */
const NOT_A_NAME: Record<string, number> = {
    I: 1, A: 1, An: 1, The: 1, But: 1, And: 1, When: 1, After: 1, While: 1, As: 1,
    In: 1, On: 1, At: 1, To: 1, Of: 1, For: 1, His: 1, Her: 1, Their: 1, It: 1,
    Monday: 1, Tuesday: 1, Wednesday: 1, Thursday: 1, Friday: 1, Saturday: 1, Sunday: 1,
    Christmas: 1, Halloween: 1,
};

/** Title words too generic to be worth masking on their own. */
const TITLE_NOISE: Record<string, number> = {
    the: 1, a: 1, an: 1, of: 1, and: 1, or: 1, in: 1, on: 1, to: 1, for: 1,
    from: 1, at: 1, by: 1, with: 1, part: 1, ii: 1, iii: 1, iv: 1,
};

/** Enough prose to be a hint; a six-word opener usually isn't. */
const PLOT_MIN_CHARS = 90;
const PLOT_MAX_SENTENCES = 2;

/**
 * Turn TMDB's synopsis into a premise.
 *
 * Two separate cuts, both needed:
 *
 * 1. LENGTH. The raw blurb walks the entire plot including the turn. One
 *    sentence is the hint; a second is only added when the first is too short
 *    to say anything.
 * 2. PROPER NOUNS. Every mid-sentence capitalised word is masked, plus every
 *    non-trivial word of the title wherever it appears (titles are frequently
 *    lower-case inside the blurb, e.g. "the matrix has you"). This is the cut
 *    that matters -- "Rick" or "Gotham" is the answer, not a clue.
 *
 * Masking is deliberately blunt: a place or an organisation lands in the mask
 * too. That's the intended trade -- an over-masked line is still a playable
 * hint, an under-masked one is the answer.
 */
export const redactPlot = (overview: string, title: string): string => {
    if (!overview) return "";

    // Sentence split on terminal punctuation followed by a space. An initial
    // ("Dr. Ryan") splits early; harmless, because a too-short first sentence
    // just pulls the next one in.
    const parts = overview.split(/(?<=[.!?])\s+/);
    let text = "";
    for (let i = 0; i < parts.length && i < PLOT_MAX_SENTENCES; i++) {
        text = text ? text + " " + parts[i] : parts[i];
        if (text.length >= PLOT_MIN_CHARS) break;
    }

    const titleWords: Record<string, number> = {};
    const rawTitleWords = title.toLowerCase().split(/[^a-z0-9']+/);
    for (let i = 0; i < rawTitleWords.length; i++) {
        const w = rawTitleWords[i];
        if (w.length >= 3 && !TITLE_NOISE[w]) titleWords[w] = 1;
    }

    let sentenceStart = true;
    const out = text.replace(/[A-Za-z][A-Za-z'’.-]*/g, (word, offset: number) => {
        const atStart = sentenceStart;
        sentenceStart = false;
        // The next word starts a sentence if this one ended with terminal
        // punctuation (checked on the ORIGINAL text, since the match itself may
        // swallow a trailing dot).
        const after = text.slice(offset + word.length, offset + word.length + 2);
        if (/^[.!?]/.test(after) || /[.!?]$/.test(word)) sentenceStart = true;

        const bare = word.replace(/[^A-Za-z'’]/g, "");
        if (!bare) return word;
        if (titleWords[bare.toLowerCase()]) return MASK;
        if (atStart) return word;
        if (NOT_A_NAME[bare]) return word;
        if (/^[A-Z]/.test(bare) && bare.length > 1) return MASK;
        return word;
    });

    // Collapse "███ ███ ███" runs -- three masks in a row read as noise, one
    // reads as a redacted name. Only spaces are eaten, never punctuation: the
    // comma after a masked place name is what keeps the rest of the sentence
    // parseable.
    return out.replace(new RegExp("(?:" + MASK + " )+" + MASK, "g"), MASK).replace(/\s+/g, " ").trim();
};

/** Vague to near-giveaway, top to bottom. */
const HINTS: HintDef[] = [
    {
        id: "facts",
        label: "Year, runtime & genre",
        body: (f) => {
            const bits: string[] = [];
            if (f.year) bits.push(f.year);
            if (f.runtime) bits.push(f.runtime + " min");
            if (f.genres.length) bits.push(f.genres.slice(0, 3).join(", "));
            return bits.length ? bits.join(" · ") : null;
        },
    },
    { id: "tagline", label: "Tagline", body: (f) => f.tagline || null },
    // Id stays "plot": it's persisted in saved state and counted on the shared
    // board, so renaming it would orphan every row already filed under it.
    { id: "plot", label: "Premise (names hidden)", body: (f) => redactPlot(f.overview, f.title) || null },
];

interface SavedState {
    day: string;
    /** TMDB ids of wrong guesses, so a reload can't re-offer a spent guess. */
    guessIds: number[];
    guessLabels: string[];
    /** Skips are guesses with no film attached. */
    skips: number;
    hints: HintId[];
    done: boolean;
    solved: boolean;
    streak: number;
    lastSolvedDay: string;
}

interface BoardRow {
    day: string;
    member: string;
    guesses: number;
    hints: number;
    solved: boolean;
    streak: number;
}

interface Standing {
    member: string;
    solved: number;
    played: number;
    best: number;        // fewest guesses on a solved day; 0 = never solved
    hints: number;       // total bought across the window
    streak: number;
    lastDay: string;
}

/**
 * Roll the per-day rows up per member.
 *
 * Streak is read off each member's MOST RECENT row rather than recomputed from
 * the window -- identical reasoning to the word board (DailyWord.tsx): a
 * streak is counted on the player's own machine, which knows which days they
 * actually played, whereas the board only sees the days they were at their
 * desk.
 */
export const standingsFrom = (rows: BoardRow[]): Standing[] => {
    const byMember: Record<string, Standing> = {};
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r.member) continue;
        let s = byMember[r.member];
        if (!s) {
            s = { member: r.member, solved: 0, played: 0, best: 0, hints: 0, streak: 0, lastDay: "" };
            byMember[r.member] = s;
        }
        s.played++;
        s.hints += r.hints || 0;
        if (r.solved) {
            s.solved++;
            if (!s.best || r.guesses < s.best) s.best = r.guesses;
        }
        if (r.day > s.lastDay) {
            s.lastDay = r.day;
            s.streak = r.streak || 0;
        }
    }
    const out: Standing[] = [];
    for (const k in byMember) if (byMember.hasOwnProperty(k)) out.push(byMember[k]);
    // Streak, then the cleanest single round, then fewest hints overall --
    // rewards turning up, then solving cold.
    out.sort((a, b) =>
        b.streak - a.streak ||
        (a.best || 99) - (b.best || 99) ||
        a.hints - b.hints
    );
    return out;
};

/**
 * The day key and that day's film.
 *
 * Day math and the stride are lifted straight from DailyWord's `puzzleForDay`
 * and for the same reasons: the LOCAL calendar date collapsed onto a UTC
 * timestamp, so a puzzle turns over at local midnight and a DST shift can't
 * produce a 23- or 25-hour day that skips or repeats a film; and a prime
 * stride coprime with the list length, so consecutive days land far apart in
 * the list while still visiting every film before any repeat (600 films here,
 * ~1.6 years).
 */
export const posterForDay = (d: Date) => {
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    const pad = (n: number) => (n < 10 ? "0" + n : String(n));
    const dayKey = y + "-" + pad(m + 1) + "-" + pad(day);

    const EPOCH = Date.UTC(2026, 0, 1);
    const dayNumber = Math.floor((Date.UTC(y, m, day) - EPOCH) / 86400000);
    const idx = (((dayNumber * 7919) % FILMS.length) + FILMS.length) % FILMS.length;
    return { dayKey, film: FILMS[idx] };
};

// Fallback store for browser preview (no CEP bridge): the game still plays, it
// just forgets on reload. Module scope so it survives the panel's known
// cold-start double-mount.
let memoryState: SavedState | null = null;

export const PosterDaily = ({ onClose }: { onClose: () => void }) => {
    const today = useRef(posterForDay(new Date())).current;
    const film = today.film;

    const [guessIds, setGuessIds] = useState<number[]>([]);
    const [guessLabels, setGuessLabels] = useState<string[]>([]);
    const [skips, setSkips] = useState(0);
    const [hints, setHints] = useState<HintId[]>([]);
    const [done, setDone] = useState(false);
    const [solved, setSolved] = useState(false);
    const [streak, setStreak] = useState(0);
    const [lastSolvedDay, setLastSolvedDay] = useState("");
    const [posted, setPosted] = useState(false);

    const [query, setQuery] = useState("");
    const [results, setResults] = useState<MovieSummary[]>([]);
    const [searching, setSearching] = useState(false);
    const [facts, setFacts] = useState<FilmFacts | null>(null);
    const [factsError, setFactsError] = useState<string | null>(null);
    const [posterError, setPosterError] = useState(false);
    const [board, setBoard] = useState<BoardRow[] | null>(null);
    const [postNote, setPostNote] = useState<string | null>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [imgReady, setImgReady] = useState(false);
    const postingRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const used = guessIds.length + skips;
    const left = MAX_GUESSES - used;

    // ── persistence (quiet on every failure) ─────────────────────────────────
    const persist = useCallback((s: SavedState) => {
        memoryState = s;
        evalTS("posterGameSaveState", JSON.stringify(s)).catch(() => undefined);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            let saved: SavedState | null = memoryState;
            try {
                const raw = await evalTS("posterGameLoadState");
                if (typeof raw === "string" && raw) saved = JSON.parse(raw) as SavedState;
            } catch (e) {
                /* no bridge / unreadable -- a fresh game is the right fallback */
            }
            if (cancelled || !saved) return;

            // The streak carries across days; the board itself only comes back
            // if the save is from today.
            setStreak(saved.streak || 0);
            setLastSolvedDay(saved.lastSolvedDay || "");
            if (saved.day === today.dayKey) {
                setGuessIds(saved.guessIds || []);
                setGuessLabels(saved.guessLabels || []);
                setSkips(saved.skips || 0);
                setHints(saved.hints || []);
                setDone(!!saved.done);
                setSolved(!!saved.solved);
            }
        })();
        return () => { cancelled = true; };
    }, [today.dayKey]);

    // ── the poster ───────────────────────────────────────────────────────────
    useEffect(() => {
        const img = new Image();
        img.onload = () => { imgRef.current = img; setImgReady(true); };
        img.onerror = () => setPosterError(true);
        img.src = posterUrl(film.p, "w500");
        return () => { img.onload = null; img.onerror = null; };
    }, [film.p]);

    // Redraw whenever the stage changes. The offscreen canvas is the pixelator:
    // draw the poster into a grid-sized canvas (so the browser averages each
    // block for us), then blow that back up with smoothing OFF.
    useEffect(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img || !imgReady) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        if (done) {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
            return;
        }

        const cols = STAGE_COLUMNS[Math.min(used, STAGE_COLUMNS.length - 1)];
        const rows = Math.round(cols * (CANVAS_H / CANVAS_W));
        const off = document.createElement("canvas");
        off.width = cols;
        off.height = rows;
        const octx = off.getContext("2d");
        if (!octx) return;
        octx.drawImage(img, 0, 0, cols, rows);

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, cols, rows, 0, 0, CANVAS_W, CANVAS_H);
    }, [imgReady, used, done]);

    // Facts back the hints, so they're fetched once up front rather than on
    // the click -- a hint that takes a second to arrive reads as broken.
    useEffect(() => {
        let cancelled = false;
        getFilmFacts(film.id)
            .then((f) => { if (!cancelled) setFacts(f); })
            .catch((e: Error) => { if (!cancelled) setFactsError(e.message || "TMDB is unreachable."); });
        return () => { cancelled = true; };
    }, [film.id]);

    // ── the board ────────────────────────────────────────────────────────────
    const refreshBoard = useCallback(async () => {
        try {
            const res = await evalTS("teamLoadPosterBoard");
            const r = res as { entries?: BoardRow[]; read?: boolean } | undefined;
            // `read === false` means the host could not read the shared file
            // (unmounted NAS, or AE busy mid-render). Keeping the board we
            // already have beats replacing it with an empty one -- that is
            // exactly how the arcade hub's standings went blank until the
            // panel was reopened. An older host has no flag, so undefined is
            // trusted.
            const entries = r && r.read !== false ? r.entries : undefined;
            if (entries) setBoard(entries);
        } catch (e) {
            /* no bridge / no team folder -- the board simply doesn't appear */
        }
    }, []);

    useEffect(() => { refreshBoard(); }, [refreshBoard]);

    // Posting is automatic once a round ends, and the hint line says so -- same
    // call (and same reasoning) as DAILY: a leaderboard nobody remembers to
    // post to is a dead leaderboard, so it's handled by being open about it
    // rather than by asking. An untagged machine still can't post; the host
    // refuses rather than guessing a name, and that surfaces as a quiet note.
    const postResult = useCallback(async (r: { guesses: number; hints: number; solved: boolean; streak: number }) => {
        if (postingRef.current) return;
        postingRef.current = true;
        try {
            const res = await evalTS("teamPostPosterResult", JSON.stringify({
                day: today.dayKey,
                member: "",              // filled in host-side from the machine tag
                guesses: r.solved ? r.guesses : 0,
                hints: r.hints,
                solved: r.solved,
                streak: r.streak,
                postedAt: "",
            }));
            if (res === undefined) throw new Error("no bridge");
            const out = res as { success?: boolean; error?: string };
            if (out.success) {
                setPosted(true);
                setPostNote(null);
                refreshBoard();
                // Also the arcade hub's own cross-game board, which counts one
                // row per solved day. The score is a "cleanliness" number
                // (higher is better) so the hub's existing max-based detail
                // column means something: 6 = first guess, no hints.
                if (r.solved) {
                    const clean = Math.max(1, MAX_GUESSES + 1 - r.guesses - r.hints);
                    evalTS("teamArcadePost", "poster", clean, "").catch(() => undefined);
                }
            } else {
                setPostNote(out.error || "Couldn't post to the team board.");
            }
        } catch (e) {
            // No bridge / no team folder: normal states, not errors.
            setPostNote(null);
        } finally {
            postingRef.current = false;
        }
    }, [refreshBoard, today.dayKey]);

    // ── play ─────────────────────────────────────────────────────────────────
    const finish = useCallback((won: boolean, nextIds: number[], nextLabels: string[], nextSkips: number) => {
        // Streak only advances on a day actually solved, and only once -- keyed
        // on lastSolvedDay so replaying can't inflate it.
        let nextStreak = streak;
        let nextLast = lastSolvedDay;
        if (won && lastSolvedDay !== today.dayKey) {
            nextStreak = streak + 1;
            nextLast = today.dayKey;
        }
        setDone(true);
        setSolved(won);
        setStreak(nextStreak);
        setLastSolvedDay(nextLast);
        persist({
            day: today.dayKey,
            guessIds: nextIds,
            guessLabels: nextLabels,
            skips: nextSkips,
            hints,
            done: true,
            solved: won,
            streak: nextStreak,
            lastSolvedDay: nextLast,
        });
        postResult({
            // The winning guess itself counts, and it isn't in nextIds -- a win
            // on the third attempt posts 3, not 2.
            guesses: won ? nextIds.length + nextSkips + 1 : MAX_GUESSES,
            hints: hints.length,
            solved: won,
            streak: nextStreak,
        });
    }, [hints, lastSolvedDay, persist, postResult, streak, today.dayKey]);

    const guess = useCallback((m: MovieSummary) => {
        if (done) return;
        setQuery("");
        setResults([]);
        if (m.id === film.id) {
            finish(true, guessIds, guessLabels, skips);
            return;
        }
        const nextIds = [...guessIds, m.id];
        const nextLabels = [...guessLabels, m.title + (m.year ? ` (${m.year})` : "")];
        setGuessIds(nextIds);
        setGuessLabels(nextLabels);
        if (nextIds.length + skips >= MAX_GUESSES) {
            finish(false, nextIds, nextLabels, skips);
            return;
        }
        persist({
            day: today.dayKey, guessIds: nextIds, guessLabels: nextLabels, skips,
            hints, done: false, solved: false, streak, lastSolvedDay,
        });
        setTimeout(() => inputRef.current?.focus(), 0);
    }, [done, film.id, finish, guessIds, guessLabels, hints, lastSolvedDay, persist, skips, streak, today.dayKey]);

    const skip = useCallback(() => {
        if (done) return;
        const nextSkips = skips + 1;
        setSkips(nextSkips);
        setQuery("");
        setResults([]);
        if (guessIds.length + nextSkips >= MAX_GUESSES) {
            finish(false, guessIds, guessLabels, nextSkips);
            return;
        }
        persist({
            day: today.dayKey, guessIds, guessLabels, skips: nextSkips,
            hints, done: false, solved: false, streak, lastSolvedDay,
        });
    }, [done, finish, guessIds, guessLabels, hints, lastSolvedDay, persist, skips, streak, today.dayKey]);

    const buyHint = useCallback((id: HintId) => {
        // Nothing can be bought after the round ends -- the result (including
        // the hint count) has already gone to the board, and letting the tally
        // move afterwards would make the board disagree with the screen.
        if (done || hints.indexOf(id) !== -1) return;
        const next = [...hints, id];
        setHints(next);
        persist({
            day: today.dayKey, guessIds, guessLabels, skips,
            hints: next, done, solved, streak, lastSolvedDay,
        });
    }, [done, guessIds, guessLabels, hints, lastSolvedDay, persist, skips, solved, streak, today.dayKey]);

    // Debounced search. The in-flight query is tracked so a slow response for
    // an older query can't overwrite the results for a newer one.
    useEffect(() => {
        const q = query.trim();
        if (q.length < 2 || done) { setResults([]); setSearching(false); return; }
        setSearching(true);
        let cancelled = false;
        const id = setTimeout(() => {
            searchMovies(q)
                .then((r) => { if (!cancelled) setResults(r); })
                .catch(() => { if (!cancelled) setResults([]); })
                .then(() => { if (!cancelled) setSearching(false); });
        }, 260);
        return () => { cancelled = true; clearTimeout(id); };
    }, [query, done]);

    const guessedAlready = useCallback((id: number) => guessIds.indexOf(id) !== -1, [guessIds]);

    // ── render ───────────────────────────────────────────────────────────────
    const todayRows = useMemo(
        () => (board || []).filter((r) => r.day === today.dayKey),
        [board, today.dayKey]
    );
    const standings = useMemo(() => standingsFrom(board || []), [board]);

    return (
        <ArcadeFrame
            title="ONE SHEET"
            hint={`Six guesses · ${today.dayKey}${streak > 0 ? ` · streak ${streak}` : ""} · result posts to the team board`}
            keyCodes={KEY_CODES}
            fluid
            onClose={onClose}
        >
            <div className="pd-wrap">
                <div className="pd-main">
                    <div className="pd-stage">
                        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="pd-canvas" />
                        {!imgReady && !posterError && (
                            <div className="pd-loading"><Loader2 size={14} className="spin" /> Loading poster…</div>
                        )}
                        {posterError && (
                            <div className="pd-loading">Couldn't load the poster (is the network up?).</div>
                        )}
                        {!done && (
                            <div className="pd-pips" title={`${left} guess${left === 1 ? "" : "es"} left`}>
                                {Array.from({ length: MAX_GUESSES }).map((_, i) => (
                                    <span key={i} className={"pd-pip" + (i < used ? " pd-pip--spent" : "")} />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="pd-play">
                        {done ? (
                            <div className="pd-result">
                                <span className={solved ? "pd-win" : "pd-lose"}>
                                    {solved ? `Got it in ${used + 1}` : "Out of guesses"}
                                </span>
                                <strong className="pd-answer">{film.t} <em>({film.y})</em></strong>
                                <span className="pd-tally">
                                    {hints.length ? `${hints.length} hint${hints.length === 1 ? "" : "s"} used` : "no hints"}
                                    {posted ? " · on the board" : ""}
                                </span>
                            </div>
                        ) : (
                            <>
                                <div className="pd-search">
                                    <Search size={13} className="pd-search-icon" />
                                    <input
                                        ref={inputRef}
                                        className="pd-input"
                                        placeholder="Name the film…"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                    {searching && <Loader2 size={13} className="spin pd-search-spin" />}
                                    <button className="pd-skip" onClick={skip} title="Burn a guess to reveal more">
                                        <SkipForward size={12} /> Skip
                                    </button>
                                </div>

                                {results.length > 0 && (
                                    <div className="pd-results">
                                        {results.map((m) => {
                                            const spent = guessedAlready(m.id);
                                            return (
                                                <button
                                                    key={m.id}
                                                    className={"pd-result-row" + (spent ? " pd-result-row--spent" : "")}
                                                    disabled={spent}
                                                    onClick={() => guess(m)}
                                                    title={spent ? "Already guessed" : undefined}
                                                >
                                                    {/* NO POSTER THUMBNAIL HERE, deliberately. The
                                                        search list used to show one per result, which
                                                        handed the player the answer: type a hunch, and
                                                        a 24px thumb of the same artwork sitting on
                                                        screen next to the pixelated one confirms it
                                                        without spending a guess. Titles only. */}
                                                    <span className="pd-result-title">{m.title}</span>
                                                    <span className="pd-result-year">{m.year}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}

                        {guessLabels.length > 0 && (
                            <div className="pd-guesses">
                                {guessLabels.map((g, i) => <span className="pd-guess" key={i}>{g}</span>)}
                                {skips > 0 && <span className="pd-guess pd-guess--skip">{skips} skipped</span>}
                            </div>
                        )}

                        <div className="pd-hints">
                            <div className="pd-hints-head">
                                Hints
                                <span className="pd-hints-note">
                                    {hints.length
                                        ? `${hints.length} used — the board sees this`
                                        : "each one is recorded on the board"}
                                </span>
                            </div>
                            {HINTS.map((h) => {
                                const open = hints.indexOf(h.id) !== -1;
                                const body = facts ? h.body(facts) : null;
                                // A film with no tagline has nothing to sell, so
                                // the button says so and stays unbuyable rather
                                // than charging for an empty reveal.
                                const empty = !!facts && body === null;
                                if (open) {
                                    return (
                                        <div className="pd-hint pd-hint--open" key={h.id}>
                                            <span className="pd-hint-label">{h.label}</span>
                                            <span className="pd-hint-body">{body || "—"}</span>
                                        </div>
                                    );
                                }
                                return (
                                    <button
                                        className="pd-hint"
                                        key={h.id}
                                        disabled={!facts || empty || done}
                                        onClick={() => buyHint(h.id)}
                                    >
                                        <span className="pd-hint-label">{h.label}</span>
                                        <span className="pd-hint-cost">
                                            {done ? "not used"
                                                : !facts ? (factsError ? "unavailable" : "loading…")
                                                : empty ? "none for this film"
                                                : "reveal"}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {postNote && <div className="pd-note">{postNote}</div>}
                    </div>
                </div>

                {board && board.length > 0 && (
                    <div className="pd-board">
                        <div className="pd-board-head">
                            <Users size={12} /> Leaderboard
                            <span className="pd-board-window">last 30 days</span>
                        </div>
                        <div className="pd-lb-row pd-lb-row--head">
                            <span className="pd-lb-name">Member</span>
                            <span className="pd-lb-cell">Today</span>
                            <span className="pd-lb-cell">Streak</span>
                            <span className="pd-lb-cell">Best</span>
                            <span className="pd-lb-cell">Hints</span>
                        </div>
                        {standings.map((s) => {
                            const t = todayRows.filter((r) => r.member === s.member)[0];
                            return (
                                <div className="pd-lb-row" key={s.member}>
                                    <span className="pd-lb-name">{s.member}</span>
                                    <span className="pd-lb-cell">
                                        {t ? (t.solved ? `${t.guesses}/6${t.hints ? ` +${t.hints}` : ""}` : "✗") : "–"}
                                    </span>
                                    <span className="pd-lb-cell pd-lb-streak">{s.streak || "–"}</span>
                                    <span className="pd-lb-cell">{s.best ? `${s.best}/6` : "–"}</span>
                                    <span className="pd-lb-cell">{s.hints || "–"}</span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* TMDB's terms require the attribution -- keep it. */}
                <div className="pd-credit">Film data and posters from TMDB.</div>
            </div>
        </ArcadeFrame>
    );
};

export default PosterDaily;
