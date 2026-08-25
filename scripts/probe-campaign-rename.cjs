// =============================================================================
// scripts/probe-campaign-rename.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's campaignRename() against a stubbed filesystem.
//
// This exists because campaignRename reads parseFilenameMeta, and a change made
// for a DIFFERENT caller silently broke it for four months: d0653f6 re-cut
// `campaign` as the creative alone (right for the frontcard) while this tool
// wanted the whole descriptive part. Nothing failed, nothing type-checked --
// tsconfig-build.json checks zero files under src/jsx -- and the only symptom
// was AE projects quietly renaming themselves to ..._V01_copy.aep.
//
// The two conventions are both fixtures on purpose: masters are on BOTH
// permanently, and the legacy _DGTL_ form is the one where the artwork type is
// the FIRST descriptive token, so it fails differently from the current form.
//
//   yarn build && node scripts/probe-campaign-rename.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

let disk = {};
let dialogQueue = [];

function makeFile(path) {
    const name = path.split('/').pop();
    return {
        name,
        fsName: path,
        get parent() { return makeFolder(path.substring(0, path.lastIndexOf('/'))); },
        get exists() { return !!disk[path]; },
        rename(n) {
            const target = path.substring(0, path.lastIndexOf('/')) + '/' + n;
            delete disk[path];
            disk[target] = true;
            return true;
        },
        copy(dest) { disk[dest] = true; return true; },
        remove() { delete disk[path]; return true; },
    };
}
function makeFolder(path) {
    return {
        fsName: path,
        name: path.split('/').pop(),
        get exists() { return true; },
        getFiles(mask) {
            const kids = Object.keys(disk).filter((p) => p.substring(0, p.lastIndexOf('/')) === path);
            const files = kids.map(makeFile);
            if (mask === undefined) return files;
            const rx = new RegExp('^' + String(mask).replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
            return files.filter((f) => rx.test(f.name));
        },
    };
}

const sandbox = {
    Folder: function (p) { return makeFolder(p); },
    File: function (p) { return makeFile(p); },
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} }, project: null },
    $: { writeln() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' },
    alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.selectDialog = () => makeFolder(dialogQueue.shift());
sandbox.File.decode = decodeURI;
// The tool filters its AE folder with `instanceof File`, which is a host-class
// check the sandbox has to answer; duck-typing matches the codebase rule.
Object.defineProperty(sandbox.File, Symbol.hasInstance, { value: (o) => !!o && typeof o.rename === 'function' });
Object.defineProperty(sandbox.Folder, Symbol.hasInstance, { value: (o) => !!o && typeof o.getFiles === 'function' });

const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx);

let api = null;
for (const root of [sandbox.$, sandbox]) {
    for (const k of Object.keys(root)) {
        const v = root[k];
        if (v && typeof v === 'object' && typeof v.campaignRename === 'function') { api = v; break; }
    }
    if (api) break;
}
if (!api) { console.log('EXPORT NOT REACHABLE — globals: ' + Object.keys(sandbox).join(',')); process.exit(1); }

let fails = 0;
function check(label, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + label +
        (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/** Runs the tool over one folder pair and returns the AE-side names after. */
function run(pdfs, aeps) {
    disk = {};
    pdfs.forEach((n) => { disk['/pdf/' + n + '.pdf'] = true; });
    aeps.forEach((n) => { disk['/ae/' + n + '.aep'] = true; });
    dialogQueue = ['/pdf', '/ae'];
    const res = api.campaignRename();
    if (!res.success) return ['ERROR: ' + res.error];
    return Object.keys(disk)
        .filter((p) => p.indexOf('/ae/') === 0)
        .map((p) => p.split('/').pop())
        .sort();
}

const AEP = 'FID_INTL_PortalToParadise_DOOH_MULTIART_1180x228px_10s_CO_V01';

// 1. The current convention. The AE file carries a placeholder in its site
//    slot; the PDF's site replaces it and the creative is left alone.
check('current convention -> site borrowed, creative kept',
    run(['FID_INTL_MultiArt_DOOH_SalitreWheel_1180x228px_10s_CO'], [AEP]),
    ['FID_INTL_PortalToParadise_DOOH_SalitreWheel_1180x228px_10s_CO_V01.aep']);

// 2. The legacy _DGTL_ form, which is what the tool was ported against. DOOH is
//    the first descriptive token here, so `campaign` is empty and reading it
//    spliced "" in as a double underscore.
check('legacy _DGTL_ -> descriptive part inserted, no empty token',
    run(['ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV'], ['ODY_INTL_DGTL_DOOH_1920x858_10sec_OV']),
    ['ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV.aep']);

// 3. Several sites at one size is the shape a real campaign folder has: one AE
//    file, one copy per site, each named for its own site rather than _copy2.
check('two sites, one size -> one copy each, distinctly named',
    run([
        'FID_INTL_MultiArt_DOOH_SalitreWheel_1180x228px_10s_CO',
        'FID_INTL_MultiArt_DOOH_UnicentroNorte_1180x228px_10s_CO',
    ], [AEP]),
    [
        'FID_INTL_PortalToParadise_DOOH_MULTIART_1180x228px_10s_CO_V01.aep',
        'FID_INTL_PortalToParadise_DOOH_SalitreWheel_1180x228px_10s_CO_V01.aep',
        'FID_INTL_PortalToParadise_DOOH_UnicentroNorte_1180x228px_10s_CO_V01.aep',
    ]);

// 4. Running it twice must be a no-op. The name it builds is the name already
//    on disk, and the exists-loop will happily hand that file a _copy suffix.
check('already named -> untouched, not _copy',
    run(['FID_INTL_MultiArt_DOOH_SalitreWheel_1180x228px_10s_CO'],
        ['FID_INTL_PortalToParadise_DOOH_SalitreWheel_1180x228px_10s_CO_V01']),
    ['FID_INTL_PortalToParadise_DOOH_SalitreWheel_1180x228px_10s_CO_V01.aep']);

// 5. A PDF with nothing right of the artwork type has no site to lend.
check('PDF with no site part -> AE file left alone',
    run(['FID_INTL_MultiArt_DOOH_1180x228px_10s_CO'], [AEP]),
    [AEP + '.aep']);

// 6. JPG_PNG writes a ratio token that sits between underscores exactly like a
//    size. Cutting the name at 16x9 would drop the real resolution.
check('ratio token is not the resolution',
    run(['FID_INTL_MultiArt_DOOH_SalitreWheel_16x9_1180x228px_10s_CO'],
        ['FID_INTL_PortalToParadise_DOOH_MULTIART_16x9_1180x228px_10s_CO_V01']),
    ['FID_INTL_PortalToParadise_DOOH_SalitreWheel_16x9_1180x228px_10s_CO_V01.aep']);

// 7. A site name can carry the size shape welded to letters (a grid, a wall).
check('site carrying a grid survives as the site',
    run(['FID_INTL_TVSpot_DOOH_Hoyts3x3_1920x1080px_30s_NZ'],
        ['FID_INTL_PortalToParadise_DOOH_MULTIART_1920x1080px_30s_NZ_V01']),
    ['FID_INTL_PortalToParadise_DOOH_Hoyts3x3_1920x1080px_30s_NZ_V01.aep']);

console.log(fails === 0 ? '\nAll checks passed.' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
