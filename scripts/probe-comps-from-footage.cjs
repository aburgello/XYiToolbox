// =============================================================================
// scripts/probe-comps-from-footage.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// Make Comp from Elements over a stubbed project. The script it replaced never
// found (or made) its "Comps" folder, because it compared AE objects with ===
// -- AE hands back a fresh wrapper on every access, so here every access does
// too. Also: footage by duck-type (not the translated typeName), decoded
// names, a movie cut to the comp, a still filling it, bad values refused.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

let items = [];
let nextId = 1;
// EVERY access returns a new wrapper, like AE: identity comparison is useless.
const wrap = (o) => new Proxy(o, {});
const rootRaw = { name: 'Root', numItems: 0 };
rootRaw.parentFolder = null;
const project = {
    get rootFolder() { return wrap(rootRaw); },
    get numItems() { return items.length; },
    item: (i) => wrap(items[i - 1]),
    selection: [],
    items: {
        addFolder(name) { const f = { id: nextId++, name, numItems: 0, parentFolder: wrap(rootRaw) }; items.push(f); return wrap(f); },
        addComp(name, w, h, par, dur, fps) {
            const layers = [];
            const c = { id: nextId++, name, width: w, height: h, pixelAspect: par, duration: dur, frameRate: fps, numLayers: 0, parentFolder: wrap(rootRaw),
                layers: { add(src) { const l = { source: src, outPoint: src.duration > 0 ? src.duration : dur }; layers.push(l); c.numLayers = layers.length; return l; } }, _layers: layers };
            items.push(c);
            return c;
        },
    },
};
const footage = (name, w, h, dur) => { const f = { id: nextId++, name, width: w, height: h, pixelAspect: 1, duration: dur, mainSource: {}, typeName: 'Metraggio', parentFolder: wrap(rootRaw) }; items.push(f); return f; };
const sandbox = {
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} }, project, beginUndoGroup() {}, endUndoGroup() {} },
    $: { writeln() {}, global: null }, BridgeTalk: { appName: 'aftereffects' }, alert() {}, File: function () {}, Folder: function () {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const r of [sandbox.$, sandbox]) for (const k of Object.keys(r)) {
    const v = r[k];
    if (!aeft && v && typeof v === 'object' && typeof v.makeCompsFromFootage === 'function') aeft = v;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }
let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };

const existing = { id: nextId++, name: 'Comps', numItems: 0, parentFolder: wrap(rootRaw) };
items.push(existing);
const mov = footage('SF_INTL_Trio_BioRexSeina%CC%88joki_1920x1080px_15s_FI.mov', 1920, 1080, 15);
const still = footage('Poster_1080x1920.png', 1080, 1920, 0);
const aComp = { id: nextId++, name: 'SomeComp', width: 100, height: 100, numLayers: 3, parentFolder: wrap(rootRaw) };
items.push(aComp);
project.selection = [wrap(mov), wrap(still), wrap(aComp)];

const sel = aeft.compsFromFootageSelection();
check(sel.success && sel.count === 2 && sel.ignored === 1, 'the picker sees 2 footage items and 1 not (a comp)', sel);
check(sel.sizes.join() === '1920x1080,1080x1920', '…and their sizes', sel.sizes);

const before = items.length;
const r = aeft.makeCompsFromFootage(23.976, 10, 'Comps');
check(r.success && r.made === 2, 'two comps made (footage found without typeName, which is translated)', r);
const comps = items.slice(before).filter((x) => x._layers);
check(items.filter((x) => x.name === 'Comps').length === 1, 'the EXISTING root "Comps" folder is reused, not a second made');
check(comps.every((c) => c.parentFolder.id === existing.id), '…and the comps are in it', comps.map((c) => c.parentFolder && c.parentFolder.name));
check(comps[0].name.normalize('NFC') === 'SF_INTL_Trio_BioRexSeinäjoki_1920x1080px_15s_FI'.normalize('NFC') && comps[0].name.indexOf('%') === -1, 'named after the file, decoded, no extension', comps[0].name);
check(comps[0].frameRate === 23.976 && comps[0].duration === 10, 'at the chosen frame rate and length', [comps[0].frameRate, comps[0].duration]);
check(comps[0]._layers[0].outPoint === 10, 'a 15s movie is cut to the 10s comp');
check(comps[1].width === 1080 && comps[1].height === 1920 && comps[1]._layers[0].outPoint === 10, "a still fills the comp at its own size");
check(/2 comps at 23\.976fps, 10s, in "Comps"/.test(r.message), 'the message says what was made', r.message);

const n = items.length;
const r2 = aeft.makeCompsFromFootage(25, 5, 'New Folder/../x');
const madeFolder = items.slice(n).find((x) => typeof x.numItems === 'number');
check(r2.success && madeFolder && madeFolder.name === 'New Folder .. x', 'a new folder is made when none matches, its name made safe', madeFolder && madeFolder.name);
const r3 = aeft.makeCompsFromFootage(25, 5, '');
check(r3.success && items.slice(-2).every((x) => x.parentFolder.name === 'Root'), 'no folder name: comps at the root');
check(!aeft.makeCompsFromFootage(0, 10, 'Comps').success && !aeft.makeCompsFromFootage(25, 0, 'Comps').success, 'a 0fps or 0s request is refused');
project.selection = [wrap(aComp)];
check(!aeft.makeCompsFromFootage(25, 10, 'Comps').success, 'no footage selected: refused, nothing made');

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — one comp per footage item, filed where it should be.');
process.exit(fails ? 1 : 0);
