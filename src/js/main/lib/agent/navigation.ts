// =============================================================================
// src/js/main/lib/agent/navigation.ts
// -----------------------------------------------------------------------------
// Lets the agent open a panel tool for you.
//
// A module variable rather than props or context, for the same reason
// localiseHandoff.ts is one: the agent lives inside a tool page, the navigator
// lives in main.tsx's shell, and ToolScreen renders tool components with no
// props at all. Threading a navigator down through ToolProps would put an
// agent concern into every tool's signature for the benefit of one caller.
//
// NAVIGATION ONLY, AND THAT BOUNDARY IS DELIBERATE.
// main.tsx's Screen union also carries `autoAction`, which finds a button by
// its exact visible text and clicks it (main.tsx:99). That is how the Command
// Palette jumps straight to "Trott 2.0" -- and it is deliberately NOT wired up
// here. Clicking "Generate Files" runs campaignLocaliserGenerate, which opens
// masters and writes a new _V01.aep. Handing the agent a generic button-clicker
// would mean the read-only tool table in tools.ts stops being the boundary on
// what it can do, and the real boundary becomes "any button label in the
// panel". An allowlist would not fix it either: the match is on button TEXT,
// so relabelling a button silently changes what is permitted.
//
// So: the agent opens the page and tells you which button to press. You press
// it. Adding writes is a separate design with its own confirmation gates, not
// a field appended to this call.
// =============================================================================

import { TOOLS as PANEL_TOOLS } from "../../toolRegistry";

/**
 * `livesIn` is passed through rather than resolved here: this module knows
 * about the registry, main.tsx knows about the Screen union, and neither
 * should have to learn the other's vocabulary.
 */
type Navigator = (toolId: string, livesIn?: string, autoAction?: string) => void;

let navigator: Navigator | null = null;

/** Called once by main.tsx on mount. */
export function setNavigator(fn: Navigator | null): void {
    navigator = fn;
}

export interface NavResult {
    ok: boolean;
    reason?: string;
    label?: string;
    /** The button that was actually pressed, when one was. */
    pressed?: string;
}

/**
 * Opens a tool by registry id.
 *
 * Validates against the registry rather than trusting the model, so a
 * hallucinated id fails loudly with the valid options instead of silently
 * navigating nowhere and leaving the agent to claim success.
 */
export function navigateToTool(toolId: string, action?: string): NavResult {
    if (!navigator) {
        return { ok: false, reason: "Navigation isn't available right now." };
    }

    const entry = PANEL_TOOLS.find((t) => t.id === toolId);

    if (!entry) {
        return {
            ok: false,
            reason:
                `No tool with id "${toolId}". Valid ids: ` +
                PANEL_TOOLS.map((t) => t.id).join(", "),
        };
    }

    // --- the click gate -------------------------------------------------
    //
    // Enforced HERE rather than in the prompt, because a prompt is not a
    // control: the agent already demonstrated it will report a failed call as
    // a success, so "we told it not to" is not a safety property. If the
    // registry does not explicitly mark a label "read", it is not clickable,
    // full stop -- including labels nobody has classified yet.
    if (action) {
        const known = (entry.actions || []).indexOf(action) !== -1;
        if (!known) {
            return {
                ok: false,
                reason:
                    `${entry.label} has no button labelled "${action}". Its buttons are: ` +
                    ((entry.actions || []).join(", ") || "none listed") + ".",
            };
        }
        const tier = entry.actionSafety ? entry.actionSafety[action] : undefined;
        if (tier !== "read") {
            return {
                ok: false,
                reason:
                    `"${action}" in ${entry.label} produces work, so it is not something I can press. ` +
                    `Open the tool and tell the artist to press it themselves.`,
            };
        }
    }

    navigator(toolId, entry.livesIn, action);
    return { ok: true, label: entry.label, pressed: action };
}
