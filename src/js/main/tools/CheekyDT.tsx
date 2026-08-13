// =============================================================================
// src/js/main/tools/CheekyDT.tsx
// -----------------------------------------------------------------------------
// Ported from XYi_Toolbox.jsx's "Cheeky DT" tab, then rebuilt around live
// editing.
//
// WHAT IT USED TO BE. Seven checkboxes and a Run button, where each checkbox
// meant "re-derive this field FROM THE FILENAME and overwrite it". So the tool
// could only ever say WHICH fields to overwrite, never WHAT to write -- and
// when the filename was wrong (a three-letter territory, a compound one, a
// campaign token that swept up the placement) it could not help at all. Your
// options were renaming the comp or editing the text layer by hand.
//
// WHAT IT IS NOW. Every field is editable and prefilled from what the FRONTCARD
// currently says, not from the filename -- you are correcting reality rather
// than re-deriving from the thing that was wrong. Editing writes through to AE
// immediately, because the card is the only real preview. The per-field "from
// name" button is the old checkbox: it snaps one field to the filename-derived
// value, except you see the value before it commits instead of after.
//
// UNTOUCHED MEANS UNTOUCHED. A field nobody edits is never sent, which is the
// old "only overwrite what I ticked" guarantee -- it just stops being something
// you configure up front.
//
// CAMPAIGN AND DURATION ARE ONE TEXT LAYER on the card ("MULTIPLE ART 15\"").
// They are two fields here and the line is COMPOSED from them, so both are sent
// whenever either changes. The old code read that line back and guessed where
// the campaign ended by taking the last word, then used the fragment as a split
// delimiter -- which silently dropped text from any campaign containing the
// duration digits. The inch mark is appended by the host, never typed.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, Globe2, RefreshCw, Undo2 } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

type FieldKey = "title" | "artwork" | "version" | "campaign" | "duration" | "territory" | "date";
type FieldMap = Record<FieldKey, string>;

/** Mirrors aeft/tools.ts's FrontcardFields. */
interface FrontcardFields {
    success: boolean;
    error?: string;
    frontcards?: number;
    compName?: string;
    current?: FieldMap;
    derived?: FieldMap;
    unresolved?: string[];
    territoryToken?: string;
    countries?: { name: string; code: string }[];
}

const FIELDS: { key: FieldKey; label: string }[] = [
    { key: "title", label: "Title" },
    { key: "artwork", label: "Artwork" },
    { key: "version", label: "Version" },
    { key: "campaign", label: "Campaign" },
    { key: "duration", label: "Duration" },
    { key: "territory", label: "Territory" },
    { key: "date", label: "Date" },
];

/** The studio's four, and the whole toolbox parses on this same set. */
const ARTWORK_TYPES = ["DOOH", "DFOH", "DINTH", "FOH"];
const MAX_MATCHES = 7;
const WRITE_DEBOUNCE_MS = 240;

const EMPTY: FieldMap = { title: "", artwork: "", version: "", campaign: "", duration: "", territory: "", date: "" };

const CheekyDTTool = () => {
    const [card, setCard] = useState<FrontcardFields | null>(null);
    const [values, setValues] = useState<FieldMap>(EMPTY);
    const [touched, setTouched] = useState<Partial<Record<FieldKey, true>>>({});
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [loading, setLoading] = useState(true);
    const [terOpen, setTerOpen] = useState(false);
    const [terQuery, setTerQuery] = useState("");
    const terRef = useRef<HTMLDivElement>(null);

    // The independent territory-code lookup. Unrelated to the card and useful
    // on its own, so it survives the rebuild untouched.
    const [territoryEntry, setTerritoryEntry] = useState("OV");
    const [lookup, setLookup] = useState<StatusMsg | null>(null);
    const reduced = useReducedMotion();

    const read = useCallback(async () => {
        setLoading(true);
        setStatus(null);
        try {
            const res = (await evalTS("frontcardReadFields")) as unknown as FrontcardFields | undefined;
            if (res === undefined) throw new Error("no bridge");
            setCard(res);
            if (res.success && res.current) {
                setValues({ ...res.current });
                setTouched({});
            } else if (!res.success) {
                setStatus({ text: res.error || "Couldn't read the Frontcard.", type: "error" });
            }
        } catch {
            setStatus({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { read(); }, [read]);

    // --- live write ---------------------------------------------------------
    const timer = useRef<number | null>(null);
    const skipFirst = useRef(true);
    useEffect(() => {
        if (skipFirst.current) { skipFirst.current = false; return; }
        const keys = Object.keys(touched) as FieldKey[];
        if (!keys.length) return;

        const payload: Partial<FieldMap> = {};
        for (const k of keys) payload[k] = values[k];
        // One text layer, two fields: the host composes the line, so it needs
        // both sides whenever either one has been edited.
        if (touched.campaign || touched.duration) {
            payload.campaign = values.campaign;
            payload.duration = values.duration;
        }

        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            evalTS("frontcardWriteFields", JSON.stringify(payload))
                .then((r) => {
                    const res = r as unknown as { success?: boolean; error?: string } | undefined;
                    if (res && res.success === false) setStatus({ text: res.error || "Couldn't write to the Frontcard.", type: "error" });
                    else setStatus(null);
                })
                .catch(() => setStatus({ text: "Couldn't reach After Effects.", type: "error" }));
        }, WRITE_DEBOUNCE_MS);
        return () => { if (timer.current) window.clearTimeout(timer.current); };
    }, [values, touched]);

    // Close the picker on any click outside it. MOUSEDOWN, not click: the
    // list's own buttons are removed from the DOM by the time a click event
    // finishes bubbling, so a click listener can't tell "picked an option"
    // from "clicked away" -- mousedown still sees the real target. Capture
    // phase so it runs before React's own handlers.
    useEffect(() => {
        if (!terOpen) return;
        const onDown = (e: MouseEvent) => {
            if (terRef.current && !terRef.current.contains(e.target as Node)) {
                setTerOpen(false);
                setTerQuery("");
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { setTerOpen(false); setTerQuery(""); }
        };
        document.addEventListener("mousedown", onDown, true);
        window.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown, true);
            window.removeEventListener("keydown", onKey);
        };
    }, [terOpen]);

    const set = (k: FieldKey, v: string) => {
        setValues((prev) => ({ ...prev, [k]: v }));
        setTouched((prev) => ({ ...prev, [k]: true }));
    };

    const derived = card?.derived || EMPTY;
    const unresolved = card?.unresolved || [];
    const countries = card?.countries || [];

    // MATCHES ON CODE AS WELL AS NAME, so "DE" finds Germany. An exact code hit
    // ranks first -- typing a two-letter code is unambiguous and should not be
    // buried under every country whose name happens to contain those letters.
    const matches = useMemo(() => {
        const q = terQuery.trim().toLowerCase();
        if (!q) return countries.slice(0, MAX_MATCHES);
        const exactCode: typeof countries = [];
        const starts: typeof countries = [];
        const rest: typeof countries = [];
        for (const c of countries) {
            const lc = c.name.toLowerCase();
            const code = String(c.code || "").toLowerCase();
            if (code === q || code.split("_").join(" ") === q) exactCode.push(c);
            else if (lc.indexOf(q) === 0) starts.push(c);
            else if (lc.indexOf(q) !== -1 || code.indexOf(q) === 0) rest.push(c);
        }
        return exactCode.concat(starts, rest).slice(0, MAX_MATCHES);
    }, [terQuery, countries]);

    const runLookup = async () => {
        setLookup(null);
        try {
            const code = await evalTS("getTerritoryCountryCode", territoryEntry);
            if (code === undefined) throw new Error("no bridge");
            setLookup({ text: (code as unknown as string) || "No matching territory found.", type: code ? "success" : "error" });
        } catch {
            setLookup({ text: "No CEP bridge detected — open this panel inside After Effects to run it.", type: "error" });
        }
    };

    const touchedKeys = Object.keys(touched) as FieldKey[];

    const renderField = (key: FieldKey, label: string, idx: number) => {
        const isMissing = unresolved.indexOf(key) !== -1 && !touched[key];
        const fromName = derived[key] || "";
        const canReset = fromName !== "" && fromName !== values[key];
        const cls = "cdt-row" + (touched[key] ? " is-touched" : "") + (isMissing ? " is-missing" : "");

        // The reset button sits WITH its input rather than floating out at the
        // right-hand end of the label row: on a wide panel that put it a long
        // way from the field it acts on, reading as page furniture rather than
        // as a control belonging to that row.
        const resetBtn = (
            <Tooltip text={fromName ? `Reset to “${fromName}” from the comp name` : "The comp name doesn't answer this one"}>
                <button
                    type="button"
                    className="cdt-reset"
                    disabled={!canReset}
                    onClick={() => set(key, fromName)}
                    aria-label="Reset from the comp name"
                >
                    <Undo2 size={12} />
                </button>
            </Tooltip>
        );

        return (
            <motion.div
                className={cls}
                key={key}
                // Per-item explicit delay rather than a stagger parent -- this
                // codebase's documented workaround for variant propagation
                // stalling inside an AnimatePresence wrapper. Same cadence as
                // CSV Localiser's scanned territories.
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduced ? 0 : Math.min(idx * 0.035, 0.3), duration: 0.22, ease: "easeOut" }}
            >
                <div className="cdt-row-head">
                    <span className="cdt-row-label">
                        {label}
                        {isMissing && <AlertCircle size={10} />}
                    </span>
                    {isMissing && key === "territory" && card?.territoryToken && (
                        <em className="cdt-hint">“{card.territoryToken}” isn't one we know</em>
                    )}
                </div>

                {key === "artwork" ? (
                    <div className="cdt-field-row">
                    <div className="cdt-chips">
                        {ARTWORK_TYPES.map((t) => (
                            <button
                                key={t}
                                type="button"
                                className={"cdt-chip" + (values.artwork === t ? " is-on" : "")}
                                onClick={() => set("artwork", t)}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                    {resetBtn}
                    </div>
                ) : key === "territory" ? (
                    <div ref={terRef}>
                    <div className="cdt-field-row">
                        {/* Picked from the real TC_COUNTRIES list rather than typed
                            free-hand: the card prints this verbatim, so a typo here
                            is exactly as wrong as a bad lookup. */}
                        <input
                            className="cdt-input"
                            value={terOpen ? terQuery : values.territory}
                            placeholder="Search territories…"
                            onFocus={() => { setTerOpen(true); setTerQuery(""); }}
                            onChange={(e) => { setTerOpen(true); setTerQuery(e.target.value); }}
                        />
                        {resetBtn}
                        </div>
                        {terOpen && (
                            <ul className="cdt-matches">
                                {matches.map((c) => (
                                    <li key={c.name}>
                                        <button
                                            type="button"
                                            onClick={() => { set("territory", c.name); setTerOpen(false); setTerQuery(""); }}
                                        >
                                            {c.name}
                                            <em className="cdt-code">{c.code}</em>
                                        </button>
                                    </li>
                                ))}
                                {matches.length === 0 && <li className="cdt-none">No territory matches that.</li>}
                            </ul>
                        )}
                    </div>
                ) : key === "duration" ? (
                    <div className="cdt-suffixed">
                        <input
                            className="cdt-input"
                            value={values.duration}
                            placeholder="15"
                            onChange={(e) => set("duration", e.target.value)}
                        />
                        {/* Every duration ends this way, so it is never typed and
                            can never end up doubled or missing -- the host appends
                            it when it composes the line. */}
                        <span className="cdt-suffix">”</span>
                        {resetBtn}
                    </div>
                ) : (
                    <div className="cdt-field-row">
                        <input
                            className="cdt-input"
                            value={values[key]}
                            onChange={(e) => set(key, key === "version" ? e.target.value.toUpperCase() : e.target.value)}
                        />
                        {resetBtn}
                    </div>
                )}
            </motion.div>
        );
    };

    return (
        <div className="form-tool cdt">
            {/* No heading here: the tool shell already prints "Cheeky DT" with
                its icon directly above, and a second one read as a duplicate. */}
            <div className="cdt-head">
                <p className="cdt-comp">
                    {card?.compName || (loading ? "Reading the Frontcard…" : "No comp open")}
                    {card?.frontcards ? ` · ${card.frontcards} Frontcard${card.frontcards === 1 ? "" : "s"}` : ""}
                </p>
                <Tooltip text="Re-read the Frontcard and drop your edits">
                    <button className="cdt-refresh" onClick={read} disabled={loading}>
                        <RefreshCw size={12} className={loading ? "spin" : ""} />
                        <span>Re-read</span>
                    </button>
                </Tooltip>
            </div>

            {card && !card.success ? (
                <p className="cdt-empty">{card.error}</p>
            ) : (
                <>
                    <p className="cdt-lede">
                        Edit a field and it writes to the Frontcard as you type. Anything you
                        don't touch is left exactly as it is.
                    </p>

                    <div className="cdt-fields">
                        {FIELDS.map((f, i) => renderField(f.key, f.label, i))}
                    </div>

                    <p className="cdt-written">
                        {touchedKeys.length === 0
                            ? "Nothing edited yet — nothing has been written."
                            : `Written: ${touchedKeys.join(", ")}.`}
                    </p>
                </>
            )}

            {status && (
                <p className={"cdt-status is-" + status.type}>
                    <StatusIcon type={status.type} size={12} /> {status.text}
                </p>
            )}

            {/* --- the standalone territory-code lookup, unchanged ------------ */}
            <div className="cdt-lookup">
                <span className="cdt-row-label"><Globe2 size={10} /> Territory code lookup</span>
                <div className="cdt-lookup-row">
                    <input
                        className="cdt-input"
                        value={territoryEntry}
                        onChange={(e) => setTerritoryEntry(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") runLookup(); }}
                    />
                    <button className="cdt-lookup-go" onClick={runLookup}>Look up</button>
                </div>
                {lookup && (
                    <p className={"cdt-status is-" + lookup.type}>
                        <StatusIcon type={lookup.type} size={12} /> {lookup.text}
                    </p>
                )}
            </div>
        </div>
    );
};

export default CheekyDTTool;
