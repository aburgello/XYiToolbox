// =============================================================================
// src/js/main/tools/DeliveryHub.tsx
// =============================================================================
import React, { useState, useRef } from "react";
import { motion, AnimatePresence, useAnimate, useReducedMotion } from "motion/react";
import { Truck, ListPlus, Trash2, ChevronsDown, Send, AlertCircle, AlertTriangle, Check, X, Volume2, VolumeX, Folder } from "lucide-react";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import { evalTS } from "../../lib/utils/bolt";
import { sfx } from "../../lib/utils/sfx";
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
        queued: false,
    }));
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

    const runDelivery = async () => {
        setDeliveryBusy(true);
        try {
            const result = await evalTSSafe("delivery");
            pushToast(
                result.success ? "Delivery comp(s) created." : result.error || "Something went wrong.",
                result.success ? "success" : "error"
            );
        } finally {
            setDeliveryBusy(false);
        }
    };

    // --- Checklist ----------------------------------------------------------
    const [rows, setRows] = useState<RowData[]>([]);
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
    const pushToast = (text: string, type: Toast["type"] = "success") => {
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, text, type }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    };

    const loadComps = async () => {
        setCheckError(null);
        try {
            const result = await evalTS("deliveryChecklistLoadComps");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) { setCheckError(result.error || "Something went wrong."); return; }
            setRows(
                (result.comps || []).map((c: any, i: number) => ({
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
                    batchOffset: i,
                    includeAudio: false,
                    queued: false,
                }))
            );
            setBatchKey((k) => k + 1);
            if ((result.comps || []).length > 0) sfx.bop();
        } catch {
            setCheckError("No CEP bridge — open inside After Effects.");
        }
    };

    const applyBulk = () => {
        const val = parseFloat(bulkSize);
        if (isNaN(val) || val <= 0) { setCheckError("Invalid MB value."); return; }
        const fps = parseFloat(bulkFps);
        if (bulkFps !== "" && (isNaN(fps) || fps <= 0)) { setCheckError("Invalid fps value."); return; }
        setCheckError(null);
        setRows((r) => r.map((row) => ({ ...row, sizeMB: bulkSize, maxMbps: bulkMbps, fps: bulkFps })));
    };

    const queueAll = async () => {
        if (rows.length === 0) { setCheckError("Load comps first."); return; }
        for (const row of rows) {
            if (isNaN(parseFloat(row.sizeMB)) || parseFloat(row.sizeMB) <= 0) {
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
                    sizeMB: parseFloat(r.sizeMB),
                    maxMbps: r.maxMbps !== "" ? parseFloat(r.maxMbps) : null,
                    fps: r.fps !== "" ? parseFloat(r.fps) : null,
                    includeAudio: r.includeAudio,
                }))
            );
            if (result === undefined) throw new Error("no bridge");
            if (result.success) { setLog(result.log || ""); setRows((r) => r.map((x) => ({ ...x, queued: true }))); pushToast("Queued."); }
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

                <div className="dh-bar-spacer" />

                <LoadButton busy={checkBusy} empty={rows.length === 0} onClick={loadComps} label="Load Comps" />
                <AnimatePresence>
                    {rows.length > 0 && (
                        <motion.div
                            key="clear-wrap"
                            initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                            animate={{ width: 28, opacity: 1, marginLeft: 6 }}
                            exit={{ width: 0, opacity: 0, marginLeft: 0 }}
                            transition={{ duration: 0.15, ease: "easeOut" }}
                            style={{ overflow: "hidden", flexShrink: 0 }}
                        >
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

            {/* ── Bulk edit bar ───────────────────────────────────── */}
            <div className="dh-bulk-bar">
                <div className="dh-bar-spacer" />
                <Tooltip text="Target file size (MB)">
                    <input
                        className="dh-spec-input"
                        type="text"
                        placeholder="MB"
                        value={bulkSize}
                        onChange={(e) => setBulkSize(e.target.value)}
                    />
                </Tooltip>
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
                                                onClick={() => setRows((r) => r.map((x, xi) => xi === i ? { ...x, includeAudio: !x.includeAudio } : x))}
                                            >
                                                {row.includeAudio ? <Volume2 size={11} /> : <VolumeX size={11} />}
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
                                                    return (
                                                        <div key={row.id} className="dh-preview-item">
                                                            <span className="dh-preview-file">{outName}</span>
                                                            <span className="dh-preview-tags">
                                                                {row.sizeMB && <span className="dh-preview-tag">{row.sizeMB} MB</span>}
                                                                {row.duration > 0 && <span className="dh-preview-tag">{row.duration} sec</span>}
                                                                <span className={"dh-preview-tag" + (row.fps ? "" : " dh-preview-tag--native")}>{row.fps || row.frameRate} fps</span>
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
