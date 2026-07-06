// =============================================================================
// src/js/main/SfxDroplet.tsx
// -----------------------------------------------------------------------------
// Home-screen sound-effects control -- a speaker icon that opens an anchored
// Droplet (same pattern as TimeTrackerDroplet/Toolset's pickers) containing
// an on/off switch and a master volume slider, instead of a plain toggle
// button. Volume was previously immutable (each preset sound had its own
// fixed gain in sfx.ts, no overall control) -- sfx.ts now multiplies every
// sound's gain by a master volume (sfx.setVolume/getVolume), which this is
// the UI for.
//
// Both enabled + volume are persisted via app.settings (loadSfxEnabled/
// saveSfxEnabled/loadSfxVolume/saveSfxVolume in aeft.ts) and loaded once here
// on mount -- sfx.ts's `enabled`/`masterVolume` are module-level, so once set
// they hold for the whole session regardless of which screen is showing,
// same pattern as hooks/useTimeTracker.ts.
// =============================================================================
import React, { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import Droplet from "./Droplet";
import Tooltip from "./Tooltip";
import CheckboxToggle from "./CheckboxToggle";
import { sfx } from "../lib/utils/sfx";
import { evalTS } from "../lib/utils/bolt";
import "./SfxDroplet.scss";

const SfxDroplet: React.FC = () => {
    const [enabled, setEnabledState] = useState(false);
    const [volume, setVolumeState] = useState(1);

    useEffect(() => {
        (async () => {
            try {
                const [e, v] = await Promise.all([evalTS("loadSfxEnabled"), evalTS("loadSfxVolume")]);
                if (typeof e === "boolean") { sfx.setEnabled(e); setEnabledState(e); }
                if (typeof v === "number") { sfx.setVolume(v); setVolumeState(v); }
            } catch {
                // browser preview -- stays off at default volume
            }
        })();
    }, []);

    const toggleEnabled = () => {
        const next = !enabled;
        sfx.setEnabled(next);
        setEnabledState(next);
        if (next) sfx.click(); // audible confirmation that it's now on
        evalTS("saveSfxEnabled", next).catch(() => {});
    };

    // Live feedback while dragging (input fires continuously); persisted
    // only once the user releases the slider (change fires on release for
    // range inputs), so adjusting volume doesn't spam app.settings writes.
    const onVolumeInput = (v: number) => {
        sfx.setVolume(v);
        setVolumeState(v);
    };
    const onVolumeCommit = (v: number) => {
        evalTS("saveSfxVolume", v).catch(() => {});
        if (enabled) sfx.click(); // preview the new level
    };

    return (
        <Droplet
            panelClassName="sfx-droplet-panel"
            trigger={({ toggle }) => (
                <Tooltip text={enabled ? "Sound effects on" : "Sound effects off"}>
                    <button className={enabled ? "favorites-toggle active" : "favorites-toggle"} onClick={toggle}>
                        {enabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    </button>
                </Tooltip>
            )}
        >
            {() => (
                <div className="sfx-droplet-body">
                    <CheckboxToggle checked={enabled} onChange={toggleEnabled} label="Sound Effects" />
                    <div className={"sfx-volume-row" + (enabled ? "" : " disabled")}>
                        <VolumeX size={12} />
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round(volume * 100)}
                            disabled={!enabled}
                            onInput={(e) => onVolumeInput(Number((e.target as HTMLInputElement).value) / 100)}
                            onChange={(e) => onVolumeCommit(Number((e.target as HTMLInputElement).value) / 100)}
                        />
                        <Volume2 size={13} />
                    </div>
                </div>
            )}
        </Droplet>
    );
};

export default SfxDroplet;
