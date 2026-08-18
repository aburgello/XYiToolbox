// =============================================================================
// scripts/probe-agent-bubble.cjs
// -----------------------------------------------------------------------------
// The Ask bubble's opt-in. Three things change this state -- the home-screen
// toggle, the bubble's own X, and its floating launcher -- so the risk is them
// disagreeing: a lit-up toggle over a dismissed bubble, or a panel that
// reappears after somebody turned the feature off.
//
//   node scripts/probe-agent-bubble.cjs
// =============================================================================
"use strict";
const { execFileSync } = require("child_process");
const os = require("os"), path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(os.tmpdir(), "xyi-bubble-probe.cjs");
execFileSync("npx", ["esbuild", path.join(ROOT, "src/js/main/lib/agent/bubbleControl.ts"),
    "--bundle", "--format=cjs", "--outfile=" + OUT, "--log-level=error"], { cwd: ROOT });

const store = {};
global.window = { localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
} };
const B = require(OUT);

let pass = 0, fail = 0;
const check = (l, c, d) => {
    if (c) { pass++; console.log("  ok    " + l); }
    else { fail++; console.log("  FAIL  " + l + (d ? "\n          " + d : "")); }
};

console.log("\n=== off until somebody chooses it ===");
check("disabled with nothing stored", B.isAgentEnabled() === false);
check("and therefore not open", B.isBubbleOpen() === false);
check("opening it while disabled does nothing",
      (B.setBubbleOpen(true), B.isBubbleOpen() === false), "a disabled bubble opened");

console.log("\n=== the home toggle ===");
B.toggleAgentEnabled();
check("enabling turns it on", B.isAgentEnabled() === true);
check("and opens it, so the button visibly did something", B.isBubbleOpen() === true);
check("the choice is persisted", store["xyi.agent.enabled"] === "1", JSON.stringify(store));

console.log("\n=== the bubble's own X ===");
B.setBubbleOpen(false);
check("closing the panel leaves the feature ON", B.isAgentEnabled() === true);
check("but shut", B.isBubbleOpen() === false);
check("the launcher can reopen it", (B.toggleBubble(), B.isBubbleOpen() === true));

console.log("\n=== turning the feature off ===");
B.toggleAgentEnabled();
check("disabled", B.isAgentEnabled() === false);
check("and closed with it", B.isBubbleOpen() === false);
check("persisted as off", store["xyi.agent.enabled"] === "0", JSON.stringify(store));
B.toggleAgentEnabled();
check("re-enabling does not resurrect a stale panel state — it opens fresh",
      B.isAgentEnabled() === true && B.isBubbleOpen() === true);

console.log("\n=== a question handed over from elsewhere in the panel ===");
B.setAgentEnabled(false);
check("does nothing while the agent is off", B.askAgent("check these specs") === false);
check("and leaves no question waiting", B.takePendingQuestion() === "");
check("the feature stays off — a button must not switch it on", B.isAgentEnabled() === false);

B.setAgentEnabled(true);
B.setBubbleOpen(false);
check("handing one over opens the bubble", B.askAgent("check these specs") === true && B.isBubbleOpen());
check("the question is waiting", B.takePendingQuestion() === "check these specs");
check("take-once — a second read gets nothing", B.takePendingQuestion() === "");
check("an empty question is refused", B.askAgent("   ") === false);

console.log("\n=== subscribers ===");
let seen = 0;
const stop = B.subscribeToBubble(() => seen++);
B.setBubbleOpen(false);
B.setBubbleOpen(true);
check("listeners hear every change", seen === 2, "heard " + seen);
B.setBubbleOpen(true);
check("but not a no-op change", seen === 2, "heard " + seen);
stop();
B.setBubbleOpen(false);
check("unsubscribe works", seen === 2, "heard " + seen);

// A listener that removes itself mid-announce must not skip the next one.
let a = 0, b = 0;
const stopA = B.subscribeToBubble(() => { a++; stopA(); });
B.subscribeToBubble(() => { b++; });
B.setBubbleOpen(true);
check("a self-unsubscribing listener does not skip the one after it",
      a === 1 && b === 1, "a=" + a + " b=" + b);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
