// =============================================================================
// src/js/main/lib/sizeScan.ts
// -----------------------------------------------------------------------------
// EVERY APPROVED DELIVERABLE UNDER A MARKETS ROOT, read off folder listings.
//
// "Approved" is a place, not a status: a file in a `_Delivery` folder under a
// territory's `Renders` went out, so somebody signed it off. Nothing here asks
// Wrike and nothing opens a file.
//
// Each one is paired, by name, with what lets a person recognise it:
//   - something Chromium can PLAY: the delivered file itself when it is an
//     mp4 (most are), else its twin in the batch's `_mp4`;
//   - its mech PDF from `<Territory>/PDFs`, whichever batch folder it sits in;
//   - its folder in `<Territory>/JPG_PNG`, which holds the JPG exported from
//     that PDF. The panel cannot draw a PDF (pdf.js takes its Node branch in
//     CEP and asks for a `canvas` module that is not there), so the JPG is
//     what gets SHOWN and the PDF is what gets opened.
// Either may be missing, and a deliverable with neither is still listed: the
// size is the fact being looked for.
//
// The lister is an ARGUMENT so `node scripts/probe-size-finder.mjs` can run
// this over a stub tree. In the panel it is Node's readdir (about a second a
// campaign); it only ever lists. `_` folders are skipped except the ones this
// is FOR (`_Delivery`, `_mp4`) and `PDFs/_Delivered`, where a batch's PDFs go
// once it has shipped.
// =============================================================================
import { creativeOfName, deliverableSquash, folderIsRow, RowSpec, sizeOfName, versionOf } from "./sizeMatch";

export interface Kid { name: string; path: string; dir: boolean }
export type Lister = (dir: string) => Promise<Kid[]>;

export interface Approved {
    id: string;
    campaign: string;
    territory: string;
    /** Trio, Characters… off the name. "" when the name carries none. */
    creative: string;
    /** The batch folder it was delivered from, "" for the territory-level _Delivery. */
    batch: string;
    /** The delivered file's name, extension off. */
    name: string;
    w: number;
    h: number;
    seconds: number;
    delivered: string;
    /** A file the panel can play, or "". */
    preview: string;
    pdf: string;
    /** The territory's PDFs folder, for when no PDF pairs by name. "" if none. */
    pdfFolder: string;
    /** Its JPG_PNG folder (named as the deliverable is), where the sheet's JPG is. "" if none. */
    artFolder: string;
    artFolderName: string;
}

const lower = (s: string) => String(s).toLowerCase();
const hidden = (n: string) => n.charAt(0) === ".";
const child = (list: Kid[], name: string) => list.find((k) => k.dir && lower(k.name) === lower(name)) || null;

/** Every file under `dir`, depth-capped. `skip` decides which folders to leave. */
async function walk(list: Lister, dir: string, skip: (name: string) => boolean, depth = 4): Promise<Kid[]> {
    const out: Kid[] = [];
    const stack: { p: string; d: number }[] = [{ p: dir, d: 0 }];
    let guard = 0;
    while (stack.length && guard++ < 400) {
        const at = stack.pop() as { p: string; d: number };
        for (const k of await list(at.p)) {
            if (hidden(k.name)) continue;
            if (k.dir) {
                if (at.d < depth && !skip(k.name)) stack.push({ p: k.path, d: at.d + 1 });
                continue;
            }
            out.push(k);
        }
    }
    return out;
}

async function scanTerritory(campaign: string, terr: Kid, list: Lister): Promise<Approved[]> {
    const top = await list(terr.path);
    const renders = child(top, "Renders");
    if (!renders) return [];
    const rdKids = await list(renders.path);

    // Where delivered files live: Renders/_Delivery, and each batch's own.
    const sources: { folder: Kid; batch: string }[] = [];
    const previewFolders: Kid[] = [];
    const own = child(rdKids, "_Delivery");
    if (own) sources.push({ folder: own, batch: "" });
    const batches = rdKids.filter((k) => k.dir && k.name.charAt(0) !== "_" && !hidden(k.name));
    const inBatches = await Promise.all(batches.map((b) => list(b.path)));
    batches.forEach((b, i) => {
        const dl = child(inBatches[i], "_Delivery");
        if (dl) sources.push({ folder: dl, batch: b.name });
        const mp = child(inBatches[i], "_mp4");
        if (mp) previewFolders.push(mp);
    });
    if (!sources.length) return [];

    // Playable twins, newest version per deliverable.
    const previews: Record<string, { path: string; v: number }> = {};
    for (const pf of previewFolders) {
        for (const k of await list(pf.path)) {
            if (k.dir || hidden(k.name) || !/\.(mp4|m4v)$/i.test(k.name)) continue;
            const key = deliverableSquash(k.name);
            const v = versionOf(k.name);
            if (!previews[key] || v > previews[key].v) previews[key] = { path: k.path, v };
        }
    }

    // Mech PDFs, newest version per deliverable, wherever under PDFs they sit.
    const pdfs: Record<string, { path: string; v: number }> = {};
    const pdfRoot = child(top, "PDFs");
    if (pdfRoot) {
        const skip = (n: string) => n.charAt(0) === "_" && lower(n) !== "_delivered";
        for (const k of await walk(list, pdfRoot.path, skip, 3)) {
            if (!/\.pdf$/i.test(k.name)) continue;
            const key = deliverableSquash(k.name);
            const v = versionOf(k.name);
            if (!pdfs[key] || v > pdfs[key].v) pdfs[key] = { path: k.path, v };
        }
    }

    // JPG_PNG: one folder per deliverable, under a batch folder or (no batch
    // level, Panama) straight under JPG_PNG. A folder named with a size is a
    // deliverable's; anything else is taken as a batch and looked inside.
    const art: Record<string, Kid> = {};
    const jp = child(top, "JPG_PNG");
    if (jp) {
        const level = (await list(jp.path)).filter((k) => k.dir && k.name.charAt(0) !== "_" && !hidden(k.name));
        const batchLike = level.filter((k) => !sizeOfName(k.name));
        level.filter((k) => sizeOfName(k.name)).forEach((k) => { art[deliverableSquash(k.name)] = k; });
        const inside = await Promise.all(batchLike.map((b) => list(b.path)));
        inside.forEach((kidsIn) => kidsIn.forEach((k) => {
            if (!k.dir || k.name.charAt(0) === "_" || hidden(k.name) || !sizeOfName(k.name)) return;
            const key = deliverableSquash(k.name);
            if (!art[key]) art[key] = k;
        }));
    }

    const out: Approved[] = [];
    const seen: Record<string, number> = {};
    for (const src of sources) {
        for (const k of await walk(list, src.folder.path, () => false, 4)) {
            if (!/\.(mp4|mov|m4v)$/i.test(k.name)) continue;
            const info = sizeOfName(k.name);
            if (!info) continue; // not named as a deliverable: nothing to match a size against
            const key = deliverableSquash(k.name);
            const playable = /\.(mp4|m4v)$/i.test(k.name);
            const row: Approved = {
                id: campaign + "|" + terr.name + "|" + key,
                campaign, territory: terr.name, batch: src.batch,
                creative: creativeOfName(k.name),
                name: k.name.replace(/\.[A-Za-z0-9]{2,4}$/, ""),
                w: info.w, h: info.h, seconds: info.seconds,
                delivered: k.path,
                preview: playable ? k.path : (previews[key] ? previews[key].path : ""),
                pdf: pdfs[key] ? pdfs[key].path : "",
                pdfFolder: pdfRoot ? pdfRoot.path : "",
                artFolder: art[key] ? art[key].path : "",
                artFolderName: art[key] ? art[key].name : "",
            };
            // One row per deliverable: the same file is often in the batch's
            // _Delivery AND the territory's. A playable copy beats a .mov.
            if (seen[key] === undefined) { seen[key] = out.length; out.push(row); continue; }
            const had = out[seen[key]];
            if (!had.preview && row.preview) out[seen[key]] = row;
            // The batch it went out from is worth more than the territory-level
            // copy: it is where its project is (findApprovedProject).
            if (!out[seen[key]].batch && (row.batch || had.batch)) out[seen[key]] = { ...out[seen[key]], batch: row.batch || had.batch };
        }
    }
    return out;
}

const looseBatch = (n: string) => String(n).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|\D)0+(\d)/g, "$1$2");

/**
 * The PROJECT an approved deliverable was rendered from:
 * `<Territory>/AE/<Batch>/<name>_Vnn.aep`, newest version. The batch is the
 * one it was delivered from (paired loosely: Renders' `Batch_01` is AE's
 * `Batch_1`), or every batch when it came out of the territory's own
 * `_Delivery`. Null when there isn't one -- an approved file with no project
 * on disk can be looked at, never built from.
 */
export async function findApprovedProject(marketsRoot: string, row: Approved, list: Lister): Promise<{ name: string; path: string } | null> {
    const terr = (await list(marketsRoot)).find((k) => k.dir && k.name === row.territory);
    if (!terr) return null;
    const ae = child(await list(terr.path), "AE");
    if (!ae) return null;
    const batches = (await list(ae.path)).filter((k) => k.dir && k.name.charAt(0) !== "_" && !hidden(k.name));
    const pool = row.batch ? batches.filter((b) => looseBatch(b.name) === looseBatch(row.batch)) : batches;
    const want = deliverableSquash(row.name);
    let best: { name: string; path: string; v: number } | null = null;
    for (const b of pool) {
        for (const k of await list(b.path)) {
            if (k.dir || hidden(k.name) || !/\.aep$/i.test(k.name)) continue;
            if (deliverableSquash(k.name) !== want) continue;
            const v = versionOf(k.name);
            if (!best || v > best.v) best = { name: k.name, path: k.path, v };
        }
    }
    return best ? { name: best.name, path: best.path } : null;
}

/**
 * The JPG_PNG folders in ONE territory that could be a batch row's own
 * artwork (folderIsRow): under a batch folder or straight under JPG_PNG, `_`
 * folders left alone, the same folder under two batches counted once. Every
 * candidate comes back, because the caller compares only when there is
 * exactly one: none means the artwork has not landed, several means the row
 * does not say enough to choose.
 */
export async function findRowArt(territoryPath: string, row: RowSpec, list: Lister): Promise<Kid[]> {
    if (!territoryPath || !(row.w > 0) || !(row.h > 0)) return [];
    const jp = child(await list(territoryPath), "JPG_PNG");
    if (!jp) return [];
    const level = (await list(jp.path)).filter((k) => k.dir && k.name.charAt(0) !== "_" && !hidden(k.name));
    const found: Kid[] = level.filter((k) => sizeOfName(k.name));
    const inside = await Promise.all(level.filter((k) => !sizeOfName(k.name)).map((b) => list(b.path)));
    inside.forEach((kids) => kids.forEach((k) => { if (k.dir && k.name.charAt(0) !== "_" && !hidden(k.name) && sizeOfName(k.name)) found.push(k); }));
    const out: Kid[] = [];
    const seen: Record<string, true> = {};
    for (const k of found) {
        if (!folderIsRow(k.name, row)) continue;
        const key = deliverableSquash(k.name);
        if (seen[key]) continue;
        seen[key] = true;
        out.push(k);
    }
    return out;
}

/** Every approved deliverable under one Markets root. [] when it can't be listed. */
export async function scanMarkets(campaign: string, marketsRoot: string, list: Lister): Promise<Approved[]> {
    const top = (await list(marketsRoot)).filter((k) => k.dir && k.name.charAt(0) !== "_" && !hidden(k.name));
    const per = await Promise.all(top.map((t) => scanTerritory(campaign, t, list)));
    const out: Approved[] = [];
    per.forEach((rows) => rows.forEach((r) => out.push(r)));
    return out;
}
