// =============================================================================
// scripts/probe-darken.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// Drives generateDarken's POOL over a stubbed comp where the selected layer is
// drawn somewhere its Position value does not say: parented, scaled to 50% and
// moved, with its anchor off its content. The pool used to centre on Position
// and landed a comp-width away (off frame). It must centre on where the layer
// is DRAWN, and leave no probe null or orphaned null source behind.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

function CompItem() {}
function Shape() { this.vertices = []; }
const MaskMode = { ADD: 1 };

// Layer space -> comp space for the CTA: parent at 50%, moved to (1500, 300).
const toComp = (x, y) => [x * 0.5 + 1500, y * 0.5 + 300];

function makeComp() {
    const comp = new CompItem();
    Object.assign(comp, { name: 'C', width: 1920, height: 1080, pixelAspect: 1, duration: 10, time: 0 });
    const layers = [];
    const items = []; // project items created (null sources)
    const reindex = () => layers.forEach((l, i) => { l.index = i + 1; });
    const cta = {
        name: 'CTA',
        // Position says (0,0): nowhere near where it is drawn.
        property: (n) => ({ value: n === 'Scale' ? [100, 100] : [0, 0] }),
        sourceRectAtTime: () => ({ left: 100, top: 200, width: 400, height: 200 }),
    };
    layers.push(cta); reindex();
    comp.selectedLayers = [cta];
    comp.layers = {
        addNull() {
            const source = { usedIn: [], remove() { items.splice(items.indexOf(source), 1); } };
            items.push(source);
            let expr = '';
            const probe = {
                name: 'Null', source,
                transform: { position: {
                    get expression() { return expr; }, set expression(v) { expr = v; },
                    expressionEnabled: true, expressionError: '',
                    valueAtTime() {
                        const m = /layer\((\d+)\)\.toComp\(\[([-\d.]+), ([-\d.]+)/.exec(expr);
                        if (!m || layers[+m[1] - 1] !== cta) return [NaN, NaN];
                        return toComp(+m[2], +m[3]);
                    },
                } },
                remove() { layers.splice(layers.indexOf(probe), 1); reindex(); },
            };
            layers.unshift(probe); reindex();
            return probe;
        },
        addSolid(color, name, w, h) {
            let maskPath = null;
            const mask = { property: (n) => ({ setValue(v) { if (n === 'Mask Path') maskPath = v; } }) };
            const solid = {
                name, w, h,
                property: (n) => n === 'Masks' ? { addProperty: () => mask } : { setValue() {} },
                moveAfter() {}, moveToBeginning() {},
                get maskPath() { return maskPath; },
            };
            layers.unshift(solid); reindex();
            comp.solid = solid;
            return solid;
        },
    };
    comp.layersList = layers;
    comp.items = items;
    return comp;
}

const comp = makeComp();
const sandbox = {
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} },
        project: { activeItem: comp }, beginUndoGroup() {}, endUndoGroup() {} },
    CompItem, Shape, MaskMode, BridgeTalk: { appName: 'aftereffects' }, alert() {},
    $: { writeln() {}, global: null }, File: function () {}, Folder: function () {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error, Infinity,
};
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const root of [sandbox.$, sandbox]) for (const k of Object.keys(root)) {
    const v = root[k];
    if (!aeft && v && typeof v === 'object' && typeof v.generateDarken === 'function') aeft = v;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };

const r = aeft.generateDarken('pool', 60, 100, 33);
check(r && r.success, 'a pool is generated', r);
const v = comp.solid && comp.solid.maskPath && comp.solid.maskPath.vertices;
// Drawn box: corners (100,200)-(500,400) -> comp (1550,400)-(1750,500).
// Centre (1650, 450); the mask is in solid space, offset by pad = 108.
const pad = 108;
const cx = v ? (v[1][0] + v[3][0]) / 2 - pad : NaN;
const cy = v ? (v[0][1] + v[2][1]) / 2 - pad : NaN;
check(Math.abs(cx - 1650) < 0.01 && Math.abs(cy - 450) < 0.01, 'centred on where the layer is DRAWN, not its Position', [cx, cy]);
const rx = v ? (v[1][0] - v[3][0]) / 2 : NaN;
check(Math.abs(rx - (100 + 75 + 40)) < 0.01, 'sized to the drawn width (parent scale included)', rx);
check(comp.layersList.every((l) => l.name !== 'Null'), 'the probe null is removed');
check(comp.items.length === 0, "…and so is its footage item, which a removed null leaves behind");

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — the pool lands on the layer as drawn, and cleans up after itself.');
process.exit(fails ? 1 : 0);
