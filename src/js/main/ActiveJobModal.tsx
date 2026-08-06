// =============================================================================
// src/js/main/ActiveJobModal.tsx
// -----------------------------------------------------------------------------
// Opens a Wrike job's subtasks as localiser-shaped rows.
//
// Subtask names ARE deliverable filenames in the studio convention, so they are
// run through parseDeliverableNames -- a bridge wrapper around the same
// nameGeneratorParse that Name Generator, Trott 2.0, PDF to CSV, File Name
// Check and Naming Audit all share. One parser, one answer; nothing about the
// convention is reimplemented here.
//
// WHAT THIS DELIBERATELY DOES NOT DO: pretend every name resolves. Real subtask
// names often do not carry everything a localise needs -- the ARTWALL ones
// yield an EMPTY campaign (everything between the artwork tag and the size gets
// absorbed into `site`) and no duration at all, because they are stills. So
// each row shows exactly what parsed and flags what is missing, and the modal
// says plainly that the specs PDF is still the input for a run. A screen that
// silently showed blanks as if they were fine would send someone to localise
// against a campaign of "".
//
// Portalled to <body>, so it needs its own scope class for any ancestor-scoped
// CSS and re-applies nothing else -- see the batch modal's note in HISTORY.
// =============================================================================
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { evalTS } from "../lib/utils/bolt";
import { parseJobTitle, type WrikeJob } from "./lib/jobsFeed";
import { setPendingBatch, type HandoffRow } from "./lib/localiseHandoff";

// Mirrors NameDetectResult host-side.
interface ParsedName {
    success: boolean;
    filmTitle?: string;
    artworkType?: string;
    campaign?: string;
    territory?: string;
    duration?: string;
    site?: string;
    version?: string;
    error?: string;
    // True when the name carries an isolated OV token -- i.e. it is the
    // un-localised master, not a deliverable.
    isOv?: boolean;
}

interface Row {
    name: string;
    status: string;
    parsed: ParsedName | null;
    // Size is not part of nameGeneratorParse's output, so it is read straight
    // off the filename here rather than pretending the parser supplies it.
    size: string;
    missing: string[];
}

const SIZE_RE = /_(\d+)x(\d+)(?:px)?_/;

function buildRow(name: string, status: string, parsed: ParsedName | null): Row {
    const sizeMatch = name.match(SIZE_RE);
    const size = sizeMatch ? `${sizeMatch[1]}x${sizeMatch[2]}` : "";
    const missing: string[] = [];
    if (!parsed || !parsed.success) missing.push("unparseable");
    else if (parsed.isOv) {
        // Not a gap in the name -- it is a perfectly good MASTER name. It just
        // is not something to localise, and it parses identically to its own
        // deliverable, so sending it would duplicate that row.
        missing.push("is the OV master");
    } else {
        // Campaign is what the master lookup keys on -- an empty one means the
        // row can never match a master, so it is the most important gap here.
        if (!parsed.campaign) missing.push("campaign");
        if (!parsed.artworkType) missing.push("artwork");
        if (!parsed.territory) missing.push("territory");
        if (!parsed.duration) missing.push("duration");
        if (!size) missing.push("size");
    }
    return { name, status, parsed, size, missing };
}

interface Props {
    job: WrikeJob;
    onClose: () => void;
    onOpenLocaliser: () => void;
}

export const ActiveJobModal: React.FC<Props> = ({ job, onClose, onOpenLocaliser }) => {
    const [rows, setRows] = useState<Row[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const subs = job.subtasks || [];
            if (!subs.length) {
                setRows([]);
                return;
            }
            try {
                // ONE call for every name: each bridge round-trip costs far
                // more than the parse itself.
                const parsed = (await evalTS(
                    "parseDeliverableNames",
                    JSON.stringify(subs.map((s) => s.name))
                )) as ParsedName[];
                if (cancelled) return;
                setRows(subs.map((s, i) => buildRow(s.name, s.status, (parsed && parsed[i]) || null)));
            } catch (e) {
                // No bridge (browser preview): still list the names, just
                // without a parse. Better than an empty modal.
                if (!cancelled) setRows(subs.map((s) => buildRow(s.name, s.status, null)));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [job]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const parts = parseJobTitle(job.title);
    const clean = rows ? rows.filter((r) => r.missing.length === 0).length : 0;
    // Only fully-parsed rows can be localised: campaign is what the master
    // lookup keys on, and a run needs a size and duration too. A row missing
    // any of those is shown in the table but never sent.
    const sendable = rows ? rows.filter((r) => r.missing.length === 0) : [];

    return createPortal(
        <div className="ajm-overlay" onClick={onClose} role="presentation">
            <div
                className="ajm"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={job.title}
            >
                <div className="ajm-head">
                    <div className="ajm-head-text">
                        <span className="ajm-title">{parts.name || job.title}</span>
                        <span className="ajm-sub">
                            {parts.territory && <span className="ajm-chip">{parts.territory}</span>}
                            {parts.batch && <span className="ajm-chip">{parts.batch}</span>}
                            <span className="ajm-assignee">{job.assignee}</span>
                        </span>
                    </div>
                    <button type="button" className="ajm-close" onClick={onClose} aria-label="Close">
                        <X size={15} />
                    </button>
                </div>

                <div className="ajm-body">
                    {rows === null ? (
                        <p className="ajm-note">Reading subtasks…</p>
                    ) : rows.length === 0 ? (
                        <p className="ajm-note">This job has no subtasks in the feed.</p>
                    ) : (
                        <>
                            <p className="ajm-summary">
                                {clean === rows.length ? (
                                    <>
                                        <CheckCircle2 size={12} className="ajm-ok" /> All {rows.length} subtask
                                        {rows.length === 1 ? "" : "s"} parse cleanly.
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle size={12} className="ajm-warn" /> {clean} of {rows.length} parse
                                        cleanly — the rest are missing fields a localise needs.
                                    </>
                                )}
                            </p>
                            <table className="ajm-table">
                                <thead>
                                    <tr>
                                        <th>Campaign</th>
                                        <th>Artwork</th>
                                        <th>Site</th>
                                        <th>Size</th>
                                        <th>Dur</th>
                                        <th>Terr</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r) => (
                                        <tr key={r.name} className={r.missing.length ? "ajm-row--gap" : undefined}>
                                            <td className={!r.parsed?.campaign ? "ajm-missing" : undefined}>
                                                {r.parsed?.campaign || "—"}
                                            </td>
                                            <td>{r.parsed?.artworkType || "—"}</td>
                                            <td className="ajm-site" title={r.parsed?.site || ""}>
                                                {r.parsed?.site || "—"}
                                            </td>
                                            <td className={!r.size ? "ajm-missing" : undefined}>{r.size || "—"}</td>
                                            <td className={!r.parsed?.duration ? "ajm-missing" : undefined}>
                                                {r.parsed?.duration || "—"}
                                            </td>
                                            <td>{r.parsed?.territory || "—"}</td>
                                            <td className="ajm-status">{r.status || "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="ajm-foot">
                                Parsed from the subtask names with the toolbox's own naming parser. Names that don't
                                carry a campaign or duration — stills, mostly — can't drive a run on their own; the
                                specs PDF is still the input the localiser reads.
                            </p>
                        </>
                    )}
                </div>

                <div className="ajm-actions">
                    <button type="button" className="ajm-btn" onClick={onClose}>
                        Close
                    </button>
                    {/* Sends only the rows that can actually localise, and says
                        how many were left behind. The RUN still happens in CSV
                        Localiser, which owns every guard that matters --
                        skip-existing, the built-row matcher, duplicate
                        detection, per-row master status. Rebuilding those here
                        would mean either duplicating them or shipping without
                        them. */}
                    <button
                        type="button"
                        className="ajm-btn ajm-btn--primary"
                        disabled={!rows || sendable.length === 0}
                        onClick={() => {
                            if (!rows) return;
                            const handoffRows: HandoffRow[] = sendable.map((r) => {
                                const [w, h] = r.size.split("x");
                                return {
                                    artwork: r.parsed?.artworkType || "DOOH",
                                    creative: r.parsed?.campaign || "",
                                    width: w || "",
                                    height: h || "",
                                    // The builder's field is a bare number of
                                    // seconds; the parser gives "30sec".
                                    duration: (r.parsed?.duration || "").replace(/\D/g, ""),
                                };
                            });
                            setPendingBatch({
                                territory: parts.territory || "",
                                // Wrike titles carry the batch as free text ("Batch 2"),
                                // but this string becomes an output FOLDER name: the CSV's
                                // "Batch:" line is read by csvLocaliserRun and joined onto
                                // the AE folder path (localise.ts). Left as-is it would
                                // create "AE/Batch 02" beside the studio's existing
                                // "Batch_01" folders -- a parallel naming convention
                                // rather than the next batch in the series. Whitespace
                                // only; the trailing number is zero-padded downstream by
                                // csvLocPadBatchNumber, so nothing here should touch it.
                                batch: parts.batch.trim().replace(/\s+/g, "_") || "Batch_1",
                                rows: handoffRows,
                                jobTitle: job.title,
                                skipped: rows
                                    .filter((r) => r.missing.length > 0)
                                    .map((r) => ({ name: r.name, missing: r.missing })),
                            });
                            onOpenLocaliser();
                        }}
                    >
                        {sendable.length === 0
                            ? "Nothing to send"
                            : `Send ${sendable.length} row${sendable.length === 1 ? "" : "s"} to Localise`}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ActiveJobModal;
