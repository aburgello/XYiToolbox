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
let renames = [];     // [oldName, newName]
let opened = [];      // .aep paths app.open() was called on
let saved = 0;
const parentOf = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : null; };

function File(p) {
    if (!(this instanceof File)) return new File(p);
    this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); this.encoding = '';
    this.copy = (dest) => { copies.push([p, dest]); tree[parentOf(dest)] = (tree[parentOf(dest)] || []).concat(String(dest).split('/').pop()); return true; };
    this.rename = (newName) => {
        const dir = parentOf(p); const leaf = String(p).split('/').pop();
        if (!tree[dir]) return false;
        tree[dir] = tree[dir].map((n) => (n === leaf ? newName : n));
        renames.push([leaf, newName]);
        return true;
    };
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
    tree = {}; copies = []; renames = []; opened = []; saved = 0;
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
    dir(MASTERS + '/Support/Motion_Components/TRIO/Date', ['FID_INTL_Trio_2L_DATE_OV_RGB.aep', 'FID_INTL_Trio_2L_DATE_OV_RGB Precomp.aep']);
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
    let src = (copies.filter((c) => c[1] === aepPath)[0] || [])[0];
    if (!src) {
        // Resumed: the copy was made under the template's own name and renamed
        // in place, so walk the rename back to find which template it was.
        const leaf = String(aepPath).split('/').pop();
        const was = (renames.filter((r) => r[1] === leaf)[0] || [])[0] || leaf;
        src = (copies.filter((c) => String(c[1]).split('/').pop() === was)[0] || [])[0] || aepPath;
    }
    // A "X Precomp.aep" is built FROM "X.ai" -- the suffix is the component's,
    // not the artwork's. That is the whole case section 7 exists for.
    const stem = String(src).split('/').pop().replace(/\.aep$/, '').replace(/ Precomp$/, '');
    // TT's artwork really is a .psd in the masters tree, and the swap rule
    // requires the extension to match -- an .ai must never stand in for a
    // .psd. A stub that made everything .ai hid that.
    const ext = /_TT_/.test(stem) ? '.psd' : '.ai';
    const item = new FootageItem(new File('/x/' + stem + ext), new FolderItem('Artwork'));
    // The comps inside carry the template's own name -- the studio convention
    // is that a comp is named after its file's stem -- so they still say _OV_
    // until something renames them.
    const tmplStem = String(src).split('/').pop().replace(/\.aep$/, '');
    const comps = [{ name: tmplStem, numLayers: 3 }, { name: 'Frontcard', numLayers: 1 }];
    const items = [item].concat(comps);
    return {
        file: new File(aepPath), numItems: items.length,
        item: (i) => items[i - 1], _item: item, _comps: comps,
        save() { saved++; },
    };
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
say(dry.made === 5, 'and it says what it would make (2 dates, 1 TT, 1 trio, 1 trio precomp)', String(dry.made));

console.log('\n3. the run copies, relinks and renames');
build();
const real = aeft.makeMotionRun(MARKETS, 'Colombia', pairs, false);
for (const f of real.files) console.log('        ' + f.status.padEnd(8) + (f.to || f.from) + (f.reason ? '   (' + f.reason.slice(0, 46) + ')' : ''));
say(real.success && real.made === 5, '5 made', String(real.made));
const names = copies.map((c) => c[1].split('/').pop());
say(names.indexOf('FID_INTL_Portal_2L_DATE_CO_RGB.aep') !== -1,
    'the component is renamed with the market token read off the artwork (CO)', names.join(', ').slice(0, 60));
say(copies.every((c) => c[1].indexOf('/Colombia/Test_Support/') !== -1), 'everything lands in Test_Support');
say(copies.every((c) => c[0].indexOf('/Motion_Components/') !== -1), 'and everything is copied FROM the templates, never written to them');
say(real.relinked === 5 && saved === 5, 'each copy was relinked and saved', `relinked=${real.relinked} saved=${saved}`);
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

console.log('\n7. a component whose name carries a trailing word its artwork does not');
{
    // Real: FID_INTL_Trio_2L_DATE_OV_RGB Precomp.aep is built from
    // FID_INTL_Trio_2L_DATE_OV_RGB.ai. One token more than its artwork, so
    // "exactly one token differs" found nothing and called the artwork missing
    // while it sat in the same folder.
    build();
    const r = aeft.makeMotionRun(MARKETS, 'Colombia', pairs, false);
    const names = copies.map((c) => c[1].split('/').pop());
    say(names.indexOf('FID_INTL_Trio_2L_DATE_CO_RGB Precomp.aep') !== -1,
        'it is made, and KEEPS its trailing word while the market token moves', names.filter((n) => /Precomp/.test(n)).join(', ') || '(not made)');
    say(names.indexOf('FID_INTL_Trio_2L_DATE_CO_RGB.aep') !== -1,
        'and the plain one beside it is still made from the same artwork');
    const row = r.files.filter((f) => /Precomp/.test(f.from))[0];
    say(row && row.status === 'made' && row.relinked === 1, 'with its artwork relinked, not reported missing', row ? `${row.status}/${row.relinked}` : 'no row');
}

console.log('\n8. the comps inside are renamed too');
{
    build();
    const seen = [];
    const realOpen = openProject;
    openProject = (p) => { const proj = realOpen(p); seen.push(proj); return proj; };
    const r = aeft.makeMotionRun(MARKETS, 'Colombia', pairs, false);
    openProject = realOpen;
    const all = seen.reduce((a, p) => a.concat(p._comps.map((c) => c.name)), []);
    say(all.indexOf('FID_INTL_Trio_2L_DATE_CO_RGB Precomp') !== -1,
        'a precomp\'s comp takes the market token, keeping its trailing word',
        all.filter((n) => /Precomp/.test(n)).join(', ') || '(none)');
    say(!all.some((n) => /_OV_/.test(n)), 'no comp is left saying _OV_', all.filter((n) => /_OV_/.test(n)).join(', '));
    say(all.filter((n) => n === 'Frontcard').length === seen.length,
        'a comp with no market token is left exactly as it was');
    say(r.compsRenamed === 5, 'and it counts what it renamed', String(r.compsRenamed));
}

console.log('\n9. a component with no artwork yet is copied and waits');
{
    build();
    // Gutters has a component; Colombia's BOOMBOX has nothing one token from it.
    const only = JSON.stringify([{ component: 'Gutters', territoryFolder: 'BOOMBOX' }]);
    const r = aeft.makeMotionRun(MARKETS, 'Colombia', only, false);
    const row = r.files[0];
    say(row && row.status === 'waiting', 'it is copied rather than skipped', row && row.status);
    say(copies.length === 1 && /FID_INTL_Gutter_DATE_OV_RGB\.aep$/.test(copies[0][1]),
        'and lands under its OWN name, so it cannot read as localised', copies.map((c) => c[1].split('/').pop()).join(', '));
    say(r.waiting === 1 && r.made === 0, 'counted as waiting, not as made', `waiting=${r.waiting} made=${r.made}`);
    say(opened.length === 0, 'nothing was opened for it — there was nothing to relink');

    // A second run with still no artwork must not copy it again.
    const again = aeft.makeMotionRun(MARKETS, 'Colombia', only, false);
    say(again.files[0].status === 'exists' && copies.length === 1, 'a re-run with no artwork leaves it alone', String(copies.length));
}

console.log('\n10. the artwork arrives, and a re-run finishes it');
{
    // Same run, then give BOOMBOX the artwork Gutters needs.
    tree[MARKETS + '/Colombia/Masters/Support/BOOMBOX/Date'] = ['FID_INTL_Gutter_DATE_CO_RGB.ai'];
    const before = copies.length;
    const r = aeft.makeMotionRun(MARKETS, 'Colombia', JSON.stringify([{ component: 'Gutters', territoryFolder: 'BOOMBOX' }]), false);
    const row = r.files[0];
    say(row && row.status === 'made', 'the waiting copy is finished', row && row.status);
    say(copies.length === before, 'without copying it a second time', `copies=${copies.length}`);
    say(renames.some((x) => x[1] === 'FID_INTL_Gutter_DATE_CO_RGB.aep'), 'it is renamed in place', renames.map((x) => x[1]).join(', '));
    say(row.relinked === 1, 'and relinked to the artwork that arrived', String(row.relinked));
    say(/Was waiting on artwork/.test(row.reason || ''), 'and says that is what happened', row.reason);
}

console.log('\n11. it can build into Support_Motion instead');
{
    build();
    const r = aeft.makeMotionRun(MARKETS, 'Colombia', pairs, false, 'Support_Motion');
    say(copies.every((c) => c[1].indexOf('/Colombia/Support_Motion/') !== -1), 'everything lands there instead', copies[0] ? copies[0][1] : '');
    // A destination is a path segment, so it cannot be allowed to climb out.
    build();
    const escaped = aeft.makeMotionRun(MARKETS, 'Colombia', pairs, false, '../../AE');
    say(copies.every((c) => c[1].indexOf('/Colombia/AE/') !== -1 && c[1].indexOf('..') === -1),
        'and a destination that tries to climb out is sanitised, not obeyed', copies[0] ? copies[0][1] : '');
}

console.log(fails === 0 ? '\nCLEAN — it pairs nothing on its own, and writes only what the preview promised.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
