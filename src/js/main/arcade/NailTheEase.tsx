// NAIL THE EASE -- match the motion, not the picture.
//
// The target curve is NEVER drawn. You only ever see it MOVE: a dot running the
// target ease on the top track, yours on the one below it, looping together. If
// the curve were on screen this would be a tracing exercise; hidden, it is the
// thing the job actually asks for, which is reading acceleration by eye and
// reproducing it.
//
// NOT WIRED TO MotionToolsEasePresets, deliberately. Those store AE keyframe
// INFLUENCE (and only influence -- speed is absolute and tied to one keyframe,
// so it isn't portable), which does not convert cleanly to a cubic bezier. A
// lossy conversion would make the target subtly unmatchable and the scoring a
// lie. The targets here are a hand-built list of real easing curves instead.
//
// An arcade game, not a daily one: every run posts and the board keeps the best,
// so playing more is playing better rather than just showing up.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evalTS } from "../../lib/utils/bolt";
import ArcadeFrame from "./ArcadeFrame";

const W = 960;
const H = 600;

const CURVES_PER_RUN = 5;
const POINTS_PER_CURVE = 200;
/** Mean sampled error at which a curve is worth nothing. */
const ZERO_AT = 0.15;

// THE CLOCK EXISTS BECAUSE THE TARGET LOOPS FOREVER.
//
// Untimed, a patient player converges on near-200 every curve by nudging a
// handle a hundredth at a time, so the board ranks persistence rather than eye
// -- the same staring-contest problem the clock solves in Off by a Pixel.
//
// 20 seconds rather than something snappier because of what a careful attempt
// actually costs: the target loops every 1.95s, so reading it takes ~3 loops,
// dragging both handles ~3s, and checking the two dots together ~2 loops. That
// is about 13s. At 10s there is no verification pass at all and the game stops
// being about reading acceleration.
//
// The pressure lives in the BONUS, not in a guillotine: time out and you keep
// whatever accuracy you had. Accuracy therefore still decides the winner and
// speed breaks ties, rather than fast-and-sloppy beating slow-and-precise.
const CURVE_SECONDS = 20;
const SPEED_BONUS = 60;
/**
 * No bonus below half marks, or the optimal opening is to slam "Lock it in" on
 * the default handles five times and bank 300 for nothing.
 */
const BONUS_FLOOR = POINTS_PER_CURVE / 2;

export function speedBonus(seconds: number, accuracy: number): number {
    if (accuracy < BONUS_FLOOR) return 0;
    const left = Math.max(0, 1 - seconds / CURVE_SECONDS);
    return Math.round(SPEED_BONUS * left);
}

interface Ease {
    name: string;
    p: [number, number, number, number];
}

// THE NAMED CLASSICS ARE A SEED, NOT THE POOL. On a fixed list of twelve, five
// a run, the median player has seen every curve in SIX runs -- about a quarter
// of an hour before the cabinet has nothing new in it. So a run is two of these
// plus three generated ones, which makes the supply effectively endless while
// keeping curves people can actually name in the mix.
const EASES: Ease[] = [
    { name: "Out Expo", p: [0.16, 1, 0.3, 1] },
    { name: "In Out Cubic", p: [0.65, 0, 0.35, 1] },
    { name: "Out Back", p: [0.34, 1.56, 0.64, 1] },
    { name: "In Quart", p: [0.5, 0, 0.75, 0] },
    { name: "Out Quint", p: [0.22, 1, 0.36, 1] },
    { name: "In Out Back", p: [0.68, -0.6, 0.32, 1.6] },
    { name: "In Out Quart", p: [0.76, 0, 0.24, 1] },
    { name: "Out Circ", p: [0, 0.55, 0.45, 1] },
    { name: "In Back", p: [0.36, 0, 0.66, -0.56] },
    { name: "In Out Expo", p: [0.87, 0, 0.13, 1] },
    { name: "Out Sine", p: [0.61, 1, 0.88, 1] },
    { name: "In Out Circ", p: [0.85, 0, 0.15, 1] },
];

/**
 * cubic-bezier(x1,y1,x2,y2) as a progress function. Newton's method on x to
 * recover t, then evaluate y -- the same approach the CSS spec describes.
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
    const A = (a: number, b: number) => 1 - 3 * b + 3 * a;
    const B = (a: number, b: number) => 3 * b - 6 * a;
    const C = (a: number) => 3 * a;
    const calc = (t: number, a: number, b: number) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
    const slope = (t: number, a: number, b: number) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);

    return (x: number) => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let t = x;
        for (let i = 0; i < 8; i++) {
            const s = slope(t, x1, x2);
            if (Math.abs(s) < 1e-6) break;
            t -= (calc(t, x1, x2) - x) / s;
            // Newton can wander outside the domain on the overshoot curves,
            // where the slope briefly approaches zero. Clamping keeps it in the
            // basin rather than diverging; 8 passes is ample from there.
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
        }
        return calc(t, y1, y2);
    };
}

/** Mean absolute difference between two eases, sampled evenly. */
export function curveError(a: [number, number, number, number], b: [number, number, number, number]): number {
    const fa = bezier(a[0], a[1], a[2], a[3]);
    const fb = bezier(b[0], b[1], b[2], b[3]);
    const N = 100;
    let sum = 0;
    for (let i = 1; i < N; i++) sum += Math.abs(fa(i / N) - fb(i / N));
    return sum / (N - 1);
}

export function scoreFor(err: number): number {
    return Math.max(0, Math.round(POINTS_PER_CURVE * (1 - err / ZERO_AT)));
}

// --- geometry ---------------------------------------------------------------
const GRID = { x: 60, y: 92, w: 400, h: 400 };
// The grid has to reach FURTHER than the most extreme target, or that target is
// unmatchable and the round is capped below 200 through no fault of the player.
// At -0.5..1.5 three of the twelve curves were impossible: In Out Back (y 1.6)
// topped out at 175, Out Back and In Back at 180. Any new ease added below must
// sit inside this range.
const Y_MIN = -0.75;
const Y_MAX = 1.75;

const toPx = (x: number, y: number) => ({
    px: GRID.x + x * GRID.w,
    py: GRID.y + GRID.h - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * GRID.h,
});
const toVal = (px: number, py: number) => ({
    x: (px - GRID.x) / GRID.w,
    y: Y_MIN + ((GRID.y + GRID.h - py) / GRID.h) * (Y_MAX - Y_MIN),
});

const TRACK = { x: 540, w: 360, targetY: 210, userY: 330, r: 11 };
/** One full loop: travel, then a beat at the end so the ending reads. */
const LOOP_MS = 1500;
const HOLD_MS = 450;

// --- generated curves -------------------------------------------------------
/** Names a curve by what it DOES, since a generated one has no other name. */
function describeEase(p: [number, number, number, number]): string {
    const f = bezier(p[0], p[1], p[2], p[3]);
    let min = 0;
    let max = 0;
    for (let i = 0; i <= 100; i++) {
        const v = f(i / 100);
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const start = p[1] <= 0.15 ? "Slow start" : p[1] >= 0.85 ? "Fast start" : "Even start";
    const end = p[3] >= 0.85 ? "soft landing" : p[3] <= 0.3 ? "hard landing" : "even landing";
    const extra = max > 1.03 ? " + overshoot" : min < -0.03 ? " + anticipation" : "";
    return `${start}, ${end}${extra}`;
}

/**
 * A random but PLAYABLE curve. The y bounds sit inside the grid's own range, or
 * the target would be unmatchable; near-linear results are rejected because
 * there is nothing to read in them.
 */
function randomEase(): Ease {
    for (let attempt = 0; attempt < 40; attempt++) {
        const x1 = Math.round(Math.random() * 100) / 100;
        const x2 = Math.round(Math.random() * 100) / 100;
        const y1 = Math.round((-0.6 + Math.random() * 2.2) * 100) / 100;
        const y2 = Math.round((-0.6 + Math.random() * 2.2) * 100) / 100;
        const p: [number, number, number, number] = [x1, y1, x2, y2];
        if (curveError(p, [0, 0, 1, 1]) < 0.05) continue;          // too close to linear
        if (curveError(p, [0.4, 0.4, 0.6, 0.6]) < 0.05) continue;  // too close to the starting handles
        return { name: describeEase(p), p };
    }
    return EASES[Math.floor(Math.random() * EASES.length)];
}

/** Two named classics and three generated, shuffled. */
function buildRun(): Ease[] {
    const pool = EASES.slice();
    const out: Ease[] = [];
    for (let i = 0; i < 2 && pool.length; i++) {
        out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    while (out.length < CURVES_PER_RUN) out.push(randomEase());
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

const KEY_CODES: number[] = [];

interface Result {
    name: string;
    points: number;
    bonus: number;
    err: number;
}

export const NailTheEase = ({ onClose }: { onClose: () => void }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // A fresh five every run -- this is the arcade cabinet, not a daily.
    const targets = useMemo(() => buildRun(), []);

    const [idx, setIdx] = useState(0);
    const [handles, setHandles] = useState<[number, number, number, number]>([0.4, 0.4, 0.6, 0.6]);
    const [results, setResults] = useState<Result[]>([]);
    const [done, setDone] = useState(false);
    const [postNote, setPostNote] = useState<string | null>(null);
    const [dragging, setDragging] = useState<0 | 1 | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const startedRef = useRef(Date.now());

    // Read by the render loop every frame. Kept in refs as well as state so the
    // rAF closure never has to be rebuilt (and the animation never restarts)
    // just because a handle moved.
    const handlesRef = useRef(handles);
    const idxRef = useRef(idx);
    const doneRef = useRef(done);
    useEffect(() => { handlesRef.current = handles; }, [handles]);
    useEffect(() => { idxRef.current = idx; }, [idx]);
    useEffect(() => { doneRef.current = done; }, [done]);

    const postedRef = useRef(false);
    const total = results.reduce((n, r) => n + r.points + r.bonus, 0);
    const target = targets[Math.min(idx, targets.length - 1)];

    const submit = useCallback(() => {
        const secs = Math.min(CURVE_SECONDS, (Date.now() - startedRef.current) / 1000);
        const err = curveError(handles, target.p);
        const points = scoreFor(err);
        setResults((prev) => [...prev, { name: target.name, points, bonus: speedBonus(secs, points), err }]);
        if (idx + 1 >= targets.length) setDone(true);
        else {
            setIdx((i) => i + 1);
            // Back to linear-ish for the next one. Leaving the last answer in
            // place would make consecutive similar curves free.
            setHandles([0.4, 0.4, 0.6, 0.6]);
        }
    }, [handles, idx, target, targets.length]);

    // The clock. Restarts on each curve; running out locks in what you have
    // rather than scoring zero, so the cost of overrunning is the bonus alone.
    useEffect(() => {
        if (done) return;
        startedRef.current = Date.now();
        setElapsed(0);
        const t = window.setInterval(() => setElapsed((Date.now() - startedRef.current) / 1000), 100);
        return () => window.clearInterval(t);
    }, [idx, done]);

    useEffect(() => {
        if (!done || postedRef.current) return;
        postedRef.current = true;
        evalTS("teamArcadePost", "ease", total, "")
            .then(() => setPostNote(`${total} posted to the board.`))
            .catch(() => setPostNote("Couldn't reach the team folder — score not posted."));
    }, [done, total]);

    // --- dragging -----------------------------------------------------------
    // Mouse events rather than pointer events: the macOS AE CEP host doesn't
    // dispatch Pointer Events reliably, which is this codebase's standing rule
    // for anything beyond a plain click.
    const canvasPoint = useCallback((e: { clientX: number; clientY: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();
        return {
            px: ((e.clientX - r.left) / r.width) * W,
            py: ((e.clientY - r.top) / r.height) * H,
        };
    }, []);

    const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (done) return;
        const pt = canvasPoint(e);
        if (!pt) return;
        const h = handlesRef.current;
        const a = toPx(h[0], h[1]);
        const b = toPx(h[2], h[3]);
        const d1 = Math.hypot(pt.px - a.px, pt.py - a.py);
        const d2 = Math.hypot(pt.px - b.px, pt.py - b.py);
        if (Math.min(d1, d2) > 34) return;
        setDragging(d1 <= d2 ? 0 : 1);
    }, [canvasPoint, done]);

    useEffect(() => {
        if (dragging === null) return;
        const move = (e: MouseEvent) => {
            const pt = canvasPoint(e);
            if (!pt) return;
            const v = toVal(pt.px, pt.py);
            const x = Math.max(0, Math.min(1, v.x));
            const y = Math.max(Y_MIN, Math.min(Y_MAX, v.y));
            setHandles((h) => (dragging === 0 ? [x, y, h[2], h[3]] : [h[0], h[1], x, y]));
        };
        const up = () => setDragging(null);
        // On window, not the canvas: dragging a handle to the very edge takes
        // the cursor off the canvas, and a listener bound there would drop the
        // drag and strand the handle mid-move.
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
    }, [dragging, canvasPoint]);

    // --- the loop -----------------------------------------------------------
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        let raf = 0;
        const t0 = performance.now();

        const draw = (now: number) => {
            raf = requestAnimationFrame(draw);
            ctx.fillStyle = "#0d0d0d";
            ctx.fillRect(0, 0, W, H);

            if (doneRef.current) return;

            const h = handlesRef.current;
            const tg = targets[Math.min(idxRef.current, targets.length - 1)];
            const mine = bezier(h[0], h[1], h[2], h[3]);
            const theirs = bezier(tg.p[0], tg.p[1], tg.p[2], tg.p[3]);

            // --- grid ---
            ctx.strokeStyle = "#1e1e1e";
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const gx = GRID.x + (i / 4) * GRID.w;
                ctx.beginPath(); ctx.moveTo(gx, GRID.y); ctx.lineTo(gx, GRID.y + GRID.h); ctx.stroke();
            }
            // 0 and 1 get brighter rules -- they're the values that matter.
            for (const v of [0, 1]) {
                const { py } = toPx(0, v);
                ctx.strokeStyle = "#2d2d2d";
                ctx.beginPath(); ctx.moveTo(GRID.x, py); ctx.lineTo(GRID.x + GRID.w, py); ctx.stroke();
            }

            // --- the player's curve ---
            ctx.strokeStyle = "#8b5cf6";
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i <= 60; i++) {
                const x = i / 60;
                const { px, py } = toPx(x, mine(x));
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();

            // --- handles ---
            const anchors = [toPx(0, 0), toPx(1, 1)];
            const hs = [toPx(h[0], h[1]), toPx(h[2], h[3])];
            ctx.strokeStyle = "#4b3f6b";
            ctx.lineWidth = 1.5;
            for (let i = 0; i < 2; i++) {
                ctx.beginPath();
                ctx.moveTo(anchors[i].px, anchors[i].py);
                ctx.lineTo(hs[i].px, hs[i].py);
                ctx.stroke();
            }
            for (let i = 0; i < 2; i++) {
                ctx.fillStyle = dragging === i ? "#c4b5fd" : "#8b5cf6";
                ctx.beginPath();
                ctx.arc(hs[i].px, hs[i].py, dragging === i ? 8 : 6.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = "#3f3f46";
            for (const a of anchors) {
                ctx.beginPath(); ctx.arc(a.px, a.py, 4, 0, Math.PI * 2); ctx.fill();
            }

            ctx.fillStyle = "#5a5a5a";
            ctx.font = "10.5px ui-monospace, Menlo, monospace";
            ctx.fillText("drag both handles", GRID.x, GRID.y - 14);
            ctx.fillText(
                `cubic-bezier(${h[0].toFixed(2)}, ${h[1].toFixed(2)}, ${h[2].toFixed(2)}, ${h[3].toFixed(2)})`,
                GRID.x, GRID.y + GRID.h + 26
            );

            // --- the two tracks ---
            const cycle = LOOP_MS + HOLD_MS;
            const phase = ((now - t0) % cycle) / LOOP_MS;
            const p = Math.min(1, phase);

            const track = (y: number, label: string, colour: string, fn: (x: number) => number) => {
                ctx.strokeStyle = "#242424";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(TRACK.x, y);
                ctx.lineTo(TRACK.x + TRACK.w, y);
                ctx.stroke();
                // End posts, so the travel has somewhere to arrive.
                ctx.fillStyle = "#2a2a2a";
                ctx.fillRect(TRACK.x - 1, y - 12, 2, 24);
                ctx.fillRect(TRACK.x + TRACK.w - 1, y - 12, 2, 24);

                ctx.fillStyle = colour;
                ctx.beginPath();
                ctx.arc(TRACK.x + fn(p) * TRACK.w, y, TRACK.r, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = "#6a6a6a";
                ctx.font = "10.5px ui-monospace, Menlo, monospace";
                ctx.fillText(label, TRACK.x, y - 26);
            };

            track(TRACK.targetY, "TARGET", "#e8c766", theirs);
            track(TRACK.userY, "YOURS", "#8b5cf6", mine);

            ctx.fillStyle = "#4a4a4a";
            ctx.font = "10.5px ui-monospace, Menlo, monospace";
            ctx.fillText("watch the acceleration, not the finish", TRACK.x, TRACK.userY + 52);
        };

        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [targets, dragging]);

    return (
        <ArcadeFrame
            title="NAIL THE EASE"
            hint={`Drag the two handles until your dot moves like the target · ${CURVE_SECONDS}s a curve for the speed bonus`}
            keyCodes={KEY_CODES}
            onClose={onClose}
        >
            <canvas
                ref={canvasRef}
                className="arcade-canvas nte-canvas"
                width={W}
                height={H}
                onMouseDown={onMouseDown}
                tabIndex={-1}
            />

            {!done && (
                <>
                    <div className="nte-hud">
                        <span className="nte-round">Curve {idx + 1} / {targets.length}</span>
                        <span className={"nte-clock" + (elapsed >= CURVE_SECONDS ? " is-out" : "")}>
                            {elapsed >= CURVE_SECONDS
                                ? "no bonus"
                                : `+${speedBonus(elapsed, POINTS_PER_CURVE)} bonus`}
                        </span>
                        <span className="nte-score">{total} pts</span>
                    </div>
                    <button className="nte-submit" onClick={submit}>Lock it in</button>
                </>
            )}

            {done && (
                <div className="nte-overlay">
                    <span className="nte-total">{total}</span>
                    <span className="nte-outof">out of {targets.length * (POINTS_PER_CURVE + SPEED_BONUS)}</span>
                    <ul className="nte-breakdown">
                        {results.map((r, i) => (
                            <li key={i}>
                                <span className="nte-bd-name">{r.name}</span>
                                <span className="nte-bd-err">±{r.err.toFixed(3)}</span>
                                <span className="nte-bd-bonus">{r.bonus > 0 ? `+${r.bonus}` : ""}</span>
                                <span className="nte-bd-pts">{r.points + r.bonus}</span>
                            </li>
                        ))}
                    </ul>
                    {postNote && <span className="nte-post">{postNote}</span>}
                    <button className="nte-again" onClick={onClose}>Back to the arcade</button>
                </div>
            )}
        </ArcadeFrame>
    );
};

export default NailTheEase;
