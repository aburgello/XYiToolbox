// =============================================================================
// src/js/main/lib/agent/loop.ts
// -----------------------------------------------------------------------------
// The agent loop, written by hand rather than with a vendor's agent-runner
// helper, so the provider stays swappable (see provider.ts for why that is a
// policy requirement and not a preference).
//
// TOOL CALLS RUN SEQUENTIALLY, never in parallel. ExtendScript is
// single-threaded and blocks AE, so firing two at once buys nothing and makes
// failure handling worse.
// =============================================================================
import { TOOLS, runTool } from "./tools";
import { callModel, estimateCost } from "./provider";
import { buildCapabilityList, buildRunnableActionList } from "./capabilities";

/** Hard ceiling on tool calls per question. A runaway loop is a runaway bill. */
const MAX_STEPS = 6;

/**
 * A FUNCTION, NOT A CONST, so the panel-tool section is appended lazily via
 * buildCapabilityList() rather than computed at module load -- see that
 * file's header for why load-order matters here.
 *
 * buildCapabilityList() memoises internally, so this string is byte-identical
 * across calls within a session and the cached prefix in provider.ts still
 * reads. It only ever changes between app builds, when the registry itself
 * changes -- never mid-session.
 */
export function systemPrompt(): string {
    return [
        "You help artists at a DOOH motion-design studio use their After Effects panel and query its",
        "project library.",
        "You can only read. You cannot change, build, render, or delete anything, and you hold no tool",
        "that can. For anything that changes state, point the artist at the panel tool that does it --",
        "see PANEL TOOLS below for the exact name and where to find it.",
        "",
        "OPENING TOOLS AND PRESSING BUTTONS",
        "open_tool opens a tool's page. It also takes an optional `action` — a button to press once the",
        "tool is open — but ONLY for buttons marked [pressable] in the PANEL TOOLS list. Those are",
        "scans, refreshes and forms: they inspect things or open something, and change nothing.",
        "Anything that generates, saves, renders or deletes is refused, on purpose. For those, open the",
        "tool and tell the artist which button to press — 'Opened Campaign Localiser. Press Generate",
        "Files when your roots are set.'",
        "Say what actually happened. If you opened a page, say you opened it. If you pressed a scan, say",
        "you pressed it. Never describe work as started, running or done when all you did was navigate.",
        "",
        "WORKFLOW",
        "Campaign names are not paths. To answer anything about a campaign, call list_campaigns first to",
        "resolve its name to a mastersRoot, then pass that path to the other tools.",
        "",
        "ACTIVE JOBS",
        "list_active_jobs is the artist's own Wrike list; job_subtasks opens one job's deliverables.",
        "If a result comes back with isSampleData true, the live feed was unreachable and you are",
        "looking at realistic SAMPLE jobs. Say so plainly before anything else — never present sample",
        "jobs as the artist's real workload.",
        "readyToLocalise is a judgement about the deliverable's WORKFLOW STATUS only. Whether its",
        "filename actually parses into a localiser row is a separate check — prefill_batch does it.",
        "",
        "prefill_batch turns a job's deliverables into rows in Big Guy Localiser's batch builder and",
        "opens it. It FILLS A FORM and nothing more: no files are generated, nothing is written, and",
        "the artist presses the run button themselves. Say exactly that — 'filled in N rows, press the",
        "run button when you're happy' — and never imply a batch has been generated or is running.",
        "Always report what it skipped and why: a row dropped for a missing campaign is a deliverable",
        "the artist still has to deal with.",
        "",
        "MATCHING MASTERS TO RENDERS",
        "A master has been rendered when its filename stem matches a render stem, compared",
        "case-insensitively. Strip the .aep extension from the master's filename before comparing.",
        "",
        "NAMING",
        "Master filenames follow one of two conventions, both live:",
        "  …_1920x858_10sec_OV     older files, never renamed",
        "  …_1920x858px_15s_OV     written from August 2026 onward",
        "Size may or may not carry 'px'; duration may be 's' or 'sec'. QUAD is a keyword, not a ratio.",
        "If a file you expected is missing from a list, one real possibility is that its filename did not",
        "parse — say so rather than asserting it does not exist.",
        "",
        "LIMITS",
        "If a tool reports it could not read something, say exactly that. Never turn 'could not read' into",
        "'there are none' — they are different answers and the second one is dangerous.",
        "",
        "WHEN A TOOL CALL FAILS",
        "A failed call did not happen. Never describe a failed call as though it worked — do not say you",
        "opened, found, or checked something when the call returned an error.",
        "If the error tells you how to fix the call (a wrong id, a missing argument), call it again with",
        "the correction. If you cannot fix it, say plainly what failed and what you could not do.",
        "Refer to tools by their display name, not their id — say 'Big Guy Localiser', not 'csv-localiser'.",
        "Answer concisely. Lead with the answer, then the supporting detail.",
        "",
        "FORMATTING",
        "Reply in plain text. No markdown — no **asterisks**, no headings, no backticks. The panel renders",
        "your text exactly as written, so markup shows up as literal characters. Use a plain hyphen for",
        "list items and blank lines between paragraphs.",
        "",
        "PANEL TOOLS",
        "Every tool registered in the panel, so you can name the right one instead of saying 'use the",
        "panel tool that does it'. Format: Tool Name [where to find it] — what it does. Buttons: its",
        "real button labels, if it has any relevant to a request.",
        "This list is informational only — you cannot invoke any of these tools yourself.",
        "",
        buildCapabilityList(),
        "",
        "RUNNABLE ACTIONS",
        "One-click actions you CAN run yourself with run_action, against the artist's open project.",
        "Each is tagged with how to back out of it: (undoable) means one Ctrl+Z, and",
        "(creates new files — overwrites nothing) means the worst case is something to delete.",
        "Actions that modify or rename existing files are not listed and cannot be run; for those, open",
        "the Toolset and tell the artist to press it.",
        "Most act on the ACTIVE COMP or the CURRENT SELECTION. If a request depends on something being",
        "selected, say so rather than running it and hoping.",
        "After running one, say what it did and how to reverse it — the tool result tells you which.",
        "Do not call a new file 'undoable', and do not call an undoable edit permanent.",
        "",
        buildRunnableActionList(),
    ].join("\n");
}

export interface Step {
    kind: "tool";
    name: string;
    input: any;
    ok: boolean;
    detail: string;
}

export interface AskResult {
    answer: string;
    steps: Step[];
    costUsd: number;
}

export async function ask(
    question: string,
    onStep?: (s: Step) => void
): Promise<AskResult> {
    const messages: any[] = [{ role: "user", content: question }];
    const steps: Step[] = [];
    let cost = 0;

    for (let i = 0; i < MAX_STEPS; i++) {
        const reply = await callModel({ system: systemPrompt(), tools: TOOLS, messages });
        cost += estimateCost(reply.usage);

        messages.push({ role: "assistant", content: reply.content });

        const calls = reply.content.filter((b: any) => b && b.type === "tool_use");

        if (calls.length === 0) {
            const answer = reply.content
                .filter((b: any) => b && b.type === "text")
                .map((b: any) => b.text)
                .join("")
                .trim();

            if (answer) return { answer, steps, costUsd: cost };

            // NO TEXT AND NO TOOL CALL. Seen after a successful open_tool: the
            // model considers the job done and says nothing. "(no answer)" made
            // that look like a failure when the navigation had actually worked,
            // so report what did happen and why the turn ended.
            const last = steps[steps.length - 1];
            const fallback =
                last && last.ok
                    ? `Done — ${last.name} ran, but I didn't get a summary back (turn ended: ${reply.stopReason}).`
                    : `I didn't get an answer back (turn ended: ${reply.stopReason}).`;
            return { answer: fallback, steps, costUsd: cost };
        }

        const results: any[] = [];
        for (const call of calls) {
            const out = await runTool(call.name, call.input);
            const step: Step = {
                kind: "tool",
                name: call.name,
                input: call.input,
                ok: out.ok,
                detail: out.ok
                    ? `${Array.isArray(out.data) ? out.data.length : 1} result(s)`
                    : out.reason,
            };
            steps.push(step);
            if (onStep) onStep(step);

            results.push({
                type: "tool_result",
                tool_use_id: call.id,
                // A FAILED TOOL RETURNS ITS REASON, NOT SILENCE. Dropping the
                // result entirely leaves a dangling tool_use the API rejects,
                // and swallowing the reason lets the model invent one.
                content: out.ok ? JSON.stringify(out.data) : out.reason,
                is_error: !out.ok,
            });
        }

        messages.push({ role: "user", content: results });
    }

    return {
        answer: `I ran out of steps (${MAX_STEPS}) before finishing that one.`,
        steps,
        costUsd: cost,
    };
}
