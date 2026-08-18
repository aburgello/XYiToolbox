// =============================================================================
// src/js/main/lib/agent/capabilities.ts
// -----------------------------------------------------------------------------
// Renders toolRegistry's TOOLS into a compact capability list for the agent's
// system prompt, so that when it is asked to do something it cannot do, it can
// name the panel tool that CAN -- rather than saying "use the panel tool that
// does it" and leaving the artist to go hunting.
//
// The data already exists for exactly this purpose: CLAUDE.md §4 says to
// populate ToolEntry.actions with each real button's exact visible label
// because it drives search and ⌘K. Same list, same job, different consumer.
//
// BUILT ON FIRST CALL, NOT AT MODULE LOAD.
// toolRegistry lazily imports every tool component -- including AgentChat,
// which is what leads here. React.lazy defers those imports so there is no
// runtime cycle, but computing this at module top-level would depend on
// module-init order to stay correct. Doing it on first use sidesteps the
// question entirely: by the time anyone asks a question, every module is long
// since initialised.
//
// MEMOISED, and that is load-bearing rather than an optimisation: the system
// prompt is the cached prefix of every request (see provider.ts). It has to be
// byte-identical call to call or the cache silently never reads and every
// question pays full input price.
// =============================================================================
import { TOOLS as PANEL_TOOLS, CATEGORIES } from "../../toolRegistry";
import { ACTIONS } from "../../tools/Toolset";

let cached: string | null = null;

/** Keeps one tool's line from running away — QuickFX alone lists twenty actions. */
const MAX_ACTIONS = 6;
const MAX_DESC = 170;

export function buildCapabilityList(): string {
    if (cached !== null) return cached;

    const categoryLabel: Record<string, string> = {};
    for (const c of CATEGORIES) categoryLabel[c.id] = c.label;

    const lines: string[] = [];

    for (const t of PANEL_TOOLS) {
        const where = t.categories
            .map((id) => categoryLabel[id] || id)
            .join("/");

        // THE ID IS NOT OPTIONAL HERE. Without it the model has to infer an id
        // from the display label to call open_tool, and the two do not reliably
        // match -- "Big Guy Localiser" is `csv-localiser`, "Effects" is
        // `quick-fx`. It guessed "big-guy-localiser", the call failed, and it
        // then reported success anyway. Give it the id and there is nothing to
        // guess at.
        let line = `- ${t.label} (id: ${t.id}) [${where}]`;

        if (t.description) {
            const d = t.description.length > MAX_DESC
                ? t.description.slice(0, MAX_DESC).replace(/\s+\S*$/, "") + "…"
                : t.description;
            line += ` — ${d}`;
        }

        if (t.actions && t.actions.length) {
            const shown = t.actions.slice(0, MAX_ACTIONS);
            const more = t.actions.length > shown.length ? ", …" : "";
            // [pressable] marks the buttons open_tool will actually press.
            // Everything else is refused by navigation.ts regardless of what
            // this list says -- the marker is a hint to save a wasted call,
            // not the control itself.
            const marked = shown.map((a) =>
                t.actionSafety && t.actionSafety[a] === "read" ? `${a} [pressable]` : a
            );
            line += ` Buttons: ${marked.join(", ")}${more}.`;
        }

        lines.push(line);

        // ANNOTATED BUTTONS GET THEIR OWN INDENTED LINES. Without these the
        // agent has a label and nothing else, and invents a plausible purpose
        // from the name -- it described "Bespoke It" as custom territory
        // handling when it is for several masters in one deliverable. Sparse
        // by design: only tools with actionNotes cost these extra lines.
        if (t.actionNotes) {
            for (const label of Object.keys(t.actionNotes)) {
                lines.push(`    · ${label}: ${t.actionNotes[label]}`);
            }
        }
    }

    cached = lines.join("\n");
    return cached;
}

let cachedActions: string | null = null;

/**
 * The one-click Toolset actions the agent may actually run.
 *
 * These live in Toolset.tsx's own ACTIONS array rather than in toolRegistry --
 * per CLAUDE.md §4, a one-click action with no inputs goes there instead of
 * getting a TOOLS entry. That is why the agent could not see a single one of
 * them: the capability list is built from TOOLS, and these were never in it.
 *
 * DESTRUCTIVE ACTIONS ARE NOT LISTED AT ALL. Naming an action it will be
 * refused anyway only invites it to try, and then to explain the refusal to
 * an artist who never asked. The refusal path still exists in tools.ts for an
 * id the model invents or remembers.
 *
 * Memoised for the same cache-prefix reason as buildCapabilityList.
 */
export function buildRunnableActionList(): string {
    if (cachedActions !== null) return cachedActions;

    const TAG: Record<string, string> = {
        undoable: " (undoable)",
        additive: " (creates new files — overwrites nothing)",
    };

    const rows = ACTIONS.filter(
        (a) => a.safety === "read" || a.safety === "undoable" || a.safety === "additive"
    ).map((a) => {
        const tag = TAG[a.safety || ""] || "";
        const d =
            a.description.length > MAX_DESC
                ? a.description.slice(0, MAX_DESC).replace(/\s+\S*$/, "") + "…"
                : a.description;
        return `- ${a.label} (id: ${a.id})${tag} — ${d}`;
    });

    cachedActions = rows.join("\n");
    return cachedActions;
}
