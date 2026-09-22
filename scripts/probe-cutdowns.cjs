// =============================================================================
// scripts/probe-cutdowns.cjs
// -----------------------------------------------------------------------------
// Cut-downs are deliverables somebody has declared masters -- Australia's 7s
// becoming Peru's. The registry decides what a localise run is offered when
// the masters tree has nothing at a length, so its failure mode is a build
// from the wrong file.
//
//   yarn build && node scripts/probe-cutdowns.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

let tree = {};
let written = {};
const parentOf = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : null; };
function File(p) {
    if (!(this instanceof File)) return new File(p);
    this.fsName = p; this.name = String(p).split('/').pop(); this.encoding = ''; this._buf = '';
    this.open = () => { this._buf = ''; return true; };
    this.write = (t) => { this._buf += t; return true; };
    this.read = () => written[p] || '';
    this.close = () => { if (this._buf) written[p] = this._buf; return true; };
}
Object.defineProperty(File.prototype, 'exists', { get() { return Object.prototype.hasOwnProperty.call(written, this.fsName); } });
Object.defineProperty(File.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
function Folder(p) {
    if (!(this instanceof Folder)) return new Folder(p);
    this.fsName = String(p).length > 1 ? String(p).replace(/\/+$/, '') : p;
    this.name = this.fsName.split('/').pop();
}
Object.defineProperty(Folder.prototype, 'exists', { get() { return Object.prototype.hasOwnProperty.call(tree, this.fsName); } });
Folder.prototype.create = function () { tree[this.fsName] = tree[this.fsName] || []; return true; };
Folder.prototype.getFiles = function () {
    return (tree[this.fsName] || []).map((k) => {
        const q = this.fsName + '/' + k;
        return tree[q] ? new Folder(q) : new File(q);
    });
};

// TeamFolderPath is the key team.ts reads; the folder has to exist, since
// teamFolder() returns null for one that does not.
const settings = { TeamMachineOwner: 'Antonio', TeamFolderPath: '/team' };
tree['/team'] = [];
const sandbox = {
    Folder, File,
    app: {
        project: { activeItem: null, numItems: 0, item: () => null },
        settings: {
            haveSetting: (sec, k) => Object.prototype.hasOwnProperty.call(settings, k),
            getSetting: (sec, k) => settings[k] || '',
            saveSetting: (sec, k, v) => { settings[k] = v; },
        },
    },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.userData = new Folder('/userdata');
vm.runInContext(src, vm.createContext(sandbox));
const A = sandbox.$['com.xyi.toolbox'] || sandbox['com.xyi.toolbox'];
if (!A || typeof A.cutdownsScanFolder !== 'function') { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };

// Peru's batch: the 7s somebody built, a 15s that is an ordinary deliverable,
// another creative's file, and an auto-save nobody should see.
const B = '/Markets/Peru/AE/Batch_01';
tree[B] = [
    'FID_INTL_Trio_DOOH_1080x1920px_7s_PE_V01.aep',
    'FID_INTL_Trio_DOOH_1080x1920px_15s_PE_V01.aep',
    'FID_INTL_Bracelet_DOOH_1080x1920px_7s_PE_V01.aep',
    'Adobe After Effects Auto-Save',
    'ARTWORK',
];
tree[B + '/Adobe After Effects Auto-Save'] = ['FID_INTL_Trio_DOOH_1080x1920px_7s_PE_V01.aep'];
tree[B + '/ARTWORK'] = ['FID_INTL_Trio_DOOH_1080x1920px_9s_PE_V01.aep'];

console.log('1. scanning a batch folder\n');
let scan = A.cutdownsScanFolder(B, 'Forgotten Island', 'Trio');
const names = (scan.found || []).map((c) => c.name);
say(scan.success, 'it reads the folder', scan.error || '');
say(names.indexOf('FID_INTL_Trio_DOOH_1080x1920px_7s_PE_V01.aep') !== -1, 'finds the creative\'s files', names.join(' · '));
say(names.indexOf('FID_INTL_Bracelet_DOOH_1080x1920px_7s_PE_V01.aep') === -1, 'and not another creative\'s');
say(names.filter((n) => /7s_PE_V01\.aep/.test(n)).length === 1, 'the Auto-Save copy is not a second answer');
say(names.indexOf('FID_INTL_Trio_DOOH_1080x1920px_9s_PE_V01.aep') !== -1, 'a deliverable one level down is found too');
const seven = (scan.found || []).filter((c) => c.duration === '7')[0];
say(seven && seven.territory === 'PE' && seven.size === '1080x1920',
    'each carries the length, size and market its name gives', seven && [seven.duration, seven.size, seven.territory].join(' · '));

console.log('\n2. registering, and being offered back');
let reg = A.cutdownsAdd(JSON.stringify(scan.found));
say(reg.success, 'registered', reg.error || '');
let hit = A.cutdownsFor('', 'Trio', '1080x1920', '7sec');
say((hit.entries || []).length === 1, 'a 7s row is offered exactly one', JSON.stringify((hit.entries || []).map((c) => c.name)));
say((A.cutdownsFor('', 'Trio', '1080x1920', '30sec').entries || []).length === 0, 'a 30s row is offered none');
say((A.cutdownsFor('', 'Bracelet', '1080x1920', '7sec').entries || []).length === 0, 'and another creative is offered none');

console.log('\n3. registering twice is not two answers');
A.cutdownsAdd(JSON.stringify(scan.found));
hit = A.cutdownsFor('', 'Trio', '1080x1920', '7sec');
say((hit.entries || []).length === 1, 'the same length replaces rather than duplicates', String((hit.entries || []).length));

console.log('\n4. removing one');
const id = (hit.entries || [])[0].id;
say(A.cutdownsRemove(id).success, 'it goes');
say((A.cutdownsFor('', 'Trio', '1080x1920', '7sec').entries || []).length === 0, 'and stops being offered');

console.log(fails === 0 ? '\nCLEAN — only what somebody registered, and only where the tree is silent.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
