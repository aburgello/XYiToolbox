import React, { useState } from "react";
import { FolderInput, FolderCog, Rabbit, ArrowRight, Image as ImageIcon } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { sfx } from "../../lib/utils/sfx";
import StatusIcon from "../StatusIcon";
import CheckboxToggle from "../CheckboxToggle";
import type { ToolProps } from "../toolRegistry";
import CSVLocaliserTool from "./CSVLocaliser";
import "../shared.scss";
import "./CampaignLocaliser.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

type Section = "generate" | "trott";

const SECTIONS: { id: Section; icon: React.ComponentType<{ size?: number }>; label: string; desc: string }[] = [
    { id: "generate", icon: FolderInput, label: "Generate Files",      desc: "Generate localised AE variants from the best-matching master AEP." },
    { id: "trott",    icon: Rabbit,      label: "Trotting",            desc: "Match PDFs to masters and mirror into an AE output folder." },
];

const CampaignLocaliserTool: React.FC<ToolProps> = (_props) => {
    const [section, setSection] = useState<Section>("generate");
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const [trotDuration, setTrotDuration] = useState("15");
    const [trotArtwork, setTrotArtwork] = useState("");
    const [trotUseArtworkName, setTrotUseArtworkName] = useState(false);
    const [trotCampaign, setTrotCampaign] = useState("");
    const [trotUseCampaignName, setTrotUseCampaignName] = useState(false);

    const run = async (action: string, fn: () => Promise<any>) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            setStatus(
                result.success
                    ? { text: result.message || `${action} finished — see the alert dialog(s) shown during the run for details.`, type: "success" }
                    : { text: result.error || "Something went wrong.", type: "error" }
            );
            result.success ? sfx.success() : sfx.error();
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
            sfx.error();
        } finally {
            setBusy(false);
        }
    };

    const handleSection = (s: Section) => {
        sfx.menu();
        setSection(s);
        setStatus(null);
    };

    return (
        <div className="campaign-localiser">
            <div className="cl-tabs">
                {SECTIONS.map(({ id, icon: Icon, label, desc }) => (
                    <button
                        key={id}
                        className={"cl-tab" + (section === id ? " cl-tab--active" : "")}
                        onClick={() => handleSection(id)}
                    >
                        <Icon size={16} />
                        <span className="cl-tab-label">{label}</span>
                    </button>
                ))}
            </div>

            <div className="cl-panel">
                {status && (
                    <div className={`loc-status loc-status-${status.type}`}>
                        <StatusIcon type={status.type} />
                        <span>{status.text}</span>
                    </div>
                )}

                {section === "generate" && (
                    <div className="cl-panel-inner">
                        <p className="hint">
                            Generate localised AE variants from the best-matching master AEP,
                            saved as <code>_V01.aep</code> in the localisation file&rsquo;s folder.
                        </p>
                        <div className="cl-trott-cards">
                            <div className="cl-trott-card">
                                <div className="cl-trott-card-title">Generate Files</div>
                                <p className="cl-trott-card-desc">
                                    Select a Masters folder and a localisation CSV file. Generates localised variants for each row. The &ldquo;don&rsquo;t replace&rdquo; option skips files that already exist.
                                </p>
                                <div className="cl-flow-row">
                                    <span className="cl-flow-badge">Masters</span>
                                    <ArrowRight size={14} />
                                    <span className="cl-flow-badge">CSV File</span>
                                </div>
                                <div className="cl-trott-card-spacer" />
                                <div className="cl-panel-buttons">
                                    <button disabled={busy} onClick={() => run("Generate Files", () => evalTS("campaignLocaliserGenerate", false))}>
                                        <FolderInput size={14} /> Generate Files
                                    </button>
                                    <button disabled={busy} onClick={() => run("Generate Files", () => evalTS("campaignLocaliserGenerate", true))}>
                                        <FolderCog size={14} /> Generate Files (don&rsquo;t replace)
                                    </button>
                                </div>
                            </div>
                            <div className="cl-trott-card">
                                <div className="cl-trott-card-title">CSV Localiser</div>
                                <p className="cl-trott-card-desc">
                                    Scan a campaign&rsquo;s Markets folder — reads every territory&rsquo;s Specs PDFs and
                                    localises against a folder of AEP masters. Paste-CSV still available as a fallback.
                                </p>
                                <CSVLocaliserTool />
                            </div>
                        </div>
                        <div className="cl-quick-row">
                            <button disabled={busy} onClick={() => run("MC It!", () => evalTS("mcIt"))}>
                                <ImageIcon size={14} /> MC It!
                            </button>
                        </div>
                    </div>
                )}

                {section === "trott" && (
                    <div className="cl-panel-inner">
                        <p className="hint">
                            Match PDFs in a folder tree (under a &ldquo;PDFs&rdquo; folder) to the closest master
                            by campaign/size/duration, and mirror the PDFs folder&rsquo;s structure into a sibling
                            &ldquo;AE&rdquo; output folder.
                        </p>
                        <div className="cl-trott-cards">
                            <div className="cl-trott-card">
                                <div className="cl-trott-card-title">Trott</div>
                                <p className="cl-trott-card-desc">
                                    Uses your manual fields as overrides. Uncheck a box to use the typed value; check it to auto-detect from the filename.
                                </p>
                                <div className="cl-flow-row">
                                    <span className="cl-flow-badge">Masters</span>
                                    <ArrowRight size={14} />
                                    <span className="cl-flow-badge">PDFs</span>
                                </div>
                                <div className="loc-field-row">
                                    <label>Enter Duration Below</label>
                                    <input type="text" value={trotDuration} onChange={(e) => setTrotDuration(e.target.value)} disabled={busy} />
                                </div>
                                <div className="loc-field-row">
                                    <label>Enter DOOH / DINTH</label>
                                    <input type="text" placeholder="Enter DOOH / DINTH" value={trotArtwork} onChange={(e) => setTrotArtwork(e.target.value)} disabled={busy} />
                                </div>
                                <CheckboxToggle className="loc-checkbox-row" checked={trotUseArtworkName} onChange={setTrotUseArtworkName} label="Use DOOH / DINTH name" />
                                <div className="loc-field-row">
                                    <label>Enter Toolkit Name Below</label>
                                    <input type="text" placeholder="Enter Campaign Name" value={trotCampaign} onChange={(e) => setTrotCampaign(e.target.value)} disabled={busy} />
                                </div>
                                <CheckboxToggle className="loc-checkbox-row" checked={trotUseCampaignName} onChange={setTrotUseCampaignName} label="Use Campaign Name" />
                                <button className="cl-trott-card-btn" disabled={busy} onClick={() => run("Trott!", () => evalTS("campaignLocaliserTrott", trotDuration, trotArtwork, trotUseArtworkName, trotCampaign, trotUseCampaignName))}>
                                    <Rabbit size={16} /> Run Trott
                                </button>
                            </div>
                            <div className="cl-trott-card">
                                <div className="cl-trott-card-title">Trott 2.0</div>
                                <p className="cl-trott-card-desc">
                                    Fully automatic — Jaccard-matches PDFs to masters using filename analysis.
                                </p>
                                <div className="cl-flow-row">
                                    <span className="cl-flow-badge">Masters</span>
                                    <ArrowRight size={14} />
                                    <span className="cl-flow-badge">PDFs</span>
                                </div>
                                <div className="cl-trott-card-spacer" />
                                <button className="cl-trott-card-btn" disabled={busy} onClick={() => run("Trott 2.0", () => evalTS("campaignLocaliserTrott2", trotDuration, trotArtwork, trotUseArtworkName, trotCampaign, trotUseCampaignName))}>
                                    <Rabbit size={16} /> Run Trott 2.0
                                </button>
                            </div>
                        </div>
                        <div className="cl-quick-row">
                            <button disabled={busy} onClick={() => run("MC It!", () => evalTS("mcIt"))}>
                                <ImageIcon size={14} /> MC It!
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CampaignLocaliserTool;
