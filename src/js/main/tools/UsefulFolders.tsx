// =============================================================================
// src/js/main/tools/UsefulFolders.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Useful Folders" tab. A user-curatable list
// of folder shortcuts, persisted via app.settings ("XYiToolbox" /
// "UsefulFolders") -- the SAME section/key the still-live ScriptUI tab
// uses, so shortcuts added in either show up in both. Click a row to
// reveal it in Explorer/Finder.
// =============================================================================
import React, { useEffect, useState } from "react";
import { FolderOpen, Pencil, X, FolderPlus, AlertCircle } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { confirmDialog, promptDialog } from "../Dialog";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";
import "./UsefulFolders.scss";

interface UsefulFolder {
    label: string;
    path: string;
}

const UsefulFoldersTool = () => {
    const [folders, setFolders] = useState<UsefulFolder[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reload = async () => {
        try {
            const result = await evalTS("loadUsefulFolders");
            if (result === undefined) throw new Error("no bridge");
            setFolders(result);
        } catch (e) {
            setError("No CEP bridge detected — open this panel inside After Effects to use this.");
            setFolders([]);
        }
    };

    useEffect(() => {
        reload();
    }, []);

    const openFolder = async (path: string) => {
        const result = await evalTS("revealUsefulFolder", path);
        if (result && !result.success) setError(result.error || "Something went wrong.");
    };

    const addFolder = async () => {
        const path = await evalTS("selectUsefulFolder");
        if (!path) return;
        const defaultLabel = path.split(/[\\/]/).pop() || path;
        const label = await promptDialog("Name this shortcut:", defaultLabel);
        if (label === null) return;
        await evalTS("addUsefulFolder", label || defaultLabel, path);
        reload();
    };

    const renameFolder = async (index: number, current: string) => {
        const newLabel = await promptDialog("Rename this shortcut:", current);
        if (newLabel === null || newLabel === "") return;
        await evalTS("renameUsefulFolder", index, newLabel);
        reload();
    };

    const removeFolder = async (index: number, label: string) => {
        if (!(await confirmDialog(`Remove "${label}" from Useful Folders?`))) return;
        await evalTS("removeUsefulFolder", index);
        reload();
    };

    return (
        <div className="form-tool useful-folders">
            <h2>Useful Folders</h2>
            <p className="hint">Click a folder to open it in Explorer/Finder. Edit the list per campaign — it's remembered between sessions.</p>

            {error && (
                <div className="tool-status tool-status-error">
                    <AlertCircle size={14} />
                    <span>{error}</span>
                </div>
            )}

            <div className="uf-list">
                {folders === null ? (
                    <p className="hint">Loading…</p>
                ) : folders.length === 0 ? (
                    <p className="hint">No folders yet — click "Add Folder..." below.</p>
                ) : (
                    folders.map((f, i) => (
                        <div className="uf-row" key={i}>
                            <Tooltip text={f.path}>
                                <button className="uf-open" onClick={() => openFolder(f.path)}>
                                    <FolderOpen size={14} /> {f.label}
                                </button>
                            </Tooltip>
                            <Tooltip text="Rename">
                                <button className="uf-icon-btn" onClick={() => renameFolder(i, f.label)}>
                                    <Pencil size={12} />
                                </button>
                            </Tooltip>
                            <Tooltip text="Remove">
                                <button className="uf-icon-btn" onClick={() => removeFolder(i, f.label)}>
                                    <X size={12} />
                                </button>
                            </Tooltip>
                        </div>
                    ))
                )}
            </div>

            <div className="button-row" style={{ marginTop: 10 }}>
                <button onClick={addFolder}>
                    <FolderPlus size={14} /> Add Folder...
                </button>
            </div>
        </div>
    );
};

export default UsefulFoldersTool;
