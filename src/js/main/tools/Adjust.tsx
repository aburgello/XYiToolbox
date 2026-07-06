// =============================================================================
// src/js/main/tools/Adjust.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Adjust" tab, backed by XYi_Adj.jsx. Unlike
// Scale Composition, each field here changes ONE property directly with no
// null-parent layer scaling -- e.g. adjusting width alone will visually
// stretch layer content rather than scale it proportionally. That's the
// original tool's actual behavior, not a bug introduced in porting.
// =============================================================================
import React, { useState } from "react";
import { MoveHorizontal, MoveVertical, Clock, Gauge, RectangleHorizontal } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

interface FieldDef {
    id: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
    action: string;
    fnName: string;
}

const FIELDS: FieldDef[] = [
    { id: "width", label: "Width", icon: MoveHorizontal, action: "Adjust Width", fnName: "adjustWidth" },
    { id: "height", label: "Height", icon: MoveVertical, action: "Adjust Height", fnName: "adjustHeight" },
    { id: "duration", label: "Duration", icon: Clock, action: "Adjust Duration", fnName: "adjustDuration" },
    { id: "frameRate", label: "Frame Rate", icon: Gauge, action: "Adjust Frame Rate", fnName: "adjustFrameRate" },
    { id: "aspectRatio", label: "Aspect Ratio", icon: RectangleHorizontal, action: "Adjust Aspect Ratio", fnName: "adjustAspectRatio" },
];

const AdjustTool = () => {
    const [values, setValues] = useState<Record<string, string>>({});
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (field: FieldDef) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS(field.fnName as any, parseFloat(values[field.id] || "0"));
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: `${field.action} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            {FIELDS.map((field) => {
                const Icon = field.icon;
                return (
                    <div className="field-with-button" key={field.id}>
                        <div className="field-row">
                            <label htmlFor={`adj-${field.id}`}>{field.label}</label>
                            <input
                                id={`adj-${field.id}`}
                                type="text"
                                value={values[field.id] || ""}
                                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                            />
                        </div>
                        <Tooltip text={field.action}>
                            <button className="icon-btn" disabled={busy} onClick={() => run(field)}>
                                <Icon size={14} />
                            </button>
                        </Tooltip>
                    </div>
                );
            })}

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default AdjustTool;
