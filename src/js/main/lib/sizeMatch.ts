// =============================================================================
// src/js/main/lib/sizeMatch.ts
// -----------------------------------------------------------------------------
// THE SIZE FINDER'S RULES, with nothing in them that needs a panel: what a
// delivered file's name says, how two names are the same deliverable, and how
// close one shape is to another. Kept free of imports so
// `node scripts/probe-size-finder.mjs` can run them as they ship.
//
// A SIZE IS ONLY A SIZE WHEN IT IS A TOKEN (CLAUDE.md): between underscores,
// three digits a side, optional `px`. A site's grid (`Hoyts3x3`) and a mech
// ratio (`_9x16_`) are neither.
// =============================================================================

export interface SizeInfo { w: number; h: number; seconds: number }

/** The size and length a deliverable's name carries, or null with no size. */
export function sizeOfName(name: string): SizeInfo | null {
    const toks = String(name || "").replace(/\.[A-Za-z0-9]{2,4}$/, "").split(/[_ ]+/);
    let w = 0;
    let h = 0;
    let seconds = 0;
    for (const t of toks) {
        if (!w) {
            const m = /^(\d{3,})x(\d{3,})(?:px)?$/i.exec(t);
            if (m) { w = parseInt(m[1], 10); h = parseInt(m[2], 10); continue; }
        }
        if (!seconds) {
            const d = /^(\d{1,3})s(?:ec)?$/i.exec(t);
            if (d) seconds = parseInt(d[1], 10);
        }
    }
    return w && h ? { w, h, seconds } : null;
}

/**
 * One deliverable, however a folder spells it. The PDFs are named by the mech
 * team and the renders by us, and they differ in ways that mean nothing:
 * `Digital_Metro` against `DigitalMetro`, `_V2` against `_V01`, a `_9x16`
 * ratio beside the size, `_DOUBLE_RES` on a render. All of that comes off and
 * the rest is squashed. The size and the length stay in, so two deliverables
 * can never fold into one.
 */
export function deliverableSquash(name: string): string {
    let s = String(name || "").replace(/\.[A-Za-z0-9]{2,4}$/, "");
    s = s.replace(/_(?:DOUBLE|TRIPLE|QUAD)_RES$/i, "").replace(/_V\d+$/i, "").replace(/_(?:DOUBLE|TRIPLE|QUAD)_RES$/i, "");
    const kept: string[] = [];
    for (const t of s.split(/[_ ]+/)) {
        if (/^\d{1,2}x\d{1,2}$/i.test(t)) continue; // a ratio, never a size
        kept.push(t);
    }
    let out = kept.join("").toUpperCase();
    if (typeof out.normalize === "function") out = out.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return out.replace(/[^A-Z0-9]/g, "");
}

/**
 * The CREATIVE a deliverable belongs to: the token left of the artwork type
 * (`SF_INTL_Trio_DOOH_…` is Trio), which is the third in both conventions. A
 * legacy name spends that slot on `DGTL` and names no creative, so "" there.
 */
export function creativeOfName(name: string): string {
    const toks = String(name || "").split(/[_ ]+/);
    if (toks.length < 5) return "";
    const c = toks[2];
    if (!c || /^DGTL$/i.test(c) || /^\d+x\d+/i.test(c)) return "";
    return c;
}

/**
 * The MARKET a deliverable was made for: the token straight after its length
 * (`…_10s_DK`, `…_15s_BE_FL` is BE). Never OV, never anything not shaped like
 * a market code. "" when the name doesn't say.
 */
export function marketOfName(name: string): string {
    const toks = String(name || "").replace(/\.[A-Za-z0-9]{2,4}$/, "").split(/[_ ]+/);
    for (let i = 0; i < toks.length - 1; i++) {
        if (!/^\d{1,3}s(?:ec)?$/i.test(toks[i])) continue;
        const t = toks[i + 1];
        if (/^[A-Za-z]{2,3}$/.test(t) && t.toUpperCase() !== "OV") return t.toUpperCase();
        return "";
    }
    return "";
}

/** The `_Vnn` a name ends on (before any RES tail), 0 when it has none. */
export function versionOf(name: string): number {
    const s = String(name || "").replace(/\.[A-Za-z0-9]{2,4}$/, "").replace(/_(?:DOUBLE|TRIPLE|QUAD)_RES$/i, "");
    const m = /_V(\d+)$/i.exec(s);
    return m ? parseInt(m[1], 10) : 0;
}

export interface Closeness {
    /** How far the SHAPE is off, as |ln(ratio / wanted ratio)|. 0 is the same shape. */
    shape: number;
    /** How far the SCALE is off, as |ln(linear scale)|. 0 is the same size. */
    scale: number;
    /** What to say on the card. */
    label: string;
    kind: "exact" | "same-shape" | "near";
}

const pct = (n: number) => {
    const p = (n - 1) * 100;
    return p < 10 ? String(Math.round(p * 10) / 10) : String(Math.round(p));
};

/**
 * How close `have` is to `want`. SHAPE FIRST: a 1080x1080 answers "400x400"
 * better than a 400x420 does, because a square scales to a square and nothing
 * scales a near-square into one. Scale only orders things of the same shape.
 */
export function closeness(want: { w: number; h: number }, have: { w: number; h: number }): Closeness {
    const r = (have.w / have.h) / (want.w / want.h);
    const lin = Math.sqrt((have.w * have.h) / (want.w * want.h));
    const shape = Math.abs(Math.log(r));
    const scale = Math.abs(Math.log(lin));
    if (have.w === want.w && have.h === want.h) return { shape: 0, scale: 0, label: "Exact size", kind: "exact" };
    // Under half a percent off is a rounding of the same shape (1920x1080
    // against 1280x720 is exact; 854x480 against 16:9 is not quite).
    // THE LABEL IS ABOUT THE RATIO, not the scale: the size is already on the
    // card, and "2.8× larger" answered a question nobody asked. What is being
    // judged is how far the shape is from the one typed.
    if (shape < 0.005) {
        return { shape: 0, scale, label: `Same ratio · ${ratioLabel(have.w, have.h)}`, kind: "same-shape" };
    }
    const off = r > 1 ? `${pct(r)}% wider` : `${pct(1 / r)}% taller`;
    return { shape, scale, label: `${ratioLabel(have.w, have.h)} · ${off}`, kind: "near" };
}

/**
 * WIGGLE ROOM: a ratio within this much of the row's own (10% wider or
 * taller) is close enough to be worth a look. A 768x1280 row is told about an
 * 800x1280, which reframes with a nudge; it is not told about a 512x1280.
 */
export const NEAR_RATIO = 0.1;

/**
 * How many times an approved deliverable of `haveSeconds` is played to fill a
 * row of `rowSeconds`: 1 the same length, 2 or 3 when it goes in exactly that
 * many times (a 30s row from a 15s or a 10s), 0 when it can't be used. A
 * length nobody stated on either side is not a reason to refuse.
 */
export function repeatFor(rowSeconds: number, haveSeconds: number): number {
    if (!rowSeconds || !haveSeconds || rowSeconds === haveSeconds) return 1;
    if (haveSeconds * 2 === rowSeconds) return 2;
    if (haveSeconds * 3 === rowSeconds) return 3;
    return 0;
}

/**
 * How many of `rows` are one creative at exactly this size, how many more at
 * the same ratio, and how many CLOSE to it (NEAR_RATIO). What the "seen
 * before" hint on a batch row is counted from. A blank creative counts
 * nothing: the hint is about THIS creative. With `seconds`, only lengths the
 * row could be built from are counted (repeatFor), so the count matches what
 * the window opened from it lists.
 */
export function countAtRatio(
    rows: { w: number; h: number; creative: string; seconds?: number }[],
    w: number,
    h: number,
    creative: string,
    seconds?: number
): { exact: number; same: number; near: number } {
    const want = String(creative || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    let exact = 0;
    let same = 0;
    let near = 0;
    if (!want || !(w > 0) || !(h > 0)) return { exact, same, near };
    const room = Math.log(1 + NEAR_RATIO) + 1e-9;
    for (const r of rows) {
        if (String(r.creative || "").toUpperCase().replace(/[^A-Z0-9]/g, "") !== want) continue;
        if (seconds && !repeatFor(seconds, r.seconds || 0)) continue;
        const c = closeness({ w, h }, r);
        if (c.kind === "exact") exact++;
        else if (c.kind === "same-shape") same++;
        else if (c.shape <= room) near++;
    }
    return { exact, same, near };
}

/** Sort order for results: shape, then scale, then the newer-looking name. */
export function byCloseness(a: Closeness, b: Closeness): number {
    if (a.kind === "exact" && b.kind !== "exact") return -1;
    if (b.kind === "exact" && a.kind !== "exact") return 1;
    if (Math.abs(a.shape - b.shape) > 1e-9) return a.shape - b.shape;
    return a.scale - b.scale;
}

/**
 * A size's ratio the way people say it: "2:1", "16:9", "9:16". When the
 * numbers do not reduce to something sayable (1160x800 is 29:20) it is given
 * against 1 instead, "1.45:1", which is the form that can be compared by eye.
 */
export function ratioLabel(w: number, h: number): string {
    if (!(w > 0) || !(h > 0)) return "";
    let a = Math.round(w);
    let b = Math.round(h);
    while (b) { const t = a % b; a = b; b = t; }
    const rw = Math.round(w) / a;
    const rh = Math.round(h) / a;
    if (rw <= 21 && rh <= 21) return rw + ":" + rh;
    const dec = (n: number) => String(Math.round(n * 100) / 100);
    return w >= h ? dec(w / h) + ":1" : "1:" + dec(h / w);
}

/**
 * THE MECH SHEET in a deliverable's JPG_PNG folder: the JPG named exactly as
 * the folder is. Its numbered neighbours (`…_NO2.jpg`) and `…_ARTWORK_1.jpg`
 * are artwork slots, and squash to something else. "" when there is none.
 */
export function pickSheet(folderName: string, fileNames: string[]): string {
    const want = deliverableSquash(folderName);
    for (const n of fileNames) {
        if (!/\.jpe?g$/i.test(n) || n.charAt(0) === ".") continue;
        if (deliverableSquash(n) === want) return n;
    }
    return "";
}

/**
 * EVERY PICTURE in a deliverable's JPG_PNG folder, in the order to page
 * through: the sheet first (it is what the PDF looks like), then the rest by
 * name with numbers in order (`…NO2` before `…NO10`). A folder often holds
 * more than the sheet -- each artwork slot, and the `_ARTWORK_` extras.
 */
export function sheetImages(folderName: string, fileNames: string[]): string[] {
    const pics = fileNames.filter((n) => /\.(jpe?g|png)$/i.test(n) && n.charAt(0) !== ".");
    const sheet = pickSheet(folderName, pics);
    const rest = pics.filter((n) => n !== sheet).sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }));
    return sheet ? [sheet].concat(rest) : rest;
}

/** "400x400", "400 x 400", "400*400", "400, 400" -> a size, else null. */
export function parseWanted(text: string): { w: number; h: number } | null {
    const m = /^\s*(\d{2,5})\s*(?:px)?\s*[x×*,: ]\s*(\d{2,5})\s*(?:px)?\s*$/i.exec(String(text || ""));
    if (!m) return null;
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    return w > 0 && h > 0 ? { w, h } : null;
}
