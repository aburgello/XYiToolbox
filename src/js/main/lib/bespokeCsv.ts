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
