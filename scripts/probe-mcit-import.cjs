// =============================================================================
// scripts/probe-mcit-import.cjs
// -----------------------------------------------------------------------------
// MC It! now imports a deliverable's WHOLE image set alongside the swap, so the
// extras a territory supplies (the ARTWORK_ONLY pair in every real folder) stop
// having to be fetched from Finder by hand.
//
// The part worth guarding is WHOSE images those are. A JPG_PNG batch is filed
// one subfolder per deliverable, named exactly as the .aep is -- measured on
// Brazil's Batch_2, eleven subfolders against eleven .aep files -- so a project
// must get its own six, not the batch's sixty-six.
//
//   yarn build && node scripts/probe-mcit-import.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

const parentOf = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : null; };
function File(p) { if (!(this instanceof File)) return new File(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Object.defineProperty(File.prototype, 'exists', { get() { return true; } });
Object.defineProperty(File.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
function Folder(p) { if (!(this instanceof Folder)) return new Folder(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return true; } });
Object.defineProperty(Folder.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
Folder.prototype.getFiles = () => [];
function FolderItem(name, parent) { this.name = name; this.parentFolder = parent || null; this.numItems = 0; this.item = () => null; }
function FootageItem(file, parentFolder) { this.file = file; this.parentFolder = parentFolder || null; this.replace = (f) => { this.file = f; }; }
function ImportOptions(f) { this.file = f; }

const sandbox = {
    Folder, File, FolderItem, FootageItem, ImportOptions,
    app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} }, project: null },
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
        if (v && typeof v === 'object' && typeof v.mcItApplyToOpenProject === 'function') { aeft = v; break; }
    }
    if (aeft) break;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };

// Brazil's real Batch_2 shape: a subfolder per deliverable, ARTWORK_ONLY inside.
const B = '/Volumes/universal/Markets/Brazil/JPG_PNG/Batch_2';
const A = 'FID_INTL_PortalToParadise_DOOH_DufryEZ_1920x1080px_15s_BR';
const OTHER = 'FID_INTL_PortalToParadise_DOOH_DufryEZ_1280x1440px_15s_BR';
const images = [
    new File(`${B}/${A}/${A}.jpg`),
    new File(`${B}/${A}/${A}1.png`),
    new File(`${B}/${A}/${A}2.png`),
    new File(`${B}/${A}/${A}2.jpg`),
    new File(`${B}/${A}/ARTWORK_ONLY/${A}_ARTWORK_1.jpg`),
    new File(`${B}/${A}/ARTWORK_ONLY/${A}_ARTWORK_2.jpg`),
    new File(`${B}/${OTHER}/${OTHER}.jpg`),
    new File(`${B}/${OTHER}/ARTWORK_ONLY/${OTHER}_ARTWORK_1.jpg`),
];

// A project with a Footage/PNG holding the OV originals, as a real one has.
function makeProject() {
    const png = new FolderItem('PNG');
    const shots = [new FootageItem(new File('/x/' + A.replace('_BR', '_OV') + '1.png'), png)];
    png.numItems = shots.length;
    png.item = (i) => shots[i - 1];
    const footage = new FolderItem('Footage');
    footage.numItems = 1; footage.item = () => png;
    png.parentFolder = footage;

    const items = [footage, png].concat(shots);
    const proj = {
        numItems: items.length,
        item: (i) => items[i - 1],
        items: {
            addFolder(name) {
                const f = new FolderItem(name);
                f.parentFolder = null;
                items.push(f); proj.numItems = items.length;
                proj._made = f; f._children = [];
                f.numItems = 0; f.item = (i) => f._children[i - 1];
                return f;
            },
        },
        importFile(opts) {
            const it = new FootageItem(opts.file);
            proj._imported.push(opts.file.fsName);
            // AE puts it at the root; the caller re-parents it.
            Object.defineProperty(it, 'parentFolder', {
                set(f) { if (f && f._children) { f._children.push(it); f.numItems = f._children.length; } },
                get() { return null; }, configurable: true,
            });
            return it;
        },
        _imported: [], _made: null,
    };
    return proj;
}

console.log('1. a project gets ITS OWN images, not the whole batch\n');
let proj = makeProject();
let rep = aeft.mcItApplyToOpenProject(proj, A + '_V01.aep', images, false, undefined, 'Brazil_JPG_PNG');
say(rep.imported === 6, 'six imported — the four beside it plus the two in ARTWORK_ONLY', String(rep.imported));
say(proj._imported.every((p) => p.indexOf('/' + A + '/') !== -1),
    'and none of the other deliverable\'s', proj._imported.filter((p) => p.indexOf(OTHER) !== -1).join(', ') || 'none');
say(proj._imported.some((p) => /ARTWORK_1\.jpg$/.test(p)), 'ARTWORK_ONLY resolves to the deliverable above it');
say(proj._made && proj._made.name === 'Brazil_JPG_PNG', 'into a folder named after the territory', proj._made && proj._made.name);

console.log('\n2. the swap still happens');
say(rep.items.filter((i) => i.action === 'replaced').length === 1, 'the OV png was still swapped', JSON.stringify(rep.items.map((i) => i.action)));

console.log('\n3. re-running does not stack a second copy');
const before = proj._imported.length;
// The folder now holds them; a second pass must skip every one.
const rep2 = aeft.mcItApplyToOpenProject(proj, A + '_V01.aep', images, false, undefined, 'Brazil_JPG_PNG');
say(rep2.imported === 0 && proj._imported.length === before, 'nothing imported twice', `${rep2.imported} / ${proj._imported.length - before} new`);

console.log('\n4. it is off unless the folder shape says which territory');
proj = makeProject();
const rep3 = aeft.mcItApplyToOpenProject(proj, A + '_V01.aep', images, false, undefined, '');
say(rep3.imported === undefined && proj._imported.length === 0, 'no folder name, no import', String(rep3.imported));
say(aeft.mcItTerritoryOfImageFolder(new Folder(B)) === 'Brazil', 'and the territory is derived from the batch path', aeft.mcItTerritoryOfImageFolder(new Folder(B)));
say(aeft.mcItTerritoryOfImageFolder(new Folder('/Users/someone/Desktop/loose')) === '',
    'a hand-picked folder that says nothing about a territory yields no name');

console.log('\n5. a dry run imports nothing');
proj = makeProject();
const dry = aeft.mcItApplyToOpenProject(proj, A + '_V01.aep', images, true, undefined, 'Brazil_JPG_PNG');
say(proj._imported.length === 0, 'nothing brought in', String(proj._imported.length));
say(dry.imported === 6, 'but it still says how many it would bring', String(dry.imported));

console.log(fails === 0 ? '\nCLEAN — each project gets its own images, once.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
