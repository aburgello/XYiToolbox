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
import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
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
    Maximize2,
    Truck,
    ArrowLeftRight,
    Tag,
    Type,
    Move,
    Sparkles,
    FileEdit,
    Globe,
    ToggleLeft,
    Timer,
    Ban,
} from "lucide-react";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import { sfx } from "../../lib/utils/sfx";
import Tooltip from "../Tooltip";
import StatusIcon from "../StatusIcon";
import Droplet from "../Droplet";
import { promptDialog, selectDialog } from "../Dialog";
import { iconWiggle, buttonLift } from "../animations";
import "../shared.scss";
import "./Toolset.scss";

export interface ActionResult {
    success: boolean;
    error?: string;
    savedFiles?: string[];
    message?: string;
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
type GroupId = "organise" | "qc" | "transform" | "naming";
const GROUPS: { id: GroupId; label: string }[] = [ 
    { id: "qc", label: "QC & Versioning" },
    { id: "organise", label: "Organise & Output" },
    { id: "naming", label: "Naming & Localise" },
    { id: "transform", label: "Layer & Transform" },
];

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
        id: "replicator",
        label: "Replicator",
        description: "Recursively copies a source folder's contents into a destination folder, skipping files that already exist there.",
        icon: Copy,
        group: "organise",
        run: () => evalTSSafe("replicator"),
        successText: (result) => result.message || "Copy complete.",
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
        icon: Sparkles,
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

interface Toast {
    id: number;
    text: string;
    type: "success" | "error";
}

const ToolsetTool = () => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastId = useRef(0);

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
    };

    // Flat running counter (not reset per group) so the cascade reads as
    // one continuous top-to-bottom/left-to-right wave across every group,
    // the same idea as the 4 category cards' index * delay stagger in
    // main.tsx -- just scaled down since there are ~20 buttons here
    // instead of 4 (0.06s/card there would take over a second to finish).
    let staggerIndex = 0;

    return (
        <div className="toolset-grid">
            <div className="toolset-panel">
                <h2>Toolset</h2>

                {GROUPS.map((group, groupIndex) => {
                    const groupActions = ACTIONS.filter((a) => a.group === group.id);
                    if (groupActions.length === 0) return null;
                    // One accent per group (not per button) -- reinforces which
                    // cluster a button belongs to at a glance, on top of the
                    // section label itself.
                    const accent = PALETTE[groupIndex % PALETTE.length];
                    return (
                        <div className="action-group" key={group.id}>
                            <div className="action-group-divider">
                                <h3 className="action-group-label">{group.label}</h3>
                            </div>
                            <div className="action-grid justify-center mx-auto">
                                {groupActions.map((action) => {
                                    const Icon = action.icon;
                                    const delay = staggerIndex * 0.025;
                                    staggerIndex++;
                                    const btnStyle = {
                                        "--btn-border": accent.border,
                                        "--btn-bg": accent.bg,
                                        "--btn-glow": accent.glow,
                                    } as React.CSSProperties;

                                    // Reused for both the plain click-runs-action path AND the two
                                    // droplet-triggering buttons below -- same look/animation either
                                    // way, only what onClick does (and an "active" class while a
                                    // droplet is open) differs.
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
                                            onClick={onClick}
                                        >
                                            <motion.span variants={iconWiggle} className="action-icon">
                                                <Icon size={16} />
                                            </motion.span>
                                            {action.label}
                                        </motion.button>
                                    );

                                    if (action.id === "toggle-by-label" || action.id === "comp-duration") {
                                        return (
                                            <Droplet
                                                key={action.id}
                                                panelClassName={action.id === "toggle-by-label" ? "droplet-swatches" : "droplet-duration"}
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
                                                    ) : (
                                                        <CompDurationDropletBody
                                                            close={close}
                                                            onResult={(r) => reportResult(r, action.successText)}
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
                })}
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
        </div>
    );
};

export default ToolsetTool;