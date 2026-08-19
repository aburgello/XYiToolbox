// =============================================================================
// scripts/agent-prefix-report.cjs
// -----------------------------------------------------------------------------
// WHAT THE ASK AGENT PAYS FOR BEFORE ANYONE TYPES A QUESTION.
//
// The system prompt and the 41 tool definitions are sent on EVERY model call.
// They are cached, but a cache write still costs 2x base and a read 0.1x, so
// the prefix sets the floor under every question and every capability added
// widens it. This prints the split so that trade is visible rather than felt.
//
//   node scripts/agent-prefix-report.cjs          # summary + per-tool table
//   node scripts/agent-prefix-report.cjs --json   # machine-readable
//
// Token counts are chars/4, the usual English approximation. Good enough to
// rank tools against each other and size the prefix; not the API's own count.
// =============================================================================
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TOOLS_TS = path.join(ROOT, "src/js/main/lib/agent/tools.ts");
const LOOP_TS = path.join(ROOT, "src/js/main/lib/agent/loop.ts");

const tok = (n) => Math.round(n / 4);

const { loadAgent } = require("./agent-headless.cjs");
const agent = loadAgent();

const systemText = agent.systemPrompt();
const sys = { chars: systemText.length, lines: systemText.split("\n").length };
const tools = agent.TOOLS;
const rows = tools
    .map((t) => {
        const whole = JSON.stringify(t).length;
        const desc = (t.description || "").length;
        const schema = JSON.stringify(t.input_schema || {}).length;
        return { name: t.name, chars: whole, tokens: tok(whole), desc, schema };
    })
    .sort((a, b) => b.chars - a.chars);

const toolChars = rows.reduce((n, r) => n + r.chars, 0);
const total = sys.chars + toolChars;

if (process.argv.indexOf("--json") !== -1) {
    console.log(JSON.stringify({ system: sys, tools: rows, totalChars: total, totalTokens: tok(total) }, null, 2));
    process.exit(0);
}

console.log("\nTHE CACHED PREFIX — sent on every model call\n");
const pct = (n) => ((n / total) * 100).toFixed(1).padStart(5) + "%";
console.log(`  system prompt      ${String(sys.chars).padStart(7)} chars  ${String(tok(sys.chars)).padStart(6)} tok  ${pct(sys.chars)}   (${sys.lines} lines)`);
console.log(`  ${String(rows.length).padStart(2)} tool definitions ${String(toolChars).padStart(7)} chars  ${String(tok(toolChars)).padStart(6)} tok  ${pct(toolChars)}`);
console.log(`  ${"".padStart(18)} ${String(total).padStart(7)} chars  ${String(tok(total)).padStart(6)} tok`);
console.log("\n  (the generated panel inventory IS included -- it is part of what gets sent)");

console.log("\nPER TOOL, dearest first\n");
console.log("       tokens   share  name                          description / schema");
for (const r of rows) {
    console.log(
        "  " + String(r.tokens).padStart(6) +
        "  " + ((r.chars / toolChars) * 100).toFixed(1).padStart(5) + "%" +
        "  " + r.name.padEnd(28) +
        "  " + String(r.desc).padStart(5) + " / " + String(r.schema).padStart(5) + " chars"
    );
}

// What the prefix costs, at the rates in provider.ts, and -- the part that
// actually decides the TTL -- how the two TTLs compare over a real session.
const t = tok(total);
const READ = (t / 1e6) * 0.1;
const WRITE_5M = (t / 1e6) * 1.25;
const WRITE_1H = (t / 1e6) * 2.0;
const CALLS = 3;   // model calls in a typical tool-using question

console.log("\nWHAT THAT COSTS, per model call (Haiku 4.5 rates)\n");
console.log(`  cache read                             $${READ.toFixed(5)}`);
console.log(`  cache write, 5m TTL (1.25x)            $${WRITE_5M.toFixed(5)}`);
console.log(`  cache write, 1h TTL (2x)               $${WRITE_1H.toFixed(5)}`);
console.log(`  no cache at all                        $${((t / 1e6) * 1.0).toFixed(5)}`);

// Calls within one question are seconds apart, so they read under either TTL.
// The TTL only decides whether the NEXT question re-writes the prefix.
const q5m = WRITE_5M + (CALLS - 1) * READ;
const q1hFirst = WRITE_1H + (CALLS - 1) * READ;
const q1hLater = CALLS * READ;

console.log("\nTTL TRADE-OFF — questions more than 5 minutes apart\n");
console.log("  questions      5m TTL      1h TTL     verdict");
for (const n of [1, 2, 3, 5, 10, 20]) {
    const a = n * q5m;
    const b = q1hFirst + (n - 1) * q1hLater;
    const delta = ((b - a) / a) * 100;
    const verdict = Math.abs(delta) < 1 ? "level" : delta < 0 ? `1h saves ${(-delta).toFixed(0)}%` : `1h costs ${delta.toFixed(0)}% more`;
    console.log(`  ${String(n).padStart(9)}   $${a.toFixed(5)}   $${b.toFixed(5)}     ${verdict}`);
}
console.log("\n  Break-even is about 2 questions in the hour. Below that the 5m");
console.log("  default was cheaper, because a 1h write costs 2x against 1.25x.\n");

const top = rows.slice(0, 5).reduce((n, r) => n + r.chars, 0);
console.log(`  The 5 dearest tools are ${((top / toolChars) * 100).toFixed(0)}% of the tool surface.`);
console.log(`  Dropping the 10 cheapest would save ${tok(rows.slice(-10).reduce((n, r) => n + r.chars, 0))} tokens — ${((rows.slice(-10).reduce((n, r) => n + r.chars, 0) / total) * 100).toFixed(1)}% of the prefix.\n`);
