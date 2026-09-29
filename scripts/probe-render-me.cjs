// =============================================================================
// scripts/probe-render-me.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// Drives RenderMe! over a stubbed project: one active comp queues that comp;
// two or more comps selected in the Project panel queue every one of them,
// each with its default output in Renders/<Batch> and its MP4 in _mp4; a
// single selected comp still means the ACTIVE comp; footage in the selection
// is ignored.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

const T = '/Volumes/p/SF_Markets/Chile';
const dirs = { [T]: ['AE', 'Renders'], [T + '/AE']: ['Batch_02'], [T + '/Renders']: [] };
function File(p) { this.fsName = p; this.name = String(p).split('/').pop(); this.absoluteURI = p; }
Object.defineProperty(File.prototype, 'parent', { get() { return new Folder(this.fsName.slice(0, this.fsName.lastIndexOf('/'))); } });
function Folder(p) { this.fsName = String(p); this.name = this.fsName.split('/').pop(); this.absoluteURI = this.fsName; }
Object.defineProperty(Folder.prototype, 'parent', { get() { const i = this.fsName.lastIndexOf('/'); return i > 0 ? new Folder(this.fsName.slice(0, i)) : null; } });
Object.defineProperty(Folder.prototype, 'exists', { get() { return Object.prototype.hasOwnProperty.call(dirs, this.fsName); } });
Folder.prototype.create = function () { dirs[this.fsName] = []; return true; };
Folder.prototype.getFiles = function () { return (dirs[this.fsName] || []).map((k) => new Folder(this.fsName + '/' + k)); };

const comp = (name) => ({ name, numLayers: 1, layers: {} });
const queued = [];
function mkItem(c) {
    const oms = [{ file: new File('/old/whatever.mov'), applyTemplate() {} }];
    const it = { comp: c, get numOutputModules() { return oms.length; }, outputModule: (i) => oms[i - 1], _oms: oms };
    queued.push(it);
    return it;
}
let project;
const app = {
    settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} },
    beginUndoGroup() {}, endUndoGroup() {},
    // Add Output Module: AE adds it to the last-added (selected) row.
    executeCommand(id) { if (id === 2154) queued[queued.length - 1]._oms.push({ file: null, applyTemplate() {} }); },
    get project() { return project; },
};
const sandbox = { Folder, File, app, $: { writeln() {}, sleep() {}, global: null }, BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error };
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const r of [sandbox.$, sandbox]) for (const k of Object.keys(r)) { const v = r[k]; if (!aeft && v && typeof v === 'object' && typeof v.renderMe === 'function') aeft = v; }
if (!aeft) { console.error('renderMe not in the bundle'); process.exit(1); }

const setProject = (active, selection) => {
    queued.length = 0;
    project = { file: new File(T + '/AE/Batch_02/SF_Chile_Batch_02.aep'), activeItem: active, selection,
        renderQueue: { showWindow() {}, items: { add: mkItem } } };
};
let fails = 0;
const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + what + (got !== undefined ? '   ' + JSON.stringify(got) : '')); };
const files = () => queued.map((q) => q._oms.map((o) => o.file && o.file.fsName.replace(T + '/Renders/', '')));

const A = comp('SF_A_V01'), B = comp('SF_B_V01'), C = comp('SF_C_V01');
setProject(A, []);
let r = aeft.renderMe();
say(r.success && queued.length === 1 && queued[0].comp === A, 'no selection: the active comp', files());
say(JSON.stringify(files()[0]) === JSON.stringify(['Batch_02/SF_A_V01.mov', 'Batch_02/_mp4/SF_A_V01.mp4']), 'default in the batch folder, MP4 in _mp4, named after the comp', files()[0]);

setProject(A, [B, { name: 'footage.mov', mainSource: {} }, C]);
r = aeft.renderMe();
say(r.success && queued.length === 2 && queued[0].comp === B && queued[1].comp === C, 'two comps selected: both queued, footage ignored, not the active one', files());
say(files().every((f) => f.length === 2 && /_mp4\/.*\.mp4$/.test(f[1])), 'each with its own MP4 output on its own row', files());
say(/^2 comps · /.test(r.message || ''), 'the toast says how many', r.message);

setProject(A, [B]);
r = aeft.renderMe();
say(r.success && queued.length === 1 && queued[0].comp === A, 'ONE selected comp still means the active comp', files());

setProject(null, []);
r = aeft.renderMe();
say(!r.success && queued.length === 0, 'nothing open or selected: refused, nothing queued', r.error);

console.log(fails === 0 ? '\nCLEAN — RenderMe! queues the active comp, or every selected one.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
