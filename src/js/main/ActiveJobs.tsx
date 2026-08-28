// =============================================================================
// src/js/main/ActiveJobs.tsx
// -----------------------------------------------------------------------------
// The home screen's full-width "Active Jobs" card: what still needs localising,
// one row per territory/batch, click to open it.
//
// IT DOES NOT SCAN. A specs scan walks every territory folder and parses every
// PDF; doing that on the home screen would make the panel's first screen the
// slowest thing in it. CSV Localiser publishes a snapshot whenever it scans,
// runs or re-checks (see its saveActiveJobs effect), and this reads it. That is
// why the header says WHEN it was captured rather than pretending to be live --
// a card that quietly shows week-old numbers as if they were current is worse
// than one that admits its age.
//
// Numbers come from the SAME matchBuiltRows() that tints the rows and unticks
// the built ones in the specs table, so this can never disagree with the tool.
//
// Deliberately no perpetual animation: the entrance is one-shot, matching the
// rest of the always-visible home screen (CLAUDE.md §3).
// =============================================================================
import React, { useCallback, useEffect, useState } from "react";
import { TutorialIcon } from "./TutorialIcon";
import { AnimatePresence, motion } from "motion/react";
import { Briefcase, ChevronDown, ChevronRight, MapPin, RefreshCw, Users, Check } from "lucide-react";
import Droplet from "./Droplet";
import { evalTS } from "../lib/utils/bolt";
import Tooltip from "./Tooltip";
import { fetchJobs, refreshJobs, saveJobsFeedConfig, loadJobsFeedConfig, parseJobTitle, jobReadiness, territoryFlag, statusTint, type WrikeJob } from "./lib/jobsFeed";
import ActiveJobModal from "./ActiveJobModal";

interface ActiveJob {
    territory: string;
    batch: string;
    pdfName: string;
    sourceFolder: string;
    total: number;
    built: number;
}

interface Snapshot {
    capturedAt: number;
    jobs: ActiveJob[];
}


interface Props {
    onOpen: () => void;
}

export const ActiveJobs: React.FC<Props> = ({ onOpen }) => {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [loaded, setLoaded] = useState(false);
    // Wrike is the source of TRUTH for what needs doing: a PM can forget to
    // drop a specs PDF, but a task assigned to someone is real work regardless.
    // The specs snapshot stays as the second half of the picture -- it is the
    // only thing that knows what is actually BUILT on disk.
    const [jobs, setJobs] = useState<WrikeJob[] | null>(null);
    const [jobsMock, setJobsMock] = useState(false);
    const [jobsError, setJobsError] = useState<string | undefined>(undefined);
    const [busy, setBusy] = useState(false);
    // Which member this station belongs to, so "assigned to me" is a local
    // filter rather than an auth question -- every member can read the whole
    // studio's Wrike, so the feed returns everything and we narrow it here.
    const [owner, setOwner] = useState("");
    // Whose list is on screen. Equals `owner` normally; differs when a
    // "view as" is configured. The card filters and labels on THIS, never on
    // the machine tag, or a view-as result would be filtered by your own name
    // and come back empty.
    const [viewingAs, setViewingAs] = useState("");
    const [impersonating, setImpersonating] = useState(false);
    const [setupViewAs, setSetupViewAs] = useState("");
    // Clicking a batch opens it here rather than jumping straight to Localise:
    // the useful first question is "what is actually in this job", and the
    // subtask names answer it without leaving home.
    const [openJob, setOpenJob] = useState<WrikeJob | null>(null);
    // Setup lives inside the card rather than in a settings screen: the only
    // moment anyone wants it is when they are looking at the "sample" badge
    // wondering why the data is not real.
    const [setupOpen, setSetupOpen] = useState(false);
    const [setupUrl, setSetupUrl] = useState("");
    const [setupKey, setSetupKey] = useState("");
    const [setupBusy, setSetupBusy] = useState(false);
    const [setupNote, setSetupNote] = useState("");

    // The Motion roster, straight from the team folder -- the same
    // teamListProfiles the Team menu lists, so this can't drift into a second
    // idea of who's on the team. Loaded when the picker opens, not on mount:
    // it's a NAS read and most sessions never touch it.
    const [roster, setRoster] = useState<string[] | null>(null);
    const loadRoster = useCallback(async () => {
        if (roster) return;
        try {
            const res = await evalTS("teamListProfiles");
            const names = ((res as { profiles?: { name: string }[] })?.profiles || [])
                .map((p) => p.name)
                .filter(Boolean);
            setRoster(names);
        } catch {
            setRoster([]); // unmounted share is a normal state, not an error
        }
    }, [roster]);

    /** Switch whose list is shown. Empty string = back to your own. */
    const viewAsMember = useCallback(async (name: string) => {
        const cfg = await loadJobsFeedConfig();
        if (!cfg) return;
        await saveJobsFeedConfig({ ...cfg, viewAs: name || undefined });
        setBusy(true);
        try {
            // ALWAYS `owner`, never the person being viewed. fetchJobs treats
            // its argument as "who this machine is" and derives impersonation
            // from cfg.viewAs !== member -- so passing the target name made
            // viewAs and member identical and the result came back
            // impersonating: false. The trigger stayed "You" and both the
            // owner and the viewed person showed a tick, until a refresh
            // (which does pass `owner`) corrected it.
            //
            // fetchJobs(force) NOT refreshJobs: switching whose list you see is
            // a different FILTER, not a request for newer data -- refreshJobs
            // asks the Worker to read Wrike live, so every name change was
            // spending a Wrike call. `force` bypasses the panel's own cache,
            // which is all this needs.
            const res = await fetchJobs(owner, true);
            setJobs(res.jobs);
            setJobsMock(!!res.mock);
            setJobsError(res.error);
            setViewingAs(res.viewingAs);
            setImpersonating(!!res.impersonating);
        } finally {
            setBusy(false);
        }
    }, [owner]);

    const saveSetup = useCallback(async () => {
        const url = setupUrl.trim();
        let key = setupKey.trim();
        if (!key) {
            // Blank means "unchanged" -- so the view-as field can be edited
            // without retyping a 44-character secret every time.
            const existing = await loadJobsFeedConfig();
            key = existing?.key || "";
        }
        if (!url || !key) {
            setSetupNote("Both the URL and the key are needed.");
            return;
        }
        setSetupBusy(true);
        setSetupNote("");
        try {
            const ok = await saveJobsFeedConfig({ url, key, viewAs: setupViewAs.trim() || undefined });
            if (!ok) {
                setSetupNote("Couldn't save. No bridge to After Effects.");
                return;
            }
            // Fetch straight away so a wrong URL or key is reported HERE, while
            // the fields are still on screen to correct, rather than silently
            // falling back to sample data.
            const res = await refreshJobs(owner);
            setJobs(res.jobs);
            setJobsMock(res.mock);
            setJobsError(res.error);
            setViewingAs(res.viewingAs);
            setImpersonating(res.impersonating);
            if (res.mock) setSetupNote(res.error || "Saved, but the feed didn't answer.");
            else {
                setSetupNote("");
                setSetupOpen(false);
                setSetupKey("");
            }
        } finally {
            setSetupBusy(false);
        }
        // setupViewAs MUST be here. Without it this callback closes over the
        // value from before you typed, so "view as" always saved as empty and
        // the card silently kept showing your own jobs -- everything
        // downstream was correct, the name just never reached the save.
    }, [setupUrl, setupKey, setupViewAs, owner]);
    // Collapsed by default. The four category cards are the home screen's
    // primary navigation and this must not compete with them -- as a standing
    // open panel it read as a permanent slab of text under the nav. As a
    // closed button it joins that row and only spends space when asked to.
    //
    // Declared with the other hooks, ABOVE the early returns below: this
    // component returns null until the snapshot loads, so a useState placed
    // after those returns would change the hook COUNT between renders and
    // React would throw "rendered fewer hooks than expected" the moment a
    // snapshot arrived.
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const raw = await evalTS("loadActiveJobs");
            if (typeof raw === "string" && raw !== "") {
                const parsed = JSON.parse(raw) as Snapshot;
                if (parsed && parsed.jobs instanceof Array) setSnapshot(parsed);
            }
        } catch (e) {
            // No bridge (browser preview), or a snapshot written by an older
            // build. Either way the empty state is the honest answer -- this
            // card must never toast or block the home screen.
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        let cancelled = false;
        // Resolved before the fetch: the Worker filters by member, so asking
        // before we know who this machine is would return nothing.
        let who = "";
        (async () => {
            try {
                const state = await evalTS("teamGetMachineState");
                if (!cancelled && state && (state as { owner?: string }).owner) {
                    who = (state as { owner: string }).owner;
                    setOwner(who);
                }
            } catch (e) {
                /* untagged machine or no bridge -- "mine" simply matches nothing */
            }
            // Prefill so the form edits the existing config rather than only
            // ever creating one. The key is deliberately NOT read back into a
            // visible field -- left blank means "keep the stored one".
            try {
                const cfg = await loadJobsFeedConfig();
                if (!cancelled && cfg) {
                    setSetupUrl(cfg.url || "");
                    setSetupViewAs(cfg.viewAs || "");
                }
            } catch (e) {
                /* nothing saved yet */
            }
            const res = await fetchJobs(who);
            if (cancelled) return;
            setJobs(res.jobs);
            setJobsMock(res.mock);
            setJobsError(res.error);
            setViewingAs(res.viewingAs);
            setImpersonating(res.impersonating);
        })();
        return () => { cancelled = true; };
    }, []);

    const doRefresh = useCallback(async (e: React.MouseEvent) => {
        // The refresh control lives inside the toggle button, so its click must
        // not also collapse/expand the card.
        e.stopPropagation();
        setBusy(true);
        try {
            const res = await refreshJobs(owner);
            setJobs(res.jobs);
            setJobsMock(res.mock);
            setJobsError(res.error);
            setViewingAs(res.viewingAs);
            setImpersonating(res.impersonating);
        } finally {
            setBusy(false);
        }
        // `owner` belongs here for the same reason as saveSetup's deps: with an
        // empty array this closed over the mount-time value (""), so pressing
        // refresh asked the feed for NO member -- which the Worker answers with
        // the whole studio's jobs.
    }, [owner]);

    // Nothing to show and nothing scanned yet: stay out of the way entirely
    // rather than occupying the home screen with an empty box. Once a scan has
    // happened the card persists, because "0 outstanding" is real information.
    // Render as soon as EITHER source has something. Waiting for both would
    // hide the card on a machine that has never scanned but does have jobs.
    if (!loaded) return null;
    if (!jobs && !snapshot) return null;

    // The snapshot no longer renders a line of its own -- the "last specs scan"
    // footer was restating a count nobody acted on. It is still LOADED, because
    // it is half of the guard that decides whether this card appears at all on
    // a machine with no jobs feed configured.
    const allJobs = jobs || [];
    // YOURS ONLY -- no "everyone" toggle. The whole point of the card is a
    // short, glanceable list of what you personally have to build; the feed
    // returns the studio's jobs only because filtering server-side would need
    // per-user auth we deliberately avoided.
    //
    // An untagged machine can't answer "mine", so it says so rather than
    // showing an empty list, which would read as "no work" instead of "we
    // don't know who you are".
    const listFor = viewingAs || owner;
    const shown = listFor ? allJobs.filter((j) => j.assignee === listFor) : [];
    const openCount = shown.filter((j) => (j.subtasksDone ?? 0) < (j.subtaskCount ?? 0)).length;
    // "3 ready · 2 waiting" beats "5 jobs" -- but only once the feed actually
    // sends custom statuses. Until then readyCount is 0 and the old wording
    // stands, so a lagging feed reads as it always did rather than as "nothing
    // is ready".
    const readyCount = shown.filter((j) => jobReadiness(j.status) === "ready").length;

    // A job with NO SUBTASKS has nothing to localise -- showreels, case
    // studies, decks. They filled the card with rows that open a modal saying
    // "no subtasks in the feed". Hidden here, counted below: hiding is only
    // honest if the count stays visible.
    const localisable = shown.filter((j) => (j.subtaskCount ?? 0) > 0);
    const hiddenCount = shown.length - localisable.length;
    const localisableReady = localisable.filter((j) => jobReadiness(j.status) === "ready").length;
    // Only phrase it as ready/waiting once the feed actually sends statuses --
    // otherwise every row would read "waiting" purely because nothing is known.
    const anyStatusKnown = localisable.some((j) => jobReadiness(j.status) !== "unknown");

    return (
        <motion.div
            className="active-jobs"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.28 }}
        >
            <button
                type="button"
                className={open ? "active-jobs-toggle is-open" : "active-jobs-toggle"}
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
            >
                {/* THE CARD'S OWN HEADER ICON, because this surface has no
                    registry entry and so no tool page to carry one -- the same
                    reason the two hubs carry theirs in their own top bar.
                    Without it a clip named ActiveJobs.mp4 sits in _tuts with
                    nowhere to be played from.

                    Stops the toggle ONLY when there is a clip. TutorialIcon
                    marks itself `has-tutorial` exactly then, so with no clip
                    the click falls through and opens the card as it always
                    did -- which is what "the affordance only exists when the
                    clip does" has to mean for an icon inside a button. */}
                <span
                    role="presentation"
                    onClick={(e) => {
                        const el = e.target as HTMLElement;
                        if (el && el.closest && el.closest(".has-tutorial")) e.stopPropagation();
                    }}
                >
                    <TutorialIcon toolId="active-jobs" toolLabel="Active Jobs" className="active-jobs-icon" hover="pop">
                        <Briefcase size={16} />
                    </TutorialIcon>
                </span>
                <span className="active-jobs-title">Active Jobs</span>
                <span className="active-jobs-count">
                    {!listFor
                        ? "Machine not tagged"
                        : shown.length === 0
                        ? impersonating ? `Nothing assigned to ${listFor}` : "Nothing assigned to you"
                        : anyStatusKnown
                        ? `${localisableReady} ready · ${localisable.length - localisableReady} waiting`
                        : `${localisable.length} job${localisable.length === 1 ? "" : "s"}${openCount ? ` · ${openCount} to build` : ""}`}
                </span>
                {jobsMock && (
                    <Tooltip text={jobsError || "No jobs feed connected, showing sample data. Click to connect."}>
                        <span
                            className="active-jobs-pill"
                            role="button"
                            tabIndex={-1}
                            onClick={(e) => {
                                e.stopPropagation();
                                setOpen(true);
                                setSetupOpen(true);
                            }}
                        >
                            sample
                        </span>
                    </Tooltip>
                )}
                <span className="active-jobs-spacer" />
                {/* Whose list this is. Sits beside refresh rather than behind
                    "Feed settings" -- checking a colleague's queue is a normal
                    thing to do, not a configuration change. Stops propagation
                    so opening it doesn't also collapse the card. */}
                <span
                    className={impersonating ? "active-jobs-who is-other" : "active-jobs-who"}
                    onClick={(e) => e.stopPropagation()}
                    role="presentation"
                >
                    <Droplet
                        panelClassName="active-jobs-who-panel"
                        trigger={({ toggle }) => (
                            <span
                                className="active-jobs-who-trigger"
                                role="button"
                                tabIndex={0}
                                onClick={() => { toggle(); loadRoster(); }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); loadRoster(); }
                                }}
                            >
                                <Users size={13} />
                                {impersonating ? listFor : "You"}
                            </span>
                        )}
                    >
                        {(close) => (
                          <>
                        <p className="droplet-title">Whose jobs</p>
                        <button
                            type="button"
                            className={impersonating ? "active-jobs-who-item" : "active-jobs-who-item is-current"}
                            onClick={() => { close(); viewAsMember(""); }}
                        >
                            {!impersonating && <Check size={12} />}
                            {owner || "You"}
                        </button>
                        {roster === null ? (
                            <p className="hint">Reading the team folder…</p>
                        ) : roster.length === 0 ? (
                            <p className="hint">No team folder set, or the share isn't mounted.</p>
                        ) : (
                            roster
                                .filter((n) => n.toLowerCase() !== (owner || "").toLowerCase())
                                .map((n) => (
                                    <button
                                        key={n}
                                        type="button"
                                        className={listFor === n ? "active-jobs-who-item is-current" : "active-jobs-who-item"}
                                        onClick={() => { close(); viewAsMember(n); }}
                                    >
                                        {listFor === n && <Check size={12} />}
                                        {n}
                                    </button>
                                ))
                        )}
                          </>
                        )}
                    </Droplet>
                </span>
                <Tooltip text="Re-read the jobs feed">
                    <span
                        className={busy ? "active-jobs-age is-busy" : "active-jobs-age"}
                        role="button"
                        tabIndex={-1}
                        onClick={doRefresh}
                    >
                        <RefreshCw size={13} /> {busy ? "…" : "refresh"}
                    </span>
                </Tooltip>
                <ChevronDown size={15} className="active-jobs-caret" />
            </button>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        className="active-jobs-body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                        {(setupOpen || (jobsMock && open)) && (
                            <div className="active-jobs-setup">
                                <p className="active-jobs-setup-lead">
                                    Already set up. These only need changing if the feed moves.
                                </p>
                                <label className="active-jobs-field">
                                    <span>Feed URL</span>
                                    <input
                                        type="text"
                                        value={setupUrl}
                                        placeholder="https://your-worker-url/api/panel/jobs"
                                        onChange={(e) => setSetupUrl(e.target.value)}
                                    />
                                </label>
                                <label className="active-jobs-field">
                                    <span>Panel key</span>
                                    <input
                                        type="password"
                                        value={setupKey}
                                        placeholder="leave blank to keep the saved key"
                                        onChange={(e) => setSetupKey(e.target.value)}
                                    />
                                </label>
                                <label className="active-jobs-field">
                                    <span>View as</span>
                                    <input
                                        type="text"
                                        value={setupViewAs}
                                        placeholder="optional, a colleague's name, to preview their list"
                                        onChange={(e) => setSetupViewAs(e.target.value)}
                                    />
                                </label>
                                <div className="active-jobs-setup-actions">
                                    {setupNote && <span className="active-jobs-setup-note">{setupNote}</span>}
                                    <span className="active-jobs-spacer" />
                                    {/* There was no way OUT of this panel short of
                                        connecting — opening it by accident trapped
                                        you in it. */}
                                    <button
                                        type="button"
                                        className="active-jobs-cancel"
                                        disabled={setupBusy}
                                        onClick={() => { setSetupOpen(false); setSetupNote(""); }}
                                    >
                                        Close
                                    </button>
                                    <button type="button" className="active-jobs-save" disabled={setupBusy} onClick={saveSetup}>
                                        {setupBusy ? "Checking…" : "Connect"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Only when there is a reason to. The URL and key ship
                            with the panel, so a healthy feed needs no setup at
                            all -- a permanent settings chip on the home screen
                            was inviting people to fiddle with something already
                            correct. It reappears the moment the feed errors. */}
                        {!jobsMock && !setupOpen && (jobsError || impersonating) && (
                            <button
                                type="button"
                                className="active-jobs-settings"
                                onClick={() => setSetupOpen(true)}
                            >
                                {impersonating ? "Viewing as someone else" : "Fix feed settings"}
                            </button>
                        )}

                        {impersonating && (
                            <p className="active-jobs-viewas">
                                Viewing <strong>{listFor}</strong>'s jobs, not your own. Clear the “View as” field to go
                                back. Your Team tag is untouched. Nothing is posted or synced as {listFor}.
                            </p>
                        )}

                        {!listFor ? (
                            <p className="active-jobs-empty">
                                This machine isn't tagged with a member name, so there's no "you" to filter by. Tag it
                                from the Team menu and your jobs will appear here.
                            </p>
                        ) : localisable.length === 0 ? (
                            <p className="active-jobs-empty">
                                {hiddenCount > 0
                                    ? `Nothing to localise for ${listFor}, ${hiddenCount} job${hiddenCount === 1 ? " has" : "s have"} no deliverables.`
                                    : `Nothing in the feed is assigned to ${listFor}.`}
                            </p>
                        ) : (
                            <ul className="active-jobs-list">
                                {localisable.map((job) => {
                                    const parts = parseJobTitle(job.title);
                                    const flag = territoryFlag(parts.territory);
                                    // job.status carries the CUSTOM Wrike status the feed
                                    // resolves ("Render review"), not the base group.
                                    const readiness = jobReadiness(job.status);
                                    const total = job.subtaskCount ?? 0;
                                    const done = job.subtasksDone ?? 0;
                                    return (
                                        <li key={job.id}>
                                            <button
                                                type="button"
                                                className="active-jobs-row"
                                                onClick={() => setOpenJob(job)}
                                                title={job.title}
                                            >
                                                {/* Flag AND code, never flag alone: at 12px several
                                                    flags are hard to tell apart, and the code is what
                                                    people actually say out loud. The flag just makes
                                                    the row findable. Falls back to the pin icon when
                                                    the token isn't a real two-letter territory. */}
                                                {flag ? (
                                                    <span className="active-jobs-flag" aria-hidden="true">{flag}</span>
                                                ) : (
                                                    <MapPin size={12} className="active-jobs-pin" />
                                                )}
                                                <span className="active-jobs-terr">
                                                    {parts.territory || parts.film || "—"}
                                                </span>
                                                <span className="active-jobs-name">{parts.name || job.title}</span>
                                                {parts.batch && <span className="active-jobs-batch">{parts.batch}</span>}
                                                {/* Coloured by WORKFLOW, matching TimeHub, so a
                                                    status looks the same in both places. Readiness
                                                    (ready/waiting/done) is carried by the header
                                                    count and the send button rather than by this
                                                    chip -- one colour can't say two things. */}
                                                {readiness !== "unknown" && (
                                                    <span
                                                        className={`active-jobs-state is-${readiness}`}
                                                        style={statusTint(job.status)}
                                                    >
                                                        {job.status}
                                                    </span>
                                                )}
                                                {/* No bar. "4 left / 12" is the number people act
                                                    on, and a fill behind it read as progress toward
                                                    delivery when it only ever counted ticked
                                                    subtasks -- a meter nobody trusted. */}
                                                {total > 0 && (
                                                    <span className="active-jobs-left">
                                                        {total - done} left
                                                        <span className="active-jobs-of"> / {total}</span>
                                                    </span>
                                                )}
                                                <ChevronRight size={13} className="active-jobs-chev" />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                    </motion.div>
                )}
            </AnimatePresence>
            {openJob && (
                <ActiveJobModal
                    job={openJob}
                    onClose={() => setOpenJob(null)}
                    onOpenLocaliser={() => {
                        setOpenJob(null);
                        onOpen();
                    }}
                />
            )}
        </motion.div>
    );
};

export default ActiveJobs;
