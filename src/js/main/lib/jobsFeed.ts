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
}

export interface JobsFeedResult {
    jobs: WrikeJob[];
    fetchedAt: number;
    // True when nothing real was reachable and the sample below is being shown.
    // Surfaced in the UI: a card that silently shows invented jobs would be
    // worse than one showing none.
    mock: boolean;
    error?: string;
}

interface FeedConfig {
    url: string;
    key: string;
}

// Sample data so the card can be built and judged before the Worker route
// exists. Shaped exactly like the real payload, and drawn from real job titles
// so the layout is tested against realistic lengths rather than "Job 1".
const MOCK_JOBS: WrikeJob[] = [
    { id: "m1", title: "FID - IT - ARTWALL GALLERIA - Batch 2", assignee: "Antonio", status: "In Progress", updatedAt: new Date(Date.now() - 36e5).toISOString(), subtaskCount: 3, subtasksDone: 0 },
    { id: "m2", title: "FID - TW - DINTH - Batch 1", assignee: "Antonio", status: "Backlog", updatedAt: new Date(Date.now() - 7 * 36e5).toISOString(), subtaskCount: 9, subtasksDone: 2 },
    { id: "m3", title: "FID - SE - DOOH - Batch 1", assignee: "Antonio", status: "Backlog", updatedAt: new Date(Date.now() - 26 * 36e5).toISOString(), subtaskCount: 4, subtasksDone: 4 },
    { id: "m4", title: "PPD - FR - DOOH - Batch 3", assignee: "Jacqui", status: "In Progress", updatedAt: new Date(Date.now() - 3 * 36e5).toISOString(), subtaskCount: 6, subtasksDone: 1 },
    { id: "m5", title: "PPD - DE - DINTH - Batch 1", assignee: "Aaron", status: "Backlog", updatedAt: new Date(Date.now() - 50 * 36e5).toISOString(), subtaskCount: 12, subtasksDone: 0 },
];

let cache: JobsFeedResult | null = null;

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
        });
    }
    return out.filter((j) => j.title !== "");
}

export async function fetchJobs(force = false): Promise<JobsFeedResult> {
    if (cache && !force) return cache;

    const cfg = await loadJobsFeedConfig();
    if (!cfg) {
        cache = { jobs: MOCK_JOBS, fetchedAt: Date.now(), mock: true };
        return cache;
    }

    try {
        // No credentials/cookies: the key is the gate, and sending credentials
        // cross-origin would force the Worker into a stricter CORS contract for
        // no benefit.
        const res = await fetch(cfg.url, {
            method: "GET",
            headers: { "X-Panel-Key": cfg.key },
            credentials: "omit",
        });
        if (!res.ok) {
            cache = {
                jobs: MOCK_JOBS,
                fetchedAt: Date.now(),
                mock: true,
                error: res.status === 401 ? "Feed key rejected." : `Feed returned ${res.status}.`,
            };
            return cache;
        }
        const data = await res.json();
        const jobs = normalise(data instanceof Array ? data : (data && data.jobs) || []);
        cache = { jobs, fetchedAt: Date.now(), mock: false };
        return cache;
    } catch (e: any) {
        // Offline, VPN down, Worker unreachable. Never throws to the caller --
        // the home screen must not depend on the network being up.
        cache = { jobs: MOCK_JOBS, fetchedAt: Date.now(), mock: true, error: "Jobs feed unreachable." };
        return cache;
    }
}

export function refreshJobs(): Promise<JobsFeedResult> {
    return fetchJobs(true);
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
