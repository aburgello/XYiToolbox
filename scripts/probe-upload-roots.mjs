// =============================================================================
// scripts/probe-upload-roots.mjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// A campaign's shared uploads folder: the batch's own folder under it (panel,
// over a throwaway tree) and the shared list behind it (the built bundle over
// a stubbed team folder).
// =============================================================================
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

globalThis.window = { cep: {} };
globalThis.require = createRequire(import.meta.url);
const out = join(tmpdir(), "xyi-upload-roots.mjs");
await build({
    entryPoints: ["src/js/main/lib/uploadRoots.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error",
    plugins: [{ name: "no-bridge", setup(b) {
        b.onResolve({ filter: /utils\/bolt$/ }, () => ({ path: "bolt", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const evalTS = async () => undefined;" }));
    } }],
});
const { uploadFolderFor, uploadRootFor, campaignKeyOf } = await import(pathToFileURL(out).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };

console.log("1. The batch's folder under the root");
const tmp = mkdtempSync(join(tmpdir(), "xyi-up-"));
try {
    const ROOT = join(tmp, "Upload_To_ENT_New", "StreetFighter", "Outdoor", "DOOH");
    mkdirSync(join(ROOT, "Taiwan", "Batch_1"), { recursive: true });
    mkdirSync(join(ROOT, "Norway"), { recursive: true });
    const MK = "/Volumes/paramount/StreetFighter/Digital/INT/XY026205_INTL_DIGITAL_Outdoor_Campaign_Markets";
    let u = uploadFolderFor(ROOT, MK + "/Taiwan", "Batch_01");
    check(u.folder === join(ROOT, "Taiwan", "Batch_1") && u.open === u.folder, "a folder already there is named as the uploads share spells it (Batch_1 for Batch_01)", u);
    u = uploadFolderFor(ROOT, MK + "/Norway", "Batch_02");
    check(u.folder === join(ROOT, "Norway", "Batch_02") && u.open === join(ROOT, "Norway"), "a batch not uploaded yet: named as it will be, and the link opens the territory", u);
    u = uploadFolderFor(ROOT, MK + "/Peru", "Batch_01");
    check(u.folder === join(ROOT, "Peru", "Batch_01") && u.open === ROOT, "a territory not there yet: named from the Markets folder, the link opens the root", u);
    u = uploadFolderFor(join(tmp, "unmounted"), MK + "/Peru", "Batch_01");
    check(u.folder === join(tmp, "unmounted", "Peru", "Batch_01"), "an uploads share that isn't mounted still names the folder", u);
    check(uploadFolderFor("", MK + "/Peru", "Batch_01").folder === "", "no root set: nothing, and the message leaves the block out");
    check(campaignKeyOf(MK + "/Taiwan") === "XY026205_INTL_DIGITAL_Outdoor_Campaign_Markets", "a campaign is filed under its Markets folder's own name");
    const roots = [{ key: "XY026205_INTL_DIGITAL_OUTDOOR_CAMPAIGN_MARKETS", campaign: "x", root: ROOT }];
    check(uploadRootFor(roots, MK + "/Taiwan") === ROOT && uploadRootFor(roots, "P:\\StreetFighter\\XY026205_INTL_DIGITAL_Outdoor_Campaign_Markets\\Taiwan") === ROOT,
        "the same campaign on another machine's mount finds the same root");
    check(uploadRootFor(roots, "/Volumes/universal/FID/XY026040_Markets/Denmark") === "", "another campaign finds none");
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

console.log("\n2. The shared list (built bundle, stubbed team folder)");
const src = readFileSync("dist/cep/jsx/index.js", "utf8");
const tree = { "/team": [] };
const written = {};
function File(p) {
    if (!(this instanceof File)) return new File(p);
    this.fsName = p; this.name = String(p).split("/").pop(); this.encoding = ""; this._buf = "";
    this.open = () => { this._buf = ""; return true; };
    this.write = (t) => { this._buf += t; return true; };
    this.read = () => written[p] || "";
    this.close = () => { if (this._buf) written[p] = this._buf; return true; };
}
Object.defineProperty(File.prototype, "exists", { get() { return Object.prototype.hasOwnProperty.call(written, this.fsName); } });
Object.defineProperty(File.prototype, "parent", { get() { const i = this.fsName.lastIndexOf("/"); return i > 0 ? new Folder(this.fsName.slice(0, i)) : null; } });
function Folder(p) {
    if (!(this instanceof Folder)) return new Folder(p);
    this.fsName = String(p).length > 1 ? String(p).replace(/\/+$/, "") : p;
    this.name = this.fsName.split("/").pop();
}
Object.defineProperty(Folder.prototype, "exists", { get() { return Object.prototype.hasOwnProperty.call(tree, this.fsName); } });
Folder.prototype.create = function () { tree[this.fsName] = tree[this.fsName] || []; return true; };
Folder.prototype.getFiles = function () { return (tree[this.fsName] || []).map((k) => (tree[this.fsName + "/" + k] ? new Folder(this.fsName + "/" + k) : new File(this.fsName + "/" + k))); };
const settings = { TeamMachineOwner: "Antonio", TeamFolderPath: "/team" };
const sandbox = {
    Folder, File,
    app: { project: { activeItem: null, numItems: 0, item: () => null }, settings: {
        haveSetting: (s, k) => Object.prototype.hasOwnProperty.call(settings, k), getSetting: (s, k) => settings[k] || "", saveSetting: (s, k, v) => { settings[k] = v; } } },
    $: { writeln() {}, sleep() {}, global: null }, BridgeTalk: { appName: "aftereffects" }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.userData = new Folder("/userdata");
vm.runInContext(src, vm.createContext(sandbox));
const A = sandbox.$["com.xyi.toolbox"] || sandbox["com.xyi.toolbox"];
if (!A || typeof A.uploadRootSet !== "function") { console.log("EXPORT NOT REACHABLE"); process.exit(1); }

check(A.uploadRootsLoad().success && A.uploadRootsLoad().entries.length === 0, "nobody has set one: an empty list, not an error");
let r = A.uploadRootSet("XY026205_INTL_DIGITAL_Outdoor_Campaign_Markets", "/Volumes/uploads/Upload_To_ENT_New/StreetFighter/Outdoor/DOOH");
check(r.success && r.entries.length === 1 && r.entries[0].author === "Antonio", "setting one shares it, with who set it", r.error);
A.uploadRootSet("XY026040_Markets", "/Volumes/uploads/PUMA/FID");
r = A.uploadRootSet("xy026205_intl_digital_outdoor_campaign_markets", "/Volumes/uploads/Upload_To_ENT_New/StreetFighter/Outdoor/DOOH_2");
check(r.entries.length === 2 && r.entries.filter((e) => /DOOH_2$/.test(e.root)).length === 1, "setting it again changes that campaign's, and leaves the other campaign's alone", r.entries.map((e) => e.root));
settings.TeamMachineOwner = "";
check(!A.uploadRootSet("XY1_Markets", "/x").success, "an untagged machine can't share one");
settings.TeamMachineOwner = "Antonio";
settings.TeamFolderPath = "/gone";
check(A.uploadRootsLoad().success && A.uploadRootsLoad().entries.length === 0 && !A.uploadRootSet("XY1_Markets", "/x").success, "team folder not mounted: reads as none, and a write is refused rather than lost");

console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — one uploads folder per campaign, shared, and the batch's own folder under it.");
process.exit(fails ? 1 : 0);
