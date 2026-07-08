// =============================================================================
// src/js/main/tools/LocalisedLibrary.tsx
// -----------------------------------------------------------------------------
// Localised Library, ported from XYi_Localised_Library.jsx -- a campaign ->
// territory -> component library, manually curated (or auto-populated from a
// "Support_Motion"/"Motion_Components" folder). Wasn't part of the vertical
// listbox in the original toolbox -- it was launched next to the search bar,
// same as OV Library used to be. Every actual file operation happens in
// aeft.ts via evalTS() -- this file only holds UI state.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
    Download,
    Search,
    FolderPlus,
    Trash2,
    Plus,
    Wand2,
    X,
    CheckSquare,
    Square,
    FolderInput,
    ChevronRight,
    ArrowLeft,
    Library,
    MapPin,
    Folder,
    FolderSymlink,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import Tooltip from "../Tooltip";
import StatusIcon from "../StatusIcon";
import Dropdown from "../Dropdown";
import { alertDialog, confirmDialog, promptDialog, selectDialog } from "../Dialog";
import "../shared.scss";
import "./LocalisedLibrary.scss";

interface Campaign {
    name: string;
    marketsRoot: string;
}

interface Component {
    campaign: string;
    territory: string;
    label: string;
    path: string;
    // Explicit folder assignment ("mini directories" split by file type,
    // e.g. PNG/AEP/AI) -- undefined means folderForComponent() below
    // auto-buckets it by extension instead. This is a library-only
    // grouping, not a mirror of how the files actually sit on disk.
    folder?: string;
}

interface CustomFolder {
    campaign: string;
    territory: string;
    name: string;
}

interface Toast {
    id: number;
    text: string;
    type: "success" | "error";
}

// Extension -> display folder name. Anything not listed falls back to the
// extension itself uppercased (e.g. ".xml" -> "XML"); no extension at all
// (a rare extensionless file) falls back to "Other".
const EXTENSION_FOLDER_MAP: Record<string, string> = {
    aep: "AEP", aet: "AEP",
    ai: "AI", eps: "AI",
    png: "PNG",
    jpg: "JPG", jpeg: "JPG",
    psd: "PSD",
    mov: "MOV", mp4: "MOV",
    pdf: "PDF",
};

// A component's own explicit `folder` always wins; otherwise derived from
// its file extension. Never persisted for the auto-bucketed case -- this
// stays purely a display-time computation so it can't drift out of sync
// with a component's real path.
function folderForComponent(c: Component): string {
    if (c.folder) return c.folder;
    const m = c.path.match(/\.([A-Za-z0-9]+)$/);
    const ext = m ? m[1].toLowerCase() : "";
    if (!ext) return "Other";
    return EXTENSION_FOLDER_MAP[ext] || ext.toUpperCase();
}

// Browser-preview mock data (no CEP bridge outside AE) -- same intent as OV
// Library's MOCK_* constants: lets the layout be previewed at
// http://localhost:3000/main/ without a real Markets folder. Only ever used
// when the very first bridge call returns no bridge (see refreshCampaigns).
const MOCK_CAMPAIGNS: Campaign[] = [
    { name: "ODY_INTL_DGTL_DOOH_HORSE", marketsRoot: "/mock/HORSE/Markets" },
    { name: "GLADIATOR_II_DOOH", marketsRoot: "/mock/GLAD/Markets" },
];
const MOCK_TERRITORIES: Record<string, string[]> = {
    ODY_INTL_DGTL_DOOH_HORSE: ["France", "Germany", "Spain", "Italy", "Japan", "Brazil", "APAC (ex. China)"],
    GLADIATOR_II_DOOH: ["France", "Mexico", "Australia"],
};
const MOCK_COMPONENTS: Component[] = [
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Logo_Endcard_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Logo_Endcard_FR.aep" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Legal_Line_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Legal_Line_FR.aep" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Logo_Mark_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Logo_Mark_FR.png" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Brand_Vector_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Brand_Vector_FR.ai" },
    // Filed under a custom folder ("Legal Approved") rather than
    // auto-bucketed by extension -- demonstrates a manually-moved entry.
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", label: "Legal_Signoff_FR", path: "/mock/HORSE/Markets/France/Support_Motion/Legal_Signoff_FR.pdf", folder: "Legal Approved" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "Germany", label: "Logo_Endcard_DE", path: "/mock/HORSE/Markets/Germany/Support_Motion/Logo_Endcard_DE.aep" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "Japan", label: "Logo_Endcard_JP", path: "/mock/HORSE/Markets/Japan/Support_Motion/Logo_Endcard_JP.aep" },
];
// A still-empty custom folder -- demonstrates that a just-created folder
// with zero components in it yet still shows in the folder list.
const MOCK_FOLDERS: CustomFolder[] = [
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", name: "Legal Approved" },
    { campaign: "ODY_INTL_DGTL_DOOH_HORSE", territory: "France", name: "WIP" },
];
const MOCK_CODES: Record<string, string> = { France: "FR", Germany: "DE", Spain: "ES", Italy: "IT", Japan: "JP", Brazil: "BR", Mexico: "MX", Australia: "AU" };
// Demonstrates the "You may be in…" suggestion in browser preview, same as
// every other MOCK_* constant here -- real detection needs a real saved
// project file, which preview mode never has.
const MOCK_DETECTED_TERRITORY: Record<string, string | null> = { ODY_INTL_DGTL_DOOH_HORSE: "France", GLADIATOR_II_DOOH: null };

// Shimmer placeholder matching a real territory row's layout (pip + name +
// count badge), shown while the territory scan is in flight -- same
// instinct as OV Library's SkeletonCard/SkeletonVariantBlock.
const SkeletonTerritoryRow: React.FC = () => (
    <div className="ll-terr-row skeleton">
        <span className="ll-pip shimmer-bar" />
        <span className="ll-terr-name shimmer-bar" style={{ width: "60%", height: "11px" }} />
        <span className="ll-count shimmer-bar" style={{ width: "16px" }} />
    </div>
);

const LocalisedLibraryTool = () => {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

    const [territories, setTerritories] = useState<string[]>([]);
    const [components, setComponents] = useState<Component[]>([]);
    const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
    const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);
    // Third nav level, within a territory: null shows the folder list
    // (auto extension buckets + any custom folders), set shows that
    // folder's own component list -- see the "mini directories" split in
    // this file's header comment.
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
    const [territorySearch, setTerritorySearch] = useState("");
    const [countryCodes, setCountryCodes] = useState<Record<string, string>>({});

    // "You may be in..." -- the territory (if any) whose folder the
    // currently open AE project's saved file path sits inside, detected
    // against this campaign's own scanned territory list. Purely a quick-
    // access suggestion pinned above the list -- null just means no match
    // (unsaved project, project outside this campaign's Markets tree, or
    // browser preview), never an error state.
    const [detectedTerritory, setDetectedTerritory] = useState<string | null>(null);

    const [loadingTerritories, setLoadingTerritories] = useState(false);
    const [busy, setBusy] = useState(false);
    // True only in browser preview (no CEP bridge) -- drives the mock data
    // path so the layout is viewable without AE. Never true inside real AE.
    const [mockMode, setMockMode] = useState(false);

    // Batch-import selection -- component paths (unique enough as a key
    // since a real library never has two components sharing a source
    // file), scoped to whichever territory is currently selected. Cleared
    // on every territory switch below so a stale selection from a
    // different territory can never get silently carried into a batch
    // action on this one.
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [batchBusy, setBatchBusy] = useState(false);

    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastId = useRef(0);

    const pushToast = (text: string, type: Toast["type"] = "success") => {
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, text, type }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    };

    const safeEvalTS = async (name: string, ...args: any[]): Promise<any> => {
        try {
            const result = await evalTS(name as any, ...args);
            if (result === undefined) throw new Error("no bridge");
            return result;
        } catch (e: any) {
            // Two different failure modes land here, and they used to show
            // the same generic message regardless -- that's exactly what
            // hid a real bug (getTerritoryCountryCode throwing a
            // SyntaxError on territory names with regex-special characters)
            // behind a misleading "no bridge" toast even while running for
            // real inside AE. `result === undefined` above is the genuine
            // no-bridge case (evalTS's own sentinel for "the bridge call
            // itself never reached an ExtendScript engine," e.g. browser
            // preview). Anything else here is a real thrown ExtendScript
            // exception with an actual `.message` -- show that instead so
            // this class of bug is visible again if it ever recurs.
            const message = e && e.message && e.message !== "no bridge" ? e.message : "No CEP bridge detected — open this panel inside After Effects to run it.";
            pushToast(message, "error");
            return null;
        }
    };

    // Same bridge call as safeEvalTS, but fails completely silently (no
    // toast) instead of surfacing an error -- for calls where the result
    // is purely decorative and the user never asked for it, so a failure
    // is never something worth interrupting them about. Currently only
    // used for the per-territory country-code badge lookup below: with a
    // real campaign's full territory list (tens of sequential bridge
    // round-trips, not the 2-3 used in earlier testing), an occasional
    // individual call not resolving is a realistic outcome on its own and
    // shouldn't read as "the whole panel lost its connection" -- it just
    // means that one territory's badge doesn't show a code, the same as
    // a territory whose name genuinely has no match in the lookup table.
    const quietEvalTS = async (name: string, ...args: any[]): Promise<any> => {
        try {
            const result = await evalTS(name as any, ...args);
            return result === undefined ? null : result;
        } catch (e) {
            return null;
        }
    };

    useEffect(() => {
        refreshCampaigns();
    }, []);

    const refreshCampaigns = async () => {
        // quietEvalTS (not safeEvalTS) for this first probe: a null result
        // here means "no bridge" (browser preview), which we handle with
        // mock data rather than an error toast the user can't act on.
        const camps = await quietEvalTS("loadLocLibCampaigns");
        if (camps === null) {
            setMockMode(true);
            setCampaigns(MOCK_CAMPAIGNS);
            if (!selectedCampaign) setSelectedCampaign(MOCK_CAMPAIGNS[0]);
            return;
        }
        setMockMode(false);
        setCampaigns(camps || []);
        if (camps && camps.length > 0 && !selectedCampaign) {
            setSelectedCampaign(camps[0]);
        }
    };

    useEffect(() => {
        if (!selectedCampaign) {
            setTerritories([]);
            setComponents([]);
            setCustomFolders([]);
            setSelectedTerritory(null);
            return;
        }
        refreshTerritories(selectedCampaign);
    }, [selectedCampaign]);

    useEffect(() => {
        setSelectedFolder(null);
    }, [selectedTerritory]);

    useEffect(() => {
        setSelectedPaths(new Set());
    }, [selectedTerritory, selectedFolder]);

    const refreshTerritories = async (camp: Campaign) => {
        setLoadingTerritories(true);
        setSelectedTerritory(null);
        setDetectedTerritory(null);
        if (mockMode) {
            setTerritories(MOCK_TERRITORIES[camp.name] || []);
            setComponents(MOCK_COMPONENTS);
            setCustomFolders(MOCK_FOLDERS);
            setCountryCodes(MOCK_CODES);
            setDetectedTerritory(MOCK_DETECTED_TERRITORY[camp.name] ?? null);
            setLoadingTerritories(false);
            return;
        }
        try {
            const terrs: string[] = (await safeEvalTS("scanTerritories", camp.marketsRoot)) || [];
            const [allComponents, allFolders] = await Promise.all([
                (safeEvalTS("loadLocLibComponents") as Promise<Component[]>).then((v) => v || []),
                (quietEvalTS("loadLocLibFolders") as Promise<CustomFolder[]>).then((v) => v || []),
            ]);
            setTerritories(terrs);
            setComponents(allComponents);
            setCustomFolders(allFolders);

            // Parallel, not a sequential for-loop -- these are independent
            // lookups, and a real campaign's full territory list (tens of
            // entries, not the 2-3 used in earlier testing) means a
            // sequential chain of round-trips adds up to real, visible
            // delay for something purely decorative. Parallelizing also
            // shrinks the total time window any individual call could
            // hiccup in. quietEvalTS (not safeEvalTS) on purpose -- see its
            // own comment above. detectCurrentTerritory joins the same
            // Promise.all for the same reason -- one more decorative,
            // best-effort lookup that shouldn't add its own sequential
            // round-trip on top of the country-code batch.
            const [codeEntries, detected] = await Promise.all([
                Promise.all(terrs.map(async (t) => [t, await quietEvalTS("getTerritoryCountryCode", t)] as const)),
                quietEvalTS("detectCurrentTerritory", terrs) as Promise<string | null>,
            ]);
            const codes: Record<string, string> = {};
            for (const [t, code] of codeEntries) {
                if (code) codes[t] = code;
            }
            setCountryCodes(codes);
            setDetectedTerritory(detected);
        } finally {
            setLoadingTerritories(false);
        }
    };

    const handleNewCampaign = async () => {
        const name = await promptDialog("Campaign name (e.g. HORSE, ODY_INTL_DGTL_DOOH...):", "");
        if (!name) return;
        if (campaigns.some((c) => c.name === name)) {
            await alertDialog(`A campaign named "${name}" already exists.`);
            return;
        }
        const marketsRoot = await safeEvalTS("selectMarketsFolder");
        if (!marketsRoot) return;

        const result = await safeEvalTS("saveLocLibCampaign", name, marketsRoot);
        if (!result || !result.success) {
            await alertDialog((result && result.error) || "Could not save campaign.");
            return;
        }
        const newCamp = { name, marketsRoot };
        await refreshCampaigns();
        setSelectedCampaign(newCamp);
    };

    const handleRemoveCampaign = async () => {
        if (!selectedCampaign) return;
        if (
            !(await confirmDialog(
                `Remove campaign "${selectedCampaign.name}" from the library?\n\nThis deletes its saved component entries too — the actual files on disk are untouched.`
            ))
        )
            return;
        await safeEvalTS("removeLocLibCampaign", selectedCampaign.name);
        setSelectedCampaign(null);
        await refreshCampaigns();
    };

    const handleAddComponent = async () => {
        if (!selectedCampaign || !selectedTerritory) return;
        const path = await safeEvalTS("selectComponentFile", selectedTerritory);
        if (!path) return;

        const defaultLabel = (path.split("/").pop() || path).replace(/\.[^.]+$/, "");
        const label = await promptDialog("Label this component:", defaultLabel);
        if (label === null) return;

        // Filed straight into whichever folder we're currently viewing --
        // Add Component only ever shows from inside a folder now, so
        // selectedFolder is always set here in practice.
        const result = await safeEvalTS(
            "addLocLibComponent",
            selectedCampaign.name,
            selectedTerritory,
            label || defaultLabel,
            path,
            selectedFolder || undefined
        );
        if (result && result.success) {
            const all: Component[] = (await safeEvalTS("loadLocLibComponents")) || [];
            setComponents(all);
        }
    };

    const handleRemoveComponent = async (component: Component) => {
        if (!(await confirmDialog(`Remove "${component.label}" from this territory's library?`))) return;
        await safeEvalTS("removeLocLibComponent", component.campaign, component.territory, component.label, component.path);
        const all: Component[] = (await safeEvalTS("loadLocLibComponents")) || [];
        setComponents(all);
    };

    const handleNewFolder = async () => {
        if (!selectedCampaign || !selectedTerritory) return;
        const name = await promptDialog("New folder name:", "");
        if (!name) return;
        const result = await safeEvalTS("createLocLibFolder", selectedCampaign.name, selectedTerritory, name);
        if (result && result.success) {
            const all: CustomFolder[] = (await safeEvalTS("loadLocLibFolders")) || [];
            setCustomFolders(all);
        } else if (result) {
            pushToast(result.error || "Could not create folder.", "error");
        }
    };

    const handleRemoveFolder = async (folderName: string) => {
        if (!selectedCampaign || !selectedTerritory) return;
        if (
            !(await confirmDialog(
                `Remove the "${folderName}" folder?\n\nComponents inside it aren't deleted -- they'll fall back to being grouped by file type.`
            ))
        )
            return;
        await safeEvalTS("removeLocLibFolder", selectedCampaign.name, selectedTerritory, folderName);
        const [all, allFolders] = await Promise.all([
            (safeEvalTS("loadLocLibComponents") as Promise<Component[]>).then((v) => v || []),
            (safeEvalTS("loadLocLibFolders") as Promise<CustomFolder[]>).then((v) => v || []),
        ]);
        setComponents(all);
        setCustomFolders(allFolders);
        // The folder we were just looking at no longer exists -- drop back
        // to the folder list rather than showing an empty, gone folder.
        if (selectedFolder === folderName) setSelectedFolder(null);
    };

    // Reassigns one component to a different folder, offering every folder
    // name currently in use in this territory (auto buckets + custom) plus
    // the option to create a brand new one on the spot.
    const handleMoveComponent = async (component: Component) => {
        if (!selectedCampaign || !selectedTerritory) return;
        const inThisTerritory = components.filter((c) => c.campaign === selectedCampaign.name && c.territory === selectedTerritory);
        const autoNames = inThisTerritory.map(folderForComponent);
        const customNames = customFolders
            .filter((f) => f.campaign === selectedCampaign.name && f.territory === selectedTerritory)
            .map((f) => f.name);
        const allNames = Array.from(new Set([...autoNames, ...customNames])).sort();
        const options = [...allNames, "New folder…"];
        const currentName = folderForComponent(component);
        const defaultIndex = Math.max(0, options.indexOf(currentName));

        const choice = await selectDialog(`Move "${component.label}" to:`, options, defaultIndex);
        if (choice === null) return;

        let targetFolder = options[choice];
        if (targetFolder === "New folder…") {
            const name = await promptDialog("New folder name:", "");
            if (!name) return;
            const createResult = await safeEvalTS("createLocLibFolder", selectedCampaign.name, selectedTerritory, name);
            if (!createResult || !createResult.success) {
                if (createResult) pushToast(createResult.error || "Could not create folder.", "error");
                return;
            }
            targetFolder = name;
        } else if (targetFolder === currentName) {
            return; // no-op, already there
        }

        await safeEvalTS("setLocLibComponentFolder", component.campaign, component.territory, component.label, component.path, targetFolder);
        const [all, allFolders] = await Promise.all([
            (safeEvalTS("loadLocLibComponents") as Promise<Component[]>).then((v) => v || []),
            (safeEvalTS("loadLocLibFolders") as Promise<CustomFolder[]>).then((v) => v || []),
        ]);
        setComponents(all);
        setCustomFolders(allFolders);
    };

    const handleAutoPopulate = async () => {
        if (!selectedCampaign) {
            await alertDialog("Select or create a campaign first.");
            return;
        }
        const scopeLabel = selectedTerritory ? `the "${selectedTerritory}" territory` : `every territory under "${selectedCampaign.name}"`;
        if (
            !(await confirmDialog(
                `Scan ${scopeLabel} for a "Support_Motion" or "Motion_Components" folder, and auto-add every file found inside as a component?\n\n` +
                    "Files already in the library are skipped, so this is safe to re-run later as new territories come online."
            ))
        )
            return;

        setBusy(true);
        try {
            const result = await safeEvalTS(
                "autoPopulateLocLib",
                selectedCampaign.name,
                selectedCampaign.marketsRoot,
                selectedTerritory || undefined
            );
            if (result && result.success) {
                const all: Component[] = (await safeEvalTS("loadLocLibComponents")) || [];
                setComponents(all);
                const noMatchCount = (result.territoriesWithNoMatch || []).length;
                pushToast(`Added ${result.added}, skipped ${result.skippedExisting} already in library, ${noMatchCount} territories with no match.`);
            } else if (result) {
                pushToast(result.error || "Auto-populate failed.", "error");
            }
        } finally {
            setBusy(false);
        }
    };

    const handleImport = async (path: string) => {
        const result = await safeEvalTS("importFile", path);
        if (result) {
            pushToast(
                result.success ? `Imported ${path.split("/").pop()?.split("\\").pop()}` : result.error || "Import failed",
                result.success ? "success" : "error"
            );
        }
    };
    const handleReveal = async (path: string) => {
        await safeEvalTS("revealFile", path);
    };

    const toggleSelected = (path: string) => {
        setSelectedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    const toggleSelectAll = () => {
        setSelectedPaths((prev) =>
            prev.size === componentsForFolder.length ? new Set() : new Set(componentsForFolder.map((c) => c.path))
        );
    };

    // Reports a summary toast rather than one per file -- a batch of 5+
    // success toasts stacking up is exactly the noisy pattern this app
    // already moved away from elsewhere (see the "stacked toasts" fix
    // noted in CLAUDE.md), so failures are named individually within a
    // single toast instead of one toast per file.
    const reportBatchResult = (result: any, fallbackError: string) => {
        if (!result) return;
        if (!result.success) {
            pushToast(result.error || fallbackError, "error");
            return;
        }
        const failed: string[] = result.failed || [];
        const imported: number = result.imported || 0;
        if (failed.length === 0) {
            pushToast(`Imported ${imported} file${imported === 1 ? "" : "s"}.`);
            // Only clear the selection on a clean sweep -- if anything
            // failed, leaving the checkboxes as-is lets the user glance at
            // which rows are still selected and retry (e.g. after fixing a
            // missing file) without having to re-pick them one by one.
            setSelectedPaths(new Set());
        } else {
            pushToast(`Imported ${imported}, ${failed.length} failed: ${failed.join(", ")}`, "error");
        }
    };

    const handleImportSelected = async () => {
        if (selectedPaths.size === 0) return;
        setBatchBusy(true);
        try {
            const result = await safeEvalTS("importLocLibComponentsBatch", Array.from(selectedPaths));
            reportBatchResult(result, "Batch import failed.");
        } finally {
            setBatchBusy(false);
        }
    };

    // Opens every .aep in a picked localised batch folder, imports the
    // selected components into each, and saves it in place -- NOT a
    // read-only import. Confirmed with the user this targets localised
    // delivery batches (e.g. "Batch_01" France), never Masters -- aeft.ts
    // still independently refuses to touch anything inside a known
    // Masters root regardless of what this UI does, but the preview step
    // here is what lets the user see and cancel before anything on disk
    // actually changes.
    const handleSaveIntoBatchFolder = async () => {
        if (selectedPaths.size === 0) return;
        const folder = await safeEvalTS("selectBatchFolder");
        if (!folder) return;

        const preview = await safeEvalTS("previewBatchFolderAep", folder);
        if (!preview) return;
        if (preview.blocked) {
            await alertDialog(preview.blockedReason || "That folder can't be used for this.");
            return;
        }
        if (!preview.count) {
            await alertDialog("No .aep files found in that folder.");
            return;
        }

        const folderName = folder.split(/[\\/]/).pop();
        const proceed = await confirmDialog(
            `This will open, update, and SAVE ${preview.count} project file${preview.count === 1 ? "" : "s"} in "${folderName}" with the ${selectedPaths.size} selected component${selectedPaths.size === 1 ? "" : "s"}.\n\n` +
                "This modifies those files on disk and can't be undone. It will also temporarily replace whatever project you currently have open here — save any unsaved work in it first.\n\nContinue?"
        );
        if (!proceed) return;

        setBatchBusy(true);
        try {
            const result = await safeEvalTS("importComponentsIntoBatchFolder", Array.from(selectedPaths), folder);
            reportBatchResult(result, "Batch save failed.");
        } finally {
            setBatchBusy(false);
        }
    };

    const territorySearchLower = territorySearch.trim().toLowerCase();
    const visibleTerritories = territories.filter((t) => {
        if (!territorySearchLower) return true;
        return (t + (countryCodes[t] || "")).toLowerCase().indexOf(territorySearchLower) !== -1;
    });

    const componentsForTerritory = components.filter((c) => c.campaign === selectedCampaign?.name && c.territory === selectedTerritory);

    const countFor = (territory: string) => components.filter((c) => c.campaign === selectedCampaign?.name && c.territory === territory).length;

    // Folder list for the currently selected territory -- every distinct
    // folder name in actual use (auto extension bucket or explicit) UNION
    // any custom folder that's been created but has nothing filed in it
    // yet, so a just-created empty folder doesn't disappear.
    const customFoldersForTerritory = customFolders.filter((f) => f.campaign === selectedCampaign?.name && f.territory === selectedTerritory);
    const folderNamesInUse = new Set(componentsForTerritory.map(folderForComponent));
    const allFolderNames = Array.from(new Set([...folderNamesInUse, ...customFoldersForTerritory.map((f) => f.name)])).sort();
    const customFolderNameSet = new Set(customFoldersForTerritory.map((f) => f.name));

    const componentsForFolder = componentsForTerritory.filter((c) => folderForComponent(c) === selectedFolder);

    const allSelected = componentsForFolder.length > 0 && selectedPaths.size === componentsForFolder.length;

    return (
        <div className="localised-library">

            {/* Campaign context bar */}
            <div className="ll-campaign-bar">
                <Dropdown
                    className="ll-campaign-select"
                    icon={<Library size={13} />}
                    value={selectedCampaign?.name || ""}
                    onChange={(v) => setSelectedCampaign(campaigns.find((c) => c.name === v) || null)}
                    options={campaigns.map((c) => ({ value: c.name, label: c.name }))}
                    placeholder="Select a campaign…"
                    emptyMessage="No campaigns yet — add one with the folder icon."
                />
                <Tooltip text="New Campaign">
                    <button className="ll-icon-btn" onClick={handleNewCampaign}>
                        <FolderPlus size={14} />
                    </button>
                </Tooltip>
                <Tooltip text="Remove Campaign">
                    <button className="ll-icon-btn" onClick={handleRemoveCampaign} disabled={!selectedCampaign}>
                        <Trash2 size={14} />
                    </button>
                </Tooltip>
            </div>

            {!selectedCampaign ? (
                <div className="ll-empty-state">
                    <Library size={28} />
                    <p>Select or create a campaign to browse its territories and components.</p>
                </div>
            ) : (
                <>
                    <Tooltip
                        text={
                            selectedTerritory
                                ? `Scans only the "${selectedTerritory}" territory for a Support_Motion or Motion_Components folder and auto-adds every file found inside. Read-only.`
                                : "Scans every territory for a Support_Motion or Motion_Components folder and auto-adds every file found inside. Read-only."
                        }
                    >
                        <button className="ll-auto-populate" disabled={busy} onClick={handleAutoPopulate}>
                            <Wand2 size={14} className={busy ? "spin" : ""} />{" "}
                            {selectedTerritory ? (
                                <>
                                    Find the <span className="ll-auto-populate-territory">{selectedTerritory}</span> Motion
                                </>
                            ) : (
                                "Find the Motion"
                            )}
                        </button>
                    </Tooltip>

                    <div className="ll-view-wrap">
                        <motion.div
                            key={selectedFolder ? "components" : selectedTerritory ? "folders" : "territories"}
                            className="ll-view"
                            initial={{ opacity: 0, x: selectedTerritory ? 16 : -16 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        >
                            {!selectedTerritory ? (
                                /* ── Territories view ─────────────────────── */
                                <>
                                    <div className="ll-section-head">
                                        <span className="ll-section-title">Territories</span>
                                        {!loadingTerritories && <span className="ll-section-count">{territories.length}</span>}
                                    </div>

                                    {!loadingTerritories && detectedTerritory && territories.includes(detectedTerritory) && (
                                        <button className="ll-suggestion" onClick={() => setSelectedTerritory(detectedTerritory)}>
                                            <MapPin size={13} />
                                            <span className="ll-suggestion-text">
                                                You may be in <strong>{detectedTerritory}</strong>
                                                {countryCodes[detectedTerritory] ? <em> {countryCodes[detectedTerritory]}</em> : null}
                                            </span>
                                            <ChevronRight size={14} className="ll-chevron" />
                                        </button>
                                    )}

                                    <div className="ll-search">
                                        <Search size={12} />
                                        <input
                                            type="text"
                                            placeholder="Find territory…"
                                            value={territorySearch}
                                            onChange={(e) => setTerritorySearch(e.target.value)}
                                        />
                                        {territorySearch && (
                                            <Tooltip text="Clear">
                                                <button className="ll-search-clear" onClick={() => setTerritorySearch("")}>
                                                    <X size={12} />
                                                </button>
                                            </Tooltip>
                                        )}
                                    </div>

                                    <div className="ll-terr-list">
                                        {loadingTerritories &&
                                            Array.from({ length: 6 }).map((_, i) => <SkeletonTerritoryRow key={i} />)}
                                        {!loadingTerritories && visibleTerritories.length === 0 && (
                                            <div className="ll-empty">
                                                {territories.length === 0 ? "No territory folders found under the Markets root." : "No matching territories."}
                                            </div>
                                        )}
                                        {!loadingTerritories &&
                                            visibleTerritories.map((t) => {
                                                const count = countFor(t);
                                                return (
                                                    <button key={t} className="ll-terr-row" onClick={() => setSelectedTerritory(t)}>
                                                        <span className={count > 0 ? "ll-pip filled" : "ll-pip"} />
                                                        <span className="ll-terr-name">
                                                            {t}
                                                            {countryCodes[t] ? <em> {countryCodes[t]}</em> : null}
                                                        </span>
                                                        <span className={count > 0 ? "ll-count has" : "ll-count"}>{count}</span>
                                                        <ChevronRight size={14} className="ll-chevron" />
                                                    </button>
                                                );
                                            })}
                                    </div>
                                </>
                            ) : !selectedFolder ? (
                                /* ── Folders view (the "mini directories" split) ── */
                                <>
                                    <button className="ll-back" onClick={() => setSelectedTerritory(null)}>
                                        <ArrowLeft size={13} /> All territories
                                    </button>

                                    <div className="ll-comp-head">
                                        <div className="ll-comp-title">
                                            {selectedTerritory}
                                            {countryCodes[selectedTerritory] ? <em> {countryCodes[selectedTerritory]}</em> : null}
                                        </div>
                                        <span className={componentsForTerritory.length > 0 ? "ll-count has" : "ll-count"}>
                                            {componentsForTerritory.length}
                                        </span>
                                    </div>

                                    <button className="ll-new-folder" onClick={handleNewFolder}>
                                        <FolderPlus size={14} /> New Folder…
                                    </button>

                                    <div className="ll-folder-list">
                                        {allFolderNames.length === 0 && (
                                            <p className="ll-empty">
                                                No folders yet. Create one, then Add Component once inside it -- or run Auto-Populate to pull files
                                                from this territory's Motion Components folder (each lands in a folder named after its file type).
                                            </p>
                                        )}
                                        {allFolderNames.map((name) => {
                                            const count = componentsForTerritory.filter((c) => folderForComponent(c) === name).length;
                                            const isCustom = customFolderNameSet.has(name);
                                            return (
                                                <div key={name} className="ll-folder-row-wrap">
                                                    <button className="ll-folder-row" onClick={() => setSelectedFolder(name)}>
                                                        <Folder size={14} className="ll-folder-icon" />
                                                        <span className="ll-folder-name">{name}</span>
                                                        <span className={count > 0 ? "ll-count has" : "ll-count"}>{count}</span>
                                                        <ChevronRight size={14} className="ll-chevron" />
                                                    </button>
                                                    {isCustom && (
                                                        <Tooltip text="Remove this folder (components move back to their file-type folder)">
                                                            <button
                                                                className="ll-row-btn ll-folder-delete"
                                                                onClick={() => handleRemoveFolder(name)}
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </Tooltip>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : (
                                /* ── Components-in-a-folder view ──────────────── */
                                <>
                                    <button className="ll-back" onClick={() => setSelectedFolder(null)}>
                                        <ArrowLeft size={13} /> {selectedTerritory}
                                    </button>

                                    <div className="ll-comp-head">
                                        <div className="ll-comp-title">
                                            <Folder size={13} className="ll-folder-icon" /> {selectedFolder}
                                        </div>
                                        <span className={componentsForFolder.length > 0 ? "ll-count has" : "ll-count"}>
                                            {componentsForFolder.length}
                                        </span>
                                    </div>

                                    {componentsForFolder.length > 0 && (
                                        <div className="ll-select-all" onClick={toggleSelectAll}>
                                            {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                                            <span>{allSelected ? "Deselect all" : "Select all"}</span>
                                        </div>
                                    )}

                                    <div className="ll-comp-list">
                                        {componentsForFolder.length === 0 && (
                                            <p className="ll-empty">No components in this folder yet. Add one below.</p>
                                        )}
                                        {componentsForFolder.map((c) => (
                                            <div key={c.label + c.path} className={`ll-comp-row ${selectedPaths.has(c.path) ? "selected" : ""}`}>
                                                <Tooltip text="Select for batch import">
                                                    <button className="ll-check" onClick={() => toggleSelected(c.path)}>
                                                        {selectedPaths.has(c.path) ? <CheckSquare size={14} /> : <Square size={14} />}
                                                    </button>
                                                </Tooltip>
                                                <Tooltip text={c.path}>
                                                    <span className="ll-comp-name">{c.label}</span>
                                                </Tooltip>
                                                <Tooltip text="Import (read-only)">
                                                    <button className="ll-row-btn" onClick={() => handleImport(c.path)}>
                                                        <Download size={14} />
                                                    </button>
                                                </Tooltip>
                                                <Tooltip text="Reveal in Finder/Explorer">
                                                    <button className="ll-row-btn" onClick={() => handleReveal(c.path)}>
                                                        <Search size={14} />
                                                    </button>
                                                </Tooltip>
                                                <Tooltip text="Remove from library">
                                                    <button className="ll-row-btn" onClick={() => handleRemoveComponent(c)}>
                                                        <X size={14} />
                                                    </button>
                                                </Tooltip>
                                                {/* Deliberately at the far end, set apart from
                                                    Import/Reveal/Remove -- it used to sit right next
                                                    to Import, easy to fat-finger by mistake. */}
                                                <Tooltip text="Move to another folder">
                                                    <button className="ll-row-btn ll-row-btn-move" onClick={() => handleMoveComponent(c)}>
                                                        <FolderSymlink size={14} />
                                                    </button>
                                                </Tooltip>
                                            </div>
                                        ))}
                                    </div>

                                    <AnimatePresence>
                                        {selectedPaths.size > 0 && (
                                            <motion.div
                                                className="ll-batch"
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: "auto" }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.18 }}
                                            >
                                                <Tooltip text="Import just the selected components into the current project, read-only">
                                                    <button disabled={batchBusy} onClick={handleImportSelected}>
                                                        <Download size={14} /> Import Selected ({selectedPaths.size})
                                                    </button>
                                                </Tooltip>
                                                <Tooltip text="Pick a localised batch folder -- opens, updates, and SAVES every .aep found inside it with the selected components. Modifies those files on disk. Never use on a Masters folder.">
                                                    <button className="danger" disabled={batchBusy} onClick={handleSaveIntoBatchFolder}>
                                                        <FolderInput size={14} /> Save Into Batch…
                                                    </button>
                                                </Tooltip>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    <button className="ll-add" onClick={handleAddComponent}>
                                        <Plus size={14} /> Add Component…
                                    </button>
                                </>
                            )}
                        </motion.div>
                    </div>
                </>
            )}

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
        </div>
    );
};

export default LocalisedLibraryTool;
