// OFF BY A PIXEL -- the QC drill. Two versions of the same DOOH layout, one
// thing wrong in the right-hand one. Click it.
//
// WHY THERE ARE NO PHOTOGRAPHS IN HERE. The first shape of this game was "spot
// the swap": a real master frame beside its localised counterpart. That fails
// twice over. The differences between real territories aren't subtle -- every
// line of copy changed, the pack shot changed -- so it's a "which language is
// this" test, solved instantly. And a frame game needs a FRESH PAIR EVERY DAY or
// it's memorised, which means somebody hand-curating client artwork into a game
// forever. One Sheet gets away with a static list because film data is public;
// studio masters are not.
//
// So the board is DRAWN, from the day's seed, and the fault is applied
// programmatically. That buys three things the photo version couldn't have:
// infinite content with no curation, difficulty as a NUMBER (round one is off by
// 12px, round five by 2), and exact scoring -- we know precisely where the fault
// is, so a click is right or wrong with no judgement call.
//
// It also stops being a puzzle and starts being the job. Spotting a 3px
// misalignment on a six-sheet is what the afternoon is actually made of.
//
// REPLAY IS GUARDED BY THE SHARED BOARD, not by a saved state file. A daily game
// that can be closed and reopened for a better score is a leaderboard of who
// quit the most. Rather than adding another pair of ExtendScript state
// functions, the mount reads `teamArcadeScores` -- which the hub already uses --
// and treats "a row under my name stamped today" as done. That also gets
// cross-machine right for free: play it on the laptop, it's played.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evalTS } from "../../lib/utils/bolt";
import ArcadeFrame from "./ArcadeFrame";

/** Internal canvas pixels. 8:5, matching the frame's stage box. */
const W = 960;
const H = 600;

const ROUNDS = 5;
const ROUND_SECONDS = 25;
const POINTS_PER_ROUND = 20;
const WRONG_CLICK_COST = 3;

/** How far the fault is pushed, per round. The whole difficulty curve. */
export const OFFSETS = [12, 8, 5, 3, 2];
/** Channel delta for a colour fault, per round. */
const TINTS = [20, 14, 9, 6, 4];

// --- deterministic randomness ----------------------------------------------
// Everyone gets the same five boards on the same day, so the score means
// something. mulberry32: small, fast, and good enough that consecutive seeds
// don't produce visibly similar layouts.
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const puzzleForDay = (d: Date): { dayKey: string; seed: number } => {
    const pad = (n: number) => (n < 10 ? "0" + n : String(n));
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    const dayKey = y + "-" + pad(m + 1) + "-" + pad(day);
    // Same epoch and prime as Wordmark and One Sheet, so the three dailies roll
    // over together at local midnight.
    const EPOCH = Date.UTC(2026, 0, 1);
    const dayNumber = Math.floor((Date.UTC(y, m, day) - EPOCH) / 86400000);
    return { dayKey, seed: dayNumber * 7919 + 104729 };
};

// --- the layout -------------------------------------------------------------
type ElemKind = "logo" | "head" | "pack" | "legal" | "rule";

interface Elem {
    id: string;
    kind: ElemKind;
    x: number;
    y: number;
    w: number;
    h: number;
    fill: string;
    /** Rounded ends on the copy bars, square on structure. */
    round?: number;
}

/** Panel box in stage coordinates. */
export const PANEL = { w: 440, h: 552, y: 24, gap: 32 };
export const PANEL_X = [24, 24 + PANEL.w + PANEL.gap];
/** The safe margin every element is supposed to sit inside. */
export const SAFE = 30;

// Deliberately not the panel's own accent palette -- this is meant to read as
// artwork on a screen, not as more UI. Muted enough that a 4-channel tint shift
// is genuinely hard to see, which is the entire point of the colour fault.
export const PALETTES = [
    { bg: "#152029", ink: "#e6dfd2", accent: "#d98c4a", mute: "#5c6b76" },
    { bg: "#1e1a24", ink: "#efe7f2", accent: "#7d6bd4", mute: "#6a6076" },
    { bg: "#11211c", ink: "#e2eee6", accent: "#4fa87b", mute: "#576b62" },
    { bg: "#241a1a", ink: "#f2e6e2", accent: "#c8563f", mute: "#75605c" },
    { bg: "#1a1f2b", ink: "#e4e9f2", accent: "#4a86d9", mute: "#5b6577" },
    { bg: "#20221a", ink: "#eef0e2", accent: "#a8b544", mute: "#666b57" },
    { bg: "#101d24", ink: "#dfeaf0", accent: "#3fa8b5", mute: "#4f6670" },
    { bg: "#231d15", ink: "#f0e8da", accent: "#d4a534", mute: "#6f6350" },
    { bg: "#1c1622", ink: "#ece2f0", accent: "#b5559e", mute: "#655772" },
    { bg: "#151a1a", ink: "#e2eaea", accent: "#7f8c96", mute: "#4e5a5c" },
    { bg: "#221619", ink: "#f2e4e8", accent: "#d9557a", mute: "#725560" },
    { bg: "#161f18", ink: "#e4efe4", accent: "#67b04a", mute: "#54655a" },
    { bg: "#1d1c26", ink: "#e8e6f2", accent: "#5f6bd4", mute: "#5c5c75" },
];

// FOUR COMPOSITIONS, not one. The geometry alone never repeats (1,823 distinct
// boards in a year of play), but with a single arrangement it all LOOKS the same
// -- logo top-left, three bars, centred pack shot, every single day. Varying the
// arrangement is what stops it reading as one poster in different colours, and
// it also changes what a shift fault looks like: an element that is centred
// breaks differently from one hung off a left margin.
type Composition = "poster" | "banner" | "split" | "centred";
const COMPOSITIONS: Composition[] = ["poster", "banner", "split", "centred"];

export function makeLayout(rand: () => number): { elems: Elem[]; pal: typeof PALETTES[0] } {
    const pal = PALETTES[Math.floor(rand() * PALETTES.length)];
    const comp = COMPOSITIONS[Math.floor(rand() * COMPOSITIONS.length)];
    const elems: Elem[] = [];
    const inner = PANEL.w - SAFE * 2;

    const lead = 30 + Math.floor(rand() * 6);
    const logoW = 74 + Math.floor(rand() * 30);
    const packH = 168 + Math.floor(rand() * 40);

    if (comp === "split") {
        // Copy in a narrow left column, pack shot filling the right.
        const colW = Math.round(inner * 0.44);
        const packW = inner - colW - 16;
        elems.push({ id: "logo", kind: "logo", x: SAFE, y: SAFE, w: Math.min(logoW, colW), h: 24, fill: pal.ink, round: 3 });
        const headTop = SAFE + 74;
        const widths = [1, 0.82, 0.58];
        for (let i = 0; i < 3; i++) {
            elems.push({
                id: "head" + i, kind: "head",
                x: SAFE, y: headTop + i * lead,
                w: Math.round(colW * widths[i]), h: 17,
                fill: i === 0 ? pal.accent : pal.ink, round: 2,
            });
        }
        elems.push({
            id: "pack", kind: "pack",
            x: SAFE + colW + 16, y: SAFE + 74,
            w: packW, h: packH + 40,
            fill: pal.mute, round: 4,
        });
    } else if (comp === "banner") {
        // Pack shot up top, copy hung underneath it.
        const packW = inner;
        elems.push({ id: "pack", kind: "pack", x: SAFE, y: SAFE, w: packW, h: packH, fill: pal.mute, round: 4 });
        elems.push({ id: "logo", kind: "logo", x: SAFE, y: SAFE + packH + 22, w: logoW, h: 24, fill: pal.ink, round: 3 });
        const headTop = SAFE + packH + 72;
        const widths = [0.92, 0.74, 0.52];
        for (let i = 0; i < 3; i++) {
            elems.push({
                id: "head" + i, kind: "head",
                x: SAFE, y: headTop + i * lead,
                w: Math.round(inner * widths[i]), h: 17,
                fill: i === 0 ? pal.accent : pal.ink, round: 2,
            });
        }
    } else if (comp === "centred") {
        // Everything on a centre axis -- a shift fault reads as a broken axis
        // here rather than as a broken left margin.
        elems.push({
            id: "logo", kind: "logo",
            x: SAFE + Math.round((inner - logoW) / 2), y: SAFE,
            w: logoW, h: 24, fill: pal.ink, round: 3,
        });
        const headTop = SAFE + 74;
        const widths = [0.86, 0.66, 0.44];
        for (let i = 0; i < 3; i++) {
            const w = Math.round(inner * widths[i]);
            elems.push({
                id: "head" + i, kind: "head",
                x: SAFE + Math.round((inner - w) / 2), y: headTop + i * lead,
                w, h: 17,
                fill: i === 0 ? pal.accent : pal.ink, round: 2,
            });
        }
        const packW = Math.round(inner * (0.62 + rand() * 0.16));
        elems.push({
            id: "pack", kind: "pack",
            x: SAFE + Math.round((inner - packW) / 2),
            y: headTop + 3 * lead + 34,
            w: packW, h: packH, fill: pal.mute, round: 4,
        });
    } else {
        // "poster" -- logo top-left, copy on the left margin, pack shot centred.
        elems.push({ id: "logo", kind: "logo", x: SAFE, y: SAFE, w: logoW, h: 24, fill: pal.ink, round: 3 });
        const headTop = SAFE + 74;
        const widths = [0.92, 0.74, 0.52];
        for (let i = 0; i < 3; i++) {
            elems.push({
                id: "head" + i, kind: "head",
                x: SAFE, y: headTop + i * lead,
                w: Math.round(inner * widths[i]), h: 17,
                fill: i === 0 ? pal.accent : pal.ink, round: 2,
            });
        }
        const packW = Math.round(inner * (0.62 + rand() * 0.16));
        elems.push({
            id: "pack", kind: "pack",
            x: SAFE + Math.round((inner - packW) / 2),
            y: headTop + 3 * lead + 34,
            w: packW, h: packH, fill: pal.mute, round: 4,
        });
    }

    // A full-width rule above the legal -- the element a size fault is most
    // visible on, since both its ends are against the safe margin.
    elems.push({
        id: "rule", kind: "rule",
        x: SAFE, y: PANEL.h - SAFE - 54,
        w: inner, h: 3,
        fill: pal.accent,
    });

    // Legal strip: two thin bars at the bottom.
    for (let i = 0; i < 2; i++) {
        elems.push({
            id: "legal" + i, kind: "legal",
            x: SAFE, y: PANEL.h - SAFE - 38 + i * 14,
            w: Math.round(inner * (i === 0 ? 0.86 : 0.62)), h: 7,
            fill: pal.mute, round: 1,
        });
    }

    return { elems, pal };
}

// --- the fault --------------------------------------------------------------
type FaultKind = "shift" | "colour" | "size" | "safe" | "gap";

interface Fault {
    kind: FaultKind;
    /** Which element carries it -- the only correct click target. */
    id: string;
    /** Shown after the round, so a miss teaches something. */
    label: string;
}

function shiftChannel(hex: string, delta: number): string {
    const n = parseInt(hex.slice(1), 16);
    const cl = (v: number) => Math.max(0, Math.min(255, v));
    const r = cl(((n >> 16) & 255) + delta);
    const g = cl(((n >> 8) & 255) + Math.round(delta * 0.4));
    const b = cl((n & 255) - Math.round(delta * 0.6));
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

/**
 * Returns a COPY of the layout with exactly one thing wrong, plus which element
 * carries it. Never mutates the reference layout -- both panels render from the
 * same source and a mutation would silently "fix" the left-hand one too.
 */
export function applyFault(elems: Elem[], rand: () => number, round: number): { faulty: Elem[]; fault: Fault } {
    const off = OFFSETS[round];
    const tint = TINTS[round];
    const out = elems.map((e) => ({ ...e }));
    const pick = (ids: string[]) => ids[Math.floor(rand() * ids.length)];

    const kinds: FaultKind[] = ["shift", "colour", "size", "safe", "gap"];
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const at = (id: string) => out[out.findIndex((e) => e.id === id)];

    if (kind === "shift") {
        const id = pick(["head0", "head1", "head2", "logo", "pack"]);
        const e = at(id);
        // Horizontal on copy (breaks the left margin the eye is tracking),
        // vertical on blocks (breaks the leading).
        if (rand() < 0.5) e.x += rand() < 0.5 ? off : -off;
        else e.y += rand() < 0.5 ? off : -off;
        return { faulty: out, fault: { kind, id, label: `${off}px off its position` } };
    }

    if (kind === "colour") {
        const id = pick(["head0", "rule", "pack", "logo"]);
        const e = at(id);
        e.fill = shiftChannel(e.fill, rand() < 0.5 ? tint : -tint);
        return { faulty: out, fault: { kind, id, label: "off-brand colour" } };
    }

    if (kind === "size") {
        const id = pick(["rule", "head1", "legal0", "pack"]);
        const e = at(id);
        e.w += rand() < 0.5 ? off * 2 : -off * 2;
        return { faulty: out, fault: { kind, id, label: "wrong width" } };
    }

    if (kind === "safe") {
        // Pushed OUT past the safe margin rather than in, so it reads as a
        // breach rather than as inconsistent padding.
        const id = pick(["head0", "legal0", "logo", "rule"]);
        const e = at(id);
        e.x -= off;
        e.w += off;
        return { faulty: out, fault: { kind, id, label: "breaks the safe margin" } };
    }

    // gap: one headline bar's leading is wrong, so the block is unevenly spaced.
    const id = pick(["head1", "head2"]);
    const e = at(id);
    e.y += rand() < 0.5 ? off : -off;
    return { faulty: out, fault: { kind, id, label: "uneven leading" } };
}

// --- drawing ----------------------------------------------------------------
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    // Not ctx.roundRect() -- that is Chrome 99 and this panel targets 74.
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
    ctx.fill();
}

export function drawPanel(
    ctx: CanvasRenderingContext2D,
    ox: number,
    elems: Elem[],
    pal: typeof PALETTES[0],
    label: string,
    highlight: Elem | null
) {
    ctx.save();
    ctx.translate(ox, PANEL.y);

    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, PANEL.w, PANEL.h);

    for (const e of elems) {
        ctx.fillStyle = e.fill;
        if (e.round) roundRect(ctx, e.x, e.y, e.w, e.h, e.round);
        else ctx.fillRect(e.x, e.y, e.w, e.h);
    }

    // Revealed answer: a ring, drawn last so nothing paints over it.
    if (highlight) {
        ctx.strokeStyle = "#ff5f56";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(highlight.x - 7, highlight.y - 7, highlight.w + 14, highlight.h + 14);
        ctx.setLineDash([]);
    }

    ctx.restore();

    // Panel caption, outside the artwork.
    ctx.fillStyle = "#6f6f6f";
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.fillText(label, ox, PANEL.y + PANEL.h + 17);
}

const KEY_CODES: number[] = [];

interface RoundResult {
    points: number;
    wrong: number;
    seconds: number;
    fault: Fault;
}

export const OffByAPixel = ({ onClose }: { onClose: () => void }) => {
    const today = useMemo(() => puzzleForDay(new Date()), []);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [round, setRound] = useState(0);
    const [wrong, setWrong] = useState(0);
    const [results, setResults] = useState<RoundResult[]>([]);
    const [reveal, setReveal] = useState<"hit" | "miss" | null>(null);
    const [elapsed, setElapsed] = useState(0);
    /** Set once the day's five rounds are behind us, whether played or replayed. */
    const [done, setDone] = useState(false);
    /** A score already on the board for today: play on, but don't post again. */
    const [already, setAlready] = useState<number | null>(null);
    const [checking, setChecking] = useState(true);
    const [postNote, setPostNote] = useState<string | null>(null);
    const startedRef = useRef(Date.now());
    const postedRef = useRef(false);

    // The day's five boards, built once. Each round draws from the same stream
    // so the layout and its fault stay in step.
    const boards = useMemo(() => {
        const rand = mulberry32(today.seed);
        const out: { clean: Elem[]; faulty: Elem[]; pal: typeof PALETTES[0]; fault: Fault }[] = [];
        for (let i = 0; i < ROUNDS; i++) {
            const { elems, pal } = makeLayout(rand);
            const { faulty, fault } = applyFault(elems, rand, i);
            out.push({ clean: elems, faulty, pal, fault });
        }
        return out;
    }, [today.seed]);

    const board = boards[Math.min(round, ROUNDS - 1)];
    const total = results.reduce((n, r) => n + r.points, 0);

    // --- already played today? ---------------------------------------------
    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const res = await evalTS("teamArcadeScores");
                const r = res as unknown as { me?: string; scores?: { game: string; name: string; score: number; stamp: string }[] } | undefined;
                if (!live || !r?.me || !r.scores) return;
                const mine = r.scores.filter(
                    (s) => s.game === "pixel" && s.name === r.me && (s.stamp || "").slice(0, 10) === today.dayKey
                );
                if (mine.length) setAlready(mine.reduce((n, s) => Math.max(n, s.score), 0));
            } catch {
                /* no bridge or no team folder -- play anyway, post attempt will
                   fail quietly too. Never a blocker. */
            } finally {
                if (live) setChecking(false);
            }
        })();
        return () => { live = false; };
    }, [today.dayKey]);

    // --- the round clock ----------------------------------------------------
    useEffect(() => {
        if (done || reveal) return;
        startedRef.current = Date.now();
        setElapsed(0);
        const t = window.setInterval(() => {
            const secs = (Date.now() - startedRef.current) / 1000;
            setElapsed(secs);
        }, 100);
        return () => window.clearInterval(t);
    }, [round, done, reveal]);

    const finishRound = useCallback((hit: boolean, wrongClicks: number) => {
        const secs = Math.min(ROUND_SECONDS, (Date.now() - startedRef.current) / 1000);
        // Worth 20, losing a point every two seconds and three per wrong click.
        // Time has to count for something or a five-pixel fault is just a
        // staring contest that everybody eventually wins.
        const points = hit
            ? Math.max(0, POINTS_PER_ROUND - Math.floor(secs / 2) - wrongClicks * WRONG_CLICK_COST)
            : 0;
        setResults((prev) => [...prev, { points, wrong: wrongClicks, seconds: secs, fault: board.fault }]);
        setReveal(hit ? "hit" : "miss");
    }, [board]);

    // Time up.
    useEffect(() => {
        if (done || reveal) return;
        if (elapsed >= ROUND_SECONDS) finishRound(false, wrong);
    }, [elapsed, done, reveal, wrong, finishRound]);

    const next = useCallback(() => {
        setReveal(null);
        setWrong(0);
        if (round + 1 >= ROUNDS) setDone(true);
        else setRound((r) => r + 1);
    }, [round]);

    // --- post once, at the end ---------------------------------------------
    useEffect(() => {
        if (!done || postedRef.current || checking) return;
        postedRef.current = true;
        if (already !== null) {
            setPostNote(`Already played today — your ${already} stands.`);
            return;
        }
        evalTS("teamArcadePost", "pixel", total, "")
            .then(() => setPostNote(`${total} posted to the board.`))
            .catch(() => setPostNote("Couldn't reach the team folder — score not posted."));
    }, [done, total, already, checking]);

    // --- click handling -----------------------------------------------------
    const onCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (done || reveal) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        // The canvas is CSS-stretched over the stage, so a client coordinate has
        // to come back through that scale before it means anything in the
        // 960x600 space the layout lives in.
        const x = ((e.clientX - rect.left) / rect.width) * W;
        const y = ((e.clientY - rect.top) / rect.height) * H;

        // Only the right-hand panel is clickable -- the left is the reference.
        const local = { x: x - PANEL_X[1], y: y - PANEL.y };
        if (local.x < 0 || local.x > PANEL.w || local.y < 0 || local.y > PANEL.h) return;

        const target = board.faulty.find((el) => el.id === board.fault.id);
        if (!target) return;
        // Padded, because "I clicked the thing" shouldn't need pixel accuracy --
        // the game is about SEEING the fault, not about mouse precision.
        const pad = 14;
        const hit =
            local.x >= target.x - pad && local.x <= target.x + target.w + pad &&
            local.y >= target.y - pad && local.y <= target.y + target.h + pad;

        if (hit) finishRound(true, wrong);
        else setWrong((n) => n + 1);
    }, [board, done, reveal, wrong, finishRound]);

    // --- render -------------------------------------------------------------
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        ctx.fillStyle = "#0d0d0d";
        ctx.fillRect(0, 0, W, H);

        if (done) {
            ctx.fillStyle = "#e8c766";
            ctx.font = "600 34px ui-monospace, Menlo, monospace";
            ctx.textAlign = "center";
            ctx.fillText(`${total} / ${ROUNDS * POINTS_PER_ROUND}`, W / 2, H / 2 - 10);
            ctx.fillStyle = "#8a8a8a";
            ctx.font = "13px ui-monospace, Menlo, monospace";
            const found = results.filter((r) => r.points > 0).length;
            ctx.fillText(`${found} of ${ROUNDS} found`, W / 2, H / 2 + 22);
            ctx.textAlign = "left";
            return;
        }

        const showAnswer = reveal ? board.faulty.find((el) => el.id === board.fault.id) || null : null;
        drawPanel(ctx, PANEL_X[0], board.clean, board.pal, "APPROVED", null);
        drawPanel(ctx, PANEL_X[1], board.faulty, board.pal, "DELIVERED — click the fault", showAnswer);
    }, [board, done, reveal, results, total]);

    const secsLeft = Math.max(0, ROUND_SECONDS - elapsed);
    const last = results[results.length - 1];

    return (
        <ArcadeFrame
            title="OFF BY A PIXEL"
            hint={`Five rounds · ${today.dayKey}${already !== null ? " · already played today" : ""} · click the fault in the right-hand board`}
            keyCodes={KEY_CODES}
            onClose={onClose}
        >
            <canvas
                ref={canvasRef}
                className="arcade-canvas obp-canvas"
                width={W}
                height={H}
                onClick={onCanvasClick}
                tabIndex={-1}
            />

            {!done && (
                <div className="obp-hud">
                    <span className="obp-round">Round {round + 1} / {ROUNDS}</span>
                    <span className={"obp-clock" + (secsLeft <= 5 ? " is-low" : "")}>{secsLeft.toFixed(1)}s</span>
                    <span className="obp-score">{total} pts</span>
                    {wrong > 0 && <span className="obp-wrong">{wrong} miss{wrong > 1 ? "es" : ""}</span>}
                </div>
            )}

            {reveal && last && (
                <div className="obp-overlay">
                    <span className={"obp-verdict" + (reveal === "hit" ? " is-hit" : "")}>
                        {reveal === "hit" ? `Found it — ${last.points} pts` : "Time — 0 pts"}
                    </span>
                    <span className="obp-why">{last.fault.label}</span>
                    <button className="obp-next" onClick={next} autoFocus>
                        {round + 1 >= ROUNDS ? "See the score" : "Next round"}
                    </button>
                </div>
            )}

            {done && (
                <div className="obp-overlay obp-overlay--end">
                    <ul className="obp-breakdown">
                        {results.map((r, i) => (
                            <li key={i}>
                                <span className="obp-bd-round">{i + 1}</span>
                                <span className="obp-bd-why">{r.fault.label}</span>
                                <span className="obp-bd-pts">{r.points > 0 ? `${r.points}` : "—"}</span>
                            </li>
                        ))}
                    </ul>
                    {postNote && <span className="obp-post">{postNote}</span>}
                </div>
            )}
        </ArcadeFrame>
    );
};

export default OffByAPixel;
