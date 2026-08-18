// =============================================================================
// src/js/main/lib/agent/provider.ts
// -----------------------------------------------------------------------------
// THE ONLY PROVIDER-SPECIFIC FILE. Everything else in lib/agent/ is vendor
// neutral, so swapping model providers is this file plus a key -- not a
// refactor.
//
// That matters for a policy reason, not a taste one: XYi's AI Policy §3.1
// approves Google Gemini (Enterprise) and Adobe AI and nothing else, §1.4 says
// the policy is reviewed and revised, and this prototype is meant to run
// against a GENERATED masters tree (scripts/make-test-masters.cjs) precisely so
// no real creative asset crosses a vendor boundary while you're testing. Point
// it at real campaigns only through an approved tool.
//
// CORS: the panel is Chromium, so a browser fetch to a third-party API is
// subject to CORS. Anthropic's API accepts a direct-browser-access opt-in
// header for exactly this case, set below. If a provider you swap in refuses
// browser calls outright, CEP has Node enabled -- issue the request through
// node's https module instead and the whole problem disappears.
// =============================================================================

export interface ModelCall {
    system: string;
    tools: { name: string; description: string; input_schema: unknown }[];
    messages: any[];
}

export interface ModelReply {
    /** Raw content blocks, passed straight back into the next turn's history. */
    content: any[];
    stopReason: string;
    usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

const ENDPOINT = "https://api.anthropic.com/v1/messages";

// Cheapest capable tier — this workload is "call two tools, summarise", which
// does not need a frontier model. See docs/AGENT-THREE-TOOL-PROTOTYPE.md §7.
const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 2048;

const KEY_STORAGE = "xyi.agent.apiKey";

/**
 * localStorage, NOT app.settings -- deliberately.
 *
 * The house pattern for a credential is the loadWrikeApiToken/saveWrikeApiToken
 * pair in jsx/aeft/shell.ts, kept out of team.ts's PROFILE_KEYS so it never
 * travels to the shared folder. Mirror that when this stops being a prototype.
 * For now localStorage keeps the whole experiment out of src/jsx, which is the
 * part of the codebase nothing type-checks (CLAUDE.md §6) -- so a prototype
 * that touches no ExtendScript cannot break anything that ships.
 *
 * Either way the key is per-machine and never written to the team share.
 */
export function getApiKey(): string {
    try { return window.localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}

export function setApiKey(key: string): void {
    try { window.localStorage.setItem(KEY_STORAGE, key.trim()); } catch { /* private mode — session only */ }
}

export async function callModel(call: ModelCall): Promise<ModelReply> {
    const key = getApiKey();
    if (!key) throw new Error("No API key set. Open Settings in the tool and paste one in.");

    const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            // Required when calling from a browser context, which a CEP panel is.
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            // CACHE THE STABLE PREFIX. The system prompt plus three tool
            // definitions is identical on every call in a session, and cached
            // input bills at a fraction of fresh input. Keep it byte-stable:
            // no timestamps, no machine tag, no per-artist interpolation, or
            // this silently never reads and you pay full price forever.
            // ttl "1h", NOT THE 5-MINUTE DEFAULT. The prefix is ~12k tokens and
            // it was expiring between questions: an artist asks something, goes
            // and works in AE for ten minutes, asks again -- and pays full
            // price for a prefix that had already been cached and thrown away.
            // Panel use is bursty by nature, so the default TTL was close to
            // paying the write premium for nothing.
            //
            // A 1h write costs 2x base against 1.25x for 5m, so this is only
            // right because the reads now actually land. If the panel ever
            // becomes something people fire one question at and close, this is
            // the line to reconsider.
            system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral", ttl: "1h" } }],
            tools: call.tools,
            messages: call.messages,
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Model call failed (${res.status}). ${body.slice(0, 300)}`);
    }

    const json = await res.json();
    return {
        content: json.content || [],
        stopReason: json.stop_reason || "end_turn",
        usage: {
            input: json.usage?.input_tokens ?? 0,
            output: json.usage?.output_tokens ?? 0,
            cacheRead: json.usage?.cache_read_input_tokens ?? 0,
            // A SEPARATE FIELD, and it was being dropped. input_tokens does NOT
            // include cache writes, so the readout has been understating every
            // session that ever wrote a cache entry -- by the whole prefix, on
            // the first call of each one. It matters more now, since a 1h write
            // is billed at 2x rather than 1.25x.
            cacheWrite: json.usage?.cache_creation_input_tokens ?? 0,
        },
    };
}

/**
 * Rough running cost, so the panel can show what a session actually spent
 * rather than leaving you to guess. Haiku-tier rates, USD per million tokens.
 * Update alongside MODEL.
 */
export function estimateCost(u: { input: number; output: number; cacheRead: number; cacheWrite?: number }): number {
    return (
        (u.input / 1e6) * 1.0 +
        (u.output / 1e6) * 5.0 +
        (u.cacheRead / 1e6) * 0.1 +
        // 2x base for a 1h write. Counted at all now: leaving it out made the
        // panel report a number that was always too low, which is the wrong
        // direction for a figure someone is deciding a budget on.
        ((u.cacheWrite || 0) / 1e6) * 2.0
    );
}
