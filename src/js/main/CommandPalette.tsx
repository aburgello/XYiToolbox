// =============================================================================
// src/js/main/CommandPalette.tsx
// -----------------------------------------------------------------------------
// Global quick-open: Ctrl/Cmd+K (or the floating button, bottom-right,
// visible on every screen) opens a searchable list of every TOOLS entry
// (+ their inner actions) AND every Toolset one-click ACTIONS entry, in one
// place, reachable from anywhere -- Home, a category page, or a tool's own
// page.
//
// This fills a real gap, not a hypothetical one: HomeScreen.tsx already has
// its own search box, but it only exists ON the home screen, only searches
// TOOLS (dedicated tool pages), and doesn't know about Toolset.tsx's ~19
// one-click grid buttons at all -- there was previously no way to search
// for "Turk It" or "Frontcard" from anywhere, home included. This is a
// superset: same substring-match convention HomeScreen's search already
// uses (no fuzzy-scoring library, consistent with this codebase's existing
// simplicity), extended to cover Toolset actions and to work from any
// screen via a module-independent global keydown listener.
//
// Selecting a TOOLS hit navigates (same auto-action mechanism main.tsx
// already has for HomeScreen's search) with `backTo` set to whatever
// screen the palette was opened from -- not hardcoded to home, since this
// can now be opened from a category or tool page too. Selecting a Toolset
// ACTIONS hit runs it in place (no navigation needed, its `run()` is
// already self-contained) and shows an inline result before auto-closing,
// mirroring ToolsetTool's own toast pattern without needing a new
// app-wide toast system.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, CornerDownLeft, ArrowUpDown, Terminal } from "lucide-react";
import { TOOLS, categoryStyleVars, type ToolEntry } from "./toolRegistry";
import { ACTIONS, customButtonToAction, type ActionEntry } from "./tools/Toolset";
import { useFavorites, favoriteKey } from "./hooks/useFavorites";
import { useCustomTools, type CustomToolEntry } from "./hooks/useCustomTools";
import StatusIcon from "./StatusIcon";
import Tooltip from "./Tooltip";
import type { Screen } from "./main";
import "./CommandPalette.scss";

// Module-level singleton: lets PaletteTrigger (rendered inline in drill
// screens) open the same palette instance. Same pattern as Dialog.tsx's
// dialog singleton -- no context provider needed across the app shell.
let _openPalette: (() => void) | null = null;
export const triggerPalette = () => _openPalette?.();

type Hit =
    | { kind: "tool"; key: string; tool: ToolEntry; matchedAction?: string }
    | { kind: "action"; key: string; action: ActionEntry }
    // A "page"-kind custom tool (Script Playground's My Tools list) --
    // deliberately its own Hit kind, not a "tool" hit pointing at the
    // my-tools ToolEntry with matchedAction set to the script's name: a
    // "tool" hit's matchedAction drives main.tsx's auto-click-that-button
    // mechanism, and running an arbitrary saved script sight-unseen off a
    // single search selection is a bigger leap than auto-clicking a known
    // static button -- this always just navigates to My Tools, never runs.
    | { kind: "custom-page"; key: string; entry: CustomToolEntry };

interface Props {
    screen: Screen;
    onNavigate: (screen: Screen) => void;
}

const CommandPalette: React.FC<Props> = ({ screen, onNavigate }) => {
    const { favoriteEntries } = useFavorites(TOOLS);
    const { customTools } = useCustomTools();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [running, setRunning] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    // Synchronous re-entrancy guard for runAction -- `running` (React
    // state) is what the UI reads to render the "Running…" state, but it's
    // not safe to gate a real side-effecting call on: state updates are
    // batched/async, so two keydown events arriving close together (StrictMode's
    // dev-only double-invoke, an errant duplicate listener, or just a fast
    // double-click) can both read `running` as still-null before the first
    // call's setRunning has flushed, and both proceed. A ref updates
    // immediately, so the second call always sees the guard set by the
    // first regardless of React's render timing. This matters here
    // specifically because these actions have real side effects in AE
    // (e.g. "Turk It" bumping version numbers) -- running one twice from a
    // single selection would be a real, visible bug, not just a UI glitch.
    const runningRef = useRef(false);

    // Register module-level opener so PaletteTrigger components rendered
    // elsewhere (drill screen headers) can open this same palette instance.
    useEffect(() => {
        _openPalette = () => setOpen(true);
        return () => { _openPalette = null; };
    }, []);

    // Always mounted regardless of open state -- this is what makes the
    // shortcut work from every screen, not just while some particular
    // component happens to be on-screen (see HomeScreen.tsx's own Cmd/
    // Ctrl+F handler for the pattern this is modeled on, generalized to
    // the whole app instead of one screen).
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setOpen((v) => !v);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    useEffect(() => {
        if (!open) return;
        setQuery("");
        setSelectedIndex(0);
        setRunning(null);
        setOutcome(null);
        // Autofocus after the entrance animation starts mounting, not
        // synchronously -- the input isn't in the DOM yet on the same tick
        // this effect fires.
        const id = requestAnimationFrame(() => inputRef.current?.focus());
        return () => cancelAnimationFrame(id);
    }, [open]);

    const hits = useMemo<Hit[]>(() => {
        const q = query.trim().toLowerCase();

        if (!q) {
            // Empty query: surface favorites (reuses the same favorites this
            // app already has via the home screen's star icon) rather than
            // showing nothing, or dumping all ~44 entries unranked.
            return favoriteEntries.map(({ tool, action }) => ({
                kind: "tool" as const,
                key: tool.id + (action ? ":" + action : ""),
                tool,
                matchedAction: action,
            }));
        }

        // Ranked so a whole-tool match ("localised library") outranks a
        // one-click action LABEL match, which outranks a buried inner-action
        // match ("trott 2.0"), which outranks an action matched only via its
        // description text (e.g. "check" matching Scale Fit's description
        // mentioning "checkbox effect") -- that last tier is deliberately
        // last, not excluded: still findable for someone searching by what
        // a button DOES, just not competing with an obvious label match for
        // the top slot where it'd look unexplained.
        const toolNameHits: Hit[] = TOOLS.filter((t) => t.label.toLowerCase().includes(q)).map((t) => ({
            kind: "tool",
            key: t.id,
            tool: t,
        }));
        const actionLabelHits: Hit[] = ACTIONS.filter((a) => a.label.toLowerCase().includes(q)).map((a) => ({
            kind: "action" as const,
            key: "toolset:" + a.id,
            action: a,
        }));
        const innerActionHits: Hit[] = TOOLS.flatMap((t) =>
            (t.actions || [])
                .filter((a) => a.toLowerCase().includes(q) && !t.label.toLowerCase().includes(q))
                .map((a) => ({ kind: "tool" as const, key: t.id + ":" + a, tool: t, matchedAction: a }))
        );
        const actionDescriptionHits: Hit[] = ACTIONS.filter(
            (a) => !a.label.toLowerCase().includes(q) && a.description.toLowerCase().includes(q)
        ).map((a) => ({ kind: "action" as const, key: "toolset:" + a.id, action: a }));

        // Custom tools (Script Playground's "Save as Tool...") slot into the
        // same two tiers their real counterparts use: a "button"-kind one
        // reads and runs exactly like an ACTIONS entry, a "page"-kind one
        // reads like a tool but always navigates to My Tools (see the Hit
        // type's own comment for why it never auto-runs).
        const customButtonTools = customTools.filter((t) => t.kind === "button");
        const customPageTools = customTools.filter((t) => t.kind === "page");
        const customButtonLabelHits: Hit[] = customButtonTools
            .filter((t) => t.name.toLowerCase().includes(q))
            .map((t) => ({ kind: "action" as const, key: "custom:" + t.id, action: customButtonToAction(t) }));
        const customPageLabelHits: Hit[] = customPageTools
            .filter((t) => t.name.toLowerCase().includes(q))
            .map((t) => ({ kind: "custom-page" as const, key: "custompage:" + t.id, entry: t }));
        const customButtonDescriptionHits: Hit[] = customButtonTools
            .filter((t) => !t.name.toLowerCase().includes(q) && t.description.toLowerCase().includes(q))
            .map((t) => ({ kind: "action" as const, key: "custom:" + t.id, action: customButtonToAction(t) }));
        const customPageDescriptionHits: Hit[] = customPageTools
            .filter((t) => !t.name.toLowerCase().includes(q) && t.description.toLowerCase().includes(q))
            .map((t) => ({ kind: "custom-page" as const, key: "custompage:" + t.id, entry: t }));

        return [
            ...toolNameHits, ...actionLabelHits, ...customButtonLabelHits, ...customPageLabelHits,
            ...innerActionHits, ...actionDescriptionHits, ...customButtonDescriptionHits, ...customPageDescriptionHits,
        ];
    }, [query, favoriteEntries, customTools]);

    // Keep the highlighted row in view when navigating by keyboard past the
    // edge of the scrollable list.
    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const el = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    const close = () => setOpen(false);

    const runAction = async (action: ActionEntry) => {
        if (runningRef.current) return;
        runningRef.current = true;
        setRunning(action.label);
        let cancelled = false;
        try {
            const result = await action.run();
            if (result === null) {
                // User cancelled a picker dialog (e.g. Toggle By Label's color
                // choice) before anything ran -- drop back to the search list
                // instead of closing the whole palette, same as cancelling a
                // Toolset grid button's own picker just leaves that tile as-is.
                cancelled = true;
            } else if (result === undefined) {
                setOutcome({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
            } else {
                setOutcome({
                    text: result.success ? action.successText(result) : result.error || "Something went wrong.",
                    type: result.success ? "success" : "error",
                });
            }
        } finally {
            setRunning(null);
            runningRef.current = false;
        }
        if (!cancelled) setTimeout(close, 1600);
    };

    const selectHit = (hit: Hit) => {
        if (hit.kind === "tool") {
            onNavigate({ type: "tool", toolId: hit.tool.id, backTo: screen, autoAction: hit.matchedAction });
            close();
        } else if (hit.kind === "custom-page") {
            onNavigate({ type: "tool", toolId: "my-tools", backTo: screen });
            close();
        } else {
            runAction(hit.action);
        }
    };

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (running || outcome) {
                if (e.key === "Escape") close();
                return;
            }
            if (e.key === "Escape") { close(); return; }
            if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, hits.length - 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
            if (e.key === "Enter") {
                e.preventDefault();
                const hit = hits[selectedIndex];
                if (hit) selectHit(hit);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, hits, selectedIndex, running, outcome]);

    return (
        <>
            <AnimatePresence>
                {open && (
                    <motion.div
                        className="palette-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        onClick={close}
                    >
                        <motion.div
                            className="palette-card"
                            initial={{ opacity: 0, scale: 0.97, y: -8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98, y: -4 }}
                            transition={{ type: "spring", stiffness: 460, damping: 34 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {running || outcome ? (
                                <div className="palette-status">
                                    {running ? (
                                        <>
                                            <span className="palette-status-spinner" />
                                            <span>Running {running}…</span>
                                        </>
                                    ) : (
                                        outcome && (
                                            <>
                                                <StatusIcon type={outcome.type} size={16} />
                                                <span>{outcome.text}</span>
                                            </>
                                        )
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div className="palette-input-row">
                                        <Search size={14} />
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            placeholder="Search tools and actions…"
                                            value={query}
                                            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
                                        />
                                        <span className="palette-kbd">esc</span>
                                    </div>

                                    <div className="palette-list" ref={listRef}>
                                        {!query && favoriteEntries.length === 0 && (
                                            <p className="palette-hint">
                                                Type to search every tool and one-click action — or star a tool from search
                                                results to see it here first.
                                            </p>
                                        )}
                                        {query && hits.length === 0 && <p className="palette-hint">No matches for "{query}".</p>}
                                        {!query && favoriteEntries.length > 0 && <p className="palette-section-label">Favorites</p>}

                                        {hits.map((hit, index) => {
                                            const isSelected = index === selectedIndex;
                                            if (hit.kind === "tool") {
                                                const Icon = hit.tool.icon;
                                                return (
                                                    <div
                                                        key={hit.key}
                                                        data-index={index}
                                                        className={isSelected ? "palette-row selected" : "palette-row"}
                                                        style={categoryStyleVars(hit.tool.categories[0])}
                                                        onMouseEnter={() => setSelectedIndex(index)}
                                                        onClick={() => selectHit(hit)}
                                                    >
                                                        <Icon size={14} />
                                                        <span className="palette-row-label">
                                                            {hit.matchedAction || hit.tool.label}
                                                            {hit.matchedAction && <small>in {hit.tool.label}</small>}
                                                        </span>
                                                        {isSelected && <CornerDownLeft size={12} className="palette-row-enter" />}
                                                    </div>
                                                );
                                            }
                                            if (hit.kind === "custom-page") {
                                                return (
                                                    <div
                                                        key={hit.key}
                                                        data-index={index}
                                                        className={isSelected ? "palette-row selected" : "palette-row"}
                                                        onMouseEnter={() => setSelectedIndex(index)}
                                                        onClick={() => selectHit(hit)}
                                                    >
                                                        <Terminal size={14} />
                                                        <span className="palette-row-label">
                                                            {hit.entry.name}
                                                            <small>in My Tools</small>
                                                        </span>
                                                        {isSelected && <CornerDownLeft size={12} className="palette-row-enter" />}
                                                    </div>
                                                );
                                            }
                                            const Icon = hit.action.icon;
                                            return (
                                                <div
                                                    key={hit.key}
                                                    data-index={index}
                                                    className={isSelected ? "palette-row selected action" : "palette-row action"}
                                                    onMouseEnter={() => setSelectedIndex(index)}
                                                    onClick={() => selectHit(hit)}
                                                >
                                                    <Icon size={14} />
                                                    <span className="palette-row-label">
                                                        {hit.action.label}
                                                        <small>one-click action</small>
                                                    </span>
                                                    {isSelected && <CornerDownLeft size={12} className="palette-row-enter" />}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="palette-footer">
                                        <span><ArrowUpDown size={11} /> navigate</span>
                                        <span><CornerDownLeft size={11} /> select</span>
                                        <span>esc close</span>
                                    </div>
                                </>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

/** Standalone trigger button -- rendered inline in each screen's header. */
export const PaletteTrigger: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <Tooltip text="Search everywhere (Ctrl/Cmd+K)">
        <button className="palette-trigger" onClick={onClick}>
            <Search size={13} />
            <span className="palette-trigger-kbd">⌘K</span>
        </button>
    </Tooltip>
);

export default CommandPalette;
