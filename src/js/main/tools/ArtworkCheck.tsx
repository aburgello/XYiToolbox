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
import { FileSearch, Download, FolderOpen, FolderSearch, RefreshCw, X } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";
import "./ArtworkCheck.scss";

/** One .aep motion edit, and the folder it came out of — "Tiffs" or "Edit",
 *  which mean different things and are labelled as such. */
interface Edit { name: string; path: string; folder: string }

interface Row {
    type: string; name: string; filePath: string; inProject: boolean;
    /** The .aep motion edit built from this tiff — what a motion deliverable
     *  actually needs. "" when the creative folder has none for it. */
    editName?: string; editPath?: string;
    editVariants?: Edit[];
}
interface CheckResult {
    success: boolean;
    error?: string;
    deliverable?: string;
    territory?: string;
    csvPath?: string;
    rows?: Row[];
    creative?: string;
    editsFolder?: string;
    editFolders?: string[];
    edits?: Edit[];
    componentsFolder?: string;
    componentsPicked?: boolean;
    unexpected?: string[];
    verdict?: "match" | "mismatch" | "no-reference";
    jpgPngFolder?: string;
    picked?: boolean;
    /** The failure is "I couldn't find the folder", which is answerable by
     *  pointing at it. */
    needsFolder?: boolean;
}

/** Last path segment, either separator — the panel runs on both platforms. */
function leafName(path: string): string {
    const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return cut === -1 ? path : path.substring(cut + 1) || path;
}

const ArtworkCheckTool = () => {
    const [res, setRes] = useState<CheckResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [showAll, setShowAll] = useState(false);
    // A manually picked JPG_PNG folder, for when the walk up from the project
    // finds nothing. SESSION-ONLY on purpose: it belongs to the deliverable in
    // front of you, and a path remembered across jobs would quietly check the
    // next one against the last one's sheets.
    const [folder, setFolder] = useState("");
    const [needsFolder, setNeedsFolder] = useState(false);
    // The creative's Tiffs/Edit folder, for the creatives this can't name from
    // the deliverable. Session-only for the same reason as the one above.
    const [components, setComponents] = useState("");

    /** Overrides are passed explicitly rather than read from state, so picking
     *  a folder can check against it in the same tick. */
    const check = async (override?: string, comp?: string) => {
        const path = override === undefined ? folder : override;
        const compPath = comp === undefined ? components : comp;
        setBusy(true);
        setStatus(null);
        try {
            const r = (await evalTS("artworkCheck", path, compPath)) as unknown as CheckResult | undefined;
            if (r === undefined) throw new Error("no bridge");
            setRes(r);
            setNeedsFolder(!r.success && !!r.needsFolder);
            if (!r.success) setStatus({ text: r.error || "Couldn't check this one.", type: "error" });
        } catch {
            setStatus({ text: "No CEP bridge detected. Open this panel inside After Effects.", type: "error" });
        } finally {
            setBusy(false);
        }
    };

    const pickFolder = async () => {
        try {
            const path = (await evalTS("selectArtworkJpgPngFolder")) as unknown as string | null | undefined;
            if (path === undefined) throw new Error("no bridge");
            if (!path) return;                       // cancelled, which is fine
            setFolder(path);
            await check(path);
        } catch {
            setStatus({ text: "No CEP bridge detected. Open this panel inside After Effects.", type: "error" });
        }
    };

    const clearFolder = async () => {
        setFolder("");
        await check("");
    };

    const pickComponents = async () => {
        try {
            const path = (await evalTS("selectArtworkComponentsFolder")) as unknown as string | null | undefined;
            if (path === undefined) throw new Error("no bridge");
            if (!path) return;
            setComponents(path);
            await check(undefined, path);
        } catch {
            setStatus({ text: "No CEP bridge detected. Open this panel inside After Effects.", type: "error" });
        }
    };

    const clearComponents = async () => {
        setComponents("");
        await check(undefined, "");
    };

    const importEdit = async (path: string, name: string) => {
        setBusy(true);
        try {
            const r = (await evalTS("artworkImportTiff", path)) as unknown as { success: boolean; error?: string };
            setStatus(r && r.success
                ? { text: `Imported ${name}. Put it into the comp yourself. Layer order, masking and scale are yours.`, type: "success" }
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
    const offered = (res?.rows || []).map((r) => (r.editName || "").toLowerCase());
    const alternatives = (res?.edits || []).filter((t) => offered.indexOf(t.name.toLowerCase()) === -1);

    return (
        <div className="form-tool artwork-check">
            <div className="button-row">
                <button disabled={busy} onClick={() => check()}>
                    {busy ? <RefreshCw size={14} /> : <FileSearch size={14} />} Check this deliverable
                </button>
            </div>

            {/* Offered when the walk-up failed, and kept on screen once a
                folder is in use so it is never a mystery which one was read. */}
            {(needsFolder || folder !== "") && (
                <div className="ac-folder">
                    {folder === "" ? (
                        <button className="ac-folder-pick" disabled={busy} onClick={pickFolder}>
                            <FolderSearch size={12} /> Pick the JPG_PNG folder
                        </button>
                    ) : (
                        <>
                            <Tooltip text={folder}>
                                <span className="ac-folder-path">
                                    <FolderSearch size={11} />
                                    <em>{leafName(folder)}</em>
                                </span>
                            </Tooltip>
                            <button className="ac-folder-pick" disabled={busy} onClick={pickFolder}>Change</button>
                            <button className="ac-folder-clear" disabled={busy} onClick={clearFolder}
                                title="Go back to finding it from the project">
                                <X size={11} />
                            </button>
                        </>
                    )}
                </div>
            )}

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
                            <em>Usually the comp was renamed after the mech was built. Check the duration
                                and site tokens against the JPG_PNG folder.</em>
                            {/* The other cause, and the one this fixes: it read
                                the wrong JPG_PNG. */}
                            {folder === "" && (
                                <button className="ac-folder-pick" disabled={busy} onClick={pickFolder}>
                                    <FolderSearch size={12} /> Pick the JPG_PNG folder yourself
                                </button>
                            )}
                        </div>
                    )}

                    {art.map((r) => (
                        <div key={r.name}>
                            <div className={"ac-row" + (r.inProject ? " is-ok" : " is-missing")}>
                                <StatusIcon type={r.inProject ? "success" : "error"} size={12} />
                                <div className="ac-row-text">
                                    {/* THE EDIT IS THE HEADLINE, not the tiff. The
                                        sheet names the static art the mech was
                                        built from; what goes in a motion
                                        deliverable is the .aep built from it. */}
                                    <strong>{r.editName || r.name}</strong>
                                    <span>
                                        {r.editName
                                            ? `the motion edit for ${r.name}`
                                            : `no motion edit exists for ${r.name}`}
                                        {" · "}
                                        {r.inProject ? "in this project" : "NOT in this project"}
                                    </span>
                                </div>
                                {!r.inProject && r.editPath && (
                                    <button className="ac-import" disabled={busy}
                                        onClick={() => importEdit(r.editPath!, r.editName || r.name)}>
                                        <Download size={12} /> Import
                                    </button>
                                )}
                            </div>
                            {/* OFFERED, NEVER CHOSEN. Which of these a
                                deliverable wants depends on its duration, and
                                that is the artist's call. */}
                            {(r.editVariants || []).map((v) => (
                                <div className="ac-row ac-row--alt" key={v.path}>
                                    <div className="ac-row-text">
                                        <strong>{v.name}</strong>
                                        <span>another cut of the same edit · {v.folder}</span>
                                    </div>
                                    <button className="ac-import" disabled={busy}
                                        onClick={() => importEdit(v.path, v.name)}>
                                        <Download size={12} /> Import
                                    </button>
                                </div>
                            ))}
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
                                <FolderOpen size={12} /> {showAll ? "Hide" : "Show"} the other {res.creative || "available"} motion edits ({alternatives.length})
                            </button>
                            {/* GROUPED BY FOLDER, because the two are not the
                                same kind of thing: Tiffs holds the animated
                                version of one piece of artwork, Edit holds cuts
                                of the whole spot. Lumping them together would
                                offer a 15sec edit as if it were artwork. */}
                            {showAll && (res.editFolders || []).map((name) => {
                                const inFolder = alternatives.filter((t) => t.folder === name);
                                if (inFolder.length === 0) return null;
                                return (
                                    <div key={name}>
                                        <p className="ac-alts-group">
                                            {name}
                                            <em>{name.toLowerCase().indexOf("edit") === 0
                                                ? "cuts of the whole spot"
                                                : "one per piece of artwork"}</em>
                                        </p>
                                        {inFolder.map((t) => (
                                            <div className="ac-row ac-row--alt" key={t.path}>
                                                <div className="ac-row-text"><strong>{t.name}</strong></div>
                                                <button className="ac-import" disabled={busy} onClick={() => importEdit(t.path, t.name)}>
                                                    <Download size={12} /> Import
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Not every creative HAS a Tiffs or an Edit — Bracelet and
                        Portal LOS have neither — so an empty list is a normal
                        answer, said plainly, with the way out beside it. */}
                    {(res.edits || []).length === 0 && (
                        <div className="ac-folder ac-folder--comp">
                            {components === "" ? (
                                <button className="ac-folder-pick" disabled={busy} onClick={pickComponents}>
                                    <FolderSearch size={12} />
                                    {res.creative
                                        ? `No Tiffs or Edit folder in ${res.creative} — pick one`
                                        : "No motion edits found — pick the Tiffs or Edit folder"}
                                </button>
                            ) : (
                                <>
                                    <Tooltip text={components}>
                                        <span className="ac-folder-path">
                                            <FolderSearch size={11} />
                                            <em>nothing in {leafName(components)}</em>
                                        </span>
                                    </Tooltip>
                                    <button className="ac-folder-pick" disabled={busy} onClick={pickComponents}>Change</button>
                                    <button className="ac-folder-clear" disabled={busy} onClick={clearComponents}
                                        title="Go back to finding it from the campaign">
                                        <X size={11} />
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {(res.edits || []).length > 0 && components !== "" && (
                        <div className="ac-folder ac-folder--comp">
                            <Tooltip text={components}>
                                <span className="ac-folder-path">
                                    <FolderSearch size={11} />
                                    <em>{leafName(components)}</em>
                                </span>
                            </Tooltip>
                            <button className="ac-folder-pick" disabled={busy} onClick={pickComponents}>Change</button>
                            <button className="ac-folder-clear" disabled={busy} onClick={clearComponents}
                                title="Go back to finding it from the campaign">
                                <X size={11} />
                            </button>
                        </div>
                    )}

                    {res.csvPath && (
                        <Tooltip text={res.csvPath}>
                            <p className="ac-source">
                                read from the mech sheet in {res.picked ? "the folder you picked" : "JPG_PNG"}
                            </p>
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
