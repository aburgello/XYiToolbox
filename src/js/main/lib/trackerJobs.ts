// =============================================================================
// src/js/main/lib/trackerJobs.ts
// -----------------------------------------------------------------------------
// WHICH WRIKE JOBS BELONG TO THE BATCH ON SCREEN (Batch Tracker).
//
// A POST batch is its own batch. Thailand has "TH 6" and "TH 6 POST", filed
// as `Batch_06` and `Batch_6_POST`, nine deliverables each -- and the tracker
// showed all eighteen under BOTH, because the match dropped the POST from
// each side before comparing. That was written for the opposite case: a POST
// job whose territory keeps its POST files in the plain folder (Norway's
// `Batch_02` holds the NfkinoPOST deliverables and there is no `Batch_2_POST`).
//
// So: the job whose batch IS this one wins outright. Only when no job matches
// exactly is a job from the other side of POST let in, and then only if its
// own batch has no folder of its own to be shown under.
//
// Free of imports so `node scripts/probe-tracker-jobs.mjs` runs it as it ships.
// =============================================================================

/** Case, separators and leading zeros off: `Batch_06` is `Batch_6`. */
export const looseBatch = (s: string) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|\D)0+(\d)/g, "$1$2");

const unPost = (s: string) => String(s).replace(/_?POST$/i, "");

/**
 * The jobs of one territory that the batch `batch` should list.
 * `batches` is every batch folder the territory has, when known ([] if not).
 */
export function jobsForBatch<T>(jobs: T[], batchOf: (j: T) => string, batch: string, batches: string[]): T[] {
    const want = looseBatch(batch);
    const exact = jobs.filter((j) => looseBatch(batchOf(j)) === want);
    if (exact.length) return exact;
    const folders = (batches || []).map(looseBatch);
    return jobs.filter((j) => {
        const own = looseBatch(batchOf(j));
        if (looseBatch(unPost(batchOf(j))) !== looseBatch(unPost(batch))) return false;
        // Its own batch has a folder: it is shown there, never here as well.
        return folders.indexOf(own) === -1;
    });
}
