// =============================================================================
// src/js/main/tools/ReviewHub.tsx
// -----------------------------------------------------------------------------
// One-stop review page for the Review category.
//
// Two tabs:
//   "OV Library"      — the full OVLibrary experience (masters + renders grid)
//   "Review Session"  — import comp names from the AE project panel,
//                       mark each as Approved / To Amend, add notes per comp.
//
// Campaign context is shared between the two tabs: OV Library owns the
// campaign picker, and Review Session reads the active campaign to match
// imported .mov files against .mp4 renders via scanAllRenders().
// =============================================================================
import React, { Suspense, useRef, useState, useEffect, createContext, useContext } from "react";
import { motion, AnimatePresence, useReducedMotion, useAnimation } from "motion/react";
import {
    Library,
    MessageSquareDiff,
    ListPlus,
    Trash2,
    CheckCircle2,
    AlertTriangle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    X,
    Pencil,
    Copy,
    Film,
    Columns2,
    Layers,
    Play,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { sfx } from "../../lib/utils/sfx";
import { usePersistentState } from "../../lib/utils/usePersistentState";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import ReviewPlayer from "./ReviewPlayer";
import "../shared.scss";
import "./ReviewHub.scss";

// OVLibrary is the full existing component -- lazy loaded, not inlined.
// It already manages its own state and CEP bridge calls.
const OVLibraryTool = React.lazy(() => import("./OVLibrary"));

// The artwork-type tokens from the studio's filename convention — DOOH,
// DFOH, DINTH, FOH — defined here (kept in step with nameGeneratorParse's
// artworkTypes in localise.ts).  Review rows truncate a .mov name at the
// first artwork-type token so a long filename like
// "PP3_INTL_DGTL_DOOH_PLAYMOREHUB_640x1560_15sec_ES" displays as
// "PP3_INTL_DGTL_DOOH…" instead of overflowing the row's buttons.
const ARTWORK_TYPES = ["DOOH", "DFOH", "DINTH", "FOH"];

function truncateNameAtArtwork(fullName: string): string {
    // Split into underscore tokens; find the first token that IS an artwork
    // type (exact, case-insensitive) and keep everything through it.  This
    // avoids a substring match like "_DINTH" landing inside "_DINTHING_".
    const tokens = fullName.split("_");
    let keep = 0;
    let found = -1;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i].toUpperCase();
        for (let a = 0; a < ARTWORK_TYPES.length; a++) {
            if (t === ARTWORK_TYPES[a]) { found = i; break; }
        }
        if (found !== -1) break;
        keep++;
    }
    if (found === -1) return fullName;
    // Rejoin tokens up to and including the artwork type, restore the rest
    // as an ellipsis.  Rebuild from the original tokens to preserve case.
    return tokens.slice(0, found + 1).join("_") + "…";
}

// ---------------------------------------------------------------------------
// Shared campaign context — OV Library owns the picker, Review Session
// reads the active campaign to find matching .mp4 renders.
// ---------------------------------------------------------------------------

interface Campaign {
    name: string;
    mastersRoot: string;
}

interface CampaignContextValue {
    campaign: Campaign | null;
}

const CampaignContext = createContext<CampaignContextValue>({ campaign: null });

// ---------------------------------------------------------------------------
// Review Session types
// ---------------------------------------------------------------------------

type ReviewStatus = "approved" | "amend" | "pending";

interface ReviewItem {
    id: number;
    name: string;
    sourcePath: string | null;
    status: ReviewStatus;
    note: string;
    noteOpen: boolean;
    batchOffset: number;
    // Set when a comparison comp was auto-created for this item (the
    // enriched side-by-side comp with master .mp4 on the left, local
    // render on the right, difference matte, labels, timecode overlay).
    comparisonCompName?: string;
    comparisonCompId?: number;
    comparisonEnrich?: string;
    comparisonFps?: number;
}

interface Toast {
    id: number;
    text: string;
    type: "success" | "error";
}

// ---------------------------------------------------------------------------
// Status toggle — three-state pill: pending → approved → amend → pending
// Keyboard accessible: Enter / Space cycles through.
// ---------------------------------------------------------------------------
const StatusToggle: React.FC<{ status: ReviewStatus; onChange: (s: ReviewStatus) => void; onAmend?: () => void; onLeaveAmend?: () => void }> = ({ status, onChange, onAmend, onLeaveAmend }) => {
    const reduced = useReducedMotion();
    const cycle: ReviewStatus[] = ["pending", "amend", "approved"];
    const next = () => {
        const newStatus = cycle[(cycle.indexOf(status) + 1) % cycle.length];
        onChange(newStatus);
        if (newStatus === "amend") onAmend?.();
        if (status === "amend" && newStatus !== "amend") onLeaveAmend?.();
    };
    return (
        <motion.button
            className={`rv-status rv-status--${status}`}
            onClick={next}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); } }}
            whileHover={reduced ? {} : { scale: 1.06 }}
            whileTap={reduced ? {} : { scale: 0.93 }}
        >
            <AnimatePresence mode="wait" initial={false}>
                <motion.span
                    key={status}
                    initial={{ opacity: 0, y: reduced ? 0 : -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduced ? 0 : 6 }}
                    transition={{ duration: 0.14 }}
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                    {status === "approved" && <><CheckCircle2 size={11} /> Approved</>}
                    {status === "amend"    && <><AlertTriangle size={11} /> To Amend</>}
                    {status === "pending"  && <>— Pending</>}
                </motion.span>
            </AnimatePresence>
        </motion.button>
    );
};

// ---------------------------------------------------------------------------
// Single review row
// ---------------------------------------------------------------------------
const ReviewRow: React.FC<{
    item: ReviewItem;
    batchIndex: number;
    matchedMp4: string | null;
    onChange: (patch: Partial<ReviewItem>) => void;
    onRemove: () => void;
    onOpenComp: (compId: number) => void;
    onToggleDiff: (compId: number) => void;
    onPreview: (item: ReviewItem) => void;
}> = ({ item, batchIndex, matchedMp4, onChange, onRemove, onOpenComp, onToggleDiff, onPreview }) => {
    const reduced = useReducedMotion();
    return (
        <motion.div
            className={`rv-row rv-row--${item.status}`}
            initial={{ opacity: 0, x: -10, y: -4 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.25, delay: reduced ? 0 : batchIndex * 0.06, ease: [0.22, 1, 0.36, 1] }}
            layout
        >
            <div className="rv-row-main">
                {/* Comp name — truncated after the artwork-type token so a
                    long .mov name doesn't overflow the row's buttons.  Full
                    name stays in the tooltip. */}
                <Tooltip text={item.name}>
                    <span className="rv-row-name">{truncateNameAtArtwork(item.name)}</span>
                </Tooltip>

                {/* In-panel preview — opens the synced master/local player
                    with live diff for this row. */}
                <Tooltip text="Preview in panel (synced master + local + diff)">
                    <motion.button
                        className="rv-preview-btn"
                        onClick={() => onPreview(item)}
                        whileHover={reduced ? {} : { scale: 1.1 }}
                        whileTap={reduced ? {} : { scale: 0.92 }}
                    >
                        <Play size={10} />
                    </motion.button>
                </Tooltip>

                {/* Matched .mp4 render — click to play the master in the OS
                    player for a quick sanity check. */}
                {matchedMp4 && (
                    <Tooltip text={`Play master: ${matchedMp4}`}>
                        <motion.button
                            className="rv-mp4-match"
                            onClick={async () => {
                                try { await evalTS("playFile", matchedMp4); }
                                catch { /* no bridge — ignore */ }
                            }}
                            whileHover={reduced ? {} : { scale: 1.15 }}
                            whileTap={reduced ? {} : { scale: 0.9 }}
                        >
                            <Film size={10} />
                        </motion.button>
                    </Tooltip>
                )}

                {/* Comparison comp — auto-created side-by-side QC comp.
                    Click to open in AE's viewer. */}
                {item.comparisonCompName && item.comparisonCompId && (
                    <Tooltip text={item.comparisonEnrich ? `${item.comparisonCompName}\n${item.comparisonEnrich}` : `Open "${item.comparisonCompName}" in AE viewer`}>
                        <motion.button
                            className="rv-comp-btn"
                            onClick={() => onOpenComp(item.comparisonCompId!)}
                            whileHover={reduced ? {} : { scale: 1.08 }}
                            whileTap={reduced ? {} : { scale: 0.94 }}
                        >
                            <Columns2 size={11} />
                            <span className="rv-comp-label">Compare</span>
                        </motion.button>
                    </Tooltip>
                )}

                {/* Diff toggle — flips the DIFF layer's visibility in the
                    comparison comp from the panel, so the artist doesn't have
                    to hunt the timeline checkbox. */}
                {item.comparisonCompId && (
                    <Tooltip text="Toggle the DIFF (difference) layer">
                        <motion.button
                            className="rv-diff-btn"
                            onClick={() => onToggleDiff(item.comparisonCompId!)}
                            whileHover={reduced ? {} : { scale: 1.1 }}
                            whileTap={reduced ? {} : { scale: 0.92 }}
                        >
                            <Layers size={11} />
                        </motion.button>
                    </Tooltip>
                )}

                {/* Status toggle */}
                <StatusToggle status={item.status} onChange={(s) => onChange({ status: s })} onAmend={() => onChange({ noteOpen: true })} onLeaveAmend={() => onChange({ noteOpen: false })} />

                {/* Note toggle */}
                <Tooltip text={item.noteOpen ? "Collapse note" : "Add / view note"}>
                    <motion.button
                        className={item.noteOpen || item.note ? "rv-note-btn rv-note-btn--active" : "rv-note-btn"}
                        onClick={() => onChange({ noteOpen: !item.noteOpen })}
                        whileHover={reduced ? {} : { scale: 1.08 }}
                        whileTap={reduced ? {} : { scale: 0.92 }}
                    >
                        {item.noteOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <Pencil size={11} />
                    </motion.button>
                </Tooltip>

                {/* Remove */}
                <Tooltip text="Remove from session">
                    <motion.button
                        className="rv-remove-btn"
                        onClick={onRemove}
                        whileHover={reduced ? {} : { scale: 1.1 }}
                        whileTap={reduced ? {} : { scale: 0.9 }}
                    >
                        <X size={12} />
                    </motion.button>
                </Tooltip>
            </div>

            <AnimatePresence initial={false}>
                {item.noteOpen && (
                    <motion.div
                        className="rv-note-area"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                    >
                        <textarea
                            className="rv-note-input"
                            placeholder="Note for the animator…"
                            value={item.note}
                            rows={2}
                            onChange={(e) => onChange({ note: e.target.value })}
                            autoFocus
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

// ---------------------------------------------------------------------------
// Review Session tab
// ---------------------------------------------------------------------------
const ReviewSession: React.FC = () => {
    const reduced = useReducedMotion();
    const { campaign } = useContext(CampaignContext);
    const [items, setItems] = usePersistentState<ReviewItem[]>("review-items", []);
    const [error, setError] = useState<string | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [batchKey, setBatchKey] = useState(0);
    // Per-item mp4 matches — name → mp4Path, populated by the backend's
    // reviewMatchToMaster() which reuses the Localise section's proven
    // buildMastersIndex + pickBestMasterFromIndex pipeline (campaign +
    // size + duration + aspect-ratio scoring).
    const [itemMatches, setItemMatches] = useState<Record<string, string> | null>(null);
    // The row currently open in the in-panel synced player, if any.
    const [previewItem, setPreviewItem] = useState<ReviewItem | null>(null);
    const toastId = useRef(0);
    const nextId = useRef(items.reduce((max, i) => Math.max(max, i.id), 0));
    // Mounted guard — flipped to false on unmount so async operations
    // (loadComps, handleOpenComp) don't setState after the component is
    // gone (tab switch mid-bridge-call).  Also clears any pending toast
    // timeouts.
    const mountedRef = useRef(true);
    const toastTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    useEffect(() => { return () => {
        mountedRef.current = false;
        for (const t of toastTimersRef.current) clearTimeout(t);
        toastTimersRef.current = [];
    }; }, []);

    const pushToast = (text: string, type: Toast["type"] = "success") => {
        if (!mountedRef.current) return;
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, text, type }]);
        const timer = setTimeout(() => {
            if (mountedRef.current) setToasts((t) => t.filter((x) => x.id !== id));
        }, 3500);
        toastTimersRef.current.push(timer);
    };

    const loadComps = async () => {
        setError(null);
        try {
            // 1. Import selected items from the AE Project panel — accepts
            //    both Comps and FootageItems (.mov files are FootageItems).
            const result = await evalTS("reviewLoadSelectedItems");
            if (!mountedRef.current) return;
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) { setError(result.error || "Something went wrong."); return; }
            const offset = items.length;
            const fresh: ReviewItem[] = (result.items || [])
                .filter((c: any) => !items.some((i) => i.name === c.name))
                .map((c: any, i: number) => ({
                    id: ++nextId.current,
                    name: c.name,
                    sourcePath: c.sourcePath ?? null,
                    status: "pending" as ReviewStatus,
                    note: "",
                    noteOpen: false,
                    batchOffset: offset,
                }));
            setItems((prev) => [...prev, ...fresh]);
            setBatchKey((k) => k + 1);
            if (fresh.length === 0) { pushToast("No new items to add.", "error"); return; }

            // 2. If a campaign is active, match every imported item against
            //    the campaign's master .mp4 renders using the Localise
            //    section's proven buildMastersIndex + pickBestMasterFromIndex
            //    pipeline — campaign + size + duration + aspect-ratio scoring.
            //    Items without a match just stay as plain review rows.
            if (campaign) {
                // Build the payload for the backend: each item's name and
                // source path so the matcher can extract tokens from the
                // filename.
                const matchPayload = fresh.map((item) => ({ name: item.name, sourcePath: item.sourcePath }));
                let matchedMp4s: Record<string, string> = {};
                try {
                    const matchResult = await evalTS("reviewMatchToMaster", campaign.mastersRoot, JSON.stringify(matchPayload));
                    if (!mountedRef.current) return;
                    const matchedItems: any[] = (matchResult as any)?.items || [];
                    for (const mi of matchedItems) {
                        if (mi.mp4Path) matchedMp4s[mi.name] = mi.mp4Path;
                    }
                    setItemMatches(matchedMp4s);
                } catch {
                    // Matching failed — items are still imported, just without
                    // matches.  Don't abort the import.
                }

                // 3. For every matched item, auto-create enriched comparison
                //    comps.  The AE item ids from the bridge result are paired
                //    with the matched .mp4 paths.
                const allBridgeItems: any[] = result.items || [];
                const compMatches: { mp4Path: string; localItemId: number; localItemName: string; reviewId: number }[] = [];
                for (const reviewItem of fresh) {
                    const mp4Path = matchedMp4s[reviewItem.name];
                    if (!mp4Path) continue;
                    const bridgeEntry = allBridgeItems.find((c: any) => c.name === reviewItem.name);
                    if (!bridgeEntry) continue;
                    compMatches.push({
                        mp4Path,
                        localItemId: bridgeEntry.id,
                        localItemName: reviewItem.name,
                        reviewId: reviewItem.id,
                    });
                }

                if (compMatches.length > 0) {
                    try {
                        const compResult = await evalTS("createReviewComparisons", JSON.stringify(compMatches));
                        if (!mountedRef.current) return;
                        const results: any[] = (compResult as any)?.results || [];
                        // Zip results with compMatches by index — the backend
                        // iterates the input in order and returns results in
                        // the same order, so results[i] ↔ compMatches[i].
                        const stampByReviewId: Record<number, { compName: string; compId: number; enrich?: string; fps?: number }> = {};
                        for (let ri = 0; ri < results.length && ri < compMatches.length; ri++) {
                            // Key off the comp's actual presence (compId +
                            // compName), NOT the success flag — the backend can
                            // create the comp and still report a non-success if
                            // an enrichment step hiccuped.  If the comp exists,
                            // the row should get its purple chip so it's
                            // openable.
                            if (results[ri] && results[ri].compId && results[ri].compName) {
                                stampByReviewId[compMatches[ri].reviewId] = {
                                    compName: results[ri].compName,
                                    compId: results[ri].compId,
                                    enrich: results[ri].enrichNotes || "",
                                    fps: results[ri].compFps,
                                };
                            }
                        }
                        if (Object.keys(stampByReviewId).length > 0) {
                            setItems((prev) => prev.map((item) => {
                                const stamp = stampByReviewId[item.id];
                                return stamp
                                    ? { ...item, comparisonCompName: stamp.compName, comparisonCompId: stamp.compId, comparisonEnrich: stamp.enrich, comparisonFps: stamp.fps }
                                    : item;
                            }));
                        }
                        const succeeded = Object.keys(stampByReviewId).length;
                        pushToast(`${fresh.length} item${fresh.length > 1 ? "s" : ""} added, ${succeeded} comparison comp${succeeded > 1 ? "s" : ""} created.`);
                        sfx.bop();
                    } catch {
                        pushToast(`${fresh.length} item${fresh.length > 1 ? "s" : ""} added.  Comparison comps could not be created.`);
                    }
                } else {
                    const matchCount = Object.keys(matchedMp4s).length;
                    if (matchCount > 0) {
                        pushToast(`${fresh.length} item${fresh.length > 1 ? "s" : ""} added, ${matchCount} matched to master renders (but comp creation skipped).`);
                    } else {
                        pushToast(`${fresh.length} item${fresh.length > 1 ? "s" : ""} added (no matching master renders found in this campaign).`);
                    }
                }
            } else {
                pushToast(`${fresh.length} item${fresh.length > 1 ? "s" : ""} added.`);
                sfx.bop();
            }
        } catch {
            setError("No CEP bridge — open inside After Effects.");
        }
    };

    const updateItem = (id: number, patch: Partial<ReviewItem>) =>
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

    const removeItem = (id: number) =>
        setItems((prev) => prev.filter((i) => i.id !== id));

    const clearAll = () => { setItems([]); setError(null); };

    const handleOpenComp = async (compId: number) => {
        lastOpenedCompIdRef.current = compId;
        try {
            const result = await evalTS("focusReviewComp", compId);
            if (!mountedRef.current) return;
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) pushToast(result.error || "Could not open comp.", "error");
        } catch {
            pushToast("No CEP bridge — open inside After Effects.", "error");
        }
    };

    // Step through the session's comparison comps: Prev/Next opens the
    // previous/next item that has a comparison comp, for the approve-
    // approve-approve review pass.
    const handleStepComp = async (dir: 1 | -1) => {
        const withComps = items.filter((i) => i.comparisonCompId);
        if (withComps.length === 0) { pushToast("No comparison comps in this session.", "error"); return; }
        const currentIndex = withComps.findIndex((i) => i.comparisonCompId === (lastOpenedCompIdRef.current ?? -1));
        const nextIndex = (currentIndex === -1 ? 0 : (currentIndex + dir + withComps.length) % withComps.length);
        const target = withComps[nextIndex];
        if (!target.comparisonCompId) return;
        lastOpenedCompIdRef.current = target.comparisonCompId;
        await handleOpenComp(target.comparisonCompId);
    };
    const lastOpenedCompIdRef = useRef<number | null>(null);

    // Open the in-panel synced player for a row.  Needs both the master .mp4
    // (from itemMatches) and the local .mov (the item's sourcePath).  Scrubs
    // also jump the AE comparison comp to the same frame via reviewJumpComp.
    const handlePreview = (item: ReviewItem) => {
        const mp4 = itemMatches?.[item.name] || null;
        if (!mp4 || !item.sourcePath) {
            pushToast("Preview needs both a matched master and a local render path.", "error");
            return;
        }
        setPreviewItem(item);
    };

    const handlePlayerScrub = async (frame: number) => {
        if (!previewItem?.comparisonCompId) return;
        try {
            await evalTS("reviewJumpComp", previewItem.comparisonCompId, frame);
        } catch { /* bridge hiccup — ignore, comp just won't follow */ }
    };

    const handleToggleDiff = async (compId: number) => {
        try {
            const result = await evalTS("reviewToggleDiff", compId);
            if (!mountedRef.current) return;
            if (result === undefined) throw new Error("no bridge");
            pushToast(result.success
                ? (result.visible ? "Difference view on." : "Difference view off.")
                : (result.error || "Could not toggle diff."),
                result.success ? "success" : "error");
        } catch {
            pushToast("No CEP bridge — open inside After Effects.", "error");
        }
    };

    const approvedCount = items.filter((i) => i.status === "approved").length;
    const amendCount    = items.filter((i) => i.status === "amend").length;
    const pendingCount  = items.filter((i) => i.status === "pending").length;

    // Count how many items have a matching .mp4 render in the active campaign.
    const matchedCount = itemMatches
        ? items.filter((item) => itemMatches[item.name]).length
        : 0;

    // Wrike-format export: every "To Amend" item WITH a note, each as the
    // source .mov's full path followed by an orange-diamond-prefixed note
    // line, blank line between entries -- matches the director's own
    // paste-into-Wrike convention exactly (real emoji character, not an
    // icon component, since this text is meant to be copied verbatim).
    // Amend items with no note yet are skipped -- nothing meaningful to
    // hand the director without one.
    const amendWithNotes = items.filter((i) => i.status === "amend" && i.note.trim());
    const wrikeText = amendWithNotes
        .map((i) => (i.sourcePath || i.name) + "\n🔶 " + i.note.trim())
        .join("\n\n");

    // Copy straight from the browser.  The ExtendScript clipboard path
    // (timesheetCopyToClipboard) writes the text to a temp file with
    // File.write(), which uses the system ANSI codepage and mangles the 🔶
    // surrogate pair before it reaches the clipboard — the "jumbled emoji"
    // bug.  In the browser the exact JS string survives intact, so copy here.
    //
    // navigator.clipboard.writeText needs a SECURE context, which a file://
    // CEP panel is not — so it's not the primary path.  The reliable browser
    // trick on file:// is a hidden textarea + document.execCommand("copy"):
    // it copies the exact JS string (emoji intact) synchronously, works
    // without a secure context, and runs from this button's click gesture.
    // The bridge is a last resort only.
    const copyWrikeText = async () => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(wrikeText);
                pushToast("Copied to clipboard.", "success");
                return;
            }
        } catch {
            /* fall through to textarea */
        }
        try {
            const ta = document.createElement("textarea");
            ta.value = wrikeText;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            if (ok) {
                pushToast("Copied to clipboard.", "success");
                return;
            }
        } catch {
            /* fall through to bridge */
        }
        try {
            const result = await evalTS("timesheetCopyToClipboard", wrikeText);
            if (result === undefined) throw new Error("no bridge");
            pushToast(result.success ? "Copied to clipboard." : result.error || "Could not copy.", result.success ? "success" : "error");
        } catch {
            pushToast("No CEP bridge — open inside After Effects to copy.", "error");
        }
    };

    return (
        <div className="rv-session">
            {/* Toolbar */}
            <div className="rv-toolbar">
                <Tooltip text={campaign ? "Import selected items and auto-create comparison comps for any with a matching master .mp4" : "Import items currently selected in the Project panel"}>
                    <motion.button
                        className="rv-load-btn"
                        onClick={loadComps}
                        whileHover={reduced ? {} : { scale: 1.03 }}
                        whileTap={reduced ? {} : { scale: 0.97 }}
                    >
                        <ListPlus size={14} /> {campaign ? "Import & Compare" : "Import Selected"}
                    </motion.button>
                </Tooltip>

                {/* Prev / Next — step through the session's comparison comps
                    without returning to the list between each one. */}
                {items.some((i) => i.comparisonCompId) && (
                    <>
                        <Tooltip text="Previous comparison comp">
                            <motion.button
                                className="rv-step-btn"
                                onClick={() => handleStepComp(-1)}
                                whileHover={reduced ? {} : { scale: 1.05 }}
                                whileTap={reduced ? {} : { scale: 0.95 }}
                            >
                                <ChevronLeft size={13} />
                            </motion.button>
                        </Tooltip>
                        <Tooltip text="Next comparison comp">
                            <motion.button
                                className="rv-step-btn"
                                onClick={() => handleStepComp(1)}
                                whileHover={reduced ? {} : { scale: 1.05 }}
                                whileTap={reduced ? {} : { scale: 0.95 }}
                            >
                                <ChevronRight size={13} />
                            </motion.button>
                        </Tooltip>
                    </>
                )}

                <div className="rv-bar-spacer" />

                {items.length > 0 && (
                    <div className="rv-summary">
                        {approvedCount > 0 && <span className="rv-count rv-count--approved"><CheckCircle2 size={10} /> {approvedCount}</span>}
                        {amendCount > 0    && <span className="rv-count rv-count--amend"><AlertTriangle size={10} /> {amendCount}</span>}
                        {pendingCount > 0  && <span className="rv-count rv-count--pending">— {pendingCount}</span>}
                        {campaign && matchedCount > 0 && (
                            <Tooltip text={`${matchedCount} of ${items.length} matched to .mp4 renders in this campaign`}>
                                <span className="rv-count rv-count--mp4"><Film size={10} /> {matchedCount}</span>
                            </Tooltip>
                        )}
                    </div>
                )}

                <Tooltip text="Clear session">
                    <motion.button
                        className="rv-icon-btn"
                        onClick={clearAll}
                        disabled={items.length === 0}
                        whileHover={reduced ? {} : { scale: 1.08 }}
                        whileTap={reduced ? {} : { scale: 0.94 }}
                    >
                        <Trash2 size={14} />
                    </motion.button>
                </Tooltip>
            </div>

            {/* Error */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        className="rv-error"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                    >
                        <AlertTriangle size={12} />
                        <span>{error}</span>
                        <button onClick={() => setError(null)}><X size={11} /></button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* In-panel synced player — shown for the row the user chose to
                preview.  Master + local play together with a live diff; the
                AE comparison comp follows scrubs via reviewJumpComp. */}
            {previewItem && itemMatches?.[previewItem.name] && previewItem.sourcePath && (
                <ReviewPlayer
                    masterPath={itemMatches[previewItem.name]}
                    localPath={previewItem.sourcePath}
                    compFrameRate={previewItem.comparisonFps || 25}
                    onScrub={handlePlayerScrub}
                />
            )}

            {/* Row list */}
            <div className="rv-list">
                {items.length === 0 ? (
                    <div className="rv-empty">
                        <motion.div
                            animate={reduced ? {} : { y: [0, -5, 0] }}
                            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                        >
                            <MessageSquareDiff size={22} />
                        </motion.div>
                        <span>Select items in the Project panel, then Import</span>
                        {campaign ? (
                            <span className="rv-empty-hint">Imported items will be matched to master renders in "{campaign.name}" using campaign, size, duration, and aspect ratio</span>
                        ) : (
                            <span className="rv-empty-hint">Select a campaign in the OV Library tab to auto-match master renders</span>
                        )}
                    </div>
                ) : (
                    <div key={batchKey} className="rv-list">
                        {items.map((item, i) => {
                            const matchedMp4 = itemMatches?.[item.name] || null;
                            return (
                                <ReviewRow
                                    key={`${item.id}-${batchKey}`}
                                    item={item}
                                    batchIndex={i - item.batchOffset}
                                    matchedMp4={matchedMp4}
                                    onChange={(patch) => updateItem(item.id, patch)}
                                    onRemove={() => removeItem(item.id)}
                                    onOpenComp={handleOpenComp}
                                    onToggleDiff={handleToggleDiff}
                                    onPreview={handlePreview}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Wrike-format export -- only shown once there's something to
                paste, right below the list per direct request. */}
            {amendWithNotes.length > 0 && (
                <div className="rv-wrike-box">
                    <div className="rv-wrike-header">
                        <span>Wrike Format ({amendWithNotes.length})</span>
                        <Tooltip text="Copy to clipboard">
                            <button className="rv-wrike-copy" onClick={copyWrikeText}>
                                <Copy size={12} /> Copy
                            </button>
                        </Tooltip>
                    </div>
                    <pre className="rv-wrike-text">{wrikeText}</pre>
                </div>
            )}

            {/* Toasts */}
            <div className="rv-toast-stack">
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
                            <button onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}><X size={12} /></button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Tab definition
// ---------------------------------------------------------------------------
type Tab = "library" | "session";

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "library", label: "OV Library",      Icon: Library           },
    { id: "session", label: "Review Session",   Icon: MessageSquareDiff },
];

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
const ReviewHubTool: React.FC = () => {
    const reduced = useReducedMotion();
    const [activeTab, setActiveTab] = usePersistentState<Tab>("review-activeTab", "library");
    // The active campaign, owned by OV Library's picker, shared with Review
    // Session so it can find matching .mp4 renders for imported .mov files.
    const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
    // Memoize the context value so consumers don't re-render every time
    // ReviewHubTool itself re-renders for an unrelated reason (e.g. tab
    // switch, blob animation).  Without this, { campaign: activeCampaign }
    // is a new object identity every render, and every useContext consumer
    // re-renders with it — including the ReviewSession, which then re-runs
    // its effects.
    const campaignContextValue = React.useMemo(
        () => ({ campaign: activeCampaign }),
        [activeCampaign]
    );

    return (
        <CampaignContext.Provider value={campaignContextValue}>
        <div className="review-hub">
            <div className="rh-content">
                {/* Ambient purple blobs — matches Review category color.
                    Lives inside .rh-content (not as a sibling spanning the
                    whole .review-hub box) so overflow:hidden + border-radius
                    on the card clip the glow to the card's own rounded
                    corners instead of it spilling out above the top edge. */}
                <div className="rh-ambient-bg" aria-hidden="true">
                    <motion.div
                        className="rh-ambient-blob rh-ambient-blob--tl"
                        animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.07, 1] }}
                        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <motion.div
                        className="rh-ambient-blob rh-ambient-blob--br"
                        animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.07, 1] }}
                        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 5 }}
                    />
                </div>

                <div className="rh-content-inner">
                    {/* Tab bar -- one continuous seamless gradient (no per-button
                        fill, no divider, no rounding) that physically slides
                        from one half to the other via Framer's `layout` prop,
                        rather than each button carrying its own separate
                        colored/rounded box. */}
                    <div className="rh-tab-bar">
                        <motion.div
                            className="rh-tab-highlight"
                            layout
                            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                            style={{ left: activeTab === "library" ? "0%" : "50%" }}
                        />
                        {TABS.map(({ id, label, Icon }) => (
                            <button
                                key={id}
                                className={activeTab === id ? "rh-tab rh-tab--active" : "rh-tab"}
                                onClick={() => { if (id !== activeTab) sfx.menu(); setActiveTab(id); }}
                            >
                                <Icon size={14} />
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Tab content */}
                    <div className="rh-tab-body">
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={activeTab}
                                className="rh-tab-pane"
                                initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: reduced ? 0 : -6 }}
                                transition={{ duration: 0.16, ease: "easeInOut" }}
                            >
                                {activeTab === "library" && (
                                    <Suspense fallback={<div className="rh-loading">Loading…</div>}>
                                        <OVLibraryTool hero onCampaignChange={setActiveCampaign} />
                                    </Suspense>
                                )}
                                {activeTab === "session" && <ReviewSession />}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
        </CampaignContext.Provider>
    );
};

export default ReviewHubTool;
