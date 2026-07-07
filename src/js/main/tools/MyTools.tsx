// =============================================================================
// src/js/main/tools/MyTools.tsx
// -----------------------------------------------------------------------------
// Browse/run/delete every tool saved from Script Playground's "Save as
// Tool..." form -- both kinds ("button" ones ALSO live as a real tile in
// the Toolset grid's "Custom Tools" group; "page" ones live only here).
// This page IS the "submenu in tools" a saved script gets -- there's no
// separate per-script navigation entry, which would need each script to
// carry its own lazy-loaded component the way real registered tools do.
// Reuses ScriptPlayground's .sp-tool-list styling (formTool.scss) since
// this is functionally the same list, just standalone instead of tucked
// under an editor.
//
// Also the home for SHARING custom tools with colleagues (whose app.settings
// this can't reach directly): tick the tools to share, Export to a .json
// file, send it however; a colleague uses Import here to merge them into
// their own. See the export/import backend (aeft/tools.ts) -- this side owns
// the selection, the file-format wrapper, id-stripping on export, and
// merge-by-name on import.
// =============================================================================
import React from "react";
import { Play, Terminal, X, Pencil, Upload, Download } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { confirmDialog } from "../Dialog";
import { useCustomTools, type CustomToolEntry } from "../hooks/useCustomTools";
import CheckboxToggle from "../CheckboxToggle";
import StatusIcon from "../StatusIcon";
import type { ToolProps } from "../toolRegistry";
import "../shared.scss";
import "./formTool.scss";

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Marker on the export file so Import can reject an unrelated .json instead
// of trying to merge garbage. Bump `version` if the entry shape ever changes.
const EXPORT_MARKER = "customTools";
const EXPORT_VERSION = 1;

const MyTools: React.FC<ToolProps> = ({ onSelectTool }) => {
    const { customTools, loaded, persist } = useCustomTools();
    const [status, setStatus] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
    const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

    const toggleSelected = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    // Counted against the live list (not selectedIds.size) so a lingering id
    // from a since-deleted tool can't inflate the count or enable Export.
    const selectedTools = customTools.filter((t) => selectedIds.has(t.id));
    const allSelected = customTools.length > 0 && selectedTools.length === customTools.length;
    const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(customTools.map((t) => t.id)));

    const run = async (t: CustomToolEntry) => {
        setStatus(null);
        try {
            const result = await evalTS("runScript", t.code);
            if (result === undefined) throw new Error("no bridge");
            setStatus({
                type: result.success ? "success" : "error",
                text: result.success ? `"${t.name}" ran: ${result.message || "(no output)"}` : `"${t.name}" failed: ${result.error || "Unknown error."}`,
            });
        } catch {
            setStatus({ type: "error", text: "No CEP bridge detected — open this panel inside After Effects to run tools." });
        }
    };

    const remove = async (t: CustomToolEntry) => {
        if (!(await confirmDialog(`Delete "${t.name}"? This can't be undone.`))) return;
        await persist(customTools.filter((x) => x.id !== t.id));
    };

    const handleExport = async () => {
        if (selectedTools.length === 0) return;
        setStatus(null);
        // Strip the machine-local `id` on the way out -- Import always mints a
        // fresh one, so ids from another machine would only ever risk colliding.
        const payload = {
            xyiToolbox: EXPORT_MARKER,
            version: EXPORT_VERSION,
            tools: selectedTools.map((t) => ({ name: t.name, description: t.description, code: t.code, kind: t.kind })),
        };
        try {
            const result = await evalTS("exportCustomToolsToFile", JSON.stringify(payload, null, 2));
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                setStatus({ type: "error", text: "Export failed: " + (result.error || "unknown error") });
            } else if (result.message) {
                const n = selectedTools.length;
                setStatus({ type: "success", text: `Exported ${n} tool${n === 1 ? "" : "s"} to ${result.message}` });
            }
            // result.message === "" means the save dialog was cancelled -- no status.
        } catch {
            setStatus({ type: "error", text: "No CEP bridge detected — open this panel inside After Effects to export." });
        }
    };

    const handleImport = async () => {
        setStatus(null);
        try {
            const result = await evalTS("importCustomToolsFromFile");
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                setStatus({ type: "error", text: "Import failed: " + (result.error || "unknown error") });
                return;
            }
            if (!result.message) return; // cancelled / empty file

            let parsed: any;
            try { parsed = JSON.parse(result.message); }
            catch { setStatus({ type: "error", text: "That file isn't valid JSON." }); return; }
            if (!parsed || parsed.xyiToolbox !== EXPORT_MARKER || !Array.isArray(parsed.tools)) {
                setStatus({ type: "error", text: "That doesn't look like an XYi tools export file." });
                return;
            }

            // Merge by name: an incoming tool whose name already exists here is
            // skipped rather than duplicated or silently overwriting a local
            // edit. New ones get a fresh local id.
            const seen: Record<string, true> = {};
            customTools.forEach((t) => { seen[t.name.toLowerCase()] = true; });
            const additions: CustomToolEntry[] = [];
            let skipped = 0;
            for (let i = 0; i < parsed.tools.length; i++) {
                const raw = parsed.tools[i];
                const name = raw && typeof raw.name === "string" ? raw.name.trim() : "";
                if (!name || typeof raw.code !== "string") { skipped++; continue; }
                if (seen[name.toLowerCase()]) { skipped++; continue; }
                seen[name.toLowerCase()] = true;
                additions.push({
                    id: genId(),
                    name,
                    description: typeof raw.description === "string" ? raw.description : "",
                    code: raw.code,
                    kind: raw.kind === "button" ? "button" : "page",
                });
            }

            if (additions.length === 0) {
                setStatus({
                    type: "success",
                    text: skipped > 0 ? `Nothing new — those ${skipped} tool${skipped === 1 ? "" : "s"} are already here.` : "That file had no tools.",
                });
                return;
            }
            await persist(customTools.concat(additions));
            setStatus({
                type: "success",
                text: `Imported ${additions.length} tool${additions.length === 1 ? "" : "s"}` + (skipped > 0 ? ` (skipped ${skipped} already present)` : "") + ".",
            });
        } catch {
            setStatus({ type: "error", text: "No CEP bridge detected — open this panel inside After Effects to import." });
        }
    };

    return (
        <div className="form-tool sp">
            <p className="hint">
                Every script you've saved as a tool. Toolset-button ones also run from the home screen's
                "Custom Tools" group. Tick tools and Export to share them with a colleague — they Import the
                file here to add them to their own panel.
            </p>

            {status && (
                <div className={`loc-status loc-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}

            {customTools.length > 0 && (
                <div className="mytools-actions">
                    <CheckboxToggle checked={allSelected} onChange={toggleAll} label="Select all" />
                    <div className="mytools-actions-spacer" />
                    <button disabled={selectedTools.length === 0} onClick={handleExport}>
                        <Upload size={13} /> Export{selectedTools.length > 0 ? ` (${selectedTools.length})` : ""}…
                    </button>
                    <button onClick={handleImport}>
                        <Download size={13} /> Import…
                    </button>
                </div>
            )}

            {customTools.length === 0 ? (
                <div>
                    <p className="hint">{loaded ? "No saved tools yet -- save one from Script Playground." : "Loading…"}</p>
                    {loaded && (
                        <div className="mytools-actions">
                            <button onClick={handleImport}>
                                <Download size={13} /> Import…
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="sp-tool-list">
                    {customTools.map((t) => (
                        <div key={t.id} className="sp-tool-row">
                            <CheckboxToggle
                                checked={selectedIds.has(t.id)}
                                onChange={() => toggleSelected(t.id)}
                                title="Select to share"
                                className="mytools-check"
                            />
                            <span className="sp-tool-icon"><Terminal size={13} /></span>
                            <div className="sp-tool-info">
                                <span className="sp-tool-name">{t.name}</span>
                                {t.description && <span className="sp-tool-desc">{t.description}</span>}
                            </div>
                            <span className={"sp-tool-kind sp-tool-kind-" + t.kind}>
                                {t.kind === "button" ? "Toolset button" : "My Tools"}
                            </span>
                            <button className="sp-tool-icon-btn" title="Run" onClick={() => run(t)}>
                                <Play size={12} />
                            </button>
                            <button
                                className="sp-tool-icon-btn"
                                title="Edit in Script Playground"
                                onClick={() => onSelectTool?.("script-playground")}
                            >
                                <Pencil size={12} />
                            </button>
                            <button className="sp-tool-icon-btn" title="Delete" onClick={() => remove(t)}>
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MyTools;
