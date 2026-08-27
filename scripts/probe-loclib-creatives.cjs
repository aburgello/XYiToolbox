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
//   5. an accented creative folder is stored DECODED, not percent-escaped;
//   6. suggestLocLibCreative picks the right creative for an open project,
//      and — the reason it is not a call to suggestJpgPngMatch — does NOT
//      fire on Trio inside Triology;
//   7. a FLAT Support_Motion (Forgotten Island's real Italy) gets its
//      creatives from <Territory>/Masters/Support, and that tree's own
//      artwork joins the library without duplicating what is already there.
//
//   yarn build && node scripts/probe-loclib-creatives.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

// fsName -> array of child names (a folder), or absent (a file).
let tree = {};
let settings = {};
let openProject = '';

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
        // Set `openProject` below to stand in for the open AE project.
        get project() { return { file: openProject ? new File('/x/' + openProject) : null }; },
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
dir(ROOT + '/Germany/Support_Motion', ['Bracelet', 'Trio', 'Seinäjoki', 'MC_Taglines', 'Logo_Endcard_DE.aep']);
dir(ROOT + '/Germany/Support_Motion/Bracelet', ['Date', 'MCs_Taglines', 'TT']);
dir(ROOT + '/Germany/Support_Motion/Bracelet/Date', ['Bracelet_Date_DE.aep']);
dir(ROOT + '/Germany/Support_Motion/Bracelet/MCs_Taglines', ['FID_INTL_Bracelet_1L_TAGLINE_DE_RGB.ai', 'FID_Teaser_PIB_Pedigree_DE_RGB_SIMP.psd']);
dir(ROOT + '/Germany/Support_Motion/Bracelet/TT', ['deeper']);
dir(ROOT + '/Germany/Support_Motion/Bracelet/TT/deeper', ['Bracelet_TT_DE.ai']);
dir(ROOT + '/Germany/Support_Motion/Trio', ['TT']);
dir(ROOT + '/Germany/Support_Motion/Trio/TT', ['Trio_TT_DE.ai']);
// A category level, because that is what every real creative folder has --
// see llCollectContainer: a first-level folder with no subfolder in it is
// read as a CATEGORY, not a creative.
dir(ROOT + '/Germany/Support_Motion/Seinäjoki', ['MCs_Taglines']);
dir(ROOT + '/Germany/Support_Motion/Seinäjoki/MCs_Taglines', ['Seinäjoki_DE.ai']);
// The shape that rule exists for: a flat category folder sitting where a
// creative would, with no Masters/Support to resolve it. Paw Patrol has nine
// territories like this (MC_Taglines, AEP, PNGs).
dir(ROOT + '/Germany/Support_Motion/MC_Taglines', ['PP3_INTL_MC_9_DE_RGB.ai']);

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
// MC_Taglines' file has no creative either way, so it is not among them.
check('6 rows regain a creative, none added', r3.added === 0 && r3.refiled === 6 && restored === 6 && rows().length === preCount, JSON.stringify(r3));

console.log('\n4b. a flat category folder is not mistaken for a creative');
check('MC_Taglines/ names no creative, with no source tree to ask',
    !!byLabel('PP3_INTL_MC_9_DE_RGB') && !byLabel('PP3_INTL_MC_9_DE_RGB').creative,
    byLabel('PP3_INTL_MC_9_DE_RGB') ? JSON.stringify(byLabel('PP3_INTL_MC_9_DE_RGB').creative) : 'row missing');

console.log('\n5. an accented creative folder is stored decoded');
const acc = byLabel('Seinäjoki_DE');
check('creative reads back as Seinajoki-with-accent, not %-escaped',
    !!acc && acc.creative === 'Seinäjoki', acc ? JSON.stringify(acc.creative) : 'row missing');

console.log('\n7. a flat Support_Motion is filed from Masters/Support');
{
    // Forgotten Island's real Italy: Support_Motion has NO creative level, and
    // Masters/Support has one per creative. Stems pair across the two.
    const IT = ROOT + '/Italy';
    dir(ROOT, tree[ROOT].concat(['Italy']));
    dir(IT, ['Support_Motion', 'Masters']);
    dir(IT + '/Support_Motion', ['Tagline', 'Date', 'TT']);
    dir(IT + '/Support_Motion/Tagline', ['FID_INTL_Trio_Pedigree_IT_RGB.aep', 'FID_INTL_Trio_Pedigree_IT_RGB.psd']);
    dir(IT + '/Support_Motion/Date', ['FID_INTL_Portal_2L_DATE_IT_RGB.aep', 'FID_INTL_Trio_2L_DATE_IT_RGB Precomp.aep']);
    dir(IT + '/Support_Motion/TT', ['FID_RGB_TT_IT_ON_BLACK_Simp_OOH.aep']);
    dir(IT + '/Masters', ['Support']);
    dir(IT + '/Masters/Support', ['PortalToParadise', 'TRIO', 'FID_DreamWorks_Logo_Bugs_Cyan_IT_RGB.ai']);
    dir(IT + '/Masters/Support/PortalToParadise', ['Date']);
    dir(IT + '/Masters/Support/PortalToParadise/Date', ['FID_INTL_Portal_2L_DATE_IT_RGB.ai']);
    dir(IT + '/Masters/Support/TRIO', ['MCs_Taglines', 'TT', '_Old']);
    dir(IT + '/Masters/Support/TRIO/MCs_Taglines', ['FID_INTL_Trio_Pedigree_IT_RGB.psd', 'FID_INTL_Trio_Tagline_IT_RGB.ai']);
    dir(IT + '/Masters/Support/TRIO/TT', ['FID_RGB_TT_IT_ON_BLACK_Simp_OOH.psd']);
    dir(IT + '/Masters/Support/TRIO/_Old', ['FID_INTL_Trio_Tagline_XX_RGB.ai']);

    settings['XYiToolbox|LocLibComponents'] = '';
    const r = aeft.autoPopulateLocLib(CAMP, ROOT, 'Italy');
    const rows = aeft.loadLocLibComponents().filter((c) => c.territory === 'Italy');
    for (const c of rows) console.log('        ' + (c.creative || '—').padEnd(18) + c.label + '   ' + c.path.replace(IT + '/', ''));

    const by = (l) => rows.filter((c) => c.label === l)[0];
    const say = (ok, msg) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg); };

    say(by('FID_INTL_Portal_2L_DATE_IT_RGB') && by('FID_INTL_Portal_2L_DATE_IT_RGB').creative === 'PortalToParadise',
        'a loose Date/.aep is filed under PortalToParadise, from the source tree');
    say(by('FID_RGB_TT_IT_ON_BLACK_Simp_OOH') && by('FID_RGB_TT_IT_ON_BLACK_Simp_OOH').creative === 'TRIO',
        'a loose TT/.aep is filed under TRIO');
    // Two files share this stem in Support_Motion (.aep and .psd) and BOTH
    // pair to TRIO — the index is keyed on the stem, not the extension.
    const ped = rows.filter((c) => c.label === 'FID_INTL_Trio_Pedigree_IT_RGB');
    say(ped.length === 2 && ped.every((c) => c.creative === 'TRIO'),
        'the .aep and its .psd both land under TRIO (' + ped.length + ' rows)');
    say(ped.every((c) => c.path.indexOf('/Support_Motion/') !== -1),
        'and the Masters/Support copy of that .psd is NOT added twice');
    say(by('FID_INTL_Trio_Tagline_IT_RGB') && by('FID_INTL_Trio_Tagline_IT_RGB').creative === 'TRIO'
        && by('FID_INTL_Trio_Tagline_IT_RGB').path.indexOf('/Masters/Support/') !== -1,
        'source artwork with no Support_Motion twin IS added, tagged TRIO');
    say(!by('FID_INTL_Trio_Tagline_XX_RGB'), 'the source tree\'s _Old folder is skipped');
    say(by('FID_INTL_Trio_2L_DATE_IT_RGB Precomp') && !by('FID_INTL_Trio_2L_DATE_IT_RGB Precomp').creative,
        'a stem with no exact twin stays loose rather than being guessed at');
    say(by('FID_DreamWorks_Logo_Bugs_Cyan_IT_RGB') && !by('FID_DreamWorks_Logo_Bugs_Cyan_IT_RGB').creative,
        'a file loose at the source root names no creative, and claims none');

    // Idempotent, like every other run.
    const again = aeft.autoPopulateLocLib(CAMP, ROOT, 'Italy');
    say(again.added === 0 && again.refiled === 0, 'a second run adds and refiles nothing (' + JSON.stringify({ a: again.added, r: again.refiled }) + ')');
}

console.log('\n6. the open project is matched to a creative folder');
const match = (proj, creatives, expected, why) => {
    openProject = proj;
    const got = aeft.suggestLocLibCreative(creatives);
    check(String(got === null ? '—' : got).padEnd(20) + why, got === expected, got === expected ? '' : '(wanted ' + expected + ')');
};
const GERMANY = ['Bracelet', 'Trio', 'Date'];
match('FID_INTL_Bracelet_DOOH_1920x1080px_10s_DE_V01.aep', GERMANY, 'Bracelet', 'current convention');
match('ODY_INTL_DGTL_DOOH_Bracelet_1920x858_10sec_DE.aep', GERMANY, 'Bracelet', 'legacy convention');
match('FID_INTL_Trio_DOOH_DufryEZ_512x96px_15s_DE.aep', GERMANY, 'Trio', 'creative with a site token after it');
match('FID_INTL_Pedigree_DOOH_1920x1080px_10s_DE.aep', GERMANY, null, 'no folder for it — no mark, not a guess');
match('', GERMANY, null, 'unsaved project');
// The traps. These are why this is its own function and not a call to
// suggestJpgPngMatch, whose substring branch fires on every one of them.
match('FID_INTL_Triology_DOOH_1920x1080px_10s_DE.aep', GERMANY, null, 'Trio sits INSIDE Triology');
match('FID_INTL_MyBracelets_DOOH_1920x1080px_10s_DE.aep', GERMANY, null, 'Bracelet inside Bracelets');
match('FID_INTL_PortalToParadise_DOOH_1920x640px_30s_NO.aep', ['Portal_To_Paradise', 'Trio'], 'Portal_To_Paradise', 'folder underscored, deliverable not');
match('FID_INTL_Portal_To_Paradise_DOOH_1920x640px_30s_NO.aep', ['PortalToParadise'], 'PortalToParadise', '…and the other way round');
match('FID_INTL_Bracelet_DOOH_1920x1080px_10s_DE.aep', ['Bracelet', 'BraceletReveal'], 'Bracelet', 'exact beats the longer sibling');
match('FID_INTL_BraceletReveal_DOOH_1920x1080px_10s_DE.aep', ['Bracelet', 'BraceletReveal'], 'BraceletReveal', 'longest match wins');
match('FID_INTL_TT_DOOH_1920x1080px_10s_DE.aep', ['TT', 'Trio'], null, 'two letters match too much to be evidence');
openProject = '';

console.log(fails === 0 ? '\nCLEAN — the scan mirrors the folder structure.' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
