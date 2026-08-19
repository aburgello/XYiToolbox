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
import { parseJobTitle, type WrikeJob } from "./lib/jobsFeed";
// PARSING AND VERDICTS LIVE IN lib/jobRows.ts. They were here, which meant the
// Ask agent could not reach them without keeping a second copy -- the same
// trap jobsFeed.ts calls out for readiness. This file renders them now, and
// does not define them.
import {
    loadJobRows,
    classifyRows,
    isFinished,
    isHeld,
    statusOf,
    stageBatchFromJob,
    type Row,
} from "./lib/jobRows";

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
            const parsed = await loadJobRows(job);
            if (!cancelled) setRows(parsed);
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

    // Rows that can't drive a localise are HIDDEN, not greyed, and the count
    // below still says how many were dropped so nothing disappears silently.
    // All of these verdicts come from lib/jobRows.ts -- the agent reads the
    // same ones, so the modal and Ask cannot disagree about a job.
    const { usable, hidden, sendable, doneCount, heldCount } = classifyRows(rows || []);
    const clean = usable.length;

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
                        <p className="ajm-note">
                            {/* "No subtasks" and "subtasks whose names didn't arrive"
                                are different problems and only one of them is the
                                job's fault. The COUNT comes from subTaskIds and is
                                always right; the NAMES are resolved separately and
                                can come back blank. Saying "no subtasks" there
                                sends someone to check Wrike for a task that is
                                perfectly fine.

                                DOES NOT SUGGEST REFRESHING. It used to, and that
                                was the worst possible advice: a live refresh is
                                the ONE path that loses subtask names (the worker
                                rebuilds its rows from Wrike and the names have to
                                be joined back on), so the fix being offered was
                                the cause. Measured on the live feed: the cached
                                path returned 19 of 19 names, refresh returned 12. */}
                            {(job.subtaskCount ?? 0) > 0
                                ? `Wrike says this job has ${job.subtaskCount} subtask${job.subtaskCount === 1 ? "" : "s"}, but their names didn't arrive with the feed. The job itself is fine. Open it in Wrike to work from there.`
                                : "This job has no subtasks in the feed."}
                        </p>
                    ) : usable.length === 0 ? (
                        <p className="ajm-note">
                            Nothing here can be localised. No campaign, size or duration in the names.
                        </p>
                    ) : (
                        <>
                            {/* Says what is on screen AND what isn't. Hiding
                                unusable rows is only safe if the count of what
                                was hidden stays visible. */}
                            <p className="ajm-summary">
                                {hidden === 0 ? (
                                    <>
                                        <CheckCircle2 size={12} className="ajm-ok" /> All {rows.length} subtask
                                        {rows.length === 1 ? "" : "s"} can be localised.
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle size={12} className="ajm-warn" /> Showing {clean} of{" "}
                                        {rows.length}, {hidden} hidden, missing fields a localise needs.
                                    </>
                                )}
                                {(doneCount > 0 || heldCount > 0) && (
                                    <span className="ajm-summary-done">
                                        {doneCount > 0 && ` ${doneCount} already finished.`}
                                        {heldCount > 0 && ` ${heldCount} not ready to localise.`}
                                        {" Neither gets sent."}
                                    </span>
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
                                    {usable.map((r) => (
                                        <tr key={r.name} className={isFinished(r) ? "ajm-row--done" : isHeld(r) ? "ajm-row--hold" : undefined}>
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
                                            <td className="ajm-status">{r.customStatusName || r.status || "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
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
                            // Payload construction lives in lib/jobRows.ts so
                            // the Ask agent can stage the same batch the same
                            // way -- see stageBatchFromJob.
                            stageBatchFromJob(job, rows);
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
