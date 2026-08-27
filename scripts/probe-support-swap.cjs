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
let projectsOnDisk = {};   // .aep fsName -> the stub project app.open() hands back
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
    app: {
        settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} },
        project: null,
        // Stands in for app.open(): swaps the "current project" for the one
        // that file names, the way AE does.
        open(file) { const p = projectsOnDisk[file.fsName]; if (!p) return null; sandbox.app.project = p; return p; },
    },
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

// ---------------------------------------------------------------------------
// 6. batch-folder mode -- every .aep in AE/Batch_1, the way a batch is run.
// ---------------------------------------------------------------------------
console.log('\n6. supportSwap() over a batch folder');
{
    const BATCH = T + '/AE/Batch_1';
    const mkProj = (name, files) => {
        const its = files.map((f) => new FootageItem(new File('/x/' + f), new FolderItem('Support')));
        return {
            name, file: new File(BATCH + '/' + name), numItems: its.length,
            item: (i) => its[i - 1], items: its, saveCount: 0,
            save() { this.saveCount++; },
        };
    };
    const a = mkProj('FID_INTL_PortalToParadise_DOOH_1920x1080px_10s_IT_V01.aep',
        ['FID_INTL_Portal_2L_DATE_OV_RGB.ai', 'FID_UNI_Logo_RGB.ai']);
    const b = mkProj('FID_INTL_TRIO_DOOH_1080x1920px_10s_IT_V01.aep',
        ['FID_Teaser_PIB_Pedigree_OV_RGB_SIMP.psd']);
    // Nothing to do here: every component is already this market's.
    const c = mkProj('FID_INTL_PortalToParadise_DOOH_512x96px_15s_IT_V01.aep',
        ['FID_INTL_Portal_2L_DATE_IT_RGB.ai']);
    dir(BATCH, [a.name, b.name, c.name, 'notes.txt']);
    projectsOnDisk = {};
    for (const p of [a, b, c]) projectsOnDisk[p.file.fsName] = p;
    sandbox.app.project = null;

    const say = (ok, msg) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg); };

    const dryB = aeft.supportSwap(BATCH, '', true);
    if (!dryB.success) { say(false, dryB.error); }
    else {
        say(dryB.projects.length === 3, 'three projects previewed, the .txt ignored (' + dryB.projects.length + ')');
        say(dryB.replaced === 2, 'two swaps found across the batch (' + dryB.replaced + ')');
        say([a, b, c].every((p) => p.saveCount === 0) && [a, b, c].every((p) => p.items.every((i) => i.replacedWith === null)),
            'the preview opened them all and wrote to none');
        // b sits under TRIO in the deliverable name, and TRIO holds that same
        // tagline filename — the tie-break has to follow the PROJECT, not the
        // first candidate found.
        const bRow = dryB.projects.filter((r) => r.aep === b.name)[0];
        say(bRow && bRow.resolution === 'TRIO', 'the TRIO deliverable is read as TRIO, not PortalToParadise (' + (bRow && bRow.resolution) + ')');
    }

    // The guard the batch probe exists for: Italy holds BOTH 1L and 2L dates,
    // so a 2L file already in IT is one token from the 1L one. "Exactly one
    // token differs" alone swapped a two-line date for a one-line date.
    {
        const cRow = dryB.projects.filter((r) => r.aep === c.name)[0];
        const row = cRow && cRow.items[0];
        say(row && row.action === 'skipped', 'a 2L date already in IT is left alone, not swapped for the 1L beside it (' + (row && row.action) + ')');
    }

    // Another market's file: neither swapped nor silent — offered to fix.
    {
        const d = mkProj('FID_INTL_PortalToParadise_DOOH_300x250px_10s_IT_V01.aep', ['FID_INTL_Portal_2L_DATE_FR_RGB.ai']);
        projectsOnDisk[d.file.fsName] = d;
        dir(BATCH, [a.name, b.name, c.name, d.name, 'notes.txt']);
        const r = aeft.supportSwap(BATCH, dryB.imageFolder, true);
        const row = r.projects.filter((x) => x.aep === d.name)[0].items[0];
        say(row.action === 'no-match' && /the FR version/.test(row.reason || '') && (row.candidates || []).length === 1,
            'a FR file in an IT project is offered as a fix, never swapped automatically');
        dir(BATCH, [a.name, b.name, c.name, 'notes.txt']);
        delete projectsOnDisk[d.file.fsName];
    }

    const realB = aeft.supportSwap(BATCH, dryB.imageFolder, false);
    say(realB.replaced === 2, 'the real batch run swaps the 2 it promised (' + realB.replaced + ')');
    say(a.saveCount === 1 && b.saveCount === 1, 'the two projects that changed were saved');
    say(c.saveCount === 0, 'the project that changed nothing was NOT saved — no pointless churn on its modified date');

    // Unticking in the preview must mean "never opened", not "opened and discarded".
    for (const p of [a, b, c]) { p.saveCount = 0; p.items.forEach((i) => { i.replacedWith = null; }); }
    const only = aeft.supportSwap(BATCH, dryB.imageFolder, false, JSON.stringify([b.name]));
    say(only.projects.length === 1 && only.projects[0].aep === b.name, 'unticking leaves exactly one project in the run');
    say(a.saveCount === 0 && a.items.every((i) => i.replacedWith === null), 'and the unticked project was never touched');
}

console.log(fails === 0 ? '\nCLEAN — the rule holds on every real family surveyed.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
