// =============================================================================
// scripts/probe-edge-controller.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's edgeControllerApply against a stubbed comp.
//
// Nothing here can tell you an edge LOOKS right -- that needs a rendered frame
// and a pair of eyes. What it can tell you is everything that would fail
// silently in AE: a parameter addressed by a matchName this build does not
// have, an expression pointing at a control that was never created, a rig
// built without the room to spread into, and a camera in the selection taking
// the whole run down instead of being skipped.
//
//   yarn build && node scripts/probe-edge-controller.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

// --- the AE objects the rig touches, as stubs that record what was done -----
const PARAMS = {
    'ADBE Simple Choker': ['ADBE Simple Choker-0001', 'ADBE Simple Choker-0002'],
    'ADBE Channel Blur': [
        'ADBE Channel Blur-0001', 'ADBE Channel Blur-0002', 'ADBE Channel Blur-0003',
        'ADBE Channel Blur-0004', 'ADBE Channel Blur-0007', 'ADBE Channel Blur-0008',
    ],
    'ADBE Fill': ['ADBE Fill-0001', 'ADBE Fill-0002', 'ADBE Fill-0005'],
    'ADBE Slider Control': ['ADBE Slider Control-0001'],
    'ADBE Color Control': ['ADBE Color Control-0001'],
};

function Param(name) {
    this.name = name; this.value = 0; this.expression = ''; this.numKeys = 0;
    this.setValue = (v) => { this.value = v; };
    this.setValueAtTime = (t, v) => { this.value = v; };
}
function Fx(matchName) {
    this.matchName = matchName; this.name = matchName;
    this._params = {};
    (PARAMS[matchName] || []).forEach((mn) => { this._params[mn] = new Param(mn); });
    this.property = (mn) => this._params[mn];
    this.remove = () => {};
}
function Group(children) {
    this._fx = children || [];
    this.canAddProperty = (mn) => !!PARAMS[mn];
    this.addProperty = (mn) => { const f = new Fx(mn); this._fx.push(f); return f; };
    Object.defineProperty(this, 'numProperties', { get: () => this._fx.length });
    this.property = (i) => this._fx[i - 1];
}
function Transform(l) {
    const pos = new Param('ADBE Position'); pos.value = [100, 100];
    const op = new Param('ADBE Opacity'); op.value = 100;
    this.property = (mn) => (mn === 'ADBE Position' ? pos : op);
}
function Layer(name, comp, isAV) {
    this.name = name; this.comp = comp;
    // A layer's index is its POSITION IN THE COMP -- which is the whole reason
    // the rig resolves indices before precomposing. A counter made every
    // lookup miss, and the miss looked like a bug in the rig.
    Object.defineProperty(this, 'index', { get: () => comp._layers.indexOf(this) + 1 });
    this.enabled = true; this.guideLayer = false; this.trackMatteType = null;
    this._parade = new Group([]);
    this._tr = new Transform(this);
    if (isAV !== false) this.sourceRectAtTime = () => ({ width: 10, height: 10 });
    this.property = (mn) => (mn === 'ADBE Effect Parade' ? this._parade : this._tr);
    this.duplicate = () => { const d = new Layer(this.name, comp, true); comp._layers.unshift(d); return d; };
    this.moveAfter = () => {};
}
function Comp(name, w, h) {
    this.name = name; this.width = w; this.height = h; this.time = 0;
    this._layers = [];
    this.layer = (i) => this._layers[i - 1];
    Object.defineProperty(this, 'numLayers', { get: () => this._layers.length });
    this.layers = {
        precompose: (idx, nm) => {
            const inner = new Comp(nm, w, h);
            inner._layers = [new Layer('artwork', inner, true)];
            made.push(inner);
            return inner;
        },
        addNull: () => { const n = new Layer('Null', this, true); this._layers.unshift(n); return n; },
    };
    Object.defineProperty(this, 'selectedLayers', { get: () => this._selected || [] });
}
let made = [];

const sandbox = {
    app: {
        project: { activeItem: null },
        beginUndoGroup: () => {}, endUndoGroup: () => {},
        settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} },
    },
    TrackMatteType: { ALPHA: 'alpha' },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    File: function () {}, Folder: function () {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
vm.runInContext(src, vm.createContext(sandbox));
const A = sandbox.$['com.xyi.toolbox'] || sandbox['com.xyi.toolbox'];
if (!A || typeof A.edgeControllerApply !== 'function') { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };

const OPTS = {
    choke: 2, blur: 3, direction: 0,
    outerSize: 6, outerColour: [0, 1, 1], outerOpacity: 100,
    innerSize: 3, innerFeather: 4, innerColour: [1, 1, 1], innerOpacity: 60,
    useOuter: true, useInner: true,
};

function run(opts, sel) {
    made = [];
    const comp = new Comp('Main', 1920, 1080);
    const art = new Layer('Artwork', comp, true);
    comp._layers = [art];
    comp._selected = sel === undefined ? [art] : sel(comp);
    sandbox.app.project.activeItem = comp;
    const res = A.edgeControllerApply(JSON.stringify(opts));
    return { res, rig: made[0] };
}

console.log('1. the full rig\n');
let { res, rig } = run(OPTS);
say(res.success, 'it builds', res.error || '');
const names = rig ? rig._layers.map((l) => l.name) : [];
say(names.indexOf('EDGE CTRL') !== -1, 'a control null is created', names.join(' · '));
say(names.indexOf('EDGE OUTER') !== -1, 'the halo layer is created');
say(names.indexOf('EDGE INNER') !== -1, 'the inner tint layer is created');

const ctrl = rig && rig._layers.filter((l) => l.name === 'EDGE CTRL')[0];
const ctrlNames = ctrl ? ctrl._parade._fx.map((f) => f.name) : [];
say(ctrlNames.indexOf('Dilate / Erode') !== -1 && ctrlNames.indexOf('Edge Blur') !== -1,
    'the everyday controls are on it', ctrlNames.join(' · '));

// EVERY EXPRESSION MUST POINT AT A CONTROL THAT EXISTS. This is the failure
// that shows up in AE as a yellow warning triangle and a dead slider.
const exprs = [];
(rig ? rig._layers : []).forEach((l) => {
    l._parade._fx.forEach((f) => Object.keys(f._params).forEach((k) => {
        if (f._params[k].expression) exprs.push(f._params[k].expression);
    }));
    ['ADBE Opacity'].forEach((mn) => {
        const p = l.property('x').property(mn);
        if (p && p.expression) exprs.push(p.expression);
    });
});
say(exprs.length >= 6, exprs.length + ' expressions written');
const referenced = [];
exprs.forEach((e) => {
    const m = e.match(/effect\("([^"]+)"\)/g) || [];
    m.forEach((x) => { const n = x.slice(8, -2); if (referenced.indexOf(n) === -1) referenced.push(n); });
});
const missing = referenced.filter((n) => ctrlNames.indexOf(n) === -1);
say(missing.length === 0, 'and every one points at a control that exists', missing.join(', '));

console.log('\n2. room to spread');
say(rig && rig.width > 1920 && rig.height > 1080,
    'the precomp is grown so the halo is not clipped', rig ? rig.width + 'x' + rig.height : '');
const artLayer = rig && rig._layers.filter((l) => l.name === 'artwork')[0];
const moved = artLayer && artLayer.property('x').property('ADBE Position').value;
say(moved && moved[0] !== 100, 'and the artwork moves with the walls', JSON.stringify(moved));

console.log('\n3. the everyday case is lighter');
const plain = run({ ...OPTS, useOuter: false, useInner: false });
const plainNames = plain.rig ? plain.rig._layers.map((l) => l.name) : [];
say(plainNames.indexOf('EDGE OUTER') === -1 && plainNames.indexOf('EDGE INNER') === -1,
    'no halo and no tint layers when both are off', plainNames.join(' · '));
say(plain.res.success, 'and it still builds', plain.res.error || '');

console.log('\n4. what cannot be rigged is skipped, not fatal');
const mixed = run(OPTS, (comp) => {
    const cam = new Layer('Camera 1', comp, false);   // no sourceRectAtTime
    comp._layers.push(cam);
    return [comp._layers[0], cam];
});
say(mixed.res.success, 'a camera in the selection does not fail the run', mixed.res.error || '');
say((mixed.res.skipped || []).join(' ').indexOf('Camera 1') !== -1,
    'and it is named in the report', JSON.stringify(mixed.res.skipped));

const onlyCam = run(OPTS, (comp) => {
    const cam = new Layer('Camera 1', comp, false);
    comp._layers.push(cam);
    return [cam];
});
say(!onlyCam.res.success, 'a selection with nothing riggable refuses', onlyCam.res.error);

console.log('\n5. a matchName this AE does not have is REPORTED');
// The AE 26.3 "Scale" -> "Scale Height" trap, in miniature: drop the parameter
// the rig depends on and the run must say so rather than half-applying.
const keep = PARAMS['ADBE Channel Blur'];
PARAMS['ADBE Channel Blur'] = keep.filter((p) => p !== 'ADBE Channel Blur-0004');
const broken = run(OPTS);
PARAMS['ADBE Channel Blur'] = keep;
say(!broken.res.success, 'it fails loudly', broken.res.error);
say(/Alpha Blurriness/.test(broken.res.error || ''), 'naming the parameter it could not find');

console.log(fails === 0 ? '\nCLEAN — the rig builds, and every slider it writes is one it made.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
