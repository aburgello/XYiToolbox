// =============================================================================
// src/js/main/lib/mastersRoot.ts
// -----------------------------------------------------------------------------
// ONE ANSWER TO "WHERE ARE THIS CAMPAIGN'S MASTERS?".
//
// A saved campaign records only its Markets root, deliberately: that record is
// the single source of truth, and re-pointing it in Localised Library has to
// carry every tool with it. The Masters folder is its SIBLING, so it is derived
// rather than stored -- a second stored path is a second thing to go stale.
//
// This lived inside CSVLocaliser.tsx and was about to be copy-pasted into
// Bespoke. Two copies of a path convention drift, and the failure is silent:
// one tool finds the masters and the other says the folder is empty.
// =============================================================================
import { fs, path } from "../../lib/cep/node";

/**
 * The campaign root (e.g. .../INT) holds sibling `*_Markets` and `*_Masters`
 * folders sharing a stem. Given the saved Markets path, find its Masters
 * sibling: strip the "XY####_" prefix and "_Markets" suffix to get the stem,
 * then match the sibling ending "…Masters" that contains that stem. The XY
 * numbers differ between the two, so the compare is on the stem, alphanumerics
 * only.
 *
 * Returns "" when there is nothing to point at -- an unmounted share included.
 * The caller decides what to do about that; this never guesses a folder.
 */
export function deriveMastersFromMarkets(marketsRoot: string): string {
    try {
        const parent = path.dirname(marketsRoot);
        const marketsName = path.basename(marketsRoot);
        const stem = marketsName.replace(/^XY\d+[_-]?/i, "").replace(/[_-]?markets$/i, "");
        const canon = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const stemC = canon(stem);
        const kids = fs.readdirSync(parent, { withFileTypes: true }).filter((d: any) => d.isDirectory());
        let ms = kids.find((d: any) => /masters$/i.test(d.name) && stemC && canon(d.name).indexOf(stemC) !== -1);
        if (!ms) ms = kids.find((d: any) => /masters$/i.test(d.name) && !/markets$/i.test(d.name));
        return ms ? path.join(parent, ms.name) : "";
    } catch (e) {
        return "";
    }
}
