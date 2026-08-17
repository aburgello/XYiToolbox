// =============================================================================
// src/js/main/tools/CSVLocaliser.tsx
// -----------------------------------------------------------------------------
// CSV Localiser -- now scan-first. The primary flow points at a campaign's
// Markets root and, for every territory, reads <Territory>/Masters/Specs/*.pdf,
// parses the delivery table PANEL-SIDE (pdf.js -- see lib/pdfSpecs.ts), and
// generates localised comps by feeding each PDF into the SAME host function
// (csvLocaliserRun) the old paste flow used. Country comes from the territory
// folder, Batch from the PDF filename -- no website CSV export needed.
//
// The original "paste a [METADATA]/CSV block" flow is kept as a collapsible
// fallback at the bottom. ExtendScript can't read PDF bytes, so folder walking
// + PDF parsing happen here; only comp generation crosses the bridge.
// =============================================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { territoryNameFlag } from "../lib/jobsFeed";
import { takePendingBatch, type PendingBatch } from "../lib/localiseHandoff";
import {
    Layers,
    FolderSearch,
    FolderPlus,
    Share2,
    Archive,
    Trash2,
    Library,
    PlayCircle,
    ScanSearch,
    FileText,
    MapPin,
    ChevronRight,
    ChevronDown,
    Check,
    Search,
    RefreshCw,
    Image as ImageIcon,
    Wand2,
    Plus,
    X,
    RotateCcw,
    FolderOpen,
    FileCheck,
    FileX,
    Circle,

} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import type { ToolProps } from "../toolRegistry";
import { fs, path } from "../../lib/cep/node";
import CheckboxToggle from "../CheckboxToggle";
import Tooltip from "../Tooltip";
import Dropdown from "../Dropdown";
import { alertDialog, confirmDialog, promptDialog } from "../Dialog";
import { showMcItReport, type McReport } from "../McItReportModal";
import { showLocGenReport, type LocGenReport, type LocGenRow } from "../LocGenReportModal";
import { specRowWarnings, type SpecRow } from "../lib/pdfSpecs";
import { deriveMastersFromMarkets } from "../lib/mastersRoot";

// One row of the team's shared campaign board (team.ts's TeamCampaignRow).
// Only what this picker needs: the name, and who retired it if anyone.
interface TeamCampaignRow {
    name: string;
    mastersRoot: string;
    marketsRoot: string;
    retiredBy: string;
    retiredAt: string;
}

interface Campaign {
    name: string;
    marketsRoot: string;
}

// Mirrors csvLocaliserRun()'s CsvLocRowReport host-side.
interface CsvLocRow {
    row: number;
    artwork: string;
    campaign: string;
    size: string;
    duration: string;
    status: "generated" | "skipped-existing" | "no-master" | "error";
    master?: string;
    output?: string;
    error?: string;
    imagesReplaced?: number; // inline MC It! pass, per row
    imagesNote?: string;
}

// The Markets-root → Masters-sibling derivation now lives in lib/mastersRoot.ts,
// imported above: Bespoke derives the same folder from the same campaign, and a
// second copy of a path convention drifts silently.
import "../shared.scss";
import "./formTool.scss";

// One row in the manual batch builder (the visual alternative to Paste CSV).
// creative === "__custom__" means "type a name not in the scanned list", held
// in `custom`.
interface BuildRow {
    id: number;
    artwork: string; // DOOH | DINTH | FOH
    creative: string;
    custom: string;
    // Media site name, free text and OPTIONAL -- a deliverable with no site is
    // normal (that is what the whole pre-Site era of masters is), so this never
    // gates a row from being "complete". Typed as the studio writes it and
    // sanitised host-side by csvLocSanitiseSiteToken, which keeps the case.
    site: string;
    width: string;
    height: string;
    duration: string;
}

const CUSTOM_CREATIVE = "__custom__";

// Artwork types offered in both the scanned-row editor and Build-a-batch.
const ARTWORK_TYPES = ["DOOH", "DINTH", "FOH", "DFOH"];

// List the campaign's creatives from the masters folder, PANEL-SIDE (fs) so it
// works regardless of the host, same as the Specs scan reads folders itself.
// Prefers the clean AE/<Creative> subfolder names; if that structure isn't
// there, falls back to the creative token parsed out of the master .aep
// filenames (between the DOOH/DINTH/FOH artwork tag and the WxH size). The
// builder feeds whichever the user picks straight into csvLocaliserRun's
// campaign match (a case/separator-insensitive substring), so either form
// resolves to the right master.
function scanCreativesFromMasters(aepPath: string): string[] {
    if (!aepPath) return [];
    // (a) AE/<Creative> subfolders -- the cleanest source when present.
    try {
        const aeDir = path.join(aepPath, "AE");
        const dirs = (fs.readdirSync(aeDir, { withFileTypes: true }) as any[])
            .filter((d) => d.isDirectory() && d.name.charAt(0) !== "_")
            .map((d) => d.name as string);
        if (dirs.length) return dirs.sort();
    } catch (e) {
        /* no AE/ subfolder layout -- fall through to filename parsing */
    }
    // (b) parse the creative token out of master filenames, walking a few
    // levels deep (masters folders are modest; cap depth to stay safe).
    const found: Record<string, true> = {};
    const walk = (dir: string, depth: number) => {
        if (depth > 4) return;
        let entries: any[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const en of entries) {
            if (en.name.charAt(0) === "_") continue;
            const full = path.join(dir, en.name);
            if (en.isDirectory()) walk(full, depth + 1);
            else if (/\.aep$/i.test(en.name)) {
                const m = en.name.match(/(?:DOOH|DINTH|DFOH|FOH)_(.+?)_\d+x\d+/i);
                if (m && m[1]) found[m[1]] = true;
            }
        }
    };
    walk(aepPath, 0);
    return Object.keys(found).sort();
}

interface Batch {
    pdfName: string;
    batch: string;
    rows: SpecRow[];
    error?: string;
    // Output folder <Territory>/AE/<paddedBatch> already holds .aep(s) — the
    // batch has been localised before, so seed the button to "Done".
    done?: boolean;
    // Every .aep filename currently in that output folder. Kept (rather than
    // just the boolean above) so each ROW can be matched against what's
    // actually been built — see alreadyBuiltFile(). Empty when the folder
    // doesn't exist yet.
    existing?: string[];
}

// Canonical form for filename matching: uppercase, alphanumerics only. Both
// sides of every comparison below go through this, so "Batch_01"/"batch 1",
// "1080x1920"/"1080X1920" and "Jungle-Tunnel"/"JUNGLE_TUNNEL" all line up.
const canonName = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Boundary-aware containment, used for the campaign check only.
//
// The campaign has to be matched with token boundaries, or "HORSE" happily
// substring-matches a file built for "HORSESHOE" and "FOH" matches "DFOH",
// marking a row built when its deliverable doesn't exist -- exactly the silent
// drop this feature exists to prevent. (Sizes/durations/sites don't need this;
// they're bounded by their own x/sec/adjacent digits.)
//
// But the boundaries can't be required to LINE UP between the two sides. A CSV
// campaign is written however the client wrote it ("JungleTunnel") while the
// .aep carries whatever the master was named ("..._JUNGLE_TUNNEL_..."), so a
// separator-preserving compare ("_JUNGLETUNNEL_" vs "_JUNGLE_TUNNEL_") matches
// nothing -- which is what made a fully-built Croatia Batch_1 read as entirely
// unbuilt. So: strip separators from BOTH sides, but require the occurrence to
// begin at the start of a token and end at the end of one IN THE FILENAME.
// "JUNGLETUNNEL" then matches "_JUNGLE_TUNNEL_" (starts after "_", ends before
// "_") while "HORSE" still can't match inside "_HORSESHOE_".
const tokenised = (s: string) => {
    const up = (s || "").toUpperCase();
    let flat = "";
    const startsToken: boolean[] = [];
    const endsToken: boolean[] = [];
    let afterSep = true;
    for (let i = 0; i < up.length; i++) {
        const c = up.charAt(i);
        if (c >= "A" && c <= "Z" || c >= "0" && c <= "9") {
            flat += c;
            startsToken.push(afterSep);
            endsToken.push(false);
            afterSep = false;
        } else {
            if (flat.length) endsToken[flat.length - 1] = true;
            afterSep = true;
        }
    }
    if (flat.length) endsToken[flat.length - 1] = true;
    return { flat: flat, startsToken: startsToken, endsToken: endsToken };
};

type Tokenised = ReturnType<typeof tokenised>;

/**
 * Is this row's duration present in that filename, under EITHER convention?
 *
 * Files on disk carry one of two forms and both have to keep matching, because
 * nobody is renaming the batches that already exist:
 *
 *   old   …_1080x1920_15sec_EG_V01.aep   ->  flat "…1080X192015SECEGV01AEP"
 *   new   …_1080x1920px_15s_EG_V01.aep   ->  flat "…1080X1920PX15SEGV01AEP"
 *
 * Testing for `<digits>S` covers both at once, since "15SEC" itself begins
 * "15S". The previous version appended "SEC" unconditionally, so every new
 * -convention file read as unbuilt -- and that failed SILENTLY, by re-running
 * deliverables that were already finished rather than by raising anything.
 *
 * The leading-digit guard is a real fix, not defensiveness: separators are
 * stripped from `flat`, so a bare substring test lets a 5-second row match a
 * 15-second file ("15S" contains "5S"). Requiring the character before the
 * digits to be a non-digit rules that out. This bug predates the convention
 * change -- the old "SEC" form had it too.
 */
const durationPresent = (hay: Tokenised, rawDuration: string): boolean => {
    const digits = (rawDuration || "").replace(/[^0-9]/g, "");
    if (!digits) return true;              // no duration on the row = nothing to check
    let from = 0;
    for (;;) {
        const at = hay.flat.indexOf(digits, from);
        if (at === -1) return false;
        // Must be the START of a real token in the filename. A plain substring
        // test cannot work here: separators are stripped from `flat`, so
        // "1920x858_10sec" collapses to "…85810SEC" and a 5-second row would
        // match the "5" inside "858". Token starts are the only surviving
        // boundary information, which is why this takes the Tokenised form
        // rather than the flat string.
        if (hay.startsToken[at]) {
            let end = at;
            while (end < hay.flat.length && !hay.endsToken[end]) end++;
            const token = hay.flat.slice(at, end + 1);
            // Accept BOTH conventions -- "10s" (current) and "10sec" (every
            // batch already on disk, which nobody is renaming).
            if (token === digits + "S" || token === digits + "SEC") return true;
        }
        from = at + 1;
    }
};

const containsAsTokens = (hay: Tokenised, needle: string): boolean => {
    if (!needle) return false;
    let from = 0;
    for (;;) {
        const at = hay.flat.indexOf(needle, from);
        if (at === -1) return false;
        if (hay.startsToken[at] && hay.endsToken[at + needle.length - 1]) return true;
        from = at + 1;
    }
};

/**
 * Which rows of a batch are already localised into its AE folder?
 * Returns one entry per row: the matching .aep filename, or "".
 *
 * WHY THIS IS BATCH-LEVEL AND NOT PER-ROW. The first version tested each row
 * on its own and REQUIRED the row's media-site token to appear in the
 * filename. That found nothing at all against the real Egypt Batch_01, whose
 * files are named `PP3_INTL_DGTL_DINTH_JUNGLETUNNEL_640x768_15sec_EG_V01.aep`
 * -- no site token, because they were built before the Site column existed.
 * Sites can't be a hard requirement.
 *
 * But sites can't just be dropped either: two rows in a batch can be identical
 * apart from the screen (same campaign, size and duration, different site), and
 * ignoring the site would mark BOTH built off one file. So the site is a
 * PREFERENCE, resolved by claiming files in two passes:
 *   1. rows carrying a site claim a core-matching file that also names that
 *      site (the modern, site-stamped filenames);
 *   2. remaining rows claim any core-matching file still unclaimed.
 * Each file can only be claimed ONCE, which is what keeps the two-sites/one-file
 * case honest: the site-stamped row wins it in pass 1, the other row correctly
 * comes back unbuilt.
 *
 * "Core" = campaign + size + duration.
 *
 * ARTWORK WAS DROPPED FROM THE CORE (studio instruction: "match by size and
 * campaign and duration"). It was the wrong kind of check: a Specs PDF is one
 * campaign's batch, so the artwork column is effectively constant down it and
 * discriminates nothing between rows -- but reshapeSpecs DEFAULTS it to "DOOH"
 * whenever the PDF cell doesn't parse, so a batch actually built as DINTH/DFOH
 * had every row read as unbuilt. Cost of a false "unbuilt" is a re-run; cost of
 * requiring a field that can silently default is the whole feature not working,
 * which is what was reported.
 *
 * WHY THIS MATCHES ON TOKENS rather than rebuilding the expected filename: the
 * generated name is
 *   <FilmTitle>_<INTL|DOM>_DGTL_<Artwork>_<CAMPAIGN>[_SITE]_<WxH>_<dur>sec_<CC>_V01.aep
 * and its first two tokens come from whichever MASTER csvLocaliserRun matches
 * at run time (localise.ts, scanMastersForBestMatch) — the panel can't know
 * them without doing the master scan itself. What the ROW does determine is
 * artwork, campaign, size and duration, and that combination is exactly what
 * makes one deliverable different from another within a batch. So: require all
 * four, as canonical substrings.
 *
 * SITE is required too WHEN THE ROW HAS ONE, because two rows in a batch can be
 * identical apart from the media site (same size, same duration, different
 * screen) and would otherwise collapse onto one file.
 *
 * DELIBERATELY ASYMMETRIC ON FAILURE. The site token is sanitised host-side
 * with full accent folding (csvLocSanitiseSiteToken); this only strips to
 * A-Z0-9, so an accented site name ("Gare de l'Est") canonicalises differently
 * here and the row reads as NOT built. That's the safe direction: the row stays
 * ticked, gets localised, and the host's own skipExisting check is the
 * backstop. The reverse mistake — calling something built when it isn't —
 * would silently drop a deliverable, which is the failure this whole feature
 * exists to prevent.
 */
export function matchBuiltRows(rows: SpecRow[], existing: string[] | undefined): string[] {
    const out = rows.map(() => "");
    if (!existing || !existing.length) return out;

    const files = existing.map((f) => ({ name: f, flat: canonName(f), tokens: tokenised(f), claimed: false }));

    const coreMatches = (row: SpecRow, f: typeof files[number]): boolean => {
        const size = canonName(row.Size);                  // 1080X1920
        const campaign = canonName(row.Campaign);          // JUNGLETUNNEL
        if (!size || !campaign) return false;
        if (f.flat.indexOf(size) === -1) return false;     // "…1080X1920PX…" still contains it
        if (!durationPresent(f.tokens, row.Duration)) return false;
        if (!containsAsTokens(f.tokens, campaign)) return false;
        return true;
    };

    const claim = (i: number, f: typeof files[number]) => {
        f.claimed = true;
        out[i] = f.name;
    };

    // Pass 1 -- site-stamped filenames go to the row that names that site.
    rows.forEach((row, i) => {
        const site = canonName(row.Site);
        if (!site || site.length < 3) return;
        for (const f of files) {
            if (f.claimed) continue;
            if (f.flat.indexOf(site) === -1) continue;
            if (!coreMatches(row, f)) continue;
            claim(i, f);
            return;
        }
    });

    // Pass 2 -- everything else takes the first unclaimed core match.
    rows.forEach((row, i) => {
        if (out[i]) return;
        for (const f of files) {
            if (f.claimed) continue;
            if (!coreMatches(row, f)) continue;
            claim(i, f);
            return;
        }
    });

    return out;
}

/**
 * Which rows of a batch are exact duplicates of an earlier row?
 * Returns one entry per row: the index of the first row it duplicates, or -1.
 *
 * WHY THIS EXISTS. A specs PDF sometimes lists the same deliverable twice (a
 * real one: a Ukraine Batch_1 carrying 1080x1920 on two rows). Every field that
 * decides the output filename is identical, so csvLocaliserRun would write the
 * SAME file for both -- meaning only one file can ever exist for the pair, and
 * matchBuiltRows' one-file-one-claim rule correctly leaves the second row
 * ticked forever. That is right, but it looks EXACTLY like a genuinely missing
 * deliverable, which is what prompted this tag.
 *
 * The key is every field the generated name is built from that the ROW itself
 * determines -- artwork, campaign, site, size, duration. Two rows differing
 * only by site are NOT duplicates: they produce different filenames and are the
 * case matchBuiltRows' pass 1 exists to keep honest.
 *
 * Compared on the canonical form (case and separators stripped), the same
 * spelling-tolerant comparison matchBuiltRows uses -- "Jungle Tunnel" and
 * "JungleTunnel" on two rows is still one deliverable listed twice.
 */
export function duplicateRowOf(rows: SpecRow[]): number[] {
    const firstSeen: Record<string, number> = {};
    return rows.map((r, i) => {
        const key = [r.Artwork, r.Campaign, r.Site || "", r.Size, r.Duration].map(canonName).join("|");
        // A row too empty to identify (no size or no campaign) is never called a
        // duplicate -- it hasn't parsed enough to know what it is.
        if (!canonName(r.Size) || !canonName(r.Campaign)) return -1;
        if (firstSeen[key] === undefined) {
            firstSeen[key] = i;
            return -1;
        }
        return firstSeen[key];
    });
}

/**
 * Where a batch's .aep files actually live, or "" if there's no such folder.
 *
 * csvLocaliserRun WRITES to <Source Folder>/AE/<paddedBatch> ("Batch_2" ->
 * "Batch_02"), but a folder made by hand, by an older build, or by one of the
 * other localisation tools is just as likely to be "Batch_2"/"batch 2". Looking
 * only for the padded spelling is why a batch that was plainly already built
 * came back with nothing existing, so every row stayed ticked. So: prefer the
 * exact padded name, then fall back to whichever child of AE/ canonicalises to
 * the same thing (case, separators and a leading zero all ignored).
 */
function resolveBatchFolder(sourceFolder: string, batch: string): string {
    const aeDir = path.join(sourceFolder, "AE");
    const exact = path.join(aeDir, padBatch(batch));
    try {
        if (fs.readdirSync(exact)) return exact;
    } catch (e) {
        // not there under that spelling — fall through to the loose match
    }
    // "Batch_2"/"batch 02"/"BATCH2" all reduce to "BATCH2".
    const loose = (s: string) => canonName(s).replace(/0+(\d)$/, "$1");
    const want = loose(batch);
    try {
        for (const child of fs.readdirSync(aeDir)) {
            if (loose(child) !== want) continue;
            try {
                fs.readdirSync(path.join(aeDir, child));
                return path.join(aeDir, child);
            } catch (e) {
                // a FILE whose name happens to match — keep looking
            }
        }
    } catch (e) {
        // no AE folder at all
    }
    return "";
}

/** The .aep files sitting in a batch's output folder right now. */
function readExistingAeps(sourceFolder: string, batch: string): string[] {
    const dir = resolveBatchFolder(sourceFolder, batch);
    if (!dir) return []; // no output folder yet — a brand-new batch
    try {
        return fs.readdirSync(dir).filter((f: string) => /\.aep$/i.test(f));
    } catch (e) {
        return [];
    }
}

interface TerritoryScan {
    territory: string;
    sourceFolder: string;
    batches: Batch[];
    rowCount: number;
    hasSpecs: boolean;
    // Specs PDFs are read PER TERRITORY, on expand -- not up front. The scan
    // button used to parse every PDF under every territory before you had
    // looked at anything, which on the NAS is most of the wait, for work you
    // may never open. Same eager-to-lazy move Localised Library's JPG_PNG
    // browse already made, for the same reason.
    loaded: boolean;
}

// Which master each row resolves to, from the read-only preview. A null master
// means nothing matched -- that row would come back "no-master" on a real run.
interface ResolvedMaster {
    master: string | null;
    path: string | null;
    // Every factor that divides this row's duration exactly AND has a master,
    // ascending — so a 30s row with both a 15s and a 10s master offers 2× then
    // 3×, and the control can cycle between them. Populated only when there is
    // no same-duration master. An OFFER: nothing is built this way unless the
    // row is opted in. See multipleMasterOptions in jsx/aeft/tools.ts.
    multiples?: { factor: number; duration: string; master: string }[];
}

const isBridge = () => typeof (window as any).cep !== "undefined";
const batchKey = (territory: string, pdfName: string) => `${territory}/${pdfName}`;

// Map a csvLocaliserRun result into the shared LocGen report shape so it pops
// the same modal as Generate/Trott. runId comes from the host so this live
// popup dedupes against the persisted-report poller (no double-show).
function csvResultToLocGenReport(res: {
    message?: string;
    outputFolder?: string;
    rows?: CsvLocRow[];
    runId?: string;
    finishedAt?: string;
}, label: string): LocGenReport {
    const rows: LocGenRow[] = (res.rows || []).map((r) => ({
        source: "Row " + r.row + (r.campaign ? " · " + r.campaign : ""),
        artwork: r.artwork,
        campaign: r.campaign,
        size: r.size,
        duration: r.duration,
        status: r.status,
        master: r.master,
        output: r.output,
        error: r.error,
        imagesReplaced: r.imagesReplaced,
        imagesNote: r.imagesNote,
    }));
    return { tool: label, message: res.message, outputFolder: res.outputFolder, rows, runId: res.runId, finishedAt: res.finishedAt };
}

// csvLocaliserRun writes to <Source Folder>/AE/<paddedBatch> and pads a lone
// trailing digit (Batch_1 -> Batch_01), so mirror that to find the folder.
const padBatch = (batch: string) => batch.replace(/(\d+)$/, (d) => (d.length === 1 ? "0" + d : d));

/** Last path segment, for the collapsed summary. Handles both separators and a
 *  trailing slash; returns "" rather than a stray separator. */
function baseName(p: string): string {
    const clean = String(p || "").replace(/[\\/]+$/, "");
    const bits = clean.split(/[\\/]/);
    return bits[bits.length - 1] || "";
}

const CSVLocaliserTool = ({ onSelectTool }: ToolProps) => {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [campaignName, setCampaignName] = useState("");
    const [aepPath, setAepPath] = useState("");
    const [mastersAuto, setMastersAuto] = useState(false);
    const [marketsRoot, setMarketsRoot] = useState("");
    const [skipExisting, setSkipExisting] = useState(true);
    // Inline MC It! -- ON by default. Each generated file is already open and
    // about to be saved, so swapping its PNG/JPG footage in that same session
    // costs no extra open/save cycle; running MC It! separately afterwards
    // reopens and resaves every file for the same result. The image folder is
    // derived (<Territory>/JPG_PNG/<Batch>, sibling of the AE folder), never
    // asked for -- see csvLocaliserRun's mcIt setup block.
    const [runMcIt, setRunMcIt] = useState(true);
    // Batches whose footage was already swapped by the inline pass this
    // session (keyed by batchKey). Only used to relabel the standalone MC It!
    // button as a deliberate RE-run, so it doesn't read as the expected next
    // step after localising -- a dry run there would list swaps that are
    // effectively no-ops (MC It! re-matches already-localised footage by
    // design), which is easy to misread as "the inline pass didn't work".
    const [mcItInlineDone, setMcItInlineDone] = useState<Record<string, boolean>>({});
    // Batch sections, keyed by batchKey. Stores the OPEN ones, so everything
    // starts COLLAPSED -- a territory is often several batches deep and having
    // every row table expanded at once made it hard to tell which batch you
    // were actually editing. The open one is highlighted (.is-open) for the
    // same reason. Not an accordion: opening a second batch doesn't close the
    // first, since comparing two batches' rows is a real thing to want.
    const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
    const toggleBatchCollapsed = (key: string) =>
        setExpandedBatches((s) => {
            const next = new Set(s);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    // Open a batch without toggling -- used when a run starts, so its result
    // lines aren't written into a section the user can't see.
    const openBatch = (key: string) =>
        setExpandedBatches((s) => (s.has(key) ? s : new Set(s).add(key)));
    // The tool's own root, used only to read the category tint back off it for
    // portalled content.
    const toolRootRef = useRef<HTMLDivElement>(null);

    // categoryStyleVars() sets --cat-* as an inline style on an ANCESTOR of
    // this tool (see main.tsx / ToolScreen), so they cascade normally into the
    // tool but NOT into anything portalled to <body>. Read the resolved values
    // back off the tool root and hand them to the portal. Every consumer has a
    // var(--cat-x, fallback), so a miss degrades to the theme accent rather
    // than to nothing — but the tint is the point, so copy it properly.
    const portalCatVars = (): React.CSSProperties => {
        const el = toolRootRef.current;
        if (!el || typeof getComputedStyle !== "function") return {};
        const cs = getComputedStyle(el);
        const out: Record<string, string> = {};
        const names = ["--cat-grad", "--cat-border", "--cat-glow", "--cat-icon"];
        for (const n of names) {
            const v = cs.getPropertyValue(n);
            if (v && v.trim() !== "") out[n] = v.trim();
        }
        return out as React.CSSProperties;
    };

    const collapseBatch = (key: string) =>
        setExpandedBatches((s) => {
            if (!s.has(key)) return s;
            const next = new Set(s);
            next.delete(key);
            return next;
        });

    // Escape closes the open batch modal. Bound once for the whole tool rather
    // than per batch, and only while something is actually open, so it can't
    // swallow Escape from the rest of the panel. Closes ALL open batches: only
    // one can realistically be open at a time now that they are modal, but a
    // run auto-opens one, so this stays defensive.
    useEffect(() => {
        if (expandedBatches.size === 0) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setExpandedBatches(new Set());
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [expandedBatches]);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const [scan, setScan] = useState<TerritoryScan[] | null>(null);


    // Territories whose specs are being read right now (one spinner each).

    const [loadingTerr, setLoadingTerr] = useState<Set<string>>(new Set());

    // batchKey -> per-row resolved master, from the read-only preview.

    const [masters, setMasters] = useState<Record<string, ResolvedMaster[]>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    // Per-batch run state, keyed by `${territory}/${pdfName}`.
    const [batchStatus, setBatchStatus] = useState<Record<string, "running" | "done" | "failed">>({});
    // Per-batch localiser row results (csvLocaliserRun's structured report),
    // same key -- rendered inline under the batch after a run.
    const [batchRows, setBatchRows] = useState<Record<string, CsvLocRow[]>>({});
    // Rows the user has DISCARDED from a batch before running, keyed by the
    // batch key -> a set of row indices (into b.rows). Purpose: a Wrike task
    // put on hold still shows up in the fetched Specs PDF, so let the user
    // uncheck those rows and localise only the rest. Purely a frontend filter
    // -- the excluded rows never reach buildLocaliserCsv, so the host never
    // sees them.
    const [excludedRows, setExcludedRows] = useState<Record<string, Set<number>>>({});

    const isRowExcluded = (key: string, idx: number) => !!excludedRows[key]?.has(idx);


    // The multiple each row is explicitly opted in to: batch key -> row index
    // -> factor (2, 3, …). Absent means off, which is the default for every
    // row — a run can never substitute a different duration than the specs
    // asked for unless someone clicked.
    const [multipleRows, setMultipleRows] = useState<Record<string, Record<number, number>>>({});

    const rowMultiple = (key: string, idx: number) => multipleRows[key]?.[idx] || 0;

    // Cycles off -> first available factor -> next -> … -> off. Driven by the
    // factors the HOST said exist for this row, so a 30s row with both a 15s
    // and a 10s master offers 2× then 3×, while one with only a 15s master
    // offers 2× and nothing else.
    const cycleRowMultiple = (key: string, idx: number, available: number[]) => {
        setMultipleRows((prev) => {
            const current = prev[key]?.[idx] || 0;
            const at = available.indexOf(current);
            // -1 (off, or a factor that no longer exists) restarts at the
            // first option; past the end wraps back to off.
            const nextFactor = at === -1 ? available[0] : at + 1 < available.length ? available[at + 1] : 0;
            const forKey = { ...(prev[key] || {}) };
            if (nextFactor) forKey[idx] = nextFactor;
            else delete forKey[idx];
            return { ...prev, [key]: forKey };
        });
    };

    const toggleRowExcluded = (key: string, idx: number) => {
        setExcludedRows((prev) => {
            const next = new Set(prev[key] || []);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return { ...prev, [key]: next };
        });
    };

    // Exclude / include EVERY row in a batch at once (header checkbox).
    const setAllRowsExcluded = (key: string, rowCount: number, excluded: boolean) => {
        setExcludedRows((prev) => {
            const next = new Set<number>();
            if (excluded) for (let i = 0; i < rowCount; i++) next.add(i);
            return { ...prev, [key]: next };
        });
    };

    const includedCount = (key: string, rowCount: number) => rowCount - (excludedRows[key]?.size || 0);

    // Per-cell manual edits, keyed by batch key -> row index -> field overrides.
    // The scanned SpecRow (straight from the PDF parse) is left untouched; this
    // overlay wins at render AND at run time (see effectiveRow), so a mis-parsed
    // value — a wrong size, a dropped campaign name — can be corrected in place
    // without re-scanning, and reverted back to what the PDF said. Same overlay
    // pattern as excludedRows: the host only ever sees the effective rows.
    const [editedRows, setEditedRows] = useState<Record<string, Record<number, Partial<SpecRow>>>>({});

    // The row as it will actually be localised: PDF parse + any manual edits.
    const effectiveRow = (key: string, idx: number, r: SpecRow): SpecRow => ({ ...r, ...(editedRows[key]?.[idx] || {}) });

    const isRowEdited = (key: string, idx: number) => {
        const patch = editedRows[key]?.[idx];
        return !!patch && Object.keys(patch).length > 0;
    };

    const editRowField = (key: string, idx: number, field: keyof SpecRow, value: string) =>
        setEditedRows((prev) => {
            const batch = { ...(prev[key] || {}) };
            batch[idx] = { ...(batch[idx] || {}), [field]: value };
            return { ...prev, [key]: batch };
        });

    // ── Active Jobs snapshot for the home screen ──────────────────────────
    // Published whenever the scan changes (a fresh scan, a run, a Re-check).
    // This deliberately re-uses matchBuiltRows — the SAME function that tints
    // the rows and unticks the built ones — so the home card can never
    // disagree with what this table shows. Nothing extra is read from disk:
    // every input here is already in memory by the time this runs.
    //
    // Fire-and-forget: the snapshot is a convenience, and failing to write it
    // must never interrupt a scan.
    useEffect(() => {
        if (!scan) return;
        const jobs: {
            territory: string;
            batch: string;
            pdfName: string;
            sourceFolder: string;
            total: number;
            built: number;
        }[] = [];
        scan.forEach((t) => {
            t.batches.forEach((b) => {
                if (!b.rows.length) return;
                const key = batchKey(t.territory, b.pdfName);
                const effRows = b.rows.map((r, i) => effectiveRow(key, i, r));
                const built = matchBuiltRows(effRows, b.existing).filter(Boolean).length;
                jobs.push({
                    territory: t.territory,
                    batch: b.batch,
                    pdfName: b.pdfName,
                    sourceFolder: t.sourceFolder,
                    total: b.rows.length,
                    built,
                });
            });
        });
        try {
            Promise.resolve(
                evalTS("saveActiveJobs", JSON.stringify({ capturedAt: Date.now(), jobs }))
            ).catch(() => {});
        } catch (e) {
            /* no bridge — browser preview */
        }
    }, [scan, editedRows]);

    // Drop every override on one row, snapping it back to the parsed values.
    const revertRow = (key: string, idx: number) =>
        setEditedRows((prev) => {
            if (!prev[key]) return prev;
            const batch = { ...prev[key] };
            delete batch[idx];
            return { ...prev, [key]: batch };
        });

    // ── manual batch builder ("Build a batch" — the visual alternative to
    // Paste CSV): pick one territory from the campaign, pick creatives from the
    // masters, type widths/heights, and it assembles the same [METADATA]/CSV
    // csvLocaliserRun consumes. One territory at a time, by request.
    const [buildOpen, setBuildOpen] = useState(false);
    const [buildTerritory, setBuildTerritory] = useState("");
    const [buildBatch, setBuildBatch] = useState("Batch_1");
    const [buildTerritories, setBuildTerritories] = useState<string[]>([]);
    const [buildCreatives, setBuildCreatives] = useState<string[]>([]);
    const [buildRows, setBuildRows] = useState<BuildRow[]>([
        { id: 1, artwork: "DOOH", creative: "", custom: "", site: "", width: "", height: "", duration: "" },
    ]);
    const buildRowId = useRef(2);
    // A batch handed over from the Active Jobs modal ("Send N rows to
    // Localise"), consumed once on mount. Kept in state only so the notice
    // below can name the job it came from.
    const [handoff, setHandoff] = useState<PendingBatch | null>(null);

    useEffect(() => {
        const pending = takePendingBatch();
        if (!pending || !pending.rows.length) return;
        setHandoff(pending);
        setBuildRows(
            pending.rows.map((r, i) => ({
                id: i + 1,
                artwork: r.artwork || "DOOH",
                // The creative comes from the parsed subtask name, which is
                // free text as far as the builder is concerned -- so it goes in
                // via CUSTOM_CREATIVE rather than the scanned-creatives
                // dropdown, which would silently blank anything not in the
                // masters folder listing.
                creative: CUSTOM_CREATIVE,
                custom: r.creative,
                // Straight from the subtask name's own site token, in the case
                // Wrike carries it -- that case is the point (see
                // csvLocSanitiseSiteToken), so nothing here re-cases it.
                site: r.site || "",
                width: r.width,
                height: r.height,
                duration: r.duration,
            }))
        );
        buildRowId.current = pending.rows.length + 1;
        setBuildBatch(pending.batch || "Batch_1");
        // Territory is NOT set blindly: the dropdown lists scanned FOLDER names
        // ("Italy"), while the Wrike title carries a code ("IT"). Setting an
        // unmatched value would look like a selection that then fails on run.
        // The effect below resolves it once the territory list has loaded.
        setBuildOpen(true);
    }, []);

    // Resolve the handoff's territory code against the scanned folder names,
    // once those exist. Exact, then prefix -- "IT" matching "Italy" is a guess
    // worth making, "IT" matching "ITALY_ARCHIVE" is not, so anything
    // ambiguous is left for the user to pick.
    useEffect(() => {
        if (!handoff || !handoff.territory || !buildTerritories.length) return;
        const code = handoff.territory.toLowerCase();
        const exact = buildTerritories.find((t) => t.toLowerCase() === code);
        const prefixed = buildTerritories.filter((t) => t.toLowerCase().indexOf(code) === 0);
        const hit = exact || (prefixed.length === 1 ? prefixed[0] : "");
        if (hit) setBuildTerritory(hit);
    }, [handoff, buildTerritories]);
    // Master lookup for the builder's rows, keyed by ROW ID (not position --
    // rows are added and removed, and a positional key would smear one row's
    // result onto another). Same resolver the specs table uses, so a hand-built
    // row gets the same duration-multiple offer.
    const [buildMasters, setBuildMasters] = useState<Record<number, ResolvedMaster>>({});
    // Chosen multiple per builder row, row id -> factor. Absent = off.
    const [buildMultiples, setBuildMultiples] = useState<Record<number, number>>({});

    const cycleBuildMultiple = (id: number, available: number[]) =>
        setBuildMultiples((prev) => {
            const current = prev[id] || 0;
            const at = available.indexOf(current);
            const nextFactor = at === -1 ? available[0] : at + 1 < available.length ? available[at + 1] : 0;
            const next = { ...prev };
            if (nextFactor) next[id] = nextFactor;
            else delete next[id];
            return next;
        });

    // Load territories + creatives whenever the builder is open and its inputs
    // change (campaign switch re-scans). Quiet — no bridge / empty are normal.
    useEffect(() => {
        if (!buildOpen) return;
        let cancelled = false;
        (async () => {
            try {
                if (marketsRoot) {
                    const terrs: string[] = (await evalTS("scanTerritories", marketsRoot)) || [];
                    if (cancelled) return;
                    setBuildTerritories(terrs);
                    setBuildTerritory((cur) => (cur && terrs.indexOf(cur) !== -1 ? cur : terrs[0] || ""));
                }
            } catch (e) { /* no bridge / no territories */ }
            try {
                if (aepPath && !cancelled) setBuildCreatives(scanCreativesFromMasters(aepPath));
            } catch (e) { /* fs unavailable in preview */ }
        })();
        return () => { cancelled = true; };
    }, [buildOpen, marketsRoot, aepPath]);

    const updateBuildRow = (id: number, patch: Partial<BuildRow>) =>
        setBuildRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const addBuildRow = () =>
        setBuildRows((rs) => [...rs, { id: buildRowId.current++, artwork: "DOOH", creative: "", custom: "", site: "", width: "", height: "", duration: "" }]);
    const removeBuildRow = (id: number) =>
        setBuildRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

    const buildRowCreative = (r: BuildRow) => (r.creative === CUSTOM_CREATIVE ? r.custom.trim() : r.creative);
    const buildComplete = buildRows.filter((r) => buildRowCreative(r) && r.width && r.height && r.duration);

    // Look up a master for each COMPLETE builder row, so a row asking for a
    // duration no master has can still be offered "build it from the 15sec one
    // twice" -- the same offer the scanned specs table makes.
    //
    // DEBOUNCED, and this is the whole design constraint: unlike the specs
    // table (resolved once per scan), these rows change on every keystroke, and
    // csvLocaliserResolveMasters walks the entire masters tree on the NAS per
    // call. One call for ALL complete rows, 500ms after typing stops.
    const buildResolveKey = buildRows
        .map((r) => `${r.id}:${buildRowCreative(r)}|${r.width}x${r.height}|${r.duration}`)
        .join(";");

    useEffect(() => {
        if (!buildOpen || !aepPath) return;
        const complete = buildRows.filter((r) => buildRowCreative(r) && r.width && r.height && r.duration);
        if (!complete.length) {
            setBuildMasters({});
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const payload = complete.map((r) => ({
                    campaign: buildRowCreative(r),
                    size: `${parseInt(r.width, 10)}x${parseInt(r.height, 10)}`,
                    duration: `${parseInt(r.duration, 10)}sec`,
                }));
                const res = await evalTS("csvLocaliserResolveMasters", aepPath, JSON.stringify(payload));
                if (cancelled || res === undefined || !(res as { success?: boolean }).success) return;
                const resolved = ((res as { rows?: ResolvedMaster[] }).rows || []);
                const next: Record<number, ResolvedMaster> = {};
                complete.forEach((r, n) => {
                    if (resolved[n]) next[r.id] = resolved[n];
                });
                setBuildMasters(next);
            } catch (e) {
                /* preview only -- never block the builder on a lookup */
            }
        }, 500);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [buildOpen, aepPath, buildResolveKey]);

    const runBuilder = async () => {
        if (!aepPath) { setNotice("Pick the AEP masters folder first."); return; }
        if (!buildTerritory) { setNotice("Pick a territory to build for."); return; }
        const rows: SpecRow[] = buildComplete.map((r) => ({
            Artwork: r.artwork || "DOOH",
            Campaign: buildRowCreative(r),
            Size: `${parseInt(r.width, 10)}x${parseInt(r.height, 10)}`,
            Duration: String(parseInt(r.duration, 10)),
            Country: buildTerritory,
            // Optional: blank on a hand-typed row for a deliverable with no
            // media site, filled from the Wrike subtask on a handed-over one.
            // buildLocaliserCsv puts it in the CSV's trailing Site column, and
            // an empty one produces a filename with no site token at all --
            // exactly the pre-Site behaviour.
            Site: r.site.trim(),
            // Build-a-batch is hand-typed, so there is no PDF to read a target
            // size, bitrate or frame rate off. Left blank rather than defaulted:
            // an invented delivery spec is worse than an absent one.
            FileSize: "",
            BitRate: "",
            Fps: "",
            // Same reasoning: nothing to read a sound requirement off either,
            // and "" means "the sheet didn't say" rather than "no sound".
            Sound: "",
            Flags: "",
        }));
        if (!rows.length) { setNotice("Add at least one complete row (creative, width, height, duration)."); return; }

        setBusy(true);
        setNotice(null);
        try {
            const { buildLocaliserCsv } = await import("../lib/pdfSpecs");
            const sourceFolder = path.join(marketsRoot, buildTerritory);
            const batch = buildBatch.trim() || "Batch_1";
            const csv = buildLocaliserCsv({ territory: buildTerritory, batch, sourceFolder, rows });
            // Indexed by position in buildComplete -- the same list that became
            // the CSV. Incomplete rows are filtered out before this, so a
            // builder row's own position is NOT the CSV index, exactly the trap
            // the specs table's excluded rows create.
            const multiplesForRun: Record<number, number> = {};
            buildComplete.forEach((r, n) => {
                const f = buildMultiples[r.id];
                if (f > 1) multiplesForRun[n] = f;
            });
            const res = await evalTS("csvLocaliserRun", aepPath, csv, skipExisting, runMcIt, JSON.stringify(multiplesForRun));
            if (res === undefined) throw new Error("no bridge");
            if (res.success) {
                const rrows = (res as { rows?: CsvLocRow[] }).rows || [];
                const problems = rrows.filter((r) => r.status === "no-master" || r.status === "error").length;
                setNotice(`${buildTerritory} · ${batch}: ${res.message || "run finished."}` + (problems ? ` — ${problems} row(s) had no master match.` : ""));
                if (rrows.length) showLocGenReport(csvResultToLocGenReport(res as any, `CSV Localiser (built) · ${buildTerritory} · ${batch}`));
            } else {
                setNotice(res.error || "Something went wrong.");
            }
        } catch (e: any) {
            setNotice(e?.message || "No CEP bridge — open this panel inside After Effects to run it.");
        } finally {
            setBusy(false);
        }
    };

    // paste fallback

    const refreshCampaigns = async () => {
        try {
            const camps = await evalTS("loadLocLibCampaigns");
            if (camps) setCampaigns(camps as Campaign[]);
        } catch (e) {
            /* browser preview -- no bridge */
        }
    };

    useEffect(() => {
        (async () => {
            await refreshCampaigns();
            try {
                const last = await evalTS("csvLocaliserLoadLastPath");
                if (last) setAepPath(last);
            } catch (e) {
                /* browser preview -- no bridge */
            }
        })();
    }, []);

    // Restore the campaign that was selected last time, which brings its
    // Markets folder (and derived Masters) back with it -- the Markets folder
    // is the same one all campaign long, so re-picking it every panel open was
    // pure repetition. Runs once the campaign list is loaded and only if
    // nothing's been picked in the meantime; a saved name that no longer
    // matches a campaign restores nothing. Silent: this is a restore, not a
    // thing that happened, so it doesn't announce itself in the notice line.
    useEffect(() => {
        if (campaigns.length === 0 || campaignName) return;
        (async () => {
            try {
                const lastCampaign = await evalTS("csvLocaliserLoadLastCampaign");
                if (lastCampaign && campaigns.some((c) => c.name === lastCampaign)) {
                    selectCampaign(lastCampaign, true);
                }
            } catch (e) {
                /* browser preview -- no bridge */
            }
        })();
    }, [campaigns]);

    // Selecting a saved campaign (shared with Localised Library) fills Markets
    // from the campaign and derives Masters from its sibling in the same root.
    // Storing just the NAME keeps the campaign record the single source of
    // truth for its Markets path -- re-point it in Localised Library and this
    // follows automatically instead of holding a stale copy.
    const selectCampaign = (name: string, restoring = false) => {
        const c = campaigns.find((c) => c.name === name);
        if (!c) return;
        setCampaignName(name);
        setMarketsRoot(c.marketsRoot);
        setScan(null);
        const masters = deriveMastersFromMarkets(c.marketsRoot);
        setMastersAuto(!!masters);
        if (masters) setAepPath(masters);
        if (!restoring) {
            setNotice(masters ? "Markets from campaign; Masters auto-detected from its root." : "Markets set — pick the AEP masters folder below.");
            evalTS("csvLocaliserSaveLastCampaign", name).catch(() => {});
        }
    };

    // Add a campaign the same way Localised Library does, so they stay in sync.
    const addCampaign = async () => {
        try {
            const name = await promptDialog("Campaign name (e.g. INTL_DIGITAL_Outdoor_Campaign):", "");
            if (!name) return;
            if (campaigns.some((c) => c.name === name)) {
                await alertDialog(`A campaign named "${name}" already exists.`);
                return;
            }
            const mr = await evalTS("selectMarketsFolder");
            if (mr === undefined) throw new Error("no bridge");
            if (!mr) return;
            const res = await evalTS("saveLocLibCampaign", name, mr);
            if (!res || !res.success) {
                await alertDialog((res && res.error) || "Could not save campaign.");
                return;
            }
            await refreshCampaigns();
            selectCampaign(name);
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects.");
        }
    };

    // --- campaign housekeeping ------------------------------------------
    // Three separate concerns that all show up on the same picker row, kept
    // apart on purpose because they have genuinely different blast radii:
    //   reachability -- this machine only, read-only, advisory
    //   remove       -- this machine only, destructive, undoable by re-adding
    //   retire       -- the whole studio, advisory, reversible
    // Nothing here ever deletes anything from anyone ELSE's machine.

    // Which campaigns' Markets roots resolve right now. Re-read whenever the
    // list changes. Quiet: no bridge, or an unmounted NAS, is a normal state
    // and must never toast (CLAUDE.md).
    const [campaignReach, setCampaignReach] = useState<Record<string, boolean>>({});
    const reduced = useReducedMotion();
    // --- landing state -----------------------------------------------------
    // This tool mounts EXPANDED on the Localise screen, so every visit opened
    // with a setup form aimed at someone who filled it in weeks ago. The
    // campaign and both paths are remembered, so on the common visit there is
    // nothing to ask.
    //
    // FAILS SOFT, deliberately: reachability is only a blocker when the check
    // actually RAN and said no (`=== false`). An undefined entry means "not
    // asked" -- an unmounted share or a check still in flight -- and must not
    // collapse the form OR claim anything is missing. Per CLAUDE.md, an
    // unreachable team path means "not mounted right now", never "gone".
    const [setupOpen, setSetupOpen] = useState(false);
    const setupComplete =
        !!campaignName && !!marketsRoot && !!aepPath && campaignReach[campaignName] !== false;
    const showSetup = setupOpen || !setupComplete;
    // The team's shared campaign board, and whether we could actually READ it.
    // `read` false means "couldn't ask" -- distinct from "nothing is retired",
    // and the UI must not show a retired-marker vacuum as fact.
    const [teamCampaigns, setTeamCampaigns] = useState<{ read: boolean; rows: TeamCampaignRow[] }>({ read: false, rows: [] });

    const refreshCampaignStatus = useCallback(async () => {
        try {
            const rows = (await evalTS("locLibCampaignStatus")) as { name: string; reachable: boolean }[] | undefined;
            if (rows) {
                const next: Record<string, boolean> = {};
                rows.forEach((r) => { next[r.name] = r.reachable; });
                setCampaignReach(next);
            }
        } catch (e) { /* no bridge — leave every campaign unmarked */ }
        try {
            const board = (await evalTS("teamCampaignBoard")) as { read?: boolean; rows?: TeamCampaignRow[] } | undefined;
            if (board && board.read) setTeamCampaigns({ read: true, rows: board.rows || [] });
        } catch (e) { /* team folder unreachable — keep whatever we last had */ }
    }, []);

    useEffect(() => {
        if (campaigns.length) refreshCampaignStatus();
    }, [campaigns, refreshCampaignStatus]);

    const retiredEntry = (name: string) =>
        teamCampaigns.rows.find((r) => r.name.toLowerCase() === name.toLowerCase() && r.retiredBy);

    // Remove from THIS machine. The confirm names the part nobody would guess
    // from this screen: the campaign list is shared with Localised Library, so
    // this also drops that campaign's saved component entries there.
    const removeCampaign = async () => {
        if (!campaignName) return;
        const ok = await confirmDialog(
            `Remove "${campaignName}" from this machine's campaign list?\n\n` +
                `It also disappears from Localised Library, along with that campaign's saved component entries and custom folders. ` +
                `Files on disk are untouched, and you can add it back by pointing at its Markets folder again.\n\n` +
                `This changes nothing for anyone else — use "Retire for team" if the volume has been archived.`
        );
        if (!ok) return;
        try {
            const res = await evalTS("removeLocLibCampaign", campaignName);
            if (!res || !res.success) {
                await alertDialog((res && (res as { error?: string }).error) || "Could not remove the campaign.");
                return;
            }
            setCampaignName("");
            setMarketsRoot("");
            setScan(null);
            await refreshCampaigns();
            await refreshCampaignStatus();
            setNotice(`Removed "${campaignName}" from this machine.`);
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects.");
        }
    };

    // Push this campaign's Markets path to the team library, so the next
    // person doesn't have to browse for it. Merges; never repoints a path the
    // team already holds.
    const shareCampaign = async () => {
        const camp = campaigns.find((c) => c.name === campaignName);
        if (!camp) return;
        try {
            const res = await evalTS("teamShareLocCampaign", JSON.stringify({ name: camp.name, marketsRoot: camp.marketsRoot }));
            if (res === undefined) throw new Error("no bridge");
            setNotice((res as { message?: string; error?: string }).message || (res as { error?: string }).error || "");
            await refreshCampaignStatus();
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects.");
        }
    };

    // Mark retired for the whole studio (or undo that). Advisory: it marks
    // every picker, and stops NEW machines pulling the campaign on sync, but
    // never deletes a local list entry -- not even this machine's.
    const toggleRetireCampaign = async () => {
        if (!campaignName) return;
        const already = !!retiredEntry(campaignName);
        if (!already) {
            const ok = await confirmDialog(
                `Mark "${campaignName}" retired for the whole team?\n\n` +
                    `Everyone's picker will show it as retired, and machines syncing from now on won't pick it up. ` +
                    `Nobody's existing campaign list is changed, and you can un-retire it here.`
            );
            if (!ok) return;
        }
        try {
            const res = await evalTS("teamSetCampaignRetired", campaignName, !already);
            if (res === undefined) throw new Error("no bridge");
            setNotice((res as { message?: string; error?: string }).message || (res as { error?: string }).error || "");
            await refreshCampaignStatus();
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects.");
        }
    };

    const browseAep = async () => {
        try {
            const picked = await evalTS("selectCsvLocaliserAepFolder");
            if (picked === undefined) throw new Error("no bridge");
            if (picked) {
                setAepPath(picked);
                setMastersAuto(false);
            }
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects.");
        }
    };

    const browseMarkets = async () => {
        try {
            const picked = await evalTS("selectMarketsFolder");
            if (picked === undefined) throw new Error("no bridge");
            if (picked) {
                setMarketsRoot(picked);
                setCampaignName("");
                setScan(null);
            }
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects.");
        }
    };

    // ── scan every territory's Masters/Specs for PDFs ─────────────────────────
    const runScan = async () => {
        // Pressing Scan is the moment the setup form has done its job, so it
        // folds itself away rather than sitting above the results it produced.
        setSetupOpen(false);
        setNotice(null);
        if (!isBridge()) {
            setNotice("No CEP bridge — open this panel inside After Effects to scan.");
            return;
        }
        if (!marketsRoot) {
            setNotice("Pick the campaign's Markets folder first.");
            return;
        }
        setBusy(true);
        setScan(null);
        setMasters({});
        try {
            const territories: string[] = (await evalTS("scanTerritories", marketsRoot)) || [];
            // Names only. Nothing inside a territory is read until it is
            // expanded -- see loadTerritory.
            setScan(
                territories.map((territory) => ({
                    territory,
                    sourceFolder: path.join(marketsRoot, territory),
                    batches: [],
                    rowCount: 0,
                    hasSpecs: true,
                    loaded: false,
                }))
            );
            setBatchStatus({});
            setExcludedRows({});
            setNotice(
                territories.length
                    ? `${territories.length} territor${territories.length === 1 ? "y" : "ies"} — open one to read its specs.`
                    : "No territories found under that Markets folder."
            );
        } catch (e: any) {
            setNotice(e?.message || "Scan failed.");
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    // Picking (or changing) the masters folder after territories are already
    // open must re-answer their indicators -- otherwise they sit on "not
    // checked" until the territory is collapsed and reopened.
    useEffect(() => {
        if (!aepPath || !scan) return;
        const loaded = scan.filter((t) => t.loaded && t.rowCount > 0);
        if (!loaded.length) return;
        loaded.forEach((t) => resolveMastersFor(t.territory, t.batches));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aepPath]);

    // Read ONE territory's Specs PDFs. This is the expensive half of what the
    // scan button used to do for every territory at once, now paid only for a
    // territory actually opened, and only once (guarded by `loaded`).
    const loadTerritory = async (t: TerritoryScan) => {
        if (t.loaded || loadingTerr.has(t.territory)) return;
        setLoadingTerr((prev) => new Set(prev).add(t.territory));
        setProgress(`Reading ${t.territory}…`);
        try {
            const { parsePdfDeliverySpecs, reshapeSpecs, batchNameFromFilename } = await import("../lib/pdfSpecs");
            const specsDir = path.join(t.sourceFolder, "Masters", "Specs");
            let pdfs: string[] = [];
            let hasSpecs = true;
            try {
                pdfs = fs.readdirSync(specsDir).filter((f: string) => /\.pdf$/i.test(f));
            } catch (e) {
                hasSpecs = false;
            }

            const batches: Batch[] = [];
            for (const pdfName of pdfs.sort()) {
                const batch = batchNameFromFilename(pdfName);
                const existing = readExistingAeps(t.sourceFolder, batch);
                const done = existing.length > 0;
                try {
                    const buf = fs.readFileSync(path.join(specsDir, pdfName));
                    const raw = await parsePdfDeliverySpecs(new Uint8Array(buf));
                    const rows = raw ? reshapeSpecs(raw, t.territory) : [];
                    batches.push({ pdfName, batch, rows, done, existing, error: rows.length ? undefined : "No spec rows found." });
                } catch (e: any) {
                    batches.push({ pdfName, batch, rows: [], done, existing, error: e?.message || "Couldn't read PDF." });
                }
            }
            const rowCount = batches.reduce((n, b) => n + b.rows.length, 0);

            setScan((prev) =>
                prev
                    ? prev.map((ts) =>
                          ts.territory === t.territory ? { ...ts, batches, rowCount, hasSpecs, loaded: true } : ts
                      )
                    : prev
            );

            // Seed run-state + row exclusions for THIS territory only, by the
            // same rules the whole-scan version used.
            const seed: Record<string, "done"> = {};
            const exclSeed: Record<string, Set<number>> = {};
            batches.forEach((b) => {
                const key = batchKey(t.territory, b.pdfName);
                if (b.done) seed[key] = "done";
                const built = new Set<number>();
                matchBuiltRows(b.rows, b.existing).forEach((f, i) => {
                    if (f) built.add(i);
                });
                if (built.size) exclSeed[key] = built;
            });
            setBatchStatus((prev) => ({ ...prev, ...seed }));
            setExcludedRows((prev) => ({ ...prev, ...exclSeed }));

            resolveMastersFor(t.territory, batches);
        } catch (e: any) {
            setNotice(e?.message || `Couldn't read ${t.territory}.`);
        } finally {
            setLoadingTerr((prev) => {
                const next = new Set(prev);
                next.delete(t.territory);
                return next;
            });
            setProgress(null);
        }
    };

    // One bridge call per territory: the host walks the masters tree ONCE and
    // scores every row against that index, using the same picker the real run
    // uses -- so what this shows and what localising actually does cannot
    // disagree. Best-effort throughout: no masters folder set, no bridge, or a
    // failure simply leaves the indicators neutral rather than raising
    // anything, because this is a preview nobody asked for by clicking.
    const resolveMastersFor = async (territory: string, batches: Batch[]) => {
        if (!aepPath || !isBridge()) return;
        const flat: { key: string; index: number; campaign: string; size: string; duration: string }[] = [];
        batches.forEach((b) => {
            const key = batchKey(territory, b.pdfName);
            b.rows.forEach((r, i) => {
                // EFFECTIVE row, not the raw PDF parse: correcting a mis-read
                // size in place should re-answer "does this find a master?",
                // which is the main reason to correct it at all.
                const eff = effectiveRow(key, i, r);
                flat.push({ key, index: i, campaign: eff.Campaign, size: eff.Size, duration: eff.Duration });
            });
        });
        if (!flat.length) return;
        try {
            const payload = flat.map((f) => ({ campaign: f.campaign, size: f.size, duration: f.duration }));
            const res = await evalTS("csvLocaliserResolveMasters", aepPath, JSON.stringify(payload));
            if (res === undefined || !res.success) return;
            const resolved = (res as { rows?: ResolvedMaster[] }).rows || [];
            setMasters((prev) => {
                const next: Record<string, ResolvedMaster[]> = { ...prev };
                flat.forEach((f, n) => {
                    const arr = (next[f.key] || []).slice();
                    arr[f.index] = resolved[n] || { master: null, path: null };
                    next[f.key] = arr;
                });
                return next;
            });
        } catch (e) {
            /* preview only -- never interrupt the scan for it */
        }
    };

    // Re-read one batch's output folder and re-derive which rows are built.
    // Called after a run so the freshly-written rows untick themselves; also
    // wired to the per-batch "Re-check" button for when files were added or
    // deleted in Finder while the panel sat open.
    //
    // Manual ticks are NOT preserved: this deliberately re-seeds the batch's
    // exclusions from what's on disk, because that's what the button (and a
    // just-finished run) is being asked to report. Any row the user had
    // unticked by hand that ISN'T built comes back ticked -- surprising once,
    // versus silently hiding a deliverable that is genuinely missing.
    const refreshBatchBuilt = (t: TerritoryScan, b: Batch) => {
        const key = batchKey(t.territory, b.pdfName);
        // "Re-check" is the button people press when files changed in Finder
        // while the panel sat open, so it is also the right moment to drop the
        // cached masters index — otherwise a master added since the first
        // lookup keeps reading as "no master" for the rest of the session.
        // Fire-and-forget: a failure here only costs a stale cache.
        if (aepPath) {
            try {
                Promise.resolve(evalTS("invalidateMastersIndex", aepPath)).catch(() => {});
            } catch (e) {
                /* no bridge */
            }
        }
        const existing = readExistingAeps(t.sourceFolder, b.batch);
        setScan((prev) =>
            prev
                ? prev.map((ts) =>
                      ts.territory !== t.territory
                          ? ts
                          : {
                                ...ts,
                                batches: ts.batches.map((bb) =>
                                    bb.pdfName !== b.pdfName ? bb : { ...bb, existing, done: existing.length > 0 }
                                ),
                            }
                  )
                : prev
        );
        const built = new Set<number>();
        // Match on the EFFECTIVE rows (PDF parse + any manual cell edits), the
        // same rows a run would use.
        matchBuiltRows(b.rows.map((r, i) => effectiveRow(key, i, r)), existing).forEach((f, i) => {
            if (f) built.add(i);
        });
        setExcludedRows((prev) => ({ ...prev, [key]: built }));
        // Re-answer the master indicators for this batch too -- Re-check is
        // the natural "I've changed something, look again" button, and after a
        // row edit the previous answer is stale.
        resolveMastersFor(t.territory, [b]);
    };

    // ── run the localiser for ONE batch (one PDF) ─────────────────────────────
    const runBatch = async (t: TerritoryScan, b: Batch) => {
        if (!b.rows.length) return;
        if (!aepPath) {
            setNotice("Pick the AEP masters folder first.");
            return;
        }
        setNotice(null);
        const key = batchKey(t.territory, b.pdfName);
        // Apply any manual cell edits, then drop rows the user discarded (e.g.
        // on-hold Wrike tasks still in the PDF). If they've excluded everything,
        // there's nothing to run.
        const rowsToRun = b.rows
            .map((r, i) => effectiveRow(key, i, r))
            .filter((_, i) => !isRowExcluded(key, i));
        // The host indexes rows as they appear IN THE CSV, and excluded rows
        // never reach the CSV — so a table index of 5 can be CSV index 3.
        // Re-index against the filtered list or the opt-in lands on the wrong
        // deliverable, which would build the wrong row from a multiple.
        const multiplesForRun: Record<number, number> = {};
        let csvIndex = 0;
        b.rows.forEach((_, i) => {
            if (isRowExcluded(key, i)) return;
            const f = rowMultiple(key, i);
            if (f > 1) multiplesForRun[csvIndex] = f;
            csvIndex++;
        });
        if (!rowsToRun.length) {
            setNotice(`${t.territory} · ${b.batch}: every row is excluded — nothing to localise.`);
            return;
        }
        setBatchStatus((s) => ({ ...s, [key]: "running" }));
        // Batches start collapsed, so make sure the one being run is showing --
        // its per-row result lines render inside this section.
        openBatch(key);
        setBusy(true);
        try {
            const { buildLocaliserCsv } = await import("../lib/pdfSpecs");
            const csv = buildLocaliserCsv({ territory: t.territory, batch: b.batch, sourceFolder: t.sourceFolder, rows: rowsToRun });
            const res = await evalTS("csvLocaliserRun", aepPath, csv, skipExisting, runMcIt, JSON.stringify(multiplesForRun));
            if (res === undefined) throw new Error("no bridge");
            const rows = (res.success ? (res as { rows?: CsvLocRow[] }).rows : undefined) || [];
            const problems = rows.filter((r) => r.status === "no-master" || r.status === "error").length;
            if (rows.length) setBatchRows((s) => ({ ...s, [key]: rows }));
            // mcItRan is true only when the pass actually had images to work
            // with -- a derivation miss leaves it false, so the button keeps
            // its normal label and stays the right next step.
            if ((res as { mcItRan?: boolean }).mcItRan) setMcItInlineDone((s) => ({ ...s, [key]: true }));
            setBatchStatus((s) => ({ ...s, [key]: res.success && problems === 0 ? "done" : "failed" }));
            // Re-read the output folder so the rows just written now show as
            // built (and untick themselves). Without this the batch would keep
            // offering to rebuild what it just built until the next full scan.
            if (res.success) refreshBatchBuilt(t, b);
            setNotice(res.success ? `${t.territory} · ${b.batch}: ${res.message || "run finished."}` : res.error || "Something went wrong.");
            // Inline strip above stays; also pop the shared results modal.
            if (res.success && rows.length) showLocGenReport(csvResultToLocGenReport(res as any, `CSV Localiser · ${t.territory} · ${b.batch}`));
        } catch (e: any) {
            setBatchStatus((s) => ({ ...s, [key]: "failed" }));
            setNotice(e?.message || "No CEP bridge — open this panel inside After Effects to run it.");
        } finally {
            setBusy(false);
        }
    };

    // MC It! for ONE batch, dialogs-free: the scan already knows the AEP
    // output folder (<Territory>/AE/<paddedBatch>) and mcIt() derives the
    // JPG_PNG sibling itself. Dry-run first — the app-root modal offers Apply.
    const runBatchMcIt = async (t: TerritoryScan, b: Batch) => {
        setNotice(null);
        setBusy(true);
        try {
            const aepDir = resolveBatchFolder(t.sourceFolder, b.batch) || path.join(t.sourceFolder, "AE", padBatch(b.batch));
            const res = await evalTS("mcIt", aepDir, "", true);
            if (res === undefined) throw new Error("no bridge");
            if (res.success) showMcItReport(res as unknown as McReport);
            else setNotice(res.error || "MC It! couldn't run on this batch.");
        } catch (e: any) {
            setNotice(e?.message || "No CEP bridge — open this panel inside After Effects to run it.");
        } finally {
            setBusy(false);
        }
    };

    // Open the territory's Specs folder (where the found batch PDFs live) in
    // Finder/Explorer so the parse can be sanity-checked against the real PDFs.
    // Falls back to the territory root if there's no Specs subfolder.
    const revealTerritory = async (t: TerritoryScan) => {
        setNotice(null);
        const target = t.hasSpecs ? path.join(t.sourceFolder, "Masters", "Specs") : t.sourceFolder;
        try {
            const res = await evalTS("revealUsefulFolder", target);
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) setNotice(res.error || "Couldn't open that folder.");
        } catch (e: any) {
            setNotice(e?.message || "No CEP bridge — open this panel inside After Effects.");
        }
    };

    // Expanding is what pays for a territory's specs -- the scan itself only
    // listed names. Collapsing keeps whatever was read, so re-opening is free.
    const toggleExpand = (t: string) => {
        const terr = scan?.find((x) => x.territory === t);
        if (terr && !expanded.has(t) && !terr.loaded) void loadTerritory(terr);
        setExpanded((s) => {
            const n = new Set(s);
            n.has(t) ? n.delete(t) : n.add(t);
            return n;
        });
    };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (scan || []).filter((t) => !q || t.territory.toLowerCase().includes(q));
    }, [scan, search]);

    return (
        <div className="form-tool specs-tool" ref={toolRootRef}>
            {/* Folders */}
            {/* Job setup, rendered as a PATH rather than three lookalike
                fields. Markets and Masters are not independent inputs -- they
                are two folders under one job, and Markets is usually derived
                from the campaign. Branching them off the campaign says that,
                and makes "what is still missing" readable at a glance instead
                of requiring you to notice an empty box. */}
            <div className="specs-setup">
                {!showSetup && (
                    /* Everything the form would ask for, already answered. Edit
                       puts the full form back; it never disappears, it just
                       stops being the first thing you meet. */
                    <div className="specs-ready">
                        <Check size={14} className="specs-ready-tick" />
                        <span className="specs-ready-text">
                            <strong>{campaignName}</strong>
                            <span>{baseName(marketsRoot)} · {mastersAuto ? "masters found" : baseName(aepPath)}</span>
                        </span>
                        <button className="specs-ready-edit" onClick={() => setSetupOpen(true)}>Edit</button>
                        <button className="specs-scan-btn" disabled={busy || !marketsRoot} onClick={runScan}>
                            {scan ? <RefreshCw size={14} /> : <ScanSearch size={14} />} {scan ? "Re-scan" : "Scan territories"}
                        </button>
                    </div>
                )}
                {showSetup && (
                <>
                <div className="specs-setup-root">
                    <label className="specs-field-label">Campaign</label>
                    <div className="field-with-button">
                        <div className="field-row specs-campaign-select">
                            <Dropdown
                                icon={<Library size={13} />}
                                value={campaignName}
                                onChange={selectCampaign}
                                options={campaigns.map((c) => ({
                                    value: c.name,
                                    label: c.name,
                                    // "retired" (the team said so) outranks "not mounted"
                                    // (this machine can't see it) -- a retired campaign is
                                    // usually also unreachable, and showing both would be
                                    // noise. Reachability is only claimed when the check
                                    // actually ran: an absent entry means "not asked",
                                    // which must not render as "not mounted".
                                    hint: retiredEntry(c.name)
                                        ? "retired"
                                        : campaignReach[c.name] === false
                                        ? "not mounted"
                                        : undefined,
                                }))}
                                placeholder="Select a campaign…"
                                emptyMessage="No campaigns yet — add one with the + button."
                                disabled={busy}
                            />
                        </div>
                        <Tooltip text="Add a campaign (pick its Markets folder)">
                            <button className="icon-btn specs-campaign-btn" disabled={busy} onClick={addCampaign}><FolderPlus size={14} /></button>
                        </Tooltip>
                        <Tooltip text={campaignName ? `Share "${campaignName}"'s Markets path with the team` : "Pick a campaign to share it"}>
                            <button className="icon-btn specs-campaign-btn" disabled={busy || !campaignName} onClick={shareCampaign}><Share2 size={14} /></button>
                        </Tooltip>
                        <Tooltip
                            text={
                                !campaignName
                                    ? "Pick a campaign first"
                                    : retiredEntry(campaignName)
                                    ? `Retired by ${retiredEntry(campaignName)!.retiredBy} — click to un-retire for the team`
                                    : "Mark retired for the team (volume archived). Marks everyone's picker; deletes nothing."
                            }
                        >
                            <button
                                className={"icon-btn specs-campaign-btn" + (campaignName && retiredEntry(campaignName) ? " is-retired" : "")}
                                disabled={busy || !campaignName}
                                onClick={toggleRetireCampaign}
                            >
                                <Archive size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip text={campaignName ? `Remove "${campaignName}" from this machine` : "Pick a campaign to remove it"}>
                            <button className="icon-btn specs-campaign-btn specs-campaign-btn--danger" disabled={busy || !campaignName} onClick={removeCampaign}><Trash2 size={14} /></button>
                        </Tooltip>
                    </div>
                    {campaignName && retiredEntry(campaignName) && (
                        <p className="specs-campaign-retired">
                            Retired by {retiredEntry(campaignName)!.retiredBy}. It still works here — this is a flag, not a lock.
                        </p>
                    )}
                    {campaignName && !retiredEntry(campaignName) && campaignReach[campaignName] === false && (
                        <p className="specs-campaign-retired">
                            Its Markets folder isn't reachable from this machine right now — the volume may just not be mounted.
                        </p>
                    )}
                </div>

                <div className="specs-branches">
                    <div className={"specs-branch" + (marketsRoot ? " is-set" : " is-empty")}>
                        <span className="specs-branch-dot" aria-hidden="true" />
                        <div className="specs-branch-body">
                            <label className="specs-field-label">
                                Markets
                                {campaignName && marketsRoot && <span className="specs-detected">from campaign</span>}
                            </label>
                            <div className="field-with-button">
                                <div className="field-row">
                                    <input type="text" value={marketsRoot} onChange={(e) => setMarketsRoot(e.target.value)} placeholder="Where the territories live…" />
                                </div>
                                <Tooltip text="Browse for the Markets folder">
                                    <button className="icon-btn" disabled={busy} onClick={browseMarkets}><FolderSearch size={14} /></button>
                                </Tooltip>
                            </div>
                        </div>
                    </div>

                    <div className={"specs-branch" + (aepPath ? " is-set" : " is-empty")}>
                        <span className="specs-branch-dot" aria-hidden="true" />
                        <div className="specs-branch-body">
                            <label className="specs-field-label">
                                Masters
                                {mastersAuto && aepPath && <span className="specs-detected">auto-detected</span>}
                            </label>
                            <div className="field-with-button">
                                <div className="field-row">
                                    <input type="text" value={aepPath} onChange={(e) => { setAepPath(e.target.value); setMastersAuto(false); }} placeholder="The AEPs to localise from…" />
                                </div>
                                <Tooltip text="Browse for the AEP masters folder">
                                    <button className="icon-btn" disabled={busy} onClick={browseAep}><FolderSearch size={14} /></button>
                                </Tooltip>
                            </div>
                            {!aepPath && (
                                <span className="specs-branch-why">
                                    Needed to run, and to check which master each row would use.
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Settings and the action are different KINDS of control, so
                    they no longer share a shape -- the two toggles sit quietly
                    on their own line rather than wearing button costumes next
                    to the primary action. */}
                <div className="specs-run-row">
                    <div className="specs-options">
                        <CheckboxToggle checked={skipExisting} onChange={setSkipExisting} label="Skip existing files" />
                        <Tooltip text="Swap each generated file's PNG/JPG footage for the localised versions in the territory's JPG_PNG batch folder, while the file is still open — instead of re-opening every file afterwards with MC It!">
                            <span>
                                <CheckboxToggle checked={runMcIt} onChange={setRunMcIt} label="Run MC It! inline" />
                            </span>
                        </Tooltip>
                    </div>
                    <button className="specs-scan-btn" disabled={busy || !marketsRoot} onClick={runScan}>
                        {scan ? <RefreshCw size={14} /> : <ScanSearch size={14} />} {scan ? "Re-scan" : "Scan territories"}
                    </button>
                </div>
                {setupComplete && (
                    <button className="specs-ready-done" onClick={() => setSetupOpen(false)}>Done</button>
                )}
                </>
                )}
            </div>

            {progress && <p className="hint specs-progress">{progress}</p>}

            {/* Results */}
            {scan && scan.length > 0 && (
                <div className="specs-results">
                    <div className="specs-toolbar">
                        <div className="specs-search">
                            <Search size={13} />
                            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter territories…" />
                        </div>
                    </div>

                    {!aepPath && <p className="hint specs-warn">Pick the AEP masters folder above to enable batch runs.</p>}

                    <div className="specs-list">
                        {filtered.map((t, i) => {
                            const open = expanded.has(t.territory);
                            const loading = loadingTerr.has(t.territory);
                            // Before a territory is read we have no idea what is in it,
                            // so it must stay clickable -- clicking is what reads it.
                            const runnable = !t.loaded || t.rowCount > 0;
                            const batchCount = t.batches.filter((b) => b.rows.length).length;
                            const status = loading
                                ? "reading…"
                                : !t.loaded
                                ? "open to read"
                                : t.rowCount > 0
                                ? `${batchCount} batch${batchCount === 1 ? "" : "es"} · ${t.rowCount} rows`
                                : t.hasSpecs
                                ? "no rows"
                                : "no Specs";
                            const statusClass = loading ? "muted" : !t.loaded ? "muted" : t.rowCount > 0 ? "ok" : t.hasSpecs ? "warn" : "muted";
                            const flag = territoryNameFlag(t.territory);
                            return (
                                <motion.div
                                    key={t.territory}
                                    className={"specs-terr" + (runnable ? "" : " is-disabled")}
                                    initial={reduced ? false : { opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    /* Explicit per-item delay, not staggerChildren --
                                       the house rule, and it keeps the cascade stable
                                       when the filter box changes the list. Capped so
                                       a 17-territory campaign doesn't take a second to
                                       finish arriving. */
                                    transition={{ duration: 0.22, delay: Math.min(i * 0.03, 0.3), ease: "easeOut" }}
                                >
                                    <div className="specs-terr-head">
                                        <button className="specs-terr-main" onClick={() => runnable && toggleExpand(t.territory)} disabled={!runnable}>
                                            {flag ? (
                                                <span className="specs-terr-flag" aria-hidden="true">{flag}</span>
                                            ) : (
                                                <MapPin size={13} />
                                            )}
                                            <span className="specs-terr-name">{t.territory}</span>
                                            <span className={"specs-pill specs-pill--" + statusClass}>{status}</span>
                                            {runnable && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                                        </button>
                                        <Tooltip text={t.hasSpecs ? "Open this territory's Specs folder in Finder/Explorer" : "Open this territory's folder in Finder/Explorer"}>
                                            <button className="specs-terr-reveal" onClick={() => revealTerritory(t)} aria-label={`Open ${t.territory} folder`}>
                                                <FolderOpen size={14} />
                                            </button>
                                        </Tooltip>
                                    </div>

                                    {open && t.loaded && t.rowCount > 0 && (
                                        <div className="specs-terr-body">
                                            {t.batches.map((b) => {
                                                const key = batchKey(t.territory, b.pdfName);
                                                const st = batchStatus[key];
                                                const canRun = b.rows.length > 0;
                                                const incl = includedCount(key, b.rows.length);
                                                const someExcluded = incl < b.rows.length;
                                                // Which rows already exist in the AE folder. Computed
                                                // per render (a plain substring scan over a handful of
                                                // filenames) rather than cached -- `existing` only
                                                // changes on scan/run/Re-check, and this keeps one
                                                // source of truth for the row tint, the header count
                                                // and the tooltips.
                                                const effRows = b.rows.map((r, i) => effectiveRow(key, i, r));
                                                const builtFor = matchBuiltRows(effRows, b.existing);
                                                const builtCount = builtFor.filter(Boolean).length;
                                                // Rows the PDF lists twice -- flagged because they can
                                                // never read as built (one filename, one file) and would
                                                // otherwise look like a missing deliverable. Same
                                                // effective rows as the match above, so correcting a
                                                // mis-parsed size clears the tag immediately.
                                                const dupOf = duplicateRowOf(effRows);
                                                const dupCount = dupOf.filter((d) => d >= 0).length;
                                                const batchOpen = expandedBatches.has(key);
                                                return (
                                                    <div key={b.pdfName} className={"specs-batch" + (batchOpen ? " is-open" : " is-collapsed")}>
                                                        <div className="specs-batch-head">
                                                            {/* Only the label area toggles -- the action buttons to the
                                                                right are siblings, not children, so clicking Localise or
                                                                MC It! can never also collapse the section. Same split as
                                                                .specs-terr-main above. */}
                                                            <button
                                                                className="specs-batch-main"
                                                                onClick={() => toggleBatchCollapsed(key)}
                                                                aria-expanded={batchOpen}
                                                                title={batchOpen ? "Collapse this batch" : "Expand this batch"}
                                                            >
                                                                {batchOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                <FileText size={13} />
                                                                <span className="specs-batch-name">{b.pdfName}</span>
                                                                <span className="specs-batch-tag">{b.batch}</span>
                                                                {b.error ? <span className="specs-batch-err">{b.error}</span> : (
                                                                    <span className={"specs-batch-ok" + (someExcluded ? " specs-batch-ok--filtered" : "")}>
                                                                        {someExcluded ? `${incl} of ${b.rows.length} rows` : `${b.rows.length} rows`}
                                                                    </span>
                                                                )}
                                                                {/* The headline for a batch that has gained sizes:
                                                                    how many are actually new, without expanding it. */}
                                                                {builtCount > 0 && (
                                                                    <span className="specs-batch-built">
                                                                        {builtCount === b.rows.length
                                                                            ? "all built"
                                                                            : `${b.rows.length - builtCount} new · ${builtCount} built`}
                                                                    </span>
                                                                )}
                                                                {/* Says why a collapsed batch's "N new" is bigger than
                                                                    the number of deliverables actually outstanding. */}
                                                                {dupCount > 0 && (
                                                                    <span className="specs-batch-dup">
                                                                        {dupCount} dup{dupCount === 1 ? "" : "s"}
                                                                    </span>
                                                                )}
                                                            </button>
                                                            {canRun && (
                                                                <>
                                                                    <button
                                                                        className={"specs-batch-run" + (st === "done" ? " is-done" : st === "failed" ? " is-failed" : "")}
                                                                        disabled={busy || !aepPath || incl === 0}
                                                                        onClick={() => runBatch(t, b)}
                                                                    >
                                                                        {st === "running" ? (
                                                                            <><RefreshCw size={13} className="spin" /> Running…</>
                                                                        ) : st === "done" ? (
                                                                            <><Check size={13} /> Done · Re-run</>
                                                                        ) : st === "failed" ? (
                                                                            <><PlayCircle size={13} /> Retry</>
                                                                        ) : someExcluded ? (
                                                                            <><PlayCircle size={13} /> Localise {incl} row{incl === 1 ? "" : "s"}</>
                                                                        ) : (
                                                                            <><PlayCircle size={13} /> Localise batch</>
                                                                        )}
                                                                    </button>
                                                                    {/* Re-read the AE folder without a full re-scan --
                                                                        for when files were added/removed in Finder
                                                                        while the panel sat open. */}
                                                                    <Tooltip text={`Re-check AE/${padBatch(b.batch)} for files that already exist`}>
                                                                        <button
                                                                            className="specs-batch-run specs-batch-recheck"
                                                                            disabled={busy}
                                                                            onClick={() => refreshBatchBuilt(t, b)}
                                                                            aria-label="Re-check which rows are already built"
                                                                        >
                                                                            <RotateCcw size={13} />
                                                                        </button>
                                                                    </Tooltip>
                                                                    {/* Enabled once the batch's AE output exists (pre-scan
                                                                        detection or a completed run this session). */}
                                                                    <Tooltip
                                                                        text={
                                                                            mcItInlineDone[key]
                                                                                ? "Footage was already swapped during localisation. Run this only to redo the swap — the preview will list matches again, including ones already applied."
                                                                                : "Swap the placeholder PNG/JPGs in this batch's AEPs for the localised images (previews first)"
                                                                        }
                                                                    >
                                                                        <button
                                                                            className="specs-batch-run specs-batch-mcit"
                                                                            disabled={busy || (!b.done && st !== "done")}
                                                                            onClick={() => runBatchMcIt(t, b)}
                                                                        >
                                                                            <ImageIcon size={13} /> {mcItInlineDone[key] ? "Re-run MC It!" : "MC It!"}
                                                                        </button>
                                                                    </Tooltip>
                                                                </>
                                                            )}
                                                        </div>
                                                        {/* The batch opens as a MODAL rather than expanding
                                                            inline. Inline, the table sat inside an already
                                                            indented territory > batch nest and every column was
                                                            squeezed; a batch is the thing you actually read and
                                                            edit, so it gets the full panel width.

                                                            Rendered through createPortal so no `overflow` or
                                                            `transform` ancestor in the territory list can clip
                                                            it -- the same reason Tooltip portals its bubble. The
                                                            JSX stays where it is in the tree, so it still closes
                                                            over b/key/builtFor/dupOf exactly as before. */}
                                                        {batchOpen && createPortal(
                                                            <div
                                                                // `specs-tool` is NOT decorative here. Every
                                                                // .specs-table / .specs-cell-* rule is NESTED under
                                                                // .specs-tool in formTool.scss, and portalling to
                                                                // <body> puts this outside the tool root — so without
                                                                // it the table renders as unstyled native inputs.
                                                                // .specs-tool declares no properties of its own, only
                                                                // nested rules, so adding it to a fixed overlay is
                                                                // safe.
                                                                className="specs-modal-overlay specs-tool"
                                                                // Category tint is an inline style on an ANCESTOR of
                                                                // the tool, so it cascades to the tool but not to a
                                                                // portal. Copied across explicitly (CLAUDE.md).
                                                                style={portalCatVars()}
                                                                onClick={() => collapseBatch(key)}
                                                                role="presentation"
                                                            >
                                                                <div
                                                                    className="specs-modal"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    role="dialog"
                                                                    aria-modal="true"
                                                                    aria-label={`${t.territory} — ${b.pdfName}`}
                                                                >
                                                                    <div className="specs-modal-head">
                                                                        <FileText size={14} />
                                                                        <span className="specs-modal-title">{b.pdfName}</span>
                                                                        <span className="specs-batch-tag">{b.batch}</span>
                                                                        <span className="specs-modal-terr">{t.territory}</span>
                                                                        <span className="specs-modal-spacer" />
                                                                        <button
                                                                            type="button"
                                                                            className="specs-modal-close"
                                                                            onClick={() => collapseBatch(key)}
                                                                            aria-label="Close"
                                                                        >
                                                                            <X size={15} />
                                                                        </button>
                                                                    </div>
                                                                    <div className="specs-modal-body">
                                                        {b.rows.length > 0 && (
                                                            <table className="specs-table specs-table--selectable">
                                                                <thead>
                                                                    <tr>
                                                                        <th className="specs-row-check-col">
                                                                            <Tooltip text={incl === 0 ? "Include all rows" : "Exclude all rows"}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    className="specs-row-check"
                                                                                    checked={incl > 0}
                                                                                    ref={(el) => { if (el) el.indeterminate = someExcluded && incl > 0; }}
                                                                                    onChange={() => setAllRowsExcluded(key, b.rows.length, incl > 0)}
                                                                                    aria-label="Include or exclude all rows"
                                                                                />
                                                                            </Tooltip>
                                                                        </th>
                                                                        {/* master-col sits SECOND, matching the body's
                                                                            <td> order (check, master, Artwork…). It used
                                                                            to be declared after Dur, which kept the cell
                                                                            COUNT right — so the table looked fine — while
                                                                            shifting every label one column left of the
                                                                            data it names. */}
                                                                        <th className="specs-row-master-col" />
                                                                        <th>Artwork</th><th>Campaign</th><th className="specs-row-warn-col" /><th>Site</th><th>Size</th><th>Dur</th>
                                                                        {/* Duration multiple — sits next to Dur because that
                                                                            is what it modifies. Header is a bare × so the
                                                                            column stays narrow. */}
                                                                        <th className="specs-row-mult-col">×</th>
                                                                        <th className="specs-row-revert-col" />
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {b.rows.map((r, i) => {
                                                                        const excluded = isRowExcluded(key, i);
                                                                        const eff = effectiveRow(key, i, r);
                                                                        const specWarnings = specRowWarnings(eff);
                                                                        const edited = isRowEdited(key, i);
                                                                        // Match on the EFFECTIVE row: correcting a
                                                                        // mis-parsed size in place should immediately
                                                                        // re-answer "is this one already built?".
                                                                        const built = builtFor[i];
                                                                        const dup = dupOf[i];
                                                                        return (
                                                                            <tr
                                                                                key={i}
                                                                                className={(excluded ? "specs-row--excluded" : "") + (edited ? " specs-row--edited" : "") + (built ? " specs-row--built" : "") + (dup >= 0 ? " specs-row--dup" : "")}
                                                                            >
                                                                                <td className="specs-row-check-col">
                                                                                    <Tooltip
                                                                                        text={
                                                                                            built
                                                                                                ? `Already in AE/${padBatch(b.batch)} as ${built} — unticked so it won't be rebuilt. Tick it to localise it again.`
                                                                                                : dup >= 0
                                                                                                ? `Duplicate of row ${dup + 1} — the specs PDF lists this deliverable twice. Both rows produce the same filename, so this one can never read as built. Leave it unticked unless row ${dup + 1} is wrong.`
                                                                                                : excluded
                                                                                                ? "Excluded — click to include"
                                                                                                : "Included — click to exclude (e.g. an on-hold row)"
                                                                                        }
                                                                                    >
                                                                                        <input
                                                                                            type="checkbox"
                                                                                            className="specs-row-check"
                                                                                            checked={!excluded}
                                                                                            onChange={() => toggleRowExcluded(key, i)}
                                                                                            aria-label={`Include row ${i + 1}`}
                                                                                        />
                                                                                    </Tooltip>
                                                                                </td>
                                                                                <td className="specs-row-master-col">
                                                                                    {(() => {
                                                                                        // Three genuinely different states, and they must not
                                                                                        // look alike: no masters folder set (we cannot know),
                                                                                        // a master found (name in the tooltip), nothing found
                                                                                        // (this row would come back "no-master" on a run).
                                                                                        if (!aepPath) {
                                                                                            return (
                                                                                                <Tooltip text="Pick the AEP masters folder above to check which master each row would use.">
                                                                                                    <span className="specs-master specs-master--unknown">
                                                                                                        <Circle size={11} />
                                                                                                    </span>
                                                                                                </Tooltip>
                                                                                            );
                                                                                        }
                                                                                        const res = masters[key]?.[i];
                                                                                        if (!res) {
                                                                                            return (
                                                                                                <Tooltip text="Not checked yet.">
                                                                                                    <span className="specs-master specs-master--unknown">
                                                                                                        <Circle size={11} />
                                                                                                    </span>
                                                                                                </Tooltip>
                                                                                            );
                                                                                        }
                                                                                        if (res.master) {
                                                                                            return (
                                                                                                <Tooltip text={`Master found: ${res.master}`}>
                                                                                                    <span className="specs-master specs-master--ok">
                                                                                                        <FileCheck size={12} />
                                                                                                    </span>
                                                                                                </Tooltip>
                                                                                            );
                                                                                        }
                                                                                        // A row with no exact master may still be
                                                                                        // buildable from a multiple — but that offer
                                                                                        // lives in its own column after Dur, next to
                                                                                        // the duration it's about. This column stays
                                                                                        // a pure status icon.
                                                                                        const canMultiply = !!res.multiples?.length;
                                                                                        return (
                                                                                            <Tooltip
                                                                                                text={
                                                                                                    canMultiply
                                                                                                        ? `No ${eff.Duration} master for ${eff.Campaign || "this campaign"} at ${eff.Size || "this size"} — but it can be built from a shorter one. See the ×  column.`
                                                                                                        : `No master matches ${eff.Campaign || "this campaign"} at ${eff.Size || "this size"} / ${eff.Duration || "this duration"}. This row would be skipped.`
                                                                                                }
                                                                                            >
                                                                                                <span className="specs-master specs-master--none">
                                                                                                    <FileX size={12} />
                                                                                                </span>
                                                                                            </Tooltip>
                                                                                        );
                                                                                    })()}
                                                                                </td>
                                                                                <td className="specs-cell-edit">
                                                                                    <select
                                                                                        className="specs-cell-input specs-cell-select"
                                                                                        value={eff.Artwork}
                                                                                        disabled={excluded}
                                                                                        onChange={(e) => editRowField(key, i, "Artwork", e.target.value)}
                                                                                        aria-label={`Row ${i + 1} artwork`}
                                                                                    >
                                                                                        {ARTWORK_TYPES.concat(
                                                                                            ARTWORK_TYPES.indexOf(eff.Artwork) === -1 ? [eff.Artwork] : []
                                                                                        ).map((a) => (
                                                                                            <option key={a} value={a}>{a}</option>
                                                                                        ))}
                                                                                    </select>
                                                                                </td>
                                                                                <td className={"specs-cell-edit" + (eff.Campaign === "UNKNOWN" ? " is-unknown" : "")}>
                                                                                    <input
                                                                                        type="text"
                                                                                        className="specs-cell-input"
                                                                                        value={eff.Campaign}
                                                                                        disabled={excluded}
                                                                                        onChange={(e) => editRowField(key, i, "Campaign", e.target.value)}
                                                                                        aria-label={`Row ${i + 1} campaign`}
                                                                                    />
                                                                                </td>
                                                                                {/* MEDIA SITE NAME from the PDF — informational (the host
                                                                                    never reads it), editable so a mis-parsed name can be
                                                                                    tidied like every other cell. */}
                                                                                {/* Delivery-spec warning. ADVISORY ONLY -- changes no
                                                                                    value, excludes no row, blocks no run. Computed from
                                                                                    `eff`, i.e. the row INCLUDING manual edits, so fixing a
                                                                                    cell makes its warning disappear on the spot. These
                                                                                    numbers come off PDFs territories fill in by hand; the
                                                                                    person reading the table is the authority here, not the
                                                                                    parser. */}
                                                                                <td className="specs-cell-warn">
                                                                                    {specWarnings.length > 0 && (
                                                                                        <Tooltip text={specWarnings.join(" · ") + " — correct any cell to clear this"}>
                                                                                            <span className="specs-spec-warn" aria-label="Delivery spec looks wrong">▲</span>
                                                                                        </Tooltip>
                                                                                    )}
                                                                                </td>
                                                                                <td className="specs-cell-edit">
                                                                                    <Tooltip text={eff.Site || "No MEDIA SITE NAME found in the PDF for this row"}>
                                                                                        <input
                                                                                            type="text"
                                                                                            className="specs-cell-input specs-cell-input--site"
                                                                                            value={eff.Site || ""}
                                                                                            disabled={excluded}
                                                                                            placeholder="—"
                                                                                            onChange={(e) => editRowField(key, i, "Site", e.target.value)}
                                                                                            aria-label={`Row ${i + 1} media site name`}
                                                                                        />
                                                                                    </Tooltip>
                                                                                </td>
                                                                                <td className="specs-cell-edit">
                                                                                    <input
                                                                                        type="text"
                                                                                        className="specs-cell-input specs-cell-input--size"
                                                                                        value={eff.Size}
                                                                                        disabled={excluded}
                                                                                        placeholder="WxH"
                                                                                        onChange={(e) => editRowField(key, i, "Size", e.target.value)}
                                                                                        aria-label={`Row ${i + 1} size`}
                                                                                    />
                                                                                    {/* Sits next to the size because size is
                                                                                        what's duplicated in practice, and it's
                                                                                        where the eye already is when the row
                                                                                        looks wrong. */}
                                                                                    {dup >= 0 && (
                                                                                        <Tooltip
                                                                                            text={`The specs PDF lists this deliverable twice — same artwork, campaign, site, size and duration as row ${dup + 1}. Both rows would build the same file, so only one can exist and this row will always read as unbuilt.`}
                                                                                        >
                                                                                            <span className="specs-row-dup">dup of {dup + 1}</span>
                                                                                        </Tooltip>
                                                                                    )}
                                                                                </td>
                                                                                <td className="specs-cell-edit">
                                                                                    <input
                                                                                        type="text"
                                                                                        className="specs-cell-input specs-cell-input--dur"
                                                                                        value={eff.Duration}
                                                                                        disabled={excluded}
                                                                                        onChange={(e) => editRowField(key, i, "Duration", e.target.value)}
                                                                                        aria-label={`Row ${i + 1} duration`}
                                                                                    />
                                                                                </td>
                                                                                <td className="specs-row-mult-col">
                                                                                    {(() => {
                                                                                        const res = masters[key]?.[i];
                                                                                        const opts = res?.multiples || [];
                                                                                        // Nothing to offer: an exact master exists,
                                                                                        // or no duration divides this one. Render an
                                                                                        // empty cell rather than a dead control.
                                                                                        if (!opts.length) return null;
                                                                                        const factors = opts.map((o) => o.factor);
                                                                                        const chosen = rowMultiple(key, i);
                                                                                        const active = opts.find((o) => o.factor === chosen);
                                                                                        const nextAt = factors.indexOf(chosen);
                                                                                        const nextFactor =
                                                                                            nextAt === -1 ? factors[0] : nextAt + 1 < factors.length ? factors[nextAt + 1] : 0;
                                                                                        return (
                                                                                            <Tooltip
                                                                                                text={
                                                                                                    active
                                                                                                        ? `Building ${eff.Duration} from the ${active.duration} master played ${active.factor}× (${active.master}). Click for ${nextFactor ? nextFactor + "×" : "off"}.`
                                                                                                        : `No ${eff.Duration} master. Click to build it from a shorter one played ${factors.join("× or ")}×.`
                                                                                                }
                                                                                            >
                                                                                                <button
                                                                                                    type="button"
                                                                                                    className={active ? "specs-mult is-on" : "specs-mult"}
                                                                                                    disabled={excluded}
                                                                                                    onClick={() => cycleRowMultiple(key, i, factors)}
                                                                                                    aria-label={`Row ${i + 1}: duration multiple, currently ${chosen ? chosen + "×" : "off"}`}
                                                                                                >
                                                                                                    {chosen ? `${chosen}×` : `${factors[0]}×?`}
                                                                                                </button>
                                                                                            </Tooltip>
                                                                                        );
                                                                                    })()}
                                                                                </td>
                                                                                <td className="specs-row-revert-col">
                                                                                    {edited && (
                                                                                        <Tooltip text="Revert this row to the scanned values">
                                                                                            <button
                                                                                                type="button"
                                                                                                className="specs-row-revert"
                                                                                                onClick={() => revertRow(key, i)}
                                                                                                aria-label={`Revert row ${i + 1}`}
                                                                                            >
                                                                                                <RotateCcw size={11} />
                                                                                            </button>
                                                                                        </Tooltip>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                        {batchRows[key] && (
                                                            <div className="specs-locresult">
                                                                {(() => {
                                                                    const rows = batchRows[key];
                                                                    const gen = rows.filter((r) => r.status === "generated").length;
                                                                    const skip = rows.filter((r) => r.status === "skipped-existing").length;
                                                                    const problems = rows.filter((r) => r.status === "no-master" || r.status === "error");
                                                                    return (
                                                                        <>
                                                                            <div className="specs-locresult-line">
                                                                                <span className="ok">{gen} generated</span>
                                                                                {skip > 0 && <span className="muted"> · {skip} already existed</span>}
                                                                                {problems.length > 0 && <span className="bad"> · {problems.length} failed</span>}
                                                                            </div>
                                                                            {problems.map((r) => (
                                                                                <div key={r.row} className="specs-locresult-problem">
                                                                                    Row {r.row} · {r.campaign} {r.size} {r.duration} — {r.error || "no master matched"}
                                                                                </div>
                                                                            ))}
                                                                        </>
                                                                    );
                                                                })()}
                                                            </div>
                                                        )}
                                                                    </div>
                                                                    {/* The batch's actions live on the collapsed row
                                                                        too, but that row is now BEHIND this modal --
                                                                        reviewing the rows and then being unable to run
                                                                        them would be a silly place to leave someone.
                                                                        Same handlers, so there is no second code path. */}
                                                                    {canRun && (
                                                                        <div className="specs-modal-foot">
                                                                            <span className="specs-modal-foot-count">
                                                                                {incl} of {b.rows.length} row{b.rows.length === 1 ? "" : "s"} selected
                                                                            </span>
                                                                            <span className="specs-modal-spacer" />
                                                                            <Tooltip text={`Re-check AE/${padBatch(b.batch)} for files that already exist`}>
                                                                                <button
                                                                                    className="specs-batch-run specs-batch-recheck"
                                                                                    disabled={busy}
                                                                                    onClick={() => refreshBatchBuilt(t, b)}
                                                                                    aria-label="Re-check which rows are already built"
                                                                                >
                                                                                    <RotateCcw size={13} />
                                                                                </button>
                                                                            </Tooltip>
                                                                            <button
                                                                                className="specs-batch-run specs-batch-mcit"
                                                                                disabled={busy || (!b.done && st !== "done")}
                                                                                onClick={() => runBatchMcIt(t, b)}
                                                                            >
                                                                                <ImageIcon size={13} /> {mcItInlineDone[key] ? "Re-run MC It!" : "MC It!"}
                                                                            </button>
                                                                            <button
                                                                                className={"specs-batch-run" + (st === "done" ? " is-done" : st === "failed" ? " is-failed" : "")}
                                                                                disabled={busy || !aepPath || incl === 0}
                                                                                onClick={() => runBatch(t, b)}
                                                                            >
                                                                                {st === "running" ? (
                                                                                    <><RefreshCw size={13} className="spin" /> Running…</>
                                                                                ) : st === "done" ? (
                                                                                    <><Check size={13} /> Done · Re-run</>
                                                                                ) : st === "failed" ? (
                                                                                    <><PlayCircle size={13} /> Retry</>
                                                                                ) : someExcluded ? (
                                                                                    <><PlayCircle size={13} /> Localise {incl} row{incl === 1 ? "" : "s"}</>
                                                                                ) : (
                                                                                    <><PlayCircle size={13} /> Localise batch</>
                                                                                )}
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>,
                                                            document.body
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* TWO ROUTES, AS BUTTONS. These were disclosure triangles reading
                "Build a batch" and "Paste a CSV instead" -- the second is gone
                (nobody pastes a CSV now the builder exists) and the first was
                doing too much work as a caret. Bespoke sits beside it because
                it answers the same question a row poses: this one isn't a
                single master. */}
            <div className="specs-routes">
                <button
                    className={"specs-route" + (buildOpen ? " is-open" : "")}
                    onClick={() => setBuildOpen((v) => !v)}
                >
                    <Wand2 size={14} />
                    <span className="specs-route-t">Build a Batch</span>
                    <span className="specs-route-s">Pick creatives and sizes by hand</span>
                </button>
                <button
                    className="specs-route"
                    onClick={() => onSelectTool?.("bespoke")}
                >
                    <Layers size={14} />
                    <span className="specs-route-t">Bespoke It</span>
                    <span className="specs-route-s">Several masters in one deliverable</span>
                </button>
            </div>

            <div className="specs-fallback specs-build specs-build--headless">
                {buildOpen && (
                    <div className="specs-fallback-body specs-build-body">
                        {handoff && (
                            <div className="specs-handoff">
                                <strong>{handoff.rows.length} row{handoff.rows.length === 1 ? "" : "s"}</strong> from{" "}
                                <em>{handoff.jobTitle}</em> — check the territory and masters folder, then Localise.
                                {handoff.skipped.length > 0 && (
                                    <span className="specs-handoff-skipped">
                                        {" "}{handoff.skipped.length} subtask{handoff.skipped.length === 1 ? " was" : "s were"} left
                                        out: {handoff.skipped.slice(0, 3).map((sk) => sk.name.split("_").slice(-3).join("_")).join(", ")}
                                        {handoff.skipped.length > 3 ? "…" : ""} (missing{" "}
                                        {[...new Set(handoff.skipped.flatMap((sk) => sk.missing))].join(", ")}).
                                    </span>
                                )}
                            </div>
                        )}
                        <div className="specs-build-meta">
                            <label className="specs-build-field">
                                <span>Territory</span>
                                <Dropdown
                                    value={buildTerritory}
                                    onChange={setBuildTerritory}
                                    options={buildTerritories.map((t) => ({ value: t, label: t }))}
                                    placeholder="Pick a territory…"
                                    icon={<MapPin size={12} />}
                                    emptyMessage="No territories found for this campaign."
                                />
                            </label>
                            <label className="specs-build-field specs-build-field--batch">
                                <span>Batch</span>
                                <input type="text" value={buildBatch} onChange={(e) => setBuildBatch(e.target.value)} placeholder="Batch_1" />
                            </label>
                        </div>

                        <div className="specs-build-rows">
                            <div className="specs-build-row specs-build-row--head">
                                {/* Master status column, blank header exactly like the
                                    specs table's own — the icon says what it is, and a
                                    label here would crowd a 20px column. */}
                                <span />
                                <span>Type</span><span>Creative</span><span>Site</span><span>Width</span><span>Height</span><span>Dur</span><span>×</span><span />
                            </div>
                            {buildRows.map((r) => (
                                <div className="specs-build-row" key={r.id}>
                                    {(() => {
                                        // Same three states as the specs table's master
                                        // column, reusing its markup and colours so the
                                        // two can't drift apart — plus one the specs
                                        // table can't have: a row too incomplete to look
                                        // up yet. That must NOT render as "no master",
                                        // which would read as a failed lookup on a row
                                        // nobody has finished typing.
                                        //
                                        // This matters most for handed-over Wrike rows:
                                        // their creative is free text parsed from a
                                        // subtask name, never checked against the masters
                                        // folder, so without this the first sign of a
                                        // mismatch was a "no-master" line in the run
                                        // report.
                                        if (!aepPath) {
                                            return (
                                                <Tooltip text="Pick the AEP masters folder above to check which master each row would use.">
                                                    <span className="specs-master specs-master--unknown"><Circle size={11} /></span>
                                                </Tooltip>
                                            );
                                        }
                                        const complete = buildRowCreative(r) && r.width && r.height && r.duration;
                                        if (!complete) {
                                            return (
                                                <Tooltip text="Fill in creative, size and duration to check for a master.">
                                                    <span className="specs-master specs-master--unknown"><Circle size={11} /></span>
                                                </Tooltip>
                                            );
                                        }
                                        const res = buildMasters[r.id];
                                        if (!res) {
                                            // The lookup is debounced 500ms and walks the
                                            // NAS, so "not back yet" is a normal, visible
                                            // state rather than an edge case.
                                            return (
                                                <Tooltip text="Checking the masters folder…">
                                                    <span className="specs-master specs-master--unknown"><Circle size={11} /></span>
                                                </Tooltip>
                                            );
                                        }
                                        if (res.master) {
                                            return (
                                                <Tooltip text={`Master found: ${res.master}`}>
                                                    <span className="specs-master specs-master--ok"><FileCheck size={12} /></span>
                                                </Tooltip>
                                            );
                                        }
                                        const canMultiply = !!res.multiples?.length;
                                        return (
                                            <Tooltip
                                                text={
                                                    canMultiply
                                                        ? `No ${r.duration}s master for ${buildRowCreative(r)} at ${r.width}x${r.height} — but it can be built from a shorter one. See the × column.`
                                                        : `No master matches ${buildRowCreative(r) || "this creative"} at ${r.width}x${r.height} / ${r.duration}s. This row would be skipped.`
                                                }
                                            >
                                                <span className="specs-master specs-master--none"><FileX size={12} /></span>
                                            </Tooltip>
                                        );
                                    })()}
                                    <Dropdown
                                        className="specs-build-artwork"
                                        value={r.artwork}
                                        onChange={(v) => updateBuildRow(r.id, { artwork: v })}
                                        options={ARTWORK_TYPES.map((a) => ({ value: a, label: a }))}
                                    />
                                    {r.creative === CUSTOM_CREATIVE ? (
                                        <input
                                            className="specs-build-custom"
                                            type="text"
                                            placeholder="Creative name"
                                            value={r.custom}
                                            autoFocus
                                            onChange={(e) => updateBuildRow(r.id, { custom: e.target.value })}
                                            onBlur={(e) => { if (!e.target.value.trim()) updateBuildRow(r.id, { creative: "" }); }}
                                        />
                                    ) : (
                                        <Dropdown
                                            value={r.creative}
                                            onChange={(v) => updateBuildRow(r.id, { creative: v, custom: "" })}
                                            options={[...buildCreatives.map((c) => ({ value: c, label: c })), { value: CUSTOM_CREATIVE, label: "＋ Type a creative…" }]}
                                            placeholder="Pick creative…"
                                            emptyMessage="No creatives scanned — pick the masters folder, or type one."
                                        />
                                    )}
                                    {/* Optional, and deliberately NOT wrapped in a Tooltip:
                                        its span carries flex:0 0 auto, which would defeat this
                                        grid cell's sizing (see the note in CLAUDE.md). */}
                                    <input
                                        className="specs-build-site"
                                        type="text"
                                        placeholder="Site"
                                        aria-label="Media site name (optional)"
                                        title="Media site name, as written in the Wrike subtask or specs PDF. Optional — leave blank for a deliverable with no site. The case you type is the case in the filename."
                                        value={r.site}
                                        onChange={(e) => updateBuildRow(r.id, { site: e.target.value })}
                                    />
                                    <input type="number" min="1" placeholder="W" value={r.width} onChange={(e) => updateBuildRow(r.id, { width: e.target.value })} />
                                    <input type="number" min="1" placeholder="H" value={r.height} onChange={(e) => updateBuildRow(r.id, { height: e.target.value })} />
                                    <input type="number" min="1" placeholder="sec" value={r.duration} onChange={(e) => updateBuildRow(r.id, { duration: e.target.value })} />
                                    {(() => {
                                        // Same control, same meaning as the specs table's × column:
                                        // only appears when this row has no same-duration master AND
                                        // one exists whose duration divides it. Empty otherwise, so
                                        // it costs nothing on a normal row.
                                        const res = buildMasters[r.id];
                                        const opts = res?.multiples || [];
                                        if (!opts.length) return <span />;
                                        const factors = opts.map((o) => o.factor);
                                        const chosen = buildMultiples[r.id] || 0;
                                        const active = opts.find((o) => o.factor === chosen);
                                        const at = factors.indexOf(chosen);
                                        const nextFactor = at === -1 ? factors[0] : at + 1 < factors.length ? factors[at + 1] : 0;
                                        return (
                                            <Tooltip
                                                text={
                                                    active
                                                        ? `Building ${r.duration}s from the ${active.duration} master played ${active.factor}× (${active.master}). Click for ${nextFactor ? nextFactor + "×" : "off"}.`
                                                        : `No ${r.duration}s master for ${buildRowCreative(r)}. Click to build it from a shorter one played ${factors.join("× or ")}×.`
                                                }
                                            >
                                                <button
                                                    type="button"
                                                    className={active ? "specs-mult is-on" : "specs-mult"}
                                                    onClick={() => cycleBuildMultiple(r.id, factors)}
                                                    aria-label={`Duration multiple, currently ${chosen ? chosen + "×" : "off"}`}
                                                >
                                                    {chosen ? `${chosen}×` : `${factors[0]}×?`}
                                                </button>
                                            </Tooltip>
                                        );
                                    })()}
                                    <button className="specs-build-remove" onClick={() => removeBuildRow(r.id)} disabled={buildRows.length === 1} title="Remove row"><X size={12} /></button>
                                </div>
                            ))}
                        </div>

                        <div className="specs-build-actions">
                            <button className="specs-build-add" onClick={addBuildRow}><Plus size={13} /> Add row</button>
                            <span className="specs-build-count">{buildComplete.length} ready</span>
                            <button className="specs-build-run" disabled={busy || !aepPath || !buildTerritory || buildComplete.length === 0} onClick={runBuilder}>
                                <PlayCircle size={14} /> Localise {buildComplete.length || ""} row{buildComplete.length === 1 ? "" : "s"}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {notice && <p className="hint">{notice}</p>}
        </div>
    );
};

export default CSVLocaliserTool;
