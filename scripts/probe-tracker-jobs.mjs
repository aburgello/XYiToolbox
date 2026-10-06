// =============================================================================
// scripts/probe-tracker-jobs.mjs  (no build needed)
// -----------------------------------------------------------------------------
// Batch Tracker: which Wrike jobs a batch lists. Thailand's TH 6 and TH 6 POST
// (2026-10-06) each showed the other's nine subtasks as well as their own.
//
//   node scripts/probe-tracker-jobs.mjs
// =============================================================================
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(tmpdir(), "xyi-tracker-jobs.mjs");
await build({ entryPoints: ["src/js/main/lib/trackerJobs.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const T = await import(pathToFileURL(out).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };
const pick = (jobs, batch, batches) => T.jobsForBatch(jobs, (j) => j.batch, batch, batches).map((j) => j.id).join();

console.log("Thailand: Batch_06 beside Batch_6_POST");
const TH = [{ id: "TH 6 POST", batch: "Batch_06_POST" }, { id: "TH 6", batch: "Batch_06" }];
const THB = ["Batch_1", "Batch_2", "Batch_06", "Batch_6_POST"];
check(pick(TH, "Batch_6_POST", THB) === "TH 6 POST", "the POST batch lists the POST job, and only it", pick(TH, "Batch_6_POST", THB));
check(pick(TH, "Batch_06", THB) === "TH 6", "the plain batch lists the plain job, and only it", pick(TH, "Batch_06", THB));
check(pick(TH, "Batch_6", THB) === "TH 6" && pick(TH, "batch 06 post", THB) === "TH 6 POST", "however the folder pads or cases it");
check(pick([TH[0]], "Batch_06", THB) === "", "only the POST job in the feed: the plain batch does not borrow it, it has its own folder", pick([TH[0]], "Batch_06", THB));
check(pick([TH[1]], "Batch_6_POST", THB) === "", "…and the POST batch does not borrow the plain one");
check(pick(TH, "Batch_2", THB) === "", "another batch lists neither");

console.log("\nNorway: POST deliverables kept in the plain folder, no POST folder");
const NO = [{ id: "NO 2 POST", batch: "Batch_02_POST" }];
check(pick(NO, "Batch_02", ["Batch_01", "Batch_02"]) === "NO 2 POST", "a POST job with no folder of its own is listed under the plain batch, as before", pick(NO, "Batch_02", ["Batch_01", "Batch_02"]));
check(pick([{ id: "CL 2", batch: "Batch_02" }], "Batch_2_POST", ["Batch_2_POST"]) === "CL 2", "…and the other way round");
check(pick(NO, "Batch_02", []) === "NO 2 POST", "the batch list not known yet: the loose match stands");
check(pick(NO.concat([{ id: "NO 2", batch: "Batch_2" }]), "Batch_02", ["Batch_02"]) === "NO 2", "but an exact job always wins outright, folder or no folder");

console.log(fails ? "\n" + fails + " FAILED" : "\nCLEAN — a POST batch lists its own job, and a job with no folder of its own still has a home.");
process.exit(fails ? 1 : 0);
