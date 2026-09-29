// =============================================================================
// scripts/probe-batch-folders.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// Which AE/ folder a localise run writes into. Wrike's "CL POST B1" is batch
// "Batch_1_POST", padded to Batch_01_POST -- but an existing folder spelled
// otherwise (Chile's real "Batch_2_POST", an old unpadded "Batch_2") must be
// REUSED, never shadowed by a second, padded twin.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');
const tree = { '/m/Chile/AE': ['Batch_01', 'Batch_2', 'Batch_2_POST', 'Batch_10', 'notes.txt'] };
function File(p) { this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
function Folder(p) { this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Folder.prototype.getFiles = function () {
    return (tree[this.fsName] || []).map((n) => (/\./.test(n) ? new File(this.fsName + '/' + n) : new Folder(this.fsName + '/' + n)));
};
const sandbox = {
    Folder, File, app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} } },
    $: { writeln() {}, global: null }, BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.File.decode = decodeURI;
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const r of [sandbox.$, sandbox]) for (const k of Object.keys(r)) {
    const v = r[k];
    if (!aeft && v && typeof v === 'object' && typeof v.csvLocExistingBatchFolder === 'function') aeft = v;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }
let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };
const pad = aeft.csvLocPadBatchNumber;
const AE = new Folder('/m/Chile/AE');
const pick = (b) => { const f = aeft.csvLocExistingBatchFolder(AE, pad(b)); return f ? decodeURI(f.name) : null; };

check(pad('Batch_1_POST') === 'Batch_01_POST' && pad('Batch_4') === 'Batch_04' && pad('Batch_12_POST') === 'Batch_12_POST', 'the batch number is padded wherever it sits', [pad('Batch_1_POST'), pad('Batch_4'), pad('Batch_12_POST')]);
check(pick('Batch_2_POST') === 'Batch_2_POST', "Chile's own Batch_2_POST is reused, not shadowed by Batch_02_POST", pick('Batch_2_POST'));
check(pick('Batch_2') === 'Batch_2', 'an old unpadded Batch_2 is reused', pick('Batch_2'));
check(pick('Batch_1') === 'Batch_01', 'Batch_1 finds Batch_01');
check(pick('Batch_1_POST') === null, 'a POST batch is never the PRE folder', pick('Batch_1_POST'));
check(pick('Batch_1') !== 'Batch_10' && pick('Batch_10') === 'Batch_10', 'Batch_1 and Batch_10 never cross');
check(pick('Batch_3') === null, 'nothing matching: a folder will be made', pick('Batch_3'));

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — a run writes into the batch folder that is already there.');
process.exit(fails ? 1 : 0);
