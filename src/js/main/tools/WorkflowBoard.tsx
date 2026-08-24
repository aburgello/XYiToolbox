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
    ArrowRight, Link2, Link2Off, Search,
} from "lucide-react";
import { TOOLS } from "../toolRegistry";
import { evalTS } from "../../lib/utils/bolt";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import { sfx } from "../../lib/utils/sfx";
import { confirmDialog } from "../Dialog";
import CheckboxToggle from "../CheckboxToggle";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
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
interface WorkflowNote { id: string; text: string; author: string; stamp: string }
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

/** A creative token comes back SHOUTED, because that is what matching needs.
 *  Nobody wants to read a screen of TRIO, so title-case it for display only --
 *  the stored value is never touched. */
function prettyCreative(s: string): string {
    const raw = String(s || "");
    if (!raw) return "";
    if (raw !== raw.toUpperCase()) return raw;   // already mixed case; leave it
    return raw.charAt(0) + raw.slice(1).toLowerCase();
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

/** The registry entry a link points at, or null when it points at nothing.
 *  A shared file outlives a tool id: this is checked on every render rather
 *  than trusted, so a rename shows as a dead chip instead of a dead click. */
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

// ---------------------------------------------------------------------------
// Progress ring. Reads at a glance from across a desk, which a "4/7" does not.
// ---------------------------------------------------------------------------
const ProgressRing: React.FC<{ done: number; total: number }> = ({ done, total }) => {
    const reduced = useReducedMotion();
    const R = 15;
    const C = 2 * Math.PI * R;
    const frac = total > 0 ? done / total : 0;
    const complete = total > 0 && done === total;
    return (
        <div className={"wfb-ring" + (complete ? " is-complete" : "")}>
            <svg width="36" height="36" viewBox="0 0 36 36">
                <circle className="wfb-ring-track" cx="18" cy="18" r={R} fill="none" strokeWidth="3" />
                <motion.circle
                    className="wfb-ring-bar"
                    cx="18" cy="18" r={R} fill="none" strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={C}
                    // Drawn from twelve o'clock. A CSS transform would fight
                    // nothing here (Framer only animates the offset), but the
                    // rotation belongs to the geometry, so it stays on the SVG.
                    transform="rotate(-90 18 18)"
                    initial={false}
                    animate={{ strokeDashoffset: C * (1 - frac) }}
                    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 24 }}
                />
            </svg>
            <span className="wfb-ring-label">{done}/{total}</span>
        </div>
    );
};

const WorkflowBoardTool: React.FC<{ onSelectTool?: (toolId: string) => void }> = ({ onSelectTool }) => {
    const reduced = useReducedMotion();

    const [entries, setEntries] = useState<WorkflowEntry[]>([]);
    // "Couldn't read" is NOT "nothing there". A failed read must never blank a
    // board that was on screen a moment ago -- it goes stale, and says so.
    const [boardRead, setBoardRead] = useState(false);
    const [stale, setStale] = useState(false);
    const [me, setMe] = useState("");

    const [campaigns, setCampaigns] = useState<CampaignRef[]>([]);
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

    const [ticks, setTicks] = useState<Record<string, Record<string, boolean>>>({});
    const [editing, setEditing] = useState(false);
    const [draftSteps, setDraftSteps] = useState<WorkflowStep[]>([]);
    const [noteDraft, setNoteDraft] = useState("");
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
                    success: boolean; project?: string; creative?: string; campaign?: string;
                    campaigns?: CampaignRef[];
                };
                if (cancelled || !ctx || !ctx.success) return;
                setDetected({ project: ctx.project || "", creative: ctx.creative || "", campaign: ctx.campaign || "" });
                setCampaigns(ctx.campaigns || []);
                setCampaign(ctx.campaign || "");
                setCreative(ctx.creative || "");
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

    const persistTicks = useCallback(async (next: Record<string, Record<string, boolean>>) => {
        setTicks(next);
        try { await evalTS("workflowTicksSave", JSON.stringify(next)); } catch { /* local only; not worth a toast */ }
    }, []);

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

    const addNote = async () => {
        const body = noteDraft.trim();
        if (!body || !entry) return;
        setBusy(true);
        const r = (await evalTSSafe("workflowAddNote", entry.id, body)) as {
            success: boolean; error?: string; entries?: WorkflowEntry[];
        };
        setBusy(false);
        if (!r || !r.success) { toast("error", (r && r.error) || "Couldn't post the note."); return; }
        if (r.entries) setEntries(r.entries);
        setNoteDraft("");
        sfx.click();
    };

    const removeNote = async (noteId: string) => {
        if (!entry) return;
        const r = (await evalTSSafe("workflowDeleteNote", entry.id, noteId)) as {
            success: boolean; error?: string; entries?: WorkflowEntry[];
        };
        if (!r || !r.success) { toast("error", (r && r.error) || "Couldn't remove the note."); return; }
        if (r.entries) setEntries(r.entries);
    };

    // --- the picker ----------------------------------------------------------

    const openPicker = async () => {
        setPickCampaign(campaign || (campaigns[0] ? campaigns[0].name : ""));
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
        const out: { name: string; hasWorkflow: boolean }[] = [];
        const want = canon(pickCampaign);
        const withWf: Record<string, boolean> = {};
        entries.filter((e) => canon(e.campaign) === want).forEach((e) => { withWf[canon(e.creative)] = true; });
        (folderCreatives || []).forEach((n) => {
            const c = canon(n);
            if (seen[c]) return;
            seen[c] = true;
            out.push({ name: n, hasWorkflow: !!withWf[c] });
        });
        entries.filter((e) => canon(e.campaign) === want).forEach((e) => {
            const c = canon(e.creative);
            if (seen[c]) return;
            seen[c] = true;
            out.push({ name: e.creative, hasWorkflow: true });
        });
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }, [folderCreatives, entries, pickCampaign]);

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
        <div className="workflow-board">
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

                {entry && !editing && <ProgressRing done={doneCount} total={entry.steps.length} />}

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
                            {campaigns.map((c) => (
                                <button
                                    key={c.name}
                                    type="button"
                                    className={"wfb-camp" + (c.name === pickCampaign ? " is-on" : "")}
                                    onClick={() => setPickCampaign(c.name)}
                                >
                                    {c.name}
                                </button>
                            ))}
                        </div>

                        <div className="wfb-creatives">
                            {scanning && <p className="wfb-empty-line">Reading the masters tree…</p>}
                            {!scanning && pickable.length === 0 && (
                                <p className="wfb-empty-line">
                                    {folderCreatives === null
                                        ? "Couldn't read that campaign's AE folder — the share may not be mounted. You can still type a creative below."
                                        : "No creatives found for that campaign."}
                                </p>
                            )}
                            {pickable.map((c, i) => (
                                <motion.button
                                    key={c.name}
                                    type="button"
                                    className={"wfb-creative" + (c.hasWorkflow ? " has-wf" : "")}
                                    onClick={() => choose(pickCampaign, c.name)}
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ ...ease, delay: rowDelay(i) }}
                                >
                                    <span className="wfb-creative-name">{prettyCreative(c.name)}</span>
                                    {c.hasWorkflow
                                        ? <span className="wfb-creative-tag"><ListChecks size={9} /> workflow</span>
                                        : <span className="wfb-creative-tag wfb-creative-tag--none">none yet</span>}
                                </motion.button>
                            ))}
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
                            <ul className="wfb-steps">
                                <AnimatePresence initial={false}>
                                    {entry.steps.map((s, i) => {
                                        const on = !!myTicks[s.id];
                                        return (
                                            <motion.li
                                                key={s.id}
                                                className={"wfb-step" + (on ? " is-done" : "")}
                                                initial={{ opacity: 0, x: -6 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0 }}
                                                transition={{ ...ease, delay: rowDelay(i) }}
                                            >
                                                <CheckboxToggle
                                                    checked={on}
                                                    onChange={() => toggleStep(s.id)}
                                                    className="wfb-step-box"
                                                    label={
                                                        // The strike lives INSIDE the text span, not
                                                        // beside it. As a sibling it stretched the
                                                        // whole row and read as a horizontal rule
                                                        // under every ticked step rather than as a
                                                        // line through the words.
                                                        <span className="wfb-step-textwrap">
                                                            <span className="wfb-step-text">{s.text}</span>
                                                            {/* Sweeps rather than appears, which is
                                                                the difference between a tick that
                                                                feels like progress and one that
                                                                feels like a redraw. */}
                                                            <motion.span
                                                                className="wfb-step-strike"
                                                                initial={false}
                                                                animate={{ scaleX: on ? 1 : 0 }}
                                                                transition={reduced ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                                                            />
                                                        </span>
                                                    }
                                                />
                                                {s.link && (
                                                    <StepLinkChip
                                                        link={s.link}
                                                        onGo={goTo}
                                                    />
                                                )}
                                            </motion.li>
                                        );
                                    })}
                                </AnimatePresence>
                                {entry.steps.length === 0 && (
                                    <li className="wfb-empty-line">This workflow has no steps yet.</li>
                                )}
                            </ul>

                            <div className="wfb-steps-foot">
                                <span className="wfb-by">
                                    <Users size={10} /> {entry.author || "unknown"}
                                    {entry.updatedAt ? ` · ${shortStamp(entry.updatedAt)}` : ""}
                                </span>
                                <div className="wfb-steps-foot-actions">
                                    <button type="button" className="wfb-btn" onClick={resetTicks} disabled={doneCount === 0}>
                                        <RotateCcw size={12} /><span>Reset</span>
                                    </button>
                                    <button type="button" className="wfb-btn" onClick={startEditing}>
                                        <Pencil size={12} /><span>Edit steps</span>
                                    </button>
                                    <Tooltip text="Delete this workflow for everyone">
                                        <button type="button" className="wfb-btn wfb-btn--icon wfb-btn--danger" onClick={deleteEntry}>
                                            <Trash2 size={12} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>

                            {/* ── notes ─────────────────────────────────── */}
                            <div className="wfb-notes">
                                <div className="wfb-notes-head">
                                    <StickyNote size={11} />
                                    <span>Notes</span>
                                    <em>{entry.notes.length}</em>
                                </div>
                                <AnimatePresence initial={false}>
                                    {entry.notes.map((n, i) => (
                                        <motion.div
                                            key={n.id}
                                            className="wfb-note"
                                            initial={{ opacity: 0, y: 4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ ...ease, delay: rowDelay(i) }}
                                        >
                                            <p className="wfb-note-text">{n.text}</p>
                                            <span className="wfb-note-by" title={n.stamp}>
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
                                <div className="wfb-note-add">
                                    <input
                                        type="text"
                                        value={noteDraft}
                                        placeholder={me ? "Add a note for the team…" : "Tag this machine with your name to post"}
                                        disabled={!me || busy}
                                        onChange={(e) => setNoteDraft(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                                    />
                                    <button type="button" className="wfb-btn" onClick={addNote} disabled={!me || busy || !noteDraft.trim()}>
                                        <Plus size={12} /><span>Add</span>
                                    </button>
                                </div>
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
    const set = (i: number, text: string) => setSteps(steps.map((s, j) => (j === i ? { ...s, text } : s)));
    const setLink = (i: number, link: WorkflowLink | undefined) =>
        setSteps(steps.map((s, j) => {
            if (j !== i) return s;
            const next = { ...s };
            if (link) next.link = link;
            else delete next.link;
            return next;
        }));
    const remove = (i: number) => setSteps(steps.filter((_, j) => j !== i));
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
                            <span className="wfb-editstep-grip"><GripVertical size={11} /></span>
                            <input
                                type="text"
                                value={s.text}
                                placeholder="What has to happen?"
                                onChange={(e) => set(i, e.target.value)}
                            />
                            <button
                                type="button"
                                className={"wfb-mini" + (s.link ? " is-on" : "")}
                                onClick={() => setLinking(linking === i ? null : i)}
                                title={s.link ? "Change where this step sends you" : "Send this step somewhere"}
                            >
                                <Link2 size={11} />
                            </button>
                            <button type="button" className="wfb-mini" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                            <button type="button" className="wfb-mini" onClick={() => move(i, 1)} disabled={i === steps.length - 1} title="Move down">↓</button>
                            <button type="button" className="wfb-mini wfb-mini--danger" onClick={() => remove(i)} title="Remove"><X size={11} /></button>
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
