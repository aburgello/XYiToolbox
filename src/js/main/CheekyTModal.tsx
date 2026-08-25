// Cheeky T's review modal: opens ONLY when the comp name couldn't answer
// something, and writes to the Frontcard live as you type.
//
// WHY IT EXISTS. Cheeky T reads everything off the comp name, and real names
// break that in ways the parser can't recover from -- a three-letter territory
// (DOM), a compound one (BE_DE), a stray two-letter token upstream. Its old
// behaviour was to stamp whatever it got, so a name it couldn't read put a
// literal "(null)" -- and before the lookup was fixed, a confident but wrong
// "(Belgium German)" -- onto a finished frontcard. Refusing to write is safer,
// but a blank frontcard is still a job someone has to finish by hand.
//
// So the rule is: never guess, always ask. Anything the name answered is
// applied as before and this never appears. Anything it didn't comes here with
// the field flagged, and nothing is written until a human puts a value in it.
//
// LIVE, because the frontcard is the only real preview. The panel can't show
// what the card will look like, but AE can -- every edit writes through
// immediately, so you're reading the actual comp rather than a text field.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import { evalTS } from "../lib/utils/bolt";
import StatusIcon from "./StatusIcon";

/** Mirrors aeft/tools.ts's CheekyTInspection -- see the note in Toolset.tsx
 *  about why cross-bridge types are re-declared rather than imported. */
export interface CheekyTInspection {
    success: boolean;
    error?: string;
    frontcards?: number;
    compName?: string;
    shortName?: boolean;
    values?: { artwork: string; version: string; territory: string; date: string; campaign: string; duration: string };
    unresolved?: string[];
    territoryToken?: string;
    countries?: { name: string; code: string }[];
}

/** The studio's four, confirmed -- the same set the whole toolbox parses on. */
const ARTWORK_TYPES = ["DOOH", "DFOH", "DINTH", "FOH"];

/** Enough to choose from without the list becoming the whole modal. */
const MAX_MATCHES = 7;

/** Long enough not to write on every keystroke, short enough to feel live. */
const APPLY_DEBOUNCE_MS = 220;

interface Props {
    inspection: CheekyTInspection;
    onClose: () => void;
}

export const CheekyTModal = ({ inspection, onClose }: Props) => {
    const [artwork, setArtwork] = useState(inspection.values?.artwork || "");
    const [version, setVersion] = useState(inspection.values?.version || "");
    const [territory, setTerritory] = useState(inspection.values?.territory || "");
    const [date, setDate] = useState(inspection.values?.date || "");
    // The campaign line's two halves. Collected here for the same reason as the
    // rest: a name that answers neither used to leave the card's campaign line
    // as a lone inch mark.
    const [campaign, setCampaign] = useState(inspection.values?.campaign || "");
    const [duration, setDuration] = useState(inspection.values?.duration || "");
    const [terQuery, setTerQuery] = useState("");
    const [terOpen, setTerOpen] = useState(false);
    const terRef = useRef<HTMLDivElement>(null);
    const [applied, setApplied] = useState(false);
    const [applyError, setApplyError] = useState<string | null>(null);

    // ONLY THE FIELDS THAT FAILED. Everything the comp name answered has
    // already been applied correctly, so showing it here was asking someone to
    // re-check work that was never in doubt -- and burying the one field that
    // was. Cheeky DT is the tool for editing a field that parsed fine.
    //
    // Taken from the inspection, not from live state, so a field does not
    // vanish out from under you the moment you fill it in. Date is never in
    // here: it is always today, so it can never fail to resolve.
    const unresolved = inspection.unresolved || [];
    const missing = useCallback((k: string) => unresolved.indexOf(k) !== -1, [unresolved]);
    const show = useCallback((k: string) => unresolved.indexOf(k) !== -1, [unresolved]);

    const countries = inspection.countries || [];
    // Matches on CODE as well as name, so "DE" finds Germany. An exact code hit
    // ranks first. indexOf throughout, never a built regex -- these are real
    // country names and several carry brackets and commas.
    const matches = useMemo(() => {
        const q = terQuery.trim().toLowerCase();
        if (!q) return countries.slice(0, MAX_MATCHES);
        const exactCode: typeof countries = [];
        const starts: typeof countries = [];
        const contains: typeof countries = [];
        for (const c of countries) {
            const lc = c.name.toLowerCase();
            const code = String(c.code || "").toLowerCase();
            if (code === q || code.split("_").join(" ") === q) exactCode.push(c);
            else if (lc.indexOf(q) === 0) starts.push(c);
            else if (lc.indexOf(q) !== -1 || code.indexOf(q) === 0) contains.push(c);
        }
        return exactCode.concat(starts, contains).slice(0, MAX_MATCHES);
    }, [terQuery, countries]);

    // --- live write ---------------------------------------------------------
    // Debounced, and it deliberately sends ALL four fields every time: the host
    // skips blanks, so a half-filled modal can never blank a field that was
    // already right on the card.
    const timer = useRef<number | null>(null);
    const firstRun = useRef(true);
    useEffect(() => {
        // Nothing is written on mount. The whole point is that an unresolved
        // field stays untouched until a human fills it in.
        if (firstRun.current) {
            firstRun.current = false;
            return;
        }
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            // The three fields this modal can own. Date is written by the
            // Cheeky T run that opened this and is never editable here. Sending
            // all three unconditionally is safe and simpler than working out
            // which are on screen: they are prefilled with the values that run
            // already applied, and the host skips blanks entirely.
            evalTS("cheekyTApplyFields", JSON.stringify({ artwork, version, territory, campaign, duration }))
                .then((r) => {
                    const res = r as unknown as { success?: boolean; error?: string } | undefined;
                    if (res && res.success === false) {
                        setApplyError(res.error || "Couldn't write to the Frontcard.");
                        setApplied(false);
                    } else {
                        setApplyError(null);
                        setApplied(true);
                    }
                })
                .catch(() => setApplyError("Couldn't reach After Effects."));
        }, APPLY_DEBOUNCE_MS);
        return () => {
            if (timer.current) window.clearTimeout(timer.current);
        };
    }, [artwork, version, territory, campaign, duration]);

    // Clicking anywhere outside the picker closes it. Mousedown rather than
    // click: the list's buttons are gone from the DOM by the time a click
    // finishes bubbling, so a click listener can't tell a pick from a
    // click-away.
    useEffect(() => {
        if (!terOpen) return;
        const onDown = (e: MouseEvent) => {
            if (terRef.current && !terRef.current.contains(e.target as Node)) {
                setTerOpen(false);
                setTerQuery("");
            }
        };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [terOpen]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Escape closes the picker first if it is open, and only closes the
            // modal when it isn't -- otherwise dismissing a dropdown throws away
            // everything you were in the middle of.
            if (e.key === "Escape" && terOpen) {
                e.stopPropagation();
                setTerOpen(false);
                setTerQuery("");
                return;
            }
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose, terOpen]);

    // Counts only what is actually on screen -- a field the name answered is
    // not "still blank", it was simply never asked about.
    const current: Record<string, string> = { artwork, version, territory, campaign, duration };
    const stillMissing = unresolved.filter((k) => !current[k]);

    return (
        <div className="ctm-backdrop" onClick={onClose}>
            <div className="ctm" onClick={(e) => e.stopPropagation()}>
                <div className="ctm-head">
                    <div>
                        <h3 className="ctm-title">Frontcard needs a hand</h3>
                        <p className="ctm-sub">{inspection.compName}</p>
                    </div>
                    <button className="ctm-x" onClick={onClose} title="Close (Esc)"><X size={13} /></button>
                </div>

                <div className="ctm-fields">
                    {show("artwork") && (
                    <label className={"ctm-field" + (missing("artwork") ? " is-missing" : "")}>
                        <span className="ctm-lbl">
                            Artwork {missing("artwork") && <AlertCircle size={10} />}
                        </span>
                        <span className="ctm-chips">
                            {ARTWORK_TYPES.map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    className={"ctm-chip" + (artwork === t ? " is-on" : "")}
                                    onClick={() => setArtwork(t)}
                                >
                                    {t}
                                </button>
                            ))}
                        </span>
                    </label>
                    )}

                    {show("version") && (
                    <label className={"ctm-field" + (missing("version") ? " is-missing" : "")}>
                        <span className="ctm-lbl">
                            Version {missing("version") && <AlertCircle size={10} />}
                        </span>
                        <input
                            className="ctm-input"
                            value={version}
                            placeholder="V01"
                            // Uppercased on blur, not on change: rewriting the
                            // value React echoes back moves the caret to the end
                            // of the rewritten string mid-typing.
                            onChange={(e) => setVersion(e.target.value)}
                            onBlur={() => setVersion((v) => v.toUpperCase())}
                        />
                    </label>
                    )}

                    {show("campaign") && (
                    <label className={"ctm-field" + (missing("campaign") ? " is-missing" : "")}>
                        <span className="ctm-lbl">
                            Campaign {missing("campaign") && <AlertCircle size={10} />}
                        </span>
                        <input
                            className="ctm-input"
                            value={campaign}
                            placeholder="Multiple Art"
                            onChange={(e) => setCampaign(e.target.value)}
                        />
                    </label>
                    )}

                    {show("duration") && (
                    <label className={"ctm-field" + (missing("duration") ? " is-missing" : "")}>
                        <span className="ctm-lbl">
                            Seconds {missing("duration") && <AlertCircle size={10} />}
                        </span>
                        <input
                            className="ctm-input"
                            value={duration}
                            // A BARE NUMBER. The inch mark is the card's own and
                            // is appended host-side, so typing one here would
                            // double it -- and which mark a card uses is a thing
                            // the host reads off that card, never assumes.
                            placeholder="30"
                            inputMode="numeric"
                            onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ""))}
                        />
                    </label>
                    )}

                    {show("territory") && (
                    <div className={"ctm-field" + (missing("territory") ? " is-missing" : "")} ref={terRef}>
                        <span className="ctm-lbl">
                            Territory {missing("territory") && <AlertCircle size={10} />}
                            {missing("territory") && inspection.territoryToken && (
                                <em className="ctm-hint">“{inspection.territoryToken}” isn't one we know</em>
                            )}
                        </span>
                        {/* Picked from the real TC_COUNTRIES list rather than typed
                            free-hand: the frontcard shows this name verbatim, and a
                            typo here is exactly as wrong as the bad lookup was. */}
                        <input
                            className="ctm-input"
                            value={terOpen ? terQuery : territory}
                            placeholder="Search territories…"
                            // Opens the list without blanking the field -- see
                            // the same fix in CheekyDT.
                            onFocus={(e) => { setTerOpen(true); setTerQuery(territory); e.target.select(); }}
                            onChange={(e) => { setTerOpen(true); setTerQuery(e.target.value); }}
                        />
                        {terOpen && (
                            <ul className="ctm-matches">
                                {matches.map((c) => (
                                    <li key={c.name}>
                                        <button
                                            type="button"
                                            onClick={() => { setTerritory(c.name); setTerOpen(false); setTerQuery(""); }}
                                        >
                                            {c.name}
                                            <em className="ctm-code">{c.code}</em>
                                        </button>
                                    </li>
                                ))}
                                {matches.length === 0 && <li className="ctm-none">No territory matches that.</li>}
                            </ul>
                        )}
                    </div>
                    )}
                </div>

                <div className="ctm-foot">
                    <span className="ctm-state">
                        {applyError ? (
                            <><StatusIcon type="error" size={12} /> {applyError}</>
                        ) : stillMissing.length ? (
                            <>{stillMissing.join(" and ")} still blank — left untouched on the card.</>
                        ) : applied ? (
                            <><Check size={12} /> Written to {inspection.frontcards === 1 ? "the Frontcard" : `${inspection.frontcards} Frontcards`}.</>
                        ) : (
                            <>Edit a field and it writes straight through.</>
                        )}
                    </span>
                    <button className="ctm-done" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
};

export default CheekyTModal;
