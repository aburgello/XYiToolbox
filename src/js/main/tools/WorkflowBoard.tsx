// =============================================================================
// src/js/main/tools/WorkflowBoard.tsx
// -----------------------------------------------------------------------------
// THE CHECKLIST A CREATIVE HAS TO BE LOCALISED BY.
//
// Every creative carries house rules that are in no spec sheet and derivable
// from no filename: Trio's title treatment, pedigree, tagline and date all come
// from Components rather than being rebuilt. Until now that lived in whoever
// did it last, or in a Slack message from four months ago.
//
// THE SPLIT THIS TOOL IS BUILT ON: steps and notes are SHARED, ticks are NOT.
// Steps and notes are what the team knows about the creative, so they belong to
// the creative -- one copy on the NAS, the same for everyone. A tick is one
// artist's progress through one job, and two people localising BR and FR on the
// same afternoon must not uncheck each other's boxes or open a board somebody
// else has already ticked through. See team.ts's WORKFLOW section.
//
// The creative is read off the OPEN PROJECT'S NAME with the localiser's own
// parser, so FID_INTL_Trio_DOOH_... is Trio here and in MC It! alike. Every
// part of that can come back empty -- nothing open, a scratch project, a file
// outside every known campaign -- and each of those is answered with a picker,
// never an error.
// =============================================================================
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
    ListChecks, Plus, X, Trash2, Pencil, Check, RotateCcw, StickyNote,
    RefreshCw, AlertCircle, FolderSearch, ChevronLeft, GripVertical, Users,
    ArrowRight, Link2, Link2Off, Search, Globe, FolderOpen, Wand2, MoreHorizontal,
} from "lucide-react";
import { TOOLS } from "../toolRegistry";
import { evalTS } from "../../lib/utils/bolt";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import { sfx } from "../../lib/utils/sfx";
import { confirmDialog } from "../Dialog";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import Droplet from "../Droplet";
import "../shared.scss";
import "./WorkflowBoard.scss";

/**
 * WHERE A STEP SENDS YOU.
 *
 * `tool` is a registry id, validated against TOOLS at render time -- a shared
 * file naming a tool that no longer exists renders a dead chip that says so,
 * and never navigates anywhere. `action` is the exact visible label of a button
 * inside that tool, shown on arrival so you know what to press.
 *
 * NAVIGATE, DON'T PRESS, and that boundary is deliberate. Several one-click
 * actions carry follow-up UI that only exists where they normally live -- MC
 * It! opens a report you pick overrides in, Cheeky T opens a review modal for
 * anything the filename couldn't answer. Firing those from here would run the
 * ExtendScript and drop the half of the feature that asks you questions. So a
 * link opens the page and names the button; you press it, with the tool's own
 * chrome around you.
 */
interface WorkflowLink { tool: string; action?: string }

interface WorkflowStep { id: string; text: string; link?: WorkflowLink }
interface WorkflowNote {
    id: string;
    text: string;
    author: string;
    stamp: string;
    /** ISO-3166 alpha-2, or absent. Notes are overwhelmingly per-territory --
     *  "for Brazil, watch the two-line gutters" -- and an untagged wall of them
     *  is a wall you have to read to find the two that apply to you. */
    territory?: string;
    links?: WorkflowNoteLink[];
    /** Free-form labels — "CTA", "TT". Upper-cased host-side so the vocabulary
     *  converges instead of fragmenting into three spellings of one tag. */
    tags?: string[];
}

/**
 * A word in a note that does something.
 *
 * "Check the **masters**" opens the folder; "run **Artwork Check**" opens the
 * tool. Same idea as a step's link, attached to a word rather than a row,
 * because a note is a sentence and the thing worth clicking is inside it.
 *
 * A SIDE TABLE rather than markup in the text -- see the host-side comment.
 * Exactly one of `path` / `tool` is set; a link with neither is dropped on the
 * way in, since a word that looks clickable and is not is worse than no link.
 */
interface WorkflowNoteLink {
    label: string;
    path?: string;
    tool?: string;
    action?: string;
}
interface Territory { name: string; code: string }
interface WorkflowEntry {
    id: string;
    campaign: string;
    creative: string;
    key: string;
    steps: WorkflowStep[];
    notes: WorkflowNote[];
    author: string;
    updatedAt: string;
}
interface CampaignRef { name: string; mastersRoot: string }

// Two states, matching StatusIcon and every other tool's toast styling. A
// third "info" tone was tried and removed: the only messages that wanted it
// (an unmounted share) must NOT be a toast at all -- a toast reads as a
// failure and vanishes before it can be acted on, so that one is the inline
// stale banner instead.
type Toast = { id: number; type: "success" | "error"; text: string };

/** Upper-case alphanumerics. MUST match team.ts's workflowCanon exactly -- the
 *  panel builds the same key to find an entry that the host builds to store it,
 *  and a drift between the two reads as "no workflow for this creative" on one
 *  that has one. */
function canon(s: string): string {
    return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function keyFor(campaign: string, creative: string): string {
    return canon(campaign) + "|" + canon(creative);
}

/**
 * A CREATIVE NAME, MADE READABLE.
 *
 * These arrive from two places and neither is written for a human:
 *
 *   the masters tree   Portal_to_paradise, International_payoff, Portal_brb
 *   the filename parser PORTALTOPARADISE  (upper-cased, because that is what
 *                                          matching needs)
 *
 * So: split on underscores, hyphens and camelCase boundaries, then decide each
 * word on its own.
 *
 * THE THREE RULES, and each exists because of a real name in one campaign:
 *
 *   - A SHORT LOWERCASE WORD IS A CODE, not a word. `Portal_brb` and
 *     `Portal_los` are BRB and LOS — territory and cut markers this studio
 *     writes in lower case — so a three-letter token is upper-cased.
 *   - EXCEPT A JOINING WORD. That rule alone turns `Portal_to_paradise` into
 *     "Portal TO Paradise", which is worse than what it replaced, so the
 *     handful of English words that legitimately appear mid-name stay lower.
 *   - AN EXISTING ACRONYM IS LEFT ALONE. `DOOH`, `OV`, `TT` are already
 *     upper-case and title-casing them would be actively wrong.
 *
 * A fully upper-case name has already lost its word boundaries — nothing can
 * recover "Portal To Paradise" from "PORTALTOPARADISE" without a dictionary —
 * so it is title-cased whole. That path is now rare: `workflowContext` carries
 * the creative's ORIGINAL spelling from the filename alongside the matching
 * token, precisely so this does not have to guess.
 */
const JOINERS = ["to", "of", "the", "and", "a", "an", "in", "on", "at", "for", "by", "vs", "or", "with"];

function prettyCreative(s: string): string {
    const raw = String(s || "").trim();
    if (!raw) return "";

    // NOTHING BUT CAPITALS IS SHOUTING, NOT ACRONYMS. `PORTAL_TO_PARADISE` and
    // `CHARMED TOOLKIT` are real folder names, and the "leave an acronym alone"
    // rule below read every word of them as an acronym and printed them back
    // unchanged. If the whole string is upper-case there is no acronym to
    // preserve — there is nothing to contrast it against — so it is lowered
    // first and re-cased by the same rules as anything else.
    const shouting = raw === raw.toUpperCase();
    const work = shouting ? raw.toLowerCase() : raw;

    // A single run of capitals with no separator is the parser's token
    // ("PORTALTOPARADISE"). Nothing can recover the word breaks, so it just
    // gets a leading capital.
    if (shouting && raw.indexOf("_") === -1 && raw.indexOf("-") === -1 && raw.indexOf(" ") === -1) {
        return raw.charAt(0) + raw.slice(1).toLowerCase();
    }

    const words = work
        .replace(/[_-]+/g, " ")
        // camelCase and PascalCase: "PortalToParadise" -> "Portal To Paradise".
        // The second pattern catches an acronym running into a word
        // ("DOOHMaster" -> "DOOH Master") rather than splitting the acronym.
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(/\s+/)
        .filter((w) => w !== "");

    return words.map((w, i) => {
        if (w === w.toUpperCase() && /[A-Z]/.test(w)) return w;          // already an acronym
        const lower = w.toLowerCase();
        if (i > 0 && JOINERS.indexOf(lower) !== -1) return lower;         // never the first word
        // THE CODE RULE NEEDS A MIXED-CASE NAME TO MEAN ANYTHING. `Portal_brb`
        // says "brb" is a code because somebody chose lower case for it while
        // choosing upper for Portal. In `PAW_PATROL_DINO` nothing was chosen —
        // it is all capitals — so applying it there gave "PAW Patrol Dino".
        // A shouting name loses that signal, and guessing without it is worse
        // than title-casing everything. (`FID_DOOH_MASTER` therefore comes back
        // as "Fid Dooh Master"; there is no way to tell those apart, and the
        // wrong-but-readable answer beats a wrong-and-shouty one.)
        if (!shouting && lower.length <= 3 && /^[a-z]+$/.test(w)) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
}

/** "Mon Aug 24 2026 17:13:46 GMT+0100" -> "24 Aug". The full stamp stays in
 *  the title attribute; a note list wants the short form. */
function shortStamp(stamp: string): string {
    const d = new Date(stamp);
    if (isNaN(d.getTime())) return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
}

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${uid++}`;

/**
 * `**bold**`, and NOTHING else.
 *
 * A step that reads "select the main comp (**not** the frontcard one)" needs
 * the one word carrying the whole instruction to be findable at a glance —
 * these get skimmed by somebody halfway through a job, not read.
 *
 * Deliberately not a markdown library and deliberately not `**` plus italics
 * plus links plus code. Steps and notes are typed into a small input by
 * somebody in a hurry; every extra syntax is another way to get a literal
 * asterisk on screen, and a link would duplicate what the step's own link chip
 * already does properly.
 *
 * REACT ELEMENTS, never `dangerouslySetInnerHTML`. This text arrives from a
 * shared file on the team folder, and while the people writing it are
 * colleagues, "trusted author" is not a reason to hand a string to an HTML
 * parser — the split below cannot produce markup at all.
 */
/** Regex-safe. A folder or a tool label can hold `(`, `+`, `[` -- the same trap
 *  CLAUDE.md records for `.match()` on a filename, one layer up. */
function escapeRe(s: string): string {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A note body: `**bold**` first, then any linked words inside what is left.
 *
 * BOLD IS RESOLVED FIRST and links are matched only within the plain runs, so
 * the two can never interleave into something neither of them meant. A label
 * that happens to sit inside a bold run simply stays bold and unlinked -- a
 * corner nobody will hit, and the alternative is a parser with two nesting
 * rules to get wrong.
 *
 * LONGEST LABEL FIRST, or "Artwork" would eat the front of "Artwork Check" and
 * leave " Check" dangling as plain text.
 */
function noteBody(
    text: string,
    links: WorkflowNoteLink[] | undefined,
    onOpen: (link: WorkflowNoteLink) => void,
): React.ReactNode {
    const usable = (links || []).filter((l) => l && l.label);
    if (!usable.length) return richText(text);

    const byLength = usable.slice().sort((a, b) => b.label.length - a.label.length);
    const re = new RegExp("(" + byLength.map((l) => escapeRe(l.label)).join("|") + ")", "gi");

    const linkify = (chunk: string, keyBase: string): React.ReactNode => {
        const parts = chunk.split(re);
        return parts.map((part, i) => {
            if (i % 2 === 0) return <React.Fragment key={keyBase + "-" + i}>{part}</React.Fragment>;
            const hit = byLength.filter((l) => l.label.toLowerCase() === part.toLowerCase())[0];
            if (!hit) return <React.Fragment key={keyBase + "-" + i}>{part}</React.Fragment>;
            return (
                <button
                    key={keyBase + "-" + i}
                    type="button"
                    className="wfb-inline-link"
                    onClick={() => onOpen(hit)}
                    title={hit.path
                        ? hit.path
                        : `Opens ${hit.tool}${hit.action ? ` — then press “${hit.action}”` : ""}`}
                >
                    {hit.path ? <FolderOpen size={9} /> : <ArrowRight size={9} />}
                    {part}
                </button>
            );
        });
    };

    const raw = String(text || "");
    if (raw.indexOf("**") === -1) return linkify(raw, "p");
    return raw.split(/\*\*([^*]+)\*\*/g).map((part, i) => (i % 2 === 1
        ? <strong key={"b" + i}>{part}</strong>
        : <React.Fragment key={"t" + i}>{linkify(part, "t" + i)}</React.Fragment>));
}

function richText(text: string): React.ReactNode {
    const raw = String(text || "");
    if (raw.indexOf("**") === -1) return raw;
    // Split KEEPING the delimiters' contents: odd indices are the bold runs.
    const parts = raw.split(/\*\*([^*]+)\*\*/g);
    return parts.map((part, i) => (i % 2 === 1
        ? <strong key={i}>{part}</strong>
        : <React.Fragment key={i}>{part}</React.Fragment>));
}

/** The registry entry a link points at, or null when it points at nothing.
 *  A shared file outlives a tool id: this is checked on every render rather
 *  than trusted, so a rename shows as a dead chip instead of a dead click. */
/**
 * The flag for an ISO code, built from regional indicator symbols.
 *
 * DEGRADES TO THE CODE ITSELF, which is why this is worth doing at all: a
 * platform without flag glyphs renders the two regional indicators as their
 * plain letters, so "BR" is what you see. There is no fallback to write —
 * the failure mode is already the right answer.
 *
 * Codes this codebase carries are not all two letters ("BE_FR" for Belgium
 * French); anything that is not exactly two A-Z characters gets no flag rather
 * than a wrong one.
 */
function flagFor(code: string): string {
    const c = String(code || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return "";
    return String.fromCodePoint(0x1f1e6 + (c.charCodeAt(0) - 65))
         + String.fromCodePoint(0x1f1e6 + (c.charCodeAt(1) - 65));
}

function toolFor(link: WorkflowLink | undefined) {
    if (!link || !link.tool) return null;
    return TOOLS.filter((t) => t.id === link.tool)[0] || null;
}

// ---------------------------------------------------------------------------
// "Take me there." The chip that turns a checklist into a route through the
// panel: press it and you land on the tool the step is about, with the button
// to press named before you go.
// ---------------------------------------------------------------------------
const StepLinkChip: React.FC<{
    link: WorkflowLink;
    onGo: (toolId: string) => void;
    disabled?: boolean;
}> = ({ link, onGo, disabled }) => {
    const entry = toolFor(link);
    if (!entry) {
        return (
            <span className="wfb-link wfb-link--dead" title={`This step links to "${link.tool}", which isn't a tool in this panel any more.`}>
                <Link2Off size={10} /> missing
            </span>
        );
    }
    // The button is NAMED, not pressed -- see WorkflowLink. Whether the label
    // still exists is checked too: a button renamed since the link was written
    // sends you to the right page with a name that is no longer there, and
    // saying nothing would be worse than saying "it moved".
    const known = link.action ? (entry.actions || []).indexOf(link.action) !== -1 : true;
    const hint = link.action
        ? (known
            ? `Opens ${entry.label} — then press “${link.action}”`
            : `Opens ${entry.label}. It no longer has a button called “${link.action}”.`)
        : `Opens ${entry.label}`;
    return (
        <Tooltip text={hint}>
            <button
                type="button"
                className="wfb-link"
                disabled={disabled}
                onClick={(e) => { e.stopPropagation(); onGo(entry.id); }}
            >
                <ArrowRight size={10} />
                <span>{entry.label}</span>
                {link.action && <em className={known ? undefined : "is-stale"}>{link.action}</em>}
            </button>
        </Tooltip>
    );
};

// ---------------------------------------------------------------------------
// Picking what a step links to. Tools first, then that tool's own buttons --
// both come straight off the registry, so a tool that isn't registered cannot
// be linked to and a button that doesn't exist cannot be named.
// ---------------------------------------------------------------------------
const LinkPicker: React.FC<{
    value?: WorkflowLink;
    /** The step being linked, echoed in the header. The picker drops below the
     *  whole list rather than inside its row, so without this there is nothing
     *  on screen saying which of seven steps you are pointing somewhere. */
    stepText: string;
    onPick: (link: WorkflowLink | undefined) => void;
    onClose: () => void;
}> = ({ value, stepText, onPick, onClose }) => {
    const [query, setQuery] = useState("");
    const [tool, setTool] = useState(value ? value.tool : "");
    const q = query.trim().toLowerCase();
    const matches = useMemo(() => {
        const all = TOOLS.slice().sort((a, b) => a.label.localeCompare(b.label));
        if (!q) return all;
        return all.filter((t) =>
            t.label.toLowerCase().indexOf(q) !== -1 ||
            t.id.toLowerCase().indexOf(q) !== -1 ||
            (t.categories || []).join(" ").toLowerCase().indexOf(q) !== -1);
    }, [q]);
    const chosen = TOOLS.filter((t) => t.id === tool)[0];

    return (
        <div className="wfb-linkpick">
            <div className="wfb-linkpick-for">
                <Link2 size={10} />
                <span>{stepText.trim() || "this step"}</span>
            </div>
            <div className="wfb-linkpick-head">
                <Search size={11} />
                <input
                    type="text"
                    autoFocus
                    value={query}
                    placeholder="Which tool should this step open?"
                    onChange={(e) => setQuery(e.target.value)}
                />
                <button type="button" className="wfb-mini" onClick={onClose} title="Close"><X size={11} /></button>
            </div>

            {!chosen && (
                <div className="wfb-linkpick-list">
                    {matches.map((t) => (
                        <button key={t.id} type="button" className="wfb-linkpick-row" onClick={() => setTool(t.id)}>
                            <t.icon size={12} />
                            <span className="wfb-linkpick-name">{t.label}</span>
                            <em>{(t.categories || []).join(" · ")}</em>
                        </button>
                    ))}
                    {matches.length === 0 && <p className="wfb-empty-line">No tool matches that.</p>}
                </div>
            )}

            {chosen && (
                <div className="wfb-linkpick-list">
                    <button type="button" className="wfb-linkpick-back" onClick={() => setTool("")}>
                        <ChevronLeft size={11} /> {chosen.label}
                    </button>
                    <button
                        type="button"
                        className="wfb-linkpick-row"
                        onClick={() => { onPick({ tool: chosen.id }); onClose(); }}
                    >
                        <ArrowRight size={12} />
                        <span className="wfb-linkpick-name">Just open it</span>
                    </button>
                    {(chosen.actions || []).map((a) => (
                        <button
                            key={a}
                            type="button"
                            className="wfb-linkpick-row"
                            onClick={() => { onPick({ tool: chosen.id, action: a }); onClose(); }}
                        >
                            <ArrowRight size={12} />
                            <span className="wfb-linkpick-name">…and press “{a}”</span>
                        </button>
                    ))}
                    {(chosen.actions || []).length === 0 && (
                        <p className="wfb-empty-line">This tool has no named buttons to point at.</p>
                    )}
                </div>
            )}

            {value && (
                <button type="button" className="wfb-linkpick-clear" onClick={() => { onPick(undefined); onClose(); }}>
                    <Link2Off size={11} /> Remove the link
                </button>
            )}
        </div>
    );
};

/**
 * THE THREE CURVES, and there are only three.
 *
 * Personality: PHYSICAL — the checklist should feel like objects you press,
 * not rows you click. Springs everywhere something arrives or settles, one
 * cubic-bezier for hover feedback (spring overshoot on hover reads as jitter).
 *
 * Framer's springs, NOT CSS `linear()`: that whole palette is Chrome 113 and
 * the build target is chrome74, so JS-computed physics is the only real spring
 * available here. It is also the better one — Framer carries velocity through
 * an interruption, which matters when somebody ticks four boxes in a second.
 */
const SPRING = {
    /** Arrivals: rows, chips, notes. Fast, barely overshoots. */
    snappy: { type: "spring", stiffness: 400, damping: 30, mass: 1 },
    /** Settles: the progress ring, panel-level position. */
    smooth: { type: "spring", stiffness: 200, damping: 24, mass: 1 },
    /** The tick itself, and only the tick. A small element, pressed rarely
     *  enough per session that a real pop is a reward rather than a tax. */
    bouncy: { type: "spring", stiffness: 500, damping: 18, mass: 1 },
} as const;
/** Hover only. */
const SNAP = { type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

const WorkflowBoardTool: React.FC<{
    onSelectTool?: (toolId: string) => void;
    /** "panel" is the floating bubble: tighter, and it drops the chrome the
     *  tool page already draws around it. */
    variant?: "page" | "panel";
}> = ({ onSelectTool, variant }) => {
    const reduced = useReducedMotion();
    const panel = variant === "panel";

    const [entries, setEntries] = useState<WorkflowEntry[]>([]);
    // "Couldn't read" is NOT "nothing there". A failed read must never blank a
    // board that was on screen a moment ago -- it goes stale, and says so.
    const [boardRead, setBoardRead] = useState(false);
    const [stale, setStale] = useState(false);
    const [me, setMe] = useState("");

    const [campaigns, setCampaigns] = useState<CampaignRef[]>([]);
    /** Lower-cased name -> who retired it. Best-effort: an unreachable team
     *  folder leaves this empty, which shows every campaign as live rather than
     *  greying the lot — the same "no data is not the same as couldn't read"
     *  rule the board itself follows. */
    const [retired, setRetired] = useState<Record<string, string>>({});
    const [detected, setDetected] = useState<{ project: string; creative: string; campaign: string }>({
        project: "", creative: "", campaign: "",
    });
    // What the board is SHOWING, which starts as what was detected and then
    // follows the picker.
    const [campaign, setCampaign] = useState("");
    const [creative, setCreative] = useState("");

    const [picking, setPicking] = useState(false);
    const [pickCampaign, setPickCampaign] = useState("");
    const [folderCreatives, setFolderCreatives] = useState<string[] | null>(null);
    const [scanning, setScanning] = useState(false);
    /** Filters the creative list. A campaign can carry twenty folders and the
     *  one you want is rarely near the top alphabetically. */
    const [creativeQuery, setCreativeQuery] = useState("");

    const [ticks, setTicks] = useState<Record<string, Record<string, boolean>>>({});
    const [editing, setEditing] = useState(false);
    const [draftSteps, setDraftSteps] = useState<WorkflowStep[]>([]);
    const [noteDraft, setNoteDraft] = useState("");
    // The territory being attached to the note being typed, and the picker's
    // open state. Both reset after a post: a tag is per-note, and a sticky one
    // would quietly file the next three notes under Brazil.
    const [noteTerritory, setNoteTerritory] = useState("");
    const [terrPickerOpen, setTerrPickerOpen] = useState(false);
    // Fetched once per campaign root, lazily -- the picker is the only thing
    // that needs it and most sessions never open it.
    const [territories, setTerritories] = useState<{ markets: Territory[]; all: Territory[] } | null>(null);
    /** Reading the notes, not writing one: "" is every territory. */
    const [terrFilter, setTerrFilter] = useState("");
    /** Links being attached to the note being typed. */
    const [noteLinks, setNoteLinks] = useState<WorkflowNoteLink[]>([]);
    /** The word chosen to link, while its destination is still being picked.
     *  "" means the word chooser is closed. */
    const [linkWord, setLinkWord] = useState("");
    const [wordPicking, setWordPicking] = useState(false);
    const [toolPicking, setToolPicking] = useState(false);
    /** Tags on the note being typed, and the box they are typed into. */
    const [noteTags, setNoteTags] = useState<string[]>([]);
    const [tagDraft, setTagDraft] = useState("");
    /** Reading, not writing: "" is every tag. */
    const [tagFilter, setTagFilter] = useState("");
    const noteSel = useSelection(noteDraft);
    const [busy, setBusy] = useState(false);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastSeq = useRef(0);

    const toast = useCallback((type: Toast["type"], text: string) => {
        const id = ++toastSeq.current;
        setToasts((t) => [...t, { id, type, text }]);
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
    }, []);

    // --- loading ------------------------------------------------------------

    const loadBoard = useCallback(async (announce: boolean) => {
        try {
            const r = (await evalTS("workflowBoardLoad")) as {
                success: boolean; read?: boolean; entries?: WorkflowEntry[]; me?: string; error?: string;
            };
            if (!r || !r.success) { setStale(true); return; }
            setMe(r.me || "");
            if (r.read) {
                setEntries(r.entries || []);
                setBoardRead(true);
                setStale(false);
                if (announce) toast("success", "Board reloaded.");
            } else {
                // An unmounted share is a NORMAL state on a laptop at home --
                // never an error toast. Keep whatever is on screen and mark it.
                setStale(true);
            }
        } catch {
            setStale(true);
        }
    }, [toast]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const ctx = (await evalTS("workflowContext")) as {
                    success: boolean; project?: string; creative?: string; creativeLabel?: string;
                    campaign?: string; campaigns?: CampaignRef[];
                };
                if (cancelled || !ctx || !ctx.success) return;
                // THE FILENAME'S OWN SPELLING where there is one. The matching
                // token is upper-cased and that is lossy: "PORTALTOPARADISE"
                // formats to "Portaltoparadise" and nothing can do better,
                // while "PortalToParadise" formats to "Portal To Paradise".
                // Matching still canonicalises, so the two stay interchangeable.
                const label = ctx.creativeLabel || ctx.creative || "";
                setDetected({ project: ctx.project || "", creative: label, campaign: ctx.campaign || "" });
                setCampaigns(ctx.campaigns || []);
                setCampaign(ctx.campaign || "");
                setCreative(label);
                setPickCampaign(ctx.campaign || "");
            } catch {
                /* nothing open, or AE busy -- the picker covers it */
            }
            try {
                const t = (await evalTS("workflowTicksLoad")) as { success: boolean; message?: string };
                if (!cancelled && t && t.success && t.message) setTicks(JSON.parse(t.message));
            } catch {
                /* a corrupt tick store starts empty rather than breaking the tool */
            }
            try {
                const board = (await evalTS("teamCampaignBoard")) as {
                    read?: boolean; rows?: { name: string; retiredBy: string }[];
                } | null;
                if (!cancelled && board && board.read) {
                    const next: Record<string, string> = {};
                    (board.rows || []).forEach((r) => { if (r.retiredBy) next[r.name.toLowerCase()] = r.retiredBy; });
                    setRetired(next);
                }
            } catch {
                /* team folder unreachable -- nothing is greyed, which is right:
                   "couldn't ask" must not render as "nothing is retired" in one
                   direction or "everything is" in the other. */
            }
            if (!cancelled) await loadBoard(false);
        })();
        return () => { cancelled = true; };
    }, [loadBoard]);

    // --- the entry on screen -------------------------------------------------

    const activeKey = keyFor(campaign, creative);
    const entry = useMemo(
        () => entries.filter((e) => e.key === activeKey)[0] || null,
        [entries, activeKey]
    );

    /** Every creative that already has a workflow on THIS campaign. */
    const creativesWithWorkflow = useMemo(() => {
        const want = canon(campaign);
        return entries
            .filter((e) => canon(e.campaign) === want)
            .map((e) => e.creative)
            .sort((a, b) => a.localeCompare(b));
    }, [entries, campaign]);

    const myTicks = ticks[activeKey] || {};
    const doneCount = entry ? entry.steps.filter((s) => myTicks[s.id]).length : 0;
    /** Where you are. -1 once everything is done, so nothing is lit at the end
     *  — a finished route should read as finished, not as still pointing
     *  somewhere. */
    const firstUndone = useMemo(() => {
        if (!entry) return -1;
        for (let i = 0; i < entry.steps.length; i++) {
            if (!myTicks[entry.steps[i].id]) return i;
        }
        return -1;
    }, [entry, myTicks]);

    const persistTicks = useCallback(async (next: Record<string, Record<string, boolean>>) => {
        setTicks(next);
        try { await evalTS("workflowTicksSave", JSON.stringify(next)); } catch { /* local only; not worth a toast */ }
    }, []);

    /** The campaign's own root, for the territory scan. */
    const campaignRoot = useMemo(() => {
        const hit = campaigns.filter((c) => c.name === campaign)[0];
        return hit ? hit.mastersRoot : "";
    }, [campaigns, campaign]);

    useEffect(() => {
        if (!terrPickerOpen || territories !== null) return;
        let cancelled = false;
        (async () => {
            try {
                const r = (await evalTS("workflowTerritories", campaignRoot)) as {
                    success: boolean; markets?: Territory[]; all?: Territory[];
                };
                if (cancelled || !r || !r.success) return;
                setTerritories({ markets: r.markets || [], all: r.all || [] });
            } catch {
                // An unmounted share is a normal state: the picker says it
                // couldn't look rather than claiming the campaign has none.
                if (!cancelled) setTerritories({ markets: [], all: [] });
            }
        })();
        return () => { cancelled = true; };
    }, [terrPickerOpen, territories, campaignRoot]);

    /** Display name for a stored code. Falls back to the code, which is already
     *  the useful half — a note tagged BR reads fine as "BR". */
    const territoryName = useCallback((code: string) => {
        if (!territories) return code;
        const all = territories.markets.concat(territories.all);
        const hit = all.filter((t) => t.code === code)[0];
        return hit ? hit.name : code;
    }, [territories]);

    /**
     * Follow a step's link.
     *
     * `onSelectTool` is the prop both screens that mount a tool already pass
     * (ToolScreen and LocaliseScreen), so this is the panel's own tool-to-tool
     * channel rather than a second one -- and deliberately NOT the agent's
     * navigator, which lives in lib/agent and would tie this feature to the
     * agent's removal.
     */
    const goTo = useCallback((toolId: string) => {
        if (!onSelectTool) {
            toast("error", "This screen can't navigate — open Workflows from the Localise screen.");
            return;
        }
        sfx.click();
        onSelectTool(toolId);
    }, [onSelectTool, toast]);

    const toggleStep = (stepId: string) => {
        const forKey = { ...(ticks[activeKey] || {}) };
        if (forKey[stepId]) delete forKey[stepId];
        else forKey[stepId] = true;
        sfx.click();
        persistTicks({ ...ticks, [activeKey]: forKey });
    };

    const resetTicks = async () => {
        if (doneCount === 0) return;
        const next = { ...ticks };
        delete next[activeKey];
        await persistTicks(next);
        toast("success", "Checklist reset for the next job.");
    };

    // --- editing the shared steps -------------------------------------------

    const startEditing = () => {
        setDraftSteps(entry ? entry.steps.map((s) => ({ ...s })) : []);
        setEditing(true);
    };

    const startNew = () => {
        // Seeded, not empty. A blank first screen is where a shared checklist
        // dies -- these four are the ones that came up by name.
        setDraftSteps(["Title treatment from Components", "Pedigree from Components", "Tagline from Components", "Date from Components"]
            .map((text) => ({ id: nextId("step"), text })));
        setEditing(true);
    };

    const saveSteps = async () => {
        const steps = draftSteps
            .map((s) => ({ ...s, text: s.text.trim() }))
            .filter((s) => s.text !== "");
        if (!creative) { toast("error", "Pick a creative first."); return; }

        // THE CONFIRM BELONGS AT THE IRREVERSIBLE MOMENT, not at every click in
        // the editor. Removing a step there is a draft edit that Cancel already
        // throws away; pressing Save is what reaches the team folder and cannot
        // be undone. So the question is asked once, here, and names exactly
        // what will be lost rather than asking "are you sure" about a list.
        if (entry) {
            const kept: Record<string, boolean> = {};
            steps.forEach((st) => { kept[st.id] = true; });
            const dropped = entry.steps.filter((st) => !kept[st.id]);
            if (dropped.length) {
                const ok = await confirmDialog(
                    `Save, removing ${dropped.length} step${dropped.length === 1 ? "" : "s"} for the whole team?\n\n` +
                    dropped.map((st) => "· " + st.text).join("\n") +
                    "\n\nThere is no undo."
                );
                if (!ok) return;
            }
        }

        setBusy(true);
        const payload: WorkflowEntry = {
            id: entry ? entry.id : "",
            campaign,
            creative,
            key: activeKey,
            steps,
            notes: entry ? entry.notes : [],
            author: entry ? entry.author : me,
            updatedAt: "",
        };
        // ONE JSON STRING across the bridge. Nested arrays-of-objects lose
        // their values when spliced into eval'd ExtendScript source.
        const r = (await evalTSSafe("workflowSaveEntry", JSON.stringify(payload))) as {
            success: boolean; error?: string; entries?: WorkflowEntry[]; read?: boolean;
        };
        setBusy(false);
        if (!r || !r.success) { toast("error", (r && r.error) || "Couldn't save."); return; }
        if (r.entries) { setEntries(r.entries); setBoardRead(true); setStale(false); }
        setEditing(false);
        sfx.click();
        toast("success", `Saved ${prettyCreative(creative)}'s workflow for the team.`);
    };

    const deleteEntry = async () => {
        if (!entry) return;
        const ok = await confirmDialog(
            `Delete the whole ${prettyCreative(entry.creative)} workflow for everyone?\n\n` +
            `${entry.steps.length} step${entry.steps.length === 1 ? "" : "s"} and ` +
            `${entry.notes.length} note${entry.notes.length === 1 ? "" : "s"} go with it.`
        );
        if (!ok) return;
        setBusy(true);
        const r = (await evalTSSafe("workflowDeleteEntry", entry.id)) as {
            success: boolean; error?: string; entries?: WorkflowEntry[];
        };
        setBusy(false);
        if (!r || !r.success) { toast("error", (r && r.error) || "Couldn't delete."); return; }
        if (r.entries) setEntries(r.entries);
        toast("success", "Workflow removed from the team board.");
    };

    // --- notes ---------------------------------------------------------------

    /** Distinct words in the note being typed, in order, for the chooser.
     *  Punctuation is stripped so clicking "masters." attaches to "masters" --
     *  the label has to match what the renderer will find in the body. */
    const draftWords = useMemo(() => {
        const seen: Record<string, boolean> = {};
        const out: string[] = [];
        noteDraft.split(/\s+/).forEach((w) => {
            const clean = w.replace(/^[^\w&'-]+|[^\w&'-]+$/g, "");
            if (!clean) return;
            const key = clean.toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            out.push(clean);
        });
        return out;
    }, [noteDraft]);

    /** Every tag already on this board, for the suggestion row -- the whole
     *  reason the vocabulary stays small is that the tag you want is usually
     *  one somebody already typed. */
    const knownTags = useMemo(() => {
        const seen: Record<string, boolean> = {};
        const out: string[] = [];
        entries.forEach((e) => (e.notes || []).forEach((n) => (n.tags || []).forEach((t) => {
            if (seen[t]) return;
            seen[t] = true;
            out.push(t);
        })));
        return out.sort();
    }, [entries]);

    const addTag = (raw: string) => {
        const tag = raw.toUpperCase().replace(/[^A-Z0-9 \-]/g, "").replace(/\s+/g, " ").trim();
        if (!tag || tag.length > 24) return;
        setNoteTags((prev) => (prev.indexOf(tag) === -1 ? prev.concat([tag]) : prev));
        setTagDraft("");
    };

    const attachLink = (link: WorkflowNoteLink) => {
        setNoteLinks((prev) => prev.filter((l) => l.label.toLowerCase() !== link.label.toLowerCase()).concat([link]));
        setLinkWord("");
        setWordPicking(false);
        setToolPicking(false);
    };

    /** Pick a folder for the chosen word. The picker is a real OS dialog on the
     *  host side, so this can sit for as long as somebody browses -- evalTS
     *  rather than evalTSSafe, whose 15s timeout would report an ordinary
     *  decision as a failure. */
    const attachFolder = async (word: string) => {
        try {
            const path = (await evalTS("workflowSelectFolder")) as string;
            // Cancelled. Not an error, and not a toast.
            if (!path) { setLinkWord(""); setWordPicking(false); return; }
            attachLink({ label: word, path });
        } catch {
            toast("error", "Couldn't open the folder picker.");
            setLinkWord("");
            setWordPicking(false);
        }
    };

    const addNote = async () => {
        const body = noteDraft.trim();
        if (!body || !entry) return;
        setBusy(true);
        // ONE JSON STRING for the links: an array of objects spliced into
        // eval'd ExtendScript source loses its values in transit.
        const r = (await evalTSSafe("workflowAddNote", entry.id, body, noteTerritory, JSON.stringify(noteLinks), JSON.stringify(noteTags))) as {
            success: boolean; error?: string; entries?: WorkflowEntry[];
        };
        setBusy(false);
        if (!r || !r.success) { toast("error", (r && r.error) || "Couldn't post the note."); return; }
        if (r.entries) setEntries(r.entries);
        setNoteDraft("");
        setNoteTerritory("");
        setNoteLinks([]);
        setNoteTags([]);
        setTagDraft("");
        setLinkWord("");
        setWordPicking(false);
        setTerrPickerOpen(false);
        sfx.click();
    };

    /** Follow a note's inline link: a folder in Finder, or a tool in the panel. */
    const openNoteLink = useCallback(async (link: WorkflowNoteLink) => {
        if (link.path) {
            sfx.click();
            // revealUsefulFolder gates on Folder.exists, which CLAUDE.md allows
            // precisely here: `.exists` is only untrustworthy on a FILE over the
            // NAS, and this is a directory.
            const r = (await evalTSSafe("revealUsefulFolder", link.path)) as { success: boolean; error?: string };
            if (r && !r.success) toast("error", r.error || "Couldn't open that folder.");
            return;
        }
        if (link.tool) goTo(link.tool);
    }, [goTo, toast]);

    const removeNote = async (noteId: string) => {
        if (!entry) return;
        const note = entry.notes.filter((n) => n.id === noteId)[0];
        // CONFIRMED, AND THE NOTE IS QUOTED. This is a shared file with no undo
        // and no version history: a mis-click here loses somebody's writing
        // permanently, and "are you sure?" without saying WHICH note is a
        // question you cannot actually answer when four of them are on screen.
        const ok = await confirmDialog(
            "Delete this note?\n\n" +
            "“" + (note ? note.text : "") + "”\n\n" +
            "It goes for the whole team, and there is no undo."
        );
        if (!ok) return;
        const r = (await evalTSSafe("workflowDeleteNote", entry.id, noteId)) as {
            success: boolean; error?: string; entries?: WorkflowEntry[];
        };
        if (!r || !r.success) { toast("error", (r && r.error) || "Couldn't remove the note."); return; }
        if (r.entries) setEntries(r.entries);
    };

    // --- the picker ----------------------------------------------------------

    const openPicker = async () => {
        // NEVER LAND ON A RETIRED CAMPAIGN. This used to be `campaigns[0]`,
        // which is whichever was added to this machine first — and a machine
        // that has been going a while has a finished campaign there. Opening
        // the picker on one you cannot even select, every time, made the
        // greying look broken rather than deliberate.
        const live = campaigns.filter((c) => !retired[c.name.toLowerCase()]);
        const fallback = live[0] || campaigns[0];
        setPickCampaign(campaign || (fallback ? fallback.name : ""));
        setPicking(true);
    };

    /** The campaign's creatives read off the masters tree, so a creative nobody
     *  has written a workflow for is still offerable. An unmounted share gives
     *  null, which the UI reports as "couldn't look" rather than "none". */
    useEffect(() => {
        if (!picking || !pickCampaign) { setFolderCreatives(null); return; }
        const camp = campaigns.filter((c) => c.name === pickCampaign)[0];
        if (!camp || !camp.mastersRoot) { setFolderCreatives(null); return; }
        let cancelled = false;
        setScanning(true);
        (async () => {
            try {
                const names = (await evalTS("scanCreatives", camp.mastersRoot)) as string[] | null;
                if (!cancelled) setFolderCreatives(names && names.length ? names : null);
            } catch {
                if (!cancelled) setFolderCreatives(null);
            } finally {
                if (!cancelled) setScanning(false);
            }
        })();
        return () => { cancelled = true; };
    }, [picking, pickCampaign, campaigns]);

    /** Everything offerable for the picked campaign: what the tree has, plus
     *  anything the board already carries that the tree didn't show. */
    const pickable = useMemo(() => {
        const seen: Record<string, boolean> = {};
        const out: { name: string; steps: number; notes: number; hasWorkflow: boolean }[] = [];
        const want = canon(pickCampaign);
        const mine = entries.filter((e) => canon(e.campaign) === want);
        const wf: Record<string, WorkflowEntry> = {};
        mine.forEach((e) => { wf[canon(e.creative)] = e; });

        const push = (name: string) => {
            const c = canon(name);
            if (seen[c]) return;
            seen[c] = true;
            const hit = wf[c];
            out.push({
                name,
                steps: hit ? hit.steps.length : 0,
                notes: hit ? (hit.notes || []).length : 0,
                hasWorkflow: !!hit,
            });
        };
        (folderCreatives || []).forEach(push);
        // A creative with a workflow but no folder on disk still has to be
        // reachable -- the folder may be on a share that is not mounted.
        mine.forEach((e) => push(e.creative));

        // WHAT THE TEAM HAS WRITTEN COMES FIRST. Alphabetical put a folder
        // nobody has documented above the workflow you were looking for, which
        // is the wrong way round for a list you open to find a workflow.
        return out.sort((a, b) => {
            if (a.hasWorkflow !== b.hasWorkflow) return a.hasWorkflow ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }, [folderCreatives, entries, pickCampaign]);

    const pickableShown = useMemo(() => {
        const q = creativeQuery.trim().toLowerCase();
        if (!q) return pickable;
        return pickable.filter((c) =>
            c.name.toLowerCase().indexOf(q) !== -1 ||
            prettyCreative(c.name).toLowerCase().indexOf(q) !== -1);
    }, [pickable, creativeQuery]);

    const choose = (campName: string, creativeName: string) => {
        setCampaign(campName);
        setCreative(creativeName);
        setPicking(false);
        setEditing(false);
    };

    // --- render --------------------------------------------------------------

    const ease = reduced ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
    const rowDelay = (i: number) => (reduced ? 0 : Math.min(i, 12) * 0.035);

    return (
        <div className={"workflow-board" + (panel ? " is-panel" : "")}>
            {/* ── who am I looking at ──────────────────────────────────── */}
            <div className="wfb-head">
                <div className="wfb-id">
                    <ListChecks size={15} className="wfb-id-icon" />
                    <div className="wfb-id-text">
                        <span className="wfb-id-creative">
                            {creative ? prettyCreative(creative) : "No creative picked"}
                        </span>
                        <span className="wfb-id-sub">
                            {campaign || "no campaign"}
                            {detected.project && detected.creative === creative && detected.campaign === campaign
                                ? <em> · from {detected.project}</em>
                                : null}
                        </span>
                    </div>
                </div>

                <div className="wfb-head-actions">
                    <Tooltip text="Pick a different creative">
                        <button type="button" className="wfb-btn" onClick={openPicker}>
                            <FolderSearch size={12} /><span>Change</span>
                        </button>
                    </Tooltip>
                    <Tooltip text="Re-read the team board">
                        <button type="button" className="wfb-btn wfb-btn--icon" onClick={() => loadBoard(true)}>
                            <RefreshCw size={12} />
                        </button>
                    </Tooltip>
                </div>
            </div>

            {stale && (
                <div className="wfb-stale">
                    <AlertCircle size={11} />
                    <span>
                        {boardRead
                            ? "Team folder unreachable — this is the last board that was read, not live."
                            : "Team folder unreachable. Set it in the Team menu, or mount the share."}
                    </span>
                </div>
            )}

            {/* ── the picker ───────────────────────────────────────────── */}
            <AnimatePresence initial={false}>
                {picking && (
                    <motion.div
                        className="wfb-picker"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={ease}
                    >
                        <div className="wfb-picker-head">
                            <button type="button" className="wfb-btn wfb-btn--icon" onClick={() => setPicking(false)}>
                                <ChevronLeft size={12} />
                            </button>
                            <span>Which creative?</span>
                        </div>

                        <div className="wfb-camps">
                            {campaigns.length === 0 && (
                                <p className="wfb-empty-line">
                                    No campaigns saved yet — add one in OV Library or Localised Library first.
                                </p>
                            )}
                            {campaigns.map((c) => {
                                // A FINISHED CAMPAIGN IS NOT A PLACE TO WRITE A
                                // WORKFLOW. Greyed and unclickable here for the
                                // same reason as in the other two pickers, and
                                // listed rather than hidden so "where did it
                                // go" never comes up. The one you are already
                                // on stays clickable: a campaign retired while
                                // you had it open must not strand you with a
                                // board you cannot get back to.
                                const off = !!retired[c.name.toLowerCase()] && c.name !== pickCampaign;
                                return (
                                    <button
                                        key={c.name}
                                        type="button"
                                        className={"wfb-camp"
                                            + (c.name === pickCampaign ? " is-on" : "")
                                            + (off ? " is-retired" : "")}
                                        aria-disabled={off || undefined}
                                        title={off ? `Retired by ${retired[c.name.toLowerCase()]}` : undefined}
                                        onClick={() => { if (!off) setPickCampaign(c.name); }}
                                    >
                                        {c.name}
                                        {off && <em>retired</em>}
                                    </button>
                                );
                            })}
                        </div>

                        {/* A SEARCH, because a campaign carries twenty folders
                            and the one you want is rarely near the top
                            alphabetically. Only when there is enough to hunt
                            through — under about eight it is faster to read. */}
                        {pickable.length > 8 && (
                            <div className="wfb-creative-search">
                                <Search size={11} />
                                <input
                                    type="text"
                                    value={creativeQuery}
                                    placeholder="Find a creative…"
                                    onChange={(e) => setCreativeQuery(e.target.value)}
                                />
                                {creativeQuery && (
                                    <button type="button" className="wfb-mini" onClick={() => setCreativeQuery("")} title="Clear">
                                        <X size={10} />
                                    </button>
                                )}
                            </div>
                        )}

                        <div className="wfb-creatives">
                            {scanning && <p className="wfb-empty-line">Reading the masters tree…</p>}
                            {!scanning && pickable.length === 0 && (
                                <p className="wfb-empty-line">
                                    {folderCreatives === null
                                        ? "Couldn't read that campaign's AE folder — the share may not be mounted. You can still type a creative below."
                                        : "No creatives found for that campaign."}
                                </p>
                            )}
                            {!scanning && pickable.length > 0 && pickableShown.length === 0 && (
                                <p className="wfb-empty-line">Nothing matches “{creativeQuery}”.</p>
                            )}
                            {pickableShown.map((c, i) => {
                                // The divider between documented and not, drawn
                                // once at the boundary rather than as two
                                // separate lists — one list you can scan beats
                                // two you have to notice.
                                const first = i > 0 && pickableShown[i - 1].hasWorkflow && !c.hasWorkflow;
                                return (
                                    <React.Fragment key={c.name}>
                                        {first && <p className="wfb-creative-sep">Nothing written down yet</p>}
                                        <motion.button
                                            type="button"
                                            className={"wfb-creative" + (c.hasWorkflow ? " has-wf" : "")}
                                            onClick={() => choose(pickCampaign, c.name)}
                                            initial={{ opacity: 0, y: 4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={reduced ? { duration: 0 } : { ...SPRING.snappy, delay: rowDelay(i) }}
                                        >
                                            <span className="wfb-creative-name">{prettyCreative(c.name)}</span>
                                            {c.hasWorkflow && (
                                                <span className="wfb-creative-meta">
                                                    <span className="wfb-creative-count" title={`${c.steps} step${c.steps === 1 ? "" : "s"}`}>
                                                        <ListChecks size={9} />{c.steps}
                                                    </span>
                                                    {c.notes > 0 && (
                                                        <span className="wfb-creative-count" title={`${c.notes} note${c.notes === 1 ? "" : "s"}`}>
                                                            <StickyNote size={9} />{c.notes}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                        </motion.button>
                                    </React.Fragment>
                                );
                            })}
                        </div>

                        {/* THE LAST RESORT, AND IT HAS TO EXIST. A creative
                            whose folder is named differently, a campaign that
                            isn't saved, a share that isn't mounted -- none of
                            those should stop somebody writing the checklist
                            down while they still remember it. */}
                        <TypeItIn
                            onPick={(name) => choose(pickCampaign, name)}
                            campaignName={pickCampaign}
                            campaigns={campaigns}
                            onCampaign={setPickCampaign}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── the checklist ────────────────────────────────────────── */}
            {!picking && (
                <div className="wfb-body">
                    {!creative && (
                        <div className="wfb-empty">
                            <ListChecks size={26} />
                            <p>Nothing open that names a creative.</p>
                            <span>
                                Open a working file — or use Change to pick a creative for any campaign.
                            </span>
                        </div>
                    )}

                    {creative && !entry && !editing && (
                        <div className="wfb-empty">
                            <ListChecks size={26} />
                            <p>No workflow saved for {prettyCreative(creative)}{campaign ? ` on ${campaign}` : ""}.</p>
                            <span>Write down what this one needs and the whole team gets it.</span>
                            <button type="button" className="wfb-btn wfb-btn--primary" onClick={startNew}>
                                <Plus size={12} /><span>Start one</span>
                            </button>
                            {creativesWithWorkflow.length > 0 && (
                                <div className="wfb-others">
                                    <span className="wfb-others-label">This campaign already has:</span>
                                    {creativesWithWorkflow.map((name) => (
                                        <button key={name} type="button" className="wfb-chip" onClick={() => setCreative(name)}>
                                            {prettyCreative(name)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {editing && (
                        <StepEditor
                            steps={draftSteps}
                            setSteps={setDraftSteps}
                            busy={busy}
                            onCancel={() => setEditing(false)}
                            onSave={saveSteps}
                            ease={ease}
                            rowDelay={rowDelay}
                        />
                    )}

                    {entry && !editing && (
                        <>
                            {/* A ROUTE, NOT A LIST OF ROWS.
                                The small flat rows read as a form to fill in;
                                what this actually is, is an order of
                                operations that ends with the job done — and
                                half the steps hand you on to another tool. So
                                the steps are numbered nodes on a rail, the rail
                                fills in behind you as you go, and each step is
                                a card you press rather than a line you click.
                                The metaphor is the same one the launcher icon
                                carries. */}
                            <ol className="wfb-steps">
                                {entry.steps.map((s, i) => {
                                    const on = !!myTicks[s.id];
                                    // WHERE YOU ARE: the first step not yet
                                    // done. A checklist is a set of independent
                                    // boxes; a route has a position, and this
                                    // is a route — so one step is lit and the
                                    // rest are context around it.
                                    const current = !on && i === firstUndone;
                                    // The rail segment ABOVE this node is
                                    // travelled once the step before it is
                                    // done — so the line fills behind you.
                                    const prevOn = i > 0 && !!myTicks[entry.steps[i - 1].id];
                                    return (
                                        <motion.li
                                            key={s.id}
                                            className={"wfb-step"
                                                + (on ? " is-done" : "")
                                                + (current ? " is-current" : "")}
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={reduced ? { duration: 0 } : { ...SPRING.snappy, delay: rowDelay(i) }}
                                        >
                                            {/* THE RAIL IS TWO HALVES PER ROW, not
                                                one stub between them.

                                                It was a single 11px line at the
                                                top of each row, which only ever
                                                reached the node above when every
                                                row was the same height. The
                                                current step's card is taller,
                                                and a two-line step taller again
                                                — so the very first joint was
                                                missing while the rest looked
                                                fine.

                                                Now each row draws from its top
                                                edge to its node, and from its
                                                node to its bottom edge, in CSS
                                                pseudo-elements that stretch with
                                                whatever height the row turns out
                                                to be. The two halves of one
                                                joint are driven by the same
                                                step's done-ness, so they always
                                                agree. */}
                                            <span
                                                className={"wfb-rail"
                                                    + (i === 0 ? " is-first" : "")
                                                    + (i === entry.steps.length - 1 ? " is-last" : "")
                                                    + (prevOn ? " above-on" : "")
                                                    + (on ? " below-on" : "")}
                                                aria-hidden="true"
                                            >
                                                <span className={"wfb-node" + (on ? " is-on" : "") + (current ? " is-current" : "")}>
                                                    {on
                                                        ? <Check size={11} strokeWidth={3} />
                                                        : <span className="wfb-node-num">{i + 1}</span>}
                                                </span>
                                            </span>

                                            {/* PRESSED, NOT CLICKED. whileTap
                                                compresses the whole card, which
                                                is the cheapest thing that makes
                                                a control feel like an object.
                                                Framer owns the transform here,
                                                so the card's hover is a surface
                                                change — never a CSS transform,
                                                which would be overwritten. */}
                                            <motion.div
                                                className="wfb-step-card"
                                                whileTap={reduced ? undefined : { scale: 0.985 }}
                                                transition={SNAP}
                                            >
                                                {/* NO CHECKBOX. The row IS the
                                                    control: a numbered route
                                                    with one step lit says where
                                                    you are far better than four
                                                    identical empty squares, and
                                                    the box was costing 20px of
                                                    a 380px panel to say nothing
                                                    the node does not already.
                                                    A BUTTON, not a div with a
                                                    click handler, so it is
                                                    focusable and Enter works —
                                                    and a sibling of the link
                                                    chip rather than its parent,
                                                    because a button inside a
                                                    button is invalid and the
                                                    inner one stops firing. */}
                                                <button
                                                    type="button"
                                                    className="wfb-step-hit"
                                                    aria-pressed={on}
                                                    onClick={() => toggleStep(s.id)}
                                                >
                                                    <span className="wfb-step-textwrap">
                                                        <span className="wfb-step-text">{richText(s.text)}</span>
                                                        {/* Sweeps rather than appears, which is
                                                            the difference between a tick that
                                                            feels like progress and one that
                                                            feels like a redraw. */}
                                                        <motion.span
                                                            className="wfb-step-strike"
                                                            initial={false}
                                                            animate={{ scaleX: on ? 1 : 0 }}
                                                            transition={reduced ? { duration: 0 } : SPRING.snappy}
                                                        />
                                                    </span>
                                                </button>
                                                {s.link && <StepLinkChip link={s.link} onGo={goTo} />}
                                            </motion.div>
                                        </motion.li>
                                    );
                                })}
                                {entry.steps.length === 0 && (
                                    <li className="wfb-empty-line">This workflow has no steps yet.</li>
                                )}
                            </ol>

                            {/* THIS IS HOUSE RULES, NOT A FORM.
                                Three buttons sat here — Reset, Edit steps and a
                                Delete-for-everyone bin — taking a full row under
                                a four-step list. It made the workflow read as a
                                document you were being invited to change, when
                                it is something the team agreed once and you
                                follow. Editing is rare and deliberate; it does
                                not get equal billing with the steps.

                                So: one quiet ⋯, and the row is the byline. The
                                Droplet is the same popover the rest of the panel
                                uses, so Escape and outside-click already work. */}
                            <div className="wfb-steps-foot">
                                <span className="wfb-by">
                                    <Users size={10} /> {entry.author || "unknown"}
                                    {entry.updatedAt ? ` · ${shortStamp(entry.updatedAt)}` : ""}
                                    {doneCount > 0 && <em> · {doneCount}/{entry.steps.length} done</em>}
                                </span>
                                <Droplet
                                    panelClassName="wfb-menu"
                                    trigger={({ toggle }) => (
                                        <button
                                            type="button"
                                            className="wfb-btn wfb-btn--icon wfb-btn--quiet"
                                            onClick={toggle}
                                            title="Workflow options"
                                            aria-label="Workflow options"
                                        >
                                            <MoreHorizontal size={13} />
                                        </button>
                                    )}
                                >
                                    {(close) => (
                                        <>
                                            <button
                                                type="button"
                                                className="wfb-menu-item"
                                                disabled={doneCount === 0}
                                                onClick={() => { close(); resetTicks(); }}
                                            >
                                                <RotateCcw size={12} />
                                                {/* "Reset" said nothing about
                                                    WHOSE progress, on a board
                                                    that is otherwise shared. */}
                                                <span>Clear my ticks</span>
                                            </button>
                                            <button
                                                type="button"
                                                className="wfb-menu-item"
                                                onClick={() => { close(); startEditing(); }}
                                            >
                                                <Pencil size={12} /><span>Edit steps</span>
                                            </button>
                                            <button
                                                type="button"
                                                className="wfb-menu-item wfb-menu-item--danger"
                                                onClick={() => { close(); deleteEntry(); }}
                                            >
                                                <Trash2 size={12} /><span>Delete for the team</span>
                                            </button>
                                        </>
                                    )}
                                </Droplet>
                            </div>

                            {/* ── notes ─────────────────────────────────── */}
                            <div className="wfb-notes">
                                {(() => {
                                    // WHICH TERRITORIES THIS BOARD ACTUALLY HAS
                                    // NOTES FOR. Not every territory in the
                                    // campaign: a filter row offering fifteen
                                    // countries when the notes cover two is
                                    // fifteen ways to find an empty list.
                                    const used: string[] = [];
                                    const usedTags: string[] = [];
                                    entry.notes.forEach((n) => {
                                        if (n.territory && used.indexOf(n.territory) === -1) used.push(n.territory);
                                        (n.tags || []).forEach((t) => {
                                            if (usedTags.indexOf(t) === -1) usedTags.push(t);
                                        });
                                    });
                                    usedTags.sort();
                                    // TWO FILTERS THAT COMPOSE. "Brazil" and
                                    // "CTA" together is the question somebody
                                    // actually has; making them exclusive would
                                    // mean picking which half of it to ask.
                                    // UNIVERSAL NOTES FIRST. A note with no
                                    // territory applies to every version of the
                                    // creative, so it is the one everybody
                                    // needs to read; a Brazil note is only for
                                    // whoever is on Brazil. Sorted by post order
                                    // before this, so within each group the
                                    // oldest still reads first — this only
                                    // lifts the universal ones above the rest,
                                    // it does not shuffle them.
                                    const shown = entry.notes
                                        .filter((n) =>
                                            (!terrFilter || n.territory === terrFilter) &&
                                            (!tagFilter || (n.tags || []).indexOf(tagFilter) !== -1))
                                        .map((n, i) => ({ n, i }))
                                        .sort((a, b) => {
                                            const au = a.n.territory ? 1 : 0;
                                            const bu = b.n.territory ? 1 : 0;
                                            if (au !== bu) return au - bu;
                                            // Array.prototype.sort is only
                                            // guaranteed stable from ES2019;
                                            // carrying the index makes it so
                                            // regardless of the host.
                                            return a.i - b.i;
                                        })
                                        .map((x) => x.n);
                                    return (
                                        <>
                                            <div className="wfb-notes-head">
                                                <StickyNote size={11} />
                                                <span>Notes</span>
                                                <em>{shown.length}{(terrFilter || tagFilter) ? ` of ${entry.notes.length}` : ""}</em>

                                                {/* THE FILTER COSTS NOTHING UNTIL IT
                                                    EXISTS. One flag per territory that
                                                    actually has notes, and only when
                                                    there is more than one — below that
                                                    a filter is a control that can only
                                                    ever hide things. */}
                                                {(used.length > 1 || usedTags.length > 1) && (
                                                    <span className="wfb-notes-filter">
                                                        {(terrFilter || tagFilter) && (
                                                            <button
                                                                type="button"
                                                                className="wfb-flagchip wfb-flagchip--clear"
                                                                onClick={() => { setTerrFilter(""); setTagFilter(""); }}
                                                                title="Show every note"
                                                            >
                                                                <X size={9} />
                                                            </button>
                                                        )}
                                                        {used.length > 1 && used.map((code) => (
                                                            <button
                                                                key={code}
                                                                type="button"
                                                                className={"wfb-flagchip" + (terrFilter === code ? " is-on" : "")}
                                                                onClick={() => setTerrFilter(terrFilter === code ? "" : code)}
                                                                title={territoryName(code)}
                                                            >
                                                                <span className="wfb-flag">{flagFor(code) || code}</span>
                                                            </button>
                                                        ))}
                                                        {/* TAGS LIVE IN THE SAME ROW as the
                                                            flags. They used to be reachable
                                                            only by clicking a chip already on
                                                            a note, which works but is invisible
                                                            — you had to already know it. Both
                                                            filters in one place is one thing to
                                                            learn, and it still costs nothing
                                                            when there is only one of each. */}
                                                        {usedTags.length > 1 && usedTags.map((t) => (
                                                            <button
                                                                key={t}
                                                                type="button"
                                                                className={"wfb-tag" + (tagFilter === t ? " is-on" : "")}
                                                                onClick={() => setTagFilter(tagFilter === t ? "" : t)}
                                                                title={tagFilter === t ? "Show every tag" : `Show only ${t}`}
                                                            >
                                                                {t}
                                                            </button>
                                                        ))}
                                                    </span>
                                                )}
                                            </div>

                                            <AnimatePresence initial={false}>
                                                {shown.map((n, i) => (
                                                    <motion.div
                                                        key={n.id}
                                                        className="wfb-note"
                                                        initial={{ opacity: 0, y: 4 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={reduced ? { duration: 0 } : { ...SPRING.snappy, delay: rowDelay(i) }}
                                                    >
                                                        <p className="wfb-note-text">{noteBody(n.text, n.links, openNoteLink)}</p>
                                                        {(n.tags || []).length > 0 && (
                                                            <span className="wfb-note-tags">
                                                                {(n.tags || []).map((t) => (
                                                                    <button
                                                                        key={t}
                                                                        type="button"
                                                                        className={"wfb-tag" + (tagFilter === t ? " is-on" : "")}
                                                                        onClick={() => setTagFilter(tagFilter === t ? "" : t)}
                                                                        title={tagFilter === t ? "Show every tag" : `Show only ${t}`}
                                                                    >
                                                                        {t}
                                                                    </button>
                                                                ))}
                                                            </span>
                                                        )}
                                                        <span className="wfb-note-by" title={n.stamp}>
                                                            {n.territory && (
                                                                <span className="wfb-note-terr" title={territoryName(n.territory)}>
                                                                    <span className="wfb-flag">{flagFor(n.territory) || n.territory}</span>
                                                                </span>
                                                            )}
                                                            {n.author}{n.stamp ? ` · ${shortStamp(n.stamp)}` : ""}
                                                        </span>
                                                        {/* Your own notes only. Somebody
                                                            else's is theirs to withdraw. */}
                                                        {n.author === me && (
                                                            <button type="button" className="wfb-note-x" onClick={() => removeNote(n.id)}>
                                                                <X size={10} />
                                                            </button>
                                                        )}
                                                    </motion.div>
                                                ))}
                                            </AnimatePresence>
                                            {shown.length === 0 && entry.notes.length > 0 && (
                                                <p className="wfb-empty-line">
                                                    No notes for {[terrFilter ? territoryName(terrFilter) : "", tagFilter]
                                                        .filter(Boolean).join(" · ")}.
                                                </p>
                                            )}
                                        </>
                                    );
                                })()}

                                <div className="wfb-note-add">
                                    {/* A GLOBE, NOT A DROPDOWN. The panel is
                                        380px and already dense; a permanent
                                        country selector next to the input would
                                        cost a third of the row to say nothing
                                        most of the time. Closed it is one
                                        glyph; open it is a search over this
                                        campaign's own territories. */}
                                    <button
                                        type="button"
                                        className={"wfb-terr-btn" + (noteTerritory ? " is-on" : "")}
                                        onClick={() => setTerrPickerOpen((v) => !v)}
                                        disabled={!me || busy}
                                        title={noteTerritory ? `Tagged ${territoryName(noteTerritory)} — click to change` : "Tag this note with a territory"}
                                    >
                                        {noteTerritory
                                            ? <span className="wfb-flag">{flagFor(noteTerritory) || noteTerritory}</span>
                                            : <Globe size={12} />}
                                    </button>
                                    <span className="wfb-note-field">
                                        <FormatBar
                                            sel={noteSel.sel}
                                            onBold={() => noteSel.wrapBold(noteDraft, setNoteDraft)}
                                            onLink={() => {
                                                // The SELECTION is the label, so
                                                // the word chooser is skipped
                                                // entirely -- and the label
                                                // cannot fail to match the body,
                                                // because it was cut from it.
                                                if (!noteSel.selected) return;
                                                setLinkWord(noteSel.selected);
                                                setWordPicking(true);
                                                setToolPicking(false);
                                            }}
                                        />
                                        <input
                                            type="text"
                                            value={noteDraft}
                                            placeholder={me ? "Add a note for the team…" : "Tag this machine with your name to post"}
                                            disabled={!me || busy}
                                            onChange={(e) => setNoteDraft(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                                            {...noteSel.handlers}
                                        />
                                    </span>
                                    {/* MAKE A WORD DO SOMETHING. Pressed, it
                                        turns the note you have typed into
                                        clickable words -- pick one, then say
                                        where it goes. No syntax to remember and
                                        no path to type: the two things that
                                        make a link syntax unusable in a
                                        one-line input. */}
                                    {/* Still here for when nothing is selected:
                                        the format bar is the fast path, this is
                                        the one you find without knowing. */}
                                    <Tooltip text="Link a word in this note to a folder or a tool">
                                        <button
                                            type="button"
                                            className={"wfb-terr-btn" + (noteLinks.length ? " is-on" : "")}
                                            onClick={() => { setWordPicking((v) => !v); setLinkWord(""); setToolPicking(false); }}
                                            disabled={!me || busy || !noteDraft.trim()}
                                        >
                                            <Wand2 size={12} />
                                        </button>
                                    </Tooltip>
                                    <button type="button" className="wfb-btn" onClick={addNote} disabled={!me || busy || !noteDraft.trim()}>
                                        <Plus size={12} /><span>Add</span>
                                    </button>
                                </div>

                                {/* What is already attached, before posting.
                                    Shown as chips rather than by highlighting
                                    the input, because an <input> cannot carry
                                    styled runs and faking one with an overlay is
                                    a caret-alignment problem nobody needs. */}
                                {/* TAGS, typed. A row of chips under the input
                                    rather than a field beside it: the composer
                                    row is already a globe, an input, a wand and
                                    Add, and a fifth control in it would leave
                                    the input itself about forty pixels wide. */}
                                <div className="wfb-tagbar">
                                    {noteTags.map((t) => (
                                        <span key={t} className="wfb-tag is-draft">
                                            {t}
                                            <button
                                                type="button"
                                                onClick={() => setNoteTags((prev) => prev.filter((x) => x !== t))}
                                                title="Remove"
                                            >
                                                <X size={8} />
                                            </button>
                                        </span>
                                    ))}
                                    <input
                                        type="text"
                                        className="wfb-taginput"
                                        value={tagDraft}
                                        placeholder={noteTags.length ? "+ tag" : "+ tag (CTA, TT…)"}
                                        disabled={!me || busy}
                                        onChange={(e) => setTagDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            // Enter and comma both commit. A
                                            // comma is what people type between
                                            // tags without being told to, and
                                            // Enter here must NOT post the note
                                            // -- that is the input above.
                                            if (e.key === "Enter" || e.key === ",") {
                                                e.preventDefault();
                                                addTag(tagDraft);
                                            } else if (e.key === "Backspace" && !tagDraft && noteTags.length) {
                                                setNoteTags((prev) => prev.slice(0, -1));
                                            }
                                        }}
                                        onBlur={() => { if (tagDraft.trim()) addTag(tagDraft); }}
                                    />
                                    {/* What the team already uses, minus what is
                                        on this note. One click beats retyping,
                                        and it is why the vocabulary converges. */}
                                    {knownTags.filter((t) => noteTags.indexOf(t) === -1).slice(0, 6).map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            className="wfb-tag wfb-tag--suggest"
                                            disabled={!me || busy}
                                            onClick={() => addTag(t)}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>

                                {noteLinks.length > 0 && (
                                    <div className="wfb-notelinks">
                                        {noteLinks.map((l) => (
                                            <span key={l.label} className="wfb-notelink">
                                                {l.path ? <FolderOpen size={9} /> : <ArrowRight size={9} />}
                                                <em>{l.label}</em>
                                                <span className="wfb-notelink-to">
                                                    {l.path
                                                        ? l.path.split("/").filter(Boolean).slice(-1)[0]
                                                        : (toolFor({ tool: l.tool || "" }) || { label: l.tool }).label}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setNoteLinks((prev) => prev.filter((x) => x.label !== l.label))}
                                                    title="Remove this link"
                                                >
                                                    <X size={9} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <AnimatePresence initial={false}>
                                    {wordPicking && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: "auto" }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={ease}
                                            style={{ overflow: "hidden" }}
                                        >
                                            <div className="wfb-wordpick">
                                                <p className="wfb-wordpick-hint">
                                                    {linkWord
                                                        ? <>Where should “<strong>{linkWord}</strong>” go?</>
                                                        : "Which word should be clickable?"}
                                                </p>
                                                {!linkWord && (
                                                    <div className="wfb-wordpick-words">
                                                        {draftWords.map((w) => (
                                                            <button
                                                                key={w}
                                                                type="button"
                                                                className="wfb-word"
                                                                onClick={() => setLinkWord(w)}
                                                            >
                                                                {w}
                                                            </button>
                                                        ))}
                                                        {draftWords.length === 0 && (
                                                            <p className="wfb-empty-line">Type the note first.</p>
                                                        )}
                                                    </div>
                                                )}
                                                {linkWord && !toolPicking && (
                                                    <div className="wfb-wordpick-where">
                                                        <button type="button" className="wfb-btn" onClick={() => attachFolder(linkWord)}>
                                                            <FolderOpen size={12} /><span>A folder…</span>
                                                        </button>
                                                        <button type="button" className="wfb-btn" onClick={() => setToolPicking(true)}>
                                                            <ArrowRight size={12} /><span>A tool…</span>
                                                        </button>
                                                        <button type="button" className="wfb-btn wfb-btn--icon" onClick={() => setLinkWord("")} title="Pick a different word">
                                                            <ChevronLeft size={12} />
                                                        </button>
                                                    </div>
                                                )}
                                                {linkWord && toolPicking && (
                                                    <LinkPicker
                                                        stepText={linkWord}
                                                        onPick={(link) => {
                                                            if (link) attachLink({ label: linkWord, tool: link.tool, action: link.action });
                                                            else { setToolPicking(false); }
                                                        }}
                                                        onClose={() => setToolPicking(false)}
                                                    />
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                <AnimatePresence initial={false}>
                                    {terrPickerOpen && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: "auto" }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={ease}
                                            style={{ overflow: "hidden" }}
                                        >
                                            <TerritoryPicker
                                                territories={territories}
                                                value={noteTerritory}
                                                onPick={(code) => { setNoteTerritory(code); setTerrPickerOpen(false); }}
                                                onClose={() => setTerrPickerOpen(false)}
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                                                        </div>
                        </>
                    )}
                </div>
            )}

            <div className="wfb-toasts">
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
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
};

/**
 * One editable step row.
 *
 * ITS OWN COMPONENT because `useSelection` is a hook, and hooks cannot be
 * called inside a `.map()`. Lifting the selection into the editor and keying it
 * by row index would work right up until a row is removed or moved, at which
 * point the stored index points at somebody else's text.
 */
const StepRow: React.FC<{
    step: WorkflowStep;
    index: number;
    total: number;
    hasLink: boolean;
    onText: (text: string) => void;
    onMove: (by: number) => void;
    onRemove: () => void;
    onLink: () => void;
}> = ({ step, index, total, hasLink, onText, onMove, onRemove, onLink }) => {
    const sel = useSelection(step.text);
    return (
        <>
            <span className="wfb-editstep-grip"><GripVertical size={11} /></span>
            <span className="wfb-editstep-field">
                {/* BOLD ONLY. A step already carries a row-level link chip, and
                    a second inline mechanism in the same sentence would be two
                    answers to one question. */}
                <FormatBar sel={sel.sel} onBold={() => sel.wrapBold(step.text, onText)} />
                <input
                    type="text"
                    value={step.text}
                    placeholder="What has to happen?"
                    onChange={(e) => onText(e.target.value)}
                    {...sel.handlers}
                />
            </span>
            <button
                type="button"
                className={"wfb-mini" + (hasLink ? " is-on" : "")}
                onClick={onLink}
                title={hasLink ? "Change where this step sends you" : "Send this step somewhere"}
            >
                <Link2 size={11} />
            </button>
            <button type="button" className="wfb-mini" onClick={() => onMove(-1)} disabled={index === 0} title="Move up">↑</button>
            <button type="button" className="wfb-mini" onClick={() => onMove(1)} disabled={index === total - 1} title="Move down">↓</button>
            <button type="button" className="wfb-mini wfb-mini--danger" onClick={onRemove} title="Remove"><X size={11} /></button>
        </>
    );
};

// ---------------------------------------------------------------------------
// SELECT A WORD, THEN DO SOMETHING TO IT.
//
// `**bold**` and the link side table both shipped working, and both were
// invisible: you had to know to type asterisks, and linking meant pressing a
// wand and picking a word out of a list. Nobody types markdown into a one-line
// input in a hurry, so in practice neither got used.
//
// A plain <input> is enough for this. `selectionStart`/`selectionEnd` give the
// range, and bolding is a string splice around it — no contenteditable, no
// rich-text model, no second source of truth for what the note says. The
// trade-off is honest: the asterisks stay visible while you type and the bold
// only appears once posted. That is also the upside — you can see and delete a
// marker you did not mean.
//
// THE BAR IS ANCHORED TO THE INPUT, not to the selection. Positioning over a
// range inside an <input> means measuring text with a mirror element, and on a
// 380px panel that buys a few pixels of precision for a whole class of drift
// bugs. Above the field, it is always where you left it.
//
// mousedown is PREVENTED on every button. Without that, pressing one blurs the
// input, the selection collapses, and the button acts on nothing — the classic
// way this feature ships broken.
// ---------------------------------------------------------------------------
interface Sel { start: number; end: number }

const FormatBar: React.FC<{
    sel: Sel | null;
    onBold: () => void;
    /** Absent on steps: a step already carries a row-level link chip, and a
     *  second inline mechanism in the same sentence is two answers to one
     *  question. */
    onLink?: () => void;
}> = ({ sel, onBold, onLink }) => {
    if (!sel || sel.end <= sel.start) return null;
    return (
        <div className="wfb-formatbar" onMouseDown={(e) => e.preventDefault()}>
            <button type="button" onClick={onBold} title="Bold the selected text">
                <span className="wfb-formatbar-b">B</span>
            </button>
            {onLink && (
                <button type="button" onClick={onLink} title="Make the selected text open a folder or a tool">
                    <Link2 size={11} />
                </button>
            )}
        </div>
    );
};

/**
 * Selection tracking for one input, plus the splice that wraps it.
 *
 * Read on every event that can move a caret. `select` alone misses the arrow
 * keys, and `keyup` alone misses a drag that ends outside the field.
 */
function useSelection(value: string) {
    const ref = useRef<HTMLInputElement | null>(null);
    const [sel, setSel] = useState<Sel | null>(null);

    const read = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        if (start === null || end === null) { setSel(null); return; }
        setSel({ start, end });
    }, []);

    /** The selected text, trimmed of the spaces a double-click drags in. */
    const selected = sel && sel.end > sel.start ? value.slice(sel.start, sel.end).trim() : "";

    const handlers = {
        ref,
        onSelect: read,
        onKeyUp: read,
        onMouseUp: read,
        // A selection that survives losing focus would put the bar over a field
        // somebody has left; one that dies on every blur takes the bar away
        // before a click on it lands. Hence the preventDefault on the bar, and
        // no onBlur here at all.
    };

    /** `**` around the selection, or off it again if it is already bold. */
    const wrapBold = (v: string, set: (next: string) => void) => {
        if (!sel || sel.end <= sel.start) return;
        const before = v.slice(0, sel.start);
        const mid = v.slice(sel.start, sel.end);
        const after = v.slice(sel.end);
        const already = before.slice(-2) === "**" && after.slice(0, 2) === "**";
        const next = already
            ? before.slice(0, -2) + mid + after.slice(2)
            // `+ after` is not decoration: without it, bolding the first words
            // of a note silently threw away the rest of the sentence. Caught by
            // bolding a selection that was not the whole string.
            : before + "**" + mid + "**" + after;
        set(next);
        // Put the caret back around the same words, so a second press toggles
        // rather than wrapping again.
        const shift = already ? -2 : 2;
        window.setTimeout(() => {
            const el = ref.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(sel.start + shift, sel.end + shift);
            read();
        }, 0);
    };

    return { ref, sel, selected, handlers, wrapBold, read };
}

// ---------------------------------------------------------------------------
// Tagging a note with a territory.
//
// TWO LISTS, and the order is the whole design. What the campaign has on disk
// comes first — five or six folders, which is the answer nearly every time and
// short enough to click without typing. The full ISO list is underneath, behind
// the search, because `markets` is legitimately empty in three ordinary cases:
// the share is not mounted, the campaign was saved against its masters root
// rather than its markets root (sibling trees, CLAUDE.md §5), or the note is
// about a territory whose folder does not exist yet. A picker that offered
// nothing in any of those would fail exactly when somebody is writing down what
// they just learned.
// ---------------------------------------------------------------------------
const TerritoryPicker: React.FC<{
    territories: { markets: Territory[]; all: Territory[] } | null;
    value: string;
    onPick: (code: string) => void;
    onClose: () => void;
}> = ({ territories, value, onPick, onClose }) => {
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const match = (t: Territory) =>
        t.name.toLowerCase().indexOf(q) !== -1 || t.code.toLowerCase().indexOf(q) !== -1;

    const markets = territories ? territories.markets : [];
    const onDisk: Record<string, boolean> = {};
    markets.forEach((t) => { onDisk[t.code] = true; });
    // The full list only once something has been typed: dropping 250 countries
    // into a 380px panel the moment the globe is pressed buries the six that
    // matter.
    const rest = (q && territories ? territories.all.filter((t) => match(t) && !onDisk[t.code]) : []).slice(0, 40);
    const near = markets.filter(match);

    return (
        <div className="wfb-terrpick">
            <div className="wfb-terrpick-head">
                <Search size={11} />
                <input
                    type="text"
                    autoFocus
                    value={query}
                    placeholder={markets.length ? "This campaign's territories…" : "Search every territory…"}
                    onChange={(e) => setQuery(e.target.value)}
                />
                {value && (
                    <button type="button" className="wfb-mini" onClick={() => onPick("")} title="Remove the tag">
                        <Link2Off size={11} />
                    </button>
                )}
                <button type="button" className="wfb-mini" onClick={onClose} title="Close"><X size={11} /></button>
            </div>

            <div className="wfb-terrpick-list">
                {territories === null && <p className="wfb-empty-line">Reading the campaign's markets folder…</p>}
                {territories !== null && markets.length === 0 && !q && (
                    <p className="wfb-empty-line">
                        Couldn't read this campaign's markets folder — search for a territory instead.
                    </p>
                )}
                {near.map((t) => (
                    <button
                        key={"m-" + t.code}
                        type="button"
                        className={"wfb-terrpick-row" + (t.code === value ? " is-on" : "")}
                        onClick={() => onPick(t.code)}
                    >
                        <span className="wfb-flag">{flagFor(t.code) || t.code}</span>
                        <span className="wfb-terrpick-name">{t.name}</span>
                        <em>{t.code}</em>
                    </button>
                ))}
                {rest.length > 0 && <p className="wfb-terrpick-sep">Not in this campaign</p>}
                {rest.map((t) => (
                    <button
                        key={"a-" + t.code}
                        type="button"
                        className={"wfb-terrpick-row is-far" + (t.code === value ? " is-on" : "")}
                        onClick={() => onPick(t.code)}
                    >
                        <span className="wfb-flag">{flagFor(t.code) || t.code}</span>
                        <span className="wfb-terrpick-name">{t.name}</span>
                        <em>{t.code}</em>
                    </button>
                ))}
                {q && near.length === 0 && rest.length === 0 && (
                    <p className="wfb-empty-line">Nothing matches “{query}”.</p>
                )}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Typing a creative in by hand, for when the tree can't be read or doesn't
// name it the way the files do.
// ---------------------------------------------------------------------------
const TypeItIn: React.FC<{
    campaignName: string;
    campaigns: CampaignRef[];
    onCampaign: (name: string) => void;
    onPick: (name: string) => void;
}> = ({ campaignName, campaigns, onCampaign, onPick }) => {
    const [name, setName] = useState("");
    const [campText, setCampText] = useState("");
    const known = campaigns.filter((c) => c.name === campaignName).length > 0;
    const effectiveCampaign = known ? campaignName : campText;
    return (
        <div className="wfb-typein">
            {!known && (
                <input
                    type="text"
                    value={campText}
                    placeholder="Campaign"
                    onChange={(e) => { setCampText(e.target.value); onCampaign(e.target.value); }}
                />
            )}
            <input
                type="text"
                value={name}
                placeholder="…or type a creative"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onPick(name.trim()); }}
            />
            <button
                type="button"
                className="wfb-btn"
                disabled={!name.trim() || !effectiveCampaign.trim()}
                onClick={() => onPick(name.trim())}
            >
                <Check size={12} /><span>Use</span>
            </button>
        </div>
    );
};

// ---------------------------------------------------------------------------
// The step editor. Plain up/down rather than drag-and-drop: the panel docks
// narrow, the list is four items long, and a drag library here would be more
// machinery than the job needs.
// ---------------------------------------------------------------------------
const StepEditor: React.FC<{
    steps: WorkflowStep[];
    setSteps: (s: WorkflowStep[]) => void;
    busy: boolean;
    onCancel: () => void;
    onSave: () => void;
    ease: any;
    rowDelay: (i: number) => number;
}> = ({ steps, setSteps, busy, onCancel, onSave, ease, rowDelay }) => {
    // Which row has its link picker open, by index. One at a time: the picker
    // is a list of every tool in the panel and two of them open at once is a
    // page you have to scroll to find the step you were editing.
    const [linking, setLinking] = useState<number | null>(null);
    /** The last step removed here, held so it can be put back. */
    const [undo, setUndo] = useState<{ step: WorkflowStep; index: number } | null>(null);
    const set = (i: number, text: string) => setSteps(steps.map((s, j) => (j === i ? { ...s, text } : s)));
    const setLink = (i: number, link: WorkflowLink | undefined) =>
        setSteps(steps.map((s, j) => {
            if (j !== i) return s;
            const next = { ...s };
            if (link) next.link = link;
            else delete next.link;
            return next;
        }));
    // UNDO RATHER THAN A CONFIRM. Removing a step in the editor is a draft edit
    // -- Cancel already discards the lot, and the real point of no return is
    // Save, which asks its own question and names what it is about to drop. A
    // modal on every X here would be a dialog you learn to dismiss without
    // reading, which is worse than none: it trains the reflex that the Save
    // confirm then has to survive.
    const remove = (i: number) => {
        setUndo({ step: steps[i], index: i });
        setSteps(steps.filter((_, j) => j !== i));
    };
    const undoRemove = () => {
        if (!undo) return;
        const next = steps.slice();
        // Back where it was, not on the end -- a step restored to the bottom of
        // a running order is a different instruction.
        next.splice(Math.min(undo.index, next.length), 0, undo.step);
        setSteps(next);
        setUndo(null);
    };
    const move = (i: number, by: number) => {
        const j = i + by;
        if (j < 0 || j >= steps.length) return;
        const next = steps.slice();
        const tmp = next[i];
        next[i] = next[j];
        next[j] = tmp;
        setSteps(next);
    };
    const add = () => setSteps([...steps, { id: nextId("step"), text: "" }]);

    return (
        <div className="wfb-editor">
            <p className="wfb-editor-hint">
                These are shared with the team. Ticks stay yours.
            </p>
            <ul className="wfb-editsteps">
                <AnimatePresence initial={false}>
                    {steps.map((s, i) => (
                        <motion.li
                            key={s.id}
                            className="wfb-editstep"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ ...ease, delay: rowDelay(i) }}
                        >
                            <StepRow
                                step={s}
                                index={i}
                                total={steps.length}
                                hasLink={!!s.link}
                                onText={(text) => set(i, text)}
                                onMove={(by) => move(i, by)}
                                onRemove={() => remove(i)}
                                onLink={() => setLinking(linking === i ? null : i)}
                            />
                        </motion.li>
                    ))}
                </AnimatePresence>
            </ul>
            {/* Rendered OUTSIDE the row rather than inside it: the row is a
                flex line of inputs and buttons, and a 200px list dropped into
                it fights every one of them for width. */}
            <AnimatePresence initial={false}>
                {linking !== null && steps[linking] && (
                    <motion.div
                        key={steps[linking].id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={ease}
                        style={{ overflow: "hidden" }}
                    >
                        <LinkPicker
                            stepText={steps[linking].text}
                            value={steps[linking].link}
                            onPick={(link) => setLink(linking, link)}
                            onClose={() => setLinking(null)}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
            <AnimatePresence initial={false}>
                {undo && (
                    <motion.div
                        className="wfb-undo"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={ease}
                    >
                        <RotateCcw size={11} />
                        <span>Removed “{undo.step.text || "an empty step"}”</span>
                        <button type="button" className="wfb-btn" onClick={undoRemove}>
                            <span>Undo</span>
                        </button>
                        <button
                            type="button"
                            className="wfb-mini"
                            onClick={() => setUndo(null)}
                            title="Dismiss"
                        >
                            <X size={10} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
            <div className="wfb-editor-foot">
                <button type="button" className="wfb-btn" onClick={add}>
                    <Plus size={12} /><span>Add step</span>
                </button>
                <div className="wfb-editor-foot-right">
                    <button type="button" className="wfb-btn" onClick={onCancel} disabled={busy}>
                        <X size={12} /><span>Cancel</span>
                    </button>
                    <button type="button" className="wfb-btn wfb-btn--primary" onClick={onSave} disabled={busy}>
                        <Check size={12} /><span>{busy ? "Saving…" : "Save for the team"}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WorkflowBoardTool;
