// =============================================================================
// src/js/main/lib/archivePreviews.ts
// -----------------------------------------------------------------------------
// A FINISHED BATCH'S PREVIEWS GO TO `_Old`, by the panel, in one press.
//
// Render Me writes a web-playable mp4 per deliverable into
// `<Territory>/Renders/<Batch>/_mp4`. Once the batch is delivered they are
// housekeeping: the studio moves them to `Renders/<Batch>/_Old/_mp4`, which is
// purged later. People forget, and `_Old` is often not there to move into.
//
// So: `_Old` is found whatever its case, or made; `_mp4` goes inside it. A
// rename on the same share, so nothing is copied. When `_Old/_mp4` is already
// there (archived once, then rendered again) the files are moved into it one
// by one, a same-named one replaced: previews are regenerable and both copies
// are on their way to the purge.
//
// ONLY EVER `<Territory>/Renders/<Batch>/_mp4`. The sweep walks territories
// and their batches and nothing else, so it cannot reach a masters tree's
// `Support/Motion_Components/_mp4`, which OV Library and 67 play from.
// `node scripts/probe-archive-previews.mjs` guards it.
// =============================================================================
import { fs, path } from "../../lib/cep/node";

interface Kid { name: string; path: string; dir: boolean }

export interface PreviewFolder {
    /** `<Territory>/Renders/<Batch>` */
    batchPath: string;
    territory: string;
    batch: string;
    /** The `_mp4` folder itself, as the disk spells it. */
    path: string;
    files: number;
}

const kids = (dir: string): Promise<Kid[]> =>
    new Promise((resolve) => {
        try {
            (fs as any).readdir(dir, { withFileTypes: true }, (err: any, list: any[]) => {
                if (err || !list) { resolve([]); return; }
                resolve(list.map((d) => ({ name: d.name, path: path.join(dir, d.name), dir: d.isDirectory() })));
            });
        } catch {
            resolve([]);
        }
    });

const call = (fn: string, ...args: any[]): Promise<string> =>
    new Promise((resolve) => {
        try {
            (fs as any)[fn](...args, (err: any) => resolve(err ? String(err.message || err) : ""));
        } catch (e) {
            resolve(String(e));
        }
    });

const named = (list: Kid[], name: string): Kid | null =>
    list.find((k) => k.dir && k.name.toLowerCase() === name.toLowerCase()) || null;

const isClip = (k: Kid) => !k.dir && k.name.charAt(0) !== "." && /\.(mp4|m4v)$/i.test(k.name);

/** A batch's `_mp4`, when it holds at least one clip. */
export async function previewFolderOf(batchPath: string): Promise<PreviewFolder | null> {
    if (!batchPath) return null;
    const mp = named(await kids(batchPath), "_mp4");
    if (!mp) return null;
    const files = (await kids(mp.path)).filter(isClip).length;
    if (!files) return null;
    return { batchPath, territory: path.basename(path.dirname(path.dirname(batchPath))), batch: path.basename(batchPath), path: mp.path, files };
}

/** Every batch under a Markets root still holding previews. `_` folders are
 *  never territories or batches. [] when the root can't be listed. */
export async function findPreviewFolders(marketsRoot: string): Promise<PreviewFolder[]> {
    const out: PreviewFolder[] = [];
    if (!marketsRoot) return out;
    for (const t of await kids(marketsRoot)) {
        if (!t.dir || t.name.charAt(0) === "_" || t.name.charAt(0) === ".") continue;
        const renders = named(await kids(t.path), "Renders");
        if (!renders) continue;
        for (const b of await kids(renders.path)) {
            if (!b.dir || b.name.charAt(0) === "_" || b.name.charAt(0) === ".") continue;
            const found = await previewFolderOf(b.path);
            if (found) out.push(found);
        }
    }
    return out;
}

export interface ArchiveResult { success: boolean; moved: number; to: string; madeOld: boolean; error?: string }

/** Move one batch's `_mp4` into its `_Old`, making `_Old` when it isn't there. */
export async function archivePreviews(batchPath: string): Promise<ArchiveResult> {
    const fail = (error: string): ArchiveResult => ({ success: false, moved: 0, to: "", madeOld: false, error });
    // The one shape this ever touches: a batch folder directly under Renders.
    if (!batchPath || path.basename(path.dirname(batchPath)).toLowerCase() !== "renders" || path.basename(batchPath).charAt(0) === "_") {
        return fail("Not a batch's Renders folder.");
    }
    const inBatch = await kids(batchPath);
    const mp = named(inBatch, "_mp4");
    if (!mp) return fail("No _mp4 folder in this batch.");

    let old = named(inBatch, "_Old");
    let madeOld = false;
    if (!old) {
        const made = path.join(batchPath, "_Old");
        const err = await call("mkdir", made);
        if (err) return fail("Couldn't make _Old: " + err);
        old = { name: "_Old", path: made, dir: true };
        madeOld = true;
    }

    const there = named(await kids(old.path), "_mp4");
    const inside = await kids(mp.path);
    const count = inside.filter((k) => !k.dir).length;
    if (!there) {
        const to = path.join(old.path, mp.name);
        const err = await call("rename", mp.path, to);
        if (err) return fail("Couldn't move _mp4: " + err);
        return { success: true, moved: count, to, madeOld };
    }

    // Archived before and rendered again: file by file into the folder there.
    let moved = 0;
    for (const k of inside) {
        if (k.dir) continue;
        const err = await call("rename", k.path, path.join(there.path, k.name));
        if (err) return { success: false, moved, to: there.path, madeOld, error: "Couldn't move " + k.name + ": " + err };
        moved++;
    }
    // Empty now unless it held a folder; rmdir refuses a folder with anything in it.
    await call("rmdir", mp.path);
    return { success: true, moved, to: there.path, madeOld };
}

/** A deliverable's name with its extension, version and RES tail off, so a
 *  delivered file and its previews (any version) key the same. Exact beyond that. */
export const previewKey = (name: string): string =>
    String(name)
        .replace(/\.[A-Za-z0-9]+$/, "")
        .replace(/_V\d+(?=_|$)/i, "")
        .replace(/_(DOUBLE|TRIPLE|QUAD)_RES$/i, "")
        .toUpperCase();

/** Move the previews of the named deliverables (`keys`, as `previewKey`
 *  gives them) from one batch's `_mp4` to its `_Old/_mp4`. */
export async function archivePreviewsFor(batchPath: string, keys: string[]): Promise<{ moved: number; error?: string }> {
    if (!batchPath || !keys.length || path.basename(path.dirname(batchPath)).toLowerCase() !== "renders" || path.basename(batchPath).charAt(0) === "_") return { moved: 0 };
    let moved = 0;
    const inBatch = await kids(batchPath);
    const mp = named(inBatch, "_mp4");
    if (!mp) return { moved: 0 };
    const inside = await kids(mp.path);
    const mine = inside.filter((k) => isClip(k) && keys.indexOf(previewKey(k.name)) !== -1);
    if (!mine.length) return { moved: 0 };
    let old = named(inBatch, "_Old");
    if (!old) {
        const made = path.join(batchPath, "_Old");
        const err = await call("mkdir", made);
        if (err) return { moved, error: "Couldn't make _Old: " + err };
        old = { name: "_Old", path: made, dir: true };
    }
    let there = named(await kids(old.path), "_mp4");
    if (!there) {
        const made = path.join(old.path, mp.name);
        const err = await call("mkdir", made);
        if (err) return { moved, error: "Couldn't make _Old/_mp4: " + err };
        there = { name: mp.name, path: made, dir: true };
    }
    for (const k of mine) {
        const err = await call("rename", k.path, path.join(there.path, k.name));
        if (err) return { moved, error: "Couldn't move " + k.name + ": " + err };
        moved++;
    }
    // Nothing left but Finder's own file: the folder has done its job.
    const left = (await kids(mp.path)).filter((k) => k.name !== ".DS_Store");
    if (!left.length) {
        await call("unlink", path.join(mp.path, ".DS_Store"));
        await call("rmdir", mp.path);
    }
    return { moved };
}

/**
 * Delivery has just written `outputPath` into a `_Delivery` folder: move THAT
 * deliverable's previews (every version) from its batch's `_mp4` to
 * `_Old/_mp4`, making either folder when it's missing. The batch is the folder
 * holding `_Delivery`; when `_Delivery` sits under `Renders` itself, every
 * batch there is looked in. Other deliverables' previews stay where they are,
 * and an `_mp4` left with nothing in it is removed.
 */
export async function archiveDeliveredPreview(outputPath: string): Promise<{ moved: number; error?: string }> {
    if (!outputPath) return { moved: 0 };
    let dir = path.dirname(outputPath);
    let hops = 0;
    while (dir && path.basename(dir).toLowerCase() !== "_delivery" && hops++ < 6) {
        const up = path.dirname(dir);
        if (up === dir) return { moved: 0 };
        dir = up;
    }
    if (path.basename(dir).toLowerCase() !== "_delivery") return { moved: 0 };
    const above = path.dirname(dir);
    let batches: string[] = [];
    if (path.basename(above).toLowerCase() === "renders") {
        batches = (await kids(above)).filter((k) => k.dir && k.name.charAt(0) !== "_" && k.name.charAt(0) !== ".").map((k) => k.path);
    } else if (path.basename(path.dirname(above)).toLowerCase() === "renders" && path.basename(above).charAt(0) !== "_") {
        batches = [above];
    }
    // A delivery Chromium can't play (a .mov) keeps its preview: it is the
    // only thing Size Finder can show for it while the campaign is active.
    // It goes with the rest when the campaign is archived.
    if (!/\.(mp4|m4v)$/i.test(outputPath)) return { moved: 0 };
    const want = previewKey(path.basename(outputPath));
    let moved = 0;
    for (const batchPath of batches) {
        const res = await archivePreviewsFor(batchPath, [want]);
        moved += res.moved;
        if (res.error) return { moved, error: res.error };
    }
    return { moved };
}
