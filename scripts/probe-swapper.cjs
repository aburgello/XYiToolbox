// =============================================================================
// scripts/probe-swapper.cjs
// -----------------------------------------------------------------------------
// Swapper replaces a layer's source and re-matches its width. It used to
// compute ONE factor from the width and write it to both axes, so a layer
// deliberately squashed to [100, 90] came back [400, 400] instead of
// [400, 360] -- artwork quietly changing shape, reported from the floor.
//
//   yarn build && node scripts/probe-swapper.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

function Prop(value) {
    this.value = value; this.numKeys = 0;
    this.setValue = (v) => { this.value = v; };
    this.setValueAtTime = (t, v) => { this.value = v; this.keyedAt = t; };
}
function Layer(w, h, scale, anchor, pos) {
    this.width = w; this.height = h;
    this.scale = new Prop(scale);
    this.anchorPoint = new Prop(anchor);
    this.position = new Prop(pos);
    this.replaced = null;
    this.replaceSource = (item) => {
        this.replaced = item;
        // AE re-reports the layer's own size as the new source's.
        this.width = item.width; this.height = item.height;
    };
}
function CompItem(w, h) { this.width = w; this.height = h; this.time = 2; this.selectedLayers = []; }
function AVItem(w, h) { this.width = w; this.height = h; }

const sandbox = {
    CompItem, AVItem,
    app: {
        project: { activeItem: null, selection: [] },
        beginUndoGroup: () => {}, endUndoGroup: () => {},
        settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} },
    },
    Folder: function () {}, File: function () {},
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
vm.runInContext(src, vm.createContext(sandbox));
const A = sandbox.$['com.xyi.toolbox'] || sandbox['com.xyi.toolbox'];
if (!A || typeof A.swapper !== 'function') { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };
const round = (a) => a.map((n) => Math.round(n * 1000) / 1000);

function swap(layerScale, oldSize, newSize, prep) {
    const comp = new CompItem(1920, 1080);
    const layer = new Layer(oldSize[0], oldSize[1], layerScale, [oldSize[0] / 2, oldSize[1] / 2], [960, 540]);
    if (prep) prep(layer);
    comp.selectedLayers = [layer];
    const asset = new AVItem(newSize[0], newSize[1]);
    sandbox.app.project.activeItem = comp;
    sandbox.app.project.selection = [asset];
    const res = A.swapper();
    return { res, layer };
}

console.log('1. the reported case: a squashed layer keeps its squash\n');
// 1000px wide at 100% -> a 250px source has to reach 400% to match the width.
let { res, layer } = swap([100, 90], [1000, 1000], [250, 250]);
say(res.success, 'it swaps', res.error || '');
say(JSON.stringify(round(layer.scale.value)) === JSON.stringify([400, 360]),
    'scale is [400, 360], not [400, 400]', JSON.stringify(round(layer.scale.value)));

console.log('\n2. an ordinary uniform layer is untouched by the change');
({ layer } = swap([100, 100], [1000, 1000], [250, 250]));
say(JSON.stringify(round(layer.scale.value)) === JSON.stringify([400, 400]), 'still uniform', JSON.stringify(round(layer.scale.value)));
({ layer } = swap([50, 50], [800, 600], [400, 300]));
say(JSON.stringify(round(layer.scale.value)) === JSON.stringify([100, 100]), 'and matches the width', JSON.stringify(round(layer.scale.value)));

console.log('\n3. a mirrored layer keeps its flip');
({ layer } = swap([-100, 100], [1000, 1000], [250, 250]));
const mirrored = round(layer.scale.value);
say(mirrored[0] === -400 && mirrored[1] === 400, 'x stays negative, y stays positive', JSON.stringify(mirrored));

console.log('\n4. a zero-width layer writes numbers, not NaN');
({ layer } = swap([0, 90], [1000, 1000], [250, 250]));
const zeroed = layer.scale.value;
say(!isNaN(zeroed[0]) && !isNaN(zeroed[1]), 'no NaN in the scale', JSON.stringify(zeroed));

console.log('\n5. an animated scale gets a key instead of throwing');
({ res, layer } = swap([100, 90], [1000, 1000], [250, 250], (l) => { l.scale.numKeys = 3; }));
say(res.success, 'it still swaps', res.error || '');
say(layer.scale.keyedAt === 2, 'the value lands at the playhead', String(layer.scale.keyedAt));
say(JSON.stringify(round(layer.scale.value)) === JSON.stringify([400, 360]), 'with the ratio kept', JSON.stringify(round(layer.scale.value)));

console.log('\n6. the anchor follows the new source');
({ layer } = swap([100, 100], [1000, 500], [250, 125]));
say(JSON.stringify(layer.anchorPoint.value) === JSON.stringify([125, 62.5]),
    'anchor keeps its ratio into the new size', JSON.stringify(layer.anchorPoint.value));

console.log(fails === 0 ? '\nCLEAN — width drives the size, the ratio survives.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
