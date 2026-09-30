// =============================================================================
// scripts/probe-support-swap-post.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// Support Swap in a POST batch. Norway's Masters/Support/Trio/Date holds each
// date twice -- "SF_Trio_Date_White_NO_RGB.ai" and "…_NO_RGB_POST.ai" -- and
// the one-token rule never offered the _POST one (a second token differs), so
// a POST deliverable's working file always got the PRE date.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

function File(p) { this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
function FootageItem(o) { Object.assign(this, o); }
const DATE = '/Volumes/paramount/SF/Norway/Masters/Support/Trio/Date/';
const TAG = '/Volumes/paramount/SF/Norway/Masters/Support/Trio/MCs_Taglines/';
const cand = (dir, n, cat) => ({ file: new File(dir + n), creative: 'Trio', category: cat });
const CANDS = [
    cand(DATE, 'SF_Trio_Date_White_NO_RGB.ai', 'Date'),
    cand(DATE, 'SF_Trio_Date_White_NO_RGB_POST.ai', 'Date'),
    cand(DATE, 'SF_Trio_Date_Yellow_NO_RGB.ai', 'Date'),
    cand(DATE, 'SF_Trio_Date_Yellow_NO_RGB_POST.ai', 'Date'),
    cand(TAG, 'SF_Trio_Tagline_NO_RGB.ai', 'MCs_Taglines'),   // no POST version
];
function project(names) {
    const items = names.map((n) => {
        const it = new FootageItem({ file: new File('/proj/' + n), parentFolder: { name: 'AI', parentFolder: { name: 'Root', parentFolder: null } } });
        it.replace = (f) => { it.file = f; it.replacedWith = decodeURI(f.name); };
        return it;
    });
    return { numItems: items.length, item: (i) => items[i - 1], _items: items };
}
const sandbox = {
    File, FootageItem, app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} } },
    $: { writeln() {}, sleep() {}, global: null }, BridgeTalk: { appName: 'aftereffects' }, alert() {}, Folder: function () {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const r of [sandbox.$, sandbox]) for (const k of Object.keys(r)) {
    const v = r[k];
    if (!aeft && v && typeof v === 'object' && typeof v.ssApplyToOpenProject === 'function') aeft = v;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }
let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };

console.log('1. Which deliverables are POST');
const P = aeft.ssIsPostDeliverable;
check(P('SF_INTL_Trio_DOOH_NfkinoPOST_345x496px_30s_NO_V01.aep') && P('SF_INTL_Trio_DOOH_OdeonPOST_3840x1152px_30s_NO_V01.aep'), 'a site with POST glued on in capitals');
check(P('SF_INTL_Trio_DOOH_Post_1920x1080px_30s_NO_V01.aep') && P('SF_INTL_Characters_DOOH_Digital MetroPOST_1080x1920px_10s_NO.aep'), 'POST as its own word, or after a space');
check(!P('SF_INTL_Trio_DOOH_Lamppost_1920x1080px_30s_NO_V01.aep') && !P('SF_INTL_Trio_DOOH_Nfkino_345x496px_30s_NO_V01.aep'), 'never a lowercase "post" inside a word, nor a PRE name');

const OVS = ['SF_Trio_Date_White_OV_RGB.ai', 'SF_Trio_Date_Yellow_OV_RGB.ai', 'SF_Trio_Tagline_OV_RGB.ai'];
const run = (aep, names) => { const proj = project(names); const rep = aeft.ssApplyToOpenProject(proj, aep, CANDS, ['Trio'], false); return { rep, got: proj._items.map((i) => i.replacedWith || '-') }; };

console.log('\n2. A PRE deliverable');
let r = run('SF_INTL_Trio_DOOH_Nfkino_345x496px_30s_NO_V01.aep', OVS);
check(r.got.join() === 'SF_Trio_Date_White_NO_RGB.ai,SF_Trio_Date_Yellow_NO_RGB.ai,SF_Trio_Tagline_NO_RGB.ai', 'takes the ordinary dates, never a _POST one', r.got);

console.log('\n3. A POST deliverable');
r = run('SF_INTL_Trio_DOOH_NfkinoPOST_345x496px_30s_NO_V01.aep', OVS);
check(r.got[0] === 'SF_Trio_Date_White_NO_RGB_POST.ai' && r.got[1] === 'SF_Trio_Date_Yellow_NO_RGB_POST.ai', 'OV dates become the POST versions', r.got);
check(r.got[2] === 'SF_Trio_Tagline_NO_RGB.ai', 'a component with no POST version takes the ordinary one', r.got[2]);
check(/POST version/.test(r.rep.items[0].reason || ''), 'and the report says why', r.rep.items[0].reason);

console.log('\n4. A POST working file already swapped to the PRE date');
r = run('SF_INTL_Trio_DOOH_OdeonPOST_3840x1152px_30s_NO_V01.aep', ['SF_Trio_Date_White_NO_RGB.ai', 'SF_Trio_Tagline_NO_RGB.ai']);
check(r.got[0] === 'SF_Trio_Date_White_NO_RGB_POST.ai', 'the PRE date is upgraded to its POST version', r.got);
check(r.got[1] === '-' && /Already the version/.test(r.rep.items[1].reason || ''), 'a tagline with no POST version is left alone', r.rep.items[1]);
r = run('SF_INTL_Trio_DOOH_Nfkino_345x496px_30s_NO_V01.aep', ['SF_Trio_Date_White_NO_RGB.ai']);
check(r.got[0] === '-', 'a PRE deliverable is never "upgraded" to POST', r.got);

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — a POST deliverable gets its POST dates, and nothing else changes.');
process.exit(fails ? 1 : 0);
