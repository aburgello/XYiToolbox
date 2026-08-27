// =============================================================================
// scripts/probe-reduce-project.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's reduceToSelection() against a stubbed AE project.
//
// STUBBED ON PURPOSE, unlike the geometry probes that drive real AE. Reduce
// DELETES items, and a probe run against whatever the artist has open would be
// the bug it is meant to prevent -- Ctrl+Z is a person's way back, not a
// script's. What is checked here is everything that can be checked without
// deleting anybody's work: that a missing selection refuses rather than
// reducing to nothing, that a selected footage item is not mistaken for a comp,
// that the look-only pass touches nothing, and that the count is measured
// rather than assumed.
//
//   yarn build && node scripts/probe-reduce-project.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

function File(p) { if (!(this instanceof File)) return new File(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
function Folder(p) { if (!(this instanceof Folder)) return new Folder(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return false; } });
Folder.prototype.getFiles = () => [];

// A comp is anything with a numeric numLayers — the duck-type the code uses.
const comp = (name, layers) => ({ name, numLayers: layers === undefined ? 3 : layers });
const footage = (name) => ({ name, file: new File('/x/' + name) });   // NO numLayers

let reduceCalls = [];
function makeProject(items, selection, dirty) {
    return {
        numItems: items.length,
        item: (i) => items[i - 1],
        selection,
        dirty,
        file: new File('/x/proj.aep'),
        reduceProject(keep) {
            reduceCalls.push(keep.map((c) => c.name));
            // Stands in for AE: everything not named by a kept comp goes.
            const keepNames = keep.map((c) => c.name);
            items = items.filter((it) => keepNames.indexOf(it.name) !== -1 || /used/.test(it.name));
            this.numItems = items.length;
        },
    };
}

const sandbox = {
    Folder, File,
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} }, project: null },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.selectDialog = () => null;
sandbox.File.decode = decodeURI;
const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx);

let aeft = null;
for (const root of [sandbox.$, sandbox]) {
    for (const k of Object.keys(root)) {
        const v = root[k];
        if (v && typeof v === 'object' && typeof v.reduceToSelection === 'function') { aeft = v; break; }
    }
    if (aeft) break;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };

console.log('1. it refuses rather than reducing to nothing\n');
sandbox.app.project = makeProject([comp('Main'), footage('logo.ai')], [], false);
reduceCalls = [];
let r = aeft.reduceToSelection(true);
say(!r.success && /Select the comp/.test(r.error || ''), 'nothing selected: refuses, and says what to select', r.error);
say(reduceCalls.length === 0, 'and nothing was reduced');

// A footage item selected is not a comp. Reducing to it would empty the project.
sandbox.app.project = makeProject([comp('Main'), footage('logo.ai')], [footage('logo.ai')], false);
reduceCalls = [];
r = aeft.reduceToSelection(true);
say(!r.success && reduceCalls.length === 0, 'a selected FOOTAGE item is not a comp — still refuses');

console.log('\n2. the look-first pass touches nothing');
const items = [comp('Main'), comp('Other'), footage('used_logo.ai'), footage('stray1.png'), footage('stray2.png')];
sandbox.app.project = makeProject(items, [items[0]], true);
reduceCalls = [];
r = aeft.reduceToSelection(false);
say(r.success && reduceCalls.length === 0, 'reduceProject is never called on the look pass');
say(r.total === 5, 'it reports the project size', String(r.total));
say(JSON.stringify(r.comps) === '["Main"]', 'and which comps would be kept', JSON.stringify(r.comps));
say(r.dirty === undefined, 'it says nothing about unsaved changes — Ctrl+Z is the way back, not Revert');
say(r.removed === undefined, 'it does not claim a removal count it has not earned');

console.log('\n3. the apply pass');
const items2 = [comp('Main'), comp('Other'), footage('used_logo.ai'), footage('stray1.png'), footage('stray2.png')];
sandbox.app.project = makeProject(items2, [items2[0]], false);
reduceCalls = [];
r = aeft.reduceToSelection(true);
say(reduceCalls.length === 1 && JSON.stringify(reduceCalls[0]) === '["Main"]', 'reduceProject gets exactly the selected comps', JSON.stringify(reduceCalls));
say(r.success && r.removed === 3, 'and the count is measured before-and-after, not guessed', String(r.removed));
say(/3 items removed/.test(r.message || ''), 'the message says what happened', r.message);

console.log('\n4. several comps kept at once');
const items3 = [comp('A'), comp('B'), footage('stray.png')];
sandbox.app.project = makeProject(items3, [items3[0], items3[1]], false);
reduceCalls = [];
r = aeft.reduceToSelection(true);
say(JSON.stringify(reduceCalls[0]) === '["A","B"]', 'both are passed through', JSON.stringify(reduceCalls[0]));

console.log('\n5. nothing to do');
const items4 = [comp('Main'), footage('used_logo.ai')];
sandbox.app.project = makeProject(items4, [items4[0]], false);
r = aeft.reduceToSelection(true);
say(r.success && r.removed === 0 && /Nothing to remove/.test(r.message || ''),
    'a project with nothing spare says so rather than "0 items removed"', r.message);

console.log('\n6. the menu command is never used');
say(!/executeCommand\(\s*2735/.test(src), 'command id 2735 (modal Reduce Project) appears nowhere in the bundle');

console.log(fails === 0 ? '\nCLEAN — it refuses when it cannot tell what to keep, and counts what it actually did.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
