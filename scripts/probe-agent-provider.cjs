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

console.log("\n=== a stored id that no longer exists ===");
store["xyi.agent.provider"] = "some-service-we-removed";
check("falls back rather than bricking", P.getProvider().id === "anthropic", P.getProvider().id);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
