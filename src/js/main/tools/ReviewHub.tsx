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
import SegmentedToggle from "../SegmentedToggle";
import { usePosterFrame } from "../lib/renderPreview";
import { toFileUrl } from "../lib/fileUrl";
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
    /** >1 when the master is a shorter cut played that many times (20s = 10s x2). */
    masterRepeat?: number;
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
type Section = CompareKind;

interface CompStamp {
    compName?: string;
    compId?: number;
    enrich?: string;
    fps?: number;
    error?: string;
}

const SECTIONS: { id: Section; label: string; tip: string }[] = [
    { id: "master",  label: "vs Master",   tip: "Every item against the campaign's OV master render" },
    { id: "amend",   label: "Amends",      tip: "Each render against its previous version, V02 against V01" },
    { id: "prepost", label: "Pre vs Post", tip: "Each POST render against the PRE render of the same deliverable" },
];

/** Where an item lands when imported: its MASTER whenever it has one. A V02
 *  is still a deliverable to check against the OV, and the studio did not
 *  want that to stop being the default the moment a V01 exists -- Amends and
 *  Pre vs Post are extra sections, not a replacement. Without a master, the
 *  most specific reference it does have. */
function primaryKind(item: ReviewItem): CompareKind {
    if (item.masterPath) return "master";
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
// The row's parts
// ---------------------------------------------------------------------------
// Shorten a full master path to just its filename (no folder, no extension)
// for the "vs <master>" second line in each row.
function masterDisplayName(masterPath: string): string {
    const seg = masterPath.replace(/\\/g, "/").split("/").pop() || masterPath;
    const dot = seg.lastIndexOf(".");
    return dot === -1 ? seg : seg.substring(0, dot);
}

/** A render name read for a person: the SITE in bold, then size, length,
 *  version and any _DOUBLE_RES as small tags -- the prefix every row shares
 *  (SF_INTL_Trio_DOOH) and the territory (the group header says it) dropped. */
export function rowNameParts(fullName: string): { site: string; tags: string[] } {
    const stem = truncateNameAtArtwork(fullName).replace(/\.[A-Za-z0-9]{2,4}$/, "");
    const toks = stem.split("_");
    const site: string[] = [];
    const tags: string[] = [];
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (!t) continue;
        if (/^\d{2,5}x\d{2,5}(px)?$/i.test(t)) { tags.push(t.replace(/px$/i, "")); continue; }
        if (/^\d+(s|sec)$/i.test(t)) { tags.push(t.replace(/sec$/i, "s")); continue; }
        if (/^V\d{1,3}$/i.test(t)) { tags.push(t.toUpperCase()); continue; }
        if (/^(DOUBLE|TRIPLE|QUAD)$/i.test(t) && /^RES$/i.test(toks[i + 1] || "")) { tags.push(t.toLowerCase() + " res"); i++; continue; }
        if (/^[A-Z]{2}$/.test(t) && i > 0) continue; // territory: in the group header
        site.push(t);
    }
    return { site: site.join(" ") || stem, tags };
}

/** Which batch a render came from, off its path: ".../Chile/Renders/Batch_02/x.mov"
 *  is "Chile · Batch_02". Rows group under it, so a session spanning two
 *  batches reads as two lists rather than one long one. */
export function rowGroupOf(sourcePath: string | null): string {
    const parts = String(sourcePath || "").split(/[\\/]/).filter(Boolean);
    for (let i = parts.length - 2; i > 0; i--) {
        if (/^(renders|ae)$/i.test(parts[i])) {
            const territory = parts[i - 1].replace(/_/g, " ");
            const batch = i + 1 < parts.length - 1 ? parts[i + 1] : "";
            return batch && !/^_/.test(batch) ? territory + " · " + batch : territory;
        }
    }
    return "Imported";
}

/** The master's poster frame, as OV Library shows it, playing on hover. Only
 *  the MASTER: the local renders are ProRes MOVs Chromium cannot decode. */
const MasterThumb: React.FC<{ path: string | null | undefined }> = ({ path }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const poster = usePosterFrame(videoRef, () => {});
    const playable = !!path && /\.(mp4|m4v|webm)$/i.test(path) && !failed;
    return (
        <span
            className={"rv-thumb" + (playable ? "" : " rv-thumb--empty")}
            onMouseEnter={() => { const v = videoRef.current; if (v) { v.currentTime = 0; v.play().catch(() => {}); } }}
            onMouseLeave={() => poster.restToPoster()}
        >
            {playable ? (
                <video
                    ref={videoRef}
                    src={toFileUrl(path as string)}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={poster.onLoadedMetadata}
                    onSeeked={poster.onSeeked}
                    onLoadedData={poster.onLoadedData}
                    onError={() => setFailed(true)}
                />
            ) : (
                <Film size={13} />
            )}
        </span>
    );
};

const STATUS_NEXT: Record<ReviewStatus, ReviewStatus> = { pending: "approved", approved: "amend", amend: "pending" };
/** The Compare button's hover: what it opens, plus a line for each part of
 *  the comp the build could not make. The host's own notes
 *  (`diff:ok | tc-master:ok | frontcard:5.00s`) are for debugging, and used
 *  to be shown here raw. */
function compareTip(comp: CompStamp): string {
    const notes = comp.enrich || "";
    const lines = [`Open "${comp.compName}" in AE`];
    if (/diff:(FAIL|no-blend)/.test(notes)) lines.push("Built without the difference layer.");
    if (/tc-(master|local):FAIL/.test(notes)) lines.push("Built without frame counters.");
    if (/frontcard:shifted/.test(notes)) lines.push("The frontcard marker is missing.");
    return lines.join("\n");
}

const STATUS_WORD: Record<ReviewStatus, string> = { pending: "Pending", approved: "Approved", amend: "To amend" };

// ---------------------------------------------------------------------------
// Single review row -- one action (the row opens its comparison), status as a
// dot at the left edge, the rest on hover.
// ---------------------------------------------------------------------------
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
    const { site, tags } = rowNameParts(item.name);
    const refLabel = kind === "amend" ? "vs previous" : kind === "prepost" ? `vs PRE${item.preFolder ? " · " + item.preFolder : ""}` : "vs";
    const setStatus = (next: ReviewStatus) => {
        onChange({ status: next, ...(next === "amend" ? { noteOpen: true } : item.status === "amend" ? { noteOpen: false } : {}) });
    };
    // The row IS the button: open the comparison, or build it when the master
    // matched and the comp wasn't made.
    const openOrBuild = () => {
        if (comp.compId) onOpenComp(comp.compId);
        else if (matchedMp4) onRetryCompare();
    };
    return (
        <motion.div
            className={`rv-row rv-row--${item.status}${isOpen ? " rv-row--open" : ""}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: reduced ? 0 : Math.min(batchIndex, 12) * 0.04, ease: [0.22, 1, 0.36, 1] }}
        >
            <div className="rv-row-main">
                <button
                    type="button"
                    className={`rv-dot rv-dot--${item.status}`}
                    title={`${STATUS_WORD[item.status]} · press to mark ${STATUS_WORD[STATUS_NEXT[item.status]].toLowerCase()}`}
                    aria-label={STATUS_WORD[item.status]}
                   
                    onClick={(e) => { e.stopPropagation(); setStatus(STATUS_NEXT[item.status]); }}
                >
                    {item.status === "approved" ? <CheckCircle2 size={12} /> : item.status === "amend" ? <AlertTriangle size={11} /> : null}
                </button>

                <MasterThumb path={item.masterPath || (kind === "master" ? matchedMp4 : null)} />

                <span className="rv-row-name-block" onClick={openOrBuild} title={item.name}>
                    <span className="rv-row-line1">
                        <span className="rv-row-site">{site}</span>
                        {tags.map((t) => <span key={t} className={"rv-tag" + (/^\d+x\d+$/.test(t) ? " rv-tag--size" : "")}>{t}</span>)}
                    </span>
                    {matchedMp4 ? (
                        <span className="rv-row-master" title={matchedMp4}>
                            <span className="rv-row-master-label">{refLabel}</span>
                            <span className="rv-row-master-name">{kind === "master" ? masterDisplayName(matchedMp4) : truncateNameAtArtwork(masterDisplayName(matchedMp4))}</span>
                            {kind === "master" && (item.masterRepeat || 1) > 1 && (
                                <span className="rv-row-repeat" title={`The master plays ${item.masterRepeat} times back to back to fill this length`}>×{item.masterRepeat}</span>
                            )}
                        </span>
                    ) : kind === "master" ? (
                        <span className="rv-row-master rv-row-master--none" title="No master render matches this creative, size and length. Check a campaign is picked in OV Library.">
                            no master found
                        </span>
                    ) : null}
                </span>

                <span className="rv-row-actions">
                    {/* Hover-only, and FLOATING over the end of the name rather
                        than reserving four buttons of width while invisible --
                        on a docked panel that reserve is what pushed Compare
                        off the row. */}
                    <span className="rv-hover-acts">
                        {matchedMp4 && (
                            <Tooltip text={`Play the ${kind === "master" ? "master" : kind === "amend" ? "previous version" : "PRE render"}`}>
                                <button className="rv-act" onClick={async () => { try { await evalTS("playFile", matchedMp4); } catch { /* no bridge */ } }}>
                                    <Film size={12} />
                                </button>
                            </Tooltip>
                        )}
                        {comp.compId && (
                            <Tooltip text="Show or hide the difference layer">
                                <button className="rv-act" onClick={() => onToggleDiff(comp.compId!)}>
                                    <Layers size={12} />
                                </button>
                            </Tooltip>
                        )}
                        {!item.note && !item.noteOpen && (
                            <Tooltip text="Add a note">
                                <button className="rv-act" onClick={() => onChange({ noteOpen: true })}>
                                    <Pencil size={11} />
                                </button>
                            </Tooltip>
                        )}
                        <Tooltip text="Remove from session">
                            <button className="rv-act" onClick={onRemove}>
                                <X size={12} />
                            </button>
                        </Tooltip>
                    </span>
                    {/* A note that exists stays in view: it's content, not a control. */}
                    {(item.note || item.noteOpen) && (
                        <Tooltip text="Note">
                            <button className="rv-act rv-act--on" onClick={() => onChange({ noteOpen: !item.noteOpen })}>
                                <Pencil size={11} />
                            </button>
                        </Tooltip>
                    )}
                    {comp.compId ? (
                        <Tooltip text={compareTip(comp)}>
                            <button className="rv-comp-btn" onClick={openOrBuild}>
                                <Columns2 size={11} /><span className="rv-comp-label">Compare</span>
                            </button>
                        </Tooltip>
                    ) : matchedMp4 ? (
                        <Tooltip text={comp.error ? `Couldn't build the comparison: ${comp.error}\nPress to try again.` : "Build the comparison comp"}>
                            <button className="rv-comp-btn rv-comp-btn--retry" onClick={openOrBuild}>
                                <Columns2 size={11} /><span className="rv-comp-label">Compare</span>
                            </button>
                        </Tooltip>
                    ) : null}
                </span>
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
                            placeholder="Note for the motioner…"
                            value={item.note}
                            rows={2}
                            onChange={(e) => onChange({ note: e.target.value })}
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
    // "all" was a section until 2026-09-29; a stored one reads as vs Master.
    const [storedSection, setSection] = usePersistentState<Section | "all">("review-section", "master");
    const section: Section = storedSection === "all" ? "master" : storedSection;
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
            const repeats: Record<string, number> = {};
            if (campaign) {
                try {
                    const matchResult = await evalTS("reviewMatchToMaster", campaign.mastersRoot, lookupPayload);
                    if (!mountedRef.current) return;
                    const matchedItems: any[] = (matchResult as any)?.items || [];
                    for (const mi of matchedItems) {
                        if (mi.mp4Path) matchedMp4s[mi.name] = mi.mp4Path;
                        if (mi.mp4Path && mi.repeat > 1) repeats[mi.name] = mi.repeat;
                    }
                    setItemMatches((prev) => ({ ...(prev || {}), ...matchedMp4s }));
                } catch {
                    // Matching failed: items are still imported, without masters.
                }
            }
            const enriched = fresh.map((item) => ({
                ...item,
                ...(refsById[item.id] || {}),
                ...(matchedMp4s[item.name] ? { masterPath: matchedMp4s[item.name], masterRepeat: repeats[item.name] } : {}),
            }));
            setItems((prev) => prev.map((item) => {
                const e = enriched.find((x) => x.id === item.id);
                return e ? e : item;
            }));

            // 3. Build ONE comparison per item: against the reference it was
            //    imported for (primaryKind). The other sections build theirs on
            //    press, so an import doesn't make three comps per render.
            const allBridgeItems: any[] = result.items || [];
            const compMatches: { mp4Path: string; localItemId: number; localItemName: string; reviewId: number; kind: CompareKind; repeat?: number }[] = [];
            for (const reviewItem of enriched) {
                const kind = primaryKind(reviewItem);
                const refPath = refPathOf(reviewItem, kind, matchedMp4s);
                if (!refPath) continue;
                const bridgeEntry = allBridgeItems.find((c: any) => c.name === reviewItem.name);
                if (!bridgeEntry) continue;
                compMatches.push({ mp4Path: refPath, localItemId: bridgeEntry.id, localItemName: reviewItem.name, reviewId: reviewItem.id, kind, repeat: kind === "master" ? reviewItem.masterRepeat : undefined });
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
            const r = (await evalTS("createReviewComparison", mp4, item.aeId, item.name, kind, kind === "master" ? (item.masterRepeat || 1) : 1)) as any;
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
    // vs Master is EVERY row: one with no master found still belongs in the
    // review and says so, rather than vanishing from the only list it is in.
    const sectionCount = (id: Section) => id === "master" ? items.length : items.filter((i) => kindsOf(i).indexOf(id) !== -1).length;
    // Pills only once there is more than one kind of review in the session:
    // a masters-only session looks exactly as it always did.
    const hasOtherKinds = items.some((i) => i.amendPath || i.prePath);
    const activeSection: Section = hasOtherKinds ? section : "master";
    const visible = items
        .map((item, index) => ({ item, index, kind: activeSection }))
        .filter((v) => v.kind === "master" || kindsOf(v.item).indexOf(v.kind) !== -1);

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

    // --- the header's campaign banner -------------------------------------
    const [banner, setBanner] = useState("");
    useEffect(() => {
        let dead = false;
        setBanner("");
        if (!campaign) return;
        (async () => {
            try {
                const b = (await evalTS("loadCampaignBanner", campaign.name)) as unknown as string;
                if (!dead && typeof b === "string") setBanner(b);
            } catch { /* no banner */ }
        })();
        return () => { dead = true; };
    }, [campaign]);

    const reviewed = approvedCount + amendCount;
    const pct = (n: number) => (items.length ? (n / items.length) * 100 : 0);
    // Rows grouped by batch, in session order.
    const groups: { label: string; rows: typeof visible }[] = [];
    for (const v of visible) {
        const label = rowGroupOf(v.item.sourcePath);
        let g = groups.find((x) => x.label === label);
        if (!g) { g = { label, rows: [] }; groups.push(g); }
        g.rows.push(v);
    }

    return (
        <div className="rv-session">
            {/* ONE BAND: where you are, how far through, where the work comes
                from -- instead of a toolbar, a jobs box and a pill row, each in
                its own visual language. */}
            <div className="rv-head">
                {banner && <div className="rv-head-wash" style={{ backgroundImage: `url("${toFileUrl(banner)}")` }} aria-hidden="true" />}
                <div className="rv-head-top">
                    <div className="rv-head-title">
                        <span className="rv-head-kicker">Review Session</span>
                        <span className="rv-head-name">{campaign ? campaign.name : "No campaign"}</span>
                    </div>
                    <div className="rv-head-actions">
                        <Tooltip text={campaign ? "Import what's selected in the Project panel and compare each against its master" : "Import what's selected in the Project panel. Pick a campaign in OV Library to pair masters."}>
                            <motion.button
                                className="rv-load-btn"
                                onClick={loadComps}
                                whileHover={reduced ? {} : { scale: 1.03 }}
                                whileTap={reduced ? {} : { scale: 0.97 }}
                            >
                                <ListPlus size={14} /> {campaign ? "Import & Compare" : "Import Selected"}
                            </motion.button>
                        </Tooltip>
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
                </div>

                {items.length > 0 && (
                    <div className="rv-progress">
                        <div className="rv-progress-bar" aria-hidden="true">
                            <span className="rv-progress-seg rv-progress-seg--approved" style={{ width: pct(approvedCount) + "%" }} />
                            <span className="rv-progress-seg rv-progress-seg--amend" style={{ width: pct(amendCount) + "%" }} />
                        </div>
                        <span className="rv-progress-text">
                            <strong>{reviewed} of {items.length}</strong> reviewed
                            {amendCount > 0 && <> · <em className="rv-progress-amend">{amendCount} to amend</em></>}
                            {campaign && <> · {matchedCount} with a master</>}
                        </span>
                    </div>
                )}

                {/* Wrike jobs in Revised / To amend / Motion / Backlog. */}
                <ReviewJobs pushToast={pushToast} onImported={loadComps} />
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

            {/* Sections as one control, with the pass controls beside them. */}
            {items.length > 0 && (
                <div className="rv-sections-bar">
                    {hasOtherKinds ? (
                        <SegmentedToggle
                            name="review-sections"
                            value={activeSection}
                            onChange={(v) => { if (v !== activeSection) sfx.menu(); setSection(v as Section); }}
                            options={SECTIONS.filter((sec) => sec.id === "master" || sectionCount(sec.id) > 0)
                                .map((sec) => ({ value: sec.id, label: `${sec.label} ${sectionCount(sec.id)}` }))}
                        />
                    ) : (
                        <span className="rv-sections-solo">vs Master</span>
                    )}
                    <span className="rv-bar-spacer" />
                    {visible.some((v) => compOf(v.item, v.kind).compId) && (
                        <>
                            <Tooltip text="Previous comparison comp">
                                <button className="rv-step-btn" onClick={() => handleStepComp(-1)}><ChevronLeft size={13} /></button>
                            </Tooltip>
                            <Tooltip text="Next comparison comp">
                                <button className="rv-step-btn" onClick={() => handleStepComp(1)}><ChevronRight size={13} /></button>
                            </Tooltip>
                        </>
                    )}
                </div>
            )}

            {/* Row list */}
            <div className="rv-list">
                {items.length === 0 ? (
                    <div className="rv-empty">
                        <MessageSquareDiff size={22} />
                        <span>Select renders in the Project panel, then Import</span>
                        {campaign ? (
                            <span className="rv-empty-hint">Each is compared against its master in "{campaign.name}" by creative, size and length.</span>
                        ) : (
                            <span className="rv-empty-hint">Pick a campaign in the OV Library tab to pair masters.</span>
                        )}
                    </div>
                ) : (
                    <div key={batchKey} className="rv-groups">
                        {groups.map((g) => (
                            <div key={g.label} className="rv-group">
                                {groups.length > 1 || g.label !== "Imported" ? (
                                    <div className="rv-group-head">
                                        <span>{g.label}</span>
                                        <span className="rv-group-count">{g.rows.length}</span>
                                    </div>
                                ) : null}
                                {g.rows.map(({ item, index: i, kind }) => {
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
                        ))}
                    </div>
                )}
            </div>

            {/* Amends to send: only once something is marked to amend. */}
            {amendWithNotes.length > 0 && (
                <div className="rv-wrike-box">
                    <div className="rv-wrike-header">
                        <span><AlertTriangle size={12} /> {amendWithNotes.length} amend{amendWithNotes.length === 1 ? "" : "s"} for Wrike</span>
                        <Tooltip text="Copy the notes, ready to paste into Wrike">
                            <button className="rv-wrike-copy" onClick={copyWrikeText}>
                                <Copy size={12} /> Copy for Wrike
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
