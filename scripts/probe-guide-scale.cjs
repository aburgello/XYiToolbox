// =============================================================================
// scripts/probe-guide-scale.cjs
// -----------------------------------------------------------------------------
// Guide Scale reads the active comp's ruler guides. Until AE 26.5 a guide's
// `orientationType` was a plain 0/1 and its position was always pixels; 26.5
// made it a GuideOrientationType constant, added percentage positions and
// pinning. The tool compared against the literals, so on 26.5 every guide fell
// through and it answered "No ruler guides" about a comp showing four.
//
// The stub's 26.5 enum numbers are INVENTED on purpose (they are not 0/1):
// the point is that nothing may depend on what they happen to be.
//
//   yarn build && node scripts/probe-guide-scale.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

function Prop(value) {
    this.value = value; this.numKeys = 0; this.writes = 0;
    this.setValue = (v) => { this.value = v; this.writes++; };
}
function AVLayer(name, source) {
    this.name = name; this.source = source; this.matchName = 'ADBE AV Layer'; this.parent = null;
    this.anchor = new Prop([960, 540, 0]);
    this.pos = new Prop([960, 540, 0]);
    this.transform = { scale: new Prop([50, 50, 100]) };
    this.scale = this.transform.scale;
    this.position = this.pos;
    this.property = (n) => (n === 'Anchor Point' ? this.anchor : n === 'Position' ? this.pos : n === 'Scale' ? this.transform.scale : null);
    this.remove = () => {};
}
function CompItem(name, w, h) {
    this.name = name; this.width = w; this.height = h; this.id = ++CompItem.n;
    this.guides = []; this.selectedLayers = []; this.parentFolder = null;
    const layers = [];
    this.numLayers = 0;
    this.layer = (i) => layers[i - 1];
    this.layers = {
        addNull: () => {
            const nl = new AVLayer('Null', { usedIn: [], remove() {} });
            nl.remove = () => { layers.splice(layers.indexOf(nl), 1); this.numLayers = layers.length; };
            layers.unshift(nl); this.numLayers = layers.length;
            return nl;
        },
    };
}
CompItem.n = 0;

let project = [];
const sandbox = {
    CompItem, AVLayer,
    app: {
        version: '26.5x89',
        project: { activeItem: null, selection: [], get numItems() { return project.length; }, item: (i) => project[i - 1] },
        beginUndoGroup: () => {}, endUndoGroup: () => {},
        settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} },
    },
    Folder: function () {}, File: function () {},
    $: { writeln() {}, sleep() {}, global: {} },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
vm.runInContext(src, vm.createContext(sandbox));
const A = sandbox.$['com.xyi.toolbox'] || sandbox['com.xyi.toolbox'];
if (!A || typeof A.guideScale !== 'function') { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };

const ENUM_265 = { GuideOrientationType: { HORIZONTAL: 9612, VERTICAL: 9613 }, GuidePositionType: { PIXEL: 9712, PERCENTAGE: 9713 } };

// A 3840x1080 deliverable holding one precomp layer at 50%.
function run(guides, host, prep) {
    sandbox.$.global = host || {};
    const edit = new CompItem('Edit', 1920, 1080);
    const comp = new CompItem('SF_INTL_Trio_DINTH_VivacityMainFoyerLED_3840x1080px_30s_MY', 3840, 1080);
    const layer = new AVLayer('Edit', edit);
    comp.guides = guides; comp.selectedLayers = [layer];
    const other = new CompItem('Landscape_Frontcard', 1920, 1080);
    other.guides = [{ orientationType: 0, positionType: 0, position: 10 }];
    project = [comp, edit, other];
    sandbox.app.project.activeItem = comp;
    if (prep) prep(layer);
    return { res: A.guideScale(), layer, edit };
}
const size = (c) => c.width + 'x' + c.height;

console.log('1. AE up to 26.2: plain 0/1, pixels\n');
let r = run([
    { orientationType: 1, positionType: 0, position: 960 }, { orientationType: 1, positionType: 0, position: 2880 },
    { orientationType: 0, positionType: 0, position: 0 }, { orientationType: 0, positionType: 0, position: 1080 },
]);
say(r.res.success, 'it runs', r.res.error || '');
say(size(r.edit) === '1920x1080', 'the precomp is the region\'s size', size(r.edit));
say(r.layer.pos.value[0] === 960 && r.layer.anchor.value[0] === 0, 'the layer sits on the left guide', String(r.layer.pos.value));
say(r.layer.transform.scale.value[0] === 100 && r.layer.transform.scale.value[1] === 100, 'the layer is back at 100%', String(r.layer.transform.scale.value));
say(/reset to 100%/.test(r.res.message || ''), 'and the report says so', r.res.message);

console.log('\n2. AE 26.5: orientation is an enumerated constant, not 0/1 (the reported machine)\n');
const O = ENUM_265.GuideOrientationType, P = ENUM_265.GuidePositionType;
r = run([
    { orientationType: O.VERTICAL, positionType: P.PIXEL, position: 480, pinned: false }, { orientationType: O.VERTICAL, positionType: P.PIXEL, position: 3360, pinned: false },
    { orientationType: O.HORIZONTAL, positionType: P.PIXEL, position: 100, pinned: false }, { orientationType: O.HORIZONTAL, positionType: P.PIXEL, position: 980, pinned: false },
], ENUM_265);
say(r.res.success, 'it reads the guides', r.res.error || '');
say(size(r.edit) === '2880x880', 'region 480–3360 by 100–980', size(r.edit));
say(r.layer.pos.value[0] === 480 && r.layer.pos.value[1] === 100, 'placed at the region\'s corner', String(r.layer.pos.value));

console.log('\n3. AE 26.5: percentage and pinned guides become pixels of THIS comp\n');
r = run([
    { orientationType: O.VERTICAL, positionType: P.PERCENTAGE, position: 25, pinned: false },
    { orientationType: O.VERTICAL, positionType: P.PERCENTAGE, position: 75, pinned: false },
], ENUM_265);
say(r.res.success && r.edit.width === 1920 && r.layer.pos.value[0] === 960, '25% and 75% of 3840 are 960 and 2880', size(r.edit) + ' at ' + r.layer.pos.value[0]);
say(/percentage/.test(r.res.message || ''), 'the report names the percentage guides', r.res.message);
r = run([
    { orientationType: O.VERTICAL, positionType: P.PIXEL, position: 840, pinned: false },
    { orientationType: O.VERTICAL, positionType: P.PIXEL, position: 840, pinned: true },
], ENUM_265);
say(r.res.success && r.edit.width === 2160 && r.layer.pos.value[0] === 840, 'a guide pinned 840 from the right is x 3000', 'width ' + r.edit.width);
say(/pinned/.test(r.res.message || ''), 'the report names the pinned guide', r.res.message);

console.log('\n4. a guide nobody can read is a refusal, never a skip\n');
r = run([
    { orientationType: 1, positionType: 0, position: 960 }, { orientationType: 1, positionType: 0, position: 2880 },
    { orientationType: 4412, positionType: 0, position: 500 },
]);
say(!r.res.success, 'it refuses');
say(/4412/.test(r.res.error || '') && /26\.5x89/.test(r.res.error || ''), 'with the raw value and the AE version', r.res.error);
say(size(r.edit) === '1920x1080' && r.layer.pos.writes === 0 && r.layer.transform.scale.writes === 0, 'and nothing was touched');

console.log('\n5. no guides at all still names the comp and where guides are\n');
r = run([]);
say(!r.res.success && /No ruler guides on "SF_INTL_Trio/.test(r.res.error || '') && /Landscape_Frontcard \(1\)/.test(r.res.error || ''), 'named', r.res.error);

console.log('\n6. keyframed Scale is somebody\'s animation\n');
r = run([{ orientationType: 1, positionType: 0, position: 960 }, { orientationType: 1, positionType: 0, position: 2880 }], null, (l) => { l.transform.scale.numKeys = 2; });
say(r.res.success && r.layer.transform.scale.writes === 0 && /keyframed/.test(r.res.message || ''), 'left alone, and said', r.res.message);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall good');
process.exit(fails ? 1 : 0);
