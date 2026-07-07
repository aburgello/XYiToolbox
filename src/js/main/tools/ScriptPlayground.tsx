import React, { useState } from "react";
import { Play, Trash2, Save, Pencil, X, Terminal, LayoutList, MousePointerClick, Check } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import { confirmDialog } from "../Dialog";
import { useCustomTools, type CustomToolEntry } from "../hooks/useCustomTools";
import "../shared.scss";
import "./formTool.scss";

const DEFAULT_SCRIPT = `// ExtendScript Playground
// app.project, app.beginUndoGroup(), etc. are all available.

var comp = app.project.activeItem;
if (comp instanceof CompItem) {
  "Active comp: " + comp.name + " (" + comp.width + "x" + comp.height + ")";
} else {
  "No active comp selected.";
}`;

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const ScriptPlayground: React.FC = () => {
    const [code, setCode] = useState(DEFAULT_SCRIPT);
    const [output, setOutput] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // Save-as-tool: a script saved here either becomes a one-click Toolset
    // grid button (Toolset.tsx auto-adds every "button"-kind entry to its
    // own "Custom Tools" group) or a "page" entry that just lives in the
    // "My Tools" list below -- there's no separate nav page for those, this
    // list IS their home, which is also why Script Playground itself lives
    // under Tools > Scripting (this doubles as the "submenu in tools").
    const { customTools, persist: persistCustomTools } = useCustomTools();
    const [saving, setSaving] = useState(false);
    const [saveName, setSaveName] = useState("");
    const [saveDescription, setSaveDescription] = useState("");
    const [saveKind, setSaveKind] = useState<"button" | "page">("button");
    // Which My Tools entry (if any) this editor's current code was loaded
    // from -- lets "Save as Tool" update that same entry in place instead of
    // always creating a new one when you're iterating on a saved script.
    const [editingToolId, setEditingToolId] = useState<string | null>(null);

    const run = async () => {
        setBusy(true);
        setStatus(null);
        setOutput(null);
        try {
            const result = await evalTS("runScript", code);
            if (result === undefined) throw new Error("no bridge");
            if (result.success) {
                setOutput(result.message || "(no output)");
                setStatus({ type: "success", text: "Script executed." });
            } else {
                setOutput(result.error || "Unknown error.");
                setStatus({ type: "error", text: "Script failed." });
            }
        } catch (e) {
            setOutput("No CEP bridge detected — open this panel inside After Effects to run scripts.");
            setStatus({ type: "error", text: "No bridge." });
        } finally {
            setBusy(false);
        }
    };

    const clear = () => {
        setOutput(null);
        setStatus(null);
    };

    const openSaveForm = () => {
        setSaveName(editingToolId ? (customTools.find((t) => t.id === editingToolId)?.name || "") : "");
        setSaveDescription(editingToolId ? (customTools.find((t) => t.id === editingToolId)?.description || "") : "");
        setSaveKind(editingToolId ? (customTools.find((t) => t.id === editingToolId)?.kind || "button") : "button");
        setSaving(true);
    };

    const cancelSave = () => setSaving(false);

    const confirmSave = async () => {
        if (!saveName.trim()) {
            setStatus({ type: "error", text: "Name is required to save a tool." });
            return;
        }
        const entry: CustomToolEntry = {
            id: editingToolId || genId(),
            name: saveName.trim(),
            description: saveDescription.trim(),
            code,
            kind: saveKind,
        };
        const next = editingToolId
            ? customTools.map((t) => (t.id === editingToolId ? entry : t))
            : [...customTools, entry];
        await persistCustomTools(next);
        setEditingToolId(entry.id);
        setSaving(false);
        setStatus({
            type: "success",
            text: `Saved "${entry.name}" as a ${saveKind === "button" ? "one-click Toolset button" : "My Tools entry"}.`,
        });
    };

    const loadTool = (t: CustomToolEntry) => {
        setCode(t.code);
        setEditingToolId(t.id);
        setOutput(null);
        setStatus({ type: "success", text: `Loaded "${t.name}" into the editor.` });
    };

    const deleteTool = async (t: CustomToolEntry) => {
        if (!(await confirmDialog(`Delete "${t.name}"? This can't be undone.`))) return;
        await persistCustomTools(customTools.filter((x) => x.id !== t.id));
        if (editingToolId === t.id) setEditingToolId(null);
    };

    const runSavedTool = async (t: CustomToolEntry) => {
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

    return (
        <div className="form-tool sp">

            <div className="sp-editor">
                <textarea
                    className="sp-textarea"
                    value={code}
                    onChange={(e) => { setCode(e.target.value); setEditingToolId(null); }}
                    spellCheck={false}
                    placeholder="// Write ExtendScript here…"
                    rows={10}
                    disabled={busy}
                />
            </div>

            <div className="button-row sp-buttons">
                <button disabled={busy} onClick={run}>
                    <Play size={14} /> Run Script
                </button>
                <button disabled={busy} onClick={clear} className="sp-clear-btn">
                    <Trash2 size={14} /> Clear Output
                </button>
                <button disabled={busy} onClick={openSaveForm} className="sp-save-btn">
                    <Save size={14} /> {editingToolId ? "Update Tool…" : "Save as Tool…"}
                </button>
            </div>

            {saving && (
                <div className="sp-save-form">
                    <div className="field-row">
                        <label>Name</label>
                        <input
                            type="text"
                            value={saveName}
                            onChange={(e) => setSaveName(e.target.value)}
                            placeholder="e.g. Rename Layers to Sequence"
                            autoFocus
                        />
                    </div>
                    <div className="field-row">
                        <label>Description (optional)</label>
                        <input
                            type="text"
                            value={saveDescription}
                            onChange={(e) => setSaveDescription(e.target.value)}
                            placeholder="What this does -- shown as a hint"
                        />
                    </div>
                    <div className="kind-picker">
                        <button
                            type="button"
                            className={saveKind === "button" ? "kind-option selected" : "kind-option"}
                            onClick={() => setSaveKind("button")}
                        >
                            <span className="kind-option-check">{saveKind === "button" && <Check size={11} />}</span>
                            <span className="kind-option-icon"><MousePointerClick size={16} /></span>
                            <span className="kind-option-text">
                                <strong>Toolset button</strong>
                                <small>One-click, appears in the home grid</small>
                            </span>
                        </button>
                        <button
                            type="button"
                            className={saveKind === "page" ? "kind-option selected" : "kind-option"}
                            onClick={() => setSaveKind("page")}
                        >
                            <span className="kind-option-check">{saveKind === "page" && <Check size={11} />}</span>
                            <span className="kind-option-icon"><LayoutList size={16} /></span>
                            <span className="kind-option-text">
                                <strong>My Tools entry</strong>
                                <small>Listed under Tools → Scripting</small>
                            </span>
                        </button>
                    </div>
                    <div className="button-row">
                        <button onClick={confirmSave}><Save size={14} /> Save</button>
                        <button onClick={cancelSave} className="sp-clear-btn">Cancel</button>
                    </div>
                </div>
            )}

            {status && (
                <div className={`loc-status loc-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}

            {output !== null && (
                <div className="sp-output-wrap">
                    <div className="sp-output-label">Output</div>
                    <pre className="sp-output">{output}</pre>
                </div>
            )}

            {customTools.length > 0 && (
                <>
                    <h3><LayoutList size={12} /> My Tools</h3>
                    <div className="sp-tool-list">
                        {customTools.map((t) => (
                            <div key={t.id} className="sp-tool-row">
                                <span className="sp-tool-icon"><Terminal size={13} /></span>
                                <div className="sp-tool-info">
                                    <span className="sp-tool-name">{t.name}</span>
                                    {t.description && <span className="sp-tool-desc">{t.description}</span>}
                                </div>
                                <span className={"sp-tool-kind sp-tool-kind-" + t.kind}>
                                    {t.kind === "button" ? "Button" : "My Tools"}
                                </span>
                                <button className="sp-tool-icon-btn" title="Run" onClick={() => runSavedTool(t)}>
                                    <Play size={12} />
                                </button>
                                <button className="sp-tool-icon-btn" title="Load into editor" onClick={() => loadTool(t)}>
                                    <Pencil size={12} />
                                </button>
                                <button className="sp-tool-icon-btn" title="Delete" onClick={() => deleteTool(t)}>
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default ScriptPlayground;