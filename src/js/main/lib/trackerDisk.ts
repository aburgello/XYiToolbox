// =============================================================================
// src/js/main/lib/trackerDisk.ts
// -----------------------------------------------------------------------------
// THE TRACKER'S FOLDER LISTINGS, READ BY THE PANEL instead of by After Effects.
//
// A batch is ~23 listings. From AE's script engine that is seconds, during
// which AE shows the busy cursor and the panel waits; from the panel's own
// Node it is ~40ms (measured on Norway Batch_02, 2026-10-01) and AE is never
// asked. So the panel reads, and hands AE the listing to line up with Wrike:
// the MERGE stays where it was (tracker.ts trackerScan), untouched, so every
// rule about what pairs with what is still one piece of code.
//
// THIS IS A PORT OF tracker.ts's trReadDisk AND MUST STAY ONE: the same
// folders, the same filters, in the same order, producing the same TrDisk.
// `node scripts/probe-tracker-disk.mjs` runs both over one tree and fails on
// any difference. Change one, change the other, run the probe.
//
// READ-ONLY, like the host's: it lists folders and nothing else.
//
// null means "let AE do it": no Node (browser preview), or the territory can't
// be listed from here. The host then reads as it always did, and says so if
// the folder really is unreachable. Never an empty listing in place of a
// failed one -- that would draw a batch with nothing in it.
// =============================================================================
import { fs, path } from "../../lib/cep/node";

export interface TrEntry { nm: string; path: string }
export interface TrDisk {
    folders: { art: string; aep: string; renders: string; delivered: string[]; specs: string; pdfs: string };
    aes: TrEntry[];
    art: (TrEntry & { files: number })[];
    artIsRoot: boolean;
    artRoot: string;
    renders: TrEntry[];
    delivered: TrEntry[];
    previews: TrEntry[];
}

interface Kid { name: string; nm: string; path: string; dir: boolean }

const loose = (n: string) => String(n).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|\D)0+(\d)/g, "$1$2");

// AE reads a name off macOS DECOMPOSED (CLAUDE.md: `.name` is the URI form of
// what the system hands back), and the merge keys on it. Node hands back what
// the volume stores, so on macOS it is folded the same way; the PATH keeps the
// name exactly as listed, since that is what opens.
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || "");
const asAE = (name: string) => (isMac && typeof name.normalize === "function" ? name.normalize("NFD") : name);

/** One folder's children, in the order the system lists them. [] when it
 *  can't be listed -- the same answer trKids gives. */
function kids(dir: string): Promise<Kid[]> {
    return new Promise((resolve) => {
        try {
            (fs as any).readdir(dir, { withFileTypes: true }, (err: any, list: any[]) => {
                if (err || !list) { resolve([]); return; }
                resolve(list.map((d) => ({ name: d.name, nm: asAE(d.name), path: path.join(dir, d.name), dir: d.isDirectory() })));
            });
        } catch {
            resolve([]);
        }
    });
}

const child = (list: Kid[], name: string): Kid | null =>
    list.find((k) => k.dir && k.nm.toLowerCase() === name.toLowerCase()) || null;

const batchIn = (list: Kid[], batch: string): Kid | null => {
    const want = loose(batch);
    return list.find((k) => k.dir && k.nm.charAt(0) !== "_" && loose(k.nm) === want) || null;
};

/** Can this panel list folders at all, and is the territory one of them? */
function listable(territoryPath: string): boolean {
    try {
        const st = (fs as any).statSync(territoryPath);
        return !!st && typeof st.isDirectory === "function" && st.isDirectory() && typeof (fs as any).readdir === "function";
    } catch {
        return false;
    }
}

export async function readTrackerDisk(territoryPath: string, batch: string): Promise<TrDisk | null> {
    if (!territoryPath || !batch || !listable(territoryPath)) return null;
    const disk: TrDisk = { folders: { art: "", aep: "", renders: "", delivered: [], specs: "", pdfs: "" }, aes: [], art: [], artIsRoot: false, artRoot: "", renders: [], delivered: [], previews: [] };
    const top = await kids(territoryPath);

    const masters = child(top, "Masters");
    const specs = masters ? child(await kids(masters.path), "Specs") : null;
    if (specs) disk.folders.specs = specs.path;
    const pdfs = child(top, "PDFs");
    if (pdfs) {
        const pdfBatch = batchIn(await kids(pdfs.path), batch);
        disk.folders.pdfs = (pdfBatch || pdfs).path;
    }

    const ae = child(top, "AE");
    const aeBatch = ae ? batchIn(await kids(ae.path), batch) : null;
    if (aeBatch) {
        disk.folders.aep = aeBatch.path;
        for (const k of await kids(aeBatch.path)) {
            if (k.dir) continue;
            if (!/\.aep$/i.test(k.nm) || k.nm.charAt(0) === "_") continue;
            disk.aes.push({ nm: k.nm, path: k.path });
        }
    }

    // JPG_PNG: under a batch folder, or (no batch level) under JPG_PNG itself.
    const jp = child(top, "JPG_PNG");
    const jpKids = jp ? await kids(jp.path) : [];
    const jpBatch = jp ? batchIn(jpKids, batch) : null;
    disk.artIsRoot = !jpBatch;
    if (jp) disk.artRoot = jp.path;
    if (jp) {
        const at = jpBatch ? await kids(jpBatch.path) : jpKids;
        const folders = at.filter((k) => k.dir && k.nm.charAt(0) !== "_");
        // The counts are independent of each other: listed together, kept in order.
        const inner = await Promise.all(folders.map((k) => kids(k.path)));
        folders.forEach((k, i) => {
            const count = inner[i].filter((x) => !x.dir && /\.(png|jpe?g|tiff?)$/i.test(x.nm)).length;
            disk.art.push({ nm: k.nm, path: k.path, files: count });
        });
        if (jpBatch) disk.folders.art = jpBatch.path;
    }

    const rd = child(top, "Renders");
    const rdKids = rd ? await kids(rd.path) : [];
    const rdBatch = rd ? batchIn(rdKids, batch) : null;
    const deliveredIn: Kid[] = [];
    const previewIn: Kid[] = [];
    if (rdBatch) {
        disk.folders.renders = rdBatch.path;
        for (const k of await kids(rdBatch.path)) {
            if (k.dir) {
                if (k.nm.toLowerCase() === "_delivery") deliveredIn.push(k);
                else if (k.nm.toLowerCase() === "_mp4") previewIn.push(k);
                continue;
            }
            if (!/\.mov$/i.test(k.nm) || k.nm.charAt(0) === "_") continue;
            disk.renders.push({ nm: k.nm, path: k.path });
        }
    }
    if (rd) {
        const dl = child(rdKids, "_Delivery");
        if (dl) deliveredIn.push(dl);
    }
    // The same walk as the host's, one folder at a time off a stack, so what
    // is found first is found first here too (the merge keeps the first).
    for (const d of deliveredIn) {
        disk.folders.delivered.push(d.path);
        const stack: string[] = [d.path];
        let depth = 0;
        while (stack.length && depth++ < 40) {
            const f = stack.pop() as string;
            for (const k of await kids(f)) {
                if (k.dir) { stack.push(k.path); continue; }
                if (/\.(mp4|mov)$/i.test(k.nm)) disk.delivered.push({ nm: k.nm, path: k.path });
            }
        }
    }
    for (const p of previewIn) {
        for (const k of await kids(p.path)) {
            if (k.dir) continue;
            if (!/\.(mp4|m4v)$/i.test(k.nm) || k.nm.charAt(0) === "_" || k.nm.charAt(0) === ".") continue;
            disk.previews.push({ nm: k.nm, path: k.path });
        }
    }
    return disk;
}

// --- kept, like the host keeps its own -----------------------------------
// The page asks for the same batch again whenever Wrike's statuses change; a
// listing read moments ago answers that without touching the share. `force`
// (refresh, a rename) reads again.
const TTL = 60 * 1000;
const kept: Record<string, { at: number; disk: TrDisk }> = {};
const keyOf = (territoryPath: string, batch: string) => territoryPath + "|" + loose(batch);

export async function trackerDisk(territoryPath: string, batch: string, force = false): Promise<{ disk: TrDisk | null; ms: number; kept: boolean }> {
    const key = keyOf(territoryPath, batch);
    const hit = kept[key];
    if (!force && hit && Date.now() - hit.at < TTL) return { disk: hit.disk, ms: 0, kept: true };
    const t0 = Date.now();
    const disk = await readTrackerDisk(territoryPath, batch);
    if (disk) kept[key] = { at: Date.now(), disk };
    else delete kept[key];
    return { disk, ms: Date.now() - t0, kept: false };
}

/** After anything that moves files (the tracker's own rename). */
export function dropTrackerDisks(): void {
    Object.keys(kept).forEach((k) => { delete kept[k]; });
}
