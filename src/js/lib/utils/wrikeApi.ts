// =============================================================================
// src/js/lib/utils/wrikeApi.ts -- thin Wrike REST API v4 client.
//
// Runs over Node's `https` module (lib/cep/node.ts), NOT the browser
// `fetch()` -- Wrike's API isn't set up for arbitrary cross-origin browser
// calls, and this panel's cep.config.ts already enables Node integration
// (`--enable-nodejs`, see main.tsx's parameters), so going through Node
// sidesteps CORS entirely instead of fighting it. This is exactly the
// "confirm the CORS/Node question" spike -- if this file works end to end
// inside real AE, the same pattern extends to whatever Wrike automation
// comes next.
//
// Field names below (contact/task/attachment shape) are from Wrike's
// documented v4 API, not yet exercised against a real response -- same
// "unverified against real data" caveat this codebase already uses for
// render-pairing/QUAD detection in CLAUDE.md. If a real call comes back
// missing a field this file expects, that's the first thing to check.
// =============================================================================
import { https } from "../cep/node";

export interface WrikeUser {
    id: string;
    firstName: string;
    lastName: string;
}

export interface WrikeTask {
    id: string;
    title: string;
    status: string;
    permalink: string;
    subTaskIds?: string[];
    // Part of Wrike's default task fields (not gated behind the `fields`
    // query param, unlike subTaskIds above) -- `due`/`start` can come back
    // as either a plain "YYYY-MM-DD" date or a full ISO datetime depending
    // on the task's `dates.type` (Milestone/Planned/Backlog), so callers
    // comparing dates should only use the first 10 characters.
    dates?: { type?: string; due?: string; start?: string };
    // Raw HTML -- gated behind `fields=["description"]`, only requested for
    // a single expanded task (wrikeGetTaskDescription), not the list fetch,
    // since a task's full rich-text description can be a lot of payload to
    // pull down for every assigned task up front. Never rendered as raw
    // HTML -- see extractPlainText()/extractLinks() below.
    description?: string;
}

export interface WrikeAttachment {
    id: string;
    name: string;
    contentType: string;
    createdDate: string;
}

function nodeAvailable(): boolean {
    return typeof https.request === "function";
}

function wrikeGet<T = any>(pathWithQuery: string, token: string): Promise<T> {
    return new Promise((resolve, reject) => {
        if (!nodeAvailable()) {
            reject(new Error("Node bridge not available -- this only works inside After Effects, not browser preview."));
            return;
        }
        const req = https.request(
            {
                hostname: "www.wrike.com",
                path: pathWithQuery,
                method: "GET",
                headers: { Authorization: "Bearer " + token },
            },
            (res: any) => {
                let body = "";
                res.on("data", (chunk: any) => { body += chunk; });
                res.on("end", () => {
                    let parsed: any;
                    try {
                        parsed = JSON.parse(body);
                    } catch {
                        reject(new Error("Wrike returned a non-JSON response (status " + res.statusCode + ")."));
                        return;
                    }
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error((parsed && (parsed.errorDescription || parsed.error)) || ("Wrike API error " + res.statusCode)));
                        return;
                    }
                    resolve(parsed);
                });
            }
        );
        req.on("error", (err: any) => reject(err instanceof Error ? err : new Error(String(err))));
        req.end();
    });
}

// Recognises the token and returns the signed-in user -- this is the
// "log in" step. Wrike has no separate login call; a valid permanent
// token just resolves this endpoint successfully.
export async function wrikeGetMe(token: string): Promise<WrikeUser> {
    const json = await wrikeGet<{ data: WrikeUser[] }>("/api/v4/contacts?me=true", token);
    if (!json.data || !json.data.length) throw new Error("Wrike didn't return a user for this token.");
    return json.data[0];
}

export async function wrikeGetAssignedTasks(token: string, userId: string): Promise<WrikeTask[]> {
    const query =
        "responsibles=" + encodeURIComponent(JSON.stringify([userId])) +
        "&status=Active" +
        "&fields=" + encodeURIComponent(JSON.stringify(["subTaskIds"]));
    const json = await wrikeGet<{ data: WrikeTask[] }>("/api/v4/tasks?" + query, token);
    return json.data || [];
}

export async function wrikeGetAttachments(token: string, taskId: string): Promise<WrikeAttachment[]> {
    const json = await wrikeGet<{ data: WrikeAttachment[] }>("/api/v4/tasks/" + taskId + "/attachments", token);
    return json.data || [];
}

export async function wrikeGetTasksByIds(token: string, ids: string[]): Promise<WrikeTask[]> {
    if (!ids.length) return [];
    const json = await wrikeGet<{ data: WrikeTask[] }>("/api/v4/tasks/" + ids.join(","), token);
    return json.data || [];
}

// Confirmed against a real account: passing fields=["description"] here
// gets a hard 400 back ("Fields parameter value 'description' not
// allowed") -- unlike subTaskIds (genuinely opt-in), description turns out
// to already be part of this endpoint's default response, and Wrike
// rejects requesting a field that isn't in its optional-fields enum. Fix
// was simply to drop the fields param and let the default payload through.
export async function wrikeGetTaskDescription(token: string, taskId: string): Promise<string> {
    const json = await wrikeGet<{ data: WrikeTask[] }>("/api/v4/tasks/" + taskId, token);
    return json.data?.[0]?.description || "";
}

// --- Description HTML handling ----------------------------------------------
// Wrike's task description comes back as HTML. Deliberately NEVER rendered
// via dangerouslySetInnerHTML -- these two functions reduce it to plain
// data (text, and a separate list of links) instead, so there's no HTML
// injection surface at all rather than relying on an allowlist sanitizer
// to be airtight. This is also how "folders in the description" from the
// original ask gets answered: a folder mentioned in a task's description is
// almost always a Wrike link (an <a href="https://www.wrike.com/open.htm?...">
// pointing at that folder), which extractLinks() surfaces as a clickable
// row -- see WrikeTasks.tsx's "Links" section.
const HTML_ENTITIES: Record<string, string> = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
};

export function extractPlainText(html: string): string {
    if (!html) return "";
    let text = html
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<li[^>]*>/gi, "• ")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]+>/g, "");
    text = text.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => HTML_ENTITIES[m] || m);
    return text.replace(/\n{3,}/g, "\n\n").trim();
}

export interface WrikeDescriptionLink {
    href: string;
    text: string;
}

export function extractLinks(html: string): WrikeDescriptionLink[] {
    if (!html) return [];
    const links: WrikeDescriptionLink[] = [];
    const re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
        const href = m[1];
        if (!/^https?:\/\//i.test(href)) continue; // no javascript:/data: hrefs
        const text = m[2].replace(/<[^>]+>/g, "").trim() || href;
        links.push({ href, text });
    }
    return links;
}
