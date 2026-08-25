// =============================================================================
// src/js/main/lib/tutorialSubject.ts
// -----------------------------------------------------------------------------
// WHAT THE HEADER ICON IS CURRENTLY ABOUT, when that is not simply the tool it
// sits on.
//
// One tool needs this: Bespoke forks three ways at its door -- Multiple Art,
// Bespoke, Insitu -- and those modes share a door and nothing else (an insitu
// has no board size, no guides and no running order). One clip covering all
// three is either twelve minutes long or it teaches one mode and misleads on
// the other two, which is the failure the never-fuzzy match rule exists to
// prevent.
//
// A SUBJECT, NOT A FILENAME SYNTAX. The alternative was a compound convention
// -- Bespoke-MultipleArt.mp4 -- and this feature's whole bet is that recording
// a clip stays "drop the mp4 in _tuts and name it after what it teaches". A
// rule to remember is a clip nobody records. The header icon stays mounted
// after a mode is picked, so it can simply be contextual instead: the tool's
// clip at the chooser, the mode's clip once you are inside one. Keys stay
// exact either way.
//
// A module store rather than context or props, matching lib/workflowBubble.ts:
// the icon lives in four different screen headers and the tool is mounted
// several layers below each of them, so threading this through would touch
// every one of those screens to serve a single tool.
//
// SCOPED BY toolId, which is the whole safety of it. A subject only applies to
// the icon whose tool set it, so a mode left uncleared can never relabel
// another tool's header -- the worst case is Bespoke's own icon being stale,
// and it is cleared on unmount as well.
// =============================================================================

export interface TutorialSubject {
    /** The registry id of the tool this subject belongs to. */
    toolId: string;
    /** Looked up like a tool id would be — see lib/tutorials.ts. */
    id: string;
    /** Looked up like a tool label would be, and shown in the tooltip. */
    label: string;
}

let current: TutorialSubject | null = null;
const listeners: Array<() => void> = [];

export function getTutorialSubject(): TutorialSubject | null {
    return current;
}

export function setTutorialSubject(next: TutorialSubject | null): void {
    // Reference equality is not enough — a tool re-rendering would notify on
    // every pass and re-run the icon's lookup effect for no reason.
    const same =
        (current === null && next === null) ||
        (current !== null &&
            next !== null &&
            current.toolId === next.toolId &&
            current.id === next.id &&
            current.label === next.label);
    if (same) return;
    current = next;
    for (let i = 0; i < listeners.length; i++) listeners[i]();
}

export function subscribeTutorialSubject(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
        const at = listeners.indexOf(fn);
        if (at !== -1) listeners.splice(at, 1);
    };
}
