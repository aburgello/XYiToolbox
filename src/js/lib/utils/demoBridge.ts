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

/**
 * Battle rooms in demo mode: `room -> { p1, p2 }`, each the raw JSON string a
 * player file would hold on the NAS. Module-scope so it survives re-renders
 * (not a real backing store -- a reload starts a fresh arcade, which is the
 * right behaviour for a demo).
 */
const demoBattleRooms: Record<string, { p1?: string; p2?: string }> = {};
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

// The arcade rack's one cross-game store. Shared by teamArcadeScores AND the
// Nerdle lobby's results, exactly as the host shares it — a versus row IS a
// head-to-head result. Several xyinerdle rows so the in-game leaderboard has
// enough to show records, streaks and a rivalry rather than one lonely line.
const DEMO_ARCADE_SCORES = [
    { game: "timeline", name: "turk", score: 31, versus: "", stamp: "2026-07-26 10:02" },
    { game: "timeline", name: "antonio", score: 24, versus: "", stamp: "2026-07-26 09:40" },
    { game: "daily", name: "jacqui", score: 7, versus: "", stamp: "2026-07-27 08:15" },
    { game: "poster", name: "antonio", score: 5, versus: "", stamp: "2026-07-27 08:20" },
    { game: "xyinerdle", name: "antonio", score: 17, versus: "aaron", stamp: "2026-07-27 09:05" },
    { game: "xyinerdle", name: "antonio", score: 9, versus: "aaron", stamp: "2026-07-26 17:22" },
    { game: "xyinerdle", name: "aaron", score: 14, versus: "antonio", stamp: "2026-07-26 11:48" },
    { game: "xyinerdle", name: "jacqui", score: 21, versus: "turk", stamp: "2026-07-26 09:31" },
    { game: "xyinerdle", name: "maria", score: 12, versus: "luke", stamp: "2026-07-25 16:11" },
];

// Functions whose caller reads structured fields off the result. Values here
// are chosen to render a believable, non-broken demo.
// --- Bespoke screen library --------------------------------------------------
//
// MUTABLE AT MODULE SCOPE, like demoBattleRooms above: seeding, saving and
// removing have to actually change what the grid shows or the demo can't
// demonstrate the one thing the library is about -- templates being replaced
// by layouts over time. A reload starts fresh, which is right for a demo.
//
// The geometry is real enough to be worth looking at: three portrait panels on
// a metrobus, a four-slot ceiling at 4.4:1, and an asymmetric atrium. Those
// are the shapes the wireframes exist to tell apart, so a demo with three
// identical 16:9 boxes would prove nothing.
interface DemoScreen {
    id: string;
    name: string;
    territory: string;
    site: string;
    canvasW: number;
    canvasH: number;
    guidesX: number[];
    guidesY: number[];
    slots: {
        x: number; y: number; w: number; h: number; rotation: number;
        masterW: number; masterH: number; masterDuration: string;
    }[];
    savedBy: string;
    stamp: string;
    kind: "layout" | "template";
    templatePath?: string;
    screen: string;
    status: "active" | "archive";
}

const demoLayout = (
    territory: string, screen: string, canvasW: number, canvasH: number,
    guidesX: number[], slots: [number, number, number, number][], savedBy: string, stamp: string
): DemoScreen => ({
    id: `${territory}::${screen}`.toUpperCase(),
    name: screen,
    territory,
    site: screen,
    canvasW,
    canvasH,
    guidesX,
    guidesY: [],
    slots: slots.map((s) => ({
        x: s[0], y: s[1], w: s[2], h: s[3], rotation: 0,
        masterW: s[2], masterH: s[3], masterDuration: "10",
    })),
    savedBy,
    stamp,
    kind: "layout",
    screen,
    status: "active",
});

const demoTemplate = (
    territory: string, screen: string, canvasW: number, canvasH: number, file: string
): DemoScreen => ({
    id: `${territory}::${screen}`.toUpperCase(),
    name: screen,
    territory,
    site: screen,
    canvasW,
    canvasH,
    guidesX: [],
    guidesY: [],
    slots: [],
    savedBy: "",
    stamp: "2026-08-17",
    kind: "template",
    templatePath: `/Volumes/newmedia/_Motion/DOOH/DOOH_Specs/${territory}/${screen}/${file}`,
    screen,
    status: "active",
});

let demoScreens: DemoScreen[] = [
    // Traced — three portrait panels across a metrobus.
    demoLayout("France", "GRAND_REX", 3240, 1920, [1080, 2160],
        [[0, 0, 1080, 1920], [1080, 0, 1080, 1920], [2160, 0, 1080, 1920]], "Antonio", "2026-08-14"),
    // Traced — a 4.4:1 ceiling, four slots with gaps between them.
    demoLayout("France", "BEAUGRENELLE", 13536, 3072, [3456, 6912, 10368],
        [[0, 0, 3168, 3072], [3456, 0, 3168, 3072], [6912, 0, 3168, 3072], [10368, 0, 3168, 3072]], "Fran", "2026-08-11"),
    // Traced — an asymmetric atrium: banner over two stacked panels.
    demoLayout("Domestic", "WESTFIELD_ATRIUM", 3840, 2816, [1920],
        [[0, 0, 3840, 1600], [0, 1600, 1900, 1216], [1940, 1600, 1900, 1216]], "Antonio", "2026-08-09"),
    // Untraced — still pointing at the old templates folder.
    demoTemplate("France", "DIGITAL_DREAM_2024", 2160, 3840, "DIGITAL_DREAM_2160x3840px_10s.aep"),
    demoTemplate("Germany", "SONY_CENTER", 5760, 1080, "SONY_CENTER_5760x1080_10sec.aep"),
    demoTemplate("Germany", "ZEIL_FRANKFURT", 1920, 1080, "ZEIL_1920x1080px_15s.aep"),
    demoTemplate("Italy", "DUOMO_WRAP", 7680, 2160, "DUOMO_WRAP_7680x2160px_10s.aep"),
    demoTemplate("MENA", "DUBAI_MALL_LED", 8192, 2304, "DUBAI_MALL_8192x2304px_15s.aep"),
    // Deliberately unparseable filename -- draws a neutral box rather than
    // vanishing, which is the section 5 rule applied to the card.
    demoTemplate("Football Super Boards", "PERIMETER_BOARD", 0, 0, "PERIMETER_master_FINAL_v3.aep"),
];

/** What a scan of the templates folder would turn up. */
const DEMO_SCAN: { territory: string; screen: string; file: string; w: number; h: number }[] = [
    { territory: "France", screen: "GRAND_REX", file: "GRAND_REX_3240x1920px_10s.aep", w: 3240, h: 1920 },
    { territory: "France", screen: "DIGITAL_DREAM_2024", file: "DIGITAL_DREAM_2160x3840px_10s.aep", w: 2160, h: 3840 },
    { territory: "Germany", screen: "SONY_CENTER", file: "SONY_CENTER_5760x1080_10sec.aep", w: 5760, h: 1080 },
    { territory: "Italy", screen: "GALLERIA_LED", file: "GALLERIA_3840x1080px_10s.aep", w: 3840, h: 1080 },
    { territory: "Japan", screen: "SHIBUYA_CROSS", file: "SHIBUYA_5120x1440px_15s.aep", w: 5120, h: 1440 },
    { territory: "Japan", screen: "SHINJUKU_3D", file: "SHINJUKU_3840x2160px_15s.aep", w: 3840, h: 2160 },
    { territory: "Poland", screen: "ZLOTE_TARASY", file: "ZLOTE_2880x1620px_10s.aep", w: 2880, h: 1620 },
    { territory: "Australia", screen: "QV_MELBOURNE", file: "QV_4096x2304px_10s.aep", w: 4096, h: 2304 },
];

// --- Creative workflows -------------------------------------------------
// A real-shaped board so the demo shows the tool doing its job rather than its
// empty state, and so the layout can be driven in a browser at all -- nothing
// under src/jsx runs in preview, so this IS the only place the checklist can
// be looked at outside AE.
interface DemoWorkflow {
    id: string; campaign: string; creative: string; key: string;
    steps: { id: string; text: string }[];
    notes: { id: string; text: string; author: string; stamp: string }[];
    author: string; updatedAt: string;
}
const demoWfKey = (c: string, cr: string) =>
    c.toUpperCase().replace(/[^A-Z0-9]/g, "") + "|" + cr.toUpperCase().replace(/[^A-Z0-9]/g, "");
let demoWorkflows: DemoWorkflow[] = [
    {
        id: "wf-demo-1",
        campaign: "Forgotten Island",
        creative: "TRIO",
        key: demoWfKey("Forgotten Island", "TRIO"),
        steps: [
            { id: "s1", text: "Title treatment from Components — never rebuilt" },
            { id: "s2", text: "Pedigree from Components" },
            { id: "s3", text: "Tagline from Components" },
            { id: "s4", text: "Date from Components, check the territory format" },
            { id: "s5", text: "Billing block swapped for the local one" },
        ],
        notes: [
            { id: "n1", text: "BR tagline runs long — the Components version is already tracked tighter, don't re-scale it.", author: "Ana", stamp: "Fri Aug 22 2026 11:02:00 GMT+0100" },
            { id: "n2", text: "Date component was rebuilt for Batch 2. Use the one in Support/Motion_Components, not the Batch 1 copy.", author: "Antonio", stamp: "Mon Aug 24 2026 09:41:00 GMT+0100" },
        ],
        author: "Ana",
        updatedAt: "Mon Aug 24 2026 09:41:00 GMT+0100",
    },
    {
        id: "wf-demo-2",
        campaign: "Forgotten Island",
        creative: "PORTALTOPARADISE",
        key: demoWfKey("Forgotten Island", "PORTALTOPARADISE"),
        steps: [
            { id: "p1", text: "Artwork slot _OV → territory export" },
            { id: "p2", text: "Check the drum wrap still lines up after the swap" },
        ],
        notes: [],
        author: "Antonio",
        updatedAt: "Thu Aug 21 2026 16:20:00 GMT+0100",
    },
];
let demoTicks = '{"FORGOTTENISLAND|TRIO":{"s1":true,"s2":true}}';

const SHAPED: Record<string, (args: unknown[]) => unknown> = {
    workflowBoardLoad: () => ({ success: true, read: true, entries: demoWorkflows, me: "Antonio" }),

    workflowContext: () => ({
        success: true,
        project: "FID_INTL_Trio_DOOH_Ingresso_1920x1080px_10s_BR_V01.aep",
        creative: "TRIO",
        campaign: "Forgotten Island",
        campaigns: [
            { name: "Forgotten Island", mastersRoot: "/Volumes/universal/Universal_Pictures/Forgotten_Island/Digital/INT/XY026039_Masters" },
            { name: "Portal To Paradise", mastersRoot: "/Volumes/universal/Universal_Pictures/Portal/Digital/INT/XY025911_Masters" },
        ],
    }),

    workflowSaveEntry: (args) => {
        try {
            const entry = JSON.parse(String(args[0])) as DemoWorkflow;
            entry.key = demoWfKey(entry.campaign, entry.creative);
            entry.updatedAt = new Date().toString();
            if (!entry.id) entry.id = "wf-demo-" + Date.now();
            if (!entry.author) entry.author = "Antonio";
            const prior = demoWorkflows.filter((w) => w.key === entry.key)[0];
            if (prior) entry.notes = prior.notes;
            demoWorkflows = demoWorkflows.filter((w) => w.key !== entry.key).concat([entry]);
            return { success: true, read: true, entries: demoWorkflows, me: "Antonio" };
        } catch {
            return { success: false, error: "Demo mode couldn't parse that workflow." };
        }
    },

    workflowDeleteEntry: (args) => {
        demoWorkflows = demoWorkflows.filter((w) => w.id !== String(args[0]));
        return { success: true, read: true, entries: demoWorkflows, me: "Antonio" };
    },

    workflowAddNote: (args) => {
        const id = String(args[0]);
        demoWorkflows = demoWorkflows.map((w) => (w.id === id
            ? { ...w, notes: w.notes.concat([{ id: "n-" + Date.now(), text: String(args[1]), author: "Antonio", stamp: new Date().toString() }]) }
            : w));
        return { success: true, read: true, entries: demoWorkflows, me: "Antonio" };
    },

    workflowDeleteNote: (args) => {
        const id = String(args[0]);
        demoWorkflows = demoWorkflows.map((w) => (w.id === id
            ? { ...w, notes: w.notes.filter((n) => n.id !== String(args[1])) }
            : w));
        return { success: true, read: true, entries: demoWorkflows, me: "Antonio" };
    },

    workflowTicksLoad: () => ({ success: true, message: demoTicks }),
    workflowTicksSave: (args) => { demoTicks = String(args[0]); return ok(); },

    // DELIBERATELY NO scanCreatives MOCK. This table is consulted before a
    // caller's own fallback (see bolt.ts), so shaping it here would hand OV
    // Library these names instead of its own MOCK_CREATIVES. Unhandled is the
    // right answer: the workflow picker treats an unreadable tree as "couldn't
    // look", which is a path worth seeing in the demo anyway.

    // --- Bespoke screen library ---------------------------------------------
    // `read: true` on purpose: an unreadable share hides the Library button
    // entirely, and a demo that hid the feature it is demonstrating would be
    // worse than useless.
    bespokeTemplateList: () => ({ success: true, read: true, templates: demoScreens }),

    bespokeTemplateSave: (args) => {
        try {
            const entry = JSON.parse(String(args[0])) as DemoScreen;
            demoScreens = demoScreens.filter((s) => s.id !== entry.id).concat([entry]);
            return ok({ count: demoScreens.length });
        } catch {
            return { success: false, error: "Demo mode couldn't parse that layout." };
        }
    },

    bespokeTemplateDelete: (args) => {
        demoScreens = demoScreens.filter((s) => s.id !== String(args[0]));
        return ok();
    },

    bespokeSelectTemplatesRoot: () => "/Volumes/newmedia/_Motion/DOOH/DOOH_Specs",

    bespokeLibraryScan: () => ({
        success: true,
        scanned: DEMO_SCAN.length + 4, // a few venues hold more than one .aep
        candidates: DEMO_SCAN.map((c) => {
            const id = `${c.territory}::${c.screen}`.toUpperCase();
            const hit = demoScreens.filter((s) => s.id === id)[0];
            return {
                id,
                territory: c.territory,
                screen: c.screen,
                name: c.screen,
                templatePath: `/Volumes/newmedia/_Motion/DOOH/DOOH_Specs/${c.territory}/${c.screen}/${c.file}`,
                canvasW: c.w,
                canvasH: c.h,
                known: !!hit,
                superseded: !!hit && hit.kind === "layout",
            };
        }),
    }),

    bespokeLibrarySeed: (args) => {
        try {
            const incoming = JSON.parse(String(args[0])) as {
                id: string; territory: string; screen: string; name: string;
                templatePath: string; canvasW: number; canvasH: number;
            }[];
            let added = 0;
            let skipped = 0;
            for (const c of incoming) {
                const at = demoScreens.filter((s) => s.id === c.id)[0];
                if (at) {
                    // A layout is never overwritten by a template — same rule
                    // the real backend enforces, worth showing here.
                    if (at.kind === "template") at.templatePath = c.templatePath;
                    skipped++;
                    continue;
                }
                demoScreens = demoScreens.concat([
                    demoTemplate(c.territory, c.screen, c.canvasW, c.canvasH, c.templatePath.split("/").pop() || "template.aep"),
                ]);
                added++;
            }
            return ok({ added, skipped });
        } catch {
            return { success: false, error: "Demo mode couldn't parse that scan." };
        }
    },

    bespokeLibraryImport: (args) => ok({ name: String(args[0] || "").split("/").pop() || "template.aep" }),
    bespokeLibraryReveal: () => ok(),

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
    teamListProfiles: () => ({
        success: true,
        profiles: [
            { name: "marco", hasProfile: true },
            { name: "sarah", hasProfile: true },
            { name: "david", hasProfile: true },
            { name: "lisa", hasProfile: true },
        ],
        folderSet: false,
        mounted: false,
    }),
    teamGetMachineState: () => ({ owner: null, liveSync: false, guestBackup: null }),
    teamCheckVersion: () => ({ updateAvailable: false }),
    teamSyncShared: () => ok(),

    // Team — machine owner tag (used by battle boot and menu).
    loadLocalSetting: (args: unknown[]) => {
        const key = args[0] as string;
        if (key === "machineOwner") return "antonio";
        return null;
    },

    // Nerdle menu — lobby state. `results` mirrors the host: they're DERIVED
    // from the versus rows of the one arcade score store below, not a separate
    // file (see team.ts's nerdleResultsFromScores).
    teamNerdleLobby: () => ({
        success: true,
        me: "antonio",
        incoming: [
            { room: "ABCD", from: "marco", to: "antonio", stamp: "2026-07-25T10:30:00Z" },
        ],
        outgoing: [],
        results: DEMO_ARCADE_SCORES
            .filter((s) => s.game === "xyinerdle" && s.versus)
            .map((s) => ({ room: "", winner: s.name, loser: s.versus, films: s.score, stamp: s.stamp })),
    }),
    // Mirrors the host's contract: it answers with the room you actually got,
    // which is not necessarily the one you suggested (it joins an existing
    // challenge from that person rather than opening a second room).
    teamNerdleInvite: (args: unknown[]) => ({
        success: true,
        room: args[1] as string,
        seat: 1,
        message: `Invited ${args[0]} to room ${args[1]}.`,
    }),
    teamLoadWordBoard: () => ({ success: true, board: [] }),
    teamPostWordResult: () => ({ success: true, message: "Result saved." }),

    // The arcade rack's cross-game board. A fixture so the hub shows what a
    // populated rack looks like; posts are accepted and dropped (a demo
    // shouldn't imply it wrote to the studio NAS).
    teamArcadePost: () => ok(),
    // Naming Audit -- a deliberately MIXED fixture: real-shaped names from both
    // conventions plus the three failure modes the audit exists to surface, so
    // the report layout can be judged in preview without a NAS or AE.
    // Resolve rows to masters. Deliberately MIXED so the preview shows all
    // three indicator states: most rows match, one deliberately doesn't.
    csvLocaliserResolveMasters: (args: unknown[]) => {
        let rows: { campaign?: string; size?: string; duration?: string }[] = [];
        try {
            rows = JSON.parse(String(args[1] || "[]"));
        } catch (e) {
            rows = [];
        }
        return {
            success: true,
            indexed: 29,
            rows: rows.map((r, i) => {
                // Every 4th row finds nothing, so the "no master" state is visible.
                if (i % 4 === 3) return { master: null, path: null };
                const camp = (r.campaign || "CAMPAIGN").replace(/[^A-Za-z0-9]/g, "");
                const size = (r.size || "1920x1080").replace("px", "");
                const dur = String(r.duration || "10").replace(/[^0-9]/g, "");
                const name = `ODY_INTL_DGTL_DOOH_${camp.toUpperCase()}_${size}_${dur}sec_OV.aep`;
                return { master: name, path: `/Volumes/newmedia/XY1234_Masters/AE/${camp}/${name}` };
            }),
        };
    },

    nameAuditScan: (args: unknown[]) => {
        const mode = String(args[0] || "batch");
        return {
        success: true,
        root: mode === "masters" ? "/Volumes/newmedia/XY1234_ODYSSEY/Masters/AE" : "/Volumes/newmedia/XY1234_ODYSSEY/FR/AE/Batch_02",
        mode,
        scanned: 14,
        newCount: mode === "masters" ? 1 : 9,
        legacyCount: mode === "masters" ? 12 : 4,
        unknownCount: 1,
        issueCount: mode === "masters" ? 2 : 6,
        truncated: false,
        rows:
            mode === "masters"
                ? [
                      {
                          name: "ODY_HORSE_LOS_1920x858_10sec_OV.aep",
                          folder: "HORSE",
                          convention: "unknown",
                          issues: ["No INTL/DOM token -- the parser can't find where the film title ends"],
                      },
                      {
                          name: "ODY_INTL_DGTL_DOOH_HORSE_1920x858_OV.aep",
                          folder: "HORSE",
                          convention: "legacy",
                          issues: ["No duration token"],
                      },
                  ]
                : [
                      {
                          name: "ODY_INTL_DGTL_DOOH_JUNGLETUNNEL_1080x1920_15sec_FR_V01.aep",
                          folder: "",
                          convention: "legacy",
                          issues: ["Still on the OLD (DGTL) convention -- deliverables should use the new form"],
                      },
                      {
                          name: "ODY_INTL_JUNGLETUNNEL_DOOH_1080x1920px_15s.aep",
                          folder: "",
                          convention: "new",
                          issues: ["No territory code"],
                      },
                      {
                          name: "ODY_INTL_JUNGLETUNNEL_DOOH_Piccadilly_1080x1920px_15s_FR.aep",
                          folder: "",
                          convention: "new",
                          issues: ["Another file in this folder canonicalises to the same name"],
                      },
                  ],
        };
    },

    teamArcadeScores: () => ({
        success: true,
        me: "antonio",
        scores: DEMO_ARCADE_SCORES,
    }),

    // Poster puzzle. The board gets a small fixture rather than an empty array
    // so the demo actually shows what the leaderboard looks like -- guesses AND
    // hints, which is the whole point of this game's scoring. Progress is not
    // stored (a reload starts today's puzzle fresh), same as the battle rooms
    // above: right behaviour for a demo.
    posterGameLoadState: () => "",
    posterGameSaveState: () => ok(),
    teamPostPosterResult: () => ({ success: true, message: "Result saved." }),
    teamLoadPosterBoard: () => ({
        success: true,
        entries: [
            { day: "demo", member: "jacqui", guesses: 2, hints: 0, solved: true, streak: 5 },
            { day: "demo", member: "antonio", guesses: 4, hints: 1, solved: true, streak: 3 },
            { day: "demo", member: "turk", guesses: 0, hints: 3, solved: false, streak: 0 },
        ],
    }),

    // Battle sync -- a REAL in-memory store, keyed by room, holding the same
    // JSON strings the host would.
    //
    // It used to return hand-built objects in the pre-action-log schema
    // (`moves`/`turnOwner`/`tools`) and throw writes away, which made demo mode
    // actively misleading: every sync overwrote whatever you'd just done with a
    // stale fixture, so Ready/skip/ban all looked broken here while being fine
    // in AE. Storing what's written means the whole two-seat flow -- including
    // the ready handshake -- can be exercised in the browser.
    teamBattleRead: (args: unknown[]) => {
        const room = String(args[0] || "");
        const store = demoBattleRooms[room] || {};
        return { success: true, me: "antonio", p1: store.p1 || "", p2: store.p2 || "" };
    },
    teamBattleWrite: (args: unknown[]) => {
        const room = String(args[0] || "");
        const player = Number(args[1]);
        const json = String(args[2] || "");
        const store = demoBattleRooms[room] || (demoBattleRooms[room] = {});
        if (player === 1) store.p1 = json; else store.p2 = json;
        return { success: true, message: "Battle state saved." };
    },
    /** Drops a demo room so a fresh game doesn't inherit the last one. */
    teamBattleCleanup: (args: unknown[]) => {
        delete demoBattleRooms[String(args[0] || "")];
        return { success: true };
    },
    teamBattlePostResult: (args: unknown[]) => ({
        success: true,
        message: `${args[1]} beat ${args[2]} (${args[3]} films).`,
    }),

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
    "autoAspectRatio", "c4dLineArt", "campaignLocaliserGenerate",
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
