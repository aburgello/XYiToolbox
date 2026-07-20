// =============================================================================
// src/js/main/tools/QuickFX.tsx
// -----------------------------------------------------------------------------
// "Effects" -- one-click apply for AE effects to the selected layer(s),
// instead of hunting through AE's own Effects & Presets dropdown/search.
// Three tiers:
//   1. quickFxData.ts's curated 20 (the daily-driver grid, custom groups).
//   2. "My Effects" -- user-pinned effects, persisted via app.settings
//      (quickFxListUserEffects/quickFxAddUserEffect/quickFxRemoveUserEffect).
//   3. EVERYTHING installed -- the search box also matches the full
//      `app.effects` list (every built-in + third-party effect on this
//      machine, fetched once per mount via quickFxListInstalledEffects),
//      and any hit can be applied directly or pinned into My Effects.
// (An earlier version of this header claimed there's no API to enumerate
// installed effects -- wrong, `app.effects` is exactly that; corrected.)
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
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Search, Sparkles, Layers, BookmarkPlus, PencilLine, Trash2, Check, X, Pin,
    History, Upload, Download, ChevronDown, Users,
    Droplets, ArrowRightLeft, Palette, Wand2, Waves,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { fuzzyFilter } from "../lib/fuzzySearch";
import StatusIcon from "../StatusIcon";
import { QUICK_FX, QUICK_FX_CATEGORIES, type QuickFxEntry } from "./quickFxData";
import "../shared.scss";
import "./formTool.scss";
import "./QuickFX.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

interface CapturedProp {
    matchName: string;
    value: unknown;
}

interface ComboEffect {
    matchName: string;
    label: string;
    // The artist's captured settings on this effect (see effects.ts's
    // CapturedProp). Carried through opaquely -- the UI never reads it, it
    // just has to survive the round-trip back to quickFxSaveCombo so the
    // saved combo reproduces the look, not default-valued effects.
    props?: CapturedProp[];
}

interface ComboEntry {
    id: string;
    name: string;
    effects: ComboEffect[];
}

// Mirrors effects.ts's InstalledEffectEntry / QuickFxRecentEntry -- can't
// import ExtendScript-side types across the bridge's two tsconfig worlds,
// same as everywhere else in src/js.
interface InstalledEffect {
    displayName: string;
    matchName: string;
    category: string;
}

interface UserEffect {
    id: string;
    label: string;
    matchName: string;
    category: string;
}

const NO_BRIDGE_MSG = "No CEP bridge detected — open this panel inside After Effects to run it.";

// A caught rejection from evalTS is one of: our own "no bridge" sentinel
// (thrown when the bridge resolves undefined); the raw TypeError CSInterface
// throws with no bridge present (window.__adobe_cep__ undefined -> "Cannot
// read properties of undefined (reading 'evalScript')"); or a genuine
// ExtendScript error object with a real .message. Map the first two to the
// clean bridge message, but surface a REAL failure verbatim so it isn't
// mislabelled "no bridge detected".
const errorMessage = (e: unknown): string => {
    if (e && typeof e === "object" && "message" in e) {
        const msg = String((e as { message: unknown }).message);
        if (msg === "no bridge" || msg.indexOf("evalScript") !== -1) return NO_BRIDGE_MSG;
        return msg || "Something went wrong.";
    }
    return NO_BRIDGE_MSG;
};

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

// One icon per curated category, echoing what the effect DOES, so a pill's
// glyph carries information while scanning instead of every pill wearing the
// same Sparkles. My Effects keeps Pin (its glyph means "you pinned this"),
// installed search hits keep Sparkles (unknown/any category).
const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    "Blur & Sharpen":      Droplets,
    "Transitions & Wipes": ArrowRightLeft,
    "Color":               Palette,
    "Stylize":             Wand2,
    "Distort":             Waves,
};

// Collapsed-section persistence: sessionStorage, not app.settings -- it's a
// per-sitting viewing preference (same tier as GsapScreenTransition's
// last-animated key), not studio data worth a bridge round-trip. try/catch
// because CEF configs can block storage access.
const COLLAPSED_STORE_KEY = "xyi.qfxCollapsedSections";
const loadCollapsed = (): string[] => {
    try {
        const raw = sessionStorage.getItem(COLLAPSED_STORE_KEY);
        return raw ? (JSON.parse(raw) as string[]) : [];
    } catch (e) {
        return [];
    }
};
const storeCollapsed = (sections: string[]) => {
    try {
        sessionStorage.setItem(COLLAPSED_STORE_KEY, JSON.stringify(sections));
    } catch (e) {
        // storage blocked -- collapse still works for this mount
    }
};

interface StatusMsgWithId extends StatusMsg {
    id: number;
}

const QuickFXTool = () => {
    const [query, setQuery] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [status, setStatus] = useState<StatusMsgWithId | null>(null);
    const statusIdRef = React.useRef(0);

    // Fuzzy (fuse.js, shared lib/fuzzySearch helper -- same config as the home
    // search + ⌘K palette) across label/category/matchName, so "gaussain" still
    // finds Gaussian Blur. Empty query returns the full curated list (browse).
    const filtered = useMemo(
        () => fuzzyFilter(QUICK_FX, query, ["label", "category", "matchName"]),
        [query]
    );

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

    // Auto-dismiss the status line a few seconds after it appears, matching
    // the Toolset toast lifetime -- otherwise the last success/error lingers
    // on screen indefinitely. Keyed on status.id so each new message resets
    // the timer (a rapid second apply doesn't get cut short by the first's).
    useEffect(() => {
        if (!status) return;
        const id = setTimeout(() => {
            setStatus((cur) => (cur && cur.id === status.id ? null : cur));
        }, 4000);
        return () => clearTimeout(id);
    }, [status]);

    const [verifying, setVerifying] = useState(false);

    // --- Recently used strip -------------------------------------------
    // Same backend history the Toolset grid's Quick FX droplet reads
    // (quickFxListRecentEffects) -- applying from either place feeds both.
    const [recents, setRecents] = useState<UserEffect[]>([]);

    const refreshRecents = async () => {
        try {
            const result = await evalTS("quickFxListRecentEffects");
            if (result && result.success) setRecents(result.effects || []);
        } catch (e) {
            // silent -- decorative strip, hidden when empty
        }
    };

    useEffect(() => {
        refreshRecents();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Shared by curated pills, My Effects pills, recents, and installed
    // search hits -- they're all just {id, label, matchName, category}
    // shapes feeding the same one generic backend function.
    const applyByMatchName = async (id: string, matchName: string, label: string, category: string) => {
        setBusyId(id);
        setStatus(null);
        try {
            const result = await evalTS("applyEffectToSelectedLayers", id, matchName, label, category);
            if (result === undefined) throw new Error("no bridge");
            showStatus(result.success ? result.message || `${label} applied.` : result.error || "Something went wrong.", result.success ? "success" : "error");
            if (result.success) refreshRecents(); // the backend just recorded it
        } catch (e) {
            showStatus(errorMessage(e), "error");
        } finally {
            setBusyId(null);
        }
    };

    const applyEffect = (fx: QuickFxEntry) => applyByMatchName(fx.id, fx.matchName, fx.label, fx.category);

    // --- Collapsible sections ------------------------------------------
    // A collapsed section stays collapsed per sitting (sessionStorage).
    // Searching overrides collapse -- a query always shows its matches, so
    // keyboard-apply targets are never hidden inside a folded section.
    const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
    const toggleSection = (label: string) => {
        setCollapsed((cur) => {
            const next = cur.indexOf(label) !== -1 ? cur.filter((s) => s !== label) : [...cur, label];
            storeCollapsed(next);
            return next;
        });
    };
    const isCollapsed = (label: string) => query.trim() === "" && collapsed.indexOf(label) !== -1;

    // --- My Effects (user-pinned) + full installed list ----------------
    const [userEffects, setUserEffects] = useState<UserEffect[]>([]);
    const [installedEffects, setInstalledEffects] = useState<InstalledEffect[]>([]);

    // Both load silently in the background on mount, same convention as the
    // combo list below -- browser preview (no bridge) just means an empty
    // My Effects row and search covering only the curated list.
    useEffect(() => {
        (async () => {
            try {
                const result = await evalTS("quickFxListUserEffects");
                if (result && result.success) setUserEffects(result.effects || []);
            } catch (e) {
                // silent -- background load
            }
        })();
        (async () => {
            try {
                const result = await evalTS("quickFxListInstalledEffects");
                if (result && result.success) setInstalledEffects(result.effects || []);
            } catch (e) {
                // silent -- background load
            }
        })();
    }, []);

    const pinEffect = async (fx: InstalledEffect) => {
        try {
            const result = await evalTS("quickFxAddUserEffect", fx.displayName, fx.matchName, fx.category);
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showStatus(result.error || "Something went wrong.", "error");
                return;
            }
            setUserEffects(result.effects || []);
            showStatus(`Pinned "${fx.displayName}" to My Effects.`, "success");
        } catch (e) {
            showStatus(errorMessage(e), "error");
        }
    };

    const unpinEffect = async (fx: UserEffect) => {
        try {
            const result = await evalTS("quickFxRemoveUserEffect", fx.id);
            if (result === undefined) throw new Error("no bridge");
            if (result.success) setUserEffects(result.effects || []);
            else showStatus(result.error || "Something went wrong.", "error");
        } catch (e) {
            showStatus(errorMessage(e), "error");
        }
    };

    // Installed-list search hits: only while searching, deduped against
    // everything already visible as a pill (curated + pinned), capped so a
    // broad query ("blur") doesn't dump hundreds of rows.
    const installedHits = useMemo(() => {
        if (!query.trim() || installedEffects.length === 0) return [];
        const shown = new Set<string>();
        for (const fx of QUICK_FX) shown.add(fx.matchName);
        for (const fx of userEffects) shown.add(fx.matchName);
        // Fuzzy-match across the whole installed registry, then drop anything
        // already visible as a pill and cap so a broad query ("blur") doesn't
        // dump hundreds of rows. Fuse's relevance order is preserved.
        const matched = fuzzyFilter(installedEffects, query, ["displayName", "category"]);
        const hits: InstalledEffect[] = [];
        for (const fx of matched) {
            if (shown.has(fx.matchName)) continue;
            hits.push(fx);
            if (hits.length >= 30) break;
        }
        return hits;
    }, [query, installedEffects, userEffects]);

    const filteredUserEffects = useMemo(
        () => fuzzyFilter(userEffects, query, ["label", "category"]),
        [query, userEffects]
    );

    // --- Keyboard-first apply ------------------------------------------
    // While searching, one flat ordered list of every visible hit (My
    // Effects -> curated -> installed, matching render order top to
    // bottom). Arrow keys move a highlight through it, Enter applies the
    // highlighted one -- so "glo" + Enter applies Glow without touching
    // the mouse, the whole reason this page beats AE's own dropdown.
    interface KbdTarget {
        key: string;
        run: () => void;
    }

    const kbdTargets = useMemo<KbdTarget[]>(() => {
        if (query.trim() === "") return [];
        const targets: KbdTarget[] = [];
        for (const fx of filteredUserEffects) {
            targets.push({ key: fx.id, run: () => applyByMatchName(fx.id, fx.matchName, fx.label, fx.category) });
        }
        for (const fx of filtered) {
            targets.push({ key: fx.id, run: () => applyEffect(fx) });
        }
        for (const fx of installedHits) {
            targets.push({ key: "inst-" + fx.matchName, run: () => applyByMatchName("inst-" + fx.matchName, fx.matchName, fx.displayName, fx.category) });
        }
        return targets;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, filteredUserEffects, filtered, installedHits]);

    const [kbdIndex, setKbdIndex] = useState(0);
    useEffect(() => setKbdIndex(0), [query]);
    const kbdActiveKey = kbdTargets.length > 0 ? kbdTargets[Math.min(kbdIndex, kbdTargets.length - 1)].key : null;

    // Keep the highlighted hit on screen as arrows move it through a long
    // result list.
    useEffect(() => {
        if (!kbdActiveKey) return;
        const el = document.querySelector(".qfx-kbd-active");
        if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    }, [kbdActiveKey]);

    const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (kbdTargets.length === 0) {
            if (e.key === "Escape") setQuery("");
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setKbdIndex((i) => Math.min(i + 1, kbdTargets.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setKbdIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            kbdTargets[Math.min(kbdIndex, kbdTargets.length - 1)].run();
        } else if (e.key === "Escape") {
            setQuery("");
        }
    };

    const kbdClass = (key: string, base: string) => (kbdActiveKey === key ? base + " qfx-kbd-active" : base);

    // One-off self-check: membership check against app.effects (AE's own
    // installed-effects registry -- instant, nothing touched in the project,
    // no layer/selection needed). Covers the curated list (passed in, so
    // quickFxData.ts stays the source of truth) PLUS the backend's own
    // persisted My Effects and combos -- those are the real staleness risk
    // now (a pinned/recorded third-party effect whose plugin got
    // uninstalled); a curated miss means correcting that matchName string in
    // quickFxData.ts (see that file's "how to find a real matchName" note).
    const verifyMatchNames = async () => {
        setVerifying(true);
        setStatus(null);
        try {
            const entries = QUICK_FX.map((fx) => ({ id: fx.id, label: fx.label, matchName: fx.matchName }));
            const result = (await evalTS("quickFxVerifyMatchNames", JSON.stringify(entries))) as
                | (StatusMsg & { success: boolean; message?: string; error?: string; bad?: { label: string }[] })
                | undefined;
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showStatus(result.error || "Something went wrong.", "error");
                return;
            }
            const clean = !result.bad || result.bad.length === 0;
            showStatus(result.message || (clean ? "All effects available." : "Some effects unavailable."), clean ? "success" : "error");
        } catch (e) {
            showStatus(errorMessage(e), "error");
        } finally {
            setVerifying(false);
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
            // The backend's EffectComboEffect is structurally the frontend's
            // ComboEffect (matchName/label/props); cast across the bridge's own
            // type world and default the "no effects" case to null for state.
            setPendingEffects((result.effects as ComboEffect[] | undefined) ?? null);
            setComboNameDraft(result.layerName ? `${result.layerName} Combo` : "");
        } catch (e) {
            showStatus(errorMessage(e), "error");
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
            showStatus(errorMessage(e), "error");
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
            showStatus(errorMessage(e), "error");
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
            showStatus(errorMessage(e), "error");
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
            showStatus(errorMessage(e), "error");
        }
    };

    // One-click "share to team" -- pushes a single combo into the team
    // folder's shared-combos.json (aeft/team.ts), from which every
    // colleague's panel pulls automatically on open (teamSyncShared). The
    // file-dialog export/import below stays as the fallback for anyone
    // without a team folder configured.
    const shareCombo = async (combo: ComboEntry) => {
        try {
            const result = await evalTS("teamShareCombo", combo.id);
            if (result === undefined) throw new Error("no bridge");
            showStatus(result.success ? result.message || "Shared." : result.error || "Something went wrong.", result.success ? "success" : "error");
        } catch (e) {
            showStatus(errorMessage(e), "error");
        }
    };

    // Export/import move combos through a .json file (the studio NAS being
    // the natural home) so a recorded look can be shared across machines --
    // app.settings is per-machine. message === "" means the user cancelled
    // the file dialog: show nothing, same convention as My Tools' sharing.
    const exportCombos = async () => {
        try {
            const result = await evalTS("quickFxExportCombos");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) showStatus(result.error || "Something went wrong.", "error");
            else if (result.message) showStatus(result.message, "success");
        } catch (e) {
            showStatus(errorMessage(e), "error");
        }
    };

    const importCombos = async () => {
        try {
            const result = await evalTS("quickFxImportCombos");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                showStatus(result.error || "Something went wrong.", "error");
                return;
            }
            if (result.combos) setCombos(result.combos);
            if (result.message) showStatus(result.message, "success");
        } catch (e) {
            showStatus(errorMessage(e), "error");
        }
    };

    return (
        <div className="form-tool qfx-tool">
            <label className="qfx-search">
                <Search size={13} />
                <input
                    type="text"
                    autoFocus
                    placeholder="Search effects — Enter applies the highlighted one…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                />
            </label>

            {recents.length > 0 && !query.trim() && (
                <div className="qfx-recents">
                    <span className="qfx-recents-label"><History size={11} /> Recent</span>
                    {recents.map((fx) => (
                        <button
                            key={fx.id}
                            type="button"
                            className="qfx-recent-pill"
                            disabled={busyId === fx.id}
                            title={fx.category || fx.matchName}
                            onClick={() => applyByMatchName(fx.id, fx.matchName, fx.label, fx.category)}
                        >
                            {fx.label}
                        </button>
                    ))}
                </div>
            )}

            <div className="qfx-combos">
                <div className="qfx-combos-header">
                    <span className="qfx-section-label qfx-section-label--combos">My Combos</span>
                    {!pendingEffects && (
                        <div className="qfx-combos-actions">
                            {combos.length > 0 && (
                                <button type="button" className="qfx-transfer-btn" title="Export combos to a shareable .json (e.g. on the NAS)" onClick={exportCombos}>
                                    <Upload size={12} />
                                </button>
                            )}
                            <button type="button" className="qfx-transfer-btn" title="Import combos from a shared .json" onClick={importCombos}>
                                <Download size={12} />
                            </button>
                            <button type="button" className="qfx-record-btn" disabled={capturing} onClick={startRecordCombo}>
                                <BookmarkPlus size={13} />
                                {capturing ? "Reading layer…" : "Record Combo"}
                            </button>
                        </div>
                    )}
                </div>

                {pendingEffects && (
                    <div className="qfx-combo-save-row">
                        <span className="qfx-combo-save-hint">
                            {pendingEffects.length} effect{pendingEffects.length === 1 ? "" : "s"} + settings captured
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
                    <p className="hint">No combos yet — set up a layer's effects the way you like them, select it, and click "Record Combo" to save the whole stack <em>with its settings</em> for one-click re-use.</p>
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
                                        disabled={comboBusyId === combo.id}
                                        title={combo.effects.map((e) => e.label).join(", ")}
                                        onClick={() => applyCombo(combo)}
                                    >
                                        <Layers size={13} />
                                        {combo.name}
                                        <span className="qfx-combo-count">{combo.effects.length}</span>
                                    </button>
                                    <button type="button" className="qfx-combo-icon-btn" title="Share to team library" onClick={() => shareCombo(combo)}>
                                        <Users size={12} />
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
                {filtered.length === 0 && filteredUserEffects.length === 0 && installedHits.length === 0 && (
                    <p className="hint">No effects match "{query}".</p>
                )}

                {filteredUserEffects.length > 0 && (
                    <div className="qfx-section" style={{ "--qfx-accent": "#facc15", "--qfx-glow": "rgba(250, 204, 21, 0.3)" } as React.CSSProperties}>
                        <button type="button" className="qfx-section-label qfx-section-toggle" onClick={() => toggleSection("My Effects")}>
                            My Effects
                            <ChevronDown size={12} className={isCollapsed("My Effects") ? "qfx-chevron qfx-chevron--closed" : "qfx-chevron"} />
                        </button>
                        {!isCollapsed("My Effects") && (
                            <div className="qfx-grid">
                                {filteredUserEffects.map((fx) => (
                                    <span key={fx.id} className="qfx-pill-wrap">
                                        <button
                                            className={kbdClass(fx.id, "qfx-pill")}
                                            disabled={busyId === fx.id}
                                            title={fx.category ? `${fx.category} — ${fx.matchName}` : fx.matchName}
                                            onClick={() => applyByMatchName(fx.id, fx.matchName, fx.label, fx.category)}
                                        >
                                            <Pin size={13} className="qfx-pill-icon" />
                                            {fx.label}
                                        </button>
                                        <button type="button" className="qfx-unpin-btn" title="Remove from My Effects" onClick={() => unpinEffect(fx)}>
                                            <X size={11} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {QUICK_FX_CATEGORIES.map((category, i) => {
                    const entries = grouped.get(category);
                    if (!entries || entries.length === 0) return null;
                    const accent = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
                    const CatIcon = CATEGORY_ICONS[category] || Sparkles;
                    return (
                        <div key={category} className="qfx-section" style={{ "--qfx-accent": accent.border, "--qfx-glow": accent.glow } as React.CSSProperties}>
                            <button type="button" className="qfx-section-label qfx-section-toggle" onClick={() => toggleSection(category)}>
                                {category}
                                <ChevronDown size={12} className={isCollapsed(category) ? "qfx-chevron qfx-chevron--closed" : "qfx-chevron"} />
                            </button>
                            {!isCollapsed(category) && (
                                <div className="qfx-grid">
                                    {entries.map((fx) => (
                                        <button
                                            key={fx.id}
                                            className={kbdClass(fx.id, "qfx-pill")}
                                            disabled={busyId === fx.id}
                                            onClick={() => applyEffect(fx)}
                                        >
                                            <CatIcon size={13} className="qfx-pill-icon" />
                                            {fx.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

                {installedHits.length > 0 && (
                    <div className="qfx-section" style={{ "--qfx-accent": "#94a3b8", "--qfx-glow": "rgba(148, 163, 184, 0.3)" } as React.CSSProperties}>
                        <span className="qfx-section-label">All Installed Effects</span>
                        <div className="qfx-installed-list">
                            {installedHits.map((fx) => (
                                <div key={fx.matchName} className="qfx-installed-row">
                                    <button
                                        type="button"
                                        className={kbdClass("inst-" + fx.matchName, "qfx-installed-apply")}
                                        disabled={busyId === "inst-" + fx.matchName}
                                        title={fx.matchName}
                                        onClick={() => applyByMatchName("inst-" + fx.matchName, fx.matchName, fx.displayName, fx.category)}
                                    >
                                        <Sparkles size={12} />
                                        <span className="qfx-installed-name">{fx.displayName}</span>
                                        {fx.category && <span className="qfx-installed-cat">{fx.category}</span>}
                                    </button>
                                    <button type="button" className="qfx-combo-icon-btn" title="Pin to My Effects" onClick={() => pinEffect(fx)}>
                                        <Pin size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {query.trim() !== "" && installedEffects.length === 0 && (
                    <p className="hint">Searching the curated list only — the full installed-effects list needs the panel open inside After Effects.</p>
                )}

                {!query && (
                    <button type="button" className="qfx-verify-btn" disabled={verifying} onClick={verifyMatchNames}>
                        <Check size={12} />
                        {verifying ? "Checking…" : "Check effects on this machine"}
                    </button>
                )}
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
