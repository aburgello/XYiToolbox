// =============================================================================
// src/js/main/tools/ProjectButtons.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Project Buttons" tab. Shape to Masks,
// C4D Line Art, Optimal Placement, Detail-Preserving Scale, and Midcarder
// are all real. Midcarder is a studio-confirmed exception (opens the
// active project, which may be a master, but only ever save-as's to a new
// territory file and re-opens the original -- never writes it); see
// midcarder()'s comment in aeft.ts.
// =============================================================================
import React, { useState } from "react";
import { Shapes, Boxes, Move3d, Sparkle, IdCard } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const ProjectButtonsTool = () => {
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, fn: () => Promise<any>) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: result.message || `${label} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Shape to Masks", () => evalTS("shapeToMasks"))}>
                    <Shapes size={14} /> Shape to Masks
                </button>
                <button disabled={busy} onClick={() => run("C4D Line Art", () => evalTS("c4dLineArt"))}>
                    <Boxes size={14} /> C4D Line Art
                </button>
                <button disabled={busy} onClick={() => run("Optimal Placement", () => evalTS("optimalPlacement"))}>
                    <Move3d size={14} /> Optimal Placement
                </button>
                <button disabled={busy} onClick={() => run("Detail-Preserving Scale", () => evalTS("detailPreservingScale"))}>
                    <Sparkle size={14} /> Detail-Preserving Scale
                </button>
                <button disabled={busy} onClick={() => run("Midcarder", () => evalTS("midcarder"))}>
                    <IdCard size={14} /> Midcarder
                </button>
            </div>
            <p className="hint">
                Midcarder batch-localises a project's Midcard/Endcard text layers from a CSV, saving each territory to its own file. Run it with
                the localisation file ready; it works on the currently open project.
            </p>

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span style={{ whiteSpace: "pre-wrap" }}>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default ProjectButtonsTool;
