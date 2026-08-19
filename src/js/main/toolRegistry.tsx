// =============================================================================
// src/js/main/toolRegistry.tsx
// -----------------------------------------------------------------------------
// Single source of truth for every tool registered in the panel:
//   - CATEGORIES: the four business-phase cards.
//   - TOOLS: every tool entry with its id, label, categories, icon, lazy
//     Component, and searchable actions list.
//
// Tool components are loaded with React.lazy() so they only execute when
// the user actually navigates to them -- not all at startup. This matters
// in CEP where the Chromium instance is memory-constrained.
//
// To add a new tool: add a lazy import and one entry to TOOLS.
// One-click tools with no inputs go in tools/Toolset.tsx's ACTIONS array
// instead -- they don't need a TOOLS entry here.
// =============================================================================
import React from "react";
import {
    BookOpen,
    Shuffle,
    FileSignature,
    Languages,
    SlidersHorizontal,
    Clapperboard,
    FileText,
    ShieldCheck,
    ClipboardCheck,
    FileSearch,
    Wand2,
    Replace,
    Stamp,
    Target,
    Grid3x3,
    Expand,
    FileSpreadsheet,
    Repeat,
    Layers,
    MousePointerClick,
    Clock,
    FolderOpen,
    Globe,
    Eye,
    Truck,
    Wrench,
    Copy,
    Image,
    Terminal,
    Code2,
    Monitor,
    ListVideo,
    Scissors,
    LayoutList,
    Sparkles,
    Crosshair,
    ScanSearch,
    Moon,
} from "lucide-react";

// --- Lazy tool imports --------------------------------------------------
const LocalisedLibraryTool  = React.lazy(() => import("./tools/LocalisedLibrary"));
const OVSwapTool            = React.lazy(() => import("./tools/OVSwap"));
const RandomLayersTool      = React.lazy(() => import("./tools/RandomLayers"));
const NameGeneratorTool     = React.lazy(() => import("./tools/NameGenerator"));
const CampaignLocaliserTool = React.lazy(() => import("./tools/CampaignLocaliser"));
const CSVLocaliserTool      = React.lazy(() => import("./tools/CSVLocaliser"));
const ArtworkCheckTool     = React.lazy(() => import("./tools/ArtworkCheck"));
const EditGeneratorTool     = React.lazy(() => import("./tools/EditGenerator"));
const GenerateCueSheetTool  = React.lazy(() => import("./tools/GenerateCueSheet"));
const CheekyDTTool          = React.lazy(() => import("./tools/CheekyDT"));
const BespokeTool           = React.lazy(() => import("./tools/Bespoke"));

const CheckTool             = React.lazy(() => import("./tools/Check"));
const DeliveryHubTool       = React.lazy(() => import("./tools/DeliveryHub"));
const ReviewHubTool         = React.lazy(() => import("./tools/ReviewHub"));
const ScaleCompositionTool  = React.lazy(() => import("./tools/ScaleComposition"));
const AdjustTool            = React.lazy(() => import("./tools/Adjust"));
const SafeGeneratorTool     = React.lazy(() => import("./tools/SafeGenerator"));
const EditToolsTool         = React.lazy(() => import("./tools/EditTools"));
const FindReplaceTool       = React.lazy(() => import("./tools/FindReplace"));
const MasterOfNullsTool     = React.lazy(() => import("./tools/MasterOfNulls"));
const WallToolsTool         = React.lazy(() => import("./tools/WallTools"));
const ExtremeTools01Tool    = React.lazy(() => import("./tools/ExtremeTools01"));
const ExtremeTools02Tool    = React.lazy(() => import("./tools/ExtremeTools02"));
const LOSToolsTool          = React.lazy(() => import("./tools/LOSTools"));
const BatchMatchTool        = React.lazy(() => import("./tools/BatchMatch"));
const EditInContextTool     = React.lazy(() => import("./tools/EditInContext"));
const NameAuditTool         = React.lazy(() => import("./tools/NameAudit"));
const MasterToolsTool       = React.lazy(() => import("./tools/MasterTools"));
const ProjectButtonsTool    = React.lazy(() => import("./tools/ProjectButtons"));
const TimesheetTrackerTool  = React.lazy(() => import("./tools/TimesheetTracker"));
const UsefulFoldersTool     = React.lazy(() => import("./tools/UsefulFolders"));
const AEPThiefTool          = React.lazy(() => import("./tools/AEPThief"));
const JPEGLocTool           = React.lazy(() => import("./tools/JPEGLoc"));
const PDFToCSVTool          = React.lazy(() => import("./tools/PDFToCSV"));
const ScriptPlaygroundTool  = React.lazy(() => import("./tools/ScriptPlayground"));
const MyToolsTool           = React.lazy(() => import("./tools/MyTools"));
const ExpressionsBankTool   = React.lazy(() => import("./tools/ExpressionsBank"));
const CompInspectorTool     = React.lazy(() => import("./tools/CompInspector"));
const RenderQueueManagerTool = React.lazy(() => import("./tools/RenderQueueManager"));
const MaskSeparatorTool      = React.lazy(() => import("./tools/MaskSeparator"));
const ReplicatorTool         = React.lazy(() => import("./tools/Replicator"));
const QuickFXTool            = React.lazy(() => import("./tools/QuickFX"));
const DarkenTool             = React.lazy(() => import("./tools/Darken"));
// Ask is not lazily imported here any more -- it is mounted directly by
// AgentBubble.tsx from main.tsx's shell, so it can outlive screen changes.
// WrikeTasksTool intentionally NOT imported here -- see the "Wrike Tasks
// (unhooked)" note near the end of CLAUDE.md before re-adding it.

// --- Prefetch ---------------------------------------------------------
// Maps tool id → the same dynamic import function React.lazy uses. Calling
// it ahead of time (e.g. on card hover) primes Vite's module cache so the
// later React.lazy resolution is instant — no Suspense fallback, no
// content popping in after the GSAP screen transition finishes.
const PREFETCH_MAP: Record<string, () => Promise<any>> = {
    "localised-library":  () => import("./tools/LocalisedLibrary"),
    "random-layers":      () => import("./tools/RandomLayers"),
    "name-generator":     () => import("./tools/NameGenerator"),
    "campaign-localiser": () => import("./tools/CampaignLocaliser"),
    "csv-localiser":      () => import("./tools/CSVLocaliser"),
    "artwork-check":      () => import("./tools/ArtworkCheck"),
    "edit-generator":     () => import("./tools/EditGenerator"),
    "generate-cue-sheet": () => import("./tools/GenerateCueSheet"),
    "cheeky-dt":          () => import("./tools/CheekyDT"),
    "bespoke":            () => import("./tools/Bespoke"),
    "check":              () => import("./tools/Check"),
    "delivery-hub":       () => import("./tools/DeliveryHub"),
    "review-hub":         () => import("./tools/ReviewHub"),
    "scale-composition":  () => import("./tools/ScaleComposition"),
    "adjust":             () => import("./tools/Adjust"),
    "safe-generator":     () => import("./tools/SafeGenerator"),
    "edit-tools":         () => import("./tools/EditTools"),
    "find-replace":       () => import("./tools/FindReplace"),
    "master-of-nulls":    () => import("./tools/MasterOfNulls"),
    "wall-tools":         () => import("./tools/WallTools"),
    "extreme-tools-01":   () => import("./tools/ExtremeTools01"),
    "extreme-tools-02":   () => import("./tools/ExtremeTools02"),
    "los-tools":          () => import("./tools/LOSTools"),
    "batch-match":        () => import("./tools/BatchMatch"),
    "name-audit":         () => import("./tools/NameAudit"),
    "master-tools":       () => import("./tools/MasterTools"),
    "project-buttons":    () => import("./tools/ProjectButtons"),
    "timesheet-tracker":  () => import("./tools/TimesheetTracker"),
    "useful-folders":     () => import("./tools/UsefulFolders"),
    "aep-thief":          () => import("./tools/AEPThief"),
    "jpeg-loc":           () => import("./tools/JPEGLoc"),
    "pdf-to-csv":         () => import("./tools/PDFToCSV"),
    "script-playground":  () => import("./tools/ScriptPlayground"),
    "my-tools":           () => import("./tools/MyTools"),
    "expressions-bank":   () => import("./tools/ExpressionsBank"),
    "comp-inspector":     () => import("./tools/CompInspector"),
    "render-queue-manager": () => import("./tools/RenderQueueManager"),
    "mask-separator":       () => import("./tools/MaskSeparator"),
    "replicator":           () => import("./tools/Replicator"),
    "quick-fx":             () => import("./tools/QuickFX"),
    "darken":               () => import("./tools/Darken"),
};

export const prefetchTool = (toolId: string) => {
    PREFETCH_MAP[toolId]?.();
};

// --- Types -------------------------------------------------------------

export interface ToolProps {
    onSelectTool?: (toolId: string) => void;
}

export interface ToolEntry {
    id: string;
    label: string;
    /** A tool can appear under more than one category. */
    categories: string[];
    icon: React.ComponentType<{ size?: number }>;
    Component: React.LazyExoticComponent<React.ComponentType<ToolProps>>;
    /** Labels of the individual buttons/actions inside this tool's own page --
     *  searchable from the home screen alongside the tool's own name. */
    actions?: string[];
    /** Short description shown in the tool content header. */
    description?: string;
    /**
     * What each button in `actions` actually DOES, keyed by its exact label.
     *
     * A PARALLEL FIELD rather than richer `actions` entries, because
     * CommandPalette and HomeScreen both iterate `actions` as plain strings
     * for search -- changing that type breaks both.
     *
     * Read by the Ask agent (lib/agent/capabilities.ts). Without it the agent
     * has a button's NAME and nothing else, so anything it says about what a
     * button does is inferred from the label: it told an artist "Bespoke It"
     * was for "custom territory handling" when it is for several masters in
     * one deliverable. Optional and sparse on purpose -- fill it in where a
     * label alone is misleading, not everywhere for completeness.
     */
    actionNotes?: Record<string, string>;
    /**
     * Whether the Ask agent may press a button itself, keyed by exact label.
     *
     *   "read"  — inspects, scans, refreshes, or opens a form. Changes nothing
     *             on disk or in the project. The agent may click it.
     *   "write" — generates, saves, renders, deletes, or otherwise produces
     *             work. The agent NEVER clicks it: it opens the page and says
     *             which button to press.
     *
     * UNLISTED LABELS DEFAULT TO "write". Unknown means don't touch — a new
     * button should not become agent-clickable by having been forgotten here.
     *
     * The dangerous case is not an empty form, it is a LOADED one: an artist
     * who has already set their roots and picked a campaign is exactly the
     * artist most likely to be talking to the agent, and "press Generate" then
     * runs against real config with no picker to catch it.
     *
     * Filling a form's FIELDS is neither of these -- see the note on
     * localiseHandoff.ts. It changes React state, nothing else, and the artist
     * still presses the button.
     */
    actionSafety?: Record<string, "read" | "write">;
    /**
     * WHICH OF THIS TOOL'S FIELDS THE AGENT MAY FILL IN, keyed by a stable
     * field id the tool itself understands.
     *
     * Filling a field is not a write and not an undoable edit -- it is a
     * PROPOSAL. It changes React state, it is visible before it does anything,
     * it can be typed over, and it is inert until the artist presses the
     * button. That is a stronger guarantee than "undoable": undoable means it
     * happened and you reversed it; this means it has not happened yet.
     * prefill_batch already works exactly this way.
     *
     * THE RISK IS NOT THE FILLING, IT IS WHAT THE FIELD FEEDS. Two kinds:
     *
     *   A size, a duration, a territory, a batch row — the field's own type
     *   bounds the damage. The worst case is a wrong value you can see. These
     *   are what this list is for.
     *
     *   A script body, an output path, a filename that decides where files
     *   land — the field bounds nothing. Filling one is not proposing a value,
     *   it is authoring the action, and the button afterwards is a formality
     *   rather than a decision. These are never listed.
     *
     * UNLISTED FIELDS, AND UNLISTED TOOLS, ARE NOT FILLABLE. Same fail-closed
     * rule as actionSafety: a field must not become agent-fillable by having
     * been forgotten here.
     *
     * Two rules the filler enforces regardless of what this list says: the
     * agent fills and STOPS -- it never fills and submits, even for a button
     * graded "read" -- and it never silently replaces a value the artist
     * already typed, because overwriting your work is where a proposal turns
     * into a destructive act.
     */
    fillableFields?: string[];
    /**
     * Set when this tool's real home is a category's bespoke screen rather
     * than its own tool page. Navigating an artist here should land them on
     * that screen, where the tool sits in context with its siblings.
     */
    livesIn?: string;
}

export interface CategoryDef {
    id: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
}

// --- Categories --------------------------------------------------------

export const CATEGORIES: CategoryDef[] = [
    { id: "localise", label: "Localise", icon: Globe },
    { id: "review",   label: "Review",   icon: Eye   },
    { id: "deliver",  label: "Deliver",  icon: Truck },
    { id: "tools",    label: "Tools",    icon: Wrench },
];

// Gives each category its own hover identity. Applied as CSS custom
// properties (var(--cat-*)) via inline style. Pre-blended hex values --
// color-mix() is unsupported on the chrome74 build target.
// `edge` is the RESTING border a category card wears on the OLED surface only
// -- the same 0.5-alpha treatment the Toolset's own resting edges use (see
// themes.ts's REST_EDGE_ALPHA). It exists because on black those four cards
// are otherwise the only elements that lost their identity: same colour as
// each other, and darker than the ground they sit on. Pre-blended rather than
// derived with color-mix(), per this project's chrome74 target.
export const CATEGORY_COLORS: Record<string, { grad: string; border: string; glow: string; icon: string; edge: string }> = {
    localise: { grad: "linear-gradient(135deg, #1c7a76 0%, #0f3d45 100%)", border: "#2dd4bf", glow: "rgba(45, 212, 191, 0.35)",  icon: "#5eead4", edge: "rgba(45, 212, 191, 0.5)" },
    review:   { grad: "linear-gradient(135deg, #6842b0 0%, #2e1a52 100%)", border: "#a78bfa", glow: "rgba(167, 139, 250, 0.35)", icon: "#c4b5fd", edge: "rgba(167, 139, 250, 0.5)" },
    deliver:  { grad: "linear-gradient(135deg, #b3661f 0%, #5c2f0e 100%)", border: "#fb923c", glow: "rgba(251, 146, 60, 0.35)",  icon: "#fdba74", edge: "rgba(251, 146, 60, 0.5)" },
    tools:    { grad: "linear-gradient(135deg, #ad2d67 0%, #4a1530 100%)", border: "#f472b6", glow: "rgba(244, 114, 182, 0.35)", icon: "#f9a8d4", edge: "rgba(244, 114, 182, 0.5)" },
};

export function categoryStyleVars(categoryId: string | undefined): React.CSSProperties {
    const c = CATEGORY_COLORS[categoryId || ""] || CATEGORY_COLORS.tools;
    return {
        "--cat-grad":   c.grad,
        "--cat-border": c.border,
        "--cat-glow":   c.glow,
        "--cat-icon":   c.icon,
        "--cat-edge":   c.edge,
    } as React.CSSProperties;
}

// --- Tools -------------------------------------------------------------

export const TOOLS: ToolEntry[] = [
    {
        id: "review-hub",
        label: "Review",
        categories: ["review"],
        icon: Eye,
        Component: ReviewHubTool,
        actions: ["OV Library", "New Campaign", "Refresh", "Review Session", "Import Selected"],
    },
    {
        id: "localised-library",
        label: "Localised Library",
        categories: ["localise"],
        icon: BookOpen,
        Component: LocalisedLibraryTool,
        actions: ["Auto-Populate from Motion Components", "Add Component"],
        description: "",
    },
    {
        id: "ov-swap",
        label: "OV Swap",
        categories: ["localise"],
        icon: Repeat,
        Component: OVSwapTool,
        actions: ["Scan Active Comp", "Swap Selected", "Reset"],
        description: "Swaps the OV precomps and OV artwork in the active comp for the territory components already imported into the project — exact name match only, with a manual picker for anything it won't guess at.",
    },
    {
        id: "random-layers",
        label: "Random Layers",
        categories: ["tools"],
        icon: Shuffle,
        Component: RandomLayersTool,
        actions: ["Random Z", "Random Starting Point"],
        description: "Applies a random value within [Minimum, Minimum + Range] to whichever layers are currently selected in the active comp — either their Z position or their start time.",
    },
    {
        id: "name-generator",
        label: "Name Generator",
        categories: ["localise"],
        icon: FileSignature,
        Component: NameGeneratorTool,
        actions: ["Generate Name", "Detect Name", "Reset"],
        description: "Builds a standardised comp/filename from these fields for every selected item, or reverse-parses a selected item's existing name back into them (\"Detect Name\").",
        // THE FIRST FILLABLE TOOL, and a deliberately unexciting one. Five short
        // text fields, each bounded by what it is: a film title, an artwork
        // type, a campaign, a site, a country. The worst case is a wrong word
        // sitting in front of you before you press anything.
        //
        // Ids, not labels. actionSafety is keyed by label because a button is
        // identified by its visible text and there is no other handle; a field
        // has a real one, and keying these by label would break the moment
        // "Film Title" was retitled.
        //
        // Generate Name is NOT in actionSafety, so it defaults to "write" and
        // the agent cannot press it. That is the whole shape of this feature:
        // it fills the form and stops.
        fillableFields: ["filmTitle", "artworkType", "campaign", "site", "territory"],
    },
    {
        id: "campaign-localiser",
        label: "Campaign Localiser",
        categories: ["localise"],
        icon: Languages,
        Component: CampaignLocaliserTool,
        // ONLY TROTT IS ADVERTISED, and this list is what advertising means:
        // `actions` drives search, ⌘K and the agent's capability list, so a
        // button left out of it is still on the page and still pressable, just
        // no longer something the panel offers you as a way to localise.
        //
        // A STUDIO ROUTING DECISION, not a judgement about the code: Big Guy
        // Localiser is the route for localising a campaign, and Trott 2.0 is
        // the fallback for the cases it cannot do. Campaign Localiser's two
        // Generate Files buttons are a third way of doing the same job, and
        // three routes to one outcome is how two artists localise the same
        // batch differently. They stay on the page for whoever already knows
        // to reach for them.
        actions: ["Trott 2.0"],
        description: "",
        // WRITES — it opens a master and saves to a new _V01.aep, never over
        // the master itself (CLAUDE.md §1). Worth the agent being able to say
        // so, since "generate" alone does not tell an artist whether anything
        // of theirs is at risk.
        //
        // The notes for the two unadvertised buttons are kept: they cost
        // nothing, they are keyed by label so they simply go unread, and they
        // are the description to restore if the routing decision is ever
        // reversed.
        actionNotes: {
            "Generate Files": "Generates the localised files for the campaign. Writes new _V01.aep files; the master itself is never written to.",
            "Generate Files (don't replace)": "Same as Generate Files, but skips any deliverable that already exists instead of regenerating it.",
            "Trott 2.0": "A generation variant that also writes to new _V01.aep files rather than the master.",
        },
        // Generates deliverables. Never agent-clickable.
        actionSafety: {
            "Generate Files": "write",
            "Generate Files (don't replace)": "write",
            "Trott 2.0": "write",
        },
    },
    {
        // REGISTERED LATE. This tool shipped reachable only as a pane inside
        // LocaliseScreen's TOOLS_ROW ("Big Guy Localiser"), with no entry
        // here -- so it was invisible to home search, to ⌘K, and to anything
        // else that reads TOOLS, exactly as CLAUDE.md's "live but
        // unregistered, and therefore unfindable" note warned. A Localise
        // tool needs BOTH; the TOOLS_ROW half was already there.
        //
        // `label` is what artists actually call it and what the tab says.
        // "CSV" lives in the description so searching either term finds it.
        id: "csv-localiser",
        label: "Big Guy Localiser",
        categories: ["localise"],
        icon: FileSpreadsheet,
        Component: CSVLocaliserTool,
        actions: ["Scan territories", "Re-scan", "Build a Batch", "Bespoke It", "Add row"],
        description: "The main CSV-driven batch localiser: scan a campaign's territories, see what each one still needs, and generate the batch. Build a Batch picks creatives and sizes by hand.",
        // It is the DEFAULT pane of the Localise screen, so that is where an
        // artist should be sent -- in context with the rest of the pipeline,
        // not on an isolated tool page.
        livesIn: "localise",
        actionNotes: {
            "Scan territories": "Walks the campaign's markets root and reports what each territory still needs. Read-only — nothing is generated.",
            "Re-scan": "Same as Scan territories, shown once a scan already exists. Refreshes it.",
            "Build a Batch": "Opens a row builder for picking creatives and sizes by hand, when there is no CSV to drive the batch.",
            "Bespoke It": "Hands off to the Bespoke tool, for a deliverable made of SEVERAL masters at once (e.g. three portrait panels on one metrobus). Not for territory handling.",
            "Add row": "Adds one more deliverable row inside Build a Batch.",
        },
        actionSafety: {
            "Scan territories": "read",
            "Re-scan": "read",
            // Opens the row builder. Building a batch is not running one --
            // nothing is generated until a separate run, so opening the form
            // is safe.
            "Build a Batch": "read",
            "Add row": "read",
            // Navigates to the Bespoke tool. Marked "write" at first on the
            // grounds that it moves the artist's screen -- which is not what
            // this field is for. The test is whether you can get back, and
            // Back is a click.
            "Bespoke It": "read",
        },
    },
    {
        id: "aep-thief",
        label: "AEP Thief",
        categories: ["localise"],
        icon: Copy,
        Component: AEPThiefTool,
        actions: ["Copy AEPs"],
        description: "Recursively copies .aep files from a source folder into a destination folder, skipping ones already there.",
    },
    {
        id: "jpeg-loc",
        label: "JPEG Loc",
        categories: ["localise"],
        icon: Image,
        Component: JPEGLocTool,
        actions: ["JPEG Loc"],
        description: "Batch-replaces .jpg footage across a folder of .aep files with the best-matching JPG (by resolution + number) from a second folder.",
    },
    {
        id: "pdf-to-csv",
        label: "PDF to CSV",
        categories: ["localise"],
        icon: FileSpreadsheet,
        Component: PDFToCSVTool,
        actions: ["PDF to CSV"],
        description: "Scans a folder of PDFs and writes a Campaign_Data_<CC>.csv of matched master info — filename scan only, never opens a project.",
    },
    {
        id: "edit-generator",
        label: "Edit Generator",
        categories: ["localise"],
        icon: Clapperboard,
        Component: EditGeneratorTool,
        actions: ["Generate Edit"],
        description: "Auto-arranges selected layers into a cutdown of a given duration, in the currently open comp.",
    },
    {
        id: "generate-cue-sheet",
        label: "Generate Cue Sheet",
        categories: ["localise"],
        icon: FileText,
        Component: GenerateCueSheetTool,
        actions: ["Generate Cue Sheet"],
        description: "Exports a cue sheet (layer in/out points and durations) for the active comp to a .txt file on the Desktop.",
    },
    {
        // Named for where it is going, not what it does first: a tool id can't
        // be renamed once it ships without orphaning anything saved under it,
        // and this section is meant to grow past MultipleArt.
        id: "bespoke",
        label: "It's Bespokin' Time",
        categories: ["localise"],
        icon: Layers,
        Component: BespokeTool,
        actions: ["Bespoke", "Bespokin", "Multiple Art", "Add segment", "Remove segment", "Screen library", "Library", "Seed from templates", "Find references", "Trace", "Save this layout"],
        // ARRIVING IN A STATE, not pressing a button. Bespoke opens on the mode
        // chooser, so "Screen library" does not exist yet for anything to click
        // -- which is why this tool has no actionSafety and every button stays
        // unpressable. The agent reaches the library through these instead.
        //
        //   mode             "regions" (Bespoke) or "multi" (Multi Art)
        //   libraryOpen      "true" to open the screen library
        //   libraryTerritory a country to filter the library's rail to
        //   screenName       adopt that screen as the reference — ONLY onto an
        //                    empty board. Replacing regions is panel state and
        //                    no Ctrl+Z brings them back, so with work in
        //                    progress the receiver opens the library instead
        //                    and says why.
        //   mastersRoot      point the shelf at a campaign, using the path
        //                    list_campaigns returned
        //   segments         a Multi Art running order, as a JSON array of
        //                    {seconds, count, creative, orientation, size}.
        //                    Matched against the loaded shelf by
        //                    lib/agent/multiArt.ts, which forgives spelling and
        //                    refuses ambiguity. Same empty-board rule as
        //                    screenName, and it never presses Build.
        //   canvasWidth      the DELIVERABLE's size — not a master's. A spec
        //   canvasHeight     saying 1080x1526 is describing this, and the
        //   runtimeSeconds   masters that fill it are whatever the campaign
        //                    has in that shape.
        fillableFields: [
            "mode", "libraryOpen", "libraryTerritory", "screenName", "mastersRoot", "segments",
            "canvasWidth", "canvasHeight", "runtimeSeconds",
        ],
        description: "Compose a deliverable from several masters — creatives tiled across the frame, segments played in order. For MultipleArt rows, where no single master fits.",
    },
    {
        id: "cheeky-dt",
        label: "Cheeky DT",
        categories: ["localise"],
        icon: Stamp,
        Component: CheekyDTTool,
        actions: ["Cheeky DT", "Territory Check"],
        description: "Select what you would like to update on the active Frontcard from its filename.",
    },
    {
        id: "artwork-check",
        label: "Artwork Check",
        categories: ["localise"],
        icon: FileSearch,
        Component: ArtworkCheckTool,
        actions: ["Check this deliverable", "Import"],
        // Read-only: it reads a sheet and reports. "Import" brings a file into
        // the project and is deliberately NOT listed as read, so nothing can
        // press it on somebody's behalf.
        actionSafety: { "Check this deliverable": "read" },
        description: "Which art edit this deliverable is supposed to use, read off the mech sheet in JPG_PNG — and whether that tiff is actually in the project.",
    },
    {
        id: "check",
        label: "Check",
        categories: ["localise"],
        icon: ClipboardCheck,
        Component: CheckTool,
        actions: ["Aspect Ratio Rename", "Effects Used", "Comp / Footage Details", "File Name Check", "Marker Comment Guide", "Render Check"],
        description: "A QC grab bag: aspect-ratio rename, effects-used report, comp/footage details, filename check, marker guide, and a render timecode checker.",
    },
    {
        id: "delivery-hub",
        label: "Deliver",
        categories: ["deliver"],
        icon: Truck,
        Component: DeliveryHubTool,
        actions: ["Delivery", "Set Frame Rate", "Load Selected Comps", "Queue"],
    },
    {
        id: "scale-composition",
        label: "Scale Composition",
        categories: ["tools"],
        icon: Expand,
        Component: ScaleCompositionTool,
        actions: ["Scale by Width", "Scale by Height", "Scale Composition (Width + Height)", "Scale by Factor", "Multi Comp Scale", "Scale Detect", "Scale by Name", "Scale Reset"],
        description: "Scales the active comp and every layer within it (including cameras) to fit a new size, keeping content proportional rather than stretching it.",
    },
    {
        id: "adjust",
        label: "Adjust",
        categories: ["tools"],
        icon: SlidersHorizontal,
        Component: AdjustTool,
        actions: ["Adjust Width", "Adjust Height", "Adjust Duration", "Adjust Frame Rate", "Adjust Aspect Ratio"],
        description: "Adjusts a single property of every selected composition directly, one field at a time.",
    },
    {
        id: "safe-generator",
        label: "Safe Generator",
        categories: ["tools"],
        icon: ShieldCheck,
        Component: SafeGeneratorTool,
        actions: ["Generate Safe", "Generate Full Safe"],
        description: "Draws safe-area guide overlays (a dimmed outer solid on an alpha-inverted matte) into the active comp.",
    },
    {
        id: "edit-tools",
        label: "Edit Tools",
        categories: ["tools"],
        icon: Wand2,
        Component: EditToolsTool,
        actions: ["Fuse Shots", "Snuggle Layers"],
        description: "Automatic shot fusing and layer snuggling on the active comp's layers.",
    },
    {
        id: "find-and-replace",
        label: "Find and Replace",
        categories: ["tools"],
        icon: Replace,
        Component: FindReplaceTool,
        actions: ["Replace String (Comps)", "Replace String (All Items)"],
        description: "Renames project items whose name contains the search string.",
    },
    {
        id: "master-of-nulls",
        label: "Master of Nulls",
        categories: ["tools"],
        icon: Target,
        Component: MasterOfNullsTool,
        actions: ["Master Null", "Master Selected Null", "Parental Guidance"],
        description: "Creates a 3D master control null and parents unparented layers to it, or reports on an existing parenting hierarchy.",
    },
    {
        id: "wall-tools",
        label: "Wall Tools",
        categories: ["tools"],
        icon: Grid3x3,
        Component: WallToolsTool,
        actions: ["Generate Wall", "Generate Wall Aspect Ratio", "Focal Organiser", "Wall Queue"],
        description: "Builds a video-wall grid of tiled comps, plus a focal/distance layer organiser.",
    },
    {
        id: "extreme-tools-01",
        label: "Extreme Tools 01",
        categories: ["tools"],
        icon: Expand,
        Component: ExtremeTools01Tool,
        actions: ["Landscape Extreme Generate", "Portrait Extreme Generate"],
        description: "Generates ultra-wide/tall \"extreme\" format comps from surround-panel counts, total size, and aspect-ratio limits.",
    },
    {
        id: "extreme-tools-02",
        label: "Extreme Tools 02",
        categories: ["tools"],
        icon: FileSpreadsheet,
        Component: ExtremeTools02Tool,
        actions: ["Adjust From CSV", "Build From CSV"],
        description: "CSV-driven builder/adjuster for the extreme formats.",
    },
    {
        id: "name-audit",
        label: "Naming Audit",
        categories: ["localise"],
        icon: ScanSearch,
        Component: NameAuditTool,
        actions: ["Audit a Masters root", "Audit a batch / AE folder"],
        description: "Checks a folder tree's filenames against the studio convention — what's on the new form, what's still on the old DGTL one, and what can't be parsed.",
    },
    {
        id: "batch-match",
        label: "Batch Match",
        categories: ["tools"],
        icon: Crosshair,
        Component: BatchMatchTool,
        actions: ["Capture from selection", "Preview changes"],
        description: "Copies a property value you've already got right onto the matching layer in every .aep in a folder — verbatim, offset, or scaled proportionally to each file's own comp/source size.",
    },
    {
        id: "edit-in-context",
        label: "Edit In Context",
        categories: ["tools"],
        icon: Layers,
        Component: EditInContextTool,
        actions: ["Find Parent Comp(s)", "Open Parent Alongside", "Read Selected Layer", "Apply to Layer"],
        description: "Edit a layer inside a precomp without leaving the comp you're in.",
    },
    {
        id: "los-tools",
        label: "LOS Tools",
        categories: ["tools"],
        icon: Repeat,
        Component: LOSToolsTool,
        actions: ["Apply CSV to Projects"],
        description: "Replaces a named target layer across every .aep in a project folder, from a CSV mapping matched by size token.",
    },
    {
        id: "master-tools",
        label: "Master Tools",
        categories: ["tools"],
        icon: Layers,
        Component: MasterToolsTool,
        actions: ["Auto AR", "Velocity Scaler", "Transform Apply - Scale", "Transform Apply - Position"],
        description: "Auto aspect-ratio rig, velocity scaler, one-click comp sizes, and transform-apply for scale/position.",
    },
    {
        id: "project-buttons",
        label: "Project Buttons",
        categories: ["tools"],
        icon: MousePointerClick,
        Component: ProjectButtonsTool,
        actions: ["Shape to Masks", "C4D Line Art", "Optimal Placement", "Detail-Preserving Scale", "Midcarder"],
        description: "Misc shortcut buttons: shape-to-mask conversion, Cinema 4D line-art import, optimal placement, and detail-preserving scale.",
    },
    {
        id: "timesheet-tracker",
        label: "Timesheet Tracker",
        categories: ["tools", "review"],
        icon: Clock,
        Component: TimesheetTrackerTool,
        actions: ["Generate JSON", "Copy to Clipboard", "New Batch", "Generate Batch JSON"],
        description: "Track time against a job, territory, and category. Quick mode logs one file; Batch mode auto-tracks time per file across a whole delivery batch and compiles one JSON at the end.",
    },
    {
        id: "useful-folders",
        label: "Useful Folders",
        categories: [],           // removed from all sidebars — lives in the HomeScreen flyout
        icon: FolderOpen,
        Component: UsefulFoldersTool,
        actions: ["Add Folder..."],
    },
    {
        id: "script-playground",
        label: "Script Playground",
        categories: ["tools"],
        icon: Terminal,
        Component: ScriptPlaygroundTool,
        actions: ["Run Script", "Clear Output"],
        description: "Run arbitrary ExtendScript directly in After Effects from a textarea.",
        // FILLABLE AFTER ALL, and the earlier refusal is kept here because the
        // reasoning behind it was wrong in a specific, reusable way.
        //
        // It ran: filling this textarea grants `runScript` through the front
        // end. It does not. The agent can already author arbitrary
        // ExtendScript — it does that in chat and the artist pastes it — so
        // filling the box adds no capability, it removes a clipboard
        // round-trip. What grants execution is the RUN button, and that is
        // still the artist's: "Run Script" is absent from actionSafety, so it
        // defaults to "write" and navigation.ts refuses to press it. None of
        // that changed.
        //
        // What was RIGHT in the objection is narrower, and is handled in the
        // receiver rather than here: a filled box reads as READY where a chat
        // message reads as a suggestion. So the tool fills only an untouched
        // box, never over the artist's own work, and says plainly that what is
        // in there was written by the agent and has not been run.
        //
        // Still no actionSafety: neither "Run Script" nor "Clear Output" is
        // agent-clickable. And "Save as Tool" stays out of reach — a saved
        // custom tool re-runs later on one click with nobody reading it, which
        // is a different and worse thing than a filled box.
        fillableFields: ["code"],
    },
    {
        id: "my-tools",
        label: "My Tools",
        categories: ["tools"],
        icon: LayoutList,
        Component: MyToolsTool,
        description: "Scripts you've saved from Script Playground as named tools -- run, edit, or delete them here.",
    },
    {
        id: "expressions-bank",
        label: "Expressions Bank",
        categories: ["tools"],
        icon: Code2,
        Component: ExpressionsBankTool,
        actions: ["Add", "Save", "Copy code", "Share to team library", "Group by Source", "Group by Tag"],
        description: "Save, search, and copy expressions the team uses often, sectioned into yours, the team's, and the built-ins. Click an entry to copy its code.",
    },
    {
        id: "comp-inspector",
        label: "Comp Inspector",
        categories: ["tools"],
        icon: Monitor,
        Component: CompInspectorTool,
        actions: ["Inspect Active Comp", "Refresh"],
        description: "Read-only report of the active comp's layers, effects, and key properties.",
    },
    {
        id: "render-queue-manager",
        label: "Render Queue Manager",
        categories: ["tools"],
        icon: ListVideo,
        Component: RenderQueueManagerTool,
        actions: ["Load Queue", "Refresh", "Clear All"],
        description: "View and manage the render queue. Toggle skip, remove individual items, or clear the whole queue.",
    },
    {
        id: "mask-separator",
        label: "Mask Separator",
        categories: ["tools"],
        icon: Scissors,
        Component: MaskSeparatorTool,
        actions: ["Separate Masks"],
        description: "Splits a layer with 2+ masks into one duplicate layer per mask (by Christopher R. Green, via aenhancers.com).",
    },
    {
        id: "darken",
        label: "Darken",
        categories: ["tools"],
        icon: Moon,
        Component: DarkenTool,
        actions: ["Generate Darkening Layer"],
        description: "Drops a black scrim behind the selected layer so a CTA, TT or midcard reads over busy artwork.",
    },
    {
        id: "replicator",
        label: "Replicator",
        categories: ["tools"],
        icon: Copy,
        Component: ReplicatorTool,
        actions: ["Copy"],
        description: "Recursively copies a source folder's contents into a destination folder, skipping files that already exist there.",
    },
    {
        id: "quick-fx",
        label: "Effects",
        categories: ["tools"],
        icon: Sparkles,
        Component: QuickFXTool,
        actions: [
            "Fast Box Blur", "Gaussian Blur", "Directional Blur", "Sharpen",
            "Linear Wipe", "Gradient Wipe", "Radial Wipe", "Venetian Blinds", "Block Dissolve",
            "Lumetri Color", "Curves", "Hue/Saturation", "Levels", "Tint", "Brightness & Contrast", "Exposure", "Vibrance",
            "Glow", "Drop Shadow",
            "Turbulent Displace",
        ],
        description: "One-click apply for a curated list of AE effects to the selected layer(s) -- a faster alternative to AE's own Effects & Presets search.",
    },
    // "ask" is deliberately NOT registered as a tool. It moved to a floating
    // panel mounted in main.tsx (AgentBubble.tsx) so it survives navigation --
    // as a tool page, opening a tool for the artist unmounted the tool doing
    // the opening and threw away the conversation. Registering it as well
    // would put a SECOND, separate instance on the Tools rail with its own
    // transcript, which is worse than not being in search at all: a floating
    // button on every screen is already about as discoverable as it gets.
    //
    // wrike-tasks entry intentionally removed -- unhooked, not deleted, see
    // CLAUDE.md's "Wrike Tasks (unhooked)" note.
];
