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
    ChevronRight,
    X,
    Pencil,
    Copy,
    Film,
    Columns2,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { sfx } from "../../lib/utils/sfx";
import { usePersistentState } from "../../lib/utils/usePersistentState";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./ReviewHub.scss";

// OVLibrary is the full existing component -- lazy loaded, not inlined.
// It already manages its own state and CEP bridge calls.
const OVLibraryTool = React.lazy(() => import("./OVLibrary"));

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
}> = ({ item, batchIndex, matchedMp4, onChange, onRemove, onOpenComp }) => {
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
                {/* Comp name */}
                <Tooltip text={item.name}>
                    <span className="rv-row-name">{item.name}</span>
                </Tooltip>

                {/* Matched .mp4 render — shown when the active campaign has
                    a render whose filename stem matches this item's source
                    .mov. Same stem-matching convention OV Library uses. */}
                {matchedMp4 && (
                    <Tooltip text={matchedMp4}>
                        <span className="rv-mp4-match" title={matchedMp4}>
                            <Film size={10} />
                        </span>
                    </Tooltip>
                )}

                {/* Comparison comp — auto-created when imported with a
                    matched .mp4.  Click to open in AE's viewer. */}
                {item.comparisonCompName && (
                    <Tooltip text={`Open comparison comp "${item.comparisonCompName}"`}>
                        <motion.button
                            className="rv-comp-btn"
                            onClick={() => item.comparisonCompId && onOpenComp(item.comparisonCompId)}
                            whileHover={reduced ? {} : { scale: 1.08 }}
                            whileTap={reduced ? {} : { scale: 0.94 }}
                        >
                            <Columns2 size={11} />
                            <span className="rv-comp-label">{item.comparisonCompName}</span>
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
    // Campaign-wide render map: stem (lowercase) → mp4 path. Built once per
    // campaign via scanAllRenders(), then each imported .mov is matched
    // against it by its own filename stem.
    const [renderMap, setRenderMap] = useState<Record<string, string> | null>(null);
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

    // Rebuild the campaign-wide render map whenever the active campaign
    // changes, so imported .mov files can be matched against .mp4 renders
    // by identical filename stem (the same convention OV Library uses).
    useEffect(() => {
        if (!campaign) { setRenderMap(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const renders: { stem: string; path: string }[] = await evalTS("scanAllRenders", campaign.mastersRoot);
                if (cancelled) return;
                const map: Record<string, string> = {};
                for (const r of renders || []) map[r.stem.toLowerCase()] = r.path;
                setRenderMap(map);
            } catch {
                if (!cancelled) setRenderMap(null);
            }
        })();
        return () => { cancelled = true; };
    }, [campaign]);

    // Extract a filename stem from a path (or plain name), lowercased, for
    // lookup in the render map.
    const stemFromPath = (path: string): string => {
        // Last segment after any / or \
        const seg = path.replace(/\\/g, "/").split("/").pop() || path;
        // Strip extension
        const dot = seg.lastIndexOf(".");
        return dot === -1 ? seg.toLowerCase() : seg.substring(0, dot).toLowerCase();
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
            if (fresh.length === 0) { pushToast("No new comps to add.", "error"); return; }

            // 2. If a campaign is active and we have a render map, auto-create
            //    enriched comparison comps for every item whose source .mov has
            //    a matching .mp4 in the campaign.  Items without a match just
            //    stay as plain review rows.
            if (campaign && renderMap) {
                // Match each imported item against the render map and pair
                // the AE comp id (from the bridge result) with the matched
                // .mp4 path.  The bridge comps array is in the SAME order as
                // `fresh` because the filter preserves it.
                const allComps: any[] = result.items || [];
                const matches: { mp4Path: string; localItemId: number; localItemName: string; reviewId: number }[] = [];
                for (let fi = 0; fi < fresh.length; fi++) {
                    const reviewItem = fresh[fi];
                    // Find the corresponding bridge comp entry to get the
                    // AE item id.  Name match is safe here — nothing was
                    // renamed between the bridge call and this loop, and the
                    // filter above already deduplicates by name.
                    const compEntry = allComps.find((c: any) => c.name === reviewItem.name);
                    if (!compEntry) continue;
                    // Match by stem, same two-tier lookup the row rendering
                    // uses: source .mov path first, then comp name as fallback.
                    let mp4Path: string | null = null;
                    if (reviewItem.sourcePath) mp4Path = renderMap[stemFromPath(reviewItem.sourcePath)] || null;
                    if (!mp4Path) mp4Path = renderMap[reviewItem.name.toLowerCase()] || null;
                    if (mp4Path) {
                        matches.push({
                            mp4Path,
                            localItemId: compEntry.id,
                            localItemName: reviewItem.name,
                            reviewId: reviewItem.id,
                        });
                    }
                }

                if (matches.length > 0) {
                    try {
                        const compResult = await evalTS("createReviewComparisons", JSON.stringify(matches));
                        if (!mountedRef.current) return;
                        const results: any[] = (compResult as any)?.results || [];
                        // Stamp each review item with its comparison comp info.
                        setItems((prev) => prev.map((item) => {
                            const match = matches.find((m) => m.reviewId === item.id);
                            if (!match) return item;
                            const r = results.find((res: any) =>
                                res.localItemId === match.localItemId || res.compName?.endsWith(item.name.replace(/[\\\/:*?"<>|]/g, "-"))
                            );
                            // Map result back by position — if the results
                            // array aligns with the matches array (same order,
                            // same count), use positional lookup as fallback.
                            const idx = matches.indexOf(match);
                            const fallback = (idx >= 0 && results.length > idx) ? results[idx] : null;
                            const compInfo = r || fallback;
                            if (compInfo && compInfo.success && compInfo.compName) {
                                return { ...item, comparisonCompName: compInfo.compName, comparisonCompId: compInfo.compId };
                            }
                            return item;
                        }));
                        const succeeded = results.filter((r: any) => r.success).length;
                        if (succeeded > 0) {
                            pushToast(`${fresh.length} comp${fresh.length > 1 ? "s" : ""} added, ${succeeded} comparison comp${succeeded > 1 ? "s" : ""} created.`);
                            sfx.bop();
                        } else {
                            pushToast(`${fresh.length} comp${fresh.length > 1 ? "s" : ""} added (comparison comps failed — check the master renders are still on disk).`);
                        }
                    } catch {
                        // Comparison comp creation failed — items are still
                        // imported, just without comps.  Don't abort the import.
                        pushToast(`${fresh.length} comp${fresh.length > 1 ? "s" : ""} added.  Comparison comps could not be created.`);
                    }
                } else {
                    pushToast(`${fresh.length} comp${fresh.length > 1 ? "s" : ""} added (no matching .mp4 renders to compare against).`);
                }
            } else {
                pushToast(`${fresh.length} comp${fresh.length > 1 ? "s" : ""} added.`);
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
        try {
            const result = await evalTS("focusReviewComp", compId);
            if (!mountedRef.current) return;
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) pushToast(result.error || "Could not open comp.", "error");
        } catch {
            pushToast("No CEP bridge — open inside After Effects.", "error");
        }
    };

    const approvedCount = items.filter((i) => i.status === "approved").length;
    const amendCount    = items.filter((i) => i.status === "amend").length;
    const pendingCount  = items.filter((i) => i.status === "pending").length;

    // Count how many items have a matching .mp4 render in the active campaign.
    const matchedCount = items.filter((item) => {
        if (!renderMap) return false;
        if (item.sourcePath && renderMap[stemFromPath(item.sourcePath)]) return true;
        return renderMap[item.name.toLowerCase()] || false;
    }).length;

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

    const copyWrikeText = async () => {
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
                        <span>Select comps in the Project panel, then Import</span>
                        {campaign ? (
                            <span className="rv-empty-hint">.mov files will be matched to .mp4 renders in "{campaign.name}" by filename stem</span>
                        ) : (
                            <span className="rv-empty-hint">Select a campaign in the OV Library tab to auto-match .mp4 renders</span>
                        )}
                    </div>
                ) : (
                    <div key={batchKey} className="rv-list">
                        {items.map((item, i) => {
                            // Match this item against the campaign's render map
                            // by identical filename stem — same convention OV
                            // Library uses for master↔render pairing.
                            let matchedMp4: string | null = null;
                            if (renderMap) {
                                // Try the source .mov path first, then the
                                // comp name as a fallback (for comps whose
                                // source isn't a separate footage file).
                                if (item.sourcePath) {
                                    matchedMp4 = renderMap[stemFromPath(item.sourcePath)] || null;
                                }
                                if (!matchedMp4) {
                                    matchedMp4 = renderMap[item.name.toLowerCase()] || null;
                                }
                            }
                            return (
                                <ReviewRow
                                    key={`${item.id}-${batchKey}`}
                                    item={item}
                                    batchIndex={i - item.batchOffset}
                                    matchedMp4={matchedMp4}
                                    onChange={(patch) => updateItem(item.id, patch)}
                                    onRemove={() => removeItem(item.id)}
                                    onOpenComp={handleOpenComp}
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
