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

import { useEffect, useRef } from "react";

export interface PendingFill {
    /** The registry id of the tool these values are for. */
    toolId: string;
    /** Field id -> value. Field ids are the tool's own, never its labels. */
    values: Record<string, string>;
}

let pending: PendingFill | null = null;

/**
 * Receivers waiting for a fill.
 *
 * A MOUNT-ONLY READ IS NOT ENOUGH, and this is the bug that shipped: asking a
 * second time while already ON the tool filled nothing at all. navigateToTool
 * sets the screen, and if that screen is already showing, React reconciles
 * rather than remounting -- so an effect with a `[]` dependency never runs
 * again and the staged value just sits there. Worse than doing nothing: it
 * would surface on some later, unrelated visit to that tool, which is exactly
 * the "the panel typed into my form by itself" failure take-once exists to
 * prevent.
 *
 * So receivers subscribe as well as reading on mount. The pipe tells them a
 * value has arrived; it still holds no policy.
 */
const listeners = new Set<() => void>();

export function setPendingFill(fill: PendingFill): void {
    pending = fill;
    // Copied before iterating: a receiver is free to unsubscribe from inside
    // its own callback, and mutating the set mid-iteration would skip the next
    // one along.
    for (const l of Array.from(listeners)) l();
}

/** Returns its own unsubscribe, for a useEffect cleanup to call. */
export function subscribeToFills(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
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

/**
 * The receiver side, so a tool needs four lines rather than this reasoning.
 *
 * Runs `apply` for anything staged before it mounted, and again for anything
 * staged while it is up — the second half being what makes asking twice work.
 *
 * `apply` is held in a REF and refreshed every render. A receiver's logic reads
 * the tool's current state to decide whether a field is the artist's work, and
 * a callback captured once on mount would be comparing against whatever that
 * state was at mount time — so clearing the box and asking again would still be
 * judged against the box's original contents. That is the same class of bug as
 * the mount-only read this fixes, one layer in.
 */
export function usePendingFill(
    toolId: string,
    apply: (values: Record<string, string>) => void
): void {
    const applyRef = useRef(apply);
    applyRef.current = apply;

    useEffect(() => {
        const run = () => {
            const values = takePendingFill(toolId);
            if (values) applyRef.current(values);
        };
        run();
        return subscribeToFills(run);
    }, [toolId]);
}
