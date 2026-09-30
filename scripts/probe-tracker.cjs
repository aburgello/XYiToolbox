// =============================================================================
// scripts/probe-tracker.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// The Batch Tracker over a stubbed Norway, shaped like the real one: AE/Batch_02
// beside JPG_PNG/Batch_2 (a different spelling of the same batch), Renders with
// V01/V02 and an _mp4, the POST pair whose names disagree between AE and
// JPG_PNG, and Wrike subtasks named in capitals. Read-only: the stub THROWS on
// anything that isn't a listing.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');
const dirs = {}; const files = {};
const parentOf = (p) => { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : null; };
const mk = (p) => { let q = p; while (q && !dirs[q]) { dirs[q] = true; q = parentOf(q); } };
const put = (p) => { mk(parentOf(p)); files[p] = true; };
const NOPE = () => { throw new Error('the tracker must only list folders'); };
function File(p) { this.fsName = p; this.name = encodeURI(p.split('/').pop()); }
File.prototype.open = NOPE; File.prototype.remove = NOPE; File.prototype.rename = NOPE; File.prototype.copy = NOPE;
Object.defineProperty(File.prototype, 'parent', { get() { return new Folder(parentOf(this.fsName)); } });
function Folder(p) { this.fsName = p; this.name = encodeURI(p.split('/').pop()); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return !!dirs[this.fsName]; } });
Object.defineProperty(Folder.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
Folder.prototype.getFiles = function () { const out = []; for (const k of Object.keys(dirs)) if (parentOf(k) === this.fsName) out.push(new Folder(k)); for (const k of Object.keys(files)) if (parentOf(k) === this.fsName) out.push(new File(k)); return out; };
Folder.prototype.create = NOPE; Folder.prototype.remove = NOPE; Folder.prototype.rename = NOPE;

const T = '/Volumes/paramount/SF/Markets/Norway';
const P = 'SF_INTL_Trio_DOOH_';
// AE
put(`${T}/AE/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.aep`);
put(`${T}/AE/Batch_02/${P}OdeonPOST_3840x1152px_30s_NO_V01.aep`);
put(`${T}/AE/Batch_02/SF_INTL_Characters_DOOH_Post_1080x1920px_30s_NO_V01.aep`);
put(`${T}/AE/Batch_02/${P}NfkinoPOST_1200x380px_30s_NO_V01.aep`);
put(`${T}/AE/Batch_01/${P}Other_1920x1080px_15s_NO_V01.aep`);
// JPG_PNG, spelled Batch_2, a ratio token on one name
put(`${T}/JPG_PNG/Batch_2/${P}NfkinoPOST_345x496px_30s_NO/${P}NfkinoPOST_345x496px_30s_NO.jpg`);
put(`${T}/JPG_PNG/Batch_2/${P}NfkinoPOST_345x496px_30s_NO/ARTWORK_ONLY/x.jpg`);
put(`${T}/JPG_PNG/Batch_2/${P}OdeonPOST_16x5_3840x1152px_30s_NO/${P}OdeonPOST_3840x1152px_30s_NO.png`);
put(`${T}/JPG_PNG/Batch_2/SF_INTL_Characters_DOOH_Digital MetroPOST_1080x1920px_10s_NO/a.png`);
put(`${T}/JPG_PNG/Batch_2/${P}NfkinoPOST_1200x380px_30s_NO/a.png`);
// Renders
put(`${T}/Renders/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.mov`);
put(`${T}/Renders/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V02.mov`);
put(`${T}/Renders/Batch_02/${P}OdeonPOST_3840x1152px_30s_NO_V01.mov`);
put(`${T}/Renders/Batch_02/_mp4/${P}NfkinoPOST_345x496px_30s_NO.mp4`);
put(`${T}/Renders/Batch_02/_Old/${P}NfkinoPOST_1200x380px_30s_NO_V01.mov`);
put(`${T}/Masters/Specs/NO.pdf`);

const sb = { Folder, File, app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} }, project: {} }, $: { writeln() {}, global: null }, BridgeTalk: { appName: 'aftereffects' }, alert() {}, decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error };
sb.File.decode = decodeURI;
vm.runInContext(src, vm.createContext(sb));
let a = null;
for (const r of [sb.$, sb]) for (const k of Object.keys(r)) { const v = r[k]; if (!a && v && typeof v === 'object' && typeof v.trackerScan === 'function') a = v; }
if (!a) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }
let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };

sb.app.project.file = new File(`${T}/AE/Batch_02/${P}NfkinoPOST_345x496px_30s_NO_V01.aep`);
const ctx = a.trackerContext();
check(ctx.territory === 'Norway' && ctx.batch === 'Batch_02' && ctx.batches.join() === 'Batch_01,Batch_02', 'the open project places the tracker: Norway, Batch_02', ctx);

const wrike = [
    { name: `${P}NFKINOPOST_345x496px_30s_NO`, status: 'Prep for delivery' },
    { name: `${P}ODEONPOST_3840x1152px_30s_NO`, status: 'Render review' },
];
const r = a.trackerScan(JSON.stringify({ territoryPath: T, batch: 'Batch_02', wrike }));
check(r.success, 'it scans', r.error);
const by = (re) => r.rows.find((x) => re.test(x.name));
const nk = by(/NfkinoPOST_345/);
check(nk && nk.art && nk.aep && nk.render && nk.delivered && nk.wrike, 'a finished deliverable lights every stage, across Batch_02 and Batch_2', nk && Object.keys(nk));
check(nk.render.version === 2 && nk.render.versions === 2, '…its render is the newest of two versions', nk.render);
check(nk.art.files === 1, '…counting the artwork in its own folder', nk.art);
check(nk.wrike.status === 'Prep for delivery', '…with its Wrike status, matched through the capitals', nk.wrike);
const od = by(/OdeonPOST/);
check(od && od.art && od.aep && od.render && !od.delivered, 'a JPG_PNG name with a ratio token (_16x5) still pairs; not yet delivered', od && Object.keys(od));
const n12 = by(/1200x380/);
check(n12 && n12.aep && n12.art && !n12.render, 'a render moved to _Old is not counted as rendered');
const ch = r.rows.filter((x) => /Characters/.test(x.name));
check(ch.length === 2, "Norway's POST pair stays two rows -- never joined", ch.map((x) => x.name));
const aepOnly = ch.find((x) => x.aep);
check(aepOnly && aepOnly.near && aepOnly.near.some((n) => /same size, named differently \(and 30s vs 10s\)/.test(n.why) && /MetroPOST/.test(n.name)), '…but each points at the other: same size, named differently, 30s vs 10s', aepOnly && aepOnly.near);
check(!nk.near && !od.near, 'two complete deliverables of one size are never flagged');
check(r.folders.specs === `${T}/Masters/Specs` && /Batch_2$/.test(r.folders.art) && /Renders\/Batch_02$/.test(r.folders.renders), 'and it knows where each stage lives, for the links', r.folders);
check(!a.trackerScan(JSON.stringify({ territoryPath: '/nowhere', batch: 'Batch_02' })).success, 'an unreachable territory is said so');

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — one batch, lined up by deliverable, read-only.');
process.exit(fails ? 1 : 0);
