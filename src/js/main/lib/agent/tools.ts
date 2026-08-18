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
import { navigateToTool } from "./navigation";
import {
    fetchJobs,
    parseJobTitle,
    jobReadiness,
    LOCALISABLE_STATUSES,
    FINISHED_STATUSES,
    type WrikeJob,
} from "../jobsFeed";
import { loadJobRows, classifyRows, stageBatchFromJob } from "../jobRows";

export interface ToolDef {
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: Record<string, { type: string; description: string }>;
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
