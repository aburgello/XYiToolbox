// =============================================================================
// src/js/main/lib/agent/bubbleControl.ts
// -----------------------------------------------------------------------------
// Whether the Ask bubble is on this machine at all, and whether it is open.
//
// TWO SEPARATE THINGS, and conflating them was the first mistake here.
//
//   ENABLED is opt-in and persists. Off by default, because a floating button
//   sitting over every screen is a thing you should have chosen. Somebody who
//   never wants to touch the agent should not have to look at its launcher --
//   the same reasoning SFX uses ("a shared studio-floor tool making noise by
//   default is presumptuous; this is opt-in", shell.ts).
//
//   OPEN is session-only. It is whether the panel is expanded right now, and
//   it means nothing while the feature is off.
//
// A MODULE VARIABLE WITH SUBSCRIBERS, for the same reason navigation.ts and
// context.ts are: the bubble is mounted in main.tsx's shell so it outlives
// screen changes, while the control that toggles it sits in HomeScreen's row of
// pickers. Lifting this into main.tsx would thread an agent concern through the
// whole screen tree for one button. Subscribers rather than a bare setter
// because the state is genuinely shared -- the bubble's own X and its launcher
// change `open` too, and the home toggle has to show the truth when they do.
//
// localStorage, NOT app.settings: the same deliberate choice provider.ts makes
// for the API key and AgentBubble makes for the panel size. This whole thing is
// unreleased, and an experimental key has no business travelling with a team
// profile via PROFILE_KEYS.
// =============================================================================

const ENABLED_KEY = "xyi.agent.enabled";

type Listener = () => void;

let enabled = readEnabled();
let open = false;
const listeners: Listener[] = [];

function readEnabled(): boolean {
    try {
        // OFF unless explicitly turned on. An unreadable or absent value is
        // "never chosen", which is not the same as "chosen yes".
        return window.localStorage.getItem(ENABLED_KEY) === "1";
    } catch {
        return false;
    }
}

function announce(): void {
    // Copied before iterating: a listener unsubscribing inside its own callback
    // would otherwise shorten the array mid-loop and skip the next one.
    const snapshot = listeners.slice();
    for (let i = 0; i < snapshot.length; i++) snapshot[i]();
}

export function isAgentEnabled(): boolean {
    return enabled;
}

export function isBubbleOpen(): boolean {
    return enabled && open;
}

export function setAgentEnabled(next: boolean): void {
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
export function toggleAgentEnabled(): void {
    const next = !enabled;
    setAgentEnabled(next);
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
