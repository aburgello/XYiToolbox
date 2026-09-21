// =============================================================================
// scripts/probe-language-token.cjs
// -----------------------------------------------------------------------------
// The LANGUAGE token, end to end through the naming spine.
//
// Belgium delivers Flemish and French of one size and length, so the name is
// the only thing that tells the three apart ("..._15s_BE", "..._15s_BE_FL",
// "..._15s_BE_FR"). Before this token existed all three parsed identically,
// built ONE filename between them, and read as duplicates of each other.
//
// Guards, in order: the parser reads it; a master's "_OV" and a legacy
// "_UK_V01" are NOT languages; the name builder writes it back; the three
// Belgian names round-trip to themselves and never collide; and MC It!'s
// artwork filter pairs each deliverable with its own language's artwork.
//
//   yarn build && node scripts/probe-language-token.cjs
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
const SFile = File, SFolderItem = FolderItem, SFootageItem = FootageItem;
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
vm.runInContext(src, vm.createContext(sandbox));
const A = sandbox.$['com.xyi.toolbox'] || sandbox['com.xyi.toolbox'];
if (!A || typeof A.parseDeliverableNames !== 'function') { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const check = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`));
};
const parse = (n) => A.parseDeliverableNames(JSON.stringify([n]))[0];

// ── 1. the parser ────────────────────────────────────────────────────────────
const be   = parse('SF_INTL_Characters_DOOH_1080x1920px_15s_BE');
const beFl = parse('SF_INTL_Characters_DOOH_1080x1920px_15s_BE_FL');
const beFr = parse('SF_INTL_Characters_DOOH_1080x1920px_15s_BE_FR');
check('plain BE: territory BE, no language', [be.territory, be.language || ''], ['BE', '']);
check('BE_FL: territory stays BE, language FL', [beFl.territory, beFl.language], ['BE', 'FL']);
check('BE_FR: territory stays BE, language FR', [beFr.territory, beFr.language], ['BE', 'FR']);
check('the campaign is untouched by it', [be.campaign, beFl.campaign], ['Characters', 'Characters']);

// The two tokens that live in exactly this position and are NOT languages.
const ov = parse('FID_INTL_Trio_DOOH_1920x1080px_15s_OV');
check('a master\'s _OV is not a language', ov.language || '', '');
const ver = parse('ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_UK_V01');
check('a legacy _V01 is not a language', ver.language || '', '');
check('...and that name still parses as UK', ver.territory, 'UK');
const site = parse('FID_INTL_Trio_DOOH_ImsPosnaniaRing_8160x240px_15s_PL');
check('a sited name has no language', [site.site, site.language || ''], ['ImsPosnaniaRing', '']);

// ── 2. the name builder, and the round trip ──────────────────────────────────
const build = (p) => A.buildDeliverableName(p);
const base = { filmTitle: 'SF', region: 'INTL', campaign: 'Characters', artworkType: 'DOOH', site: '', width: '1080', height: '1920', duration: '15sec', territory: 'BE' };
check('no language builds the name it always did', build(base), 'SF_INTL_Characters_DOOH_1080x1920px_15s_BE');
check('FL is written after the territory', build({ ...base, language: 'FL' }), 'SF_INTL_Characters_DOOH_1080x1920px_15s_BE_FL');
check('lower case converges', build({ ...base, language: 'fl' }), 'SF_INTL_Characters_DOOH_1080x1920px_15s_BE_FL');
check('OV is refused as a language', build({ ...base, language: 'OV' }), 'SF_INTL_Characters_DOOH_1080x1920px_15s_BE');
check('a digit-bearing token is refused', build({ ...base, language: 'V2' }), 'SF_INTL_Characters_DOOH_1080x1920px_15s_BE');

const names = [
    'SF_INTL_Characters_DOOH_1080x1920px_15s_BE',
    'SF_INTL_Characters_DOOH_1080x1920px_15s_BE_FL',
    'SF_INTL_Characters_DOOH_1080x1920px_15s_BE_FR',
    'SF_INTL_StaticLegendary_DINTH_1080x1920px_6s_BE',
];
const rebuilt = names.map((n) => {
    const r = parse(n);
    return build({ filmTitle: r.filmTitle, region: 'INTL', campaign: r.campaign, artworkType: r.artworkType, site: r.site, width: '1080', height: '1920', duration: r.duration, territory: r.territory, language: r.language });
});
check('every Belgian name rebuilds as itself', rebuilt, names);
check('...and the four are four distinct files', new Set(rebuilt).size, 4);

// ── 3. MC It! pairs each deliverable with its own language's artwork ─────────
// Driven through the real mcItApplyToOpenProject, with the same stubs
// probe-mcit-import.cjs uses -- the filter chain is inside that function, so
// re-implementing it here would prove nothing about what ships.
//
// The real Batch_1 shape: the artwork carries RGB where the deliverable has a
// duration, the three differ only by the trailing language, and all three sit
// LOOSE in the batch folder, so every deliverable sees all three.
const B = '/Volumes/uploads/Markets/Belgium/JPG_PNG/Batch_1';
const ART = [
    'SF_INTL_Characters_DOOH_1080x1920px_RGB_BE.jpg',
    'SF_INTL_Characters_DOOH_1080x1920px_RGB_BE_FL.jpg',
    'SF_INTL_Characters_DOOH_1080x1920px_RGB_BE_FR.jpg',
];
const artFiles = ART.map((n) => new SFile(`${B}/${n}`));

function makeProject(ovName) {
    const png = new SFolderItem('Artwork');
    const shots = [new SFootageItem(new SFile('/x/' + ovName), png)];
    png.numItems = shots.length;
    png.item = (i) => shots[i - 1];
    const footage = new SFolderItem('Footage');
    footage.numItems = 1; footage.item = () => png;
    png.parentFolder = footage;
    const items = [footage, png].concat(shots);
    return {
        numItems: items.length,
        item: (i) => items[i - 1],
        items: { addFolder: () => { const f = new SFolderItem('x'); f._children = []; f.item = (i) => f._children[i - 1]; return f; } },
        importFile: () => { throw new Error('no import in this probe'); },
    };
}

// The OV original inside each project is the same file in all three -- the
// language is on the DELIVERABLE, which is what has to pick the artwork apart.
const OV = 'SF_INTL_Characters_DOOH_1080x1920px_RGB_OV.jpg';
for (const [aep, want] of [
    ['SF_INTL_Characters_DOOH_1080x1920px_15s_BE_V01.aep', 'SF_INTL_Characters_DOOH_1080x1920px_RGB_BE.jpg'],
    ['SF_INTL_Characters_DOOH_1080x1920px_15s_BE_FL_V01.aep', 'SF_INTL_Characters_DOOH_1080x1920px_RGB_BE_FL.jpg'],
    ['SF_INTL_Characters_DOOH_1080x1920px_15s_BE_FR_V01.aep', 'SF_INTL_Characters_DOOH_1080x1920px_RGB_BE_FR.jpg'],
]) {
    const rep = A.mcItApplyToOpenProject(makeProject(OV), aep, artFiles, true, undefined, '');
    const replaced = (rep.items || []).filter((i) => i.action === 'replaced');
    check(`MC It!: ${aep.slice(41)} takes its own language`, replaced.length === 1 ? replaced[0].newName : JSON.stringify(rep.items), want);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
