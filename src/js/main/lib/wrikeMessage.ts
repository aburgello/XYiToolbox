// =============================================================================
// src/js/main/lib/wrikeMessage.ts
// -----------------------------------------------------------------------------
// THE MESSAGE YOU TYPE INTO WRIKE WHEN A BATCH MOVES ON, written from what the
// tracker already knows. Three were being typed by hand every time:
//
//     Hey @James Crouch, renders with banners ready:
//
//     12 x Renders:
//     /Volumes/…/Panama/Renders/Batch_01
//
//     PDFs:
//     /Volumes/…/Panama/PDFs
//
// A TEMPLATE is plain text with tokens in braces. Three kinds:
//   {renders.folder}   DATA, filled from the batch on screen (TOKENS below)
//   {to}               who it is addressed to, typed once and remembered
//   {?MASV link}       a FIELD, asked for each time and never remembered --
//                      last batch's upload link in this batch's message is
//                      exactly the mistake a remembered field would make
// and **double asterisks** for bold, which is what the headings are.
//
// A BLOCK WHOSE DATA IS MISSING IS LEFT OUT. Blocks are separated by a blank
// line, and one holding a data token that came back empty (a territory with no
// PDFs folder, a batch with nothing revised) is dropped whole, heading and
// all -- "PDFs:" over nothing is worse than no PDFs block. Fields and {to} do
// not drop a block: an unfilled one stays visible as [MASV link].
//
// Pure text in, text out; the panel never renders the result as markup it did
// not build itself (toHtml escapes first).
// =============================================================================

export interface MessageTemplate {
    id: string;
    name: string;
    body: string;
}

/** Every data token, and what it is filled with. The editor lists these. */
export const TOKENS: { token: string; what: string }[] = [
    { token: "territory", what: "The territory's name" },
    { token: "batch", what: "The batch folder's name" },
    { token: "renders.count", what: "How many deliverables have a render" },
    { token: "renders.folder", what: "This batch's Renders folder" },
    { token: "renders.list", what: "The newest render of each deliverable, one path a line" },
    { token: "revised.count", what: "How many deliverables sent back for amends (To amend or Revised in Wrike, or named in the amend comment) have a render" },
    { token: "revised.paths", what: "The newest render of each of those, one path a line" },
    { token: "pdfs.folder", what: "This batch's folder in the territory's PDFs, or PDFs itself when it has none" },
    { token: "masters.renders", what: "The masters' Renders folder: the creative's own when the batch has one creative, the whole folder when it has several" },
    { token: "delivered.count", what: "How many deliverables are in _Delivery" },
    { token: "delivered.folder", what: "This batch's _Delivery folder" },
    { token: "specs.folder", what: "The territory's Masters/Specs folder" },
    { token: "ae.folder", what: "This batch's AE folder" },
    { token: "upload.folder", what: "This batch's folder under the campaign's shared uploads folder" },
    { token: "upload.name", what: "Where deliveries are uploaded: ENT for Paramount, PUMA for Universal" },
];
const IS_DATA: Record<string, boolean> = {};
TOKENS.forEach((t) => { IS_DATA[t.token] = true; });

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
    {
        id: "review",
        name: "For review",
        body: "Hey {to}, renders ready:\n\n**{renders.count} x Renders:**\n{renders.folder}\n\n**PDFs:**\n{pdfs.folder}\n\n**Masters:**\n{masters.renders}",
    },
    {
        id: "revised",
        name: "Revised",
        body: "Hi {to}, amends are in:\n\n🟠 **{revised.count} x Revised:**\n{revised.paths}",
    },
    {
        id: "delivery",
        name: "Delivery",
        body: "Hey {to}, here's the delivery:\n\n**{upload.name}:**\n{upload.folder}\n\n**MASV:**\n{?MASV link}",
    },
];

/**
 * WHERE A DELIVERY IS UPLOADED depends on whose film it is: ENT for Paramount,
 * PUMA for Universal. Read off the batch's own path, where the studio is a
 * folder (`/Volumes/paramount/…`, `/Volumes/universal/…`) -- a whole path
 * segment, never a substring. Any other studio is "Upload": never empty, or
 * the block naming the upload folder would be left out with it.
 */
export function uploadNameFor(path: string): string {
    const segs = String(path || "").toLowerCase().split(/[\\/]+/);
    if (segs.indexOf("paramount") !== -1) return "ENT";
    if (segs.indexOf("universal") !== -1) return "PUMA";
    return "Upload";
}

const TOKEN_RE = /\{(\?[^{}\n]+|[a-z]+(?:\.[a-z]+)?)\}/gi;

/** The fields a template asks for, in the order it names them. "To" is {to}. */
export function fieldsOf(body: string): string[] {
    const out: string[] = [];
    String(body || "").replace(TOKEN_RE, (m, name: string) => {
        const label = name.charAt(0) === "?" ? name.slice(1).trim() : name.toLowerCase() === "to" ? "To" : "";
        if (label && out.indexOf(label) === -1) out.push(label);
        return m;
    });
    return out;
}

export interface FilledMessage {
    /** With the ** marks still in: what toPlain and toHtml are made from. */
    marked: string;
    /** The first line of each block left out for want of data. */
    dropped: string[];
}

export function fillMessage(body: string, data: Record<string, string>, fields: Record<string, string>): FilledMessage {
    const dropped: string[] = [];
    const kept: string[] = [];
    for (const block of String(body || "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
        if (!block.trim()) continue;
        let missing = false;
        const filled = block.replace(TOKEN_RE, (m, name: string) => {
            if (name.charAt(0) === "?") {
                const label = name.slice(1).trim();
                return (fields[label] || "").trim() || `[${label}]`;
            }
            const key = name.toLowerCase();
            if (key === "to") return (fields.To || "").trim() || "[To]";
            // A word in braces that is not a token is somebody's own text.
            if (!IS_DATA[key]) return m;
            const v = String(data[key] || "").trim();
            if (!v) missing = true;
            return v;
        });
        if (missing) {
            dropped.push(block.split("\n")[0].replace(/\*\*/g, "").replace(TOKEN_RE, "").replace(/[^\p{L}\p{N} ]/gu, "").trim() || "a block");
            continue;
        }
        kept.push(filled);
    }
    return { marked: kept.join("\n\n"), dropped };
}

/** What goes on the clipboard as text: the bold marks off. */
export const toPlain = (marked: string) => marked.replace(/\*\*/g, "");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** What goes on the clipboard as rich text, so the headings paste bold.
 *  Escaped FIRST: nothing typed into a template is ever markup. */
export function toHtml(marked: string): string {
    return esc(marked).replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
}

/** A stored list, read back. Anything unreadable is the defaults: a broken
 *  setting must not leave the composer with no templates at all. */
export function parseTemplates(json: string): MessageTemplate[] {
    try {
        const raw = JSON.parse(json || "");
        if (!Array.isArray(raw)) return DEFAULT_TEMPLATES;
        const out = raw
            .filter((t) => t && typeof t.id === "string" && typeof t.body === "string")
            .map((t) => ({ id: String(t.id), name: String(t.name || "Untitled"), body: String(t.body) }));
        return out.length ? out : DEFAULT_TEMPLATES;
    } catch {
        return DEFAULT_TEMPLATES;
    }
}
