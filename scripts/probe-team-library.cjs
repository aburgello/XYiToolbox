// =============================================================================
// scripts/probe-team-library.cjs
// -----------------------------------------------------------------------------
// Two things that used to live on one machine only, now shared through the
// team folder -- driven against a STUBBED team folder, since the real one is
// the file every artist's panel reads on open.
//
//   1. CAMPAIGN BANNERS. Street Fighter was shared before its banner was
//      pinned and pinning never published it, so colleagues saw none; and the
//      banner that did travel (Forgotten Island) was a Desktop path. Banners
//      are now copied into misc/banners/ and published on pin, on share and
//      -- to fill gaps already out there -- on sync.
//   2. THE LOCALISED LIBRARY. Each machine filled its own by scanning every
//      territory. Find the Motion now writes misc/loclib/<campaign>.json and
//      opening a campaign merges it in: additive both ways.
//
//   yarn build && node scripts/probe-team-library.cjs
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');

const TEAM = '/Volumes/newmedia/_XYiToolbox';
let dirs = {};
let files = {};
const parentOf = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? String(p).slice(0, i) : null; };
const has = (p) => Object.prototype.hasOwnProperty.call(files, p);

function File(p) {
    if (!(this instanceof File)) return new File(p);
    this.fsName = p; this.name = encodeURI(String(p).split('/').pop());
    this.encoding = ''; this._mode = ''; this._buf = '';
    this.open = (mode) => {
        this._mode = mode;
        if (mode === 'r') return has(p);
        this._buf = ''; return true;
    };
    this.read = () => files[p];
    this.write = (t) => { this._buf += t; return true; };
    this.close = () => { if (this._mode !== 'r') files[p] = this._buf; return true; };
    this.remove = () => { delete files[p]; return true; };
    this.copy = (dest) => { if (!has(p) || !dirs[parentOf(dest)]) return false; files[dest] = files[p]; return true; };
}
Object.defineProperty(File.prototype, 'exists', { get() { return has(this.fsName); } });
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
vm.runInContext(src, vm.createContext(sandbox));

let aeft = null;
for (const root of [sandbox.$, sandbox]) {
    for (const k of Object.keys(root)) {
        const v = root[k];
        if (v && typeof v === 'object' && typeof v.teamLocLibPublish === 'function') { aeft = v; break; }
    }
    if (aeft) break;
}
if (!aeft) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + extra : '')); };

const S = 'XYiToolbox';
const SHARED = TEAM + '/misc/shared-campaigns.json';
const writeShared = (entries) => {
    dirs[TEAM + '/misc'] = true;
    files[SHARED] = JSON.stringify({ type: 'xyi-shared-campaigns', version: 1, entries });
};
const sharedRow = (name) => (JSON.parse(files[SHARED]).entries || []).filter((r) => r.name === name)[0] || {};
const machine = (owner) => { settings = {}; settings[skey(S, 'TeamFolderPath')] = TEAM; if (owner) settings[skey(S, 'TeamMachineOwner')] = owner; };
const reset = () => { dirs = {}; files = {}; dirs[TEAM] = true; };

const SF = 'Street Fighter';
const MASTERS = '/Volumes/paramount/SF/Masters';
const MARKETS = '/Volumes/paramount/SF/Markets';
const DESKTOP = '/Users/antonio/Desktop/sf-banner.png';
const NAS_IMG = '/Volumes/paramount/SF/Print/banner.jpg';

console.log('Team sharing — banners and the Localised Library\n');

console.log('1. pinning publishes, copied into the team folder');
reset(); machine('Antonio');
writeShared([{ name: SF, mastersRoot: MASTERS, marketsRoot: MARKETS, banner: '' }]);
files[DESKTOP] = 'PNGDATA';
let r = aeft.teamPublishCampaignBanner(SF, DESKTOP);
const teamCopy = TEAM + '/misc/banners/street-fighter.png';
say(r.success && sharedRow(SF).banner === teamCopy, 'a Desktop banner is shared as a TEAM-FOLDER copy', sharedRow(SF).banner);
say(files[teamCopy] === 'PNGDATA', 'and the copy is really there');

console.log('\n2. never from an untagged machine, never over an unreadable file');
reset(); machine('');
writeShared([{ name: SF, mastersRoot: MASTERS, marketsRoot: MARKETS, banner: '' }]);
files[NAS_IMG] = 'JPG';
r = aeft.teamPublishCampaignBanner(SF, NAS_IMG);
say(!r.success && sharedRow(SF).banner === '', 'untagged: refused, file untouched', r.error);
reset(); machine('Antonio');
files[NAS_IMG] = 'JPG';
r = aeft.teamPublishCampaignBanner(SF, NAS_IMG);
say(!r.success && !has(SHARED), 'no shared file readable: refused, nothing written from nothing', r.error);
reset(); machine('Antonio');
writeShared([]);
files[NAS_IMG] = 'JPG';
r = aeft.teamPublishCampaignBanner(SF, NAS_IMG);
say(r.success && r.message === 'not shared', 'a campaign not shared yet: nothing to attach it to', r.message);

console.log('\n3. a personal path that cannot be copied is not published');
reset(); machine('Antonio');
writeShared([{ name: SF, mastersRoot: MASTERS, marketsRoot: MARKETS, banner: '' }]);
r = aeft.teamPublishCampaignBanner(SF, DESKTOP); // file not on this machine
say(!r.success && sharedRow(SF).banner === '', 'a Desktop path nobody can open never reaches the team', r.error);

console.log('\n4. sharing publishes the pinned banner — even "already in the team library"');
reset(); machine('Antonio');
writeShared([{ name: SF, mastersRoot: MASTERS, marketsRoot: MARKETS, banner: '' }]);
files[NAS_IMG] = 'JPG';
aeft.setCampaignBanner(SF, NAS_IMG);
r = aeft.teamShareLocCampaign(JSON.stringify({ name: SF, marketsRoot: MARKETS, mastersRoot: MASTERS }));
say(/already in the team library/.test(r.message || ''), 'the share itself is the usual no-op', r.message);
say(sharedRow(SF).banner === TEAM + '/misc/banners/street-fighter.jpg', 'but the banner now travels with it', sharedRow(SF).banner);

console.log('\n5. sync fills the team gap, and fixes a colleague stuck on a Desktop path');
reset(); machine('Antonio');
writeShared([
    { name: SF, mastersRoot: MASTERS, marketsRoot: MARKETS, banner: '' },
    { name: 'Forgotten Island', mastersRoot: '/Volumes/u/FI/Masters', marketsRoot: '/Volumes/u/FI/Markets', banner: '/Users/antonio/Desktop/fi.png' },
]);
files[NAS_IMG] = 'JPG';
files['/Users/antonio/Desktop/fi.png'] = 'FIPNG';
aeft.setCampaignBanner(SF, NAS_IMG);
aeft.setCampaignBanner('Forgotten Island', '/Users/antonio/Desktop/fi.png');
aeft.teamSyncShared();
say(sharedRow(SF).banner === TEAM + '/misc/banners/street-fighter.jpg', 'Antonio’s sync publishes the missing SF banner', sharedRow(SF).banner);
say(sharedRow('Forgotten Island').banner === TEAM + '/misc/banners/forgotten-island.png', 'and replaces FI’s Desktop path with a team copy', sharedRow('Forgotten Island').banner);
// A colleague: nothing pinned for SF, and FI's old Desktop path, which does
// not open on her machine.
machine('Maria');
delete files['/Users/antonio/Desktop/fi.png'];
aeft.setCampaignBanner('Forgotten Island', '/Users/antonio/Desktop/fi.png');
aeft.teamSyncShared();
say(aeft.loadCampaignBanner(SF) === TEAM + '/misc/banners/street-fighter.jpg', 'Maria gets the SF banner', aeft.loadCampaignBanner(SF));
say(aeft.loadCampaignBanner('Forgotten Island') === TEAM + '/misc/banners/forgotten-island.png', 'and her stranded FI path is replaced', aeft.loadCampaignBanner('Forgotten Island'));
machine('Maria');
files['/Volumes/maria/own.jpg'] = 'MINE';
aeft.setCampaignBanner(SF, '/Volumes/maria/own.jpg');
aeft.teamSyncShared();
say(aeft.loadCampaignBanner(SF) === '/Volumes/maria/own.jpg', 'a banner somebody chose is never overwritten');

console.log('\n6. the Localised Library catalogue');
reset(); machine('Antonio');
aeft.addLocLibComponent(SF, 'Czechia', 'SF_Date_CZ', MARKETS + '/Czechia/Support_Motion/Date/SF_Date_CZ.aep', 'My Picks', 'Trio');
aeft.addLocLibComponent(SF, 'Latvia', 'SF_Date_LV', MARKETS + '/Latvia/Support_Motion/Date/SF_Date_LV.aep');
aeft.addLocLibComponent('Other Job', 'Italy', 'X', '/Volumes/x/X.aep');
r = aeft.teamLocLibPublish(SF);
const CAT = TEAM + '/misc/loclib/street-fighter.json';
const cat = () => JSON.parse(files[CAT]);
say(r.success && cat().entries.length === 2, 'Find the Motion publishes this campaign’s rows only', r.message || r.error);
say(cat().updatedBy === 'Antonio', 'saying who');
say(cat().entries.every((e) => e.folder === undefined), 'without anybody’s own folder filing');
say(cat().entries.some((e) => e.creative === 'Trio'), 'but with the creative');

// A colleague with an empty library.
machine('Maria');
r = aeft.teamLocLibPull(SF);
say(r.read && r.added === 2 && aeft.loadLocLibComponents().length === 2, 'a colleague opens to a full library, no scan', JSON.stringify(r));
r = aeft.teamLocLibPull(SF);
say(r.added === 0 && aeft.loadLocLibComponents().length === 2, 'pulling again adds nothing twice');

// She scans a territory nobody had; publishing must not erase Antonio's.
aeft.addLocLibComponent(SF, 'Chile', 'SF_Date_CH', MARKETS + '/Chile/Support_Motion/Date/SF_Date_CH.aep');
aeft.teamLocLibPublish(SF);
say(cat().entries.length === 3, 'publishing is a union: two people’s scans add up', cat().entries.length + ' rows');

// Antonio removed a row locally; a pull must not put his own filing back
// over it, and must never remove his rows.
machine('Antonio');
aeft.addLocLibComponent(SF, 'Czechia', 'SF_Date_CZ', MARKETS + '/Czechia/Support_Motion/Date/SF_Date_CZ.aep', 'My Picks', 'Trio');
r = aeft.teamLocLibPull(SF);
const mine = aeft.loadLocLibComponents().filter((c) => c.campaign === SF);
say(r.added === 2 && mine.length === 3, 'pull only adds', JSON.stringify(r));
say(mine.filter((c) => c.territory === 'Czechia')[0].folder === 'My Picks', 'and leaves somebody’s own folder filing alone');

console.log('\n7. degrades quietly');
machine('Antonio');
r = aeft.teamLocLibPull('Nobody Shared This');
say(!r.read && r.added === 0, 'no catalogue yet: "couldn’t read", nothing changed', JSON.stringify(r));
machine('');
r = aeft.teamLocLibPublish(SF);
say(!r.success, 'untagged machine: never publishes', r.error);
machine('Antonio');
r = aeft.teamLocLibPublish('Empty Campaign');
say(r.success && !has(TEAM + '/misc/loclib/empty-campaign.json'), 'an empty list never becomes a catalogue', r.message);

console.log('\n8. Global Components, and removals that travel');
reset(); machine('Antonio');
const LOGO = '/Volumes/paramount/SF/Brand/Logo_Pack';
const FONT = '/Volumes/paramount/SF/Brand/SF_Font.otf';
aeft.addLocLibGlobal(SF, 'Logo_Pack', LOGO, 'folder');
aeft.addLocLibGlobal(SF, 'SF_Font', FONT, 'file');
r = aeft.addLocLibGlobal(SF, 'SF_Font', FONT, 'file');
say(r.message === 'already there', 'adding the same path twice keeps one', r.message);
aeft.teamLocLibPublish(SF);
say(cat().entries.filter((e) => e.territory === '__GLOBAL__').length === 2, 'globals travel in the catalogue');
say(cat().entries.filter((e) => e.path === LOGO)[0].kind === 'folder', '…a folder still marked as one');
machine('Maria');
aeft.teamLocLibPull(SF);
const mariaGlobals = () => aeft.loadLocLibComponents().filter((c) => c.territory === '__GLOBAL__');
say(mariaGlobals().length === 2 && mariaGlobals().filter((c) => c.path === LOGO)[0].kind === 'folder', 'a colleague gets them, folder and all');
// Antonio removes the font.
machine('Antonio');
aeft.removeLocLibComponent(SF, '__GLOBAL__', 'SF_Font', FONT);
r = aeft.teamLocLibRemove(SF, FONT);
say(r.success && !cat().entries.some((e) => e.path === FONT) && cat().removed.indexOf(FONT) !== -1, 'removing takes it out of the catalogue and records it', JSON.stringify(cat().removed));
// Maria still has it locally; her next publish must not put it back...
machine('Maria');
aeft.teamLocLibPublish(SF);
say(!cat().entries.some((e) => e.path === FONT), 'a colleague’s publish doesn’t bring a removed file back');
// ...and her next pull takes it out of hers.
aeft.teamLocLibPull(SF);
say(!mariaGlobals().some((c) => c.path === FONT), 'and her pull removes it from her library');
say(mariaGlobals().some((c) => c.path === LOGO), 'leaving everything else');
// Re-adding on purpose clears the removal.
machine('Antonio');
aeft.addLocLibGlobal(SF, 'SF_Font', FONT, 'file');
aeft.teamLocLibPublish(SF, FONT);
say(cat().entries.some((e) => e.path === FONT) && cat().removed.indexOf(FONT) === -1, 'adding it again on purpose brings it back for everyone');
machine('');
r = aeft.teamLocLibRemove(SF, LOGO);
say(!r.success && cat().entries.some((e) => e.path === LOGO), 'an untagged machine can’t remove for the team', r.error);

console.log('\n9. folder listing');
reset(); machine('Antonio');
dirs['/Volumes/p/Pack'] = true; dirs['/Volumes/p/Pack/Variants'] = true; dirs['/Volumes/p/Pack/_Old'] = true;
files['/Volumes/p/Pack/b.ai'] = 'x'; files['/Volumes/p/Pack/A.png'] = 'x'; files['/Volumes/p/Pack/.DS_Store'] = 'x';
const listing = aeft.locLibListFolder('/Volumes/p/Pack');
say(JSON.stringify(listing.folders.map((f) => f.name)) === '["Variants"]', 'sub-folders listed, _ folders left out', JSON.stringify(listing.folders.map((f) => f.name)));
say(JSON.stringify(listing.files.map((f) => f.name)) === '["A.png","b.ai"]', 'files sorted, dot-files left out', JSON.stringify(listing.files.map((f) => f.name)));

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — banners reach the team as a copy anyone can open, and a colleague opens to a full library.');
process.exit(fails ? 1 : 0);
