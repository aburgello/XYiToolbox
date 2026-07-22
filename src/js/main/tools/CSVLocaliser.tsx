// =============================================================================
// src/js/main/tools/CSVLocaliser.tsx
// -----------------------------------------------------------------------------
// CSV Localiser -- now scan-first. The primary flow points at a campaign's
// Markets root and, for every territory, reads <Territory>/Masters/Specs/*.pdf,
// parses the delivery table PANEL-SIDE (pdf.js -- see lib/pdfSpecs.ts), and
// generates localised comps by feeding each PDF into the SAME host function
// (csvLocaliserRun) the old paste flow used. Country comes from the territory
// folder, Batch from the PDF filename -- no website CSV export needed.
//
// The original "paste a [METADATA]/CSV block" flow is kept as a collapsible
// fallback at the bottom. ExtendScript can't read PDF bytes, so folder walking
// + PDF parsing happen here; only comp generation crosses the bridge.
// =============================================================================
import React, { useEffect, useMemo, useState } from "react";
import {
    FolderSearch,
    FolderPlus,
    Library,
    PlayCircle,
    ScanSearch,
    FileText,
    MapPin,
    ChevronRight,
    ChevronDown,
    Check,
    Search,
    ClipboardPaste,
    RefreshCw,
    Image as ImageIcon,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { fs, path } from "../../lib/cep/node";
import CheckboxToggle from "../CheckboxToggle";
import Tooltip from "../Tooltip";
import Dropdown from "../Dropdown";
import { alertDialog, promptDialog } from "../Dialog";
import { showMcItReport, type McReport } from "../McItReportModal";
import { showLocGenReport, type LocGenReport, type LocGenRow } from "../LocGenReportModal";
import type { SpecRow } from "../lib/pdfSpecs";

interface Campaign {
    name: string;
    marketsRoot: string;
}

// Mirrors csvLocaliserRun()'s CsvLocRowReport host-side.
interface CsvLocRow {
    row: number;
    artwork: string;
    campaign: string;
    size: string;
    duration: string;
    status: "generated" | "skipped-existing" | "no-master" | "error";
    master?: string;
    output?: string;
    error?: string;
}

// The campaign root (e.g. .../INT) holds sibling *_Markets and *_Masters folders
// sharing a stem. Given the saved Markets path, find its Masters sibling: strip
// the "XY####_" prefix and "_Markets" suffix to get the stem, then match the
// sibling ending "…Masters" that contains that stem (XY numbers differ between
// the two, so compare on the stem, alphanumerics only).
function deriveMastersFromMarkets(marketsRoot: string): string {
    try {
        const parent = path.dirname(marketsRoot);
        const marketsName = path.basename(marketsRoot);
        const stem = marketsName.replace(/^XY\d+[_-]?/i, "").replace(/[_-]?markets$/i, "");
        const canon = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const stemC = canon(stem);
        const kids = fs.readdirSync(parent, { withFileTypes: true }).filter((d: any) => d.isDirectory());
        let ms = kids.find((d: any) => /masters$/i.test(d.name) && stemC && canon(d.name).indexOf(stemC) !== -1);
        if (!ms) ms = kids.find((d: any) => /masters$/i.test(d.name) && !/markets$/i.test(d.name));
        return ms ? path.join(parent, ms.name) : "";
    } catch (e) {
        return "";
    }
}
import "../shared.scss";
import "./formTool.scss";

interface Batch {
    pdfName: string;
    batch: string;
    rows: SpecRow[];
    error?: string;
    // Output folder <Territory>/AE/<paddedBatch> already holds .aep(s) — the
    // batch has been localised before, so seed the button to "Done".
    done?: boolean;
}

interface TerritoryScan {
    territory: string;
    sourceFolder: string;
    batches: Batch[];
    rowCount: number;
    hasSpecs: boolean;
}

const isBridge = () => typeof (window as any).cep !== "undefined";
const batchKey = (territory: string, pdfName: string) => `${territory}/${pdfName}`;

// Map a csvLocaliserRun result into the shared LocGen report shape so it pops
// the same modal as Generate/Trott. runId comes from the host so this live
// popup dedupes against the persisted-report poller (no double-show).
function csvResultToLocGenReport(res: {
    message?: string;
    outputFolder?: string;
    rows?: CsvLocRow[];
    runId?: string;
    finishedAt?: string;
}, label: string): LocGenReport {
    const rows: LocGenRow[] = (res.rows || []).map((r) => ({
        source: "Row " + r.row + (r.campaign ? " · " + r.campaign : ""),
        artwork: r.artwork,
        campaign: r.campaign,
        size: r.size,
        duration: r.duration,
        status: r.status,
        master: r.master,
        output: r.output,
        error: r.error,
    }));
    return { tool: label, message: res.message, outputFolder: res.outputFolder, rows, runId: res.runId, finishedAt: res.finishedAt };
}

// csvLocaliserRun writes to <Source Folder>/AE/<paddedBatch> and pads a lone
// trailing digit (Batch_1 -> Batch_01), so mirror that to find the folder.
const padBatch = (batch: string) => batch.replace(/(\d+)$/, (d) => (d.length === 1 ? "0" + d : d));

const CSVLocaliserTool = () => {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [campaignName, setCampaignName] = useState("");
    const [aepPath, setAepPath] = useState("");
    const [mastersAuto, setMastersAuto] = useState(false);
    const [marketsRoot, setMarketsRoot] = useState("");
    const [skipExisting, setSkipExisting] = useState(true);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const [scan, setScan] = useState<TerritoryScan[] | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    // Per-batch run state, keyed by `${territory}/${pdfName}`.
    const [batchStatus, setBatchStatus] = useState<Record<string, "running" | "done" | "failed">>({});
    // Per-batch localiser row results (csvLocaliserRun's structured report),
    // same key -- rendered inline under the batch after a run.
    const [batchRows, setBatchRows] = useState<Record<string, CsvLocRow[]>>({});

    // paste fallback
    const [pasteOpen, setPasteOpen] = useState(false);
    const [csvText, setCsvText] = useState("");

    const refreshCampaigns = async () => {
        try {
            const camps = await evalTS("loadLocLibCampaigns");
            if (camps) setCampaigns(camps as Campaign[]);
        } catch (e) {
            /* browser preview -- no bridge */
        }
    };

    useEffect(() => {
        (async () => {
            await refreshCampaigns();
            try {
                const last = await evalTS("csvLocaliserLoadLastPath");
                if (last) setAepPath(last);
            } catch (e) {
                /* browser preview -- no bridge */
            }
        })();
    }, []);

    // Restore the campaign that was selected last time, which brings its
    // Markets folder (and derived Masters) back with it -- the Markets folder
    // is the same one all campaign long, so re-picking it every panel open was
    // pure repetition. Runs once the campaign list is loaded and only if
    // nothing's been picked in the meantime; a saved name that no longer
    // matches a campaign restores nothing. Silent: this is a restore, not a
    // thing that happened, so it doesn't announce itself in the notice line.
    useEffect(() => {
        if (campaigns.length === 0 || campaignName) return;
        (async () => {
            try {
                const lastCampaign = await evalTS("csvLocaliserLoadLastCampaign");
                if (lastCampaign && campaigns.some((c) => c.name === lastCampaign)) {
                    selectCampaign(lastCampaign, true);
                }
            } catch (e) {
                /* browser preview -- no bridge */
            }
        })();
    }, [campaigns]);

    // Selecting a saved campaign (shared with Localised Library) fills Markets
    // from the campaign and derives Masters from its sibling in the same root.
    // Storing just the NAME keeps the campaign record the single source of
    // truth for its Markets path -- re-point it in Localised Library and this
    // follows automatically instead of holding a stale copy.
    const selectCampaign = (name: string, restoring = false) => {
        const c = campaigns.find((c) => c.name === name);
        if (!c) return;
        setCampaignName(name);
        setMarketsRoot(c.marketsRoot);
        setScan(null);
        const masters = deriveMastersFromMarkets(c.marketsRoot);
        setMastersAuto(!!masters);
        if (masters) setAepPath(masters);
        if (!restoring) {
            setNotice(masters ? "Markets from campaign; Masters auto-detected from its root." : "Markets set — pick the AEP masters folder below.");
            evalTS("csvLocaliserSaveLastCampaign", name).catch(() => {});
        }
    };

    // Add a campaign the same way Localised Library does, so they stay in sync.
    const addCampaign = async () => {
        try {
            const name = await promptDialog("Campaign name (e.g. INTL_DIGITAL_Outdoor_Campaign):", "");
            if (!name) return;
            if (campaigns.some((c) => c.name === name)) {
                await alertDialog(`A campaign named "${name}" already exists.`);
                return;
            }
            const mr = await evalTS("selectMarketsFolder");
            if (mr === undefined) throw new Error("no bridge");
            if (!mr) return;
            const res = await evalTS("saveLocLibCampaign", name, mr);
            if (!res || !res.success) {
                await alertDialog((res && res.error) || "Could not save campaign.");
                return;
            }
            await refreshCampaigns();
            selectCampaign(name);
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects.");
        }
    };

    const browseAep = async () => {
        try {
            const picked = await evalTS("selectCsvLocaliserAepFolder");
            if (picked === undefined) throw new Error("no bridge");
            if (picked) {
                setAepPath(picked);
                setMastersAuto(false);
            }
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects.");
        }
    };

    const browseMarkets = async () => {
        try {
            const picked = await evalTS("selectMarketsFolder");
            if (picked === undefined) throw new Error("no bridge");
            if (picked) {
                setMarketsRoot(picked);
                setCampaignName("");
                setScan(null);
            }
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects.");
        }
    };

    // ── scan every territory's Masters/Specs for PDFs ─────────────────────────
    const runScan = async () => {
        setNotice(null);
        if (!isBridge()) {
            setNotice("No CEP bridge — open this panel inside After Effects to scan.");
            return;
        }
        if (!marketsRoot) {
            setNotice("Pick the campaign's Markets folder first.");
            return;
        }
        setBusy(true);
        setScan(null);
        try {
            const { parsePdfDeliverySpecs, reshapeSpecs, batchNameFromFilename } = await import("../lib/pdfSpecs");
            const territories: string[] = (await evalTS("scanTerritories", marketsRoot)) || [];
            const result: TerritoryScan[] = [];

            for (const territory of territories) {
                setProgress(`Reading ${territory}…`);
                const sourceFolder = path.join(marketsRoot, territory);
                const specsDir = path.join(sourceFolder, "Masters", "Specs");
                let pdfs: string[] = [];
                let hasSpecs = true;
                try {
                    pdfs = fs.readdirSync(specsDir).filter((f: string) => /\.pdf$/i.test(f));
                } catch (e) {
                    hasSpecs = false;
                }

                const batches: Batch[] = [];
                for (const pdfName of pdfs.sort()) {
                    const batch = batchNameFromFilename(pdfName);
                    // Already localised? Check <Territory>/AE/<paddedBatch> for .aep output.
                    let done = false;
                    try {
                        const outDir = path.join(sourceFolder, "AE", padBatch(batch));
                        done = fs.readdirSync(outDir).some((f: string) => /\.aep$/i.test(f));
                    } catch (e) {
                        /* no output folder yet */
                    }
                    try {
                        const buf = fs.readFileSync(path.join(specsDir, pdfName));
                        const raw = await parsePdfDeliverySpecs(new Uint8Array(buf));
                        const rows = raw ? reshapeSpecs(raw, territory) : [];
                        batches.push({ pdfName, batch, rows, done, error: rows.length ? undefined : "No spec rows found." });
                    } catch (e: any) {
                        batches.push({ pdfName, batch, rows: [], done, error: e?.message || "Couldn't read PDF." });
                    }
                }

                const rowCount = batches.reduce((n, b) => n + b.rows.length, 0);
                result.push({ territory, sourceFolder, batches, rowCount, hasSpecs });
            }

            setScan(result);
            // Seed run-state: any batch whose output folder already holds .aep
            // files shows "Done · Re-run" straight away.
            const seed: Record<string, "done"> = {};
            result.forEach((t) =>
                t.batches.forEach((b) => {
                    if (b.done) seed[batchKey(t.territory, b.pdfName)] = "done";
                })
            );
            setBatchStatus(seed);
            const withRows = result.filter((t) => t.rowCount > 0);
            const rowTotal = withRows.reduce((n, t) => n + t.rowCount, 0);
            setNotice(
                withRows.length
                    ? `Found ${rowTotal} rows across ${withRows.length} territor${withRows.length === 1 ? "y" : "ies"}.`
                    : "No Masters/Specs PDFs with rows found under any territory."
            );
        } catch (e: any) {
            setNotice(e?.message || "Scan failed.");
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    // ── run the localiser for ONE batch (one PDF) ─────────────────────────────
    const runBatch = async (t: TerritoryScan, b: Batch) => {
        if (!b.rows.length) return;
        if (!aepPath) {
            setNotice("Pick the AEP masters folder first.");
            return;
        }
        setNotice(null);
        const key = batchKey(t.territory, b.pdfName);
        setBatchStatus((s) => ({ ...s, [key]: "running" }));
        setBusy(true);
        try {
            const { buildLocaliserCsv } = await import("../lib/pdfSpecs");
            const csv = buildLocaliserCsv({ territory: t.territory, batch: b.batch, sourceFolder: t.sourceFolder, rows: b.rows });
            const res = await evalTS("csvLocaliserRun", aepPath, csv, skipExisting);
            if (res === undefined) throw new Error("no bridge");
            const rows = (res.success ? (res as { rows?: CsvLocRow[] }).rows : undefined) || [];
            const problems = rows.filter((r) => r.status === "no-master" || r.status === "error").length;
            if (rows.length) setBatchRows((s) => ({ ...s, [key]: rows }));
            setBatchStatus((s) => ({ ...s, [key]: res.success && problems === 0 ? "done" : "failed" }));
            setNotice(res.success ? `${t.territory} · ${b.batch}: ${res.message || "run finished."}` : res.error || "Something went wrong.");
            // Inline strip above stays; also pop the shared results modal.
            if (res.success && rows.length) showLocGenReport(csvResultToLocGenReport(res as any, `CSV Localiser · ${t.territory} · ${b.batch}`));
        } catch (e: any) {
            setBatchStatus((s) => ({ ...s, [key]: "failed" }));
            setNotice(e?.message || "No CEP bridge — open this panel inside After Effects to run it.");
        } finally {
            setBusy(false);
        }
    };

    // MC It! for ONE batch, dialogs-free: the scan already knows the AEP
    // output folder (<Territory>/AE/<paddedBatch>) and mcIt() derives the
    // JPG_PNG sibling itself. Dry-run first — the app-root modal offers Apply.
    const runBatchMcIt = async (t: TerritoryScan, b: Batch) => {
        setNotice(null);
        setBusy(true);
        try {
            const aepDir = path.join(t.sourceFolder, "AE", padBatch(b.batch));
            const res = await evalTS("mcIt", aepDir, "", true);
            if (res === undefined) throw new Error("no bridge");
            if (res.success) showMcItReport(res as unknown as McReport);
            else setNotice(res.error || "MC It! couldn't run on this batch.");
        } catch (e: any) {
            setNotice(e?.message || "No CEP bridge — open this panel inside After Effects to run it.");
        } finally {
            setBusy(false);
        }
    };

    const runPaste = async () => {
        setNotice(null);
        setBusy(true);
        try {
            const res = await evalTS("csvLocaliserRun", aepPath, csvText, skipExisting);
            if (res === undefined) throw new Error("no bridge");
            if (res.success) {
                const rows = (res as { rows?: CsvLocRow[] }).rows || [];
                const problems = rows.filter((r) => r.status === "no-master" || r.status === "error").length;
                setNotice((res.message || "Run finished.") + (problems ? ` — ${problems} row(s) had no master match.` : ""));
                if (rows.length) showLocGenReport(csvResultToLocGenReport(res as any, "CSV Localiser (pasted)"));
            } else {
                setNotice(res.error || "Something went wrong.");
            }
        } catch (e) {
            setNotice("No CEP bridge — open this panel inside After Effects to run it.");
        } finally {
            setBusy(false);
        }
    };

    const toggleExpand = (t: string) =>
        setExpanded((s) => {
            const n = new Set(s);
            n.has(t) ? n.delete(t) : n.add(t);
            return n;
        });

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (scan || []).filter((t) => !q || t.territory.toLowerCase().includes(q));
    }, [scan, search]);

    return (
        <div className="form-tool specs-tool">
            {/* Folders */}
            <div className="specs-folders">
                <label className="specs-field-label">Campaign</label>
                <div className="field-with-button">
                    <div className="field-row specs-campaign-select">
                        <Dropdown
                            icon={<Library size={13} />}
                            value={campaignName}
                            onChange={selectCampaign}
                            options={campaigns.map((c) => ({ value: c.name, label: c.name }))}
                            placeholder="Select a campaign…"
                            emptyMessage="No campaigns yet — add one with the + button."
                            disabled={busy}
                        />
                    </div>
                    <Tooltip text="Add a campaign (pick its Markets folder)">
                        <button className="icon-btn specs-campaign-btn" disabled={busy} onClick={addCampaign}><FolderPlus size={14} /></button>
                    </Tooltip>
                </div>

                <label className="specs-field-label">
                    Markets folder {campaignName && marketsRoot && <span className="specs-detected">from campaign</span>}
                </label>
                <div className="field-with-button">
                    <div className="field-row">
                        <input type="text" value={marketsRoot} onChange={(e) => setMarketsRoot(e.target.value)} placeholder="The campaign's Markets (territories) folder…" />
                    </div>
                    <Tooltip text="Browse for the Markets folder">
                        <button className="icon-btn" disabled={busy} onClick={browseMarkets}><FolderSearch size={14} /></button>
                    </Tooltip>
                </div>

                <label className="specs-field-label">
                    AEP masters folder {mastersAuto && aepPath && <span className="specs-detected">auto-detected</span>}
                </label>
                <div className="field-with-button">
                    <div className="field-row">
                        <input type="text" value={aepPath} onChange={(e) => { setAepPath(e.target.value); setMastersAuto(false); }} placeholder="Folder of master AEPs to localise from…" />
                    </div>
                    <Tooltip text="Browse for the AEP masters folder">
                        <button className="icon-btn" disabled={busy} onClick={browseAep}><FolderSearch size={14} /></button>
                    </Tooltip>
                </div>

                <div className="specs-actions-row">
                    <CheckboxToggle checked={skipExisting} onChange={setSkipExisting} label="Skip existing files" />
                    <button className="specs-scan-btn" disabled={busy || !marketsRoot} onClick={runScan}>
                        {scan ? <RefreshCw size={14} /> : <ScanSearch size={14} />} {scan ? "Re-scan" : "Scan Specs"}
                    </button>
                </div>
            </div>

            {progress && <p className="hint specs-progress">{progress}</p>}

            {/* Results */}
            {scan && scan.length > 0 && (
                <div className="specs-results">
                    <div className="specs-toolbar">
                        <div className="specs-search">
                            <Search size={13} />
                            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter territories…" />
                        </div>
                    </div>

                    {!aepPath && <p className="hint specs-warn">Pick the AEP masters folder above to enable batch runs.</p>}

                    <div className="specs-list">
                        {filtered.map((t) => {
                            const open = expanded.has(t.territory);
                            const runnable = t.rowCount > 0;
                            const batchCount = t.batches.filter((b) => b.rows.length).length;
                            const status = runnable ? `${batchCount} batch${batchCount === 1 ? "" : "es"} · ${t.rowCount} rows` : t.hasSpecs ? "no rows" : "no Specs";
                            const statusClass = runnable ? "ok" : t.hasSpecs ? "warn" : "muted";
                            return (
                                <div key={t.territory} className={"specs-terr" + (runnable ? "" : " is-disabled")}>
                                    <button className="specs-terr-main" onClick={() => runnable && toggleExpand(t.territory)} disabled={!runnable}>
                                        <MapPin size={13} />
                                        <span className="specs-terr-name">{t.territory}</span>
                                        <span className={"specs-pill specs-pill--" + statusClass}>{status}</span>
                                        {runnable && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                                    </button>

                                    {open && runnable && (
                                        <div className="specs-terr-body">
                                            {t.batches.map((b) => {
                                                const key = batchKey(t.territory, b.pdfName);
                                                const st = batchStatus[key];
                                                const canRun = b.rows.length > 0;
                                                return (
                                                    <div key={b.pdfName} className="specs-batch">
                                                        <div className="specs-batch-head">
                                                            <FileText size={12} />
                                                            <span className="specs-batch-name">{b.pdfName}</span>
                                                            <span className="specs-batch-tag">{b.batch}</span>
                                                            {b.error ? <span className="specs-batch-err">{b.error}</span> : <span className="specs-batch-ok">{b.rows.length} rows</span>}
                                                            {canRun && (
                                                                <>
                                                                    <button
                                                                        className={"specs-batch-run" + (st === "done" ? " is-done" : st === "failed" ? " is-failed" : "")}
                                                                        disabled={busy || !aepPath}
                                                                        onClick={() => runBatch(t, b)}
                                                                    >
                                                                        {st === "running" ? (
                                                                            <><RefreshCw size={12} className="spin" /> Running…</>
                                                                        ) : st === "done" ? (
                                                                            <><Check size={12} /> Done · Re-run</>
                                                                        ) : st === "failed" ? (
                                                                            <><PlayCircle size={12} /> Retry</>
                                                                        ) : (
                                                                            <><PlayCircle size={12} /> Localise batch</>
                                                                        )}
                                                                    </button>
                                                                    {/* Enabled once the batch's AE output exists (pre-scan
                                                                        detection or a completed run this session). */}
                                                                    <Tooltip text="Swap the placeholder PNG/JPGs in this batch's AEPs for the localised images (previews first)">
                                                                        <button
                                                                            className="specs-batch-run specs-batch-mcit"
                                                                            disabled={busy || (!b.done && st !== "done")}
                                                                            onClick={() => runBatchMcIt(t, b)}
                                                                        >
                                                                            <ImageIcon size={12} /> MC It!
                                                                        </button>
                                                                    </Tooltip>
                                                                </>
                                                            )}
                                                        </div>
                                                        {b.rows.length > 0 && (
                                                            <table className="specs-table">
                                                                <thead><tr><th>Artwork</th><th>Campaign</th><th>Size</th><th>Dur</th></tr></thead>
                                                                <tbody>
                                                                    {b.rows.map((r, i) => (
                                                                        <tr key={i}>
                                                                            <td>{r.Artwork}</td>
                                                                            <td className={r.Campaign === "UNKNOWN" ? "is-unknown" : ""}>{r.Campaign}</td>
                                                                            <td>{r.Size}</td>
                                                                            <td>{r.Duration}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                        {batchRows[key] && (
                                                            <div className="specs-locresult">
                                                                {(() => {
                                                                    const rows = batchRows[key];
                                                                    const gen = rows.filter((r) => r.status === "generated").length;
                                                                    const skip = rows.filter((r) => r.status === "skipped-existing").length;
                                                                    const problems = rows.filter((r) => r.status === "no-master" || r.status === "error");
                                                                    return (
                                                                        <>
                                                                            <div className="specs-locresult-line">
                                                                                <span className="ok">{gen} generated</span>
                                                                                {skip > 0 && <span className="muted"> · {skip} already existed</span>}
                                                                                {problems.length > 0 && <span className="bad"> · {problems.length} failed</span>}
                                                                            </div>
                                                                            {problems.map((r) => (
                                                                                <div key={r.row} className="specs-locresult-problem">
                                                                                    Row {r.row} · {r.campaign} {r.size} {r.duration} — {r.error || "no master matched"}
                                                                                </div>
                                                                            ))}
                                                                        </>
                                                                    );
                                                                })()}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Paste-CSV fallback */}
            <div className="specs-fallback">
                <button className="specs-fallback-toggle" onClick={() => setPasteOpen((v) => !v)}>
                    {pasteOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <ClipboardPaste size={13} /> Paste a CSV instead
                </button>
                {pasteOpen && (
                    <div className="specs-fallback-body">
                        <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={8} placeholder="Paste a [METADATA] block + Artwork/Campaign/Size/Duration rows…" />
                        <button disabled={busy || !csvText.trim() || !aepPath} onClick={runPaste}>
                            <PlayCircle size={14} /> Run pasted CSV
                        </button>
                    </div>
                )}
            </div>

            {notice && <p className="hint">{notice}</p>}
        </div>
    );
};

export default CSVLocaliserTool;
