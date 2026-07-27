// "TIMELINE" -- the studio-flavoured arcade egg. Snake, except the snake is a
// chain of keyframes trailing a playhead, the food is unimported footage, and
// the two ways to die are the two things that actually ruin an AE afternoon:
// running past the work area, and making a circular reference.
//
// Written from scratch rather than ported, which is the entire point: it costs
// a few KB instead of an emulator's megabytes, carries no GPL/shareware baggage, and it
// speaks the studio's own vocabulary. All the genuinely hard parts (getting AE
// to hand keystrokes to a CEP panel at all) live in ArcadeFrame.tsx.
//
// TWO DELIBERATE IMPLEMENTATION CHOICES:
//
// 1. THE LOOP IS `setInterval`, NOT `requestAnimationFrame`. A grid game wants
//    a fixed logical tick, not a per-frame one, so this is the right model
//    anyway -- but it also makes the game verifiable in this project's browser
//    preview harness, which throttles rAF to death in an automated tab (see
//    CLAUDE.md's "Preview harness caveat"). An rAF loop would be untestable
//    there for exactly the same reason any exit animation is.
//
// 2. INPUT IS QUEUED, NOT APPLIED IMMEDIATELY. Turning writes into `pending`
//    and only the tick commits it. Without that, two fast key presses inside
//    one tick (right, then down, while moving up) can reverse the snake into
//    its own neck -- the classic snake bug. The queue also means a direction
//    change always survives to the next tick instead of being overwritten by a
//    stray press.
import { useCallback, useEffect, useRef, useState } from "react";
import ArcadeFrame from "./ArcadeFrame";

const COLS = 24;
const ROWS = 15;
const CELL = 24;                      // internal canvas px per cell (576x360)
const START_MS = 140;                 // tick at the start
const MIN_MS = 70;                    // fastest it ever gets
const SPEEDUP_EVERY = 4;              // speed step per N pickups

// The panel's own palette, so the game looks like it belongs in the toolbox
// rather than like a dropped-in demo: Localise teal for the keyframes, Deliver
// orange for the footage.
const TEAL = "#5eead4";
const TEAL_DIM = "#2dd4bf";
const ORANGE = "#fb923c";
const GRID = "#12191c";
const GRID_MAJOR = "#1b262a";

type Pt = { x: number; y: number };
type Dir = { x: number; y: number };

// Survives remounts within the page session (not a reload) -- a full
// app.settings round trip would be real backend surface for a joke.
let bestScore = 0;

const DIRS: Record<string, Dir> = {
    ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 },
};

// Arrows, WASD, space, enter, R, P -- claimed from AE while the game is open.
const KEY_CODES = [37, 38, 39, 40, 87, 65, 83, 68, 32, 13, 82, 80];

const startSnake = (): Pt[] => [
    { x: 6, y: Math.floor(ROWS / 2) },
    { x: 5, y: Math.floor(ROWS / 2) },
    { x: 4, y: Math.floor(ROWS / 2) },
];

export const KeyframeSnake = ({ onClose }: { onClose: () => void }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // All live game state sits in refs: the tick runs from an interval, and
    // reading React state in there would capture a stale closure. React state
    // is used only for what the CHROME needs to re-render (score, dead, paused).
    const snake = useRef<Pt[]>(startSnake());
    const dir = useRef<Dir>({ x: 1, y: 0 });
    const pending = useRef<Dir[]>([]);
    const food = useRef<Pt>({ x: 16, y: 7 });
    const dead = useRef<string | null>(null);
    const paused = useRef(false);

    const [score, setScore] = useState(0);
    const [deadMsg, setDeadMsg] = useState<string | null>(null);
    const [isPaused, setIsPaused] = useState(false);

    /** Place food on a cell the snake isn't already occupying. */
    const placeFood = useCallback(() => {
        const free: Pt[] = [];
        for (let x = 0; x < COLS; x++) {
            for (let y = 0; y < ROWS; y++) {
                let hit = false;
                for (let i = 0; i < snake.current.length; i++) {
                    if (snake.current[i].x === x && snake.current[i].y === y) { hit = true; break; }
                }
                if (!hit) free.push({ x, y });
            }
        }
        // Board full = the player has genuinely won; leave the last food be.
        if (free.length) food.current = free[Math.floor(Math.random() * free.length)];
    }, []);

    const reset = useCallback(() => {
        snake.current = startSnake();
        dir.current = { x: 1, y: 0 };
        pending.current = [];
        dead.current = null;
        paused.current = false;
        setScore(0);
        setDeadMsg(null);
        setIsPaused(false);
        placeFood();
    }, [placeFood]);

    // ── drawing ──────────────────────────────────────────────────────────────
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const W = COLS * CELL;
        const H = ROWS * CELL;

        ctx.fillStyle = "#05090a";
        ctx.fillRect(0, 0, W, H);

        // Timeline ruler: a tick per cell, heavier every 4 (a "second" at 4fps
        // of gameplay) so the board reads as a comp timeline, not graph paper.
        for (let x = 0; x <= COLS; x++) {
            ctx.fillStyle = x % 4 === 0 ? GRID_MAJOR : GRID;
            ctx.fillRect(x * CELL, 0, 1, H);
        }
        for (let y = 0; y <= ROWS; y++) {
            ctx.fillStyle = GRID;
            ctx.fillRect(0, y * CELL, W, 1);
        }

        // Footage to import: a small rounded-ish tile with a corner notch, so
        // it reads as an asset rather than just "the pellet".
        const f = food.current;
        ctx.fillStyle = ORANGE;
        ctx.fillRect(f.x * CELL + 5, f.y * CELL + 5, CELL - 10, CELL - 10);
        ctx.fillStyle = "#05090a";
        ctx.fillRect(f.x * CELL + CELL - 10, f.y * CELL + 5, 5, 5);

        // The chain: every segment is an AE keyframe diamond. The head is the
        // playhead -- brighter, with its own vertical line down the timeline.
        for (let i = snake.current.length - 1; i >= 0; i--) {
            const s = snake.current[i];
            const cx = s.x * CELL + CELL / 2;
            const cy = s.y * CELL + CELL / 2;
            const r = i === 0 ? CELL / 2 - 3 : CELL / 2 - 5;

            if (i === 0) {
                ctx.fillStyle = "rgba(94, 234, 212, 0.22)";
                ctx.fillRect(cx - 0.5, 0, 1, H);
            }

            ctx.beginPath();
            ctx.moveTo(cx, cy - r);
            ctx.lineTo(cx + r, cy);
            ctx.lineTo(cx, cy + r);
            ctx.lineTo(cx - r, cy);
            ctx.closePath();
            ctx.fillStyle = i === 0 ? "#ffffff" : TEAL;
            ctx.fill();
            if (i !== 0) {
                ctx.strokeStyle = TEAL_DIM;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }, []);

    // ── the tick ─────────────────────────────────────────────────────────────
    const step = useCallback(() => {
        if (dead.current || paused.current) return;

        // Commit at most one queued turn per tick, ignoring a straight reversal
        // (see note 2 in the header).
        while (pending.current.length) {
            const next = pending.current.shift() as Dir;
            const reversing = next.x === -dir.current.x && next.y === -dir.current.y;
            const same = next.x === dir.current.x && next.y === dir.current.y;
            if (!reversing && !same) { dir.current = next; break; }
        }

        const head = snake.current[0];
        const nx = head.x + dir.current.x;
        const ny = head.y + dir.current.y;

        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
            dead.current = "Ran past the work area.";
            setDeadMsg(dead.current);
            return;
        }
        for (let i = 0; i < snake.current.length; i++) {
            if (snake.current[i].x === nx && snake.current[i].y === ny) {
                dead.current = "Circular reference!";
                setDeadMsg(dead.current);
                return;
            }
        }

        snake.current = [{ x: nx, y: ny }, ...snake.current];
        if (nx === food.current.x && ny === food.current.y) {
            setScore((s) => {
                const next = s + 1;
                if (next > bestScore) bestScore = next;
                return next;
            });
            placeFood();
        } else {
            snake.current.pop();
        }
        draw();
    }, [draw, placeFood]);

    // Interval is re-created when the speed step changes -- score is the only
    // thing that alters the tick rate, so it's the right dependency.
    useEffect(() => {
        const ms = Math.max(MIN_MS, START_MS - Math.floor(score / SPEEDUP_EVERY) * 10);
        const id = setInterval(step, ms);
        return () => clearInterval(id);
    }, [step, score]);

    // First paint, so the board is visible before the first tick lands.
    useEffect(() => { draw(); }, [draw]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

            if (key === "r") { e.preventDefault(); reset(); return; }
            if (key === "p") {
                e.preventDefault();
                paused.current = !paused.current;
                setIsPaused(paused.current);
                return;
            }
            if (key === " " || key === "Enter") {
                e.preventDefault();
                if (dead.current) reset();
                return;
            }

            const d = DIRS[key];
            if (d) {
                e.preventDefault();
                // Cap the queue: holding a key shouldn't bank a dozen turns.
                if (pending.current.length < 2) pending.current.push(d);
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [reset]);

    return (
        <ArcadeFrame
            title="TIMELINE"
            hint="Arrows / WASD move · P pauses · R restarts · Esc quits"
            keyCodes={KEY_CODES}
            onClose={onClose}
        >
            <canvas
                ref={canvasRef}
                className="arcade-canvas"
                width={COLS * CELL}
                height={ROWS * CELL}
                tabIndex={-1}
            />
            <div className="ks-hud">
                <span className="ks-score">{score} frames</span>
                <span className="ks-best">best {Math.max(bestScore, score)}</span>
            </div>
            {(deadMsg || isPaused) && (
                <div className="ks-overlay">
                    {deadMsg ? (
                        <>
                            <span className="ks-dead">{deadMsg}</span>
                            <span className="ks-sub">{score} frames rendered · Space to try again</span>
                        </>
                    ) : (
                        <span className="ks-dead">Paused</span>
                    )}
                </div>
            )}
        </ArcadeFrame>
    );
};

export default KeyframeSnake;
