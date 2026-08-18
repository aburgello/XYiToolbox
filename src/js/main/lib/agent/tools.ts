// =============================================================================
// src/js/main/lib/agent/tools.ts
// -----------------------------------------------------------------------------
// THE THREE READ-ONLY TOOLS the agent may call, and the dispatcher that runs
// them. Nothing here writes, opens, saves, builds, or queues anything -- see
// CLAUDE.md §1 for why that boundary is the whole point.
//
// `runScript` is deliberately absent and must stay absent. It is a bare eval
// over the bridge, so an agent holding it could do anything at all, including
// the exact thing the masters rule exists to prevent.
//
// TWO BACKEND SHAPES, NOT ONE. CLAUDE.md §2 says every function returns
// {success, error} -- but only bespokeListMasters actually does. loadCampaigns
// and scanAllRenders return BARE ARRAYS, and `undefined` from either means the
// bridge didn't answer. That is "couldn't ask", never "there are none", and
// collapsing the two is how the model ends up confidently telling an artist
// their campaign is empty when the share is simply unmounted. Every branch
// below normalises to one shape so the model can't make that mistake.
//
// FLAT SCALAR ARGUMENTS ONLY. Arguments are JSON.stringify'd and spliced into
// eval'd ExtendScript source; nested arrays-of-objects lose their values in
// transit (CLAUDE.md §2). Keep every input_schema one level deep.
// =============================================================================
import { evalTS } from "../../../lib/utils/bolt";
import { setPendingFill, takePendingFill } from "./fieldHandoff";
import { navigateToTool } from "./navigation";
// The registry is the single source of truth for what may be filled;
// capabilities.ts reads the same list to tell the model the field ids.
import { TOOLS as PANEL_TOOLS } from "../../toolRegistry";
import {
    fetchJobs,
    parseJobTitle,
    jobReadiness,
    LOCALISABLE_STATUSES,
    FINISHED_STATUSES,
    type WrikeJob,
} from "../jobsFeed";
import { loadJobRows, classifyRows, stageBatchFromJob } from "../jobRows";
import { ACTIONS } from "../../tools/Toolset";

export interface ToolDef {
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: Record<string, {
            type: string;
            description: string;
            /**
             * A value-type for an object argument, i.e. one level of nesting.
             *
             * THE FLAT-SCALAR RULE AT THE TOP OF THIS FILE IS A BRIDGE RULE.
             * It exists because arguments are JSON.stringify'd and spliced into
             * eval'd ExtendScript source, where nested arrays-of-objects lose
             * their values in transit. A tool whose input never reaches
             * ExtendScript is not subject to it: fill_fields stages values in a
             * frontend module and navigates, and nothing it receives is ever
             * marshalled across evalTS.
             *
             * So: allowed, and only for tools that stay panel-side. If a tool
             * taking one of these ever grows a bridge call, its argument has to
             * become a JSON string first (CLAUDE.md §2).
             */
            additionalProperties?: { type: string };
        }>;
        required: string[];
    };
}

export type ToolResult =
    | { ok: true; data: unknown }
    | { ok: false; reason: string };

// --- Definitions --------------------------------------------------------
//
// Descriptions state WHEN to call and WHAT the argument must be, not just what
// the tool does. The single most likely first-run failure is the model passing
// a campaign NAME where a masters-root PATH is required, and the description is
// where that gets prevented -- no amount of system-prompt text fixes a tool
// whose contract is vague.

export const TOOLS: ToolDef[] = [
    {
        name: "list_campaigns",
        description:
            "List the campaigns available in OV Library, with the masters root folder path for each. " +
            "Call this FIRST whenever the user names a campaign, to resolve that name to its masters root. " +
            "Takes no arguments.",
        input_schema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "list_masters",
        description:
            "List every master .aep in a campaign's masters root, with each master's filename, creative, " +
            "pixel size and duration. Requires the mastersRoot PATH from list_campaigns — it will not " +
            "accept a campaign name.",
        input_schema: {
            type: "object",
            properties: {
                mastersRoot: {
                    type: "string",
                    description:
                        "Absolute path to the campaign's masters root, exactly as returned by list_campaigns.",
                },
            },
            required: ["mastersRoot"],
        },
    },
    {
        name: "list_active_jobs",
        description:
            "The artist's current Wrike jobs — the same feed behind the Active Jobs card on the home " +
            "screen. Returns each job's film, territory, batch, status, whether it is ready to " +
            "localise, and how many subtasks (deliverables) it has. Use this for 'what's on my plate', " +
            "'what can I localise', 'what's waiting'. Takes no arguments.",
        input_schema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "job_subtasks",
        description:
            "The deliverables inside one job, with each one's workflow status and whether that status " +
            "means it can be localised now. Subtask names are deliverable filenames in the studio " +
            "convention. Get the jobId from list_active_jobs first.",
        input_schema: {
            type: "object",
            properties: {
                jobId: {
                    type: "string",
                    description: "The job's id, exactly as returned by list_active_jobs.",
                },
            },
            required: ["jobId"],
        },
    },
    {
        name: "run_action",
        description:
            "Run one of the panel's one-click Toolset actions against the artist's open After Effects " +
            "project — scaling, rotating, organising, renaming comps, applying effects and so on. " +
            "Only actions listed under RUNNABLE ACTIONS can be run: those change nothing, change the " +
            "open project in a way Ctrl+Z reverses, or create new files without touching existing " +
            "ones. Anything that modifies or renames files already on disk is refused. Most act on " +
            "the ACTIVE COMP or the CURRENT SELECTION, so say what the artist needs selected if it " +
            "matters.",
        input_schema: {
            type: "object",
            properties: {
                actionId: {
                    type: "string",
                    description:
                        "The action's id from the RUNNABLE ACTIONS list, e.g. 'rotate-90cc'. " +
                        "Lower-case with hyphens, not the display label.",
                },
            },
            required: ["actionId"],
        },
    },
    {
        name: "prefill_batch",
        description:
            "Turn a Wrike job's deliverables into rows in Big Guy Localiser's batch builder, and open " +
            "it with those rows filled in. This FILLS A FORM — it generates nothing, writes no files " +
            "and touches no project. The artist reviews the rows and presses the run button " +
            "themselves. Deliverables whose names do not carry a campaign, size and duration are left " +
            "out, and reported back so you can say which and why.",
        input_schema: {
            type: "object",
            properties: {
                jobId: {
                    type: "string",
                    description: "The job's id, exactly as returned by list_active_jobs.",
                },
            },
            required: ["jobId"],
        },
    },
    {
        name: "open_tool",
        description:
            "Open one of the panel's tools so the artist lands on the right page. Use this when the " +
            "request needs a tool you cannot run yourself — you open the page, then tell them which " +
            "button to press. This only changes what is on screen; it does not press anything, run " +
            "anything, or change any file. Use the tool's registry id from the PANEL TOOLS list.",
        input_schema: {
            type: "object",
            properties: {
                toolId: {
                    type: "string",
                    description:
                        "The tool's registry id, e.g. 'campaign-localiser' or 'name-audit'. Ids are " +
                        "lower-case with hyphens, not the display label.",
                },
                action: {
                    type: "string",
                    description:
                        "Optional. A button to press once the tool opens — only buttons marked " +
                        "[pressable] in the PANEL TOOLS list. Anything that generates, saves or " +
                        "renders is refused; open the tool and ask the artist to press it instead.",
                },
            },
            required: ["toolId"],
        },
    },
    {
        name: "fill_fields",
        description:
            "Put values into a panel tool's fields and open it, so the artist can check them and press " +
            "the button themselves. This FILLS A FORM — it generates nothing, writes no files and " +
            "touches no project. Only the fields listed for a tool can be filled; anything else is " +
            "refused. Fields the artist has already typed into are left alone and reported back, so " +
            "say which ones you filled and which you did not. Never say you have run, generated or " +
            "saved anything — you have filled a form and stopped.",
        input_schema: {
            type: "object",
            properties: {
                toolId: {
                    type: "string",
                    description: "The tool's id from the PANEL TOOLS list, e.g. 'name-generator'.",
                },
                values: {
                    type: "object",
                    description:
                        "Field id to value, e.g. {\"campaign\": \"ODY\", \"territory\": \"Turkey\"}. " +
                        "Use the field ids given in FILLABLE FIELDS, not the on-screen labels.",
                    additionalProperties: { type: "string" },
                },
            },
            required: ["toolId", "values"],
        },
    },
    {
        name: "scan_renders",
        description:
            "Find every rendered video file under a campaign's masters root and return each render's " +
            "filename stem. A master counts as rendered when its filename stem matches a render stem, " +
            "compared case-insensitively. Requires the mastersRoot PATH from list_campaigns.",
        input_schema: {
            type: "object",
            properties: {
                mastersRoot: {
                    type: "string",
                    description:
                        "Absolute path to the campaign's masters root, exactly as returned by list_campaigns.",
                },
            },
            required: ["mastersRoot"],
        },
    },
];

// --- Mock data ----------------------------------------------------------
//
// `yarn dev` never executes ExtendScript (CLAUDE.md §6), so without these the
// whole tool is untestable in the browser and you'd be debugging the model and
// the bridge at the same time. Same fallback pattern as CompInspector's
// MOCK_COMP. ODY has one master with no matching render, on purpose -- that is
// the answer the prototype has to arrive at.

const MOCK_CAMPAIGNS = [
    { name: "ODY", mastersRoot: "/Volumes/Studio/Masters/ODY" },
    { name: "MERIDIAN", mastersRoot: "/Volumes/Studio/Masters/MERIDIAN" },
];

const MOCK_MASTERS = [
    { name: "ODY_HORSE_1920x858_10sec_OV.aep",    creative: "HORSE",  size: "1920x858",  duration: "10sec" },
    { name: "ODY_HORSE_1080x1920px_15s_OV.aep",   creative: "HORSE",  size: "1080x1920", duration: "15s"   },
    { name: "ODY_FALCON_3240x1920px_15s_OV.aep",  creative: "FALCON", size: "3240x1920", duration: "15s"   },
];

const MOCK_RENDERS = [
    { stem: "ODY_HORSE_1920x858_10sec_OV" },
    { stem: "ody_horse_1080x1920px_15s_ov" }, // lower-cased on purpose: the stem match is case-insensitive
];

// --- Dispatch -----------------------------------------------------------

export async function runTool(name: string, input: any): Promise<ToolResult> {
    switch (name) {
        case "list_campaigns": {
            const res = await evalTS("loadCampaigns").catch(() => undefined);
            if (res === undefined) return mockOr({ ok: true, data: MOCK_CAMPAIGNS });
            const rows = (res as any[]) || [];
            return { ok: true, data: rows.map((c) => ({ name: c.name, mastersRoot: c.mastersRoot })) };
        }

        case "list_masters": {
            if (!input || typeof input.mastersRoot !== "string" || !input.mastersRoot) {
                return { ok: false, reason: "list_masters needs a mastersRoot path. Call list_campaigns first." };
            }
            const res = (await evalTS("bespokeListMasters", input.mastersRoot).catch(() => undefined)) as
                | { success: boolean; error?: string; masters?: any[] }
                | undefined;
            if (res === undefined) return mockOr({ ok: true, data: MOCK_MASTERS });
            if (!res.success) return { ok: false, reason: res.error || "Couldn't read the masters folder." };
            // TRIMMED ON PURPOSE. BespokeMaster carries 13 fields; this question
            // needs four. Tool results are re-sent on every later call in the
            // turn, so a wide row is paid for repeatedly -- and the model
            // reasons better over a narrow one.
            const masters = (res.masters || []).map((m) => ({
                name: m.name,
                creative: m.creative,
                size: m.size,
                duration: m.duration,
            }));
            return { ok: true, data: masters };
        }

        case "list_active_jobs": {
            const feed = await loadJobs();
            if (!feed.ok) return feed;
            const res = feed.res;
            return {
                ok: true,
                data: {
                    // LOUD NAME ON PURPOSE. When the worker is unreachable the
                    // feed serves realistic SAMPLE jobs -- drawn from real job
                    // titles -- and an agent relaying those as the artist's
                    // actual workload would be worse than saying nothing.
                    isSampleData: !!res.mock,
                    whoseList: res.viewingAs,
                    feedError: res.error,
                    jobs: res.jobs.map(summariseJob),
                },
            };
        }

        case "job_subtasks": {
            if (!input || typeof input.jobId !== "string" || !input.jobId) {
                return { ok: false, reason: "job_subtasks needs a jobId from list_active_jobs." };
            }
            const feed = await loadJobs();
            if (!feed.ok) return feed;
            const job = feed.res.jobs.filter((j) => j.id === input.jobId)[0];
            if (!job) {
                return {
                    ok: false,
                    reason:
                        `No job with id "${input.jobId}". Call list_active_jobs and use an id from it.`,
                };
            }
            const subs = job.subtasks || [];
            return {
                ok: true,
                data: {
                    isSampleData: !!feed.res.mock,
                    job: summariseJob(job),
                    // `subtaskCount` can be present with no subtasks array --
                    // "we know there are 4, we don't have them" is not "there
                    // are none", so say which it is.
                    subtasksAvailable: subs.length > 0 || !job.subtaskCount,
                    subtasks: subs.map((s) => {
                        const status = String(s.customStatusName || s.status || "").trim();
                        const finished =
                            String(s.status || "").trim() === "Completed" ||
                            FINISHED_STATUSES.test(status);
                        // Only judge against the allowlist when a CUSTOM status
                        // exists: the bare status group is only ever Active/
                        // Completed/Deferred/Cancelled, none of which is
                        // localisable, so testing it would mark everything held.
                        const hasCustom = !!String(s.customStatusName || "").trim();
                        const held = hasCustom && !LOCALISABLE_STATUSES.test(status) && !finished;
                        return {
                            name: s.name,
                            status: status || "unknown",
                            finished,
                            readyToLocalise: !finished && !held && hasCustom,
                            heldBack: held,
                        };
                    }),
                },
            };
        }

        case "run_action": {
            if (!input || typeof input.actionId !== "string" || !input.actionId) {
                return { ok: false, reason: "run_action needs an actionId from the RUNNABLE ACTIONS list." };
            }
            const entry = ACTIONS.filter((a) => a.id === input.actionId)[0];
            if (!entry) {
                return {
                    ok: false,
                    reason:
                        `No action with id "${input.actionId}". Runnable ids: ` +
                        ACTIONS.filter(isRunnable).map((a) => a.id).join(", "),
                };
            }
            // THE GATE. Enforced here, never in the prompt -- an unclassified
            // action is treated as a write, so nothing becomes runnable by
            // having been forgotten in Toolset.tsx.
            if (!isRunnable(entry)) {
                return {
                    ok: false,
                    reason:
                        `"${entry.label}" modifies or renames files that already exist, which cannot ` +
                        `be undone, so I can't run it. Open the Toolset and press it yourself if ` +
                        `that's what you want.`,
                };
            }

            try {
                const result = await entry.run();
                // null is the picker-cancelled sentinel, distinct from a
                // failure and from evalTSSafe's own "no bridge" undefined --
                // reporting a cancel as success is how an agent claims work
                // it did not do.
                if (result === null) {
                    return { ok: true, data: { ran: entry.label, outcome: "cancelled by the artist" } };
                }
                if (result === undefined) {
                    return { ok: false, reason: `No bridge to After Effects — ${entry.label} did not run.` };
                }
                return {
                    ok: true,
                    data: {
                        ran: entry.label,
                        outcome: entry.successText(result),
                        // So the model can tell the artist how to back out,
                        // and does not describe a new file as "undoable".
                        howToReverse:
                            entry.safety === "undoable"
                                ? "Ctrl+Z / Cmd+Z in After Effects"
                                : entry.safety === "additive"
                                ? "nothing was overwritten — delete what it created if it was wrong"
                                : "nothing to reverse, this only reported",
                    },
                };
            } catch (e: any) {
                return { ok: false, reason: `${entry.label} failed: ${e?.message || e}` };
            }
        }

        case "prefill_batch": {
            if (!input || typeof input.jobId !== "string" || !input.jobId) {
                return { ok: false, reason: "prefill_batch needs a jobId from list_active_jobs." };
            }
            const feed = await loadJobs();
            if (!feed.ok) return feed;
            const job = feed.res.jobs.filter((j) => j.id === input.jobId)[0];
            if (!job) {
                return { ok: false, reason: `No job with id "${input.jobId}". Call list_active_jobs first.` };
            }
            if (feed.res.mock) {
                // Staging invented deliverables into a real batch builder is
                // the one thing worse than showing sample jobs in a list.
                return {
                    ok: false,
                    reason:
                        "The live jobs feed is unreachable, so this job is sample data. " +
                        "I won't fill the batch builder with invented deliverables.",
                };
            }

            const rows = await loadJobRows(job);
            const verdict = classifyRows(rows);

            if (verdict.sendable.length === 0) {
                return {
                    ok: false,
                    reason:
                        `Nothing in "${job.title}" can be sent: ` +
                        `${verdict.hidden} row(s) missing campaign/size/duration, ` +
                        `${verdict.doneCount} already finished, ${verdict.heldCount} not at a localisable status.`,
                };
            }

            const staged = stageBatchFromJob(job, rows);
            const nav = navigateToTool("csv-localiser");

            return {
                ok: true,
                data: {
                    filledInto: "Big Guy Localiser — Build a Batch",
                    opened: nav.ok ? nav.label : undefined,
                    navigationError: nav.ok ? undefined : nav.reason,
                    territory: staged.territory,
                    batch: staged.batch,
                    rowsFilled: staged.rows.length,
                    // Named rather than counted: "3 rows were skipped" sends
                    // the artist hunting, "these three, for these reasons"
                    // does not.
                    skipped: staged.skipped,
                    finishedCount: verdict.doneCount,
                    heldCount: verdict.heldCount,
                    nothingHasRunYet: true,
                },
            };
        }

        case "open_tool": {
            if (!input || typeof input.toolId !== "string" || !input.toolId) {
                return { ok: false, reason: "open_tool needs a toolId from the PANEL TOOLS list." };
            }
            const action = typeof input.action === "string" && input.action ? input.action : undefined;
            const nav = navigateToTool(input.toolId, action);
            if (!nav.ok) return { ok: false, reason: nav.reason || "Couldn't open that tool." };
            // The label goes back so the model can confirm what it opened by
            // name rather than echoing the id at the artist.
            return { ok: true, data: { opened: nav.label, pressed: nav.pressed } };
        }

        case "fill_fields": {
            if (!input || typeof input.toolId !== "string" || !input.toolId) {
                return { ok: false, reason: "fill_fields needs a toolId from the PANEL TOOLS list." };
            }
            if (!input.values || typeof input.values !== "object" || Array.isArray(input.values)) {
                return { ok: false, reason: "fill_fields needs a values object of field id to value." };
            }

            const entry = PANEL_TOOLS.filter((t) => t.id === input.toolId)[0];
            if (!entry) {
                return { ok: false, reason: `No panel tool with id "${input.toolId}".` };
            }

            // THE GATE. Fail-closed on BOTH axes: a tool that declares no
            // fillable fields has none, and a field not on its list is not
            // fillable. Nothing becomes agent-fillable by having been forgotten
            // in the registry -- same rule as run_action's, for the same reason.
            const allowed = entry.fillableFields || [];
            if (!allowed.length) {
                return {
                    ok: false,
                    reason:
                        `${entry.label} has no fields I'm allowed to fill. I can open it and tell you ` +
                        `what to put in.`,
                };
            }

            const accepted: Record<string, string> = {};
            const refused: string[] = [];
            for (const key in input.values) {
                if (!Object.prototype.hasOwnProperty.call(input.values, key)) continue;
                if (allowed.indexOf(key) === -1) { refused.push(key); continue; }
                const v = input.values[key];
                // Values cross into a form the artist reads and acts on, so a
                // non-string here is a bug worth refusing rather than coercing:
                // String(undefined) puts the word "undefined" in a filename.
                if (typeof v !== "string") { refused.push(key); continue; }
                accepted[key] = v;
            }

            if (!Object.keys(accepted).length) {
                return {
                    ok: false,
                    reason:
                        `None of those are fields I can fill in ${entry.label}. Fillable: ` +
                        `${allowed.join(", ")}.`,
                };
            }

            // Staged BEFORE navigating: the tool reads its pending fill as it
            // mounts, so a value set afterwards would arrive to a component
            // that had already looked.
            setPendingFill({ toolId: entry.id, values: accepted });

            const nav = navigateToTool(entry.id);
            if (!nav.ok) {
                // Nothing is left staged for a tool that never opened -- it
                // would surface on some unrelated later visit.
                takePendingFill(entry.id);
                return { ok: false, reason: nav.reason || "Couldn't open that tool." };
            }

            return {
                ok: true,
                data: {
                    opened: nav.label,
                    // What was HANDED OVER, not what landed. The tool fills only
                    // its empty fields and shows the artist what it held back,
                    // so claiming these were all applied would be claiming more
                    // than this call knows.
                    offered: accepted,
                    refused: refused.length ? refused : undefined,
                    note:
                        "Values are in the form, not applied to anything. Anything the artist had " +
                        "already typed is left as it was and flagged in the tool.",
                },
            };
        }

        case "scan_renders": {
            if (!input || typeof input.mastersRoot !== "string" || !input.mastersRoot) {
                return { ok: false, reason: "scan_renders needs a mastersRoot path. Call list_campaigns first." };
            }
            const res = await evalTS("scanAllRenders", input.mastersRoot).catch(() => undefined);
            if (res === undefined) return mockOr({ ok: true, data: MOCK_RENDERS });
            const rows = (res as any[]) || [];
            return { ok: true, data: rows.map((r) => ({ stem: r.stem })) };
        }

        default:
            return { ok: false, reason: `Unknown tool: ${name}` };
    }
}

/**
 * Whose jobs, and the feed itself.
 *
 * `fetchJobs` takes the MACHINE's owner, never the person being viewed --
 * impersonation is derived from the saved config, and passing the viewed name
 * makes the feed think you are them (ActiveJobs.tsx:109 learned this the hard
 * way). An untagged machine is a normal state, not an error: it just means the
 * "assigned to me" filter matches nothing.
 */
async function loadJobs(): Promise<{ ok: true; res: Awaited<ReturnType<typeof fetchJobs>> } | { ok: false; reason: string }> {
    let owner = "";
    try {
        const state = await evalTS("teamGetMachineState");
        if (state && (state as { owner?: string }).owner) owner = (state as { owner: string }).owner;
    } catch {
        /* no bridge -- fetchJobs still answers, just unfiltered */
    }

    try {
        const res = await fetchJobs(owner);
        return { ok: true, res };
    } catch (e: any) {
        return { ok: false, reason: `Couldn't reach the jobs feed: ${e?.message || e}` };
    }
}

/**
 * May the agent run this one-click action?
 *
 * Everything except "destructive" -- i.e. anything whose worst case is a
 * Ctrl+Z or a folder you delete. An action with no `safety` at all counts as
 * destructive, so nothing becomes runnable by having been forgotten. See the
 * field's note in Toolset.tsx for what each tier means.
 */
export function isRunnable(a: {
    safety?: "read" | "undoable" | "additive" | "destructive";
}): boolean {
    return a.safety === "read" || a.safety === "undoable" || a.safety === "additive";
}

/** One job, flattened -- the title is parsed the same way the card parses it. */
function summariseJob(j: WrikeJob) {
    const parts = parseJobTitle(j.title);
    return {
        id: j.id,
        title: j.title,
        film: parts.film,
        territory: parts.territory,
        batch: parts.batch,
        status: j.status,
        // "ready" | "waiting" | "done" | "unknown" -- the shared definition
        // from jobsFeed, so this cannot drift from what the card shows.
        readiness: jobReadiness(j.status),
        assignee: j.assignee,
        deliverables: j.subtaskCount,
        deliverablesDone: j.subtasksDone,
    };
}

/**
 * IN AE, A MISSING BRIDGE IS A REAL FAILURE AND MUST BE REPORTED AS ONE.
 * In the browser it just means there is no ExtendScript, so mock data is the
 * useful answer. `window.cep` is present only inside the CEP host.
 */
function mockOr(mock: ToolResult): ToolResult {
    if (typeof window !== "undefined" && (window as any).cep) {
        return { ok: false, reason: "No bridge to After Effects — couldn't read this. This is not the same as there being none." };
    }
    return mock;
}
