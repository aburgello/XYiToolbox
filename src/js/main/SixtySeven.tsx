// =============================================================================
// src/js/main/SixtySeven.tsx
// -----------------------------------------------------------------------------
// 67 -- the master for the comp you are in, with this creative's pitfalls
// pinned to the seconds they happen.
//
// FOR CHECKING YOUR OWN WORK, before it goes anywhere. What gets missed is
// nearly always something somebody already knows ("the date card clips on the
// 2L version"), known by whoever hit it last week. So the warnings live with
// the creative, travel with the team board, and arrive at the second they
// matter rather than in a document nobody opens.
//
// NO RENDER IS A NORMAL ANSWER. Plenty of creatives have no mp4 where OV
// Library looks; the notes are the point and they show either way.
//
// Singleton host + a show() call, the same shape as McItReportModal: this is
// opened from a Toolset card, and a card cannot hold a modal of its own.
// =============================================================================
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, MapPin, Plus, Film, AlertCircle, Loader2 } from "lucide-react";
import { toFileUrl } from "./lib/fileUrl";
import { evalTS } from "../lib/utils/bolt";
import { evalTSSafe } from "../lib/utils/evalTSSafe";
import Tooltip from "./Tooltip";
import "./WorkflowTutorial.scss";
import "./SixtySeven.scss";

interface Ctx {
    success: boolean;
    error?: string;
    compName?: string;
    creative?: string;
    size?: string;
    duration?: string;
    territory?: string;
    campaign?: string;
    masterName?: string;
    renders?: { stem: string; path: string }[];
}

interface Note {
    id: string;
    text: string;
    author: string;
    stamp: string;
    territory?: string;
    at?: number;
    atDuration?: string;
}

interface Entry {
    key: string;
    campaign: string;
    creative: string;
    notes: Note[];
}

const clock = (s: number) => {
    const t = Math.max(0, Math.floor(s));
    return Math.floor(t / 60) + ":" + (t % 60 < 10 ? "0" : "") + (t % 60);
};

/** Upper-case alphanumerics — matches team.ts's workflowCanon. */
const canon = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Bare digits, so "15", "15s" and "15sec" are one duration. */
const durKey = (s: string) => String(s || "").replace(/[^0-9]/g, "");

let pushOpen: ((open: boolean) => void) | null = null;
export function showSixtySeven(): void {
    pushOpen?.(true);
}

export const SixtySevenHost: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [ctx, setCtx] = useState<Ctx | null>(null);
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(false);
    const [now, setNow] = useState(0);
    const [videoFailed, setVideoFailed] = useState(false);
    const [draft, setDraft] = useState("");
    const [draftAt, setDraftAt] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        pushOpen = setOpen;
        return () => { pushOpen = null; };
    }, []);

    /** The comp, its master, its renders, and the creative's notes. */
    const load = useCallback(async () => {
        setLoading(true);
        setVideoFailed(false);
        try {
            const c = (await evalTSSafe("sixtySevenContext")) as unknown as Ctx;
            setCtx(c);
            if (!c || !c.success || !c.creative) { setNotes([]); return; }
            const board = (await evalTS("workflowBoardLoad")) as { success?: boolean; entries?: Entry[] };
            const entries = (board && board.entries) || [];
            const base = canon(c.campaign || "") + "|" + canon(c.creative);
            const mine: Note[] = [];
            entries.forEach((e) => {
                // Every workflow of this creative: notes belong to the creative,
                // not to one of its boards (see team.ts's workflowBaseKeyOf).
                // The campaign half is only compared when we know it — 67 can
                // identify a creative without having placed its campaign.
                const key = String(e.key || "");
                const hit = c.campaign
                    ? (key === base || key.indexOf(base + "|") === 0)
                    : canon(e.creative) === canon(c.creative || "");
                if (!hit) return;
                (e.notes || []).forEach((n) => mine.push(n));
            });
            setNotes(mine);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        setNow(0);
        setDraft("");
        setDraftAt(null);
        void load();
    }, [open, load]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    if (!open) return null;

    const render = ctx && ctx.renders && ctx.renders.length ? ctx.renders[0] : null;
    const thisDuration = durKey(ctx?.duration || "");

    // A TIME ONLY COUNTS AGAINST THE CUT IT WAS MADE ON. 0:05 of the 15s master
    // is a different beat from 0:05 of the 30s, so a note timed on another
    // length is listed without its time rather than fired at the wrong second.
    const timed = notes.filter((n) => typeof n.at === "number" && (!n.atDuration || durKey(n.atDuration) === thisDuration))
        .sort((a, b) => (a.at || 0) - (b.at || 0));
    const untimed = notes.filter((n) => timed.indexOf(n) === -1);

    const live = timed.filter((n) => (n.at || 0) <= now + 0.05 && (n.at || 0) > now - 6);

    const seek = (at?: number) => {
        const v = videoRef.current;
        if (!v || at === undefined) return;
        v.currentTime = at;
        void v.play();
    };

    const addNote = async () => {
        const body = draft.trim();
        if (!body || !ctx || !ctx.creative) return;
        setSaving(true);
        try {
            const r = (await evalTSSafe(
                "workflowAddTimedNote",
                ctx.campaign || "",
                ctx.creative,
                body,
                ctx.territory || "",
                draftAt === null ? -1 : draftAt,
                draftAt === null ? "" : (ctx.duration || "")
            )) as { success: boolean; error?: string };
            if (!r || !r.success) return;
            setDraft("");
            setDraftAt(null);
            await load();
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="wft-overlay s67-overlay" onClick={() => setOpen(false)} role="presentation">
            <div className="wft s67" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="67">
                {render && !videoFailed ? (
                    <video
                        ref={videoRef}
                        src={toFileUrl(render.path)}
                        controls
                        onTimeUpdate={(e) => setNow((e.currentTarget as HTMLVideoElement).currentTime)}
                        onError={() => setVideoFailed(true)}
                    />
                ) : (
                    <div className="s67-noclip">
                        {loading ? <Loader2 size={20} /> : <Film size={20} />}
                        <p>
                            {loading
                                ? "Looking for the master…"
                                : ctx && ctx.success
                                    ? `No playable render for ${ctx.masterName || ctx.creative}. The notes are below.`
                                    : (ctx && ctx.error) || "Nothing to show."}
                        </p>
                    </div>
                )}

                <div className="wft-top">
                    <span className="wft-title">
                        {ctx && ctx.success
                            ? `${ctx.creative}${ctx.size ? " · " + ctx.size : ""}${ctx.duration ? " · " + ctx.duration : ""}`
                            : "67"}
                    </span>
                    <button type="button" className="wft-icon" onClick={() => setOpen(false)} aria-label="Close">
                        <X size={14} />
                    </button>
                </div>

                {/* The ones whose moment has just come, over the picture. */}
                {live.length > 0 && (
                    <div className="wft-strip s67-live">
                        {live.map((n) => (
                            <div key={n.id} className="wft-line is-current is-arriving">
                                <span className="s67-at">{clock(n.at || 0)}</span>
                                <span className="wft-text s67-static">{n.text}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="s67-notes">
                    <div className="s67-add">
                        <input
                            type="text"
                            value={draft}
                            placeholder={draftAt === null ? "Add a pitfall for this creative…" : `Add a pitfall at ${clock(draftAt)}…`}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") void addNote(); }}
                        />
                        <Tooltip text={render ? "Pin it to where the clip is now" : "No clip to take a time from"}>
                            <button
                                type="button"
                                className={"s67-pin" + (draftAt !== null ? " is-on" : "")}
                                disabled={!render}
                                onClick={() => setDraftAt(draftAt === null ? Math.max(0, videoRef.current?.currentTime || 0) : null)}
                                aria-label="Pin to the current time"
                            >
                                <MapPin size={12} />
                            </button>
                        </Tooltip>
                        <button type="button" className="s67-save" disabled={saving || !draft.trim()} onClick={addNote}>
                            <Plus size={12} /> <span>{saving ? "Saving…" : "Add"}</span>
                        </button>
                    </div>

                    <div className="s67-list">
                        {timed.map((n) => (
                            <button key={n.id} type="button" className="s67-note" onClick={() => seek(n.at)}>
                                <span className="s67-at">{clock(n.at || 0)}</span>
                                <span className="s67-text">{n.text}</span>
                                <span className="s67-by">{n.author}</span>
                            </button>
                        ))}
                        {untimed.map((n) => (
                            <div key={n.id} className="s67-note is-untimed">
                                <span className="s67-at">—</span>
                                <span className="s67-text">{n.text}</span>
                                <span className="s67-by">{n.author}</span>
                            </div>
                        ))}
                        {!loading && notes.length === 0 && (
                            <p className="s67-empty">
                                <AlertCircle size={12} /> Nothing written down for {ctx?.creative || "this creative"} yet — add the first one.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default SixtySevenHost;
