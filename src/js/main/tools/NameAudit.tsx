// =============================================================================
// src/js/main/tools/NameAudit.tsx
// -----------------------------------------------------------------------------
// Read-only naming-convention audit over a folder tree. NOT a port of anything
// in toolset/ -- new, and built because the studio now runs two naming
// conventions at once (masters were never renamed; deliverables generated
// since 2026-07-31 use the new form) and nothing could tell you which
// convention a file on disk was actually on.
//
// Nothing is opened. The backend (`nameAuditScan` in jsx/aeft/localise.ts)
// walks the tree and runs the same pure `nameGeneratorParse` every other
// naming-aware tool already shares, so a whole-campaign audit costs about
// what one row of a localise run already costs.
//
// Two modes, because the two folders are asked different questions -- see the
// backend's own header for the split.
// =============================================================================
import React, { useState } from "react";
import { FolderSearch, Boxes, AlertTriangle, CheckCircle2 } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";
import "./NameAudit.scss";

interface AuditRow {
    name: string;
    folder: string;
    convention: string;
    issues: string[];
}

interface AuditReport {
    root: string;
    mode: string;
    scanned: number;
    newCount: number;
    legacyCount: number;
    unknownCount: number;
    issueCount: number;
    truncated: boolean;
    rows: AuditRow[];
}

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

const CONVENTION_LABEL: Record<string, string> = {
    new: "New",
    legacy: "Old (DGTL)",
    unknown: "Unreadable",
};

const NameAuditTool = () => {
    const [report, setReport] = useState<AuditReport | null>(null);
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const scan = async (mode: "masters" | "batch") => {
        setStatus(null);
        setBusy(true);
        try {
            const result = await evalTS("nameAuditScan", mode);
            if (result === undefined) throw new Error("no bridge");
            if (!result.success) {
                // A cancelled folder dialog is a deliberate user action, not a
                // failure worth an error banner.
                if (result.error !== "Cancelled.") {
                    setStatus({ text: result.error || "Something went wrong.", type: "error" });
                }
                return;
            }
            setReport(result as AuditReport);
            setStatus({
                text:
                    result.issueCount === 0
                        ? `Scanned ${result.scanned} file(s) — nothing to flag.`
                        : `Scanned ${result.scanned} file(s) — ${result.issueCount} need a look.`,
                type: "success",
            });
        } catch (e) {
            setStatus({
                text: "No CEP bridge detected. Open this panel inside After Effects to run it.",
                type: "error",
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">
            <div className="button-row">
                <button disabled={busy} onClick={() => scan("masters")}>
                    <Boxes size={14} /> Audit a Masters root
                </button>
                <button disabled={busy} onClick={() => scan("batch")}>
                    <FolderSearch size={14} /> Audit a batch / AE folder
                </button>
            </div>

            {status && (
                <div className={`tool-status ${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}

            {report && (
                <div className="na-report">
                    <div className="na-root" title={report.root}>
                        {report.root}
                    </div>

                    <div className="na-tallies">
                        <span className="na-tally na-tally--new">
                            <b>{report.newCount}</b> new
                        </span>
                        <span className="na-tally na-tally--legacy">
                            <b>{report.legacyCount}</b> old
                        </span>
                        <span className="na-tally na-tally--unknown">
                            <b>{report.unknownCount}</b> unreadable
                        </span>
                    </div>

                    {report.rows.length === 0 ? (
                        <div className="na-clean">
                            <CheckCircle2 size={14} /> Every file parsed cleanly.
                        </div>
                    ) : (
                        <>
                            <div className="na-list-head">
                                Needs a look ({report.issueCount})
                            </div>
                            <div className="na-list">
                                {report.rows.map((row, i) => (
                                    <div className="na-row" key={`${row.folder}/${row.name}-${i}`}>
                                        <div className="na-row-top">
                                            <span className="na-row-name" title={row.name}>
                                                {row.name}
                                            </span>
                                            <span className={`na-badge na-badge--${row.convention}`}>
                                                {CONVENTION_LABEL[row.convention] || row.convention}
                                            </span>
                                        </div>
                                        {row.folder && <div className="na-row-folder">{row.folder}</div>}
                                        <ul className="na-issues">
                                            {row.issues.map((issue, k) => (
                                                <li key={k}>
                                                    <AlertTriangle size={11} /> {issue}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                            {report.truncated && (
                                <div className="na-truncated">
                                    Showing the first {report.rows.length} — narrow the folder to see the rest.
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default NameAuditTool;
