// =============================================================================
// src/js/main/tools/NameGenerator.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Name Generator" tab. Builds a standard
// comp/filename from form fields (Generate Name), or reverse-parses one of
// those names back into the fields (Detect Name). Pure metadata rename of
// the selected project item(s) -- never touches a file on disk.
// =============================================================================
import React, { useState } from "react";
import { Wand2, ScanSearch, RotateCcw } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import SegmentedToggle from "../SegmentedToggle";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const NameGeneratorTool = () => {
    const [filmTitle, setFilmTitle] = useState("");
    const [isInternational, setIsInternational] = useState(true);
    const [artworkType, setArtworkType] = useState("");
    const [campaign, setCampaign] = useState("");
    const [territory, setTerritory] = useState("");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (label: string, fn: () => Promise<any>, onResult?: (r: any) => void) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            if (result.success && onResult) onResult(result);
            setStatus(result.success ? { text: result.newName || result.message || `${label} complete.`, type: "success" } : { text: result.error || "Something went wrong.", type: "error" });
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const reset = () => {
        setFilmTitle("");
        setArtworkType("");
        setCampaign("");
        setTerritory("");
        setStatus(null);
    };

    return (
        <div className="form-tool">

            <div className="field-row">
                <label htmlFor="ng-film-title">Film Title</label>
                <input id="ng-film-title" type="text" value={filmTitle} onChange={(e) => setFilmTitle(e.target.value)} placeholder="Enter film title..." />
            </div>

            <SegmentedToggle
                name="ng-scope"
                value={isInternational ? "intl" : "dom"}
                onChange={(v) => setIsInternational(v === "intl")}
                options={[
                    { value: "intl", label: "International" },
                    { value: "dom", label: "Domestic" },
                ]}
            />

            <div className="field-row">
                <label htmlFor="ng-artwork">Artwork Type</label>
                <input id="ng-artwork" type="text" value={artworkType} onChange={(e) => setArtworkType(e.target.value)} placeholder="Enter artwork type..." />
            </div>

            <div className="field-row">
                <label htmlFor="ng-campaign">Campaign</label>
                <input id="ng-campaign" type="text" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Enter campaign..." />
            </div>

            <div className="field-row">
                <label htmlFor="ng-territory">2 Digit Territory / Version</label>
                <input id="ng-territory" type="text" value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder="Enter 2 digit territory..." />
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={() => run("Generate Name", () => evalTS("nameGeneratorGenerate", filmTitle, isInternational, artworkType, campaign, territory))}>
                    <Wand2 size={14} /> Generate Name
                </button>
                <button
                    disabled={busy}
                    onClick={() =>
                        run("Detect Name", () => evalTS("nameGeneratorDetect"), (r) => {
                            setFilmTitle(r.filmTitle || "");
                            setArtworkType(r.artworkType || "");
                            setCampaign(r.campaign || "");
                            setTerritory(r.territory || "");
                            setIsInternational(!!r.isInternational);
                        })
                    }
                >
                    <ScanSearch size={14} /> Detect Name
                </button>
                <button disabled={busy} onClick={reset}>
                    <RotateCcw size={14} /> Reset
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

export default NameGeneratorTool;
