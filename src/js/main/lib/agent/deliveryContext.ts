// =============================================================================
// src/js/main/lib/agent/deliveryContext.ts
// -----------------------------------------------------------------------------
// The spec sheet the artist currently has open in Delivery.
//
// WHY THIS EXISTS. read_delivery_specs finds a campaign's specs by walking up
// from a path looking for Masters/Specs. That works from a RENDER path, which
// is what Delivery itself uses -- but the agent is handed a mastersRoot by
// list_campaigns, and on the studio's real layout the campaign folder is a
// SIBLING of the masters folder, never an ancestor:
//
//   .../XY026039_..._Campaign/Masters/Specs          <- the specs
//   .../XY026039_..._Campaign_Masters/AE             <- what the agent is given
//
// So the walk could not reach them, and the agent kept insisting no specs
// existed while the artist was looking at them parsed on screen. Deriving the
// same folder a second way was never going to be the fix: the panel had already
// found it, and the agent should read THAT.
//
// A module variable with the same reasoning as navigation.ts and context.ts --
// the agent lives in a floating bubble outside the screen tree.
// =============================================================================
import type { SpecReport } from "../deliverySpecMatch";

let loaded: SpecReport | null = null;

/** Called by DeliveryHub when its spec report is read, and with null on close. */
export function setLoadedSpecReport(report: SpecReport | null): void {
    loaded = report;
}

/**
 * The report on screen, or null.
 *
 * Only ever returns one with rows in it. A report that found the folder and
 * parsed nothing is not a better answer than going and looking properly -- and
 * handing the agent an empty one would have it announce there are no specs,
 * which is the bug this file exists to fix.
 */
export function getLoadedSpecReport(): SpecReport | null {
    if (!loaded) return null;
    const rows = loaded.files.reduce((n, f) => n + f.rows.length, 0);
    return rows > 0 ? loaded : null;
}

// =============================================================================
// WHAT DELIVERY IS ABOUT TO SEND.
//
// The agent could read the spec sheet but had no idea which deliverables were
// being checked against it -- its only view of the world is the ACTIVE COMP,
// via the context line. So asked about "these three renders" it answered about
// one, and looked like it was discarding the rest when it had simply never
// been shown them.
// =============================================================================

export interface LoadedDeliverable {
    name: string;
    /** Seconds, from the comp itself. */
    duration: number;
    /** The comp's real frame rate, which is what a spec sheet disagrees with. */
    frameRate: number;
    /** What is typed into the row, "" when blank. NOT what the spec asks for. */
    sizeMB: string;
    maxMbps: string;
    fps: string;
    audio: boolean;
}

/** Past this, a batch costs more prompt than it is worth. Never truncated
 *  silently -- the count is reported alongside. */
const MAX_REPORTED = 25;

let deliverables: LoadedDeliverable[] = [];

export function setLoadedDeliveryRows(rows: LoadedDeliverable[]): void {
    deliverables = rows || [];
}

export function getLoadedDeliveryRows(): { rows: LoadedDeliverable[]; total: number; omitted: number } {
    const total = deliverables.length;
    const rows = deliverables.slice(0, MAX_REPORTED);
    return { rows, total, omitted: Math.max(0, total - rows.length) };
}
