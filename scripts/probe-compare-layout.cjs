// =============================================================================
// scripts/probe-compare-layout.cjs  (after `yarn build`)
// -----------------------------------------------------------------------------
// Every comparison (Review, 67's compare icon, OV Library) lays out through
// compareLayout: side by side, or STACKED once the frame is wider than 2:1,
// with the comp's longer side capped. Checked against the real sizes that
// asked for it (Malaysia's 4480x384, 3840x1080) and the ones that must not
// change (1920x1080, portrait).
// =============================================================================
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('dist/cep/jsx/index.js', 'utf8');
const sb = { app: { settings: { haveSetting: () => false, getSetting: () => '', saveSetting() {} }, project: {} }, $: { writeln() {}, global: null }, BridgeTalk: { appName: 'aftereffects' }, File: function () {}, Folder: function () {}, alert() {}, decodeURI, encodeURI, parseInt, parseFloat, isNaN, Math, Date, JSON, String, Number, Array, Object, RegExp, Error };
vm.runInContext(src, vm.createContext(sb));
let a = null;
for (const r of [sb.$, sb]) for (const k of Object.keys(r)) { const v = r[k]; if (!a && v && typeof v === 'object' && typeof v.compareLayout === 'function') a = v; }
if (!a) { console.log('EXPORT NOT REACHABLE'); process.exit(1); }
let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };
const inside = (L, c) => c[0] - L.boxW / 2 >= -0.5 && c[0] + L.boxW / 2 <= L.compW + 0.5 && c[1] - L.boxH / 2 >= -0.5 && c[1] + L.boxH / 2 <= L.compH + 0.5;

const hd = a.compareLayout(1920, 1080, 3840);
check(!hd.stacked && hd.compW === 3840 && hd.compH === 1080 && hd.first[0] < hd.second[0] && hd.first[1] === hd.second[1], '1920x1080 stays side by side, reference left, full size', hd);
const pt = a.compareLayout(1080, 1920, 3840);
check(!pt.stacked && pt.compW === 2160 && pt.compH === 1920, 'portrait stays side by side', pt);
const two = a.compareLayout(2000, 1000, 0);
check(!two.stacked, 'exactly 2:1 is not "above 2": side by side');
const my = a.compareLayout(4480, 384, 3840);
check(my.stacked && my.first[1] < my.second[1] && my.first[0] === my.second[0], "Malaysia's 4480x384 stacks, reference on top", my);
check(my.compW === 3840 && Math.max(my.compW, my.compH) <= 3840 && my.compH === Math.round(768 * 3840 / 4480), '…scaled so its longer side fits the cap, in proportion', my);
const uhd = a.compareLayout(3840, 1080, 3840);
check(uhd.stacked && uhd.compW === 3840 && uhd.compH === 2160, '3840x1080 stacks into a 3840x2160 comp, nothing scaled', uhd);
const cin = a.compareLayout(1920, 858, 0);
check(cin.stacked && cin.compW === 1920 && cin.compH === 1716, "the legacy 1920x858 (2.24:1) stacks too; OV Library's comp is uncapped", cin);
for (const L of [hd, pt, my, uhd, cin]) check(inside(L, L.first) && inside(L, L.second) && (L.stacked ? L.boxH * 2 === L.compH || Math.abs(L.boxH * 2 - L.compH) <= 1 : Math.abs(L.boxW * 2 - L.compW) <= 1), `${L.compW}x${L.compH}: both boxes inside the comp, splitting it evenly`);

console.log(fails ? `\n${fails} FAILED` : '\nCLEAN — every comparison sits side by side up to 2:1 and stacks past it.');
process.exit(fails ? 1 : 0);
