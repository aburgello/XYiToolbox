// =============================================================================
// src/js/main/lib/mastersRoot.ts
// -----------------------------------------------------------------------------
// ONE ANSWER TO "WHERE ARE THIS CAMPAIGN'S MASTERS?" -- and, since a campaign
// is one job with two roots, to "where are its Markets?" as well.
//
// A saved campaign records only ONE of the two roots, deliberately: that record
// is the single source of truth for its half, and re-pointing it has to carry
// every tool with it. The other root is its SIBLING, so it is derived rather
// than stored -- a second stored path is a second thing to go stale.
//
// This lived inside CSVLocaliser.tsx and was about to be copy-pasted into
// Bespoke. Two copies of a path convention drift, and the failure is silent:
// one tool finds the masters and the other says the folder is empty.
// =============================================================================
import { fs, path } from "../../lib/cep/node";
import { evalTS } from "../../lib/utils/bolt";

const canon = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The campaign root (e.g. .../INT) holds sibling `*_Markets` and `*_Masters`
 * folders sharing a stem. Given one of them, find the other: strip the
 * "XY####_" prefix and the half's own suffix to get the stem, then match the
 * sibling ending in the wanted word that contains that stem. The XY numbers
 * differ between the two, so the compare is on the stem, alphanumerics only.
 *
 * Returns "" when there is nothing to point at -- an unmounted share included.
 * The caller decides what to do about that; this never guesses a folder.
 */
function deriveSibling(root: string, own: RegExp, want: RegExp, notWant: RegExp): string {
    try {
        const parent = path.dirname(root);
        const stem = path.basename(root).replace(/^XY\d+[_-]?/i, "").replace(own, "");
        const stemC = canon(stem);
        const kids = fs.readdirSync(parent, { withFileTypes: true }).filter((d: any) => d.isDirectory());
        let hit = kids.find((d: any) => want.test(d.name) && stemC && canon(d.name).indexOf(stemC) !== -1);
        if (!hit) hit = kids.find((d: any) => want.test(d.name) && !notWant.test(d.name));
        return hit ? path.join(parent, hit.name) : "";
    } catch (e) {
        return "";
    }
}

/** Markets root -> its Masters sibling, or "". */
export function deriveMastersFromMarkets(marketsRoot: string): string {
    return deriveSibling(marketsRoot, /[_-]?markets$/i, /masters$/i, /markets$/i);
}

/** Masters root -> its Markets sibling, or "". */
export function deriveMarketsFromMasters(mastersRoot: string): string {
    return deriveSibling(mastersRoot, /[_-]?masters$/i, /markets$/i, /masters$/i);
}

// --- pairing the two campaign lists ------------------------------------------
// A campaign is ONE job, and the panel keeps two lists of it: OVLibCampaigns
// (name + masters root, behind OV Library and Review) and LocLibCampaigns
// (name + markets root, behind Localised Library and CSV Localiser). The
// team's shared-campaigns file has always treated those as two halves of one
// row -- so adding a campaign on one side and having to add it again on the
// other was the local copy disagreeing with the studio's own model.
//
// Adding registers the other half too, WHEN THE SIBLING IS REALLY ON DISK.
// Three rules, and they are the same three the share path already follows:
//   - never invent a path: no sibling found (unmounted share included) means
//     no pairing, silently, exactly as deriveSibling refuses to guess;
//   - never repoint: saveCampaign / saveLocLibCampaign both refuse a name the
//     list already holds, and that refusal is the desired outcome here, not an
//     error to report -- somebody's existing root stays theirs;
//   - never toast: the pairing is a side effect of adding a campaign, not the
//     thing that was asked for, so a failure leaves the user exactly where
//     they were (one list, add the other by hand) rather than raising an error
//     about a tool they are not standing in.
// Returns the path registered, or "" if nothing was -- the caller can say so
// in its notice line, which is what keeps this from being spooky.

async function pair(fn: "saveCampaign" | "saveLocLibCampaign", name: string, root: string): Promise<string> {
    if (!root) return "";
    try {
        const res = (await evalTS(fn as any, name, root)) as { success?: boolean } | null;
        return res && res.success ? root : "";
    } catch (e) {
        return ""; // no bridge (browser preview), or the host said no
    }
}

/** Adding a Localise campaign: register its masters half with OV Library. */
export function pairCampaignToOVLibrary(name: string, marketsRoot: string): Promise<string> {
    return pair("saveCampaign", name, deriveMastersFromMarkets(marketsRoot));
}

/** Adding an OV Library campaign: register its markets half with Localise. */
export function pairCampaignToLocalise(name: string, mastersRoot: string): Promise<string> {
    return pair("saveLocLibCampaign", name, deriveMarketsFromMasters(mastersRoot));
}

// --- sharing: one press, both halves ------------------------------------------
// The Share button in OV Library and the one in CSV Localiser each used to push
// only the root belonging to the tool it sits in, so a campaign reached the
// team working in Review and missing from Localise (or the reverse) until
// somebody pressed the other one. "Share this campaign" has to mean the
// campaign, not the half you happen to be standing in.
//
// Where the other half comes from, in order:
//   1. THE OTHER LIST'S OWN RECORD. That record is the source of truth for its
//      half -- if this machine has the campaign in both lists (everything
//      added since the pairing above), the shared row should carry exactly
//      what this machine actually uses, not a re-derivation of it.
//   2. The sibling folder on disk, for a campaign added before the pairing
//      existed and so present in only one list.
//   3. "" -- and the share still goes ahead with the half it has. A machine
//      may legitimately know only one half, and half a campaign is worth more
//      to the team than nothing. The host fills a blank half in later.

async function otherHalf(
    fn: "loadLocLibCampaigns" | "loadCampaigns",
    key: "marketsRoot" | "mastersRoot",
    name: string,
    derived: string
): Promise<string> {
    try {
        const list = (await evalTS(fn as any)) as { name: string; marketsRoot?: string; mastersRoot?: string }[] | null;
        if (list) {
            const lower = name.toLowerCase();
            const hit = list.find((c) => c && c.name && c.name.toLowerCase() === lower);
            const root = hit ? (hit as any)[key] : "";
            if (root) return String(root);
        }
    } catch (e) {
        /* no bridge, or the host said no -- fall through to the derivation */
    }
    return derived;
}

/** Sharing from OV Library: this campaign's Markets root, or "". */
export function marketsHalfFor(name: string, mastersRoot: string): Promise<string> {
    return otherHalf("loadLocLibCampaigns", "marketsRoot", name, deriveMarketsFromMasters(mastersRoot));
}

/** Sharing from CSV Localiser: this campaign's Masters root, or "". */
export function mastersHalfFor(name: string, marketsRoot: string): Promise<string> {
    return otherHalf("loadCampaigns", "mastersRoot", name, deriveMastersFromMarkets(marketsRoot));
}
