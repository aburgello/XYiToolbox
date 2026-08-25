// =============================================================================
// src/js/main/lib/tutorials.ts
// -----------------------------------------------------------------------------
// Short screen recordings the team drops in <TeamFolder>/_tuts/, matched to the
// tool they explain and played from that tool's header icon.
//
// THE MATCH IS THE FILENAME AND NOTHING ELSE. `OVSwap.mp4` explains OV Swap
// because "ovswap" is what both the file's name and the tool's id/label reduce
// to. No index file, no registry field, no per-tool wiring: recording a
// tutorial is "drop the mp4 in _tuts and name it after the tool", which is a
// thing somebody will actually do at 6pm on a Friday. Anything that needed a
// code change per clip would mean no clips.
//
// EXACT after squashing, never fuzzy. `findBestComponentFile`-style scoring is
// the wrong tool here for the same reason CLAUDE.md gives for the CSV
// "already built" matcher: an unmatched clip costs one rename, and a
// mismatched one silently plays the wrong tool's tutorial to somebody who is
// trusting it to teach them the tool they are standing in.
//
// SILENT throughout, like every other team-folder feature. No team folder, an
// unmounted share, no `_tuts` folder and no matching clip are all the same
// normal answer -- the icon is simply not a button.
// =============================================================================
import { evalTS } from "../../lib/utils/bolt";

export interface Tutorial {
    /** Filename without the extension, e.g. "OVSwap". */
    name: string;
    /** OS path -- hand to VideoOverlay, which converts it to file://. */
    path: string;
}

/**
 * Fold a tool id, a tool label or a filename to the one key they can be
 * compared on: "OV Swap", "ov-swap" and "OVSwap" all become "ovswap".
 *
 * Accents fold too (NFD then strip the combining marks) so a clip named from
 * a Mac keyboard keys the same as one named from Windows -- the decomposed /
 * precomposed trap CLAUDE.md documents for `File.name`, one level up.
 */
export function tutorialKey(s: string): string {
    return String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

// ONE bridge call per panel session, not one per tool screen. Opening a tool
// is the single most common thing anybody does in here, and re-reading a NAS
// folder on every one of those would put a network round-trip in front of a
// screen that has nothing to do with tutorials.
let cache: Promise<Tutorial[]> | null = null;

async function fetchTutorials(): Promise<Tutorial[]> {
    try {
        const res = (await evalTS("tutorialsList" as any)) as
            | { success?: boolean; available?: boolean; files?: Tutorial[] }
            | undefined;
        if (!res || !res.available || !res.files) return [];
        return res.files;
    } catch (e) {
        // No bridge (browser preview), no share, no permission -- all "no
        // tutorials", none of them worth a toast.
        return [];
    }
}

export function loadTutorials(): Promise<Tutorial[]> {
    if (!cache) cache = fetchTutorials();
    return cache;
}

/**
 * Drops the cached list so the next lookup re-reads the folder. For a clip
 * added while the panel is open -- the whole point is that recording one
 * needs no code change, so it should not need a panel restart either.
 */
export function refreshTutorials(): void {
    cache = null;
}

/**
 * The tutorial for a tool, or null. `id` and `label` are both tried because
 * either can be the more natural filename -- "OVSwap" reads better than
 * "ov-swap", and "find-and-replace" reads better than "Find & Replace".
 */
export async function tutorialFor(id: string, label?: string): Promise<Tutorial | null> {
    const files = await loadTutorials();
    if (!files.length) return null;
    const wanted = [tutorialKey(id), tutorialKey(label || "")];
    for (let i = 0; i < files.length; i++) {
        const key = tutorialKey(files[i].name);
        if (!key) continue;
        if (wanted.indexOf(key) !== -1) return files[i];
    }
    return null;
}
