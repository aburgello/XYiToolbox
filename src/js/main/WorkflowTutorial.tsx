// =============================================================================
// src/js/main/WorkflowTutorial.tsx
// -----------------------------------------------------------------------------
// The clip and the checklist, at once.
//
// A tutorial is followed by DOING the steps, so a player that covers them is a
// player you have to keep closing. The steps sit over the video, the one you
// are on is lit and the ones behind fade back.
//
// THE MARKS ARE WHAT MAKE IT FOLLOW. A step can carry `at` -- a second in the
// clip -- and the list then advances itself as the video plays. Nothing knows
// those times but the person who recorded it, so they press "mark here" once
// per step and save it for everybody. With no marks the list is still there,
// still tickable, just not moving on its own: no marks is a normal state, not
// a broken one.
// =============================================================================
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Play, MapPin, Check, Save } from "lucide-react";
import { toFileUrl } from "./lib/fileUrl";
import Tooltip from "./Tooltip";
import "./WorkflowTutorial.scss";

export interface TutorialStep {
    id: string;
    text: string;
    /** Seconds into the clip where this step starts, when somebody marked it. */
    at?: number;
}

/** 83 -> "1:23". */
const clock = (s: number) => {
    const t = Math.max(0, Math.floor(s));
    return Math.floor(t / 60) + ":" + (t % 60 < 10 ? "0" : "") + (t % 60);
};

const WorkflowTutorial: React.FC<{
    path: string;
    title: string;
    steps: TutorialStep[];
    /** Per-machine done state, keyed by step id. */
    ticks: Record<string, boolean>;
    onTick: (stepId: string) => void;
    /** Save the marks for the team. Absent while the board is busy saving. */
    onSaveMarks?: (marks: Record<string, number>) => Promise<void> | void;
    onClose: () => void;
    /** Category tint, re-applied because this portals outside the tool. */
    style?: React.CSSProperties;
}> = ({ path, title, steps, ticks, onTick, onSaveMarks, onClose, style }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [now, setNow] = useState(0);
    const [failed, setFailed] = useState(false);
    /** Marks made in this sitting, not yet saved. */
    const [draftMarks, setDraftMarks] = useState<Record<string, number>>({});
    const [saving, setSaving] = useState(false);

    const markOf = (s: TutorialStep) => (draftMarks[s.id] !== undefined ? draftMarks[s.id] : s.at);
    const dirty = Object.keys(draftMarks).length > 0;

    // THE STEP THE CLIP IS ON: the last marked step whose time has passed.
    // Unmarked steps never become current on their own — they would jump the
    // list to a position the video has not reached.
    let current = -1;
    steps.forEach((s, i) => {
        const at = markOf(s);
        if (at !== undefined && at <= now + 0.05) current = i;
    });

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const seek = useCallback((at?: number) => {
        const v = videoRef.current;
        if (!v || at === undefined) return;
        v.currentTime = at;
        void v.play();
    }, []);

    const mark = (id: string) => {
        const v = videoRef.current;
        if (!v) return;
        setDraftMarks((prev) => ({ ...prev, [id]: Math.max(0, v.currentTime) }));
    };

    const save = async () => {
        if (!onSaveMarks || !dirty) return;
        setSaving(true);
        try {
            const all: Record<string, number> = {};
            steps.forEach((s) => {
                const at = markOf(s);
                if (at !== undefined) all[s.id] = at;
            });
            await onSaveMarks(all);
            setDraftMarks({});
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="wft-overlay" style={style} onClick={onClose} role="presentation">
            <div className="wft" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
                <div className="wft-video">
                    {failed ? (
                        <p className="wft-error">
                            Couldn’t open this clip. If it lives on somebody’s desktop, other machines can’t reach it —
                            put it on the team share.
                        </p>
                    ) : (
                        <video
                            ref={videoRef}
                            src={toFileUrl(path)}
                            controls
                            autoPlay
                            onTimeUpdate={(e) => setNow((e.currentTarget as HTMLVideoElement).currentTime)}
                            onError={() => setFailed(true)}
                        />
                    )}
                </div>

                <div className="wft-side">
                    <div className="wft-head">
                        <span className="wft-title">{title}</span>
                        <button type="button" className="wft-close" onClick={onClose} aria-label="Close">
                            <X size={14} />
                        </button>
                    </div>

                    <ol className="wft-steps">
                        {steps.map((s, i) => {
                            const at = markOf(s);
                            const done = !!ticks[s.id];
                            // BEHIND YOU, not gone: faded rather than hidden, so
                            // the shape of the whole job stays readable.
                            const past = current > -1 && i < current;
                            return (
                                <li
                                    key={s.id}
                                    className={"wft-step"
                                        + (i === current ? " is-current" : "")
                                        + (past ? " is-past" : "")
                                        + (done ? " is-done" : "")}
                                >
                                    <button
                                        type="button"
                                        className="wft-tick"
                                        onClick={() => onTick(s.id)}
                                        aria-label={done ? "Not done" : "Done"}
                                    >
                                        {done ? <Check size={11} /> : <span>{i + 1}</span>}
                                    </button>
                                    <button
                                        type="button"
                                        className="wft-text"
                                        onClick={() => seek(at)}
                                        title={at !== undefined ? `Jump to ${clock(at)}` : "No mark on this step yet"}
                                    >
                                        {s.text}
                                    </button>
                                    {at !== undefined && <span className="wft-at">{clock(at)}</span>}
                                    {onSaveMarks && (
                                        <Tooltip text="Mark this step at the clip's current time">
                                            <button type="button" className="wft-mark" onClick={() => mark(s.id)} aria-label="Mark here">
                                                <MapPin size={10} />
                                            </button>
                                        </Tooltip>
                                    )}
                                </li>
                            );
                        })}
                        {steps.length === 0 && <li className="wft-empty">This workflow has no steps yet.</li>}
                    </ol>

                    {onSaveMarks && (
                        <div className="wft-foot">
                            {dirty ? (
                                <button type="button" className="wft-save" disabled={saving} onClick={save}>
                                    <Save size={12} /> <span>{saving ? "Saving…" : "Save marks for the team"}</span>
                                </button>
                            ) : (
                                <span className="wft-hint">
                                    <Play size={10} /> Marks make the list follow the clip — set one per step.
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default WorkflowTutorial;
