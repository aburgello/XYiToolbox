// =============================================================================
// src/js/main/screens/HomeScreen.tsx
// -----------------------------------------------------------------------------
// The home screen: logo, version, toolset grid, category cards, search,
// and favorites chip row. All state that belongs only to home (search query,
// favorites open/closed, logo spin/easter egg) lives here rather than in
// the top-level Main component.
// =============================================================================
import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, type Transition } from "motion/react";
import {
    Search,
    X,
    Star,
    FolderOpen,
    FolderPlus,
    Pencil,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { confirmDialog, promptDialog } from "../Dialog";
import { TOOLS, CATEGORIES, categoryStyleVars, prefetchTool } from "../toolRegistry";
import { iconWiggle, cardLift, categoryLift } from "../animations";
import { useFavorites, favoriteKey } from "../hooks/useFavorites";
import ToolsetTool from "../tools/Toolset";
import Tooltip from "../Tooltip";
import TimeTrackerDroplet from "../TimeTrackerDroplet";
import SfxDroplet from "../SfxDroplet";
import { sfx } from "../../lib/utils/sfx";
import logo from "../../assets/xyi-logo.png";
import easterEggGif from "../../assets/easter-egg.gif";
import type { Screen } from "../main";

const EASTER_EGG_CLICKS = 7;

interface Props {
    onNavigate: (screen: Screen) => void;
}

export const HomeScreen: React.FC<Props> = ({ onNavigate }) => {
    const { favoriteIds, favoriteEntries, toggleFavorite } = useFavorites(TOOLS);
    const [favoritesOpen, setFavoritesOpen] = useState(false);
    const [foldersOpen, setFoldersOpen] = useState(false);
    const [folders, setFolders] = useState<{ label: string; path: string }[] | null>(null);

    const loadFolders = useCallback(async () => {
        try {
            const result = await evalTS("loadUsefulFolders");
            setFolders(result ?? []);
        } catch {
            setFolders([]);
        }
    }, []);

    useEffect(() => {
        if (foldersOpen && folders === null) loadFolders();
    }, [foldersOpen]);

    const openFolder = async (path: string) => { await evalTS("revealUsefulFolder", path); };

    const addFolder = async () => {
        const path = await evalTS("selectUsefulFolder");
        if (!path) return;
        const def = (path as string).split(/[\\/]/).pop() || path;
        const label = await promptDialog("Name this shortcut:", def);
        if (label === null) return;
        await evalTS("addUsefulFolder", label || def, path);
        loadFolders();
    };

    const renameFolder = async (i: number, current: string) => {
        const next = await promptDialog("Rename:", current);
        if (!next) return;
        await evalTS("renameUsefulFolder", i, next);
        loadFolders();
    };

    const removeFolder = async (i: number, label: string) => {
        if (!(await confirmDialog(`Remove "${label}"?`))) return;
        await evalTS("removeUsefulFolder", i);
        loadFolders();
    };
    const [search, setSearch] = useState("");
    const [logoSpinTrigger, setLogoSpinTrigger] = useState(0);
    const [logoClickStreak, setLogoClickStreak] = useState(0);
    const [showLogoEasterEgg, setShowLogoEasterEgg] = useState(false);
    const [placeholderIdx, setPlaceholderIdx] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Cmd/Ctrl+F or "/" focuses the search box from anywhere on the home screen.
    // Suppresses the browser's own find-in-page (preventDefault) so it doesn't
    // fight with our handler. "/" is only intercepted when the active element
    // isn't already a text input/textarea, so typing in other fields is safe.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            const isTyping = tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable;
            if ((e.key === "f" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !isTyping)) {
                e.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    useEffect(() => {
        const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % TOOLS.length), 6600);
        return () => clearInterval(id);
    }, []);

    const handleLogoClick = () => {
        setLogoSpinTrigger((n) => n + 1);
        setLogoClickStreak((c) => {
            const next = c + 1;
            if (next >= EASTER_EGG_CLICKS) {
                setShowLogoEasterEgg(true);
                setTimeout(() => setShowLogoEasterEgg(false), 3000);
                return 0;
            }
            return next;
        });
    };

    // Search: matches tool names AND individual action labels.
    const searchLower = search.trim().toLowerCase();
    const searchHits: { tool: typeof TOOLS[number]; matchedAction?: string }[] = searchLower
        ? TOOLS.flatMap((t) => {
              const hits: { tool: typeof TOOLS[number]; matchedAction?: string }[] = [];
              if (t.label.toLowerCase().includes(searchLower)) hits.push({ tool: t });
              for (const action of t.actions || []) {
                  if (action.toLowerCase().includes(searchLower)) hits.push({ tool: t, matchedAction: action });
              }
              return hits;
          })
        : [];

    const renderToolCard = (tool: typeof TOOLS[number], backTo: Screen, matchedAction?: string) => {
        const Icon = tool.icon;
        const isFavorite = favoriteIds.includes(favoriteKey(tool.id, matchedAction));
        const navigate = () => onNavigate({ type: "tool", toolId: tool.id, backTo, autoAction: matchedAction });
        return (
            <motion.div
                key={tool.id + (matchedAction ? ":" + matchedAction : "")}
                className="tool-card"
                style={categoryStyleVars(tool.categories[0])}
                variants={cardLift}
                initial="rest"
                whileHover="hover"
                whileTap={{ scale: 0.96 }}
                role="button"
                tabIndex={0}
                onClick={navigate}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(); }
                }}
            >
                <motion.span variants={iconWiggle} className="tool-card-icon">
                    <Icon size={18} />
                </motion.span>
                {matchedAction ? (
                    <span className="tool-card-text">
                        {matchedAction}
                        <small>in {tool.label}</small>
                    </span>
                ) : (
                    tool.label
                )}
                <button
                    className={isFavorite ? "tool-card-favorite favorited" : "tool-card-favorite"}
                    title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(tool.id, matchedAction); }}
                >
                    <Star size={12} fill={isFavorite ? "currentColor" : "none"} />
                </button>
            </motion.div>
        );
    };

    const screenRef: Screen = { type: "home" };

    return (
        <>
            <div className="home-screen">
                <div className="home-ambient-bg" aria-hidden="true">
                    <motion.span className="ambient-blob ambient-blob-localise"
                        initial={{ opacity: 0, scale: 0.7, x: -80, y: -80 }}
                        animate={{ opacity: [0, 1, 0.4], scale: 1, x: 0, y: 0 }}
                        transition={{ x: { type: "spring", stiffness: 45, damping: 12, mass: 1 }, y: { type: "spring", stiffness: 45, damping: 12, mass: 1 }, scale: { type: "spring", stiffness: 45, damping: 12, mass: 1 }, opacity: { duration: 1.8, times: [0, 0.4, 1], ease: "easeInOut" } }}
                    />
                    <motion.span className="ambient-blob ambient-blob-review"
                        initial={{ opacity: 0, scale: 0.7, x: 80, y: -80 }}
                        animate={{ opacity: [0, 1, 0.4], scale: 1, x: 0, y: 0 }}
                        transition={{ x: { type: "spring", stiffness: 45, damping: 12, mass: 1, delay: 0.12 }, y: { type: "spring", stiffness: 45, damping: 12, mass: 1, delay: 0.12 }, scale: { type: "spring", stiffness: 45, damping: 12, mass: 1, delay: 0.12 }, opacity: { duration: 1.8, times: [0, 0.4, 1], ease: "easeInOut", delay: 0.12 } }}
                    />
                    <motion.span className="ambient-blob ambient-blob-deliver"
                        initial={{ opacity: 0, scale: 0.7, x: -80, y: 80 }}
                        animate={{ opacity: [0, 1, 0.4], scale: 1, x: 0, y: 0 }}
                        transition={{ x: { type: "spring", stiffness: 45, damping: 12, mass: 1, delay: 0.24 }, y: { type: "spring", stiffness: 45, damping: 12, mass: 1, delay: 0.24 }, scale: { type: "spring", stiffness: 45, damping: 12, mass: 1, delay: 0.24 }, opacity: { duration: 1.8, times: [0, 0.4, 1], ease: "easeInOut", delay: 0.24 } }}
                    />
                    <motion.span className="ambient-blob ambient-blob-tools"
                        initial={{ opacity: 0, scale: 0.7, x: 80, y: 80 }}
                        animate={{ opacity: [0, 1, 0.4], scale: 1, x: 0, y: 0 }}
                        transition={{ x: { type: "spring", stiffness: 45, damping: 12, mass: 1, delay: 0.36 }, y: { type: "spring", stiffness: 45, damping: 12, mass: 1, delay: 0.36 }, scale: { type: "spring", stiffness: 45, damping: 12, mass: 1, delay: 0.36 }, opacity: { duration: 1.8, times: [0, 0.4, 1], ease: "easeInOut", delay: 0.36 } }}
                    />
                </div>

                <div className="home-content">
                    <motion.div className="home-header"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35 }}
                    >
                        <motion.div
                            className="logo-glow"
                            animate={{ opacity: [0.55, 0.9, 0.55], scale: [0.94, 1.05, 0.94] }}
                            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <motion.img
                            src={logo}
                            alt="XYi Design"
                            className="logo"
                            onClick={handleLogoClick}
                            initial={false}
                            animate={{ rotate: logoSpinTrigger * 360 }}
                            whileTap={{ scale: 0.88 }}
                            transition={{ duration: 0.6, ease: "easeInOut" }}
                        />
                        <p className="version">Toolbox 2026.07</p>
                    </motion.div>

                    <div className="home-search">
                        <div className="search-box-row">
                            <div className="search-box">
                                <Search size={12} />
                                <div className="search-input-wrap">
                                    <input
                                        type="text"
                                        aria-label="Search all tools"
                                        ref={searchInputRef}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    />
                                    {!search && (
                                        <AnimatePresence mode="wait">
                                            <motion.span
                                                key={placeholderIdx}
                                                className="search-placeholder"
                                                initial={{ opacity: 0, y: 4 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -4 }}
                                                transition={{ duration: 0.25 }}
                                            >
                                                Search "{TOOLS[placeholderIdx].label}"…
                                            </motion.span>
                                        </AnimatePresence>
                                    )}
                                </div>
                                {search && (
                                    <Tooltip text="Clear">
                                        <button className="clear-search" onClick={() => setSearch("")}>
                                            <X size={12} />
                                        </button>
                                    </Tooltip>
                                )}
                            </div>
                            <Tooltip text="Favorites">
                                <button
                                    className={favoritesOpen || favoriteEntries.length > 0 ? "favorites-toggle active" : "favorites-toggle"}
                                    onClick={() => { setFavoritesOpen((v) => !v); setFoldersOpen(false); }}
                                >
                                    <Star size={14} fill={favoriteEntries.length > 0 ? "currentColor" : "none"} />
                                </button>
                            </Tooltip>
                            <Tooltip text="Useful Folders">
                                <button
                                    className={foldersOpen ? "favorites-toggle active" : "favorites-toggle"}
                                    onClick={() => { setFoldersOpen((v) => !v); setFavoritesOpen(false); }}
                                >
                                    <FolderOpen size={14} />
                                </button>
                            </Tooltip>
                            <SfxDroplet />
                            <TimeTrackerDroplet
                                onOpenFullTracker={() => onNavigate({ type: "tool", toolId: "timesheet-tracker", backTo: { type: "home" } })}
                            />
                        </div>

                        <AnimatePresence>
                            {favoritesOpen && (
                                <motion.div
                                    className="favorites-row"
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.15 }}
                                >
                                    {favoriteEntries.length === 0 ? (
                                        <p className="hint">No favorites yet — star a tool from your search results to pin it here.</p>
                                    ) : (
                                        favoriteEntries.map(({ tool, action }) => {
                                            const Icon = tool.icon;
                                            return (
                                                <motion.button
                                                    key={favoriteKey(tool.id, action)}
                                                    className="favorite-chip"
                                                    style={categoryStyleVars(tool.categories[0])}
                                                    whileHover={{ y: -2 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={() => onNavigate({ type: "tool", toolId: tool.id, backTo: { type: "home" }, autoAction: action })}
                                                >
                                                    <Icon size={13} />
                                                    <span>{action || tool.label}</span>
                                                </motion.button>
                                            );
                                        })
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <AnimatePresence>
                            {foldersOpen && (
                                <motion.div
                                    className="folders-flyout"
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.15 }}
                                    style={{ overflow: "hidden" }}
                                >
                                    <div className="folders-flyout-inner">
                                        {folders === null ? (
                                            <span className="hint">Loading…</span>
                                        ) : folders.length === 0 ? (
                                            <span className="hint">No folders yet.</span>
                                        ) : (
                                            folders.map((f, i) => (
                                                <div key={i} className="folder-row">
                                                    <Tooltip text={f.path}>
                                                        <motion.button
                                                            className="folder-row-open"
                                                            onClick={() => openFolder(f.path)}
                                                            whileHover={{ x: 2 }}
                                                            whileTap={{ scale: 0.96 }}
                                                        >
                                                            <FolderOpen size={12} />
                                                            <span>{f.label}</span>
                                                        </motion.button>
                                                    </Tooltip>
                                                    <Tooltip text="Rename">
                                                        <button className="folder-row-icon" onClick={() => renameFolder(i, f.label)}><Pencil size={11} /></button>
                                                    </Tooltip>
                                                    <Tooltip text="Remove">
                                                        <button className="folder-row-icon" onClick={() => removeFolder(i, f.label)}><X size={11} /></button>
                                                    </Tooltip>
                                                </div>
                                            ))
                                        )}
                                        <button className="folder-row-add" onClick={addFolder}>
                                            <FolderPlus size={12} /> Add folder
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <AnimatePresence>
                            {searchLower && (
                                <motion.div
                                    className="tool-card-grid search-results"
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.15 }}
                                >
                                    {searchHits.length === 0 ? (
                                        <p className="hint">No tools match "{search}".</p>
                                    ) : (
                                        searchHits.map((hit) => renderToolCard(hit.tool, { type: "home" }, hit.matchedAction))
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <ToolsetTool onNavigate={onNavigate} />

                    <div className="category-row">
                        {CATEGORIES.map((category, index) => {
                            const Icon = category.icon;
                            return (
                                <motion.button
                                    key={category.id}
                                    className="category-card"
                                    style={categoryStyleVars(category.id)}
                                    variants={categoryLift}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    whileHover="hover"
                                    transition={{ type: "spring", stiffness: 300, damping: 24, delay: index * 0.06 } as Transition}
                                    whileTap={{ scale: 0.96 }}
                                    onHoverStart={() => {
                                        if (category.id === "deliver") prefetchTool("delivery-hub");
                                        else if (category.id === "review") prefetchTool("review-hub");
                                        else if (category.id === "localise") prefetchTool("campaign-localiser");
                                        else if (category.id === "tools") prefetchTool("random-layers");
                                    }}
                                    onClick={() => {
                                        sfx.click();
                                        // Deliver is deliberately NOT a master-detail category --
                                        // it's a single bespoke one-stop page (DeliveryHub, id
                                        // "delivery-hub") that already contains everything that
                                        // category needs (Delivery, frame rate, the bitrate
                                        // checklist), so clicking the card skips the tool-list
                                        // screen entirely and goes straight there. The other three
                                        // categories are unaffected -- this is the only special case.
                                        if (category.id === "deliver") {
                                            onNavigate({ type: "tool", toolId: "delivery-hub", backTo: { type: "home" } });
                                        } else if (category.id === "review") {
                                            onNavigate({ type: "tool", toolId: "review-hub", backTo: { type: "home" } });
                                        } else {
                                            onNavigate({ type: "category", categoryId: category.id });
                                        }
                                    }}
                                >
                                    <motion.span variants={iconWiggle} className="category-card-icon">
                                        <Icon size={22} />
                                    </motion.span>
                                    {category.label}
                                </motion.button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Easter egg overlay -- sibling of .home-screen so it covers the full panel */}
            <AnimatePresence>
                {showLogoEasterEgg && (
                    <motion.div
                        className="logo-easter-egg-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        onClick={() => setShowLogoEasterEgg(false)}
                    >
                        <motion.img
                            src={easterEggGif}
                            alt=""
                            className="logo-easter-egg-gif"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 22 }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};
