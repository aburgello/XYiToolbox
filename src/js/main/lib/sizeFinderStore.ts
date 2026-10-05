// =============================================================================
// src/js/main/lib/sizeFinderStore.ts
// -----------------------------------------------------------------------------
// What has been APPROVED per campaign, shared: Size Finder's own page and the
// "seen before" hint on Build a Batch's rows both ask here.
//
// THREE LAYERS, fastest first:
//   1. this session's memory;
//   2. the TEAM FOLDER's copy, `misc/sizes/<campaign>.json` -- one file read
//      instead of hundreds of folder listings, written by whoever scanned
//      last, so a colleague opening the tool fresh pays nothing either;
//   3. the Markets folders themselves (lib/sizeScan.ts).
// A team copy is SHOWN AT ONCE and checked against the disk in the
// background; when the disk says something new, the copy is replaced and
// everyone listening is told. So it never waits, and a new delivery appears a
// second later rather than never.
//
// THE TEAM COPY IS A CACHE, NEVER A SOURCE OF TRUTH. It can always be rebuilt
// from the Markets folders, which is why two machines writing it at once costs
// nothing and why nothing here ever deletes one. Same rules as every team
// feature (CLAUDE.md): an unmounted share is silence, not an error; a failed
// read never replaces what is on screen; only a TAGGED machine writes. Paths
// are stored RELATIVE to the Markets root, so a machine that mounts the share
// somewhere else still gets working paths.
//
// None of this holds the panel or After Effects: Node's file calls are
// asynchronous, and the only bridge call is the team folder's path and the
// machine tag, asked once a session.
// =============================================================================
import { fs, path as nodePath } from "../../lib/cep/node";
import { evalTS } from "../../lib/utils/bolt";
import { Approved, Kid, scanMarkets } from "./sizeScan";

export const hasNode = typeof window !== "undefined" && typeof (window as any).cep !== "undefined";

/** One folder's children. [] when it can't be listed. */
export const listDir = (dir: string): Promise<Kid[]> =>
    new Promise((resolve) => {
        try {
            (fs as any).readdir(dir, { withFileTypes: true }, (err: any, list: any[]) => {
                if (err || !list) { resolve([]); return; }
                resolve(list.map((d) => ({ name: d.name, path: nodePath.join(dir, d.name), dir: d.isDirectory() })));
            });
        } catch {
            resolve([]);
        }
    });

export interface CampaignRead {
    rows: Approved[];
    mounted: boolean;
    /** Where these rows came from: the disk this session, or the team copy (and when it was made). */
    source: "disk" | "team";
    scannedAt: number;
    scannedBy: string;
}

const kept: Record<string, CampaignRead> = {};
const inflight: Record<string, Promise<CampaignRead> | undefined> = {};
const checking: Record<string, true> = {};
const listeners: Array<() => void> = [];
const keyOf = (name: string, root: string) => name + "\n" + root;

/** Told whenever a campaign's rows change, or a background check starts or ends. */
export function onApprovedChange(fn: () => void): () => void {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
}
const tell = () => listeners.slice().forEach((fn) => { try { fn(); } catch { /* one listener is not the others' problem */ } });

/** True while any campaign's team copy is being checked against the disk. */
export const isChecking = () => Object.keys(checking).length > 0;

/** What this session already holds for a campaign, or null. Never reads. */
export function peekApproved(name: string, marketsRoot: string): CampaignRead | null {
    return kept[keyOf(name, marketsRoot)] || null;
}

// --- the team folder -------------------------------------------------------

let teamAsk: Promise<{ dir: string; tag: string }> | null = null;
function teamContext(): Promise<{ dir: string; tag: string }> {
    if (!teamAsk) {
        teamAsk = (async () => {
            try {
                const f = (await evalTS("teamGetFolder")) as unknown as { path?: string; mounted?: boolean } | undefined;
                const m = (await evalTS("teamGetMachineState")) as unknown as { owner?: string } | undefined;
                return { dir: f && f.mounted && f.path ? f.path : "", tag: (m && m.owner) || "" };
            } catch {
                return { dir: "", tag: "" };
            }
        })();
    }
    return teamAsk;
}

const fileFor = (teamDir: string, campaign: string) =>
    nodePath.join(teamDir, "misc", "sizes", String(campaign).replace(/[^A-Za-z0-9_-]+/g, "_") + ".json");

const PATH_FIELDS: Array<keyof Approved> = ["delivered", "preview", "pdf", "pdfFolder", "artFolder"];

function toRelative(rows: Approved[], root: string): Approved[] {
    const base = root.replace(/[\\/]+$/, "");
    return rows.map((r) => {
        const o: any = { ...r };
        for (const k of PATH_FIELDS) {
            const v = String(o[k] || "");
            o[k] = v && v.indexOf(base) === 0 ? v.slice(base.length).replace(/^[\\/]+/, "") : v;
        }
        return o as Approved;
    });
}

function toAbsolute(rows: Approved[], root: string, campaign: string): Approved[] {
    return rows.map((r) => {
        const o: any = { ...r, campaign };
        for (const k of PATH_FIELDS) {
            const v = String(o[k] || "");
            o[k] = v && !/^([\\/]|[A-Za-z]:)/.test(v) ? nodePath.join(root, v) : v;
        }
        return o as Approved;
    });
}

const readFile = (p: string): Promise<string> =>
    new Promise((resolve) => {
        try { (fs as any).readFile(p, "utf8", (err: any, txt: string) => resolve(err ? "" : txt || "")); } catch { resolve(""); }
    });

const mkdirOne = (p: string): Promise<void> =>
    new Promise((resolve) => { try { (fs as any).mkdir(p, () => resolve()); } catch { resolve(); } });

/** The team copy for a campaign, or null when there is none or it can't be read. */
async function readTeamCopy(name: string, root: string): Promise<CampaignRead | null> {
    const { dir } = await teamContext();
    if (!dir) return null;
    const txt = await readFile(fileFor(dir, name));
    if (!txt) return null;
    try {
        const j = JSON.parse(txt);
        if (!j || j.version !== 1 || !Array.isArray(j.rows)) return null;
        return { rows: toAbsolute(j.rows, root, name), mounted: true, source: "team", scannedAt: Number(j.scannedAt) || 0, scannedBy: String(j.scannedBy || "") };
    } catch {
        return null; // half-written by somebody else this instant: the disk answers instead
    }
}

/** Write the team copy -- a tagged machine only, through a temp file so no reader sees half of it. */
async function writeTeamCopy(name: string, root: string, read: CampaignRead): Promise<void> {
    const { dir, tag } = await teamContext();
    if (!dir || !tag || !read.mounted) return;
    const misc = nodePath.join(dir, "misc");
    await mkdirOne(misc);
    await mkdirOne(nodePath.join(misc, "sizes"));
    const target = fileFor(dir, name);
    const tmp = target + "." + tag.replace(/[^A-Za-z0-9]+/g, "") + ".tmp";
    const body = JSON.stringify({ version: 1, campaign: name, scannedAt: read.scannedAt, scannedBy: tag, rows: toRelative(read.rows, root) });
    await new Promise<void>((resolve) => {
        try {
            (fs as any).writeFile(tmp, body, "utf8", (err: any) => {
                if (err) { resolve(); return; }
                (fs as any).rename(tmp, target, () => resolve());
            });
        } catch {
            resolve();
        }
    });
}

/** Two reads describe the same deliverables, paired with the same files. */
const signature = (rows: Approved[]) =>
    rows.map((r) => [r.id, r.delivered, r.preview, r.pdf, r.artFolder].join("|")).sort().join("\n");

// --- reading ---------------------------------------------------------------

async function scanDisk(name: string, root: string): Promise<CampaignRead> {
    const rows = await scanMarkets(name, root, listDir);
    const mounted = rows.length > 0 || (await listDir(root)).length > 0;
    const { tag } = await teamContext();
    return { rows, mounted, source: "disk", scannedAt: Date.now(), scannedBy: tag };
}

/** Check a team copy against the disk; replace it (and tell everyone) when they differ. */
function checkInBackground(name: string, root: string) {
    const key = keyOf(name, root);
    if (checking[key]) return;
    checking[key] = true;
    tell();
    scanDisk(name, root)
        .then(async (fresh) => {
            // An unmounted Markets share must not wipe the team's copy.
            if (!fresh.mounted) return;
            const before = kept[key];
            const changed = !before || signature(before.rows) !== signature(fresh.rows);
            kept[key] = fresh;
            if (changed) await writeTeamCopy(name, root, fresh);
        })
        .catch(() => { /* the copy on screen stays */ })
        .then(() => { delete checking[key]; tell(); });
}

/**
 * A campaign's approved deliverables. Memory, else the team copy (shown now,
 * checked behind), else the disk. `force` (Re-read) goes to the disk and
 * refreshes the team copy.
 */
export function readApproved(name: string, marketsRoot: string, force = false): Promise<CampaignRead> {
    const key = keyOf(name, marketsRoot);
    if (!hasNode || !marketsRoot) return Promise.resolve({ rows: [], mounted: false, source: "disk", scannedAt: 0, scannedBy: "" });
    if (!force && kept[key]) return Promise.resolve(kept[key]);
    const going = inflight[key];
    if (going) return going;
    const run = (async () => {
        if (!force) {
            const team = await readTeamCopy(name, marketsRoot);
            if (team) {
                kept[key] = team;
                checkInBackground(name, marketsRoot);
                return team;
            }
        }
        const fresh = await scanDisk(name, marketsRoot);
        // A share that dropped mid-session must not wipe what was read before.
        if (fresh.mounted || !kept[key]) kept[key] = fresh;
        if (fresh.mounted) await writeTeamCopy(name, marketsRoot, fresh);
        return kept[key];
    })();
    inflight[key] = run;
    run.then(() => { delete inflight[key]; tell(); }, () => { delete inflight[key]; });
    return run;
}
