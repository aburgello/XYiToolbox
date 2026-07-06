import React, { useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
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

const ScriptPlayground: React.FC = () => {
    const [code, setCode] = useState(DEFAULT_SCRIPT);
    const [output, setOutput] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

    return (
        <div className="form-tool sp">

            <div className="sp-editor">
                <textarea
                    className="sp-textarea"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
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
            </div>

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
        </div>
    );
};

export default ScriptPlayground;