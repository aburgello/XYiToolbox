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
// Deliverables key exactly as the tracker keys them (tracker.ts trackerKey):
// upper-cased, extension, _Vnn / _Vnn_DOUBLE_RES and a ratio token off. The
// version reviewed is kept, so a row can say a newer render exists since.
//
// Plain text in, plain text out: nothing here is ever rendered as markup.
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

const stripLead = (line: string) => line.replace(/^[^\p{L}\p{N}]+/u, "").trim();

function isFilename(line: string): boolean {
    const t = stripLead(line);
    if ((t.match(/ /g) || []).length > 2) return false;
    return /(^|_)\d{2,5}x\d{2,5}(px)?(_|$)/i.test(t) && /(^|_)\d+s(ec)?(_|\.|$)/i.test(t);
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
            group.names.push(stripLead(line));
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
