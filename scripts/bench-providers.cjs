// =============================================================================
// scripts/bench-providers.cjs
// -----------------------------------------------------------------------------
// THE SAME QUESTIONS, PUT TO BOTH SERVICES, PRICED THE SAME WAY.
//
// Comparing two screenshots taken hours apart tells you very little: the
// questions differ, the cache is in a different state, and DeepSeek's peak
// window may have opened in between. This asks BOTH providers the same list, in
// the same order, with the panel's real system prompt and real tool
// definitions, and prints what each actually charged.
//
//   ANTHROPIC_API_KEY=... DEEPSEEK_API_KEY=... node scripts/bench-providers.cjs
//   ... --only deepseek        just one of them
//   ... --questions my.json    your own list, as a JSON array of strings
//
// IT SPENDS REAL MONEY on both accounts. Small -- the default list is six
// questions -- but it is not free, and it is your key.
//
// WHAT IT IS NOT: a correctness test. Tool calls are answered with fixtures
// rather than by After Effects, so the model sees plausible data and not your
// project. That is enough to compare cost, step counts and which tools each
// model reaches for; it says nothing about whether the answers would be right
// against real masters.
// =============================================================================
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const { loadAgent } = require("./agent-headless.cjs");

// --- keys ------------------------------------------------------------------
// Read from .env.local (already covered by the *.local rule in .gitignore) so
// a key never has to be typed onto a command line, where it would end up in
// shell history and in any transcript of the session running it. Environment
// variables still win if they are set.
function loadEnvFile() {
    const file = path.join(ROOT, ".env.local");
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { return; }
    for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t || t.charAt(0) === "#") continue;
        const eq = t.indexOf("=");
        if (eq < 1) continue;
        const k = t.slice(0, eq).trim();
        // Never override a real environment variable, and strip the quotes
        // people reflexively put round a pasted key.
        if (process.env[k]) continue;
        process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
}
loadEnvFile();

// --- the two services -------------------------------------------------------
const PROVIDERS = {
    anthropic: {
        label: "Anthropic — Haiku 4.5",
        endpoint: "https://api.anthropic.com/v1/messages",
        model: "claude-haiku-4-5",
        keyEnv: "ANTHROPIC_API_KEY",
        auth: "x-api-key",
        explicitCache: true,
        rates: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 2.0 },
    },
    deepseek: {
        label: "DeepSeek — V4 Flash",
        endpoint: "https://api.deepseek.com/anthropic/v1/messages",
        model: "deepseek-v4-flash",
        keyEnv: "DEEPSEEK_API_KEY",
        auth: "bearer",
        explicitCache: false,
        rates: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0.22 },
        peak: { rates: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 }, windowsUtc: [[1, 4], [6, 10]] },
    },
};

function ratesNow(p) {
    if (!p.peak) return p.rates;
    const h = new Date().getUTCHours();
    for (const w of p.peak.windowsUtc) if (h >= w[0] && h < w[1]) return p.peak.rates;
    return p.rates;
}

// Questions chosen to exercise different shapes: a plain answer, a read tool, a
// multi-tool chain, and one that should REFUSE. The refusal matters as much as
// the rest -- a model that ploughs on is the expensive failure here.
const DEFAULT_QUESTIONS = [
    "What can you help me with?",
    "What campaigns do we have?",
    "List the masters for the first campaign you find.",
    "Which of my jobs are ready to localise?",
    "Add a random spin expression to the rotation of the selected layers.",
    "Delete every master in the campaign folder.",
];

// Fixtures, so a tool call gets plausible data without After Effects. Anything
// unlisted gets a neutral empty result rather than an error, which keeps a
// model from spiralling into retries and skewing the step counts.
const FIXTURES = {
    list_campaigns: { success: true, campaigns: [{ name: "Forgotten Island", mastersRoot: "/Volumes/x/FID" }] },
    list_masters: { success: true, masters: [
        { name: "FID_INTL_Trio_DOOH_1080x1920px_10s_OV.aep", creative: "Trio", size: "1080x1920", duration: "10s" },
    ] },
    list_active_jobs: { success: true, jobs: [{ id: "J1", film: "Forgotten Island", territory: "Germany", readyToLocalise: true, subtasks: 3 }] },
    find_expression: { success: true, results: [{ name: "Random Spin (Z Rotation)", code: "seedRandom(index, true);\nrandom(0, 360)" }] },
    list_layers: { success: true, layers: [{ index: 1, name: "BG" }, { index: 2, name: "Logo" }], selectedCount: 0 },
};

async function callOnce(p, key, system, tools, messages) {
    const headers = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
    if (p.auth === "bearer") headers.authorization = "Bearer " + key;
    else headers["x-api-key"] = key;

    // Mirrors provider.ts exactly: two breakpoints for Anthropic (the stable
    // tools+system prefix, and the growing conversation), none for a service
    // that caches automatically. A benchmark that priced a different request
    // shape from the panel would be measuring the wrong thing.
    let body;
    if (p.explicitCache) {
        const mark = { type: "ephemeral", ttl: "1h" };
        const msgs = messages.slice();
        const last = msgs[msgs.length - 1];
        if (typeof last.content === "string") {
            msgs[msgs.length - 1] = { ...last, content: [{ type: "text", text: last.content, cache_control: mark }] };
        } else if (Array.isArray(last.content) && last.content.length) {
            const blocks = last.content.slice();
            blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: mark };
            msgs[msgs.length - 1] = { ...last, content: blocks };
        }
        body = { model: p.model, max_tokens: 2048,
                 system: [{ type: "text", text: system, cache_control: mark }], tools, messages: msgs };
    } else {
        body = { model: p.model, max_tokens: 2048, system, tools, messages };
    }

    const res = await fetch(p.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(p.label + " " + res.status + ": " + (await res.text()).slice(0, 200));
    const json = await res.json();
    const u = json.usage || {};
    const cacheRead = u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? 0;
    const input = Math.max(0, (u.input_tokens ?? 0) -
        (u.cache_read_input_tokens === undefined ? (u.prompt_cache_hit_tokens ?? 0) : 0));
    return {
        content: json.content || [],
        stopReason: json.stop_reason,
        usage: { input, output: u.output_tokens ?? 0, cacheRead, cacheWrite: u.cache_creation_input_tokens ?? 0 },
        rawUsageKeys: Object.keys(u),
    };
}

async function askOne(p, key, system, tools, question) {
    const messages = [{ role: "user", content: question }];
    const used = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const toolsCalled = [];
    let calls = 0, rawKeys = [];

    for (let step = 0; step < 10; step++) {
        const r = await callOnce(p, key, system, tools, messages);
        calls++;
        rawKeys = r.rawUsageKeys;
        for (const k of Object.keys(used)) used[k] += r.usage[k];

        const wants = r.content.filter((b) => b.type === "tool_use");
        if (!wants.length) break;
        messages.push({ role: "assistant", content: r.content });
        messages.push({
            role: "user",
            content: wants.map((w) => {
                toolsCalled.push(w.name);
                return {
                    type: "tool_result", tool_use_id: w.id,
                    content: JSON.stringify(FIXTURES[w.name] || { success: true, note: "no data in this environment" }),
                };
            }),
        });
    }
    const r = ratesNow(p);
    const cost = used.input / 1e6 * r.input + used.output / 1e6 * r.output
               + used.cacheRead / 1e6 * r.cacheRead + used.cacheWrite / 1e6 * r.cacheWrite;
    return { calls, used, cost, toolsCalled, rawKeys };
}

(async () => {
    const argv = process.argv.slice(2);
    const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
    const qFile = argv.includes("--questions") ? argv[argv.indexOf("--questions") + 1] : null;
    const questions = qFile ? JSON.parse(fs.readFileSync(qFile, "utf8")) : DEFAULT_QUESTIONS;

    const agent = loadAgent();
    const system = agent.systemPrompt();
    const tools = agent.TOOLS;
    console.log(`\nprompt ${system.length} chars · ${tools.length} tools · ${questions.length} questions\n`);

    const picked = Object.keys(PROVIDERS).filter((k) => !only || k === only);
    const results = {};
    for (const id of picked) {
        const p = PROVIDERS[id];
        const key = process.env[p.keyEnv];
        if (!key) {
            console.log(`  ${p.label}: skipped — no ${p.keyEnv}.`);
            console.log(`    Put it in .env.local at the repo root, as a line reading  ${p.keyEnv}=your-key`);
            console.log(`    That file is gitignored.\n`);
            continue;
        }
        console.log(p.label);
        results[id] = [];
        for (const q of questions) {
            try {
                const r = await askOne(p, key, system, tools, q);
                results[id].push({ q, ...r });
                console.log(`  $${r.cost.toFixed(5)}  ${String(r.calls).padStart(2)} calls  ` +
                    `${String(r.used.cacheRead).padStart(7)} cached  ${q.slice(0, 46)}`);
            } catch (e) {
                console.log(`  FAILED  ${q.slice(0, 46)}\n          ${e.message}`);
                results[id].push({ q, failed: e.message });
            }
        }
        const ok = results[id].filter((r) => !r.failed);
        if (ok.length) {
            console.log(`  usage fields returned: ${ok[0].rawKeys.join(", ")}`);
            console.log(`  TOTAL $${ok.reduce((n, r) => n + r.cost, 0).toFixed(5)}\n`);
        }
    }

    const ids = Object.keys(results).filter((id) => results[id].some((r) => !r.failed));
    if (ids.length === 2) {
        const [a, b] = ids;
        const ta = results[a].reduce((n, r) => n + (r.cost || 0), 0);
        const tb = results[b].reduce((n, r) => n + (r.cost || 0), 0);
        console.log("SIDE BY SIDE\n");
        console.log("  " + "question".padEnd(48) + PROVIDERS[a].label.padEnd(24) + PROVIDERS[b].label);
        questions.forEach((q, i) => {
            const ra = results[a][i], rb = results[b][i];
            const f = (r) => r.failed ? "failed".padEnd(24)
                : ("$" + r.cost.toFixed(5) + " / " + r.calls + " calls").padEnd(24);
            console.log("  " + q.slice(0, 46).padEnd(48) + f(ra) + f(rb));
        });
        console.log("\n  " + "TOTAL".padEnd(48) + ("$" + ta.toFixed(5)).padEnd(24) + "$" + tb.toFixed(5));
        console.log("  " + "".padEnd(48) + "".padEnd(24) + (ta / tb).toFixed(1) + "x cheaper\n");
        // Behaviour, not just price: the same question should reach for the
        // same tools. Divergence here is the thing a cost table hides.
        console.log("TOOL CHOICE\n");
        questions.forEach((q, i) => {
            const ta2 = (results[a][i].toolsCalled || []).join(",") || "—";
            const tb2 = (results[b][i].toolsCalled || []).join(",") || "—";
            console.log("  " + q.slice(0, 40).padEnd(42) + (ta2 === tb2 ? "same: " + ta2 : ta2 + "   vs   " + tb2));
        });
        console.log("");
    }
})();
