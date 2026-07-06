// =============================================================================
// src/js/main/tools/LOSTools.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "LOS Tools" tab, backed by XYi_LOSCsv.jsx's
// applyCSVToProjects() -- already safety-patched at the source-file level
// (copy-first before any app.open()), so this page just wires up the
// already-safe logic. Replaces a named target layer across every .aep in a
// folder, working on a versioned COPY of each project, never the original.
// =============================================================================
import React, { useState } from "react";
import { FolderSearch, Repeat } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const LOSToolsTool = () => {
    const [targetLayer, setTargetLayer] = useState("");
    const [csvFolder, setCsvFolder] = useState("");
    const [aepFolder, setAepFolder] = useState("");
    const [componentsFolder, setComponentsFolder] = useState("");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const pick = async (fnName: string, setter: (v: string) => void) => {
        try {
            const path = await evalTS(fnName as any);
            if (path === undefined) throw new Error("no bridge");
            if (path) setter(path);
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to use this.", type: "error" });
        }
    };

    const run = async () => {
        if (!targetLayer || !csvFolder || !aepFolder || !componentsFolder) {
            setStatus({ text: "Fill in the target layer name and all three folders first.", type: "error" });
            return;
        }
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("losApplyCsvToProjects", targetLayer, csvFolder, aepFolder, componentsFolder);
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: "Complete. Any per-project issues were shown as their own alert during the run.", type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="field-row">
                <label htmlFor="los-target">Target Layer Name</label>
                <input id="los-target" type="text" value={targetLayer} onChange={(e) => setTargetLayer(e.target.value)} placeholder="Enter the layer name to replace" />
            </div>

            <div className="field-with-button">
                <div className="field-row">
                    <label>CSV Folder</label>
                    <input type="text" readOnly value={csvFolder} placeholder="Not selected" />
                </div>
                <Tooltip text="Select CSV folder">
                    <button className="icon-btn" disabled={busy} onClick={() => pick("selectLosCsvFolder", setCsvFolder)}>
                        <FolderSearch size={14} />
                    </button>
                </Tooltip>
            </div>

            <div className="field-with-button">
                <div className="field-row">
                    <label>AEP Folder</label>
                    <input type="text" readOnly value={aepFolder} placeholder="Not selected" />
                </div>
                <Tooltip text="Select AEP folder">
                    <button className="icon-btn" disabled={busy} onClick={() => pick("selectLosAepFolder", setAepFolder)}>
                        <FolderSearch size={14} />
                    </button>
                </Tooltip>
            </div>

            <div className="field-with-button">
                <div className="field-row">
                    <label>Components Folder</label>
                    <input type="text" readOnly value={componentsFolder} placeholder="Not selected" />
                </div>
                <Tooltip text="Select Components folder">
                    <button className="icon-btn" disabled={busy} onClick={() => pick("selectLosComponentsFolder", setComponentsFolder)}>
                        <FolderSearch size={14} />
                    </button>
                </Tooltip>
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={run}>
                    <Repeat size={14} /> Apply CSV to Projects
                </button>
            </div>

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default LOSToolsTool;
