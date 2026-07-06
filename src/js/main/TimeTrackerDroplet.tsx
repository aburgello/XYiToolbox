// =============================================================================
// src/js/main/TimeTrackerDroplet.tsx
// -----------------------------------------------------------------------------
// Home-screen quick-launch widget for the Timesheet Tracker's Batch mode --
// a Clock icon next to Favorites/Folders that opens an anchored Droplet
// (not the push-down flyout pattern those two use) so starting a batch never
// requires leaving Home. Reads/drives the SAME shared store
// (hooks/useTimeTracker.ts) the full Tools > Timesheet Tracker page uses, so
// a batch started here is the exact batch you land on if you open the full
// page, live timer included -- not a separate mini-tracker.
//
// Deliberately minimal: create/start a batch, or Start/Pause the one that's
// already running. Anything else (switching between several batches, the
// file list, adjusting minutes, generating JSON) is a tap away via "Open
// Tracker" rather than replicated here -- a home-screen popover is the wrong
// place for that much surface.
// =============================================================================
import React from "react";
import { Clock, Play, Pause, PlusCircle, ArrowUpRight } from "lucide-react";
import Droplet from "./Droplet";
import Tooltip from "./Tooltip";
import { useTimeTracker, digitalCategories, defaultCategoryFor } from "./hooks/useTimeTracker";
import { promptDialog } from "./Dialog";
import { evalTS } from "../lib/utils/bolt";
import "./TimeTrackerDroplet.scss";

function formatTime(totalSeconds: number): string {
    const s = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = (n: number) => (n < 10 ? "0" + n : String(n));
    return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
}

interface Props {
    onOpenFullTracker: () => void;
}

const TimeTrackerDroplet: React.FC<Props> = ({ onOpenFullTracker }) => {
    const tracker = useTimeTracker();
    const batch = tracker.activeBatch;

    // Same "name it, we start it" flow the full page's New Batch uses, minus
    // the extra tap: creating a batch here also starts tracking immediately,
    // since the whole point of reaching for this widget is "start tracking
    // now" -- the full page still supports create-without-starting.
    const startNewBatch = async (close: () => void) => {
        let suggestion = "Batch";
        try {
            const info = await evalTS("timesheetActiveFile" as any);
            if (info && info.folderName) suggestion = info.folderName;
        } catch (e) { /* preview -- no bridge */ }
        const name = await promptDialog("Name this batch (auto-filled from the open file's folder):", suggestion);
        if (!name) return;
        await tracker.createBatch(name, defaultCategoryFor(digitalCategories(tracker.categories)));
        await tracker.startTracking();
        close();
    };

    // Reflects actual state instead of a static label, same idea as the
    // Sound Effects trigger's on/off tooltip -- so hovering the icon alone
    // (without opening the droplet) already tells you whether something's
    // running and, if so, which batch.
    const tooltipText = tracker.running
        ? `Timesheet — tracking "${batch?.name}"`
        : batch
            ? `Timesheet — "${batch.name}" paused`
            : "Timesheet";

    return (
        <Droplet
            panelClassName="ts-droplet-panel"
            trigger={({ open, toggle }) => (
                <Tooltip text={tooltipText}>
                    <button
                        className={"favorites-toggle ts-droplet-trigger" + (open || tracker.running ? " active" : "")}
                        onClick={toggle}
                    >
                        <Clock size={14} />
                        {tracker.running && <span className="ts-droplet-live-dot" />}
                    </button>
                </Tooltip>
            )}
        >
            {(close) => (
                <div className="ts-droplet-body">
                    <div className="ts-droplet-head">
                        <Clock size={13} />
                        <span>Timesheet</span>
                    </div>

                    {!batch ? (
                        <>
                            <p className="ts-droplet-hint">No batch running yet.</p>
                            <button className="ts-droplet-start-new" onClick={() => startNewBatch(close)}>
                                <PlusCircle size={14} /> Start a Batch
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="ts-droplet-batch-name">{batch.name}</div>
                            <div className="ts-droplet-timer">{formatTime(tracker.batchTotal)}</div>
                            <button className="ts-droplet-toggle" onClick={tracker.running ? tracker.pauseTracking : tracker.startTracking}>
                                {tracker.running ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Resume</>}
                            </button>
                            {tracker.running && (
                                <p className="ts-droplet-status">
                                    {tracker.activePath ? "Tracking the open file…" : "Open a saved project to log time to it."}
                                </p>
                            )}
                            {tracker.batches.length > 1 && (
                                <p className="ts-droplet-more">+{tracker.batches.length - 1} other batch{tracker.batches.length - 1 === 1 ? "" : "es"} — manage in the full tracker.</p>
                            )}
                        </>
                    )}

                    <button className="ts-droplet-open-full" onClick={() => { onOpenFullTracker(); close(); }}>
                        Open Tracker <ArrowUpRight size={12} />
                    </button>
                </div>
            )}
        </Droplet>
    );
};

export default TimeTrackerDroplet;
