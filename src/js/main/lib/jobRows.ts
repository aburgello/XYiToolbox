// =============================================================================
// src/js/main/lib/jobRows.ts
// -----------------------------------------------------------------------------
// A Wrike job's subtasks, as localiser-shaped rows -- and the verdicts about
// which of them can actually be sent.
//
// LIFTED OUT OF ActiveJobModal so the Ask agent can reach the same answers.
// It is the same move jobsFeed.ts already made for readiness, and for the same
// stated reason: two copies of these rules is exactly how a card ends up
// disagreeing with the sheet it opens. The modal had its own local LOCALISABLE
// and FINISHED regexes despite jobsFeed exporting both; those are gone, and
// the exports are used here instead. The patterns were byte-identical, so
// nothing about the modal's behaviour changes.
//
// Subtask names ARE deliverable filenames in the studio convention, so they go
// through parseDeliverableNames -- the bridge wrapper around the same
// nameGeneratorParse that Name Generator, Trott 2.0, PDF to CSV, File Name
// Check and Naming Audit all share. One parser, one answer.
//
// WHAT THIS DELIBERATELY DOES NOT DO: pretend every name resolves. Real
// subtask names often do not carry everything a localise needs -- the ARTWALL
// ones yield an EMPTY campaign and no duration at all, because they are
// stills. Every row reports exactly what is missing, and callers are expected
// to show that rather than send blanks as though they were fine.
// =============================================================================
import { evalTS } from "../../lib/utils/bolt";
import {
    parseJobTitle,
    LOCALISABLE_STATUSES,
    FINISHED_STATUSES,
    type WrikeJob,
} from "./jobsFeed";
import { setPendingBatch, type HandoffRow, type PendingBatch } from "./localiseHandoff";

/** Mirrors NameDetectResult host-side. */
export interface ParsedName {
    success: boolean;
    filmTitle?: string;
    artworkType?: string;
    campaign?: string;
    territory?: string;
    duration?: string;
    site?: string;
    version?: string;
    error?: string;
    /** True when the name carries an isolated OV token -- i.e. it is the
     *  un-localised master, not a deliverable. */
    isOv?: boolean;
}

export interface Row {
    name: string;
    status: string;
    /** Custom workflow status when the feed sends one; falls back to `status`
     *  for display. */
    customStatusName?: string;
    parsed: ParsedName | null;
    /** Not part of nameGeneratorParse's output, so it is read straight off the
     *  filename rather than pretending the parser supplies it. */
    size: string;
    missing: string[];
}

const SIZE_RE = /_(\d+)x(\d+)(?:px)?_/;

export function buildRow(
    name: string,
    status: string,
    parsed: ParsedName | null,
    customStatusName?: string
): Row {
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

/**
 * Every subtask of a job, parsed.
 *
 * ONE bridge call for all the names: each round-trip costs far more than the
 * parse itself. With no bridge (browser preview) the names are still returned,
 * just unparsed -- better than nothing, and the `missing` flags say so.
 */
export async function loadJobRows(job: WrikeJob): Promise<Row[]> {
    const subs = job.subtasks || [];
    if (!subs.length) return [];
    try {
        const parsed = (await evalTS(
            "parseDeliverableNames",
            JSON.stringify(subs.map((s) => s.name))
        )) as ParsedName[];
        return subs.map((s, i) =>
            buildRow(s.name, s.status, (parsed && parsed[i]) || null, s.customStatusName)
        );
    } catch {
        return subs.map((s) => buildRow(s.name, s.status, null, s.customStatusName));
    }
}

// --- status verdicts ----------------------------------------------------
//
// The feed DOES send customStatusName (subtasks arrive as status "Active"
// with customStatusName "Backlog" / "On hold" / "Render review"). The guard
// stays anyway: a subtask arriving without one must not be judged against an
// allowlist it cannot satisfy -- the status GROUP is only ever Active/
// Completed/Deferred/Cancelled, none of which is localisable, so applying the
// allowlist to a bare group would make every row unsendable.

const hasCustom = (r: Row) => !!String(r.customStatusName || "").trim();
export const statusOf = (r: Row) => String(r.customStatusName || r.status || "").trim();

export const isFinished = (r: Row) =>
    String(r.status || "").trim() === "Completed" || FINISHED_STATUSES.test(statusOf(r));

/** Not ready or not needed -- shown, highlighted, never sent. */
export const isHeld = (r: Row) =>
    hasCustom(r) && !LOCALISABLE_STATUSES.test(statusOf(r)) && !isFinished(r);

export interface RowVerdicts {
    /** Rows complete enough to drive a localise. */
    usable: Row[];
    /** How many were dropped for missing fields -- never silently. */
    hidden: number;
    /** Usable, not finished, not held: the ones that would actually be sent. */
    sendable: Row[];
    doneCount: number;
    heldCount: number;
}

export function classifyRows(rows: Row[]): RowVerdicts {
    const usable = rows.filter((r) => r.missing.length === 0);
    const sendable = usable.filter((r) => !isFinished(r) && !isHeld(r));
    return {
        usable,
        hidden: rows.length - usable.length,
        sendable,
        doneCount: usable.filter(isFinished).length,
        heldCount: usable.filter(isHeld).length,
    };
}

/**
 * Builds the payload CSV Localiser's batch builder reads on mount, and stages
 * it. The caller still has to navigate -- staging alone shows the artist
 * nothing.
 *
 * Nothing here writes to disk or touches AE: it fills in a form. The artist
 * reviews it and presses the button.
 */
export function stageBatchFromJob(job: WrikeJob, rows: Row[]): PendingBatch {
    const parts = parseJobTitle(job.title);
    const { sendable } = classifyRows(rows);

    const handoffRows: HandoffRow[] = sendable.map((r) => {
        const [w, h] = r.size.split("x");
        return {
            artwork: r.parsed?.artworkType || "DOOH",
            creative: r.parsed?.campaign || "",
            // Verbatim: nameGeneratorParse already returns the site exactly as
            // the subtask spelled it, and that spelling is what the generated
            // filename is meant to agree with.
            site: r.parsed?.site || "",
            width: w || "",
            height: h || "",
            // The builder's field is a bare number of seconds; the parser
            // gives "30sec".
            duration: (r.parsed?.duration || "").replace(/\D/g, ""),
        };
    });

    const batch: PendingBatch = {
        territory: parts.territory || "",
        // Wrike titles carry the batch as free text ("Batch 2"), but this
        // string becomes an output FOLDER name: the CSV's "Batch:" line is
        // read by csvLocaliserRun and joined onto the AE folder path. Left
        // as-is it would create "AE/Batch 02" beside the studio's existing
        // "Batch_01" folders -- a parallel convention rather than the next
        // batch in the series. Whitespace only; the trailing number is
        // zero-padded downstream by csvLocPadBatchNumber.
        batch: parts.batch.trim().replace(/\s+/g, "_") || "Batch_1",
        rows: handoffRows,
        jobTitle: job.title,
        skipped: rows
            .filter((r) => r.missing.length > 0)
            .map((r) => ({ name: r.name, missing: r.missing })),
    };

    setPendingBatch(batch);
    return batch;
}
