// =============================================================================
// src/js/main/lib/deliverySpecMatch.ts
// -----------------------------------------------------------------------------
// Finds the delivery spec for a row in the Delivery hub, from the comp's own
// name, and offers what it finds as a SUGGESTION.
//
// The comp Deliver creates is the source .mov's name with the version stripped,
// which leaves the country code on the end:
//
//   FID_INTL_Trio_DOOH_WestfieldSuperScreens_950x1600px_20s_AU
//                      └── site ──────────┘ └─ size ─┘ └dur┘ └code
//
// So every row identifies its own territory. That beats deriving it from where
// the project happens to be saved: a project holding comps for more than one
// territory still resolves each row correctly.
//
// TWO TIERS, because the specs are not uniform. Surveyed across all 17
// territories of one campaign: 14 have a parseable delivery table (7 of those
// state a file size, 3 a bitrate), 1 has only prose vendor sheets, 2 have no
// specs at all.
//
//   1. The PDF parses into a table -> match on size + duration EXACTLY and
//      offer the number. No match, or more than one match, offers nothing.
//   2. It doesn't parse (Australia's BrandSpace / oOh! sheets are layout
//      documents, not tables) -> name the PDF whose filename best matches the
//      site token, so the row at least points at the right document.
//
// FUZZY MATCHING IS CONFINED TO TIER 2, deliberately. "WestfieldSuperScreens"
// -> "BrandSpace - Digital Specifications - SuperScreen Network.pdf" can only
// be done loosely, and that is acceptable ONLY because the outcome is which
// PDF a human opens: a wrong guess costs a glance. A fuzzy match must never
// drive a prefilled number -- that would put a wrong bitrate into a real
// delivery, which nothing downstream would catch.
// =============================================================================
import { fs, path } from "../../lib/cep/node";
import { parsePdfDeliverySpecs, reshapeSpecs, type SpecRow } from "./pdfSpecs";

export interface CompNameParts {
    /** Media site / network token, e.g. "WestfieldSuperScreens". "" if absent. */
    site: string;
    /** "950x1600" */
    size: string;
    /** Seconds, as written. */
    duration: string;
    /** Trailing country code, e.g. "AU". */
    code: string;
}

/** Both naming conventions: size with or without `px`, duration `s` or `sec`. */
const SIZE_RE = /(\d{2,5})\s*[xX]\s*(\d{2,5})(?:px)?/;
const DUR_RE = /(\d{1,4})\s*(?:sec|secs|s)(?![a-zA-Z0-9])/i;

export function parseDeliveryCompName(name: string): CompNameParts | null {
    if (!name) return null;
    // Strip a trailing version, which Deliver already removes from the comp but
    // is present if this is ever handed a raw filename.
    const stem = String(name)
        .replace(/\.(mov|mp4|aep)$/i, "")
        .replace(/_V\d{1,3}$/i, "");

    const size = stem.match(SIZE_RE);
    const dur = stem.match(DUR_RE);
    if (!size || !dur) return null;

    const bits = stem.split("_").filter(Boolean);
    const last = bits[bits.length - 1] || "";
    if (!/^[A-Za-z]{2,3}$/.test(last)) return null;

    // The site is whatever sits between the creative/format prefix and the
    // size token. Best-effort: the token immediately before the size.
    let site = "";
    for (let i = 0; i < bits.length; i++) {
        if (SIZE_RE.test(bits[i])) {
            site = i > 0 ? bits[i - 1] : "";
            break;
        }
    }

    return {
        site,
        size: `${size[1]}x${size[2]}`,
        duration: dur[1],
        code: last.toUpperCase(),
    };
}

/**
 * Walks UP from a delivered file until it finds the folder that owns a
 * `Masters/Specs`. That folder is the territory, identified structurally rather
 * than by matching against a list of country names -- so a territory folder
 * named in a way nobody predicted still resolves.
 */
export function findSpecsFolder(sourcePath: string): string | null {
    try {
        if (!sourcePath) return null;
        let dir = path.dirname(sourcePath);
        for (let hops = 0; hops < 8 && dir && dir !== path.dirname(dir); hops++) {
            const candidate = path.join(dir, "Masters", "Specs");
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
            dir = path.dirname(dir);
        }
    } catch {
        /* unreadable path -- no suggestion, not an error */
    }
    return null;
}

/** Lowercase alphanumerics only, for loose filename comparison. */
function squash(s: string): string {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * How well a spec PDF's filename matches a site token. Tier 2 only.
 * Scores on the longest run of the site token found in the filename, so
 * "WestfieldSuperScreens" beats "SmartScreen Network" on "superscreen".
 */
function scoreFilename(site: string, filename: string): number {
    const a = squash(site);
    const b = squash(filename);
    if (!a || !b) return 0;
    let best = 0;
    // Longest substring of the site token that appears in the filename.
    for (let len = a.length; len > 4; len--) {
        for (let i = 0; i + len <= a.length; i++) {
            if (b.indexOf(a.slice(i, i + len)) !== -1) { best = len; break; }
        }
        if (best) break;
    }
    return best;
}

export interface SpecSuggestion {
    /** "" when nothing was found -- always safe to render. */
    sizeMB: string;
    maxMbps: string;
    /** Human sentence naming where this came from. "" when nothing found. */
    source: string;
    /** Tier 2: the spec document to open, when nothing could be extracted. */
    openPath: string;
    /** True when a spec folder existed but offered nothing useful. */
    searched: boolean;
}

const EMPTY: SpecSuggestion = { sizeMB: "", maxMbps: "", source: "", openPath: "", searched: false };

export async function suggestForComp(compName: string, sourcePath: string): Promise<SpecSuggestion> {
    // EVERY EXIT SAYS WHY. These all used to return EMPTY, which the caller
    // discards (searched:false), so the row showed nothing at all -- identical
    // to never having pressed the button. A reason you can read is the
    // difference between "the panel is broken" and "your comp name has no
    // country code in it", and only one of those is worth anyone's afternoon.
    const parts = parseDeliveryCompName(compName);
    if (!parts) {
        return { ...EMPTY, searched: true, source: "Couldn't read a size, duration and country code out of this comp's name" };
    }
    const specsDir = findSpecsFolder(sourcePath);
    if (!specsDir) {
        return { ...EMPTY, searched: true, source: "No Masters/Specs folder anywhere above this render" };
    }

    let pdfs: string[] = [];
    try {
        pdfs = fs.readdirSync(specsDir).filter((f: string) => /\.pdf$/i.test(f) && !f.startsWith("."));
    } catch {
        return { ...EMPTY, searched: true, source: `Couldn't read ${specsDir}` };
    }
    if (!pdfs.length) {
        return { ...EMPTY, searched: true, source: "The Specs folder has no PDFs in it" };
    }

    // A row that matched exactly but carries no numbers. Held rather than
    // returned immediately, so a LATER pdf that does have them still wins --
    // but it is remembered, because "I found your spec and it doesn't say"
    // is a real answer and used to be thrown away.
    let matchedButSilent: SpecSuggestion | null = null;

    // --- tier 1: a real delivery table -------------------------------------
    for (const file of pdfs) {
        let rows: SpecRow[] = [];
        try {
            const bytes = new Uint8Array(fs.readFileSync(path.join(specsDir, file)));
            const raw = await parsePdfDeliverySpecs(bytes);
            if (!raw) continue;
            rows = reshapeSpecs(raw, parts.code);
        } catch {
            continue;
        }
        const hits = rows.filter(
            (r) => r.Size === parts.size && String(r.Duration) === String(parts.duration)
        );
        // Exactly one, or nothing. An ambiguous match stays blank: a wrong
        // target size means a file delivered over its limit, and a blank field
        // costs one manual entry.
        if (hits.length === 1 && (hits[0].FileSize || hits[0].BitRate)) {
            return {
                sizeMB: hits[0].FileSize || "",
                maxMbps: hits[0].BitRate || "",
                source: `${parts.size} · ${parts.duration}s in ${file}`,
                openPath: path.join(specsDir, file),
                searched: true,
            };
        }
        // EXACTLY ONE ROW, NO NUMBERS. Plenty of real sheets specify dimensions,
        // duration, sound and container and stop there -- the German DINTH one
        // does. That used to fall through to the fuzzy filename tier, score
        // nothing, and end with no badge, so a PERFECT match offered less than a
        // vague guess and looked identical to "couldn't find your spec".
        if (hits.length === 1 && !matchedButSilent) {
            matchedButSilent = {
                ...EMPTY,
                searched: true,
                source: `${parts.size} · ${parts.duration}s found in ${file}, but it doesn't specify size or bitrate`,
                openPath: path.join(specsDir, file),
            };
        }
        if (hits.length > 1) {
            return {
                ...EMPTY,
                searched: true,
                source: `${hits.length} rows in ${file} match ${parts.size} · ${parts.duration}s — pick one yourself`,
                openPath: path.join(specsDir, file),
            };
        }
    }

    // A confident table match beats a filename guess, even with nothing to fill.
    if (matchedButSilent) return matchedButSilent;

    // --- tier 2: point at the likeliest document ---------------------------
    if (parts.site) {
        let bestFile = "";
        let bestScore = 0;
        for (const file of pdfs) {
            const score = scoreFilename(parts.site, file);
            if (score > bestScore) { bestScore = score; bestFile = file; }
        }
        if (bestFile) {
            return {
                ...EMPTY,
                searched: true,
                source: `No table to read — ${bestFile} looks like this one's spec`,
                openPath: path.join(specsDir, bestFile),
            };
        }
    }

    return {
        ...EMPTY,
        searched: true,
        source: `Nothing in ${pdfs.length === 1 ? "the spec PDF" : `the ${pdfs.length} spec PDFs`} matches ${parts.size} · ${parts.duration}s`,
    };
}
