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
    Eye,
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
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { sfx } from "../../lib/utils/sfx";
import { usePersistentState } from "../../lib/utils/usePersistentState";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import TutorialIcon from "../TutorialIcon";
import ReviewJobs from "./ReviewJobs";
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
    // type (exact, case-insensitive).  This avoids a substring match like
    // "_DINTH" landing inside "_DINTHING_".
    const tokens = fullName.split("_");
    let found = -1;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i].toUpperCase();
        for (let a = 0; a < ARTWORK_TYPES.length; a++) {
            if (t === ARTWORK_TYPES[a]) { found = i; break; }
        }
        if (found !== -1) break;
    }
    if (found === -1) return fullName;
    // Keep everything AFTER the artwork type — the distinguishing part
    // (creative / size / duration / territory).  The campaign prefix before
    // the artwork type is repetitive across a session and is what was
    // overflowing the buttons, so it's dropped.
    return tokens.slice(found + 1).join("_");
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
    /** The AE project item id, so a failed compare can be retried. */
    aeId?: number;
    /** Why the comparison comp wasn't built, when it wasn't. */
    comparisonError?: string;
    // The fields above are the MASTER comparison (kept as they were, so a
    // saved session still loads). The other two kinds live here.
    /** The master render this item matched, kept on the item so a reloaded
     *  session still knows it. */
    masterPath?: string;
    /** An earlier version of this deliverable (V01 for a V02), off disk. */
    amendPath?: string;
    amendName?: string;
    /** A POST render's PRE twin, off disk. */
    prePath?: string;
    preName?: string;
    preFolder?: string;
    altComps?: { amend?: CompStamp; prepost?: CompStamp };
}

/** What a row is compared against. "master" is the OV render; "amend" the
 *  previous version; "prepost" the PRE batch's render of the same site. */
type CompareKind = "master" | "amend" | "prepost";
type Section = "all" | CompareKind;

interface CompStamp {
    compName?: string;
    compId?: number;
    enrich?: string;
    fps?: number;
    error?: string;
}

const SECTIONS: { id: Section; label: string; tip: string }[] = [
    { id: "all",     label: "All",         tip: "Every item, each against the reference it was imported for" },
    { id: "master",  label: "vs Master",   tip: "Against the campaign's OV master render" },
    { id: "amend",   label: "Amends",      tip: "Against the previous version of the same deliverable (V01 for a V02), found beside it or in its _Old" },
    { id: "prepost", label: "Pre vs Post", tip: "A POST render against its PRE batch twin: the same name without the Post token, in a sibling batch folder" },
];

/** Where an item lands when imported: the most specific reference it has. A
 *  POST render with a PRE twin is being checked against PRE; a V02 against
 *  its V01; everything else against the master. */
function primaryKind(item: ReviewItem): CompareKind {
    if (item.prePath) return "prepost";
    if (item.amendPath) return "amend";
    return "master";
}

function refPathOf(item: ReviewItem, kind: CompareKind, matches: Record<string, string> | null): string | null {
    if (kind === "amend") return item.amendPath || null;
    if (kind === "prepost") return item.prePath || null;
    return item.masterPath || (matches && matches[item.name]) || null;
}

function compOf(item: ReviewItem, kind: CompareKind): CompStamp {
    if (kind === "master") {
        return { compName: item.comparisonCompName, compId: item.comparisonCompId, enrich: item.comparisonEnrich, fps: item.comparisonFps, error: item.comparisonError };
    }
    return (item.altComps && item.altComps[kind]) || {};
}

function compPatch(item: ReviewItem, kind: CompareKind, stamp: CompStamp): Partial<ReviewItem> {
    if (kind === "master") {
        return { comparisonCompName: stamp.compName, comparisonCompId: stamp.compId, comparisonEnrich: stamp.enrich, comparisonFps: stamp.fps, comparisonError: stamp.error };
    }
    return { altComps: { ...(item.altComps || {}), [kind]: stamp } };
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
// Shorten a full master path to just its filename (no folder, no extension)
// for the "vs <master>" second line in each row.
function masterDisplayName(masterPath: string): string {
    const seg = masterPath.replace(/\\/g, "/").split("/").pop() || masterPath;
    const dot = seg.lastIndexOf(".");
    return dot === -1 ? seg : seg.substring(0, dot);
}

const ReviewRow: React.FC<{
    item: ReviewItem;
    batchIndex: number;
    kind: CompareKind;
    comp: CompStamp;
    matchedMp4: string | null;
    isOpen: boolean;
    onChange: (patch: Partial<ReviewItem>) => void;
    onRemove: () => void;
    onOpenComp: (compId: number) => void;
    onToggleDiff: (compId: number) => void;
    onRetryCompare: () => void;
}> = ({ item, batchIndex, kind, comp, matchedMp4, isOpen, onChange, onRemove, onOpenComp, onToggleDiff, onRetryCompare }) => {
    const reduced = useReducedMotion();
    return (
        <motion.div
            className={`rv-row rv-row--${item.status}${isOpen ? " rv-row--open" : ""}`}
            initial={{ opacity: 0, x: -10, y: -4 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.25, delay: reduced ? 0 : batchIndex * 0.06, ease: [0.22, 1, 0.36, 1] }}
            layout
        >
            <div className="rv-row-main">
                {/* Name block — truncated local name on line one, and the
                    master it's paired against on line two so the pairing is
                    visible at a glance instead of on hover.  The green film
                    icon sits right beside the master name — it plays that
                    master in the OS player, so it lives where the master is
                    shown, not out in the action row. */}
                <span className="rv-row-name-block">
                    <Tooltip text={item.name}>
                        <span className="rv-row-name">{truncateNameAtArtwork(item.name)}</span>
                    </Tooltip>
                    {matchedMp4 && (
                        <span className="rv-row-master" title={matchedMp4}>
                            <span className="rv-row-master-label">
                                {kind === "amend" ? "vs previous" : kind === "prepost" ? `vs PRE${item.preFolder ? " · " + item.preFolder : ""}` : "vs"}
                            </span>
                            <span className="rv-row-master-name">{kind === "master" ? masterDisplayName(matchedMp4) : truncateNameAtArtwork(masterDisplayName(matchedMp4))}</span>
                            <Tooltip text={`Play ${kind === "master" ? "master" : kind === "amend" ? "previous version" : "PRE render"}: ${matchedMp4}`}>
                                <motion.button
                                    className="rv-mp4-match"
                                    onClick={async () => {
                                        try { await evalTS("playFile", matchedMp4); }
                                        catch { /* no bridge — ignore */ }
                                    }}
                                    whileHover={reduced ? {} : { scale: 1.2 }}
                                    whileTap={reduced ? {} : { scale: 0.9 }}
                                >
                                    <Film size={10} />
                                </motion.button>
                            </Tooltip>
                        </span>
                    )}
                </span>

                {/* Comparison comp — auto-created side-by-side QC comp.
                    Click to open in AE's viewer. */}
                {comp.compName && comp.compId && (
                    <Tooltip text={comp.enrich ? `${comp.compName}\n${comp.enrich}` : `Open "${comp.compName}" in AE viewer`}>
                        <motion.button
                            className="rv-comp-btn"
                            onClick={() => onOpenComp(comp.compId!)}
                            whileHover={reduced ? {} : { scale: 1.08 }}
                            whileTap={reduced ? {} : { scale: 0.94 }}
                        >
                            <Columns2 size={11} />
                            <span className="rv-comp-label">Compare</span>
                        </motion.button>
                    </Tooltip>
                )}

                {/* MATCHED BUT NOT BUILT: the master was found and the comp
                    wasn't made. That row used to show no Compare button at all
                    and no reason; now it says why and builds on press. */}
                {matchedMp4 && !comp.compId && (
                    <Tooltip text={comp.error ? `Couldn't build the comparison: ${comp.error}\nPress to try again.` : "Build the comparison comp"}>
                        <motion.button
                            className="rv-comp-btn rv-comp-btn--retry"
                            onClick={onRetryCompare}
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
                {comp.compId && (
                    <Tooltip text="Toggle the DIFF (difference) layer">
                        <motion.button
                            className="rv-diff-btn"
                            onClick={() => onToggleDiff(comp.compId!)}
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
    // The comparison comp currently open in AE — drives the "open now" row
    // highlight so Prev/Next navigation always shows where you are.
    const [lastOpenedCompId, setLastOpenedCompId] = useState<number | null>(null);
    // Per-item mp4 matches — name → mp4Path, populated by the backend's
    // reviewMatchToMaster() which reuses the Localise section's proven
    // buildMastersIndex + pickBestMasterFromIndex pipeline (campaign +
    // size + duration + aspect-ratio scoring).
    const [itemMatches, setItemMatches] = useState<Record<string, string> | null>(null);
    const [section, setSection] = usePersistentState<Section>("review-section", "all");
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
                    aeId: typeof c.id === "number" ? c.id : undefined,
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

            // 2. What each item can be compared against. The previous version
            //    and a PRE twin are found on disk beside the render and need no
            //    campaign; the master needs one.
            const lookupPayload = JSON.stringify(fresh.map((item) => ({ name: item.name, sourcePath: item.sourcePath })));
            const refsById: Record<number, Partial<ReviewItem>> = {};
            try {
                const cp = (await evalTS("reviewFindCounterparts", lookupPayload)) as any;
                if (!mountedRef.current) return;
                const rows: any[] = (cp && cp.items) || [];
                for (let ri = 0; ri < rows.length && ri < fresh.length; ri++) {
                    const r = rows[ri];
                    const patch: Partial<ReviewItem> = {};
                    if (r.amendPath) { patch.amendPath = r.amendPath; patch.amendName = r.amendName; }
                    if (r.prePath) { patch.prePath = r.prePath; patch.preName = r.preName; patch.preFolder = r.preFolder; }
                    refsById[fresh[ri].id] = patch;
                }
            } catch {
                // No references found: the items still review against masters.
            }
            let matchedMp4s: Record<string, string> = {};
            if (campaign) {
                try {
                    const matchResult = await evalTS("reviewMatchToMaster", campaign.mastersRoot, lookupPayload);
                    if (!mountedRef.current) return;
                    const matchedItems: any[] = (matchResult as any)?.items || [];
                    for (const mi of matchedItems) {
                        if (mi.mp4Path) matchedMp4s[mi.name] = mi.mp4Path;
                    }
                    setItemMatches((prev) => ({ ...(prev || {}), ...matchedMp4s }));
                } catch {
                    // Matching failed: items are still imported, without masters.
                }
            }
            const enriched = fresh.map((item) => ({
                ...item,
                ...(refsById[item.id] || {}),
                ...(matchedMp4s[item.name] ? { masterPath: matchedMp4s[item.name] } : {}),
            }));
            setItems((prev) => prev.map((item) => {
                const e = enriched.find((x) => x.id === item.id);
                return e ? e : item;
            }));

            // 3. Build ONE comparison per item: against the reference it was
            //    imported for (primaryKind). The other sections build theirs on
            //    press, so an import doesn't make three comps per render.
            const allBridgeItems: any[] = result.items || [];
            const compMatches: { mp4Path: string; localItemId: number; localItemName: string; reviewId: number; kind: CompareKind }[] = [];
            for (const reviewItem of enriched) {
                const kind = primaryKind(reviewItem);
                const refPath = refPathOf(reviewItem, kind, matchedMp4s);
                if (!refPath) continue;
                const bridgeEntry = allBridgeItems.find((c: any) => c.name === reviewItem.name);
                if (!bridgeEntry) continue;
                compMatches.push({ mp4Path: refPath, localItemId: bridgeEntry.id, localItemName: reviewItem.name, reviewId: reviewItem.id, kind });
            }
            const amendN = enriched.filter((i) => primaryKind(i) === "amend").length;
            const preN = enriched.filter((i) => primaryKind(i) === "prepost").length;
            const sorted = (amendN || preN)
                ? ` (${[amendN ? `${amendN} amend${amendN === 1 ? "" : "s"}` : "", preN ? `${preN} pre vs post` : ""].filter(Boolean).join(", ")})`
                : "";

            if (compMatches.length > 0) {
                try {
                    const compResult = await evalTS("createReviewComparisons", JSON.stringify(compMatches));
                    if (!mountedRef.current) return;
                    const results: any[] = (compResult as any)?.results || [];
                    // results[i] <-> compMatches[i]: the backend keeps the order.
                    // Keyed off the comp's presence, not the success flag: a comp
                    // that exists is openable even if an enrichment step failed.
                    const stampById: Record<number, { kind: CompareKind; stamp: CompStamp }> = {};
                    let succeeded = 0;
                    let failedN = 0;
                    for (let ri = 0; ri < results.length && ri < compMatches.length; ri++) {
                        const r = results[ri];
                        const m = compMatches[ri];
                        if (r && r.compId && r.compName) {
                            stampById[m.reviewId] = { kind: m.kind, stamp: { compName: r.compName, compId: r.compId, enrich: r.enrichNotes || "", fps: r.compFps } };
                            succeeded++;
                        } else {
                            stampById[m.reviewId] = { kind: m.kind, stamp: { error: (r && r.error) || "no comp came back" } };
                            failedN++;
                        }
                    }
                    setItems((prev) => prev.map((item) => {
                        const st = stampById[item.id];
                        return st ? { ...item, ...compPatch(item, st.kind, st.stamp) } : item;
                    }));
                    pushToast(`${fresh.length} item${fresh.length > 1 ? "s" : ""} added${sorted}, ${succeeded} comparison comp${succeeded === 1 ? "" : "s"} created.` + (failedN ? ` ${failedN} couldn't be built. Hover their Compare for why.` : ""), failedN ? "error" : "success");
                    sfx.bop();
                } catch {
                    pushToast(`${fresh.length} item${fresh.length > 1 ? "s" : ""} added${sorted}.  Comparison comps could not be created.`);
                }
            } else if (campaign) {
                pushToast(`${fresh.length} item${fresh.length > 1 ? "s" : ""} added (no matching master renders found in this campaign).`);
            } else {
                pushToast(`${fresh.length} item${fresh.length > 1 ? "s" : ""} added.`);
                sfx.bop();
            }
        } catch {
            setError("No CEP bridge. Open inside After Effects.");
        }
    };

    const updateItem = (id: number, patch: Partial<ReviewItem>) =>
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

    const removeItem = (id: number) =>
        setItems((prev) => prev.filter((i) => i.id !== id));

    const clearAll = () => { setItems([]); setError(null); };

    const handleOpenComp = async (compId: number) => {
        setLastOpenedCompId(compId);
        try {
            const result = await evalTS("focusReviewComp", compId);
            if (!mountedRef.current) return;
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) pushToast(result.error || "Could not open comp.", "error");
        } catch {
            pushToast("No CEP bridge. Open inside After Effects.", "error");
        }
    };

    // Step through the session's comparison comps: Prev/Next opens the
    // previous/next item that has a comparison comp, for the approve-
    // approve-approve review pass.
    // Within the section on screen, against the reference each row shows.
    const handleStepComp = async (dir: 1 | -1) => {
        const ids: number[] = [];
        for (const v of visible) { const c = compOf(v.item, v.kind).compId; if (c) ids.push(c); }
        if (ids.length === 0) { pushToast("No comparison comps in this section.", "error"); return; }
        const currentIndex = ids.indexOf(lastOpenedCompId ?? -1);
        const nextId = ids[currentIndex === -1 ? 0 : (currentIndex + dir + ids.length) % ids.length];
        setLastOpenedCompId(nextId);
        await handleOpenComp(nextId);
    };

    // One row's comparison, again -- the same builder the batch uses.
    const retryCompare = async (item: ReviewItem, kind: CompareKind) => {
        const mp4 = refPathOf(item, kind, itemMatches);
        if (!mp4 || item.aeId === undefined) {
            pushToast("Import & Compare this item again: its project item isn't known.", "error");
            return;
        }
        try {
            const r = (await evalTS("createReviewComparison", mp4, item.aeId, item.name, kind)) as any;
            if (!mountedRef.current) return;
            if (r && r.compId && r.compName) {
                updateItem(item.id, compPatch(item, kind, { compName: r.compName, compId: r.compId, enrich: r.enrichNotes || "", fps: r.compFps }));
                pushToast("Comparison comp built.");
            } else {
                const why = (r && r.error) || "no comp came back";
                updateItem(item.id, compPatch(item, kind, { ...compOf(item, kind), error: why }));
                pushToast(`Couldn't build it: ${why}`, "error");
            }
        } catch {
            pushToast("No CEP bridge. Open inside After Effects.", "error");
        }
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
            pushToast("No CEP bridge. Open inside After Effects.", "error");
        }
    };

    // The rows on screen, each with the reference it is shown against. "All"
    // shows every item against the reference it was imported for; a section
    // shows the items that HAVE that reference, so a POST render with a
    // matched master is under both vs Master and Pre vs Post.
    const kindsOf = (item: ReviewItem): CompareKind[] => {
        const k: CompareKind[] = [];
        if (refPathOf(item, "master", itemMatches)) k.push("master");
        if (item.amendPath) k.push("amend");
        if (item.prePath) k.push("prepost");
        return k;
    };
    const sectionCount = (id: Section) => id === "all" ? items.length : items.filter((i) => kindsOf(i).indexOf(id as CompareKind) !== -1).length;
    // Pills only once there is more than one kind of review in the session:
    // a masters-only session looks exactly as it always did.
    const hasOtherKinds = items.some((i) => i.amendPath || i.prePath);
    const activeSection: Section = hasOtherKinds ? section : "all";
    const visible = items
        .map((item, index) => ({ item, index, kind: activeSection === "all" ? primaryKind(item) : (activeSection as CompareKind) }))
        .filter((v) => activeSection === "all" || kindsOf(v.item).indexOf(v.kind) !== -1);

    const approvedCount = items.filter((i) => i.status === "approved").length;
    const amendCount    = items.filter((i) => i.status === "amend").length;
    const pendingCount  = items.filter((i) => i.status === "pending").length;

    // Count how many items have a matching .mp4 render in the active campaign.
    const matchedCount = items.filter((item) => refPathOf(item, "master", itemMatches)).length;

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
            pushToast("No CEP bridge. Open inside After Effects to copy.", "error");
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
                {visible.some((v) => compOf(v.item, v.kind).compId) && (
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

            {/* Wrike jobs in To amend / Motion / Backlog, with their renders. */}
            <ReviewJobs pushToast={pushToast} onImported={loadComps} />

            {/* Sections -- vs Master / Amends / Pre vs Post. */}
            {hasOtherKinds && (
                <div className="rv-sections">
                    {SECTIONS.map((sec) => {
                        const n = sectionCount(sec.id);
                        if (sec.id !== "all" && n === 0) return null;
                        return (
                            <Tooltip key={sec.id} text={sec.tip}>
                                <button
                                    className={activeSection === sec.id ? "rv-section rv-section--on" : "rv-section"}
                                    onClick={() => { if (sec.id !== activeSection) sfx.menu(); setSection(sec.id); }}
                                >
                                    {sec.label}
                                    <span className="rv-section-count">{n}</span>
                                </button>
                            </Tooltip>
                        );
                    })}
                </div>
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
                        {visible.map(({ item, index: i, kind }) => {
                            const matchedMp4 = refPathOf(item, kind, itemMatches);
                            const comp = compOf(item, kind);
                            const isOpen = comp.compId != null && comp.compId === lastOpenedCompId;
                            return (
                                <ReviewRow
                                    key={`${item.id}-${batchKey}`}
                                    item={item}
                                    batchIndex={i - item.batchOffset}
                                    kind={kind}
                                    comp={comp}
                                    matchedMp4={matchedMp4}
                                    isOpen={isOpen}
                                    onChange={(patch) => updateItem(item.id, patch)}
                                    onRemove={() => removeItem(item.id)}
                                    onOpenComp={handleOpenComp}
                                    onToggleDiff={handleToggleDiff}
                                    onRetryCompare={() => void retryCompare(item, kind)}
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
                    <div className="rh-tab-row">
                        {/* THE HUB'S FRONT DOOR FOR A TUTORIAL -- see the same
                            note in DeliveryHub. It sits OUTSIDE .rh-tab-bar on
                            purpose: the highlight is width:50% at left 0%/50%
                            of that box, so a third child would put the slider
                            over the wrong half of the wrong element. */}
                        <TutorialIcon toolId="review-hub" toolLabel="Review" className="rh-hub-icon">
                            <Eye size={15} />
                        </TutorialIcon>
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
