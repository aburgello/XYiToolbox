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

console.log('\n6. a territory with NO batch level under JPG_PNG (Street Fighter INT)');
// AE/Batch_01 beside JPG_PNG/<deliverable>/ -- no JPG_PNG/Batch_01. This used
// to derive "" and the inline run saved every project unswapped.
const T = '/Volumes/paramount/StreetFighter/INT/XY026205_Markets';
const CG = 'SF_INTL_Trio_DINTH_CineGrand_1080x1920px_15s_BG';
const LCD = 'SF_INTL_Trio_DINTH_GenericLCD_1080x1920px_15s_BG';
const tree = {
    [`${T}/AE/Batch_01`]: [new File(`${T}/AE/Batch_01/${CG}_V01.aep`), new File(`${T}/AE/Batch_01/${LCD}_V01.aep`)],
    [`${T}/JPG_PNG`]: [new Folder(`${T}/JPG_PNG/_Delivered`), new Folder(`${T}/JPG_PNG/_Old`), new Folder(`${T}/JPG_PNG/${CG}`), new Folder(`${T}/JPG_PNG/${LCD}`)],
    [`${T}/JPG_PNG/_Delivered`]: [new Folder(`${T}/JPG_PNG/_Delivered/${CG}`)],
    [`${T}/JPG_PNG/_Delivered/${CG}`]: [new File(`${T}/JPG_PNG/_Delivered/${CG}/${CG}.jpg`)],
    [`${T}/JPG_PNG/_Old`]: [],
    [`${T}/JPG_PNG/${CG}`]: [new Folder(`${T}/JPG_PNG/${CG}/ARTWORK_ONLY`), new File(`${T}/JPG_PNG/${CG}/${CG}.csv`), new File(`${T}/JPG_PNG/${CG}/${CG}.jpg`), new File(`${T}/JPG_PNG/${CG}/${CG}1.png`)],
    [`${T}/JPG_PNG/${CG}/ARTWORK_ONLY`]: [new File(`${T}/JPG_PNG/${CG}/ARTWORK_ONLY/${CG}_ARTWORK_1.jpg`)],
    [`${T}/JPG_PNG/${LCD}`]: [new File(`${T}/JPG_PNG/${LCD}/${LCD}.jpg`)],
    [`${T}/AE/Stray`]: [new File(`${T}/AE/Stray/Unrelated_V01.aep`)],
};
Folder.prototype.getFiles = function () { return tree[this.fsName] || []; };
const derived = aeft.mcItDeriveImageFolderFor(new Folder(`${T}/AE/Batch_01`));
say(derived === `${T}/JPG_PNG`, 'JPG_PNG itself is the image folder when it holds this batch\'s deliverables', derived);
say(aeft.mcItDeriveImageFolderFor(new Folder(`${T}/AE/Stray`)) === '',
    'but not for a batch none of whose deliverables are in it');
const flat = aeft.mcItCollectImages(new Folder(derived));
say(!flat.some((f) => f.fsName.indexOf('/_Delivered/') !== -1), '_Delivered is never searched', String(flat.length) + ' images');
say(aeft.mcItTerritoryOfImageFolder(new Folder(derived)) === 'XY026205_Markets', 'territory read one level up', aeft.mcItTerritoryOfImageFolder(new Folder(derived)));

function sfProject() {
    const jpg = new FolderItem('JPG');
    const png = new FolderItem('PNG');
    const j = [new FootageItem(new File('/m/SF_INTL_Trio_DOOH_MotionPoster_1080x1920px_15s_OV.jpg'), jpg)];
    const p = [new FootageItem(new File('/m/SF_INTL_Trio_DOOH_MotionPoster_1080x1920px_15s_OV1.png'), png)];
    jpg.numItems = 1; jpg.item = () => j[0];
    png.numItems = 1; png.item = () => p[0];
    const footage = new FolderItem('Footage');
    const kids = [jpg, png];
    footage.numItems = 2; footage.item = (i) => kids[i - 1];
    jpg.parentFolder = footage; png.parentFolder = footage;
    const items = [footage, jpg, png, j[0], p[0]];
    return { numItems: items.length, item: (i) => items[i - 1], items: { addFolder: () => new FolderItem('x') }, importFile: () => new FootageItem(null), _j: j[0], _p: p[0] };
}
const sp = sfProject();
const srep = aeft.mcItApplyToOpenProject(sp, CG + '_V01.aep', flat, true, undefined, '');
const got = srep.items.map((i) => i.action + ':' + (i.newName || i.reason)).join(' | ');
say(srep.items.length === 2 && srep.items.every((i) => i.action === 'replaced'), 'both the OV jpg and the OV1 png find their CineGrand exports', got);
say(srep.items.some((i) => decodeURI(i.newName || '') === CG + '.jpg') && srep.items.some((i) => decodeURI(i.newName || '') === CG + '1.png'),
    'and the right ones, not GenericLCD\'s or _Delivered\'s');

console.log('\n7. an unnumbered slot takes the ONLY numbered export, and never one of several');
// Latvia: master has _OV.png, the mech export is _LV1.png and nothing else.
const LV = 'SF_INTL_Trio_DINTH_1080x1920px_10s_LV';
const LVD = `${T}/JPG_PNG/${LV}`;
function oneSlot(orig) {
    const png = new FolderItem('PNG');
    const it = new FootageItem(new File('/m/' + orig), png);
    png.numItems = 1; png.item = () => it;
    const footage = new FolderItem('Footage'); footage.numItems = 1; footage.item = () => png; png.parentFolder = footage;
    const items = [footage, png, it];
    return { numItems: 3, item: (i) => items[i - 1], items: { addFolder: () => new FolderItem('x') }, importFile: () => new FootageItem(null) };
}
const OVPNG = 'SF_INTL_Trio_DOOH_MotionPoster_1080x1920px_15s_OV.png';
let r7 = aeft.mcItApplyToOpenProject(oneSlot(OVPNG), LV + '_V01.aep', [new File(`${LVD}/${LV}1.png`), new File(`${LVD}/${LV}.jpg`)], true, undefined, '');
say(r7.items[0].action === 'replaced' && decodeURI(r7.items[0].newName) === LV + '1.png', '_OV.png -> the lone _LV1.png', r7.items[0].action + ' ' + (r7.items[0].newName || r7.items[0].reason));
r7 = aeft.mcItApplyToOpenProject(oneSlot(OVPNG), LV + '_V01.aep', [new File(`${LVD}/${LV}1.png`), new File(`${LVD}/${LV}2.png`)], true, undefined, '');
say(r7.items[0].action === 'no-match', 'two numbered exports stay a question', r7.items[0].reason);
r7 = aeft.mcItApplyToOpenProject(oneSlot(OVPNG), LV + '_V01.aep', [new File(`${LVD}/${LV}1.png`), new File(`${LVD}/${LV}.png`)], true, undefined, '');
say(decodeURI(r7.items[0].newName || '') === LV + '.png', 'an unnumbered export still wins outright', r7.items[0].newName);
r7 = aeft.mcItApplyToOpenProject(oneSlot(OVPNG.replace('_OV.png', '_OV2.png')), LV + '_V01.aep', [new File(`${LVD}/${LV}1.png`)], true, undefined, '');
say(r7.items[0].action === 'no-match', 'a NUMBERED slot never borrows another number', r7.items[0].reason);
r7 = aeft.mcItApplyToOpenProject(oneSlot(OVPNG.replace('.png', '.jpg')), LV + '_V01.aep', [new File(`${LVD}/ARTWORK_ONLY/${LV}_ARTWORK_1.jpg`)], true, undefined, '');
say(r7.items[0].action === 'no-match', 'an ARTWORK_ONLY extra is never the lone answer', r7.items[0].reason);

console.log(fails === 0 ? '\nCLEAN — each project gets its own images, once.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
