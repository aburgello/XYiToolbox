// =============================================================================
// src/js/main/tools/TrackerMessage.tsx
// -----------------------------------------------------------------------------
// The Tracker's "Message for Wrike": the hand-off comment, written from the
// batch on screen and copied to the clipboard. lib/wrikeMessage.ts holds the
// rules (tokens, fields, a block with no data is left out); this is the card.
//
// The panel cannot post to Wrike -- it has no write access by design -- so the
// last step is a paste. That is also why an @name is plain text here: Wrike
// only makes a mention from one picked in its own editor.
//
// Templates are the artist's own (app.settings, JSON, in PROFILE_KEYS). The
// three that ship are only the starting list: nothing is stored until one is
// edited, so a machine that never touches them keeps getting improved defaults.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import { Copy, Pencil, Plus, Trash2, X, MessageSquarePlus, RotateCcw } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import { confirmDialog } from "../Dialog";
import "./TrackerMessage.scss";
import { DEFAULT_TEMPLATES, TOKENS, fieldsOf, fillMessage, parseTemplates, toHtml, toPlain, type MessageTemplate } from "../lib/wrikeMessage";

interface Props {
    /** The batch's facts, keyed by token (lib/wrikeMessage.ts TOKENS). */
    data: Record<string, string>;
    /** Things worth knowing before sending a message that lists revised renders. */
    warnings?: string[];
    /** The campaign's shared uploads folder, "" when nobody has set one. */
    uploadRoot: string;
    /** Pick it (or another), and share it with the team. */
    onPickUploadRoot: () => void;
    /** Open on this message when there is one by that id, rather than the one
     *  last used: Delivery opens on the delivery message. */
    prefer?: string;
    onClose: () => void;
    onCopied: (text: string, bad?: boolean) => void;
}

const LAST_KEY = "xyi.tracker.msg.template";
const toKey = (id: string) => "xyi.tracker.msg.to." + id;
const remembered = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

/** Rich AND plain on one copy, so the headings paste bold into Wrike and a
 *  plain field still gets clean text. The copy event is how old Chromium
 *  takes two flavours; navigator.clipboard.write is too new for the host. */
function copyBoth(html: string, text: string): boolean {
    let done = false;
    const onCopy = (e: ClipboardEvent) => {
        if (!e.clipboardData) return;
        e.clipboardData.setData("text/html", html);
        e.clipboardData.setData("text/plain", text);
        e.preventDefault();
        done = true;
    };
    document.addEventListener("copy", onCopy);
    try { document.execCommand("copy"); } catch { /* falls through */ }
    document.removeEventListener("copy", onCopy);
    return done;
}

const TrackerMessage: React.FC<Props> = ({ data, warnings, uploadRoot, onPickUploadRoot, prefer, onClose, onCopied }) => {
    const [templates, setTemplates] = useState<MessageTemplate[]>(DEFAULT_TEMPLATES);
    const [custom, setCustom] = useState(false);
    const [id, setId] = useState(prefer || remembered(LAST_KEY) || DEFAULT_TEMPLATES[0].id);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [editing, setEditing] = useState<MessageTemplate | null>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        let dead = false;
        (async () => {
            try {
                const json = (await evalTS("loadMessageTemplates")) as unknown as string;
                if (!dead && json) { setTemplates(parseTemplates(json)); setCustom(true); }
            } catch { /* preview: the defaults */ }
        })();
        return () => { dead = true; };
    }, []);

    const current = templates.find((t) => t.id === id) || templates[0];
    // {to} is remembered per template; every other field starts blank.
    useEffect(() => { setFields({ To: remembered(toKey(current.id)) }); }, [current.id]);
    // A message written before {upload.folder} existed asks for it in a box
    // ({?Upload folder}): that box starts with the campaign's folder for this
    // batch, still editable, and never over something already typed.
    const uploadFolder = data["upload.folder"] || "";
    useEffect(() => {
        if (uploadFolder) setFields((f) => (f["Upload folder"] ? f : { ...f, "Upload folder": uploadFolder }));
    }, [current.id, uploadFolder]);

    const persist = (next: MessageTemplate[]) => {
        setTemplates(next);
        setCustom(true);
        Promise.resolve(evalTS("saveMessageTemplates", JSON.stringify(next))).catch(() => { /* preview */ });
    };
    // A page that opens on its own message does not change which one the
    // Tracker comes back to.
    const choose = (tid: string) => { setId(tid); if (!prefer) remember(LAST_KEY, tid); setEditing(null); };

    const labels = fieldsOf(current.body);
    const filled = fillMessage(current.body, data, fields);
    const empty = !filled.marked.trim();

    const copy = async () => {
        const text = toPlain(filled.marked);
        if (copyBoth(toHtml(filled.marked), text)) { onCopied("Copied. Paste it into the Wrike comment."); return; }
        try {
            const r = (await evalTS("timesheetCopyToClipboard", text)) as any;
            if (r && r.success) { onCopied("Copied as plain text. Paste it into the Wrike comment."); return; }
        } catch { /* no bridge */ }
        onCopied("Couldn't copy. Select the message and copy it by hand.", true);
    };

    const insert = (token: string) => {
        if (!editing) return;
        const el = bodyRef.current;
        const at = el ? el.selectionStart : editing.body.length;
        const end = el ? el.selectionEnd : at;
        setEditing({ ...editing, body: editing.body.slice(0, at) + `{${token}}` + editing.body.slice(end) });
    };
    const save = () => {
        if (!editing) return;
        const t = { ...editing, name: editing.name.trim() || "Untitled" };
        const next = templates.some((x) => x.id === t.id) ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t];
        persist(next);
        choose(t.id);
    };
    const remove = async () => {
        if (!editing || templates.length < 2) return;
        if (!(await confirmDialog({ title: `Delete the ${editing.name} message?`, body: "Only on this machine. It can't be undone.", confirm: "Delete", danger: true }))) return;
        const next = templates.filter((x) => x.id !== editing.id);
        persist(next);
        choose(next[0].id);
    };
    const reset = async () => {
        if (!(await confirmDialog({ title: "Go back to the three starting messages?", body: "Every message you wrote or changed here is removed.", confirm: "Reset", danger: true }))) return;
        setTemplates(DEFAULT_TEMPLATES);
        setCustom(false);
        Promise.resolve(evalTS("saveMessageTemplates", "")).catch(() => { /* preview */ });
        choose(DEFAULT_TEMPLATES[0].id);
    };

    return (
        <div className="bt-msgcard">
            <div className="bt-msgcard-head">
                <MessageSquarePlus size={12} /> <span>Message for Wrike</span>
                <button type="button" className="bt-msgcard-x" onClick={onClose} aria-label="Close"><X size={12} /></button>
            </div>
            <div className="bt-msgcard-tabs">
                {templates.map((t) => (
                    <button key={t.id} type="button" className={"bt-msgcard-tab" + (t.id === current.id && !(editing && !templates.some((x) => x.id === editing.id)) ? " is-on" : "")} onClick={() => choose(t.id)}>
                        {t.name}
                    </button>
                ))}
                <button type="button" className="bt-msgcard-tab is-add" title="Write a new message"
                    onClick={() => setEditing({ id: "t" + Date.now().toString(36), name: "", body: "Hey {to}, " })}>
                    <Plus size={11} /> New
                </button>
            </div>

            {editing ? (
                <div className="bt-msgcard-edit">
                    <input className="bt-msgcard-input" placeholder="Name, e.g. Statics delivery" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    <textarea ref={bodyRef} className="bt-msgcard-body" rows={9} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                    <p className="bt-msgcard-help">
                        Press one to add it where the cursor is. <code>{"{to}"}</code> is who it's for, <code>{"{?Anything}"}</code> asks you each time, <code>**bold**</code> makes a heading. A block whose folder or count is missing is left out.
                    </p>
                    <div className="bt-msgcard-tokens">
                        <button type="button" className="bt-msgcard-token" title="Who it's addressed to. Remembered for this message." onClick={() => insert("to")}>{"{to}"}</button>
                        {TOKENS.map((t) => (
                            <button key={t.token} type="button" className="bt-msgcard-token" title={`${t.what}${data[t.token] ? `\nNow: ${data[t.token]}` : "\nNothing for this batch"}`} onClick={() => insert(t.token)}>
                                {`{${t.token}}`}
                            </button>
                        ))}
                    </div>
                    <div className="bt-msgcard-acts">
                        <button type="button" className="bt-act is-primary" disabled={!editing.body.trim()} onClick={save}>Save</button>
                        <button type="button" className="bt-act" onClick={() => setEditing(null)}>Cancel</button>
                        <span className="bt-spacer" />
                        {templates.some((x) => x.id === editing.id) && templates.length > 1 && (
                            <button type="button" className="bt-act" onClick={() => void remove()}><Trash2 size={12} /> Delete</button>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    {labels.length > 0 && (
                        <div className="bt-msgcard-fields">
                            {labels.map((l) => (
                                <label key={l} className="bt-msgcard-field">
                                    <span>{l}</span>
                                    <input
                                        className="bt-msgcard-input"
                                        placeholder={l === "To" ? "@James Crouch" : ""}
                                        value={fields[l] || ""}
                                        onChange={(e) => {
                                            setFields({ ...fields, [l]: e.target.value });
                                            if (l === "To") remember(toKey(current.id), e.target.value);
                                        }}
                                    />
                                </label>
                            ))}
                        </div>
                    )}
                    {empty
                        ? <p className="bt-msgcard-none">Nothing to say yet: this batch has none of what the message lists.</p>
                        : <p className="bt-msgcard-preview" dangerouslySetInnerHTML={{ __html: toHtml(filled.marked) }} />}
                    {/* Only on a message that names it: the campaign's uploads
                        folder is one path for the whole team, set once. */}
                    {/\{(upload\.|\?Upload folder\})/i.test(current.body) && (
                        <p className="bt-msgcard-upload">
                            {uploadRoot
                                ? <>Uploads for this campaign: <span title={uploadRoot}>{uploadRoot}</span></>
                                : <>No uploads folder is set for this campaign yet.</>}
                            <button type="button" className="bt-msgcard-link" onClick={onPickUploadRoot}
                                title="Pick the folder that holds this campaign's territories on the uploads share. It is shared with the team.">
                                {uploadRoot ? "Change…" : "Set it…"}
                            </button>
                        </p>
                    )}
                    {/\{revised\./i.test(current.body) && !data["revised.count"] && (
                        <p className="bt-msgcard-dropped">No revised renders: nothing in this batch is To amend or Revised in Wrike with a render.</p>
                    )}
                    {/\{revised\./i.test(current.body) && (warnings || []).map((w, i) => <p key={i} className="bt-msgcard-warn">{w}</p>)}
                    {filled.dropped.length > 0 && !empty && (
                        <p className="bt-msgcard-dropped">Left out, nothing to put in it: {filled.dropped.join(", ")}.</p>
                    )}
                    <div className="bt-msgcard-acts">
                        <button type="button" className="bt-act is-primary" disabled={empty} onClick={() => void copy()}><Copy size={12} /> Copy for Wrike</button>
                        <button type="button" className="bt-act" onClick={() => setEditing({ ...current })}><Pencil size={12} /> Edit message</button>
                        <span className="bt-spacer" />
                        {custom && (
                            <button type="button" className="bt-act" title="Remove your changes and go back to the three starting messages" onClick={() => void reset()}><RotateCcw size={12} /> Reset</button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default TrackerMessage;
