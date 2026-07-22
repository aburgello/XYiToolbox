// =============================================================================
// src/js/lib/utils/demoBridge.ts
// -----------------------------------------------------------------------------
// DEMO MODE — makes the panel fully clickable in a plain web browser (a hosted
// build the team can try WITHOUT After Effects), by simulating the ExtendScript
// bridge instead of dead-ending on "No CEP bridge detected".
//
// This is 100% inert inside real After Effects: isDemoMode() is only true when
// window.__adobe_cep__ is ABSENT (i.e. a browser). In the real CEP panel the
// bridge exists, getDemoResult() is never consulted, and evalTS behaves exactly
// as before. So shipping this in the ZXP changes nothing for artists.
//
// Design (see the long analysis in the demo-mode task):
//   • ACTION functions (turkIt, delivery, organiseFolders, …) resolve a
//     simulated { success:true } so their toasts read as completed.
//   • A curated SHAPED map returns realistic objects for the handful of calls
//     whose RESULT is consumed structurally (delivery comps, name-detect
//     fields, preflight report, ease presets, …) so those UIs don't crash.
//   • Folder PICKERS resolve null ("cancelled") — a safe no-op.
//   • Everything else is left UNHANDLED so evalTS proceeds normally and rejects
//     exactly as it does in the browser today — which is what triggers each
//     data tool's own React-side mock fallback (OV Library, Localised Library,
//     Timesheet, Expressions Bank, …). Never default-success here: a data
//     loader that got { success:true } instead of its array would crash.
// =============================================================================

export function isDemoMode(): boolean {
    return (
        typeof window !== "undefined" &&
        !(window as { __adobe_cep__?: unknown }).__adobe_cep__
    );
}

const DEMO_MSG = "Simulated in demo mode — open this panel inside After Effects to run it for real.";
const ok = (extra?: Record<string, unknown>) => ({ success: true, message: DEMO_MSG, ...extra });

// --- Realistic demo data for calls whose return value drives the UI ----------
const DEMO_COMPS = [
    {
        id: 9001,
        name: "ODY_INTL_DGTL_DOOH_HORSE_1920x1080_15sec_FR",
        folderName: "Batch_3",
        batchFolder: "Batch_3",
        territoryCode: "FR",
        sourcePath: "/Volumes/newmedia/XYi Design/Odyssey/AE/Batch_3/HORSE_1920x1080.mov",
        duration: 15,
        frameRate: 25,
    },
    {
        id: 9002,
        name: "ODY_INTL_DGTL_DOOH_HORSE_1920x858_10sec_FR",
        folderName: "Batch_3",
        batchFolder: "Batch_3",
        territoryCode: "FR",
        sourcePath: "/Volumes/newmedia/XYi Design/Odyssey/AE/Batch_3/HORSE_1920x858.mov",
        duration: 10,
        frameRate: 25,
    },
];

const DEMO_EASE_PRESETS = [
    { id: "builtin-linear", name: "Linear", isBuiltIn: true, inType: 1, outType: 1, inInfluence: 0, inSpeed: 0, outInfluence: 0, outSpeed: 0 },
    { id: "builtin-standard", name: "Standard Ease", isBuiltIn: true, inType: 2, outType: 2, inInfluence: 33, inSpeed: 0, outInfluence: 33, outSpeed: 0 },
    { id: "builtin-soft", name: "Soft Ease", isBuiltIn: true, inType: 2, outType: 2, inInfluence: 15, inSpeed: 0, outInfluence: 15, outSpeed: 0 },
    { id: "builtin-strong", name: "Strong Ease", isBuiltIn: true, inType: 2, outType: 2, inInfluence: 75, inSpeed: 0, outInfluence: 75, outSpeed: 0 },
];

// Functions whose caller reads structured fields off the result. Values here
// are chosen to render a believable, non-broken demo.
const SHAPED: Record<string, (args: unknown[]) => unknown> = {
    delivery: () => ok({ compIds: [9001, 9002] }),
    deliveryChecklistLoadComps: () => ok({ comps: DEMO_COMPS }),
    deliveryChecklistLoadCompsByIds: () => ok({ comps: DEMO_COMPS }),

    nameGeneratorDetect: () =>
        ok({
            filmTitle: "Odyssey",
            artworkType: "HORSE",
            campaign: "LaunchQ3",
            territory: "France",
            isInternational: true,
            newName: "Odyssey_INTL_DGTL_HORSE_LaunchQ3_1920x1080_15sec_France",
        }),

    preflightAudit: () =>
        ok({
            report: {
                compCount: 12,
                footageCount: 34,
                missingFootage: [],
                missingEffects: [],
                missingFonts: [],
                fontsChecked: true,
                fontsUsed: 8,
            },
        }),

    // XYTools — Ease tab
    motionToolsListEasePresets: () => DEMO_EASE_PRESETS,
    motionToolsSaveEasePreset: () => DEMO_EASE_PRESETS,
    motionToolsDeleteEasePreset: () => DEMO_EASE_PRESETS,
    motionToolsApplyEasePreset: () => ok(),
    motionToolsCopyEase: () =>
        ok({
            keys: [{ inEase: [{ speed: 0, influence: 33 }], outEase: [{ speed: 0, influence: 33 }] }],
            usedPropertyKey: "position",
            message: "Copied ease from 1 keyframe on \"Shape Layer 1\"  (demo)",
        }),
    motionToolsPasteEase: () => ok({ message: "Pasted ease onto the selected keyframe(s).  (demo)" }),

    // Quick FX
    quickFxGetSelectedLayerEffects: () =>
        ok({ effects: [{ matchName: "ADBE Gaussian Blur 2", name: "Gaussian Blur" }, { matchName: "ADBE Curves", name: "Curves" }] }),
    quickFxListCombos: () => [],
    quickFxListUserEffects: () => [],
    quickFxListRecentEffects: () => [],
    quickFxListInstalledEffects: () => [],
    quickFxVerifyMatchNames: () => ok({ missing: [] }),

    // Render queue / watch
    renderQueueList: () => [],
    renderWatchSnapshot: () => [],

    // Team — behave as an unconfigured (no team folder) machine, so the setup
    // UI shows rather than half-populated NAS state.
    teamGetFolder: () => null,
    teamListProfiles: () => [],
    teamGetMachineState: () => ({ owner: null, liveSync: false, guestBackup: null }),
    teamCheckVersion: () => ({ updateAvailable: false }),
    teamSyncShared: () => ok(),

    // Timesheet (lists have their own React mock; these are the extra getters)
    timesheetStartInfo: () => ok({ jobCode: "XY0000", job: "XY0000 — Demo Job", territory: "France", compName: "MainComp", fileName: "demo_project_V01.aep" }),
    timesheetProjectFileName: () => ok({ fileName: "demo_project_V01.aep" }),
    timesheetActiveFile: () => ok({ fileName: "demo_project_V01.aep" }),
    timesheetCopyToClipboard: () => ok(),

    // QC / report actions — show a friendly demo report string
    checkEffectsUsed: () => ok({ report: "Demo report — connect After Effects for a real scan." }),
    checkCompFootageDetails: () => ok({ report: "Demo report — connect After Effects for a real scan." }),
    checkFileNameCheck: () => ok({ report: "Demo — filename looks valid." }),
    checkMarkerGuide: () => ok(),
    compInspectorInspect: () => ok({ report: "Demo report — connect After Effects for a real inspection." }),
    parentInformer: () => ok({ report: "Demo — no parented layers to report." }),
};

// Folder / file pickers — resolve null = "user cancelled", a safe no-op.
const PICKERS = new Set<string>([
    "selectMastersFolder",
    "selectUsefulFolder",
    "selectCsvLocaliserAepFolder",
    "selectCreativeThumbnail",
    "teamSelectFolder",
]);

// Explicit action verbs that don't match the prefix rules below. All resolve
// a simulated success so their toast/status reads as done.
const ACTIONS = new Set<string>([
    "autoAspectRatio", "c4dLineArt", "campaignLocaliserGenerate", "campaignLocaliserTrott",
    "campaignLocaliserTrott2", "campaignRename", "checkAspectRatioRename", "checkRenderCheck",
    "cheekyDTCheck", "cheekyTCheck", "copyAep", "createComparisonComp", "csvLocaliserRun",
    "detailPreservingScale", "drqr", "editGeneratorArrange", "editMarkers", "editToolsFuseShots",
    "editToolsSnuggleLayers", "extAdjustCsvApplyToProjects", "extBuildCompFromCsv", "focalOrganiser",
    "frontcard", "generateCueSheet", "jpegLoc", "locIt", "losApplyCsvToProjects", "makeTextless",
    "maskSeparator", "masterNullAll", "masterNullSelected", "mcIt", "midcarder", "optimalPlacement",
    "organiseFolders", "pdfToCsvGenerate", "replicator", "resizeCompositionCentered", "rotate90cc",
    "deliveryRotate90CC", "safeGenerate", "safeGenerateFull", "saveFromComp", "scaleFit",
    "setCompDuration", "shapeToMasks", "swapper", "toggleLayersByLabel", "transformApply",
    "trueCompDuplicator", "turkIt", "velocityScaler", "wallGenerate", "wallGenerateAspect",
    "wallQueueUpdate", "renderMe", "applyEffectToSelectedLayers", "nameGeneratorGenerate",
    "adjustWidth", "adjustHeight", "adjustDuration", "adjustFrameRate", "adjustAspectRatio",
    "findReplace", "detectEdit", "guideScale", "runScript",
    "renderQueueClear", "renderQueueRemoveByCompId", "renderQueueRemoveItem", "renderQueueSetSkip",
    "preflightReplaceMissing", "preflightRevealMissing", "revealUsefulFolder", "revealFile",
    "importFile", "importLocLibComponentsBatch", "openCompInViewer", "expressionsBankApply",
]);

// Name-prefix rules for whole families of mutating/persistence calls. NOTE:
// deliberately NO load/scan/get/list/detect/find/suggest/preview prefixes —
// those are data reads that must fall through to their own mock fallback.
function matchesActionPrefix(fn: string): boolean {
    return (
        /^save/.test(fn) ||          // saveTheme, saveToolOrder, saveFromComp, expressionsBankSave-style
        /^set/.test(fn) ||           // setCompDuration, setCreativeThumbnailOverride, teamSet*
        /^add/.test(fn) ||           // addUsefulFolder
        /^remove/.test(fn) ||        // removeUsefulFolder, removeCampaign, quickFxRemove*
        /^rename/.test(fn) ||        // renameMainComp, renameUsefulFolder, quickFxRenameCombo
        /^scaleComposition/.test(fn) ||
        /^motionTools/.test(fn) ||   // all XYTools transform/anchor/align/… (List* is shaped above)
        /^quickFx(Apply|Save|Delete|Rename|Add|Remove|Import|Export)/.test(fn) ||
        /^team(Set|Share|Apply|Delete|Restore|AutoSync|SaveProfile)/.test(fn) ||
        /^expressionsBankSave/.test(fn)
    );
}

export interface DemoOutcome {
    handled: boolean;
    value?: unknown;
}

export function getDemoResult(fn: string, args: unknown[]): DemoOutcome {
    if (SHAPED[fn]) return { handled: true, value: SHAPED[fn](args) };
    if (PICKERS.has(fn)) return { handled: true, value: null };
    if (ACTIONS.has(fn) || matchesActionPrefix(fn)) return { handled: true, value: ok() };
    return { handled: false };
}

// --- The "Demo mode" banner --------------------------------------------------
// Injected once into the DOM so a hosted build clearly announces it's not wired
// to AE. Guarded so it never appears inside a real panel.
let bannerInjected = false;
export function injectDemoBanner(): void {
    if (bannerInjected || !isDemoMode() || typeof document === "undefined") return;
    bannerInjected = true;
    const el = document.createElement("div");
    el.setAttribute("data-xyi-demo-banner", "");
    el.textContent = "DEMO MODE · not connected to After Effects — actions are simulated";
    Object.assign(el.style, {
        position: "fixed",
        bottom: "10px",
        left: "10px",
        zIndex: "99999",
        padding: "6px 12px",
        borderRadius: "999px",
        font: "600 11px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        letterSpacing: "0.02em",
        color: "#0b0b0f",
        background: "linear-gradient(90deg, #fbbf24, #f59e0b)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        pointerEvents: "none",
        userSelect: "none",
        maxWidth: "min(90vw, 520px)",
    } as CSSStyleDeclaration);
    const add = () => document.body && document.body.appendChild(el);
    if (document.body) add();
    else document.addEventListener("DOMContentLoaded", add);
}
