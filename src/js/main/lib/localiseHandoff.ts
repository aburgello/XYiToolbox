// =============================================================================
// src/js/main/lib/localiseHandoff.ts
// -----------------------------------------------------------------------------
// A one-shot handoff from the Active Jobs modal to CSV Localiser's batch
// builder: "these Wrike subtasks, as localiser rows".
//
// A module variable rather than context or a URL param, because the two live in
// completely different screens (home vs the Localise drill-down) and the second
// one MOUNTS as a result of the handoff. Threading state through main.tsx's
// Screen union for a single transient payload would put a localiser concern
// into the shell's navigation type.
//
// TAKE-ONCE on purpose: `takePendingBatch()` clears as it reads. Without that,
// navigating back to Localise later would silently re-prefill the builder with
// a job you already dealt with, which reads as the panel inventing rows.
// =============================================================================

export interface HandoffRow {
    artwork: string;
    creative: string;
    // Media site token as the subtask name carries it, CASE INCLUDED -- the
    // studio writes sites in CamelCase in Wrike, and the localiser's filename
    // builder now preserves whatever case arrives here. Empty for a
    // deliverable with no site, which is a normal name, not a gap.
    site: string;
    width: string;
    height: string;
    duration: string;
}

export interface PendingBatch {
    // From the Wrike job title, e.g. "IT" and "Batch 2". Territory is a best
    // effort: the builder's dropdown lists FOLDER names ("Italy"), which need
    // not match the title's code, so the consumer treats a miss as "unset" and
    // lets the user pick rather than inventing a folder.
    territory: string;
    batch: string;
    rows: HandoffRow[];
    // Purely for the notice the builder shows, so it is obvious where the rows
    // came from and that they were not typed.
    jobTitle: string;
    // Subtasks that could NOT be turned into rows, and why. Surfaced rather
    // than dropped: silently sending 2 of 5 deliverables is exactly how a
    // deliverable goes missing.
    skipped: { name: string; missing: string[] }[];
}

/**
 * The second handoff, the other way down the same road: "these localiser rows,
 * as Multiple Art targets".
 *
 * A row that cannot be localised from ONE master is exactly a Multiple Art
 * deliverable — a 30s slot filled by 15s of one creative and 15s of another —
 * and the localiser already knows which rows those are, because it draws the
 * "2×?" badge from it. So the route out is the rows themselves, not a folder:
 * at this point in the job the AE folders do not exist yet, which is the whole
 * reason these rows are still sitting here.
 *
 * Same take-once discipline as the batch above, for the same reason.
 */
export interface BespokeTargetRow {
    artwork: string;
    creative: string;
    site: string;
    width: string;
    height: string;
    duration: string;
    /**
     * The localiser could not answer this row with ONE master, which is what
     * makes it a Multiple Art deliverable. Every complete row travels so the
     * list can be changed on the other side; this is what arrives ticked.
     */
    needsMulti: boolean;
}

export interface PendingBespoke {
    territory: string;
    batch: string;
    /** The masters folder the rows were resolved against. */
    mastersRoot: string;
    /**
     * The campaign by NAME, not its markets root: Bespoke derives the root from
     * the campaign it has selected, so handing it a root would set a value the
     * next campaign change would silently contradict.
     */
    campaign: string;
    rows: BespokeTargetRow[];
}

let pendingBespoke: PendingBespoke | null = null;

export function setPendingBespoke(next: PendingBespoke): void {
    pendingBespoke = next;
}

/** Reads AND clears. */
export function takePendingBespoke(): PendingBespoke | null {
    const b = pendingBespoke;
    pendingBespoke = null;
    return b;
}

let pending: PendingBatch | null = null;

export function setPendingBatch(batch: PendingBatch): void {
    pending = batch;
}

// Reads AND clears. See the take-once note above.
export function takePendingBatch(): PendingBatch | null {
    const b = pending;
    pending = null;
    return b;
}
