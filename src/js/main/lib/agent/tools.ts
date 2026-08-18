// =============================================================================
// src/js/main/lib/agent/tools.ts
// -----------------------------------------------------------------------------
// THE THREE READ-ONLY TOOLS the agent may call, and the dispatcher that runs
// them. Nothing here writes, opens, saves, builds, or queues anything -- see
// CLAUDE.md §1 for why that boundary is the whole point.
//
// `runScript` is deliberately absent and must stay absent. It is a bare eval
// over the bridge, so an agent holding it could do anything at all, including
// the exact thing the masters rule exists to prevent.
//
// TWO BACKEND SHAPES, NOT ONE. CLAUDE.md §2 says every function returns
// {success, error} -- but only bespokeListMasters actually does. loadCampaigns
// and scanAllRenders return BARE ARRAYS, and `undefined` from either means the
// bridge didn't answer. That is "couldn't ask", never "there are none", and
// collapsing the two is how the model ends up confidently telling an artist
// their campaign is empty when the share is simply unmounted. Every branch
// below normalises to one shape so the model can't make that mistake.
//
// FLAT SCALAR ARGUMENTS ONLY. Arguments are JSON.stringify'd and spliced into
// eval'd ExtendScript source; nested arrays-of-objects lose their values in
// transit (CLAUDE.md §2). Keep every input_schema one level deep.
// =============================================================================
import { evalTS } from "../../../lib/utils/bolt";
import { setPendingFill, takePendingFill } from "./fieldHandoff";
import { navigateToTool } from "./navigation";
// The registry is the single source of truth for what may be filled;
// capabilities.ts reads the same list to tell the model the field ids.
import { TOOLS as PANEL_TOOLS } from "../../toolRegistry";
import {
    fetchJobs,
    parseJobTitle,
    jobReadiness,
    LOCALISABLE_STATUSES,
    FINISHED_STATUSES,
    type WrikeJob,
} from "../jobsFeed";
import { loadJobRows, classifyRows, stageBatchFromJob } from "../jobRows";
import { ACTIONS } from "../../tools/Toolset";

export interface ToolDef {
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: Record<string, {
            type: string;
            /** Optional when `enum` already says what the values are. */
            description?: string;
            /**
             * The allowed values, when there is a closed set of them.
             *
             * CHEAPER AND SAFER THAN PROSE. Spelling the options out in a
             * description costs more tokens on every call and still lets the
             * model invent a sixth one; an enum is shorter and the API rejects
             * anything outside it. Prefer it wherever the set is fixed.
             */
            enum?: string[];
            /**
             * A value-type for an object argument, i.e. one level of nesting.
             *
             * THE FLAT-SCALAR RULE AT THE TOP OF THIS FILE IS A BRIDGE RULE.
             * It exists because arguments are JSON.stringify'd and spliced into
             * eval'd ExtendScript source, where nested arrays-of-objects lose
             * their values in transit. A tool whose input never reaches
             * ExtendScript is not subject to it: fill_fields stages values in a
             * frontend module and navigates, and nothing it receives is ever
             * marshalled across evalTS.
             *
             * So: allowed, and only for tools that stay panel-side. If a tool
             * taking one of these ever grows a bridge call, its argument has to
             * become a JSON string first (CLAUDE.md §2).
             */
            additionalProperties?: { type: string };
        }>;
        required: string[];
    };
}

export type ToolResult =
    | { ok: true; data: unknown }
    | { ok: false; reason: string };

// --- Definitions --------------------------------------------------------
//
// Descriptions state WHEN to call and WHAT the argument must be, not just what
// the tool does. The single most likely first-run failure is the model passing
// a campaign NAME where a masters-root PATH is required, and the description is
// where that gets prevented -- no amount of system-prompt text fixes a tool
// whose contract is vague.

export const TOOLS: ToolDef[] = [
    {
        name: "list_campaigns",
        description:
            "List the campaigns available in OV Library, with the masters root folder path for each. " +
            "Call this FIRST whenever the user names a campaign, to resolve that name to its masters root. " +
            "Takes no arguments.",
        input_schema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "list_masters",
        description:
            "List every master .aep in a campaign's masters root, with each master's filename, creative, " +
            "pixel size and duration. Requires the mastersRoot PATH from list_campaigns — it will not " +
            "accept a campaign name.",
        input_schema: {
            type: "object",
            properties: {
                mastersRoot: {
                    type: "string",
                    description:
                        "Absolute path to the campaign's masters root, exactly as returned by list_campaigns.",
                },
            },
            required: ["mastersRoot"],
        },
    },
    {
        name: "list_active_jobs",
        description:
            "The artist's current Wrike jobs — the same feed behind the Active Jobs card on the home " +
            "screen. Returns each job's film, territory, batch, status, whether it is ready to " +
            "localise, and how many subtasks (deliverables) it has. Use this for 'what's on my plate', " +
            "'what can I localise', 'what's waiting'. Takes no arguments.",
        input_schema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "job_subtasks",
        description:
            "The deliverables inside one job, with each one's workflow status and whether that status " +
            "means it can be localised now. Subtask names are deliverable filenames in the studio " +
            "convention. Get the jobId from list_active_jobs first.",
        input_schema: {
            type: "object",
            properties: {
                jobId: {
                    type: "string",
                    description: "The job's id, exactly as returned by list_active_jobs.",
                },
            },
            required: ["jobId"],
        },
    },
    {
        name: "run_action",
        description:
            "Run one of the panel's one-click Toolset actions against the artist's open After Effects " +
            "project — scaling, rotating, organising, renaming comps, applying effects and so on. " +
            "Only actions listed under RUNNABLE ACTIONS can be run: those change nothing, change the " +
            "open project in a way Ctrl+Z reverses, or create new files without touching existing " +
            "ones. Anything that modifies or renames files already on disk is refused. Most act on " +
            "the ACTIVE COMP or the CURRENT SELECTION, so say what the artist needs selected if it " +
            "matters.",
        input_schema: {
            type: "object",
            properties: {
                actionId: {
                    type: "string",
                    description:
                        "The action's id from the RUNNABLE ACTIONS list, e.g. 'rotate-90cc'. " +
                        "Lower-case with hyphens, not the display label.",
                },
            },
            required: ["actionId"],
        },
    },
    {
        name: "prefill_batch",
        description:
            "Turn a Wrike job's deliverables into rows in Big Guy Localiser's batch builder, and open " +
            "it with those rows filled in. This FILLS A FORM — it generates nothing, writes no files " +
            "and touches no project. The artist reviews the rows and presses the run button " +
            "themselves. Deliverables whose names do not carry a campaign, size and duration are left " +
            "out, and reported back so you can say which and why.",
        input_schema: {
            type: "object",
            properties: {
                jobId: {
                    type: "string",
                    description: "The job's id, exactly as returned by list_active_jobs.",
                },
            },
            required: ["jobId"],
        },
    },
    {
        name: "open_tool",
        description:
            "Open one of the panel's tools so the artist lands on the right page. Use this when the " +
            "request needs a tool you cannot run yourself — you open the page, then tell them which " +
            "button to press. This only changes what is on screen; it does not press anything, run " +
            "anything, or change any file. Use the tool's registry id from the PANEL TOOLS list.",
        input_schema: {
            type: "object",
            properties: {
                toolId: {
                    type: "string",
                    description:
                        "The tool's registry id, e.g. 'campaign-localiser' or 'name-audit'. Ids are " +
                        "lower-case with hyphens, not the display label.",
                },
                action: {
                    type: "string",
                    description:
                        "Optional. A button to press once the tool opens — only buttons marked " +
                        "[pressable] in the PANEL TOOLS list. Anything that generates, saves or " +
                        "renders is refused; open the tool and ask the artist to press it instead.",
                },
            },
            required: ["toolId"],
        },
    },
    {
        name: "create_comp",
        description:
            "Create a new empty composition in the artist's open After Effects project. Undoable with " +
            "one Ctrl+Z and touches nothing on disk — it adds a comp to the project panel and nothing " +
            "else. It does not open or select the comp. Say what you made and that one undo reverses " +
            "it. If the artist has not said a frame rate or duration, ask rather than assuming: 25fps " +
            "is this studio's usual but a wrong comp is still a wrong comp.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "The comp's name, as it will appear in the project panel." },
                width: { type: "number", description: "Width in pixels." },
                height: { type: "number", description: "Height in pixels." },
                frameRate: { type: "number", description: "Frames per second, e.g. 25." },
                seconds: { type: "number", description: "Duration in seconds." },
            },
            required: ["name", "width", "height", "frameRate", "seconds"],
        },
    },
    {
        name: "precompose_selected",
        description:
            "Precompose the layers the artist has selected in the comp they have open. Undoable with " +
            "one Ctrl+Z. Attributes move into the new comp by default, which is also the only option " +
            "when more than one layer is selected. If nothing is selected you are told so — say that " +
            "rather than guessing which layers were meant.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name for the new precomp." },
                moveAllAttributes: {
                    type: "boolean",
                    description:
                        "Move attributes into the precomp. Defaults true. Only honoured for a single " +
                        "layer — with several it is forced true and reported back.",
                },
                targetKind: {
                    type: "string",
                    description:
                        "Which layers: 'selected' (default), 'name', 'index' or 'label'. Use " +
                        "list_layers to see what is in the comp.",
                },
                targetValue: {
                    type: "string",
                    description:
                        "The layer name, the 1-based index, or the label number — whichever targetKind " +
                        "says. Leave out for 'selected'.",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "add_solid",
        description:
            "Add a solid layer to the comp the artist has open. Comp-sized unless a width and height " +
            "are given. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name for the solid." },
                hexColour: { type: "string", description: "Colour as hex, e.g. #1A1A1A." },
                width: { type: "number", description: "Optional. Defaults to the comp's width." },
                height: { type: "number", description: "Optional. Defaults to the comp's height." },
            },
            required: ["name", "hexColour"],
        },
    },
    {
        name: "add_text_layer",
        description:
            "Add a text layer to the comp the artist has open. Font size and colour are optional; the " +
            "FONT FAMILY cannot be set, because After Effects substitutes a missing font silently and " +
            "the wrong typeface would ship looking fine — say so if they ask for a specific font, and " +
            "tell them to set it in the character panel. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                text: { type: "string", description: "The text to put in the layer." },
                fontSize: { type: "number", description: "Optional point size." },
                hexColour: { type: "string", description: "Optional fill colour as hex, e.g. #FFFFFF." },
            },
            required: ["text"],
        },
    },
    {
        name: "animate_layers",
        // TERSE ON PURPOSE. Every behavioural steer this used to carry -- use
        // `relative` for moves, `stagger` for "one after another", reach for a
        // studio ease preset afterwards, say what you made -- is already in the
        // system prompt's ANIMATING SOMETHING section. Saying it twice cost 643
        // tokens on EVERY model call, making this 10% of the whole tool surface,
        // to repeat advice the model read two thousand tokens earlier.
        //
        // The division that survives: WHEN to reach for a tool belongs in the
        // prompt, where it is prose and read once. WHAT its arguments mean
        // belongs here. Enums do both jobs at once -- shorter than describing
        // the allowed values, and the model cannot invent one.
        description:
            "Animate a transform property on the targeted layers: two keyframes, from `from` " +
            "(default: its current value) to `to`. Leaves the new keys selected, ready for " +
            "apply_ease_preset. Refuses if the property is already animated. One Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                property: { type: "string", enum: ["position", "scale", "rotation", "opacity", "anchor"] },
                to: {
                    type: "string",
                    description:
                        "End value as JSON: a number ('100'), or an array ('[960,540]'). A short " +
                        "array keeps the property's remaining dimensions.",
                },
                from: { type: "string", description: "Start value, same shape. Omitted = start where it is." },
                startSeconds: { type: "number", description: "First keyframe, in seconds. Default 0." },
                durationSeconds: { type: "number", description: "Length of the move, in seconds." },
                relative: {
                    type: "boolean",
                    description: "Read from/to as offsets from the current value — 'slide up 200', 'scale up 20%'.",
                },
                stagger: { type: "number", description: "Seconds between each layer's start. Default 0, together." },
                ease: { type: "string", enum: ["none", "in", "out", "both"], description: "Stock Easy Ease. Default none." },
                replaceExisting: {
                    type: "boolean",
                    description: "Destroys keyframes already on the property. Only if the artist said to.",
                },
                targetKind: { type: "string", enum: ["selected", "name", "index", "label"], description: "Default selected." },
                targetValue: { type: "string", description: "Layer name, 1-based index, or label number." },
            },
            required: ["property", "to", "durationSeconds"],
        },
    },
    {
        name: "add_shape_layer",
        description:
            "Add a shape layer to the comp the artist has open — empty, or with one rectangle or " +
            "ellipse in it. Defaults to half the comp's size and white. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Optional name for the layer." },
                shape: {
                    type: "string",
                    description: "'rectangle', 'ellipse', or 'none' for an empty shape layer. Defaults to none.",
                },
                width: { type: "number", description: "Optional. Defaults to half the comp width." },
                height: { type: "number", description: "Optional. Defaults to half the comp height." },
                hexColour: { type: "string", description: "Optional fill colour as hex. Defaults to white." },
            },
            required: [],
        },
    },
    {
        name: "align_layers",
        description:
            "Align the selected layers, using the panel's own XYTools align — the same thing its " +
            "buttons do. Edges: left, hcenter, right, top, vcenter, bottom. Align to the composition " +
            "(default) or to the selection. 'Centre this' means hcenter and vcenter relative to the " +
            "comp; 'centre these to each other' means relativeTo: selection, which needs 2+ layers. " +
            "Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                edge: {
                    type: "string",
                    description: "left, hcenter, right, top, vcenter or bottom. hcenter+vcenter is dead centre.",
                },
                relativeTo: {
                    type: "string",
                    description: "'comp' (default) or 'selection'. 'selection' needs at least 2 layers.",
                },
            },
            required: ["edge"],
        },
    },
    {
        name: "distribute_layers",
        description:
            "Space the selected layers evenly along an axis, using XYTools distribute. Undoable with " +
            "one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: { axis: { type: "string", description: "'horizontal' or 'vertical'." } },
            required: ["axis"],
        },
    },
    {
        name: "fit_layers",
        description:
            "Scale the selected layers to the comp, using XYTools fit. 'contain' fits inside, 'cover' " +
            "fills and crops, 'stretch' distorts to fill exactly. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: { mode: { type: "string", description: "'contain', 'cover' or 'stretch'." } },
            required: ["mode"],
        },
    },
    {
        name: "flip_layers",
        description: "Flip the selected layers on an axis, using XYTools. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: { axis: { type: "string", description: "'horizontal' or 'vertical'." } },
            required: ["axis"],
        },
    },
    {
        name: "sequence_layers",
        description:
            "Offset the selected layers in time so they start one after another, using XYTools " +
            "sequence. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                frames: { type: "number", description: "Frames between each layer's start." },
                reverse: { type: "boolean", description: "Sequence in reverse selection order. Defaults false." },
            },
            required: ["frames"],
        },
    },
    {
        name: "fade_layers",
        description:
            "Add opacity fades to the selected layers, using XYTools fade. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                mode: { type: "string", description: "'in', 'out' or 'both'." },
                frames: { type: "number", description: "Length of the fade in frames." },
                atEdges: {
                    type: "boolean",
                    description: "Fade at each layer's own in/out points rather than the comp's. Defaults false.",
                },
            },
            required: ["mode", "frames"],
        },
    },
    {
        name: "set_anchor",
        description:
            "Move the anchor point of the selected layers to a position within their own bounds, " +
            "using XYTools. 0,0 is top-left, 1,1 is bottom-right, 0.5,0.5 is the centre — which is " +
            "what 'centre the anchor point' means. The layer does not move. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                relX: { type: "number", description: "0 to 1 across the layer. 0.5 is centre." },
                relY: { type: "number", description: "0 to 1 down the layer. 0.5 is centre." },
            },
            required: ["relX", "relY"],
        },
    },
    {
        name: "list_ease_presets",
        description:
            "The studio's saved easing presets, built-in and custom, with the ids apply_ease_preset " +
            "needs. Read-only. Call this before applying one — the id is the only way to name a " +
            "preset and this is where it comes from.",
        input_schema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "apply_ease",
        description:
            "Apply standard easing to the SELECTED KEYFRAMES, using XYTools. 'in' eases the incoming " +
            "side, 'out' the outgoing, 'both' does both. Select keyframes in the timeline first, not " +
            "layers. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: { mode: { type: "string", description: "'in', 'out' or 'both'." } },
            required: ["mode"],
        },
    },
    {
        name: "apply_ease_preset",
        description:
            "Apply one of the studio's saved easing presets to the selected keyframes. Get the id " +
            "from list_ease_presets. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: { id: { type: "string", description: "The preset's id from list_ease_presets." } },
            required: ["id"],
        },
    },
    {
        name: "apply_custom_ease",
        description:
            "Apply easing to the selected keyframes with influence you choose, for a shape the studio " +
            "has not saved as a preset. Influence is 0.1 to 100 — higher is a longer, softer ease. " +
            "Prefer a saved preset when one fits (list_ease_presets); use this when the artist asks " +
            "for something specific like 'ease harder on the way out'. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                inInfluence: { type: "number", description: "Ease influence on the incoming side, 0.1-100." },
                outInfluence: { type: "number", description: "Ease influence on the outgoing side, 0.1-100." },
            },
            required: ["inInfluence", "outInfluence"],
        },
    },
    {
        name: "trim_layers",
        description:
            "Trim the selected layers to the playhead, using XYTools. 'in' pulls the layer's start to " +
            "the current time, 'out' pushes its end there. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: { edge: { type: "string", description: "'in' or 'out'." } },
            required: ["edge"],
        },
    },
    {
        name: "preflight_project",
        description:
            "Run the panel's own Pre-Flight audit on the open project: missing footage, missing " +
            "effects, and missing fonts. Read-only — it inspects and reports, and changes nothing. " +
            "Use it when asked whether a project is ready to render or deliver.",
        input_schema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "add_adjustment_layer",
        description:
            "Add a comp-sized adjustment layer to the comp the artist has open. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Optional name. Defaults to 'Adjustment Layer'." },
            },
            required: [],
        },
    },
    {
        name: "add_null",
        description:
            "Add a null object to the comp the artist has open, for parenting. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Optional name for the null." },
            },
            required: [],
        },
    },
    {
        name: "rename_selected",
        description:
            "Rename the selected layers in the comp the artist has open. One layer takes the name as " +
            "given; several get a numbered suffix, so say that when you report it. Undoable with one " +
            "Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "The name, or the base name when several layers are targeted." },
                targetKind: {
                    type: "string",
                    description:
                        "Which layers: 'selected' (default), 'name', 'index' or 'label'. Use " +
                        "list_layers to see what is in the comp.",
                },
                targetValue: {
                    type: "string",
                    description:
                        "The layer name, the 1-based index, or the label number — whichever targetKind " +
                        "says. Leave out for 'selected'.",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "label_selected",
        description:
            "Set the label colour on the selected layers, for organising a comp. 0 is None, 1-16 are " +
            "After Effects' label swatches. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                label: { type: "number", description: "0 for none, or 1-16 for a label swatch." },
                targetKind: {
                    type: "string",
                    description:
                        "Which layers: 'selected' (default), 'name', 'index' or 'label'. Use " +
                        "list_layers to see what is in the comp.",
                },
                targetValue: {
                    type: "string",
                    description:
                        "The layer name, the 1-based index, or the label number — whichever targetKind " +
                        "says. Leave out for 'selected'.",
                },
            },
            required: ["label"],
        },
    },
    {
        name: "duplicate_selected",
        description:
            "Duplicate layers in the comp the artist has open — the selection by default, or layers " +
            "named by targetKind/targetValue. Undoable with one Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                targetKind: {
                    type: "string",
                    description:
                        "Which layers: 'selected' (default), 'name', 'index' or 'label'. Use " +
                        "list_layers to see what is in the comp.",
                },
                targetValue: {
                    type: "string",
                    description:
                        "The layer name, the 1-based index, or the label number — whichever targetKind " +
                        "says. Leave out for 'selected'.",
                },
            },
            required: [],
        },
    },
    {
        name: "set_comp_duration",
        description:
            "Set the duration of the comp the artist has open. Shortening does not delete anything — " +
            "layers past the new end still exist, they just fall outside the comp. Undoable with one " +
            "Ctrl+Z.",
        input_schema: {
            type: "object",
            properties: {
                seconds: { type: "number", description: "New duration in seconds." },
            },
            required: ["seconds"],
        },
    },
    {
        name: "list_layers",
        description:
            "Every layer in the comp the artist has open: index, name, label colour, whether it is " +
            "enabled or selected, and how many effects it has. Read-only. Call this when you need to " +
            "act on a layer the artist described rather than selected — it is where the index, name " +
            "and label come from.",
        input_schema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "find_expression",
        description:
            "Search the studio's saved Expressions Bank. With a query, returns matching entries WITH " +
            "their code, ready to use with set_expression. With no query, returns just the names and " +
            "tags so you can see what exists without pulling every expression into the conversation. " +
            "Read-only. Prefer a saved expression over writing one from scratch — it is the one the " +
            "studio already trusts.",
        input_schema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Words to match against name, tag and description. Omit to list what exists.",
                },
            },
            required: [],
        },
    },
    {
        name: "find_screen",
        description:
            "Search the shared Bespoke screen library — layouts the studio has already traced for " +
            "peculiar screens. Match by words in the name, site or territory, and/or by canvas size. " +
            "Read-only. Ask this before anyone traces a screen by hand: somebody may have done it " +
            "already, and loading theirs is minutes instead of an afternoon.",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Words to match against name, site or territory." },
                width: { type: "number", description: "Optional canvas width to match exactly." },
                height: { type: "number", description: "Optional canvas height to match exactly." },
            },
            required: [],
        },
    },
    {
        name: "list_effects",
        description:
            "Read the effects on layers in the open comp — the selection by default, or layers named " +
            "by targetKind/targetValue — with the matchNames needed to " +
            "address them and each property's current value. Read-only. Call this BEFORE set_expression " +
            "— matchNames are the only reliable way to address an effect parameter, and this is where " +
            "you get them. It also reports the project's expression engine, which decides what syntax " +
            "is legal.",
        input_schema: {
            type: "object",
            properties: {
                targetKind: {
                    type: "string",
                    description:
                        "Which layers: 'selected' (default), 'name', 'index' or 'label'. Use " +
                        "list_layers to see what is in the comp.",
                },
                targetValue: {
                    type: "string",
                    description:
                        "The layer name, the 1-based index, or the label number — whichever targetKind " +
                        "says. Leave out for 'selected'.",
                },
            },
            required: [],
        },
    },
    {
        name: "set_expression",
        description:
            "Put an expression on one property of one effect, on every selected layer that has it. " +
            "Undoable with one Ctrl+Z. Address the effect and the property by matchName from " +
            "list_effects — never by the name shown in the timeline, which differs between After " +
            "Effects versions and languages. Layers without that effect are skipped and named back to " +
            "you; say which. Pass an empty string to clear an expression.",
        input_schema: {
            type: "object",
            properties: {
                effectMatchName: {
                    type: "string",
                    description: "The effect's matchName from list_effects, e.g. 'ADBE 4ColorGradient'.",
                },
                propertyMatchName: {
                    type: "string",
                    description: "The property's matchName from list_effects, e.g. 'ADBE 4ColorGradient-0002'.",
                },
                expression: {
                    type: "string",
                    description:
                        "The expression, in After Effects expression language. Empty string clears it.",
                },
                targetKind: {
                    type: "string",
                    description:
                        "Which layers: 'selected' (default), 'name', 'index' or 'label'. Use " +
                        "list_layers to see what is in the comp.",
                },
                targetValue: {
                    type: "string",
                    description:
                        "The layer name, the 1-based index, or the label number — whichever targetKind " +
                        "says. Leave out for 'selected'.",
                },
            },
            required: ["effectMatchName", "propertyMatchName", "expression"],
        },
    },
    {
        name: "locate_campaign",
        description:
            "Find which campaign owns a filename token. Deliverable names carry a campaign token " +
            "('FID_INTL_PortalToParadise_...') while the campaign list holds human labels " +
            "('Forgotten Island') — this maps one to the other by checking which campaign's masters " +
            "actually carry that token, using the same match the build uses to pick a master. Use it " +
            "whenever you have deliverable names but no mastersRoot. Read-only.",
        input_schema: {
            type: "object",
            properties: {
                token: {
                    type: "string",
                    description:
                        "The campaign token from a deliverable's filename — the first underscore " +
                        "field, e.g. 'FID'. Not the campaign's display name.",
                },
            },
            required: ["token"],
        },
    },
    {
        name: "resolve_masters",
        description:
            "Check whether a Wrike job's deliverables have masters to build from, BEFORE anything is " +
            "filled in or run. Returns per row whether an exact master was found, and where none was, " +
            "whether a longer master could be cut down to it. Read-only: it looks at the masters " +
            "folder and reports, and changes nothing. Use this when asked whether a batch is ready, " +
            "or before prefill_batch when the artist wants to know if it is worth doing.",
        input_schema: {
            type: "object",
            properties: {
                jobId: {
                    type: "string",
                    description: "The job's id, exactly as returned by list_active_jobs.",
                },
                mastersRoot: {
                    type: "string",
                    description: "The campaign's masters root, from list_campaigns.",
                },
            },
            required: ["jobId", "mastersRoot"],
        },
    },
    {
        name: "fill_fields",
        description:
            "Put values into a panel tool's fields and open it, so the artist can check them and press " +
            "the button themselves. This FILLS A FORM — it generates nothing, writes no files and " +
            "touches no project. Only the fields listed for a tool can be filled; anything else is " +
            "refused. Fields the artist has already typed into are left alone and reported back, so " +
            "say which ones you filled and which you did not. Never say you have run, generated or " +
            "saved anything — you have filled a form and stopped.",
        input_schema: {
            type: "object",
            properties: {
                toolId: {
                    type: "string",
                    description: "The tool's id from the PANEL TOOLS list, e.g. 'name-generator'.",
                },
                values: {
                    type: "object",
                    description:
                        "Field id to value, e.g. {\"campaign\": \"ODY\", \"territory\": \"Turkey\"}. " +
                        "Use the field ids given in FILLABLE FIELDS, not the on-screen labels.",
                    additionalProperties: { type: "string" },
                },
            },
            required: ["toolId", "values"],
        },
    },
    {
        name: "scan_renders",
        description:
            "Find every rendered video file under a campaign's masters root and return each render's " +
            "filename stem. A master counts as rendered when its filename stem matches a render stem, " +
            "compared case-insensitively. Requires the mastersRoot PATH from list_campaigns.",
        input_schema: {
            type: "object",
            properties: {
                mastersRoot: {
                    type: "string",
                    description:
                        "Absolute path to the campaign's masters root, exactly as returned by list_campaigns.",
                },
            },
            required: ["mastersRoot"],
        },
    },
];

// --- Mock data ----------------------------------------------------------
//
// `yarn dev` never executes ExtendScript (CLAUDE.md §6), so without these the
// whole tool is untestable in the browser and you'd be debugging the model and
// the bridge at the same time. Same fallback pattern as CompInspector's
// MOCK_COMP. ODY has one master with no matching render, on purpose -- that is
// the answer the prototype has to arrive at.

const MOCK_CAMPAIGNS = [
    { name: "ODY", mastersRoot: "/Volumes/Studio/Masters/ODY" },
    { name: "MERIDIAN", mastersRoot: "/Volumes/Studio/Masters/MERIDIAN" },
];

const MOCK_MASTERS = [
    { name: "ODY_HORSE_1920x858_10sec_OV.aep",    creative: "HORSE",  size: "1920x858",  duration: "10sec" },
    { name: "ODY_HORSE_1080x1920px_15s_OV.aep",   creative: "HORSE",  size: "1080x1920", duration: "15s"   },
    { name: "ODY_FALCON_3240x1920px_15s_OV.aep",  creative: "FALCON", size: "3240x1920", duration: "15s"   },
];

const MOCK_RENDERS = [
    { stem: "ODY_HORSE_1920x858_10sec_OV" },
    { stem: "ody_horse_1080x1920px_15s_ov" }, // lower-cased on purpose: the stem match is case-insensitive
];

// --- Dispatch -----------------------------------------------------------

export async function runTool(name: string, input: any): Promise<ToolResult> {
    switch (name) {
        case "list_campaigns": {
            const res = await evalTS("loadCampaigns").catch(() => undefined);
            if (res === undefined) return mockOr({ ok: true, data: MOCK_CAMPAIGNS });
            const rows = (res as any[]) || [];
            return { ok: true, data: rows.map((c) => ({ name: c.name, mastersRoot: c.mastersRoot })) };
        }

        case "list_masters": {
            if (!input || typeof input.mastersRoot !== "string" || !input.mastersRoot) {
                return { ok: false, reason: "list_masters needs a mastersRoot path. Call list_campaigns first." };
            }
            const res = (await evalTS("bespokeListMasters", input.mastersRoot).catch(() => undefined)) as
                | { success: boolean; error?: string; masters?: any[] }
                | undefined;
            if (res === undefined) return mockOr({ ok: true, data: MOCK_MASTERS });
            if (!res.success) return { ok: false, reason: res.error || "Couldn't read the masters folder." };
            // TRIMMED ON PURPOSE. BespokeMaster carries 13 fields; this question
            // needs four. Tool results are re-sent on every later call in the
            // turn, so a wide row is paid for repeatedly -- and the model
            // reasons better over a narrow one.
            const masters = (res.masters || []).map((m) => ({
                name: m.name,
                creative: m.creative,
                size: m.size,
                duration: m.duration,
            }));
            return { ok: true, data: masters };
        }

        case "list_active_jobs": {
            const feed = await loadJobs();
            if (!feed.ok) return feed;
            const res = feed.res;
            return {
                ok: true,
                data: {
                    // LOUD NAME ON PURPOSE. When the worker is unreachable the
                    // feed serves realistic SAMPLE jobs -- drawn from real job
                    // titles -- and an agent relaying those as the artist's
                    // actual workload would be worse than saying nothing.
                    isSampleData: !!res.mock,
                    whoseList: res.viewingAs,
                    feedError: res.error,
                    jobs: res.jobs.map(summariseJob),
                },
            };
        }

        case "job_subtasks": {
            if (!input || typeof input.jobId !== "string" || !input.jobId) {
                return { ok: false, reason: "job_subtasks needs a jobId from list_active_jobs." };
            }
            const feed = await loadJobs();
            if (!feed.ok) return feed;
            const job = feed.res.jobs.filter((j) => j.id === input.jobId)[0];
            if (!job) {
                return {
                    ok: false,
                    reason:
                        `No job with id "${input.jobId}". Call list_active_jobs and use an id from it.`,
                };
            }
            const subs = job.subtasks || [];
            return {
                ok: true,
                data: {
                    isSampleData: !!feed.res.mock,
                    job: summariseJob(job),
                    // `subtaskCount` can be present with no subtasks array --
                    // "we know there are 4, we don't have them" is not "there
                    // are none", so say which it is.
                    subtasksAvailable: subs.length > 0 || !job.subtaskCount,
                    subtasks: subs.map((s) => {
                        const status = String(s.customStatusName || s.status || "").trim();
                        const finished =
                            String(s.status || "").trim() === "Completed" ||
                            FINISHED_STATUSES.test(status);
                        // Only judge against the allowlist when a CUSTOM status
                        // exists: the bare status group is only ever Active/
                        // Completed/Deferred/Cancelled, none of which is
                        // localisable, so testing it would mark everything held.
                        const hasCustom = !!String(s.customStatusName || "").trim();
                        const held = hasCustom && !LOCALISABLE_STATUSES.test(status) && !finished;
                        return {
                            name: s.name,
                            status: status || "unknown",
                            finished,
                            readyToLocalise: !finished && !held && hasCustom,
                            heldBack: held,
                        };
                    }),
                },
            };
        }

        case "run_action": {
            if (!input || typeof input.actionId !== "string" || !input.actionId) {
                return { ok: false, reason: "run_action needs an actionId from the RUNNABLE ACTIONS list." };
            }
            const entry = ACTIONS.filter((a) => a.id === input.actionId)[0];
            if (!entry) {
                return {
                    ok: false,
                    reason:
                        `No action with id "${input.actionId}". Runnable ids: ` +
                        ACTIONS.filter(isRunnable).map((a) => a.id).join(", "),
                };
            }
            // THE GATE. Enforced here, never in the prompt -- an unclassified
            // action is treated as a write, so nothing becomes runnable by
            // having been forgotten in Toolset.tsx.
            if (!isRunnable(entry)) {
                return {
                    ok: false,
                    reason:
                        `"${entry.label}" modifies or renames files that already exist, which cannot ` +
                        `be undone, so I can't run it. Open the Toolset and press it yourself if ` +
                        `that's what you want.`,
                };
            }

            try {
                const result = await entry.run();
                // null is the picker-cancelled sentinel, distinct from a
                // failure and from evalTSSafe's own "no bridge" undefined --
                // reporting a cancel as success is how an agent claims work
                // it did not do.
                if (result === null) {
                    return { ok: true, data: { ran: entry.label, outcome: "cancelled by the artist" } };
                }
                if (result === undefined) {
                    return { ok: false, reason: `No bridge to After Effects — ${entry.label} did not run.` };
                }
                return {
                    ok: true,
                    data: {
                        ran: entry.label,
                        outcome: entry.successText(result),
                        // So the model can tell the artist how to back out,
                        // and does not describe a new file as "undoable".
                        howToReverse:
                            entry.safety === "undoable"
                                ? "Ctrl+Z / Cmd+Z in After Effects"
                                : entry.safety === "additive"
                                ? "nothing was overwritten — delete what it created if it was wrong"
                                : "nothing to reverse, this only reported",
                    },
                };
            } catch (e: any) {
                return { ok: false, reason: `${entry.label} failed: ${e?.message || e}` };
            }
        }

        case "prefill_batch": {
            if (!input || typeof input.jobId !== "string" || !input.jobId) {
                return { ok: false, reason: "prefill_batch needs a jobId from list_active_jobs." };
            }
            const feed = await loadJobs();
            if (!feed.ok) return feed;
            const job = feed.res.jobs.filter((j) => j.id === input.jobId)[0];
            if (!job) {
                return { ok: false, reason: `No job with id "${input.jobId}". Call list_active_jobs first.` };
            }
            if (feed.res.mock) {
                // Staging invented deliverables into a real batch builder is
                // the one thing worse than showing sample jobs in a list.
                return {
                    ok: false,
                    reason:
                        "The live jobs feed is unreachable, so this job is sample data. " +
                        "I won't fill the batch builder with invented deliverables.",
                };
            }

            const rows = await loadJobRows(job);
            const verdict = classifyRows(rows);

            if (verdict.sendable.length === 0) {
                return {
                    ok: false,
                    reason:
                        `Nothing in "${job.title}" can be sent: ` +
                        `${verdict.hidden} row(s) missing campaign/size/duration, ` +
                        `${verdict.doneCount} already finished, ${verdict.heldCount} not at a localisable status.`,
                };
            }

            const staged = stageBatchFromJob(job, rows);
            const nav = navigateToTool("csv-localiser");

            return {
                ok: true,
                data: {
                    filledInto: "Big Guy Localiser — Build a Batch",
                    opened: nav.ok ? nav.label : undefined,
                    navigationError: nav.ok ? undefined : nav.reason,
                    territory: staged.territory,
                    batch: staged.batch,
                    rowsFilled: staged.rows.length,
                    // Named rather than counted: "3 rows were skipped" sends
                    // the artist hunting, "these three, for these reasons"
                    // does not.
                    skipped: staged.skipped,
                    finishedCount: verdict.doneCount,
                    heldCount: verdict.heldCount,
                    nothingHasRunYet: true,
                },
            };
        }

        case "open_tool": {
            if (!input || typeof input.toolId !== "string" || !input.toolId) {
                return { ok: false, reason: "open_tool needs a toolId from the PANEL TOOLS list." };
            }
            const action = typeof input.action === "string" && input.action ? input.action : undefined;
            const nav = navigateToTool(input.toolId, action);
            if (!nav.ok) return { ok: false, reason: nav.reason || "Couldn't open that tool." };
            // The label goes back so the model can confirm what it opened by
            // name rather than echoing the id at the artist.
            return { ok: true, data: { opened: nav.label, pressed: nav.pressed } };
        }

        // EVERY WRITE TOOL, through one gate. Listed before the read tools so
        // the branch that can change the artist's project is the first thing
        // anyone reads in this dispatcher.
        case "create_comp":
        case "precompose_selected":
        case "add_solid":
        case "add_text_layer":
        case "add_shape_layer":
        case "add_adjustment_layer":
        case "add_null":
        case "rename_selected":
        case "label_selected":
        case "duplicate_selected":
        case "align_layers":
        case "distribute_layers":
        case "fit_layers":
        case "flip_layers":
        case "sequence_layers":
        case "fade_layers":
        case "set_anchor":
        case "apply_ease":
        case "apply_ease_preset":
        case "apply_custom_ease":
        case "trim_layers":
        case "set_comp_duration":
        case "set_expression": {
            const write = WRITE_TOOLS[name];
            // Unreachable while the case list and the map agree — and here
            // precisely so that when they stop agreeing, the answer is a
            // refusal rather than an unchecked call.
            if (!write) return { ok: false, reason: `"${name}" is not a write tool I'm allowed to run.` };

            const built = write.args(input || {});
            // Checked here AND in ExtendScript. Not redundant: this gives the
            // model a correctable error without a bridge round trip, while the
            // host check is the gate that actually holds, since it is the only
            // side that cannot be talked out of it.
            if (typeof built === "string") return { ok: false, reason: built };

            // The cast is on the ARGUMENTS only, and it is unavoidable:
            // evalTS correlates each name with that function's own parameter
            // tuple, which cannot hold when the name is chosen at runtime. The
            // NAME is still checked -- `backend` is typed as evalTS's union
            // above -- so a misspelled export still fails the build. What is
            // given up is per-call arity checking, which is why every `args`
            // builder above is written next to the signature it feeds.
            const callBackend = evalTS as unknown as (fn: string, ...a: any[]) => Promise<any>;
            const res = (await callBackend(write.backend, ...built).catch(() => undefined)) as
                | (Record<string, any> & { success: boolean; error?: string })
                | undefined;

            if (res === undefined) return { ok: false, reason: "No bridge to After Effects — nothing was changed." };
            if (!res.success) return { ok: false, reason: res.error || "That didn't work." };

            // The host's own report, passed through unchanged apart from
            // dropping `success`. Every one of these reads its values back off
            // the thing it made rather than echoing the request, so relaying it
            // verbatim is what keeps the agent honest about what exists.
            const { success, ...report } = res;
            return { ok: true, data: { ...report, safety: write.safety } };
        }

        case "list_ease_presets": {
            const res = (await evalTS("motionToolsListEasePresets").catch(() => undefined)) as
                | { success: boolean; error?: string; presets?: any[] }
                | undefined;
            if (res === undefined) return mockOr({ ok: true, data: { presets: [] } });
            if (!res.success) return { ok: false, reason: res.error || "Couldn't read the ease presets." };
            return {
                ok: true,
                data: {
                    presets: (res.presets || []).map((p) => ({
                        id: p.id,
                        name: p.name,
                        builtIn: p.isBuiltIn,
                        // Influence only, never speed: a preset stores influence
                        // because it is portable, while speed is absolute and
                        // tied to one keyframe. Reporting speed would invite the
                        // agent to talk about a number that does not travel.
                        inInfluence: p.inInfluence,
                        outInfluence: p.outInfluence,
                    })),
                },
            };
        }

        case "preflight_project": {
            const res = (await evalTS("preflightAudit").catch(() => undefined)) as
                | { success: boolean; error?: string; report?: any }
                | undefined;
            if (res === undefined) return { ok: false, reason: "No bridge to After Effects — can't audit the project." };
            if (!res.success || !res.report) return { ok: false, reason: res.error || "Couldn't audit the project." };

            const r = res.report;
            return {
                ok: true,
                data: {
                    project: r.projectName,
                    comps: r.compCount,
                    footageItems: r.footageCount,
                    missingFootage: (r.missingFootage || []).map((f: any) => ({ name: f.name, expectedAt: f.path })),
                    missingEffects: (r.missingEffects || []).map((e: any) => ({ effect: e.label, usedIn: e.usedIn })),
                    missingFonts: r.missingFonts || [],
                    // NOT the same as "no missing fonts". A false here means the
                    // check could not run, and reporting that as a clean bill is
                    // exactly how the quietest of the three failures ships.
                    fontsChecked: r.fontsChecked,
                    fontsUsed: r.fontsUsed,
                },
            };
        }

        case "list_layers": {
            const res = (await evalTS("agentListLayers").catch(() => undefined)) as
                | { success: boolean; error?: string; comp?: string; layerCount?: number; layers?: any[] }
                | undefined;
            if (res === undefined) return { ok: false, reason: "No bridge to After Effects — can't read the comp." };
            if (!res.success) return { ok: false, reason: res.error || "Couldn't read the layers." };
            return { ok: true, data: { comp: res.comp, layerCount: res.layerCount, layers: res.layers } };
        }

        case "find_expression": {
            const res = (await evalTS("expressionsBankLoad").catch(() => undefined)) as
                | { success: boolean; error?: string; message?: string }
                | undefined;
            if (res === undefined) return mockOr({ ok: true, data: { entries: [] } });
            if (!res.success) return { ok: false, reason: res.error || "Couldn't read the Expressions Bank." };

            let entries: any[] = [];
            try {
                // The host hands back the stored JSON verbatim rather than
                // re-serialising it, so unknown fields from a newer panel
                // survive. Parsing is this side's job.
                entries = JSON.parse(res.message || "[]") || [];
            } catch {
                return { ok: false, reason: "The Expressions Bank is stored in a format I couldn't read." };
            }

            const q = typeof input?.query === "string" ? input.query.trim().toLowerCase() : "";
            if (!q) {
                // NO CODE without a query. The bank can hold dozens of
                // expressions and every tool result is re-sent on each later
                // call in the turn — an index costs a line each, the bodies
                // would cost the conversation.
                return {
                    ok: true,
                    data: {
                        count: entries.length,
                        entries: entries.map((e) => ({ name: e.name, tag: e.tag, description: e.description })),
                        note: "Names and tags only. Search with a query to get the code.",
                    },
                };
            }

            const hits = entries.filter((e) => {
                const hay = [e.name, e.tag, e.description].join(" ").toLowerCase();
                return hay.indexOf(q) !== -1;
            });
            const CAP = 5;
            return {
                ok: true,
                data: {
                    matched: hits.length,
                    entries: hits.slice(0, CAP).map((e) => ({
                        name: e.name,
                        tag: e.tag,
                        description: e.description,
                        code: e.code,
                    })),
                    truncated: hits.length > CAP ? hits.length - CAP : undefined,
                },
            };
        }

        case "find_screen": {
            const res = (await evalTS("bespokeTemplateList").catch(() => undefined)) as
                | { success: boolean; read?: boolean; error?: string; templates?: any[] }
                | undefined;
            if (res === undefined) return mockOr({ ok: true, data: { screens: [] } });
            if (!res.success) return { ok: false, reason: res.error || "Couldn't read the screen library." };
            // `read` false means the share could not be reached. An empty
            // library and an unreachable one are different answers, and only
            // one of them means "nobody has built this".
            if (res.read === false) {
                return { ok: false, reason: "The team share isn't reachable, so I can't tell whether this screen exists. Not the same as it not existing." };
            }

            const all = res.templates || [];
            const q = typeof input?.query === "string" ? input.query.trim().toLowerCase() : "";
            const w = typeof input?.width === "number" ? Math.round(input.width) : null;
            const h = typeof input?.height === "number" ? Math.round(input.height) : null;

            const hits = all.filter((t) => {
                if (w !== null && Math.round(t.canvasW) !== w) return false;
                if (h !== null && Math.round(t.canvasH) !== h) return false;
                if (!q) return true;
                return [t.name, t.site, t.territory].join(" ").toLowerCase().indexOf(q) !== -1;
            });

            return {
                ok: true,
                data: {
                    matched: hits.length,
                    libraryTotal: all.length,
                    screens: hits.slice(0, 10).map((t) => ({
                        name: t.name,
                        territory: t.territory,
                        site: t.site,
                        canvas: `${t.canvasW}x${t.canvasH}`,
                        regions: (t.slots || []).length,
                        savedBy: t.savedBy,
                    })),
                    // The geometry is deliberately absent: it is the panel's to
                    // load, not the conversation's to carry.
                    note: hits.length
                        ? "Open It's Bespokin' Time and load one from the library to use its layout."
                        : undefined,
                },
            };
        }

        case "list_effects": {
            const [lek, lev] = targetArgs(input || {});
            const res = (await evalTS("agentListEffects", lek, lev).catch(() => undefined)) as
                | { success: boolean; error?: string; comp?: string; expressionEngine?: string; layers?: any[] }
                | undefined;
            if (res === undefined) return { ok: false, reason: "No bridge to After Effects — can't read the layer." };
            if (!res.success) return { ok: false, reason: res.error || "Couldn't read the effects on that layer." };
            return {
                ok: true,
                data: {
                    comp: res.comp,
                    // Passed through because it decides what syntax is legal:
                    // a project on the legacy engine rejects modern JavaScript,
                    // and the symptom is a disabled property rather than an
                    // error the model would see.
                    expressionEngine: res.expressionEngine,
                    layers: res.layers,
                },
            };
        }

        case "locate_campaign": {
            if (!input || typeof input.token !== "string" || !input.token.trim()) {
                return { ok: false, reason: "locate_campaign needs a campaign token from a deliverable's filename." };
            }
            const res = (await evalTS("locateCampaignForToken", input.token.trim()).catch(() => undefined)) as
                | { success: boolean; error?: string; matches?: any[]; unreachable?: string[] }
                | undefined;

            if (res === undefined) return mockOr({ ok: true, data: { matches: MOCK_CAMPAIGNS.slice(0, 1) } });
            if (!res.success) return { ok: false, reason: res.error || "Couldn't look up that campaign token." };

            const matches = res.matches || [];
            return {
                ok: true,
                data: {
                    token: input.token.trim(),
                    matches,
                    // NAMED, not counted. A campaign that could not be reached is
                    // not a campaign without masters, and the difference decides
                    // whether "no campaign owns this token" is true or just
                    // unknown -- so the model is given the names and told to say
                    // so rather than concluding.
                    couldNotCheck: res.unreachable,
                    note: matches.length === 0
                        ? "No campaign's masters carry that token. If any campaign could not be checked, say which — the answer may be in one of those."
                        : undefined,
                },
            };
        }

        case "resolve_masters": {
            if (!input || typeof input.jobId !== "string" || !input.jobId) {
                return { ok: false, reason: "resolve_masters needs a jobId from list_active_jobs." };
            }
            if (typeof input.mastersRoot !== "string" || !input.mastersRoot) {
                return { ok: false, reason: "resolve_masters needs a mastersRoot from list_campaigns." };
            }

            const feed = await loadJobs();
            if (!feed.ok) return feed;
            const job = feed.res.jobs.filter((j) => j.id === input.jobId)[0];
            if (!job) {
                return { ok: false, reason: `No job with id "${input.jobId}". Call list_active_jobs first.` };
            }
            if (feed.res.mock) {
                return {
                    ok: false,
                    reason:
                        "The live jobs feed is unreachable, so this job is sample data. Resolving " +
                        "invented deliverables against real masters would tell you nothing.",
                };
            }

            const rows = await loadJobRows(job);
            const { sendable } = classifyRows(rows);
            if (!sendable.length) {
                return { ok: false, reason: `Nothing in "${job.title}" has a campaign, size and duration to look up.` };
            }

            // BUILT HERE, NOT VIA stageBatchFromJob. That function calls
            // setPendingBatch -- asking whether the masters exist would
            // otherwise stage a batch as a side effect, and the artist would
            // arrive at a pre-filled form they never asked for.
            const lookups = sendable.map((r) => ({
                campaign: (r.parsed && r.parsed.campaign) || "",
                size: r.size,
                duration: (r.parsed && r.parsed.duration) || "",
            }));

            // THE SAME RESOLVER THE ROW ICONS USE, deliberately. The model
            // comparing a size against a list of hundreds of masters by eye is
            // exactly where it says "found" about a 1080x1920 when the folder
            // holds 1080x1920px -- and this function already knows both
            // conventions. One answer, one place.
            const res = (await evalTS(
                "csvLocaliserResolveMasters",
                input.mastersRoot,
                JSON.stringify(lookups)
            ).catch(() => undefined)) as
                | { success: boolean; error?: string; indexed?: number; rows?: any[] }
                | undefined;

            if (res === undefined) return mockOr({ ok: false, reason: "No bridge — can't check masters in the browser." });
            if (!res.success) return { ok: false, reason: res.error || "Couldn't read the masters folder." };

            const out = (res.rows || []).map((row, i) => ({
                deliverable: sendable[i] ? sendable[i].name : "",
                found: !!row.master,
                master: row.master || null,
                // Only offered when there is no exact match: a longer master
                // that divides evenly and could be cut down. An OFFER, not a
                // plan -- the run ignores it unless the artist opts that row in.
                couldCutFrom: row.multiples && row.multiples.length
                    ? row.multiples.map((m: any) => `${m.factor}× ${m.duration} (${m.master})`)
                    : undefined,
            }));

            const missing = out.filter((r) => !r.found);
            return {
                ok: true,
                data: {
                    job: job.title,
                    mastersIndexed: res.indexed,
                    allFound: missing.length === 0,
                    missingCount: missing.length,
                    rows: out,
                },
            };
        }

        case "fill_fields": {
            if (!input || typeof input.toolId !== "string" || !input.toolId) {
                return { ok: false, reason: "fill_fields needs a toolId from the PANEL TOOLS list." };
            }
            if (!input.values || typeof input.values !== "object" || Array.isArray(input.values)) {
                return { ok: false, reason: "fill_fields needs a values object of field id to value." };
            }

            const entry = PANEL_TOOLS.filter((t) => t.id === input.toolId)[0];
            if (!entry) {
                return { ok: false, reason: `No panel tool with id "${input.toolId}".` };
            }

            // THE GATE. Fail-closed on BOTH axes: a tool that declares no
            // fillable fields has none, and a field not on its list is not
            // fillable. Nothing becomes agent-fillable by having been forgotten
            // in the registry -- same rule as run_action's, for the same reason.
            const allowed = entry.fillableFields || [];
            if (!allowed.length) {
                return {
                    ok: false,
                    reason:
                        `${entry.label} has no fields I'm allowed to fill. I can open it and tell you ` +
                        `what to put in.`,
                };
            }

            const accepted: Record<string, string> = {};
            const refused: string[] = [];
            for (const key in input.values) {
                if (!Object.prototype.hasOwnProperty.call(input.values, key)) continue;
                if (allowed.indexOf(key) === -1) { refused.push(key); continue; }
                const v = input.values[key];
                // Values cross into a form the artist reads and acts on, so a
                // non-string here is a bug worth refusing rather than coercing:
                // String(undefined) puts the word "undefined" in a filename.
                if (typeof v !== "string") { refused.push(key); continue; }
                accepted[key] = v;
            }

            if (!Object.keys(accepted).length) {
                return {
                    ok: false,
                    reason:
                        `None of those are fields I can fill in ${entry.label}. Fillable: ` +
                        `${allowed.join(", ")}.`,
                };
            }

            // Staged BEFORE navigating: the tool reads its pending fill as it
            // mounts, so a value set afterwards would arrive to a component
            // that had already looked.
            setPendingFill({ toolId: entry.id, values: accepted });

            const nav = navigateToTool(entry.id);
            if (!nav.ok) {
                // Nothing is left staged for a tool that never opened -- it
                // would surface on some unrelated later visit.
                takePendingFill(entry.id);
                return { ok: false, reason: nav.reason || "Couldn't open that tool." };
            }

            return {
                ok: true,
                data: {
                    opened: nav.label,
                    // What was HANDED OVER, not what landed. The tool fills only
                    // its empty fields and shows the artist what it held back,
                    // so claiming these were all applied would be claiming more
                    // than this call knows.
                    offered: accepted,
                    refused: refused.length ? refused : undefined,
                    note:
                        "Values are in the form, not applied to anything. Anything the artist had " +
                        "already typed is left as it was and flagged in the tool.",
                },
            };
        }

        case "scan_renders": {
            if (!input || typeof input.mastersRoot !== "string" || !input.mastersRoot) {
                return { ok: false, reason: "scan_renders needs a mastersRoot path. Call list_campaigns first." };
            }
            const res = await evalTS("scanAllRenders", input.mastersRoot).catch(() => undefined);
            if (res === undefined) return mockOr({ ok: true, data: MOCK_RENDERS });
            const rows = (res as any[]) || [];
            return { ok: true, data: rows.map((r) => ({ stem: r.stem })) };
        }

        default:
            return { ok: false, reason: `Unknown tool: ${name}` };
    }
}

/**
 * Whose jobs, and the feed itself.
 *
 * `fetchJobs` takes the MACHINE's owner, never the person being viewed --
 * impersonation is derived from the saved config, and passing the viewed name
 * makes the feed think you are them (ActiveJobs.tsx:109 learned this the hard
 * way). An untagged machine is a normal state, not an error: it just means the
 * "assigned to me" filter matches nothing.
 */
async function loadJobs(): Promise<{ ok: true; res: Awaited<ReturnType<typeof fetchJobs>> } | { ok: false; reason: string }> {
    let owner = "";
    try {
        const state = await evalTS("teamGetMachineState");
        if (state && (state as { owner?: string }).owner) owner = (state as { owner: string }).owner;
    } catch {
        /* no bridge -- fetchJobs still answers, just unfiltered */
    }

    try {
        const res = await fetchJobs(owner);
        return { ok: true, res };
    } catch (e: any) {
        return { ok: false, reason: `Couldn't reach the jobs feed: ${e?.message || e}` };
    }
}

/**
 * THE PARAMETERISED WRITE TOOLS, and the whole list of them.
 *
 * A second, deliberately separate safety surface from ACTIONS' `safety` field.
 * Those grade buttons somebody already built; these are functions in
 * agentWrites.ts that take arguments from a language model and change the open
 * project. Keeping the two lists apart means neither can quietly inherit the
 * other's permissiveness.
 *
 * FAIL-CLOSED: a tool absent from this map is refused, so adding a function to
 * agentWrites.ts does not by itself make it reachable, and neither does adding
 * a ToolDef above.
 *
 * `undoable` is the only tier that belongs here. Anything whose worst case is
 * more than one Ctrl+Z is not a thing the agent does; it is a thing the agent
 * opens the panel for.
 *
 * ONE DISPATCHER, not one case each. Seven near-identical branches is seven
 * places for the gate to be forgotten; `args` returns either the argument list
 * to send or a string explaining what is wrong with the input, so validation
 * and marshalling stay together and the gate is passed exactly once.
 */
/**
 * The two flat scalars every selection-based write tool ends with.
 *
 * Flat, not an object, because they cross the bridge — a nested selector would
 * lose its values in transit (CLAUDE.md section 2). Defaults to the selection,
 * which is what an artist has in their hands and what these tools have always
 * meant.
 */
function targetArgs(i: any): [string, string] {
    const kind = typeof i.targetKind === "string" && i.targetKind ? i.targetKind : "selected";
    const value = i.targetValue == null ? "" : String(i.targetValue);
    return [kind, value];
}

const WRITE_TOOLS: Record<
    string,
    {
        safety: "undoable";
        /**
         * Typed as evalTS's own name union, not `string`. That makes the
         * CLAUDE.md audit rule -- every evalTS name resolves to a real export
         * -- a COMPILE error rather than something to remember to grep for. A
         * typo here fails `yarn build`, which is where it should fail.
         */
        backend: Parameters<typeof evalTS>[0];
        args: (i: any) => any[] | string;
    }
> = {
    create_comp: {
        safety: "undoable",
        backend: "agentCreateComp",
        args: (i) => {
            const name = typeof i.name === "string" ? i.name.trim() : "";
            if (!name) return "create_comp needs a name for the comp.";
            for (const k of ["width", "height", "frameRate", "seconds"]) {
                if (typeof i[k] !== "number" || !isFinite(i[k]) || i[k] <= 0) {
                    return `create_comp needs a positive number for ${k}.`;
                }
            }
            return [name, i.width, i.height, i.frameRate, i.seconds];
        },
    },
    precompose_selected: {
        safety: "undoable",
        backend: "agentPrecomposeSelected",
        args: (i) => {
            const name = typeof i.name === "string" ? i.name.trim() : "";
            if (!name) return "precompose_selected needs a name for the precomp.";
            // Defaults to true, which is both AE's default and the only legal
            // value for more than one layer.
            return [name, i.moveAllAttributes !== false, ...targetArgs(i)];
        },
    },
    add_solid: {
        safety: "undoable",
        backend: "agentAddSolid",
        args: (i) => {
            const name = typeof i.name === "string" ? i.name.trim() : "";
            if (!name) return "add_solid needs a name.";
            const hex = typeof i.hexColour === "string" ? i.hexColour.trim() : "";
            if (!hex) return "add_solid needs a hex colour like #1A1A1A.";
            // null means "comp-sized", which the host resolves — it knows the
            // comp's dimensions and this side does not.
            const w = typeof i.width === "number" ? i.width : null;
            const h = typeof i.height === "number" ? i.height : null;
            return [name, hex, w, h];
        },
    },
    add_text_layer: {
        safety: "undoable",
        backend: "agentAddTextLayer",
        args: (i) => {
            if (typeof i.text !== "string") return "add_text_layer needs the text to put in the layer.";
            // Empty strings pass through for size and colour: absent means
            // "leave AE's default", which is different from an invalid value
            // and must not be turned into one.
            return [i.text, i.fontSize == null ? "" : i.fontSize, typeof i.hexColour === "string" ? i.hexColour : ""];
        },
    },
    animate_layers: {
        safety: "undoable",
        backend: "agentAnimateProperty",
        args: (i) => {
            if (typeof i.property !== "string" || !i.property.trim()) {
                return "animate_layers needs to know which property to animate.";
            }
            // `to` is required and must survive as a STRING: the host parses it,
            // so a number sent bare still has to arrive as text it can read.
            if (i.to == null || i.to === "") return "animate_layers needs an end value.";
            const dur = Number(i.durationSeconds);
            if (!isFinite(dur) || dur <= 0) return "animate_layers needs a duration longer than zero.";
            const start = i.startSeconds == null ? 0 : Number(i.startSeconds);
            if (!isFinite(start) || start < 0) return "animate_layers needs a start time of zero or later.";
            const stagger = i.stagger == null ? 0 : Number(i.stagger);
            if (!isFinite(stagger) || stagger < 0) return "animate_layers needs a stagger of zero or more.";
            return [
                typeof i.targetKind === "string" ? i.targetKind : "selected",
                i.targetValue == null ? "" : String(i.targetValue),
                i.property.trim(),
                i.from == null ? "" : (typeof i.from === "string" ? i.from : JSON.stringify(i.from)),
                typeof i.to === "string" ? i.to : JSON.stringify(i.to),
                start,
                dur,
                i.relative === true,
                stagger,
                typeof i.ease === "string" ? i.ease : "none",
                i.replaceExisting === true,
            ];
        },
    },
    add_shape_layer: {
        safety: "undoable",
        backend: "agentAddShapeLayer",
        args: (i) => [
            typeof i.name === "string" ? i.name.trim() : "",
            typeof i.shape === "string" ? i.shape : "none",
            i.width == null ? "" : i.width,
            i.height == null ? "" : i.height,
            typeof i.hexColour === "string" ? i.hexColour : "",
        ],
    },
    add_adjustment_layer: {
        safety: "undoable",
        backend: "agentAddAdjustmentLayer",
        args: (i) => [typeof i.name === "string" ? i.name.trim() : ""],
    },
    add_null: {
        safety: "undoable",
        backend: "agentAddNull",
        args: (i) => [typeof i.name === "string" ? i.name.trim() : ""],
    },
    rename_selected: {
        safety: "undoable",
        backend: "agentRenameSelected",
        args: (i) => {
            const name = typeof i.name === "string" ? i.name.trim() : "";
            if (!name) return "rename_selected needs a name.";
            return [name, ...targetArgs(i)];
        },
    },
    label_selected: {
        safety: "undoable",
        backend: "agentLabelSelected",
        args: (i) => {
            if (typeof i.label !== "number" || !isFinite(i.label)) {
                return "label_selected needs a label number from 0 (none) to 16.";
            }
            return [i.label, ...targetArgs(i)];
        },
    },
    duplicate_selected: {
        safety: "undoable",
        backend: "agentDuplicateSelected",
        args: (i) => [...targetArgs(i)],
    },
    set_expression: {
        safety: "undoable",
        backend: "agentSetExpression",
        args: (i) => {
            const fx = typeof i.effectMatchName === "string" ? i.effectMatchName.trim() : "";
            const prop = typeof i.propertyMatchName === "string" ? i.propertyMatchName.trim() : "";
            if (!fx) return "set_expression needs the effect's matchName — call list_effects first.";
            if (!prop) return "set_expression needs the property's matchName — call list_effects first.";
            // An empty expression is legal: it clears one. Only a missing field
            // is an error, which is why this checks the type and not the value.
            if (typeof i.expression !== "string") return "set_expression needs an expression string.";
            return [fx, prop, i.expression, ...targetArgs(i)];
        },
    },
    // --- XYTools -------------------------------------------------------
    //
    // These wrap the panel's OWN motion tools rather than reimplementing them.
    // Every one already acts on the selection, already opens its own undo
    // group, and already handles the awkward parts -- sourceRectAtTime on
    // layers that do not have it, alignment against a comp versus against the
    // selection. Rewriting any of that for the agent would be a second
    // implementation of behaviour artists already know, and it would drift.
    //
    // The vocabularies below are taken from XYToolsDroplet.tsx's own call
    // sites, not invented: the agent presses exactly what the buttons press.
    align_layers: {
        safety: "undoable",
        backend: "motionToolsAlign",
        args: (i) => {
            const EDGES = ["left", "hcenter", "right", "top", "vcenter", "bottom"];
            const edge = typeof i.edge === "string" ? i.edge : "";
            if (EDGES.indexOf(edge) === -1) return `align_layers edge must be one of: ${EDGES.join(", ")}.`;
            const to = i.relativeTo === "selection" ? "selection" : "comp";
            return [edge, to];
        },
    },
    distribute_layers: {
        safety: "undoable",
        backend: "motionToolsDistribute",
        args: (i) => {
            if (i.axis !== "horizontal" && i.axis !== "vertical") {
                return "distribute_layers axis must be 'horizontal' or 'vertical'.";
            }
            return [i.axis];
        },
    },
    fit_layers: {
        safety: "undoable",
        backend: "motionToolsFit",
        args: (i) => {
            const MODES = ["contain", "cover", "stretch"];
            if (MODES.indexOf(i.mode) === -1) return `fit_layers mode must be one of: ${MODES.join(", ")}.`;
            return [i.mode];
        },
    },
    flip_layers: {
        safety: "undoable",
        backend: "motionToolsFlip",
        args: (i) => {
            if (i.axis !== "horizontal" && i.axis !== "vertical") {
                return "flip_layers axis must be 'horizontal' or 'vertical'.";
            }
            return [i.axis];
        },
    },
    sequence_layers: {
        safety: "undoable",
        backend: "motionToolsSequence",
        args: (i) => {
            if (typeof i.frames !== "number" || !isFinite(i.frames)) {
                return "sequence_layers needs a number of frames to offset each layer by.";
            }
            return [i.frames, i.reverse === true];
        },
    },
    fade_layers: {
        safety: "undoable",
        backend: "motionToolsFade",
        args: (i) => {
            const MODES = ["in", "out", "both"];
            if (MODES.indexOf(i.mode) === -1) return `fade_layers mode must be one of: ${MODES.join(", ")}.`;
            if (typeof i.frames !== "number" || !isFinite(i.frames) || i.frames <= 0) {
                return "fade_layers needs a positive number of frames.";
            }
            // atEdges fades at the layer's own in/out points rather than the
            // comp's — the panel's own default is false.
            return [i.mode, i.frames, i.atEdges === true];
        },
    },
    set_anchor: {
        safety: "undoable",
        backend: "motionToolsSnapAnchor",
        args: (i) => {
            // 0..1 across the layer's own bounds: 0.5/0.5 is the centre, which
            // is what "centre the anchor point" means.
            for (const k of ["relX", "relY"]) {
                if (typeof i[k] !== "number" || !isFinite(i[k]) || i[k] < 0 || i[k] > 1) {
                    return `set_anchor needs ${k} between 0 and 1 (0.5 is centre).`;
                }
            }
            return [i.relX, i.relY];
        },
    },
    apply_ease: {
        safety: "undoable",
        backend: "motionToolsApplyEase",
        args: (i) => {
            const MODES = ["in", "out", "both"];
            if (MODES.indexOf(i.mode) === -1) return `apply_ease mode must be one of: ${MODES.join(", ")}.`;
            return [i.mode];
        },
    },
    apply_ease_preset: {
        safety: "undoable",
        backend: "motionToolsApplyEasePreset",
        args: (i) => {
            const id = typeof i.id === "string" ? i.id.trim() : "";
            if (!id) return "apply_ease_preset needs a preset id — call list_ease_presets first.";
            return [id];
        },
    },
    apply_custom_ease: {
        safety: "undoable",
        backend: "motionToolsApplyCustomEase",
        args: (i) => {
            for (const k of ["inInfluence", "outInfluence"]) {
                if (typeof i[k] !== "number" || !isFinite(i[k]) || i[k] < 0.1 || i[k] > 100) {
                    return `apply_custom_ease needs ${k} between 0.1 and 100.`;
                }
            }
            return [i.inInfluence, i.outInfluence];
        },
    },
    trim_layers: {
        safety: "undoable",
        backend: "motionToolsTrim",
        args: (i) => {
            if (i.edge !== "in" && i.edge !== "out") return "trim_layers edge must be 'in' or 'out'.";
            return [i.edge];
        },
    },
    set_comp_duration: {
        safety: "undoable",
        backend: "agentSetCompDuration",
        args: (i) => {
            if (typeof i.seconds !== "number" || !isFinite(i.seconds) || i.seconds <= 0) {
                return "set_comp_duration needs a positive number of seconds.";
            }
            return [i.seconds];
        },
    },
};

/**
 * May the agent run this one-click action?
 *
 * Everything except "destructive" -- i.e. anything whose worst case is a
 * Ctrl+Z or a folder you delete. An action with no `safety` at all counts as
 * destructive, so nothing becomes runnable by having been forgotten. See the
 * field's note in Toolset.tsx for what each tier means.
 */
export function isRunnable(a: {
    safety?: "read" | "undoable" | "additive" | "destructive";
}): boolean {
    return a.safety === "read" || a.safety === "undoable" || a.safety === "additive";
}

/** One job, flattened -- the title is parsed the same way the card parses it. */
function summariseJob(j: WrikeJob) {
    const parts = parseJobTitle(j.title);
    return {
        id: j.id,
        title: j.title,
        film: parts.film,
        territory: parts.territory,
        batch: parts.batch,
        status: j.status,
        // "ready" | "waiting" | "done" | "unknown" -- the shared definition
        // from jobsFeed, so this cannot drift from what the card shows.
        readiness: jobReadiness(j.status),
        assignee: j.assignee,
        deliverables: j.subtaskCount,
        deliverablesDone: j.subtasksDone,
    };
}

/**
 * IN AE, A MISSING BRIDGE IS A REAL FAILURE AND MUST BE REPORTED AS ONE.
 * In the browser it just means there is no ExtendScript, so mock data is the
 * useful answer. `window.cep` is present only inside the CEP host.
 */
function mockOr(mock: ToolResult): ToolResult {
    if (typeof window !== "undefined" && (window as any).cep) {
        return { ok: false, reason: "No bridge to After Effects — couldn't read this. This is not the same as there being none." };
    }
    return mock;
}
