// =============================================================================
// src/js/main/lib/bespokeCsv.ts
// -----------------------------------------------------------------------------
// A BESPOKE BOARD, READ OFF THE MECH'S OWN CSV.
//
// The mech team exports one CSV beside each deliverable's sheet (the same
// Page/Type/Name/FilePath/position/mask format Extreme Tools' Build From CSV
// reads). It already says what tracing made a person draw by hand:
//
//   - the CANVAS is in the deliverable's name (`…_7680x1472px_30s_MY`);
//   - every `ART` row is a piece of artwork and a MASK, the window it is seen
//     through on the board;
//   - the artwork's path says whose it is (`…/Support/Trio/Tiffs/…`).
//
// A PANEL IS ONE PIECE OF ARTWORK ON THE BOARD, NOT ONE ROW. A piece of art
// arrives as layers (`…_BG.tif`, `…_BORDER.tif`), each its own row with its own
// mask, and one picture can show through several windows (an arch: a lintel
// piece and a leg). So rows are grouped by page, by the artwork's name with
// its layer suffix off, and by WINDOWS THAT OVERLAP.
//
// THE PANEL IS THE GROUP'S BIGGEST WINDOW, AS THE CSV WROTE IT -- never a box
// drawn round all of them. It shipped as that box for an afternoon: on the
// VivaCity arch the poster's leg is 768 wide at x 2049 and its background runs
// on along the lintel from x 1641, so the box came out 1176 wide at 1641, and
// a master centred in it would have sat 200px left of the leg it belongs in.
// The windows a layer adds INSIDE the main one (a BORDER within its BG) belong
// to it; the ones that run on outside are `extras`, drawn and not built.
//
// `TT` rows are title treatments. A motion master carries its own title, so
// they are kept only to be drawn on the preview: a title sitting where no
// panel is means a part of the board this CSV cannot size (artwork that is a
// film clip has no ART row), and a person adds that panel by typing it.
//
// Nothing here needs a panel or a filesystem, so
// `node scripts/probe-bespoke-csv.mjs` runs it as it ships.
// =============================================================================

export interface Rect { x: number; y: number; w: number; h: number }

export interface CsvRow {
    page: string;
    type: string;
    name: string;
    filePath: string;
    /** Where the picture itself was placed (it usually runs past the canvas). */
    place: Rect;
    /** The window it is seen through. Zero-sized when the row has none. */
    mask: Rect;
}

export interface CsvPanel {
    page: string;
    /** The artwork's name, layer suffix and extension off. */
    family: string;
    /** The creative folder the artwork sits in under Support. "" when the path doesn't say. */
    creative: string;
    /** Every row's file name that went into this panel. */
    art: string[];
    /** The artwork's MAIN window, exactly as the CSV has it. This is what gets built. */
    box: Rect;
    /** The windows that make up that box: the main one and any layer's sitting inside it. */
    masks: Rect[];
    /**
     * The same artwork's OTHER windows: where its background runs on past the
     * main one (an arch's lintel beside its leg). Shown, never built unless
     * somebody makes one a panel of its own.
     */
    extras: Rect[];
}

export interface CsvTitle { page: string; name: string; creative: string; box: Rect }

export interface CsvBoard {
    pages: string[];
    panels: CsvPanel[];
    titles: CsvTitle[];
}

/** One CSV line, quotes and doubled quotes honoured. */
function splitLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line.charAt(i);
        if (ch === '"') {
            if (quoted && line.charAt(i + 1) === '"') { cur += '"'; i++; } else quoted = !quoted;
        } else if (ch === "," && !quoted) {
            out.push(cur);
            cur = "";
        } else cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
}

const num = (v: string) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

/** Every row of the mech's CSV. The header is skipped by position, like Build From CSV does. */
export function parseBespokeCsv(text: string): CsvRow[] {
    const lines = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i] || !lines[i].trim()) continue;
        const c = splitLine(lines[i]);
        if (c.length < 8) continue;
        rows.push({
            page: c[0] || "Page1",
            type: c[1] || "",
            name: c[2] || "",
            filePath: c[3] || "",
            place: { x: num(c[4]), y: num(c[5]), w: num(c[6]), h: num(c[7]) },
            mask: { x: num(c[8] || ""), y: num(c[9] || ""), w: num(c[10] || ""), h: num(c[11] || "") },
        });
    }
    return rows;
}

/**
 * The creative an artwork belongs to: the folder straight under `Support` in
 * its path (`…_Masters/Support/Trio/Tiffs/x.tif` is Trio). Never
 * `Motion_Components`, which is a container and not a creative. "" when the
 * path has no Support level.
 */
export function creativeFromSupportPath(p: string): string {
    const parts = String(p || "").split(/[\\/]+/);
    for (let i = 0; i < parts.length - 2; i++) {
        if (parts[i].toLowerCase() !== "support") continue;
        let c = parts[i + 1];
        if (/^motion_components$/i.test(c)) c = parts[i + 2] || "";
        return c.replace(/^_+/, "");
    }
    return "";
}

/** An artwork's name with its extension and its layer suffix off. */
export function artFamily(name: string): string {
    return String(name || "").replace(/\.[A-Za-z0-9]{2,4}$/, "").replace(/_(?:BG|BORDER|FG|MG|BKG|BACKGROUND)$/i, "");
}

const clip = (r: Rect, w: number, h: number): Rect => {
    const x0 = Math.max(0, Math.min(w, r.x));
    const y0 = Math.max(0, Math.min(h, r.y));
    const x1 = Math.max(0, Math.min(w, r.x + r.w));
    const y1 = Math.max(0, Math.min(h, r.y + r.h));
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
};

/** The window a row is seen through: its mask, or its placement when it has none. */
const windowOf = (r: CsvRow, w: number, h: number): Rect => clip(r.mask.w > 0 && r.mask.h > 0 ? r.mask : r.place, w, h);

/**
 * How much of the smaller window two windows must share to be one panel.
 *
 * Grouping is by the WINDOWS, not by where the picture was placed: on the
 * pillar boards one panel's BORDER and BG are placed differently behind the
 * same window, and grouping on placement made two panels of every one. A
 * share and not "they touch": neighbouring pillars meet edge to edge, and the
 * mech's own rounding has them a pixel over (511..1023 beside 0..512).
 */
const SAME_PANEL = 0.2;
/** How much of a window must lie in the main one to be part of it and not a run-on. */
const INSIDE = 0.8;

const shared = (a: Rect, b: Rect): number => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.min(a.w * a.h, b.w * b.h);
};

/**
 * The board a CSV describes. Panels come back in reading order (page, then
 * left to right, then top down), which is also the order they are listed and
 * numbered in.
 */
export function boardFromRows(rows: CsvRow[], canvasW: number, canvasH: number): CsvBoard {
    const pages: string[] = [];
    const groups: { page: string; family: string; creative: string; art: string[]; masks: Rect[] }[] = [];
    const titles: CsvTitle[] = [];
    for (const r of rows) {
        if (pages.indexOf(r.page) === -1) pages.push(r.page);
        const type = r.type.toUpperCase();
        const win = windowOf(r, canvasW, canvasH);
        if (!(win.w > 0) || !(win.h > 0)) continue; // wholly off the board
        if (type.indexOf("TT") === 0) {
            titles.push({ page: r.page, name: r.name, creative: creativeFromSupportPath(r.filePath), box: win });
            continue;
        }
        if (type.indexOf("ART") !== 0) continue;
        // Every group of this artwork, on this page, that the window overlaps.
        // More than one means this row is what joins them (a leg read before
        // its lintel), so they fold into the first.
        const family = artFamily(r.name);
        const hit = groups.filter((g) => g.page === r.page && g.family === family && g.masks.some((m) => shared(m, win) >= SAME_PANEL));
        let g = hit[0];
        if (!g) {
            g = { page: r.page, family, creative: creativeFromSupportPath(r.filePath), art: [], masks: [] };
            groups.push(g);
        }
        for (let k = 1; k < hit.length; k++) {
            hit[k].art.forEach((n) => { if (g.art.indexOf(n) === -1) g.art.push(n); });
            hit[k].masks.forEach((m) => g.masks.push(m));
            groups.splice(groups.indexOf(hit[k]), 1);
        }
        if (g.art.indexOf(r.name) === -1) g.art.push(r.name);
        g.masks.push(win);
    }
    const panels: CsvPanel[] = groups.map((g) => {
        let main = g.masks[0];
        g.masks.forEach((m) => { if (m.w * m.h > main.w * main.h) main = m; });
        // INSIDE means most of the window's own area: `shared` is against the
        // smaller of the two, and nothing here is bigger than `main`.
        const inside = g.masks.filter((m) => shared(m, main) >= INSIDE);
        let extras: Rect[] = [];
        g.masks.filter((m) => shared(m, main) < INSIDE).forEach((m) => {
            if (!extras.some((e) => e.x === m.x && e.y === m.y && e.w === m.w && e.h === m.h)) extras.push(m);
        });
        // A WINDOW THAT CARRIES THE MAIN ONE ON, EDGE TO EDGE, IS THE SAME
        // PANEL: a leg whose background was laid in two tiles, one above the
        // other, the same width at the same x. That is the one case the box
        // grows. A lintel beside a leg matches on neither axis and stays out.
        let box: Rect = { x: main.x, y: main.y, w: main.w, h: main.h };
        const near = (a: number, b: number) => Math.abs(a - b) <= 2;
        for (let grew = true; grew; ) {
            grew = false;
            for (const e of extras) {
                if (!((near(e.x, box.x) && near(e.w, box.w)) || (near(e.y, box.y) && near(e.h, box.h)))) continue;
                const x0 = Math.min(box.x, e.x);
                const y0 = Math.min(box.y, e.y);
                box = { x: x0, y: y0, w: Math.max(box.x + box.w, e.x + e.w) - x0, h: Math.max(box.y + box.h, e.y + e.h) - y0 };
                inside.push(e);
                extras = extras.filter((x) => x !== e);
                grew = true;
                break;
            }
        }
        return { page: g.page, family: g.family, creative: g.creative, art: g.art, masks: inside, extras, box };
    });
    panels.sort((a, b) => pages.indexOf(a.page) - pages.indexOf(b.page) || a.box.x - b.box.x || a.box.y - b.box.y);
    return { pages, panels, titles };
}

/**
 * WHERE A BUILD OF THIS DELIVERABLE IS FILED, read off where its CSV sits:
 * `<Markets>/<Territory>/<PNGs|JPG_PNG|JPGs>/<Batch>/<Deliverable>/x.csv`.
 * Null for any other shape. Derived, never invented: a CSV on somebody's
 * Desktop files nowhere, and the build is left open in After Effects.
 */
export function whereItFiles(csvPath: string): { marketsRoot: string; territory: string; batch: string } | null {
    const parts = String(csvPath || "").split("/");
    if (parts.length < 6) return null;
    const art = parts[parts.length - 4];
    if (!/^(pngs?|jpgs?|jpg_png)$/i.test(art)) return null;
    const territory = parts[parts.length - 5];
    const marketsRoot = parts.slice(0, parts.length - 5).join("/");
    if (!territory || !marketsRoot) return null;
    return { marketsRoot, territory, batch: parts[parts.length - 3] };
}

// ---------------------------------------------------------------------------
// PLACING A PANEL THE CSV COULD NOT SEE, without drawing it.
//
// Artwork that is a film clip has no ART row, so parts of a board arrive with
// no panel: an arch's lintel either side of its legs. Those are added by
// pointing at the gap. The gap is worked out from what is already known: the
// BAND is the strip between the nearest horizontal edges of anything read
// (panels and run-on windows; a lintel's run-on is what says the lintel is 320
// tall), and across it the gap runs until it meets a panel or the board's edge.
// ---------------------------------------------------------------------------

const overlapsBand = (r: Rect, y0: number, y1: number) => Math.min(r.y + r.h, y1) - Math.max(r.y, y0) > 0;

/**
 * The free box round a point on the board, or null when the point is on a
 * panel. `lines` are extra boxes whose edges mark bands without blocking (the
 * run-on windows).
 */
export function gapAt(px: number, py: number, panels: Rect[], lines: Rect[], canvasW: number, canvasH: number): Rect | null {
    if (px < 0 || py < 0 || px > canvasW || py > canvasH) return null;
    if (panels.some((p) => px >= p.x && px < p.x + p.w && py >= p.y && py < p.y + p.h)) return null;
    let y0 = 0;
    let y1 = canvasH;
    panels.concat(lines).forEach((r) => {
        [r.y, r.y + r.h].forEach((e) => {
            if (e <= py && e > y0) y0 = e;
            if (e > py && e < y1) y1 = e;
        });
    });
    let x0 = 0;
    let x1 = canvasW;
    panels.filter((p) => overlapsBand(p, y0, y1)).forEach((p) => {
        if (p.x + p.w <= px && p.x + p.w > x0) x0 = p.x + p.w;
        if (p.x > px && p.x < x1) x1 = p.x;
    });
    if (!(x1 - x0 > 0) || !(y1 - y0 > 0)) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Where a COPY of a panel goes: the next gap in its own band wide enough to
 * take it. A gap that starts where the panel ends takes the copy hard against
 * it (the next pillar along). A gap beyond something else takes it at its FAR
 * end, which is where a mirrored board puts it (an arch's second banner sits
 * against the far leg). To the right first, then to the left. Null when
 * nothing in the band has room.
 */
export function copySpot(panel: Rect, others: Rect[], canvasW: number): Rect | null {
    const y0 = panel.y;
    const y1 = panel.y + panel.h;
    const taken = others.concat([panel]).filter((r) => overlapsBand(r, y0, y1)).sort((a, b) => a.x - b.x);
    const gaps: { a: number; b: number }[] = [];
    let at = 0;
    taken.forEach((r) => {
        if (r.x - at > 0) gaps.push({ a: at, b: r.x });
        at = Math.max(at, r.x + r.w);
    });
    if (canvasW - at > 0) gaps.push({ a: at, b: canvasW });
    const right = gaps.filter((g) => g.a >= panel.x + panel.w && g.b - g.a >= panel.w)[0];
    if (right) return { x: right.a === panel.x + panel.w ? right.a : right.b - panel.w, y: panel.y, w: panel.w, h: panel.h };
    const left = gaps.filter((g) => g.b <= panel.x && g.b - g.a >= panel.w).pop();
    if (left) return { x: left.b === panel.x ? left.b - panel.w : left.a, y: panel.y, w: panel.w, h: panel.h };
    return null;
}

/** The creative of the title sitting in a box, when exactly one creative's titles do. "" otherwise. */
export function creativeIn(box: Rect, titles: CsvTitle[], page: string): string {
    const seen: string[] = [];
    titles.forEach((t) => {
        if (t.page !== page || !t.creative) return;
        const cx = t.box.x + t.box.w / 2;
        const cy = t.box.y + t.box.h / 2;
        if (cx < box.x || cx >= box.x + box.w || cy < box.y || cy >= box.y + box.h) return;
        if (seen.indexOf(t.creative) === -1) seen.push(t.creative);
    });
    return seen.length === 1 ? seen[0] : "";
}

// ---------------------------------------------------------------------------
// MOVING AND SIZING A PANEL ON THE SHEET, WITH MAGNETIC SIDES.
//
// Tracing went because it meant drawing a whole board freehand. This is the
// other half of what it did, kept: nudging a box that is nearly right. A side
// that comes within `reach` of a line it could sit on (another panel's side,
// a run-on window's, the board's edge) takes that line, so two panels meet
// with no gap and no overlap without anybody typing the number.
// ---------------------------------------------------------------------------

export interface Snapped {
    rect: Rect;
    /** The lines the box is now held to, for drawing them. null when free on that axis. */
    atX: number | null;
    atY: number | null;
}

/** Which sides a drag moves. None of them is a move of the whole box. */
export interface Sides { l?: boolean; r?: boolean; t?: boolean; b?: boolean }

const MIN_SIDE = 8;

const pull = (v: number, lines: number[], reach: number): number | null => {
    let best: number | null = null;
    for (const l of lines) {
        const d = Math.abs(l - v);
        if (d <= reach && (best === null || d < Math.abs(best - v))) best = l;
    }
    return best;
};

/** The whole box moved by (dx, dy): whichever of its two sides is nearer a line takes it. */
export function snapMove(r: Rect, dx: number, dy: number, xs: number[], ys: number[], reach: number, canvasW: number, canvasH: number): Snapped {
    const axis = (pos: number, size: number, lines: number[], max: number): { v: number; at: number | null } => {
        const near = pull(pos, lines, reach);
        const far = pull(pos + size, lines, reach);
        let v = pos;
        let at: number | null = null;
        if (near !== null && (far === null || Math.abs(near - pos) <= Math.abs(far - (pos + size)))) { v = near; at = near; }
        else if (far !== null) { v = far - size; at = far; }
        const held = Math.max(0, Math.min(max - size, v));
        return { v: Math.round(held), at: held === v ? at : null };
    };
    const x = axis(r.x + dx, r.w, xs, canvasW);
    const y = axis(r.y + dy, r.h, ys, canvasH);
    return { rect: { x: x.v, y: y.v, w: r.w, h: r.h }, atX: x.at, atY: y.at };
}

/** The named sides dragged by (dx, dy), the others staying where they are. */
export function snapResize(r: Rect, sides: Sides, dx: number, dy: number, xs: number[], ys: number[], reach: number, canvasW: number, canvasH: number): Snapped {
    let x0 = r.x;
    let x1 = r.x + r.w;
    let y0 = r.y;
    let y1 = r.y + r.h;
    let atX: number | null = null;
    let atY: number | null = null;
    if (sides.l) { x0 += dx; const s = pull(x0, xs, reach); if (s !== null) { x0 = s; atX = s; } x0 = Math.max(0, Math.min(x1 - MIN_SIDE, x0)); }
    if (sides.r) { x1 += dx; const s = pull(x1, xs, reach); if (s !== null) { x1 = s; atX = s; } x1 = Math.min(canvasW, Math.max(x0 + MIN_SIDE, x1)); }
    if (sides.t) { y0 += dy; const s = pull(y0, ys, reach); if (s !== null) { y0 = s; atY = s; } y0 = Math.max(0, Math.min(y1 - MIN_SIDE, y0)); }
    if (sides.b) { y1 += dy; const s = pull(y1, ys, reach); if (s !== null) { y1 = s; atY = s; } y1 = Math.min(canvasH, Math.max(y0 + MIN_SIDE, y1)); }
    const rect = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1) - Math.round(x0), h: Math.round(y1) - Math.round(y0) };
    if (atX !== null && atX !== rect.x && atX !== rect.x + rect.w) atX = null;
    if (atY !== null && atY !== rect.y && atY !== rect.y + rect.h) atY = null;
    return { rect, atX, atY };
}
