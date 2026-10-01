// =============================================================================
// src/js/main/lib/amendNotes.ts
// -----------------------------------------------------------------------------
// A WRIKE AMEND COMMENT, SPLIT PER DELIVERABLE. The studio writes amends as one
// comment on the job, shaped like this (Norway Batch_02, 2026-09-30):
//
//     SF_INTL_Trio_POST_DOOH_1920x1080px_30s_NO_V01.mov
//     SF_INTL_Trio_DOOH_NfkinoPOST_1728x768px_30s_NO_V01.mov
//     🔶 The paramount logo is cut off at the top
//
//     SF_INTL_Trio_DOOH_OdeonPOST_3840x1152px_30s_NO_V01.mov
//     🔶 The paramount logo is cut off on the RHS
//
//     ✅ The others are approved
//
// A run of filenames is a GROUP; the text lines under it are its notes, for
// every file in the group. A blank line ends a group ONLY once it has notes
// (names, blank, note still belongs together). Text with no group above it --
// "The others are approved" -- is GENERAL, said once for the job.
//
// A filename is a line carrying a delimited SIZE token and a LENGTH token and
// hardly any spaces (a sentence mentioning "1920x1080" is not a filename).
//
// PEOPLE DO NOT ALL WRITE IT THAT WAY, so three looser shapes are read too
// (Norway Batch_02, 2026-10-01, which read as "no amends in it"):
//   - a PATH: "/Volumes/…/Renders/Batch_02/SF_…_NO_V02.mov" is that file. The
//     folders come off; they keyed the whole path, which matches no row.
//   - the note ON THE SAME LINE: "SF_…_NO_V02.mov - logo is cut off".
//   - a name INSIDE a sentence: "the logo on SF_…_NO_V02 is cut off". The
//     sentence is the note, whole.
// What makes a word a deliverable does not loosen: one unbroken word with a
// size AND a length between underscores. A sentence naming a size is still
// only a sentence.
// Deliverables key exactly as the tracker keys them (tracker.ts trackerKey):
// upper-cased, extension, _Vnn / _Vnn_DOUBLE_RES and a ratio token off. The
// version reviewed is kept, so a row can say a newer render exists since.
//
// Plain text in, plain text out: nothing here is ever rendered as markup.
// Wrike may send a bullet as its emoji shortcode; see stripLead.
// =============================================================================

export interface AmendNote {
    /** The note, one or more lines. */
    text: string;
    /** The version the reviewer looked at (_V01 -> 1), 0 when unnamed. */
    version: number;
    /** The filename as the comment wrote it. */
    name: string;
}

export interface ParsedAmends {
    byKey: Record<string, AmendNote[]>;
    general: string[];
}

/** Same key as tracker.ts's trackerKey, so a comment's filename meets its row. */
export function amendKey(name: string): string {
    let s = String(name || "").trim();
    const dot = s.lastIndexOf(".");
    if (dot > 0 && s.length - dot <= 5) s = s.substring(0, dot);
    s = s.replace(/_[Vv]\d+_(?:DOUBLE|TRIPLE|QUAD)_RES$/i, "").replace(/_[Vv]\d+$/, "");
    return s.split(/[_ ]+/).filter((t) => t && !/^\d{1,2}x\d{1,2}$/i.test(t)).map((t) => t.toUpperCase()).join("_");
}

// Bullets come as the emoji (🔶) OR as the shortcode Wrike's plain text sends
// (":small_orange_diamond:" -- Malaysia's MY 2, 2026-09-30); both come off,
// along with any other punctuation leading the line.
const stripLead = (line: string) =>
    line.replace(/^(?::[a-z0-9_+-]+:|[^\p{L}\p{N}])+/iu, "").trim(); // shortcode FIRST, or the bare ":" goes alone

const looksDeliverable = (t: string) =>
    /(^|_)\d{2,5}x\d{2,5}(px)?(_|$)/i.test(t) && /(^|_)\d+s(ec)?(_|\.|$)/i.test(t);

/** The file off a path, either slash. */
const baseName = (t: string) => t.substring(Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1);

function isFilename(line: string): boolean {
    const t = baseName(stripLead(line));
    if ((t.match(/ /g) || []).length > 2) return false;
    return looksDeliverable(t);
}

/** Deliverables named somewhere in a line that is not just a filename, and
 *  the note the line carries: what follows the names when they lead it, the
 *  whole sentence (paths cut to the file) when they sit inside it. */
function namesInLine(line: string): { names: string[]; note: string } | null {
    const words = stripLead(line).split(/\s+/);
    const names: string[] = [];
    const shown: string[] = [];
    const rest: string[] = [];
    let leading = true;
    let lead = true;
    for (const w of words) {
        // Off the path, and out of any brackets, quotes or trailing comma.
        const name = baseName(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        if (name && looksDeliverable(name)) {
            names.push(name);
            shown.push(baseName(w));
            if (!leading) lead = false;
            continue;
        }
        // "A and B: note" still leads with its names.
        if (leading && names.length && /^(and|&|\+|,)$/i.test(w)) { shown.push(w); continue; }
        leading = false;
        shown.push(w);
        rest.push(w);
    }
    if (!names.length) return null;
    return { names, note: stripLead(lead ? rest.join(" ") : shown.join(" ")) };
}

function versionOf(name: string): number {
    const m = /_[Vv](\d+)(?:_(?:DOUBLE|TRIPLE|QUAD)_RES)?(?:\.\w{2,4})?$/i.exec(name.trim());
    return m ? parseInt(m[1], 10) : 0;
}

export function parseAmends(text: string): ParsedAmends {
    const byKey: Record<string, AmendNote[]> = {};
    const general: string[] = [];
    const groups: { names: string[]; notes: string[] }[] = [];
    let group: { names: string[]; notes: string[] } | null = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) {
            if (group && group.notes.length) group = null;
            continue;
        }
        if (isFilename(line)) {
            if (!group || group.notes.length) {
                group = { names: [], notes: [] };
                groups.push(group);
            }
            group.names.push(baseName(stripLead(line)));
            continue;
        }
        const inline = namesInLine(line);
        if (inline) {
            if (!group || group.notes.length) {
                group = { names: [], notes: [] };
                groups.push(group);
            }
            group.names.push(...inline.names);
            if (inline.note) group.notes.push(inline.note);
            continue;
        }
        const note = stripLead(line);
        if (!note) continue;
        if (group) group.notes.push(note);
        else general.push(note);
    }
    for (const g of groups) {
        if (!g.notes.length) continue;
        const note = g.notes.join("\n");
        for (const name of g.names) {
            const k = amendKey(name);
            (byKey[k] = byKey[k] || []).push({ text: note, version: versionOf(name), name });
        }
    }
    return { byKey, general };
}

/** For SHOWING a comment whole: Wrike's plain text sends emoji as shortcodes
 *  (":small_orange_diamond:"); the common ones become the emoji again, and
 *  any other is left exactly as written. Display only -- parsing strips them. */
const SHORTCODES: Record<string, string> = {
    small_orange_diamond: "🔸", large_orange_diamond: "🔶", small_blue_diamond: "🔹", large_blue_diamond: "🔷",
    white_check_mark: "✅", heavy_check_mark: "✔️", ballot_box_with_check: "☑️", x: "❌", warning: "⚠️",
    red_circle: "🔴", large_blue_circle: "🔵", arrow_right: "➡️", point_right: "👉", exclamation: "❗",
};
export function showShortcodes(text: string): string {
    return String(text || "").replace(/:([a-z0-9_+-]+):/gi, (m, name) => SHORTCODES[String(name).toLowerCase()] || m);
}
