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
