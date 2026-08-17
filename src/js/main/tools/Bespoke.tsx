// =============================================================================
// src/js/main/tools/Bespoke.tsx
// -----------------------------------------------------------------------------
// BESPOKE -- deliverables that aren't one master.
//
// Named for where it is going, not for what it does first. Every other localise
// path answers "which single master fits this row"; the ones that land here are
// the rows where that question has no answer. MultipleArt is the first, and the
// section is deliberately general so the next kind doesn't need a rename -- a
// tool id can't be changed once it ships without orphaning whatever is saved
// under it.
//
// THE MODEL, and it is the whole design: a row is a list of SEGMENTS played in
// order, and each segment is a list of masters laid ACROSS the canvas. That one
// shape covers tiling (one segment, several masters), sequencing (several
// segments, one master each) and the real case -- three portrait panels filling
// a 3240x1920 METROBUS, then a different creative as an endcard, which is both
// at once.
//
// A normal single-master row is one segment holding one master, which is
// today's behaviour expressed in the new shape rather than a special case.
//
// ASSEMBLY INTO AE IS NOT WIRED YET, on purpose. How masters are placed --
// scaled to their panel, or laid in at native size with the canvas built around
// them -- decides whether a size mismatch is a harmless scale or a soft
// deliverable, and that is a studio decision rather than a coding one. The
// composition is designed, checked and saved here; building it is the next
// step. Shipping a Build button that guessed would be worse than not having one.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, ChevronRight, Copy, Globe2, Layers, LayoutGrid, Library, Plus, RectangleHorizontal, RectangleVertical, RefreshCw, RotateCcw, Square as SquareIcon, Trash2, X } from "lucide-react";
import { csi, evalTS } from "../../lib/utils/bolt";
import { deriveMastersFromMarkets } from "../lib/mastersRoot";
import { usePosterFrame, pickPreviewRender, isImageFile, type RenderEntry } from "../lib/renderPreview";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import Dropdown from "../Dropdown";
import CheckboxToggle from "../CheckboxToggle";
import LoadingChatter from "../LoadingChatter";
import ScreenLibrary, { ScreenEntry } from "./ScreenLibrary";
import "../shared.scss";
import "./Bespoke.scss";

/** Mirrors aeft/localise.ts's BespokeMaster. */
interface BespokeMaster {
    path: string;
    name: string;
    creative: string;
    artwork: string;
    site: string;
    size: string;
    width: number;
    height: number;
    duration: string;
    territory: string;
    film: string;
    region: string;
    orientation: string;
}

interface Campaign { name: string; marketsRoot: string; reachable?: boolean }

/** OV Library's four, same order and same icons, so the two read alike. */
type OrientationKey = "LANDSCAPE" | "PORTRAIT" | "SQUARE" | "QUAD";
const ORIENTATION_ORDER: OrientationKey[] = ["LANDSCAPE", "PORTRAIT", "SQUARE", "QUAD"];
const ORIENTATION_ICON: Record<OrientationKey, React.ComponentType<{ size?: number }>> = {
    LANDSCAPE: RectangleHorizontal,
    PORTRAIT: RectangleVertical,
    SQUARE: SquareIcon,
    QUAD: LayoutGrid,
};

/**
 * One master in the picker.
 *
 * The list used to be full-width rows of "PortalToParadise", twenty of them,
 * with the size — the only thing that actually differed — set small at the far
 * right. The shape IS the information here, so the card leads with a proxy
 * drawn at the master's true ratio: a 5760x1440 strip and a 1080x1920 portrait
 * are told apart at a glance, before reading a single number.
 *
 * The proxy is sized in JS rather than CSS because aspect-ratio is Chrome 88
 * and this builds for chrome74 — and the padding-box trick can't express
 * "fit inside a square box either way round" without a wrapper per case.
 */
const MasterCard: React.FC<{
    master: BespokeMaster;
    /** What tells this master apart from its siblings — see distinguish(). */
    label: string;
    /** Its render, if one was found beside it. "" means show the proxy. */
    preview: string;
    swapping: boolean;
    used: number;
    onPick: () => void;
}> = ({ master, label, preview, swapping, used, onPick }) => {
    const BOX = 38;
    const aspect = master.width && master.height ? master.width / master.height : 1;
    const pw = aspect >= 1 ? BOX : Math.max(4, BOX * aspect);
    const ph = aspect >= 1 ? Math.max(4, BOX / aspect) : BOX;
    const tint = hueFor(master.creative || master.name);

    // THE FRAME ITSELF, WHERE THERE IS ONE. A master is an .aep with no
    // thumbnail, so this card used to be a grey rectangle whose only content
    // was the aspect ratio -- which the size label directly beneath it already
    // states. The proxy was therefore saying nothing, and the one thing needed
    // to choose between two masters of the same creative (what the artwork
    // looks like) was absent, in a panel where OV Library shows exactly that
    // for exactly these files.
    //
    // A render that cannot be decoded falls back to the proxy rather than to an
    // empty black box: `preload="metadata"` means a broken source usually
    // errors before a frame is ever wanted, and 25 cards of black would be
    // worse than the grey rectangle this replaces.
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [broken, setBroken] = useState(false);
    const poster = usePosterFrame(videoRef, () => {});
    const showPreview = !!preview && !broken;
    const asImage = showPreview && isImageFile(preview);

    const play = () => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = 0;
        v.play().catch(() => { /* autoplay refused -- the poster frame stands */ });
    };

    return (
        // THE WHOLE FILENAME, ON HOVER. The card shows a fragment of the name,
        // the size and the duration, each ellipsised into its track -- the right
        // summary, and no help at all when two masters differ somewhere further
        // along the name. Replaces a native `title`, which never appeared here.
        //
        // `grow` is REQUIRED, unlike the creative rail. This button is a GRID
        // CELL, and Tooltip's wrapper otherwise hugs its content and lets the
        // card shrink out of its track (CLAUDE.md's stretch-sized trap).
        <Tooltip text={master.name} delay={220} grow>
        <button
            className={"bsp-master" + (swapping ? " is-swap" : "") + (used > 0 ? " is-used" : "")}
            onClick={onPick}
            onMouseEnter={showPreview && !asImage ? play : undefined}
            onMouseLeave={showPreview && !asImage ? poster.restToPoster : undefined}
        >
            {showPreview ? (
                <span className="bsp-master-thumb">
                    {asImage ? (
                        <img src={fileUrl(preview)} alt="" onError={() => setBroken(true)} />
                    ) : (
                        <video
                            ref={videoRef}
                            src={fileUrl(preview)}
                            muted
                            playsInline
                            loop
                            preload="metadata"
                            onLoadedMetadata={poster.onLoadedMetadata}
                            onSeeked={poster.onSeeked}
                            onLoadedData={poster.onLoadedData}
                            onError={() => setBroken(true)}
                        />
                    )}
                    {used > 0 && <span className="bsp-master-used">{used > 1 ? `×${used}` : "✓"}</span>}
                </span>
            ) : (
                <span className="bsp-master-proxy">
                    <span style={{ width: `${pw}px`, height: `${ph}px`, background: tint }} />
                    {/* ALREADY ON THE CANVAS. Twenty near-identical cards and no
                        memory of which have been placed is how a region gets added
                        twice, or a master gets missed entirely on a board with
                        eight of them. */}
                    {used > 0 && <span className="bsp-master-used">{used > 1 ? `×${used}` : "✓"}</span>}
                </span>
            )}
            <span className="bsp-master-size">{master.size || "?"}</span>
            <span className="bsp-master-meta">
                {/* NOT the creative. Inside a chosen creative every card would
                    print the same word the rail is already showing, on the one
                    full-width readable line the card has. */}
                <span className="bsp-master-name">{label}</span>
                <span className="bsp-master-dur">{master.duration ? `${master.duration}s` : "?"}</span>
            </span>
        </button>
        </Tooltip>
    );
};

/**
 * ONE FRAME OF THE MASTER, INSIDE THE REGION ITSELF.
 *
 * The board was flat colour blocks, so a layout of four panels told you where
 * things sat and nothing about whether it read -- which is the actual question
 * being answered on a bespoke screen. The render is already fetched for the
 * picker, so this costs one more element per region and no extra I/O.
 *
 * Deliberately STILL: no autoplay, no hover-play. Four videos looping under a
 * board being dragged on is noise, and the still frame is what a layout is
 * judged against anyway.
 *
 * THE GEOMETRY MATCHES THE BUILD, which is the whole point of showing it:
 *   - object-fit: cover, the same "fill the window and trim the excess" the
 *     matte does host-side;
 *   - at 90/270 the box is SWAPPED (width becomes the region's height as a
 *     percentage, and vice versa) and then rotated about its centre, which is
 *     exactly bespokeBuildRegions' faceW/faceH swap before the cover scale.
 * Anything else here would be a picture of a layout nobody is going to get.
 */
const RegionShot: React.FC<{ src: string; rotation: number; w: number; h: number }> = ({
    src, rotation, w, h,
}) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [broken, setBroken] = useState(false);
    const poster = usePosterFrame(videoRef, () => {});
    if (!src || broken) return null;

    const turned = rotation === 90 || rotation === 270;
    return (
        <span className="bsp-region-clip">
            <span
                className="bsp-region-shot"
                style={{
                    width: turned ? `${(h / Math.max(1, w)) * 100}%` : "100%",
                    height: turned ? `${(w / Math.max(1, h)) * 100}%` : "100%",
                    transform: `translate(-50%, -50%) rotate(${rotation || 0}deg)`,
                }}
            >
                {isImageFile(src) ? (
                    <img src={fileUrl(src)} alt="" onError={() => setBroken(true)} />
                ) : (
                    <video
                        ref={videoRef}
                        src={fileUrl(src)}
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={poster.onLoadedMetadata}
                        onSeeked={poster.onSeeked}
                        onLoadedData={poster.onLoadedData}
                        onError={() => setBroken(true)}
                    />
                )}
            </span>
        </span>
    );
};

/**
 * WHAT TELLS A GROUP OF MASTERS APART.
 *
 * Sibling masters share nearly all of their name: campaign, creative, artwork
 * type, often a site. Printing the whole stem in a 150px track shows only the
 * shared half and ellipsises away the half that differs, and printing the
 * CREATIVE (which is what this did) repeats what the rail beside it already
 * says. Neither lets you tell two cards apart.
 *
 * So: drop the leading and trailing name tokens that EVERY master in the group
 * shares, and keep the rest. The tokens are underscore-separated per the studio
 * convention, and the comparison is per whole token -- a character-level common
 * prefix would cut a name mid-word.
 *
 * Returns how many tokens to drop from each end; distinguish() applies it.
 */
function commonTokenEdges(stems: string[]): { pre: number; suf: number } {
    if (!stems || stems.length < 2) return { pre: 0, suf: 0 };
    const split: string[][] = [];
    for (const s of stems) split.push(String(s).split("_"));
    const shortest = split.reduce((n, t) => Math.min(n, t.length), Infinity);

    let pre = 0;
    while (pre < shortest && split.every((t) => t[pre] === split[0][pre])) pre++;

    let suf = 0;
    while (
        suf < shortest - pre &&
        split.every((t) => t[t.length - 1 - suf] === split[0][split[0].length - 1 - suf])
    ) suf++;

    return { pre, suf };
}

// The size and the duration have their OWN fields on every card and tile, so a
// token that only restates one of them is noise here. Both naming conventions,
// per the masters rule: size with or without "px", duration as "s" or "sec".
const SIZE_TOKEN = /^\d+x\d+(px)?$/i;
const DURATION_TOKEN = /^\d+(s|sec)$/i;

/** Applies commonTokenEdges to one stem. "" when nothing is left to say. */
function distinguish(stem: string, edges: { pre: number; suf: number }): string {
    const bits = String(stem).split("_");
    const kept = bits.slice(edges.pre, bits.length - edges.suf)
        .filter((t) => !SIZE_TOKEN.test(t) && !DURATION_TOKEN.test(t));
    return kept.join("_");
}

/** Below this a region collapses and can never be grabbed again. */
const MIN_REGION = 24;

/**
 * An fs path as a `file://` URL the panel can actually load.
 *
 * A RAW PATH IS NOT A URL. `file:///Volumes/…/Tower Ref.jpg` fails in Chromium
 * the moment the path contains a space, a `#` or an accent -- and these are NAS
 * paths written by artists, so most of them do. References pulled out of a
 * template were silently showing as broken images for exactly this reason.
 *
 * encodeURI, not encodeURIComponent: the slashes must survive. Anything
 * already encoded is decoded first so a double pass cannot turn %20 into %2520.
 */
const fileUrl = (fsPath: string): string => {
    if (!fsPath) return "";
    let raw = fsPath;
    try {
        raw = decodeURI(fsPath);
    } catch {
        // Not valid percent-encoding -- a literal % in the name. Use it as-is.
    }
    return "file://" + encodeURI(raw).replace(/#/g, "%23").replace(/\?/g, "%3F");
};

/**
 * One definition, in ScreenLibrary.tsx, which is the thing that has to know
 * about both kinds of entry. This file only ever writes layouts, so it keeps
 * the old name and lets the optional fields default.
 */
type BespokeTemplate = ScreenEntry;

interface Region {
    id: number;
    master: BespokeMaster;
    x: number;
    y: number;
    w: number;
    h: number;
    /**
     * Quarter turns only -- 0, 90, 180, 270. Bespoke screens are sometimes fed
     * a master turned on its side, and the studio only ever does right angles,
     * so this stays an enumeration rather than a free angle: anything else
     * would leave the region no longer axis-aligned with its own crop.
     */
    rotation: number;
}

interface Segment {
    id: number;
    /** Laid across the canvas, left to right. */
    tiles: BespokeMaster[];
    seconds: number;
}

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

/** Colour per creative, so the same artwork reads the same across the frame. */
const TILE_HUES = ["#2f6f63", "#4a5f8a", "#7a5a86", "#8a6440", "#3f6b7a", "#6f7a3f"];
function hueFor(creative: string): string {
    let n = 0;
    for (let i = 0; i < creative.length; i++) n = (n * 31 + creative.charCodeAt(i)) >>> 0;
    return TILE_HUES[n % TILE_HUES.length];
}

const MAX_MATCHES = 40;
let nextSegId = 1;



export const BespokeTool = () => {
    const reduced = useReducedMotion();

    // THE MASTERS FOLDER IS NOT A QUESTION THIS TOOL ASKS ANY MORE.
    //
    // It followed the campaign all along -- the artist picks PP3 in "where it
    // lands" and then had to go and find PP3's masters by hand at the top of
    // the same screen, which is the same answer typed twice and one more place
    // for them to disagree. It is now DERIVED from whichever campaign is
    // selected, exactly as the localise screen derives it, and the manual pick
    // survives only as an escape hatch for when derivation finds nothing.
    const [mastersPath, setMastersPath] = useState("");
    // Set once the artist overrides the derived folder by hand, so the next
    // campaign-driven derive doesn't quietly pull it back.
    const [mastersPinned, setMastersPinned] = useState(false);
    // OV LIBRARY'S SEPARATE CAMPAIGN STORE -- `loadCampaigns`, which carries a
    // mastersRoot outright. A DIFFERENT store from loadLocLibCampaigns below:
    // that one carries a marketsRoot and answers "where does the build land".
    // Only consulted as the second guess, by name, when a campaign's Markets
    // root has no Masters sibling to derive from.
    const [mastersCampaigns, setMastersCampaigns] = useState<{ name: string; mastersRoot: string }[]>([]);
    const [masters, setMasters] = useState<BespokeMaster[] | null>(null);
    // How many .aeps the walk found OUTSIDE `AE/` and therefore left out. Shown,
    // not swallowed: a shelf that is quietly narrower than the folder is the
    // thing that sends someone hunting for a master that is right there.
    const [outsideAE, setOutsideAE] = useState(0);
    // Master stem (lower-cased) -> the best render found beside it. Empty is a
    // normal state, not a failure: it just means grey proxies.
    const [renders, setRenders] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [report, setReport] = useState<string | null>(null);
    const [building, setBuilding] = useState(false);

    // The deliverable being composed. Canvas and runtime come from the row this
    // is being built for; typed by hand until the row picker is wired.
    //
    // 2000x1000 is a DELIBERATELY SMALL, DELIBERATELY NEUTRAL starting board.
    // It was 3240x1920, which is a real screen (a three-panel metrobus) -- and
    // that was the problem twice over: it drew a big working area before anyone
    // had said what they were building, and being a plausible size it could be
    // mistaken for one that had been set rather than defaulted. A round 2:1
    // reads as a placeholder.
    const [canvasW, setCanvasW] = useState("2000");
    const [canvasH, setCanvasH] = useState("1000");
    const [runtime, setRuntime] = useState("10");

    // WHERE IT LANDS. Same three answers Build a Batch asks for, and the same
    // convention underneath: <marketsRoot>/<territory>/AE/<batch>.
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [campaign, setCampaign] = useState("");
    const [territories, setTerritories] = useState<string[]>([]);
    const [territory, setTerritory] = useState("");
    const [batch, setBatch] = useState("Batch_1");
    // The media site, same field Build a Batch offers. Blank is legitimate and
    // produces a name with no site token at all.
    const [site, setSite] = useState("");
    const [siteTouched, setSiteTouched] = useState(false);
    // Shared by default: most of the time every panel of a master is the same
    // creative, so editing it once should show up everywhere. Duplicating is
    // the opt-in, for when panels genuinely need to differ.
    const [duplicatePanels, setDuplicatePanels] = useState(false);

    // TWO MODES. Multi Art is the equal-panel tiling that ships today; Bespoke
    // places a master anywhere on the canvas, traced over the deliverable's own
    // reference JPG. They share everything except the placement.
    // UNSET until chosen. Which kind of build this is gets decided once per
    // deliverable and never revisited, so it is a question asked at the door
    // rather than a switch sat permanently above the work.
    const [mode, setMode] = useState<"multi" | "regions" | null>(null);
    const [regions, setRegions] = useState<Region[]>([]);
    const [selRegion, setSelRegion] = useState(0);
    const [refPath, setRefPath] = useState("");
    // EVERY REFERENCE IN THE PICKED FOLDER, because one job is many bespoke
    // deliverables and they sit side by side. Each has its OWN canvas and its
    // own regions -- a 3840x2816 board and a 13536x3072 ceiling share nothing
    // but the campaign -- so the layouts are kept per reference path and
    // restored on the way back, rather than carried across and quietly wrong.
    const [refs, setRefs] = useState<{ path: string; name: string }[]>([]);
    // Which region is waiting for a replacement master, or -1. Swapping keeps
    // the region's coordinates, so a placement traced by eye is not lost just
    // because the master in it turned out to be the wrong length.
    const [swapTarget, setSwapTarget] = useState(-1);
    // Which ruler is selected, so it can be typed rather than dragged. Dragging
    // is fine for roughing a line in and useless for landing it on 2380.
    const [selGuide, setSelGuide] = useState<{ axis: "x" | "y"; i: number } | null>(null);
    const [destOpen, setDestOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    // Saved layouts. The screen is the stable thing; the campaign is what
    // changes -- see bespokeTemplateSave in team.ts.
    const [templates, setTemplates] = useState<BespokeTemplate[]>([]);
    const [saving, setSaving] = useState(false);
    const [tplName, setTplName] = useState("");
    const [layouts, setLayouts] = useState<Record<string, { regions: Region[]; guidesX: number[]; guidesY: number[] }>>({});
    const [libraryOpen, setLibraryOpen] = useState(false);
    // Candidate references pulled out of a template, best first. More than one
    // because picking the right in-situ image out of an .aep is a heuristic:
    // it lands on a camera roll JPG or a screenshot often enough that the
    // artist has to be able to step to the next one.
    const [refAlts, setRefAlts] = useState<string[]>([]);
    // Set when the current reference will not paint -- a path that has moved,
    // or a format Chromium cannot decode. Distinguishing the two matters:
    // "next candidate" fixes one and nothing fixes the other.
    const [refBroken, setRefBroken] = useState(false);
    // WHICH LIBRARY SCREEN THE BOARD CAME FROM, whole -- not just its id.
    // Saving needs its TERRITORY and NAME, because the country in "Where it
    // lands" is a different thing (see saveTemplate) and is usually unset.
    const [activeScreen, setActiveScreen] = useState<{ id: string; territory: string; name: string } | null>(null);
    // Not "is it empty" -- "did the read work at all". See refreshTemplates.
    const [libraryReadable, setLibraryReadable] = useState(false);
    // Constraints while dragging a corner. Ratio keeps a region from ever
    // introducing a crop it did not have; locking a side is for the common case
    // of a panel that must stay the full height or width of the screen.
    const [refMismatch, setRefMismatch] = useState("");
    // Rulers. Region edges snap to these while dragging, which is how you sit a
    // master exactly between two lines rather than nearly between them.
    const [guidesX, setGuidesX] = useState<number[]>([]);
    const [guidesY, setGuidesY] = useState<number[]>([]);
    const [lockRatio, setLockRatio] = useState(true);
    const stageRef = React.useRef<HTMLDivElement>(null);
    // Width of the area the board sits in, measured. Needed because the stage
    // is sized with the padding-box trick (height:0 + padding-bottom:%), so its
    // HEIGHT is a function of its WIDTH -- and a 768x3408 shopfront therefore
    // came out 443% of the panel width tall, which is the endless scroll.
    // Capping the height means capping the width, and that needs pixels.
    const stageWrapRef = React.useRef<HTMLDivElement>(null);
    const [stageWrapW, setStageWrapW] = useState(0);
    const dragRef = React.useRef<{ handle: string; sx: number; sy: number; box: DOMRect; start: Region } | null>(null);
    // The folder is a country NAME ("Germany"); the filename wants its code.
    // Resolved by the host's own getTerritoryCountryCode rather than guessed
    // here -- a wrong code on a deliverable is the bug that shipped BELGIUM
    // GERMAN, and there is no reason to have two answers to one question.
    const [territoryCode, setTerritoryCode] = useState("");
    const [outName, setOutName] = useState("");
    const [nameTouched, setNameTouched] = useState(false);

    const [segments, setSegments] = useState<Segment[]>([{ id: 0, tiles: [], seconds: 10 }]);
    const [current, setCurrent] = useState(0);

    // FILTERS, in OV Library's shape: pick a creative, then narrow by
    // orientation. A flat search box over 200 filenames was the thing that made
    // this feel unlike the rest of the app -- you had to already know the name.
    const [creative, setCreative] = useState("");
    // EXCLUSIVE, not a set of checkboxes. Additive orientation filters meant
    // clicking Landscape while Portrait was already on showed BOTH, so the
    // control did the opposite of what pressing it looks like it should do --
    // you had to notice the stale pill and turn it off first. One at a time;
    // clicking the active one clears it back to everything. "" is no filter.
    const [orient, setOrient] = useState<OrientationKey | "">("");
    // Once the artist picks an orientation themselves, the automatic guess
    // stands down for good -- same contract as nameTouched. A filter that keeps
    // re-deciding what you just decided is worse than no filter.
    const [orientTouched, setOrientTouched] = useState(false);
    const [durFilter, setDurFilter] = useState("");

    // --- masters -----------------------------------------------------------
    const load = useCallback(async (root: string) => {
        if (!root) return;
        setLoading(true);
        setStatus(null);
        try {
            const res = (await evalTS("bespokeListMasters", root)) as unknown as
                { success: boolean; error?: string; masters?: BespokeMaster[]; outsideAE?: number } | undefined;
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) {
                setStatus({ text: res.error || "Couldn't read the masters folder.", type: "error" });
                // An unreadable folder must not wipe a list already on screen --
                // "couldn't ask" and "there are none" are different answers.
                return;
            }
            setMasters(res.masters || []);
            setOutsideAE(res.outsideAE || 0);

            // THE RENDERS, for the card thumbnails. A separate, QUIET call:
            // previews are decoration, so a campaign with no Renders tree, or a
            // share that drops out between the two calls, must leave the shelf
            // exactly as it is rather than reporting anything. Keyed by stem
            // because that is the master<->render pairing the studio uses, and
            // lower-cased because only the .aep side's case is guaranteed.
            //
            // scanAllRenders is campaign-wide in one walk, which is the whole
            // reason this is one call and not one per creative.
            try {
                const found = (await evalTS("scanAllRenders", root)) as unknown as RenderEntry[] | undefined;
                if (found && found.length) {
                    const byStem: Record<string, RenderEntry[]> = {};
                    for (const r of found) {
                        const k = String(r.stem).toLowerCase();
                        (byStem[k] = byStem[k] || []).push(r);
                    }
                    const best: Record<string, string> = {};
                    // pickPreviewRender, not the first hit: a stem can have both
                    // a ProRes MOV Chromium cannot decode and the MP4 it can.
                    for (const k in byStem) {
                        const pick = pickPreviewRender(byStem[k]);
                        if (pick) best[k] = pick.path;
                    }
                    setRenders(best);
                }
            } catch {
                /* no renders, or no share -- the cards fall back to the proxy */
            }
            if (!res.masters || res.masters.length === 0) {
                // A folder with .aeps in it that are all OUTSIDE `AE/` is a
                // different problem from an empty one, and saying "no masters"
                // to someone looking at a folder full of them is how a wrong
                // folder gets picked next. Name what was skipped and why.
                setStatus({
                    text: res.outsideAE
                        ? `No masters under AE/ in that folder — ${res.outsideAE} .aep${res.outsideAE === 1 ? "" : "s"} sit outside it and aren't motion masters.`
                        : "No masters found in that folder.",
                    type: "error",
                });
            }
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const saved = await evalTS("csvLocaliserLoadLastPath");
                if (typeof saved === "string" && saved) {
                    setMastersPath(saved);
                    load(saved);
                }
            } catch {
                /* no bridge -- the folder button still works */
            }
        })();
    }, [load]);

    // Campaigns, then that campaign's territories -- the same two host calls
    // the localiser makes, so the two always offer the same list.
    useEffect(() => {
        (async () => {
            try {
                const camps = (await evalTS("loadLocLibCampaigns")) as unknown as Campaign[] | undefined;
                if (camps && camps.length) {
                    setCampaigns(camps);
                    const last = await evalTS("csvLocaliserLoadLastCampaign");
                    const pick = typeof last === "string" && last
                        && camps.some((c) => c.name === last) ? last : camps[0].name;
                    setCampaign(pick);
                }
            } catch {
                /* no bridge -- the composer still works, it just can't file it */
            }
        })();
    }, []);

    const marketsRoot = useMemo(
        () => campaigns.find((c) => c.name === campaign)?.marketsRoot || "",
        [campaigns, campaign]
    );

    useEffect(() => {
        if (!marketsRoot) { setTerritories([]); return; }
        (async () => {
            try {
                const terrs = (await evalTS("scanTerritories", marketsRoot)) as unknown as string[] | undefined;
                setTerritories(terrs || []);
                // An unreachable share is a normal state, not an error -- leave
                // whatever was chosen rather than clearing it.
                if (terrs && terrs.length && !terrs.some((t) => t === territory)) setTerritory("");
            } catch {
                setTerritories([]);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [marketsRoot]);

    useEffect(() => {
        if (!territory) { setTerritoryCode(""); return; }
        (async () => {
            try {
                const code = await evalTS("getTerritoryCountryCode", territory);
                setTerritoryCode(typeof code === "string" ? code : "");
            } catch {
                setTerritoryCode("");
            }
        })();
    }, [territory]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const camps = await evalTS("loadCampaigns");
                if (!cancelled && camps && camps.length) {
                    setMastersCampaigns(camps as unknown as { name: string; mastersRoot: string }[]);
                }
            } catch {
                /* no bridge -- the folder button is still there */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    /**
     * THE MASTERS FOLDER FOLLOWS THE CAMPAIGN.
     *
     * Same derivation the localise screen makes, from the same shared helper:
     * a campaign records its Markets root, and Masters is its sibling. Second
     * guess is OV Library's own campaign store, which holds a mastersRoot
     * outright -- a campaign added there but whose Markets root has no Masters
     * sibling still resolves.
     *
     * Silent when neither answers. An unmounted share is a normal state and
     * must never toast; what the artist sees is the header offering the manual
     * pick, which is a door rather than an error.
     */
    useEffect(() => {
        if (mastersPinned) return;
        if (!marketsRoot && !campaign) return;
        const derived = marketsRoot ? deriveMastersFromMarkets(marketsRoot) : "";
        const byName = derived
            ? ""
            : (mastersCampaigns.filter((c) => c.name === campaign)[0] || { mastersRoot: "" }).mastersRoot;
        const next = derived || byName;
        // A failed derive must NOT wipe a folder already loaded -- "couldn't
        // work it out" and "there is nothing here" are different answers, and
        // only one of them is worth throwing away a loaded shelf for.
        if (!next || next === mastersPath) return;
        setMastersPath(next);
        load(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [marketsRoot, campaign, mastersCampaigns, mastersPinned]);

    /** The escape hatch, shown only when the campaign didn't resolve one. */
    const pickFolder = async () => {
        try {
            const picked = await evalTS("selectCsvLocaliserAepFolder");
            if (typeof picked === "string" && picked) {
                setMastersPinned(true);
                setMastersPath(picked);
                load(picked);
            }
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        }
    };

    /**
     * Switches to a reference, banking the layout on the way out.
     *
     * THE REFERENCE IS NAMED AFTER THE DELIVERABLE, so it carries the canvas,
     * the runtime and the name -- typing them again from the same string is
     * three chances to get one wrong. Both naming conventions, per the masters
     * rule: size with or without "px", duration as "s" or "sec".
     */
    const adoptReference = (path: string) => {
        if (!path || path === refPath) return;
        // Bank what is on screen FIRST. Rotating away and back is meant to be
        // free; losing an hour of placement to a misclick is not.
        if (refPath) {
            setLayouts((prev) => ({ ...prev, [refPath]: { regions, guidesX, guidesY } }));
        }
        setRefPath(path);
        setRefMismatch("");
        const stem = (path.split("/").pop() || "").replace(/\.(jpe?g|png)$/i, "");
        const size = stem.match(/(\d+)x(\d+)(?:px)?/);
        if (size) { setCanvasW(size[1]); setCanvasH(size[2]); }
        const dur = stem.match(/_(\d+)s(?:ec)?(?:_|$)/);
        if (dur) setRuntime(dur[1]);
        if (!nameTouched && stem) setOutName(stem);
        const kept = layouts[path];
        setRegions(kept ? kept.regions : []);
        setGuidesX(kept ? kept.guidesX : []);
        setGuidesY(kept ? kept.guidesY : []);
        setSelRegion(0);
    };

    /**
     * Quietly: an unmounted share is a normal state and must never toast.
     *
     * AN EMPTY OR FAILED READ MUST NOT REPLACE WHAT IS ON SCREEN. The backend
     * already distinguishes the two -- it only returns `templates` when the
     * read itself worked -- so guarding on its presence keeps the last good
     * library up when the NAS drops out mid-session.
     */
    const refreshTemplates = useCallback(async () => {
        try {
            const res = await evalTS("bespokeTemplateList");
            if (res && res.success && res.templates) setTemplates(res.templates);
            // `read` separates "the library is empty" from "the share is not
            // there". An EMPTY library still needs its front door -- seeding is
            // how it stops being empty -- but an unreachable one shows nothing.
            if (res && res.success) setLibraryReadable(res.read !== false);
        } catch {
            /* no bridge, or no share -- the feature simply is not there */
        }
    }, []);

    useEffect(() => {
        if (!mode) return;
        refreshTemplates();
    }, [mode, refreshTemplates]);

    /**
     * Saves geometry and the SHAPE of each master, never the master itself.
     * That is the whole point: the next campaign brings different artwork to
     * the same peculiar screen.
     */
    /**
     * WHICH COUNTRY A SAVED LAYOUT LANDS IN.
     *
     * Two different countries are in play and conflating them was the bug:
     *
     *   `territory`            -- the "Where it lands" dropdown, read from the
     *                            MARKETS tree. It says where the built .aep gets
     *                            filed, it is frequently left unset, and it has
     *                            nothing to do with where the screen IS.
     *   `activeScreen.territory` -- the country of the library screen this board
     *                            was traced from, i.e. the SPEC tree. This is
     *                            the one that answers "which country is this
     *                            screen in".
     *
     * The traced screen wins, and the markets dropdown is the fallback for a
     * board built from scratch. Without this, tracing Austria's Cineplexx_Welle
     * and saving filed the layout under whatever happened to be in the dropdown
     * -- usually nothing, so it landed in "Unfiled".
     */
    const saveTerritory = (activeScreen && activeScreen.territory) || territory;

    const saveTemplate = async () => {
        const name = tplName.trim();
        if (!name) return;
        const w = Number(canvasW) || 0;
        const h = Number(canvasH) || 0;
        const entry: BespokeTemplate = {
            // SAME ID SHAPE AS THE SCAN, which is what makes a layout SUPERSEDE
            // the template it was traced from rather than sitting beside it as a
            // duplicate. When the scan grew `::WxH` (so five different
            // BARCO_PANORAMA screens stopped collapsing into one) this was left
            // on the old two-part shape, so no layout could ever match a
            // template and the "traced" count could never move.
            id: `${saveTerritory || "ANY"}::${name}::${w ? `${w}x${h}` : "?"}`.toUpperCase(),
            name,
            territory: saveTerritory,
            site: site.trim(),
            canvasW: w,
            canvasH: h,
            guidesX, guidesY,
            slots: regions.map((r) => ({
                x: r.x, y: r.y, w: r.w, h: r.h, rotation: r.rotation || 0,
                masterW: r.master.width, masterH: r.master.height, masterDuration: r.master.duration,
            })),
            savedBy: "", stamp: new Date().toISOString().slice(0, 10),
            // Explicit from here on. Entries written before the library shipped
            // have no `kind` and are read as layouts, which is what they are --
            // so this is additive, not a migration.
            kind: "layout", screen: name, status: "active",
        };
        const res = await evalTS("bespokeTemplateSave", JSON.stringify(entry));
        if (res && res.success) {
            setStatus({ text: `Saved "${name}" — ${entry.slots.length} region${entry.slots.length === 1 ? "" : "s"} and ${guidesX.length + guidesY.length} guides.`, type: "success" });
            setSaving(false);
            setTplName("");
            const listed = await evalTS("bespokeTemplateList");
            if (listed && listed.success && listed.templates) setTemplates(listed.templates);
        } else {
            setStatus({ text: (res && res.error) || "Couldn't save that layout.", type: "error" });
        }
    };

    /**
     * Rebuilds a saved layout with THIS campaign's masters.
     *
     * Each slot remembers the size and duration it wants, so a matching master
     * in the selected creative drops straight in. A slot with no match is NOT
     * skipped -- the geometry is the expensive part and losing it would defeat
     * the feature -- it takes the nearest master by aspect and is named in the
     * status, so the crop badge and a swap are one click away.
     */
    const loadTemplate = (t: BespokeTemplate) => {
        const pool = (masters || []).filter((m) => !creative || (m.creative || m.name) === creative);
        if (pool.length === 0) {
            setStatus({ text: "No masters in this creative to fill the layout with.", type: "error" });
            return;
        }
        const unmatched: string[] = [];
        const next: Region[] = [];
        t.slots.forEach((sl, i) => {
            let hit = pool.filter((m) => m.width === sl.masterW && m.height === sl.masterH && m.duration === sl.masterDuration)[0];
            if (!hit) hit = pool.filter((m) => m.width === sl.masterW && m.height === sl.masterH)[0];
            if (!hit) {
                const want = sl.masterW / Math.max(1, sl.masterH);
                let best = pool[0];
                let diff = Infinity;
                for (const m of pool) {
                    const d = Math.abs(m.width / Math.max(1, m.height) - want);
                    if (d < diff) { diff = d; best = m; }
                }
                hit = best;
                unmatched.push(`R${i + 1} wanted ${sl.masterW}×${sl.masterH}`);
            }
            next.push({ id: nextSegId++, master: hit, x: sl.x, y: sl.y, w: sl.w, h: sl.h, rotation: sl.rotation || 0 });
        });
        if (t.canvasW) setCanvasW(String(t.canvasW));
        if (t.canvasH) setCanvasH(String(t.canvasH));
        setGuidesX(t.guidesX || []);
        setGuidesY(t.guidesY || []);
        setActiveScreen({ id: t.id, territory: t.territory || "", name: t.name });
        setRegions(next);
        setSelRegion(0);
        setStatus(unmatched.length
            ? { text: `Loaded "${t.name}" — ${unmatched.join(", ")}; filled with the nearest, swap where needed.`, type: "error" }
            : { text: `Loaded "${t.name}" — ${next.length} region${next.length === 1 ? "" : "s"} matched exactly.`, type: "success" });
    };

    /**
     * Turns the comp the artist has open into regions.
     *
     * A template comp with three solids in it already IS the layout -- somebody
     * drew it when the screen was built, and tracing it again over a photo is
     * redoing work that exists. Each layer becomes a region and takes the
     * nearest master by aspect, so the board arrives ready to swap rather than
     * ready to draw.
     *
     * Masters are matched, never invented: a slot with nothing close still gets
     * the nearest one and is named in the status, same contract as loading a
     * saved layout. Losing the geometry would defeat the point.
     */
    const regionsFromComp = async () => {
        const pool = (masters || []).filter((m) => !creative || (m.creative || m.name) === creative);
        if (pool.length === 0) {
            setStatus({ text: "Pick a masters folder and a creative first — the regions need something to hold.", type: "error" });
            return;
        }
        try {
            const res = await evalTS("bespokeRegionsFromComp");
            if (!res || !res.success || !res.slots) {
                setStatus({ text: (res && res.error) || "Couldn't read that comp.", type: "error" });
                return;
            }
            const next: Region[] = [];
            const loose: string[] = [];
            res.slots.forEach((s: { name: string; x: number; y: number; w: number; h: number; rotation: number }) => {
                const want = s.w / Math.max(1, s.h);
                let best = pool[0];
                let diff = Infinity;
                for (const m of pool) {
                    const d = Math.abs(m.width / Math.max(1, m.height) - want);
                    if (d < diff) { diff = d; best = m; }
                }
                // 2% of aspect is a comfortable match; past that the crop badge
                // and a swap are the honest answer.
                if (diff / Math.max(0.0001, want) > 0.02) loose.push(s.name || `${s.w}×${s.h}`);
                next.push({ id: nextSegId++, master: best, x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation || 0 });
            });
            if (res.width) setCanvasW(String(res.width));
            if (res.height) setCanvasH(String(res.height));
            if (res.seconds) setRuntime(String(Math.round(res.seconds)));
            setRegions(next);
            setSelRegion(0);
            setStatus({
                text: loose.length
                    ? `Read ${next.length} regions from "${res.name}" — ${loose.join(", ")} had no close master, swap where needed.`
                    : `Read ${next.length} regions from "${res.name}".`,
                type: loose.length ? "error" : "success",
            });
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        }
    };

    /**
     * Swaps WHICH PICTURE is behind the board, and nothing else.
     *
     * Deliberately not adoptReference: that one is for changing DELIVERABLE, so
     * it banks the current regions, restores the incoming reference's own, and
     * re-reads canvas size and runtime from the filename. Stepping between
     * candidate images for the SAME screen must do none of that -- the regions
     * are the expensive part, the canvas came from the library entry, and a
     * candidate called "Tower Ref.jpg" has no size to re-read anyway.
     */
    const swapReference = (path: string) => {
        if (!path || path === refPath) return;
        setRefBroken(false);
        setRefMismatch("");
        setRefPath(path);
    };

    /**
     * Starts a board on a template's OWN in-situ image.
     *
     * This is what the enrichment pass is for. The reference was found inside
     * the .aep by aep_screens.py, so the artist gets the screen diagram on the
     * canvas without opening the template, hunting the spec folder, or knowing
     * the image existed -- which for most of these screens they would not.
     *
     * The canvas comes from the LIBRARY ENTRY, not from the image: a spec
     * drawing is often a scaled copy of the screen (1744x792 for a 7200x1240
     * board), and sizing the canvas from it would put every region at the wrong
     * pixel scale. adoptReference parses what it can from the filename; these
     * two assignments are applied after it so the entry wins.
     */
    const traceTemplate = (t: BespokeTemplate) => {
        if (!t.referencePath) {
            setStatus({ text: `No reference was found inside "${t.name}".`, type: "error" });
            return;
        }
        // The whole candidate list comes with it, so a wrong first guess is one
        // click to step past rather than a dead screen.
        setRefAlts(t.referencePaths && t.referencePaths.length ? t.referencePaths : [t.referencePath]);
        setActiveScreen({ id: t.id, territory: t.territory || "", name: t.name });
        adoptReference(t.referencePath);
        if (t.canvasW) setCanvasW(String(t.canvasW));
        if (t.canvasH) setCanvasH(String(t.canvasH));
        if (!nameTouched && t.name) setOutName(t.name);
        setRegions([]);
        setSelRegion(0);
        setStatus({
            text: `Tracing "${t.name}" — ${t.canvasW && t.canvasH ? `${t.canvasW}×${t.canvasH}, ` : ""}draw the regions over the reference.`,
            type: "success",
        });
    };

    // ── board shortcuts, deliberately OPT-IN ────────────────────────────────
    // AE binds the arrow keys to "nudge the selected LAYER in the comp", so a
    // panel that grabbed them permanently would quietly break that for the rest
    // of the session. The board claims them only while it holds focus -- click
    // the board to arm, click away to release -- which is the same contract
    // Edit in Context uses for its nudge pad.
    //
    // Two mechanisms, both required: registerKeyEventsInterest tells the host to
    // route these combos to the extension, and a FOCUSED editable field is what
    // actually gets keystrokes delivered on macOS AE. Hence the invisible input.
    const keyGrabRef = React.useRef<HTMLInputElement>(null);
    const [boardArmed, setBoardArmed] = useState(false);

    const boardInterest = () => {
        const out: Array<Record<string, unknown>> = [];
        // arrows, delete, backspace, H, V, minus, equals, 0, numpad -/+
        const codes = [37, 38, 39, 40, 46, 8, 72, 86, 189, 187, 48, 109, 107];
        for (let i = 0; i < codes.length; i++) {
            out.push({ keyCode: codes[i], shiftKey: false });
            out.push({ keyCode: codes[i], shiftKey: true });
        }
        return JSON.stringify(out);
    };
    const claimBoard = () => {
        try { csi.registerKeyEventsInterest(boardInterest()); } catch (e) { /* no host in preview */ }
        setBoardArmed(true);
    };
    const releaseBoard = () => {
        try { csi.registerKeyEventsInterest("[]"); } catch (e) { /* nothing to release */ }
        setBoardArmed(false);
    };
    // Never leave AE without its arrow keys if the tool unmounts while armed.
    useEffect(() => () => { try { csi.registerKeyEventsInterest("[]"); } catch (e) { /* no host */ } }, []);

    /**
     * ONE STEP IS ONE PIXEL, ten with Shift. Not acceleration.
     *
     * A ramp is the wrong tool for this job: these boards are traced against a
     * spec, so the moves that matter are "off by one" and "off by exactly the
     * gap between two panels" -- both of which you want to land on, not slide
     * past. An accelerating arrow overshoots precisely when you are closest to
     * right, and the far travel it buys is already covered by typing the number
     * into the region fields. 1 and 10 are also what every other design tool
     * does, so it needs no learning.
     */
    const onBoardKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const step = e.shiftKey ? 10 : 1;
        const key = e.key;

        if (key === "Delete" || key === "Backspace") {
            e.preventDefault();
            // A selected guide is the more specific selection, so it goes first
            // -- otherwise selecting a guide and pressing Delete would silently
            // bin the region behind it.
            if (selGuide) removeSelectedGuide();
            else if (regions.length) removeSelectedRegion();
            return;
        }
        if (key === "h" || key === "H") { e.preventDefault(); addGuide("y"); return; }
        if (key === "v" || key === "V") { e.preventDefault(); addGuide("x"); return; }
        // Zoom on the same keys every editor uses. "0" is back to fit.
        if (key === "+" || key === "=") { e.preventDefault(); stepZoom(1); return; }
        if (key === "-" || key === "_") { e.preventDefault(); stepZoom(-1); return; }
        if (key === "0") { e.preventDefault(); setZoom(1); return; }

        let dx = 0;
        let dy = 0;
        if (key === "ArrowLeft") dx = -step;
        else if (key === "ArrowRight") dx = step;
        else if (key === "ArrowUp") dy = -step;
        else if (key === "ArrowDown") dy = step;
        else return;
        e.preventDefault();

        // A selected guide moves on its own axis; across it, nothing happens
        // rather than something surprising.
        if (selGuide) {
            const along = selGuide.axis === "x" ? dx : dy;
            if (!along) return;
            const cur = selGuide.axis === "x" ? guidesX[selGuide.i] : guidesY[selGuide.i];
            setGuideAt(selGuide.axis, selGuide.i, cur + along);
            return;
        }
        if (regions.length) nudgeRegion(dx, dy);
    };

    /**
     * IS THERE ANYTHING TO WORK ON YET?
     *
     * The bar carries two different jobs and they are never both wanted. On an
     * empty board it should offer the WAYS IN and nothing else -- pick a
     * reference, read a comp, open the library -- because guides on a board
     * with no reference and no regions are meaningless. Once something is
     * loaded those entry points are clutter, and one of them (From comp) would
     * quietly replace the work if pressed by accident.
     *
     * The library stays in both states: it is how you move between screens, not
     * just how you start.
     */
    const hasBoard = !!refPath || regions.length > 0;

    /**
     * TALLEST THE BOARD IS ALLOWED TO DRAW, in px.
     *
     * This panel is docked beside a comp, not a page you scroll. A portrait
     * screen is not "a bit taller" here -- DOOH portraits run to 1:4.4 and
     * beyond, so filling the width made the stage several screens tall and
     * every control below it unreachable without a long scroll. Past this
     * height the board is fitted by HEIGHT instead and centred, which is what
     * every other image viewer does and what people expect.
     */
    // KEEP IN STEP WITH Bespoke.scss's .bsp-stagewrap max-height.
    const MAX_STAGE_H = 460;

    useEffect(() => {
        const el = stageWrapRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        // ResizeObserver is Chrome 64, comfortably under the chrome74 target.
        const ro = new ResizeObserver((entries) => {
            if (entries.length) setStageWrapW(entries[0].contentRect.width);
        });
        ro.observe(el);
        setStageWrapW(el.clientWidth);
        return () => ro.disconnect();
    }, [mode]);

    /**
     * The stage's size in px, both axes, or null before the wrap is measured.
     *
     * BOTH AXES EXPLICITLY, and that is the whole fix. The stage used to be
     * sized by the padding-box trick (`height: 0` + `padding-bottom: <ratio>%`)
     * and the cap only set a px WIDTH -- which does nothing, because a
     * PERCENTAGE PADDING RESOLVES AGAINST THE CONTAINING BLOCK'S WIDTH, not
     * against the element's own. So a 720x3840 pillar drew a correctly narrow
     * strip that was still `533% of the panel width` tall, i.e. exactly as
     * unusable as before. Once the wrap is measured there is no reason to keep
     * the ratio trick at all: compute the rectangle and set it.
     *
     * Regions are positioned as PERCENTAGES of the stage and dragging measures
     * it with getBoundingClientRect, so resizing the stage keeps every
     * coordinate correct -- nothing downstream needs to know this happened.
     */
    const stageFit = useMemo(() => {
        const cw = Number(canvasW) || 0;
        const ch = Number(canvasH) || 0;
        if (!cw || !ch || !stageWrapW) return null;
        let w = stageWrapW;
        let h = stageWrapW * (ch / cw);
        if (h > MAX_STAGE_H) {
            h = MAX_STAGE_H;
            w = MAX_STAGE_H * (cw / ch);
        }
        return { w: Math.max(24, Math.round(w)), h: Math.max(24, Math.round(h)) };
    }, [canvasW, canvasH, stageWrapW]);

    /**
     * ZOOM, as a multiple of the fitted size. 1 is "fit".
     *
     * A fit that respects the height cap is right for seeing a board and wrong
     * for working on one: a 720x3840 pillar fits at 86px wide, which is correct
     * and far too narrow to place an edge in. Rather than pick a taller cap --
     * which trades every board's reachability for one shape's precision -- the
     * VIEWPORT stays capped and the board grows inside it and scrolls. Same
     * answer any image editor gives.
     *
     * A ladder rather than free zoom: these are steps you take to see something,
     * not a value worth tuning, and discrete steps are reversible by eye.
     */
    const ZOOM_LADDER = [1, 1.5, 2, 3, 4, 6, 8];
    const [zoom, setZoom] = useState(1);

    // A new board is a new question, so it opens fitted. Keyed on the canvas
    // rather than the reference: swapping between candidate images for the same
    // screen should not throw away the zoom you just set.
    useEffect(() => { setZoom(1); }, [canvasW, canvasH]);

    const stepZoom = (dir: 1 | -1) => {
        setZoom((cur) => {
            let i = 0;
            for (let n = 0; n < ZOOM_LADDER.length; n++) if (ZOOM_LADDER[n] <= cur + 0.001) i = n;
            const next = Math.max(0, Math.min(ZOOM_LADDER.length - 1, i + dir));
            return ZOOM_LADDER[next];
        });
    };

    const stageBox = useMemo(() => {
        if (!stageFit) return null;
        return { w: Math.round(stageFit.w * zoom), h: Math.round(stageFit.h * zoom) };
    }, [stageFit, zoom]);

    /** Where the current reference sits in the folder, or -1 if it is alone. */
    const refIndex = refs.findIndex((r) => r.path === refPath);

    const pickReference = async () => {
        try {
            const picked = await evalTS("bespokeSelectReference");
            if (typeof picked === "string" && picked) {
                adoptReference(picked);
                // Picking one file is really picking the folder -- pull its
                // siblings in so the rest of the job needs no more dialogs.
                try {
                    const listed = await evalTS("bespokeListReferences", picked);
                    if (listed && listed.success && listed.refs && listed.refs.length > 0) {
                        setRefs(listed.refs);
                    } else {
                        setRefs([{ path: picked, name: picked.split("/").pop() || picked }]);
                    }
                } catch {
                    setRefs([{ path: picked, name: picked.split("/").pop() || picked }]);
                }
            }
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        }
    };

    const addRegion = (m: BespokeMaster) => {
        const cw = Number(canvasW) || 1920;
        const ch = Number(canvasH) || 1080;
        // AT THE MASTER'S OWN RATIO, so it starts uncropped. It used to arrive
        // as a half-canvas rectangle at whatever shape that happened to be,
        // which meant reaching for "Match master ratio" every single time.
        // Sized to fit inside half the canvas, never scaled up past it.
        const aspect = m.width && m.height ? m.width / m.height : 1;
        let w = Math.round(cw * 0.5);
        let h = Math.round(w / aspect);
        if (h > ch * 0.8) { h = Math.round(ch * 0.8); w = Math.round(h * aspect); }
        setRegions((prev) => [...prev, {
            id: nextSegId++, master: m, rotation: 0,
            x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2),
            w: Math.max(24, w), h: Math.max(24, h),
        }]);
        setSelRegion(regions.length);
    };

    /**
     * A short, unambiguous name for a master: its creative and its native size.
     * Falls back through the filename stem so it is never blank, and never the
     * full path, which does not fit in a region and tells you nothing new.
     */
    const regionLabel = (m: BespokeMaster) => {
        const stem = (m.name || "").replace(/\.aep$/i, "");
        let who = m.creative || "";
        if (!who) {
            // The orientation token and size are noise here; the creative is
            // the third underscore field in the studio convention.
            const bits = stem.split("_");
            who = bits.length > 2 ? bits[2] : stem;
        }
        const size = m.width && m.height ? `${m.width}×${m.height}` : "";
        return size ? `${who} · ${size}` : who;
    };

    /**
     * Seconds a master runs past the board, or 0.
     *
     * The runtime comes from the reference filename, so a 15s master in a 10s
     * board is a real mismatch and not a rounding artefact. AE happily lets the
     * layer outlive the comp -- it simply renders the first 10s and drops the
     * rest, which on these deliverables is the endcard, the logo and the legal.
     * Nothing anywhere said so, which is the actual defect: the build looked
     * like it worked.
     */
    const overrunOf = (m: BespokeMaster) => {
        const have = Number(m.duration);
        const want = Number(runtime);
        if (!have || !want || have <= want) return 0;
        return Math.round((have - want) * 10) / 10;
    };

    const overrunRegions = regions
        .map((r, i) => ({ i, r, over: overrunOf(r.master) }))
        .filter((x) => x.over > 0);

    /**
     * Puts a different master into a region, KEEPING ITS COORDINATES.
     *
     * The position is the expensive part -- it was traced against the
     * reference by hand -- and it is independent of which master fills it.
     * The ratio may now differ, so the crop is recomputed and shown, but
     * nothing moves.
     */
    const swapRegion = (m: BespokeMaster) => {
        if (swapTarget < 0) return;
        const at = swapTarget;
        setRegions((prev) => prev.map((r, i) => (i === at ? { ...r, master: m } : r)));
        setSelRegion(at);
        setSwapTarget(-1);
        setStatus(null);
    };

    /**
     * The master's dimensions AS THE CANVAS SEES THEM.
     *
     * A quarter turn swaps them, and everything downstream -- the aspect a new
     * region takes, Match master ratio, the cover scale and the crop
     * percentage -- has to reason about the turned footprint, not the file's
     * own. Getting this wrong does not error; it silently crops the wrong axis.
     */
    const facing = (r: { master: BespokeMaster; rotation: number }) => {
        const turned = r.rotation === 90 || r.rotation === 270;
        return {
            w: turned ? r.master.height : r.master.width,
            h: turned ? r.master.width : r.master.height,
        };
    };

    /**
     * A guide off the board is a line you can snap to but never see, and it
     * drags region edges to coordinates the build cannot honour. Same rule as
     * the regions themselves: the reference IS the extent of the work.
     *
     * Used by BOTH the numeric field and the drag, so the mouse cannot reach
     * anywhere the keyboard is refused. It previously fell back to 1920/1080
     * when the canvas fields were mid-edit, which would pin a guide to the
     * wrong span on a 3840-wide board the moment someone cleared the box to
     * retype it; an unparsable canvas now leaves the value alone instead.
     */
    const clampGuide = (axis: "x" | "y", value: number) => {
        const span = axis === "x" ? Number(canvasW) : Number(canvasH);
        if (!span || span <= 0) return Math.round(value);
        return Math.max(0, Math.min(span, Math.round(value)));
    };

    /** Moves a guide to an exact pixel, held inside the canvas. */
    const setGuideAt = (axis: "x" | "y", i: number, value: number) => {
        const at = clampGuide(axis, value);
        if (axis === "x") setGuidesX((g) => g.map((v, n) => (n === i ? at : v)));
        else setGuidesY((g) => g.map((v, n) => (n === i ? at : v)));
    };

    /** Removes whichever thing is selected. Shared by the buttons and Delete. */
    const removeSelectedGuide = () => {
        if (!selGuide) return;
        if (selGuide.axis === "y") setGuidesY((g) => g.filter((_, n) => n !== selGuide.i));
        else setGuidesX((g) => g.filter((_, n) => n !== selGuide.i));
        setSelGuide(null);
    };
    const removeSelectedRegion = () => {
        setRegions((prev) => prev.filter((_, n) => n !== selRegion));
        setSelRegion((n) => Math.max(0, n - 1));
    };

    /** Adds a guide down the middle, which is where both bar buttons put one. */
    const addGuide = (axis: "x" | "y") => {
        if (axis === "y") setGuidesY((g) => [...g, Math.round((Number(canvasH) || 1080) / 2)]);
        else setGuidesX((g) => [...g, Math.round((Number(canvasW) || 1920) / 2)]);
    };

    /** Moves the selected region, clamped to the board. */
    const nudgeRegion = (dx: number, dy: number) => {
        const cw = Number(canvasW) || 1920;
        const ch = Number(canvasH) || 1080;
        setRegions((prev) => prev.map((r, n) => {
            if (n !== selRegion) return r;
            const x = Math.max(0, Math.min(cw - r.w, r.x + dx));
            const y = Math.max(0, Math.min(ch - r.h, r.y + dy));
            return { ...r, x: Math.round(x), y: Math.round(y) };
        }));
    };

    /** Nearest guide within reach, or the value untouched. */
    const snapTo = (v: number, guides: number[], span: number) => {
        const reach = Math.max(6, span * 0.01);
        let best = v;
        let dist = reach;
        for (const g of guides) {
            const d = Math.abs(g - v);
            if (d <= dist) { dist = d; best = g; }
        }
        return best;
    };

    /**
     * The only way a region ever changes, so it is the only place the board
     * edge has to be enforced: dragging, the corner handles, the x/y/w/h
     * fields, Fit to guides, Match master ratio, align and rotate all come
     * through here. Clamping at the choke point means no path can put a
     * region somewhere the build cannot honour.
     *
     * A region outside the board is not a layout, it is a mistake -- the
     * canvas IS the deliverable, so anything past its edge renders as
     * nothing. Stuck to a corner now means stuck.
     *
     * NOT clamped while the canvas fields are mid-edit. Clearing the width
     * box to retype it would otherwise fall back to a default and quietly
     * crush every region to fit a board size nobody asked for.
     */
    const patchRegion = (i: number, patch: Partial<Region>) =>
        setRegions((prev) => prev.map((r, n) => {
            if (n !== i) return r;
            const merged = { ...r, ...patch };
            const cw = Number(canvasW);
            const ch = Number(canvasH);
            if (!cw || !ch || cw <= 0 || ch <= 0) return merged;
            // Size first: a region can be no larger than the board, and never
            // so small it cannot be grabbed again.
            const w = Math.max(MIN_REGION, Math.min(merged.w, cw));
            const h = Math.max(MIN_REGION, Math.min(merged.h, ch));
            // Then position, against the size that survived.
            return {
                ...merged,
                w, h,
                x: Math.max(0, Math.min(merged.x, cw - w)),
                y: Math.max(0, Math.min(merged.y, ch - h)),
            };
        }));

    // Mouse events, not pointer: the macOS AE CEP host does not dispatch
    // Pointer Events reliably, which is this codebase's standing rule for
    // anything beyond a plain click.
    useEffect(() => {
        if (mode !== "regions") return;
        const move = (e: MouseEvent) => {
            const d = dragRef.current;
            if (!d) return;
            const cw = Number(canvasW) || 1920;
            const ch = Number(canvasH) || 1080;
            const dx = ((e.clientX - d.sx) / d.box.width) * cw;
            const dy = ((e.clientY - d.sy) / d.box.height) * ch;
            const s0 = d.start;
            if (d.handle.indexOf("guide") === 0) {
                const bits = d.handle.split(":");
                const i = Number(bits[1]);
                // Through the same clamp the field uses -- dragging must not
                // reach where typing is refused.
                if (bits[0] === "guideX") {
                    const at = clampGuide("x", d.start.x + dx);
                    setGuidesX((g) => g.map((v, n) => (n === i ? at : v)));
                } else {
                    const at = clampGuide("y", d.start.y + dy);
                    setGuidesY((g) => g.map((v, n) => (n === i ? at : v)));
                }
            } else if (d.handle === "move") {
                // Both edges are offered to the ruler, so a region can land
                // flush against a line from either side.
                const rawX = Math.round(s0.x + dx);
                const rawY = Math.round(s0.y + dy);
                const sx = snapTo(rawX, guidesX, cw);
                const sx2 = snapTo(rawX + s0.w, guidesX, cw) - s0.w;
                const sy = snapTo(rawY, guidesY, ch);
                const sy2 = snapTo(rawY + s0.h, guidesY, ch) - s0.h;
                patchRegion(selRegion, {
                    x: Math.abs(sx - rawX) <= Math.abs(sx2 - rawX) ? sx : sx2,
                    y: Math.abs(sy - rawY) <= Math.abs(sy2 - rawY) ? sy : sy2,
                });
            } else {
                const west = d.handle.indexOf("w") !== -1;
                const north = d.handle.indexOf("n") !== -1;
                // The moving EDGE snaps, not the size -- that is what lets a
                // height sit exactly between two horizontal guides.
                // The edge is held inside the board before anything is derived
                // from it. patchRegion clamps as a backstop, but doing it here
                // too keeps w/h honest: an unclamped edge dragged past 0 makes
                // a width larger than the canvas, which then gets clamped and
                // detaches the box from the cursor.
                const edgeX = Math.max(0, Math.min(cw,
                    snapTo(west ? Math.round(s0.x + dx) : Math.round(s0.x + s0.w + dx), guidesX, cw)));
                const edgeY = Math.max(0, Math.min(ch,
                    snapTo(north ? Math.round(s0.y + dy) : Math.round(s0.y + s0.h + dy), guidesY, ch)));
                const nx = west ? edgeX : s0.x;
                const ny = north ? edgeY : s0.y;
                let nw = west ? s0.x + s0.w - edgeX : edgeX - s0.x;
                let nh = north ? s0.y + s0.h - edgeY : edgeY - s0.y;

                // A locked side simply does not move; ratio drives the other
                // axis from the one being dragged, using the region's CURRENT
                // shape so a lock preserves what you already have rather than
                // snapping it to the master's.
                if (lockRatio) {
                    const aspect = s0.w / Math.max(1, s0.h);
                    if (Math.abs(nw - s0.w) >= Math.abs(nh - s0.h)) nh = Math.round(nw / aspect);
                    else nw = Math.round(nh * aspect);
                }

                // Below this a region collapses and can never be grabbed again.
                const fw = Math.max(MIN_REGION, nw);
                const fh = Math.max(MIN_REGION, nh);
                patchRegion(selRegion, {
                    // A west/north handle moves the origin by however much the
                    // size actually changed, not by the raw pointer delta --
                    // otherwise a constrained drag detaches from the cursor.
                    x: west ? Math.round(s0.x + (s0.w - fw)) : nx,
                    y: north ? Math.round(s0.y + (s0.h - fh)) : ny,
                    w: fw, h: fh,
                });
            }
        };
        const up = () => { dragRef.current = null; };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
    }, [mode, selRegion, canvasW, canvasH, lockRatio, guidesX, guidesY]);

    /** Snaps a region to one of the canvas's nine anchor points. */
    const alignRegion = (hx: 0 | 0.5 | 1, vy: 0 | 0.5 | 1) => {
        const r = regions[selRegion];
        if (!r) return;
        const cw = Number(canvasW) || 1920;
        const ch = Number(canvasH) || 1080;
        patchRegion(selRegion, {
            x: Math.round((cw - r.w) * hx),
            y: Math.round((ch - r.h) * vy),
        });
    };

    /** Same master, same size, nudged clear so it can be grabbed. */
    const duplicateRegion = () => {
        const r = regions[selRegion];
        if (!r) return;
        const cw = Number(canvasW) || 1920;
        const ch = Number(canvasH) || 1080;
        const step = Math.round(Math.min(cw, ch) * 0.03);
        setRegions((prev) => [...prev, {
            ...r, id: nextSegId++,
            x: Math.min(r.x + step, Math.max(0, cw - r.w)),
            y: Math.min(r.y + step, Math.max(0, ch - r.h)),
        }]);
        setSelRegion(regions.length);
    };

    /**
     * The bounds either side of a point on one axis, or null.
     *
     * THE BOARD'S OWN EDGES COUNT AS GUIDES. Regions are already clamped to
     * the reference, so its edges are real boundaries and not merely where the
     * picture stops -- one horizontal and one vertical guide divide the board
     * into four usable cells, and it took two more guides laid along the top
     * and left to say what the edges already said.
     *
     * AN AXIS WITH NO GUIDES ON IT TAKES THE WHOLE SPAN.
     *
     * This used to return null there, on the reasoning that an empty axis has
     * "nothing to say" and filling it would turn the button into a maximise.
     * In use that is backwards: one vertical guide down a board means a panel
     * running the FULL HEIGHT and stopping at that line -- the studio's most
     * common bespoke shape -- and leaving the height untouched meant setting it
     * by hand every single time, which is the drag-an-edge-to-a-hairline the
     * button exists to remove. The board's own edges are already treated as
     * guides here, so the empty axis is simply the case where both bounds come
     * from the edges.
     *
     * The "maximise" worry is handled where it actually matters: fitToGuides
     * refuses when there are no guides ANYWHERE, so nothing can maximise a
     * region by accident on a board with no rulers on it.
     *
     * Shared by Fit to guides and the on-canvas highlight, so what is drawn is
     * literally the rectangle the button produces rather than a second guess
     * at it -- two implementations of "which pair" would eventually disagree,
     * and that would surface as the button doing something other than what you
     * were looking at.
     */
    const bracketGuides = (guides: number[], centre: number, span: number) => {
        if (!span || span <= 0) return null;
        let lo = 0;
        let hi = span;
        for (const g of guides) {
            if (g <= centre && g > lo) lo = g;
            if (g >= centre && g < hi) hi = g;
        }
        if (hi - lo < MIN_REGION) return null;
        return { lo, hi };
    };

    /**
     * The cell the selected region would land in, or null.
     *
     * Exactly what fitToGuides will do: an axis with no bracketing pair keeps
     * the region's current position and size on that axis, so the highlight
     * shows the real outcome including the parts that will not move.
     */
    const guideCell = () => {
        const r = regions[selRegion];
        if (!r) return null;
        if (guidesX.length === 0 && guidesY.length === 0) return null;
        const v = bracketGuides(guidesY, r.y + r.h / 2, Number(canvasH));
        const h = bracketGuides(guidesX, r.x + r.w / 2, Number(canvasW));
        if (!v && !h) return null;
        return {
            x: h ? h.lo : r.x,
            w: h ? h.hi - h.lo : r.w,
            y: v ? v.lo : r.y,
            h: v ? v.hi - v.lo : r.h,
        };
    };

    /**
     * Sizes the region to span the guides that BRACKET it, per axis.
     *
     * Dragging an edge onto a line was the only way to use a guide, which meant
     * doing it twice per axis and reaching a hairline each time. This takes the
     * nearest line either side of the region's own centre, so which pair it
     * means is whichever pair it is already sitting between.
     *
     * Each axis is independent: two horizontal lines and no vertical ones sets
     * the height and leaves the width alone.
     */
    const fitToGuides = () => {
        const r = regions[selRegion];
        if (!r) return;
        // THE ONE PLACE "no guides" IS REFUSED. bracketGuides now fills an empty
        // axis edge to edge, so without this a board with no rulers at all would
        // answer this button by maximising the region -- which is the only case
        // where filling both axes is certainly not what was meant.
        if (guidesX.length === 0 && guidesY.length === 0) {
            setStatus({ text: "Add a guide first — a region fits between two guides, or between a guide and the edge of the board.", type: "error" });
            return;
        }
        const v = bracketGuides(guidesY, r.y + r.h / 2, Number(canvasH));
        const h = bracketGuides(guidesX, r.x + r.w / 2, Number(canvasW));
        if (!v && !h) {
            setStatus({ text: "Nothing to fit to — the board has no width or height yet.", type: "error" });
            return;
        }
        setStatus(null);
        patchRegion(selRegion, {
            ...(h ? { x: h.lo, w: h.hi - h.lo } : {}),
            ...(v ? { y: v.lo, h: v.hi - v.lo } : {}),
        });
    };

    /**
     * A QUARTER TURN TURNS THE WINDOW, NOT JUST THE ARTWORK.
     *
     * This used to set `rotation` alone, which meant a rotated region kept the
     * shape it had been given for the UNROTATED master: turn a 5760x1440 into a
     * tall cell and the master, still covering an axis-aligned landscape window,
     * lost most of itself to the crop. The only visible sign was the dashed
     * extent box growing -- the region itself never moved, so the tool looked
     * like it had ignored the button.
     *
     * Swapping w/h about the CENTRE is what makes the turn physical: the window
     * ends up where the artwork now is, so a landscape master turned 90 degrees
     * gets a portrait window and covers it with the crop it had before.
     *
     * The centre, not the origin -- turning about the top-left would walk a
     * region across the board every time it was rotated, and a region already
     * sitting in a guide cell would leave it in a direction nobody chose.
     *
     * A swap CAN take a region outside its guide cell, and deliberately so: the
     * cell was measured for the old shape. patchRegion still clamps it to the
     * board, and Fit to guides re-seats it in one press.
     */
    const rotateRegion = () => {
        const r = regions[selRegion];
        if (!r) return;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        patchRegion(selRegion, {
            rotation: (r.rotation + 90) % 360,
            w: r.h,
            h: r.w,
            x: Math.round(cx - r.h / 2),
            y: Math.round(cy - r.w / 2),
        });
    };

    /** Reshapes the region to its master's native ratio, so nothing is cropped. */
    const matchMasterRatio = () => {
        const r = regions[selRegion];
        if (!r || !r.master.width || !r.master.height) return;
        const face = facing(r);
        const aspect = face.w / face.h;
        // Keeps the region's area roughly as it was rather than jumping to the
        // master's pixel size, which on a 13536px master would fill the screen.
        const area = r.w * r.h;
        const w = Math.round(Math.sqrt(area * aspect));
        patchRegion(selRegion, { w, h: Math.round(w / aspect) });
    };

    /** Assembles the region layout and, when a country is set, files it. */
    const runBuildRegions = async () => {
        setBuilding(true);
        setReport(null);
        setStatus(null);
        try {
            const plan = {
                canvasWidth: Number(canvasW) || 0,
                canvasHeight: Number(canvasH) || 0,
                seconds: Number(runtime) || 0,
                name: outName.trim(),
                marketsRoot, territory, batch: batch.trim(),
                regions: regions.map((r) => ({ path: r.master.path, x: r.x, y: r.y, w: r.w, h: r.h, rotation: r.rotation || 0 })),
                // The reference and the rulers travel with the plan so the
                // built comp opens looking like the panel it was traced in.
                // Arrays of scalars survive the bridge; the whole plan is
                // already a JSON string, which is the rule for anything nested.
                refPath: refPath,
                guidesX: guidesX,
                guidesY: guidesY,
            };
            const res = (await evalTS("bespokeBuildRegions", JSON.stringify(plan))) as unknown as
                { success: boolean; error?: string; report?: string; saved?: boolean; savedTo?: string } | undefined;
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) { setStatus({ text: res.error || "The build failed.", type: "error" }); return; }
            setReport(res.report || "(built)");
            setStatus({
                text: res.saved
                    ? `Built and saved to ${(res.savedTo || "").split("/").slice(-2).join("/")}`
                    : "Built — no country set, so it hasn't been filed.",
                type: "success",
            });
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBuilding(false);
        }
    };

    /** Assembles the whole composition and, when a country is set, files it. */
    const runBuild = async () => {
        setBuilding(true);
        setReport(null);
        setStatus(null);
        try {
            const plan = {
                canvasWidth: Number(canvasW) || 0,
                canvasHeight: Number(canvasH) || 0,
                name: outName.trim(),
                marketsRoot,
                territory,
                batch: batch.trim(),
                duplicatePanels,
                segments: segments.map((sg) => ({
                    seconds: sg.seconds,
                    tiles: sg.tiles.map((t) => ({ path: t.path })),
                })),
            };
            const res = (await evalTS("bespokeBuild", JSON.stringify(plan))) as unknown as
                { success: boolean; error?: string; report?: string; saved?: boolean; savedTo?: string } | undefined;
            if (res === undefined) throw new Error("no bridge");
            if (!res.success) {
                setStatus({ text: res.error || "The build failed.", type: "error" });
                return;
            }
            setReport(res.report || "(built)");
            // What actually happened, from the host rather than inferred here --
            // a territory being set is not the same as the save succeeding.
            setStatus({
                text: res.saved
                    ? `Built and saved to ${(res.savedTo || "").split("/").slice(-2).join("/")}`
                    : "Built — no country set, so it hasn't been filed.",
                type: "success",
            });
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBuilding(false);
        }
    };

    // --- filters ------------------------------------------------------------
    /** Every creative on the shelf, with how many masters each has. */
    const creatives = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const m of masters || []) {
            const key = m.creative || m.name;
            counts[key] = (counts[key] || 0) + 1;
        }
        return Object.keys(counts).sort().map((name) => ({ name, count: counts[name] }));
    }, [masters]);

    /**
     * The short label for every master, worked out PER CREATIVE.
     *
     * Grouped by creative rather than by whatever the filters currently show,
     * so a card's name does not change under the cursor when an orientation
     * pill is toggled -- a label that moves while you are reading it is worse
     * than a long one.
     */
    const shortNames = useMemo(() => {
        const groups: Record<string, string[]> = {};
        for (const m of masters || []) {
            const k = m.creative || m.name;
            (groups[k] = groups[k] || []).push(m.name);
        }
        const edges: Record<string, { pre: number; suf: number }> = {};
        for (const k in groups) edges[k] = commonTokenEdges(groups[k]);

        const out: Record<string, string> = {};
        for (const m of masters || []) {
            const k = m.creative || m.name;
            // Falls back through the creative to the stem so it is never blank:
            // a group of one, or a set of names identical apart from their size
            // and duration tokens, legitimately has nothing left to print.
            out[m.path] = distinguish(m.name, edges[k]) || m.creative || m.name;
        }
        return out;
    }, [masters]);

    /** The label and the render for one master, for the card and the tiles. */
    const shortNameOf = useCallback(
        (m: BespokeMaster) => shortNames[m.path] || m.creative || m.name,
        [shortNames]
    );
    const previewOf = useCallback(
        (m: BespokeMaster) => renders[String(m.name).toLowerCase()] || "",
        [renders]
    );

    // ONE CREATIVE IS ALWAYS SELECTED. A bespoke board is built from one
    // campaign's masters, so "All" only ever offered a mixed list nobody
    // wants -- 34 masters across six unrelated creatives, with the twenty
    // that matter buried in it. Removing the chip means the empty filter
    // state has to be filled, or the picker would open showing nothing.
    //
    // The busiest creative is the default: on a real masters folder that is
    // the campaign the job is for, and the long tail is other work that
    // happens to share the root.
    useEffect(() => {
        if (creative !== "") return;
        if (creatives.length === 0) return;
        let best = creatives[0];
        for (const c of creatives) if (c.count > best.count) best = c;
        setCreative(best.name);
    }, [creatives, creative]);

    /** Orientation counts WITHIN the chosen creative, so a pill that would
     *  return nothing reads as empty rather than looking available. */
    const orientCounts = useMemo(() => {
        const counts: Record<string, number> = { LANDSCAPE: 0, PORTRAIT: 0, SQUARE: 0, QUAD: 0 };
        for (const m of masters || []) {
            if (creative && (m.creative || m.name) !== creative) continue;
            if (counts[m.orientation] !== undefined) counts[m.orientation]++;
        }
        return counts;
    }, [masters, creative]);

    /**
     * THE REGIONS DECIDE, NOT THE CANVAS -- and that distinction is the whole
     * point of doing this properly.
     *
     * A 3240x1920 board is landscape, but it is three 1080x1920 PORTRAIT panels
     * side by side, and portrait is what you want the picker showing. Guessing
     * from the canvas would hand you exactly the wrong list on the most common
     * bespoke screen there is. So: when the board has regions -- traced, loaded
     * from a layout, or read off a comp -- their majority orientation wins, and
     * only a board with nothing on it yet falls back to its own shape.
     *
     * Classified exactly as review.ts's detectOrientation does (w<h portrait,
     * w>h landscape, equal square) so the guess and the masters agree. QUAD is
     * never guessed: it is a filename keyword, not a ratio.
     */
    const suggestedOrient = useMemo<OrientationKey | "">(() => {
        const shapeOf = (w: number, h: number): OrientationKey | "" => {
            if (!w || !h) return "";
            if (w < h) return "PORTRAIT";
            if (w > h) return "LANDSCAPE";
            return "SQUARE";
        };

        if (regions.length > 0) {
            const tally: Record<string, number> = { LANDSCAPE: 0, PORTRAIT: 0, SQUARE: 0 };
            for (const r of regions) {
                const k = shapeOf(r.w, r.h);
                if (k) tally[k]++;
            }
            let best: OrientationKey | "" = "";
            let most = 0;
            for (const k of ["PORTRAIT", "LANDSCAPE", "SQUARE"] as OrientationKey[]) {
                if (tally[k] > most) { most = tally[k]; best = k; }
            }
            return best;
        }
        return shapeOf(Number(canvasW) || 0, Number(canvasH) || 0);
    }, [regions, canvasW, canvasH]);

    useEffect(() => {
        if (orientTouched) return;
        if (!suggestedOrient) return;
        // NEVER select a filter with nothing behind it. The chip is disabled at
        // zero, so auto-selecting one would leave an empty picker and no
        // obvious way back -- worse than simply not guessing.
        if (!orientCounts[suggestedOrient]) return;
        setOrient(suggestedOrient);
        // `orient` is deliberately not a dependency: this sets it, and reacting
        // to its own write is how an effect loops.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [suggestedOrient, orientCounts, orientTouched]);

    const durations = useMemo(() => {
        const out: string[] = [];
        for (const m of masters || []) {
            if (creative && (m.creative || m.name) !== creative) continue;
            if (m.duration && out.indexOf(m.duration) === -1) out.push(m.duration);
        }
        return out.sort((a, b) => Number(a) - Number(b));
    }, [masters, creative]);

    const matches = useMemo(() => {
        const out: BespokeMaster[] = [];
        for (const m of masters || []) {
            if (creative && (m.creative || m.name) !== creative) continue;
            // No pill selected means no orientation filter, not "none of them".
            if (orient && m.orientation !== orient) continue;
            if (durFilter && m.duration !== durFilter) continue;
            out.push(m);
            if (out.length >= MAX_MATCHES) break;
        }
        // Widest first, then longest: a tile picker is usually reaching for the
        // biggest thing that fits.
        return out.sort((a, b) => b.width - a.width || Number(b.duration) - Number(a.duration));
    }, [masters, creative, orient, durFilter]);

    // --- composition -------------------------------------------------------
    const seg = segments[Math.min(current, segments.length - 1)];

    /** The output name, composed the way every other deliverable name is. */
    const suggestedName = useMemo(() => {
        const first = segments[0]?.tiles[0];
        if (!first) return "";
        const code = territoryCode || first.territory || "OV";
        const siteToken = site.trim();
        const bits = [
            first.film || "",
            first.region || "INTL",
            "MultipleArt",
            first.artwork || "DOOH",
            siteToken,
            `${canvasW}x${canvasH}px`,
            `${Math.round(Number(runtime) || 0)}s`,
            code,
        ].filter((b) => b !== "");
        return bits.join("_");
    }, [segments, territoryCode, canvasW, canvasH, runtime, site]);

    // Prefilled from the first tile's own site, then left alone once touched --
    // the masters usually carry the right one already.
    useEffect(() => {
        const first = segments[0]?.tiles[0];
        if (!siteTouched && first && first.site) setSite(first.site);
    }, [segments, siteTouched]);

    useEffect(() => {
        if (!nameTouched) setOutName(suggestedName);
    }, [suggestedName, nameTouched]);
    const totalSecs = segments.reduce((n, s) => n + s.seconds, 0);
    const wantSecs = Number(runtime) || 0;
    const canvasWidth = Number(canvasW) || 0;
    const tileWidth = seg && seg.tiles.length ? Math.round(canvasWidth / seg.tiles.length) : 0;
    const naturalWidth = seg ? seg.tiles.reduce((n, m) => n + m.width, 0) : 0;

    const setSeg = (fn: (s: Segment) => Segment) =>
        setSegments((prev) => prev.map((s, i) => (i === current ? fn(s) : s)));

    const addTile = (m: BespokeMaster) => setSeg((s) => ({ ...s, tiles: [...s.tiles, m] }));
    const removeTile = (idx: number) => setSeg((s) => ({ ...s, tiles: s.tiles.filter((_, i) => i !== idx) }));

    const addSegment = () => {
        setSegments((prev) => [...prev, { id: nextSegId++, tiles: [], seconds: 2 }]);
        setCurrent(segments.length);
    };
    const removeSegment = () => {
        if (segments.length <= 1) return;
        setSegments((prev) => prev.filter((_, i) => i !== current));
        setCurrent((c) => Math.max(0, c - 1));
    };

    // BLOCKERS vs NOTES. Only a segment with nothing in it genuinely cannot be
    // built; everything else is a layout the artist may well have meant. Tiles
    // that do not fill the canvas are centred with space around them, which is
    // a legitimate composition rather than an error to refuse.
    const blockers: string[] = [];
    if (segments.some((s) => s.tiles.length === 0)) blockers.push("a segment has no creatives in it");

    const notes: string[] = [];
    if (wantSecs > 0 && Math.abs(totalSecs - wantSecs) > 0.001) {
        notes.push(`segments total ${totalSecs}s, the row asks for ${wantSecs}s`);
    }
    if (seg && seg.tiles.length > 0 && canvasWidth > 0 && naturalWidth !== canvasWidth) {
        notes.push(naturalWidth > canvasWidth
            ? `this segment is ${naturalWidth}px across a ${canvasWidth}px canvas — it will be scaled down to fit`
            : `this segment is ${naturalWidth}px across a ${canvasWidth}px canvas — it will be centred with space either side`);
    }

    return (
        <div className="form-tool bsp">
            {/* The masters folder belongs to the work, not to the question at the
                door -- picking a build type has nothing to do with which folder
                the masters came from.

                IT IS A READOUT, NOT A CONTROL. The folder is whichever one the
                selected campaign owns, so the header's job is to show which
                one that turned out to be -- the pick only reappears when the
                campaign resolved nothing to show. */}
            <div className="bsp-head" hidden={!mode}>
                <div className="bsp-head-text">
                    {/* THE CAMPAIGN, not the path. The folder follows the
                        campaign now, so the path is derived state rather than
                        anything anyone set here -- and it was the largest thing
                        in the header, in a monospace grey, wrapping across two
                        lines of a docked panel to say what "PP3" says. It is
                        still one hover away, which is where a value you only
                        check when something looks wrong belongs. */}
                    <Tooltip text={mastersPath || "No masters folder resolved yet"}>
                        <p className="bsp-masters">
                            {mastersPinned
                                ? (mastersPath.split("/").pop() || mastersPath)
                                : campaign || (mastersPath.split("/").pop() || "No masters folder — pick a campaign below")}
                        </p>
                    </Tooltip>
                    <p className="bsp-count">
                        {loading
                            ? "Walking the masters folder — slow the first time, instant after"
                            : masters
                                ? `${masters.length} masters under AE/${outsideAE ? ` · ${outsideAE} skipped outside it` : ""}`
                                : "not loaded"}
                    </p>
                </div>
                {(!mastersPath || mastersPinned) && (
                    <Tooltip text="Pick the AEP masters folder by hand">
                        <button className="bsp-btn bsp-btn--ghost" onClick={pickFolder}>Folder</button>
                    </Tooltip>
                )}
                {mastersPinned && (
                    <Tooltip text="Go back to the campaign's own masters folder">
                        <button className="bsp-btn bsp-btn--icon" onClick={() => setMastersPinned(false)}>
                            <RotateCcw size={12} />
                        </button>
                    </Tooltip>
                )}
                <Tooltip text="Re-read the masters folder">
                    <button className="bsp-btn bsp-btn--icon" onClick={() => load(mastersPath)} disabled={loading || !mastersPath}>
                        <RefreshCw size={12} className={loading ? "spin" : ""} />
                    </button>
                </Tooltip>
            </div>

            {!mode && (
                <div className="bsp-choose">
                    <p className="bsp-choose-ask">What kind of build is this?</p>
                    <div className="bsp-choose-cards">
                        {/* Name and icon only. The team already knows which is
                            which, and two paragraphs at the door is reading
                            imposed on someone who has decided before arriving. */}
                        <button className="bsp-choose-card" onClick={() => setMode("multi")}>
                            <LayoutGrid size={30} />
                            <b>Multi Art</b>
                        </button>
                        <button className="bsp-choose-card" onClick={() => setMode("regions")}>
                            <Layers size={30} />
                            <b>Bespoke</b>
                        </button>
                    </div>
                </div>
            )}


            {/* --- where it lands ------------------------------------------ */}
            {/* COLLAPSED BY DEFAULT. Four fields that are set once per batch
                and then ignored were taking a quarter of the panel above the
                thing you actually work in. The summary line keeps the answer
                visible while closed, so nothing is hidden -- only folded. */}
            <button
                className={"bsp-fold" + (destOpen ? " is-on" : "")}
                onClick={() => setDestOpen((v) => !v)}
                hidden={!mode}
            >
                <ChevronRight size={11} className="bsp-fold-caret" />
                <span className="bsp-fold-label">Where it lands</span>
                <span className="bsp-fold-summary">
                    {territory
                        ? `${territory}${batch.trim() ? " · " + batch.trim() : ""}${site.trim() ? " · " + site.trim() : ""}`
                        : "no country chosen"}
                </span>
            </button>
            <div className="bsp-dest" hidden={!mode || !destOpen}>
                {/* The house Dropdown, the same one the localiser's campaign
                    picker uses. A native <select> renders its popup through the
                    OS, so no amount of CSS reaches the open list -- it arrived
                    as a white system menu in the middle of a black panel. */}
                <div className="bsp-field">
                    <span className="bsp-lbl">Campaign</span>
                    <Dropdown
                        icon={<Library size={13} />}
                        value={campaign}
                        onChange={setCampaign}
                        options={campaigns.map((c) => ({
                            value: c.name,
                            label: c.name,
                            // Only claimed when the check actually ran: an
                            // absent entry means "not asked", which must not
                            // render as "not mounted".
                            hint: c.reachable === false ? "not mounted" : undefined,
                        }))}
                        placeholder="Select a campaign…"
                        emptyMessage="No campaigns yet — add one in the localiser."
                    />
                </div>
                <div className="bsp-field">
                    <span className="bsp-lbl">Country</span>
                    <Dropdown
                        icon={<Globe2 size={13} />}
                        value={territory}
                        onChange={setTerritory}
                        options={[{ value: "", label: "Build it here, don't file it" }]
                            .concat(territories.map((t) => ({ value: t, label: t })))}
                        placeholder="Build it here, don't file it"
                        emptyMessage={marketsRoot ? "No territories in that campaign's markets folder." : "Pick a campaign first."}
                    />
                </div>
                <label className="bsp-field">
                    <span className="bsp-lbl">Batch</span>
                    <input className="bsp-input bsp-input--b" value={batch} onChange={(e) => setBatch(e.target.value)} />
                </label>
                <label className="bsp-field">
                    <span className="bsp-lbl">Site</span>
                    {/* Says what the field IS, not one example of what could go
                        in it. "METROBUS" is a real site name, so as a
                        placeholder it read like a value already set -- and it
                        quietly suggested that a bus wrap is the expected answer
                        on a screen that might be a mall ceiling. Blank is a
                        legitimate value here and produces a name with no site
                        token at all, which the prompt should not argue with. */}
                    <input
                        className="bsp-input bsp-input--b"
                        value={site}
                        placeholder="Site name"
                        onChange={(e) => { setSite(e.target.value); setSiteTouched(true); }}
                    />
                </label>
            </div>

            {/* NAME AND SPEC ON ONE ROW. Size and duration used to sit in the
                toolbar below, which meant the bar carried both "what am I
                building" and "how do I work on it" and wrapped to two lines.
                They belong with the name: all three are the deliverable's
                specification, and all three are read straight off the reference
                filename together. */}
            <div className="bsp-namerow" hidden={!mode}>
                <label className="bsp-field bsp-field--grow">
                    <span className="bsp-lbl">Deliverable name</span>
                    <input
                        className="bsp-input"
                        value={outName}
                        placeholder="Add a master to compose a name"
                        onChange={(e) => { setOutName(e.target.value); setNameTouched(true); }}
                    />
                </label>
                <label className="bsp-field">
                    <span className="bsp-lbl">Canvas</span>
                    <span className="bsp-size">
                        <input className="bsp-input bsp-input--n" value={canvasW} onChange={(e) => setCanvasW(e.target.value)} title="Canvas width" />
                        <span className="bsp-x">×</span>
                        <input className="bsp-input bsp-input--n" value={canvasH} onChange={(e) => setCanvasH(e.target.value)} title="Canvas height" />
                    </span>
                </label>
                <label className="bsp-field">
                    <span className="bsp-lbl">Secs</span>
                    <span className="bsp-size">
                        <input className="bsp-input bsp-input--s" value={runtime} onChange={(e) => setRuntime(e.target.value)} title="Runtime in seconds" />
                    </span>
                </label>
            </div>

            {/* The exact path, before anything is written. A batch that lands in
                the wrong market is a redelivery, and this is the one place it
                can be caught for free. */}
            <p className="bsp-path" hidden={!mode}>
                {territory && marketsRoot
                    ? `${marketsRoot}/${territory}/AE/${batch.trim() || "AE"}/${outName || "…"}_V01.aep`
                    : "No country chosen — it will be built and left unsaved."}
            </p>

            {/* CANVAS AND RUNTIME SIT WITH THE PANE THEY DESCRIBE, not at the
                top of the form. In Bespoke both are read straight off the
                reference filename, so asking for them before the reference has
                even been picked put the answer above the question -- there they
                live in the bar above the canvas instead, which is why this
                renders for Multi Art only. */}
            <div className="bsp-target" hidden={mode !== "multi"}>
                <label className="bsp-field">
                    <span className="bsp-lbl">Canvas</span>
                    <span className="bsp-size">
                        <input className="bsp-input bsp-input--n" value={canvasW} onChange={(e) => setCanvasW(e.target.value)} />
                        <span className="bsp-x">×</span>
                        <input className="bsp-input bsp-input--n" value={canvasH} onChange={(e) => setCanvasH(e.target.value)} />
                    </span>
                </label>
                <label className="bsp-field">
                    <span className="bsp-lbl">Runtime</span>
                    <span className="bsp-size">
                        <input className="bsp-input bsp-input--n" value={runtime} onChange={(e) => setRuntime(e.target.value)} />
                        <span className="bsp-x">s</span>
                    </span>
                </label>
            </div>

            {/* BOARD AND SHELF, SIDE BY SIDE when there is room for it.
                These are the two surfaces the job alternates between, and they
                were stacked with the shelf folded underneath -- so every master
                added was expand, scroll down, pick, scroll back up to place it.
                Docked wide they simply sit next to each other, and none of that
                scrolling exists.

                A plain @media on the panel width, not @container (Chrome 105,
                against a chrome74 target). Below the breakpoint this collapses
                back to exactly the stack it was. */}
            <div className="bsp-work">
            <div className="bsp-work-main">
            {mode === "regions" && (
                <>
                    {/* ONE BAR. "Trace over the reference" as a heading said
                        nothing the file name below it did not, and each of the
                        reference, the canvas and the guides had its own row --
                        three bands of chrome above the thing being worked in.
                        They are one wrapping row now, ordered the way they are
                        used: pick the reference, confirm what it says the board
                        is, then lay lines on it. */}
                    <div className="bsp-bar">
                        {/* Once a reference is chosen the button stops being a
                            call to action and becomes a statement of fact, so
                            it changes colour and shortens to the stem -- the
                            full path is on hover. */}
                        <button
                            className={"bsp-reflink" + (refPath ? " is-set" : "")}
                            onClick={pickReference}
                            title={refPath || "Pick the reference JPG for this deliverable"}
                        >
                            {refPath
                                ? (refPath.split("/").pop() || "").replace(/\.(jpe?g|png)$/i, "")
                                : "Pick the reference JPG…"}
                        </button>
                        {/* WAS A <select> OF NAMES, which is the same problem
                            the templates folder has: GRAND_REX and BEAUGRENELLE
                            are equally meaningless as strings and completely
                            distinct as shapes. The library draws them.

                            Shown even when the library is empty, because the
                            way it stops being empty is in there. It only
                            disappears when the share is unreachable, and that
                            is silent by design. */}
                        {/* GROUPED, so the bar breaks between groups and never
                            between a label and the control it names. */}
                        {/* THE COMP THE ARTIST ALREADY HAS OPEN is often the
                            answer -- a template with three solids in it IS the
                            layout. Regions mode only: Multi Art tiles equally
                            and has nothing to read. */}
                        {mode === "regions" && !hasBoard && (
                            <span className="bsp-bar-group">
                                <span className="bsp-bar-sep" />
                                <Tooltip text="Read the comp open in After Effects — its layers become the regions">
                                    <button className="bsp-btn bsp-btn--ghost" onClick={regionsFromComp}>
                                        <Layers size={11} /> From comp
                                    </button>
                                </Tooltip>
                            </span>
                        )}
                        {libraryReadable && (
                            <span className="bsp-bar-group">
                                <span className="bsp-bar-sep" />
                                <span className="bsp-bar-lbl">Screens</span>
                                <button
                                    className={"bsp-btn bsp-btn--ghost" + (libraryOpen ? " is-on" : "")}
                                    onClick={() => setLibraryOpen((v) => !v)}
                                >
                                    <Library size={11} />
                                    {templates.length > 0 ? `Library (${templates.length})` : "Library"}
                                </button>
                            </span>
                        )}
                        {hasBoard && (
                        <span className="bsp-bar-group">
                            <span className="bsp-bar-sep" />
                            {/* SHORT LABELS THAT ARE ALSO THE SHORTCUT. These
                                were "+ Horizontal" and "+ Vertical" behind a
                                GUIDES label -- three items and most of a row to
                                say what H and V now do. Naming the buttons after
                                the keys teaches the shortcut instead of needing
                                a legend for it. */}
                            <Tooltip text="Add a horizontal guide (H)">
                                <button className="bsp-btn bsp-btn--ghost bsp-btn--key" onClick={() => addGuide("y")}>
                                    ＋H
                                </button>
                            </Tooltip>
                            <Tooltip text="Add a vertical guide (V)">
                                <button className="bsp-btn bsp-btn--ghost bsp-btn--key" onClick={() => addGuide("x")}>
                                    ＋V
                                </button>
                            </Tooltip>
                            <span className="bsp-bar-sep" />
                            {/* ZOOM. The board grows inside a capped viewport
                                rather than pushing the panel, so a 1:5 pillar
                                can be worked on without every other board
                                becoming a scroll. */}
                            {/* Tooltip, not `title` — these carry the keyboard
                                shortcut, which is the one thing on the button
                                that is not written on its face. */}
                            <Tooltip text="Zoom out (−)">
                                <button
                                    className="bsp-btn bsp-btn--ghost bsp-btn--key"
                                    onClick={() => stepZoom(-1)}
                                    disabled={zoom <= ZOOM_LADDER[0]}
                                >−</button>
                            </Tooltip>
                            <Tooltip text="Back to fit (0)">
                                <button
                                    className="bsp-btn bsp-btn--ghost bsp-btn--zoom"
                                    onClick={() => setZoom(1)}
                                >
                                    {zoom === 1 ? "Fit" : `${zoom}×`}
                                </button>
                            </Tooltip>
                            <Tooltip text="Zoom in (+)">
                                <button
                                    className="bsp-btn bsp-btn--ghost bsp-btn--key"
                                    onClick={() => stepZoom(1)}
                                    disabled={zoom >= ZOOM_LADDER[ZOOM_LADDER.length - 1]}
                                >＋</button>
                            </Tooltip>
                            {(guidesX.length > 0 || guidesY.length > 0) && (
                                <button className="bsp-btn bsp-btn--ghost" onClick={() => { setGuidesX([]); setGuidesY([]); setSelGuide(null); }}>
                                    Clear
                                </button>
                            )}
                        </span>
                        )}
                    </div>
                    {refs.length > 1 && (
                        // THE WHOLE FOLDER, because a job is many deliverables.
                        // Each keeps its own regions, so stepping through them
                        // is free -- the dot marks the ones already laid out.
                        <div className="bsp-refbar">
                            <Tooltip text="Previous reference">
                                <button
                                    className="bsp-refstep"
                                    disabled={refIndex <= 0}
                                    onClick={() => adoptReference(refs[refIndex - 1].path)}
                                >‹</button>
                            </Tooltip>
                            <select
                                className="bsp-refpick"
                                value={refPath}
                                onChange={(e) => adoptReference(e.target.value)}
                            >
                                {refs.map((r) => (
                                    <option key={r.path} value={r.path}>
                                        {(layouts[r.path] && layouts[r.path].regions.length > 0) || (r.path === refPath && regions.length > 0) ? "● " : "○ "}
                                        {r.name}
                                    </option>
                                ))}
                            </select>
                            <Tooltip text="Next reference">
                                <button
                                    className="bsp-refstep"
                                    disabled={refIndex < 0 || refIndex >= refs.length - 1}
                                    onClick={() => adoptReference(refs[refIndex + 1].path)}
                                >›</button>
                            </Tooltip>
                            <span className="bsp-refcount">
                                {refIndex >= 0 ? refIndex + 1 : "–"} / {refs.length}
                            </span>
                        </div>
                    )}
                    {/* DIRECTLY ABOVE THE BOARD IT FEEDS, and it STAYS OPEN.
                        It used to sit down with the master picker and close
                        itself on Trace, which threw away the country, the
                        search and the scroll position every time -- so doing
                        two things to one screen, or working through a country,
                        meant navigating back from the top on each one. Closing
                        is now only ever something you ask for. */}
                    <ScreenLibrary
                        open={libraryOpen && !!mode}
                        entries={templates}
                        onClose={() => setLibraryOpen(false)}
                        onLoad={loadTemplate}
                        onTrace={traceTemplate}
                        activeId={activeScreen ? activeScreen.id : ""}
                        onReload={refreshTemplates}
                        onStatus={(text, type) => setStatus({ text, type })}
                    />

                    {/* CANDIDATE SCRUBBER. Picking the in-situ image out of a
                        template is a heuristic and it misses -- a camera-roll
                        JPG or a screenshot outranks the real diagram often
                        enough that one guess is not enough. Only shown when
                        there is somewhere to go. */}
                    {refAlts.length > 1 && (
                        <div className={"bsp-refalts" + (refBroken ? " is-broken" : "")}>
                            <span className="bsp-bar-lbl">Reference</span>
                            <Tooltip text="Previous candidate">
                                <button
                                    className="bsp-refstep"
                                    disabled={refAlts.indexOf(refPath) <= 0}
                                    onClick={() => {
                                        const i = refAlts.indexOf(refPath);
                                        if (i > 0) swapReference(refAlts[i - 1]);
                                    }}
                                >‹</button>
                            </Tooltip>
                            <span className="bsp-refcount">
                                {refAlts.indexOf(refPath) + 1} / {refAlts.length}
                            </span>
                            <Tooltip text="Next candidate">
                                <button
                                    className="bsp-refstep"
                                    disabled={refAlts.indexOf(refPath) >= refAlts.length - 1}
                                    onClick={() => {
                                        const i = refAlts.indexOf(refPath);
                                        if (i >= 0 && i < refAlts.length - 1) swapReference(refAlts[i + 1]);
                                    }}
                                >›</button>
                            </Tooltip>
                            <Tooltip text={refPath}>
                                <span className="bsp-refalt-name">
                                    {(refPath.split("/").pop() || "")}
                                </span>
                            </Tooltip>
                        </div>
                    )}
                    {/* The wrap is what gets measured, and what centres a board
                        that has been fitted by height rather than width. */}
                    <div
                        className={"bsp-stagewrap" + (boardArmed ? " is-armed" : "")}
                        ref={stageWrapRef}
                        // Arming on mousedown rather than click so the keys are
                        // live before a drag even finishes. preventDefault is
                        // NOT used here -- the regions' own drag handlers need
                        // the event -- so focus is moved explicitly instead.
                        onMouseDown={() => { if (keyGrabRef.current) keyGrabRef.current.focus(); }}
                    >
                        {/* Genuinely focusable and genuinely invisible: display:none
                            and visibility:hidden cannot hold focus, which is the
                            whole mechanism. */}
                        <input
                            ref={keyGrabRef}
                            className="bsp-keygrab"
                            aria-label="Board shortcuts"
                            readOnly
                            onFocus={claimBoard}
                            onBlur={releaseBoard}
                            onKeyDown={onBoardKey}
                        />
                    <div
                        className="bsp-canvas"
                        ref={stageRef}
                        // Measured: an explicit rectangle, no ratio trick.
                        // Unmeasured (first paint): fall back to the padding-box
                        // ratio so the board still appears at the right shape
                        // for the one frame before the ResizeObserver fires.
                        style={stageBox
                            ? { width: `${stageBox.w}px`, height: `${stageBox.h}px`, paddingBottom: 0 }
                            : { width: "100%", paddingBottom: `${((Number(canvasH) || 1080) / (Number(canvasW) || 1920)) * 100}%` }}
                    >
                        {/* file:// because the panel is itself a file:// page --
                            CEP has no server to fetch a local image through. */}
                        {refPath && (
                            <img
                                className="bsp-canvas-ref"
                                src={fileUrl(refPath)}
                                alt=""
                                // The FILENAME is the deliverable's spec, so it
                                // wins; the image is checked against it rather
                                // than trusted. A reference exported at the
                                // wrong size would otherwise silently become
                                // the thing everything is traced over.
                                //
                                // ONLY THE ASPECT MATTERS, NOT THE PIXELS. These
                                // JPGs come out of the PDF at whatever the export
                                // felt like -- 8000x5867 for a 3840x2816 board is
                                // normal -- and the backdrop is stretched to the
                                // stage while every region coordinate is computed
                                // from the NAMED canvas size. A uniform rescale
                                // therefore cannot move anything by a pixel.
                                // Comparing dimensions flagged every one of those
                                // as broken, which trains people to ignore the
                                // one case that is genuinely wrong: a different
                                // SHAPE, where the image really is skewed against
                                // the canvas and tracing off it lands wide.
                                onLoad={(e) => {
                                    setRefBroken(false);
                                    const img = e.currentTarget;
                                    const cw = Number(canvasW) || 0;
                                    const ch = Number(canvasH) || 0;
                                    if (!cw || !ch || !img.naturalWidth || !img.naturalHeight) {
                                        setRefMismatch("");
                                        return;
                                    }
                                    const refAspect = img.naturalWidth / img.naturalHeight;
                                    const canAspect = cw / ch;
                                    // 0.5% covers rounding in the export; a real
                                    // wrong-shape reference is out by far more.
                                    const skew = Math.abs(refAspect - canAspect) / canAspect;
                                    setRefMismatch(
                                        skew > 0.005
                                            ? `Reference is ${img.naturalWidth}×${img.naturalHeight} (${refAspect.toFixed(2)}:1) but the name says ${cw}×${ch} (${canAspect.toFixed(2)}:1) — different shape, so tracing over it will be off.`
                                            : ""
                                    );
                                }}
                                // A reference that will not paint is a normal
                                // outcome here, not a bug: the path stored in
                                // the .aep may have moved, and a PSD or TIFF
                                // cannot be decoded by Chromium at all. Say
                                // which, and point at the way out.
                                onError={() => {
                                    setRefBroken(true);
                                    const ext = (refPath.split(".").pop() || "").toLowerCase();
                                    const undecodable = ext === "psd" || ext === "tif" || ext === "tiff";
                                    const more = refAlts.length > 1 ? " Try the next candidate." : "";
                                    setRefMismatch(
                                        undecodable
                                            ? `This reference is a .${ext}, which the panel can't display.${more}`
                                            : `Couldn't load that reference — the file may have moved.${more}`
                                    );
                                }}
                            />
                        )}
                        {(() => {
                            // THE AREA A REGION WOULD SNAP INTO, drawn before
                            // the regions so it reads as ground rather than as
                            // another box on top of them. Nothing interactive:
                            // it is a preview of Fit to guides, computed by the
                            // same bracket the button uses.
                            const cell = guideCell();
                            if (!cell) return null;
                            const cw = Number(canvasW) || 1920;
                            const ch = Number(canvasH) || 1080;
                            return (
                                <span
                                    className="bsp-cell"
                                    style={{
                                        left: `${(cell.x / cw) * 100}%`,
                                        top: `${(cell.y / ch) * 100}%`,
                                        width: `${(cell.w / cw) * 100}%`,
                                        height: `${(cell.h / ch) * 100}%`,
                                    }}
                                />
                            );
                        })()}
                        {regions.map((r, i) => {
                            const cw = Number(canvasW) || 1920;
                            const ch = Number(canvasH) || 1080;
                            const face = facing(r);
                            const cover = Math.max(r.w / face.w, r.h / face.h);
                            const lost = Math.round((1 - Math.min(r.w / (face.w * cover), r.h / (face.h * cover))) * 100);
                            return (
                                <div
                                    key={r.id}
                                    className={"bsp-region" + (i === selRegion ? " is-on" : "")}
                                    style={{
                                        left: `${(r.x / cw) * 100}%`, top: `${(r.y / ch) * 100}%`,
                                        width: `${(r.w / cw) * 100}%`, height: `${(r.h / ch) * 100}%`,
                                        background: hueFor(r.master.creative || r.master.name),
                                    }}
                                    onMouseDown={(e) => {
                                        const box = stageRef.current?.getBoundingClientRect();
                                        if (!box) return;
                                        setSelRegion(i);
                                        const handle = (e.target as HTMLElement).getAttribute("data-h") || "move";
                                        dragRef.current = { handle, sx: e.clientX, sy: e.clientY, box, start: r };
                                        e.preventDefault();
                                    }}
                                >
                                    {/* The master's own frame, where a render was
                                        found beside it. Behind everything else
                                        and click-through, so dragging the region
                                        still hits the region. */}
                                    <RegionShot src={previewOf(r.master)} rotation={r.rotation || 0} w={r.w} h={r.h} />
                                    {/* The marks below are what a quarter turn
                                        moves when there is NO artwork to turn --
                                        a flat colour block looks identical
                                        rotated. They still earn their place with
                                        a thumbnail present: the dashed outline is the
                                        master's WHOLE footprint at the cover
                                        scale, so it flips portrait to landscape
                                        and shows exactly what is spilling out
                                        of the region; the solid bar is the
                                        master's own top edge, which walks round
                                        the sides as it turns. */}
                                    {i === selRegion && (
                                    <span
                                        className="bsp-region-extent"
                                        style={{
                                            width: `${(face.w * cover / r.w) * 100}%`,
                                            height: `${(face.h * cover / r.h) * 100}%`,
                                            left: `${(1 - (face.w * cover / r.w)) * 50}%`,
                                            top: `${(1 - (face.h * cover / r.h)) * 50}%`,
                                        }}
                                    />
                                    )}
                                    <span className={`bsp-region-top bsp-region-top--${r.rotation || 0}`} />
                                    {/* WHICH WAY IS UP, stated outright. On a
                                        SQUARE master a quarter turn changes no
                                        geometry at all -- same footprint, same
                                        crop, identical extent box -- so the
                                        edge bar was the only cue, and it sat in
                                        the guides' own colour. An arrow that
                                        turns with the master is unambiguous
                                        whatever its shape. */}
                                    {r.rotation ? (
                                        <span
                                            className="bsp-region-up"
                                            style={{ transform: `rotate(${r.rotation}deg)` }}
                                        >
                                            ↑
                                        </span>
                                    ) : null}
                                    <span className="bsp-region-tag" title={r.master.name}>
                                        {/* WHICH MASTER THIS IS, not just its
                                            campaign. Two regions of the same
                                            creative at different sizes were
                                            indistinguishable, and the creative
                                            is empty often enough that this fell
                                            back to the whole filename. */}
                                        {regionLabel(r.master)}
                                        {lost > 0 ? ` · ${lost}% cropped` : ""}
                                        {overrunOf(r.master) > 0 ? ` · ${r.master.duration}s in ${runtime}s` : ""}
                                        {r.rotation ? ` · ${r.rotation}°` : ""}
                                    </span>
                                    {i === selRegion && ["nw", "ne", "sw", "se"].map((h) => (
                                        <span className={`bsp-h bsp-h--${h}`} data-h={h} key={h} />
                                    ))}
                                </div>
                            );
                        })}
                        {guidesY.map((g, i) => (
                            <span
                                key={"gy" + i}
                                className={"bsp-guide bsp-guide--h" + (selGuide?.axis === "y" && selGuide.i === i ? " is-on" : "")}
                                style={{ top: `${(g / (Number(canvasH) || 1080)) * 100}%` }}
                                onMouseDown={(e) => {
                                    const box = stageRef.current?.getBoundingClientRect();
                                    if (!box) return;
                                    setSelGuide({ axis: "y", i });
                                    dragRef.current = { handle: `guideY:${i}`, sx: e.clientX, sy: e.clientY, box, start: { id: 0, master: regions[0]?.master as BespokeMaster, rotation: 0, x: 0, y: g, w: 0, h: 0 } };
                                    e.preventDefault();
                                }}
                                onDoubleClick={() => setGuidesY((gs) => gs.filter((_, n) => n !== i))}
                                title={`y ${g} — drag to move, double-click to remove`}
                            />
                        ))}
                        {guidesX.map((g, i) => (
                            <span
                                key={"gx" + i}
                                className={"bsp-guide bsp-guide--v" + (selGuide?.axis === "x" && selGuide.i === i ? " is-on" : "")}
                                style={{ left: `${(g / (Number(canvasW) || 1920)) * 100}%` }}
                                onMouseDown={(e) => {
                                    const box = stageRef.current?.getBoundingClientRect();
                                    if (!box) return;
                                    setSelGuide({ axis: "x", i });
                                    dragRef.current = { handle: `guideX:${i}`, sx: e.clientX, sy: e.clientY, box, start: { id: 0, master: regions[0]?.master as BespokeMaster, rotation: 0, x: g, y: 0, w: 0, h: 0 } };
                                    e.preventDefault();
                                }}
                                onDoubleClick={() => setGuidesX((gs) => gs.filter((_, n) => n !== i))}
                                title={`x ${g} — drag to move, double-click to remove`}
                            />
                        ))}
                        {regions.length === 0 && (
                            <span className="bsp-canvas-empty">Pick a master below to drop the first region in.</span>
                        )}
                    </div>
                    </div>

                    {/* What is LEFT of the old guides row: the buttons moved
                        into the bar above, so this appears only when there is
                        something to say about a guide you have selected. */}
                    <div className="bsp-guidebar">
                        {selGuide && (
                            // TYPED, NOT DRAGGED. Dragging roughs a line in;
                            // landing it on an exact pixel from a brief is what
                            // it is actually for, and no amount of snapping
                            // makes a mouse hit 2380 on a 2816px canvas.
                            <span className="bsp-guidenum">
                                <label>
                                    {selGuide.axis === "y" ? "Horizontal at y" : "Vertical at x"}
                                    <input
                                        type="number"
                                        value={String(selGuide.axis === "y" ? guidesY[selGuide.i] : guidesX[selGuide.i])}
                                        onChange={(e) => setGuideAt(selGuide.axis, selGuide.i, Number(e.target.value))}
                                    />
                                </label>
                                <span className="bsp-guidenum-max">
                                    of {selGuide.axis === "y" ? canvasH : canvasW}
                                </span>
                                <button
                                    className="bsp-swaplink"
                                    onClick={removeSelectedGuide}
                                >
                                    remove
                                </button>
                            </span>
                        )}
                        {/* The two descriptive hints that used to live here are
                            gone. They cost a permanent row in a docked panel to
                            say something you learn once, and the shortcuts they
                            described are now on the keyboard. */}
                        {boardArmed && (
                            <span className="bsp-keyhint">
                                ← → ↑ ↓ move · ⇧ ×10 · H / V guide · ⌫ remove · + − 0 zoom
                            </span>
                        )}
                    </div>

                    {(refMismatch !== "" || overrunRegions.length > 0) && (
                        <ul className="bsp-problems">
                            {refMismatch !== "" && <li><AlertCircle size={10} /> {refMismatch}</li>}
                            {/* SAID OUT LOUD, BEFORE THE BUILD. AE renders the
                                first N seconds of an over-long layer without
                                complaint, so the only thing standing between a
                                dropped endcard and a delivered file is this
                                line. Both ways out are offered rather than one
                                being chosen silently. */}
                            {overrunRegions.map(({ i, r, over }) => (
                                <li key={r.id}>
                                    <AlertCircle size={10} />
                                    <span>
                                        R{i + 1} {regionLabel(r.master)} is {r.master.duration}s in a {runtime}s board —
                                        its last {over}s won't render.
                                    </span>
                                    <button
                                        className="bsp-swaplink"
                                        onClick={() => { setSwapTarget(i); setSelRegion(i); }}
                                    >
                                        swap the master
                                    </button>
                                    <span className="bsp-problems-or">or keep it and it plays from the start</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {swapTarget >= 0 && (
                        <p className="bsp-swapbar">
                            Pick a master below to drop into R{swapTarget + 1}. Its position and size stay put.
                            <button className="bsp-swaplink" onClick={() => setSwapTarget(-1)}>cancel</button>
                        </p>
                    )}

                    {/* ONE BLOCK, NOT TWO ROWS OF WIDE BUTTONS.
                        Selecting a region used to open a "Region N" row of four
                        unlabelled 66px number boxes with two full-width word
                        buttons after them, and then a SECOND row for the anchor
                        grid and three more -- roughly 90px of chrome between the
                        board and the shelf, on a docked panel that has to hold
                        both plus a warnings list.

                        Three things buy that back without removing a control:
                        the numbers are labelled and half the width (they were
                        sized for nothing in particular -- a board coordinate is
                        four digits), the two destructive actions are icons with
                        tooltips rather than words, and the whole thing is one
                        wrapping row so it reflows to the width available instead
                        of always taking two. */}
                    {regions[selRegion] && (
                        <div className="bsp-rtools">
                            {/* "Region 1", not "R1". The short form went through
                                .bsp-lbl's uppercase + 0.11em letter-spacing and
                                came out as "R 1", which reads as a stray letter
                                next to a stray number rather than as a label.
                                Saving four characters was never worth being the
                                one thing on the row nobody could identify. */}
                            <span className="bsp-rtools-id">Region {selRegion + 1}</span>
                            {/* Nine anchors, laid out as they sit on the canvas --
                                a 3x3 grid needs no labels to be read. Their
                                `title`s are left alone: a Tooltip wrapper would
                                become the grid item and each anchor is 15px of
                                pure position anyway. */}
                            <span className="bsp-align-lbl">Align</span>
                            <span className="bsp-align-grid">
                                {([0, 0.5, 1] as const).map((vy) =>
                                    ([0, 0.5, 1] as const).map((hx) => (
                                        <button
                                            key={`${hx}-${vy}`}
                                            className="bsp-anchor"
                                            title={`Snap to ${vy === 0 ? "top" : vy === 1 ? "bottom" : "middle"} ${hx === 0 ? "left" : hx === 1 ? "right" : "centre"}`}
                                            onClick={() => alignRegion(hx, vy)}
                                        />
                                    ))
                                )}
                            </span>
                            {/* WHICH BOX IS WHICH. Four bare numbers in a row is
                                a guess every time -- and x/y/w/h is the order
                                they are stored in, not an order anyone reads. */}
                            {(["x", "y", "w", "h"] as const).map((k) => (
                                <label className="bsp-num" key={k}>
                                    <span className="bsp-num-k">{k}</span>
                                    <input
                                        className="bsp-input bsp-input--n"
                                        value={String(regions[selRegion][k])}
                                        onChange={(e) => patchRegion(selRegion, { [k]: Math.round(Number(e.target.value) || 0) } as Partial<Region>)}
                                    />
                                </label>
                            ))}
                            <CheckboxToggle checked={lockRatio} onChange={setLockRatio} label="Keep ratio" />
                            <Tooltip text={`Size ${regions[selRegion]?.master.name || "this region"} to the guides either side of it — each axis independently, and an axis with no guides takes the full span`}>
                                <button className="bsp-btn bsp-btn--ghost" onClick={fitToGuides}>
                                    Fit to guides
                                </button>
                            </Tooltip>
                            <Tooltip text="Turn this region and its master a quarter clockwise — the region's width and height swap about its centre">
                                <button className="bsp-btn bsp-btn--ghost" onClick={rotateRegion}>
                                    Rotate 90° {regions[selRegion].rotation ? `(${regions[selRegion].rotation}°)` : ""}
                                </button>
                            </Tooltip>
                            <Tooltip text="Reshape this region to its master's own ratio, so nothing is cropped">
                                <button className="bsp-btn bsp-btn--ghost" onClick={matchMasterRatio}>
                                    Match master ratio
                                </button>
                            </Tooltip>
                            {/* Pushed to the far end, away from the shaping
                                controls: one of these deletes the region and it
                                should not sit under a cursor aiming for Rotate. */}
                            <span className="bsp-rtools-end">
                                <Tooltip text="Duplicate this region">
                                    <button className="bsp-btn bsp-btn--icon" onClick={duplicateRegion}>
                                        <Copy size={12} />
                                    </button>
                                </Tooltip>
                                <Tooltip text="Remove this region">
                                    <button className="bsp-btn bsp-btn--icon bsp-btn--danger" onClick={removeSelectedRegion}>
                                        <Trash2 size={12} />
                                    </button>
                                </Tooltip>
                            </span>
                        </div>
                    )}
                </>
            )}

            {mode === "multi" && (<>
            {/* --- the frame ----------------------------------------------- */}
            <p className="bsp-lbl bsp-lbl--section">This segment fills the frame</p>
            <div className="bsp-stage">
                <div className="bsp-tiles">
                    {seg && seg.tiles.map((m, i) => (
                        <motion.div
                            className="bsp-tile"
                            key={`${m.path}-${i}`}
                            style={{ background: hueFor(m.creative) }}
                            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                        >
                            {/* What tells this tile from its neighbours, not the
                                creative -- three tiles of one creative used to
                                read as the same word three times. */}
                            <span className="bsp-tile-name">{shortNameOf(m)}</span>
                            <span className="bsp-tile-spec">{m.size} · {m.duration}s</span>
                            {/* NOT wrapped in <Tooltip>: this button is
                                position:absolute against the tile, and the
                                wrapper's own position:relative would re-anchor
                                it into the flow. An X on a tile needs no
                                caption anyway -- the dead native `title` it
                                carried is simply gone. */}
                            <button className="bsp-tile-x" onClick={() => removeTile(i)}>
                                <X size={9} />
                            </button>
                        </motion.div>
                    ))}
                    {(!seg || seg.tiles.length === 0) && (
                        <span className="bsp-tiles-empty">Pick a master below to fill the frame.</span>
                    )}
                </div>
                <div className="bsp-stage-foot">
                    <span>
                        {seg && seg.tiles.length
                            ? `${seg.tiles.length} × ${tileWidth}px`
                            : "empty segment"}
                    </span>
                    <span>canvas {canvasW} × {canvasH}</span>
                </div>
            </div>

            <div className="bsp-segctl">
                <span className="bsp-lbl">Holds for</span>
                <input
                    className="bsp-input bsp-input--n"
                    value={seg ? String(seg.seconds) : ""}
                    onChange={(e) => setSeg((s) => ({ ...s, seconds: Math.max(0, Number(e.target.value) || 0) }))}
                />
                <span className="bsp-x">s</span>
                <button className="bsp-btn bsp-btn--ghost" onClick={removeSegment} disabled={segments.length <= 1}>
                    <Trash2 size={11} /> Remove segment
                </button>
                <Tooltip text={duplicatePanels
                    ? "Each panel gets its own copy — edit one without touching the others"
                    : "Every panel of a master shares one comp — edit it once and they all follow"}>
                    <span className="bsp-toggle">
                        <CheckboxToggle
                            checked={duplicatePanels}
                            onChange={setDuplicatePanels}
                            label="Separate comp per panel"
                        />
                    </span>
                </Tooltip>
            </div>

            {/* --- running order ------------------------------------------- */}
            <p className="bsp-lbl bsp-lbl--section">Running order</p>
            <div className="bsp-timeline">
                {segments.map((s, i) => {
                    const name = s.tiles.length === 0 ? "empty"
                        : s.tiles.length === 1 ? (s.tiles[0].creative || s.tiles[0].name)
                        : `${s.tiles.length} × ${s.tiles[0].creative || s.tiles[0].name}`;
                    return (
                        <button
                            key={s.id}
                            className={"bsp-seg" + (i === current ? " is-on" : "")}
                            // GROW-proportional, not a percentage basis. Bases of
                            // 70% + 30% already fill the row, so the gaps and the
                            // fixed-width + button pushed it past the panel edge.
                            // Growing from a zero basis shares whatever is LEFT
                            // after those, which is the actual space available --
                            // and keeps each segment's width proportional to its
                            // duration, which is the point of the strip.
                            style={{ flex: `${Math.max(s.seconds, 0.5)} 1 0%` }}
                            onClick={() => setCurrent(i)}
                        >
                            <span className="bsp-seg-name">{name}</span>
                            <span className="bsp-seg-secs">{s.seconds}s</span>
                        </button>
                    );
                })}
                <Tooltip text="Add a segment after this one">
                    <button className="bsp-seg-add" onClick={addSegment}><Plus size={12} /></button>
                </Tooltip>
            </div>

            </>)}

            {(mode === "multi") && (blockers.length > 0 || notes.length > 0) && (
                <ul className="bsp-problems">
                    {blockers.map((p) => (
                        <li key={p}><AlertCircle size={10} /> {p}</li>
                    ))}
                    {notes.map((p) => (
                        <li className="is-note" key={p}><AlertCircle size={10} /> {p}</li>
                    ))}
                </ul>
            )}

            {/* --- the picker ----------------------------------------------- */}
            {/* FOLDED BY DEFAULT. The grid is the tallest thing in the tool and
                it is only needed at the moment you add a master -- the rest of
                the time it pushes the canvas off screen. The summary carries
                the state that matters while it is shut: which creative is
                filtered, and how many masters that leaves.
                It opens itself for a SWAP, because a swap is a request to pick
                something and closing the list you were sent to would be
                perverse. */}
            </div>
            <div className="bsp-work-side">
            <button
                className={"bsp-fold" + (pickerOpen || swapTarget >= 0 ? " is-on" : "")}
                onClick={() => setPickerOpen((v) => !v)}
                hidden={!mode}
            >
                <ChevronRight size={11} className="bsp-fold-caret" />
                <span className="bsp-fold-label">
                    {swapTarget >= 0
                        ? `Replace R${swapTarget + 1}`
                        : mode === "regions" ? "Add a master as a region" : "Add a master to this segment"}
                </span>
                <span className="bsp-fold-summary">
                    {swapTarget >= 0
                        ? "its position is kept"
                        : `${creative || "no creative"} · ${matches.length} master${matches.length === 1 ? "" : "s"}`}
                </span>
            </button>
            <div className="bsp-picker" hidden={!mode || (!pickerOpen && swapTarget < 0)}>
                <div className="bsp-filters">
                    {ORIENTATION_ORDER.map((key) => {
                        const Icon = ORIENTATION_ICON[key];
                        const n = orientCounts[key] || 0;
                        return (
                            <button
                                key={key}
                                className={"bsp-chip" + (orient === key ? " is-on" : "")}
                                disabled={n === 0}
                                // Clicking the active one clears back to all,
                                // and either way the automatic guess stands
                                // down -- an explicit choice outranks it.
                                onClick={() => {
                                    setOrientTouched(true);
                                    setOrient((cur) => (cur === key ? "" : key));
                                }}
                            >
                                <Icon size={11} />
                                {key.charAt(0) + key.slice(1).toLowerCase()}
                            </button>
                        );
                    })}
                    <Dropdown
                        className="bsp-dur"
                        value={durFilter}
                        onChange={setDurFilter}
                        options={[{ value: "", label: "Any duration" }]
                            .concat(durations.map((d) => ({ value: d, label: `${d}s` })))}
                        placeholder="Any duration"
                        emptyMessage="No durations to filter by."
                    />
                </div>
                {/* SAME SHAPE AS THE SCREEN LIBRARY: the primary axis is a
                    vertical rail, the results are a grid beside it. Creative is
                    to masters what territory is to screens -- the question you
                    answer first -- and it was previously a horizontal scroller,
                    which hid every creative past the fourth on a busy campaign
                    and cost the grid a whole row of height to do it. */}
                <div className="bsp-picker-body">
                <div className="bsp-creatives">
                    {/* THE FULL NAME, ON HOVER. The rail ellipsises -- it has to,
                        or one long creative name widens it and squeezes the
                        grid -- and "GUTTE…" next to "JUNG…" is not a choice
                        anyone can make. The native `title` this replaces never
                        appeared: CEP's host is not a browser chrome and does
                        not render them. Not Tooltip's `grow` prop, which sets
                        `flex: 1` -- in this COLUMN rail that fills the height,
                        not the width (CLAUDE.md); the width is carried through
                        by a scoped rule in Bespoke.scss instead.

                        The delay is per Tooltip's own note: the cursor sweeps
                        this rail on the way to the grid, and a bubble firing
                        under it at every row passed reads as spam, not help. */}
                    {creatives.map((c) => (
                        <Tooltip key={c.name} text={c.name} delay={220}>
                            <button
                                className={"bsp-creative" + (creative === c.name ? " is-on" : "")}
                                onClick={() => setCreative(c.name)}
                            >
                                <span className="bsp-creative-sw" style={{ background: hueFor(c.name) }} />
                                <span className="bsp-creative-nm">{c.name}</span><em>{c.count}</em>
                            </button>
                        </Tooltip>
                    ))}
                </div>

                <div className="bsp-list">
                    {/* SKELETON, not a spinner. The walk is one synchronous
                        evalTS -- ExtendScript blocks AE for its whole duration,
                        so there is no channel to report progress through and a
                        percentage would have to be invented. Showing the SHAPE
                        of what is coming is honest about that, and the copy
                        says why the wait happens once. */}
                    {loading && Array.from({ length: 6 }).map((_, i) => (
                        <span className="bsp-skel" key={i} style={{ animationDelay: reduced ? undefined : `${i * 0.08}s` }}>
                            <span className="bsp-skel-sw" />
                            <span className="bsp-skel-name" style={{ width: `${52 + ((i * 13) % 34)}%` }} />
                            <span className="bsp-skel-tag" />
                        </span>
                    ))}
                    {loading && (
                        <LoadingChatter
                            className="bsp-chatter"
                            lines={[
                                "Walking the masters folder…",
                                "Every .aep under it gets opened for its name",
                                "On a big campaign this is a few hundred files",
                                "It's cached after this — the next open is instant",
                                "Still going…",
                            ]}
                        />
                    )}
                    {!loading && !masters && <p className="bsp-none">Pick a masters folder to browse.</p>}
                    {!loading && masters && matches.length === 0 && <p className="bsp-none">No master matches those filters.</p>}
                    {!loading && matches.map((m) => (
                        <MasterCard
                            key={m.path}
                            master={m}
                            label={shortNameOf(m)}
                            preview={previewOf(m)}
                            swapping={swapTarget >= 0}
                            used={regions.filter((r) => r.master.path === m.path).length}
                            onPick={() => {
                                // ONLY A SWAP CLOSES THIS, because only a swap is
                                // finished when it is done -- it was opened by a
                                // specific region asking to be replaced, and that
                                // question has now been answered.
                                //
                                // ADDING stays open in BOTH modes. It used to
                                // close in regions mode, on the reasoning that a
                                // region is placed and then positioned on the
                                // canvas -- but a bespoke board is several regions
                                // picked in a row just as much as a segment is, so
                                // that cost a reopen and the filters you had set
                                // for every region after the first. Multi Art
                                // already worked this way; this is the same rule
                                // applied to both.
                                if (swapTarget >= 0) { swapRegion(m); setPickerOpen(false); return; }
                                if (mode === "regions") { addRegion(m); return; }
                                addTile(m);
                            }}
                        />
                    ))}
                </div>
                </div>
            </div>
            </div>
            </div>

            {status && (
                <p className={"bsp-status is-" + status.type}>
                    <StatusIcon type={status.type} size={12} /> {status.text}
                </p>
            )}

            {/* Says plainly what this does NOT do yet, rather than offering a
                Build button that would have to guess how masters are placed. */}
            {/* SAVING A LAYOUT IS NOT BUILDING ONE, so it does not get a
                primary button. Ghost weight, to the left of Build. */}
            {mode === "regions" && regions.length > 0 && (
                <div className="bsp-tpl">
                    {saving ? (
                        <>
                            <input
                                className="bsp-input bsp-tpl-name"
                                value={tplName}
                                autoFocus
                                placeholder={site.trim() || "name this screen"}
                                onChange={(e) => setTplName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveTemplate(); if (e.key === "Escape") setSaving(false); }}
                            />
                            {/* SAYS WHERE IT IS ABOUT TO GO. Which country a
                                layout lands in was invisible and guessable-wrong
                                -- and "Unfiled" is what you get with no traced
                                screen and no country chosen, which is worth
                                seeing BEFORE pressing Save rather than
                                discovering in the rail afterwards. */}
                            <span className="bsp-tpl-dest">
                                → {saveTerritory || "Unfiled"}
                                {activeScreen && activeScreen.territory ? " (from the screen)" : ""}
                            </span>
                            <button className="bsp-btn bsp-btn--ghost" onClick={saveTemplate} disabled={!tplName.trim()}>
                                Save
                            </button>
                            <button className="bsp-swaplink" onClick={() => setSaving(false)}>cancel</button>
                        </>
                    ) : (
                        <button
                            className="bsp-btn bsp-btn--ghost"
                            // Defaults to the traced screen's own name, so
                            // re-saving it keeps the same id and REPLACES the
                            // template rather than making a near-duplicate. The
                            // site is the fallback for a board built fresh.
                            onClick={() => { setTplName((activeScreen && activeScreen.name) || site.trim()); setSaving(true); }}
                        >
                            Save this layout
                        </button>
                    )}
                </div>
            )}

            <div className="bsp-pending" hidden={!mode}>
                <Tooltip text={mode === "regions"
                    ? (regions.length ? "Import the masters and assemble the regions" : "Add a region first")
                    : (blockers.length ? "Every segment needs at least one creative" : "Import the masters and assemble the composition")}>
                    <button
                        className="bsp-btn"
                        onClick={mode === "regions" ? runBuildRegions : runBuild}
                        disabled={building || (mode === "regions" ? regions.length === 0 : blockers.length > 0)}
                    >
                        {building ? "Building…" : "Build composition"}
                    </button>
                </Tooltip>
            </div>

            {report && (
                <div className="bsp-probe">
                    <div className="bsp-probe-head">
                        <span>What the build did</span>
                        <button className="bsp-probe-x" onClick={() => setReport(null)} title="Dismiss"><X size={11} /></button>
                    </div>
                    <pre className="bsp-probe-body">{report}</pre>
                </div>
            )}
        </div>
    );
};

export default BespokeTool;
