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
} from "lucide-react";

// --- Lazy tool imports --------------------------------------------------
const LocalisedLibraryTool  = React.lazy(() => import("./tools/LocalisedLibrary"));
const RandomLayersTool      = React.lazy(() => import("./tools/RandomLayers"));
const NameGeneratorTool     = React.lazy(() => import("./tools/NameGenerator"));
const CampaignLocaliserTool = React.lazy(() => import("./tools/CampaignLocaliser"));
const EditGeneratorTool     = React.lazy(() => import("./tools/EditGenerator"));
const GenerateCueSheetTool  = React.lazy(() => import("./tools/GenerateCueSheet"));
const CheekyDTTool          = React.lazy(() => import("./tools/CheekyDT"));

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
    "edit-generator":     () => import("./tools/EditGenerator"),
    "generate-cue-sheet": () => import("./tools/GenerateCueSheet"),
    "cheeky-dt":          () => import("./tools/CheekyDT"),
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
export const CATEGORY_COLORS: Record<string, { grad: string; border: string; glow: string; icon: string }> = {
    localise: { grad: "linear-gradient(135deg, #1c7a76 0%, #0f3d45 100%)", border: "#2dd4bf", glow: "rgba(45, 212, 191, 0.35)",  icon: "#5eead4" },
    review:   { grad: "linear-gradient(135deg, #6842b0 0%, #2e1a52 100%)", border: "#a78bfa", glow: "rgba(167, 139, 250, 0.35)", icon: "#c4b5fd" },
    deliver:  { grad: "linear-gradient(135deg, #b3661f 0%, #5c2f0e 100%)", border: "#fb923c", glow: "rgba(251, 146, 60, 0.35)",  icon: "#fdba74" },
    tools:    { grad: "linear-gradient(135deg, #ad2d67 0%, #4a1530 100%)", border: "#f472b6", glow: "rgba(244, 114, 182, 0.35)", icon: "#f9a8d4" },
};

export function categoryStyleVars(categoryId: string | undefined): React.CSSProperties {
    const c = CATEGORY_COLORS[categoryId || ""] || CATEGORY_COLORS.tools;
    return {
        "--cat-grad":   c.grad,
        "--cat-border": c.border,
        "--cat-glow":   c.glow,
        "--cat-icon":   c.icon,
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
    },
    {
        id: "campaign-localiser",
        label: "Campaign Localiser",
        categories: ["localise"],
        icon: Languages,
        Component: CampaignLocaliserTool,
        actions: ["Generate Files", "Generate Files (don't replace)", "Trott!", "Trott 2.0"],
        description: "",
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
        description: "Scans a folder of PDFs and writes a Campaign_Data.csv of matched master info — filename scan only, never opens a project.",
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
        id: "cheeky-dt",
        label: "Cheeky DT",
        categories: ["localise"],
        icon: Stamp,
        Component: CheekyDTTool,
        actions: ["Cheeky DT", "Territory Check"],
        description: "Select what you would like to update on the active Frontcard from its filename.",
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
        actions: ["Add", "Save", "Copy code"],
        description: "Save, search, and copy expressions the team uses often. Click an entry to copy its code.",
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
    // wrike-tasks entry intentionally removed -- unhooked, not deleted, see
    // CLAUDE.md's "Wrike Tasks (unhooked)" note.
];
