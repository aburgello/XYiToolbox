// =============================================================================
// src/js/main/lib/detectShapes.ts
// -----------------------------------------------------------------------------
// FINDING THE SCREENS IN A FLAT-COLOUR PLATE.
//
// A spec sheet or a render -- white background, solid shapes -- carries the
// screen outlines already, and tracing them by hand is copying a drawing that
// is right in front of you. This reads the pixels and proposes the shapes.
//
// A PHOTOGRAPH IS NOT THIS PROBLEM and this does not attempt it. A real plate
// has no flat background and a lit screen is not one colour; detecting those
// edges needs gradients, line fitting and vanishing points, and would be wrong
// often enough to be worse than tracing with the loupe. When the background
// doesn't read as flat, this says so and proposes nothing.
//
// Read through a data: URI rather than file://, which is what keeps the canvas
// untainted -- a file:// page drawing a file:// image cannot call getImageData
// without a CEF flag nobody should have to set.
// =============================================================================
import { fs } from "../../lib/cep/node";

export interface DetectedShape {
    /** Plate coordinates, clockwise from the top left. */
    corners: [number, number][];
    /** Share of the analysed image this blob covers, for ordering and culling. */
    area: number;
    /**
     * THE REAL OUTLINE, simplified, in plate coordinates.
     *
     * A chevron arch, an L-shaped facade or a screen with a bite out of it is
     * not a quadrilateral, and forcing one onto it loses the shape. The
     * boundary is walked and reduced to the points that actually carry it, so
     * AE can be given a mask of the true outline rather than a box.
     */
    outline: [number, number][];
    /** True when the outline is meaningfully different from its four corners,
     *  i.e. a mask is worth having. */
    complex: boolean;
}

export interface DetectResult {
    shapes: DetectedShape[];
    /** Why nothing was proposed, when nothing was. */
    why?: string;
    /** The image's own pixel size. Coordinates come back in these, and a
     *  Bespoke canvas is rarely the same size as the reference it is traced
     *  over, so the caller has to be able to scale. */
    imageW?: number;
    imageH?: number;
}

/** How far a pixel can sit from the background and still count as background. */
const BG_TOLERANCE = 46;
/** Ignore anything under this share of the image -- specks, text, logos. */
const MIN_AREA = 0.004;
const MAX_SHAPES = 24;
/** The longest edge the analysis runs at. Full plates are up to 20000px wide
 *  and the shapes are the same shapes at 900. */
const WORK_EDGE = 900;

function mimeFor(path: string): string {
    const lower = path.toLowerCase();
    if (lower.substring(lower.length - 4) === ".png") return "image/png";
    if (lower.substring(lower.length - 4) === ".gif") return "image/gif";
    if (lower.substring(lower.length - 5) === ".webp") return "image/webp";
    return "image/jpeg";
}

function loadPixels(path: string): Promise<{ data: Uint8ClampedArray; w: number; h: number; scale: number }> {
    return new Promise((resolve, reject) => {
        let base64 = "";
        try {
            base64 = (fs.readFileSync(path) as Buffer).toString("base64");
        } catch (e) {
            reject(new Error("couldn't read that file"));
            return;
        }
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, WORK_EDGE / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) { reject(new Error("no canvas")); return; }
            ctx.drawImage(img, 0, 0, w, h);
            try {
                resolve({ data: ctx.getImageData(0, 0, w, h).data, w, h, scale });
            } catch (e) {
                reject(new Error("couldn't read the pixels"));
            }
        };
        img.onerror = () => reject(new Error("couldn't decode that image"));
        img.src = `data:${mimeFor(path)};base64,${base64}`;
    });
}

/** The background, from the four corners. Disagreement between them is the
 *  signal that this is a photograph rather than a diagram. */
function background(data: Uint8ClampedArray, w: number, h: number): { rgb: number[]; flat: boolean } {
    const at = (x: number, y: number): number[] => {
        const i = (y * w + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
    };
    const pad = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    const samples = [
        at(pad, pad), at(w - 1 - pad, pad), at(pad, h - 1 - pad), at(w - 1 - pad, h - 1 - pad),
    ];
    const mean = [0, 0, 0];
    for (let i = 0; i < samples.length; i++) {
        for (let c = 0; c < 3; c++) mean[c] += samples[i][c] / samples.length;
    }
    let spread = 0;
    for (let i = 0; i < samples.length; i++) {
        let d = 0;
        for (let c = 0; c < 3; c++) d += (samples[i][c] - mean[c]) * (samples[i][c] - mean[c]);
        spread = Math.max(spread, Math.sqrt(d));
    }
    return { rgb: mean, flat: spread < 30 };
}

/** The four extreme points of a blob, which are its corners for any shape that
 *  is a quad, a trapezoid or a rotated rectangle -- everything a screen is. */
function cornersOf(xs: number[], ys: number[]): [number, number][] {
    let ulI = 0, urI = 0, lrI = 0, llI = 0;
    let ulV = Infinity, urV = -Infinity, lrV = -Infinity, llV = Infinity;
    for (let i = 0; i < xs.length; i++) {
        const sum = xs[i] + ys[i];
        const dif = xs[i] - ys[i];
        if (sum < ulV) { ulV = sum; ulI = i; }
        if (sum > lrV) { lrV = sum; lrI = i; }
        if (dif > urV) { urV = dif; urI = i; }
        if (dif < llV) { llV = dif; llI = i; }
    }
    return [
        [xs[ulI], ys[ulI]], [xs[urI], ys[urI]], [xs[lrI], ys[lrI]], [xs[llI], ys[llI]],
    ];
}

/**
 * The boundary of a blob, walked clockwise (Moore neighbourhood).
 *
 * Started from the blob's topmost-leftmost pixel, which is guaranteed to be on
 * the boundary, so the walk cannot begin inside the shape and spiral.
 */
function traceOutline(mask: Uint8Array, w: number, h: number, startX: number, startY: number): [number, number][] {
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    // Clockwise from due east.
    const dx = [1, 1, 0, -1, -1, -1, 0, 1];
    const dy = [0, 1, 1, 1, 0, -1, -1, -1];

    const out: [number, number][] = [];
    let cx = startX;
    let cy = startY;
    let dir = 6;                       // came from the north
    const guard = w * h * 4;
    let steps = 0;

    do {
        out.push([cx, cy]);
        let found = false;
        // Turn left from where we came, then sweep right until inside again.
        for (let k = 0; k < 8; k++) {
            const d = (dir + 6 + k) % 8;
            const nx = cx + dx[d];
            const ny = cy + dy[d];
            if (!inside(nx, ny)) continue;
            cx = nx;
            cy = ny;
            dir = d;
            found = true;
            break;
        }
        if (!found) break;             // a single pixel, nothing to walk
        steps++;
    } while ((cx !== startX || cy !== startY) && steps < guard);

    return out;
}

/** Douglas-Peucker: keeps the points that carry the shape and drops the ones
 *  that only carry the pixel grid. */
function simplify(points: [number, number][], tolerance: number): [number, number][] {
    if (points.length < 3) return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack: number[][] = [[0, points.length - 1]];

    while (stack.length) {
        const seg = stack.pop() as number[];
        const first = seg[0];
        const last = seg[1];
        const ax = points[first][0];
        const ay = points[first][1];
        const bx = points[last][0];
        const by = points[last][1];
        const vx = bx - ax;
        const vy = by - ay;
        const len = Math.sqrt(vx * vx + vy * vy) || 1;

        let worst = -1;
        let worstAt = -1;
        for (let i = first + 1; i < last; i++) {
            const d = Math.abs((points[i][0] - ax) * vy - (points[i][1] - ay) * vx) / len;
            if (d > worst) { worst = d; worstAt = i; }
        }
        if (worst > tolerance && worstAt > 0) {
            keep[worstAt] = 1;
            stack.push([first, worstAt]);
            stack.push([worstAt, last]);
        }
    }

    const out: [number, number][] = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
    return out;
}

/**
 * Every shape in the plate that isn't background, biggest first.
 *
 * Flood filled iteratively: a plate blob is hundreds of thousands of pixels and
 * a recursive fill would blow the stack long before it finished.
 */
export async function detectShapes(path: string): Promise<DetectResult> {
    let px;
    try {
        px = await loadPixels(path);
    } catch (e) {
        return { shapes: [], why: (e as Error).message };
    }
    const { data, w, h, scale } = px;
    const imageW = Math.round(w / scale);
    const imageH = Math.round(h / scale);
    const bg = background(data, w, h);
    if (!bg.flat) {
        return {
            shapes: [],
            why: "the background isn't a flat colour, so this looks like a photograph — trace it by hand",
            imageW, imageH,
        };
    }

    const total = w * h;
    const fore = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        const p = i * 4;
        if (data[p + 3] < 24) continue;                  // transparent counts as background
        const d = Math.abs(data[p] - bg.rgb[0]) + Math.abs(data[p + 1] - bg.rgb[1]) + Math.abs(data[p + 2] - bg.rgb[2]);
        if (d > BG_TOLERANCE) fore[i] = 1;
    }

    const seen = new Uint8Array(total);
    const shapes: DetectedShape[] = [];
    const stack: number[] = [];

    for (let start = 0; start < total; start++) {
        if (!fore[start] || seen[start]) continue;
        stack.length = 0;
        stack.push(start);
        seen[start] = 1;
        const xs: number[] = [];
        const ys: number[] = [];

        while (stack.length) {
            const i = stack.pop() as number;
            const x = i % w;
            const y = (i - x) / w;
            xs.push(x);
            ys.push(y);
            // Four-connected: diagonals bridge shapes that only touch at a
            // corner, which on a spec sheet is two different screens.
            if (x > 0 && fore[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
            if (x < w - 1 && fore[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
            if (y > 0 && fore[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
            if (y < h - 1 && fore[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
        }

        const share = xs.length / total;
        if (share < MIN_AREA) continue;
        const corners = cornersOf(xs, ys).map(
            (c) => [c[0] / scale, c[1] / scale] as [number, number]);

        // This blob alone, so the walk cannot wander into a neighbour.
        const blob = new Uint8Array(total);
        let topI = 0;
        let topRank = Infinity;
        for (let n = 0; n < xs.length; n++) {
            blob[ys[n] * w + xs[n]] = 1;
            const rank = ys[n] * w + xs[n];
            if (rank < topRank) { topRank = rank; topI = n; }
        }
        const walked = traceOutline(blob, w, h, xs[topI], ys[topI]);
        // A pixel and a half at working scale: past the staircase, short of the
        // shape.
        const outline = simplify(walked, 1.5).map(
            (c) => [c[0] / scale, c[1] / scale] as [number, number]);

        // IS THE OUTLINE SAYING MORE THAN ITS FOUR CORNERS?
        //
        // Measured as how far the outline STRAYS from the quad, not as a ratio
        // of areas: a tower with a rounded cap is still 95% of its bounding
        // quad, so an area test called it a rectangle and cut the cap off. The
        // distance test sees the cap immediately, because those points sit tens
        // of pixels inside the corner they are replacing.
        let strayed = 0;
        for (let i = 0; i < outline.length; i++) {
            let nearest = Infinity;
            for (let e = 0; e < corners.length; e++) {
                const a = corners[e];
                const b = corners[(e + 1) % corners.length];
                const vx = b[0] - a[0];
                const vy = b[1] - a[1];
                const len2 = vx * vx + vy * vy;
                let t = len2 > 0 ? ((outline[i][0] - a[0]) * vx + (outline[i][1] - a[1]) * vy) / len2 : 0;
                if (t < 0) t = 0;
                if (t > 1) t = 1;
                const dx2 = outline[i][0] - (a[0] + vx * t);
                const dy2 = outline[i][1] - (a[1] + vy * t);
                const d = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                if (d < nearest) nearest = d;
            }
            if (nearest > strayed) strayed = nearest;
        }
        // Against the shape's own size, so a small screen and a large one are
        // judged the same way. 1.5% catches a rounded cap and ignores the
        // pixel staircase down a straight edge.
        const spanX = Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0])
            - Math.min(corners[0][0], corners[1][0], corners[2][0], corners[3][0]);
        const spanY = Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1])
            - Math.min(corners[0][1], corners[1][1], corners[2][1], corners[3][1]);
        const span = Math.sqrt(spanX * spanX + spanY * spanY) || 1;
        const complex = strayed / span > 0.015;

        shapes.push({ corners, area: share, outline, complex });
    }

    shapes.sort((a, b) => b.area - a.area);
    if (shapes.length > MAX_SHAPES) shapes.length = MAX_SHAPES;
    if (shapes.length === 0) return { shapes: [], why: "nothing stood out from the background", imageW, imageH };
    return { shapes, imageW, imageH };
}
