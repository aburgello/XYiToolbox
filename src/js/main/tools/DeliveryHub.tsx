// =============================================================================
// src/js/main/tools/DeliveryHub.tsx
// =============================================================================
import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, useAnimate, useReducedMotion } from "motion/react";
import { Truck, ListPlus, Trash2, ChevronsDown, Send, AlertCircle, AlertTriangle, Check, X, Volume2, VolumeX, Folder, FileText, RotateCcw } from "lucide-react";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import { evalTS } from "../../lib/utils/bolt";
import { sfx } from "../../lib/utils/sfx";
import { suggestForComp, readSpecReport, type SpecSuggestion, type SpecReport } from "../lib/deliverySpecMatch";
import { setLoadedSpecReport, setLoadedDeliveryRows } from "../lib/agent/deliveryContext";
import AskAbout from "../AskAbout";
import { child_process } from "../../lib/cep/node";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import Droplet from "../Droplet";
import "../shared.scss";
import "./DeliveryHub.scss";

interface RowData {
    id: number;
    name: string;
    folderName: string | null;
    batchFolder: string | null;
    territoryCode: string | null;
    sourcePath: string | null;
    duration: number;
    frameRate: number;
    sizeMB: string;
    maxMbps: string;
    fps: string;
    batchOffset: number;
    includeAudio: boolean;
    /** True once a person has clicked the audio toggle on this row. The spec
     *  sheet fills it only while this is false -- the same "never overrule a
     *  human" rule the size and bitrate fields follow, expressed for a value
     *  that has no empty state to test. */
    audioTouched: boolean;
    queued: boolean;
}

interface Toast {
    id: number;
    text: string;
    type: "success" | "error";
}

const MOCK_NAMES = [
    "ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV",
    "ODY_INTL_DGTL_DOOH_HORSE_LOS_1080x1920_10sec_OV",
    "ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x1920_20sec_OV",
    "ODY_INTL_DGTL_DOOH_HELMET_LOS_3840x586_10sec_OV",
    "ODY_INTL_DGTL_DOOH_HELMET_LOS_1920x858_10sec_OV",
    "ODY_INTL_DGTL_DOOH_GUTTERS_LOS_1920x858_10sec_OV",
    "ODY_INTL_DGTL_DOOH_GUTTERS_LOS_1080x1920_15sec_OV",
];

function buildMockRows(): RowData[] {
    return MOCK_NAMES.map((name, i) => ({
        id: Date.now() + i,
        name,
        folderName: i % 3 === 0 ? null : i === 1 ? "Batch_01" : i === 2 ? "Batch_02" : "SiteName_DOOH",
        batchFolder: null,
        territoryCode: i % 3 === 0 ? null : "FR",
        sourcePath: i % 3 === 0 ? null : `/Volumes/Media/Renders/${name}/${name}.mov`,
        duration: 10 + i * 5,
        frameRate: 25,
        sizeMB: String(10 + i * 4),
        maxMbps: i % 2 === 0 ? "" : String(3 + i),
        fps: i % 3 === 1 ? "25" : "",
        batchOffset: 0,
        includeAudio: i % 2 === 0,
        audioTouched: false,
        queued: false,
    }));
}

// Bitrate used for a row with no target file size. Mirrors deliver.ts's
// DELIVERY_DEFAULT_MBPS (that's the one that actually decides the render --
// this copy only labels the preview) -- keep the two in step.
const DEFAULT_MBPS = 26;

// --- Template prediction (delivery preview) ----------------------------------
// The queue's one non-obvious decision: the MB target becomes a bitrate, then
// rounds DOWN to the nearest prebuilt Output Module template -- so the template
// a row actually gets is almost never the bitrate you computed. This mirror of
// deliver.ts's math (deliveryCalcRequiredBitrateMbps + the cap/default
// precedence + deliveryFindTemplateName's round-down) shows each row's real
// landing template live in the preview, before Queue runs. ONLY deliver.ts
// decides the render -- keep this list + the constants in step with its
// DELIVERY_TEMPLATE_BITRATES_MBPS / DELIVERY_AUDIO_RESERVE_KBPS if they change.
const TEMPLATE_BITRATES_MBPS = [
    0.6, 0.8, 1, 1.4, 2, 2.4, 2.8, 3.4, 5, 7, 8, 10, 12, 14, 16, 18, 20, 22,
    24, 25, 26, 28, 30, 32, 36, 40, 48, 50, 60,
];
const AUDIO_RESERVE_KBPS = 192;

// Frame rates this studio actually delivers at. Used only to spot a typo --
// never to correct one.
const PLAUSIBLE_FPS = [23.976, 24, 25, 29.97, 30, 50, 60];

/**
 * Advisory warnings about a row's numbers. ADVISORY: this never changes a
 * value, never disables a row and never stops the queue. Delivery's numbers are
 * typed by hand (or bulk-set), so the person entering them is the authority --
 * this only points.
 *
 * Deliberately NOT a call to pdfSpecs' specRowWarnings, even though that was
 * the plan: there `BitRate` is a TARGET, here `maxMbps` is a CAP, and a cap is
 * *supposed* to sit away from what the size implies. Reusing that cross-check
 * would have flagged every capped row. These use Delivery's own template list
 * instead, which makes the important check possible at all.
 */
function rowWarnings(row: RowData): string[] {
    const out: string[] = [];
    const sizeMB = row.sizeMB !== "" ? parseFloat(row.sizeMB) : null;
    const fps = row.fps !== "" ? parseFloat(row.fps) : null;

    if (sizeMB !== null && !isNaN(sizeMB) && sizeMB >= 1000) {
        out.push(`${row.sizeMB} MB looks like KB`);
    }
    if (fps !== null && !isNaN(fps) && fps > 0 &&
        !PLAUSIBLE_FPS.some((f) => Math.abs(f - fps) < 0.05)) {
        out.push(`${row.fps} isn't a frame rate we deliver at`);
    }

    // THE ONE THAT ACTUALLY BITES. Template choice rounds DOWN, so output
    // normally lands under target. But when even the LOWEST template is above
    // what the target size allows, the file overshoots -- it goes out over the
    // size limit and nothing downstream would catch it.
    if (sizeMB !== null && !isNaN(sizeMB) && sizeMB > 0 && row.duration > 0) {
        let kbps = (sizeMB * 8 * 1000 * 1000) / row.duration / 1000;
        if (row.includeAudio) kbps -= AUDIO_RESERVE_KBPS;
        const required = kbps / 1000;
        let lowest = TEMPLATE_BITRATES_MBPS[0];
        for (const v of TEMPLATE_BITRATES_MBPS) if (v < lowest) lowest = v;
        if (required > 0 && required < lowest) {
            out.push(
                `${sizeMB}MB over ${row.duration.toFixed(1)}s needs ~${required.toFixed(2)}Mbps — ` +
                `below the smallest template (${lowest}), so the file will come out over size`
            );
        }
    }
    return out;
}

function predictRowTemplate(row: RowData): { name: string; capped: boolean } | null {
    const sizeMB = row.sizeMB !== "" ? parseFloat(row.sizeMB) : null;
    const maxMbps = row.maxMbps !== "" ? parseFloat(row.maxMbps) : null;
    // Invalid numbers: the queue will refuse this row anyway -- predict nothing
    // rather than predict from garbage.
    if (sizeMB !== null && (isNaN(sizeMB) || sizeMB <= 0)) return null;
    if (maxMbps !== null && (isNaN(maxMbps) || maxMbps <= 0)) return null;

    let required: number;
    if (sizeMB !== null) {
        if (!(row.duration > 0)) return null; // duration unknown -- can't honestly predict
        let kbps = (sizeMB * 8 * 1000 * 1000) / row.duration / 1000;
        if (row.includeAudio) kbps -= AUDIO_RESERVE_KBPS;
        let mbps = kbps / 1000;
        if (mbps < 0) mbps = 0.1; // same safety floor as deliver.ts
        required = mbps;
    } else {
        required = DEFAULT_MBPS;
    }
    const capped = maxMbps !== null && required > maxMbps;
    const eff = capped ? (maxMbps as number) : required;

    let best: number | null = null;
    for (const v of TEMPLATE_BITRATES_MBPS) {
        if (v <= eff && (best === null || v > best)) best = v;
    }
    if (best === null) best = TEMPLATE_BITRATES_MBPS[0];
    return { name: "H264_" + String(best) + "MBPS_MOS", capped };
}

function getShortLabel(fullName: string): string {
    const match = fullName.match(/([A-Za-z0-9]+)_(\d{2,5}x\d{2,5})/);
    if (match) return match[1] + "_" + match[2];
    return fullName;
}

// ---------------------------------------------------------------------------
// Delivery button — truck drives off right on click, check springs in,
// resets after 1.5 s. useAnimate gives us a proper imperative sequence
// without a state machine.
// ---------------------------------------------------------------------------
const DeliveryButton: React.FC<{ busy: boolean; onClick: () => void }> = ({ busy, onClick }) => {
    const reduced = useReducedMotion();
    const [truckScope, animateTruck] = useAnimate();
    const [checkScope, animateCheck] = useAnimate();
    const [done, setDone] = useState(false);

    const handleClick = async () => {
        if (busy) return;
        onClick();
        if (!reduced) {
            // truck slides right and fades out
            await animateTruck(truckScope.current, { x: 28, opacity: 0 }, { duration: 0.28, ease: "easeIn" });
            setDone(true);
            // check pops in
            await animateCheck(checkScope.current, { scale: [0, 1.3, 1], opacity: [0, 1, 1] }, { duration: 0.32, ease: "easeOut" });
            // hold briefly then reset
            await new Promise((r) => setTimeout(r, 1200));
            animateTruck(truckScope.current, { x: 0, opacity: 1 }, { duration: 0.2 });
            setDone(false);
        }
    };

    return (
        <motion.button
            className={`dh-primary-btn${busy ? " dh-primary-btn--busy" : ""}`}
            disabled={busy}
            onClick={handleClick}
            whileHover={reduced ? {} : { scale: 1.03 }}
            whileTap={reduced ? {} : { scale: 0.97 }}
        >
            {/* Truck icon — animates out on click */}
            <span ref={truckScope} className="dh-btn-icon" style={{ display: done ? "none" : "flex" }}>
                <Truck size={16} />
            </span>
            {/* Check icon — appears after truck exits */}
            <span ref={checkScope} className="dh-btn-icon" style={{ display: done ? "flex" : "none", opacity: 0 }}>
                <Check size={16} />
            </span>
            <span>Delivery</span>
        </motion.button>
    );
};

// ---------------------------------------------------------------------------
// Queue button — Send icon throws forward on click.
// ---------------------------------------------------------------------------
const QueueButton: React.FC<{ busy: boolean; disabled: boolean; onClick: () => void }> = ({ busy, disabled, onClick }) => {
    const reduced = useReducedMotion();
    const [iconScope, animateIcon] = useAnimate();

    const handleClick = async () => {
        if (disabled || busy) return;
        if (!reduced) {
            animateIcon(iconScope.current, { x: [0, 10, 0], y: [0, -8, 0], opacity: [1, 0.4, 1] }, { duration: 0.45, ease: "easeInOut" });
        }
        onClick();
    };

    return (
        <Tooltip text="Calculate bitrate and queue all rows">
            <motion.button
                className={`dh-queue-btn${busy ? " dh-queue-btn--busy" : ""}`}
                disabled={disabled}
                onClick={handleClick}
                whileHover={reduced ? {} : { scale: 1.03 }}
                whileTap={reduced ? {} : { scale: 0.97 }}
            >
                <span ref={iconScope} style={{ display: "flex" }}>
                    <Send size={14} />
                </span>
                <span>Queue</span>
            </motion.button>
        </Tooltip>
    );
};

// ---------------------------------------------------------------------------
// Load button — this is the hinge the rest of the page depends on (nothing
// else here works until comps are loaded), so it gets the same visual
// weight as Delivery/Queue instead of hiding as a small grey icon button.
// Pulses gently ONLY while the list is still empty -- a soft nudge toward
// the one step that has to happen first, that quiets down the moment it's
// no longer needed so it doesn't nag once the real work has started.
// ---------------------------------------------------------------------------
const LoadButton: React.FC<{ busy: boolean; empty: boolean; onClick: () => void; label?: string }> = ({ busy, empty, onClick, label = "Load Selected Comps" }) => {
    const reduced = useReducedMotion();
    const [iconScope, animateIcon] = useAnimate();

    const handleClick = async () => {
        if (busy) return;
        if (!reduced) {
            animateIcon(iconScope.current, { y: [0, -3, 0], scale: [1, 1.15, 1] }, { duration: 0.35, ease: "easeOut" });
        }
        onClick();
    };

    return (
        <Tooltip text="Load the comps currently selected in the Project panel">
            <motion.button
                className={`dh-load-btn${busy ? " dh-load-btn--busy" : ""}`}
                disabled={busy}
                onClick={handleClick}
                animate={!reduced && empty && !busy ? { scale: [1, 1.012, 1] } : { scale: 1 }}
                transition={!reduced && empty && !busy ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.15 }}
                whileHover={reduced ? {} : { scale: 1.05 }}
                whileTap={reduced ? {} : { scale: 0.96 }}
            >
                <span ref={iconScope} style={{ display: "flex" }}>
                    <ListPlus size={14} />
                </span>
                <span>{label}</span>
            </motion.button>
        </Tooltip>
    );
};

// ---------------------------------------------------------------------------
// Empty state — ListPlus bobs gently on loop.
// ---------------------------------------------------------------------------
const EmptyState: React.FC = () => {
    const reduced = useReducedMotion();
    return (
        <div className="dh-empty">
            <motion.div
                animate={reduced ? {} : { y: [0, -5, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
                <ListPlus size={22} />
            </motion.div>
            <span>Select comps, then load</span>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Fps droplet — 25 / 30 / custom input, same pattern as Toolset's
// CompDurationDropletBody.
// ---------------------------------------------------------------------------
const FpsDropletBody: React.FC<{ close: () => void; onPick: (val: string) => void }> = ({ close, onPick }) => {
    const [custom, setCustom] = useState(false);
    const [customVal, setCustomVal] = useState("");

    const pick = (v: string) => { onPick(v); close(); };

    const applyCustom = () => {
        const v = parseFloat(customVal);
        if (!isNaN(v) && v > 0 && v <= 120) pick(customVal);
    };

    return (
        <>
            <p className="dh-fps-title">Frame rate</p>
            <div className="dh-fps-presets">
                <button onClick={() => pick("25")}>25</button>
                <button onClick={() => pick("30")}>30</button>
            </div>
            {custom ? (
                <div className="dh-fps-custom-row">
                    <input
                        type="number"
                        autoFocus
                        min={1}
                        max={120}
                        value={customVal}
                        onChange={(e) => setCustomVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }}
                    />
                    <button onClick={applyCustom}>Set</button>
                </div>
            ) : (
                <button className="dh-fps-custom-toggle" onClick={() => setCustom(true)}>Custom…</button>
            )}
        </>
    );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const codeToFlag = (code: string): string => {
    const [a, b] = code.toUpperCase();
    return String.fromCodePoint(0x1F1E6 + a.charCodeAt(0) - 65, 0x1F1E6 + b.charCodeAt(0) - 65);
};

const DeliveryHubTool = () => {
    const reduced = useReducedMotion();

    // --- Delivery -----------------------------------------------------------
    const [deliveryBusy, setDeliveryBusy] = useState(false);

    // Delivery creates the comps AND drops them straight into the checklist
    // below -- the two used to be separate steps (make the comps, then go
    // re-select them in the Project panel and hit Load), which is busywork
    // when the comps it just made are always the ones you want to queue.
    // Rows are APPENDED, not replaced: clicking Delivery shouldn't wipe rows
    // already loaded and configured. delivery() hands back the ids it
    // created, so this doesn't depend on the Project-panel selection still
    // being what it was when the click started.
    const runDelivery = async () => {
        setDeliveryBusy(true);
        try {
            const result = await evalTSSafe("delivery");
            if (!result.success) {
                pushToast(result.error || "Something went wrong.", "error");
                return;
            }
            const ids = (result.compIds as number[]) || [];
            if (ids.length === 0) {
                pushToast("Delivery comp(s) created.");
                return;
            }
            const loaded = await evalTSSafe("deliveryChecklistLoadCompsByIds", ids);
            if (!loaded.success) {
                // The comps themselves were made -- only the auto-load fell
                // over, and Load Comps is still right there.
                pushToast("Delivery comp(s) created, but couldn't load them into the list.", "error");
                return;
            }
            const added = appendComps((loaded.comps as any[]) || []);
            if (added > 0) sfx.bop();
            pushToast(`Delivery comp(s) created — ${added} loaded below.`);
        } finally {
            setDeliveryBusy(false);
        }
    };

    // --- Checklist ----------------------------------------------------------
    const [rows, setRows] = useState<RowData[]>([]);
    // Spec suggestions, keyed by row id. Opt-in: nothing is looked up until
    // the button is pressed, so loading comps never pays for PDF parsing and
    // nobody gets numbers they didn't ask for.
    const [suggestions, setSuggestions] = useState<Record<number, SpecSuggestion>>({});
    const [suggestBusy, setSuggestBusy] = useState(false);
    // WHAT THE SHEETS ACTUALLY SAY, as a document rather than a per-row answer.
    // suggestForComp refuses when a match is ambiguous, which is right for
    // filling a field and useless when you want to know whether the PDF is
    // silent, wrong, or simply describes sizes nobody ordered.
    const [report, setReport] = useState<SpecReport | null>(null);
    const [reportBusy, setReportBusy] = useState(false);

    // PUBLISHED FOR THE AGENT, on every change. Asked about "these three
    // renders" it used to answer about the active comp alone, because that was
    // the only deliverable it had ever been shown.
    useEffect(() => {
        setLoadedDeliveryRows(rows.map((r) => ({
            name: r.name,
            duration: r.duration,
            frameRate: r.frameRate,
            sizeMB: r.sizeMB,
            maxMbps: r.maxMbps,
            fps: r.fps,
            audio: r.includeAudio,
        })));
    }, [rows]);

    /**
     * READ THE SPECS — one action, both halves.
     *
     * These were two unlabelled icon buttons: one looked a row's spec up and
     * filled anything still blank, the other showed what the sheet says. That
     * split was how they got built rather than a real distinction, and nobody
     * could tell which was which from two grey glyphs.
     *
     * MERGING A WRITE INTO A READ IS NORMALLY WRONG, and it is worth saying why
     * it is not here: the fill only ever touches EMPTY fields, never overrules
     * a value somebody typed, and leaves audio alone once anyone has clicked
     * it. So on a row with nothing in it there is nothing to lose, and on a row
     * somebody has filled in there is nothing to change.
     *
     * The report is shown either way, which makes the fill MORE auditable than
     * it was on its own: every value that lands in a row can now be checked
     * against the sheet it came from, sitting right underneath.
     */
    const readSpecs = async () => {
        await runSuggest();
        await runReport();
    };

    const runReport = async () => {
        // sourcePath is nullable, and `filter` does not narrow it -- read it out
        // explicitly so the call cannot be handed a null it would treat as a
        // path and then report as "no specs folder".
        const withPath = rows.filter((r) => !!r.sourcePath)[0];
        const from = withPath ? withPath.sourcePath : null;
        if (!from) { setCheckError("Add a row with a rendered file first — the specs are found next to its project."); return; }
        setReportBusy(true);
        setCheckError(null);
        try {
            const r = await readSpecReport(from);
            setReport(r);
            // PUBLISHED FOR THE AGENT. It cannot reach this folder on its own --
            // the campaign sits beside the masters root rather than above it --
            // so what is on screen is the only reliable copy.
            setLoadedSpecReport(r);
        } catch (e) {
            setCheckError("Couldn't read the specs: " + String((e as Error).message || e));
        } finally {
            setReportBusy(false);
        }
    };

    const runSuggest = async () => {
        setSuggestBusy(true);
        try {
            const found: Record<number, SpecSuggestion> = {};
            for (const row of rows) {
                if (!row.sourcePath) continue;
                try {
                    const s = await suggestForComp(row.name, row.sourcePath);
                    if (s.searched) found[row.id] = s;
                } catch { /* one bad PDF must not stop the rest */ }
            }
            setSuggestions(found);
            // FILL ONLY WHAT IS EMPTY. A value already on screen was put there
            // by a person, and a suggestion off a hand-filled PDF has no
            // business overruling them.
            setRows((prev) => prev.map((r) => {
                const s = found[r.id];
                if (!s) return r;
                // AUDIO ONLY ON AN EXPLICIT YES. It is rare on these
                // deliverables, and shipping a file with sound it shouldn't
                // have means redelivering, while a missing "yes" costs one
                // click -- so a sheet that says no, or says nothing at all,
                // both leave it off. A boolean has no empty state to test, so
                // this defers to audioTouched instead: once anyone has clicked
                // the toggle, no lookup moves it again.
                return {
                    ...r,
                    sizeMB: r.sizeMB === "" && s.sizeMB ? s.sizeMB : r.sizeMB,
                    maxMbps: r.maxMbps === "" && s.maxMbps ? s.maxMbps : r.maxMbps,
                    // fps too, now that the suggestion carries it. Same
                    // empty-only rule: it is the one value nobody can infer
                    // from a filename, and it was being read off the PDF and
                    // thrown away.
                    fps: r.fps === "" && s.fps ? s.fps : r.fps,
                    includeAudio: r.audioTouched ? r.includeAudio : s.audio === "yes",
                };
            }));
        } finally {
            setSuggestBusy(false);
        }
    };
    const [bulkSize, setBulkSize] = useState("");
    const [bulkMbps, setBulkMbps] = useState("");
    const [bulkFps, setBulkFps] = useState("");
    const [checkError, setCheckError] = useState<string | null>(null);
    const [checkBusy, setCheckBusy] = useState(false);
    const [log, setLog] = useState("");
    const [batchKey, setBatchKey] = useState(0);
    const nextRowId = useRef(0);

    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastId = useRef(0);
    const pushToast = (text: string, type: Toast["type"] = "success", durationMs = 3500) => {
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, text, type }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), durationMs);
    };

    // --- Render watch -------------------------------------------------------
    // After Queue succeeds, poll renderWatchSnapshot (deliver.ts) and toast
    // each item's real result the moment it finishes: name, destination
    // folder, fps, total MB on disk, and the EFFECTIVE bitrate (from the
    // file's actual size/duration -- what the template really produced, not
    // the requested target). Details:
    //   - RAW evalTS, deliberately not evalTSSafe: while AE renders, bridge
    //     calls block until the render releases the engine -- that's one
    //     slow call, not a failure, and a 15s timeout would misreport every
    //     long render as "AE busy". The blocked call resolving IS the
    //     "render finished" signal in practice.
    //   - Watches only the items that were queued/rendering at Queue time
    //     (by queue index), so old DONE items from earlier sessions don't
    //     re-toast.
    //   - Stops when nothing watched is left pending, on unmount, or after
    //     a 4h safety cap. Leaving the Deliver page stops the watch (the
    //     component owns it) -- fine in practice, the queue log + Renders
    //     folder still tell the story; noted here so it's a known limit,
    //     not a surprise.
    const watchPendingRef = useRef<number[]>([]);
    const watchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const watchDeadlineRef = useRef(0);
    // State mirror of watchPendingRef's count, purely for the "watching N
    // renders" pulse in the action bar (the ref itself never re-renders).
    // The pulse is a pure-CSS animation on purpose: while AE renders, the
    // poll's evalTS sits awaiting a blocked bridge call for minutes -- the
    // one window where an indicator that keeps moving regardless is exactly
    // what tells the artist the panel is waiting, not dead.
    const [watchingCount, setWatchingCount] = useState(0);

    useEffect(() => () => {
        if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
    }, []);

    interface WatchItem {
        index: number;
        compName: string;
        status: string;
        outputPath: string;
        sizeBytes: number;
        fps: number;
        durationSec: number;
    }

    const pollRenderWatch = async () => {
        try {
            const result = (await evalTS("renderWatchSnapshot")) as
                | { success: boolean; items?: WatchItem[] }
                | undefined;
            if (!result || !result.success || !result.items) return; // bridge hiccup -- retry next tick

            const stillPending: number[] = [];
            for (const idx of watchPendingRef.current) {
                const item = result.items.find((it) => it.index === idx);
                if (!item) continue; // removed from the queue -- stop watching it
                if (item.status === "queued" || item.status === "rendering") {
                    stillPending.push(idx);
                    continue;
                }
                if (item.status === "done") {
                    const folder = item.outputPath.replace(/[\\/][^\\/]*$/, "");
                    const mb = item.sizeBytes / 1_000_000; // decimal MB, same convention as the checklist's own math
                    const mbps = item.durationSec > 0 ? (item.sizeBytes * 8) / item.durationSec / 1_000_000 : 0;
                    const parts = [
                        item.fps > 0 ? `${Math.round(item.fps * 100) / 100} fps` : null,
                        item.sizeBytes > 0 ? `${mb.toFixed(1)} MB` : null,
                        mbps > 0 ? `${mbps.toFixed(1)} Mbps` : null,
                    ].filter(Boolean);
                    pushToast(
                        `Rendered "${item.compName}" → ${folder}${parts.length ? ` · ${parts.join(" · ")}` : ""}`,
                        "success",
                        15000 // long-lived: the artist may not be looking when a long render lands
                    );
                    sfx.success();
                }
                // done / failed / other: either way, stop watching this index
            }
            watchPendingRef.current = stillPending;
        } catch {
            // bridge hiccup -- keep the pending list, retry next tick
        }

        const stillGoing = watchPendingRef.current.length > 0 && Date.now() < watchDeadlineRef.current;
        // Deadline hit with items still pending = we stop watching, so the
        // indicator must go dark too rather than pulse a lie.
        setWatchingCount(stillGoing ? watchPendingRef.current.length : 0);
        if (stillGoing) {
            watchTimerRef.current = setTimeout(pollRenderWatch, 5000);
        }
    };

    const startRenderWatch = async () => {
        try {
            const result = (await evalTS("renderWatchSnapshot")) as
                | { success: boolean; items?: WatchItem[] }
                | undefined;
            if (!result || !result.success || !result.items) return;
            watchPendingRef.current = result.items
                .filter((it) => it.status === "queued" || it.status === "rendering")
                .map((it) => it.index);
            if (watchPendingRef.current.length === 0) return;
            setWatchingCount(watchPendingRef.current.length);
            watchDeadlineRef.current = Date.now() + 4 * 60 * 60 * 1000;
            if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
            watchTimerRef.current = setTimeout(pollRenderWatch, 5000);
        } catch {
            // no bridge -- nothing to watch
        }
    };

    const makeRow = (c: any, batchOffset: number): RowData => ({
        id: c.id,
        name: c.name,
        folderName: c.folderName ?? null,
        batchFolder: c.batchFolder ?? null,
        territoryCode: c.territoryCode ?? null,
        sourcePath: c.sourcePath ?? null,
        duration: c.duration ?? 0,
        frameRate: c.frameRate ?? 0,
        sizeMB: "",
        maxMbps: "",
        fps: bulkFps,
        batchOffset,
        includeAudio: false,
        audioTouched: false,
        queued: false,
    });

    // Adds comps to the list without disturbing what's already there (used by
    // the Delivery button's auto-load). Skips any comp already in the list, so
    // clicking Delivery on a comp that's already queued up doesn't double it.
    // Returns how many rows were actually added. batchOffset is the row count
    // BEFORE the append, which is what makes only the new rows cascade in --
    // the entrance delay is (index - batchOffset).
    const appendComps = (comps: any[]): number => {
        // Reads `rows` from this render's closure rather than counting inside
        // a setRows updater -- React runs updaters lazily, so a count taken in
        // there would still be 0 by the time we returned it.
        const fresh = comps
            .filter((c) => !rows.some((r) => r.id === c.id))
            .map((c) => makeRow(c, rows.length));
        if (fresh.length === 0) return 0;
        setRows((prev) => prev.concat(fresh));
        return fresh.length;
    };

    // Keyed by the row's id at the moment the click happened -- once the
    // rotate succeeds the row's own `id` field is REPLACED with the new
    // wrapper comp's id (see below), so this set has to be cleared using
    // the id captured in the closure, not whatever `row.id` reads as by
    // the time the async call resolves.
    const [rotatingIds, setRotatingIds] = useState<Set<number>>(new Set());

    const handleRotateRow = async (rowId: number) => {
        setRotatingIds((s) => new Set(s).add(rowId));
        try {
            const result = await evalTS("deliveryRotate90CC", rowId);
            if (result === undefined) { pushToast("No CEP bridge detected — open this panel inside After Effects to run it.", "error"); return; }
            if (!result.success || !result.comp) { pushToast(result.error || "Rotate failed.", "error"); return; }
            const rotated = result.comp;
            // Deliberately NOT makeRow() -- this REPLACES an existing row in
            // place, so the fields the user already set (sizeMB/maxMbps/fps/
            // includeAudio/batchOffset) need to survive; makeRow() always
            // resets those to defaults, which is right for a brand-new row
            // but would silently wipe out whatever the user had already
            // typed into this one. Only the identity (id/name) and comp-
            // derived fields (folder/batch/duration/frameRate/sourcePath)
            // swap to the new rotated wrapper comp.
            setRows((r) =>
                r.map((x) =>
                    x.id === rowId
                        ? {
                              ...x,
                              id: rotated.id,
                              name: rotated.name,
                              folderName: rotated.folderName ?? null,
                              batchFolder: rotated.batchFolder ?? null,
                              territoryCode: rotated.territoryCode ?? null,
                              sourcePath: rotated.sourcePath ?? null,
                              duration: rotated.duration ?? 0,
                              frameRate: rotated.frameRate ?? 0,
                          }
                        : x
                )
            );
            pushToast(`Rotated → ${rotated.name}`);
        } catch {
            pushToast("No CEP bridge detected — open this panel inside After Effects to run it.", "error");
        } finally {
            setRotatingIds((s) => {
                const next = new Set(s);
                next.delete(rowId);
                return next;
            });
        }
    };

    const loadComps = async () => {
        setCheckError(null);
        try {
            const result = await evalTS("deliveryChecklistLoadComps");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) { setCheckError(result.error || "Something went wrong."); return; }
            setRows((result.comps || []).map((c: any, i: number) => makeRow(c, i)));
            setBatchKey((k) => k + 1);
            if ((result.comps || []).length > 0) sfx.bop();
        } catch {
            setCheckError("No CEP bridge — open inside After Effects.");
        }
    };

    // MB is optional everywhere now (an empty one renders at DEFAULT_MBPS) --
    // only a value that's actually been typed and is nonsense gets rejected.
    const isBadNumber = (v: string) => v !== "" && (isNaN(parseFloat(v)) || parseFloat(v) <= 0);

    const applyBulk = () => {
        if (isBadNumber(bulkSize)) { setCheckError("Invalid MB value."); return; }
        if (isBadNumber(bulkMbps)) { setCheckError("Invalid Mbps value."); return; }
        if (isBadNumber(bulkFps)) { setCheckError("Invalid fps value."); return; }
        setCheckError(null);
        setRows((r) => r.map((row) => ({ ...row, sizeMB: bulkSize, maxMbps: bulkMbps, fps: bulkFps })));
    };

    const queueAll = async () => {
        if (rows.length === 0) { setCheckError("Load comps first."); return; }
        for (const row of rows) {
            if (isBadNumber(row.sizeMB)) {
                setCheckError(`Invalid MB on "${getShortLabel(row.name)}".`); return;
            }
            if (row.maxMbps !== "" && (isNaN(parseFloat(row.maxMbps)) || parseFloat(row.maxMbps) <= 0)) {
                setCheckError(`Invalid Mbps cap on "${getShortLabel(row.name)}".`); return;
            }
            if (row.fps !== "" && (isNaN(parseFloat(row.fps)) || parseFloat(row.fps) <= 0)) {
                setCheckError(`Invalid fps on "${getShortLabel(row.name)}".`); return;
            }
        }
        setCheckError(null);
        setCheckBusy(true);
        try {
            const result = await evalTS(
                "deliveryChecklistQueue",
                rows.map((r) => ({
                    id: r.id,
                    // null = "no target size" -> deliver.ts renders it at its
                    // DELIVERY_DEFAULT_MBPS instead of refusing to queue.
                    sizeMB: r.sizeMB !== "" ? parseFloat(r.sizeMB) : null,
                    maxMbps: r.maxMbps !== "" ? parseFloat(r.maxMbps) : null,
                    fps: r.fps !== "" ? parseFloat(r.fps) : null,
                    includeAudio: r.includeAudio,
                    audioTouched: r.audioTouched,
                }))
            );
            if (result === undefined) throw new Error("no bridge");
            if (result.success) {
                setLog(result.log || "");
                setRows((r) => r.map((x) => ({ ...x, queued: true })));
                pushToast("Queued — you'll get a toast per file as renders finish (while this page stays open).");
                startRenderWatch();
            }
            else setCheckError(result.error || "Something went wrong.");
        } catch {
            setCheckError("No CEP bridge — open inside After Effects.");
        } finally {
            setCheckBusy(false);
        }
    };

    return (
        <div className="delivery-hub">
            {/* ── Ambient background ────────────────────────────────
                Two soft, blurred corner blobs in the Deliver category's
                own orange, breathing very slowly (opacity + a hint of
                scale, both GPU-cheap) -- same pattern HomeScreen.tsx's
                ambient blobs already use, just one accent instead of
                four since this is a single-category page. Positioned
                behind everything else (.dh-content carries z-index:1),
                low peak alpha, and respects reduced-motion like every
                other animation on this page. */}
            <div className="dh-content">
                <div className="dh-ambient-bg" aria-hidden="true">
                    <motion.div
                        className="dh-ambient-blob dh-ambient-blob--tl"
                        animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <motion.div
                        className="dh-ambient-blob dh-ambient-blob--br"
                        animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 4 }}
                    />
                </div>

            <div className="dh-content-inner">
            {/* ── Action bar ─────────────────────────────────────── */}
            <div className="dh-action-bar">
                <DeliveryButton busy={deliveryBusy} onClick={runDelivery} />

                {watchingCount > 0 && (
                    <span
                        className="dh-render-watch"
                        title="Renders being watched — you'll get a toast with the real file details as each one lands. The dot keeps pulsing even while AE hogs the bridge mid-render."
                    >
                        <span className="dh-render-watch-dot" />
                        Watching {watchingCount} render{watchingCount > 1 ? "s" : ""}
                    </span>
                )}

                <div className="dh-bar-spacer" />

                <LoadButton busy={checkBusy} empty={rows.length === 0} onClick={loadComps} label="Load Comps" />
                <AnimatePresence>
                    {rows.length > 0 && (
                        <motion.div
                            key="clear-wrap"
                            initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                            // "auto", NOT A PIXEL COUNT. This was 62 -- two 28px
                            // icon buttons and a 6px gap -- and before that 28,
                            // which clipped the second button so the two icons
                            // looked stacked. It broke a third time the moment
                            // one of them gained a text label: overflow:hidden
                            // cut "Read specs" to "ead specs" and slid the bin
                            // icon over the top of it.
                            //
                            // Three breakages of the same kind is the measure
                            // saying it is the wrong measure. The width of this
                            // strip is whatever its contents are, and Framer
                            // measures that itself.
                            animate={{ width: "auto", opacity: 1, marginLeft: 6 }}
                            exit={{ width: 0, opacity: 0, marginLeft: 0 }}
                            transition={{ duration: 0.15, ease: "easeOut" }}
                            style={{ overflow: "hidden", flexShrink: 0, display: "flex", gap: 6 }}
                        >
                            {/* Opt-in, never automatic: reads each row's own comp
                                name for its country code, finds that territory's
                                Masters/Specs, and fills ONLY empty fields. Where a
                                spec can't be read (vendor sheets rather than a
                                table) it names the document to open instead.

                                ONE BUTTON, because it was always one job. It used
                                to be two unlabelled glyphs -- one filled the rows,
                                one showed the sheet -- and nothing on screen said
                                which was which. Now it does both and says so, and
                                the sheet appearing underneath is what makes the
                                filled values checkable. */}
                            <Tooltip text="Read the client spec PDFs: fill anything still blank on each row, and show what the sheet says">
                                <button
                                    className={"dh-icon-btn dh-readspecs" + (report ? " is-on" : "")}
                                    disabled={checkBusy || suggestBusy || reportBusy || rows.length === 0}
                                    onClick={() => {
                                        if (report) { setReport(null); setLoadedSpecReport(null); return; }
                                        void readSpecs();
                                    }}
                                >
                                    <FileText size={14} />
                                    <span>{suggestBusy || reportBusy ? "Reading…" : "Read specs"}</span>
                                </button>
                            </Tooltip>
                            <button
                                className="dh-icon-btn"
                                disabled={checkBusy}
                                onClick={() => { setRows([]); setLog(""); setCheckError(null); setBatchKey((k) => k + 1); }}
                            >
                                <Trash2 size={14} />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── Bulk edit bar ─────────────────────────────────────
                Field order here MATCHES the row order below (MB, fps, ≤ Mbps).
                It used to be MB, ≤ Mbps, fps -- so the bulk field you were
                aiming at never sat above the row field it fills in. */}
            <div className="dh-bulk-bar">
                <div className="dh-bar-spacer" />
                <Tooltip text="Target file size (MB) — optional, defaults to 26 Mbps">
                    <input
                        className="dh-spec-input"
                        type="text"
                        placeholder="MB"
                        value={bulkSize}
                        onChange={(e) => setBulkSize(e.target.value)}
                    />
                </Tooltip>
                <span className="dh-specs-sep" style={{ marginLeft: 2 }}>fps</span>
                <Droplet
                    panelClassName="dh-fps-droplet"
                    trigger={({ toggle }) => (
                        <Tooltip text="Frame rate (optional)">
                            <button
                                className={"dh-fps-trigger" + (bulkFps ? " dh-fps-trigger--set" : "")}
                                onClick={toggle}
                            >
                                {bulkFps || "—"}
                            </button>
                        </Tooltip>
                    )}
                >
                    {(close) => <FpsDropletBody close={close} onPick={(v) => { setBulkFps(v); }} />}
                </Droplet>
                <span className="dh-specs-sep">≤</span>
                <Tooltip text="Bitrate cap (optional)">
                    <input
                        className="dh-spec-input dh-spec-input--secondary"
                        type="text"
                        placeholder="Mbps"
                        value={bulkMbps}
                        onChange={(e) => setBulkMbps(e.target.value)}
                    />
                </Tooltip>
                <Tooltip text="Apply to all rows">
                    <motion.button
                        className="dh-icon-btn"
                        onClick={applyBulk}
                        whileHover={reduced ? {} : { scale: 1.08 }}
                        whileTap={reduced ? {} : { scale: 0.94 }}
                    >
                        <ChevronsDown size={14} />
                    </motion.button>
                </Tooltip>
            </div>

            {/* ── Row list ───────────────────────────────────────── */}
            <div className="dh-rows-area">
                {rows.length === 0 ? (
                    <EmptyState />
                ) : (
                    <AnimatePresence>
                        <div key={batchKey}>
                        {rows.map((row, i) => {
                            const missing = !row.folderName;
                            const warnings = rowWarnings(row);
                            return (
                                <motion.div
                                    key={row.id}
                                    className={missing ? "dh-row dh-row--missing" : "dh-row" + (row.queued ? " dh-row--queued" : "")}
                                    initial={{ opacity: 0, x: -10, y: -4 }}
                                    animate={{ opacity: 1, x: 0, y: 0 }}
                                    exit={{ opacity: 0, x: 12, transition: { duration: 0.12 } }}
                                    transition={{
                                        duration: 0.25,
                                        delay: reduced ? 0 : (i - row.batchOffset) * 0.06,
                                        ease: [0.22, 1, 0.36, 1],
                                    }}
                                    layout
                                    >
                                    <Tooltip text={row.name}>
                                        <span className="dh-row-name">
                                            {getShortLabel(row.name)}
                                        </span>
                                    </Tooltip>
                                    {suggestions[row.id]?.source && (
                                        suggestions[row.id].openPath ? (
                                            <Tooltip text={suggestions[row.id].source + " — click to open it"}>
                                                <button
                                                    className="dh-row-spec"
                                                    onClick={() => {
                                                        const p = suggestions[row.id]?.openPath;
                                                        // `open` rather than a file:// URL: CEP's
                                                        // browser handoff is unreliable for local
                                                        // files, same as in masterCheck.ts.
                                                        if (p) { try { child_process.spawn("open", [p], { detached: true }); } catch { /* nothing to do */ } }
                                                    }}
                                                >
                                                    spec
                                                </button>
                                            </Tooltip>
                                        ) : (
                                            /* A reason, but no document to open. Rendered as a
                                               plain chip rather than the button above -- a
                                               control that looks clickable and does nothing is
                                               worse than saying so. */
                                            <Tooltip text={suggestions[row.id].source}>
                                                <span className="dh-row-spec dh-row-spec--none">no spec</span>
                                            </Tooltip>
                                        )
                                    )}
                                    {warnings.length > 0 && (
                                        <Tooltip text={warnings.join(" · ") + " — correct the value to clear this"}>
                                            <span className="dh-row-warn" aria-label="Check these numbers">▲</span>
                                        </Tooltip>
                                    )}
                                    {row.queued && (
                                        <Tooltip text="Un-queue (removes from render queue)">
                                            <button
                                                className="dh-row-queued-badge dh-row-unqueue-btn"
                                                onClick={async () => {
                                                    try {
                                                        await evalTS("renderQueueRemoveByCompId", row.id);
                                                    } catch { /* bridge may be down */ }
                                                    setRows((r) => r.map((x, xi) => xi === i ? { ...x, queued: false } : x));
                                                }}
                                            >
                                                <Check size={10} /> Queued
                                            </button>
                                        </Tooltip>
                                    )}
                                    {!row.queued && (
                                        <>
                                        <Tooltip text={row.includeAudio ? "Includes audio" : "No audio"}>
                                            <button
                                                className={`dh-row-audio${row.includeAudio ? " active" : ""}`}
                                                onClick={() => setRows((r) => r.map((x, xi) => xi === i ? { ...x, includeAudio: !x.includeAudio, audioTouched: true } : x))}
                                            >
                                                {row.includeAudio ? <Volume2 size={11} /> : <VolumeX size={11} />}
                                            </button>
                                        </Tooltip>
                                        <Tooltip text="Rotate 90°CC - replaces this row with the rotated comp">
                                            <button
                                                className="dh-row-rotate"
                                                disabled={rotatingIds.has(row.id)}
                                                onClick={() => handleRotateRow(row.id)}
                                            >
                                                <RotateCcw size={11} className={rotatingIds.has(row.id) ? "spin" : ""} />
                                            </button>
                                        </Tooltip>
                                        <label className="dh-row-field">
                                            MB
                                            <input
                                                type="text"
                                                value={row.sizeMB}
                                                onChange={(e) => setRows((r) => r.map((x, xi) => xi === i ? { ...x, sizeMB: e.target.value } : x))}
                                            />
                                        </label>
                                        <label className="dh-row-field dh-row-field--cap">
                                            fps
                                            <input
                                                type="text"
                                                placeholder="—"
                                                value={row.fps}
                                                onChange={(e) => setRows((r) => r.map((x, xi) => xi === i ? { ...x, fps: e.target.value } : x))}
                                            />
                                        </label>
                                        <label className="dh-row-field dh-row-field--cap">
                                            ≤
                                            <input
                                                type="text"
                                                placeholder="—"
                                                value={row.maxMbps}
                                                onChange={(e) => setRows((r) => r.map((x, xi) => xi === i ? { ...x, maxMbps: e.target.value } : x))}
                                            />
                                        </label>
                                        </>
                                    )}
                                </motion.div>
                            );
                        })}
                        </div>
                    </AnimatePresence>
                )}
            </div>

            {/* ── Delivery preview (below list, above queue) ───────── */}
            {rows.length > 0 && !rows.every((r) => r.queued) && (
                <div className="dh-preview">
                    {(() => {
                        // Group unqueued rows by source folder so each group
                        // shows its own _Delivery path (different batches
                        // may land in different _Delivery folders).
                        const groups = new Map<string, RowData[]>();
                        rows.forEach((r) => {
                            if (!r.folderName || r.queued) return;
                            if (!groups.has(r.folderName)) groups.set(r.folderName, []);
                            groups.get(r.folderName)!.push(r);
                        });
                        if (groups.size === 0) return null;
                        return (
                            <>
                                {Array.from(groups.entries()).map(([folder, group]) => {
                                    const previewCode = group.find((r) => r.territoryCode)?.territoryCode || null;
                                    return (
                                        <div key={folder} className="dh-preview-group">
                                            <div className="dh-preview-header">
                                                <Folder size={11} />
                                                {previewCode && <span className="dh-preview-flag">{codeToFlag(previewCode)}</span>}
                                                <span className="dh-preview-folder">{folder}</span>
                                                <span className="dh-preview-sep">/</span>
                                                <span className="dh-preview-folder">_Delivery</span>
                                            </div>
                                            <div className="dh-preview-items">
                                                {group.map((row) => {
                                                    const ext = row.name.match(/\.\w+$/) ? "" : ".mp4";
                                                    const outName = row.name + ext;
                                                    const predicted = predictRowTemplate(row);
                                                    return (
                                                        <div key={row.id} className="dh-preview-item">
                                                            <span className="dh-preview-file">{outName}</span>
                                                            <span className="dh-preview-tags">
                                                                {/* No target size is a valid state now -- show what it'll
                                                                    actually render at rather than leaving a blank gap. */}
                                                                {row.sizeMB
                                                                    ? <span className="dh-preview-tag">{row.sizeMB} MB</span>
                                                                    : <span className="dh-preview-tag dh-preview-tag--native">{DEFAULT_MBPS} Mbps</span>}
                                                                {row.duration > 0 && <span className="dh-preview-tag">{row.duration} sec</span>}
                                                                <span className={"dh-preview-tag" + (row.fps ? "" : " dh-preview-tag--native")}>{row.fps || row.frameRate} fps</span>
                                                                {predicted && (
                                                                    <Tooltip text={predicted.capped
                                                                        ? "The Mbps cap outranks the size target — the file will likely land below the requested MB."
                                                                        : "The Output Module template this row will actually get — the required bitrate rounds DOWN to the nearest prebuilt template, never up."}>
                                                                        <span className={"dh-preview-tag dh-preview-tag--template" + (predicted.capped ? " dh-preview-tag--capped" : "")}>
                                                                            → {predicted.name}
                                                                        </span>
                                                                    </Tooltip>
                                                                )}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </>
                        );
                    })()}
                </div>
            )}

            {rows.length > 0 && (
                <div className="dh-queue-bar">
                    <QueueButton busy={checkBusy} disabled={checkBusy || rows.length === 0} onClick={queueAll} />
                </div>
            )}

            {/* ── What the spec PDFs say ─────────────────────────── */}
            <AnimatePresence>
                {report && (
                    <motion.div
                        className="dh-specreport"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                    >
                        <div className="dh-specreport-head">
                            <FileText size={12} />
                            <span>{report.folder || "no specs folder"}</span>
                            <button onClick={() => { setReport(null); setLoadedSpecReport(null); }}><X size={11} /></button>
                        </div>

                        {report.note && <p className="dh-specreport-note">{report.note}</p>}

                        {report.files.map((f) => (
                            <div className="dh-specreport-file" key={f.file}>
                                <p className="dh-specreport-name">
                                    {f.file}
                                    {/* A PDF that could not be read is LISTED, not
                                        omitted. Leaving it out is indistinguishable
                                        from never having looked at it. */}
                                    {f.error && <em> — {f.error}</em>}
                                    {!f.error && <em> — {f.rows.length} row{f.rows.length === 1 ? "" : "s"}</em>}
                                </p>
                                {f.rows.length > 0 && (
                                    <div className="dh-specreport-scroll">
                                        <table className="dh-specreport-table">
                                            <thead>
                                                <tr>
                                                    <th>Size</th><th>Secs</th><th>Bitrate</th>
                                                    <th>Fps</th><th>Max file</th><th>Sound</th><th>Site</th><th>Notes</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {f.rows.map((r, i) => (
                                                    <tr key={i} className={r.flags ? "is-flagged" : undefined}>
                                                        <td>{r.size || "—"}</td>
                                                        <td>{r.duration || "—"}</td>
                                                        <td>{r.bitRate ? r.bitRate + " Mbps" : "—"}</td>
                                                        <td>{r.fps || "—"}</td>
                                                        <td>{r.fileSize ? r.fileSize + " MB" : "—"}</td>
                                                        <td>{r.sound || "—"}</td>
                                                        <td>{r.site || r.country || "—"}</td>
                                                        {/* VERBATIM. The parser reads one
                                                            phrasing of "max size"; the sheet is
                                                            the authority and this is where the
                                                            unparseable half of it lives. */}
                                                        <td className="dh-specreport-notes">{r.notes || "—"}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {/* THE PARSER'S OWN DOUBTS, said out loud. These
                                    tables are filled in by hand and routinely put
                                    the fps in the bitrate column; pdfSpecs flags
                                    that rather than silently correcting it, and
                                    hiding the flag here would undo the point. */}
                                {f.rows.some((r) => r.flags) && (
                                    <ul className="dh-specreport-flags">
                                        {f.rows.filter((r) => r.flags).map((r, i) => (
                                            <li key={i}>
                                                <AlertTriangle size={10} /> {r.size || "?"} · {r.duration || "?"}s — {r.flags}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}

                        <div className="dh-specreport-foot">
                            <span>
                                Read straight off the PDFs. Nothing here has been filled into a row —
                                use the folder button for that.
                            </span>
                            {/* THE ONE QUESTION WORTH A BUTTON HERE. A table has
                                just been parsed off somebody else's hand-filled
                                spreadsheet; "is anything wrong with it" is the
                                next thought every single time, and it is the
                                thing the agent does better than the table does. */}
                            <AskAbout
                                label="Check these specs"
                                hint="Reads the sheet and the rows you have loaded, and says what looks wrong"
                                // ASKS FOR THE ANSWER, NOT THE RECITAL. The first
                                // wording invited a walk through every row of every
                                // PDF and ran past the reply limit, so nothing at
                                // all came back. One line per deliverable, then the
                                // problems — the table is already on screen.
                                question={
                                    "Check the spec sheet I have open in Delivery against the rows I've loaded. " +
                                    "One short line per deliverable saying which spec row it matches, then list " +
                                    "only what looks wrong or contradictory. Don't restate the table — it's on " +
                                    "screen in front of me."
                                }
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Error + log ────────────────────────────────────── */}
            <AnimatePresence>
                {checkError && (
                    <motion.div
                        className="dh-error"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                    >
                        <AlertCircle size={12} />
                        <span>{checkError}</span>
                        <button onClick={() => setCheckError(null)}><X size={11} /></button>
                    </motion.div>
                )}
            </AnimatePresence>
            {log && <pre className="dh-log">{log}</pre>}

            {/* ── Toasts ─────────────────────────────────────────── */}
            <div className="dh-toast-stack">
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
            </div>
        </div>
    );
};

export default DeliveryHubTool;
