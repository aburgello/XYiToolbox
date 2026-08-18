// =============================================================================
// src/js/main/lib/agent/fieldHandoff.ts
// -----------------------------------------------------------------------------
// Values the agent has PROPOSED for a tool's fields, waiting for that tool to
// pick them up.
//
// A module variable rather than context or props, for the same reason
// localiseHandoff.ts is one: the agent lives in a floating bubble and the tool
// it is filling MOUNTS as a result of the call. Threading a transient payload
// through main.tsx's Screen union would put an agent concern into the shell's
// navigation type.
//
// TAKE-ONCE, and keyed by tool. `takePendingFill` clears as it reads, and only
// answers the tool the values were meant for. Without both, navigating back to
// a tool later would silently re-fill a form the artist had already dealt with
// -- which reads as the panel typing into your form by itself, and is exactly
// the failure localiseHandoff's own take-once note describes.
//
// NOTHING HERE DECIDES WHAT MAY BE FILLED. The gate is in tools.ts, against
// ToolEntry.fillableFields, before a value ever reaches this module. This is a
// pipe, and a pipe that also decided policy would be a second place to check.
// =============================================================================

export interface PendingFill {
    /** The registry id of the tool these values are for. */
    toolId: string;
    /** Field id -> value. Field ids are the tool's own, never its labels. */
    values: Record<string, string>;
}

let pending: PendingFill | null = null;

export function setPendingFill(fill: PendingFill): void {
    pending = fill;
}

/**
 * Reads AND clears, and only for the tool asked for.
 *
 * The toolId check is not belt-and-braces: two tools can be mounted across one
 * navigation, and a fill meant for Name Generator must not be swallowed by
 * whatever happened to render first.
 */
export function takePendingFill(toolId: string): Record<string, string> | null {
    if (!pending || pending.toolId !== toolId) return null;
    const values = pending.values;
    pending = null;
    return values;
}
