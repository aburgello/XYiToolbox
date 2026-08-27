// =============================================================================
// scripts/probe-support-swap.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's ssOneTokenDiff -- Support Swap's whole matching
// rule -- against the filename families actually on the studio share, surveyed
// across Forgotten Island (Italy/Germany/France/Norway) and Paw Patrol.
//
// src/jsx is type-checked by neither tsconfig, and this matcher decides which
// artwork goes into a finished deliverable. A wrong pair is the expensive
// failure; an unmatched one costs a manual pick.
//
//   yarn build && node scripts/probe-support-swap.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

let tree = {};   // fsName -> child names (a folder); absent means a file
const parentOf = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : null; };
function File(p) { if (!(this instanceof File)) return new File(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Object.defineProperty(File.prototype, 'exists', { get() { return true; } });
Object.defineProperty(File.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
function Folder(p) { if (!(this instanceof Folder)) return new Folder(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return Object.prototype.hasOwnProperty.call(tree, this.fsName); } });
Object.defineProperty(Folder.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
Folder.prototype.getFiles = function () {
    return (tree[this.fsName] || []).map((k) => {
        const p = this.fsName + '/' + k;
        return tree[p] ? new Folder(p) : new File(p);
    });
};
// The code under test duck-types with `instanceof FolderItem` / `FootageItem`
// on AE's own DOM classes, so those need to be real constructors too.
function FolderItem(name, parent) { this.name = name; this.parentFolder = parent || null; }
function FootageItem(file, parentFolder) {
    this.file = file; this.parentFolder = parentFolder || null; this.replacedWith = null;
    this.replace = (f) => { this.replacedWith = f.fsName; };
}

const sandbox = {
    Folder, File,
    FolderItem, FootageItem,
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} }, project: null },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.selectDialog = () => null;
sandbox.File.decode = decodeURI;
const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx);

let aeft = null;
for (const root of [sandbox.$, sandbox]) {
    for (const k of Object.keys(root)) {
        const v = root[k];
        if (v && typeof v === 'object' && typeof v.ssOneTokenDiff === 'function') { aeft = v; break; }
    }
    if (aeft) break;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const pair = (a, b, expectMatch, why) => {
    const at = aeft.ssOneTokenDiff(a, b);
    const ok = (at !== -1) === expectMatch;
    if (!ok) fails++;
    const verdict = at === -1 ? 'no match' : 'swap token ' + at;
    console.log((ok ? '  ok    ' : '  FAIL  ') + verdict.padEnd(14) + why);
};

console.log('Real families from <Territory>/Masters/Support — Forgotten Island\n');
console.log('1. the swap the tool exists for');
pair('FID_INTL_Portal_2L_DATE_OV_RGB.ai', 'FID_INTL_Portal_2L_DATE_IT_RGB.ai', true, 'Date · OV -> IT');
pair('FID_Teaser_PIB_Pedigree_OV_RGB_SIMP.psd', 'FID_Teaser_PIB_Pedigree_NO_RGB_SIMP.psd', true, 'MCs_Taglines · token mid-name');
pair('FID_RGB_TT_OV_ON_75BLACK_Simp_OOH.psd', 'FID_RGB_TT_FR_ON_75BLACK_Simp_OOH.psd', true, 'TT · token at index 3, not the end');
pair('FID_DreamWorks_Logo_Bugs_Cyan_OV_RGB.ai', 'FID_DreamWorks_Logo_Bugs_Cyan_IT_RGB.ai', true, 'Bugs · OV -> IT');
pair('PP3_INTL_MC_1_OV_RGB.ai', 'PP3_INTL_MC_1_NO_RGB.ai', true, 'Paw Patrol tagline · OV -> NO');

console.log('\n2. what must NOT match');
pair('FID_UNI_Logo_RGB.ai', 'FID_UNI_Logo_RGB.ai', false, 'shared artwork, no market token — zero tokens differ');
pair('FID_INTL_Portal_2L_DATE_OV_RGB.ai', 'FID_INTL_Portal_1L_DATE_DE_RGB.ai', false, '1L vs 2L AND OV vs DE — two differences');
pair('PP3_INTL_MC_1_OV_RGB.ai', 'PP3_INTL_MC_2_NO_RGB.ai', false, 'MC_1 vs MC_2 — a different component');
pair('FID_INTL_Portal_2L_DATE_OV_RGB.ai', 'FID_INTL_Portal_2L_DATE_IT_RGB.psd', false, 'right name, wrong file type');
pair('FID_INTL_Portal_2L_DATE_OV_RGB.ai', 'FID_INTL_Portal_2L_DATE_RGB.ai', false, 'a token MISSING is not a token swapped');

console.log('\n3. the discriminator this buys');
// Germany really does hold both 1L and 2L dates. Against a 2L original only
// the 2L file is one token away, so the pair is decided without a rule for it.
const germany = ['FID_INTL_Portal_1L_DATE_DE_RGB.ai', 'FID_INTL_Portal_2L_DATE_DE_RGB.ai'];
const want = 'FID_INTL_Portal_2L_DATE_OV_RGB.ai';
const hits = germany.filter((g) => aeft.ssOneTokenDiff(want, g) !== -1);
const ok = hits.length === 1 && hits[0] === 'FID_INTL_Portal_2L_DATE_DE_RGB.ai';
if (!ok) fails++;
console.log((ok ? '  ok    ' : '  FAIL  ') + 'exactly one of Germany\'s two DATE files matches a 2L original: ' + JSON.stringify(hits));

console.log('\n4. separators and case');
pair('FID INTL Portal 2L DATE OV RGB.ai', 'FID_INTL_Portal_2L_DATE_IT_RGB.ai', true, 'spaces and underscores tokenise the same');
pair('fid_intl_portal_2l_date_ov_rgb.ai', 'FID_INTL_Portal_2L_DATE_IT_RGB.AI', true, 'case-insensitive on both name and extension');

// ---------------------------------------------------------------------------
// 5. the whole export, over a stubbed Italy shaped like the real one.
// ---------------------------------------------------------------------------
console.log('\n5. supportSwap() end to end');

const T = '/Volumes/universal/…/Markets/Italy';
const SUP = T + '/Masters/Support';
const dir = (p, kids) => { tree[p] = kids; };
dir(T, ['AE', 'Masters']);
dir(T + '/AE', ['Batch_1']);
dir(T + '/AE/Batch_1', []);
dir(T + '/Masters', ['Support']);
dir(SUP, ['PortalToParadise', 'TRIO', 'FID_DreamWorks_Logo_Bugs_Cyan_IT_RGB.ai']);
dir(SUP + '/PortalToParadise', ['Bugs', 'Date', 'MCs_Taglines', 'TT', '_Old']);
dir(SUP + '/PortalToParadise/Bugs', ['FID_UNI_Logo_RGB.ai', 'FID_DreamWorks_Logo_Bugs_Cyan_IT_RGB.ai']);
dir(SUP + '/PortalToParadise/Date', ['FID_INTL_Portal_1L_DATE_IT_RGB.ai', 'FID_INTL_Portal_2L_DATE_IT_RGB.ai']);
dir(SUP + '/PortalToParadise/MCs_Taglines', ['FID_Teaser_PIB_Pedigree_IT_RGB_SIMP.psd']);
dir(SUP + '/PortalToParadise/TT', ['FID_RGB_TT_OV_ON_75BLACK_Simp_OOH.psd']);   // not localised yet
dir(SUP + '/PortalToParadise/_Old', ['FID_INTL_Portal_2L_DATE_XX_RGB.ai']);      // must be ignored
dir(SUP + '/TRIO', ['MCs_Taglines']);
dir(SUP + '/TRIO/MCs_Taglines', ['FID_Teaser_PIB_Pedigree_IT_RGB_SIMP.psd']);    // SAME NAME, other creative

const projFolder = new FolderItem('Support');
const imported = new FolderItem('Some_Other_Project.aep');
const inImported = new FolderItem('Support', imported);
const items = [
    new FootageItem(new File('/x/FID_INTL_Portal_2L_DATE_OV_RGB.ai'), projFolder),
    new FootageItem(new File('/x/FID_UNI_Logo_RGB.ai'), projFolder),
    new FootageItem(new File('/x/FID_RGB_TT_OV_ON_75BLACK_Simp_OOH.psd'), projFolder),
    new FootageItem(new File('/x/FID_Teaser_PIB_Pedigree_OV_RGB_SIMP.psd'), projFolder),
    new FootageItem(new File('/x/FID_INTL_Portal_2L_DATE_OV_RGB.ai'), inImported),
    new FootageItem(new File('/x/render.mov'), projFolder),
];
sandbox.app.project = {
    file: new File(T + '/AE/Batch_1/FID_INTL_PortalToParadise_DOOH_1920x1080px_10s_IT_V01.aep'),
    numItems: items.length,
    item: (i) => items[i - 1],
    saved: false,
    save() { this.saved = true; },
};

const dry = aeft.supportSwap('', '', true);
if (!dry.success) { console.log('  FAIL  ' + dry.error); fails++; }
else {
    const rows = dry.projects[0].items;
    const by = (n) => rows.filter((r) => r.name === n)[0];
    const say = (ok, msg) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg); };

    for (const r of rows) console.log('        · ' + r.action.padEnd(9) + r.name + (r.newName ? '  ->  ' + r.newName : '') + (r.reason ? '   (' + r.reason.slice(0, 58) + ')' : ''));

    say(by('FID_INTL_Portal_2L_DATE_OV_RGB.ai')?.newName === 'FID_INTL_Portal_2L_DATE_IT_RGB.ai',
        'the 2L date swaps to IT, not the 1L sitting beside it');
    say(by('FID_UNI_Logo_RGB.ai')?.action === 'skipped',
        'the shared logo is skipped, not swapped');
    say(by('FID_RGB_TT_OV_ON_75BLACK_Simp_OOH.psd')?.action === 'skipped'
        && /Still the OV version/.test(by('FID_RGB_TT_OV_ON_75BLACK_Simp_OOH.psd').reason || ''),
        'an OV-only component says so rather than swapping OV -> OV');
    const tie = by('FID_Teaser_PIB_Pedigree_OV_RGB_SIMP.psd');
    say(tie?.action === 'replaced' && /PortalToParadise/.test(tie.newName || '') === false && tie.newName === 'FID_Teaser_PIB_Pedigree_IT_RGB_SIMP.psd',
        'two creatives hold that tagline; the project\'s own creative breaks the tie');
    say(rows.filter((r) => r.name === 'render.mov').length === 0, 'a .mov is not a component source');
    say(rows.length === 4, 'the imported sibling project\'s copy is left alone (' + rows.length + ' rows, want 4)');
    say(dry.dryRun === true && items.every((i) => i.replacedWith === null) && sandbox.app.project.saved === false,
        'a dry run replaces nothing and saves nothing');
    say(dry.applyExport === 'supportSwap' && dry.pickExport === 'supportSwapPickFile',
        'the report names its own host exports, so the shared modal drives the right one');

    const real = aeft.supportSwap('', dry.imageFolder, false);
    say(real.success && real.replaced === 2, 'the real run swaps the 2 it said it would (' + real.replaced + ')');
    say(sandbox.app.project.saved === true, 'and saves the project afterwards');
    say(items[1].replacedWith === null, 'the shared logo is still untouched after the real run');
}

console.log(fails === 0 ? '\nCLEAN — the rule holds on every real family surveyed.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
