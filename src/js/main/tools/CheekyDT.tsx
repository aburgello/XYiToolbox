// =============================================================================
// src/js/main/tools/CheekyDT.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Cheeky DT" tab. The general-purpose version
// of Cheeky T Check -- lets you choose which fields to update on the active
// Frontcard from its filename, plus an independent territory-code lookup.
// Reuses cheekyDTCheck()/getTerritoryCountryCode() directly (already
// ported for Cheeky T Check / the territory badge) rather than duplicating
// that logic -- see aeft.ts's comments on both.
// =============================================================================
import React, { useState } from "react";
import { CheckSquare, Globe2 } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import CheckboxToggle from "../CheckboxToggle";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const FIELDS = [
    { key: "title", label: "Title" },
    { key: "artwork", label: "Artwork" },
    { key: "version", label: "Version" },
    { key: "campaign", label: "Campaign" },
    { key: "duration", label: "Duration" },
    { key: "territory", label: "Territory" },
    { key: "date", label: "Date" },
] as const;

const CheekyDTTool = () => {
    const [fields, setFields] = useState<Record<string, boolean>>({ title: true, artwork: true, version: true, campaign: true, duration: true, territory: true, date: true });
    const [territoryEntry, setTerritoryEntry] = useState("OV");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, fn: () => Promise<any>) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success ? { text: typeof result === "string" ? result : "Complete.", type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const runCheekyDT = () =>
        run("Cheeky DT", () => evalTS("cheekyDTCheck", fields.title, fields.artwork, fields.version, fields.campaign, fields.duration, fields.territory, fields.date));

    const runTerritoryCheck = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const code = await evalTS("getTerritoryCountryCode", territoryEntry);
            if (code === undefined) throw new Error("no bridge");
            setStatus({ text: code || "No matching territory found.", type: code ? "success" : "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">

            <div className="radio-row" style={{ flexDirection: "column", gap: 8 }}>
                {FIELDS.map((f) => (
                    <CheckboxToggle
                        key={f.key}
                        checked={fields[f.key]}
                        onChange={(v) => setFields((prev) => ({ ...prev, [f.key]: v }))}
                        label={f.label}
                    />
                ))}
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={runCheekyDT}>
                    <CheckSquare size={14} /> Cheeky DT
                </button>
            </div>

            <hr className="divider" />

            <div className="field-with-button">
                <div className="field-row">
                    <label htmlFor="cdt-territory">Territory Entry</label>
                    <input id="cdt-territory" type="text" value={territoryEntry} onChange={(e) => setTerritoryEntry(e.target.value)} />
                </div>
                <Tooltip text="Territory Check">
                    <button className="icon-btn" disabled={busy} onClick={runTerritoryCheck}>
                        <Globe2 size={14} />
                    </button>
                </Tooltip>
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

export default CheekyDTTool;
