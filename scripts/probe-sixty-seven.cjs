// =============================================================================
// scripts/probe-sixty-seven.cjs
// -----------------------------------------------------------------------------
// 67 picks the master behind the comp you are in, and its failure mode is
// silent: the wrong master means another campaign's pitfalls in front of
// somebody checking their own work, with nothing on screen saying so.
//
// The case that bit: Street Fighter and Forgotten Island BOTH have a creative
// called Trio, at the same size and length. Whichever campaign's index was
// walked first used to win.
//
//   yarn build && node scripts/probe-sixty-seven.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

// Two campaigns, one shared creative name.
// A campaign root holds AE/ and Renders/ as siblings, which is what the
// studio's own convention says and what OV Library walks.
const TREES = {
    '/M/FID': ['AE', 'Renders'],
    '/M/SF': ['AE', 'Renders'],
    '/M/FID/AE': ['TRIO'],
    '/M/FID/AE/TRIO': ['FID_INTL_Trio_DOOH_1920x1080px_15s_OV.aep'],
    // The render tree is a sibling of AE, filed under the creative FOLDER's
    // own spelling -- which is not how the filename spells it.
    '/M/FID/Renders': ['TRIO'],
    '/M/FID/Renders/TRIO': ['FID_INTL_Trio_DOOH_1920x1080px_15s_OV.mp4'],
    '/M/SF/AE': ['TRIO'],
    '/M/SF/Renders': [],
    '/M/SF/AE/TRIO': ['SF_INTL_Trio_DOOH_1920x1080px_15s_OV.aep'],
};
let tree = TREES;

function File(p) { if (!(this instanceof File)) return new File(p); this.fsName = p; this.name = String(p).split('/').pop(); }
function Folder(p) {
    if (!(this instanceof Folder)) return new Folder(p);
    this.fsName = String(p).length > 1 ? String(p).replace(/\/+$/, '') : p;
    this.name = this.fsName.split('/').pop();
}
Object.defineProperty(Folder.prototype, 'exists', { get() { return Object.prototype.hasOwnProperty.call(tree, this.fsName); } });
Object.defineProperty(File.prototype, 'exists', { get() { return true; } });
Folder.prototype.getFiles = function () {
    return (tree[this.fsName] || []).map((k) => {
        const q = this.fsName + '/' + k;
        return tree[q] ? new Folder(q) : new File(q);
    });
};

// app.settings holds the campaign list, tab separated, as review.ts writes it.
const settings = {
    OVLibCampaigns: ['Forgotten Island\t/M/FID', 'Street Fighter\t/M/SF'].join('\n'),
};
let activeComp = null;
const sandbox = {
    Folder, File,
    app: {
        project: { get activeItem() { return activeComp; }, numItems: 0, item: () => null },
        settings: {
            haveSetting: (sec, k) => Object.prototype.hasOwnProperty.call(settings, k),
            getSetting: (sec, k) => settings[k] || '',
            saveSetting: (sec, k, v) => { settings[k] = v; },
        },
    },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.userData = new Folder('/userdata');
vm.runInContext(src, vm.createContext(sandbox));
const A = sandbox.$['com.xyi.toolbox'] || sandbox['com.xyi.toolbox'];
if (!A || typeof A.sixtySevenContext !== 'function') { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };
const ask = (compName) => {
    activeComp = { name: compName, numLayers: 1 };
    A.invalidateMastersIndex();
    return A.sixtySevenContext();
};

console.log('1. two campaigns, one creative name\n');
let r = ask('SF_INTL_Trio_DOOH_1920x1080px_15s_CY_V01');
say(r.success, 'an SF comp resolves', r.error || '');
say(r.masterName === 'SF_INTL_Trio_DOOH_1920x1080px_15s_OV.aep', 'to SF\'s Trio master', r.masterName);
say(r.campaign === 'Street Fighter', 'and to the Street Fighter campaign', r.campaign);

r = ask('FID_INTL_Trio_DOOH_1920x1080px_15s_IT_V01');
say(r.masterName === 'FID_INTL_Trio_DOOH_1920x1080px_15s_OV.aep', 'a FID comp resolves to FID\'s', r.masterName);
say(r.campaign === 'Forgotten Island', 'and to Forgotten Island', r.campaign);

console.log('\n2. the render behind that master');
r = ask('FID_INTL_Trio_DOOH_1920x1080px_15s_IT_V01');
say((r.renders || []).length > 0, 'a render is found', JSON.stringify(r.renders));
say((r.renders || [])[0] && /15s_OV\.mp4$/.test(r.renders[0].path), 'and it is the master\'s own', (r.renders || [])[0] && r.renders[0].path);
say(r.creativeFolder === 'TRIO', 'the creative folder is read off the master\'s path, not the filename', r.creativeFolder);

console.log('\n3. what it reads off the name');
r = ask('SF_INTL_Trio_DOOH_1920x1080px_15s_CY_V01');
say(r.creative === 'Trio', 'the creative', r.creative);
say(r.size === '1920x1080', 'the size', r.size);
say(/15/.test(r.duration || ''), 'the duration', r.duration);
say(r.territory === 'CY', 'the territory', r.territory);

console.log('\n4. a prefix nobody has masters for');
r = ask('ZZZ_INTL_Trio_DOOH_1920x1080px_15s_CY_V01');
say(r.success && !r.masterName, 'answers without a master rather than taking someone else\'s', r.masterName || '(none)');

console.log('\n5. a name that is not a deliverable');
r = ask('Comp 1');
say(!r.success, 'refuses, and says why', r.error);

console.log(fails === 0 ? '\nCLEAN — the master belongs to the comp\'s own campaign.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
