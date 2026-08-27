// =============================================================================
// scripts/probe-workflow-variants.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's workflowKeyFor and workflowSaveEntry over the
// shared team file, checking the one property that makes multiple workflows
// per creative safe to ship: an UNNAMED workflow keys exactly as it did
// before, so every board already on the share — and every artist's local tick
// state, which is stored per key — still matches.
//
// The merge in workflowSaveEntry is by KEY, not id, so that two people each
// creating "Trio" converge instead of shadowing each other forever. That
// guarantee has to survive naming, and it is invisible to both tsconfigs.
//
//   yarn build && node scripts/probe-workflow-variants.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

let disk = {};        // fsName -> string contents
let settings = {};
const parentOf = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : null; };

function File(p) {
    if (!(this instanceof File)) return new File(p);
    this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); this.encoding = '';
    this._buf = '';
    this.open = (mode) => { this._mode = mode; this._buf = mode === 'r' ? (disk[p] || '') : ''; return true; };
    this.read = () => this._buf;
    this.write = (t) => { this._buf += t; return true; };
    this.close = () => { if (this._mode !== 'r') disk[p] = this._buf; return true; };
    this.remove = () => { delete disk[p]; return true; };
}
Object.defineProperty(File.prototype, 'exists', { get() { return Object.prototype.hasOwnProperty.call(disk, this.fsName); } });
Object.defineProperty(File.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
function Folder(p) { if (!(this instanceof Folder)) return new Folder(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return true; } });
Object.defineProperty(Folder.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
Folder.prototype.create = () => true;
Folder.prototype.getFiles = function () {
    const pre = this.fsName + '/';
    return Object.keys(disk).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map((k) => new File(k));
};

const TEAM = '/Volumes/newmedia/Team_Folder';
const sandbox = {
    Folder, File,
    app: { settings: {
        haveSetting: (s, k) => settings[s + '|' + k] !== undefined,
        getSetting: (s, k) => settings[s + '|' + k],
        saveSetting: (s, k, v) => { settings[s + '|' + k] = v; },
    }, project: null },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.userData = new Folder('/userdata');
sandbox.Folder.selectDialog = () => null;
sandbox.File.decode = decodeURI;
const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx);

let aeft = null;
for (const root of [sandbox.$, sandbox]) {
    for (const k of Object.keys(root)) {
        const v = root[k];
        if (v && typeof v === 'object' && typeof v.workflowKeyFor === 'function') { aeft = v; break; }
    }
    if (aeft) break;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };

console.log('1. an unnamed workflow keys exactly as it always did\n');
const K = aeft.workflowKeyFor;
say(K('Forgotten Island', 'Trio') === 'FORGOTTENISLAND|TRIO', 'two segments, no trailing separator', K('Forgotten Island', 'Trio'));
say(K('Forgotten Island', 'Trio', '') === K('Forgotten Island', 'Trio'), 'an empty name is the same key as no name at all');
say(K('Forgotten Island', 'Trio', undefined) === K('Forgotten Island', 'Trio'), '…and so is undefined');
say(K('Forgotten Island', 'Trio', '   ') === K('Forgotten Island', 'Trio'), '…and so is whitespace, which canon strips');

console.log('\n2. a named one is its own board');
say(K('Forgotten Island', 'Trio', 'Delivery') === 'FORGOTTENISLAND|TRIO|DELIVERY', 'three segments', K('Forgotten Island', 'Trio', 'Delivery'));
say(K('Forgotten Island', 'Trio', 'delivery') === K('Forgotten Island', 'Trio', 'DELIVERY'), 'case-insensitive, so Delivery and delivery are one board');
say(K('Forgotten Island', 'Trio', 'Re-touch') === K('Forgotten Island', 'Trio', 'RETOUCH'), 'punctuation ignored, same as campaign and creative');
say(K('Forgotten Island', 'Trio', 'Delivery') !== K('Forgotten Island', 'Trio'), 'and it never collides with the unnamed one');

console.log('\n3. the convergence guarantee still holds where it did');
settings['XYiToolbox|TeamFolderPath'] = TEAM;
settings['XYiToolbox|TeamMachineOwner'] = 'Antonio';
const save = (campaign, creative, name, steps) =>
    aeft.workflowSaveEntry(JSON.stringify({ id: '', campaign, creative, name, key: '', steps: steps.map((t, i) => ({ id: 's' + i, text: t })), notes: [], author: '', updatedAt: '' }));

let r = save('Forgotten Island', 'Trio', undefined, ['Anna\'s step']);
r = save('Forgotten Island', 'Trio', undefined, ['Ben\'s step']);
let all = (r.entries || []).filter((e) => e.creative === 'Trio');
say(all.length === 1, 'two people creating an unnamed "Trio" still converge to ONE board (' + all.length + ')');

r = save('Forgotten Island', 'Trio', 'Delivery', ['Deliver it']);
all = (r.entries || []).filter((e) => e.creative === 'Trio');
say(all.length === 2, 'naming one makes a second board on purpose (' + all.length + ')');
say(all.filter((e) => !e.name).length === 1 && all.filter((e) => e.name === 'DELIVERY').length === 1,
    'one unnamed, one DELIVERY — upper-cased host-side so it cannot depend on the panel');

r = save('Forgotten Island', 'Trio', 'delivery', ['Deliver it again']);
all = (r.entries || []).filter((e) => e.creative === 'Trio');
say(all.length === 2, 'the same name in another case merges rather than forking (' + all.length + ')');

r = save('Forgotten Island', 'Bracelet', 'Delivery', ['Other creative']);
all = (r.entries || []).filter((e) => e.name === 'DELIVERY');
say(all.length === 2, 'the same NAME under two creatives is two boards, not one (' + all.length + ')');

console.log('\n4. an entry written before names existed');
// Exactly what is on the share today: no `name` field at all.
const legacy = [{ id: 'wf-old', campaign: 'Forgotten Island', creative: 'Portal', key: 'FORGOTTENISLAND|PORTAL', steps: [{ id: 's', text: 'old' }], notes: [], author: 'Sam', updatedAt: 'then' }];
const wfFile = Object.keys(disk).filter((k) => k.indexOf('workflow') !== -1)[0];
disk[wfFile] = JSON.stringify({ type: 'xyi-shared-workflows', entries: legacy });
const board = aeft.workflowBoardLoad();
const old = (board.entries || []).filter((e) => e.id === 'wf-old')[0];
say(!!old && old.key === 'FORGOTTENISLAND|PORTAL', 'loads with its key unchanged — no migration, and its tick state still matches', old && old.key);
const r2 = save('Forgotten Island', 'Portal', undefined, ['edited']);
say((r2.entries || []).filter((e) => e.creative === 'Portal').length === 1, 'and saving over it edits that board rather than making a second');

console.log(fails === 0 ? '\nCLEAN — naming adds boards without moving the ones that exist.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
