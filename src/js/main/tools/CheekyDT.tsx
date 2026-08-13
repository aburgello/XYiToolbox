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
import { AlertCircle, Globe2, RefreshCw, RotateCcw } from "lucide-react";
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
    countries?: string[];
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

    // The independent territory-code lookup. Unrelated to the card and useful
    // on its own, so it survives the rebuild untouched.
    const [territoryEntry, setTerritoryEntry] = useState("OV");
    const [lookup, setLookup] = useState<StatusMsg | null>(null);

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

    const set = (k: FieldKey, v: string) => {
        setValues((prev) => ({ ...prev, [k]: v }));
        setTouched((prev) => ({ ...prev, [k]: true }));
    };

    const derived = card?.derived || EMPTY;
    const unresolved = card?.unresolved || [];
    const countries = card?.countries || [];

    const matches = useMemo(() => {
        const q = terQuery.trim().toLowerCase();
        if (!q) return countries.slice(0, MAX_MATCHES);
        const starts: string[] = [];
        const rest: string[] = [];
        for (const c of countries) {
            const lc = c.toLowerCase();
            if (lc.indexOf(q) === 0) starts.push(c);
            else if (lc.indexOf(q) !== -1) rest.push(c);
        }
        return starts.concat(rest).slice(0, MAX_MATCHES);
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

    const renderField = (key: FieldKey, label: string) => {
        const isMissing = unresolved.indexOf(key) !== -1 && !touched[key];
        const fromName = derived[key] || "";
        const canReset = fromName !== "" && fromName !== values[key];
        const cls = "cdt-row" + (touched[key] ? " is-touched" : "") + (isMissing ? " is-missing" : "");

        return (
            <div className={cls} key={key}>
                <div className="cdt-row-head">
                    <span className="cdt-row-label">
                        {label}
                        {isMissing && <AlertCircle size={10} />}
                    </span>
                    {isMissing && key === "territory" && card?.territoryToken && (
                        <em className="cdt-hint">“{card.territoryToken}” isn't one we know</em>
                    )}
                    <Tooltip text={fromName ? `Set to “${fromName}”` : "The filename doesn't answer this one"}>
                        <button
                            type="button"
                            className="cdt-reset"
                            disabled={!canReset}
                            onClick={() => set(key, fromName)}
                        >
                            <RotateCcw size={9} /> from name
                        </button>
                    </Tooltip>
                </div>

                {key === "artwork" ? (
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
                ) : key === "territory" ? (
                    <>
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
                        {terOpen && (
                            <ul className="cdt-matches">
                                {matches.map((c) => (
                                    <li key={c}>
                                        <button
                                            type="button"
                                            onClick={() => { set("territory", c); setTerOpen(false); setTerQuery(""); }}
                                        >
                                            {c}
                                        </button>
                                    </li>
                                ))}
                                {matches.length === 0 && <li className="cdt-none">No territory matches that.</li>}
                            </ul>
                        )}
                    </>
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
                    </div>
                ) : (
                    <input
                        className="cdt-input"
                        value={values[key]}
                        onChange={(e) => set(key, key === "version" ? e.target.value.toUpperCase() : e.target.value)}
                    />
                )}
            </div>
        );
    };

    return (
        <div className="form-tool cdt">
            <div className="cdt-head">
                <div className="cdt-head-text">
                    <h2 className="cdt-title">Cheeky DT</h2>
                    <p className="cdt-comp">
                        {card?.compName || (loading ? "Reading the Frontcard…" : "No comp")}
                        {card?.frontcards ? ` · ${card.frontcards} Frontcard${card.frontcards === 1 ? "" : "s"}` : ""}
                    </p>
                </div>
                <Tooltip text="Re-read the Frontcard and drop your edits">
                    <button className="cdt-refresh" onClick={read} disabled={loading}>
                        <RefreshCw size={11} className={loading ? "spin" : ""} />
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
                        {FIELDS.map((f) => renderField(f.key, f.label))}
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
