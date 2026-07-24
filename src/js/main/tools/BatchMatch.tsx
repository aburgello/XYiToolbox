// =============================================================================
// src/js/main/tools/BatchMatch.tsx
// -----------------------------------------------------------------------------
// Batch Match -- "fix one file by hand, make the rest agree."
//
// Capture a property from the project you have open (whatever is selected in
// the Timeline), then push a value derived from it onto the equivalent
// property across every .aep in a folder. Backend: jsx/aeft/batchMatch.ts,
// which explains the matching/scope rules and why they exist.
//
// Two-phase by design, same as Localised Library's batch-folder action and the
// CSV Localiser's specs table: PREVIEW builds a per-row table of current ->
// proposed with a checkbox each, and only then does Apply write. A batch that
// silently touches the wrong property across 30 files is expensive to undo, so
// there is deliberately no one-click path from capture to write.
//
// The config crosses the bridge as ONE JSON STRING, not as a nested object
// argument. evalTS splices JSON.stringify(arg) into the eval'd ExtendScript
// SOURCE, and a nested array-of-objects does not survive being re-parsed as a
// source literal (this cost a real debugging round in motionTools' ease
// copy/paste -- see CLAUDE.md). A single string always survives.
// =============================================================================
import React, { useState } from "react";
import {
    Crosshair,
    FolderSearch,
    Eye,
    Check,
    AlertTriangle,
    Layers as LayersIcon,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import CheckboxToggle from "../CheckboxToggle";
import Dropdown from "../Dropdown";
import { confirmDialog } from "../Dialog";
import "../shared.scss";
import "./formTool.scss";
import "./BatchMatch.scss";

interface StatusMsg { text: string; type: "success" | "error" }

interface Reference {
    compName: string;
    compWidth: number;
    compHeight: number;
    layerName: string;
    sourceName: string;
    sourceWidth: number;
    sourceHeight: number;
    propertyLabel: string;
    pathJson: string;
    dimensions: number;
    isKeyframed: boolean;
    numKeys: number;
    keyIndex: number;
    keyTime: number;
    value: number[];
    hasExpression: boolean;
}

interface Row {
    id: string;
    file: string;
    compPath: string;
    compName: string;
    compSize: string;
    layerName: string;
    layerIndex: number;
    sourceSize: string;
    keyIndex: number;
    keyTime: number;
    current: number[];
    proposed: number[];
    status: string;
    note?: string;
    savedAs?: string;
}

const LAYER_MODES = [
    { id: "endsWith", label: "Name ends with" },
    { id: "exact", label: "Name is exactly" },
    { id: "contains", label: "Name contains" },
    { id: "any", label: "Any layer that has the property" },
];

const TRANSFORM_MODES = [
    { id: "verbatim", label: "Same value", hint: "Write the reference value as-is. Right when the property means the same thing everywhere (a slider, an angle, an opacity)." },
    { id: "scaleSource", label: "Scale to each layer's source size", hint: "Reference value x (target source size / reference source size). For values in SOURCE-pixel space -- an effect's Center on assets of different pixel sizes." },
    { id: "scaleComp", label: "Scale to each comp size", hint: "Reference value x (target comp size / reference comp size). For values in COMP space -- a layer Position across differently-sized comps." },
    { id: "offset", label: "Offset each by", hint: "Adds to whatever each target already has. Keeps every file's own value, just shifted." },
    { id: "multiply", label: "Multiply each by", hint: "Scales whatever each target already has." },
];

const KEY_TARGETS = [
    { id: "last", label: "Last keyframe" },
    { id: "first", label: "First keyframe" },
    { id: "all", label: "Every keyframe" },
    { id: "static", label: "The static value (not keyframed)" },
    { id: "auto", label: "Last keyframe, or the static value if none" },
];

const AXIS_LABELS = ["X", "Y", "Z"];

const fmt = (v: number[]) => (v && v.length ? v.map((n) => Math.round(n * 100) / 100).join(", ") : "—");

const BatchMatchTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const [reference, setReference] = useState<Reference | null>(null);
    const [folder, setFolder] = useState("");
    const [includeSubfolders, setIncludeSubfolders] = useState(false);

    const [layerMode, setLayerMode] = useState("endsWith");
    const [layerText, setLayerText] = useState("");

    const [requireMain, setRequireMain] = useState(true);
    const [excludeImported, setExcludeImported] = useState(true);
    const [compSizes, setCompSizes] = useState("");

    const [transformMode, setTransformMode] = useState("verbatim");
    const [axes, setAxes] = useState<number[]>([0]);
    const [amounts, setAmounts] = useState<string[]>(["0", "0", "0"]);
    const [keyTarget, setKeyTarget] = useState("last");
    const [roundDecimals, setRoundDecimals] = useState("1");

    const [rows, setRows] = useState<Row[] | null>(null);
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [applied, setApplied] = useState(false);

    const changeRows = (rows || []).filter((r) => r.status === "change");
    const selectedIds = changeRows.filter((r) => checked[r.id] !== false).map((r) => r.id);

    const capture = async () => {
        setStatus(null);
        try {
            const res = await evalTS("batchMatchCaptureReference");
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) { setStatus({ text: res.error || "Could not capture.", type: "error" }); return; }
            const ref = res as unknown as Reference;
            setReference(ref);
            setRows(null);
            setApplied(false);
            // Sensible defaults straight from what was captured: match the same
            // layer by name, and default the axis list to every dimension the
            // property actually has.
            if (!layerText) setLayerText(ref.layerName);
            setAxes(ref.dimensions >= 2 ? [0] : [0]);
            setKeyTarget(ref.isKeyframed ? "last" : "static");
            if (ref.hasExpression) {
                setStatus({ text: "Heads up: that property is driven by an expression, so the value you captured is a computed result. Targets with expressions are skipped.", type: "error" });
            }
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to use this.", type: "error" });
        }
    };

    const pickFolder = async () => {
        try {
            const path = await evalTS("selectBatchMatchFolder");
            if (path === undefined) throw new Error("no bridge");
            if (path) { setFolder(path); setRows(null); setApplied(false); }
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to use this.", type: "error" });
        }
    };

    const buildConfig = (ids: string[]) => ({
        folder,
        includeSubfolders,
        layerRule: { mode: layerMode, text: layerText },
        scope: {
            requireMainFolder: requireMain,
            excludeImportedAep: excludeImported,
            compSizes: compSizes.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
        },
        pathJson: reference ? reference.pathJson : "",
        keyTarget,
        transform: {
            mode: transformMode,
            axes,
            amounts: amounts.map((a) => (parseFloat(a) || 0)),
        },
        reference: {
            value: reference ? reference.value : [],
            sourceWidth: reference ? reference.sourceWidth : 0,
            sourceHeight: reference ? reference.sourceHeight : 0,
            compWidth: reference ? reference.compWidth : 0,
            compHeight: reference ? reference.compHeight : 0,
        },
        roundDecimals: roundDecimals === "" ? -1 : parseInt(roundDecimals, 10),
        selectedIds: ids,
    });

    const preview = async () => {
        if (!reference) { setStatus({ text: "Capture a reference property first.", type: "error" }); return; }
        if (!folder) { setStatus({ text: "Pick the folder of .aep files to match.", type: "error" }); return; }
        if (layerMode !== "any" && !layerText.trim()) { setStatus({ text: "Give a layer name to match on, or switch to “Any layer”.", type: "error" }); return; }

        setBusy(true);
        setStatus(null);
        setApplied(false);
        try {
            const res = await evalTS("batchMatchPreview", JSON.stringify(buildConfig([])));
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) { setStatus({ text: res.error || "Preview failed.", type: "error" }); return; }
            setRows(res.rows as unknown as Row[]);
            setChecked({});
            setStatus({ text: res.message || "Preview complete.", type: "success" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const apply = async () => {
        if (!selectedIds.length) { setStatus({ text: "Nothing selected to apply.", type: "error" }); return; }
        const ok = await confirmDialog(
            `Write ${selectedIds.length} value(s) across ${new Set(changeRows.filter((r) => checked[r.id] !== false).map((r) => r.file)).size} project file(s)?\n\n` +
            `This edits those .aep files on disk and cannot be undone from here. Any file whose name still carries an “OV” master token is copied first and only the copy is edited.\n\n` +
            `After Effects can only hold one project open, so your current project is closed to run the batch — AE will ask whether to save it first.`
        );
        if (!ok) return;

        setBusy(true);
        setStatus(null);
        try {
            const res = await evalTS("batchMatchApply", JSON.stringify(buildConfig(selectedIds)));
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) { setStatus({ text: res.error || "Apply failed.", type: "error" }); return; }
            setRows(res.rows as unknown as Row[]);
            setApplied(true);
            setStatus({ text: res.message || "Applied.", type: "success" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const toggleAxis = (d: number) =>
        setAxes((prev) => (prev.indexOf(d) !== -1 ? prev.filter((x) => x !== d) : prev.concat([d]).sort()));

    const needsAmounts = transformMode === "offset" || transformMode === "multiply";
    const activeMode = TRANSFORM_MODES.filter((m) => m.id === transformMode)[0];
    const skipRows = (rows || []).filter((r) => r.status === "skip");
    const sameRows = (rows || []).filter((r) => r.status === "same");

    return (
        <div className="form-tool batch-match">

            {/* ── 1. reference ────────────────────────────────────────────── */}
            <div className="bm-step">
                <div className="bm-step-head"><span className="bm-step-num">1</span> Reference</div>
                <p className="bm-hint">
                    In After Effects, select the property you've already got right — click its name in the
                    Timeline (an effect's Center, a Position, a slider) — then capture it.
                </p>
                <p className="bm-hint bm-hint--warn">
                    <AlertTriangle size={11} /> A run opens each project in turn, so it closes whatever you
                    have open — AE will prompt to save it first.
                </p>
                <div className="button-row">
                    <button disabled={busy} onClick={capture}>
                        <Crosshair size={14} /> Capture from selection
                    </button>
                </div>

                {reference && (
                    <div className="bm-reference">
                        <div className="bm-ref-prop">{reference.propertyLabel}</div>
                        <div className="bm-ref-line">
                            <span className="bm-ref-key">Layer</span>
                            <span>{reference.layerName}</span>
                        </div>
                        <div className="bm-ref-line">
                            <span className="bm-ref-key">Comp</span>
                            <span>{reference.compName} · {reference.compWidth}x{reference.compHeight}</span>
                        </div>
                        {reference.sourceWidth > 0 && (
                            <div className="bm-ref-line">
                                <span className="bm-ref-key">Source</span>
                                <span>{reference.sourceName || "—"} · {reference.sourceWidth}x{reference.sourceHeight}</span>
                            </div>
                        )}
                        <div className="bm-ref-line">
                            <span className="bm-ref-key">Value</span>
                            <span className="bm-ref-value">
                                {fmt(reference.value)}
                                {reference.isKeyframed
                                    ? ` · key ${reference.keyIndex}/${reference.numKeys} @ ${Math.round(reference.keyTime * 100) / 100}s`
                                    : " · not keyframed"}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* ── 2. where ────────────────────────────────────────────────── */}
            <div className="bm-step">
                <div className="bm-step-head"><span className="bm-step-num">2</span> Where to apply it</div>

                <div className="field-with-button">
                    <div className="field-row">
                        <label>Folder of .aep files</label>
                        <input type="text" readOnly value={folder} placeholder="Not selected" />
                    </div>
                    <Tooltip text="Select the batch folder">
                        <button className="icon-btn" disabled={busy} onClick={pickFolder}><FolderSearch size={14} /></button>
                    </Tooltip>
                </div>

                <CheckboxToggle checked={includeSubfolders} onChange={setIncludeSubfolders} label="Include subfolders (skips _ folders and AE's autosaves)" />

                <div className="field-grid">
                    <div className="field-row">
                        <label>Match layers by</label>
                        <Dropdown
                            value={layerMode}
                            onChange={setLayerMode}
                            options={LAYER_MODES.map((m) => ({ value: m.id, label: m.label }))}
                        />
                    </div>
                    <div className="field-row">
                        <label>Text</label>
                        <input
                            type="text"
                            value={layerText}
                            disabled={layerMode === "any"}
                            onChange={(e) => setLayerText(e.target.value)}
                            placeholder="e.g. FI3.png"
                        />
                    </div>
                </div>
                <p className="bm-hint">Matched against the layer name <em>and</em> its source filename, case-insensitively.</p>

                <div className="bm-scope">
                    <CheckboxToggle checked={requireMain} onChange={setRequireMain} label="Only comps under a “Main” folder" />
                    <CheckboxToggle checked={excludeImported} onChange={setExcludeImported} label="Ignore comps inside imported projects (“….aep” folders)" />
                    <p className="bm-hint bm-hint--warn">
                        <AlertTriangle size={11} /> Keep the second one on. A project that has imported a sibling
                        carries that project's whole Composition/Main tree — those comps look identical to the
                        real ones and are somebody else's deliverable.
                    </p>
                    <div className="field-row">
                        <label>Only these comp sizes</label>
                        <input
                            type="text"
                            value={compSizes}
                            onChange={(e) => setCompSizes(e.target.value)}
                            placeholder="blank = any · e.g. 864x1512, 1080x1920"
                        />
                    </div>
                </div>
            </div>

            {/* ── 3. what value ───────────────────────────────────────────── */}
            <div className="bm-step">
                <div className="bm-step-head"><span className="bm-step-num">3</span> What to write</div>

                <div className="field-row">
                    <label>Value</label>
                    <Dropdown
                        value={transformMode}
                        onChange={setTransformMode}
                        options={TRANSFORM_MODES.map((m) => ({ value: m.id, label: m.label }))}
                    />
                </div>
                {activeMode && <p className="bm-hint">{activeMode.hint}</p>}

                {reference && reference.dimensions > 1 && (
                    <div className="bm-axes">
                        <span className="bm-axes-label">Write which parts</span>
                        {AXIS_LABELS.slice(0, reference.dimensions).map((ax, d) => (
                            <button
                                key={ax}
                                type="button"
                                className={"bm-axis" + (axes.indexOf(d) !== -1 ? " is-on" : "")}
                                onClick={() => toggleAxis(d)}
                            >
                                {ax}
                            </button>
                        ))}
                        <span className="bm-hint bm-hint--inline">Unticked parts keep each target's own value.</span>
                    </div>
                )}

                {needsAmounts && reference && (
                    <div className="field-grid">
                        {AXIS_LABELS.slice(0, reference.dimensions).map((ax, d) => (
                            <div className="field-row" key={ax}>
                                <label>{transformMode === "offset" ? `Offset ${ax}` : `Multiply ${ax}`}</label>
                                <input
                                    type="number"
                                    value={amounts[d]}
                                    disabled={axes.indexOf(d) === -1}
                                    onChange={(e) => setAmounts((prev) => prev.map((v, i) => (i === d ? e.target.value : v)))}
                                />
                            </div>
                        ))}
                    </div>
                )}

                <div className="field-grid">
                    <div className="field-row">
                        <label>Apply to</label>
                        <Dropdown
                            value={keyTarget}
                            onChange={setKeyTarget}
                            options={KEY_TARGETS.map((k) => ({ value: k.id, label: k.label }))}
                        />
                    </div>
                    <div className="field-row">
                        <label>Round to decimals</label>
                        <input type="number" min={-1} max={4} value={roundDecimals} onChange={(e) => setRoundDecimals(e.target.value)} />
                    </div>
                </div>
            </div>

            {/* ── 4. preview / apply ──────────────────────────────────────── */}
            <div className="button-row">
                <button disabled={busy} onClick={preview}>
                    <Eye size={14} /> {busy ? "Working…" : "Preview changes"}
                </button>
                {rows && changeRows.length > 0 && !applied && (
                    <button className="bm-apply" disabled={busy || !selectedIds.length} onClick={apply}>
                        <Check size={14} /> Apply {selectedIds.length} change{selectedIds.length === 1 ? "" : "s"}
                    </button>
                )}
            </div>

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}

            {rows && (
                <div className="bm-results">
                    {changeRows.length > 0 && (
                        <table className="bm-table">
                            <thead>
                                <tr>
                                    <th className="bm-check-col">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.length === changeRows.length}
                                            onChange={() => {
                                                const allOn = selectedIds.length === changeRows.length;
                                                const next: Record<string, boolean> = {};
                                                changeRows.forEach((r) => { next[r.id] = !allOn; });
                                                setChecked(next);
                                            }}
                                            aria-label="Select all changes"
                                        />
                                    </th>
                                    <th>File</th><th>Comp</th><th>Layer</th><th>Key</th><th>Now</th><th>→</th>
                                </tr>
                            </thead>
                            <tbody>
                                {changeRows.map((r) => (
                                    <tr key={r.id} className={applied ? "bm-row--done" : ""}>
                                        <td className="bm-check-col">
                                            <input
                                                type="checkbox"
                                                checked={checked[r.id] !== false}
                                                disabled={applied}
                                                onChange={() => setChecked((p) => ({ ...p, [r.id]: p[r.id] === false }))}
                                                aria-label={`Include ${r.file}`}
                                            />
                                        </td>
                                        <td className="bm-file">
                                            {r.file}
                                            {r.savedAs && <span className="bm-savedas"> → written to {r.savedAs}</span>}
                                        </td>
                                        <td>
                                            <span className="bm-comp">{r.compName}</span>
                                            <span className="bm-dim"> {r.compSize} · {r.compPath}</span>
                                        </td>
                                        <td>
                                            {r.layerName}
                                            {r.sourceSize && <span className="bm-dim"> src {r.sourceSize}</span>}
                                        </td>
                                        <td className="bm-dim">{r.keyIndex === 0 ? "static" : `#${r.keyIndex} @${Math.round(r.keyTime * 100) / 100}s`}</td>
                                        <td className="bm-dim">{fmt(r.current)}</td>
                                        <td className="bm-new">{fmt(r.proposed)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {changeRows.length === 0 && (
                        <div className="bm-empty"><LayersIcon size={13} /> Nothing to change — every match is already at the target value.</div>
                    )}

                    {(sameRows.length > 0 || skipRows.length > 0) && (
                        <details className="bm-details">
                            <summary>{sameRows.length} already correct · {skipRows.length} skipped</summary>
                            {sameRows.concat(skipRows).map((r) => (
                                <div className="bm-skip-row" key={r.id}>
                                    <span className={r.status === "same" ? "bm-tag bm-tag--same" : "bm-tag bm-tag--skip"}>
                                        {r.status === "same" ? "ok" : "skip"}
                                    </span>
                                    <span className="bm-file">{r.file}</span>
                                    {r.compName && <span className="bm-dim"> · {r.compName}</span>}
                                    {r.layerName && <span className="bm-dim"> · {r.layerName}</span>}
                                    {r.note && <span className="bm-note"> — {r.note}</span>}
                                </div>
                            ))}
                        </details>
                    )}
                </div>
            )}
        </div>
    );
};

export default BatchMatchTool;
