// =============================================================================
// scripts/probe-frontcard-offset.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// A localised render carries a frontcard at its start (5s is usual) that the
// master does not, so a side-by-side comp showed different moments at the
// same frame and the frame counters matched nothing. Drives, over a stubbed
// project:
//   1. frontcardOffset itself: the extra is the offset, rounding is not.
//   2. createReviewComparison (Review, OV Library, 67's compare icon): the
//      master layer starts after the frontcard; a marker, the work area and
//      the playhead start there too.
//   3. sixtySevenDropIn (67's Add to comp): the guide clip AND the timed
//      markers move past the frontcard; with no clip, the comp's name gives
//      the master's length.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

// Anything-goes property tree: property()/addProperty() always answer, setValue records.
const prop = () => {
    const p = { value: 0, numKeys: 0, setValue(v) { this.value = v; }, setValueAtTime() {}, property: () => prop(), addProperty: () => prop(), canSetExpression: true };
    return p;
};
function MarkerValue(c) { this.comment = c; }
function FootageItem(o) { Object.assign(this, o); }
function CompItem(o) { Object.assign(this, o); }
function FolderItem(o) { Object.assign(this, o); }
function ImportOptions(f) { this.file = f; }
function File(p) { this.fsName = p; this.name = String(p).split('/').pop(); }
Object.defineProperty(File.prototype, 'exists', { get() { return true; } });
function Folder(p) { this.fsName = p; }

let items = [];
let nextId = 100;
const root = new FolderItem({ name: 'Root', id: 1 });
function makeComp(name, w, h, par, dur, fps) {
    const layers = [];
    const markers = [];
    const c = new CompItem({ id: nextId++, name, width: w, height: h, duration: dur, frameRate: fps, time: 0, workAreaStart: 0, workAreaDuration: dur, parentFolder: root, frameDuration: 1 / fps });
    c.markerProperty = {
        get numKeys() { return markers.length; },
        keyValue: (k) => markers[k - 1].v, removeKey: (k) => markers.splice(k - 1, 1),
        setValueAtTime: (t, v) => markers.push({ t, v }),
    };
    c._markers = markers;
    const addLayer = (source) => {
        const l = { source, name: source ? source.name : 'Null', startTime: 0, inPoint: 0, enabled: true, video: true, property: () => prop(), moveToBeginning() {}, remove() { layers.splice(layers.indexOf(l), 1); } };
        layers.unshift(l);
        return l;
    };
    c.layers = { add: addLayer, addText: () => addLayer(null), addSolid: () => addLayer(null), addShape: () => addLayer(null) };
    c.layer = (i) => layers[i - 1];
    Object.defineProperty(c, 'numLayers', { get: () => layers.length });
    c._layers = layers;
    c.openInViewer = () => {};
    items.push(c);
    return c;
}
const project = {
    rootFolder: root,
    get numItems() { return items.length; },
    item: (i) => items[i - 1],
    itemByID: (id) => items.find((x) => x.id === id) || null,
    items: { addComp: makeComp, addFolder: (n) => { const f = new FolderItem({ name: n, id: nextId++, parentFolder: root }); items.push(f); return f; } },
    importFile: (io) => { const f = new FootageItem({ id: nextId++, name: io.file.name, width: 1920, height: 1080, duration: 10, frameRate: 25, file: io.file, parentFolder: root }); items.push(f); return f; },
};
const sandbox = {
    Folder, File, ImportOptions, MarkerValue, FootageItem, CompItem, FolderItem,
    BlendingMode: { DIFFERENCE: 1 },
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} }, project, beginUndoGroup() {}, endUndoGroup() {} },
    $: { writeln() {}, sleep() {}, global: null, os: 'Macintosh' },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
vm.runInContext(src, vm.createContext(sandbox));
let aeft = null;
for (const r of [sandbox.$, sandbox]) for (const k of Object.keys(r)) {
    const v = r[k];
    if (!aeft && v && typeof v === 'object' && typeof v.frontcardOffset === 'function') aeft = v;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };

console.log('1. The offset');
check(aeft.frontcardOffset(15, 10, 25) === 5, '15s local over a 10s master: 5s of frontcard');
check(aeft.frontcardOffset(10.04, 10, 25) === 0, 'a frame of rounding is not a frontcard');
check(aeft.frontcardOffset(10, 15, 25) === 0, 'a shorter local is never shifted');
check(Math.abs(aeft.frontcardOffset(15.01, 10, 23.976) - 120 / 23.976) < 1e-9, 'snapped to whole frames at 23.976', aeft.frontcardOffset(15.01, 10, 23.976));

console.log('\n2. Compare (Review, OV Library, 67)');
const local = new FootageItem({ id: nextId++, name: 'FID_INTL_PortalToParadise_DOOH_TheScreenFrbC_1920x1350px_10s_DK_V01.mov', width: 1920, height: 1350, duration: 15, frameRate: 25, parentFolder: root });
items.push(local);
let r = aeft.createReviewComparison('/masters/FID_INTL_PortalToParadise_DOOH_1440x1080px_10s_OV.mp4', local.id, local.name);
check(r.success, 'the comp is built', r.error);
const comp = project.itemByID(r.compId);
const master = comp && comp._layers.find((l) => /^MASTER/.test(l.name));
const loc = comp && comp._layers.find((l) => /^LOCAL/.test(l.name));
check(master && master.startTime === 5 && loc && loc.startTime === 0, 'the master starts after the 5s frontcard, the local at 0', master && [master.startTime, loc.startTime]);
check(comp.workAreaStart === 5 && comp.time === 5, 'the work area and the playhead start where the master does', [comp.workAreaStart, comp.time]);
check(comp._markers.length === 1 && comp._markers[0].t === 5, 'with a marker saying so', comp._markers);
check(comp.displayStartTime === -5, "the comp's timeline starts at -5s, so both counters read the master's frame", comp.displayStartTime);
const tcSets = (layer) => layer._tc || [];
check(/tc-master:ok/.test(r.enrichNotes) && /tc-local:ok/.test(r.enrichNotes), 'both counters were switched to Composition time (matchName ADBE Timecode-0009)', r.enrichNotes);
check(/frontcard:5\.00s/.test(r.enrichNotes || ''), 'and the notes record it', r.enrichNotes);
const same = new FootageItem({ id: nextId++, name: 'FID_INTL_Trio_DOOH_Led_1920x1080px_10s_HU_V01.mov', width: 1920, height: 1080, duration: 10, frameRate: 25, parentFolder: root });
items.push(same);
r = aeft.createReviewComparison('/masters/FID_INTL_Trio_DOOH_1920x1080px_10s_OV.mp4', same.id, same.name);
const c2 = project.itemByID(r.compId);
check(c2._layers.find((l) => /^MASTER/.test(l.name)).startTime === 0 && c2._markers.length === 0 && !c2.displayStartTime, 'a local with no frontcard is left exactly as before');

// A render AE can't see into (blank Media Duration): said plainly, no comp.
const blind = new FootageItem({ id: nextId++, name: 'FID_INTL_PortalToParadise_DOOH_TheJewel_1152x1920px_10s_DK_V01.mov', width: 1152, height: 1920, duration: 0, frameRate: 25, hasVideo: false, parentFolder: root });
items.push(blind);
const nComps = items.filter((x) => x instanceof CompItem).length;
r = aeft.createReviewComparison('/masters/FID_INTL_PortalToParadise_DOOH_1080x1920px_10s_OV.mp4', blind.id, blind.name);
check(!r.success && /can't read the picture/.test(r.error) && items.filter((x) => x instanceof CompItem).length === nComps, "a render with no readable video is named as the problem, and no half-built comp is left", r.error);

// OV Library's own Compare, from the Project-panel selection.
project.selection = [local];
r = aeft.createComparisonComp('/masters/FID_INTL_PortalToParadise_DOOH_1440x1080px_10s_OV.mp4', 1440, 1080);
const c3 = items[items.length - 1];
check(r.success && c3._layers.find((l) => /OV\.mp4$/.test(l.name)).startTime === 5 && c3.workAreaStart === 5 && c3.displayStartTime === -5, "OV Library's Compare lines up the same way", r.error);

console.log("\n3. 67's Add to comp");
const work = makeComp('FID_INTL_PortalToParadise_DOOH_TheScreenFrbC_1920x1350px_10s_DK_V01', 1920, 1350, 1, 15, 25);
project.activeItem = work;
let d = aeft.sixtySevenDropIn('/masters/FID_INTL_PortalToParadise_DOOH_1440x1080px_10s_OV.mp4', JSON.stringify([{ text: 'date card clips', at: 2 }]));
check(d.success && d.offset === 5, 'the drop-in measures the frontcard', d);
const guide = work._layers.find((l) => /^67 · /.test(l.name));
check(guide && guide.startTime === 5, 'the guide clip starts after it', guide && guide.startTime);
check(work._markers.length === 1 && work._markers[0].t === 7, 'a note at 0:02 of the master lands at 0:07 of this comp', work._markers.map((m) => m.t));
work._markers.length = 0;
d = aeft.sixtySevenDropIn('', JSON.stringify([{ text: 'date card clips', at: 2 }]));
check(d.success && work._markers[0] && work._markers[0].t === 7, "with no clip, the comp's own name (10s) gives the master's length", work._markers.map((m) => m.t));
const inner = makeComp('FID_INTL_PortalToParadise_DOOH_TheScreenFrbC_1920x1350px_10s_DK', 1920, 1350, 1, 10, 25);
project.activeItem = inner;
d = aeft.sixtySevenDropIn('', JSON.stringify([{ text: 'x', at: 2 }]));
check(inner._markers[0] && inner._markers[0].t === 2, 'an edit comp with no frontcard keeps the note where it was', inner._markers.map((m) => m.t));

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — the master lines up after the frontcard, in every compare.');
process.exit(fails ? 1 : 0);
