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
// The tab bar is the only navigation element. No sidebar, no back stack
// within the hub itself -- CategoryScreen renders this full-width because
// review has a single registered tool (review-hub, categories: ["review"]).
// =============================================================================
import React, { Suspense, useRef, useState, useEffect } from "react";
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
    onChange: (patch: Partial<ReviewItem>) => void;
    onRemove: () => void;
}> = ({ item, batchIndex, onChange, onRemove }) => {
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
    const [items, setItems] = usePersistentState<ReviewItem[]>("review-items", []);
    const [error, setError] = useState<string | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [batchKey, setBatchKey] = useState(0);
    const toastId = useRef(0);
    const nextId = useRef(items.reduce((max, i) => Math.max(max, i.id), 0));
    const prevItemCount = useRef(0);

    const pushToast = (text: string, type: Toast["type"] = "success") => {
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, text, type }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    };

    const loadComps = async () => {
        setError(null);
        try {
            // Reuses the same bridge call as DeliveryChecklist — returns
            // { success, comps: [{id, name, ...}] } for whatever is selected
            // in the Project panel.
            const result = await evalTS("deliveryChecklistLoadComps");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) { setError(result.error || "Something went wrong."); return; }
            const offset = items.length;
            const fresh: ReviewItem[] = (result.comps || [])
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
            if (fresh.length === 0) pushToast("No new comps to add.", "error");
            else { pushToast(`${fresh.length} comp${fresh.length > 1 ? "s" : ""} added.`); sfx.bop(); }
        } catch {
            setError("No CEP bridge — open inside After Effects.");
        }
    };

    const updateItem = (id: number, patch: Partial<ReviewItem>) =>
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

    const removeItem = (id: number) =>
        setItems((prev) => prev.filter((i) => i.id !== id));

    const clearAll = () => { setItems([]); setError(null); };

    const approvedCount = items.filter((i) => i.status === "approved").length;
    const amendCount    = items.filter((i) => i.status === "amend").length;
    const pendingCount  = items.filter((i) => i.status === "pending").length;

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
                <Tooltip text="Import comps currently selected in the Project panel">
                    <motion.button
                        className="rv-load-btn"
                        onClick={loadComps}
                        whileHover={reduced ? {} : { scale: 1.03 }}
                        whileTap={reduced ? {} : { scale: 0.97 }}
                    >
                        <ListPlus size={14} /> Import Selected
                    </motion.button>
                </Tooltip>

                <div className="rv-bar-spacer" />

                {items.length > 0 && (
                    <div className="rv-summary">
                        {approvedCount > 0 && <span className="rv-count rv-count--approved"><CheckCircle2 size={10} /> {approvedCount}</span>}
                        {amendCount > 0    && <span className="rv-count rv-count--amend"><AlertTriangle size={10} /> {amendCount}</span>}
                        {pendingCount > 0  && <span className="rv-count rv-count--pending">— {pendingCount}</span>}
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
                    </div>
                ) : (
                    <div key={batchKey} className="rv-list">
                        {items.map((item, i) => (
                            <ReviewRow
                                key={`${item.id}-${batchKey}`}
                                item={item}
                                batchIndex={i - item.batchOffset}
                                onChange={(patch) => updateItem(item.id, patch)}
                                onRemove={() => removeItem(item.id)}
                            />
                        ))}
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

    return (
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
                                        <OVLibraryTool hero />
                                    </Suspense>
                                )}
                                {activeTab === "session" && <ReviewSession />}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReviewHubTool;
