// =============================================================================
// scripts/probe-delivery-message.mjs  (no build needed)
// -----------------------------------------------------------------------------
// What Delivery's Message for Wrike is written from: the queued rows' own
// render paths, grouped by batch.
// =============================================================================
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(tmpdir(), "xyi-delivery-message.mjs");
await build({ entryPoints: ["src/js/main/lib/deliveryMessage.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const { deliveryGroups } = await import(pathToFileURL(out).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };
const M = "/Volumes/paramount/StreetFighter/Digital/INT/XY026205_INTL_DIGITAL_Outdoor_Campaign_Markets";
const row = (terr, batch, name) => ({ name, sourcePath: `${M}/${terr}/Renders/${batch}/${name}_V01.mov` });

let g = deliveryGroups([
    row("Taiwan", "Batch_01", "SF_INTL_Trio_DOOH_A_1920x1080px_10s_TW"),
    row("Taiwan", "Batch_01", "SF_INTL_Trio_DOOH_B_1080x1920px_10s_TW"),
]);
check(g.length === 1 && g[0].territoryPath === `${M}/Taiwan` && g[0].batch === "Batch_01" && g[0].territory === "Taiwan", "the territory is the folder above Renders, the batch the one below", g[0]);
check(g[0].rendersFolder === `${M}/Taiwan/Renders/Batch_01` && g[0].deliveryFolder === `${M}/Taiwan/Renders/Batch_01/_Delivery`, "the delivery lands in _Delivery beside the renders");
check(g[0].names.join() === "SF_INTL_Trio_DOOH_A_1920x1080px_10s_TW.mp4,SF_INTL_Trio_DOOH_B_1080x1920px_10s_TW.mp4" && g[0].label === "Taiwan · Batch_01", "it lists what is delivered, as mp4s", g[0].names);

g = deliveryGroups([
    row("Taiwan", "Batch_01", "a"), row("South_Africa", "Batch_2_POST", "b"), row("South_Africa", "Batch_2_POST", "c"),
    { name: "FromTheProject", sourcePath: null },
    { name: "loose", sourcePath: "/Users/me/Desktop/loose.mov" },
]);
check(g.length === 2 && g[0].label === "South Africa · Batch_2_POST" && g[0].names.length === 2 && g[1].label === "Taiwan · Batch_01", "two batches in one queue are two messages, the bigger first", g.map((x) => x.label));
check(!g.some((x) => x.names.some((n) => /FromTheProject|loose/.test(n))), "a row with no render under a Renders folder belongs to no batch and is left out");

g = deliveryGroups([{ name: "x", sourcePath: `${M}/Panama/Renders/x_V01.mov` }]);
check(g.length === 1 && g[0].batch === "" && g[0].rendersFolder === `${M}/Panama/Renders` && g[0].label === "Panama", "renders kept loose in Renders: no batch, the folder is Renders itself", g[0]);
g = deliveryGroups([{ name: "x", sourcePath: "P:\\SF\\XY1_Markets\\Peru\\Renders\\Batch_01\\x_V01.mov" }]);
check(g.length === 1 && g[0].territoryPath === "P:\\SF\\XY1_Markets\\Peru" && g[0].deliveryFolder === "P:\\SF\\XY1_Markets\\Peru\\Renders\\Batch_01\\_Delivery", "a Windows path keeps its own slashes", g[0]);
check(deliveryGroups([]).length === 0, "nothing queued, nothing to say");

console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — Delivery's message is read off what it queued.");
process.exit(fails ? 1 : 0);
