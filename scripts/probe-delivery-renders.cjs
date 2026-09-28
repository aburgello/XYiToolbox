// =============================================================================
// scripts/probe-delivery-renders.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// Drives Deliver's "Ready to deliver" backend over a stubbed Markets tree
// shaped like Street Fighter's Hungary: Renders/Batch_01, Renders/Batch_02
// (one deliverable at V01 AND V02), and _Old/_mp4/_Delivery that must never be
// read. The subtask names come from Wrike in a different case
// (`…_LEDKELETI_…` against `…_Ledkeleti_…`).
//
//   1. deliveryFindRenders returns Batch_02 only, pairs all six exactly,
//      ticks the latest version, and shows another job's file unmatched.
//   2. A deliverable nobody rendered comes back as missing, not guessed.
//   3. A territory nobody has is said so, not "no renders".
//   4. deliveryImportRenders imports into a batch bin, selects them, and a
//      second press imports nothing new.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

const dirs = {};
const files = {};
const parentOf = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : null; };
const mkdirs = (p) => { let q = p; while (q && !dirs[q]) { dirs[q] = true; q = parentOf(q); } };
const put = (p) => { mkdirs(parentOf(p)); files[p] = ''; };

function File(p) { if (!(this instanceof File)) return new File(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
// .exists on a FILE throws: nothing here may gate on it (the NAS lies).
Object.defineProperty(File.prototype, 'exists', { get() { throw new Error('File.exists used on the share'); } });
function Folder(p) { if (!(this instanceof Folder)) return new Folder(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return !!dirs[this.fsName]; } });
let reads = [];
Folder.prototype.getFiles = function (mask) {
    if (mask !== undefined) throw new Error('getFiles(mask) used on the share');
    reads.push(this.fsName);
    const out = [];
    for (const k of Object.keys(files)) if (parentOf(k) === this.fsName) out.push(new File(k));
    for (const k of Object.keys(dirs)) if (parentOf(k) === this.fsName) out.push(new Folder(k));
    return out;
};

const SF = '/Volumes/paramount/XY026201_SF_Markets';
const HU = SF + '/Hungary/Renders';
const b2 = [
    'SF_INTL_RyuHadouken_DOOH_Ledkeleti_2304x432px_10s_HU_V01.mov',
    'SF_INTL_Trio_DINTH_Ledetele_3840x1400px_15s_HU_V01.mov',
    'SF_INTL_Trio_DOOH_Led_1920x1080px_15s_HU_V01.mov',
    'SF_INTL_Trio_DOOH_Ledallee_1080x810px_15s_HU_V01.mov',
    'SF_INTL_Trio_DOOH_Ledlurdy_600x1600px_10s_HU_V01.mov',
    'SF_INTL_Trio_DOOH_Ledshopmark_1120x704px_10s_HU_V01.mov',
    'SF_INTL_Trio_DOOH_Ledshopmark_1120x704px_10s_HU_V02.mov',
    'SF_INTL_Trio_DOOH_Somethingelse_1920x1080px_10s_HU_V01.mov',
];
b2.forEach((n) => put(HU + '/Batch_02/' + n));
// A higher-res render IS the deliverable (Slovenia's 400x800 was one).
put(HU + '/Batch_02/SF_INTL_Trio_DOOH_Ledlurdy_600x1600px_10s_HU_V01_DOUBLE_RES.mov');
put(HU + '/Batch_02/SF_INTL_Trio_DOOH_Ledallee_1080x810px_15s_HU_V02_QUAD_RES.mov');
put(HU + '/Batch_02/_Old/SF_INTL_Trio_DOOH_Led_1920x1080px_15s_HU_V01.mov');
put(HU + '/Batch_02/_mp4/SF_INTL_Trio_DOOH_Led_1920x1080px_15s_HU_V01.mov');
put(HU + '/Batch_01/SF_INTL_Trio_DOOH_Westend_1920x1080px_15s_HU_V01.mov');
put(HU + '/_Delivery/SF_INTL_Trio_DOOH_Led_1920x1080px_15s_HU.mp4');
put(HU + '/_Archive/SF_INTL_Trio_DOOH_Led_1920x1080px_15s_HU_V01.mov');
mkdirs(SF + '/Slovenia/Renders');

const wrike = [
    'SF_INTL_RyuHadouken_DOOH_LEDKELETI_2304x432px_10s_HU',
    'SF_INTL_Trio_DINTH_LEDETELE_3840x1400px_15s_HU',
    'SF_INTL_Trio_DOOH_LED_1920x1080px_15s_HU',
    'SF_INTL_Trio_DOOH_LEDALLEE_1080x810px_15s_HU',
    'SF_INTL_Trio_DOOH_LEDLURDY_600x1600px_10s_HU',
    'SF_INTL_Trio_DOOH_LEDSHOPMARK_1120x704px_10s_HU',
];

// A project: flat items, a root folder, importFile appends.
let items = [];
let nextId = 1;
const root = { name: 'Root', parentFolder: null };
const project = {
    get numItems() { return items.length; },
    item: (i) => items[i - 1],
    items: { addFolder(name) { const f = { id: nextId++, name, numItems: 0, parentFolder: root, selected: false }; root.parentFolder = null; items.push(f); return f; } },
    importFile(opts) {
        const it = { id: nextId++, name: String(opts.file.fsName).split('/').pop(), file: opts.file, mainSource: {}, parentFolder: root, selected: false };
        items.push(it);
        return it;
    },
};
function ImportOptions(f) { this.file = f; }

const settings = { 'XYiToolbox LocLibCampaigns': 'Street Fighter\t' + SF + '\nGone Campaign\t/Volumes/unmounted/Markets' };
const sandbox = {
    Folder, File, ImportOptions,
    app: {
        settings: {
            haveSetting: (sec, key) => Object.prototype.hasOwnProperty.call(settings, sec + ' ' + key),
            getSetting: (sec, key) => settings[sec + ' ' + key],
            saveSetting: (sec, key, v) => { settings[sec + ' ' + key] = String(v); },
        },
        project, beginUndoGroup() {}, endUndoGroup() {},
    },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.File.decode = decodeURI;
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const r of [sandbox.$, sandbox]) for (const k of Object.keys(r)) {
    const v = r[k];
    if (!aeft && v && typeof v === 'object' && typeof v.deliveryFindRenders === 'function') aeft = v;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };

console.log('1. Finding the batch');
let r = aeft.deliveryFindRenders(JSON.stringify({ code: 'HU', names: wrike }));
check(r.success, 'it looks', r.error);
const folders = r.folders || [];
check(folders.length === 1 && folders[0].label === 'Batch_02', 'only the folder holding this job comes back (not Batch_01, not _Old/_mp4)', folders.map((f) => f.label));
const fo = folders[0] || { files: [] };
check(fo.territory === 'Hungary' && fo.campaign === 'Street Fighter', 'labelled with its territory and campaign', [fo.territory, fo.campaign]);
check(fo.files.length === 10, 'the whole folder is mirrored, matched or not', fo.files.length);
const ticked = fo.files.filter((f) => f.matched && f.latest).map((f) => f.name);
check(ticked.length === 6, 'all six subtasks pair exactly, whatever the case', ticked.length);
check(ticked.indexOf('SF_INTL_Trio_DOOH_Ledshopmark_1120x704px_10s_HU_V02.mov') !== -1 && ticked.indexOf('SF_INTL_Trio_DOOH_Ledshopmark_1120x704px_10s_HU_V01.mov') === -1, 'the latest version is the one ticked');
check(fo.files.some((f) => /Somethingelse/.test(f.name) && !f.matched), "another job's render is shown, unmatched");
const lurdy = fo.files.filter((f) => /Ledlurdy/.test(f.name));
check(lurdy.length === 2 && lurdy.every((f) => f.matched), 'a _DOUBLE_RES render pairs with its subtask', lurdy.map((f) => f.name));
check(lurdy[1] && lurdy[1].variant === 'DOUBLE_RES' && lurdy[1].latest && !lurdy[0].latest, '…and outranks the plain render at the same version', lurdy.map((f) => [f.variant, f.latest]));
const allee = fo.files.filter((f) => /Ledallee/.test(f.name));
check(allee.length === 2 && allee[1].variant === 'QUAD_RES' && allee[1].version === 2 && allee[1].latest, '_V02_QUAD_RES reads as version 2, a QUAD_RES, the newest', allee.map((f) => [f.version, f.variant, f.latest]));
const order = fo.files.map((f) => f.name);
const shop = order.map((n, i) => (/Ledshopmark/.test(n) ? i : -1)).filter((i) => i >= 0);
check(shop.length === 2 && shop[1] === shop[0] + 1 && /V01/.test(order[shop[0]]) && /V02/.test(order[shop[1]]), 'V01 and V02 of one deliverable sit side by side, oldest first', shop);
check(!(r.missing || []).length, 'nothing missing', r.missing);
check(!reads.some((p) => /\/_/.test(p.slice(SF.length))), 'no `_` folder was ever opened', reads.filter((p) => /\/_/.test(p.slice(SF.length))));

console.log('\n2. A deliverable with no render');
r = aeft.deliveryFindRenders(JSON.stringify({ code: 'HU', names: wrike.concat(['SF_INTL_Trio_DOOH_LEDNEW_1920x1080px_15s_HU']) }));
check((r.missing || []).length === 1 && /LEDNEW/.test(r.missing[0]), 'is reported missing, not paired with a near name', r.missing);

console.log('\n3. Territories');
r = aeft.deliveryFindRenders(JSON.stringify({ code: 'DE', names: wrike }));
check(r.success && r.noTerritory && !(r.folders || []).length, 'a territory no campaign has says so', r);
r = aeft.deliveryFindRenders(JSON.stringify({ code: 'SI', names: wrike }));
check(r.success && !r.noTerritory && !(r.folders || []).length, 'a territory with no matching renders is "none yet", not "no territory"', r);
r = aeft.deliveryFindRenders(JSON.stringify({ code: 'Hungary', names: wrike }));
check((r.folders || []).length === 1, 'a folder name works as well as a code');

console.log('\n4. Importing');
const picks = fo.files.filter((f) => f.matched && f.latest).map((f) => f.path);
let imp = aeft.deliveryImportRenders(JSON.stringify({ paths: picks, folder: 'Hungary Batch_02' }));
check(imp.success && imp.imported === 6, 'six imported', imp);
const bin = items.find((i) => i.name === 'Hungary Batch_02');
check(!!bin && items.filter((i) => i.file && i.parentFolder === bin).length === 6, 'into a bin named after the batch');
check(items.filter((i) => i.selected).length === 6 && items.filter((i) => i.selected).every((i) => i.file), 'and only they are selected, ready for Delivery');
imp = aeft.deliveryImportRenders(JSON.stringify({ paths: picks, folder: 'Hungary Batch_02' }));
check(imp.success && imp.imported === 0 && imp.reused === 6, 'a second press imports nothing new', imp);
check(items.filter((i) => i.name === 'Hungary Batch_02').length === 1, '…and makes no second bin');

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — a Prep for delivery job finds its renders, exactly, and imports them once.');
process.exit(fails ? 1 : 0);
