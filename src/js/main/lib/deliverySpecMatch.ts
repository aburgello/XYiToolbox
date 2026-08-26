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
import { child_process, fs, path } from "../../lib/cep/node";
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

/**
 * Lowercase alphanumerics only, accents folded first.
 *
 * THE FOLD IS NOT COSMETIC. Stripping non-alphanumerics on its own DELETES an
 * accented letter rather than plainening it, so Brazil's `MarinaLEDPraça&Pier`
 * squashed to `marinaledpraapier` -- the c gone entirely -- and no longer
 * matched the comp's own `MarinaLEDPracaPier`. Same for `RelógioDigital01`.
 * Decompose first and drop the combining marks, and both spellings land on the
 * same key. (This is the panel-side twin of `artwork.ts`'s `foldAccents`;
 * Chromium has `normalize`, ExtendScript does not.)
 */
function squash(s: string): string {
    return String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
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
    /** Frame rate off the sheet. WAS PARSED AND THEN DROPPED: pdfSpecs has read
     *  Fps off these tables all along, and this interface simply never carried
     *  it, so the one field an artist cannot infer from the filename was the one
     *  the panel threw away. */
    fps?: string;
    /** Human sentence naming where this came from. "" when nothing found. */
    source: string;
    /** Tier 2: the spec document to open, when nothing could be extracted. */
    openPath: string;
    /** True when a spec folder existed but offered nothing useful. */
    searched: boolean;
    /** The sheet's Sound column: "yes" | "no" | "" when it didn't say. Kept
     *  tri-state so silence never gets mistaken for an instruction to mute. */
    audio?: string;
}

const EMPTY: SpecSuggestion = { sizeMB: "", maxMbps: "", source: "", openPath: "", searched: false };

/**
 * The rows of one sheet that describe this comp. Exported so it can be driven
 * headlessly -- the matching rule is the part worth testing, and it used to be
 * buried in the middle of a function that needs a Specs folder on disk.
 *
 * Size and duration, then the SITE when those alone leave more than one row.
 * Brazil's Batch 1 sheet has JockeyClub and MarinaTotens both at
 * 1080x1920 · 15s, so size and duration alone called them ambiguous and left
 * both rows blank -- next to seven rows that filled themselves in, which reads
 * as the panel giving up rather than as a real question. The sheet names the
 * site and so does the comp, so ask it.
 *
 * NOT the fuzzy scoring tier 2 uses, and that distinction is the rule this
 * whole file is built on: a loose match may decide which PDF a human opens,
 * never which number goes into a delivery. This is exact equality on a
 * normalised name -- case, spacing, punctuation and accents folded, nothing
 * else. `MarinaLEDPraça&Pier` and `MarinaLEDPracaPier` are the same site
 * written twice; `JockeyClub` and `JockeyClubDATE` are not, and stay
 * ambiguous. And the narrowing only counts when it leaves EXACTLY one row.
 */
export function specRowsForComp(rows: SpecRow[], parts: CompNameParts): SpecRow[] {
    const hits = rows.filter(
        (r) => r.Size === parts.size && String(r.Duration) === String(parts.duration)
    );
    if (hits.length > 1 && parts.site) {
        const want = squash(parts.site);
        const bySite = hits.filter((r) => r.Site && squash(r.Site) === want);
        if (bySite.length === 1) return bySite;
    }
    return hits;
}

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
    /** More than one row matched and the site couldn't separate them. Held for
     *  the same reason as above: a later PDF may still answer cleanly. */
    let ambiguous: SpecSuggestion | null = null;

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
        const matched = specRowsForComp(rows, parts);

        // DUPLICATE ROWS THAT AGREE ARE NOT AMBIGUOUS.
        //
        // Real sheets list the same deliverable twice — a PRE sheet for Norway
        // carries PlayAdshel 1080x1920 10s and PlayBillboard 1920x1080 10s
        // twice each, all four saying 8 Mbps / 50 MB / no sound. The guard
        // below counts rows, so two identical rows read as a question and the
        // field stayed blank, while every size listed once filled in. Nothing
        // was actually in doubt: both rows give the same answer.
        //
        // Collapsed on the four values that get USED, so rows differing only in
        // a note or a site spelling still count as one. Rows that genuinely
        // disagree stay more than one, and the ambiguity guard still refuses —
        // which is the case it was written for.
        const hits: SpecRow[] = [];
        for (const row of matched) {
            const sig = [row.FileSize || "", row.BitRate || "", row.Fps || "", row.Sound || ""].join("|");
            const seen = hits.some(
                (h) => [h.FileSize || "", h.BitRate || "", h.Fps || "", h.Sound || ""].join("|") === sig,
            );
            if (!seen) hits.push(row);
        }

        // Exactly one, or nothing. An ambiguous match stays blank: a wrong
        // target size means a file delivered over its limit, and a blank field
        // costs one manual entry.
        if (hits.length === 1 && (hits[0].FileSize || hits[0].BitRate)) {
            return {
                sizeMB: hits[0].FileSize || "",
                maxMbps: hits[0].BitRate || "",
                fps: hits[0].Fps || "",
                audio: hits[0].Sound || "",
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
                fps: hits[0].Fps || "",
                audio: hits[0].Sound || "",
                // Says what it DID find, since a sheet with no numbers often
                // still answers the sound question.
                source: `${parts.size} · ${parts.duration}s found in ${file}`
                    + (hits[0].Sound ? ` — sound: ${hits[0].Sound}` : "")
                    + (hits[0].Fps ? `, ${hits[0].Fps}fps` : "")
                    + ", but no size or bitrate",
                openPath: path.join(specsDir, file),
            };
        }
        // STILL AMBIGUOUS -- REMEMBERED, NOT RETURNED. This used to end the
        // search outright, so one crowded sheet early in the folder hid a
        // later one that answers cleanly. A Specs folder holds a PRE and a
        // POST sheet per batch and they describe overlapping sizes; whichever
        // `readdir` happened to reach first decided the row.
        if (hits.length > 1 && !ambiguous) {
            ambiguous = {
                ...EMPTY,
                searched: true,
                // The count of DISAGREEING rows, not of rows: saying "4 rows
                // match" when two pairs of them are identical describes a
                // sheet nobody is looking at.
                source: `${hits.length} rows in ${file} disagree about ${parts.size} · ${parts.duration}s — pick one yourself`,
                openPath: path.join(specsDir, file),
            };
        }
    }

    // A confident table match beats a filename guess, even with nothing to fill.
    if (matchedButSilent) return matchedButSilent;
    // ...and a real question about a real row beats a guess at a filename.
    if (ambiguous) return ambiguous;

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

// =============================================================================
// THE WHOLE SHEET, NOT ONE ROW.
//
// suggestForComp answers "what should THIS deliverable be", and refuses when
// the answer is ambiguous -- which is right for filling a field, and useless
// when what you actually want is to read the document. An artist looking at a
// row that came back blank has no way to tell whether the PDF is silent, wrong,
// or simply describes a size nobody asked for.
//
// This reads every spec PDF beside the campaign and reports what each row says
// about bitrate, fps and file size. It fills nothing in and decides nothing.
// =============================================================================

export interface SpecReportRow {
    size: string;
    duration: string;
    site: string;
    country: string;
    bitRate: string;
    fps: string;
    fileSize: string;
    sound: string;
    /** The parser's own doubts about this row -- a bitrate in the fps column and
     *  so on. Surfaced rather than hidden: these tables are filled in by hand. */
    flags: string;
    /** The free-text requirements cell, verbatim. Shown because the parser can
     *  only match a phrasing it was taught, and the sheet is the authority. */
    notes: string;
}

export interface SpecReportFile {
    file: string;
    /** Full path to the PDF, so the panel can hand it to the OS. Taken from the
     *  directory listing that found it rather than rebuilt by a caller out of
     *  `folder` + `file`, which is how a name with an accent in it stops
     *  opening on one machine and not another. */
    path: string;
    rows: SpecReportRow[];
    /** Set when this PDF could not be read at all. */
    error?: string;
}

export interface SpecReport {
    /** "" when no specs folder was found. */
    folder: string;
    files: SpecReportFile[];
    /** Why there is nothing to show, when there is nothing to show. */
    note: string;
}

/**
 * Hands a spec PDF to the OS to open in whatever reads PDFs there.
 *
 * NOT gated on the file existing. Two reasons, and the second is the one that
 * matters: the path came out of the directory listing that just read the PDF,
 * so it demonstrably exists; and Specs folders live on the studio NAS, where
 * CLAUDE.md's rule holds -- attempt the operation and let its failure be the
 * answer, never ask a network mount whether a file is there.
 *
 * `open`/`explorer` rather than a file:// handoff, for the same reason
 * masterCheck's openReport does it: CEP's browser handoff is inconsistent with
 * local files. That one stays as the fallback.
 */
export function openSpecPdf(fullPath: string): void {
    try {
        const win = String((window as any).cep_node?.process?.platform || "") === "win32";
        if (win) child_process.spawn("explorer", [fullPath], { detached: true });
        else child_process.spawn("open", [fullPath], { detached: true });
    } catch {
        try {
            (window as any).cep?.util?.openURLInDefaultBrowser("file://" + fullPath);
        } catch {
            /* nothing more to try; the panel shows the folder path either way */
        }
    }
}

export async function readSpecReport(sourcePath: string): Promise<SpecReport> {
    const specsDir = findSpecsFolder(sourcePath);
    if (!specsDir) {
        return { folder: "", files: [], note: "No specs folder next to this campaign." };
    }

    let pdfs: string[] = [];
    try {
        pdfs = fs.readdirSync(specsDir).filter((f: string) => /\.pdf$/i.test(f) && !f.startsWith("."));
    } catch {
        return { folder: specsDir, files: [], note: `Couldn't read ${specsDir}.` };
    }
    if (!pdfs.length) {
        return { folder: specsDir, files: [], note: "That specs folder has no PDFs in it." };
    }

    const files: SpecReportFile[] = [];
    for (const file of pdfs) {
        const full = path.join(specsDir, file);
        try {
            const bytes = new Uint8Array(fs.readFileSync(full));
            const raw = await parsePdfDeliverySpecs(bytes);
            if (!raw) {
                // A PDF with no readable table is a normal thing -- plenty are
                // a page of prose -- and saying so beats omitting the file and
                // leaving somebody wondering whether it was even looked at.
                files.push({ file, path: full, rows: [], error: "no table this parser could read" });
                continue;
            }
            // "" rather than a country code: the report is the document's
            // contents, not one territory's slice of it.
            const rows = reshapeSpecs(raw, "");
            files.push({
                file,
                path: full,
                rows: rows.map((r) => ({
                    size: r.Size || "",
                    duration: String(r.Duration || ""),
                    site: r.Site || "",
                    country: r.Country || "",
                    bitRate: r.BitRate || "",
                    fps: r.Fps || "",
                    fileSize: r.FileSize || "",
                    sound: r.Sound || "",
                    flags: r.Flags || "",
                    notes: r.Notes || "",
                })),
            });
        } catch (e) {
            files.push({ file, path: full, rows: [], error: String((e as Error).message || e) });
        }
    }

    const total = files.reduce((n, f) => n + f.rows.length, 0);
    return {
        folder: specsDir,
        files,
        note: total ? "" : "Found the PDFs, but no readable spec table in any of them.",
    };
}
