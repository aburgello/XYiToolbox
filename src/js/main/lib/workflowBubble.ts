// =============================================================================
// src/js/main/lib/workflowBubble.ts
// -----------------------------------------------------------------------------
// Whether the Workflows bubble is on this machine, and whether it is open.
//
// Was `lib/agent/bubbleControl.ts`, and it is the one piece of that feature
// worth keeping: the mechanics of a floating panel that outlives screen
// changes, with a toggle living somewhere else, were right — it was the LLM
// behind it that wasn't.
//
// TWO SEPARATE THINGS, and conflating them was the first mistake here.
//
//   ENABLED persists. Unlike the agent it defaults ON: a creative's checklist
//   is the studio's own house rules, not an experiment somebody has to opt into,
//   and a localiser who never sees it is exactly the person the feature is for.
//   The toggle stays, because a docked panel is small and somebody deep in a
//   render queue should be able to put it away.
//
//   OPEN is session-only. Whether the panel is expanded right now, and it means
//   nothing while the feature is off.
//
// A MODULE VARIABLE WITH SUBSCRIBERS, for the same reason navigation.ts is: the
// bubble is mounted in main.tsx's shell so it outlives screen changes, while
// the control that toggles it sits in HomeScreen's row of pickers. Lifting this
// into main.tsx would thread it through the whole screen tree for one button.
// Subscribers rather than a bare setter because the state is genuinely shared —
// the bubble's own X and its launcher change `open` too, and the home toggle
// has to show the truth when they do.
//
// localStorage, NOT app.settings: this is per-machine furniture — where a
// window sits and whether it is shown — not a panel preference that should
// travel with a team profile via PROFILE_KEYS.
// =============================================================================

// A NEW KEY, not the agent's. Reusing `xyi.agent.enabled` would have handed
// every machine that once switched the agent on a Workflows bubble it never
// asked for, and every machine that switched it OFF a permanently hidden
// feature it has never seen — the worst case being the person who tried the
// agent, disliked it, and now cannot find the checklist at all.
const ENABLED_KEY = "xyi.workflows.bubble";

type Listener = () => void;

let enabled = readEnabled();
let open = false;
const listeners: Listener[] = [];

function readEnabled(): boolean {
    try {
        // ON unless explicitly turned off. Absent means "never chosen", and the
        // default for a house-rules checklist is that you can see it.
        return window.localStorage.getItem(ENABLED_KEY) !== "0";
    } catch {
        return true;
    }
}

function announce(): void {
    // Copied before iterating: a listener unsubscribing inside its own callback
    // would otherwise shorten the array mid-loop and skip the next one.
    const snapshot = listeners.slice();
    for (let i = 0; i < snapshot.length; i++) snapshot[i]();
}

export function isWorkflowBubbleEnabled(): boolean {
    return enabled;
}

export function isBubbleOpen(): boolean {
    return enabled && open;
}

export function setWorkflowBubbleEnabled(next: boolean): void {
    if (enabled === next) return;
    enabled = next;
    try { window.localStorage.setItem(ENABLED_KEY, next ? "1" : "0"); } catch { /* session only */ }
    // Turning it OFF closes it: leaving `open` set would mean the panel
    // reappeared the next time somebody enabled it, which is not what "I turned
    // that off" meant.
    if (!next) open = false;
    announce();
}

/**
 * The home-screen control.
 *
 * Enabling OPENS it as well, deliberately. Otherwise the only visible result of
 * pressing the button is a small launcher appearing in a corner, which reads as
 * nothing having happened.
 */
export function toggleWorkflowBubbleEnabled(): void {
    const next = !enabled;
    setWorkflowBubbleEnabled(next);
    if (next) setBubbleOpen(true);
}

export function setBubbleOpen(next: boolean): void {
    if (!enabled || open === next) return;
    open = next;
    announce();
}

export function toggleBubble(): void {
    setBubbleOpen(!open);
}

/** Returns an unsubscribe. */
export function subscribeToBubble(fn: Listener): () => void {
    listeners.push(fn);
    return () => {
        const i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
    };
}
