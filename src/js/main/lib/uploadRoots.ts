// =============================================================================
// src/js/main/lib/uploadRoots.ts
// -----------------------------------------------------------------------------
// A campaign's UPLOADS folder, shared by the team (jsx/aeft/uploads.ts holds
// the list), and the batch's own folder under it: `<root>/<Territory>/<Batch>`.
//
// The list is read once a session and kept; setting a root replaces what is
// kept. A failed read is "none known", silently: the uploads live on another
// share again, and neither being unmounted is an error.
// =============================================================================
import { fs, path } from "../../lib/cep/node";
import { evalTS } from "../../lib/utils/bolt";

export interface UploadRoot { key: string; campaign: string; root: string; author?: string }

let kept: UploadRoot[] | null = null;

/** The Markets folder's name: what a campaign's uploads root is filed under. */
export function campaignKeyOf(territoryPath: string): string {
    const parts = String(territoryPath || "").split(/[\\/]+/).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 2] : "";
}

export async function loadUploadRoots(force = false): Promise<UploadRoot[]> {
    if (kept && !force) return kept;
    try {
        const r = (await evalTS("uploadRootsLoad")) as any;
        kept = (r && r.entries) || [];
    } catch {
        kept = kept || [];
    }
    return kept as UploadRoot[];
}

export function uploadRootFor(roots: UploadRoot[], territoryPath: string): string {
    const key = campaignKeyOf(territoryPath).toUpperCase();
    const hit = key ? roots.find((r) => String(r.key).toUpperCase() === key) : undefined;
    return hit ? hit.root : "";
}

/** Share a campaign's root. Returns "" when saved, else why not. */
export async function saveUploadRoot(territoryPath: string, root: string): Promise<string> {
    try {
        const r = (await evalTS("uploadRootSet", campaignKeyOf(territoryPath), root)) as any;
        if (r && r.success) { kept = r.entries || []; return ""; }
        return (r && r.error) || "Couldn't save the uploads folder.";
    } catch {
        return "No CEP bridge. Open inside After Effects.";
    }
}

const loose = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|\D)0+(\d)/g, "$1$2");

/** A child folder by loose name (case, separators, leading zeros), as the
 *  disk spells it; "" when the parent can't be listed or holds none. */
function childLoose(parent: string, name: string): string {
    try {
        const want = loose(name);
        const hit = (fs.readdirSync(parent, { withFileTypes: true }) as any[]).find((d) => d.isDirectory() && loose(d.name) === want);
        return hit ? path.join(parent, hit.name) : "";
    } catch {
        return "";
    }
}

/**
 * This batch's uploads folder: `<root>/<Territory>/<Batch>`.
 *
 * `folder` is what the MESSAGE says. It takes the uploads share's own
 * spelling where the folders are already there (`Batch_1` for `Batch_01`),
 * and is otherwise written from the Markets names -- the folder is often made
 * at the moment of delivery, and the comment has to name it either way.
 * `open` is the deepest level that really exists, for the link: a path that
 * isn't there opens nothing.
 */
export function uploadFolderFor(root: string, territoryPath: string, batch: string): { folder: string; open: string } {
    if (!root) return { folder: "", open: "" };
    const territory = String(territoryPath || "").split(/[\\/]+/).filter(Boolean).pop() || "";
    if (!territory) return { folder: root, open: root };
    const terr = childLoose(root, territory);
    const bat = terr && batch ? childLoose(terr, batch) : "";
    const folder = path.join(terr || path.join(root, territory), ...(batch ? [bat ? path.basename(bat) : batch] : []));
    return { folder, open: bat || terr || root };
}
