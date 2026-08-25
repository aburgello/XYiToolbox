// =============================================================================
// scripts/probe-bespoke-rename.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's bespokeSoloCompName -- the name a solo tile's
// imported master comp takes so that the artwork localised into it pairs by
// name.
//
// It exists because this is the SECOND consumer of parseFilenameMeta to want
// the creative and the second to be able to read the wrong field for it: the
// creative sits in `campaign` on current names and in `siteName` on legacy
// _DGTL_ ones, and reading only `campaign` is what broke Campaign Rename for
// twelve days without failing anything. Nothing under src/jsx is type-checked
// and the build path returns success either way.
//
//   yarn build && node scripts/probe-bespoke-rename.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');

const sandbox = {
    Folder: function () { return {}; },
    File: function () { return {}; },
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} }, project: null },
    $: { writeln() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' },
    alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.selectDialog = () => null;
sandbox.File.decode = decodeURI;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('dist/cep/jsx/index.js', 'utf8'), ctx);

let api = null;
for (const root of [sandbox.$, sandbox]) {
    for (const k of Object.keys(root)) {
        const v = root[k];
        if (v && typeof v === 'object' && typeof v.bespokeSoloCompName === 'function') { api = v; break; }
    }
    if (api) break;
}
if (!api) { console.log('EXPORT NOT REACHABLE — globals: ' + Object.keys(sandbox).join(',')); process.exit(1); }

let fails = 0;
function check(label, got, want) {
    const ok = String(got) === String(want);
    if (!ok) fails++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '\n        got  "' + got + '"\n        want "' + want + '"'));
}

const OUT = 'FID_INTL_MultipleArt_DOOH_1920x768px_30s_BR';

// 1 & 2. The build this came from: two 15s masters in a 30s 1920x768 build.
check('current convention, master 1',
    api.bespokeSoloCompName(OUT, 'FID_INTL_PortalToParadise_DOOH_1920x858px_15s_OV'),
    'FID_INTL_PortalToParadise_DOOH_1920x768px_30s_BR');
check('current convention, master 2',
    api.bespokeSoloCompName(OUT, 'FID_INTL_Trio_DOOH_1920x960px_15s_OV'),
    'FID_INTL_Trio_DOOH_1920x768px_30s_BR');

// 3. The whole point: the comp ends up named what the mech already called the
//    artwork, so OV Swap and MC It! can pair them.
check('the result IS the artwork filename core',
    api.bespokeSoloCompName(OUT, 'FID_INTL_PortalToParadise_DOOH_1920x858px_15s_OV') + '2.jpg',
    'FID_INTL_PortalToParadise_DOOH_1920x768px_30s_BR2.jpg');

// 4. Legacy _DGTL_, where the artwork type is the FIRST descriptive token so
//    `campaign` is "" and the creative lives in `siteName`.
check('legacy _DGTL_ derives from siteName',
    api.bespokeSoloCompName('ODY_INTL_DGTL_DOOH_HORSE_1920x858_10sec_OV',
                            'ODY_INTL_DGTL_DOOH_STAG_1920x1080_10sec_OV'),
    'ODY_INTL_DGTL_DOOH_STAG_1920x858_10sec_OV');

// 5. A master whose creative IS the deliverable's would take the build comp's
//    own name.
check('deliverable\'s own creative renames to nothing',
    api.bespokeSoloCompName(OUT, 'FID_INTL_MultipleArt_DOOH_1920x858px_15s_OV'), '');

// 6. A build named by the panel's fallback has no creative to swap.
check('unparseable deliverable name renames nothing',
    api.bespokeSoloCompName('Bespoke_1920x768', 'FID_INTL_Trio_DOOH_1920x960px_15s_OV'), '');
check('unparseable master name renames nothing',
    api.bespokeSoloCompName(OUT, 'some_artists_working_file'), '');

// 7. A site on the master must not travel: the deliverable carries its own.
check('master\'s site does not come along',
    api.bespokeSoloCompName('FID_INTL_MultipleArt_DOOH_1180x228px_10s_CO',
                            'FID_INTL_PortalToParadise_DOOH_1920x858px_15s_OV'),
    'FID_INTL_PortalToParadise_DOOH_1180x228px_10s_CO');

console.log(fails === 0 ? '\nAll checks passed.' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
