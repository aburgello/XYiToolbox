// =============================================================================
// src/js/main/lib/agent/context.ts
// -----------------------------------------------------------------------------
// WHAT THE ARTIST IS LOOKING AT, sent with every question.
//
// It is what turns "precompose these" and "what's on this layer?" from a
// guessing game into a straight answer, and it stops the agent asking which
// comp is meant when the comp is on screen in front of the person asking.
//
// IT RIDES IN THE USER TURN, NEVER IN THE SYSTEM PROMPT, and that is not a
// stylistic choice. Prompt caching is a PREFIX match: tools render first, then
// system, then messages. The system prompt plus tool definitions is a ~8,800
// token cached prefix, so folding a per-screen or per-comp line into it would
// invalidate the entire cache every time the artist navigated or selected a
// different layer -- turning the one lever that makes this affordable into a
// cost. After the last cached breakpoint it costs a few dozen tokens and
// nothing else.
//
// (The tidier home for this would be a mid-conversation `role: "system"`
// message, which carries operator authority rather than looking like something
// the artist typed. That is unavailable on the model this runs on, so the user
// turn it is -- hence the explicit "Context (not part of the question)" label,
// which is doing real work rather than being decorative.)
//
// GATHERED FRESH AT SEND TIME, never cached. A stale snapshot is worse than no
// snapshot: it makes the agent confidently wrong about which comp is open,
// which is exactly the failure this exists to prevent.
// =============================================================================
import { evalTS } from "../../../lib/utils/bolt";
import { TOOLS as PANEL_TOOLS, CATEGORIES } from "../../toolRegistry";

/**
 * Where the artist is, as the shell's own screen shape rather than a label.
 *
 * main.tsx reports the ids it already has and this file turns them into words.
 * That keeps the registry out of the shell -- main.tsx does not import it today
 * and should not start for a caption -- and keeps the phrasing next to the rest
 * of the phrasing.
 *
 * A module variable for the same reason navigation.ts holds its navigator that
 * way: the agent lives in a floating bubble outside the screen tree, and
 * threading this through would put an agent concern into the shell's
 * navigation type.
 */
export interface AgentScreen {
    type: "home" | "category" | "tool";
    categoryId?: string;
    toolId?: string;
}

let currentScreen: AgentScreen | null = null;

export function setAgentScreen(screen: AgentScreen | null): void {
    currentScreen = screen;
}

/** The current screen in words, or "" when there is nothing useful to say. */
function screenLabel(): string {
    const s = currentScreen;
    if (!s) return "";
    if (s.type === "home") return "the panel's home screen";
    if (s.type === "category") {
        const cat = CATEGORIES.filter((c) => c.id === s.categoryId)[0];
        return cat ? "the " + cat.label + " screen" : "";
    }
    const tool = PANEL_TOOLS.filter((t) => t.id === s.toolId)[0];
    // Falls back to NOTHING rather than to the raw id: "the csv-localiser
    // screen" is worse than no line at all, because it teaches the model an
    // identifier the artist has never seen.
    return tool ? "the " + tool.label + " tool" : "";
}

interface Snapshot {
    success: boolean;
    compName?: string;
    width?: number;
    height?: number;
    frameRate?: number;
    seconds?: number;
    selectedCount?: number;
    selectedNames?: string[];
    expressionEngine?: string;
}

/**
 * One line of situational context, or "" when there is nothing worth saying.
 *
 * Returning "" rather than "nothing is open" matters: a line saying the panel
 * knows nothing is pure cost on every question, and an absent line already
 * means the same thing.
 */
export async function buildContextLine(): Promise<string> {
    const parts: string[] = [];
    const where = screenLabel();
    if (where) parts.push("The artist is on " + where + ".");

    let snap: Snapshot | undefined;
    try {
        snap = (await evalTS("agentContextSnapshot")) as unknown as Snapshot | undefined;
    } catch {
        // No bridge is a normal state — in the browser there is no AE at all.
        // The screen label alone is still worth sending.
    }

    if (snap && snap.compName) {
        let comp = 'Open comp: "' + snap.compName + '"';
        if (snap.width && snap.height) comp += " " + snap.width + "x" + snap.height;
        if (snap.frameRate) comp += " at " + snap.frameRate + "fps";
        if (snap.seconds) comp += ", " + snap.seconds + "s";
        parts.push(comp + ".");

        const n = snap.selectedCount || 0;
        if (n === 0) {
            // SAID OUT LOUD, because "nothing selected" is the single most
            // common reason a write tool refuses, and an agent that knows it
            // up front can say so instead of trying and reporting a failure.
            parts.push("No layers are selected.");
        } else {
            const names = snap.selectedNames || [];
            const shown = names.join(", ");
            const more = n > names.length ? " and " + (n - names.length) + " more" : "";
            parts.push(n + " layer" + (n === 1 ? "" : "s") + " selected" + (shown ? ": " + shown + more : "") + ".");
        }
    } else if (snap) {
        parts.push("No composition is open.");
    }

    if (snap && snap.expressionEngine) {
        parts.push("Expression engine: " + snap.expressionEngine + ".");
    }

    if (!parts.length) return "";

    // LABELLED, because it is arriving in the user's turn and is not the user's
    // words. Without the label the model can answer the context instead of the
    // question, or quote it back as though the artist had said it.
    return "\n\n[Context (not part of the question): " + parts.join(" ") + "]";
}
