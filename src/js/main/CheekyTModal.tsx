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
    values?: { artwork: string; version: string; territory: string; date: string };
    unresolved?: string[];
    territoryToken?: string;
    countries?: string[];
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
    const [terQuery, setTerQuery] = useState("");
    const [terOpen, setTerOpen] = useState(false);
    const [applied, setApplied] = useState(false);
    const [applyError, setApplyError] = useState<string | null>(null);

    const unresolved = inspection.unresolved || [];
    const missing = useCallback((k: string) => unresolved.indexOf(k) !== -1, [unresolved]);

    const countries = inspection.countries || [];
    const matches = useMemo(() => {
        const q = terQuery.trim().toLowerCase();
        if (!q) return countries.slice(0, MAX_MATCHES);
        const starts: string[] = [];
        const contains: string[] = [];
        for (const c of countries) {
            const lc = c.toLowerCase();
            // indexOf, never a built regex -- these are real country names and
            // several carry brackets and commas.
            if (lc.indexOf(q) === 0) starts.push(c);
            else if (lc.indexOf(q) !== -1) contains.push(c);
        }
        return starts.concat(contains).slice(0, MAX_MATCHES);
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
            evalTS("cheekyTApplyFields", JSON.stringify({ artwork, version, territory, date }))
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
    }, [artwork, version, territory, date]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const stillMissing = [
        !artwork ? "artwork" : "",
        !version ? "version" : "",
        !territory ? "territory" : "",
    ].filter((s) => s !== "");

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

                <p className="ctm-why">
                    {unresolved.length === 1
                        ? "One field couldn't be read from the comp name."
                        : `${unresolved.length} fields couldn't be read from the comp name.`}
                    {missing("territory") && inspection.territoryToken
                        ? ` The territory slot held “${inspection.territoryToken}”, which isn't a territory we know.`
                        : ""}
                    {" Everything you set here writes to the Frontcard as you type."}
                </p>

                <div className="ctm-fields">
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

                    <label className={"ctm-field" + (missing("version") ? " is-missing" : "")}>
                        <span className="ctm-lbl">
                            Version {missing("version") && <AlertCircle size={10} />}
                        </span>
                        <input
                            className="ctm-input"
                            value={version}
                            placeholder="V01"
                            onChange={(e) => setVersion(e.target.value.toUpperCase())}
                        />
                    </label>

                    <div className={"ctm-field" + (missing("territory") ? " is-missing" : "")}>
                        <span className="ctm-lbl">
                            Territory {missing("territory") && <AlertCircle size={10} />}
                        </span>
                        {/* Picked from the real TC_COUNTRIES list rather than typed
                            free-hand: the frontcard shows this name verbatim, and a
                            typo here is exactly as wrong as the bad lookup was. */}
                        <input
                            className="ctm-input"
                            value={terOpen ? terQuery : territory}
                            placeholder="Search territories…"
                            onFocus={() => { setTerOpen(true); setTerQuery(""); }}
                            onChange={(e) => { setTerOpen(true); setTerQuery(e.target.value); }}
                        />
                        {terOpen && (
                            <ul className="ctm-matches">
                                {matches.map((c) => (
                                    <li key={c}>
                                        <button
                                            type="button"
                                            onClick={() => { setTerritory(c); setTerOpen(false); setTerQuery(""); }}
                                        >
                                            {c}
                                        </button>
                                    </li>
                                ))}
                                {matches.length === 0 && <li className="ctm-none">No territory matches that.</li>}
                            </ul>
                        )}
                    </div>

                    <label className="ctm-field">
                        <span className="ctm-lbl">Date</span>
                        <input className="ctm-input" value={date} onChange={(e) => setDate(e.target.value)} />
                    </label>
                </div>

                <div className="ctm-foot">
                    <span className="ctm-state">
                        {applyError ? (
                            <><StatusIcon type="error" size={12} /> {applyError}</>
                        ) : stillMissing.length ? (
                            <>{stillMissing.length} still blank — blanks are left untouched on the card.</>
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
