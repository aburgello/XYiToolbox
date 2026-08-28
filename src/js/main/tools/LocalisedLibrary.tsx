// =============================================================================
// src/js/main/tools/LocalisedLibrary.tsx
// -----------------------------------------------------------------------------
// Localised Library, ported from XYi_Localised_Library.jsx -- a campaign ->
// territory -> component library, manually curated (or auto-populated from a
// "Support_Motion"/"Motion_Components" folder). Wasn't part of the vertical
// listbox in the original toolbox -- it was launched next to the search bar,
// same as OV Library used to be. Every actual file operation happens in
// aeft.ts via evalTS() -- this file only holds UI state.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
    Download,
    Search,
    FolderPlus,
    Trash2,
    Plus,
    Wand2,
    Hammer,
    ArrowRight,
    Link2Off,
    X,
    CheckSquare,
    Square,
    FolderInput,
    ChevronRight,
    ChevronDown,
    ArrowLeft,
    Library,
    MapPin,
    Folder,
    Image,
    Layers,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import Tooltip from "../Tooltip";
import StatusIcon from "../StatusIcon";
import Dropdown from "../Dropdown";
import { alertDialog, confirmDialog, promptDialog } from "../Dialog";
import "../shared.scss";
import "./LocalisedLibrary.scss";

interface Campaign {
    name: string;
    marketsRoot: string;
}

interface Component {
    campaign: string;
    territory: string;
    label: string;
    path: string;
    // Explicit folder assignment ("mini directories" split by file type,
    // e.g. PNG/AEP/AI) -- undefined means folderForComponent() below
    // auto-buckets it by extension instead. This is a library-only
    // grouping, not a mirror of how the files actually sit on disk.
    folder?: string;
    // The creative folder this file really sits in inside Support_Motion,
    // and the one field here that IS the disk. Territories now carry a
    // folder per creative (Support_Motion/Bracelet/MCs_Taglines/…) and
    // bucketing purely by file type threw Bracelet's and Trio's artwork
    // into one AI folder with only the filename to tell them apart --
    // and not every filename carries its creative. Absent means the file
    // sits loose in Support_Motion, which is every older campaign; those
    // keep exactly the view they had. See localise.ts's LocLibComponent.
    creative?: string;
}

/** Mirrors localise.ts's MakeMotionScan. */
interface MakeMotionScan {
    success: boolean;
    error?: string;
    territory?: string;
    componentsRoot?: string;
    supportRoot?: string;
    components?: { name: string; categories: string[]; aeps: number }[];
    territoryFolders?: string[];
    pairs?: { component: string; territoryFolder: string; auto?: boolean }[];
    unmatchedTerritory?: string[];
    unmatchedComponents?: string[];
}

interface MakeMotionResult {
    success: boolean;
    error?: string;
    destRoot?: string;
    dryRun?: boolean;
    made?: number;
    relinked?: number;
    compsRenamed?: number;
    message?: string;
    files?: {
        component: string; category: string; from: string; to?: string;
        relinked?: number; compsRenamed?: number;
        status: "made" | "exists" | "skipped" | "error"; reason?: string;
    }[];
}

interface CustomFolder {
    campaign: string;
    territory: string;
    name: string;
}

interface Toast {
    id: number;
    text: string;
    type: "success" | "error";
}

// Extension -> display folder name. Anything not listed falls back to the
// extension itself uppercased (e.g. ".xml" -> "XML"); no extension at all
// (a rare extensionless file) falls back to "Other".
const EXTENSION_FOLDER_MAP: Record<string, string> = {
    aep: "AEP", aet: "AEP",
    ai: "AI", eps: "AI",
    png: "PNG",
    jpg: "JPG", jpeg: "JPG",
    psd: "PSD",
    mov: "MOV", mp4: "MOV",
    pdf: "PDF",
};

// A component's own explicit `folder` always wins; otherwise derived from
// its file extension. Never persisted for the auto-bucketed case -- this
// stays purely a display-time computation so it can't drift out of sync
// with a component's real path.
function folderForComponent(c: Component): string {
    if (c.folder) return c.folder;
    const m = c.path.match(/\.([A-Za-z0-9]+)$/);
    const ext = m ? m[1].toLowerCase() : "";
    if (!ext) return "Other";
    return EXTENSION_FOLDER_MAP[ext] || ext.toUpperCase();
}

// Browser-preview mock data (no CEP bridge outside AE) -- same intent as OV
// Library's MOCK_* constants: lets the layout be previewed at
// http://localhost:3000/main/ without a real Markets folder. Only ever used
// when the very first bridge call returns no bridge (see refreshCampaigns).
const MOCK_CAMPAIGNS: Campaign[] = [
    { name: "ODY_INTL_DGTL_DOOH_HORSE", marketsRoot: "/mock/HORSE/Markets" },
    { name: "GLADIATOR_II_DOOH", marketsRoot: "/mock/GLAD/Markets" },
];
const MOCK_TERRITORIES: Record<string, string[]> = {
    ODY_INTL_DGTL_DOOH_HORSE: ["France", "Germany", "Spain", "Italy", "Japan", "Brazil", "APAC (ex. China)"],
    GLADIATOR_II_DOOH: ["France", "Mexico", "Australia"],
};
const MOCK_COMPONENTS: Component[] = [
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Logo_Endcard_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Logo_Endcard_FR.aep" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Legal_Line_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Legal_Line_FR.aep" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Logo_Mark_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Logo_Mark_FR.png" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Brand_Vector_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Brand_Vector_FR.ai" },
    // Filed under a custom folder ("Legal Approved") rather than
    // auto-bucketed by extension -- demonstrates a manually-moved entry.
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Legal_Signoff_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Legal_Signoff_FR.pdf", folder: "Legal Approved" },
    // Germany is filed the NEW way -- a folder per creative inside
    // Support_Motion, each with its own sub-structure below it. France
    // above is the old flat shape, deliberately left alone so browser
    // preview shows both: a territory that grows the creative level and
    // one that never does.
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "Germany", label: "FID_INTL_Bracelet_1L_TAGLINE_DE_RGB", path: "/mock/HORSE/Markets/Germany/Support_Motion/Bracelet/MCs_Taglines/FID_INTL_Bracelet_1L_TAGLINE_DE_RGB.ai", creative: "Bracelet" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "Germany", label: "FID_Teaser_PIB_Pedigree_DE_RGB_SIMP", path: "/mock/HORSE/Markets/Germany/Support_Motion/Bracelet/MCs_Taglines/FID_Teaser_PIB_Pedigree_DE_RGB_SIMP.psd", creative: "Bracelet" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "Germany", label: "Bracelet_Date_DE", path: "/mock/HORSE/Markets/Germany/Support_Motion/Bracelet/Date/Bracelet_Date_DE.aep", creative: "Bracelet" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "Germany", label: "Trio_TT_DE", path: "/mock/HORSE/Markets/Germany/Support_Motion/Trio/TT/Trio_TT_DE.ai", creative: "Trio" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "Germany", label: "Trio_Endcard_DE", path: "/mock/HORSE/Markets/Germany/Support_Motion/Trio/Trio_Endcard_DE.aep", creative: "Trio" },
    // Loose in Support_Motion alongside those two folders -- the mixed
    // case, which is what the second caption on that screen is for.
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "Germany", label: "Logo_Endcard_DE", path: "/mock/HORSE/Markets/Germany/Support_Motion/Logo_Endcard_DE.aep" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "Japan", label: "Logo_Endcard_JP", path: "/mock/HORSE/Markets/Japan/Support_Motion/Logo_Endcard_JP.aep" },
];
// A still-empty custom folder -- demonstrates that a just-created folder
// with zero components in it yet still shows in the folder list.
const MOCK_FOLDERS: CustomFolder[] = [
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", name: "Legal Approved" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", name: "WIP" },
];
const MOCK_CODES: Record<string, string> = { France: "FR", Germany: "DE", Spain: "ES", Italy: "IT", Japan: "JP", Brazil: "BR", Mexico: "MX", Australia: "AU" };
// Demonstrates the "You may be in…" suggestion in browser preview, same as
// every other MOCK_* constant here -- real detection needs a real saved
// project file, which preview mode never has.
const MOCK_DETECTED_TERRITORY: Record<string, string | null> = { ODY_INTL_DGTL_DOOH_HORSE: "France", GLADIATOR_II_DOOH: null };
// Stand-in for "the AE project currently open" in preview (real detection
// reads app.project.file, which doesn't exist there) -- "poster" matches
// Poster_Creative_FR/Poster_1Sheet_FR.jpg so the suggestion has something
// real to point at once you're a level deep.
const MOCK_OPEN_PROJECT_HINT = "poster";
// …and which creative the open project looks like, for the highlight on the
// creative rows. Bracelet, so Germany (the territory filed the new way) has
// something to mark in preview.
const MOCK_DETECTED_CREATIVE = "Bracelet";
// Demonstrates the lazy, one-level-at-a-time JPG_PNG browse in preview --
// keyed by territory for the root level, and by "territory/breadcrumb
// path" for anything drilled into, matching how the real handlers below
// build a level key. Germany deliberately has no entry (falls back to
// the "no JPG_PNG folder found" empty state). Batch_1 has its own nested
// subfolder (Poster_Creative_FR) to demonstrate drilling more than one
// level deep -- the exact case that used to get silently flattened.
interface JpgPngLevel { folders: string[]; files: { name: string; path: string }[]; }
const MOCK_JPG_PNG_ROOT: Record<string, JpgPngLevel> = {
    France: { folders: ["Batch_1", "Batch_1_Post", "Batch_2", "Bespoke"], files: [] },
};
const MOCK_JPG_PNG_LEVELS: Record<string, JpgPngLevel> = {
    "France/Batch_1": {
        folders: ["Poster_Creative_FR"],
        files: [{ name: "Logo_Transparent_FR.png", path: "/mock/HORSE/Markets/France/JPG_PNG/Batch_1/Logo_Transparent_FR.png" }],
    },
    "France/Batch_1/Poster_Creative_FR": {
        folders: [],
        files: [{ name: "Poster_1Sheet_FR.jpg", path: "/mock/HORSE/Markets/France/JPG_PNG/Batch_1/Poster_Creative_FR/Poster_1Sheet_FR.jpg" }],
    },
    "France/Batch_1_Post": {
        folders: [],
        files: [{ name: "Poster_1Sheet_FR_v2.jpg", path: "/mock/HORSE/Markets/France/JPG_PNG/Batch_1_Post/Poster_1Sheet_FR_v2.jpg" }],
    },
    "France/Batch_2": {
        folders: [],
        files: [{ name: "Billboard_FR.jpg", path: "/mock/HORSE/Markets/France/JPG_PNG/Batch_2/Billboard_FR.jpg" }],
    },
    "France/Bespoke": {
        folders: [],
        files: [{ name: "Metro_Panel_FR.png", path: "/mock/HORSE/Markets/France/JPG_PNG/Bespoke/Metro_Panel_FR.png" }],
    },
};

// Shimmer placeholder matching a real territory row's layout (pip + name +
// count badge), shown while the territory scan is in flight -- same
// instinct as OV Library's SkeletonCard/SkeletonVariantBlock.
const SkeletonTerritoryRow: React.FC = () => (
    <div className="ll-terr-row skeleton">
        <span className="ll-pip shimmer-bar" />
        <span className="ll-terr-name shimmer-bar" style={{ width: "60%", height: "11px" }} />
        <span className="ll-count shimmer-bar" style={{ width: "16px" }} />
    </div>
);

const LocalisedLibraryTool = () => {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

    const [territories, setTerritories] = useState<string[]>([]);
    const [components, setComponents] = useState<Component[]>([]);
    const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
    const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);
    // EXPANSION, NOT NAVIGATION. Below a territory this used to be two
    // more pages -- pick a creative, then pick a folder, each swapping the
    // whole view. A library is a thing you rummage in: the answer is often
    // "which of these two folders has it", and a page swap makes that a
    // there-and-back each time, losing the list you were comparing against.
    // Everything under a territory now opens in place, so several folders
    // (and several creatives) can be open at once and the batch selection
    // spans all of them.
    //
    // Folder keys carry their creative -- every creative has an `AI`.
    const [expandedCreatives, setExpandedCreatives] = useState<Set<string>>(new Set());
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

    // Which creative the OPEN PROJECT looks like, highlighted in the list.
    // Same spirit as detectedTerritory above -- a pointer, never a filter:
    // null (unsaved project, another campaign, a territory filed the old
    // way) just means no row is marked.
    const [detectedCreative, setDetectedCreative] = useState<string | null>(null);
    const [territorySearch, setTerritorySearch] = useState("");
    const [countryCodes, setCountryCodes] = useState<Record<string, string>>({});

    // "You may be in..." -- the territory (if any) whose folder the
    // currently open AE project's saved file path sits inside, detected
    // against this campaign's own scanned territory list. Purely a quick-
    // access suggestion pinned above the list -- null just means no match
    // (unsaved project, project outside this campaign's Markets tree, or
    // browser preview), never an error state.
    const [detectedTerritory, setDetectedTerritory] = useState<string | null>(null);

    // JPG_PNG lazy browse -- deliberately NOT part of `components`/the
    // persisted library (see localise.ts's removal note above
    // llIsComponentsContainerName): a live, on-demand filesystem scan.
    // `jpgPngScanned` gates re-scanning the ROOT on every collapse/
    // re-expand of the same territory -- once loaded, toggling the
    // section just shows/hides the already-fetched top-level listing.
    const [jpgPngExpanded, setJpgPngExpanded] = useState(false);
    const [jpgPngLoading, setJpgPngLoading] = useState(false);
    const [jpgPngScanned, setJpgPngScanned] = useState(false);
    const [jpgPngFolderPath, setJpgPngFolderPath] = useState<string | null>(null);
    const [jpgPngRootFolders, setJpgPngRootFolders] = useState<string[]>([]);
    const [jpgPngRootFiles, setJpgPngRootFiles] = useState<{ name: string; path: string }[]>([]);

    // Drilling below the root: one entry per level descended into (a
    // batch, then any subfolder inside it, etc.) -- NOT capped at one
    // level deep, since a real batch's own internal structure varies
    // (some are flat, some nest a subfolder per creative). Each entry's
    // `path` is the full on-disk folder path at that level; `label` is
    // just its own folder name, kept separately so breadcrumbs don't
    // have to re-derive a name from a full path. [] means "at the root
    // listing" (jpgPngRootFolders/jpgPngRootFiles above).
    const [jpgPngStack, setJpgPngStack] = useState<{ label: string; path: string }[]>([]);
    const [jpgPngLevelLoading, setJpgPngLevelLoading] = useState(false);
    const [jpgPngLevelFolders, setJpgPngLevelFolders] = useState<string[]>([]);
    const [jpgPngLevelFiles, setJpgPngLevelFiles] = useState<{ name: string; path: string }[]>([]);
    // "Current file" quick-access suggestion at whichever level is being
    // viewed -- see localise.ts's suggestJpgPngMatch() for the matching
    // logic and why it's deliberately conservative (null far more often
    // than not, by design).
    const [jpgPngSuggestion, setJpgPngSuggestion] = useState<string | null>(null);

    const [loadingTerritories, setLoadingTerritories] = useState(false);
    const [busy, setBusy] = useState(false);
    // True only in browser preview (no CEP bridge) -- drives the mock data
    // path so the layout is viewable without AE. Never true inside real AE.
    const [mockMode, setMockMode] = useState(false);

    // --- Make the Motion -----------------------------------------------------
    // The scan, the pairing a person is editing, and the preview. Held here
    // rather than inside the modal so a pairing survives flipping between the
    // preview and the pairing screen.
    const [makeBusy, setMakeBusy] = useState(false);
    const [makeScan, setMakeScan] = useState<MakeMotionScan | null>(null);
    const [makePairs, setMakePairs] = useState<Record<string, string>>({});
    const [makePreview, setMakePreview] = useState<MakeMotionResult | null>(null);

    // Batch-import selection -- component paths (unique enough as a key
    // since a real library never has two components sharing a source
    // file), scoped to whichever territory is currently selected. Cleared
    // on every territory switch below so a stale selection from a
    // different territory can never get silently carried into a batch
    // action on this one.
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [batchBusy, setBatchBusy] = useState(false);

    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastId = useRef(0);

    const pushToast = (text: string, type: Toast["type"] = "success") => {
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, text, type }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    };

    const safeEvalTS = async (name: string, ...args: any[]): Promise<any> => {
        try {
            const result = await evalTS(name as any, ...args);
            if (result === undefined) throw new Error("no bridge");
            return result;
        } catch (e: any) {
            // Two different failure modes land here, and they used to show
            // the same generic message regardless -- that's exactly what
            // hid a real bug (getTerritoryCountryCode throwing a
            // SyntaxError on territory names with regex-special characters)
            // behind a misleading "no bridge" toast even while running for
            // real inside AE. `result === undefined` above is the genuine
            // no-bridge case (evalTS's own sentinel for "the bridge call
            // itself never reached an ExtendScript engine," e.g. browser
            // preview). Anything else here is a real thrown ExtendScript
            // exception with an actual `.message` -- show that instead so
            // this class of bug is visible again if it ever recurs.
            const message = e && e.message && e.message !== "no bridge" ? e.message : "No CEP bridge detected. Open this panel inside After Effects to run it.";
            pushToast(message, "error");
            return null;
        }
    };

    // Same bridge call as safeEvalTS, but fails completely silently (no
    // toast) instead of surfacing an error -- for calls where the result
    // is purely decorative and the user never asked for it, so a failure
    // is never something worth interrupting them about. Currently only
    // used for the per-territory country-code badge lookup below: with a
    // real campaign's full territory list (tens of sequential bridge
    // round-trips, not the 2-3 used in earlier testing), an occasional
    // individual call not resolving is a realistic outcome on its own and
    // shouldn't read as "the whole panel lost its connection" -- it just
    // means that one territory's badge doesn't show a code, the same as
    // a territory whose name genuinely has no match in the lookup table.
    const quietEvalTS = async (name: string, ...args: any[]): Promise<any> => {
        try {
            const result = await evalTS(name as any, ...args);
            return result === undefined ? null : result;
        } catch (e) {
            return null;
        }
    };

    useEffect(() => {
        refreshCampaigns();
    }, []);

    // Advisory markers for the picker: which campaigns' Markets roots resolve
    // on this machine, and which the team has retired. Both are best-effort and
    // completely silent on failure -- an unmounted NAS is a normal state, and
    // an unmarked row is the safe default in both directions (it never claims
    // "reachable", only "not mounted" when the check actually ran and said so).
    const [campaignReach, setCampaignReach] = useState<Record<string, boolean>>({});
    const [retiredCampaigns, setRetiredCampaigns] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!campaigns.length) return;
        (async () => {
            const rows = (await quietEvalTS("locLibCampaignStatus")) as { name: string; reachable: boolean }[] | null;
            if (rows) {
                const next: Record<string, boolean> = {};
                rows.forEach((r) => { next[r.name] = r.reachable; });
                setCampaignReach(next);
            }
            const board = (await quietEvalTS("teamCampaignBoard")) as { read?: boolean; rows?: { name: string; retiredBy: string }[] } | null;
            // `read` false means the team folder could not be asked -- keep
            // whatever we had rather than clearing every marker, so a dropped
            // NAS mount doesn't silently un-retire the whole list on screen.
            if (board && board.read) {
                const next: Record<string, string> = {};
                (board.rows || []).forEach((r) => { if (r.retiredBy) next[r.name.toLowerCase()] = r.retiredBy; });
                setRetiredCampaigns(next);
            }
        })();
    }, [campaigns]);

    const refreshCampaigns = async () => {
        // quietEvalTS (not safeEvalTS) for this first probe: a null result
        // here means "no bridge" (browser preview), which we handle with
        // mock data rather than an error toast the user can't act on.
        const camps = await quietEvalTS("loadLocLibCampaigns");
        if (camps === null) {
            setMockMode(true);
            setCampaigns(MOCK_CAMPAIGNS);
            if (!selectedCampaign) setSelectedCampaign(MOCK_CAMPAIGNS[0]);
            return;
        }
        setMockMode(false);
        setCampaigns(camps || []);
        if (camps && camps.length > 0 && !selectedCampaign) {
            // Campaigns come back in the order they were ADDED, so camps[0]
            // is the OLDEST campaign on the machine -- opening on it meant
            // landing on the wrong campaign every time for anyone with more
            // than one saved. Ask the backend which campaign we're actually
            // in instead (open project's path, else CSV Localiser's / OV
            // Library's current campaign -- see detectCurrentLocLibCampaign
            // in localise.ts), and only fall back to camps[0] when nothing
            // has an opinion. quietEvalTS: a failed guess is not something
            // to toast about, it just means the fallback stands.
            const detected: string | null = await quietEvalTS("detectCurrentLocLibCampaign");
            const match = detected ? camps.find((c: Campaign) => c.name === detected) : undefined;
            setSelectedCampaign(match || camps[0]);
        }
    };

    useEffect(() => {
        if (!selectedCampaign) {
            setTerritories([]);
            setComponents([]);
            setCustomFolders([]);
            setSelectedTerritory(null);
            return;
        }
        refreshTerritories(selectedCampaign);
    }, [selectedCampaign]);

    // On entering a territory, stay at the folder list rather than diving
    // straight into any one folder (previously auto-selected AEP). The user
    // asked to stay out of AEP -- the folder list is the neutral landing so
    // whichever folder they actually want is one deliberate click away.
    useEffect(() => {
        setExpandedCreatives(new Set());
        setExpandedFolders(new Set());
    }, [selectedTerritory]);


    // Fresh territory, fresh JPG_PNG browse -- a listing scanned for
    // France shouldn't linger when switching to Germany.
    useEffect(() => {
        setJpgPngExpanded(false);
        setJpgPngLoading(false);
        setJpgPngScanned(false);
        setJpgPngFolderPath(null);
        setJpgPngRootFolders([]);
        setJpgPngRootFiles([]);
        setJpgPngStack([]);
        setJpgPngLevelLoading(false);
        setJpgPngLevelFolders([]);
        setJpgPngLevelFiles([]);
        setJpgPngSuggestion(null);
    }, [selectedTerritory]);

    useEffect(() => {
        setSelectedPaths(new Set());
    }, [selectedTerritory, jpgPngStack]);

    const refreshTerritories = async (camp: Campaign) => {
        setLoadingTerritories(true);
        setSelectedTerritory(null);
        setDetectedTerritory(null);
        if (mockMode) {
            setTerritories(MOCK_TERRITORIES[camp.name] || []);
            setComponents(MOCK_COMPONENTS);
            setCustomFolders(MOCK_FOLDERS);
            setCountryCodes(MOCK_CODES);
            setDetectedTerritory(MOCK_DETECTED_TERRITORY[camp.name] ?? null);
            setLoadingTerritories(false);
            return;
        }
        try {
            const terrs: string[] = (await safeEvalTS("scanTerritories", camp.marketsRoot)) || [];
            const [allComponents, allFolders] = await Promise.all([
                (safeEvalTS("loadLocLibComponents") as Promise<Component[]>).then((v) => v || []),
                (quietEvalTS("loadLocLibFolders") as Promise<CustomFolder[]>).then((v) => v || []),
            ]);
            setTerritories(terrs);
            setComponents(allComponents);
            setCustomFolders(allFolders);

            // Parallel, not a sequential for-loop -- these are independent
            // lookups, and a real campaign's full territory list (tens of
            // entries, not the 2-3 used in earlier testing) means a
            // sequential chain of round-trips adds up to real, visible
            // delay for something purely decorative. Parallelizing also
            // shrinks the total time window any individual call could
            // hiccup in. quietEvalTS (not safeEvalTS) on purpose -- see its
            // own comment above. detectCurrentTerritory joins the same
            // Promise.all for the same reason -- one more decorative,
            // best-effort lookup that shouldn't add its own sequential
            // round-trip on top of the country-code batch.
            const [codeEntries, detected] = await Promise.all([
                Promise.all(terrs.map(async (t) => [t, await quietEvalTS("getTerritoryCountryCode", t)] as const)),
                quietEvalTS("detectCurrentTerritory", terrs) as Promise<string | null>,
            ]);
            const codes: Record<string, string> = {};
            for (const [t, code] of codeEntries) {
                if (code) codes[t] = code;
            }
            setCountryCodes(codes);
            setDetectedTerritory(detected);
        } finally {
            setLoadingTerritories(false);
        }
    };

    const handleNewCampaign = async () => {
        const name = await promptDialog("Campaign name (e.g. HORSE, ODY_INTL_DGTL_DOOH...):", "");
        if (!name) return;
        if (campaigns.some((c) => c.name === name)) {
            await alertDialog(`A campaign named "${name}" already exists.`);
            return;
        }
        const marketsRoot = await safeEvalTS("selectMarketsFolder");
        if (!marketsRoot) return;

        const result = await safeEvalTS("saveLocLibCampaign", name, marketsRoot);
        if (!result || !result.success) {
            await alertDialog((result && result.error) || "Could not save campaign.");
            return;
        }
        const newCamp = { name, marketsRoot };
        await refreshCampaigns();
        setSelectedCampaign(newCamp);
    };

    const handleRemoveCampaign = async () => {
        if (!selectedCampaign) return;
        if (
            !(await confirmDialog(
                `Remove campaign "${selectedCampaign.name}" from the library?\n\nThis deletes its saved component entries too — the actual files on disk are untouched.`
            ))
        )
            return;
        await safeEvalTS("removeLocLibCampaign", selectedCampaign.name);
        setSelectedCampaign(null);
        await refreshCampaigns();
    };

    const handleAddComponent = async (creative: string, folder: string) => {
        if (!selectedCampaign || !selectedTerritory) return;
        const path = await safeEvalTS("selectComponentFile", selectedTerritory);
        if (!path) return;

        const defaultLabel = (path.split("/").pop() || path).replace(/\.[^.]+$/, "");
        const label = await promptDialog("Label this component:", defaultLabel);
        if (label === null) return;

        // Filed into the branch whose own "Add to …" button was pressed.
        // With several folders open at once there is no "the folder you
        // are in" left to infer, so the target is passed in rather than
        // read off a selection.
        const result = await safeEvalTS(
            "addLocLibComponent",
            selectedCampaign.name,
            selectedTerritory,
            label || defaultLabel,
            path,
            folder || undefined,
            creative || undefined
        );
        if (result && result.success) {
            const all: Component[] = (await safeEvalTS("loadLocLibComponents")) || [];
            setComponents(all);
        }
    };

    const handleRemoveComponent = async (component: Component) => {
        if (!(await confirmDialog(`Remove "${component.label}" from this territory's library?`))) return;
        await safeEvalTS("removeLocLibComponent", component.campaign, component.territory, component.label, component.path);
        const all: Component[] = (await safeEvalTS("loadLocLibComponents")) || [];
        setComponents(all);
    };

    const handleRemoveFolder = async (folderName: string) => {
        if (!selectedCampaign || !selectedTerritory) return;
        if (
            !(await confirmDialog(
                `Remove the "${folderName}" folder?\n\nComponents inside it aren't deleted -- they'll fall back to being grouped by file type.`
            ))
        )
            return;
        await safeEvalTS("removeLocLibFolder", selectedCampaign.name, selectedTerritory, folderName);
        const [all, allFolders] = await Promise.all([
            (safeEvalTS("loadLocLibComponents") as Promise<Component[]>).then((v) => v || []),
            (safeEvalTS("loadLocLibFolders") as Promise<CustomFolder[]>).then((v) => v || []),
        ]);
        setComponents(all);
        setCustomFolders(allFolders);
        // The folder we were just looking at no longer exists -- drop back
        // to the folder list rather than showing an empty, gone folder.
        // The branch it was is gone; drop it from the open set so a folder
        // recreated under the same name doesn't come back already open.
        setExpandedFolders((prev) => {
            const next = new Set(prev);
            next.delete(folderKey("", folderName));
            return next;
        });
    };

    /**
     * Open the Make the Motion flow: scan, seed the pairing with whatever
     * squashing already resolved, and let a person fix the rest.
     */
    const openMakeMotion = async () => {
        if (!selectedCampaign || !selectedTerritory) return;
        setMakeBusy(true);
        setMakePreview(null);
        try {
            const res = (await safeEvalTS("makeMotionScan", selectedCampaign.marketsRoot, selectedTerritory)) as MakeMotionScan | undefined;
            if (!res) return;
            if (!res.success) { pushToast(res.error || "Couldn't read the master components.", "error"); return; }
            const seeded: Record<string, string> = {};
            (res.pairs || []).forEach((p) => { seeded[p.component] = p.territoryFolder; });
            setMakePairs(seeded);
            setMakeScan(res);
        } finally {
            setMakeBusy(false);
        }
    };

    /** The pairing as the host wants it: only components a folder is chosen for. */
    const pairsForRun = () =>
        Object.keys(makePairs)
            .filter((c) => makePairs[c])
            .map((c) => ({ component: c, territoryFolder: makePairs[c] }));

    const runMakeMotion = async (dryRun: boolean) => {
        if (!selectedCampaign || !selectedTerritory) return;
        const pairs = pairsForRun();
        if (pairs.length === 0) { pushToast("Pair at least one creative first.", "error"); return; }
        setMakeBusy(true);
        try {
            // Plain evalTS on the real run, not the safe wrapper: it opens and
            // saves a project per component, which passes 15s on any territory
            // with more than a handful.
            const call = dryRun ? safeEvalTS : evalTS;
            const res = (await call("makeMotionRun", selectedCampaign.marketsRoot, selectedTerritory, JSON.stringify(pairs), dryRun)) as MakeMotionResult | undefined;
            if (!res) return;
            if (!res.success) { pushToast(res.error || "Make the Motion failed.", "error"); return; }
            setMakePreview(res);
            if (!dryRun) {
                pushToast(res.message || "Done.");
                // What it just wrote is a folder of components worth cataloguing.
                const all: Component[] = (await safeEvalTS("loadLocLibComponents")) || [];
                setComponents(all);
            }
        } finally {
            setMakeBusy(false);
        }
    };

    const handleAutoPopulate = async () => {
        if (!selectedCampaign) {
            await alertDialog("Select or create a campaign first.");
            return;
        }
        const scopeLabel = selectedTerritory ? `the "${selectedTerritory}" territory` : `every territory under "${selectedCampaign.name}"`;
        if (
            !(await confirmDialog(
                `Scan ${scopeLabel} for a "Support_Motion" or "Motion_Components" folder, and auto-add every file found inside as a component?\n\n` +
                    "Where that folder holds a folder per creative, each file is filed under its creative.\n\n" +
                    "Files already in the library are skipped, so this is safe to re-run later as new territories come online."
            ))
        )
            return;

        setBusy(true);
        try {
            const result = await safeEvalTS(
                "autoPopulateLocLib",
                selectedCampaign.name,
                selectedCampaign.marketsRoot,
                selectedTerritory || undefined
            );
            if (result && result.success) {
                const all: Component[] = (await safeEvalTS("loadLocLibComponents")) || [];
                setComponents(all);
                const noMatchCount = (result.territoriesWithNoMatch || []).length;
                // `refiled` is what a re-run does for a library saved before
                // creative folders existed: the rows were already there, so
                // "skipped" alone would report a no-op run that in fact just
                // sorted the whole territory.
                const refiled = result.refiled || 0;
                pushToast(
                    `Added ${result.added}, skipped ${result.skippedExisting} already in library` +
                        (refiled > 0 ? `, filed ${refiled} under their creative` : "") +
                        `, ${noMatchCount} territories with no match.`
                );
            } else if (result) {
                pushToast(result.error || "Auto-populate failed.", "error");
            }
        } finally {
            setBusy(false);
        }
    };

    // Expands the JPG_PNG section, scanning its ROOT (immediate batch
    // folders, same as before) on first open only (jpgPngScanned gates
    // re-fetching on every subsequent collapse/expand of the same
    // territory). Not wrapped in safeEvalTS's usual toast-on-any-failure
    // -- a genuinely empty/missing JPG_PNG folder is a normal, expected
    // outcome for a territory that doesn't have print/OOH deliverables
    // yet, not an error worth a red toast.
    const handleToggleJpgPngSection = async () => {
        if (jpgPngScanned) {
            setJpgPngExpanded((v) => !v);
            return;
        }
        if (!selectedCampaign || !selectedTerritory) return;
        setJpgPngExpanded(true);
        setJpgPngLoading(true);
        try {
            if (mockMode) {
                setJpgPngFolderPath(`/mock/.../${selectedTerritory}/JPG_PNG`);
                const root = MOCK_JPG_PNG_ROOT[selectedTerritory];
                setJpgPngRootFolders(root?.folders || []);
                setJpgPngRootFiles(root?.files || []);
                setJpgPngScanned(true);
                return;
            }
            const territoryPath = selectedCampaign.marketsRoot + "/" + selectedTerritory;
            const result = await safeEvalTS("scanJpgPngBatches", territoryPath);
            if (result) {
                setJpgPngFolderPath(result.jpgPngPath ?? null);
                setJpgPngRootFolders(result.batches || []);
                setJpgPngRootFiles(result.files || []);
                setJpgPngScanned(true);
            }
        } finally {
            setJpgPngLoading(false);
        }
    };

    // Scans ONE level (a batch, or any folder drilled into below it) and,
    // if that level has anything in it, asks the backend whether the
    // currently open AE project looks like it matches one of the names
    // found there -- see suggestJpgPngMatch()'s own header for why this
    // is deliberately conservative (comes back null far more often than
    // not). Shared by both "open a batch from the root" and "open a
    // subfolder while already inside one" -- the only difference is
    // whether it's replacing the stack or appending to it, handled by
    // the two callers below.
    const loadJpgPngLevel = async (mockKey: string, path: string) => {
        setJpgPngLevelLoading(true);
        setJpgPngLevelFolders([]);
        setJpgPngLevelFiles([]);
        setJpgPngSuggestion(null);
        try {
            if (mockMode) {
                const level = MOCK_JPG_PNG_LEVELS[mockKey];
                setJpgPngLevelFolders(level?.folders || []);
                setJpgPngLevelFiles(level?.files || []);
                // Demonstrates the suggestion in preview too -- picks
                // whichever mock name loosely matches the mock "open
                // project" below, same real-vs-mock split every other
                // decorative lookup in this file uses.
                const names = [...(level?.folders || []), ...(level?.files || []).map((f) => f.name)];
                setJpgPngSuggestion(names.find((n) => n.toLowerCase().includes(MOCK_OPEN_PROJECT_HINT)) || null);
                return;
            }
            const result = await safeEvalTS("scanJpgPngLevel", path);
            if (!result || !result.success) {
                if (result) pushToast(result.error || "Could not read that folder.", "error");
                return;
            }
            const folders: string[] = result.folders || [];
            const files: { name: string; path: string }[] = result.files || [];
            setJpgPngLevelFolders(folders);
            setJpgPngLevelFiles(files);
            const names = [...folders, ...files.map((f) => f.name)];
            if (names.length > 0) {
                const suggestion = await quietEvalTS("suggestJpgPngMatch", names);
                setJpgPngSuggestion(suggestion);
            }
        } finally {
            setJpgPngLevelLoading(false);
        }
    };

    // From the root listing (a batch), or from one level down (a
    // subfolder inside whatever's currently open) -- either way this
    // pushes one new entry onto the stack and loads it. `parentPath` is
    // the on-disk folder this name lives directly inside: jpgPngFolderPath
    // from the root, or the current top of the stack otherwise.
    const handleOpenJpgPngFolder = (name: string) => {
        const parentPath = jpgPngStack.length > 0 ? jpgPngStack[jpgPngStack.length - 1].path : jpgPngFolderPath;
        if (!parentPath && !mockMode) return;
        const path = (parentPath || "") + "/" + name;
        const mockKey = [selectedTerritory, ...jpgPngStack.map((s) => s.label), name].join("/");
        setJpgPngStack((prev) => [...prev, { label: name, path }]);
        loadJpgPngLevel(mockKey, path);
    };

    // Back out one level -- to the previous folder if there is one, or
    // all the way back to the root batch listing if this was the first
    // level drilled into.
    const handleJpgPngBack = () => {
        if (jpgPngStack.length <= 1) {
            setJpgPngStack([]);
            setJpgPngLevelFolders([]);
            setJpgPngLevelFiles([]);
            setJpgPngSuggestion(null);
            return;
        }
        const newStack = jpgPngStack.slice(0, -1);
        setJpgPngStack(newStack);
        const mockKey = [selectedTerritory, ...newStack.map((s) => s.label)].join("/");
        loadJpgPngLevel(mockKey, newStack[newStack.length - 1].path);
    };

    // Jump directly to a specific breadcrumb crumb (index into
    // jpgPngStack) -- clicking anything other than the current (last)
    // crumb.
    const handleJpgPngBreadcrumb = (index: number) => {
        const newStack = jpgPngStack.slice(0, index + 1);
        setJpgPngStack(newStack);
        const mockKey = [selectedTerritory, ...newStack.map((s) => s.label)].join("/");
        loadJpgPngLevel(mockKey, newStack[newStack.length - 1].path);
    };

    const handleImport = async (path: string) => {
        const result = await safeEvalTS("importFile", path);
        if (result) {
            pushToast(
                result.success ? `Imported ${path.split("/").pop()?.split("\\").pop()}` : result.error || "Import failed",
                result.success ? "success" : "error"
            );
        }
    };
    const handleReveal = async (path: string) => {
        await safeEvalTS("revealFile", path);
    };

    const toggleSelected = (path: string) => {
        setSelectedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    // Generic over whichever path list is currently on screen -- shared by
    // the folder-components view and the JPG_PNG batch-files view, which
    // are two different data sources feeding the same selectedPaths set.
    // ADDS or REMOVES this group's paths rather than replacing the whole
    // selection. It used to replace it, which was right while exactly one
    // folder could be on screen at a time -- now that branches open in
    // place and the selection spans them, "Select all" in Bracelet's AI
    // would have silently thrown away everything ticked under Trio.
    const toggleSelectAllPaths = (paths: string[]) => {
        setSelectedPaths((prev) => {
            const next = new Set(prev);
            let allHere = paths.length > 0;
            for (const p of paths) if (!next.has(p)) { allHere = false; break; }
            for (const p of paths) {
                if (allHere) next.delete(p);
                else next.add(p);
            }
            return next;
        });
    };

    // Reports a summary toast rather than one per file -- a batch of 5+
    // success toasts stacking up is exactly the noisy pattern this app
    // already moved away from elsewhere (see the "stacked toasts" fix
    // noted in CLAUDE.md), so failures are named individually within a
    // single toast instead of one toast per file.
    const reportBatchResult = (result: any, fallbackError: string) => {
        if (!result) return;
        if (!result.success) {
            pushToast(result.error || fallbackError, "error");
            return;
        }
        const failed: string[] = result.failed || [];
        const imported: number = result.imported || 0;
        if (failed.length === 0) {
            pushToast(`Imported ${imported} file${imported === 1 ? "" : "s"}.`);
            // Only clear the selection on a clean sweep -- if anything
            // failed, leaving the checkboxes as-is lets the user glance at
            // which rows are still selected and retry (e.g. after fixing a
            // missing file) without having to re-pick them one by one.
            setSelectedPaths(new Set());
        } else {
            pushToast(`Imported ${imported}, ${failed.length} failed: ${failed.join(", ")}`, "error");
        }
    };

    const handleImportSelected = async () => {
        if (selectedPaths.size === 0) return;
        setBatchBusy(true);
        try {
            const result = await safeEvalTS("importLocLibComponentsBatch", Array.from(selectedPaths));
            reportBatchResult(result, "Batch import failed.");
        } finally {
            setBatchBusy(false);
        }
    };

    // Opens every .aep in a picked localised batch folder, imports the
    // selected components into each, and saves it in place -- NOT a
    // read-only import. Confirmed with the user this targets localised
    // delivery batches (e.g. "Batch_01" France), never Masters -- aeft.ts
    // still independently refuses to touch anything inside a known
    // Masters root regardless of what this UI does, but the preview step
    // here is what lets the user see and cancel before anything on disk
    // actually changes.
    const handleSaveIntoBatchFolder = async () => {
        if (selectedPaths.size === 0) return;
        const folder = await safeEvalTS("selectBatchFolder");
        if (!folder) return;

        const preview = await safeEvalTS("previewBatchFolderAep", folder);
        if (!preview) return;
        if (preview.blocked) {
            await alertDialog(preview.blockedReason || "That folder can't be used for this.");
            return;
        }
        if (!preview.count) {
            await alertDialog("No .aep files found in that folder.");
            return;
        }

        const folderName = folder.split(/[\\/]/).pop();
        const proceed = await confirmDialog(
            `This will open, update, and SAVE ${preview.count} project file${preview.count === 1 ? "" : "s"} in "${folderName}" with the ${selectedPaths.size} selected component${selectedPaths.size === 1 ? "" : "s"}.\n\n` +
                "This modifies those files on disk and can't be undone. It will also temporarily replace whatever project you currently have open here — save any unsaved work in it first.\n\nContinue?"
        );
        if (!proceed) return;

        setBatchBusy(true);
        try {
            const result = await safeEvalTS("importComponentsIntoBatchFolder", Array.from(selectedPaths), folder);
            reportBatchResult(result, "Batch save failed.");
        } finally {
            setBatchBusy(false);
        }
    };

    const territorySearchLower = territorySearch.trim().toLowerCase();
    const visibleTerritories = territories.filter((t) => {
        if (!territorySearchLower) return true;
        return (t + (countryCodes[t] || "")).toLowerCase().indexOf(territorySearchLower) !== -1;
    });

    const componentsForTerritory = components.filter((c) => c.campaign === selectedCampaign?.name && c.territory === selectedTerritory);

    const countFor = (territory: string) => components.filter((c) => c.campaign === selectedCampaign?.name && c.territory === territory).length;

    // The creatives this territory's Support_Motion actually has a folder
    // for. Empty is the ordinary answer for every campaign filed the old
    // way, and it switches this whole level off rather than showing an
    // empty rail.
    const creativesForTerritory = Array.from(
        new Set(componentsForTerritory.map((c) => c.creative || "").filter((n) => n !== ""))
    ).sort();
    const hasCreatives = creativesForTerritory.length > 0;

    // Everything filed under one creative ("" for the files loose in
    // Support_Motion, which is the whole territory on a tree that has no
    // creative folders at all).
    const componentsOfCreative = (creative: string) =>
        componentsForTerritory.filter((c) => (c.creative || "") === creative);

    // Custom folders are recorded per TERRITORY, so they belong to the loose
    // level; repeating them inside every creative would offer one folder
    // several times over and file into one shared bucket regardless.
    const customFoldersForTerritory = customFolders.filter((f) => f.campaign === selectedCampaign?.name && f.territory === selectedTerritory);
    const customFolderNameSet = new Set(customFoldersForTerritory.map((f) => f.name));

    // Folder names in one creative -- every distinct bucket in actual use
    // (auto extension or explicit) UNION, at the loose level only, any
    // custom folder created but still empty, so a just-made folder doesn't
    // vanish until something is filed in it.
    const folderNamesOf = (creative: string) => {
        const inUse = new Set(componentsOfCreative(creative).map(folderForComponent));
        const customs = creative === "" ? customFoldersForTerritory.map((f) => f.name) : [];
        return Array.from(new Set([...inUse, ...customs])).sort();
    };

    const componentsOfFolder = (creative: string, folder: string) =>
        componentsOfCreative(creative).filter((c) => folderForComponent(c) === folder);

    // The folder key has to carry its creative: every creative has an `AI`.
    const folderKey = (creative: string, folder: string) => `${creative}\u0000${folder}`;
    const toggleFolderOpen = (creative: string, folder: string) => {
        const key = folderKey(creative, folder);
        setExpandedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };
    const toggleCreativeOpen = (creative: string) => {
        setExpandedCreatives((prev) => {
            const next = new Set(prev);
            if (next.has(creative)) next.delete(creative);
            else next.add(creative);
            return next;
        });
    };

    const looseFolderNames = folderNamesOf("");

    // Which creative the open project looks like, asked once per territory
    // against THAT territory's own creative folder names. quiet, not safe:
    // no match is the ordinary answer (unsaved project, another campaign, a
    // territory filed the old way) and must never raise a toast.
    useEffect(() => {
        let cancelled = false;
        const names = creativesForTerritory;
        if (!selectedTerritory || names.length === 0) {
            setDetectedCreative(null);
            return;
        }
        if (mockMode) {
            setDetectedCreative(names.indexOf(MOCK_DETECTED_CREATIVE) !== -1 ? MOCK_DETECTED_CREATIVE : null);
            return;
        }
        (async () => {
            const hit = await quietEvalTS("suggestLocLibCreative", names);
            if (!cancelled) setDetectedCreative(hit || null);
        })();
        return () => {
            cancelled = true;
        };
        // Keyed on the joined names, not the array: it is rebuilt every
        // render, and a raw dependency would re-ask the bridge on each one.
    }, [selectedTerritory, mockMode, creativesForTerritory.join("\u0000")]);

    // One component, wherever it is drawn. Extracted when the folder page
    // became an expanded branch -- the row is identical in both, and two
    // copies of five tooltipped buttons is exactly the kind of pair that
    // drifts apart.
    const renderComponentRow = (c: Component) => (
        <div key={c.label + c.path} className={`ll-comp-row ${selectedPaths.has(c.path) ? "selected" : ""}`}>
            <Tooltip text="Select for batch import">
                <button className="ll-check" onClick={() => toggleSelected(c.path)}>
                    {selectedPaths.has(c.path) ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
            </Tooltip>
            <Tooltip text={c.path}>
                <span className="ll-comp-name">{c.label}</span>
            </Tooltip>
            <Tooltip text="Import (read-only)">
                <button className="ll-row-btn" onClick={() => handleImport(c.path)}>
                    <Download size={14} />
                </button>
            </Tooltip>
            <Tooltip text="Reveal in Finder/Explorer">
                <button className="ll-row-btn" onClick={() => handleReveal(c.path)}>
                    <Search size={14} />
                </button>
            </Tooltip>
            <Tooltip text="Remove from library">
                <button className="ll-row-btn" onClick={() => handleRemoveComponent(c)}>
                    <X size={14} />
                </button>
            </Tooltip>
        </div>
    );

    // One bucket and, when open, its components. `creative` is "" for the
    // buckets of files loose in Support_Motion.
    //
    // Select-all and Add Component live INSIDE the open branch rather than
    // at the foot of the view: with several folders open at once there is
    // no longer a single "the folder you are in" for either to mean.
    const renderFolderBranch = (creative: string, name: string) => {
        const key = folderKey(creative, name);
        const open = expandedFolders.has(key);
        const rows = componentsOfFolder(creative, name);
        const isCustom = creative === "" && customFolderNameSet.has(name);
        const allHereSelected = rows.length > 0 && rows.every((c) => selectedPaths.has(c.path));
        return (
            <div key={key} className="ll-tree-branch">
                <div className="ll-folder-row-wrap">
                    <button className="ll-folder-row" onClick={() => toggleFolderOpen(creative, name)}>
                        {open ? <ChevronDown size={14} className="ll-chevron ll-chevron-lead" /> : <ChevronRight size={14} className="ll-chevron ll-chevron-lead" />}
                        <Folder size={14} className="ll-folder-icon" />
                        <span className="ll-folder-name">{name}</span>
                        <span className={rows.length > 0 ? "ll-count has" : "ll-count"}>{rows.length}</span>
                    </button>
                    {isCustom && (
                        <Tooltip text="Remove this folder (components move back to their file-type folder)">
                            <button className="ll-row-btn ll-folder-delete" onClick={() => handleRemoveFolder(name)}>
                                <Trash2 size={13} />
                            </button>
                        </Tooltip>
                    )}
                </div>
                <AnimatePresence initial={false}>
                    {open && (
                        <motion.div
                            className="ll-tree-children"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.18 }}
                            style={{ overflow: "hidden" }}
                        >
                            {rows.length > 0 && (
                                <div className="ll-select-all" onClick={() => toggleSelectAllPaths(rows.map((c) => c.path))}>
                                    {allHereSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                                    <span>{allHereSelected ? "Deselect all" : "Select all"}</span>
                                </div>
                            )}
                            <div className="ll-comp-list">
                                {rows.length === 0 && <p className="ll-empty">No components in this folder yet.</p>}
                                {rows.map(renderComponentRow)}
                            </div>
                            <button className="ll-add ll-add-inline" onClick={() => handleAddComponent(creative, name)}>
                                <Plus size={14} /> Add to {name}…
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        );
    };
    const allJpgPngSelected = jpgPngLevelFiles.length > 0 && selectedPaths.size === jpgPngLevelFiles.length;

    return (
        <div className="localised-library">

            {/* Campaign context bar */}
            <div className="ll-campaign-bar">
                <Dropdown
                    className="ll-campaign-select"
                    icon={<Library size={13} />}
                    value={selectedCampaign?.name || ""}
                    onChange={(v) => setSelectedCampaign(campaigns.find((c) => c.name === v) || null)}
                    // Same two markers CSV Localiser's picker shows -- both
                    // read the SAME campaign list, so a campaign the team has
                    // retired must not look fine here just because this screen
                    // is the one you happened to open. Read-only on this side:
                    // retiring is done from CSV Localiser, and removal already
                    // has its own button below.
                    options={campaigns.map((c) => ({
                        value: c.name,
                        label: c.name,
                        hint: retiredCampaigns[c.name.toLowerCase()]
                            ? "retired"
                            : campaignReach[c.name] === false
                            ? "not mounted"
                            : undefined,
                        // Greyed and unclickable, same as CSV Localiser's. The
                        // current value stays selectable so the trigger can
                        // still show what you are on -- see DropdownOption.
                        disabled: !!retiredCampaigns[c.name.toLowerCase()],
                    }))}
                    placeholder="Select a campaign…"
                    emptyMessage="No campaigns yet — add one with the folder icon."
                />
                <Tooltip text="New Campaign">
                    <button className="ll-icon-btn" onClick={handleNewCampaign}>
                        <FolderPlus size={14} />
                    </button>
                </Tooltip>
                <Tooltip text="Remove Campaign">
                    <button className="ll-icon-btn" onClick={handleRemoveCampaign} disabled={!selectedCampaign}>
                        <Trash2 size={14} />
                    </button>
                </Tooltip>
            </div>

            {!selectedCampaign ? (
                <div className="ll-empty-state">
                    <Library size={28} />
                    <p>Select or create a campaign to browse its territories and components.</p>
                </div>
            ) : (
                <>
                    {/* The two halves of the same job, grouped: Find catalogues
                        what a territory already has, Make builds it from the
                        master templates. Their spacing lives on the wrapper, or
                        Find's own bottom margin sets the gap between them and
                        Make sets the gap to whatever follows. */}
                    <div className="ll-motion-actions">
                        {/* No tooltip. The label already says what it does and
                            which territory it does it to, and two lines of
                            explanation on hover is a thing you read once and
                            then have in the way forever. */}
                        <button className="ll-auto-populate" disabled={busy} onClick={handleAutoPopulate}>
                            <Wand2 size={14} className={busy ? "spin" : ""} />{" "}
                            {selectedTerritory ? (
                                <>
                                    Find the <span className="ll-auto-populate-territory">{selectedTerritory}</span> Motion
                                </>
                            ) : (
                                "Find the Motion"
                            )}
                        </button>

                        {/* Only inside a territory. Pairing a creative is a
                            judgement (Colombia files PortalToParadise as "P2P"),
                            and one screen cannot ask it of 28 markets at once. */}
                        {selectedTerritory && (
                            <Tooltip text="Builds this territory's components from the master templates. Previews first.">
                                <button className="ll-make-motion" disabled={busy || makeBusy} onClick={openMakeMotion}>
                                    <Hammer size={14} className={makeBusy ? "spin" : ""} />{" "}
                                    Make the <span className="ll-auto-populate-territory">{selectedTerritory}</span> Motion
                                </button>
                            </Tooltip>
                        )}
                    </div>

                    <div className="ll-view-wrap">
                        <motion.div
                            key={jpgPngStack.length > 0 ? "jpgpng-batch" : selectedTerritory ? "folders" : "territories"}
                            className="ll-view"
                            initial={{ opacity: 0, x: selectedTerritory ? 16 : -16 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        >
                            {!selectedTerritory ? (
                                /* ── Territories view ─────────────────────── */
                                <>
                                    <div className="ll-section-head">
                                        <span className="ll-section-title">Territories</span>
                                        {!loadingTerritories && <span className="ll-section-count">{territories.length}</span>}
                                    </div>

                                    {!loadingTerritories && detectedTerritory && territories.includes(detectedTerritory) && (
                                        <button className="ll-suggestion" onClick={() => setSelectedTerritory(detectedTerritory)}>
                                            <MapPin size={13} />
                                            <span className="ll-suggestion-text">
                                                You may be in <strong>{detectedTerritory}</strong>
                                                {countryCodes[detectedTerritory] ? <em> {countryCodes[detectedTerritory]}</em> : null}
                                            </span>
                                            <ChevronRight size={14} className="ll-chevron" />
                                        </button>
                                    )}

                                    <div className="ll-search">
                                        <Search size={12} />
                                        <input
                                            type="text"
                                            placeholder="Find territory…"
                                            value={territorySearch}
                                            onChange={(e) => setTerritorySearch(e.target.value)}
                                        />
                                        {territorySearch && (
                                            <Tooltip text="Clear">
                                                <button className="ll-search-clear" onClick={() => setTerritorySearch("")}>
                                                    <X size={12} />
                                                </button>
                                            </Tooltip>
                                        )}
                                    </div>

                                    <div className="ll-terr-list">
                                        {loadingTerritories &&
                                            Array.from({ length: 6 }).map((_, i) => <SkeletonTerritoryRow key={i} />)}
                                        {!loadingTerritories && visibleTerritories.length === 0 && (
                                            <div className="ll-empty">
                                                {territories.length === 0 ? "No territory folders found under the Markets root." : "No matching territories."}
                                            </div>
                                        )}
                                        {!loadingTerritories &&
                                            visibleTerritories.map((t) => {
                                                const count = countFor(t);
                                                return (
                                                    // Zero-component territories stay clickable (they can still be
                                                    // browsed/populated) but render dimmed, so scanning the list for
                                                    // "where is there actually work" is instant.
                                                    <button key={t} className={count > 0 ? "ll-terr-row" : "ll-terr-row ll-terr-row--empty"} onClick={() => setSelectedTerritory(t)}>
                                                        <span className={count > 0 ? "ll-pip filled" : "ll-pip"} />
                                                        <span className="ll-terr-name">
                                                            {t}
                                                            {countryCodes[t] ? <em> {countryCodes[t]}</em> : null}
                                                        </span>
                                                        <span className={count > 0 ? "ll-count has" : "ll-count"}>{count}</span>
                                                        <ChevronRight size={14} className="ll-chevron" />
                                                    </button>
                                                );
                                            })}
                                    </div>

                                </>
                            ) : jpgPngStack.length > 0 ? (
                                /* ── JPG_PNG level view (a batch, or any folder drilled
                                     into below it) -- breadcrumb navigation since a
                                     batch's own internal structure can nest more than
                                     one level deep. ─────────────────────── */
                                <>
                                    <button className="ll-back" onClick={handleJpgPngBack}>
                                        <ArrowLeft size={13} /> Back
                                    </button>

                                    <div className="ll-jpgpng-crumbs">
                                        <button className="ll-jpgpng-crumb" onClick={() => handleJpgPngBreadcrumb(-1)}>JPG_PNG</button>
                                        {jpgPngStack.map((entry, i) => (
                                            <React.Fragment key={entry.path}>
                                                <ChevronRight size={11} className="ll-jpgpng-crumb-sep" />
                                                {i === jpgPngStack.length - 1 ? (
                                                    <span className="ll-jpgpng-crumb ll-jpgpng-crumb-current">{entry.label}</span>
                                                ) : (
                                                    <button className="ll-jpgpng-crumb" onClick={() => handleJpgPngBreadcrumb(i)}>{entry.label}</button>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </div>

                                    <div className="ll-comp-head">
                                        <div className="ll-comp-title">
                                            <Image size={13} className="ll-folder-icon" /> {jpgPngStack[jpgPngStack.length - 1].label}
                                        </div>
                                        <span className={jpgPngLevelFiles.length > 0 ? "ll-count has" : "ll-count"}>
                                            {jpgPngLevelFiles.length}
                                        </span>
                                    </div>

                                    {!jpgPngLevelLoading && jpgPngSuggestion && (
                                        <button
                                            className="ll-suggestion"
                                            onClick={() => {
                                                if (jpgPngLevelFolders.includes(jpgPngSuggestion)) {
                                                    handleOpenJpgPngFolder(jpgPngSuggestion);
                                                } else {
                                                    const match = jpgPngLevelFiles.find((f) => f.name === jpgPngSuggestion);
                                                    if (match) toggleSelected(match.path);
                                                }
                                            }}
                                        >
                                            <MapPin size={13} />
                                            <span className="ll-suggestion-text">
                                                Current file: <strong>{jpgPngSuggestion}</strong>
                                            </span>
                                            <ChevronRight size={14} className="ll-chevron" />
                                        </button>
                                    )}

                                    {!jpgPngLevelLoading && jpgPngLevelFiles.length > 0 && (
                                        <div className="ll-select-all" onClick={() => toggleSelectAllPaths(jpgPngLevelFiles.map((f) => f.path))}>
                                            {allJpgPngSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                                            <span>{allJpgPngSelected ? "Deselect all" : "Select all"}</span>
                                        </div>
                                    )}

                                    <div className="ll-comp-list">
                                        {jpgPngLevelLoading &&
                                            Array.from({ length: 4 }).map((_, i) => <SkeletonTerritoryRow key={i} />)}
                                        {!jpgPngLevelLoading && jpgPngLevelFolders.length === 0 && jpgPngLevelFiles.length === 0 && (
                                            <p className="ll-empty">No subfolders or JPG/PNG files found here.</p>
                                        )}
                                        {/* Subfolders first, own row style (drill deeper, no
                                            checkbox) -- this is what keeps files grouped in
                                            their REAL folders instead of the old flattened
                                            list that made same-named files from different
                                            folders look like duplicates. */}
                                        {!jpgPngLevelLoading &&
                                            jpgPngLevelFolders.map((name) => (
                                                <button key={name} className="ll-folder-row" onClick={() => handleOpenJpgPngFolder(name)}>
                                                    <Folder size={14} className="ll-folder-icon" />
                                                    <span className="ll-folder-name">{name}</span>
                                                    <ChevronRight size={14} className="ll-chevron" />
                                                </button>
                                            ))}
                                        {!jpgPngLevelLoading &&
                                            jpgPngLevelFiles.map((f) => (
                                                <div key={f.path} className={`ll-comp-row ${selectedPaths.has(f.path) ? "selected" : ""}`}>
                                                    <Tooltip text="Select for batch import">
                                                        <button className="ll-check" onClick={() => toggleSelected(f.path)}>
                                                            {selectedPaths.has(f.path) ? <CheckSquare size={14} /> : <Square size={14} />}
                                                        </button>
                                                    </Tooltip>
                                                    <Tooltip text={f.path}>
                                                        <span className="ll-comp-name">{f.name}</span>
                                                    </Tooltip>
                                                    <Tooltip text="Import (read-only)">
                                                        <button className="ll-row-btn" onClick={() => handleImport(f.path)}>
                                                            <Download size={14} />
                                                        </button>
                                                    </Tooltip>
                                                    <Tooltip text="Reveal in Finder/Explorer">
                                                        <button className="ll-row-btn" onClick={() => handleReveal(f.path)}>
                                                            <Search size={14} />
                                                        </button>
                                                    </Tooltip>
                                                </div>
                                            ))}
                                    </div>

                                    {/* Deliberately Import Selected ONLY -- no "Save Into
                                        Batch…" here. That action opens/saves .aep project
                                        files; these are plain JPG/PNG images, so it doesn't
                                        apply and would be actively misleading to offer. */}
                                    <AnimatePresence>
                                        {selectedPaths.size > 0 && (
                                            <motion.div
                                                className="ll-batch"
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: "auto" }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.18 }}
                                            >
                                                <Tooltip text="Import just the selected files into the current project, read-only">
                                                    <button disabled={batchBusy} onClick={handleImportSelected}>
                                                        <Download size={14} /> Import Selected ({selectedPaths.size})
                                                    </button>
                                                </Tooltip>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </>
                            ) : (
                                /* ── Folders view (the "mini directories" split) ── */
                                <>
                                    <button className="ll-back" onClick={() => setSelectedTerritory(null)}>
                                        <ArrowLeft size={13} /> All territories
                                    </button>

                                    <div className="ll-comp-head">
                                        <div className="ll-comp-title">
                                            {selectedTerritory}
                                            {countryCodes[selectedTerritory] ? <em> {countryCodes[selectedTerritory]}</em> : null}
                                        </div>
                                        <span className={componentsForTerritory.length > 0 ? "ll-count has" : "ll-count"}>
                                            {componentsForTerritory.length}
                                        </span>
                                    </div>

                                    {/* Shared scroll region for the whole tree AND the
                                        JPG_PNG section below it -- .ll-folder-list used to
                                        carry flex:1/overflow-y:auto itself, which would have
                                        made it greedily fill all available height and push
                                        JPG_PNG out of view entirely. Only THIS wrapper
                                        scrolls; everything inside is plain block content. */}
                                    <div className="ll-folders-scroll">
                                        {/* THE CREATIVE FOLDERS AS THEY REALLY SIT, above
                                            the file-type buckets rather than dissolved into
                                            them -- and only on a tree that has them, so a
                                            territory filed the old way never grows a level
                                            it hasn't got. */}
                                        {hasCreatives && (
                                            <div className="ll-folder-list ll-creative-list">
                                                <div className="ll-creative-caption">Creatives</div>
                                                {creativesForTerritory.map((name) => {
                                                    const open = expandedCreatives.has(name);
                                                    const isCurrent = detectedCreative === name;
                                                    return (
                                                        <div key={`creative:${name}`} className="ll-tree-branch">
                                                            <div className="ll-folder-row-wrap">
                                                                <button
                                                                    className={`ll-folder-row ll-creative-row ${isCurrent ? "current" : ""}`}
                                                                    onClick={() => toggleCreativeOpen(name)}
                                                                >
                                                                    {open ? <ChevronDown size={14} className="ll-chevron ll-chevron-lead" /> : <ChevronRight size={14} className="ll-chevron ll-chevron-lead" />}
                                                                    <Layers size={14} className="ll-folder-icon" />
                                                                    <span className="ll-folder-name">{name}</span>
                                                                    {/* Which creative the open project looks
                                                                        like. A mark on the row, not a filter
                                                                        -- the other creatives stay exactly
                                                                        where they were. */}
                                                                    {isCurrent && (
                                                                        <Tooltip text="The creative your open project looks like">
                                                                            <span className="ll-current-pill"><MapPin size={10} /> open</span>
                                                                        </Tooltip>
                                                                    )}
                                                                    <span className={componentsOfCreative(name).length > 0 ? "ll-count has" : "ll-count"}>
                                                                        {componentsOfCreative(name).length}
                                                                    </span>
                                                                </button>
                                                            </div>
                                                            <AnimatePresence initial={false}>
                                                                {open && (
                                                                    <motion.div
                                                                        className="ll-tree-children"
                                                                        initial={{ opacity: 0, height: 0 }}
                                                                        animate={{ opacity: 1, height: "auto" }}
                                                                        exit={{ opacity: 0, height: 0 }}
                                                                        transition={{ duration: 0.18 }}
                                                                        style={{ overflow: "hidden" }}
                                                                    >
                                                                        {folderNamesOf(name).length === 0 && (
                                                                            <p className="ll-empty">Nothing filed under {name} yet.</p>
                                                                        )}
                                                                        {folderNamesOf(name).map((f) => renderFolderBranch(name, f))}
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <div className="ll-folder-list">
                                            {/* A caption only where there is something above
                                                to tell these apart from -- these are the files
                                                loose in Support_Motion, sitting beside the
                                                creative folders exactly as they do on disk. */}
                                            {hasCreatives && looseFolderNames.length > 0 && (
                                                <div className="ll-creative-caption">Loose in Support_Motion</div>
                                            )}
                                            {looseFolderNames.length === 0 && !hasCreatives && (
                                                <p className="ll-empty">
                                                    No folders yet. Create one, then Add Component once inside it -- or run Auto-Populate to pull files
                                                    from this territory's Motion Components folder (each lands in a folder named after its file type).
                                                </p>
                                            )}
                                            {looseFolderNames.map((f) => renderFolderBranch("", f))}
                                        </div>

                                        {/* JPG_PNG: deliberately a separate, collapsed-by-default
                                            section below the regular folder list, not another
                                            entry in allFolderNames -- it's a LIVE filesystem
                                            browse (scanned lazily on click, one batch at a time),
                                            not persisted library data like everything above it.
                                            See localise.ts's scanJpgPngBatches() header comment
                                            for why this was split out of Auto-Populate. */}
                                        <div className="ll-jpgpng-section">
                                            <div className="ll-jpgpng-caption">Live folder browse</div>
                                            <button className="ll-jpgpng-toggle" onClick={handleToggleJpgPngSection}>
                                                <span className="ll-jpgpng-icon-badge"><Image size={13} /></span>
                                                <span className="ll-folder-name">JPG_PNG</span>
                                                <span className="ll-jpgpng-hint">
                                                    {jpgPngLoading
                                                        ? "Scanning…"
                                                        : jpgPngScanned
                                                            ? `${jpgPngRootFolders.length} batch${jpgPngRootFolders.length === 1 ? "" : "es"}`
                                                            : "Click to load"}
                                                </span>
                                                {jpgPngExpanded ? <ChevronDown size={14} className="ll-chevron" /> : <ChevronRight size={14} className="ll-chevron" />}
                                            </button>

                                            <AnimatePresence>
                                                {jpgPngExpanded && (
                                                    <motion.div
                                                        className="ll-jpgpng-batches"
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: "auto" }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={{ duration: 0.18 }}
                                                        style={{ overflow: "hidden" }}
                                                    >
                                                        {jpgPngLoading &&
                                                            Array.from({ length: 3 }).map((_, i) => <SkeletonTerritoryRow key={i} />)}
                                                        {!jpgPngLoading && jpgPngScanned && jpgPngFolderPath === null && (
                                                            <p className="ll-empty">No JPG_PNG folder found for this territory.</p>
                                                        )}
                                                        {!jpgPngLoading && jpgPngScanned && jpgPngFolderPath !== null && jpgPngRootFolders.length === 0 && jpgPngRootFiles.length === 0 && (
                                                            <p className="ll-empty">No batch folders found inside JPG_PNG.</p>
                                                        )}
                                                        {!jpgPngLoading &&
                                                            jpgPngRootFolders.map((b) => (
                                                                <button key={b} className="ll-folder-row" onClick={() => handleOpenJpgPngFolder(b)}>
                                                                    <Folder size={14} className="ll-folder-icon" />
                                                                    <span className="ll-folder-name">{b}</span>
                                                                    <ChevronRight size={14} className="ll-chevron" />
                                                                </button>
                                                            ))}
                                                        {/* Stray images sitting directly in JPG_PNG,
                                                            outside any batch folder -- uncommon but
                                                            real, so surfaced rather than silently
                                                            dropped. No batch-select checkboxes here
                                                            (this is a collapsed accordion preview, not
                                                            the full drill-down view) -- Import/Reveal
                                                            only, same as any other quick row. */}
                                                        {!jpgPngLoading &&
                                                            jpgPngRootFiles.map((f) => (
                                                                <div key={f.path} className="ll-comp-row">
                                                                    <Image size={14} className="ll-folder-icon" />
                                                                    <Tooltip text={f.path}>
                                                                        <span className="ll-comp-name">{f.name}</span>
                                                                    </Tooltip>
                                                                    <Tooltip text="Import (read-only)">
                                                                        <button className="ll-row-btn" onClick={() => handleImport(f.path)}>
                                                                            <Download size={14} />
                                                                        </button>
                                                                    </Tooltip>
                                                                    <Tooltip text="Reveal in Finder/Explorer">
                                                                        <button className="ll-row-btn" onClick={() => handleReveal(f.path)}>
                                                                            <Search size={14} />
                                                                        </button>
                                                                    </Tooltip>
                                                                </div>
                                                            ))}
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    </div>

                                    {/* OUTSIDE the scroll region and outside every branch:
                                        a selection now spans folders and creatives, so the
                                        bar that acts on it cannot belong to any one of
                                        them. It used to sit at the foot of the single
                                        folder page, which no longer exists. */}
                                    <AnimatePresence>
                                        {selectedPaths.size > 0 && (
                                            <motion.div
                                                className="ll-batch"
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: "auto" }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.18 }}
                                            >
                                                {/* Both were flex:1 and neither stretched:
                                                    Tooltip's inner span is flex:0 0 auto
                                                    !important, so each button sat at its
                                                    natural width inside a half-width
                                                    wrapper, adrift from both edges. They
                                                    take their natural width deliberately
                                                    now and the bar places them. */}
                                                <Tooltip text="Import just the selected components into the current project, read-only">
                                                    <button disabled={batchBusy} onClick={handleImportSelected}>
                                                        <Download size={14} /> Import Selected ({selectedPaths.size})
                                                    </button>
                                                </Tooltip>
                                                <span className="ll-batch-count">
                                                    {selectedPaths.size} selected
                                                </span>
                                                <Tooltip text="Pick a localised batch folder -- opens, updates, and SAVES every .aep found inside it with the selected components. Modifies those files on disk. Never use on a Masters folder.">
                                                    <button className="danger" disabled={batchBusy} onClick={handleSaveIntoBatchFolder}>
                                                        <FolderInput size={14} /> Save Into Batch…
                                                    </button>
                                                </Tooltip>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </>
                            )}
                        </motion.div>
                    </div>
                </>
            )}

            <div className="toast-stack">
                <AnimatePresence>
                    {toasts.map((t) => (
                        <motion.div
                            key={t.id}
                            className={`toast toast-${t.type}`}
                            initial={{ opacity: 0, y: 8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                            transition={{ type: "spring", stiffness: 450, damping: 32 }}
                        >
                            <StatusIcon type={t.type} />
                            <span>{t.text}</span>
                            <button onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
                                <X size={12} />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* ── Make the Motion ────────────────────────────────────────────
                PAIRING IS THE WHOLE SCREEN. Squashing resolves most creative
                folders across the two trees, but real markets carry P2P,
                PORTAL and PAYOFF_Fist, which resolve to nothing by rule and to
                the WRONG creative by guess. So each component names the folder
                its artwork should come from, seeded where that was obvious and
                blank where it was not, and blank means skip. */}
            {makeScan && (
                <div className="mm-overlay" onClick={() => { setMakeScan(null); setMakePreview(null); }}>
                    <div className="mm-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="mm-head">
                            <div className="mm-head-icon"><Hammer size={16} /></div>
                            <div className="mm-head-text">
                                <div className="mm-title">Make {selectedTerritory}&apos;s Motion</div>
                                <div className="mm-subtitle">
                                    {(makeScan.components || []).length} creative{(makeScan.components || []).length === 1 ? "" : "s"} in the
                                    master templates · writes to <strong>{selectedTerritory}/Test_Support</strong>
                                </div>
                            </div>
                            <button className="mm-close" onClick={() => { setMakeScan(null); setMakePreview(null); }}>
                                <X size={15} />
                            </button>
                        </div>

                        <div className="mm-body">
                            {!makePreview && (
                                <>
                                    <p className="mm-lead">
                                        Each creative takes its artwork from one folder in {selectedTerritory}&apos;s
                                        Masters/Support. Leave one blank to skip it.
                                    </p>
                                    {(makeScan.components || []).map((c) => (
                                        <div key={c.name} className="mm-pair">
                                            <span className="mm-pair-comp">
                                                <span className="mm-pair-name">{c.name}</span>
                                                <em>{c.aeps} component{c.aeps === 1 ? "" : "s"} · {c.categories.join(", ")}</em>
                                            </span>
                                            <ArrowRight size={13} className="mm-pair-arrow" />
                                            <select
                                                className="mm-pair-pick"
                                                value={makePairs[c.name] || ""}
                                                onChange={(e) => setMakePairs((prev) => ({ ...prev, [c.name]: e.target.value }))}
                                            >
                                                <option value="">Skip this creative</option>
                                                {(makeScan.territoryFolders || []).map((f) => (
                                                    <option key={f} value={f}>{f}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                    {(makeScan.territoryFolders || []).length === 0 && (
                                        <p className="mm-empty">
                                            <Link2Off size={13} /> {selectedTerritory} has no Masters/Support folders, so there is
                                            nothing to relink to yet.
                                        </p>
                                    )}
                                </>
                            )}

                            {makePreview && (
                                <>
                                    <p className="mm-lead">
                                        {makePreview.dryRun ? "Nothing written yet." : "Written to " + (makePreview.destRoot || "")}
                                    </p>
                                    {(makePreview.files || []).map((f, i) => (
                                        <div key={i} className={"mm-file mm-file--" + f.status}>
                                            <span className="mm-file-where">{f.component} / {f.category}</span>
                                            <span className="mm-file-name">{f.to || f.from}</span>
                                            {f.reason && <em className="mm-file-why">{f.reason}</em>}
                                        </div>
                                    ))}
                                    {(makePreview.files || []).length === 0 && (
                                        <p className="mm-empty">Nothing to make with that pairing.</p>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="mm-foot">
                            <span className="mm-foot-count">
                                {makePreview
                                    ? makePreview.message
                                    : `${pairsForRun().length} of ${(makeScan.components || []).length} paired`}
                            </span>
                            {makePreview && makePreview.dryRun && (
                                <button className="mm-back" onClick={() => setMakePreview(null)}>Back to pairing</button>
                            )}
                            {/* Preview first, always. This copies into a live
                                territory and opens a project per component;
                                seeing the filenames it would write is the
                                cheapest check there is. */}
                            {!makePreview && (
                                <button className="mm-go" disabled={makeBusy} onClick={() => runMakeMotion(true)}>
                                    {makeBusy ? "Checking…" : "Preview"}
                                </button>
                            )}
                            {makePreview && makePreview.dryRun && (
                                <button className="mm-go" disabled={makeBusy} onClick={() => runMakeMotion(false)}>
                                    {makeBusy ? "Making…" : `Make ${makePreview.made || 0}`}
                                </button>
                            )}
                            {makePreview && !makePreview.dryRun && (
                                <button className="mm-go" onClick={() => { setMakeScan(null); setMakePreview(null); }}>Done</button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LocalisedLibraryTool;
