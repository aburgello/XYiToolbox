// =============================================================================
// src/js/main/tools/Toolset.tsx
// -----------------------------------------------------------------------------
// Grid of one-click action tools -- the CEP equivalent of XYi_Toolbox.jsx's
// top button-grid. Anything that's genuinely just "click a button, it runs,
// you get told what happened" lives here instead of getting its own sidebar
// nav entry, so using them doesn't cost an extra click through a dedicated
// page. Tools that need real input fields (Random Layers, OV Library) stay
// as their own tools/*.tsx views -- this grid is only for the no-input ones.
//
// To add a new one-click tool here: add its aeft.ts function, then add one
// entry to ACTIONS below.
// =============================================================================
import React, { useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
    DndContext,
    DragOverlay,
    closestCorners,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    useSensor,
    useSensors,
    useDroppable,
    DragEndEvent,
    DragStartEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    RotateCw,
    RotateCcw,
    Save,
    PencilLine,
    X,
    FolderTree,
    CheckSquare,
    PanelTop,
    ZoomIn,
    Copy,
    CopyPlus,
    Maximize2,
    Truck,
    Film,
    ArrowLeftRight,
    Tag,
    Type,
    Move,
    Image as ImageIcon,
    FileEdit,
    Globe,
    ToggleLeft,
    Timer,
    Ban,
    Minus,
    Plus,
    Check,
    Search,
    Terminal,
    LayoutTemplate,
    Sparkles,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import { sfx } from "../../lib/utils/sfx";
import Tooltip from "../Tooltip";
import StatusIcon from "../StatusIcon";
import Droplet from "../Droplet";
import { promptDialog, selectDialog } from "../Dialog";
import { iconWiggle, buttonLift } from "../animations";
import { TOOLS } from "../toolRegistry";
import { useCustomTools, type CustomToolEntry } from "../hooks/useCustomTools";
import type { Screen } from "../main";
import turkGif from "../../assets/happy_shock_2.gif";
import "../shared.scss";
import "./Toolset.scss";

// Turk It celebrates crossing V03 -- reuses the exact overlay markup/CSS
// classes (.logo-easter-egg-overlay/-gif, main.scss) the logo click
// easter egg already established, rather than inventing a second
// full-panel-gif pattern for what's visually the same thing.
const TURK_IT_CELEBRATION_THRESHOLD = 3;

export interface ActionResult {
    success: boolean;
    error?: string;
    savedFiles?: string[];
    message?: string;
}

// Mirrors aeft/effects.ts's own QuickFxRecentEntry -- can't import that type
// directly (it's an ExtendScript file under a different tsconfig/module
// world than this one, same reason every cross-bridge call in this app goes
// through the loose `Scripts` catch-all type instead of per-function types).
interface QuickFxRecentEntry {
    id: string;
    label: string;
    matchName: string;
    category: string;
}

export interface ActionEntry {
    id: string;
    label: string;
    description: string;
    icon: React.ComponentType<{ size?: number }>;
    group: GroupId;
    // null means "the user cancelled a picker dialog before anything ran" --
    // distinct from a real success/failure, and distinct from `undefined`
    // (evalTSSafe's own "no bridge" sentinel) -- see runAction() below.
    run: () => Promise<ActionResult | null>;
    successText: (result: ActionResult) => string;
    // Optional override for the success sound. Defaults to the generic
    // sfx.success() (metallic ding) when omitted; set to "beep" for actions
    // that should use the synth beep instead.
    successSound?: "beep" | "ding";
}

// Small, fixed set of functional groups so 20+ one-click buttons read as a
// few scannable clusters instead of one flat wall -- deliberately just a
// labelled flex-wrap per group (no masonry/reflow logic) so short groups
// don't leave awkward gaps the way one giant grid did.
type GroupId = "organise" | "qc" | "transform" | "naming" | "custom";
const GROUPS: { id: GroupId; label: string }[] = [
    { id: "qc", label: "QC & Versioning" },
    { id: "organise", label: "Organise & Output" },
    { id: "naming", label: "Naming & Localise" },
    { id: "transform", label: "Layer & Transform" },
    { id: "custom", label: "Custom Tools" },
];

// A "pinned link" is a full-page tool (from toolRegistry.TOOLS) the user has
// added into the Toolset grid as a button via edit mode's "Add tool" search.
// Its id in the grid's flat order/group state is namespaced with this prefix
// so it can never collide with a real ACTIONS id, and so click/remove
// handling can tell "run this" apart from "navigate to this page" by id
// shape alone, with no extra lookup.
const LINK_PREFIX = "link:";
const linkId = (toolId: string): string => LINK_PREFIX + toolId;
const isLinkId = (id: string): boolean => id.indexOf(LINK_PREFIX) === 0;
const toolIdFromLink = (id: string): string => id.slice(LINK_PREFIX.length);

// A "custom button" is a script saved from Script Playground with kind
// "button" -- unlike a pinned link (an opt-in reference to an existing
// page), this IS user data with no default elsewhere, so it auto-appears
// (defaulting into the "custom" group) the moment it's saved, no separate
// pin step. Its minus badge still only hides/restores it here -- deleting
// the underlying script is only done from Script Playground's own list.
const CUSTOM_PREFIX = "custom:";
const customId = (toolId: string): string => CUSTOM_PREFIX + toolId;
const isCustomId = (id: string): boolean => id.indexOf(CUSTOM_PREFIX) === 0;
const toolIdFromCustom = (id: string): string => id.slice(CUSTOM_PREFIX.length);

// Builds the ActionEntry a "button"-kind custom tool resolves to -- shared
// with CommandPalette.tsx (which searches/runs custom button tools exactly
// like a real ACTIONS entry, group value unused there) so the "run a saved
// script through runScript and report its output" logic exists in one
// place, not duplicated per call site.
export function customButtonToAction(tool: CustomToolEntry, group: GroupId = "custom"): ActionEntry {
    return {
        id: customId(tool.id),
        label: tool.name,
        description: tool.description || `Custom script: ${tool.name}`,
        icon: Terminal,
        group,
        run: () => evalTSSafe("runScript", tool.code),
        successText: (r) => r.message ? `${tool.name}: ${r.message}` : `${tool.name} ran.`,
    };
}

// Placeholder for a toolset button whose logic hasn't been ported yet --
// shows up and behaves exactly like a real one (hover tooltip, click, toast)
// except the toast honestly says it's not wired up. Swap `stub(...)` for a
// real `run`/`successText` pair once that tool's aeft.ts logic lands -- the
// button itself, its position in the grid, and its icon don't need to change.
function stub(id: string, label: string, description: string, icon: React.ComponentType<{ size?: number }>, group: GroupId): ActionEntry {
    return {
        id,
        label,
        description,
        icon,
        group,
        run: async () => ({ success: false, error: "Not wired up yet -- logic coming soon." }),
        successText: () => "",
    };
}

// Same 0-16 label-color order AE's own Label Color preferences swatches
// use (0 = None) -- matches ToggleByLabel.jsx's original dropdown order.
const LABEL_COLORS = [
    "None", "Red", "Yellow", "Aqua", "Pink", "Lavender", "Peach", "Sea Foam",
    "Blue", "Green", "Purple", "Orange", "Brown", "Fuchsia", "Cyan", "Sand", "Dark Green",
];

// Approximate hex values for AE's own default Label Color swatches, index-
// matched to LABEL_COLORS (index 0/"None" has no color -- rendered as a
// Ban icon instead, see ToggleByLabelDropletBody). AE lets users
// customize these in preferences, so there's no single "true" value to
// query from here -- these are close enough to the well-known defaults
// for the swatch to be instantly recognizable, which is what matters for
// a quick visual pick.
const LABEL_SWATCH_COLORS = [
    "", "#e0433d", "#e6d848", "#a0e0d0", "#e8a0c8", "#b8a8e0", "#e8b888", "#98d8b8",
    "#5c9ce6", "#8cc86c", "#a878c8", "#e89050", "#a87858", "#d868a0", "#58c8d8", "#d8c8a0", "#588858",
];

// Exported so CommandPalette.tsx can search and run these one-click actions
// from anywhere in the app, not just from this grid -- each entry's `run()`
// is already fully self-contained (no dependency on this component's own
// state), so calling it from elsewhere needs no changes here.
export const ACTIONS: ActionEntry[] = [
    {
        id: "organise-folders",
        label: "Organise",
        description: "Arranges the currently open project's comps/footage into standard folders (Composition/PreComp/Main, Footage/MOVs/Artwork/Solids/PNG), then removes any that end up empty.",
        icon: FolderTree,
        group: "qc",
        run: () => evalTSSafe("organiseFolders"),
        successText: () => "Folders organised.",
    },
    {
        id: "cheeky-t-check",
        label: "Cheeky T",
        description: "Updates the active comp's Frontcard text layers (artwork type, version, territory check, date) from its filename. Requires a Frontcard-based project.",
        icon: CheckSquare,
        group: "qc",
        run: () => evalTSSafe("cheekyTCheck"),
        successText: () => "Frontcard text layers updated.",
    },
    {
        id: "frontcard",
        label: "Frontcard",
        description: "Imports the studio's brand Frontcard template and wraps the active comp in a new comp with it layered on top.",
        icon: PanelTop,
        group: "organise",
        run: () => evalTSSafe("frontcard"),
        successText: () => "Frontcard added.",
    },
    {
        id: "multi-comp-scale",
        label: "Multi Comp Scale",
        description: "Scales every selected layer's source pre-comp to match the active comp's current size, then resets that layer's own Scale to 100%.",
        icon: Copy,
        group: "organise",
        run: () => evalTSSafe("scaleCompositionMulti"),
        successText: () => "Selected pre-comps scaled to fit.",
    },
    {
        id: "true-comp-duplicator",
        label: "True Comp Duplicator",
        description: "Duplicates the selected composition(s) while keeping all layer references, effects, and expressions intact, recursing into nested pre-comps. Runs with defaults (suffix _DUP, include nested + update expressions on).",
        icon: CopyPlus,
        group: "organise",
        run: () => evalTSSafe("trueCompDuplicator", { suffix: "_DUP", includeNested: true, updateExpressions: true }),
        successText: (result) => result.message || "Comps duplicated.",
    },
    {
        id: "turk-it",
        label: "Turk It",
        description: "Bumps every comp's trailing \"_VNN\" version tag up by one, in the currently open project.",
        icon: RotateCw,
        group: "qc",
        run: () => evalTSSafe("turkIt", "up"),
        successText: () => "Turked it — versions bumped up.",
        successSound: "ding",
    },
    {
        id: "un-turk-it",
        label: "Un-Turk It",
        description: "Bumps every comp's trailing \"_VNN\" version tag down by one, in the currently open project.",
        icon: RotateCcw,
        group: "qc",
        run: () => evalTSSafe("turkIt", "down"),
        successText: () => "Un-turked it — versions bumped down.",
        successSound: "beep",
    },
    {
        id: "drqr",
        label: "DRQR",
        description: "Automatically scales small comps (under 500px = quad res, under 1000px = double res) up for a better preview.",
        icon: ZoomIn,
        group: "qc",
        run: () => evalTSSafe("drqr"),
        successText: () => "Comp scaled up for preview.",
    },
    {
        id: "scale-fit",
        label: "Scale Fit",
        description: "Adds a fit/fill-to-comp expression on each selected layer's Scale (toggle via the added \"Extreme\" checkbox effect).",
        icon: Maximize2,
        group: "transform",
        run: () => evalTSSafe("scaleFit"),
        successText: () => "Scale Fit applied.",
    },
    {
        id: "delivery",
        label: "Delivery",
        description: "Wraps each selected item in a new comp scaled to the size in its filename, trimmed to its work area, ready for delivery.",
        icon: Truck,
        group: "organise",
        run: () => evalTSSafe("delivery"),
        successText: () => "Delivery comp(s) created.",
    },
    {
        id: "render-me",
        label: "RenderMe!",
        description: "Finds this project's Renders folder (a sibling of AE in the market/territory root), creates a matching batch folder inside it, and queues the active comp with AE's default render settings, output redirected there -- plus a second queued row using the H264_16MBPS_MOS preset, output into a \"_mp4\" subfolder of that same batch folder.",
        icon: Film,
        group: "organise",
        run: () => evalTSSafe("renderMe"),
        successText: (r) => "Queued for render → " + (r.message || "Renders folder"),
    },
    {
        id: "rotate-90cc",
        label: "Rotate 90CC",
        description: "Wraps each selected item in a new comp with width/height swapped and rotated -90deg.",
        icon: RotateCcw,
        group: "transform",
        run: () => evalTSSafe("rotate90cc"),
        successText: () => "Rotated comp(s) created.",
    },
    {
        id: "swapper",
        label: "Swapper",
        description: "Replaces the one selected layer's source with whatever's selected in the Project panel, matching its visual width/anchor/position.",
        icon: ArrowLeftRight,
        group: "transform",
        run: () => evalTSSafe("swapper"),
        successText: () => "Layer source swapped.",
    },
    {
        id: "edit-markers",
        label: "Edit Markers",
        description: "Adds a transparent \"Edit_Points\" solid to the active comp with a marker at every layer's inPoint.",
        icon: Tag,
        group: "transform",
        run: () => evalTSSafe("editMarkers"),
        successText: () => "Edit markers added.",
    },
    {
        id: "make-textless",
        label: "Make Textless",
        description: "Recursively disables every layer labelled yellow (2) inside the first comp found in a \"Main\" folder.",
        icon: Type,
        group: "naming",
        run: () => evalTSSafe("makeTextless"),
        successText: () => "Textless pass complete.",
    },
    {
        id: "transform-apply",
        label: "Transform Apply",
        description: "Moves each selected layer's Transform properties onto a Transform effect instead, resetting the layer's own transform to default.",
        icon: Move,
        group: "transform",
        run: () => evalTSSafe("transformApply"),
        successText: () => "Transform moved to effect.",
    },
    {
        id: "save-from-comp",
        label: "Save From Comp",
        description: "Saves the currently open project to a new file per selected comp, named after that comp.",
        icon: Save,
        group: "organise",
        run: () => evalTSSafe("saveFromComp"),
        successText: (result) => `Saved: ${(result.savedFiles || []).join(", ")}`,
    },
    {
        id: "rename-main-comp",
        label: "Rename Main Comp",
        description: "Renames every comp inside a \"Main\" folder to match the project's own filename + version tag.",
        icon: PencilLine,
        group: "qc",
        run: () => evalTSSafe("renameMainComp"),
        successText: () => "Comps in \"Main\" renamed to match the project filename.",
    },
    {
        id: "mc-it",
        label: "MC It!",
        description: "Batch-replaces PNG footage across a folder of .aep files with the best-matching PNG (by resolution/number/filename similarity) from a second folder. Saves each file in place -- run this on your territory working copies, not on masters.",
        icon: ImageIcon,
        group: "naming",
        run: () => evalTSSafe("mcIt"),
        successText: (result) => result.message || "Done.",
    },
    {
        id: "campaign-rename",
        label: "Campaign Rename",
        description: "Matches PDFs to AE/render files by shared size (WxH) and renames the AE file to include the PDF's screen name/campaign tokens.",
        icon: FileEdit,
        group: "naming",
        run: () => evalTSSafe("campaignRename"),
        successText: (result) => result.message || "Done.",
    },
    {
        id: "loc-it",
        label: "Loc it",
        description: "Recursively sorts a source folder's .aep files into aspect-ratio subfolders in a destination folder (copy-only, skips duplicates).",
        icon: Globe,
        group: "naming",
        run: () => evalTSSafe("locIt"),
        successText: (result) => result.message || "Done.",
    },
    {
        id: "toggle-by-label",
        label: "Toggle By Label",
        description: "Pick a label color, then toggles enabled/disabled on every layer in the active comp with that label.",
        icon: ToggleLeft,
        group: "transform",
        run: async () => {
            const choice = await selectDialog("Toggle layers with which label color?", LABEL_COLORS, 2);
            if (choice === null) return null;
            return evalTSSafe("toggleLayersByLabel", choice);
        },
        successText: () => "Layers toggled.",
    },
    {
        id: "comp-duration",
        label: "Comp Duration",
        description: "Set the active comp's duration to a preset or a custom number of seconds.",
        icon: Timer,
        group: "transform",
        run: async () => {
            const presets = ["10s", "15s", "20s", "30s", "Custom…"];
            const choice = await selectDialog("Set comp duration to:", presets, 0);
            if (choice === null) return null;
            let seconds: number;
            if (choice === 4) {
                const val = await promptDialog("Duration in seconds:", "10");
                if (val === null) return null;
                seconds = parseFloat(val);
                if (isNaN(seconds) || seconds <= 0 || seconds > 10800) {
                    return { success: false, error: "Enter a valid number of seconds (up to 10800 / 3 hours)." };
                }
            } else {
                seconds = [10, 15, 20, 30][choice];
            }
            return evalTSSafe("setCompDuration", seconds);
        },
        successText: () => "Comp duration updated.",
    },
    {
        id: "quick-fx-recent",
        label: "Quick FX",
        description: "Re-apply one of your last 5 used effects to the selected layer(s) -- see the full Effects page (Tools) for the whole curated list.",
        icon: Sparkles,
        group: "transform",
        // Real logic lives in QuickFxRecentDropletBody -- this run() is
        // never actually called (the id is special-cased in the render
        // loop below to open a Droplet instead, same as toggle-by-label/
        // comp-duration), but every ActionEntry needs one so this action
        // is still resolvable/searchable (CommandPalette.tsx) like any
        // other -- selecting it there falls back to the modal-picker
        // convention documented in the Droplet.tsx CLAUDE.md section
        // (no anchored droplet position to reuse in a floating overlay).
        run: async () => {
            // evalTSSafe's ActionResult only declares success/error/message/
            // savedFiles/log by name -- everything else (like "effects" here)
            // comes back through its index signature as `unknown`, so it's
            // cast to what quickFxListRecentEffects actually returns, same
            // as "Turk It"'s own `(result as {maxVersion?}).maxVersion` read
            // above in runAction().
            const list = (await evalTSSafe("quickFxListRecentEffects")) as ActionResult & { effects?: QuickFxRecentEntry[] };
            if (!list.success || !list.effects || list.effects.length === 0) {
                return { success: false, error: "No recent effects yet -- apply one from the Effects page (Tools) first." };
            }
            const labels = list.effects.map((e) => e.label);
            const choice = await selectDialog("Re-apply which effect?", labels, 0);
            if (choice === null) return null;
            const fx = list.effects[choice];
            return evalTSSafe("applyEffectToSelectedLayers", fx.id, fx.matchName, fx.label, fx.category);
        },
        successText: (result) => result.message || "Effect applied.",
    },
    {
        id: "build-from-csv",
        label: "Build From CSV",
        description: "Pick a CSV of positioned/masked assets and build a single new comp from it (also on the Extreme Tools 02 page).",
        icon: LayoutTemplate,
        group: "organise",
        run: async () => {
            const val = await promptDialog("Duration in seconds:", "15");
            if (val === null) return null;
            const duration = parseFloat(val);
            if (isNaN(duration) || duration <= 0) {
                return { success: false, error: "Enter a valid duration in seconds." };
            }
            // page/art/tt are accepted by extBuildCompFromCsv but never read
            // inside it -- same dead-parameter quirk as the original toolbox
            // tab passing all 4 fields into buildCompFromCSV(); see
            // ExtremeTools02.tsx's own comment. The CSV file itself is
            // picked via a native dialog inside extBuildCompFromCsv, not
            // collected here.
            return evalTSSafe("extBuildCompFromCsv", duration, "", "", "");
        },
        successText: (result) => result.message || "Comp built from CSV.",
    },
];

// Rotating accent palette so 20+ one-click buttons don't all read as one
// flat grey wall -- purely cosmetic, cycles by index rather than meaning
// anything about the action. Kept separate from CATEGORY_COLORS in
// main.tsx since these buttons aren't tied to a category.
// Pre-blended values (not raw hex) because color-mix() isn't supported on
// this project's chrome74 build target -- see CLAUDE.md. bg/glow are
// computed once here instead of blended live in CSS.
const PALETTE: { border: string; bg: string; glow: string }[] = [
    { border: "#2dd4bf", bg: "#20403e", glow: "rgba(45, 212, 191, 0.35)" },
    { border: "#a78bfa", bg: "#352b4d", glow: "rgba(167, 139, 250, 0.35)" },
    { border: "#fb923c", bg: "#43301c", glow: "rgba(251, 146, 60, 0.35)" },
    { border: "#f472b6", bg: "#40263a", glow: "rgba(244, 114, 182, 0.35)" },
    { border: "#60a5fa", bg: "#233348", glow: "rgba(96, 165, 250, 0.35)" },
    { border: "#facc15", bg: "#403a1c", glow: "rgba(250, 204, 21, 0.35)" },
];



// Droplet content for "Toggle By Label" -- real color swatches instead of
// a text dropdown. Picking one closes the droplet immediately (optimistic,
// snappy) and reports through the same toast stack every other action
// already uses, via the `onResult` callback passed down from ToolsetTool.
const ToggleByLabelDropletBody: React.FC<{ close: () => void; onResult: (result: ActionResult | null | undefined) => void }> = ({
    close,
    onResult,
}) => (
    <>
        <p className="droplet-title">Toggle layers with this label</p>
        <div className="swatch-grid">
            {LABEL_COLORS.map((label, i) => (
                <Tooltip key={i} text={label} delay={300}>
                    <button
                        className={i === 0 ? "swatch-btn swatch-none" : "swatch-btn"}
                        style={{ "--swatch": LABEL_SWATCH_COLORS[i] } as React.CSSProperties}
                        onClick={async () => {
                            close();
                            onResult(await evalTSSafe("toggleLayersByLabel", i));
                        }}
                    >
                        {i === 0 ? <Ban size={13} /> : <span className="swatch-dot" />}
                    </button>
                </Tooltip>
            ))}
        </div>
    </>
);

// Droplet content for "Comp Duration…" -- preset chips + an inline
// "Custom…" toggle that reveals a small number field, rather than a
// second modal stacked on the first. Needs its own local state (which
// number field is showing, its value), so it has to be a real component,
// not inline logic in the render-prop callback -- calling hooks from a
// plain function invoked conditionally (only while the droplet is open)
// would violate the Rules of Hooks.
const CompDurationDropletBody: React.FC<{ close: () => void; onResult: (result: ActionResult | null | undefined) => void }> = ({
    close,
    onResult,
}) => {
    const [customOpen, setCustomOpen] = useState(false);
    const [customVal, setCustomVal] = useState("10");
    const presets = [10, 15, 20, 30];

    const run = async (seconds: number) => {
        close();
        onResult(await evalTSSafe("setCompDuration", seconds));
    };

    const applyCustom = () => {
        const seconds = parseFloat(customVal);
        if (isNaN(seconds) || seconds <= 0 || seconds > 10800) {
            close();
            onResult({ success: false, error: "Enter a valid number of seconds (up to 10800 / 3 hours)." });
            return;
        }
        run(seconds);
    };

    return (
        <>
            <p className="droplet-title">Set comp duration</p>
            <div className="duration-presets">
                {presets.map((p) => (
                    <button key={p} onClick={() => run(p)}>
                        {p}s
                    </button>
                ))}
            </div>
            {customOpen ? (
                <div className="duration-custom-row">
                    <input
                        type="number"
                        autoFocus
                        min={1}
                        max={10800}
                        value={customVal}
                        onChange={(e) => setCustomVal(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") applyCustom();
                        }}
                    />
                    <span>s</span>
                    <button className="duration-apply" onClick={applyCustom}>
                        Apply
                    </button>
                </div>
            ) : (
                <button className="duration-custom-toggle" onClick={() => setCustomOpen(true)}>
                    Custom…
                </button>
            )}
        </>
    );
};

// Droplet content for "Quick FX" -- fetches the last 5 distinct effects
// applied from either this button or the full Effects page (they share the
// same backend history, quickFxListRecentEffects/recordRecentEffect in
// aeft/effects.ts) and lets you re-apply one in a single click, no need to
// go find it again in the full curated list. Needs its own async load-on-
// open state, so -- same Rules of Hooks reasoning as CompDurationDropletBody
// above -- this has to be a real component, not inline render-prop logic.
const QuickFxRecentDropletBody: React.FC<{
    close: () => void;
    onResult: (result: ActionResult | null | undefined) => void;
    onNavigate?: (screen: Screen) => void;
}> = ({ close, onResult, onNavigate }) => {
    const [loading, setLoading] = useState(true);
    const [bridgeMissing, setBridgeMissing] = useState(false);
    const [effects, setEffects] = useState<QuickFxRecentEntry[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            // Same index-signature cast as the ACTIONS entry's own run()
            // above -- "effects" isn't one of evalTSSafe's own named
            // ActionResult fields.
            const result = (await evalTSSafe("quickFxListRecentEffects")) as ActionResult & { effects?: QuickFxRecentEntry[] };
            if (cancelled) return;
            if (result === undefined) setBridgeMissing(true);
            else if (result.success && result.effects) setEffects(result.effects);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []);

    const apply = async (fx: QuickFxRecentEntry) => {
        close();
        onResult(await evalTSSafe("applyEffectToSelectedLayers", fx.id, fx.matchName, fx.label, fx.category));
    };

    return (
        <>
            <p className="droplet-title">Quick FX — last used</p>
            {loading ? (
                <p className="hint">Loading…</p>
            ) : bridgeMissing ? (
                <p className="hint">No CEP bridge detected — open this panel inside After Effects to run it.</p>
            ) : effects.length === 0 ? (
                <>
                    <p className="hint">No recent effects yet.</p>
                    <button
                        type="button"
                        className="qfxr-open-page"
                        onClick={() => { close(); onNavigate?.({ type: "tool", toolId: "quick-fx", backTo: { type: "home" } }); }}
                    >
                        Open Effects page…
                    </button>
                </>
            ) : (
                <div className="qfxr-list">
                    {effects.map((fx) => (
                        <button key={fx.id} className="qfxr-item" onClick={() => apply(fx)}>
                            <Sparkles size={13} />
                            {fx.label}
                        </button>
                    ))}
                </div>
            )}
        </>
    );
};

// Droplet content for a group's "+ Add tool" tile -- search across every
// full-page tool in toolRegistry.TOOLS (not just the fixed one-click
// ACTIONS) and pin one into this group as a button that navigates to it.
// Own local search-query state, so -- same Rules of Hooks reasoning as
// CompDurationDropletBody above -- this has to be a real component.
const AddToolDropletBody: React.FC<{
    pinnedToolIds: Set<string>;
    onPick: (toolId: string) => void;
    close: () => void;
}> = ({ pinnedToolIds, onPick, close }) => {
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const results = TOOLS.filter((t) => !pinnedToolIds.has(t.id) && (q === "" || t.label.toLowerCase().indexOf(q) !== -1)).slice(0, 8);

    return (
        <>
            <p className="droplet-title">Add a tool to this group</p>
            <div className="add-tool-search">
                <Search size={12} />
                <input
                    type="text"
                    autoFocus
                    placeholder="Search tools…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>
            <div className="add-tool-results">
                {results.map((t) => {
                    const Icon = t.icon;
                    return (
                        <button
                            key={t.id}
                            className="add-tool-result"
                            onClick={() => { onPick(t.id); close(); }}
                        >
                            <Icon size={14} />
                            {t.label}
                        </button>
                    );
                })}
                {results.length === 0 && (
                    <p className="hint">{pinnedToolIds.size >= TOOLS.length ? "Every tool is already pinned somewhere." : "No tools match."}</p>
                )}
            </div>
        </>
    );
};

// =============================================================================
// Edit-mode sortable pieces -- MODULE SCOPE ON PURPOSE, not defined inside
// ToolsetTool. onDragStart sets `activeId` state (for the DragOverlay),
// which re-renders ToolsetTool; a component defined inside ToolsetTool's
// body gets a fresh function identity on every render, so React would
// unmount/remount every tile mid-drag and the drag would break. Kept at
// module scope so their identity is stable across those re-renders.
// =============================================================================
const SortableTile: React.FC<{
    action: ActionEntry;
    groupId: GroupId;
    isHidden: boolean;
    isLink: boolean;
    jiggle: boolean;
    btnStyle: React.CSSProperties;
    onToggleHidden: (id: string) => void;
}> = ({ action, groupId, isHidden, isLink, jiggle, btnStyle, onToggleHidden }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: action.id,
        data: { group: groupId },
    });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        // Dragged tile is hollowed out (its DragOverlay copy follows the
        // cursor instead) so it reads clearly as "in flight".
        opacity: isDragging ? 0.25 : 1,
    };
    const Icon = action.icon;
    return (
        <div
            ref={setNodeRef}
            style={style}
            className={"action-edit-item" + (isHidden ? " is-hidden" : "") + (jiggle ? " jiggle" : "")}
            {...attributes}
            {...listeners}
        >
            <div className="action-edit-face" style={btnStyle}>
                <span className="action-icon"><Icon size={16} /></span>
                {action.label}
                <button
                    type="button"
                    className={"action-hide-btn" + (isHidden ? " is-hidden" : "")}
                    title={isLink ? "Remove" : (isHidden ? "Restore" : "Hide")}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onToggleHidden(action.id); }}
                >
                    {isHidden ? <Plus size={14} /> : <Minus size={14} />}
                </button>
            </div>
        </div>
    );
};

const SortableGroup: React.FC<{
    groupId: GroupId;
    label: string;
    actions: ActionEntry[];
    btnStyle: React.CSSProperties;
    hiddenSet: Set<string>;
    linkIds: Set<string>;
    jiggle: boolean;
    onToggleHidden: (id: string) => void;
    onRename: (groupId: GroupId, label: string) => void;
    pinnedToolIds: Set<string>;
    onPinTool: (toolId: string, group: GroupId) => void;
}> = ({ groupId, label, actions, btnStyle, hiddenSet, linkIds, jiggle, onToggleHidden, onRename, pinnedToolIds, onPinTool }) => {
    // The whole group grid is a droppable, so a tile can be dropped onto a
    // group's empty space (not only onto another tile) -- this is what lets
    // an empty group still receive a drop.
    const { setNodeRef, isOver } = useDroppable({ id: "container:" + groupId, data: { group: groupId, container: true } });
    return (
        <div className="action-group">
            <div className="action-group-divider">
                <input
                    className="action-group-label-input"
                    value={label}
                    onChange={(e) => onRename(groupId, e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                    spellCheck={false}
                    aria-label="Group name"
                />
            </div>
            <SortableContext items={actions.map((a) => a.id)} strategy={rectSortingStrategy}>
                <div ref={setNodeRef} className={"action-grid editing justify-center mx-auto" + (isOver ? " drop-target" : "")}>
                    {actions.map((action) => (
                        <SortableTile
                            key={action.id}
                            action={action}
                            groupId={groupId}
                            isHidden={hiddenSet.has(action.id)}
                            isLink={linkIds.has(action.id)}
                            jiggle={jiggle}
                            btnStyle={btnStyle}
                            onToggleHidden={onToggleHidden}
                        />
                    ))}
                    {/* Outside the sortable item list on purpose -- this tile
                        isn't draggable/reorderable, it's a fixed "add" affordance
                        that always sits at the end of the group. */}
                    <Droplet
                        panelClassName="droplet-add-tool"
                        trigger={({ toggle }) => (
                            <Tooltip text="Add a tool to this group" delay={800}>
                                <button
                                    type="button"
                                    className="add-tool-tile"
                                    style={btnStyle}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => { e.stopPropagation(); toggle(); }}
                                >
                                    <Plus size={16} /> Add
                                </button>
                            </Tooltip>
                        )}
                    >
                        {(close) => (
                            <AddToolDropletBody
                                pinnedToolIds={pinnedToolIds}
                                onPick={(toolId) => onPinTool(toolId, groupId)}
                                close={close}
                            />
                        )}
                    </Droplet>
                </div>
            </SortableContext>
        </div>
    );
};

interface Toast {
    id: number;
    text: string;
    type: "success" | "error";
}

const ToolsetTool: React.FC<{ onNavigate?: (screen: Screen) => void }> = ({ onNavigate }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastId = useRef(0);
    const [showTurkGif, setShowTurkGif] = useState(false);
    const turkGifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const pushToast = (text: string, type: Toast["type"]) => {
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, text, type }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    };

    // Shared by the plain click-runs-run() path AND the two droplet-based
    // actions below, which call evalTSSafe directly (bypassing run()
    // entirely, since the droplet is its own picker UI) but still need the
    // exact same toast reporting once a result comes back.
    const reportResult = (result: ActionResult | null | undefined, successText: (r: ActionResult) => string, successSound?: "beep" | "ding") => {
        if (result === null) return; // user cancelled a picker -- nothing to report
        if (result === undefined) {
            pushToast("No CEP bridge detected — open this panel inside After Effects to run it.", "error");
            sfx.error();
            return;
        }
        pushToast(result.success ? successText(result) : result.error || "Something went wrong.", result.success ? "success" : "error");
        if (!result.success) { sfx.error(); return; }
        if (successSound === "beep") sfx.error(); // un-turk uses the beep
        else sfx.success(); // default: metallic ding
    };

    const runAction = async (action: ActionEntry) => {
        const result = await action.run();
        reportResult(result, action.successText, action.successSound);
        // Turk It reports the highest resulting version as maxVersion (see
        // aeft/tools.ts's turkIt) -- outside ActionResult's own strict
        // shape, hence the cast, same as any other cross-bridge extra
        // field this app reads opportunistically.
        if (action.id === "turk-it" && result && result.success) {
            const maxVersion = Number((result as { maxVersion?: number }).maxVersion);
            if (!isNaN(maxVersion) && maxVersion > TURK_IT_CELEBRATION_THRESHOLD) {
                if (turkGifTimer.current) clearTimeout(turkGifTimer.current);
                setShowTurkGif(true);
                turkGifTimer.current = setTimeout(() => setShowTurkGif(false), 3000);
            }
        }
    };

    // --- Personalisation (edit mode): hide, reorder, MOVE BETWEEN groups,
    // and RENAME groups ------------------------------------------------------
    // All per-machine via app.settings (shell.ts's load/save* for hidden /
    // order / groups / labels), same convention as favorites/tool-order.
    // Loads once on mount; silently no-ops on a missing bridge (browser
    // preview) -- an un-customised grid is a fine default.
    //   - hidden:        action ids the user hid.
    //   - order:         flat action-id order (within-group ordering derives
    //                    from filtering this by group, preserving position).
    //   - groupOverride: actionId -> groupId, once a tool has been dragged
    //                    into a different group than its ACTIONS default.
    //   - labelOverride: groupId -> renamed label.
    const prefersReducedMotion = useReducedMotion();
    const [editMode, setEditMode] = useState(false);
    const [hidden, setHidden] = useState<string[]>([]);
    const [order, setOrder] = useState<string[]>([]);
    const [groupOverride, setGroupOverride] = useState<Record<string, GroupId>>({});
    const [labelOverride, setLabelOverride] = useState<Record<string, string>>({});
    const [activeId, setActiveId] = useState<string | null>(null);
    // Full-page tools (toolRegistry.TOOLS ids, unprefixed) the user has
    // pinned into the grid via edit mode's "Add tool" search -- see
    // resolveEntry() below for how these become clickable, navigable tiles.
    const [pinned, setPinned] = useState<string[]>([]);
    // Scripts saved from Script Playground -- only "button"-kind ones are
    // relevant to this grid (see resolveEntry() below); "page"-kind ones
    // live exclusively in Script Playground's own "My Tools" list.
    const { customTools } = useCustomTools();

    useEffect(() => {
        (async () => {
            try {
                const h = await evalTS("loadHiddenToolsetActions" as any);
                if (Array.isArray(h)) setHidden(h as string[]);
                const o = await evalTS("loadToolsetOrder" as any);
                if (Array.isArray(o)) setOrder(o as string[]);
                const g = await evalTS("loadToolsetGroups" as any);
                if (Array.isArray(g)) {
                    const m: Record<string, GroupId> = {};
                    for (let i = 0; i + 1 < g.length; i += 2) m[g[i]] = g[i + 1] as GroupId;
                    setGroupOverride(m);
                }
                const l = await evalTS("loadToolsetLabels" as any);
                if (Array.isArray(l)) {
                    const m: Record<string, string> = {};
                    for (let i = 0; i + 1 < l.length; i += 2) m[l[i]] = l[i + 1];
                    setLabelOverride(m);
                }
                const p = await evalTS("loadPinnedToolsetLinks" as any);
                if (Array.isArray(p)) setPinned(p as string[]);
            } catch {
                /* no bridge (preview) -- defaults are correct */
            }
        })();
    }, []);

    // Escape leaves edit mode -- only wired while actually editing.
    useEffect(() => {
        if (!editMode) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditMode(false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [editMode]);

    const hiddenSet = new Set(hidden);
    const pinnedToolIds = new Set(pinned);
    const linkIds = new Set(pinned.map(linkId));
    const customButtonTools = customTools.filter((t) => t.kind === "button");

    const persistHidden = (next: string[]) => {
        setHidden(next);
        evalTS("saveHiddenToolsetActions" as any, next).catch(() => { /* preview */ });
    };
    // A pinned link's minus button removes it outright (unpin) rather than
    // hiding/restoring -- unlike a fixed ACTIONS entry, a link is user-added
    // data with no baked-in default to restore to, and re-adding it is one
    // Add-tool search away, so there's no state worth keeping around for a
    // "restore".
    const toggleHidden = (id: string) => {
        if (isLinkId(id)) { unpinLink(id); return; }
        persistHidden(hiddenSet.has(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);
    };

    // Effective group of an action/link/custom button: user override, else
    // its ACTIONS default, else "custom" for a custom button (its natural
    // home group), else "organise". A link has no ACTIONS default -- pinTool()
    // always sets its groupOverride at pin time, so it only ever falls
    // through to "organise" if that override somehow got dropped.
    const groupOf = (id: string): GroupId => {
        const o = groupOverride[id];
        if (o) return o;
        if (isCustomId(id)) return "custom";
        const a = ACTIONS.find((x) => x.id === id);
        return a ? a.group : "organise";
    };
    // Effective label of a group: user override, else the GROUPS default.
    const groupLabelOf = (gid: GroupId): string => {
        if (Object.prototype.hasOwnProperty.call(labelOverride, gid)) return labelOverride[gid];
        const g = GROUPS.find((x) => x.id === gid);
        return g ? g.label : gid;
    };

    // Resolves any grid id -- a real ACTIONS entry, a pinned link, or a
    // custom button -- to an ActionEntry-shaped object. A link's "run" just
    // navigates to the tool's own page and returns null (no toast, same as
    // a cancelled picker); a custom button's "run" replays its saved script
    // through the same generic runScript bridge Script Playground itself
    // uses, reporting its output/error exactly like any other action.
    const resolveEntry = (id: string): ActionEntry | null => {
        if (isLinkId(id)) {
            const toolId = toolIdFromLink(id);
            const tool = TOOLS.find((t) => t.id === toolId);
            if (!tool) return null;
            return {
                id,
                label: tool.label,
                description: tool.description || `Open ${tool.label}.`,
                icon: tool.icon,
                group: groupOf(id),
                run: async () => {
                    onNavigate?.({ type: "tool", toolId: tool.id, backTo: { type: "home" } });
                    return null;
                },
                successText: () => "",
            };
        }
        if (isCustomId(id)) {
            const toolId = toolIdFromCustom(id);
            const tool = customButtonTools.find((t) => t.id === toolId);
            return tool ? customButtonToAction(tool, groupOf(id)) : null;
        }
        return ACTIONS.find((x) => x.id === id) || null;
    };

    // The full flat id order (ACTIONS ids + pinned link ids + custom button
    // ids): the saved order, with any id not in it (a newly added grid
    // button, a link pinned just now, or a script just saved as a button)
    // appended at the end, so nothing silently vanishes -- same
    // merge-over-default rule as the category tool-order feature.
    const fullOrder = (): string[] => {
        const allIds = ACTIONS.map((a) => a.id).concat(pinned.map(linkId), customButtonTools.map((t) => customId(t.id)));
        const known = order.filter((id) => allIds.indexOf(id) !== -1);
        const missing = allIds.filter((id) => order.indexOf(id) === -1);
        return known.concat(missing);
    };

    // A group's actions = the flat order filtered to that (effective) group,
    // preserving flat-order position for within-group sequence.
    const orderedActionsForGroup = (groupId: GroupId): ActionEntry[] => {
        const ids = fullOrder().filter((id) => groupOf(id) === groupId);
        const out: ActionEntry[] = [];
        for (let i = 0; i < ids.length; i++) {
            const a = resolveEntry(ids[i]);
            if (a) out.push(a);
        }
        return out;
    };

    const commitLayout = (newOrder: string[], newGroups: Record<string, GroupId>) => {
        setOrder(newOrder);
        setGroupOverride(newGroups);
        evalTS("saveToolsetOrder" as any, newOrder).catch(() => { /* preview */ });
        const flatPairs: string[] = [];
        for (const id in newGroups) { if (Object.prototype.hasOwnProperty.call(newGroups, id)) flatPairs.push(id, newGroups[id]); }
        evalTS("saveToolsetGroups" as any, flatPairs).catch(() => { /* preview */ });
    };

    // Pin a full-page tool into a specific group as a new button, appended
    // at the end of the flat order (so it lands after that group's existing
    // tiles) -- called from the Add-tool droplet.
    const pinTool = (toolId: string, group: GroupId) => {
        if (pinnedToolIds.has(toolId)) return;
        const nextPinned = [...pinned, toolId];
        setPinned(nextPinned);
        evalTS("savePinnedToolsetLinks" as any, nextPinned).catch(() => { /* preview */ });
        const id = linkId(toolId);
        commitLayout(fullOrder().concat(id), { ...groupOverride, [id]: group });
    };

    // Fully remove a pinned link -- from the pinned list itself, and cleans
    // its now-meaningless order/group entries so they don't linger as dead
    // state (unlike hiding an ACTIONS entry, there's nothing to restore).
    const unpinLink = (id: string) => {
        const toolId = toolIdFromLink(id);
        const nextPinned = pinned.filter((t) => t !== toolId);
        setPinned(nextPinned);
        evalTS("savePinnedToolsetLinks" as any, nextPinned).catch(() => { /* preview */ });
        const nextGroups = { ...groupOverride };
        delete nextGroups[id];
        commitLayout(order.filter((x) => x !== id), nextGroups);
    };

    const setGroupLabel = (gid: GroupId, label: string) => {
        const next = { ...labelOverride, [gid]: label };
        setLabelOverride(next);
        const flatPairs: string[] = [];
        for (const k in next) { if (Object.prototype.hasOwnProperty.call(next, k)) flatPairs.push(k, next[k]); }
        evalTS("saveToolsetLabels" as any, flatPairs).catch(() => { /* preview */ });
    };

    // --- Sensors: mouse + touch + keyboard drag -----------------------------
    // PointerSensor doesn't reliably register press-and-hold inside AE's CEP
    // panel (pointer events there don't behave like a real browser tab) --
    // MouseSensor + TouchSensor cover the same mouse/touch input via the
    // older, more broadly-supported event types instead.
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

    // One DndContext spans every group, so a tile can be dropped either onto
    // another tile (insert at its position) OR onto a group's empty space
    // (append to that group) -- including a DIFFERENT group than it started
    // in, which is what makes cross-group moves work. Deliberately no
    // onDragOver live-preview: the dragged tile's DragOverlay copy follows
    // the cursor, the source gap closes on drop -- simpler and far more
    // robust than juggling cross-container state mid-gesture.
    const handleDragEnd = (event: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = event;
        if (!over) return;
        const draggedId = String(active.id);
        const overId = String(over.id);
        if (draggedId === overId) return;

        const isContainer = overId.indexOf("container:") === 0;
        const targetGroup: GroupId = isContainer ? (overId.slice("container:".length) as GroupId) : groupOf(overId);

        const flat = fullOrder();
        const without = flat.filter((id) => id !== draggedId);

        let insertIndex: number;
        if (isContainer) {
            // Empty space of a group: place after that group's last member.
            let lastIdx = -1;
            for (let i = 0; i < without.length; i++) {
                if (groupOf(without[i]) === targetGroup) lastIdx = i;
            }
            insertIndex = lastIdx === -1 ? without.length : lastIdx + 1;
        } else {
            insertIndex = without.indexOf(overId);
            if (insertIndex === -1) insertIndex = without.length;
        }

        const newOrder = without.slice(0, insertIndex).concat(draggedId, without.slice(insertIndex));

        const newGroups = { ...groupOverride };
        if (groupOf(draggedId) !== targetGroup) newGroups[draggedId] = targetGroup;

        commitLayout(newOrder, newGroups);
    };

    // Long-press (out of edit mode) enters edit mode -- the "keep pressing a
    // button until it shakes" gesture. The Edit/Done button in the header is
    // the discoverable equivalent for anyone who doesn't know the gesture.
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressed = useRef(false);
    const beginPress = () => {
        // Defensively clear any timer already running before arming a new
        // one -- if a PREVIOUS press's up/leave event never fired (see
        // below), its timer would otherwise still be ticking down
        // underneath this new press and could fire on top of it.
        if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
        longPressed.current = false;
        pressTimer.current = setTimeout(() => { longPressed.current = true; setEditMode(true); }, 500);
    };
    const endPress = () => {
        if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    };
    // Mouse handlers alongside the Pointer ones -- AE's CEP panel doesn't
    // reliably fire pointer/mouse UP or LEAVE events for a press-and-hold
    // (same root cause as the DndContext sensor swap above). That's not
    // just a redundancy concern: if endPress never runs, the 500ms timer
    // keeps ticking in the background after a normal quick click, and
    // fires on its own ~500ms later -- editing mode popping open with no
    // further input, "as if already holding down" from the click that
    // already completed. guardClick's own endPress() call below is the
    // real fix (a completed click is proof the press is over, regardless
    // of which up/leave events did or didn't fire); these handlers are
    // just the best-effort fast path when they DO fire.
    const pressProps = {
        onPointerDown: beginPress, onPointerUp: endPress, onPointerLeave: endPress, onPointerCancel: endPress,
        onMouseDown: beginPress, onMouseUp: endPress, onMouseLeave: endPress,
    };
    // Swallows the click that fires right after a long-press so entering edit
    // mode doesn't ALSO run the tool / open its droplet. Also always cancels
    // any pending long-press timer -- a click completing is the one signal
    // AE's CEP webview reliably delivers, so this is what actually stops a
    // stale timer from firing edit mode open after the fact (see pressProps'
    // own comment above for why the dedicated up/leave handlers alone
    // aren't enough here).
    const guardClick = (fn: () => void) => () => {
        endPress();
        if (longPressed.current) { longPressed.current = false; return; }
        fn();
    };

    // Flat running counter (not reset per group) so the cascade reads as
    // one continuous top-to-bottom/left-to-right wave across every group,
    // the same idea as the 4 category cards' index * delay stagger in
    // main.tsx -- just scaled down since there are ~20 buttons here
    // instead of 4 (0.06s/card there would take over a second to finish).
    let staggerIndex = 0;

    // The tile currently being dragged (for the DragOverlay copy that follows
    // the cursor across groups). Styled with its CURRENT group's accent.
    const activeAction = activeId ? resolveEntry(activeId) : null;
    const activeGroupIdx = activeAction ? GROUPS.findIndex((g) => g.id === groupOf(activeAction.id)) : -1;
    const overlayAccent = PALETTE[(activeGroupIdx < 0 ? 0 : activeGroupIdx) % PALETTE.length];
    const overlayStyle = {
        "--btn-border": overlayAccent.border,
        "--btn-bg": overlayAccent.bg,
        "--btn-glow": overlayAccent.glow,
    } as React.CSSProperties;

    return (
        <div className={editMode ? "toolset-grid editing" : "toolset-grid"}>
            <div className="toolset-panel">
                <h2>Toolset</h2>
                {/* No Edit affordance in normal mode -- long-press a tile to
                    enter edit mode. Done bar only exists WHILE editing, so the
                    resting grid has zero extra chrome. */}
                {editMode && (
                    <div className="toolset-editbar">
                        <p className="toolset-edit-hint">Drag to reorder within a group · tap − to hide, + to restore.</p>
                        <button className="toolset-done-btn" onClick={() => setEditMode(false)}>
                            <Check size={13} /> Done
                        </button>
                    </div>
                )}

                {editMode ? (
                    // Edit mode: ONE DndContext over every group, so a tile can
                    // be dragged within its group OR into a different group.
                    // rectSortingStrategy is grid-aware (handles wrapped rows);
                    // each SortableGroup is also a droppable so empty-space drops
                    // land in the right group. DragOverlay renders the in-flight
                    // copy that follows the cursor.
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCorners}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        {GROUPS.map((group, groupIndex) => {
                            const accent = PALETTE[groupIndex % PALETTE.length];
                            const btnStyle = {
                                "--btn-border": accent.border,
                                "--btn-bg": accent.bg,
                                "--btn-glow": accent.glow,
                            } as React.CSSProperties;
                            return (
                                <SortableGroup
                                    key={group.id}
                                    groupId={group.id}
                                    label={groupLabelOf(group.id)}
                                    actions={orderedActionsForGroup(group.id)}
                                    btnStyle={btnStyle}
                                    hiddenSet={hiddenSet}
                                    linkIds={linkIds}
                                    jiggle={!prefersReducedMotion}
                                    onToggleHidden={toggleHidden}
                                    onRename={setGroupLabel}
                                    pinnedToolIds={pinnedToolIds}
                                    onPinTool={pinTool}
                                />
                            );
                        })}
                        <DragOverlay>
                            {activeAction ? (
                                <div className="action-edit-face action-edit-overlay" style={overlayStyle}>
                                    <span className="action-icon"><activeAction.icon size={16} /></span>
                                    {activeAction.label}
                                </div>
                            ) : null}
                        </DragOverlay>
                    </DndContext>
                ) : (
                    GROUPS.map((group, groupIndex) => {
                    const groupActions = orderedActionsForGroup(group.id);
                    // Normal mode hides hidden actions outright.
                    const visibleActions = groupActions.filter((a) => !hiddenSet.has(a.id));
                    if (visibleActions.length === 0) return null;
                    // One accent per group (not per button) -- reinforces which
                    // cluster a button belongs to at a glance, on top of the
                    // section label itself.
                    const accent = PALETTE[groupIndex % PALETTE.length];
                    const btnStyle = {
                        "--btn-border": accent.border,
                        "--btn-bg": accent.bg,
                        "--btn-glow": accent.glow,
                    } as React.CSSProperties;

                    return (
                        // btnStyle (the --btn-* accent vars) sits on the group
                        // wrapper so it inherits down to BOTH the buttons AND
                        // the group label -- the label's coloured dot (::before
                        // in the scss) reads --btn-border from here.
                        <div className="action-group" key={group.id} style={btnStyle}>
                            <div className="action-group-divider">
                                <h3 className="action-group-label">{groupLabelOf(group.id)}</h3>
                            </div>
                            <div className="action-grid justify-center mx-auto">
                                {visibleActions.map((action) => {
                                    const Icon = action.icon;
                                    const delay = staggerIndex * 0.025;
                                    staggerIndex++;

                                    // Reused for both the plain click-runs-action path AND the two
                                    // droplet-triggering buttons below -- same look/animation either
                                    // way, only what onClick does (and an "active" class while a
                                    // droplet is open) differs. pressProps/guardClick add the
                                    // long-press-to-enter-edit-mode gesture without changing a
                                    // normal tap.
                                    const renderButton = (onClick: () => void, active?: boolean) => (
                                        <motion.button
                                            style={btnStyle}
                                            className={active ? "active" : undefined}
                                            variants={buttonLift}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ type: "spring", stiffness: 300, damping: 24, delay }}
                                            whileHover="hover"
                                            whileTap={{ scale: 0.95 }}
                                            {...pressProps}
                                            onClick={guardClick(onClick)}
                                        >
                                            <motion.span variants={iconWiggle} className="action-icon">
                                                <Icon size={16} />
                                            </motion.span>
                                            {action.label}
                                        </motion.button>
                                    );

                                    if (action.id === "toggle-by-label" || action.id === "comp-duration" || action.id === "quick-fx-recent") {
                                        const panelClassName =
                                            action.id === "toggle-by-label" ? "droplet-swatches" :
                                            action.id === "comp-duration" ? "droplet-duration" :
                                            "droplet-quick-fx";
                                        return (
                                            <Droplet
                                                key={action.id}
                                                panelClassName={panelClassName}
                                                trigger={({ open, toggle }) => (
                                                    <Tooltip text={action.description} delay={1500}>
                                                        {renderButton(toggle, open)}
                                                    </Tooltip>
                                                )}
                                            >
                                                {(close) =>
                                                    action.id === "toggle-by-label" ? (
                                                        <ToggleByLabelDropletBody
                                                            close={close}
                                                            onResult={(r) => reportResult(r, action.successText)}
                                                        />
                                                    ) : action.id === "comp-duration" ? (
                                                        <CompDurationDropletBody
                                                            close={close}
                                                            onResult={(r) => reportResult(r, action.successText)}
                                                        />
                                                    ) : (
                                                        <QuickFxRecentDropletBody
                                                            close={close}
                                                            onResult={(r) => reportResult(r, action.successText)}
                                                            onNavigate={onNavigate}
                                                        />
                                                    )
                                                }
                                            </Droplet>
                                        );
                                    }

                                    return (
                                        <Tooltip key={action.id} text={action.description} delay={1500}>
                                            {renderButton(() => runAction(action))}
                                        </Tooltip>
                                    );
                                })}
                            </div>
                        </div>
                    );
                    })
                )}
            </div>

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

            {/* Turk It celebration -- same full-panel overlay pattern/CSS
                classes as the logo click easter egg (main.scss). Click
                dismisses early; otherwise auto-hides after 3s. */}
            <AnimatePresence>
                {showTurkGif && (
                    <motion.div
                        className="logo-easter-egg-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        onClick={() => setShowTurkGif(false)}
                    >
                        <motion.img
                            src={turkGif}
                            alt=""
                            className="logo-easter-egg-gif"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 22 }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ToolsetTool;