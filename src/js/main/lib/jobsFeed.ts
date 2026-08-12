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

// --- readiness ---------------------------------------------------------
// ONE definition, used by the Active Jobs card and the job modal. They showed
// the same jobs with two copies of these rules, which is exactly how a card
// ends up disagreeing with the sheet it opens.
//
// Custom Wrike statuses that mean "this can be localised now" -- a studio
// decision, not a guess. Everything outside the list is shown but never sent.
export const LOCALISABLE_STATUSES = /^(backlog|motion|save\s*png)$/i;
/** Finished for real -- struck through rather than merely held back. */
export const FINISHED_STATUSES = /^(delivered|completed?|done|published)$/i;

export type Readiness = "ready" | "waiting" | "done" | "unknown";

/**
 * Workflow-status colour, matching TimeHub's own (src/utils/tagStyles.js) so
 * a status reads the same in both places.
 *
 * TRANSLATED, not copied: TimeHub paints on white with Tailwind's -50/-600
 * pairs, this panel is dark, so each status keeps its HUE at the -400 level on
 * a low-alpha tint of itself. Same colour language, legible on the other
 * ground. Literal rgba because color-mix() is Chrome 111 and this ships to 74.
 *
 * ORDER IS LOAD-BEARING and mirrors TimeHub's: these are substring tests, so
 * "content review" must be checked before the broader entries, and reordering
 * silently changes which colour a status gets.
 */
const STATUS_TINTS: [RegExp, string, string][] = [
    [/to amend/,                    "#fb7185", "rgba(251, 113, 133, 0.14)"], // rose
    [/render review/,               "#818cf8", "rgba(129, 140, 248, 0.14)"], // indigo
    [/revised/,                     "#2dd4bf", "rgba(45, 212, 191, 0.14)"],  // teal
    [/creative approved/,           "#60a5fa", "rgba(96, 165, 250, 0.14)"],  // blue
    [/content approved/,            "#c084fc", "rgba(192, 132, 252, 0.14)"], // purple
    [/client review|content review/,"#facc15", "rgba(250, 204, 21, 0.14)"],  // yellow
    [/motion/,                      "#34d399", "rgba(52, 211, 153, 0.14)"],  // emerald
    [/digital/,                     "#22d3ee", "rgba(34, 211, 238, 0.14)"],  // cyan
    [/prep for delivery/,           "#fb923c", "rgba(251, 146, 60, 0.14)"],  // orange
    [/^deliver(ing|y)$/,            "#fbbf24", "rgba(251, 191, 36, 0.18)"],  // amber, stronger
    [/on hold/,                     "#f87171", "rgba(248, 113, 113, 0.14)"], // red
    [/\bpm\b/,                      "#e879f9", "rgba(232, 121, 249, 0.14)"], // fuchsia
    [/backlog/,                     "#94a3b8", "rgba(148, 163, 184, 0.14)"], // slate
];

const STATUS_TINT_DEFAULT: [string, string] = ["#94a3b8", "rgba(148, 163, 184, 0.14)"];

export function statusTint(status: string | undefined): { color: string; background: string } {
    const s = String(status || "").trim().toLowerCase();
    if (s) {
        for (const [re, color, background] of STATUS_TINTS) {
            if (re.test(s)) return { color, background };
        }
    }
    return { color: STATUS_TINT_DEFAULT[0], background: STATUS_TINT_DEFAULT[1] };
}

/**
 * `status` here is the CUSTOM status name the feed resolves ("Render review",
 * "Backlog"), not Wrike's base group. "unknown" means the feed sent no custom
 * status at all -- older feed, or a subtask row that was never cached -- and
 * callers must treat it as "no opinion" rather than "not ready", or every row
 * goes amber the moment the feed lags.
 */
export function jobReadiness(status: string | undefined): Readiness {
    const s = String(status || "").trim();
    if (!s) return "unknown";
    if (FINISHED_STATUSES.test(s)) return "done";
    if (LOCALISABLE_STATUSES.test(s)) return "ready";
    return "waiting";
}

/**
 * Territory code -> flag emoji. Regional-indicator pairs, derived rather than
 * looked up.
 *
 * Renders fine: this panel already ships a real emoji (ReviewHub's 🔶) and the
 * studio is macOS-only, so Apple Color Emoji draws flags properly. The known
 * emoji bug is ExtendScript's File.write() mangling surrogate pairs on the way
 * to the clipboard -- so a flag may be DISPLAYED but must never be sent across
 * the bridge.
 *
 * Returns "" for anything that isn't a plain two-letter code (OV, INTL, a
 * film name), which would otherwise render as tofu or a wrong flag.
 */
export function territoryFlag(code: string | undefined): string {
    const c = String(code || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return "";
    if (c === "OV") return ""; // a real ISO code (nothing), but not a territory
    return String.fromCodePoint(
        0x1f1e6 + (c.charCodeAt(0) - 65),
        0x1f1e6 + (c.charCodeAt(1) - 65)
    );
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

// STUDIO DEFAULTS. Every machine points at the same Worker with the same
// read-only key, so making each artist paste both was pure ceremony -- and the
// panel showed sample data until they did.
//
// The key is deliberately shippable: it grants exactly what any studio member
// can already read in Wrike, it is not a Wrike token, and it reaches machines
// through a signed ZXP on the studio's own NAS. It is readable in the bundle by
// anyone holding that ZXP -- who, by definition, already has it. Anything with
// real authority must never be baked in this way.
//
// A saved config still WINS, so "view as" and any future re-pointing keep
// working; these only fill the blanks.
const DEFAULT_FEED_URL = "https://timesheeter.burgello-antonio.workers.dev/api/panel/jobs";
const DEFAULT_FEED_KEY = "1oQqdH1bYXiPDxHzHjQsx46PeeoEJrBRjuBxUpbYrNE=";

export async function loadJobsFeedConfig(): Promise<FeedConfig | null> {
    let saved: Partial<FeedConfig> | null = null;
    try {
        const raw = await evalTS("loadJobsFeedConfig");
        if (typeof raw === "string" && raw !== "") saved = JSON.parse(raw) as FeedConfig;
    } catch (e) {
        saved = null;
    }
    const url = (saved && saved.url) || DEFAULT_FEED_URL;
    const key = (saved && saved.key) || DEFAULT_FEED_KEY;
    if (!url || !key) return null;
    return { ...(saved || {}), url, key } as FeedConfig;
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
