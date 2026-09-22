// =============================================================================
// src/js/main/WorkflowTutorial.tsx
// -----------------------------------------------------------------------------
// The clip and the checklist, at once.
//
// A tutorial is followed by DOING the steps, so a player that covers them is a
// player you have to keep closing. The steps sit OVER the picture from the
// bottom, like subtitles: the one you are on, the one coming, and nothing
// else -- a column down the side spent a third of the screen on steps you had
// already done. The list icon opens the lot when you need to mark them.
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
import { X, MapPin, Check, Save, ListChecks } from "lucide-react";
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
    /** Every step, rather than just the one you are on. Marking wants the list;
     *  following it does not. */
    const [expanded, setExpanded] = useState(false);

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

    // What is on screen when the strip is closed: the step you are on, and the
    // one coming, so you can see it arriving.
    const shown = expanded
        ? steps.map((s2, i) => ({ s: s2, i }))
        : steps.map((s2, i) => ({ s: s2, i })).filter(({ i }) => i === current || i === current + 1 || (current === -1 && i === 0));

    return createPortal(
        <div className="wft-overlay" style={style} onClick={onClose} role="presentation">
            <div className="wft" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
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

                <div className="wft-top">
                    <span className="wft-title">{title}</span>
                    <Tooltip text={expanded ? "Show just the step you are on" : "Show every step"}>
                        <button type="button" className="wft-icon" onClick={() => setExpanded((v) => !v)} aria-label="All steps">
                            <ListChecks size={13} />
                        </button>
                    </Tooltip>
                    <button type="button" className="wft-icon" onClick={onClose} aria-label="Close">
                        <X size={14} />
                    </button>
                </div>

                {/* OVER THE PICTURE, FROM THE BOTTOM — like a subtitle, because
                    that is the job: a line you read without looking away. It
                    clears the video's own controls rather than fighting them. */}
                <div className={"wft-strip" + (expanded ? " is-open" : "")}>
                    {shown.map(({ s: st, i }) => {
                        const at = markOf(st);
                        const done = !!ticks[st.id];
                        return (
                            <div
                                key={st.id}
                                className={"wft-line"
                                    + (i === current ? " is-current" : "")
                                    + (current > -1 && i < current ? " is-past" : "")
                                    + (done ? " is-done" : "")}
                            >
                                <button type="button" className="wft-tick" onClick={() => onTick(st.id)} aria-label={done ? "Not done" : "Done"}>
                                    {done ? <Check size={11} /> : <span>{i + 1}</span>}
                                </button>
                                <button
                                    type="button"
                                    className="wft-text"
                                    onClick={() => seek(at)}
                                    title={at !== undefined ? `Jump to ${clock(at)}` : "No mark on this step yet"}
                                >
                                    {st.text}
                                </button>
                                {at !== undefined && <span className="wft-at">{clock(at)}</span>}
                                {onSaveMarks && (
                                    <Tooltip text="Mark this step at the clip's current time">
                                        <button type="button" className="wft-mark" onClick={() => mark(st.id)} aria-label="Mark here">
                                            <MapPin size={10} />
                                        </button>
                                    </Tooltip>
                                )}
                            </div>
                        );
                    })}
                    {steps.length === 0 && <div className="wft-line wft-empty">This workflow has no steps yet.</div>}

                    {onSaveMarks && dirty && (
                        <button type="button" className="wft-save" disabled={saving} onClick={save}>
                            <Save size={12} /> <span>{saving ? "Saving…" : "Save marks for the team"}</span>
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default WorkflowTutorial;
