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
import { X, MapPin, Plus, Film, AlertCircle, Loader2, Layers, Trash2, TimerOff } from "lucide-react";
import { toFileUrl } from "./lib/fileUrl";
import { pickPreviewRender } from "./lib/renderPreview";
import { evalTS } from "../lib/utils/bolt";
import { evalTSSafe } from "../lib/utils/evalTSSafe";
import Tooltip from "./Tooltip";
import { confirmDialog } from "./Dialog";
import "./WorkflowTutorial.scss";
import "./SixtySeven.scss";

interface Ctx {
    success: boolean;
    creativeFolder?: string;
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
    /** The campaign the note's entry belongs to. Shown only when 67 could not
     *  place the comp's own campaign — two campaigns can carry a creative of
     *  the same name, so an unplaced one must say whose note this is. */
    _campaign?: string;
    /** Which entry holds it — needed to delete it. */
    _entryId?: string;
    text: string;
    author: string;
    stamp: string;
    territory?: string;
    at?: number;
    atDuration?: string;
}

interface Entry {
    id: string;
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
    const [dropping, setDropping] = useState(false);
    const [dropped, setDropped] = useState("");
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
            // THE FOLDER IS A SECOND SPELLING OF THE SAME CREATIVE. Street
            // Fighter's masters live in CharacterMotionPoster while the .aep
            // says Characters, and the Workflows picker lists folders — so a
            // board written there is this creative's board, and must be read
            // as one.
            const aliasBase = c.creativeFolder ? canon(c.campaign || "") + "|" + canon(c.creativeFolder) : "";
            const mine: Note[] = [];
            entries.forEach((e) => {
                // Every workflow of this creative: notes belong to the creative,
                // not to one of its boards (see team.ts's workflowBaseKeyOf).
                // The campaign half is only compared when we know it — 67 can
                // identify a creative without having placed its campaign.
                const key = String(e.key || "");
                const matches = (b: string) => !!b && (key === b || key.indexOf(b + "|") === 0);
                const hit = c.campaign
                    ? (matches(base) || matches(aliasBase))
                    : (canon(e.creative) === canon(c.creative || "") || canon(e.creative) === canon(c.creativeFolder || ""));
                if (!hit) return;
                (e.notes || []).forEach((n) => mine.push({ ...n, _campaign: e.campaign, _entryId: e.id }));
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

    // REVIEW'S OWN CHOOSER, not "the first one the scan found". A Renders
    // folder mixes ProRes MOVs Chromium cannot decode with the H.264 MP4s in
    // Support/Motion_Components/_MP4, and the exact-stem MOV sorts first --
    // so taking the first match played nothing and reported "no render" for a
    // master OV Library happily previews.
    const render = (ctx && ctx.renders && pickPreviewRender(ctx.renders)) || null;
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

    /**
     * Put the clip over the comp as a guide layer, and the timed notes on the
     * comp's marker track — the panel closes, the reminders stay.
     */
    const dropIn = async () => {
        setDropping(true);
        try {
            const r = (await evalTSSafe(
                "sixtySevenDropIn",
                render ? render.path : "",
                JSON.stringify(timed.map((n) => ({ text: n.text, at: n.at })))
            )) as { success: boolean; error?: string; message?: string };
            setDropped(r && r.success ? (r.message || "Added.") : (r && r.error) || "Couldn't add it.");
        } finally {
            setDropping(false);
        }
    };

    /** Move a note's time to where the clip is, or take the time off. */
    const setNoteTime = async (n: Note, at: number | null) => {
        const r = (await evalTSSafe(
            "workflowSetNoteTime",
            n.id,
            at === null ? -1 : at,
            at === null ? "" : (ctx?.duration || "")
        )) as { success: boolean; error?: string };
        if (r && r.success) await load();
    };

    const removeNote = async (n: Note) => {
        if (!n._entryId) return;
        const ok = await confirmDialog({
            title: "Delete this pitfall for everyone?",
            body: "“" + n.text + "”",
            confirm: "Delete",
            danger: true,
        });
        if (!ok) return;
        const r = (await evalTSSafe("workflowDeleteNote", n._entryId, n.id)) as { success: boolean };
        if (r && r.success) await load();
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
                draftAt === null ? "" : (ctx.duration || ""),
                // The folder's spelling, so a note lands on the board the team
                // already has rather than starting a second one.
                ctx.creativeFolder || ""
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
                                    ? `No playable render for ${ctx.masterName || ctx.creative}${(ctx.renders || []).length ? " (only formats this panel can't decode)" : ""}. The notes are below.`
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
                    {/* Only when there is something to put there. */}
                    {ctx && ctx.success && (render || timed.length > 0) && (
                        <Tooltip text={`Adds ${render ? "the master as a guide layer (it never renders) and " : ""}${timed.length} marker${timed.length === 1 ? "" : "s"} to the comp you are in. Press again to replace them.`}>
                            <button type="button" className="s67-drop" disabled={dropping} onClick={dropIn}>
                                <Layers size={12} />
                                <span>{dropping ? "Adding…" : "Add to comp"}</span>
                            </button>
                        </Tooltip>
                    )}
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
                            <div key={n.id} className="s67-note">
                                <button type="button" className="s67-jump" onClick={() => seek(n.at)} title={`Jump to ${clock(n.at || 0)}`}>
                                    <span className="s67-at">{clock(n.at || 0)}</span>
                                    <span className="s67-text">{n.text}</span>
                                </button>
                                <span className="s67-by">{!ctx?.campaign && n._campaign ? n._campaign + " · " : ""}{n.author}</span>
                                <span className="s67-rowacts">
                                    <Tooltip text="Move it to where the clip is now">
                                        <button type="button" className="s67-rowbtn" disabled={!render} onClick={() => setNoteTime(n, Math.max(0, videoRef.current?.currentTime || 0))} aria-label="Move the time">
                                            <MapPin size={10} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip text="Take the time off — it stays as a general note">
                                        <button type="button" className="s67-rowbtn" onClick={() => setNoteTime(n, null)} aria-label="Clear the time">
                                            <TimerOff size={10} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip text="Delete this pitfall for the team">
                                        <button type="button" className="s67-rowbtn s67-rowbtn--danger" onClick={() => removeNote(n)} aria-label="Delete">
                                            <Trash2 size={10} />
                                        </button>
                                    </Tooltip>
                                </span>
                            </div>
                        ))}
                        {/* THE UNTIMED ONES ARE A DIFFERENT KIND OF THING --
                            standing advice rather than a moment — and notes
                            written before 67 existed are all of them. */}
                        {timed.length > 0 && untimed.length > 0 && (
                            <p className="s67-sep">Anywhere in the piece</p>
                        )}
                        {untimed.map((n) => (
                            <div key={n.id} className="s67-note is-untimed">
                                <span className="s67-at">—</span>
                                <span className="s67-text">{n.text}</span>
                                <span className="s67-by">{!ctx?.campaign && n._campaign ? n._campaign + " · " : ""}{n.author}</span>
                                <span className="s67-rowacts">
                                    {/* A NOTE WRITTEN BEFORE 67 EXISTED can be given
                                        a time now — which is most of them. */}
                                    <Tooltip text={render ? "Pin it to where the clip is now" : "No clip to take a time from"}>
                                        <button type="button" className="s67-rowbtn" disabled={!render} onClick={() => setNoteTime(n, Math.max(0, videoRef.current?.currentTime || 0))} aria-label="Pin to the current time">
                                            <MapPin size={10} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip text="Delete this pitfall for the team">
                                        <button type="button" className="s67-rowbtn s67-rowbtn--danger" onClick={() => removeNote(n)} aria-label="Delete">
                                            <Trash2 size={10} />
                                        </button>
                                    </Tooltip>
                                </span>
                            </div>
                        ))}
                        {dropped !== "" && <p className="s67-dropped">{dropped}</p>}
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
