// =============================================================================
// scripts/probe-loclib-creatives.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's autoPopulateLocLib() over a stubbed Markets tree
// shaped like a real one: one territory filed the OLD way (files loose in
// Support_Motion) and one filed the NEW way (a folder per creative, each with
// its own sub-structure below it).
//
// `tsconfig-build.json` type-checks ZERO files under src/jsx, so without this
// the scan's only gate is an artist running Auto-Populate against the studio
// NAS — and getting it wrong writes a wrong library into app.settings.
//
// What it checks:
//   1. a file under Support_Motion/<Creative>/… is filed under <Creative>,
//      whatever depth it sits at below that;
//   2. a file loose in Support_Motion keeps no creative;
//   3. a territory with no creative folders is unchanged, byte for byte;
//   4. re-running BACKFILLS a library saved before the field existed, and is
//      otherwise a no-op;
//   5. an accented creative folder is stored DECODED, not percent-escaped.
//
//   yarn build && node scripts/probe-loclib-creatives.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

// fsName -> array of child names (a folder), or absent (a file).
let tree = {};
let settings = {};

// Real constructors, because the code under test duck-types with
// `instanceof Folder` / `instanceof File` on ExtendScript's own core classes.
function File(p) {
    if (!(this instanceof File)) return new File(p);
    this.fsName = p;
    // URI-ENCODED, exactly as ExtendScript hands it back — the whole point of
    // check 5. macOS also stores accents decomposed; ä is e-plus-combining.
    this.name = encodeURI(p.split('/').pop());
}
function Folder(p) {
    if (!(this instanceof Folder)) return new Folder(p);
    this.fsName = p;
    this.name = encodeURI(p.split('/').pop());
}
Object.defineProperty(Folder.prototype, 'exists', {
    get() { return Object.prototype.hasOwnProperty.call(tree, this.fsName); },
});
Folder.prototype.getFiles = function (mask) {
    const kids = tree[this.fsName] || [];
    const out = [];
    for (const k of kids) {
        const p = this.fsName + '/' + k;
        out.push(tree[p] ? new Folder(p) : new File(p));
    }
    if (typeof mask === 'string') return out.filter((e) => e.name.slice(-mask.length + 1) === mask.slice(1));
    return out;
};

const sandbox = {
    Folder, File,
    app: {
        settings: {
            haveSetting: (s, k) => settings[s + '|' + k] !== undefined,
            getSetting: (s, k) => settings[s + '|' + k],
            saveSetting: (s, k, v) => { settings[s + '|' + k] = v; },
        },
        project: null,
    },
    $: { writeln() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' },
    alert() {},
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
        if (v && typeof v === 'object' && typeof v.autoPopulateLocLib === 'function') { aeft = v; break; }
    }
    if (aeft) break;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

// --- the tree ---------------------------------------------------------------
const ROOT = '/Volumes/newmedia/XY026040_Markets';
tree = {};
const dir = (p, kids) => { tree[p] = kids; };
dir(ROOT, ['Germany', 'France', '_Archive']);
dir(ROOT + '/_Archive', ['old.ai']);

// NEW shape — a folder per creative, files at varying depth below it.
dir(ROOT + '/Germany', ['AE', 'JPG_PNG', 'Support_Motion']);
dir(ROOT + '/Germany/AE', []);
dir(ROOT + '/Germany/JPG_PNG', ['Batch_1']);
dir(ROOT + '/Germany/JPG_PNG/Batch_1', ['irrelevant.png']);
dir(ROOT + '/Germany/Support_Motion', ['Bracelet', 'Trio', 'Seinäjoki', 'Logo_Endcard_DE.aep']);
dir(ROOT + '/Germany/Support_Motion/Bracelet', ['Date', 'MCs_Taglines', 'TT']);
dir(ROOT + '/Germany/Support_Motion/Bracelet/Date', ['Bracelet_Date_DE.aep']);
dir(ROOT + '/Germany/Support_Motion/Bracelet/MCs_Taglines', ['FID_INTL_Bracelet_1L_TAGLINE_DE_RGB.ai', 'FID_Teaser_PIB_Pedigree_DE_RGB_SIMP.psd']);
dir(ROOT + '/Germany/Support_Motion/Bracelet/TT', ['deeper']);
dir(ROOT + '/Germany/Support_Motion/Bracelet/TT/deeper', ['Bracelet_TT_DE.ai']);
dir(ROOT + '/Germany/Support_Motion/Trio', ['TT']);
dir(ROOT + '/Germany/Support_Motion/Trio/TT', ['Trio_TT_DE.ai']);
dir(ROOT + '/Germany/Support_Motion/Seinäjoki', ['Seinäjoki_DE.ai']);

// OLD shape — everything loose, no creative folders at all.
dir(ROOT + '/France', ['Support_Motion']);
dir(ROOT + '/France/Support_Motion', ['Logo_Endcard_FR.aep', 'Brand_Vector_FR.ai']);

// --- run --------------------------------------------------------------------
const CAMP = 'FID_INTL_DOOH';
let fails = 0;
const check = (label, ok, detail) => {
    console.log((ok ? '  ok    ' : '  FAIL  ') + label + (detail ? '  ' + detail : ''));
    if (!ok) fails++;
};

const r1 = aeft.autoPopulateLocLib(CAMP, ROOT);
console.log('\nrun 1: ' + JSON.stringify(r1));
const rows = () => aeft.loadLocLibComponents();
const byLabel = (l) => rows().filter((c) => c.label === l)[0];

console.log('\nfiled as:');
for (const c of rows()) console.log('  ' + (c.creative || '—').padEnd(12) + c.label);

console.log('\n1. a file under a creative folder is filed under it');
check('shallow  (Bracelet/MCs_Taglines/…ai)', byLabel('FID_INTL_Bracelet_1L_TAGLINE_DE_RGB') && byLabel('FID_INTL_Bracelet_1L_TAGLINE_DE_RGB').creative === 'Bracelet');
check('deeper   (Bracelet/TT/deeper/…ai)', byLabel('Bracelet_TT_DE') && byLabel('Bracelet_TT_DE').creative === 'Bracelet', '— depth below the first level must not change the answer');
check('sibling  (Trio/TT/…ai)', byLabel('Trio_TT_DE') && byLabel('Trio_TT_DE').creative === 'Trio', '— same TT folder name, different creative');

console.log('\n2. a file loose in Support_Motion keeps no creative');
check('Logo_Endcard_DE', byLabel('Logo_Endcard_DE') && !byLabel('Logo_Endcard_DE').creative);

console.log('\n3. a territory with no creative folders is untouched');
const fr = rows().filter((c) => c.territory === 'France');
check('2 rows, none with a creative', fr.length === 2 && !fr[0].creative && !fr[1].creative);

console.log('\n4. re-running is a no-op, and backfills an old library');
const r2 = aeft.autoPopulateLocLib(CAMP, ROOT);
check('adds nothing, refiles nothing', r2.added === 0 && r2.refiled === 0, JSON.stringify(r2));
// Strip every creative back off, as a library saved before the field would be,
// and confirm one more run restores the lot.
const stripped = rows().map((c) => { const d = { ...c }; delete d.creative; return d; });
settings['XYiToolbox|LocLibComponents'] = stripped
    .map((c) => [c.campaign, c.territory, c.label, c.path, c.folder || ''].join('\t')).join('\n');
const preCount = rows().length;
const r3 = aeft.autoPopulateLocLib(CAMP, ROOT);
const restored = rows().filter((c) => c.creative).length;
// Six: four under Bracelet (one of them two levels down), one Trio, one accented.
check('6 rows regain a creative, none added', r3.added === 0 && r3.refiled === 6 && restored === 6 && rows().length === preCount, JSON.stringify(r3));

console.log('\n5. an accented creative folder is stored decoded');
const acc = byLabel('Seinäjoki_DE');
check('creative reads back as Seinajoki-with-accent, not %-escaped',
    !!acc && acc.creative === 'Seinäjoki', acc ? JSON.stringify(acc.creative) : 'row missing');

console.log(fails === 0 ? '\nCLEAN — the scan mirrors the folder structure.' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
