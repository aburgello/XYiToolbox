// =============================================================================
// scripts/probe-master-tiers.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's master scorer (pickBestMasterFromIndex) and the
// picker's list (rankMastersFromIndex) over a masters tree shaped like
// Forgotten Island's, where 3DIllusion carries masters named `…_Trio_…`.
//
// The bug this exists for: the scorer matched a creative as a substring
// ANYWHERE in the path, so a Trio row got 3DIllusion's cut. Tiers fix that
// (folder > filename token > anywhere); this holds the fix, holds everything
// that matched before still matching, and holds the picker's first entry to
// the scorer's answer.
//
//   yarn build && node scripts/probe-master-tiers.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

function File(p) { this.fsName = p; this.name = String(p).split('/').pop(); }
function Folder(p) { this.fsName = p; this.name = String(p).split('/').pop(); }
const sandbox = {
    Folder, File,
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} }, project: null },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const root of [sandbox.$, sandbox]) {
    for (const k of Object.keys(root)) {
        const v = root[k];
        if (v && typeof v === 'object' && typeof v.rankMastersFromIndex === 'function') { aeft = v; break; }
    }
    if (aeft) break;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

const ROOT = '/Volumes/newmedia/XY026039_FID_Masters/AE';
// Walk order as buildMastersIndex would produce it: alphabetical, depth-first.
const paths = [
    '3DIllusion/AE/FID_INTL_3DIllusion_DOOH_1080x1920px_15s_OV.aep',
    '3DIllusion/AE/FID_INTL_3DIllusion_DOOH_1920x1080px_15s_OV.aep',
    '3DIllusion/AE/FID_INTL_3DIllusion_DOOH_Trio_1080x1920px_15s_OV.aep',
    '3DIllusion/AE/FID_INTL_3DIllusion_DOOH_Trio_1920x1080px_15s_OV.aep',
    '3DIllusion/AE/FID_INTL_3DIllusion_DOOH_Trio_5760x1440px_15s_OV.aep',
    'PORTAL_TO_PARADISE/FID_INTL_Portal_To_Paradise_DOOH_1920x1080_15sec_OV.aep',
    'TRIO/FID_INTL_Trio_DOOH_1920x1080_15sec_OV.aep',
    'TRIO/FID_INTL_Trio_DOOH_1920x1200_15sec_OV.aep',
    'TRIO/FID_INTL_Trio_DOOH_5760x1920_10sec_OV.aep',
    'Loose/FID_INTL_OddOne_DOOH_1920x1080_15sec_OV.aep',
    'Loose/FID_INTL_XPORTALX_1920x1080_15sec_OV.aep',
].map((p) => ROOT + '/' + p);
const index = paths.map((p) => {
    const m = p.match(/(\d+)x(\d+)/);
    const ratio = Number(m[1]) / Number(m[2]);
    return { file: null, path: p, name: p.split('/').pop(), canonPath: aeft.mastersCanon(p), ratio, orientation: ratio >= 1 ? 'Landscape' : 'Portrait' };
});

let fails = 0;
const tail = (e) => (e ? e.path.slice(ROOT.length + 1) : null);
const check = (label, got, want) => {
    const ok = got === want;
    if (!ok) fails++;
    console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : `\n       got  ${got}\n       want ${want}`));
};
const pick = (c, s, d) => tail(aeft.pickBestMasterFromIndex(index, c, s, d));

// The reported case.
check('Trio 1920x1080 15s takes TRIO\'s own master, not 3DIllusion\'s', pick('TRIO', '1920x1080', '15sec'), 'TRIO/FID_INTL_Trio_DOOH_1920x1080_15sec_OV.aep');
check('...and so does the lower-case creative', pick('Trio', '1920x1080', '15'), 'TRIO/FID_INTL_Trio_DOOH_1920x1080_15sec_OV.aep');
// No TRIO master at this shape: the filename-token tier still answers, which is
// the pre-existing behaviour (and the picker is how to refuse it).
check('Trio portrait 15s: no TRIO master, 3DIllusion _Trio_ still found', pick('Trio', '1080x1920', '15'), '3DIllusion/AE/FID_INTL_3DIllusion_DOOH_Trio_1080x1920px_15s_OV.aep');
// A closer aspect in a lower tier must NOT beat the creative's own folder.
// DECIDED: the creative outranks the aspect. An exact 4:1 cut of ANOTHER
// creative loses to this creative's own nearest-shaped landscape master -- a
// wrong shape is visible in the build, a wrong creative is not.
check('Trio 5760x1440 15s: TRIO\'s own 16:9 beats 3DIllusion\'s exact 4:1', pick('Trio', '5760x1440', '15'), 'TRIO/FID_INTL_Trio_DOOH_1920x1080_15sec_OV.aep');
// KNOWN, unchanged: within one creative's folder, equal aspect ties go to the
// LAST walked (buildMastersIndex's documented order), so the _Trio_ variant
// beats the plain one alphabetically. The picker is the way out today.
check('3DIllusion 1920x1080: same-tier tie still goes to the last walked', pick('3DIllusion', '1920x1080', '15'), '3DIllusion/AE/FID_INTL_3DIllusion_DOOH_Trio_1920x1080px_15s_OV.aep');
// Joined tokens: folder and name both spelled with underscores.
check('PortalToParadise answers to PORTAL_TO_PARADISE', pick('PortalToParadise', '1920x1080', '15'), 'PORTAL_TO_PARADISE/FID_INTL_Portal_To_Paradise_DOOH_1920x1080_15sec_OV.aep');
// Tier 1 floor: a substring-only hit still matches when nothing better exists.
check('Portal: whole-token hit beats the substring-only XPORTALX', pick('Portal', '1920x1080', '15'), 'PORTAL_TO_PARADISE/FID_INTL_Portal_To_Paradise_DOOH_1920x1080_15sec_OV.aep');
check('OddOne (tier 2 only) found', pick('OddOne', '1920x1080', '15'), 'Loose/FID_INTL_OddOne_DOOH_1920x1080_15sec_OV.aep');
check('XPORT substring-only (tier 1) still found', pick('XPORT', '1920x1080', '15'), 'Loose/FID_INTL_XPORTALX_1920x1080_15sec_OV.aep');
check('duration still filters', pick('Trio', '1920x1080', '20'), null);

// Picker list: first entry is the scorer's answer, creative first, others after.
for (const [c, s, d] of [['Trio', '1920x1080', '15'], ['Trio', '1080x1920', '15'], ['PortalToParadise', '1920x1080', '15'], ['XPORT', '1920x1080', '15'], ['OddOne', '1920x1080', '15']]) {
    const ranked = aeft.rankMastersFromIndex(index, c, s, d);
    const first = ranked.length && ranked[0].tier > 0 ? tail(ranked[0].entry) : null;
    check(`rank[0] === pick for ${c} ${s} ${d}`, first, pick(c, s, d));
    let sorted = true;
    for (let i = 1; i < ranked.length; i++) if (ranked[i].tier > ranked[i - 1].tier) sorted = false;
    check(`rank tiers descending for ${c}`, sorted, true);
}
const trioList = aeft.rankMastersFromIndex(index, 'Trio', '1920x1080', '15');
check('picker lists other creatives too (tier 0)', trioList.some((r) => r.tier === 0), true);
check('picker excludes other durations/orientations', trioList.every((r) => /15s/.test(r.entry.path) && r.entry.orientation === 'Landscape'), true);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
