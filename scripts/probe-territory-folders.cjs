// =============================================================================
// scripts/probe-territory-folders.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// territoryCheck over every Markets folder name on the share. Anything turning
// a Wrike code into a folder (Deliver, Review's jobs, CSV Localiser's pick)
// compares territoryCheck(code) with territoryCheck(folder). Street Fighter's
// Turkey folder is "Turkiye", which resolved to nothing, so its Renders were
// never opened ("no renders" beside a folder holding them). Czechia likewise;
// Korea resolved to NORTH Korea. Frontcards resolve CODES only and must not
// change.
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');
const sb = { app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} } }, $: { writeln() {}, global: null }, BridgeTalk: { appName: 'aftereffects' }, alert() {}, File: function () {}, Folder: function () {}, decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error };
vm.runInContext(src, vm.createContext(sb));
let a = null;
for (const r of [sb.$, sb]) for (const k of Object.keys(r)) { const v = r[k]; if (!a && v && typeof v === 'object' && typeof v.territoryCheck === 'function') a = v; }
if (!a) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }
let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };
const t = a.territoryCheck;

// Every territory folder seen across the campaigns' Markets roots (2026-09-30).
const folders = 'Argentina,Australia,Austria,Azerbaijan,Belgium,Bolivia,Brazil,Bulgaria,Cambodia,Chile,China,Colombia,Croatia,Cyprus,Czechia,Denmark,Egypt,Finland,France,Georgia,Germany,Greece,Hungary,Iceland,India,Indonesia,Italy,Japan,Kazakhstan,Korea,Kyrgyzstan,Latvia,Lithuania,Malaysia,Mexico,Netherlands,New Zealand,New_Zealand,Norway,Panama,Peru,Philippines,Poland,Portugal,Serbia,Singapore,Slovakia,Slovenia,South Africa,South_Africa,Spain,Sweden,Switzerland,Taiwan,Thailand,Turkey,Turkiye,UK,Ukraine,Uruguay,Uzbekistan,Vietnam'.split(',');
const miss = folders.filter((f) => !t(f));
check(miss.length === 0, 'every real Markets folder resolves to a country', miss);
for (const [code, folder] of [['TR', 'Turkiye'], ['TR', 'Türkiye'], ['TR', 'Turkey'], ['CZ', 'Czechia'], ['KR', 'Korea'], ['NZ', 'New_Zealand'], ['ZA', 'South_Africa'], ['UK', 'UK']]) {
    check(t(code) && t(code) === t(folder), `${code} and "${folder}" are the same country`, [t(code), t(folder)]);
}
check(t('Korea') !== t('KP'), 'Korea is South Korea, never North', t('Korea'));
// Frontcards resolve codes: unchanged.
check(t('DE') === 'Germany' && t('BE_DE') !== 'Germany' && t('FR') === 'France' && t('TR') === 'Turkey', 'codes resolve exactly as before (DE never BE_DE)');
console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — every market folder is the country its code says.');
process.exit(fails ? 1 : 0);
