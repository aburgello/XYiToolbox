// =============================================================================
// src/js/main/lib/jobsFeed.ts
// -----------------------------------------------------------------------------
// Reads Wrike-derived jobs from the studio Worker's read-only panel route.
//
// SHAPE OF THE THING: Wrike pushes task changes to the Worker's webhook, which
// keeps a `tasks` table in Supabase current. The panel asks the Worker for that
// table -- it never talks to Wrike, and never holds a Wrike token. The Worker
// holds the OAuth credentials and the panel holds only a shared read-only key.
//
// AUTH: a header key rather than a session cookie, because a CEP panel has no
// session and its origin is `null`, so cookies do not attach cross-origin. The
// key grants exactly what every studio member can already read in Wrike, which
// is what makes a shared key acceptable here and would NOT make a Wrike
// permanent token acceptable (those are read AND write, and carry someone's
// identity).
//
// FETCHED FROM THE FRONTEND, not over the ExtendScript bridge: this is a plain
// HTTPS call and CEP's Chromium does it natively. Routing it through evalTS
// would buy nothing and would block the bridge for the duration.
//
// CACHED for the panel session, same reasoning as the masters index cache: the
// answer changes on the order of hours, and re-fetching on every home render
// would be pure waste. `refreshJobs()` forces a re-read.
// =============================================================================
import { evalTS } from "../../lib/utils/bolt";

export interface WrikeJob {
    id: string;
    title: string;
    assignee: string;
    status: string;
    updatedAt: string;
    permalink?: string;
    // Deliverables under the task. May be absent -- see MOCK note below.
    subtaskCount?: number;
    subtasksDone?: number;
    // The subtask NAMES are the point: they are deliverable filenames in the
    // studio convention, so the modal can parse them into localiser rows.
    subtasks?: WrikeSubtask[];
}

export interface WrikeSubtask {
    id: string;
    name: string;
    /** Wrike's status GROUP -- only ever Active / Completed / Deferred /
     *  Cancelled. "Delivering", "On hold" and the rest are CUSTOM statuses
     *  that all report as Active, which is why this alone can't tell you
     *  whether a batch still needs localising. */
    status: string;
    /** The custom workflow status name ("Delivering", "To amend", …) when the
     *  feed supplies it. Optional because the panel feed doesn't send it yet --
     *  the worker resolves customStatusId against Wrike's workflows the way
     *  TimeHub's enrichJob already does for tasks. Preferred over `status`
     *  wherever it exists, so the panel starts using it the moment the feed
     *  does, with no further change here. */
    customStatusName?: string;
}

export interface JobsFeedResult {
    jobs: WrikeJob[];
    fetchedAt: number;
    // Whose list this actually is. The card filters and labels against this
    // rather than the machine's own tag -- otherwise a "view as" result would
    // be filtered by YOUR name and come back empty.
    viewingAs: string;
    // True when viewingAs is not the machine's own tag, so the UI can say so.
    impersonating: boolean;
    // True when nothing real was reachable and the sample below is being shown.
    // Surfaced in the UI: a card that silently shows invented jobs would be
    // worse than one showing none.
    mock: boolean;
    error?: string;
}

export interface FeedConfig {
    url: string;
    key: string;
    // Optional "view as": ask the feed for someone ELSE's jobs.
    //
    // Deliberately its own setting rather than retagging the machine. The Team
    // tag (TeamMachineOwner) drives profile live-sync and shared board posts --
    // retagging as a colleague to peek at their list would write your setup
    // into their profile on the NAS and post arcade scores under their name.
    // This touches nothing but the feed request.
    viewAs?: string;
}

// Sample data so the card can be built and judged before the Worker route
// exists. Shaped exactly like the real payload, and drawn from real job titles
// so the layout is tested against realistic lengths rather than "Job 1".
// Subtask names are taken VERBATIM from real Wrike tasks, including the
// ARTWALL ones that parse badly (empty campaign, no duration) -- the modal has
// to show that honestly rather than being demoed on names that all parse
// cleanly.
const MOCK_JOBS: WrikeJob[] = [
    {
        id: "m1", title: "FID - IT - ARTWALL GALLERIA - Batch 2", assignee: "Antonio",
        status: "In Progress", updatedAt: new Date(Date.now() - 36e5).toISOString(),
        subtaskCount: 3, subtasksDone: 0,
        subtasks: [
            { id: "s1", name: "FID_INTL_DOOH_ARTWORK_PIKASSO_ARTWALL_GALLERIA_FIRENZE_CEILING_9600x1440px_IT", status: "Backlog" },
            { id: "s2", name: "FID_INTL_DOOH_ARTWORK_PIKASSO_ARTWALL_GALLERIA_FIRENZE_LEFT_9600x768px_IT", status: "Backlog" },
            { id: "s3", name: "FID_INTL_DOOH_ARTWORK_PIKASSO_ARTWALL_GALLERIA_FIRENZE_RIGHT_9600x768px_IT", status: "Backlog" },
        ],
    },
    {
        id: "m2", title: "FID - TW - DINTH - Batch 1", assignee: "Antonio",
        status: "Backlog", updatedAt: new Date(Date.now() - 7 * 36e5).toISOString(),
        subtaskCount: 4, subtasksDone: 1,
        subtasks: [
            { id: "s4", name: "FID_INTL_Trio_DINTH_ShowtimeCinemasTPED_1920x1080px_30s_TW", status: "Completed" },
            { id: "s5", name: "FID_INTL_Trio_DINTH_ShowtimeCinemasTPED_768x1280px_30s_TW", status: "Backlog" },
            { id: "s6", name: "FID_INTL_PortalToParadise_DINTH_ShowtimeCinemasTPED_1080x1920px_30s_TW", status: "Backlog" },
            { id: "s7", name: "FID_INTL_Trio_DINTH_InTheatreFoyerScreen_512x1280px_30s_TW", status: "Backlog" },
        ],
    },
    {
        id: "m3", title: "FID - SE - DOOH - Batch 1", assignee: "Antonio",
        status: "Backlog", updatedAt: new Date(Date.now() - 26 * 36e5).toISOString(),
        subtaskCount: 2, subtasksDone: 2,
        subtasks: [
            { id: "s8", name: "FID_INTL_Bracelet_DOOH_1920x1080px_15s_SE", status: "Completed" },
            { id: "s9", name: "FID_INTL_Bracelet_DOOH_1080x1920px_15s_SE", status: "Completed" },
        ],
    },
    {
        id: "m4", title: "PPD - FR - DOOH - Batch 3", assignee: "Jacqui",
        status: "In Progress", updatedAt: new Date(Date.now() - 3 * 36e5).toISOString(),
        subtaskCount: 1, subtasksDone: 0,
        subtasks: [{ id: "s10", name: "PPD_INTL_DinoRescue_DOOH_1920x1080px_20s_FR", status: "Backlog" }],
    },
];

let cache: JobsFeedResult | null = null;
let cacheMember = "";

export async function loadJobsFeedConfig(): Promise<FeedConfig | null> {
    try {
        const raw = await evalTS("loadJobsFeedConfig");
        if (typeof raw !== "string" || raw === "") return null;
        const parsed = JSON.parse(raw) as FeedConfig;
        if (!parsed || !parsed.url || !parsed.key) return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

export async function saveJobsFeedConfig(cfg: FeedConfig): Promise<boolean> {
    try {
        const res = await evalTS("saveJobsFeedConfig", JSON.stringify(cfg));
        cache = null; // pointing somewhere new invalidates whatever we held
        return !!(res && (res as { success?: boolean }).success);
    } catch (e) {
        return false;
    }
}

// Normalises whatever the Worker returns into WrikeJob. Written defensively on
// purpose: the `tasks` table is TimeHub's, not this panel's, so its column
// names can change without anyone thinking about the toolbox. A missing field
// degrades to a blank cell rather than throwing.
function normalise(rows: any[]): WrikeJob[] {
    const out: WrikeJob[] = [];
    for (const r of rows || []) {
        if (!r) continue;
        out.push({
            id: String(r.id ?? r.task_id ?? ""),
            title: String(r.title ?? r.name ?? "").trim(),
            assignee: String(r.assignee ?? r.worked_on_by ?? r.owner ?? "").trim(),
            status: String(r.status ?? "").trim(),
            updatedAt: String(r.updated_at ?? r.updatedAt ?? ""),
            permalink: r.permalink ? String(r.permalink) : undefined,
            subtaskCount: typeof r.subtask_count === "number" ? r.subtask_count : undefined,
            subtasksDone: typeof r.subtasks_done === "number" ? r.subtasks_done : undefined,
            subtasks: r.subtasks instanceof Array
                ? r.subtasks.map((st: any, n: number) => ({
                      id: String(st?.id ?? n),
                      name: String(st?.name ?? st?.title ?? "").trim(),
                      status: String(st?.status ?? "").trim(),
                      // This mapper REBUILDS each subtask field by field, so a
                      // field the feed adds is dropped unless it is copied here
                      // too. customStatusName was, which left the panel seeing
                      // only the base group ("Active") while the feed was
                      // sending "Render review" all along. Anything added to
                      // WrikeSubtask needs a line here.
                      customStatusName: String(st?.customStatusName ?? "").trim(),
                  })).filter((st: WrikeSubtask) => st.name !== "")
                : undefined,
        });
    }
    return out.filter((j) => j.title !== "");
}

export async function fetchJobs(member: string, force = false, live = false): Promise<JobsFeedResult> {
    // Keyed by member: switching the machine's tag must not serve the previous
    // person's jobs out of cache.
    if (cache && cacheMember === member && !force) return cache;

    const cfg = await loadJobsFeedConfig();
    if (!cfg) {
        cache = { jobs: MOCK_JOBS, fetchedAt: Date.now(), mock: true, viewingAs: member, impersonating: false };
        cacheMember = member;
        return cache;
    }
    const viewAs = (cfg.viewAs || "").trim();
    const effective = viewAs || member;

    try {
        // No credentials/cookies: the key is the gate, and sending credentials
        // cross-origin would force the Worker into a stricter CORS contract for
        // no benefit.
        // The Worker filters by member so the payload stays small. It is a
        // convenience, not a security boundary -- the key holder could ask for
        // anyone -- but it keeps the panel from downloading the studio's whole
        // board to show one person's rows.
        const sep = cfg.url.indexOf("?") === -1 ? "?" : "&";
        // `refresh=1` only on an explicit refresh. The feed normally reads a
        // Supabase cache that is only as current as the last time somebody had
        // the Motion board open; this asks the Worker to go to Wrike instead.
        // Deliberately not on every open -- that would spend Wrike API budget
        // for a panel nobody is looking at.
        const liveParam = live ? "&refresh=1" : "";
        const res = await fetch(`${cfg.url}${sep}member=${encodeURIComponent(effective)}${liveParam}`, {
            method: "GET",
            headers: { "X-Panel-Key": cfg.key },
            credentials: "omit",
        });
        if (!res.ok) {
            cache = {
                jobs: MOCK_JOBS,
                fetchedAt: Date.now(),
                mock: true,
                error: res.status === 401 ? "Feed key rejected."
                    : res.status === 404 ? `The feed doesn't recognise "${effective}" as a member.`
                    : `Feed returned ${res.status}.`,
                viewingAs: effective,
                impersonating: !!viewAs && viewAs !== member,
            };
            return cache;
        }
        // A 200 of text/html means the request fell through to the SPA -- the
        // route is not deployed. Caught explicitly because res.json() would
        // otherwise throw on the HTML and land in the catch below, reporting a
        // network failure for what is really a missing deployment.
        const contentType = res.headers.get("content-type") || "";
        if (contentType.indexOf("json") === -1) {
            cache = {
                jobs: MOCK_JOBS,
                fetchedAt: Date.now(),
                mock: true,
                error: "That URL returned the website, not the feed — the /api/panel/jobs route isn't deployed yet.",
                viewingAs: effective,
                impersonating: !!viewAs && viewAs !== member,
            };
            cacheMember = member;
            return cache;
        }
        const data = await res.json();
        const jobs = normalise(data instanceof Array ? data : (data && data.jobs) || []);
        cache = { jobs, fetchedAt: Date.now(), mock: false, viewingAs: effective, impersonating: !!viewAs && viewAs !== member };
        cacheMember = member;
        return cache;
    } catch (e: any) {
        // Offline, VPN down, Worker unreachable. Never throws to the caller --
        // the home screen must not depend on the network being up.
        cache = { jobs: MOCK_JOBS, fetchedAt: Date.now(), mock: true, error: "Jobs feed unreachable.", viewingAs: effective, impersonating: !!viewAs && viewAs !== member };
        return cache;
    }
}

/** The refresh button: bypasses the panel's own cache AND asks the feed to
 *  read Wrike live rather than its Supabase snapshot. */
export function refreshJobs(member: string): Promise<JobsFeedResult> {
    return fetchJobs(member, true, true);
}

// Splits "FID - IT - ARTWALL GALLERIA - Batch 2" into its parts. The title is a
// human convention, so every part is optional and a title that doesn't match
// still lists -- it just shows fewer chips.
export function parseJobTitle(title: string): { film: string; territory: string; name: string; batch: string } {
    const parts = title.split(/\s+-\s+/).map((p) => p.trim());
    const batchPart = parts.find((p) => /^batch\b/i.test(p)) || "";
    const rest = parts.filter((p) => p !== batchPart);
    return {
        film: rest[0] || "",
        // Territory sits second and is a 2-letter code in every real example.
        territory: rest[1] && /^[A-Z]{2}$/.test(rest[1]) ? rest[1] : "",
        name: rest.slice(rest[1] && /^[A-Z]{2}$/.test(rest[1]) ? 2 : 1).join(" - "),
        batch: batchPart,
    };
}
