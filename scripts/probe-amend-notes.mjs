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

// LOOSER SHAPES. Norway Batch_02, 2026-10-01: the file given as a full path,
// under a thank-you. It read as "a newer comment, with no amends in it".
const K1200 = amendKey("SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO");
const nick = parseAmends(`Thanks @Antonio Burgello

/Volumes/paramount/StreetFighter/Digital/INT/XY026205_INTL_DIGITAL_Outdoor_Campaign_Markets/Norway/Renders/Batch_02/SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO_V02.mov
:large_orange_diamond: I think the top of the paramount logo is being chopped off? Can you check this`);
check((nick.byKey[K1200] || []).length === 1 && /chopped off/.test(nick.byKey[K1200][0].text) && nick.byKey[K1200][0].version === 2
  && nick.byKey[K1200][0].name === "SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO_V02.mov",
  "a full path is the file at the end of it, version and all", nick.byKey);
check(Object.keys(nick.byKey).length === 1 && nick.general.length === 1 && nick.general[0] === "Thanks @Antonio Burgello", "…and the thank-you above it is general", nick.general);
const win = parseAmends("P:\\Renders\\Batch_02\\SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO_V02.mov\nlogo is cut off");
check((win.byKey[K1200] || []).length === 1, "a Windows path too");
const spaced = parseAmends("/Volumes/new media/Street Fighter 2/Job Folder/Renders/SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO_V02.mov\nlogo is cut off");
check((spaced.byKey[K1200] || []).length === 1 && spaced.byKey[K1200][0].text === "logo is cut off", "a path with spaces in its folders", spaced.byKey);

const same = parseAmends("SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO_V02.mov - the logo is cut off at the top");
check((same.byKey[K1200] || []).length === 1 && same.byKey[K1200][0].text === "the logo is cut off at the top", "the note on the filename's own line", same.byKey);
const inside = parseAmends("Can you check the logo on SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO_V02, it looks chopped");
check((inside.byKey[K1200] || []).length === 1 && inside.byKey[K1200][0].text === "Can you check the logo on SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO_V02, it looks chopped"
  && inside.byKey[K1200][0].version === 2, "a name inside a sentence: the sentence is the note", inside.byKey);
const two = parseAmends("SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO_V02 and SF_INTL_Trio_DOOH_OdeonPOST_3840x1152px_30s_NO_V01: date is off the baseline\nand the bugs are too small");
const kOdeon = amendKey("SF_INTL_Trio_DOOH_OdeonPOST_3840x1152px_30s_NO");
check((two.byKey[K1200] || []).length === 1 && (two.byKey[kOdeon] || []).length === 1 && two.byKey[kOdeon][0].text === "date is off the baseline\nand the bugs are too small",
  "two names in one line share the note, and the line under it", two.byKey);
check(Object.keys(parseAmends("please redo the 1920x1080 30s version and the 9x16 one").byKey).length === 0, "a sentence naming a size and a length is still not a deliverable");

console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — an amend comment splits onto the deliverables it names.");
process.exit(fails ? 1 : 0);
