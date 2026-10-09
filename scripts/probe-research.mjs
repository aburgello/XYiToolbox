// =============================================================================
// scripts/probe-research.mjs  (no build needed)
// -----------------------------------------------------------------------------
// EOC Research's rules (src/js/main/lib/research.ts): how a clip finds its
// stills in both generations of the archive, which stills kept AE's frame
// number, what a manifest says, and which renders a run would archive.
//
//   node scripts/probe-research.mjs                 the stub
//   node scripts/probe-research.mjs <Project_Research>   also read the real
//                                                   archive. LISTS ONLY.
// =============================================================================
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const out = join(tmpdir(), "xyi-research.mjs");
await build({ entryPoints: ["src/js/main/lib/research.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const R = await import(pathToFileURL(out).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };

// A tree as { "dir/file": 1 }, listed the way Node's readdir would.
const lister = (files) => async (dir) => {
    const seen = {};
    const kids = [];
    for (const f of Object.keys(files)) {
        if (f.indexOf(dir + "/") !== 0) continue;
        const rest = f.slice(dir.length + 1).split("/");
        if (seen[rest[0]]) continue;
        seen[rest[0]] = true;
        kids.push({ name: rest[0], path: dir + "/" + rest[0], dir: rest.length > 1 });
    }
    return kids;
};

console.log("What a still's name says");
check(R.stillOf("NVC_GLASS_1080x1920_10sec_OV (0-00-11-00).jpg").base === "NVC_GLASS_1080x1920_10sec_OV" && R.stillOf("X (0-00-11-00).jpg").at === 11, "a timecoded still names its clip and its second");
check(R.stillOf("Norway_Batch_1_X_LASTFRAME.jpg00359").base === "Norway_Batch_1_X" && R.stillOf("A_LASTFRAME_00359.jpg").base === "A", "the tool's still, with AE's frame number either side of .jpg");
check(R.isPictureName("x.jpg00359") && !R.isPictureName("x.mp4") && !R.isClipName("X_V01.69540.33777244.m4v") && R.isClipName("x.mp4"), "a numbered jpg is a picture; H.264's temp file is not a clip");
check(R.marketOf("ODY_INTL_DGTL_DOOH_HORSE_LOS_1080x1920_10sec_NO_V01") === "NO" && R.marketOf("NVC_X_1080x1920_10sec_OV") === "OV" && R.marketOf("notes") === "", "the market is the token after the length, OV included");

console.log("\nStills that kept AE's frame number");
const plan = R.tidyPlan(["A_LASTFRAME.jpg00359", "B_LASTFRAME_00479.jpg", "C_LASTFRAME.jpg", "D_LASTFRAME.jpg00010", "D_LASTFRAME.jpg", "E (0-00-01-00).jpg", "F.jpg00359"]);
check(JSON.stringify(plan) === '[{"from":"A_LASTFRAME.jpg00359","to":"A_LASTFRAME.jpg"},{"from":"B_LASTFRAME_00479.jpg","to":"B_LASTFRAME.jpg"}]', "renamed to .jpg; never onto a taken name, never a hand-made still", plan);

console.log("\nThe manifest");
const txt = "# Research Renders manifest\r# STATUS\tPREFIX\tSOURCE\rDONE\tNorway_Batch_1_X_10sec_NO_V01\t/V/Camp_Markets/Norway/Renders/Batch_1/X_10sec_NO_V01.mov\rTODO\tBrazil_B2_Y\t/V/Camp_Markets/Brazil/Renders/B2/sub/Y.mov\r";
const rows = R.parseManifest(txt);
check(rows.length === 2 && rows[1].status === "TODO", "bare-CR line endings, as the first tool wrote them", rows.length);
check(R.sourceRootOf(rows) === "/V/Camp_Markets", "the folder a run was pointed at", R.sourceRootOf(rows));
check(JSON.stringify(R.placeOfSource(rows[1].path)) === '{"territory":"Brazil","batch":"B2"}', "a source's market and batch");
check(R.parseManifest(R.manifestText([{ status: "FAILED", prefix: "a\tb", path: "/p", note: "x\ny" }], "now"))[0].note === "x y", "a note with a tab or newline in it cannot break a line");

console.log("\nA film folder, both generations");
const arch = {
    "/R/Nova/MASTER_OV/NVC_GLASS_1080x1920_10sec_OV.mp4": 1,
    "/R/Nova/MASTER_OV/NVC_GLASS_1080x1920_10sec_OV (0-00-14-23).jpg": 1,
    "/R/Nova/MASTER_OV/NVC_GLASS_1080x1920_10sec_OV (0-00-05-11).jpg": 1,
    "/R/Nova/LOCALISED/EXTREMES/NVC_ARCH_4560x384_15sec_EG_V01 (0-00-19-23).jpg": 1,
    "/R/Nova/LOCALISED/.DS_Store": 1,
    "/R/Nova/_DEV/_0.56_NVC_TEST_1080x1920_10sec_OV (0-00-09-23).jpg": 1,
    "/R/Nova/Run/_RESEARCH_MANIFEST.txt": 1,
    "/R/Nova/Run/Norway_Batch_1_X_10sec_NO_V01.mp4": 1,
    "/R/Nova/Run/Norway_Batch_1_X_10sec_NO_V01_LASTFRAME.jpg00359": 1,
    "/R/Nova/Run/Norway_Batch_1_X_10sec_NO_V01.123.456.m4v": 1,
};
const scan = await R.scanFilm({ name: "Nova", path: "/R/Nova", dir: true }, lister(arch), async () => txt);
const by = (n) => scan.items.find((i) => i.name.indexOf(n) === 0);
check(scan.items.length === 4, "four things: a clip with stills, stills alone, a run's clip, and what a _DEV folder holds (the temp file is not one)", scan.items.map((i) => i.section + "/" + i.name));
check(by("NVC_TEST") && by("NVC_TEST").section === "_DEV" && by("NVC_TEST").w === 1080, "the archive's `_0.56_` sort prefix comes off the name, and a `_` folder is read", by("NVC_TEST") && by("NVC_TEST").name);
check(by("NVC_GLASS").stills.length === 2 && by("NVC_GLASS").stills[0].label === "0:05" && by("NVC_GLASS").w === 1080 && by("NVC_GLASS").seconds === 10, "stills in time order, size and length off the name");
check(by("NVC_ARCH").clip === "" && by("NVC_ARCH").section === "LOCALISED/EXTREMES" && by("NVC_ARCH").market === "EG", "stills with no clip are still an item, in their section");
const ran = by("X_10sec_NO");
check(ran && ran.territory === "Norway" && ran.batch === "Batch_1" && ran.stills.length === 1 && ran.stills[0].label === "last frame", "a run's clip is named and placed by the manifest, and finds its misnamed still", ran);
check(scan.misnamed.length === 1 && scan.runs.length === 1 && scan.runs[0].todo === 1 && scan.runs[0].total === 2, "…and the film says what needs fixing and what a run left undone", scan.runs);

console.log("\nWhat a run would archive");
const src = {
    "/M/Norway/Renders/Batch_1/A_1080x1920_10s_NO_V01.mov": 1,
    "/M/Norway/Renders/Batch_1/A_1080x1920_10s_NO_V03.mov": 1,
    "/M/Norway/Renders/Batch_1/B_192x288_10s_NO_V01_QUAD_RES.mov": 1,
    "/M/Norway/Renders/Batch_1/B_192x288_10s_NO_V02_QUAD_RES.mov": 1,
    "/M/Norway/Renders/Batch_1/_Old/A_1080x1920_10s_NO_V00.mov": 1,
    "/M/Norway/Renders/Batch_1/_mp4/A_1080x1920_10s_NO_V03.mp4": 1,
    "/M/Norway/Renders/Batch_1/x/Same.mov": 1,
    "/M/Norway/Renders/Batch_1/y/Same.mov": 1,
    "/M/Norway/Renders/Loose_NO.mov": 1,
    "/M/New Zealand/Renders/Batch (2)/C_10s_NZ_V01.mov": 1,
    "/M/_Archive/Renders/B/Z.mov": 1,
    "/M/PDFs/notes.mov": 1,
};
const jobs = await R.scanSource("/M", lister(src));
check(jobs.length === 8, "every .mov under <Market>/Renders, _ folders and non-markets left out", jobs.map((j) => j.prefix));
check(jobs.some((j) => j.prefix === "New_Zealand_Batch_2_C_10s_NZ_V01") && jobs.some((j) => j.prefix === "Norway_Loose_NO"), "names made safe as the first tool made them, so a resumed run lands on its own files");
const same = jobs.filter((j) => j.stem === "Same").map((j) => j.prefix).sort();
check(same.join() === "Norway_Batch_1_Same,Norway_Batch_1_Same_2", "two renders that would take one name are told apart", same);
const one = await R.scanSource("/M/Norway", lister(src));
check(one.length === 7 && one[0].market === "Norway", "pointed at one market, it reads that market");
const newest = R.newestOnly(jobs).map((j) => j.stem);
check(newest.indexOf("A_1080x1920_10s_NO_V03") !== -1 && newest.indexOf("A_1080x1920_10s_NO_V01") === -1 && newest.indexOf("B_192x288_10s_NO_V02_QUAD_RES") !== -1 && newest.indexOf("B_192x288_10s_NO_V01_QUAD_RES") === -1 && newest.length === 6, "newest only: the highest version, read past a RES tail", newest);
const plain = await R.scanSource("/M/Norway/Renders/Batch_1", lister(src));
check(plain.length === 6 && plain.some((j) => j.prefix === "x_Same"), "any other folder is read as a plain folder of renders", plain.map((j) => j.prefix));
const got = R.archived(["P.mp4", "P_LASTFRAME.jpg", "Q.mp4", "Q_LASTFRAME.jpg00359", "R_LASTFRAME.jpg", "S.123.456.m4v"]);
check(got.clip.P && got.clip.Q && !got.clip.R && !got.clip.S && got.still.Q && got.still.R, "done is the mp4 being there; a temp file is not a clip");

const real = process.argv[2];
if (real) {
    console.log("\n" + real + "  (listing only)");
    const list = async (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, path: join(dir, d.name), dir: d.isDirectory() })); } catch { return []; } };
    const read = async (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
    const before = fs.readdirSync(real).length;
    for (const f of await R.listFilms(real, list)) {
        const t = Date.now();
        const s = await R.scanFilm(f, list, read);
        const clips = s.items.filter((i) => i.clip).length;
        const sized = s.items.filter((i) => i.w).length;
        console.log(`  ${f.name.padEnd(34)} ${String(s.items.length).padStart(5)} items  ${String(clips).padStart(5)} clips  ${String(sized).padStart(5)} sized  misnamed ${s.misnamed.length}  ${s.runs.map((r) => `run ${r.total - r.todo}/${r.total} from ${r.sourceRoot}`).join("; ")}  ${Date.now() - t}ms`);
    }
    check(fs.readdirSync(real).length === before, "nothing was added or removed");
}

console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — the archive reads both ways, and a run knows what it has left.");
process.exit(fails ? 1 : 0);
