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
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    FolderSearch,
    FolderPlus,
    Library,
    PlayCircle,
    ScanSearch,
    FileText,
    MapPin,
    ChevronRight,
    ChevronDown,
    Check,
    Search,
    ClipboardPaste,
    RefreshCw,
    Image as ImageIcon,
    Wand2,
    Plus,
    X,
    RotateCcw,
    FolderOpen,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { fs, path } from "../../lib/cep/node";
import CheckboxToggle from "../CheckboxToggle";
import Tooltip from "../Tooltip";
import Dropdown from "../Dropdown";
import { alertDialog, promptDialog } from "../Dialog";
import { showMcItReport, type McReport } from "../McItReportModal";
import { showLocGenReport, type LocGenReport, type LocGenRow } from "../LocGenReportModal";
import type { SpecRow } from "../lib/pdfSpecs";

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

// The campaign root (e.g. .../INT) holds sibling *_Markets and *_Masters folders
// sharing a stem. Given the saved Markets path, find its Masters sibling: strip
// the "XY####_" prefix and "_Markets" suffix to get the stem, then match the
// sibling ending "…Masters" that contains that stem (XY numbers differ between
// the two, so compare on the stem, alphanumerics only).
function deriveMastersFromMarkets(marketsRoot: string): string {
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
        // The host appends "sec" to whatever the CSV carried, so match the
        // number with the suffix it will have on disk.
        const dur = canonName(row.Duration);
        const durToken = dur ? (/SEC$/.test(dur) ? dur : dur + "SEC") : "";
        if (f.flat.indexOf(size) === -1) return false;
        if (durToken && f.flat.indexOf(durToken) === -1) return false;
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

const CSVLocaliserTool = () => {
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
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const [scan, setScan] = useState<TerritoryScan[] | null>(null);
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
        { id: 1, artwork: "DOOH", creative: "", custom: "", width: "", height: "", duration: "" },
    ]);
    const buildRowId = useRef(2);

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
        setBuildRows((rs) => [...rs, { id: buildRowId.current++, artwork: "DOOH", creative: "", custom: "", width: "", height: "", duration: "" }]);
    const removeBuildRow = (id: number) =>
        setBuildRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

    const buildRowCreative = (r: BuildRow) => (r.creative === CUSTOM_CREATIVE ? r.custom.trim() : r.creative);
    const buildComplete = buildRows.filter((r) => buildRowCreative(r) && r.width && r.height && r.duration);

    const runBuilder = async () => {
        if (!aepPath) { setNotice("Pick the AEP masters folder first."); return; }
        if (!buildTerritory) { setNotice("Pick a territory to build for."); return; }
        const rows: SpecRow[] = buildComplete.map((r) => ({
            Artwork: r.artwork || "DOOH",
            Campaign: buildRowCreative(r),
            Size: `${parseInt(r.width, 10)}x${parseInt(r.height, 10)}`,
            Duration: String(parseInt(r.duration, 10)),
            Country: buildTerritory,
            Site: "", // hand-built rows have no PDF to read a site name from
        }));
        if (!rows.length) { setNotice("Add at least one complete row (creative, width, height, duration)."); return; }

        setBusy(true);
        setNotice(null);
        try {
            const { buildLocaliserCsv } = await import("../lib/pdfSpecs");
            const sourceFolder = path.join(marketsRoot, buildTerritory);
            const batch = buildBatch.trim() || "Batch_1";
            const csv = buildLocaliserCsv({ territory: buildTerritory, batch, sourceFolder, rows });
            const res = await evalTS("csvLocaliserRun", aepPath, csv, skipExisting, runMcIt);
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
    const [pasteOpen, setPasteOpen] = useState(false);
    const [csvText, setCsvText] = useState("");

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
        try {
            const { parsePdfDeliverySpecs, reshapeSpecs, batchNameFromFilename } = await import("../lib/pdfSpecs");
            const territories: string[] = (await evalTS("scanTerritories", marketsRoot)) || [];
            const result: TerritoryScan[] = [];

            for (const territory of territories) {
                setProgress(`Reading ${territory}…`);
                const sourceFolder = path.join(marketsRoot, territory);
                const specsDir = path.join(sourceFolder, "Masters", "Specs");
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
                    // What's already in <Territory>/AE/<paddedBatch>. The whole
                    // list, not just "is it empty": rows are matched against it
                    // below so a batch that has GAINED sizes since it was last
                    // localised shows only the new ones ticked.
                    const existing = readExistingAeps(sourceFolder, batch);
                    const done = existing.length > 0;
                    try {
                        const buf = fs.readFileSync(path.join(specsDir, pdfName));
                        const raw = await parsePdfDeliverySpecs(new Uint8Array(buf));
                        const rows = raw ? reshapeSpecs(raw, territory) : [];
                        batches.push({ pdfName, batch, rows, done, existing, error: rows.length ? undefined : "No spec rows found." });
                    } catch (e: any) {
                        batches.push({ pdfName, batch, rows: [], done, existing, error: e?.message || "Couldn't read PDF." });
                    }
                }

                const rowCount = batches.reduce((n, b) => n + b.rows.length, 0);
                result.push({ territory, sourceFolder, batches, rowCount, hasSpecs });
            }

            setScan(result);
            // Seed run-state: any batch whose output folder already holds .aep
            // files shows "Done · Re-run" straight away.
            const seed: Record<string, "done"> = {};
            // ...and seed the row exclusions: a row whose deliverable is
            // already sitting in the AE folder starts UNTICKED, so hitting
            // Localise on a batch that has gained sizes builds only the new
            // ones instead of re-running the whole batch. Nothing is disabled
            // -- ticking one back on re-localises it, same as always.
            const exclSeed: Record<string, Set<number>> = {};
            result.forEach((t) =>
                t.batches.forEach((b) => {
                    const key = batchKey(t.territory, b.pdfName);
                    if (b.done) seed[key] = "done";
                    const built = new Set<number>();
                    matchBuiltRows(b.rows, b.existing).forEach((f, i) => {
                        if (f) built.add(i);
                    });
                    if (built.size) exclSeed[key] = built;
                })
            );
            setBatchStatus(seed);
            setExcludedRows(exclSeed);
            const withRows = result.filter((t) => t.rowCount > 0);
            const rowTotal = withRows.reduce((n, t) => n + t.rowCount, 0);
            setNotice(
                withRows.length
                    ? `Found ${rowTotal} rows across ${withRows.length} territor${withRows.length === 1 ? "y" : "ies"}.`
                    : "No Masters/Specs PDFs with rows found under any territory."
            );
        } catch (e: any) {
            setNotice(e?.message || "Scan failed.");
        } finally {
            setBusy(false);
            setProgress(null);
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
            const res = await evalTS("csvLocaliserRun", aepPath, csv, skipExisting, runMcIt);
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

    const runPaste = async () => {
        setNotice(null);
        setBusy(true);
        try {
            const res = await evalTS("csvLocaliserRun", aepPath, csvText, skipExisting, runMcIt);
            if (res === undefined) throw new Error("no bridge");
            if (res.success) {
                const rows = (res as { rows?: CsvLocRow[] }).rows || [];
                const problems = rows.filter((r) => r.status === "no-master" || r.status === "error").length;
                setNotice((res.message || "Run finished.") + (problems ? ` — ${problems} row(s) had no master match.` : ""));
                if (rows.length) showLocGenReport(csvResultToLocGenReport(res as any, "CSV Localiser (pasted)"));
            } else {
                setNotice(res.error || "Something went wrong.");
            }
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects to run it.");
        } finally {
            setBusy(false);
        }
    };

    const toggleExpand = (t: string) =>
        setExpanded((s) => {
            const n = new Set(s);
            n.has(t) ? n.delete(t) : n.add(t);
            return n;
        });

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (scan || []).filter((t) => !q || t.territory.toLowerCase().includes(q));
    }, [scan, search]);

    return (
        <div className="form-tool specs-tool">
            {/* Folders */}
            <div className="specs-folders">
                <label className="specs-field-label">Campaign</label>
                <div className="field-with-button">
                    <div className="field-row specs-campaign-select">
                        <Dropdown
                            icon={<Library size={13} />}
                            value={campaignName}
                            onChange={selectCampaign}
                            options={campaigns.map((c) => ({ value: c.name, label: c.name }))}
                            placeholder="Select a campaign…"
                            emptyMessage="No campaigns yet — add one with the + button."
                            disabled={busy}
                        />
                    </div>
                    <Tooltip text="Add a campaign (pick its Markets folder)">
                        <button className="icon-btn specs-campaign-btn" disabled={busy} onClick={addCampaign}><FolderPlus size={14} /></button>
                    </Tooltip>
                </div>

                <label className="specs-field-label">
                    Markets folder {campaignName && marketsRoot && <span className="specs-detected">from campaign</span>}
                </label>
                <div className="field-with-button">
                    <div className="field-row">
                        <input type="text" value={marketsRoot} onChange={(e) => setMarketsRoot(e.target.value)} placeholder="The campaign's Markets (territories) folder…" />
                    </div>
                    <Tooltip text="Browse for the Markets folder">
                        <button className="icon-btn" disabled={busy} onClick={browseMarkets}><FolderSearch size={14} /></button>
                    </Tooltip>
                </div>

                <label className="specs-field-label">
                    AEP masters folder {mastersAuto && aepPath && <span className="specs-detected">auto-detected</span>}
                </label>
                <div className="field-with-button">
                    <div className="field-row">
                        <input type="text" value={aepPath} onChange={(e) => { setAepPath(e.target.value); setMastersAuto(false); }} placeholder="Folder of master AEPs to localise from…" />
                    </div>
                    <Tooltip text="Browse for the AEP masters folder">
                        <button className="icon-btn" disabled={busy} onClick={browseAep}><FolderSearch size={14} /></button>
                    </Tooltip>
                </div>

                <div className="specs-actions-row">
                    <CheckboxToggle checked={skipExisting} onChange={setSkipExisting} label="Skip existing files" />
                    <Tooltip text="Swap each generated file's PNG/JPG footage for the localised versions in the territory's JPG_PNG batch folder, while the file is still open — instead of re-opening every file afterwards with MC It!">
                        <span>
                            <CheckboxToggle checked={runMcIt} onChange={setRunMcIt} label="Run MC It! inline" />
                        </span>
                    </Tooltip>
                    <button className="specs-scan-btn" disabled={busy || !marketsRoot} onClick={runScan}>
                        {scan ? <RefreshCw size={14} /> : <ScanSearch size={14} />} {scan ? "Re-scan" : "Scan Specs"}
                    </button>
                </div>
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
                        {filtered.map((t) => {
                            const open = expanded.has(t.territory);
                            const runnable = t.rowCount > 0;
                            const batchCount = t.batches.filter((b) => b.rows.length).length;
                            const status = runnable ? `${batchCount} batch${batchCount === 1 ? "" : "es"} · ${t.rowCount} rows` : t.hasSpecs ? "no rows" : "no Specs";
                            const statusClass = runnable ? "ok" : t.hasSpecs ? "warn" : "muted";
                            return (
                                <div key={t.territory} className={"specs-terr" + (runnable ? "" : " is-disabled")}>
                                    <div className="specs-terr-head">
                                        <button className="specs-terr-main" onClick={() => runnable && toggleExpand(t.territory)} disabled={!runnable}>
                                            <MapPin size={13} />
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

                                    {open && runnable && (
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
                                                        {batchOpen && b.rows.length > 0 && (
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
                                                                        <th>Artwork</th><th>Campaign</th><th>Site</th><th>Size</th><th>Dur</th>
                                                                        <th className="specs-row-revert-col" />
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {b.rows.map((r, i) => {
                                                                        const excluded = isRowExcluded(key, i);
                                                                        const eff = effectiveRow(key, i, r);
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
                                                        {batchOpen && batchRows[key] && (
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
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Build-a-batch — visual alternative to Paste CSV */}
            <div className="specs-fallback specs-build">
                <button className="specs-fallback-toggle" onClick={() => setBuildOpen((v) => !v)}>
                    {buildOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <Wand2 size={13} /> Build a batch
                </button>
                {buildOpen && (
                    <div className="specs-fallback-body specs-build-body">
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
                                <span>Type</span><span>Creative</span><span>Width</span><span>Height</span><span>Dur</span><span />
                            </div>
                            {buildRows.map((r) => (
                                <div className="specs-build-row" key={r.id}>
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
                                    <input type="number" min="1" placeholder="W" value={r.width} onChange={(e) => updateBuildRow(r.id, { width: e.target.value })} />
                                    <input type="number" min="1" placeholder="H" value={r.height} onChange={(e) => updateBuildRow(r.id, { height: e.target.value })} />
                                    <input type="number" min="1" placeholder="sec" value={r.duration} onChange={(e) => updateBuildRow(r.id, { duration: e.target.value })} />
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

            {/* Paste-CSV fallback */}
            <div className="specs-fallback">
                <button className="specs-fallback-toggle" onClick={() => setPasteOpen((v) => !v)}>
                    {pasteOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <ClipboardPaste size={13} /> Paste a CSV instead
                </button>
                {pasteOpen && (
                    <div className="specs-fallback-body">
                        <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={8} placeholder="Paste a [METADATA] block + Artwork/Campaign/Size/Duration rows…" />
                        <button disabled={busy || !csvText.trim() || !aepPath} onClick={runPaste}>
                            <PlayCircle size={14} /> Run pasted CSV
                        </button>
                    </div>
                )}
            </div>

            {notice && <p className="hint">{notice}</p>}
        </div>
    );
};

export default CSVLocaliserTool;
