// =============================================================================
// scripts/probe-tutorials.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT ExtendScript bundle's tutorialsList() against a stubbed
// filesystem. `tsconfig-build.json` type-checks ZERO files under src/jsx, so
// without this the function's only gate would be an artist opening the panel.
//
// The stubs enforce the team-folder rules as well as the behaviour: File.exists
// THROWS here and getFiles(mask) THROWS here, so a future edit that reaches for
// either on the share fails this probe instead of failing silently on the NAS.
//
//   yarn build && node scripts/probe-tutorials.cjs
// =============================================================================
const fs = require('fs');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

let tree = {};      // fsName -> array of child entry names, or null for a file
let settings = {};

function makeFile(path, name) {
    return { name, fsName: path, get exists() { throw new Error('File.exists must NOT be consulted on the team share'); } };
}
function makeFolder(path) {
    const self = {
        fsName: path,
        name: path.split('/').pop(),
        get exists() { return Object.prototype.hasOwnProperty.call(tree, path); },
        getFiles(mask) {
            if (mask !== undefined) throw new Error('getFiles() must be called with NO MASK on the team share');
            const kids = tree[path] || [];
            return kids.map((k) => (tree[path + '/' + k] ? makeFolder(path + '/' + k) : makeFile(path + '/' + k, k)));
        },
    };
    return self;
}

const sandbox = {
    Folder: function (p) { return makeFolder(p); },
    File: function (p) { return makeFile(p, p.split('/').pop()); },
    app: { settings: {
        haveSetting: (s, k) => settings[s + '|' + k] !== undefined,
        getSetting: (s, k) => settings[s + '|' + k],
        saveSetting: (s, k, v) => { settings[s + '|' + k] = v; },
    }, project: null },
    $: { writeln() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' },
    alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.selectDialog = () => null;
sandbox.File.decode = decodeURI;

const vm = require('vm');
const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx);
// The bundle is an IIFE that hangs its exports off a namespace on `this`
// (host[ns] = aeft), so find whichever key now holds tutorialsList.
let list = null;
// host = $ (that's `var host = typeof $ !== "undefined" ? $ : window`), and
// the exports land at host[config.id].
const roots = [sandbox.$, sandbox];
for (const root of roots) {
    for (const k of Object.keys(root)) {
        const v = root[k];
        if (v && typeof v === 'object' && typeof v.tutorialsList === 'function') { list = v.tutorialsList; break; }
    }
    if (list) break;
}
if (!list) { console.log('EXPORT NOT REACHABLE — globals: ' + Object.keys(sandbox).join(',')); process.exit(1); }

let fails = 0;
function check(label, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

// 1. No team folder set at all -- the commonest state on a fresh machine.
settings = {};
check('no team folder -> available:false, no error', (() => { const r = list(); return [r.success, r.available, r.files.length]; })(), [true, false, 0]);

// 2. Team folder set but the share is not mounted.
settings['XYiToolbox|TeamFolderPath'] = '/Volumes/Team_Folder';
tree = {};
check('share unmounted -> available:false', (() => { const r = list(); return [r.success, r.available]; })(), [true, false]);

// 3. Mounted, but nobody has made _tuts yet.
tree = { '/Volumes/Team_Folder': ['misc', 'shared-tools.json'], '/Volumes/Team_Folder/misc': [] };
check('no _tuts folder -> available:false', (() => { const r = list(); return [r.success, r.available]; })(), [true, false]);

// 4. The real case, mixed contents.
tree = {
    '/Volumes/Team_Folder': ['_tuts'],
    '/Volumes/Team_Folder/_tuts': ['OVSwap.mp4', 'Artwork%20Check.mov', 'notes.txt', 'Seina%CC%88joki.webm', 'old', '.DS_Store'],
    '/Volumes/Team_Folder/_tuts/old': ['Ancient.mp4'],
};
const r4 = list();
check('picks up mp4/mov/webm only', r4.files.map(f => f.name.normalize('NFC')).sort(), ['OVSwap', 'Seinäjoki', 'Artwork Check'].map(s => s.normalize('NFC')).sort());
// DECOMPOSED, exactly as CLAUDE.md says macOS stores it: decodeURI hands back
// "Seina" + a combining diaeresis, not the precomposed letter. It is why
// tutorialKey() folds accents rather than comparing decoded names directly --
// a clip named on a Mac and a tool label typed in the registry would never
// have keyed the same.
check('decoded accent is DECOMPOSED (NFD), not precomposed',
    r4.files.filter(f => f.name.normalize('NFC') === 'Seinäjoki')[0].name === 'Seinäjoki'.normalize('NFD'), true);
check('subfolder is NOT descended into', r4.files.filter(f => f.path.indexOf('/old/') !== -1).length, 0);
check('non-video is dropped', r4.files.filter(f => f.name === 'notes').length, 0);
check('percent-escaped name is DECODED', r4.files.filter(f => f.name === 'Artwork Check').length, 1);
check('path is the full fsName', r4.files.filter(f => f.name === 'OVSwap')[0].path, '/Volumes/Team_Folder/_tuts/OVSwap.mp4');

// 5. Uppercase extensions -- QuickTime writes .MOV on some machines.
tree['/Volumes/Team_Folder/_tuts'] = ['LOUD.MP4', 'Screen Recording.MOV'];
check('uppercase extensions match', list().files.map(f => f.name).sort(), ['LOUD', 'Screen Recording']);

// 6. A dot in the name must not eat the extension test.
tree['/Volumes/Team_Folder/_tuts'] = ['OV Swap v1.2.mp4', 'noextension'];
check('dotted name keeps its stem', list().files.map(f => f.name), ['OV Swap v1.2']);


// --- The MATCHING half (lib/tutorials.ts's tutorialKey) ----------------------
// Kept in the same probe as the listing because they only mean anything
// together: a clip the host finds and the frontend cannot key to a tool is the
// same outcome as no clip at all, and neither half fails visibly.
function tutorialKey(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '');
}
console.log('');
check('filename keys to the tool id',    tutorialKey('OVSwap'), tutorialKey('ov-swap'));
check('filename keys to the tool label', tutorialKey('OVSwap'), tutorialKey('OV Swap'));
check('spaces/case/punctuation fold',    [tutorialKey('MC It!'), tutorialKey('mc-it'), tutorialKey('MC_It')].join('|'), 'mcit|mcit|mcit');
// "&" and "and" are NOT the same key, so a clip for Find & Replace has to be
// named for the id ("find-and-replace") or the label, not a mix. Documented
// rather than fixed: every rule that makes two different spellings equal is a
// rule that can make two different TOOLS equal.
check('& vs and do NOT fold together',   tutorialKey('Find & Replace') === tutorialKey('find-and-replace'), false);
// The NFD/NFC pair from the listing test above -- both spellings of one name
// must key identically or a clip named on a Mac matches nothing.
check('decomposed and precomposed key the same',
    tutorialKey('Seinäjoki'.normalize('NFD')), tutorialKey('Seinäjoki'.normalize('NFC')));
check('a different tool does NOT match', tutorialKey('OVSwap') === tutorialKey('batch-match'), false);
check('empty name keys to empty',        tutorialKey(''), '');

// Bespoke's three modes are subjects in their own right (lib/tutorialSubject),
// looked up by the same id-or-label pair a tool uses. The tiling mode answers
// to BOTH spellings on purpose: everything written down says MultipleArt, so
// that is what gets typed, but the shorter form must not cost a rename.
console.log('');
check('MultipleArt keys to the mode label', tutorialKey('MultipleArt'), tutorialKey('Multiple Art'));
check('MultiArt keys to the mode id',       tutorialKey('MultiArt'), tutorialKey('multi-art'));
check('the two spellings are DIFFERENT keys',
    tutorialKey('MultipleArt') === tutorialKey('MultiArt'), false);
check('Insitu keys to the insitu mode',     tutorialKey('Insitu'), tutorialKey('insitu'));
// The tool is "It's Bespokin' Time" and one of its three modes is "Bespoke",
// so Bespoke.mp4 legitimately answers in two places -- at the door as the
// tool's own clip, and inside the board mode. That is one clip on one tool,
// never two tools sharing a name.
check('Bespoke keys to the tool and the mode alike',
    [tutorialKey('Bespoke'), tutorialKey('bespoke'), tutorialKey('bespoke-board')].join('|'),
    'bespoke|bespoke|bespokeboard');
check('the tool label still keys',          tutorialKey("It's Bespokin' Time"), 'itsbespokintime');

console.log(fails ? '\n' + fails + ' FAILED' : '\nAll passed.');
process.exit(fails ? 1 : 0);
