// =============================================================================
// scripts/probe-agent-provider.cjs
// -----------------------------------------------------------------------------
// The Ask agent's provider switch: defaults, key isolation, cost rates.
//
// The bug this mainly guards against is KEYS CROSSING OVER. One shared
// localStorage slot would mean switching service sends the other service's
// key, which 401s in a way that reads like the endpoint being broken rather
// than the key being wrong -- and you would go off looking at CORS.
//
//   node scripts/probe-agent-provider.cjs
// =============================================================================
"use strict";
const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(os.tmpdir(), "xyi-provider-probe.cjs");
execFileSync(
    "npx",
    ["esbuild", path.join(ROOT, "src/js/main/lib/agent/provider.ts"),
     "--bundle", "--format=cjs", "--outfile=" + OUT, "--log-level=error"],
    { cwd: ROOT }
);

// A localStorage stand-in: provider.ts is the only thing under test.
const store = {};
global.window = {
    localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
    },
};
const P = require(OUT);

let pass = 0, fail = 0;
const check = (l, c, d) => {
    if (c) { pass++; console.log("  ok    " + l); }
    else { fail++; console.log("  FAIL  " + l + (d ? "\n          " + d : "")); }
};

console.log("\n=== defaults ===");
check("defaults to Anthropic with nothing stored", P.getProvider().id === "anthropic", P.getProvider().id);
check("and to Haiku", P.getProvider().model === "claude-haiku-4-5");
check("Anthropic keeps explicit cache breakpoints", P.getProvider().explicitCache === true);

console.log("\n=== keys do not cross between services ===");
P.setApiKey("sk-ant-AAA");
check("anthropic key saved", P.getApiKey() === "sk-ant-AAA");
P.setProvider("deepseek");
check("switching services shows NO key", P.getApiKey() === "", "leaked: " + P.getApiKey());
P.setApiKey("sk-ds-BBB");
check("deepseek key saved separately", P.getApiKey() === "sk-ds-BBB");
P.setProvider("anthropic");
check("switching back restores the first key", P.getApiKey() === "sk-ant-AAA", P.getApiKey());
P.setProvider("deepseek");
check("and forward again restores the second", P.getApiKey() === "sk-ds-BBB", P.getApiKey());
check("the legacy slot still holds the anthropic key",
      store["xyi.agent.apiKey"] === "sk-ant-AAA", JSON.stringify(store));
check("deepseek does not ask for explicit caching", P.getProvider().explicitCache === false);

console.log("\n=== cost follows the active provider ===");
const u = { input: 10000, output: 1000, cacheRead: 100000, cacheWrite: 12000 };
P.setProvider("anthropic");
const a = P.estimateCost(u);
P.setProvider("deepseek");
const d = P.estimateCost(u);
console.log("      anthropic $" + a.toFixed(5) + "   deepseek $" + d.toFixed(5) + "   (" + (a / d).toFixed(1) + "x)");
check("deepseek is materially cheaper on the same usage", d < a / 3, a + " vs " + d);
check("neither is zero", a > 0 && d > 0);

console.log("\n=== peak vs off-peak follows the UTC clock ===");
P.setProvider("deepseek");
const ds = P.PROVIDERS.filter((x) => x.id === "deepseek")[0];
const at = (h) => new Date(Date.UTC(2026, 7, 19, h, 30));
check("00:30 UTC is off-peak", P.activeRates(ds, at(0)).input === 0.22);
check("02:30 UTC is PEAK", P.activeRates(ds, at(2)).input === 0.44);
check("05:30 UTC is off-peak (the gap between windows)", P.activeRates(ds, at(5)).input === 0.22);
check("08:30 UTC is PEAK — 09:30 in London, mid-morning", P.activeRates(ds, at(8)).input === 0.44);
check("22:30 UTC is off-peak", P.activeRates(ds, at(22)).input === 0.22);
P.setProvider("anthropic");
const an = P.PROVIDERS.filter((x) => x.id === "anthropic")[0];
check("Anthropic has no peak window", P.activeRates(an, at(8)).input === 1.0);

console.log("\n=== reconciled against a real DeepSeek dashboard hour ===");
// 23:00-24:00 UTC on 2026-08-18, from the account's own usage page.
const HIT = 435456, MISS = 50617, OUTTOK = 10457;
P.setProvider("deepseek");
const modelled = P.estimateCost({ input: MISS, output: OUTTOK, cacheRead: HIT, cacheWrite: 0 });
console.log("      dashboard showed $0.02 for " + (HIT + MISS + OUTTOK).toLocaleString() + " tokens");
console.log("      our table gives  $" + modelled.toFixed(4));
check("within a cent of the real bill", Math.abs(modelled - 0.02) < 0.01, "$" + modelled.toFixed(4));
check("cache reads are what make it cheap — billing them as misses would not match",
      P.estimateCost({ input: HIT + MISS, output: OUTTOK, cacheRead: 0, cacheWrite: 0 }) > 0.1);

console.log("\n=== a stored id that no longer exists ===");
store["xyi.agent.provider"] = "some-service-we-removed";
check("falls back rather than bricking", P.getProvider().id === "anthropic", P.getProvider().id);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
