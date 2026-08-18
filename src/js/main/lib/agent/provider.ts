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
    usage: { input: number; output: number; cacheRead: number; cacheWrite: number; raw?: Record<string, unknown> };
}

const MAX_TOKENS = 2048;

// =============================================================================
// WHERE THE MODEL LIVES -- swappable, because it turned out not to need a fork.
//
// DeepSeek publishes an ANTHROPIC-COMPATIBLE endpoint (api.deepseek.com
// /anthropic), which is how Claude Code runs against it with nothing but
// ANTHROPIC_BASE_URL. That means the whole request and reply shape this file
// and loop.ts are built around -- `tools` with input_schema, content[] blocks
// of type "tool_use", stop_reason -- carries over untouched. Three constants,
// not a rewrite.
//
// THIS IS A TESTING FACILITY. Anthropic stays the default and nothing changes
// for anyone who does not go looking for the setting.
//
// WHAT THIS CANNOT TELL YOU, and what has to be tested from a real panel:
// whether a given endpoint permits a CROSS-ORIGIN call. Claude Code is a Node
// process with no browser origin, so CORS simply does not arise there; a CEP
// panel is Chromium doing a cross-origin fetch, which is the entire reason
// Anthropic requires an explicit opt-in header. An endpoint that works
// perfectly in a terminal can still be unreachable from here.
// =============================================================================

export interface Provider {
    id: string;
    label: string;
    endpoint: string;
    model: string;
    /** How the key travels. Anthropic wants x-api-key; most others want Bearer. */
    auth: "x-api-key" | "bearer";
    /** Send Anthropic's cache-breakpoint fields. Harmlessly ignored elsewhere. */
    explicitCache: boolean;
    /** USD per million tokens. Off-peak, where a provider has such a thing. */
    rates: { input: number; output: number; cacheRead: number; cacheWrite: number };
    /**
     * Providers that charge more at busy hours.
     *
     * NOT A DETAIL. DeepSeek's peak windows are 01:00-04:00 and 06:00-10:00
     * UTC, and the second is 07:00-11:00 in London -- the studio's whole
     * morning. Billing every call off-peak would be wrong by 2x for exactly
     * the hours artists use it, and wrong in the flattering direction.
     */
    peak?: {
        rates: { input: number; output: number; cacheRead: number; cacheWrite: number };
        /** [startHourUTC, endHourUTC) pairs. */
        windowsUtc: number[][];
    };
    /** Anything worth knowing before trusting the numbers. */
    note?: string;
}

export const PROVIDERS: Provider[] = [
    {
        id: "anthropic",
        label: "Anthropic — Haiku 4.5",
        endpoint: "https://api.anthropic.com/v1/messages",
        // Cheapest capable tier — this workload is "call two tools, summarise",
        // which does not need a frontier model.
        model: "claude-haiku-4-5",
        auth: "x-api-key",
        explicitCache: true,
        // cacheWrite is 2x base because the breakpoint below asks for a 1h TTL.
        rates: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 2.0 },
    },
    {
        id: "deepseek",
        label: "DeepSeek — V4 Flash (testing)",
        endpoint: "https://api.deepseek.com/anthropic/v1/messages",
        model: "deepseek-v4-flash",
        auth: "bearer",
        // DeepSeek caches automatically rather than on explicit breakpoints, so
        // cache_control is sent-and-ignored at best. Left OFF so the request is
        // honest about what it is asking for, and so a strict endpoint cannot
        // reject an unknown field.
        explicitCache: false,
        rates: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0.22 },
        peak: {
            rates: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 },
            windowsUtc: [[1, 4], [6, 10]],
        },
        note: "Peak 01:00–04:00 and 06:00–10:00 UTC bills 2x; the readout follows the clock.",
    },
];

const PROVIDER_STORAGE = "xyi.agent.provider";

export function getProvider(): Provider {
    let id = "";
    try { id = window.localStorage.getItem(PROVIDER_STORAGE) || ""; } catch { /* private mode */ }
    const found = PROVIDERS.filter((p) => p.id === id)[0];
    // Falls back to the first entry rather than throwing: a stored id from a
    // provider that has since been removed must not brick the tool.
    return found || PROVIDERS[0];
}

export function setProvider(id: string): void {
    try { window.localStorage.setItem(PROVIDER_STORAGE, id); } catch { /* session only */ }
}

// PER PROVIDER, because they are different accounts with different keys. One
// shared slot meant switching to DeepSeek sent the Anthropic key and 401'd,
// then switching back sent whatever was typed second -- a confusing failure
// that looks like the endpoint being broken.
const KEY_STORAGE = "xyi.agent.apiKey";
function keyStorageFor(p: Provider): string {
    return p.id === "anthropic" ? KEY_STORAGE : KEY_STORAGE + "." + p.id;
}

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
    try { return window.localStorage.getItem(keyStorageFor(getProvider())) || ""; } catch { return ""; }
}

export function setApiKey(key: string): void {
    try { window.localStorage.setItem(keyStorageFor(getProvider()), key.trim()); } catch { /* private mode — session only */ }
}

export async function callModel(call: ModelCall): Promise<ModelReply> {
    const key = getApiKey();
    if (!key) throw new Error("No API key set. Open Settings in the tool and paste one in.");

    const provider = getProvider();
    const headers: Record<string, string> = {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        // Required when calling from a browser context, which a CEP panel is.
        // Sent to every endpoint: Anthropic needs it, and an Anthropic-shaped
        // one that does not will ignore an unrecognised header.
        "anthropic-dangerous-direct-browser-access": "true",
    };
    if (provider.auth === "bearer") headers["authorization"] = "Bearer " + key;
    else headers["x-api-key"] = key;

    const res = await fetch(provider.endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
            model: provider.model,
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
            system: provider.explicitCache
                ? [{ type: "text", text: call.system, cache_control: { type: "ephemeral", ttl: "1h" } }]
                : [{ type: "text", text: call.system }],
            tools: call.tools,
            messages: call.messages,
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        // NAMES WHICH ENDPOINT FAILED. With a provider setting in play, "Model
        // call failed (401)" is ambiguous in a way it never used to be -- it
        // could be the wrong key, or the right key sent to the other service.
        throw new Error(`${provider.label} call failed (${res.status}). ${body.slice(0, 300)}`);
    }

    const json = await res.json();
    return {
        content: json.content || [],
        stopReason: json.stop_reason || "end_turn",
        usage: {
            // DEDUCT CACHE HITS WHERE THE VENDOR INCLUDES THEM. DeepSeek's
            // prompt_tokens is hits PLUS misses, so billing input_tokens at the
            // miss rate AND cacheRead at the hit rate would charge the cached
            // tokens twice. Anthropic already reports these separately, so its
            // numbers are untouched.
            input: Math.max(
                0,
                (json.usage?.input_tokens ?? 0) -
                    (json.usage?.cache_read_input_tokens === undefined
                        ? (json.usage?.prompt_cache_hit_tokens ?? 0)
                        : 0)
            ),
            output: json.usage?.output_tokens ?? 0,
            // BOTH SPELLINGS. Anthropic reports cache_read_input_tokens;
            // DeepSeek's own field is prompt_cache_hit_tokens, and its
            // Anthropic-compatible endpoint may pass either through. Reading
            // only the Anthropic name meant every cached token was billed at
            // the full miss rate -- which is why the panel read $0.028 against
            // a dashboard showing $0.02 for MORE requests than that.
            cacheRead:
                json.usage?.cache_read_input_tokens ??
                json.usage?.prompt_cache_hit_tokens ??
                0,
            // A SEPARATE FIELD, and it was being dropped. input_tokens does NOT
            // include cache writes, so the readout has been understating every
            // session that ever wrote a cache entry -- by the whole prefix, on
            // the first call of each one. It matters more now, since a 1h write
            // is billed at 2x rather than 1.25x.
            cacheWrite: json.usage?.cache_creation_input_tokens ?? 0,
            // THE RAW OBJECT, kept so the panel can show exactly which fields
            // came back. Guessing at another vendor's usage shape is how a cost
            // readout drifts from the bill without anyone noticing; this makes
            // the answer observable instead.
            raw: json.usage || {},
        },
    };
}

/**
 * Rough running cost, so the panel can show what a session actually spent
 * rather than leaving you to guess. Haiku-tier rates, USD per million tokens.
 * Update alongside MODEL.
 */
/**
 * The rates in force RIGHT NOW, read per call rather than once per session so
 * a session straddling 10:00 UTC bills each half correctly.
 */
export function activeRates(p: Provider, now?: Date): Provider["rates"] {
    if (!p.peak) return p.rates;
    const hour = (now || new Date()).getUTCHours();
    for (let i = 0; i < p.peak.windowsUtc.length; i++) {
        const w = p.peak.windowsUtc[i];
        if (hour >= w[0] && hour < w[1]) return p.peak.rates;
    }
    return p.rates;
}

/** True when the active provider is charging its peak rate right now. */
export function isPeakNow(now?: Date): boolean {
    const p = getProvider();
    return !!p.peak && activeRates(p, now) === p.peak.rates;
}

export function estimateCost(u: { input: number; output: number; cacheRead: number; cacheWrite?: number }): number {
    // The ACTIVE provider's rates. Hardcoding Haiku's would have over-reported
    // a DeepSeek session by roughly 5x -- a readout nobody can act on.
    const r = activeRates(getProvider());
    return (
        (u.input / 1e6) * r.input +
        (u.output / 1e6) * r.output +
        (u.cacheRead / 1e6) * r.cacheRead +
        // 2x base for a 1h write. Counted at all now: leaving it out made the
        // panel report a number that was always too low, which is the wrong
        // direction for a figure someone is deciding a budget on.
        ((u.cacheWrite || 0) / 1e6) * r.cacheWrite
    );
}
