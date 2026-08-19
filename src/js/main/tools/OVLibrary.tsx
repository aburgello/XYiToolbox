// =============================================================================
// src/js/main/tools/OVLibrary.tsx
// -----------------------------------------------------------------------------
// OV Library tool, ported from XYi_OV_Library.jsx's ScriptUI layout. Every
// actual file operation (scan, import, reveal, play, campaign persistence)
// happens in src/jsx/aeft/aeft.ts via evalTS() -- this file only holds UI
// state and calls across the bridge. Mounted as one entry in AppShell's tool
// registry (src/js/main/main.tsx) -- OV Library isn't its own panel anymore,
// just one tool among the rest of the toolbox.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
    Download,
    Search,
    Play,
    FolderPlus,
    RefreshCw,
    Trash2,
    ChevronDown,
    ChevronRight,
    X,
    RectangleHorizontal,
    RectangleVertical,
    Square,
    LayoutGrid,
    ArrowUpDown,
    Film,
    ImagePlus,
    Columns2,
    Users,
    ClipboardCheck,
} from "lucide-react";
import CSInterface from "../../lib/cep/csinterface";
import { csi, evalTS } from "../../lib/utils/bolt";
import Tooltip from "../Tooltip";
import StatusIcon from "../StatusIcon";
import Droplet from "../Droplet";
import { alertDialog, confirmDialog, promptDialog } from "../Dialog";
import { hasUserTheme } from "../themes";
import { runMasterCheck, openReport } from "../lib/masterCheck";
// Preview plumbing shared with Bespoke's master cards -- extension preference,
// image-vs-video detection and the poster-frame seek. It was written here and
// lives in lib/ now so both grids get the same answers; see the file header for
// why each of the three exists.
import { usePosterFrame, pickPreviewRender, isImageFile, type RenderEntry } from "../lib/renderPreview";
import "../shared.scss";
import "./OVLibrary.scss";

interface Campaign {
    name: string;
    mastersRoot: string;
}

interface MasterRecord {
    group: string;
    width: number;
    height: number;
    duration: string;
    suffix: string;
    orientation: string;
    stem: string;
    originalName: string;
    aepPath: string;
}


type OrientationKey = "LANDSCAPE" | "PORTRAIT" | "SQUARE" | "QUAD";
const ORIENTATION_ORDER: OrientationKey[] = ["LANDSCAPE", "PORTRAIT", "SQUARE", "QUAD"];

// Fallback only — used when a creative has no parseable masters at all, so
// the chips show *something* sensible rather than all-off. A creative with
// masters gets its filters from pickDefaultFilters() below instead.
const DEFAULT_FILTERS: Record<OrientationKey, boolean> = {
    LANDSCAPE: true,
    PORTRAIT: true,
    SQUARE: false,
    QUAD: false,
};

// Below this many masters, showing every orientation at once is comfortable;
// at or above it the grid gets long enough that one orientation is the more
// useful landing state.
const ORIENTATION_AUTO_THRESHOLD = 8;

// Picks the opening orientation chips for a creative from what it actually
// contains, rather than a fixed guess:
//
//   under 8 masters  -> every orientation the creative HAS is on. (A fixed
//                       Landscape+Portrait default left a square-only or
//                       QUAD-only creative looking empty, which reads as a
//                       scan failure rather than a filter.)
//   8 or more        -> only the single most numerous orientation.
//
// The "8 or more" case picks the largest group across ALL orientations, not
// just Landscape vs Portrait. In practice that is always Landscape or
// Portrait, but a QUAD-heavy creative would otherwise open on a handful of
// stray landscapes and hide the 30 masters actually in it.
// Ties go to ORIENTATION_ORDER, so a dead heat opens on Landscape.
function pickDefaultFilters(recs: MasterRecord[]): Record<OrientationKey, boolean> {
    const counts: Record<OrientationKey, number> = { LANDSCAPE: 0, PORTRAIT: 0, SQUARE: 0, QUAD: 0 };
    let total = 0;
    for (const rec of recs) {
        const key = rec.orientation as OrientationKey;
        if (counts[key] === undefined) continue;
        counts[key]++;
        total++;
    }
    if (total === 0) return { ...DEFAULT_FILTERS };

    const on: Record<OrientationKey, boolean> = { LANDSCAPE: false, PORTRAIT: false, SQUARE: false, QUAD: false };
    if (total < ORIENTATION_AUTO_THRESHOLD) {
        for (const key of ORIENTATION_ORDER) on[key] = counts[key] > 0;
        return on;
    }
    let best: OrientationKey = ORIENTATION_ORDER[0];
    for (const key of ORIENTATION_ORDER) if (counts[key] > counts[best]) best = key;
    on[best] = true;
    return on;
}
const ORIENTATION_ICON: Record<OrientationKey, React.ComponentType<{ size?: number }>> = {
    LANDSCAPE: RectangleHorizontal,
    PORTRAIT: RectangleVertical,
    SQUARE: Square,
    QUAD: LayoutGrid,
};

type VariantSort = "size" | "duration";

interface Toast {
    id: number;
    text: string;
    type: "success" | "error";
}

// -----------------------------------------------------------------------
// Mock data: lets this UI be exercised with `yarn dev` in a plain browser
// (http://localhost:3000/main/) with NO After Effects and NO real Masters
// folder. evalTS() only works inside a real CEP host -- when it fails
// (or resolves to undefined, which a real bridge call never should),
// safeEvalTS() below falls back to this fixed dataset instead. This is
// intentional scaffolding, not a bug -- see CLAUDE.md "Testing" section.
// -----------------------------------------------------------------------
const MOCK_CAMPAIGNS: Campaign[] = [{ name: "The Odyssey (MOCK)", mastersRoot: "/mock/odyssey" }];

const MOCK_CREATIVES: Record<string, string[]> = {
    "/mock/odyssey": ["HORSE", "HELMET", "GUTTERS"],
};

const MOCK_RECORDS: Record<string, MasterRecord[]> = {
    HORSE: [
        {
            group: "ODY_INTL_DGTL_DOOH_HORSE_LOS", width: 1920, height: 858, duration: "10sec", suffix: "_OV",
            orientation: "LANDSCAPE", stem: "ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV",
            originalName: "ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV.aep",
            aepPath: "/mock/odyssey/AE/HORSE/ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV.aep",
        },
        {
            group: "ODY_INTL_DGTL_DOOH_HORSE_LOS", width: 1080, height: 1920, duration: "10sec", suffix: "_OV",
            orientation: "PORTRAIT", stem: "ODY_INTL_DGTL_DOOH_HORSE_LOS_1080x1920_10sec_OV",
            originalName: "ODY_INTL_DGTL_DOOH_HORSE_LOS_1080x1920_10sec_OV.aep",
            aepPath: "/mock/odyssey/AE/HORSE/ODY_INTL_DGTL_DOOH_HORSE_LOS_1080x1920_10sec_OV.aep",
        },
        {
            group: "ODY_INTL_DGTL_DOOH_HORSE_LOS", width: 1920, height: 1920, duration: "20sec", suffix: "_OV",
            orientation: "SQUARE", stem: "ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x1920_20sec_OV",
            originalName: "ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x1920_20sec_OV.aep",
            aepPath: "/mock/odyssey/AE/HORSE/ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x1920_20sec_OV.aep",
        },
    ],
    HELMET: [
        {
            group: "ODY_INTL_DGTL_DOOH_HELMET_LOS", width: 3840, height: 586, duration: "10sec", suffix: "_OV",
            orientation: "LANDSCAPE", stem: "ODY_INTL_DGTL_DOOH_HELMET_LOS_3840x586_10sec_OV",
            originalName: "ODY_INTL_DGTL_DOOH_HELMET_LOS_3840x586_10sec_OV.aep",
            aepPath: "/mock/odyssey/AE/HELMET/ODY_INTL_DGTL_DOOH_HELMET_LOS_3840x586_10sec_OV.aep",
        },
        // A master on the NEW convention ("…x…px_10s"), which is what every
        // master written from 2026-08 onward looks like. Kept alongside the
        // legacy rows on purpose: a real campaign folder now holds both, and
        // parseMasterFilename() has to group them together.
        {
            group: "ODY_INTL_Helmet_DOOH_LOS", width: 1080, height: 1920, duration: "10sec", suffix: "_OV",
            orientation: "PORTRAIT", stem: "ODY_INTL_Helmet_DOOH_LOS_1080x1920px_10s_OV",
            originalName: "ODY_INTL_Helmet_DOOH_LOS_1080x1920px_10s_OV.aep",
            aepPath: "/mock/odyssey/AE/HELMET/ODY_INTL_Helmet_DOOH_LOS_1080x1920px_10s_OV.aep",
        },
    ],
    GUTTERS: [],
};

const MOCK_RENDERS: Record<string, RenderEntry[]> = {
    HORSE: [
        {
            stem: "ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV",
            path: "/mock/odyssey/Renders/HORSE/ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV.mov",
        },
    ],
    HELMET: [],
    GUTTERS: [],
};

function mockFor(name: string, args: any[]): any {
    switch (name) {
        case "loadCampaigns":
            return MOCK_CAMPAIGNS;
        case "loadLastCampaign":
            // "" means nothing remembered, so preview exercises the
            // most-recently-added fallback rather than a restored pick.
            return "";
        case "scanCreatives":
            return MOCK_CREATIVES[args[0]] || [];
        case "scanMastersForCreative":
            return MOCK_RECORDS[args[1]] || [];
        case "scanRendersForCreative":
            return MOCK_RENDERS[args[1]] || [];
        case "selectMastersFolder":
            return "/mock/odyssey";
        case "loadCampaignBanner":
            return "";
        case "setCampaignBanner":
        case "clearCampaignBanner":
        case "saveCampaign":
        case "removeCampaign":
        case "importFile":
        case "revealFile":
        case "playFile":
            return { success: true };
        default:
            return null;
    }
}

// Converts a raw OS filesystem path (as returned by the ExtendScript bridge,
// e.g. "/Volumes/Renders/HORSE/foo.mp4" or "C:\Renders\HORSE\foo.mp4") into
// a file:// URL a <video>/<img> tag can load. Handles backslashes (Windows)
// and Windows drive letters, which need an extra leading slash
// (file:///C:/...) that Mac/Unix paths don't.
function toFileUrl(p: string): string {
    if (!p) return "";
    if (p.startsWith("file://")) return p;
    let normalized = p.replace(/\\/g, "/");
    if (/^[a-zA-Z]:\//.test(normalized)) {
        // Drive-letter path (C:/...) -- needs an extra leading slash so the
        // drive letter isn't parsed as part of a URL scheme/host.
        normalized = "/" + normalized;
    } else if (normalized.startsWith("//")) {
        // UNC network path (\\Server\Share\... before the backslash swap
        // above) -- file://<host>/<share>/... wants exactly the TWO
        // slashes "file://" already supplies before the host, so this
        // leading "//" has to be stripped, not kept alongside it.
        // Concatenating both silently produces a malformed four-slash URL
        // that just fails to load with no error, rather than a network
        // path a mapped-drive-letter test never would have caught.
        normalized = normalized.substring(2);
    }
    return "file://" + encodeURI(normalized);
}

// Samples an approximate dominant color off a loaded <video>'s current
// frame via a tiny offscreen canvas, for the dynamic per-thumbnail accent
// (see CreativeCard/VariantBlock below) -- lets each creative/render tint
// its own card with a color pulled from its actual footage instead of
// every card sharing the same fixed --ov-accent. Wrapped in try/catch and
// returns null on any failure: canvas pixel reads can be blocked by
// cross-origin taint rules depending on exactly how CEP ends up serving
// the panel (a local dev server vs a packaged file:// load), and this is
// a pure visual nicety -- it should silently no-op back to the existing
// fixed accent, never break the card or throw somewhere a user would see.
interface DominantColor {
    solid: string; // full-opacity rgb(...), for border/background uses
    glow: string;  // same color pre-blended to 35% alpha, for box-shadow glows
}

// Returns both a solid and a pre-blended-alpha string rather than one plain
// rgb(...) -- the glow use (a soft box-shadow) needs the color at partial
// opacity, and `color-mix(in srgb, var(--card-accent) 35%, transparent)` was
// the first approach tried for that, but color-mix() is NOT supported on
// this project's chrome74 build target (same class of gotcha documented
// elsewhere in this codebase for Droplet's swatch styling and Toolset's
// palette -- looks fine in an ordinary browser, silently fails to apply in
// the real packaged panel). Precomputing both strings in JS sidesteps it
// entirely, no CSS color functions needed at the point of use.
function sampleDominantColor(video: HTMLVideoElement): DominantColor | null {
    try {
        const w = 24;
        const h = 14; // tiny on purpose -- this produces an average, not a real image, so real resolution buys nothing
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
        }
        if (count === 0) return null;
        r /= count;
        g /= count;
        b /= count;
        // A raw average of real footage skews muddy/desaturated -- reads as
        // "broken tint" rather than "branded accent." Lifting toward a
        // punchier version of the same hue (capped so it doesn't blow out
        // already-bright frames) looks intentional instead.
        const max = Math.max(r, g, b);
        const boost = max > 0 ? Math.min(1.6, 200 / max) : 1;
        const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * boost)));
        const cr = clamp(r);
        const cg = clamp(g);
        const cb = clamp(b);
        return { solid: `rgb(${cr}, ${cg}, ${cb})`, glow: `rgba(${cr}, ${cg}, ${cb}, 0.35)` };
    } catch (e) {
        return null;
    }
}

// Shimmer placeholder matching a real card's layout -- shown in place of
// the "Scanning…" spinner row while creatives/variants load, so the
// panel's structure is visible immediately instead of popping in all at
// once once the scan finishes.
const SkeletonCard: React.FC = () => (
    <div className="creative-card skeleton">
        <div className="creative-card-preview shimmer" />
        <div className="creative-card-footer">
            <span className="shimmer-bar" style={{ width: "70%" }} />
            <span className="shimmer-bar" style={{ width: "20px" }} />
        </div>
    </div>
);

const SkeletonVariantBlock: React.FC = () => (
    <div className="variant-block skeleton">
        <div className="variant-preview shimmer" />
        <div className="variant-details">
            <span className="shimmer-bar" style={{ width: "45%", height: "12px", marginBottom: "8px" }} />
            <span className="shimmer-bar" style={{ width: "85%", marginBottom: "4px" }} />
            <span className="shimmer-bar" style={{ width: "85%" }} />
        </div>
    </div>
);

// One card per creative in the top grid. The mp4 preview only plays on
// hover (rather than all cards autoplaying at once) -- these renders can be
// hundreds of MB, and having several playing simultaneously in a CEP panel
// is a good way to make the whole host app stutter. Rewinds to 0 on
// mouse-leave so every hover starts the loop fresh instead of resuming
// wherever the last hover left off.
const CreativeCard: React.FC<{
    name: string;
    count?: number;
    previewSrc?: string;
    selected: boolean;
    hasCustomThumbnail: boolean;
    onSelect: () => void;
    onSetCustomThumbnail: (name: string) => void;
    onClearCustomThumbnail: (name: string) => void;
}> = ({ name, count, previewSrc, selected, hasCustomThumbnail, onSelect, onSetCustomThumbnail, onClearCustomThumbnail }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [accent, setAccent] = useState<DominantColor | null>(null);
    const [videoError, setVideoError] = useState(false);
    // Separate from the video-preview hover (handleEnter/handleLeave) --
    // this one only flips on after a deliberate 1s hold, not instantly on
    // enter, so the override icon doesn't pop up on every card the cursor
    // sweeps past while just scanning the grid (same instinct as
    // Toolset's delay={1500} tooltips, just a shorter hold since this is
    // a single card, not a dense multi-button grid).
    const [showOverride, setShowOverride] = useState(false);
    const overrideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Grabs the dominant color off the poster frame, once. Declared before
    // usePosterFrame because that hook calls it.
    const handleFrameReady = () => {
        const v = videoRef.current;
        if (!v || accent) return;
        const color = sampleDominantColor(v);
        if (color) setAccent(color);
    };
    const poster = usePosterFrame(videoRef, handleFrameReady);

    const handleEnter = () => {
        const v = videoRef.current;
        if (!v) return;
        // Hover still plays the whole thing from the top -- the poster offset
        // is about what the card RESTS on, not where playback starts.
        v.currentTime = 0;
        v.play().catch(() => {
            // Autoplay can be rejected in some contexts -- fine, the poster
            // frame just stays static, nothing for the user to see/fix.
        });
    };
    const handleLeave = () => {
        poster.restToPoster();
    };

    const handleMouseEnter = () => {
        handleEnter();
        overrideTimeoutRef.current = setTimeout(() => setShowOverride(true), 1000);
    };
    const handleMouseLeave = () => {
        handleLeave();
        if (overrideTimeoutRef.current) clearTimeout(overrideTimeoutRef.current);
        setShowOverride(false);
    };

    return (
        <div
            className={selected ? "creative-card selected" : "creative-card"}
            style={accent ? ({ "--card-accent": accent.solid, "--card-accent-glow": accent.glow } as React.CSSProperties) : undefined}
            onClick={onSelect}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div className="creative-card-preview">
                {previewSrc && !videoError && isImageFile(previewSrc) ? (
                    // A manual override (no type filter on its file picker) or,
                    // in principle, an auto-detected "render" can be a still
                    // image -- a <video> tag silently shows nothing for one
                    // (no error event either), which is exactly what broke a
                    // PNG/JPG override before this branch existed.
                    <img src={toFileUrl(previewSrc)} alt="" onError={() => setVideoError(true)} />
                ) : previewSrc && !videoError ? (
                    <>
                        <video
                            ref={videoRef}
                            src={toFileUrl(previewSrc)}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={poster.onLoadedMetadata}
                            onSeeked={poster.onSeeked}
                            onLoadedData={poster.onLoadedData}
                            onError={() => setVideoError(true)}
                        />
                        <div className="creative-card-play-hint">
                            <Play size={18} fill="currentColor" />
                        </div>
                    </>
                ) : (
                    <div className="creative-card-no-preview">
                        <Film size={20} />
                    </div>
                )}
                {showOverride && (
                    <button
                        className={hasCustomThumbnail ? "creative-card-thumb-override active" : "creative-card-thumb-override"}
                        title={hasCustomThumbnail ? "Change custom thumbnail (right-click to reset)" : "Set a custom thumbnail from a file"}
                        onClick={(e) => {
                            e.stopPropagation();
                            onSetCustomThumbnail(name);
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (hasCustomThumbnail) onClearCustomThumbnail(name);
                        }}
                    >
                        <ImagePlus size={12} />
                    </button>
                )}
            </div>
            <div className="creative-card-footer">
                <span className="creative-name">{name}</span>
                <span className="count-badge">{count ?? "…"}</span>
            </div>
        </div>
    );
};

// Fullscreen-in-panel overlay shown when the user clicks "Play" on a
// variant's render. Plays the real render file centered over everything
// else, with native <video> controls, instead of shelling out to the OS
// to reveal the file and launch whatever the default player happens to
// be. Closes on Escape, on backdrop click, or via the X button.
const VideoPlayerModal: React.FC<{ path: string; onClose: () => void }> = ({ path, onClose }) => {
    const [error, setError] = useState(false);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    return (
        <div className="video-player-overlay" onClick={onClose}>
            <div className="video-player-frame" onClick={(e) => e.stopPropagation()}>
                <Tooltip text="Close (Esc)">
                    <button className="video-player-close" onClick={onClose}>
                        <X size={16} />
                    </button>
                </Tooltip>
                {error ? (
                    <div className="video-player-error">
                        <Film size={32} />
                        <p>Could not play this file in the panel.</p>
                        <p className="hint">The render works in After Effects. Try Import or Reveal instead.</p>
                    </div>
                ) : (
                    <video src={toFileUrl(path)} controls autoPlay onError={() => setError(true)} />
                )}
            </div>
        </div>
    );
};

// One row per size/duration variant, with its own hover-to-play preview of
// that specific render (matched by stem via renderMap in the parent) --
// distinct from CreativeCard's preview above, which only shows one
// representative render per creative. Same hover/rewind pattern as
// CreativeCard for consistency.
const VariantBlock: React.FC<{
    rec: MasterRecord;
    renderPath?: string;
    onImport: (path: string) => void;
    onReveal: (path: string) => void;
    onPlay: (path: string) => void;
    onCompare: (path: string, width: number, height: number) => void;
}> = ({ rec, renderPath, onImport, onReveal, onPlay, onCompare }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [accent, setAccent] = useState<DominantColor | null>(null);
    const [videoError, setVideoError] = useState(false);

    const handleFrameReady = () => {
        const v = videoRef.current;
        if (!v || accent) return;
        const color = sampleDominantColor(v);
        if (color) setAccent(color);
    };
    const poster = usePosterFrame(videoRef, handleFrameReady);

    const handleEnter = () => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = 0;
        v.play().catch(() => {});
    };
    const handleLeave = () => {
        poster.restToPoster();
    };

    return (
        <div
            className="variant-block"
            style={accent ? ({ "--card-accent": accent.solid, "--card-accent-glow": accent.glow } as React.CSSProperties) : undefined}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
        >
            <div className="variant-preview">
                {renderPath && !videoError ? (
                    <video
                        ref={videoRef}
                        src={toFileUrl(renderPath)}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={poster.onLoadedMetadata}
                        onSeeked={poster.onSeeked}
                        onLoadedData={poster.onLoadedData}
                        onError={() => setVideoError(true)}
                    />
                ) : (
                    <div className="variant-preview-empty">
                        <Film size={16} />
                    </div>
                )}
            </div>
            <div className="variant-details">
                <div className="variant-title">
                    {rec.width}x{rec.height} — {rec.duration}
                </div>
                <div className="action-row">
                    <Tooltip text={rec.aepPath}>
                        <span>Master (.aep)</span>
                    </Tooltip>
                    <Tooltip text="Import (read-only)">
                        <button onClick={() => onImport(rec.aepPath)}>
                            <Download size={14} />
                        </button>
                    </Tooltip>
                    <Tooltip text="Reveal in Finder/Explorer">
                        <button onClick={() => onReveal(rec.aepPath)}>
                            <Search size={14} />
                        </button>
                    </Tooltip>
                </div>
                {renderPath ? (
                    <div className="action-row">
                        <Tooltip text={renderPath}>
                            <span>Render</span>
                        </Tooltip>
                        <Tooltip text="Play">
                            <button onClick={() => onPlay(renderPath)}>
                                <Play size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip text="Import (read-only)">
                            <button onClick={() => onImport(renderPath)}>
                                <Download size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip text="Create comparison comp -- this render side by side with whatever's selected in the Project panel">
                            <button onClick={() => onCompare(renderPath, rec.width, rec.height)}>
                                <Columns2 size={14} />
                            </button>
                        </Tooltip>
                    </div>
                ) : (
                    <div className="action-row muted">No matching render found</div>
                )}
            </div>
        </div>
    );
};

// Reads AE's actual panel skin (background/accent) so the panel matches the
// host's current theme and brightness slider instead of a fixed hardcoded
// palette, and stays in sync if the user changes it while the panel is open.
// Font is intentionally NOT adopted from the host -- AE's reported
// baseFontFamily doesn't reliably resolve to an installed sans-serif font
// (falls back to a serif), so this panel keeps its own fixed font stack.
function useHostTheme() {
    useEffect(() => {
        const rgb = (c?: { red: number; green: number; blue: number }) => (c ? `rgb(${c.red}, ${c.green}, ${c.blue})` : undefined);

        const applyTheme = () => {
            try {
                // A user-picked theme (the hidden "jacqui" picker) takes
                // precedence -- don't let host-skin matching silently
                // overwrite it just because this tool happens to mount.
                if (hasUserTheme()) return;
                const skin = csi.hostEnvironment?.appSkinInfo;
                if (!skin) return;
                const root = document.documentElement.style;
                const bg = rgb(skin.panelBackgroundColor?.color);
                const accent = rgb(skin.systemHighlightColor);
                if (bg) root.setProperty("--ov-bg", bg);
                if (accent) root.setProperty("--ov-accent", accent);
            } catch (e) {
                // No host environment available (browser preview) -- CSS fallbacks apply.
            }
        };

        applyTheme();
        try {
            csi.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, applyTheme);
        } catch (e) {}
    }, []);
}

interface Props {
    // Hero mode: a big banner header (campaign name + thumbnail, seamless
    // Droplet-based campaign switcher) replacing the plain heading/select/
    // button-row toolbar -- used when this tool is the main, first-thing-
    // you-see stop for a whole category (Review), as opposed to sitting
    // in a category master-detail list or Localise's tool list alongside
    // several other tools where the plainer toolbar fits better.
    hero?: boolean;
    // Called whenever the selected campaign changes, so a parent (e.g.
    // ReviewHub) can share it with sibling tabs that also need the
    // campaign context — the Review Session tab uses this to find
    // matching .mp4 renders for imported .mov files.
    onCampaignChange?: (campaign: Campaign | null) => void;
}

const OVLibraryTool: React.FC<Props> = ({ hero = false, onCampaignChange }) => {
    useHostTheme();

    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

    const [creatives, setCreatives] = useState<string[]>([]);
    const [creativeCounts, setCreativeCounts] = useState<Record<string, number>>({});
    const [creativePreviews, setCreativePreviews] = useState<Record<string, string>>({});
    // User-set overrides, keyed by creative name, for the current campaign
    // only -- merged over creativePreviews when rendering (override wins).
    // See setCreativeThumbnailOverride()/loadThumbOverrides() in aeft.ts.
    const [thumbOverrides, setThumbOverrides] = useState<Record<string, string>>({});
    const [selectedCreative, setSelectedCreative] = useState<string | null>(null);
    const [loadingCreatives, setLoadingCreatives] = useState(false);

    const [records, setRecords] = useState<MasterRecord[]>([]);
    const [renderMap, setRenderMap] = useState<Record<string, string>>({});
    const [variantSearch, setVariantSearch] = useState("");
    const [variantSort, setVariantSort] = useState<VariantSort>("size");
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [loadingVariants, setLoadingVariants] = useState(false);

    // Recomputed from the creative's own masters each time one is selected —
    // see pickDefaultFilters(). DEFAULT_FILTERS is just the pre-selection
    // resting state.
    const [filters, setFilters] = useState<Record<OrientationKey, boolean>>({ ...DEFAULT_FILTERS });

    // "" = no pinned banner, fall back to the creative-thumbnail heuristic.
    const [campaignBanner, setCampaignBanner] = useState("");
    // Revealed by holding the cursor on the banner, same deliberate ~1s hold
    // as the creative cards' override button rather than an instant hover.
    const [showBannerOverride, setShowBannerOverride] = useState(false);
    const bannerHoldRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // A pinned banner that happens to be a video is parked on a frame rather
    // than left on frame 0 — same reasoning as the card thumbnails. No accent
    // sampling here, so the frame-ready callback has nothing to do.
    const heroVideoRef = useRef<HTMLVideoElement>(null);
    const heroPoster = usePosterFrame(heroVideoRef, () => {});

    const [usingMock, setUsingMock] = useState(false);
    const [toasts, setToasts] = useState<Toast[]>([]);
    // --- Master check (Python, out of process -- see lib/masterCheck.ts) ----
    // Deliberately no availability probe on mount: that would spawn a process
    // every time this tool opens, for a button most sessions never press.
    // Everything is checked at click time instead.
    const [checkBusy, setCheckBusy] = useState(false);
    const [checkNote, setCheckNote] = useState<string | null>(null);

    const runCheck = async () => {
        if (!selectedCampaign) return;
        setCheckBusy(true);
        setCheckNote("Starting…");
        try {
            const result = await runMasterCheck(
                selectedCampaign.name,
                selectedCampaign.mastersRoot,
                (line) => setCheckNote(line)
            );
            if (result.ok && result.reportPath) {
                openReport(result.reportPath);
                setCheckNote("Report opened in your browser.");
                pushToast("Master check done.");
            } else {
                setCheckNote(result.message);
                // A machine that has never run the setup isn't a failure, it's
                // a normal state -- same rule the NAS features follow. It gets
                // the inline note (which stays put and explains the fix) and
                // deliberately NOT a toast, which would read as an error and
                // then vanish before it could be acted on.
                if (!result.notInstalled) pushToast(result.message, "error");
            }
        } catch (e: any) {
            const msg = e?.message || "The check couldn't run.";
            setCheckNote(msg);
            pushToast(msg, "error");
        } finally {
            setCheckBusy(false);
        }
    };

    const toastId = useRef(0);
    const [playerPath, setPlayerPath] = useState<string | null>(null);

    const pushToast = (text: string, type: Toast["type"] = "success") => {
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, text, type }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    };

    // Wraps evalTS with a fallback to mock data. A real bridge call inside
    // AE should always resolve to something (even an empty array) -- if it
    // throws OR resolves to undefined, that's treated as "no CEP bridge"
    // and mock data is served instead, with a visible banner so it's never
    // ambiguous which mode is active.
    const safeEvalTS = async (name: string, ...args: any[]): Promise<any> => {
        try {
            const result = await evalTS(name as any, ...args);
            if (result === undefined) throw new Error("no bridge");
            return result;
        } catch (e) {
            setUsingMock(true);
            return mockFor(name, args);
        }
    };

    // --- Load campaigns on mount --------------------------------------
    useEffect(() => {
        refreshCampaigns();
    }, []);

    const refreshCampaigns = async () => {
        const camps = await safeEvalTS("loadCampaigns");
        setCampaigns(camps || []);
        if (camps && camps.length > 0 && !selectedCampaign) {
            // Campaigns come back in the order they were ADDED, so camps[0] is
            // the OLDEST on this machine -- landing there meant re-picking the
            // current campaign on every open. Prefer the one last used, and
            // fall back to the most recently added (not the first) so a fresh
            // machine still opens on something current.
            const lastName: string = (await safeEvalTS("loadLastCampaign")) || "";
            let pick: Campaign | undefined;
            for (let i = 0; i < camps.length; i++) {
                if (camps[i].name === lastName) { pick = camps[i]; break; }
            }
            setSelectedCampaign(pick || camps[camps.length - 1]);
        }
    };

    // Remember the campaign for next time. Fire-and-forget and deliberately
    // NOT routed through safeEvalTS: a failure here is cosmetic, and that
    // helper would flip the whole panel into its "using mock data" banner
    // over a persistence call nobody asked about.
    const rememberCampaign = (camp: Campaign | null) => {
        if (!camp) return;
        try {
            Promise.resolve(evalTS("saveLastCampaign", camp.name)).catch(() => {});
        } catch (e) {
            /* no bridge (browser preview) -- nothing to remember */
        }
    };

    // --- When the selected campaign changes, rescan creatives ---------
    useEffect(() => {
        if (!selectedCampaign) {
            setCreatives([]);
            setCreativeCounts({});
            setCreativePreviews({});
            setThumbOverrides({});
            setSelectedCreative(null);
            return;
        }
        rememberCampaign(selectedCampaign);
        refreshCreatives(selectedCampaign);
        // Clear first: without this the previous campaign's banner stays on
        // screen through the async read, so switching campaigns briefly
        // shows the wrong artwork under the new title.
        setCampaignBanner("");
        (async () => {
            const pinned = await safeEvalTS("loadCampaignBanner", selectedCampaign.name);
            setCampaignBanner(typeof pinned === "string" ? pinned : "");
        })();
    }, [selectedCampaign]);

    // Report campaign changes upward so sibling tabs (Review Session) can
    // share the campaign context without duplicating the picker.
    useEffect(() => {
        onCampaignChange?.(selectedCampaign);
    }, [selectedCampaign, onCampaignChange]);

    const refreshCreatives = async (camp: Campaign) => {
        setLoadingCreatives(true);
        try {
            const names = await safeEvalTS("scanCreatives", camp.mastersRoot);
            setCreatives(names || []);
            setSelectedCreative(null);
            setRecords([]);
            setRenderMap({});

            const overrides = await safeEvalTS("loadThumbOverrides", camp.name);
            setThumbOverrides(overrides || {});

            // Counts (and a representative render for the card preview) are
            // fetched per-creative -- cheap given the file counts involved
            // (tens, not thousands), same assumption the ScriptUI version
            // made. Only the render's path is needed here, not its bytes --
            // scanning is just a directory listing/name match, so this
            // stays cheap regardless of how large the actual mp4s are.
            const counts: Record<string, number> = {};
            const previews: Record<string, string> = {};
            for (const name of names || []) {
                const recs = await safeEvalTS("scanMastersForCreative", camp.mastersRoot, name);
                counts[name] = (recs || []).length;
                const renders: RenderEntry[] = await safeEvalTS("scanRendersForCreative", camp.mastersRoot, name);
                const bestRender = pickPreviewRender(renders || []);
                if (bestRender) previews[name] = bestRender.path;
            }
            setCreativeCounts(counts);
            setCreativePreviews(previews);
        } finally {
            setLoadingCreatives(false);
        }
    };

    // --- When the selected creative changes, rescan masters + renders -
    useEffect(() => {
        if (!selectedCampaign || !selectedCreative) {
            setRecords([]);
            setRenderMap({});
            return;
        }
        (async () => {
            setLoadingVariants(true);
            try {
                const recs: MasterRecord[] = await safeEvalTS("scanMastersForCreative", selectedCampaign.mastersRoot, selectedCreative);
                const renders: RenderEntry[] = await safeEvalTS("scanRendersForCreative", selectedCampaign.mastersRoot, selectedCreative);
                const map: Record<string, string> = {};
                for (const r of renders || []) map[r.stem] = r.path;
                setRecords(recs || []);
                setRenderMap(map);
                // Set the chips from the masters we just got back, not when
                // the creative was clicked — at click time `recs` hasn't been
                // scanned yet, so there is nothing to count.
                setFilters(pickDefaultFilters(recs || []));
            } finally {
                setLoadingVariants(false);
            }
        })();
    }, [selectedCreative]);

    // --- Campaign management ------------------------------------------
    const handleNewCampaign = async () => {
        const name = await promptDialog("Campaign name (e.g. ODY_INTL_DIGITAL_Outdoor):", "");
        if (!name) return;
        if (campaigns.some((c) => c.name === name)) {
            await alertDialog(`A campaign named "${name}" already exists.`);
            return;
        }
        const mastersRoot = await safeEvalTS("selectMastersFolder");
        if (!mastersRoot) return;

        const result = await safeEvalTS("saveCampaign", name, mastersRoot);
        if (!result.success) {
            await alertDialog(result.error || "Could not save campaign.");
            return;
        }
        const newCamp = { name, mastersRoot };
        await refreshCampaigns();
        setSelectedCampaign(newCamp);
    };

    const handleRemoveCampaign = async () => {
        if (!selectedCampaign) return;
        if (!(await confirmDialog(`Remove campaign "${selectedCampaign.name}" from the OV Library?\n\nThis only removes it from this list. Nothing on disk is touched.`))) return;
        await safeEvalTS("removeCampaign", selectedCampaign.name);
        setSelectedCampaign(null);
        await refreshCampaigns();
    };

    // Share the selected campaign to the team library (aeft/team.ts). Same
    // one-click "push to shared file, colleagues pull on open" flow as effect
    // combos / Expressions Bank / custom tools -- so a campaign set up once
    // shows up on everyone's panel instead of each person adding it by hand.
    // Safe because the masters-root path lives on the shared NAS and resolves
    // the same on every studio Mac.
    const handleShareCampaign = async () => {
        if (!selectedCampaign) return;
        // The pinned banner travels with the campaign (per-creative thumbnails
        // deliberately do not — those are personal). Re-sharing an
        // already-shared campaign is the supported way to push a banner
        // pinned after the first share; teamShareCampaign updates that field.
        const payload = JSON.stringify({
            name: selectedCampaign.name,
            mastersRoot: selectedCampaign.mastersRoot,
            banner: campaignBanner || "",
        });
        const result = await safeEvalTS("teamShareCampaign", payload);
        if (result && result.success) {
            pushToast(result.message || "Shared with the team.", "success");
        } else if (result) {
            pushToast(result.error || "Could not share campaign.", "error");
        }
    };

    // --- Custom creative thumbnails --------------------------------------
    // --- Campaign hero banner --------------------------------------------
    // Pinned per campaign and SHARED with the team (unlike per-creative
    // thumbnails, which stay on this machine) -- see setCampaignBanner in
    // aeft/review.ts.
    const handleSetCampaignBanner = async () => {
        if (!selectedCampaign) return;
        const path = await safeEvalTS("selectCreativeThumbnail");
        if (!path) return;
        const result = await safeEvalTS("setCampaignBanner", selectedCampaign.name, path);
        if (result && result.success) {
            setCampaignBanner(path);
            pushToast("Campaign banner set. Share the campaign again to send it to the team.", "success");
        } else if (result) {
            pushToast(result.error || "Could not set the banner.", "error");
        }
    };
    const handleClearCampaignBanner = async () => {
        if (!selectedCampaign) return;
        if (!(await confirmDialog(`Reset "${selectedCampaign.name}" back to its automatic banner?`))) return;
        await safeEvalTS("clearCampaignBanner", selectedCampaign.name);
        setCampaignBanner("");
    };

    const handleSetCustomThumbnail = async (creativeName: string) => {
        if (!selectedCampaign) return;
        const path = await safeEvalTS("selectCreativeThumbnail");
        if (!path) return;
        const result = await safeEvalTS("setCreativeThumbnailOverride", selectedCampaign.name, creativeName, path);
        if (result && result.success) {
            setThumbOverrides((prev) => ({ ...prev, [creativeName]: path }));
        } else if (result) {
            pushToast(result.error || "Could not set custom thumbnail.", "error");
        }
    };
    const handleClearCustomThumbnail = async (creativeName: string) => {
        if (!selectedCampaign) return;
        if (!(await confirmDialog(`Reset "${creativeName}" back to its auto-detected thumbnail?`))) return;
        await safeEvalTS("clearCreativeThumbnailOverride", selectedCampaign.name, creativeName);
        setThumbOverrides((prev) => {
            const next = { ...prev };
            delete next[creativeName];
            return next;
        });
    };

    // --- File actions ---------------------------------------------------
    const handleImport = async (path: string) => {
        const result = await safeEvalTS("importFile", path);
        pushToast(
            result.success ? `Imported ${path.split("/").pop()?.split("\\").pop()}` : result.error || "Import failed",
            result.success ? "success" : "error"
        );
    };
    const handleReveal = async (path: string) => {
        await safeEvalTS("revealFile", path);
    };
    const handlePlay = (path: string) => {
        setPlayerPath(path);
    };
    // Side-by-side comparison comp: this render on the left, whatever the
    // user currently has selected in the Project panel (their own
    // localised render/comp) on the right, in a comp double this render's
    // width -- see createComparisonComp() in aeft.ts. No mock fallback for
    // this one (unlike import/reveal/play) since there's no meaningful
    // "success" to fake without a real Project panel selection to reflect.
    // Deliberately NOT routed through safeEvalTS -- that helper collapses
    // "no bridge" and "a real thrown ExtendScript exception" into the same
    // generic message, which is exactly what hid a real bug here the first
    // time this ran for real (see createComparisonComp()'s own fix note in
    // aeft.ts). result === undefined is the genuine no-bridge case
    // (browser preview); a caught exception's own .message is shown
    // otherwise, so a real error is visible instead of masked.
    const handleCompare = async (path: string, width: number, height: number) => {
        try {
            const result = await evalTS("createComparisonComp", path, width, height);
            if (result === undefined) {
                pushToast("No CEP bridge. Open inside After Effects to create a comparison comp.", "error");
                return;
            }
            pushToast(
                result.success ? "Comparison comp created." : result.error || "Could not create comparison comp.",
                result.success ? "success" : "error"
            );
        } catch (e: any) {
            pushToast(e && e.message ? e.message : "Could not create comparison comp.", "error");
        }
    };

    const toggleGroup = (key: string) => {
        setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    // --- Client-side sort + filter + group (instant, no bridge call needed) ---
    const visibleCreatives = creatives.slice().sort((a, b) => a.localeCompare(b));

    const variantSearchLower = variantSearch.trim().toLowerCase();
    const searchedRecords = records.filter((rec) => {
        if (!variantSearchLower) return true;
        const haystack = `${rec.group} ${rec.width}x${rec.height} ${rec.duration} ${rec.stem}`.toLowerCase();
        return haystack.includes(variantSearchLower);
    });

    const parseDurationNum = (d: string) => parseInt(d, 10) || 0;
    const sortRecords = (arr: MasterRecord[]) =>
        [...arr].sort((a, b) => {
            if (variantSort === "duration") {
                const diff = parseDurationNum(a.duration) - parseDurationNum(b.duration);
                if (diff !== 0) return diff;
            }
            return a.width - b.width || a.height - b.height || (a.duration < b.duration ? -1 : a.duration > b.duration ? 1 : 0);
        });

    const grouped: Record<OrientationKey, MasterRecord[]> = { LANDSCAPE: [], PORTRAIT: [], SQUARE: [], QUAD: [] };
    for (const rec of searchedRecords) {
        const key = rec.orientation as OrientationKey;
        if (filters[key] && grouped[key]) grouped[key].push(rec);
    }
    for (const key of ORIENTATION_ORDER) {
        grouped[key] = sortRecords(grouped[key]);
    }
    const totalVisible = ORIENTATION_ORDER.reduce((sum, k) => sum + grouped[k].length, 0);
    const anyVisible = totalVisible > 0;

    // Hero banner source: whatever the creatives grid would show as a
    // thumbnail for the currently selected creative, falling back to the
    // first visible creative with one -- same override-wins merge as
    // CreativeCard's own previewSrc, just picked once for the whole page
    // rather than per-card.
    const heroPreviewName = selectedCreative || visibleCreatives.find((n) => thumbOverrides[n] || creativePreviews[n]);
    const autoBannerSrc = heroPreviewName ? thumbOverrides[heroPreviewName] || creativePreviews[heroPreviewName] : undefined;
    // A pinned banner always wins, and is the whole point of pinning: the
    // automatic one changes as you click between creatives, so a campaign
    // has no settled identity until someone chooses its image.
    const heroBannerSrc = campaignBanner || autoBannerSrc;
    const heroBannerIsPinned = !!campaignBanner;

    return (
        <div className="ov-library">
            {hero ? (
                <div className="ov-hero">
                    <div
                        className="ov-hero-banner"
                        onMouseEnter={() => {
                            if (!selectedCampaign) return;
                            bannerHoldRef.current = setTimeout(() => setShowBannerOverride(true), 1000);
                        }}
                        onMouseLeave={() => {
                            if (bannerHoldRef.current) clearTimeout(bannerHoldRef.current);
                            setShowBannerOverride(false);
                        }}
                    >
                        {heroBannerSrc && isImageFile(heroBannerSrc) ? (
                            <img src={toFileUrl(heroBannerSrc)} alt="" />
                        ) : heroBannerSrc && heroBannerIsPinned ? (
                            // A PINNED banner is deliberately static — that is
                            // what pinning is for. A video file still gets
                            // parked on a frame rather than looping behind the
                            // title. No autoPlay, no loop.
                            <video
                                key={heroBannerSrc}
                                ref={heroVideoRef}
                                src={toFileUrl(heroBannerSrc)}
                                muted
                                playsInline
                                preload="metadata"
                                onLoadedMetadata={heroPoster.onLoadedMetadata}
                            />
                        ) : heroBannerSrc ? (
                            <video src={toFileUrl(heroBannerSrc)} muted loop autoPlay playsInline preload="metadata" />
                        ) : null}
                        <div className="ov-hero-overlay" />
                        {showBannerOverride && selectedCampaign && (
                            <button
                                className={heroBannerIsPinned ? "ov-hero-banner-override active" : "ov-hero-banner-override"}
                                title={
                                    heroBannerIsPinned
                                        ? "Change the campaign banner (right-click to reset)"
                                        : "Pin a campaign banner from a file"
                                }
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleSetCampaignBanner();
                                }}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (heroBannerIsPinned) handleClearCampaignBanner();
                                }}
                            >
                                <ImagePlus size={13} />
                            </button>
                        )}
                    </div>
                    <div className="ov-hero-bar">
                        <div className="ov-hero-info">
                            <span className="ov-hero-label">Campaign</span>
                            <Droplet
                                panelClassName="ov-campaign-panel"
                                trigger={({ toggle }) => (
                                    <button className="ov-hero-title-btn" onClick={toggle}>
                                        <h2>{selectedCampaign?.name || "Select a campaign"}</h2>
                                        <ChevronDown size={16} />
                                    </button>
                                )}
                            >
                                {(close) => (
                                    <div className="ov-campaign-list">
                                        {campaigns.length === 0 && <p className="empty">No campaigns yet.</p>}
                                        {campaigns.map((c) => (
                                            <button
                                                key={c.name}
                                                className={c.name === selectedCampaign?.name ? "ov-campaign-item active" : "ov-campaign-item"}
                                                onClick={() => {
                                                    // Picking a campaign is the explicit "show me this"
                                                    // action, so it drops the host's cached folder scans.
                                                    // That makes re-selecting the campaign you are already
                                                    // on a refresh — the escape hatch for files added on
                                                    // disk while the panel sat open.
                                                    try {
                                                        Promise.resolve(evalTS("invalidateOvLibraryCache")).catch(() => {});
                                                    } catch (e) {
                                                        /* no bridge */
                                                    }
                                                    setSelectedCampaign(c);
                                                    close();
                                                }}
                                            >
                                                {c.name}
                                            </button>
                                        ))}
                                        <div className="ov-campaign-divider" />
                                        <button className="ov-campaign-action" onClick={() => { close(); handleNewCampaign(); }}>
                                            <FolderPlus size={13} /> New Campaign…
                                        </button>
                                        {selectedCampaign && (
                                            <button className="ov-campaign-action" onClick={() => { close(); handleShareCampaign(); }}>
                                                <Users size={13} /> Share "{selectedCampaign.name}" with team
                                            </button>
                                        )}
                                        {selectedCampaign && (
                                            <button className="ov-campaign-action ov-campaign-action--danger" onClick={() => { close(); handleRemoveCampaign(); }}>
                                                <Trash2 size={13} /> Remove "{selectedCampaign.name}"
                                            </button>
                                        )}
                                    </div>
                                )}
                            </Droplet>
                        </div>
                    </div>
                    {usingMock && <span className="ov-hero-mock-pill">Mock data, no CEP bridge</span>}
                </div>
            ) : (
                <>
                    <h2>OV Library: Masters &amp; Renders</h2>
                    {usingMock && (
                        <div className="mock-banner">
                            Preview mode. No CEP bridge detected, showing mock data. Real scans, imports, and file
                            actions are not happening. See CLAUDE.md "Testing" section.
                        </div>
                    )}
                    <p className="hint">
                        Creatives and sizes
                        are detected automatically from the WxH_duration naming convention.
                    </p>

                    <div className="campaign-row">
                        <label>Campaign:</label>
                        <select
                            value={selectedCampaign?.name || ""}
                            onChange={(e) => setSelectedCampaign(campaigns.find((c) => c.name === e.target.value) || null)}
                        >
                            <option value="" disabled>
                                Select a campaign
                            </option>
                            {campaigns.map((c) => (
                                <option key={c.name} value={c.name}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                        <Tooltip text="New Campaign">
                            <button className="campaign-btn--primary" onClick={handleNewCampaign}>
                                <FolderPlus size={14} /> New
                            </button>
                        </Tooltip>
                        <Tooltip text="Refresh">
                            <button
                                className="campaign-btn--icon"
                                onClick={() => selectedCampaign && refreshCreatives(selectedCampaign)}
                            >
                                <RefreshCw size={14} className={loadingCreatives ? "spin" : ""} />
                            </button>
                        </Tooltip>
                        <Tooltip text="Remove Campaign">
                            <button className="campaign-btn--icon" onClick={handleRemoveCampaign}>
                                <Trash2 size={14} />
                            </button>
                        </Tooltip>
                    </div>
                </>
            )}

            <div className="creatives-section">
                <div className="creatives-grid">
                    {loadingCreatives &&
                        Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
                    {!loadingCreatives && visibleCreatives.length === 0 && <p className="empty-row">No creative folders found.</p>}
                    {!loadingCreatives &&
                        visibleCreatives.map((name) => (
                            <CreativeCard
                                key={name}
                                name={name}
                                count={creativeCounts[name]}
                                previewSrc={thumbOverrides[name] || creativePreviews[name]}
                                selected={name === selectedCreative}
                                hasCustomThumbnail={!!thumbOverrides[name]}
                                onSelect={() => {
                                    // No filter reset here on purpose: the
                                    // scan effect sets the chips from this
                                    // creative's own masters once they land.
                                    // Resetting here too would flash a
                                    // different set for a frame first.
                                    setSelectedCreative(name);
                                }}
                                onSetCustomThumbnail={handleSetCustomThumbnail}
                                onClearCustomThumbnail={handleClearCustomThumbnail}
                            />
                        ))}
                </div>
            </div>

            <div className="variants-section">
                <h3>{selectedCreative || "Select a creative"}</h3>

                <div className="filter-row">
                    {ORIENTATION_ORDER.map((key) => {
                        const OrientIcon = ORIENTATION_ICON[key];
                        return (
                            <button
                                key={key}
                                className={filters[key] ? "filter-chip active" : "filter-chip"}
                                onClick={() => setFilters({ ...filters, [key]: !filters[key] })}
                            >
                                <OrientIcon size={12} />
                                {key.charAt(0) + key.slice(1).toLowerCase()}
                            </button>
                        );
                    })}
                </div>

                {selectedCreative && (
                    <div className="variant-toolbar">
                        <div className="search-box">
                            <Search size={12} />
                            <input
                                type="text"
                                placeholder="Filter by size, duration, name…"
                                value={variantSearch}
                                onChange={(e) => setVariantSearch(e.target.value)}
                            />
                            {variantSearch && (
                                <Tooltip text="Clear">
                                    <button className="clear-search" onClick={() => setVariantSearch("")}>
                                        <X size={12} />
                                    </button>
                                </Tooltip>
                            )}
                        </div>
                        <Tooltip text={variantSort === "size" ? "Sorted by size. Click to sort by duration" : "Sorted by duration. Click to sort by size"}>
                            <button
                                className="sort-toggle"
                                onClick={() => setVariantSort(variantSort === "size" ? "duration" : "size")}
                            >
                                <ArrowUpDown size={12} />
                                {variantSort === "size" ? "Size" : "Duration"}
                            </button>
                        </Tooltip>
                        <span className="result-count">
                            {totalVisible} of {records.length}
                        </span>
                    </div>
                )}

                <div className="variant-scroll">
                    {loadingVariants &&
                        Array.from({ length: 3 }).map((_, i) => <SkeletonVariantBlock key={i} />)}
                    {!loadingVariants && selectedCreative && !anyVisible && <p className="empty">No masters match the current filters.</p>}
                    {!loadingVariants &&
                        ORIENTATION_ORDER.map((key) => {
                            if (grouped[key].length === 0) return null;
                            const collapsed = !!collapsedGroups[key];
                            const OrientIcon = ORIENTATION_ICON[key];
                            return (
                                <div key={key} className="orientation-group">
                                    <h4 onClick={() => toggleGroup(key)}>
                                        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                        <OrientIcon size={13} />
                                        {key} ({grouped[key].length})
                                    </h4>
                                    {!collapsed &&
                                        grouped[key].map((rec) => (
                                            <VariantBlock
                                                key={rec.stem}
                                                rec={rec}
                                                renderPath={renderMap[rec.stem]}
                                                onImport={handleImport}
                                                onReveal={handleReveal}
                                                onPlay={handlePlay}
                                                onCompare={handleCompare}
                                            />
                                        ))}
                                </div>
                            );
                        })}
                </div>

                {/* Master check — sits under the masters because that's what it
                    checks, and it checks the WHOLE campaign, not the creative
                    currently selected above. The report deliberately opens in a
                    browser rather than in here: it's a wide table meant for a
                    sign-off read, and the panel is a narrow dock. */}
                {selectedCampaign && (
                    <div className="master-check">
                        <div className="master-check-row">
                            <div className="master-check-text">
                                <strong>Check the masters</strong>
                                <span>
                                    Reads every master in {selectedCampaign.name} and reports size,
                                    duration, missing footage and layer differences. Opens in your browser.
                                </span>
                            </div>
                            <button
                                className="master-check-btn"
                                disabled={checkBusy}
                                onClick={runCheck}
                            >
                                {checkBusy ? <RefreshCw size={13} className="spin" /> : <ClipboardCheck size={13} />}
                                {checkBusy ? "Checking…" : "Run check"}
                            </button>
                        </div>
                        {checkNote && <p className="master-check-note">{checkNote}</p>}
                    </div>
                )}
            </div>

            <div className="toast-stack">
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
                            <button onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
                                <X size={12} />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {playerPath && <VideoPlayerModal path={playerPath} onClose={() => setPlayerPath(null)} />}
        </div>
    );
};

export default OVLibraryTool;