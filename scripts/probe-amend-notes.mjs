// =============================================================================
// scripts/probe-amend-notes.mjs  (no build needed)
// -----------------------------------------------------------------------------
// Splits the real Norway Batch_02 amend comment (Wrike, 2026-09-30) the way
// the tracker does, and checks each note lands on its deliverable.
// =============================================================================
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(tmpdir(), "xyi-amend-notes.mjs");
await build({ entryPoints: ["src/js/main/lib/amendNotes.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const { parseAmends, amendKey, showShortcodes } = await import(pathToFileURL(out).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };

const NORWAY = `SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.mov
SF_INTL_Trio_DOOH_NfkinoPOST_1728x768px_30s_NO_V01.mov
🔶 The paramount logo is cut off at the top

SF_INTL_Trio_DOOH_OdeonPOST_3840x1152px_30s_NO_V01.mov
🔶 The paramount logo is cut off on the RHS

SF_INTL_Trio_DOOH_NfkinoPOST_1160x800px_30s_NO_V02.mov
🔶On the MC please move the TT and date to the right so the TT isn't cut off.

SF_INTL_Trio_DOOH_NfkinoPOST_1160x800px_30s_NO_V02.mov
🔶 please keep the date on the same base line as the bugs

✅ The others are approved`;
const p = parseAmends(NORWAY);
const at = (n) => p.byKey[amendKey(n)] || [];
check(at("SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO").length === 1 && at("SF_INTL_Trio_DOOH_NfkinoPOST_1728x768px_30s_NO")[0].text === "The paramount logo is cut off at the top",
  "two filenames over one note: the note is on both", [at("SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO"), at("SF_INTL_Trio_DOOH_NfkinoPOST_1728x768px_30s_NO")]);
check(at("SF_INTL_Trio_DOOH_OdeonPOST_3840x1152px_30s_NO")[0].text === "The paramount logo is cut off on the RHS", "Odeon gets its own note");
const n1160 = at("SF_INTL_Trio_DOOH_NfkinoPOST_1160x800px_30s_NO");
check(n1160.length === 2 && /move the TT/.test(n1160[0].text) && /same base line/.test(n1160[1].text) && n1160[0].version === 2, "a deliverable named twice collects both notes, with the version reviewed", n1160);
check(!/^[^A-Za-z]/.test(n1160[0].text), "…the 🔶 bullet taken off even with no space after it", n1160[0].text);
check(p.general.length === 1 && p.general[0] === "The others are approved", "the line under no filename is said once, for the job", p.general);
check(Object.keys(p.byKey).length === 4, "four deliverables, nothing else mistaken for one", Object.keys(p.byKey));

const q = parseAmends(`SF_INTL_Trio_DOOH_Odeon_1920x1080px_15s_NO_V01.mov

please redo the 1920x1080 version's end card`);
check((q.byKey[amendKey("SF_INTL_Trio_DOOH_Odeon_1920x1080px_15s_NO")] || []).length === 1 && q.general.length === 0,
  "a blank line between a filename and its note doesn't orphan the note; a sentence mentioning a size isn't a filename", q);
check(amendKey("SF_INTL_Trio_DOOH_Kiwi_9x16_1080x1920px_15s_NO_V02_DOUBLE_RES.mov") === "SF_INTL_TRIO_DOOH_KIWI_1080X1920PX_15S_NO", "keys exactly as the tracker does (version, RES, ratio, extension off)");
check(parseAmends("").general.length === 0 && Object.keys(parseAmends("Looks great, thanks!").byKey).length === 0, "an ordinary comment is general, with no deliverables");

const my = parseAmends(`SF_INTL_RyuHadouken_DINTH_4480x384px_30s_MY_V01
:small_orange_diamond: Please fade out the embers at the end`);
const myNote = (my.byKey[amendKey("SF_INTL_RyuHadouken_DINTH_4480x384px_30s_MY")] || [])[0];
check(myNote && myNote.text === "Please fade out the embers at the end" && myNote.version === 1 && my.general.length === 0,
  "Malaysia's MY 2: a filename with no extension, and a bullet sent as :small_orange_diamond:", my);
check(parseAmends(":white_check_mark: The others are approved").general[0] === "The others are approved", "…and :white_check_mark: comes off the general line too");

check(showShortcodes(":small_orange_diamond: Please fade :white_check_mark: done :not_a_real_one:") === "🔸 Please fade ✅ done :not_a_real_one:", "shown whole, known shortcodes become emoji and unknown ones stay as written");

console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — an amend comment splits onto the deliverables it names.");
process.exit(fails ? 1 : 0);
