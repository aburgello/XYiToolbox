// =============================================================================
// src/js/main/screens/LocaliseScreen.tsx
// -----------------------------------------------------------------------------
// Bespoke Localise landing: a prominent Localised Library hero (opens
// full-width), a two-pane "localise a campaign" work surface (CSV Localiser /
// Trott & Batch), and a flat tools row below, instead of the shared vertical
// rail. When a tool is selected it renders full-width in place.
// =============================================================================
import React, { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { motion, useReducedMotion } from "motion/react";
import gsap from "gsap";
import LoadingChatter from "../LoadingChatter";
import {    Layers,
 ArrowLeft, FileSignature, Stamp, ClipboardCheck, Clapperboard, FileText, Copy, Image as ImageIcon, FileSpreadsheet, Rabbit, ScanSearch, Repeat, FileSearch} from "lucide-react";
import { TOOLS, categoryStyleVars, type ToolProps } from "../toolRegistry";
import { ToolErrorBoundary } from "../ToolErrorBoundary";
import { PaletteTrigger, triggerPalette } from "../CommandPalette";
import Tooltip from "../Tooltip";
import StatusIcon from "../StatusIcon";
import { evalTS } from "../../lib/utils/bolt";
import CSVLocaliserTool, { type LocaliserCampaignInfo } from "../tools/CSVLocaliser";
import LocaliseLibraryCard, { type HereTerritory } from "./LocaliseLibraryCard";
import { territoryFlag } from "../lib/jobsFeed";
import { toFileUrl } from "../lib/fileUrl";
import { setPendingLibraryCampaign } from "../lib/localiseHandoff";
import CampaignLocaliserTool from "../tools/CampaignLocaliser";
import { sfx } from "../../lib/utils/sfx";
import "./LocaliseScreen.scss";
import HomeButton from "../HomeButton";
import TutorialIcon from "../TutorialIcon";

interface Props {
    selectedToolId?: string;
    onSelectTool: (toolId: string) => void;
    onBack: () => void;
    onHome: () => void;
}

interface UtilityEntry {
    id: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
}

// The work surface holds the two halves of ONE job -- "localise a campaign":
// CSV Localiser and Trott/Batch. The Localised Library used to be a third,
// co-equal pane here, but it's a genuinely different job (browsing/importing
// existing localised components per territory), and being sandwiched between
// the two campaign-localisation tools flattened that distinction. It's now
// pulled out into its own prominent hero above the surface (opens full-width),
// so it reads as its own first-class destination rather than a middle tab.
type Pane = "csv" | "batch";
const PANES: { id: Pane; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "csv",   label: "Big Guy Localiser", icon: FileSpreadsheet },
    { id: "batch", label: "Trott & Batch", icon: Rabbit },
];

// ONE flat list of tools. Previously this was split into a numbered
// "Localisation Workflow" strip with -> arrows plus a separate utilities
// grid, which implied a rigid pipeline nobody actually follows in order.
// They're just tools, so they're presented as tools -- plain rounded buttons,
// separated by a divider rather than arrows. `run` marks the ones that are a
// single parameterless call and so execute in place instead of opening a page
// whose only content is that button.
const TOOLS_ROW: (UtilityEntry & { run?: string })[] = [
    { id: "ov-swap",           label: "OV Swap",        icon: Repeat },
    { id: "bespoke",           label: "It's Bespokin' Time", icon: Layers },
    { id: "pdf-to-csv",        label: "PDF to CSV",     icon: FileSpreadsheet, run: "pdfToCsvGenerate" },
    { id: "jpeg-loc",          label: "JPEG Loc",       icon: ImageIcon,       run: "jpegLoc" },
    { id: "aep-thief",         label: "AEP Thief",      icon: Copy,            run: "copyAep" },
    { id: "cheeky-dt",         label: "Cheeky DT",      icon: Stamp },
    // NEXT TO Check, because it is the same kind of question -- "is this
    // deliverable right?" -- asked of the artwork rather than the comp.
    { id: "artwork-check",     label: "Artwork Check",  icon: FileSearch },
    { id: "check",             label: "Check",          icon: ClipboardCheck },
    { id: "name-audit",        label: "Naming Audit",   icon: ScanSearch },
    { id: "generate-cue-sheet",label: "Cue Sheet",      icon: FileText },
    { id: "name-generator",    label: "Name Generator", icon: FileSignature },
    { id: "edit-generator",    label: "Edit Generator", icon: Clapperboard },
];

// Tools that draw their OWN header on this screen, so the shared strip
// (icon, name, underline) is skipped for them. Each must carry its own
// TutorialIcon, or its _tuts clip has nowhere to play from (CLAUDE.md).
const OWN_HEADER_IDS = ["localised-library"];

// The same tools, by the kind of job. Every TOOLS_ROW id appears exactly once;
// an id missing here would simply not render, so keep the two in step.
const TOOL_GROUPS: { name: string; ids: string[] }[] = [
    { name: "Prepare",      ids: ["pdf-to-csv", "name-generator", "edit-generator", "generate-cue-sheet"] },
    { name: "Swap & build", ids: ["ov-swap", "jpeg-loc", "aep-thief", "bespoke"] },
    { name: "Check",        ids: ["artwork-check", "check", "name-audit", "cheeky-dt"] },
];

/** Placeholder furniture for a tool that hasn't mounted yet. Bounded by the
 *  mount, so it isn't one of the perpetual animations the home screen bans. */
const ToolSkeleton = () => (
    <div className="ls-toolskel" aria-label="Loading the tool">
        <span className="ls-toolskel-title" />
        <span className="ls-toolskel-sub" />
        <div className="ls-toolskel-rows">
            {[68, 92, 54, 80].map((w, i) => (
                <span className="ls-toolskel-row" key={i} style={{ width: `${w}%`, animationDelay: `${i * 0.09}s` }} />
            ))}
        </div>
        <LoadingChatter
            lines={[
                "Opening the tool…",
                "Still opening — the panel bundle is a big one",
            ]}
            intervalMs={3200}
        />
    </div>
);

const toolDescription = (id: string): string =>
    TOOLS.find((t) => t.id === id)?.description || "";

// One-shot landing cascade per session -- returning from a tool used to
// replay the full stagger every time (the effect is keyed on [tool]).
let lsEntranceDone = false;

export const LocaliseScreen: React.FC<Props> = ({ selectedToolId: parentToolId, onSelectTool, onBack, onHome }) => {
    const reduced = useReducedMotion();
    const [localToolId, setLocalToolId] = useState<string | null>(null);
    const effectiveToolId = parentToolId ?? localToolId;
    const tool = effectiveToolId ? TOOLS.find((t) => t.id === effectiveToolId) : null;
    const landingRef = useRef<HTMLDivElement>(null);

    // Run-in-place state for the parameterless one-shots (see WORKFLOW_STAGES /
    // SUPPORT_TOOLS `run`): a single status line under the spine, so clicking
    // "JPEG Loc" does the job right here instead of navigating to a page whose
    // only content is that same button.
    const [runningId, setRunningId] = useState<string | null>(null);
    const [runStatus, setRunStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [pane, setPane] = useState<Pane>("csv");

    // THE CAMPAIGN THE LIBRARY CARD NAMES, reported up by CSV Localiser so the
    // two can never disagree.
    const [libCampaign, setLibCampaign] = useState<LocaliserCampaignInfo | null>(null);
    const onCampaignChange = useCallback((c: LocaliserCampaignInfo | null) => {
        setLibCampaign((prev) =>
            prev && c && prev.name === c.name && prev.marketsRoot === c.marketsRoot && prev.banner === c.banner ? prev : c);
    }, []);
    // Open the Library on the campaign the card names -- and straight into a
    // territory when one of its rows was pressed.
    const openLibrary = useCallback((territory?: string) => {
        sfx.click();
        setPendingLibraryCampaign(libCampaign ? libCampaign.name : null, territory);
        handleSelect("localised-library");
    }, [libCampaign]);
    // WHERE YOU ARE, for the header: the territory the Library card detected
    // for the open project, and the batch folder the project sits in. The
    // batch is only claimed when the path really is <Territory>/AE/<Batch_*>/;
    // anything looser and a project in somebody's Downloads would announce a
    // batch it isn't in.
    const [here, setHere] = useState<HereTerritory | null>(null);
    const onHere = useCallback((t: HereTerritory | null) => {
        setHere((prev) => (prev && t && prev.name === t.name && prev.code === t.code) || (!prev && !t) ? prev : t);
    }, []);
    const [openPath, setOpenPath] = useState("");
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const f = (await evalTS("timesheetActiveFile")) as { path?: string | null } | undefined;
                if (!cancelled) setOpenPath((f && f.path) || "");
            } catch { /* no bridge or no project -- no batch, no fuss */ }
        })();
        return () => { cancelled = true; };
    }, [libCampaign?.name]);
    const hereBatch = (() => {
        if (!here || !openPath) return "";
        const bits = openPath.split(/[\\/]/);
        const ti = bits.lastIndexOf(here.name);
        if (ti < 0 || String(bits[ti + 1] || "").toUpperCase() !== "AE") return "";
        const b = bits[ti + 2] || "";
        return /^batch/i.test(b) && ti + 3 < bits.length ? b : "";
    })();
    const libraryCard = <LocaliseLibraryCard campaign={libCampaign} onOpen={openLibrary} onHere={onHere} />;

    const runInPlace = async (id: string, label: string, fnName: string) => {
        setRunningId(id);
        setRunStatus(null);
        try {
            const result = await evalTS(fnName as Parameters<typeof evalTS>[0]);
            if (result === undefined) throw new Error("no bridge");
            const r = result as { success?: boolean; message?: string; error?: string };
            if (r.success) {
                sfx.success();
                setRunStatus({ type: "success", text: r.message || `${label} finished.` });
            } else {
                sfx.error();
                setRunStatus({ type: "error", text: r.error || `${label} failed.` });
            }
        } catch (e) {
            sfx.error();
            setRunStatus({ type: "error", text: "No CEP bridge detected. Open this panel inside After Effects." });
        } finally {
            setRunningId(null);
        }
    };

    const handleSelect = (toolId: string) => {
        setLocalToolId(toolId);
    };

    const handleBack = () => {
        if (effectiveToolId) {
            setLocalToolId(null);
        } else {
            onBack();
        }
    };

    const env = categoryStyleVars("localise");

    useEffect(() => {
        if (tool || !landingRef.current) return;
        if (lsEntranceDone) return; // already cascaded this session -- render static
        lsEntranceDone = true;
        const ctx = gsap.context(() => {
            // The hero + the work surface are the "cards" tier now (the old two
            // big .ls-card tiles are gone); tools row cascades after.
            const cards = gsap.utils.toArray<HTMLElement>(".ls-main");
            const gridItems = gsap.utils.toArray<HTMLElement>(".ls-grid-item, .ls-stage");
            const gridLabel = gsap.utils.toArray<HTMLElement>(".ls-grid-label");

            gsap.set([...cards, ...gridLabel, ...gridItems], { opacity: 0, y: 24 });

            const tl = gsap.timeline();
            tl.to(cards, {
                opacity: 1,
                y: 0,
                duration: 0.5,
                ease: "back.out(1.4)",
                stagger: 0.08,
            })
            .to(gridLabel, {
                opacity: 1,
                y: 0,
                duration: 0.3,
                ease: "power2.out",
            }, "-=0.3")
            .to(gridItems, {
                opacity: 1,
                y: 0,
                duration: 0.25,
                ease: "power2.out",
                stagger: 0.02,
            }, "-=0.2");
        }, landingRef);

        return () => ctx.revert();
    }, [tool]);

    if (tool) {
        const Component = tool.Component as React.ComponentType<ToolProps>;
        return (
            <div className="drill-screen">
                <div className="category-ambient-bg" aria-hidden="true">
                    <motion.div
                        className="category-ambient-blob category-ambient-blob--tl category-ambient-blob--localise"
                        animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <motion.div
                        className="category-ambient-blob category-ambient-blob--br category-ambient-blob--localise"
                        animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 4 }}
                    />
                </div>
                <div className="drill-page-content">
                    <div className="drill-header-row">
                        <motion.button className="back-button" onClick={handleBack} whileHover={{ x: -2 }}>
                            <ArrowLeft size={14} /> Back
                        </motion.button>
                        <HomeButton onHome={onHome} />
                        <PaletteTrigger onClick={triggerPalette} />
                    </div>
                    <div className="ls-frame">
                        <div className="ls-tool-wrap" style={env}>
                        <ToolErrorBoundary toolLabel={tool.label}>
                            {/* A SHAPE, not the word "Loading". This covers the gap before a tool's
                                module has mounted -- every Localise tool passes through it, and a
                                bare line of text on an otherwise empty pane reads as a panel that
                                has hung rather than one that is working. */}
                            <Suspense fallback={<ToolSkeleton />}>
                                {/* Tools that draw their own header (the Library leads
                                    with its campaign) skip the shared strip. They must
                                    carry their own TutorialIcon -- see OWN_HEADER_IDS. */}
                                {OWN_HEADER_IDS.indexOf(tool.id) === -1 && (
                                    <div className="tool-content-header ls-tool-header" style={env}>
                                        <TutorialIcon
                                            toolId={tool.id}
                                            toolLabel={tool.label}
                                            className="ls-header-icon"
                                            hover="pop"
                                        >
                                            <tool.icon size={24} />
                                        </TutorialIcon>
                                        <h3 className="tool-content-header-title">{tool.label}</h3>
                                        <motion.div
                                            className="ls-header-line"
                                            initial={{ scaleX: 0 }}
                                            animate={{ scaleX: 1 }}
                                            transition={{ duration: 0.5, ease: "easeOut" }}
                                        />
                                    </div>
                                )}
                                <div className="tool-content-body">
                                    <Component onSelectTool={handleSelect} />
                                </div>
                            </Suspense>
                        </ToolErrorBoundary>
                    </div>
                </div>
                </div>
            </div>
        );
    }

    return (
        <div className="drill-screen">
            <div className="category-ambient-bg" aria-hidden="true">
                <motion.div
                    className="category-ambient-blob category-ambient-blob--tl category-ambient-blob--localise"
                    animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                    className="category-ambient-blob category-ambient-blob--br category-ambient-blob--localise"
                    animate={reduced ? {} : { opacity: [0.5, 1, 0.5], scale: [1, 1.06, 1] }}
                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 4 }}
                />
            </div>
            <div className="drill-page-content">
                <div className="drill-header-row">
                    <motion.button className="back-button" onClick={handleBack} whileHover={{ x: -2 }}>
                        <ArrowLeft size={14} /> Back
                    </motion.button>
                    <HomeButton onHome={onHome} />
                    <PaletteTrigger onClick={triggerPalette} />
                </div>

                <div className="ls-frame" style={env}>
                    <div className="ls-landing" ref={landingRef}>
                    {/* THE PAGE, CAMPAIGN-LED. The Library used to be a full-width
                        banner up here, read as a heading and skipped; it is now a
                        card beside the campaign it belongs to (under it on a narrow
                        dock -- LocaliseScreen.scss), showing the territories behind
                        it. CSV Localiser places it, because only it knows whether
                        the campaign is set up (card beside the campaign) or still
                        being filled in (card above the form). */}
                    <div className="ls-main">
                        {/* The campaign's own artwork, blurred behind the header,
                            so the page takes Street Fighter's colour rather than
                            generic teal. One still image; nothing animates. */}
                        {libCampaign && libCampaign.banner && (
                            <span className="ls-head-wash" aria-hidden="true">
                                <img src={toFileUrl(libCampaign.banner)} alt="" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
                            </span>
                        )}
                        <div className="ls-main-head">
                            {/* WHERE YOU ARE, not what the page is: the category
                                button already said "Localise". With a project
                                open in one of this campaign's territories, that
                                territory (and its batch) is the headline. */}
                            {here ? (
                                <span className="ls-page-heading">
                                    <span className="ls-page-kicker">
                                        Localise{libCampaign ? " · " + libCampaign.name : ""}
                                    </span>
                                    <span className="ls-page-title">
                                        {territoryFlag(here.code) && <span className="ls-page-flag">{territoryFlag(here.code)}</span>}
                                        {here.name.replace(/_/g, " ")}
                                        {hereBatch && <span className="ls-page-batch"> · {hereBatch}</span>}
                                    </span>
                                </span>
                            ) : (
                                <span className="ls-page-title">Localise</span>
                            )}
                            <div className="ls-pane-tabs" role="tablist">
                                {PANES.map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        role="tab"
                                        aria-selected={pane === id}
                                        className={pane === id ? "ls-pane-tab active" : "ls-pane-tab"}
                                        onClick={() => { sfx.click(); setPane(id); }}
                                    >
                                        <Icon size={13} />
                                        <span>{label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* Trott & Batch has no campaign card to sit beside, so
                            the Library leads the pane on its own. */}
                        {pane === "batch" && <div className="ls-libcard-solo">{libraryCard}</div>}
                        <div className={"ls-main-surface" + (pane === "csv" ? " is-bare" : "")}>
                            {/* onSelectTool is what makes the localiser's own
                                "Bespoke It" button able to navigate. The drilled
                                tool at the top of this file already receives it;
                                the LANDING pane did not, so that button silently
                                did nothing. */}
                            {pane === "csv" && (
                                <CSVLocaliserTool
                                    onSelectTool={handleSelect}
                                    onCampaignChange={onCampaignChange}
                                    librarySlot={libraryCard}
                                    hereTerritory={here ? here.name : undefined}
                                />
                            )}
                            {pane === "batch" && <CampaignLocaliserTool />}
                        </div>
                    </div>

                    {/* Tools, in three groups. Not a pipeline (the numbered
                        strip that implied one is gone for good) -- just the
                        kinds of job, so twelve identical buttons stop being a
                        wall. Group labels are names, not explanations. */}
                    <div className="ls-tools">
                        <span className="ls-tools-title">Tools</span>
                        <div className="ls-tool-groups">
                            {TOOL_GROUPS.map((g) => (
                                <div key={g.name} className="ls-tool-group">
                                    <span className="ls-grid-label">{g.name}</span>
                                    {g.ids.map((tid) => {
                                        const entry = TOOLS_ROW.filter((t) => t.id === tid)[0];
                                        if (!entry) return null;
                                        const { id, label, icon: Icon, run } = entry;
                                        return (
                                            <Tooltip key={id} text={run ? `${toolDescription(id)} (runs here)` : toolDescription(id)} delay={500}>
                                                <button
                                                    className={run ? "ls-grid-item ls-grid-item--runnable" : "ls-grid-item"}
                                                    disabled={runningId === id}
                                                    onClick={() => {
                                                        if (run) { sfx.click(); runInPlace(id, label, run); }
                                                        else { sfx.click(); handleSelect(id); }
                                                    }}
                                                >
                                                    <span className="ls-grid-item-icon"><Icon size={14} /></span>
                                                    <span>{runningId === id ? "Running…" : label}</span>
                                                </button>
                                            </Tooltip>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                        {runStatus && (
                            <div className={`loc-status loc-status-${runStatus.type} ls-run-status`}>
                                <StatusIcon type={runStatus.type} />
                                <span>{runStatus.text}</span>
                            </div>
                        )}
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
};


