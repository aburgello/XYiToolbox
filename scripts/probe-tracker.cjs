// =============================================================================
// scripts/probe-tracker.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// The Batch Tracker over a stubbed Norway, shaped like the real one: AE/Batch_02
// beside JPG_PNG/Batch_2 (a different spelling of the same batch), Renders with
// V01/V02, a _Delivery and an _mp4 of previews that must NOT count as delivered, the POST pair whose names disagree between AE and
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
// RENAME is refused until the rename section switches it on: the scan must
// never reach for it.
let allowRename = false;
const renameTo = (from, name) => {
    if (!allowRename) NOPE();
    const to = parentOf(from) + '/' + name;
    for (const k of Object.keys(files)) if (k === from || k.startsWith(from + '/')) { delete files[k]; files[to + k.slice(from.length)] = true; }
    for (const k of Object.keys(dirs)) if (k === from || k.startsWith(from + '/')) { delete dirs[k]; dirs[to + k.slice(from.length)] = true; }
    return true;
};
File.prototype.open = NOPE; File.prototype.remove = NOPE; File.prototype.copy = NOPE;
File.prototype.rename = function (n) { return renameTo(this.fsName, n); };
Object.defineProperty(File.prototype, 'parent', { get() { return new Folder(parentOf(this.fsName)); } });
function Folder(p) { this.fsName = p; this.name = encodeURI(p.split('/').pop()); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return !!dirs[this.fsName]; } });
Object.defineProperty(Folder.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
Folder.prototype.getFiles = function () { const out = []; for (const k of Object.keys(dirs)) if (parentOf(k) === this.fsName) out.push(new Folder(k)); for (const k of Object.keys(files)) if (parentOf(k) === this.fsName) out.push(new File(k)); return out; };
Folder.prototype.create = NOPE; Folder.prototype.remove = NOPE;
Folder.prototype.rename = function (n) { return renameTo(this.fsName, n); };

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
put(`${T}/Renders/Batch_02/_Delivery/${P}NfkinoPOST_345x496px_30s_NO.mp4`);
put(`${T}/Renders/Batch_02/_mp4/${P}OdeonPOST_3840x1152px_30s_NO.mp4`);
put(`${T}/Renders/Batch_02/_Old/${P}NfkinoPOST_1200x380px_30s_NO_V01.mov`);
put(`${T}/Masters/Specs/NO.pdf`);

const sb = { Folder, File, app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} }, project: {}, beginUndoGroup() {}, endUndoGroup() {} }, $: { writeln() {}, global: null }, BridgeTalk: { appName: 'aftereffects' }, alert() {}, decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error };
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
check(r.folders.delivered.every((f) => !/_mp4$/i.test(f)), '_mp4 is previews, never a delivery folder', r.folders.delivered);
const by = (re) => r.rows.find((x) => re.test(x.name));
const nk = by(/NfkinoPOST_345/);
check(nk && nk.art && nk.aep && nk.render && nk.delivered && nk.wrike, 'a finished deliverable lights every stage, across Batch_02 and Batch_2', nk && Object.keys(nk));
check(nk.render.version === 2 && nk.render.versions === 2, '…its render is the newest of two versions', nk.render);
check(nk.art.files === 1, '…counting the artwork in its own folder', nk.art);
check(nk.wrike.status === 'Prep for delivery', '…with its Wrike status, matched through the capitals', nk.wrike);
const od = by(/OdeonPOST/);
check(od && od.art && od.aep && od.render && !od.delivered, 'a JPG_PNG name with a ratio token (_16x5) still pairs; a preview in _mp4 is NOT delivered', od && Object.keys(od));
const n12 = by(/1200x380/);
check(n12 && n12.aep && n12.art && !n12.render, 'a render moved to _Old is not counted as rendered');
const ch = r.rows.filter((x) => /Characters/.test(x.name));
check(ch.length === 2, "Norway's POST pair stays two rows -- never joined", ch.map((x) => x.name));
const aepOnly = ch.find((x) => x.aep);
check(aepOnly && aepOnly.near && aepOnly.near.some((n) => /same size, named differently \(and 30s vs 10s\)/.test(n.why) && /MetroPOST/.test(n.name)), '…but each points at the other: same size, named differently, 30s vs 10s', aepOnly && aepOnly.near);
check(!nk.near && !od.near, 'two complete deliverables of one size are never flagged');
check(r.folders.specs === `${T}/Masters/Specs` && /Batch_2$/.test(r.folders.art) && /Renders\/Batch_02$/.test(r.folders.renders), 'and it knows where each stage lives, for the links', r.folders);
check(!a.trackerScan(JSON.stringify({ territoryPath: '/nowhere', batch: 'Batch_02' })).success, 'an unreachable territory is said so');

// ---------------------------------------------------------------------------
console.log('\nWrike subtasks whose files are on disk under another name (Norway, 2026-09-30)');
const T2 = '/Volumes/paramount/SF/Markets/Norway2';
const CH = 'SF_INTL_Characters_DOOH_';
put(`${T2}/AE/Batch_02/${CH}DigitalMetroPOST_1080x1920px_30s_NO_V01.aep`);
put(`${T2}/Renders/Batch_02/${CH}DigitalMetroPOST_1080x1920px_30s_NO_V01.mov`);
put(`${T2}/AE/Batch_02/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.aep`);
put(`${T2}/AE/Batch_02/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V02.aep`);
put(`${T2}/Renders/Batch_02/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.mov`);
put(`${T2}/Renders/Batch_02/_Old/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V00.mov`);
put(`${T2}/JPG_PNG/Batch_02/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO.jpg`);
put(`${T2}/JPG_PNG/Batch_02/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_ARTWORK_1.jpg`);
put(`${T2}/JPG_PNG/Batch_02/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO/notes.txt`);
// Two disk rows that could both be one subtask: neither is claimed.
put(`${T2}/AE/Batch_02/${P}OdeonPOST_1920x1080px_15s_NO_V01.aep`);
put(`${T2}/AE/Batch_02/${P}OdeonPRE_1920x1080px_15s_NO_V01.aep`);
// Another length is another deliverable, never claimed.
put(`${T2}/AE/Batch_02/${P}XXLOsloSPOST_1152x2112px_10s_NO_V01.aep`);
const wrike2 = [
    { name: `${CH}POST_1080x1920px_30s_NO`, status: 'Backlog' },
    { name: 'SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO', status: 'Backlog' },
    { name: `${P}Odeon_1920x1080px_15s_NO`, status: 'Backlog' },
    { name: `${P}XXLOsloSPOST_1152x2112px_30s_NO`, status: 'Backlog' },
];
const scan2 = () => a.trackerScan(JSON.stringify({ territoryPath: T2, batch: 'Batch_02', wrike: wrike2 }));
let r2 = scan2();
const w = (re) => r2.rows.find((x) => x.wrike && re.test(x.wrike.name));
const chr = w(/Characters_DOOH_POST/);
check(chr && chr.aep && chr.render && chr.claimed && /DigitalMetroPOST/.test(chr.claimed.name), 'Wrike POST takes the one DigitalMetroPOST on disk', chr);
const tri = w(/Trio_DOOH_POST/);
check(tri && tri.aep && tri.render && tri.art && tri.claimed && /another order/.test(tri.claimed.why), 'Wrike Trio_DOOH_POST takes Trio_POST_DOOH: same words, another order', tri && tri.claimed);
check(!r2.rows.some((x) => !x.wrike && /DigitalMetroPOST_1080x1920px_30s|Trio_POST_DOOH/.test(x.name)), '…and neither disk row is listed twice');
const odeon = w(/_Odeon_/);
check(odeon && !odeon.claimed && !odeon.aep, 'two disk rows that could both be it: neither is claimed', odeon);
const oslo = w(/XXLOsloSPOST/);
check(oslo && !oslo.claimed && !oslo.aep, 'another length is never claimed (it stays a near miss)', oslo);

console.log('\nRenaming the disk to Wrike\'s name');
const req = (o) => JSON.stringify(Object.assign({ territoryPath: T2, batch: 'Batch_02', from: 'SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO', to: 'SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO' }, o));
const dry = a.trackerRename(req({ apply: false }));
const kinds = dry.plan ? dry.plan.map((x) => x.kind).sort().join(',') : '';
check(dry.success && kinds === 'art folder,image,image,project,project,render', 'the dry run lists both projects, the render, the art folder and its two images', dry.plan);
check(dry.plan && dry.plan.some((x) => x.to === 'SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO_V02.aep') && dry.plan.some((x) => x.to === 'SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO_ARTWORK_1.jpg'), '…keeping each tail (_V02, _ARTWORK_1)');
check(!dry.plan.some((x) => /V00|notes/.test(x.from)), '…and leaving _Old and a file not named after it alone');
check(files[`${T2}/AE/Batch_02/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.aep`], 'a dry run moves nothing');
put(`${T2}/Renders/Batch_02/SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO_V01.mov`);
allowRename = true;
const clash = a.trackerRename(req({ apply: true }));
check(!clash.success && /already exists/.test(clash.error) && files[`${T2}/AE/Batch_02/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.aep`], 'a new name already taken refuses the lot, before anything moves', clash.error);
delete files[`${T2}/Renders/Batch_02/SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO_V01.mov`];
sb.app.project.file = new File(`${T2}/AE/Batch_02/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V02.aep`);
const busy = a.trackerRename(req({ apply: true }));
check(!busy.success && /open in AE/.test(busy.error), 'a project open in AE refuses the rename', busy.error);
sb.app.project.file = null;
check(!a.trackerRename(req({ apply: true, from: 'SF_INTL_Trio_DOOH_1920x1080px_30s_OV' })).success, 'an OV name is never renamed');
check(!a.trackerRename(req({ apply: true, to: '../AE/x' })).success, 'a name that is a path is refused');
const done = a.trackerRename(req({ apply: true }));
check(done.success && done.renamed === 6, 'it renames all six', done);
check(files[`${T2}/JPG_PNG/Batch_02/SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO/SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO_ARTWORK_1.jpg`] && files[`${T2}/JPG_PNG/Batch_02/SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO/notes.txt`], '…the images inside the renamed folder, and the stray file travels with it');
check(files[`${T2}/Renders/Batch_02/_Old/SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V00.mov`], '…_Old untouched');
r2 = scan2();
const tri2 = w(/Trio_DOOH_POST/);
check(tri2 && tri2.aep && tri2.render && tri2.art && !tri2.claimed && tri2.aep.version === 2, 'rescanned, it is an exact match on every stage', tri2);
allowRename = false;

console.log('\nThe comp inside keeps the old name until asked');
const root = { name: 'Root', parentFolder: null };
const comp = { name: 'SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V02', layers: {}, parentFolder: null };
const other = { name: 'SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO_V02_DOUBLE_RES', layers: {}, parentFolder: null };
const mainF = { name: 'Main', numItems: 2, item: (i) => (i === 1 ? comp : other), parentFolder: root };
comp.parentFolder = mainF; other.parentFolder = mainF;
const imported = { name: 'Main', numItems: 1, item: () => ({ name: 'Somebody_else', layers: {} }), parentFolder: { name: 'x.aep', parentFolder: root } };
sb.app.project = { file: new File(`${T2}/AE/Batch_02/SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO_V02.aep`), numItems: 2, item: (i) => (i === 1 ? imported : mainF) };
const cc = a.trackerCompCheck();
check(cc.success && cc.comps.length === 1 && cc.comps[0] === comp.name, "the check finds the stale comp in the project's OWN Main, not an imported one", cc);
const rc = a.trackerRenameComp();
check(rc.success && rc.renamed === 1 && comp.name === 'SF_INTL_Trio_DOOH_POST_1920x1080px_30s_NO_V02' && other.name.endsWith('_V02_DOUBLE_RES'), 'renaming it keeps the version; a matching comp is left alone', { comp: comp.name, other: other.name });
check(a.trackerCompCheck().comps.length === 0, '…after which there is nothing stale');

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — one batch, lined up by deliverable; the scan only reads, the rename refuses before it moves.');
process.exit(fails ? 1 : 0);
