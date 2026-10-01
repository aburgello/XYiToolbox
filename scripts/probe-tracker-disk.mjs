// =============================================================================
// scripts/probe-tracker-disk.mjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// The Tracker's folders are read by the PANEL now (lib/trackerDisk.ts), a port
// of tracker.ts's trReadDisk. Two readers of one tree must give one answer,
// so this builds a real tree, then runs the built bundle's trackerScan twice:
//
//   A. as before: AE's own read, over a stub that lists the same tree;
//   B. handed the panel's listing, over a stub whose every listing THROWS --
//      so B also proves AE lists nothing when the panel has read.
//
// and fails on any difference between the two answers.
// =============================================================================
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

globalThis.window = { cep: {} };
globalThis.require = createRequire(import.meta.url);
const out = join(tmpdir(), "xyi-tracker-disk.mjs");
await build({ entryPoints: ["src/js/main/lib/trackerDisk.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const { readTrackerDisk, trackerDisk, dropTrackerDisks } = await import(pathToFileURL(out).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra).slice(0, 400) : "")); };

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "xyi-td-")));
const all = [];
const put = (p) => { all.push(p); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, ""); };
try {
    // Norway: batch folders spelled three ways, versions, _Delivery in two
    // places, previews, an _Old, a ratio token, a name with a space.
    const T = join(ROOT, "Markets", "Norway");
    const P = "SF_INTL_Trio_DOOH_";
    put(`${T}/AE/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.aep`);
    put(`${T}/AE/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V02.aep`);
    put(`${T}/AE/Batch_02/${P}OdeonPOST_3840x1152px_30s_NO_V01.aep`);
    put(`${T}/AE/Batch_02/SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO_V01.aep`);
    put(`${T}/AE/Batch_02/_scratch.aep`);
    put(`${T}/AE/Batch_02/Adobe After Effects Auto-Save/x.aep`);
    put(`${T}/AE/Batch_01/${P}Other_1920x1080px_15s_NO_V01.aep`);
    put(`${T}/JPG_PNG/Batch_2/${P}NfkinoPOST_345x496px_30s_NO/${P}NfkinoPOST_345x496px_30s_NO.jpg`);
    put(`${T}/JPG_PNG/Batch_2/${P}NfkinoPOST_345x496px_30s_NO/ARTWORK_ONLY/x.jpg`);
    put(`${T}/JPG_PNG/Batch_2/${P}OdeonPOST_16x5_3840x1152px_30s_NO/${P}OdeonPOST_3840x1152px_30s_NO.png`);
    put(`${T}/JPG_PNG/Batch_2/${P}OdeonPOST_16x5_3840x1152px_30s_NO/notes.csv`);
    put(`${T}/JPG_PNG/Batch_2/SF_INTL_Characters_DOOH_Digital MetroPOST_1080x1920px_10s_NO/a.png`);
    put(`${T}/JPG_PNG/Batch_2/_Delivered/${P}Old_1x1/a.png`);
    put(`${T}/Renders/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.mov`);
    put(`${T}/Renders/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V02.mov`);
    put(`${T}/Renders/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V02_DOUBLE_RES.mov`);
    put(`${T}/Renders/Batch_02/${P}OdeonPOST_3840x1152px_30s_NO_V01.mov`);
    put(`${T}/Renders/Batch_02/_hidden.mov`);
    put(`${T}/Renders/Batch_02/_Delivery/${P}NfkinoPOST_345x496px_30s_NO.mp4`);
    put(`${T}/Renders/Batch_02/_Delivery/Sub/${P}OdeonPOST_3840x1152px_30s_NO.mp4`);
    put(`${T}/Renders/_Delivery/${P}OdeonPOST_3840x1152px_30s_NO.mov`);
    put(`${T}/Renders/Batch_02/_mp4/${P}OdeonPOST_3840x1152px_30s_NO.mp4`);
    put(`${T}/Renders/Batch_02/_mp4/${P}NfkinoPOST_345x496px_30s_NO_V02.mp4`);
    put(`${T}/Renders/Batch_02/_mp4/.DS_Store.mp4`);
    put(`${T}/Renders/Batch_02/_Old/${P}NfkinoPOST_1200x380px_30s_NO_V01.mov`);
    put(`${T}/Masters/Specs/NO.pdf`);
    put(`${T}/PDFs/Batch_1/a.pdf`);
    put(`${T}/PDFs/Batch_2/b.pdf`);
    // Panama: no batch level under JPG_PNG, PDFs kept loose, nothing rendered.
    const PA = join(ROOT, "Markets", "Panama");
    const TD = "SF_INTL_Trio_DOOH_TotemsDigitales_1080x1920px_10s_PA";
    put(`${PA}/AE/Batch_01/${TD}_V01.aep`);
    put(`${PA}/AE/Batch_01/SF_INTL_Trio_DOOH_MupiDigital_320x448px_10s_PA_V01.aep`);
    put(`${PA}/JPG_PNG/${TD}/${TD}.jpg`);
    put(`${PA}/JPG_PNG/${TD}/${TD}1.png`);
    put(`${PA}/JPG_PNG/${TD}/ARTWORK_ONLY/${TD}_ARTWORK_1.jpg`);
    put(`${PA}/JPG_PNG/SF_INTL_Trio_DOOH_SomeOtherBatch_1920x1080px_15s_PA/x.jpg`);
    put(`${PA}/JPG_PNG/_Old/${TD}/old.jpg`);
    put(`${PA}/PDFs/sheet.pdf`);
    // Peru: a territory with only an AE folder.
    const PE = join(ROOT, "Markets", "Peru");
    put(`${PE}/AE/Batch_01/SF_INTL_Trio_DOOH_RealPlaza_1920x1080px_20s_PE_V01.aep`);

    // --- AE's side: a stub that lists the same tree, in the same order the
    // real one does (readdir's), so the two reads see one thing.
    const dirs = {}; const files = {};
    const parentOf = (p) => { const i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : null; };
    for (const f of all) { files[f] = true; let q = parentOf(f); while (q && q.length >= ROOT.length && !dirs[q]) { dirs[q] = true; q = parentOf(q); } }
    const req = createRequire(import.meta.url);
    const nfs = req("fs");
    let listings = 0;
    let refuse = false;
    function File(p) { this.fsName = p; this.name = encodeURI(p.split("/").pop()); }
    function Folder(p) { this.fsName = p; this.name = encodeURI(p.split("/").pop()); }
    Object.defineProperty(Folder.prototype, "exists", { get() { if (refuse) throw new Error("AE must not touch the disk when the panel has read it"); return !!dirs[this.fsName]; } });
    Object.defineProperty(Folder.prototype, "parent", { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
    Folder.prototype.getFiles = function () {
        if (refuse) throw new Error("AE must not list a folder when the panel has read it");
        listings++;
        let names = [];
        try { names = nfs.readdirSync(this.fsName, { withFileTypes: true }); } catch (e) { return []; }
        return names.map((d) => (d.isDirectory() ? new Folder(this.fsName + "/" + d.name) : new File(this.fsName + "/" + d.name)));
    };
    const sb = { Folder, File, app: { settings: { haveSetting: () => false, getSetting: () => "", saveSetting() {} }, project: {}, beginUndoGroup() {}, endUndoGroup() {} },
        $: { writeln() {}, global: null }, BridgeTalk: { appName: "aftereffects" }, alert() {},
        decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error };
    sb.File.decode = decodeURI;
    vm.runInContext(readFileSync("dist/cep/jsx/index.js", "utf8"), vm.createContext(sb));
    let A = null;
    for (const r of [sb.$, sb]) for (const k of Object.keys(r)) { const v = r[k]; if (!A && v && typeof v === "object" && typeof v.trackerScan === "function") A = v; }
    if (!A) { console.log("EXPORT NOT REACHABLE"); process.exit(1); }

    const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.took; return c; };
    const cases = [
        ["Norway Batch_02, with Wrike", T, "Batch_02", [
            { name: `${P}NFKINOPOST_345x496px_30s_NO`, status: "Prep for delivery" },
            { name: `${P}OdeonPOST_3840x1152px_30s_NO`, status: "To amend" },
            { name: `${P}Kiwi_1920x1080px_15s_NO`, status: "Backlog" },
            { name: "SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO", status: "Motion" } ]],
        ["Norway Batch_02, disk only", T, "Batch_02", []],
        ["Norway asked for as Batch_2", T, "Batch_2", []],
        ["Norway Batch_01", T, "Batch_01", []],
        ["Norway, a batch that isn't there", T, "Batch_09", [{ name: `${P}Kiwi_1920x1080px_15s_NO`, status: "Backlog" }]],
        ["Panama Batch_01 (no batch level under JPG_PNG)", PA, "Batch_01", [{ name: TD, status: "Motion" }]],
        ["Peru Batch_01 (AE only)", PE, "Batch_01", []],
    ];
    for (const [label, terr, batch, wrike] of cases) {
        refuse = false; listings = 0;
        const a = A.trackerScan(JSON.stringify({ territoryPath: terr, batch, wrike, force: true }));
        const aeListings = listings;
        const disk = await readTrackerDisk(terr, batch);
        refuse = true;
        const b = A.trackerScan(JSON.stringify({ territoryPath: terr, batch, wrike, force: true, disk }));
        refuse = false;
        const same = JSON.stringify(strip(a)) === JSON.stringify(strip(b));
        check(a.success && b.success && same, `${label}: the same answer either way (${(a.rows || []).length} rows; AE alone listed ${aeListings} folders, with the panel's read it listed none)`,
            same ? undefined : { ae: strip(a), panel: strip(b), error: b.error });
    }

    console.log("");
    check((await readTrackerDisk(join(ROOT, "Markets", "Nowhere"), "Batch_01")) === null, "a territory that can't be listed is null, so AE is asked and says why -- never an empty batch");
    check((await readTrackerDisk(T, "")) === null, "no batch, no read");
    refuse = false;
    const half = A.trackerScan(JSON.stringify({ territoryPath: T, batch: "Batch_02", force: true, disk: { folders: {} } }));
    check(half.success && (half.rows || []).length > 0, "a listing that isn't whole is ignored: AE reads for itself, as before");
    dropTrackerDisks();
    const first = await trackerDisk(T, "Batch_02");
    const again = await trackerDisk(T, "Batch_2");
    const forced = await trackerDisk(T, "Batch_02", true);
    check(!first.kept && again.kept && again.disk === first.disk && !forced.kept, "a listing read moments ago is kept (Batch_2 is Batch_02); refresh reads again");
    put(`${T}/Renders/Batch_02/${P}OdeonPOST_3840x1152px_30s_NO_V02.mov`);
    dropTrackerDisks();
    check((await trackerDisk(T, "Batch_02")).disk.renders.some((x) => /Odeon.*_V02\.mov$/.test(x.nm)), "after a rename drops what was kept, the next read sees the disk as it is");
} finally {
    rmSync(ROOT, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — the panel's read and AE's read are one answer, and AE lists nothing when the panel has read.");
process.exit(fails ? 1 : 0);
