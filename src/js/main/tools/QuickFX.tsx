// =============================================================================
// src/js/main/tools/QuickFX.tsx
// -----------------------------------------------------------------------------
// "Effects" -- one-click apply for a curated list of AE effects to the
// selected layer(s), instead of hunting through AE's own Effects & Presets
// dropdown/search. NOT a full replacement of that panel -- there's no
// ExtendScript API to enumerate every installed effect (built-in + every
// third-party plugin), so this only ever covers what's in quickFxData.ts's
// curated list. It's meant to cover the effects actually reached for daily
// (search box + categories below), not to be a 1:1 clone of AE's own browser.
//
// Backend: aeft/effects.ts's applyEffectToSelectedLayers(matchName, label) --
// one generic function, not one per effect; the curated id/label/matchName/
// category list here is pure data, same "generic action + data-driven list"
// split as Toolset.tsx's ACTIONS array.
//
// Also hosts "My Combos" -- user-recorded multi-effect presets (record
// whatever's currently stacked on a selected layer, name it, re-apply the
// whole stack elsewhere in one click). Distinct from the curated list above:
// combos are user-authored, can bundle several effects at once, and persist
// via aeft/effects.ts's quickFx*Combo* functions (own "Combo effects"
// section in that file).
// =============================================================================
import React, { useEffect, useMemo, useState } from "react";
import { Search, Sparkles, Layers, BookmarkPlus, PencilLine, Trash2, Check, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import { QUICK_FX, QUICK_FX_CATEGORIES, type QuickFxEntry } from "./quickFxData";
import "../shared.scss";
import "./formTool.scss";
import "./QuickFX.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

interface ComboEffect {
    matchName: string;
    label: string;
}

interface ComboEntry {
    id: string;
    name: string;
    effects: ComboEffect[];
}

const NO_BRIDGE_MSG = "No CEP bridge detected — open this panel inside After Effects to run it.";

// Pre-blended hex values (not color-mix() -- unsupported on this project's
// chrome74 build target, same reasoning as Toolset.tsx's own PALETTE).
// Cycles by category index -- purely a "find this section by colour"
// scanning aid, independent of the page's own Tools-pink category accent
// (--cat-* vars, inherited from the drill-body wrapper) which stays for
// the page chrome (search focus ring, etc.).
const CATEGORY_PALETTE: { border: string; glow: string }[] = [
    { border: "#2dd4bf", glow: "rgba(45, 212, 191, 0.3)" },   // Blur & Sharpen -- teal
    { border: "#60a5fa", glow: "rgba(96, 165, 250, 0.3)" },   // Transitions & Wipes -- blue
    { border: "#fb923c", glow: "rgba(251, 146, 60, 0.3)" },   // Color -- orange
    { border: "#f472b6", glow: "rgba(244, 114, 182, 0.3)" },  // Stylize -- pink
    { border: "#a78bfa", glow: "rgba(167, 139, 250, 0.3)" },  // Distort -- purple
];

interface StatusMsgWithId extends StatusMsg {
    id: number;
}

const QuickFXTool = () => {
    const [query, setQuery] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [status, setStatus] = useState<StatusMsgWithId | null>(null);
    const statusIdRef = React.useRef(0);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return QUICK_FX;
        return QUICK_FX.filter((fx) => fx.label.toLowerCase().indexOf(q) !== -1 || fx.category.toLowerCase().indexOf(q) !== -1);
    }, [query]);

    const grouped = useMemo(() => {
        const map = new Map<string, QuickFxEntry[]>();
        for (const fx of filtered) {
            if (!map.has(fx.category)) map.set(fx.category, []);
            map.get(fx.category)!.push(fx);
        }
        return map;
    }, [filtered]);

    const showStatus = (text: string, type: "success" | "error") => {
        setStatus({ id: ++statusIdRef.current, text, type });
    };

    const applyEffect = async (fx: QuickFxEntry) => {
        setBusyId(fx.id);
        setStatus(null);
        try {
            const result = await evalTS("applyEffectToSelectedLayers", fx.id, fx.matchName, fx.label, fx.category);
            if (result === undefined) throw new Error("no bridge");
            showStatus(result.success ? result.message || `${fx.label} applied.` : result.error || "Something went wrong.", result.success ? "success" : "error");
        } catch (e) {
            showStatus(NO_BRIDGE_MSG, "error");
        } finally {
            setBusyId(null);
        }
    };

    // --- My Combos -----------------------------------------------------
    const [combos, setCombos] = useState<ComboEntry[]>([]);
    const [comboBusyId, setComboBusyId] = useState<string | null>(null);
    const [capturing, setCapturing] = useState(false);
    const [pendingEffects, setPendingEffects] = useState<ComboEffect[] | null>(null);
    const [comboNameDraft, setComboNameDraft] = useState("");
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState("");

    // Background load, same "silent on failure" convention as tool-order/
    // favorites elsewhere in this app -- an un-loaded combo list (browser
    // preview, or a real bridge hiccup) just means an empty section, not
    // something worth a toast for.
    useEffect(() => {
        (async () => {
            try {
                const result = await evalTS("quickFxListCombos");
                if (result && result.success) setCombos(result.combos || []);
            } catch (e) {
                // silent -- background load
            }
        })();
    }, []);

    const startRecordCombo = async () => {
        setCapturing(true);
        setStatus(null);
        try {
            const result = await evalTS("quickFxGetSelectedLayerEffects");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showStatus(result.error || "Something went wrong.", "error");
                return;
            }
            setPendingEffects(result.effects);
            setComboNameDraft(result.layerName ? `${result.layerName} Combo` : "");
        } catch (e) {
            showStatus(NO_BRIDGE_MSG, "error");
        } finally {
            setCapturing(false);
        }
    };

    const cancelRecordCombo = () => {
        setPendingEffects(null);
        setComboNameDraft("");
    };

    const confirmRecordCombo = async () => {
        if (!pendingEffects) return;
        const name = comboNameDraft.trim() || "Untitled Combo";
        try {
            const result = await evalTS("quickFxSaveCombo", name, JSON.stringify(pendingEffects));
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showStatus(result.error || "Something went wrong.", "error");
                return;
            }
            setCombos(result.combos || []);
            setPendingEffects(null);
            setComboNameDraft("");
            showStatus(`Saved "${name}" as a combo.`, "success");
        } catch (e) {
            showStatus(NO_BRIDGE_MSG, "error");
        }
    };

    const applyCombo = async (combo: ComboEntry) => {
        setComboBusyId(combo.id);
        setStatus(null);
        try {
            const result = await evalTS("quickFxApplyCombo", combo.id);
            if (result === undefined) throw new Error("no bridge");
            showStatus(result.success ? result.message || `${combo.name} applied.` : result.error || "Something went wrong.", result.success ? "success" : "error");
        } catch (e) {
            showStatus(NO_BRIDGE_MSG, "error");
        } finally {
            setComboBusyId(null);
        }
    };

    const startRenameCombo = (combo: ComboEntry) => {
        setRenamingId(combo.id);
        setRenameDraft(combo.name);
    };

    const cancelRenameCombo = () => setRenamingId(null);

    const confirmRenameCombo = async () => {
        if (!renamingId) return;
        const name = renameDraft.trim() || "Untitled Combo";
        try {
            const result = await evalTS("quickFxRenameCombo", renamingId, name);
            if (result === undefined) throw new Error("no bridge");
            if (result.success) setCombos(result.combos || []);
            else showStatus(result.error || "Something went wrong.", "error");
        } catch (e) {
            showStatus(NO_BRIDGE_MSG, "error");
        } finally {
            setRenamingId(null);
        }
    };

    const deleteCombo = async (combo: ComboEntry) => {
        try {
            const result = await evalTS("quickFxDeleteCombo", combo.id);
            if (result === undefined) throw new Error("no bridge");
            if (result.success) setCombos(result.combos || []);
            else showStatus(result.error || "Something went wrong.", "error");
        } catch (e) {
            showStatus(NO_BRIDGE_MSG, "error");
        }
    };

    return (
        <div className="form-tool qfx-tool">
            <label className="qfx-search">
                <Search size={13} />
                <input
                    type="text"
                    placeholder="Search effects…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </label>

            <div className="qfx-combos">
                <div className="qfx-combos-header">
                    <span className="qfx-section-label qfx-section-label--combos">My Combos</span>
                    {!pendingEffects && (
                        <button type="button" className="qfx-record-btn" disabled={capturing} onClick={startRecordCombo}>
                            <BookmarkPlus size={13} />
                            {capturing ? "Reading layer…" : "Record Combo"}
                        </button>
                    )}
                </div>

                {pendingEffects && (
                    <div className="qfx-combo-save-row">
                        <span className="qfx-combo-save-hint">
                            {pendingEffects.length} effect{pendingEffects.length === 1 ? "" : "s"} captured
                        </span>
                        <input
                            type="text"
                            autoFocus
                            placeholder="Combo name…"
                            value={comboNameDraft}
                            onChange={(e) => setComboNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") confirmRecordCombo();
                                if (e.key === "Escape") cancelRecordCombo();
                            }}
                        />
                        <button type="button" className="qfx-combo-icon-btn" title="Save" onClick={confirmRecordCombo}>
                            <Check size={14} />
                        </button>
                        <button type="button" className="qfx-combo-icon-btn" title="Cancel" onClick={cancelRecordCombo}>
                            <X size={14} />
                        </button>
                    </div>
                )}

                {combos.length === 0 && !pendingEffects && (
                    <p className="hint">No combos yet — select a layer with effects applied and click "Record Combo".</p>
                )}

                {combos.length > 0 && (
                    <div className="qfx-combo-grid">
                        {combos.map((combo) =>
                            renamingId === combo.id ? (
                                <div key={combo.id} className="qfx-combo-rename-row">
                                    <input
                                        type="text"
                                        autoFocus
                                        value={renameDraft}
                                        onChange={(e) => setRenameDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") confirmRenameCombo();
                                            if (e.key === "Escape") cancelRenameCombo();
                                        }}
                                    />
                                    <button type="button" className="qfx-combo-icon-btn" title="Save" onClick={confirmRenameCombo}>
                                        <Check size={14} />
                                    </button>
                                    <button type="button" className="qfx-combo-icon-btn" title="Cancel" onClick={cancelRenameCombo}>
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div key={combo.id} className="qfx-combo-pill">
                                    <button
                                        type="button"
                                        className="qfx-combo-pill-main"
                                        disabled={comboBusyId !== null}
                                        title={combo.effects.map((e) => e.label).join(", ")}
                                        onClick={() => applyCombo(combo)}
                                    >
                                        <Layers size={13} />
                                        {combo.name}
                                        <span className="qfx-combo-count">{combo.effects.length}</span>
                                    </button>
                                    <button type="button" className="qfx-combo-icon-btn" title="Rename" onClick={() => startRenameCombo(combo)}>
                                        <PencilLine size={12} />
                                    </button>
                                    <button type="button" className="qfx-combo-icon-btn" title="Delete" onClick={() => deleteCombo(combo)}>
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            )
                        )}
                    </div>
                )}
            </div>

            <div className="qfx-list">
                {filtered.length === 0 && <p className="hint">No effects match "{query}".</p>}

                {QUICK_FX_CATEGORIES.map((category, i) => {
                    const entries = grouped.get(category);
                    if (!entries || entries.length === 0) return null;
                    const accent = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
                    return (
                        <div key={category} className="qfx-section" style={{ "--qfx-accent": accent.border, "--qfx-glow": accent.glow } as React.CSSProperties}>
                            <span className="qfx-section-label">{category}</span>
                            <div className="qfx-grid">
                                {entries.map((fx) => (
                                    <button
                                        key={fx.id}
                                        className="qfx-pill"
                                        disabled={busyId !== null}
                                        onClick={() => applyEffect(fx)}
                                    >
                                        <Sparkles size={13} className="qfx-pill-icon" />
                                        {fx.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {status && (
                <div className={`tool-status tool-status-${status.type}`} key={status.id}>
                    <StatusIcon type={status.type} />
                    <span style={{ whiteSpace: "pre-wrap" }}>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default QuickFXTool;
