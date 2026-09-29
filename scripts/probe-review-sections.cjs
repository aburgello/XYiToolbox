// =============================================================================
// scripts/probe-review-sections.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// Drives Review Session's reviewFindCounterparts over a stubbed Chile Renders
// tree shaped like the real one: PRE in Batch_02 (with _Old), POST in
// Batch_2_POST. Guards the two pairings the sections are built on:
//   AMEND   -- the nearest lower version, beside the render or in _Old
//   PREPOST -- the POST render's twin with the whole "Post" token removed,
//              in a sibling batch folder whatever that folder is called,
//              version ignored, _DOUBLE_RES/_QUAD_RES required to match
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

const R = '/Volumes/universal/SF_Markets/Chile/Renders/Trio';
const tree = {};
const addFile = (p) => {
    const parts = p.split('/');
    for (let i = 2; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/'), child = parts[i];
        tree[dir] = tree[dir] || [];
        if (tree[dir].indexOf(child) === -1) tree[dir].push(child);
    }
};
const P = 'SF_INTL_Trio_DOOH_';
[
    'Batch_02/' + P + 'GlobalMallPlazaOeste_1248x416px_10s_CL_V01.mov',
    'Batch_02/' + P + 'GlobalAvprovidenciaTobalabaCostanera_672x432px_10s_CL_V02_DOUBLE_RES.mov',
    'Batch_02/_Old/' + P + 'GlobalAvprovidenciaTobalabaCostanera_672x432px_10s_CL_V01_DOUBLE_RES.mov',
    'Batch_02/' + P + 'GlobalDepartamentalMallFloridaCenter_480x300px_10s_CL_V02_QUAD_RES.mov',
    'Batch_02/_Old/' + P + 'GlobalDepartamentalMallFloridaCenter_480x300px_10s_CL_V01_QUAD_RES.mov',
    'Batch_02/' + P + 'MassivaMetroPlazaEganaPendon_960x2000px_10s_CL_V03.mov',
    'Batch_02/' + P + 'MassivaMetroPlazaEganaPendon_960x2000px_10s_CL_V02.mov',
    'Batch_02/' + P + 'MassivaMetroPlazaEganaPendon_960x2000px_10s_CL_V01.mov',
    'Batch_02/' + P + 'GlobalVitacuraNuevaTobalaba_672x432px_10s_CL_V01.mov',
    'Batch_02/_Delivery/' + P + 'GlobalMallPlazaOeste_1248x416px_10s_CL_V09.mov',
    'Batch_2_POST/' + P + 'GlobalMallPlazaOeste_1248x416px_Post_10s_CL_V01.mov',
    'Batch_2_POST/' + P + 'GlobalDepartamentalMallFloridaCenter_480x300px_Post_10s_CL_V01_QUAD_RES.mov',
    'Batch_2_POST/' + P + 'GlobalVitacuraNuevaTobalaba_672x432px_Post_10s_CL_V01_DOUBLE_RES.mov',
    'Batch_2_POST/' + P + 'PostOfficeSquare_1920x1080px_10s_CL_V02.mov',
    'Batch_2_POST/' + P + 'PostOfficeSquare_1920x1080px_10s_CL_V01.mov',
].forEach((f) => addFile(R + '/' + f));

function File(p) { this.fsName = p; this.name = String(p).split('/').pop(); }
Object.defineProperty(File.prototype, 'parent', { get() { const i = this.fsName.lastIndexOf('/'); return new Folder(this.fsName.slice(0, i)); } });
File.prototype.exists = undefined;
Object.defineProperty(File.prototype, 'exists', { get() { throw new Error('File.exists on the NAS'); } });
function Folder(p) { this.fsName = String(p).replace(/\/+$/, ''); this.name = this.fsName.split('/').pop(); }
Object.defineProperty(Folder.prototype, 'parent', { get() { const i = this.fsName.lastIndexOf('/'); return i > 0 ? new Folder(this.fsName.slice(0, i)) : null; } });
Folder.prototype.getFiles = function (mask) {
    if (mask !== undefined) throw new Error('getFiles(mask) on the NAS');
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
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const r of [sandbox.$, sandbox]) for (const k of Object.keys(r)) {
    const v = r[k];
    if (!aeft && v && typeof v === 'object' && typeof v.reviewFindCounterparts === 'function') aeft = v;
}
if (!aeft) { console.error('reviewFindCounterparts not found in the bundle'); process.exit(1); }

let fails = 0;
const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + what + (got !== undefined ? '   ' + got : '')); };
const leaf = (p) => (p ? String(p).split('/').slice(-2).join('/') : '(none)');
const find = (rel) => {
    const r = aeft.reviewFindCounterparts(JSON.stringify([{ name: rel.split('/').pop(), sourcePath: R + '/' + rel }]));
    return r.items[0];
};

let c = find('Batch_02/' + P + 'GlobalAvprovidenciaTobalabaCostanera_672x432px_10s_CL_V02_DOUBLE_RES.mov');
say(/_Old\/.*_V01_DOUBLE_RES\.mov$/.test(c.amendPath || ''), 'V02 finds its V01 in _Old, suffix kept', leaf(c.amendPath));
say(!c.prePath, 'a PRE render has no PRE twin', leaf(c.prePath));

c = find('Batch_02/' + P + 'MassivaMetroPlazaEganaPendon_960x2000px_10s_CL_V03.mov');
say(/_V02\.mov$/.test(c.amendPath || ''), 'V03 takes the NEAREST lower version, V02', leaf(c.amendPath));

c = find('Batch_02/' + P + 'GlobalMallPlazaOeste_1248x416px_10s_CL_V01.mov');
say(!c.amendPath, 'a V01 has nothing to amend against', leaf(c.amendPath));

c = find('Batch_2_POST/' + P + 'GlobalMallPlazaOeste_1248x416px_Post_10s_CL_V01.mov');
say(/Batch_02\/.*PlazaOeste_1248x416px_10s_CL_V01\.mov$/.test(c.prePath || '') && c.preFolder === 'Batch_02',
    'POST finds PRE in Batch_02 beside Batch_2_POST, never in _Delivery', leaf(c.prePath) + ' @ ' + c.preFolder);

c = find('Batch_2_POST/' + P + 'GlobalDepartamentalMallFloridaCenter_480x300px_Post_10s_CL_V01_QUAD_RES.mov');
say(/_V02_QUAD_RES\.mov$/.test(c.prePath || ''), 'version ignored: POST V01 takes the highest PRE, V02', leaf(c.prePath));

c = find('Batch_2_POST/' + P + 'GlobalVitacuraNuevaTobalaba_672x432px_Post_10s_CL_V01_DOUBLE_RES.mov');
say(!c.prePath, 'DOUBLE_RES POST does not pair with a plain PRE', leaf(c.prePath));

c = find('Batch_2_POST/' + P + 'PostOfficeSquare_1920x1080px_10s_CL_V02.mov');
say(!c.prePath && /_V01\.mov$/.test(c.amendPath || ''), 'a site called PostOffice is not a POST render', leaf(c.prePath) + ' / amend ' + leaf(c.amendPath));

say(aeft.reviewIsOwnByProduct('Compare_x_AMEND', null), 'section comps are still Review by-products');

console.log(fails === 0 ? '\nCLEAN — amends and pre/post pair by filename.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
