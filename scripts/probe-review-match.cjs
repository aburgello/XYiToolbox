// =============================================================================
// scripts/probe-review-match.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// Drives Review Session's reviewMatchToMaster over a stubbed Forgotten Island
// masters tree. The bug: the matcher tried every filename token as the
// creative, starting with `FID` -- which every master carries -- so the first
// try always matched, the closest aspect won, and a Denmark PortalToParadise
// batch was paired with InternationalPayoff throughout.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

const ROOT = '/Volumes/universal/XY026039_FID_Masters';
const tree = {};
const addFile = (p) => {
    const parts = p.split('/');
    for (let i = 2; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/'), child = parts[i];
        tree[dir] = tree[dir] || [];
        if (tree[dir].indexOf(child) === -1) tree[dir].push(child);
    }
};
const masters = [
    'InternationalPayoff/FID_INTL_InternationalPayoff_DOOH_1920x1080px_10s_OV',
    'InternationalPayoff/FID_INTL_InternationalPayoff_DOOH_1080x1920px_10s_OV',
    'InternationalPayoff/FID_INTL_InternationalPayoff_DOOH_1440x1080px_10s_OV',
    'PortalToParadise/FID_INTL_PortalToParadise_DOOH_1920x1080px_10s_OV',
    'PortalToParadise/FID_INTL_PortalToParadise_DOOH_1080x1920px_10s_OV',
    'PortalToParadise/FID_INTL_PortalToParadise_DOOH_1920x960px_10s_OV',
    'Trio/FID_INTL_Trio_DOOH_1920x1080px_10s_OV',
    'Trio/FID_INTL_Trio_DOOH_1920x1080px_15s_OV',
    'Trio/FID_INTL_Trio_DOOH_1080x1920px_10s_OV',
];
masters.forEach((m) => {
    addFile(ROOT + '/AE/' + m + '.aep');
    addFile(ROOT + '/Renders/' + m + '.mp4');
});

function File(p) { this.fsName = p; this.name = String(p).split('/').pop(); }
function Folder(p) { this.fsName = String(p).replace(/\/+$/, ''); this.name = this.fsName.split('/').pop(); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return Object.prototype.hasOwnProperty.call(tree, this.fsName); } });
Object.defineProperty(Folder.prototype, 'parent', { get() { const i = this.fsName.lastIndexOf('/'); return i > 0 ? new Folder(this.fsName.slice(0, i)) : null; } });
Folder.prototype.getFiles = function () {
    return (tree[this.fsName] || []).map((k) => {
        const q = this.fsName + '/' + k;
        return tree[q] ? new Folder(q) : new File(q);
    });
};
const sandbox = {
    Folder, File,
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} }, project: null },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.File.decode = decodeURI;
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const r of [sandbox.$, sandbox]) for (const k of Object.keys(r)) {
    const v = r[k];
    if (!aeft && v && typeof v === 'object' && typeof v.reviewMatchToMaster === 'function') aeft = v;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };

// Denmark's real batch (the screenshot), as the .movs are named on disk.
const dk = [
    'FID_INTL_PortalToParadise_DOOH_BytorvHorsensHorizontal_1920x1026px_10s_DK_V01',
    'FID_INTL_PortalToParadise_DOOH_BytorvHorsensVertical_1152x2048px_10s_DK_V01',
    'FID_INTL_PortalToParadise_DOOH_HorizontalScreenFormat_1920x1080px_10s_DK_V01',
    'FID_INTL_PortalToParadise_DOOH_NorrebroBycenter_520x520px_10s_DK_V01_DOUBLE_RES',
    'FID_INTL_PortalToParadise_DOOH_TheCrown_1536x768px_10s_DK_V01',
    'FID_INTL_PortalToParadise_DOOH_TheScreenFrbC_1920x1350px_10s_DK_V01',
];
const r = aeft.reviewMatchToMaster(ROOT, JSON.stringify(dk.map((n) => ({ name: n + '.mov', sourcePath: '/Volumes/universal/DK/Renders/Batch_01/' + n + '.mov' }))));
check(r.success, 'it matches', r.error);
const got = (r.items || []).map((i) => (i.masterStem || '').replace(/^fid_intl_/, ''));
check(got.length === dk.length && got.every((s) => /^portaltoparadise_/.test(s)), 'every PortalToParadise deliverable pairs with a PortalToParadise master, never InternationalPayoff', got);
check(/1920x1080/.test(got[2]) && /1080x1920/.test(got[1]), '…and the closest shape within it', [got[1], got[2]]);

// A legacy-named Trio still finds Trio: the creative-first order must not
// break a name the fallback loop used to answer.
const t = aeft.reviewMatchToMaster(ROOT, JSON.stringify([{ name: 'x.mov', sourcePath: '/x/FID_INTL_Trio_DOOH_Somewhere_1920x1080px_10s_NO_V01.mov' }]));
check(t.items && /_trio_/.test(t.items[0].masterStem || ''), 'a Trio deliverable still pairs with Trio', t.items && t.items[0].masterStem);

// A 20s deliverable of a creative whose masters are 10s and 15s (Peru's
// RealPlaza batch): the 10s master, played twice -- not nothing.
const tw = aeft.reviewMatchToMaster(ROOT, JSON.stringify([{ name: 'x.mov', sourcePath: '/x/FID_INTL_Trio_DOOH_RealPlazaSalaverry_1632x1248px_20s_PE_V01.mov' }]));
check(tw.items && /_trio_dooh_1920x1080px_10s_ov$/.test(tw.items[0].masterStem || '') && tw.items[0].repeat === 2, 'a 20s Trio pairs with the 10s master, x2', tw.items && tw.items[0]);
const ex = aeft.reviewMatchToMaster(ROOT, JSON.stringify([{ name: 'x.mov', sourcePath: '/x/FID_INTL_Trio_DOOH_Plaza_1920x1080px_15s_PE_V01.mov' }]));
check(ex.items && /_15s_ov$/.test(ex.items[0].masterStem || '') && !ex.items[0].repeat, 'a length that has a master is never a multiple', ex.items && ex.items[0]);
const odd = aeft.reviewMatchToMaster(ROOT, JSON.stringify([{ name: 'x.mov', sourcePath: '/x/FID_INTL_Trio_DOOH_Plaza_1920x1080px_25s_PE_V01.mov' }]));
check(odd.items && !odd.items[0].masterStem, 'a length no master divides pairs with nothing', odd.items && odd.items[0]);

// A creative no master has: no pairing at all, rather than the film title
// matching everything.
const n = aeft.reviewMatchToMaster(ROOT, JSON.stringify([{ name: 'x.mov', sourcePath: '/x/FID_INTL_Unknowncreative_DOOH_Site_1920x1080px_10s_DK_V01.mov' }]));
check(n.items && !n.items[0].masterStem, 'an unknown creative pairs with nothing, not with whatever FID matched', n.items && n.items[0].masterStem);

// The master renders Compare imported (and AE left selected) are never rows.
const own = (n, p) => aeft.reviewIsOwnByProduct(n, p);
check(own('FID_INTL_PortalToParadise_DOOH_1080x1920px_10s_OV.mp4', ROOT + '/Renders/PortalToParadise/FID_INTL_PortalToParadise_DOOH_1080x1920px_10s_OV.mp4'), 'a master .mp4 is not something to review');
check(own('x', '/x/FID_INTL_Trio_DOOH_1920x1080_15sec_OV1.mov') && own('Compare_FID_INTL_PortalToParadise_DOOH_TheCrown', null), 'nor an _OV1 render, nor a Compare_ comp');
check(!own('FID_INTL_PortalToParadise_DOOH_TheCrown_1536x768px_10s_DK_V01.mov', '/x/FID_INTL_PortalToParadise_DOOH_TheCrown_1536x768px_10s_DK_V01.mov')
    && !own('x', '/x/FID_INTL_PortalToParadise_DOOH_NorrebroBycenter_520x520px_10s_DK_V01_DOUBLE_RES.mov'), 'a localised render (even DOUBLE_RES) is');

// CHANGE MASTER lists every render of the campaign, once per stem.
const mr = aeft.reviewMasterRenders(ROOT);
const mrNames = (mr.renders || []).map((x) => x.name);
check(mr.success && mrNames.length > 0 && mrNames.length === new Set(mrNames.map((x) => x.toLowerCase())).size, 'Change master lists the campaign\'s renders, one per stem', mrNames.length);
check(mrNames.some((x) => /PortalToParadise.*1080x1920/i.test(x)) && mrNames.some((x) => /Trio/i.test(x)), '…every creative\'s, since the point is to pick what the matcher did not');
check(!aeft.reviewMasterRenders('').success, 'and says so with no campaign picked');

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — Review pairs a deliverable with its own creative\'s master.');
process.exit(fails ? 1 : 0);
