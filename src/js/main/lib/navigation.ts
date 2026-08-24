// =============================================================================
// src/js/main/lib/navigation.ts
// -----------------------------------------------------------------------------
// Opens a panel tool from anywhere.
//
// Was `lib/agent/navigation.ts`. It outlived the agent because the problem it
// solves is not an agent problem: something mounted in main.tsx's shell needs
// to change the screen, and main.tsx's shell is where the Screen union lives.
// The Workflows bubble is exactly that — it floats above every screen, so it
// has no `onSelectTool` prop to be handed and no parent to ask.
//
// A MODULE VARIABLE rather than props or context, for the same reason
// localiseHandoff.ts is one: threading a navigator down through ToolProps would
// put it into every tool's signature for the benefit of two callers.
//
// VALIDATED, NOT TRUSTED. A tool id can arrive from a shared JSON file on the
// team folder that outlived the tool it names, so an unknown id fails loudly
// with the valid options rather than navigating nowhere and leaving the caller
// to claim success.
//
// THE CLICK GATE IS STILL HERE, and it still earns its place. main.tsx's Screen
// union carries `autoAction`, which finds a button by its exact visible text and
// clicks it. That match is on button TEXT, so relabelling a button silently
// changes what a stored link is permitted to press — and "Generate Files" runs
// campaignLocaliserGenerate, which opens masters and writes a new _V01.aep. So
// a caller may only auto-press a button the registry explicitly grades "read";
// anything else navigates and leaves the press to the artist. An allowlist of
// labels would not fix it, for the same reason: the labels are the weak part.
// =============================================================================

import { TOOLS as PANEL_TOOLS } from "../toolRegistry";

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
 * Validates against the registry rather than trusting the caller: ids reach
 * here from shared files that outlive the tools they name, and a stale one must
 * say so rather than silently doing nothing.
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
    // Fail-closed: if the registry does not explicitly mark a label "read", it
    // is not auto-clickable, full stop -- including labels nobody has
    // classified yet. A button must not become pressable-by-stored-link by
    // having been forgotten here.
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
                    `"${action}" in ${entry.label} produces work, so it is not pressed automatically. ` +
                    `The tool opens; press it there.`,
            };
        }
    }

    navigator(toolId, entry.livesIn, action);
    return { ok: true, label: entry.label, pressed: action };
}
