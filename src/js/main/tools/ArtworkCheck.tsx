// =============================================================================
// src/js/main/tools/ArtworkCheck.tsx
// -----------------------------------------------------------------------------
// "Which tiff am I supposed to be using here?"
//
// The mech pipeline writes a CSV beside every deliverable's JPG/PNG naming the
// art edit that went into it. Nothing read it, so a comp built from the wrong
// edit looked fine until somebody noticed by eye, mid-localise, with the render
// already made.
//
// READS, NEVER SWAPS. It says what the sheet asks for, whether that file is in
// the project, and offers to import the right one. Putting it into the comp is
// a judgement about layer order, masking and scale that belongs to the artist;
// fetching the correct file is the tedious half and the half that goes wrong.
// =============================================================================
import React, { useState } from "react";
import { FileSearch, Download, FolderOpen, RefreshCw } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";
import "./ArtworkCheck.scss";

interface Row { type: string; name: string; filePath: string; inProject: boolean }
interface CheckResult {
    success: boolean;
    error?: string;
    deliverable?: string;
    territory?: string;
    csvPath?: string;
    rows?: Row[];
    creative?: string;
    tiffFolder?: string;
    tiffs?: { name: string; path: string }[];
    unexpected?: string[];
    verdict?: "match" | "mismatch" | "no-reference";
}

const ArtworkCheckTool = () => {
    const [res, setRes] = useState<CheckResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [showAll, setShowAll] = useState(false);

    const check = async () => {
        setBusy(true);
        setStatus(null);
        try {
            const r = (await evalTS("artworkCheck")) as unknown as CheckResult | undefined;
            if (r === undefined) throw new Error("no bridge");
            setRes(r);
            if (!r.success) setStatus({ text: r.error || "Couldn't check this one.", type: "error" });
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const importTiff = async (path: string, name: string) => {
        setBusy(true);
        try {
            const r = (await evalTS("artworkImportTiff", path)) as unknown as { success: boolean; error?: string };
            setStatus(r && r.success
                ? { text: `Imported ${name}. Put it into the comp yourself — layer order and masking are yours.`, type: "success" }
                : { text: (r && r.error) || "Couldn't import that.", type: "error" });
            if (r && r.success) await check();
        } catch {
            setStatus({ text: "No CEP bridge detected.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const art = (res?.rows || []).filter((r) => r.type.toUpperCase() === "ART");
    const other = (res?.rows || []).filter((r) => r.type.toUpperCase() !== "ART");
    // Everything the creative has, minus what the sheet already asks for --
    // the "or check all the TIFFs in that folder" half.
    const expected = (res?.rows || []).map((r) => r.name.toLowerCase());
    const alternatives = (res?.tiffs || []).filter((t) => expected.indexOf(t.name.toLowerCase()) === -1);

    return (
        <div className="form-tool artwork-check">
            <div className="button-row">
                <button disabled={busy} onClick={check}>
                    {busy ? <RefreshCw size={14} /> : <FileSearch size={14} />} Check this deliverable
                </button>
            </div>

            {res && res.success && (
                <div className="ac-result">
                    <p className="ac-head">
                        <strong>{res.deliverable}</strong>
                        <span>{res.territory}{res.creative ? " · " + res.creative : ""}</span>
                    </p>

                    {res.verdict === "no-reference" && (
                        <div className="ac-note">
                            No reference sheet for this deliverable in {res.territory}'s JPG_PNG.
                            {/* The likeliest cause by far, said rather than left
                                to be worked out: the mech was built for a name
                                this comp no longer has. */}
                            <em>Usually the comp has been renamed since the mech was built — check the duration
                                and site tokens against the JPG_PNG folder.</em>
                        </div>
                    )}

                    {art.map((r) => (
                        <div key={r.name} className={"ac-row" + (r.inProject ? " is-ok" : " is-missing")}>
                            <StatusIcon type={r.inProject ? "success" : "error"} size={12} />
                            <div className="ac-row-text">
                                <strong>{r.name}</strong>
                                <span>{r.inProject ? "in this project" : "NOT in this project"}</span>
                            </div>
                            {!r.inProject && res.tiffs && res.tiffs.filter((t) => t.name === r.name)[0] && (
                                <button
                                    className="ac-import"
                                    disabled={busy}
                                    onClick={() => importTiff(res.tiffs!.filter((t) => t.name === r.name)[0].path, r.name)}
                                >
                                    <Download size={12} /> Import
                                </button>
                            )}
                        </div>
                    ))}

                    {other.map((r) => (
                        <div key={r.name} className={"ac-row ac-row--minor" + (r.inProject ? " is-ok" : " is-missing")}>
                            <StatusIcon type={r.inProject ? "success" : "error"} size={12} />
                            <div className="ac-row-text">
                                <strong>{r.name}</strong>
                                <span>{r.type} · {r.inProject ? "in this project" : "not in this project"}</span>
                            </div>
                        </div>
                    ))}

                    {/* NAMES THE CULPRIT. "The right one is missing" and "this
                        wrong one is here instead" are different facts, and the
                        second is what tells you what happened. */}
                    {(res.unexpected || []).length > 0 && (
                        <p className="ac-unexpected">
                            Also in the project, not on the sheet: {(res.unexpected || []).join(", ")}
                        </p>
                    )}

                    {alternatives.length > 0 && (
                        <div className="ac-alts">
                            <button className="ac-alts-toggle" onClick={() => setShowAll((v) => !v)}>
                                <FolderOpen size={12} /> {showAll ? "Hide" : "Show"} the other {res.creative} art edits ({alternatives.length})
                            </button>
                            {showAll && alternatives.map((t) => (
                                <div className="ac-row ac-row--alt" key={t.path}>
                                    <div className="ac-row-text"><strong>{t.name}</strong></div>
                                    <button className="ac-import" disabled={busy} onClick={() => importTiff(t.path, t.name)}>
                                        <Download size={12} /> Import
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {res.csvPath && (
                        <Tooltip text={res.csvPath}>
                            <p className="ac-source">read from the mech sheet in JPG_PNG</p>
                        </Tooltip>
                    )}
                </div>
            )}

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default ArtworkCheckTool;
