// =============================================================================
// scripts/probe-campaign-share.cjs
// -----------------------------------------------------------------------------
// Drives the BUILT bundle's campaign SHARE pair -- teamShareCampaign (the
// Masters half, behind OV Library / Review) and teamShareLocCampaign (the
// Markets half, behind Localised Library / CSV Localiser) -- plus the
// teamSyncShared pull that reads back what they wrote.
//
// THE QUESTION THIS ANSWERS: a campaign now lands in BOTH local lists when it
// is added, so both Share buttons get pressed, in either order. Neither press
// may make a second row, neither may repoint a root the team has already
// agreed on, and after both the row must carry BOTH halves -- teamSyncShared
// skips a row whose masters half is empty, so a missing one silently costs
// colleagues OV Library and Review while the toast says "already in the team
// library".
//
// Stubbed, deliberately: the real thing writes into the studio's shared team
// folder, which is the one file every artist's panel reads on open.
//
//   yarn build && node scripts/probe-campaign-share.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

const TEAM = '/Volumes/newmedia/_XYiToolbox';
let dirs = {};    // fsName -> true
let files = {};   // fsName -> contents
const parentOf = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : null; };

function File(p) {
    if (!(this instanceof File)) return new File(p);
    this.fsName = p; this.name = encodeURI(String(p).split('/').pop());
    this.encoding = ''; this._mode = ''; this._buf = '';
    this.open = (mode) => {
        this._mode = mode;
        if (mode === 'r') return Object.prototype.hasOwnProperty.call(files, p);
        this._buf = ''; return true;
    };
    this.read = () => files[p];
    this.write = (t) => { this._buf += t; return true; };
    this.close = () => { if (this._mode !== 'r') files[p] = this._buf; return true; };
    this.remove = () => { delete files[p]; return true; };
}
Object.defineProperty(File.prototype, 'exists', { get() { return Object.prototype.hasOwnProperty.call(files, this.fsName); } });
Object.defineProperty(File.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });

function Folder(p) { if (!(this instanceof Folder)) return new Folder(p); this.fsName = p; this.name = encodeURI(String(p).split('/').pop()); }
Object.defineProperty(Folder.prototype, 'exists', { get() { return !!dirs[this.fsName]; } });
Object.defineProperty(Folder.prototype, 'parent', { get() { const q = parentOf(this.fsName); return q ? new Folder(q) : null; } });
Folder.prototype.create = function () { dirs[this.fsName] = true; return true; };
Folder.prototype.getFiles = function () {
    const out = [];
    for (const k of Object.keys(files)) if (parentOf(k) === this.fsName) out.push(new File(k));
    for (const k of Object.keys(dirs)) if (parentOf(k) === this.fsName) out.push(new Folder(k));
    return out;
};

// app.settings with real storage -- the local campaign lists live here, and
// what teamSyncShared pulled is only observable by reading them back.
let settings = {};
const skey = (sec, key) => sec + ' ' + key;
const sandbox = {
    Folder, File,
    app: {
        settings: {
            haveSetting: (sec, key) => Object.prototype.hasOwnProperty.call(settings, skey(sec, key)),
            getSetting: (sec, key) => settings[skey(sec, key)],
            saveSetting: (sec, key, val) => { settings[skey(sec, key)] = String(val); },
        },
        project: null,
    },
    $: { writeln() {}, sleep() {}, global: null },
    BridgeTalk: { appName: 'aftereffects' }, alert() {},
    decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error,
};
sandbox.Folder.selectDialog = () => null;
sandbox.Folder.userData = new Folder('/userdata');
sandbox.File.decode = decodeURI;
const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx);

let aeft = null;
for (const root of [sandbox.$, sandbox]) {
    for (const k of Object.keys(root)) {
        const v = root[k];
        if (v && typeof v === 'object' && typeof v.teamShareCampaign === 'function') { aeft = v; break; }
    }
    if (aeft) break;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };

// The shared file, wherever writeSharedFile decided to put it (misc/, with a
// root fallback -- the probe does not care which, only what is in it).
const rows = () => {
    const hit = Object.keys(files).filter((k) => /shared-campaigns\.json$/.test(k))[0];
    if (!hit) return [];
    return JSON.parse(files[hit]).entries || [];
};
const rowFor = (name) => rows().filter((r) => r.name.toLowerCase() === name.toLowerCase())[0] || {};

// A machine with the team folder mounted and nothing of its own yet. The
// team-folder path is written straight into the settings stub because it is
// normally set by a folder picker, which has no answer in here.
const freshMachine = () => { settings = {}; settings[skey('XYiToolbox', 'TeamFolderPath')] = TEAM; };
const reset = () => { dirs = {}; files = {}; dirs[TEAM] = true; freshMachine(); };

const MARKETS = '/Volumes/paramount/StreetFighter/Digital/INT/XY026205_INTL_DIGITAL_Outdoor_Markets';
const MASTERS = '/Volumes/paramount/StreetFighter/Digital/INT/XY026204_INTL_DIGITAL_Outdoor_Masters';
// The panel sends BOTH halves when it knows both -- the second argument is
// what the frontend looked up (the other list's record, else the sibling on
// disk, else ""). These stubs mirror that, so a press from either tool is
// exercised in the shape it really arrives in.
const shareLoc = (name, root, other) => aeft.teamShareLocCampaign(JSON.stringify({ name: name, marketsRoot: root, mastersRoot: other || '' }));
const shareOV = (name, root, other) => aeft.teamShareCampaign(JSON.stringify({ name: name, mastersRoot: root, marketsRoot: other || '', banner: '' }));

console.log('Campaign share — one job, two halves, one row\n');

console.log('1. Localise first, then OV Library — each knowing only its own half');
reset();
let r = shareLoc('Street Fighter', MARKETS);
say(r.success && rows().length === 1, 'sharing the Markets half writes one row', r.message || r.error);
say(rowFor('Street Fighter').mastersRoot === '', 'with the Masters half still blank');

r = shareOV('Street Fighter', MASTERS);
say(rows().length === 1, 'sharing the Masters half does NOT add a second row', rows().length + ' row(s)');
say(rowFor('Street Fighter').mastersRoot === MASTERS, 'it fills the blank half in', r.message || r.error);
say(rowFor('Street Fighter').marketsRoot === MARKETS, 'and leaves the Markets half exactly as it was');

console.log('\n2. pressing either button again');
r = shareOV('Street Fighter', MASTERS);
say(r.success && rows().length === 1 && /already in the team library/.test(r.message), 'OV Library: no-op, and says so', r.message);
r = shareLoc('Street Fighter', MARKETS);
say(r.success && rows().length === 1 && /already in the team library/.test(r.message), 'Localise: no-op, and says so', r.message);

console.log('\n3. never repoints a root the team already has');
shareOV('Street Fighter', '/Volumes/someone_elses_mount/Masters');
say(rowFor('Street Fighter').mastersRoot === MASTERS, 'a different Masters path does not overwrite the shared one');
shareLoc('Street Fighter', '/Volumes/elsewhere/Markets');
say(rowFor('Street Fighter').marketsRoot === MARKETS, 'nor does a different Markets path');

console.log('\n4. the other order, and a name cased differently');
reset();
shareOV('Street Fighter', MASTERS);
shareLoc('STREET FIGHTER', MARKETS);
say(rows().length === 1, 'a differently-cased name lands on the same row', rows().length + ' row(s)');
say(rowFor('Street Fighter').mastersRoot === MASTERS && rowFor('Street Fighter').marketsRoot === MARKETS,
    'and the row ends up carrying both halves');

console.log('\n5. what a colleague actually pulls (teamSyncShared)');
reset();
shareLoc('Street Fighter', MARKETS);
freshMachine();
let sync = aeft.teamSyncShared();
say(sync.newLocCampaigns === 1, 'the Markets half alone reaches Localised Library / CSV Localiser');
say(sync.newCampaigns === 0, 'and nothing reaches OV Library / Review — the half that was missing');

freshMachine();
shareOV('Street Fighter', MASTERS);
freshMachine();
sync = aeft.teamSyncShared();
say(sync.newCampaigns === 1 && sync.newLocCampaigns === 1, 'once both are shared, a fresh machine gets both lists',
    'OV ' + sync.newCampaigns + ' / Loc ' + sync.newLocCampaigns);
const ov = aeft.loadCampaigns();
say(ov.length === 1 && ov[0].mastersRoot === MASTERS, 'pointing OV Library at the right Masters folder');

console.log('\n6. ONE press, from a machine that holds both halves');
for (const from of ['OV Library', 'CSV Localiser']) {
    reset();
    if (from === 'OV Library') shareOV('Street Fighter', MASTERS, MARKETS);
    else shareLoc('Street Fighter', MARKETS, MASTERS);
    say(rows().length === 1, from + ': one press writes one row', rows().length + ' row(s)');
    say(rowFor('Street Fighter').mastersRoot === MASTERS && rowFor('Street Fighter').marketsRoot === MARKETS,
        '  carrying both halves');
    freshMachine();
    const sy = aeft.teamSyncShared();
    say(sy.newCampaigns === 1 && sy.newLocCampaigns === 1,
        '  and a colleague gets BOTH lists off that single press',
        'OV ' + sy.newCampaigns + ' / Loc ' + sy.newLocCampaigns);
}

console.log('\n7. a machine that only knows one half still shares it');
reset();
r = shareOV('Street Fighter', MASTERS, '');
say(r.success && rows().length === 1 && rowFor('Street Fighter').mastersRoot === MASTERS,
    'the half it has goes to the team', r.message || r.error);
say(!rowFor('Street Fighter').marketsRoot, 'the half it does not have is left blank, not invented');
r = shareLoc('Street Fighter', MARKETS, '');
say(rows().length === 1 && rowFor('Street Fighter').marketsRoot === MARKETS,
    'and somebody else filling it in later still lands on the same row', r.message || r.error);

console.log(fails === 0 ? '\nCLEAN — one press shares the whole campaign; still one row, still no repointing.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
