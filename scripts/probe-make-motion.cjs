// =============================================================================
// scripts/probe-make-motion.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's makeMotionScan/makeMotionRun over a stubbed tree
// shaped like the real Forgotten Island one.
//
// STUBBED, and not negotiable: this writes into 28 live territory folders on
// the studio share. Everything checkable without doing that is checked here --
// that the pairing is never guessed, that the market token is read off the
// artwork rather than derived from the country, that a dry run copies nothing,
// and that a second run does not overwrite work somebody has done.
//
//   yarn build && node scripts/probe-make-motion.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

let tree = {};        // fsName -> child names (a folder); absent means a file
let copies = [];      // [from, to]
let opened = [];      // .aep paths app.open() was called on
let saved = 0;
const parentOf = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : null; };

function File(p) {
    if (!(this instanceof File)) return new File(p);
    this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); this.encoding = '';
    this.copy = (dest) => { copies.push([p, dest]); tree[parentOf(dest)] = (tree[parentOf(dest)] || []).concat(String(dest).split('/').pop()); return true; };
    this.open = () => true; this.write = () => true; this.close = () => true;
}
Object.defineProperty(File.prototype, 'exists', {
    get() {
        const dir = parentOf(this.fsName);
        const leaf = String(this.fsName).split('/').pop();
        return !tree[this.fsName] && !!tree[dir] && tree[dir].indexOf(leaf) !== -1;
    },
});
Object.defineProperty(File.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
function Folder(p) { if (!(this instanceof Folder)) return new Folder(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return Object.prototype.hasOwnProperty.call(tree, this.fsName); } });
Object.defineProperty(Folder.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
Folder.prototype.create = function () { tree[this.fsName] = tree[this.fsName] || []; return true; };
Folder.prototype.getFiles = function () {
    return (tree[this.fsName] || []).map((k) => {
        const q = this.fsName + '/' + k;
        return tree[q] ? new Folder(q) : new File(q);
    });
};

function FolderItem(name, parent) { this.name = name; this.parentFolder = parent || null; }
function FootageItem(file, parentFolder) {
    this.file = file; this.parentFolder = parentFolder || null; this.replacedWith = null;
    this.replace = (f) => { this.replacedWith = f.fsName; this.file = f; };
}

let openProject = null;
const sandbox = {
    Folder, File, FolderItem, FootageItem,
    app: {
        settings: { haveSetting: () => false, getSetting: () => '', saveSetting: () => {} },
        project: null,
        open(f) { opened.push(f.fsName); sandbox.app.project = openProject(f.fsName); return sandbox.app.project; },
    },
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
        if (v && typeof v === 'object' && typeof v.makeMotionScan === 'function') { aeft = v; break; }
    }
    if (aeft) break;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

// --- the tree, shaped like the real campaign pair ---------------------------
const JOB = '/Volumes/universal/Forgotten_Island/Digital/INT';
const MASTERS = JOB + '/XY026039_Masters';
const MARKETS = JOB + '/XY026040_Markets';
const dir = (p, kids) => { tree[p] = kids; };

const build = () => {
    tree = {}; copies = []; opened = []; saved = 0;
    dir(JOB, ['XY026039_Masters', 'XY026040_Markets']);
    dir(MASTERS, ['Support']);
    dir(MASTERS + '/Support', ['Motion_Components']);
    dir(MASTERS + '/Support/Motion_Components', ['_C4D', 'PORTAL_TO_PARADISE', 'TRIO', 'Gutters']);
    dir(MASTERS + '/Support/Motion_Components/_C4D', ['ignore.aep']);
    dir(MASTERS + '/Support/Motion_Components/PORTAL_TO_PARADISE', ['Date', 'TT', 'Edit', 'Tiffs']);
    dir(MASTERS + '/Support/Motion_Components/PORTAL_TO_PARADISE/Date', ['FID_INTL_Portal_2L_DATE_OV_RGB.aep', 'FID_INTL_Portal_1L_DATE_OV_RGB.aep']);
    dir(MASTERS + '/Support/Motion_Components/PORTAL_TO_PARADISE/TT', ['FID_RGB_TT_OV_ON_75BLACK_Simp_OOH.aep']);
    dir(MASTERS + '/Support/Motion_Components/PORTAL_TO_PARADISE/Edit', ['FID_PORTALTOPARADISE_EDIT_15sec.aep']);
    dir(MASTERS + '/Support/Motion_Components/PORTAL_TO_PARADISE/Tiffs', ['FID_INTL_Portal_48_Sheet_RGB_OV.aep']);
    dir(MASTERS + '/Support/Motion_Components/TRIO', ['Date']);
    dir(MASTERS + '/Support/Motion_Components/TRIO/Date', ['FID_INTL_Trio_2L_DATE_OV_RGB.aep']);
    dir(MASTERS + '/Support/Motion_Components/Gutters', ['Date']);
    dir(MASTERS + '/Support/Motion_Components/Gutters/Date', ['FID_INTL_Gutter_DATE_OV_RGB.aep']);

    // Colombia: TRIO squash-matches, P2P does NOT (the case that needs a person).
    dir(MARKETS, ['Colombia']);
    dir(MARKETS + '/Colombia', ['Masters']);
    dir(MARKETS + '/Colombia/Masters', ['Support']);
    dir(MARKETS + '/Colombia/Masters/Support', ['P2P', 'TRIO', 'BOOMBOX']);
    dir(MARKETS + '/Colombia/Masters/Support/P2P', ['Date', 'TT']);
    dir(MARKETS + '/Colombia/Masters/Support/P2P/Date', ['FID_INTL_Portal_2L_DATE_CO_RGB.ai', 'FID_INTL_Portal_1L_DATE_CO_RGB.ai']);
    dir(MARKETS + '/Colombia/Masters/Support/P2P/TT', ['FID_RGB_TT_CO_ON_75BLACK_Simp_OOH.psd']);
    dir(MARKETS + '/Colombia/Masters/Support/TRIO', ['Date']);
    dir(MARKETS + '/Colombia/Masters/Support/TRIO/Date', ['FID_INTL_Trio_2L_DATE_CO_RGB.ai']);
    dir(MARKETS + '/Colombia/Masters/Support/BOOMBOX', ['Date']);
    dir(MARKETS + '/Colombia/Masters/Support/BOOMBOX/Date', ['FID_INTL_Boombox_DATE_CO_RGB.ai']);
};

// A copied .aep opens holding the artwork its TEMPLATE referenced -- looked up
// through the copy that made it, not guessed from the new filename (a regex
// for the market token also matches _TT_, which is how this stub first lied).
openProject = (aepPath) => {
    const src = (copies.filter((c) => c[1] === aepPath)[0] || [])[0] || aepPath;
    const stem = String(src).split('/').pop().replace(/\.aep$/, '');
    // TT's artwork really is a .psd in the masters tree, and the swap rule
    // requires the extension to match -- an .ai must never stand in for a
    // .psd. A stub that made everything .ai hid that.
    const ext = /_TT_/.test(stem) ? '.psd' : '.ai';
    const item = new FootageItem(new File('/x/' + stem + ext), new FolderItem('Artwork'));
    return { file: new File(aepPath), numItems: 1, item: () => item, _item: item, save() { saved++; } };
};

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };

build();
console.log('1. the scan pairs what it can and asks about the rest\n');
const scan = aeft.makeMotionScan(MARKETS, 'Colombia');
if (!scan.success) { say(false, scan.error); }
else {
    console.log('   components: ' + scan.components.map((c) => c.name + '(' + c.aeps + ')').join(', '));
    console.log('   auto pairs: ' + scan.pairs.map((p) => p.component + ' <- ' + p.territoryFolder).join(', '));
    console.log('   unmatched : ' + scan.unmatchedTerritory.join(', ') + '   |  no artwork for: ' + scan.unmatchedComponents.join(', '));
    say(scan.pairs.length === 1 && scan.pairs[0].component === 'TRIO', 'TRIO pairs itself');
    say(scan.unmatchedTerritory.indexOf('P2P') !== -1, 'P2P comes back unmatched rather than guessed onto PORTAL_TO_PARADISE');
    say(scan.unmatchedComponents.indexOf('Gutters') !== -1, 'Gutters is reported as having no artwork here');
    const ptp = scan.components.filter((c) => c.name === 'PORTAL_TO_PARADISE')[0];
    say(ptp && ptp.categories.indexOf('Edit') === -1 && ptp.categories.indexOf('Tiffs') === -1,
        'Edit and Tiffs are not components', ptp ? ptp.categories.join('/') : '');
    say(scan.components.filter((c) => c.name === '_C4D').length === 0, '_C4D is excluded like every other "_" folder');
}

console.log('\n2. a dry run writes nothing');
const pairs = JSON.stringify([{ component: 'PORTAL_TO_PARADISE', territoryFolder: 'P2P' }, { component: 'TRIO', territoryFolder: 'TRIO' }]);
const dry = aeft.makeMotionRun(MARKETS, 'Colombia', pairs, true);
say(dry.success && copies.length === 0 && opened.length === 0, 'nothing copied, nothing opened', `copies=${copies.length} opens=${opened.length}`);
say(dry.made === 4, 'and it says what it would make (4: 2 dates, 1 TT, 1 trio)', String(dry.made));

console.log('\n3. the run copies, relinks and renames');
build();
const real = aeft.makeMotionRun(MARKETS, 'Colombia', pairs, false);
for (const f of real.files) console.log('        ' + f.status.padEnd(8) + (f.to || f.from) + (f.reason ? '   (' + f.reason.slice(0, 46) + ')' : ''));
say(real.success && real.made === 4, '4 made', String(real.made));
const names = copies.map((c) => c[1].split('/').pop());
say(names.indexOf('FID_INTL_Portal_2L_DATE_CO_RGB.aep') !== -1,
    'the component is renamed with the market token read off the artwork (CO)', names.join(', ').slice(0, 60));
say(copies.every((c) => c[1].indexOf('/Colombia/Test_Support/') !== -1), 'everything lands in Test_Support');
say(copies.every((c) => c[0].indexOf('/Motion_Components/') !== -1), 'and everything is copied FROM the templates, never written to them');
say(real.relinked === 4 && saved === 4, 'each copy was relinked and saved', `relinked=${real.relinked} saved=${saved}`);
say(!copies.some((c) => /EDIT_15sec|48_Sheet/.test(c[1])), 'Edit and Tiffs were not copied');

console.log('\n4. it never derives the market code from the country name');
// Colombia's ISO-2 is CO here, but the point is the token came from the FILE.
// Prove it by relabelling the artwork and re-running: the rename must follow.
build();
for (const d of Object.keys(tree)) {
    tree[d] = tree[d].map((n) => n.replace('_CO_', '_XX_'));
}
const odd = aeft.makeMotionRun(MARKETS, 'Colombia', pairs, false);
const oddNames = copies.map((c) => c[1].split('/').pop());
say(oddNames.indexOf('FID_INTL_Portal_2L_DATE_XX_RGB.aep') !== -1,
    'artwork labelled _XX_ renames the component _XX_, not _CO_', oddNames.join(', ').slice(0, 60));

console.log('\n5. a second run leaves existing work alone');
const again = aeft.makeMotionRun(MARKETS, 'Colombia', pairs, false);
say(again.files.every((f) => f.status === 'exists' || f.status === 'skipped'), 'every file reports "exists" rather than being overwritten');
say(again.made === 0, 'and nothing is remade', String(again.made));

console.log('\n6. a creative with no matching artwork is skipped, not half-made');
build();
const lone = aeft.makeMotionRun(MARKETS, 'Colombia', JSON.stringify([{ component: 'Gutters', territoryFolder: 'BOOMBOX' }]), false);
say(lone.made === 0 && copies.length === 0, 'nothing copied when no artwork is one token away', String(lone.made));
say((lone.files[0] || {}).status === 'skipped' && /nothing to localise/.test((lone.files[0] || {}).reason || ''),
    'and it says why', (lone.files[0] || {}).reason);

console.log(fails === 0 ? '\nCLEAN — it pairs nothing on its own, and writes only what the preview promised.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
