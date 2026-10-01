// =============================================================================
// scripts/probe-wrike-message.mjs  (no build needed)
// -----------------------------------------------------------------------------
// The Tracker's "Message for Wrike": fills the three starting messages from a
// batch's facts and checks what is left out, what is asked for, and that
// nothing typed into a template can become markup on the clipboard.
// =============================================================================
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(tmpdir(), "xyi-wrike-message.mjs");
await build({ entryPoints: ["src/js/main/lib/wrikeMessage.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const { DEFAULT_TEMPLATES, TOKENS, uploadNameFor, fieldsOf, fillMessage, toPlain, toHtml, parseTemplates } = await import(pathToFileURL(out).href + "?" + Date.now());

let fails = 0;
const check = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? "  ok    " : "  FAIL  ") + msg + (extra !== undefined ? "   " + JSON.stringify(extra) : "")); };
const T = (id) => DEFAULT_TEMPLATES.find((t) => t.id === id).body;
const M = "/Volumes/paramount/StreetFighter/Digital/INT/XY026205_INTL_DIGITAL_Outdoor_Campaign_Markets";

console.log("1. For review (Panama Batch_01, 2026-09-30)");
const panama = {
    "renders.count": "12", "renders.folder": `${M}/Panama/Renders/Batch_01`, "pdfs.folder": `${M}/Panama/PDFs`,
    "masters.renders": "/Volumes/paramount/StreetFighter/Digital/INT/XY026204_INTL_DIGITAL_Outdoor_Campaign_Masters/Renders/Trio",
};
let f = fillMessage(T("review"), panama, { To: "@James Crouch" });
check(toPlain(f.marked) === `Hey @James Crouch, renders ready:\n\n12 x Renders:\n${M}/Panama/Renders/Batch_01\n\nPDFs:\n${M}/Panama/PDFs\n\nMasters:\n${panama["masters.renders"]}`,
  "the message that was typed by hand, from the batch", toPlain(f.marked));
check(f.dropped.length === 0, "nothing left out");
check(/<b>12 x Renders:<\/b><br>/.test(toHtml(f.marked)) && !/\*\*/.test(toHtml(f.marked)), "headings go on the clipboard bold");
check(fieldsOf(T("review")).join() === "To", "it asks only who it is for");

f = fillMessage(T("review"), { ...panama, "pdfs.folder": "", "masters.renders": "" }, { To: "@James Crouch" });
check(!/PDFs|Masters/.test(f.marked) && f.dropped.join() === "PDFs,Masters", "a territory with no PDFs folder: the block goes, heading and all", f);
f = fillMessage(T("review"), panama, {});
check(/^Hey \[To\], renders ready:/.test(f.marked), "an unfilled name stays visible, never an empty gap", f.marked.split("\n")[0]);

console.log("\n2. Revised (Norway Batch_02)");
const v3 = `${M}/Norway/Renders/Batch_02/SF_INTL_Trio_DOOH_NfkinoPOST_1200x380px_30s_NO_V03.mov`;
f = fillMessage(T("revised"), { "revised.count": "1", "revised.paths": v3 }, { To: "@Nicholas" });
check(toPlain(f.marked) === `Hi @Nicholas, amends are in:\n\n🟠 1 x Revised:\n${v3}`, "the revised render's own path", toPlain(f.marked));
f = fillMessage(T("revised"), { "revised.count": "", "revised.paths": "" }, { To: "@Nicholas" });
check(f.dropped.length === 1 && toPlain(f.marked) === "Hi @Nicholas, amends are in:", "nothing revised yet: no \"0 x Revised\"", f);

console.log("\n3. Delivery, and fields that are asked for each time");
check(fieldsOf(T("delivery")).join() === "To,Upload folder,MASV link", "it asks for the upload folder and the link", fieldsOf(T("delivery")));
check(uploadNameFor(M + "/Taiwan") === "ENT" && uploadNameFor("/Volumes/universal/ForgottenIsland/INT/XY026040_Markets/Denmark") === "PUMA", "the upload is ENT for a Paramount film, PUMA for a Universal one");
check(uploadNameFor("P:\\Universal\\FID\\Markets\\Denmark") === "PUMA" && uploadNameFor("/Volumes/newmedia/ParamountPlus_Idents/Markets/UK") === "Upload" && uploadNameFor("") === "Upload",
  "a whole folder name, either slash; any other studio is Upload, never empty");
f = fillMessage(T("delivery"), { "upload.name": "PUMA" }, { To: "@AM", "Upload folder": "/Volumes/uploads/PUMA/FID/Denmark" });
check(/^PUMA:\n\/Volumes\/uploads\/PUMA/m.test(toPlain(f.marked)), "a Universal batch's delivery says PUMA", toPlain(f.marked));
f = fillMessage(T("delivery"), { "upload.name": "ENT" }, { To: "@James Crouch & @AM", "Upload folder": "/Volumes/uploads/Upload_To_ENT_New/StreetFighter/Outdoor/DOOH/Taiwan/Batch_01", "MASV link": "https://get.massive.app/x?secret=y&lang=system" });
check(/ENT:\n\/Volumes\/uploads/.test(toPlain(f.marked)) && /MASV:\nhttps:\/\/get\.massive\.app\/x\?secret=y&lang=system$/.test(toPlain(f.marked)), "both land under their headings", toPlain(f.marked));
check(/secret=y&amp;lang=system/.test(toHtml(f.marked)), "an & in a link is escaped on the rich copy, and whole on the plain one");
f = fillMessage(T("delivery"), { "upload.name": "ENT" }, { To: "@AM" });
check(/\[Upload folder\]/.test(f.marked) && /\[MASV link\]/.test(f.marked) && f.dropped.length === 0, "an unfilled field shows as [MASV link]; it never drops its block");

console.log("\n4. A template somebody wrote");
f = fillMessage("Hey {to}, {territory} {batch} is up.\n\n{delivered.count} delivered:\n{delivered.folder}\n\nSee {notatoken} and {?Notes}", { territory: "Taiwan", batch: "Batch_01", "delivered.count": "", "delivered.folder": "/d" }, { To: "@AM", Notes: "<script>x</script>" });
check(/Taiwan Batch_01 is up/.test(f.marked) && !/delivered:/.test(f.marked), "data tokens fill; a block with an empty count goes");
check(/\{notatoken\}/.test(f.marked), "braces around a word that is no token are left as typed");
check(!/<script>/.test(toHtml(f.marked)) && /&lt;script&gt;/.test(toHtml(f.marked)), "typed text is never markup on the clipboard");
check(TOKENS.every((t) => /^[a-z]+(\.[a-z]+)?$/.test(t.token)), "every token is one the filler can read");

console.log("\n5. What is stored");
check(parseTemplates("") === DEFAULT_TEMPLATES && parseTemplates("{not json") === DEFAULT_TEMPLATES && parseTemplates("[]") === DEFAULT_TEMPLATES, "nothing stored, or something unreadable, is the starting list");
const mine = parseTemplates(JSON.stringify([{ id: "a", name: "Statics", body: "Hey {to}\n\tTabbed | piped" }, { nope: 1 }]));
check(mine.length === 1 && mine[0].body === "Hey {to}\n\tTabbed | piped", "a body with tabs, pipes and newlines survives whole (JSON, never a delimited list)", mine);

console.log(fails ? `\n${fails} FAILED` : "\nCLEAN — the hand-off message is written from the batch, and only from what it has.");
process.exit(fails ? 1 : 0);
