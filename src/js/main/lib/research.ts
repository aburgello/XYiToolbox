// =============================================================================
// src/js/main/lib/research.ts
// -----------------------------------------------------------------------------
// EOC RESEARCH'S RULES, with nothing in them that needs a panel: what the
// Project_Research archive holds, how a clip finds its stills, what a run's
// manifest says, and which renders of a campaign a run would archive.
//
// The archive is <root>/<Film>/<Section…>/files, and TWO generations of file
// live in it:
//   - hand-made:  `<name>.mp4` beside `<name> (0-00-11-00).jpg` stills at
//                 chosen timecodes (Novacaine, Wicked, MI8), or stills alone
//                 (Fast X, Migration, Trolls 3);
//   - the tool's: `<Territory>_<Batch>_<name>.mp4` beside
//                 `…_LASTFRAME.jpg`, with a `_RESEARCH_MANIFEST.txt` saying
//                 where each came from.
// A browse reads both and asks neither to be renamed.
//
// The lister is an ARGUMENT so `node scripts/probe-research.mjs` can run this
// over a stub tree; in the panel it is Node's readdir. Nothing here writes.
//
// A LEADING `_` MEANS TWO THINGS HERE. In a campaign's Renders it is the usual
// "leave this folder alone" (`_Delivery`, `_mp4`, `_Old`), and a run skips it.
// In the ARCHIVE it is how the hand-made films sort by shape: every file is
// `_0.56_<name>` (width over height), and a film can keep a `_DEV` folder. So
// reading the archive skips dot files and nothing else, and that ratio prefix
// comes off the name that is shown.
// =============================================================================
import { sizeOfName, versionOf } from "./sizeMatch";

export interface Kid { name: string; path: string; dir: boolean }
export type Lister = (dir: string) => Promise<Kid[]>;

export const MANIFEST_NAME = "_RESEARCH_MANIFEST.txt";
export const STILL_TAIL = "_LASTFRAME";

export interface Still {
    name: string;
    path: string;
    /** "0:11" for a timecoded still, "last frame" for the tool's, "" otherwise. */
    label: string;
    /** Seconds into the clip, or -1 when the name doesn't say. */
    at: number;
}

export interface ResearchItem {
    id: string;
    film: string;
    /** The folder under the film, as the disk spells it ("LOCALISED/EXTREMES"). */
    section: string;
    /** The clip's name, extension off; a stills-only item's shared stem. */
    name: string;
    /** A file the panel can play, or "". */
    clip: string;
    stills: Still[];
    w: number;
    h: number;
    seconds: number;
    /** The market token off the name: "NO", "OV", "" when it carries none. */
    market: string;
    /** The Markets folder and batch it was rendered from, when a manifest says. */
    territory: string;
    batch: string;
    /** The render it was made from, when a manifest says. */
    source: string;
}

export interface ManifestRow { status: string; prefix: string; path: string; note: string }

export interface FilmScan {
    film: string;
    items: ResearchItem[];
    /** Stills still carrying AE's frame number (`.jpg00359`), as rename pairs. */
    misnamed: { from: string; to: string }[];
    /** Manifests found, each with its folder and how far it got. */
    runs: { folder: string; section: string; total: number; todo: number; sourceRoot: string }[];
}

const lower = (s: string) => String(s).toLowerCase();
/** Never listed anywhere: dot files. */
const dotted = (n: string) => n.charAt(0) === ".";
/** Left alone in a campaign's Renders: dot files, and `_` folders and files. */
const hidden = (n: string) => n.charAt(0) === "." || n.charAt(0) === "_";
/** `_0.56_NAME` -> `NAME`: the archive's sort-by-shape prefix. */
export const withoutRatio = (n: string) => String(n).replace(/^_\d+\.\d+_/, "");

const CLIP = /\.(mp4|m4v|mov|webm)$/i;
/** A picture, including one AE left its frame number on (`x.jpg00359`). */
const PICTURE = /\.(jpe?g|png)(\d{3,6})?$/i;
/** H.264's temp file while a render is muxing: never a clip to show. */
const TEMP = /\.\d+\.\d+\.m4v$/i;

export const isClipName = (n: string) => CLIP.test(n) && !TEMP.test(n);
export const isPictureName = (n: string) => PICTURE.test(n);

/** "0-00-11-00" (h-mm-ss-ff) -> seconds. Frames are read at 25. */
function timecodeSeconds(tc: string): number {
    const p = tc.split("-").map((v) => parseInt(v, 10));
    if (p.length !== 4 || p.some((v) => isNaN(v))) return -1;
    return p[0] * 3600 + p[1] * 60 + p[2] + p[3] / 25;
}

const clock = (s: number) => {
    const whole = Math.floor(s);
    const m = Math.floor(whole / 60);
    const sec = whole % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
};

/** What a still's name says: the clip it belongs to, and where in it. */
export function stillOf(name: string): { base: string; label: string; at: number } {
    let s = String(name).replace(PICTURE, "");
    const tc = /\s*\((\d+-\d{2}-\d{2}-\d{2})\)$/.exec(s);
    if (tc) {
        const at = timecodeSeconds(tc[1]);
        return { base: s.slice(0, s.length - tc[0].length), label: at >= 0 ? clock(at) : "", at };
    }
    // The tool's own: `_LASTFRAME`, and AE's frame number when it sits before
    // the extension (`_LASTFRAME_00359.jpg`).
    const last = /_LASTFRAME(?:_\d{3,6})?$/i.exec(s);
    if (last) return { base: s.slice(0, s.length - last[0].length), label: "last frame", at: -1 };
    return { base: s, label: "", at: -1 };
}

/**
 * STILLS THAT KEPT AE'S FRAME NUMBER, as rename pairs. The render queue writes
 * a one-frame JPEG as `<name>.jpg00359` (or `<name>_00359.jpg` when the name
 * asks for a counter), and the first tool looked for `.jpg` at the END of the
 * name, so it renamed none of them: a thousand in The Odyssey. Only the tool's
 * own `_LASTFRAME` stills are touched, and never onto a name already taken.
 */
export function tidyPlan(names: string[]): { from: string; to: string }[] {
    const have: Record<string, true> = {};
    names.forEach((n) => { have[lower(n)] = true; });
    const out: { from: string; to: string }[] = [];
    for (const n of names) {
        const m = /^(.*_LASTFRAME)(?:\.jpe?g(\d{3,6})|_(\d{3,6})\.jpe?g)$/i.exec(n);
        if (!m) continue;
        const to = m[1] + ".jpg";
        if (have[lower(to)]) continue;
        have[lower(to)] = true;
        out.push({ from: n, to });
    }
    return out;
}

/** The market a name was made for, OV included ("" when it doesn't say). */
export function marketOf(name: string): string {
    const toks = String(name || "").split(/[_ ]+/);
    for (let i = 0; i < toks.length - 1; i++) {
        if (!/^\d{1,3}s(?:ec)?$/i.test(toks[i])) continue;
        const t = toks[i + 1];
        return /^[A-Za-z]{2,3}$/.test(t) ? t.toUpperCase() : "";
    }
    return "";
}

// --- the manifest ------------------------------------------------------------

/** STATUS \t PREFIX \t SOURCE [\t NOTE], `#` lines ignored. The first tool
 *  wrote it with bare CRs, so every line ending is taken. */
export function parseManifest(text: string): ManifestRow[] {
    const rows: ManifestRow[] = [];
    for (const line of String(text || "").split(/\r\n|\r|\n/)) {
        if (!line || line.charAt(0) === "#") continue;
        const p = line.split("\t");
        if (p.length < 3) continue;
        rows.push({ status: p[0], prefix: p[1], path: p[2], note: p[3] || "" });
    }
    return rows;
}

export function manifestText(rows: ManifestRow[], stamp: string): string {
    const clean = (s: string) => String(s || "").replace(/[\t\r\n]+/g, " ");
    const lines = ["# Research Renders manifest — " + stamp, "# STATUS<tab>PREFIX<tab>SOURCE<tab>NOTE"];
    for (const r of rows) lines.push([r.status, clean(r.prefix), clean(r.path), clean(r.note)].join("\t"));
    return lines.join("\n") + "\n";
}

/** `…/<Market>/Renders/<Batch>/x.mov` -> the market and the batch. */
export function placeOfSource(path: string): { territory: string; batch: string } {
    const parts = String(path || "").split(/[\\/]+/);
    let at = -1;
    for (let i = parts.length - 2; i > 0; i--) if (lower(parts[i]) === "renders") { at = i; break; }
    if (at < 1) return { territory: "", batch: "" };
    return { territory: parts[at - 1], batch: at + 1 < parts.length - 1 ? parts[at + 1] : "" };
}

/** The folder a manifest's sources all sit under: what the run was pointed at. */
export function sourceRootOf(rows: ManifestRow[]): string {
    let common: string[] | null = null;
    for (const r of rows) {
        const parts = String(r.path).split("/");
        let at = -1;
        for (let i = parts.length - 2; i > 0; i--) if (lower(parts[i]) === "renders") { at = i; break; }
        if (at < 1) return "";
        const above = parts.slice(0, at - 1); // the folder holding the market
        if (!common) { common = above; continue; }
        let n = 0;
        while (n < common.length && n < above.length && common[n] === above[n]) n++;
        common = common.slice(0, n);
    }
    return common && common.length > 1 ? common.join("/") : "";
}

// --- reading the archive -----------------------------------------------------

/** The films under the archive root: its folders. */
export async function listFilms(root: string, list: Lister): Promise<Kid[]> {
    return (await list(root)).filter((k) => k.dir && !dotted(k.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** One folder's files, paired: each clip with its stills, and stills with no clip as their own item. */
export function pairFolder(film: string, section: string, kids: Kid[], manifest: Record<string, ManifestRow>): ResearchItem[] {
    const clips: Record<string, Kid> = {};
    const order: string[] = [];
    const loose: Record<string, Still[]> = {};
    const mine: Record<string, Still[]> = {};
    for (const k of kids) {
        if (k.dir || dotted(k.name) || !isClipName(k.name)) continue;
        const stem = k.name.replace(CLIP, "");
        // Two containers of one clip: the mp4 is the one Chromium plays.
        if (clips[stem] && !/\.mp4$/i.test(k.name)) continue;
        if (!clips[stem]) order.push(stem);
        clips[stem] = k;
    }
    for (const k of kids) {
        if (k.dir || dotted(k.name) || !isPictureName(k.name)) continue;
        const s = stillOf(k.name);
        const still: Still = { name: k.name, path: k.path, label: s.label, at: s.at };
        if (clips[s.base]) (mine[s.base] = mine[s.base] || []).push(still);
        else {
            if (!loose[s.base]) order.push("\n" + s.base);
            (loose[s.base] = loose[s.base] || []).push(still);
        }
    }
    const byTime = (a: Still, b: Still) => (a.at - b.at) || a.name.localeCompare(b.name, undefined, { numeric: true });
    return order.map((key) => {
        const stillsOnly = key.charAt(0) === "\n";
        const stem = stillsOnly ? key.slice(1) : key;
        // Aspect Ratio Rename may have put `_1.67_` on the file since: the
        // manifest still knows it by the name it was rendered under.
        const row = manifest[stem] || manifest[withoutRatio(stem)];
        const place = row ? placeOfSource(row.path) : { territory: "", batch: "" };
        // The tool's own names lead with "<Territory>_<Batch>_"; what is shown
        // and parsed is the render's own name, off the manifest's source.
        const own = row ? String(row.path).split(/[\\/]+/).pop()!.replace(/\.[A-Za-z0-9]{2,4}$/, "") : withoutRatio(stem);
        const info = sizeOfName(own) || sizeOfName(stem);
        const stills = ((stillsOnly ? loose[stem] : mine[stem]) || []).slice().sort(byTime);
        return {
            id: film + "/" + section + "/" + key,
            film,
            section,
            name: own,
            clip: stillsOnly ? "" : clips[stem].path,
            stills,
            w: info ? info.w : 0,
            h: info ? info.h : 0,
            seconds: info ? info.seconds : 0,
            market: marketOf(own),
            territory: place.territory,
            batch: place.batch,
            source: row ? row.path : "",
        };
    });
}

/**
 * Everything in one film's folder. `read` fetches a manifest's text ("" when
 * it can't); the walk is breadth-first and capped, so a stray deep tree
 * cannot hold the panel.
 */
export async function scanFilm(film: Kid, list: Lister, read: (path: string) => Promise<string>): Promise<FilmScan> {
    const out: FilmScan = { film: film.name, items: [], misnamed: [], runs: [] };
    const queue: { path: string; section: string; depth: number }[] = [{ path: film.path, section: "", depth: 0 }];
    let guard = 0;
    while (queue.length && guard++ < 600) {
        const at = queue.shift() as { path: string; section: string; depth: number };
        const kids = await list(at.path);
        const manifest: Record<string, ManifestRow> = {};
        const hasManifest = kids.some((k) => !k.dir && k.name === MANIFEST_NAME);
        if (hasManifest) {
            const rows = parseManifest(await read(at.path + "/" + MANIFEST_NAME));
            rows.forEach((r) => { manifest[r.prefix] = r; });
            const names: Record<string, true> = {};
            // Past a `_1.67_` sort prefix: a renamed clip is still that clip.
            kids.forEach((k) => { names[withoutRatio(k.name)] = true; });
            // Done is what is ON DISK, never what a line claims.
            const todo = rows.filter((r) => !names[r.prefix + ".mp4"]).length;
            out.runs.push({ folder: at.path, section: at.section, total: rows.length, todo, sourceRoot: sourceRootOf(rows) });
        }
        tidyPlan(kids.filter((k) => !k.dir).map((k) => k.name))
            .forEach((p) => out.misnamed.push({ from: at.path + "/" + p.from, to: at.path + "/" + p.to }));
        out.items.push(...pairFolder(film.name, at.section, kids, manifest));
        for (const k of kids) {
            if (!k.dir || dotted(k.name) || at.depth >= 5) continue;
            queue.push({ path: k.path, section: at.section ? at.section + "/" + k.name : k.name, depth: at.depth + 1 });
        }
    }
    return out;
}

// --- what a run would archive ------------------------------------------------

export interface Job {
    /** The render to read. */
    src: string;
    /** What it is called in the archive, extension off. */
    prefix: string;
    market: string;
    batch: string;
    /** The render's own name, extension off. */
    stem: string;
}

/** A name safe as one path segment: the first tool's rule, kept so a resumed
 *  run lands on the names already there. */
export function safeName(s: string): string {
    return String(s).replace(/[^A-Za-z0-9_\-.]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

const isMov = (n: string) => /\.mov$/i.test(n);

async function movsUnder(dir: string, list: Lister, depth = 5): Promise<Kid[]> {
    const out: Kid[] = [];
    const stack: { p: string; d: number }[] = [{ p: dir, d: 0 }];
    let guard = 0;
    while (stack.length && guard++ < 800) {
        const at = stack.pop() as { p: string; d: number };
        const kids = (await list(at.p)).slice().sort((a, b) => a.name.localeCompare(b.name));
        for (const k of kids) {
            if (hidden(k.name)) continue;
            if (k.dir) { if (at.d < depth) stack.push({ p: k.path, d: at.d + 1 }); continue; }
            if (isMov(k.name)) out.push(k);
        }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Every render under a Markets root, or under one market, as jobs:
 * `<Market>/Renders/<Batch>/**` with `_` folders left alone (so `_Delivery`,
 * `_mp4` and `_Old` never double a deliverable). A folder that is neither is
 * read as a plain folder of renders, named by where each file sits in it.
 * Two renders that would take one archive name get `_2`, `_3`: the first tool
 * let the second overwrite or stack as `_v2`.
 */
export async function scanSource(root: string, list: Lister): Promise<Job[]> {
    const base = root.replace(/[\\/]+$/, "");
    const rootName = base.split(/[\\/]+/).pop() || "";
    const top = await list(base);
    const rendersOf = (kids: Kid[]) => kids.find((k) => k.dir && lower(k.name) === "renders") || null;
    const jobs: Job[] = [];

    const market = async (name: string, renders: Kid) => {
        const kids = (await list(renders.path)).slice().sort((a, b) => a.name.localeCompare(b.name));
        for (const b of kids) {
            if (hidden(b.name)) continue;
            if (b.dir) {
                for (const m of await movsUnder(b.path, list)) {
                    const stem = m.name.replace(/\.mov$/i, "");
                    jobs.push({ src: m.path, market: name, batch: b.name, stem, prefix: [safeName(name), safeName(b.name), safeName(stem)].join("_") });
                }
            } else if (isMov(b.name)) {
                const stem = b.name.replace(/\.mov$/i, "");
                jobs.push({ src: b.path, market: name, batch: "", stem, prefix: [safeName(name), safeName(stem)].join("_") });
            }
        }
    };

    const own = rendersOf(top);
    if (own) {
        await market(rootName, own);
    } else {
        let found = false;
        for (const k of top.slice().sort((a, b) => a.name.localeCompare(b.name))) {
            if (!k.dir || hidden(k.name)) continue;
            const r = rendersOf(await list(k.path));
            if (!r) continue;
            found = true;
            await market(k.name, r);
        }
        if (!found) {
            for (const m of await movsUnder(base, list)) {
                const rel = m.path.slice(base.length).split(/[\\/]+/).filter(Boolean);
                rel.pop();
                const stem = m.name.replace(/\.mov$/i, "");
                jobs.push({ src: m.path, market: rel[0] || "", batch: rel.slice(1).join("/"), stem, prefix: rel.map(safeName).concat(safeName(stem)).filter(Boolean).join("_") });
            }
        }
    }

    const taken: Record<string, number> = {};
    for (const j of jobs) {
        const key = lower(j.prefix);
        const n = (taken[key] = (taken[key] || 0) + 1);
        if (n > 1) j.prefix = j.prefix + "_" + n;
    }
    return jobs;
}

/** A render's name with its version off (the RES tail is the deliverable's, and stays). */
const versionless = (stem: string) => stem.replace(/_V\d+(?=(?:_(?:DOUBLE|TRIPLE|QUAD)_RES)?$)/i, "");

/** One job per deliverable in each folder: the highest `_Vnn`. */
export function newestOnly(jobs: Job[]): Job[] {
    const best: Record<string, Job> = {};
    for (const j of jobs) {
        // Per FOLDER: the same name in two folders of a batch is two things.
        const key = lower(j.src.replace(/[\\/][^\\/]*$/, "") + "\n" + versionless(j.stem));
        const cur = best[key];
        if (!cur || versionOf(j.stem) > versionOf(cur.stem)) best[key] = j;
    }
    const keep: Record<string, true> = {};
    Object.keys(best).forEach((k) => { keep[best[k].src] = true; });
    return jobs.filter((j) => keep[j.src]);
}

/** Which prefixes a destination already holds: the clip, and the still. */
export function archived(names: string[]): { clip: Record<string, true>; still: Record<string, true> } {
    const clip: Record<string, true> = {};
    const still: Record<string, true> = {};
    // A film sorted by shape (Check's Aspect Ratio Rename puts `_1.67_` on
    // every name) is the same film: read past the prefix, or everything
    // already there reads as still to add and is rendered again.
    for (const full of names) {
        const n = withoutRatio(full);
        if (/\.mp4$/i.test(n)) clip[n.slice(0, -4)] = true;
        else if (isPictureName(n) && /_LASTFRAME/i.test(n)) still[stillOf(n).base] = true;
    }
    return { clip, still };
}
