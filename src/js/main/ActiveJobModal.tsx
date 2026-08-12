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
    /** Custom workflow status when the feed sends one; falls back to `status`
     *  for display. */
    customStatusName?: string;
    parsed: ParsedName | null;
    // Size is not part of nameGeneratorParse's output, so it is read straight
    // off the filename here rather than pretending the parser supplies it.
    size: string;
    missing: string[];
}

const SIZE_RE = /_(\d+)x(\d+)(?:px)?_/;

function buildRow(name: string, status: string, parsed: ParsedName | null, customStatusName?: string): Row {
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
    return { name, status, customStatusName, parsed, size, missing };
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
                setRows(subs.map((s, i) => buildRow(s.name, s.status, (parsed && parsed[i]) || null, s.customStatusName)));
            } catch (e) {
                // No bridge (browser preview): still list the names, just
                // without a parse. Better than an empty modal.
                if (!cancelled) setRows(subs.map((s) => buildRow(s.name, s.status, null, s.customStatusName)));
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

    // WHICH CUSTOM STATUSES MEAN "ready to localise" -- an ALLOWLIST, per the
    // studio. Everything else is shown but not sent: it may be waiting, may be
    // in flight, may already be done, and none of those want re-localising.
    const LOCALISABLE = /^(backlog|motion|save\s*png)$/i;
    // Finished for real. Struck through rather than merely dimmed, because
    // "delivered" reads very differently from "on hold". Matches TimeHub's
    // own test (enrichJob) so the two never disagree.
    const FINISHED = /^(delivered|completed?|done|published)$/i;

    // The feed does not send customStatusName yet -- every subtask arrives with
    // the status GROUP ("Active"), which is in no allowlist. Applying the
    // allowlist to that would make every row unsendable and the button dead.
    // So the allowlist only governs rows that actually carry a custom status;
    // until the worker resolves customStatusId (as TimeHub already does for
    // tasks), behaviour is unchanged apart from excluding finished rows.
    const hasCustom = (r: Row) => !!String(r.customStatusName || "").trim();
    const statusOf = (r: Row) => String(r.customStatusName || r.status || "").trim();

    const isFinished = (r: Row) =>
        String(r.status || "").trim() === "Completed" || FINISHED.test(statusOf(r));
    /** Not ready or not needed -- shown, highlighted, never sent. */
    const isHeld = (r: Row) => hasCustom(r) && !LOCALISABLE.test(statusOf(r)) && !isFinished(r);

    // Rows that can't drive a localise are HIDDEN, not greyed. Campaign is what
    // the master lookup keys on and a run needs a size and duration too, so a
    // row missing any of those was only ever there to be scrolled past --
    // stills, mostly. The count below still says how many were dropped, so
    // nothing disappears silently.
    const usable = rows ? rows.filter((r) => r.missing.length === 0) : [];
    const hidden = rows ? rows.length - usable.length : 0;
    const clean = usable.length;

    // Completed rows stay VISIBLE and struck through -- seeing that eight of
    // twelve are already done is the useful part -- but they are never sent.
    const sendable = usable.filter((r) => !isFinished(r) && !isHeld(r));
    const doneCount = usable.filter(isFinished).length;
    const heldCount = usable.filter(isHeld).length;

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
                    ) : usable.length === 0 ? (
                        <p className="ajm-note">
                            Nothing here can be localised — no campaign, size or duration in the names.
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
                                        {rows.length} — {hidden} hidden, missing fields a localise needs.
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
                            const handoffRows: HandoffRow[] = sendable.map((r) => {
                                const [w, h] = r.size.split("x");
                                return {
                                    artwork: r.parsed?.artworkType || "DOOH",
                                    creative: r.parsed?.campaign || "",
                                    // Passed through verbatim: nameGeneratorParse
                                    // already returns the site exactly as the subtask
                                    // spelled it, and that spelling is what the
                                    // generated filename is meant to agree with.
                                    site: r.parsed?.site || "",
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
