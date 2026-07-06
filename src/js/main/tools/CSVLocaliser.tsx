// =============================================================================
// src/js/main/tools/CSVLocaliser.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "CSV Localiser" tab, backed by
// XYi_Campaign_CSV.jsx's campLocCSV(). Paste CSV text (a [METADATA] block
// with Territory:/Batch:/Source Folder: lines, then Artwork/Campaign/Size/
// Duration rows) and it scans an AEP source path for the best-matching
// master per row, then generates a localised comp per row. Already
// copy-first in the original -- see csvLocaliserRun()'s comment in aeft.ts.
// =============================================================================
import React, { useEffect, useState } from "react";
import { FolderSearch, PlayCircle } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import CheckboxToggle from "../CheckboxToggle";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";

const CSVLocaliserTool = () => {
    const [aepPath, setAepPath] = useState("");
    const [skipExisting, setSkipExisting] = useState(true);
    const [csvText, setCsvText] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const last = await evalTS("csvLocaliserLoadLastPath");
                if (last) setAepPath(last);
            } catch (e) {
                // browser preview -- no bridge, leave blank
            }
        })();
    }, []);

    const browse = async () => {
        try {
            const picked = await evalTS("selectCsvLocaliserAepFolder");
            if (picked === undefined) throw new Error("no bridge");
            if (picked) setAepPath(picked);
        } catch (e) {
            setNotice("No CEP bridge detected — open this panel inside After Effects to use this.");
        }
    };

    const run = async () => {
        setNotice(null);
        setBusy(true);
        try {
            const result = await evalTS("csvLocaliserRun", aepPath, csvText, skipExisting);
            if (result === undefined) throw new Error("no bridge");
            // The underlying script shows its own alert()s per row and a final
            // count -- this status line is just a fallback for browser preview
            // / headless runs where those native dialogs aren't visible.
            setNotice(result.success ? "Run finished — see the alert dialog(s) shown during the run for row-by-row results." : result.error || "Something went wrong.");
        } catch (e) {
            setNotice("No CEP bridge detected — open this panel inside After Effects to run it.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">
            <div className="field-with-button">
                <div className="field-row">
                    <input type="text" value={aepPath} onChange={(e) => setAepPath(e.target.value)} placeholder="Enter AEP source path here..." />
                </div>
                <Tooltip text="Browse for AEP source folder">
                    <button className="icon-btn" disabled={busy} onClick={browse}>
                        <FolderSearch size={14} />
                    </button>
                </Tooltip>
            </div>

            <div className="radio-row">
                <CheckboxToggle checked={skipExisting} onChange={setSkipExisting} label="Skip existing files" />
            </div>

            <div className="field-row" style={{ maxWidth: 520 }}>
                <label htmlFor="csvloc-paste">Paste your copied CSV Data below</label>
                <textarea
                    id="csvloc-paste"
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    rows={10}
                    placeholder="Paste CSV rows here…"
                />
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={run}>
                    <PlayCircle size={14} /> Run CSV Localiser
                </button>
            </div>

            {notice && <p className="hint">{notice}</p>}
        </div>
    );
};

export default CSVLocaliserTool;
