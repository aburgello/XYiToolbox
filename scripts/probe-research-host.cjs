// =============================================================================
// scripts/probe-research-host.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// EOC Research's render pass (src/jsx/aeft/research.ts), against a STUBBED
// project. Stubbed on purpose: a pass renders the whole render queue and
// clears it, which is exactly what must never be tried on a live project.
// File.exists THROWS here, so reaching for it on the share fails the probe.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

function world(opts) {
    const o = Object.assign({ queued: 0, templates: ['H264_1MBPS_MOS', 'JPEG_1FRAME'], badImport: [], dirty: false, items: 0 }, opts || {});
    const log = { rendered: 0, removedBin: 0, purged: 0, files: [], newProject: 0, removedForeign: 0 };
    const queue = [];
    for (let i = 0; i < o.queued; i++) queue.push({ foreign: true, remove() { log.removedForeign++; queue.splice(queue.indexOf(this), 1); } });
    function File(p) { this.fsName = p; this.name = String(p).split('/').pop(); }
    Object.defineProperty(File.prototype, 'exists', { get() { throw new Error('File.exists was asked on the share'); } });
    function Folder(p) { this.fsName = p; }
    Folder.prototype.selectDlg = () => null;
    const mkItem = (comp) => {
        const it = {
            status: 'QUEUED', comp, timeSpanStart: 0, timeSpanDuration: 0,
            outputModule: () => it.om,
            remove() { queue.splice(queue.indexOf(it), 1); },
        };
        it.om = { applyTemplate(n) { if (o.templates.indexOf(n) === -1) throw new Error('no template'); it.tpl = n; }, set file(f) { it.file = f.fsName; log.files.push(f.fsName); } };
        return it;
    };
    const project = {
        numItems: o.items, dirty: o.dirty, file: o.items ? { name: 'Work.aep' } : null,
        items: {
            addFolder: () => ({ remove() { log.removedBin++; } }),
            addComp: (name, w, h, pa, dur, fr) => ({ name, width: w, height: h, duration: dur, frameDuration: 1 / fr, layers: { add() {} } }),
        },
        importFile(io) { if (o.badImport.indexOf(io.file.fsName) !== -1) throw new Error('cannot read'); return { width: 1081, height: 1920, pixelAspect: 1, duration: 10, frameRate: 24 }; },
        renderQueue: {
            get numItems() { return queue.length; },
            item: (i) => queue[i - 1],
            items: { add(comp) { const it = mkItem(comp); queue.push(it); return it; } },
            render() { log.rendered++; queue.forEach((q) => { q.status = 'DONE'; }); },
        },
    };
    const sb = {
        app: { project, settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} }, beginSuppressDialogs() {}, endSuppressDialogs() {}, purge() { log.purged++; }, newProject() { log.newProject++; } },
        $: { writeln() {}, global: null }, BridgeTalk: { appName: 'aftereffects' }, alert() {}, File, Folder,
        ImportOptions: function (f) { this.file = f; }, ImportAsType: { FOOTAGE: 1 }, RQItemStatus: { DONE: 'DONE' }, PurgeTarget: { ALL_CACHES: 1 },
        decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
    };
    vm.runInContext(src, vm.createContext(sb));
    let a = null;
    for (const r of [sb.$, sb]) for (const k of Object.keys(r)) { const v = r[k]; if (!a && v && typeof v === 'object' && typeof v.researchRenderChunk === 'function') a = v; }
    if (!a) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }
    return { a, log, queue };
}

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };
const args = (rows, more) => JSON.stringify(Object.assign({ dest: '/R/Film/LOCALISED', mp4Template: 'H264_1MBPS_MOS', jpgTemplate: 'JPEG_1FRAME', still: true, rows }, more || {}));
const rows = [{ prefix: 'Norway_B1_A', src: '/M/Norway/Renders/B1/A.mov' }, { prefix: 'Norway_B1_B', src: '/M/Norway/Renders/B1/B.mov' }];

console.log('A pass');
let w = world({ badImport: ['/M/Norway/Renders/B1/B.mov'] });
let r = w.a.researchRenderChunk(args(rows));
check(r.success && r.rows.length === 2, 'every row is answered for', r.rows);
check(r.rows.find((x) => x.prefix === 'Norway_B1_A').ok && !r.rows.find((x) => x.prefix === 'Norway_B1_B').ok, 'a render that cannot be imported fails by itself, and the rest still render');
check(w.log.files.indexOf('/R/Film/LOCALISED/Norway_B1_A.mp4') !== -1 && w.log.files.indexOf('/R/Film/LOCALISED/Norway_B1_A_LASTFRAME_[#####].jpg') !== -1, "the still asks for AE's frame number BEFORE .jpg", w.log.files);
check(w.log.rendered === 1 && w.queue.length === 0 && w.log.removedBin === 1 && w.log.purged === 1, 'one render, then the queue, the bin and the caches are cleared');

console.log('\nWhat stops it');
w = world({ queued: 2 });
r = w.a.researchRenderChunk(args(rows));
check(!r.success && !!r.fatal && w.queue.length === 2 && w.log.rendered === 0 && w.log.removedForeign === 0, "somebody's queued renders: refused, and their queue is untouched", r.fatal);
w = world({ templates: ['JPEG_1FRAME'] });
r = w.a.researchRenderChunk(args(rows));
check(!r.success && /H264_1MBPS_MOS/.test(r.fatal || '') && w.log.rendered === 0 && w.queue.length === 0, 'no mp4 template: nothing renders at default settings, and the run is told to stop', r.fatal);
w = world({ templates: ['H264_1MBPS_MOS'] });
r = w.a.researchRenderChunk(args(rows));
check(r.success && r.rows.every((x) => x.ok && /JPEG_1FRAME/.test(x.note)) && w.log.files.length === 2, 'no still template: the clips render and each row says it has no still', r.rows);
w = world({ queued: 1 });
r = w.a.researchRenderChunk('{not json');
check(!r.success && w.queue.length === 1 && w.log.removedForeign === 0, 'unreadable arguments fail without touching a queue that was never ours');
w = world();
r = w.a.researchRenderChunk(args(rows, { still: false }));
check(r.success && w.log.files.length === 2 && w.log.files.every((f) => /\.mp4$/.test(f)), 'stills off: clips only');

console.log('\nThe project');
w = world({ items: 3, dirty: true });
check(w.a.researchProjectState().dirty === true && w.a.researchProjectState().items === 3, 'says what is open');
check(!w.a.researchNewProject().success && w.log.newProject === 0, 'never closes a project with unsaved changes');
w = world({ items: 3, dirty: false });
check(w.a.researchNewProject().success && w.log.newProject === 1, 'a saved one is closed for a new, empty project');
check(w.a.researchGetRoot() === '/Volumes/newmedia/_Motion/MotionAssets/Project_Research' && w.a.researchSelectFolder('/x', '') === '', "the archive defaults to the studio's folder; a cancelled dialog is \"\"");

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — a pass renders only its own queue, and stops rather than render wrong.');
process.exit(fails ? 1 : 0);
