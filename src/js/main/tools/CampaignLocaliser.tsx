import React, { useState } from "react";
import { FolderInput, FolderCog, Rabbit, ArrowRight, Image as ImageIcon } from "lucide-react";
import { showMcItReport, type McReport } from "../McItReportModal";
import { showLocGenReport, type LocGenReport } from "../LocGenReportModal";
import { evalTS } from "../../lib/utils/bolt";
import { sfx } from "../../lib/utils/sfx";
import StatusIcon from "../StatusIcon";
import SegmentedToggle from "../SegmentedToggle";
import type { ToolProps } from "../toolRegistry";
import CSVLocaliserTool from "./CSVLocaliser";
import "../shared.scss";
import "./CampaignLocaliser.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

type Section = "generate" | "trott";

// NOTE: Generate Files / Trott / Trott 2.0 deliberately remember NOTHING and
// pop their folder dialogs every run. A previous pass added remembered paths
// here and it was wrong: these folders arrive via native dialogs, so silent
// reuse is invisible -- clicking Run and having it proceed against last time's
// folders is worse than one extra dialog. CSV Localiser is the exception that
// proves the rule: its campaign is an explicit, visible, one-click selection,
// so restoring it is legible. Don't add path memory back here.

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

    // MC It! gets its own runner: it previews first (dry run — identical
    // matching, nothing replaced or saved), then the app-root modal
    // (McItReportHost in main.tsx) offers "Apply" to do it for real using the
    // same folders. Empty-string args = "prompt/derive the folders host-side".
    const runMcIt = async () => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("mcIt", "", "", true);
            if (result === undefined) throw new Error("no bridge");
            if (result.success) {
                showMcItReport(result as McReport);
                sfx.success();
            } else {
                setStatus({ text: result.error || "Something went wrong.", type: "error" });
                sfx.error();
            }
        } catch (e) {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
            sfx.error();
        } finally {
            setBusy(false);
        }
    };

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

    // Generate Files / Trott / Trott 2.0 now return a structured per-row
    // report — on success show the app-root results modal (LocGenReportHost)
    // instead of the one-line status text. A run with no rows (folder cancel)
    // just falls through to the status line.
    const runLocGen = async (action: string, fn: () => Promise<any>) => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await fn();
            if (result === undefined) throw new Error("no bridge");
            if (result.success && (result as LocGenReport).rows) {
                showLocGenReport(result as LocGenReport);
                sfx.success();
            } else {
                setStatus({ text: result.success ? result.message || `${action} finished.` : result.error || "Something went wrong.", type: result.success ? "success" : "error" });
                result.success ? sfx.success() : sfx.error();
            }
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
                                    <button disabled={busy} onClick={() => runLocGen("Generate Files", () => evalTS("campaignLocaliserGenerate", false))}>
                                        <FolderInput size={14} /> Generate Files
                                    </button>
                                    <button disabled={busy} onClick={() => runLocGen("Generate Files", () => evalTS("campaignLocaliserGenerate", true))}>
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
                            <button disabled={busy} onClick={runMcIt}>
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
                                    Semi-automatic — set each field to auto-detect from the PDF filename, or type it in yourself.
                                </p>
                                <div className="cl-flow-row">
                                    <span className="cl-flow-badge">Masters</span>
                                    <ArrowRight size={14} />
                                    <span className="cl-flow-badge">PDFs</span>
                                </div>
                                <div className="loc-field-row">
                                    <label>Duration (sec)</label>
                                    <input type="text" value={trotDuration} onChange={(e) => setTrotDuration(e.target.value)} disabled={busy} />
                                </div>
                                {/* Auto-detect | Manual toggles replace the old inverted
                                    checkboxes ("Use X name" CHECKED meant "ignore my typed
                                    value") -- same booleans go to the backend, the choice
                                    just reads the right way round now. */}
                                <div className="loc-field-row">
                                    <label>DOOH / DINTH</label>
                                    <SegmentedToggle
                                        name="trott-artwork"
                                        value={trotUseArtworkName ? "auto" : "manual"}
                                        onChange={(v) => setTrotUseArtworkName(v === "auto")}
                                        options={[{ value: "auto", label: "Auto-detect" }, { value: "manual", label: "Manual" }]}
                                    />
                                    <input type="text" placeholder={trotUseArtworkName ? "Detected from each PDF's filename" : "Enter DOOH / DINTH"} value={trotArtwork} onChange={(e) => setTrotArtwork(e.target.value)} disabled={busy || trotUseArtworkName} />
                                </div>
                                <div className="loc-field-row">
                                    <label>Campaign / Toolkit Name</label>
                                    <SegmentedToggle
                                        name="trott-campaign"
                                        value={trotUseCampaignName ? "auto" : "manual"}
                                        onChange={(v) => setTrotUseCampaignName(v === "auto")}
                                        options={[{ value: "auto", label: "Auto-detect" }, { value: "manual", label: "Manual" }]}
                                    />
                                    <input type="text" placeholder={trotUseCampaignName ? "Detected from each PDF's filename" : "Enter Campaign Name"} value={trotCampaign} onChange={(e) => setTrotCampaign(e.target.value)} disabled={busy || trotUseCampaignName} />
                                </div>
                                <button className="cl-trott-card-btn" disabled={busy} onClick={() => runLocGen("Trott!", () => evalTS("campaignLocaliserTrott", trotDuration, trotArtwork, trotUseArtworkName, trotCampaign, trotUseCampaignName))}>
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
                                <button className="cl-trott-card-btn" disabled={busy} onClick={() => runLocGen("Trott 2.0", () => evalTS("campaignLocaliserTrott2", trotDuration, trotArtwork, trotUseArtworkName, trotCampaign, trotUseCampaignName))}>
                                    <Rabbit size={16} /> Run Trott 2.0
                                </button>
                            </div>
                        </div>
                        <div className="cl-quick-row">
                            <button disabled={busy} onClick={runMcIt}>
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
