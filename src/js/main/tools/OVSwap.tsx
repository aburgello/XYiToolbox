// =============================================================================
// src/js/main/tools/OVSwap.tsx
// -----------------------------------------------------------------------------
// OV Swap -- the step after MC It! and Localised Library's batch import. The
// artwork has been localised and the territory's components are sitting in
// the project, but the working comp is still pointing at the OV precomps and
// OV logo/legal artwork. This pairs each of those with its imported
// counterpart and swaps them in one undo group.
//
// Scan-first, exactly like CSV Localiser: nothing is touched until the user
// has seen the pairing table. That matters more here than in most tools --
// a wrong pairing puts another component's (or another territory's) artwork
// into a finished deliverable, and nothing downstream would catch it.
// scanOvSwap (localise.ts) therefore matches on an EXACT normalised name and
// reports a miss as a miss; the manual picker below is how a miss gets
// resolved, rather than the backend guessing.
//
// Scope is the ACTIVE COMP and its nested precomps, per the studio's call --
// see scanOvSwap's own comment for what that rules out.
// =============================================================================
import React, { useEffect, useState } from "react";
import { Repeat, ScanSearch, RotateCcw } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import CheckboxToggle from "../CheckboxToggle";
import Dropdown from "../Dropdown";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";
import "./OVSwap.scss";

interface SwapRow {
    compId: number;
    compName: string;
    layerIndex: number;
    layerName: string;
    sourceName: string;
    sourceIsComp: boolean;
    matchId: number;
    matchName: string;
    status: "matched" | "no-match" | "ambiguous";
    reason?: string;
}

interface Candidate {
    id: number;
    name: string;
    isComp: boolean;
}

interface StatusMsg {
    text: string;
    type: "success" | "error";
}

// Row key. compId + layerIndex is unique within a scan, and both are plain
// numbers that survive the bridge -- never a held AE object.
const rowKey = (r: SwapRow) => `${r.compId}:${r.layerIndex}`;

const OVSwapTool = () => {
    const [code, setCode] = useState("");
    // Has the user typed in the code field themselves? The field is
    // PREFILLED from the project on mount so it isn't a mystery blank, but a
    // prefilled value must not then outrank detection: open the tool on an
    // Italian comp, switch to a French one, hit Scan, and a sticky "IT"
    // would quietly scan for the wrong territory. So an untouched field is
    // always re-derived at scan time and only a typed one is obeyed.
    const [codeTouched, setCodeTouched] = useState(false);
    const [compName, setCompName] = useState("");
    const [rows, setRows] = useState<SwapRow[] | null>(null);
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    // Per-row replacement item id, seeded from the scan's own match and
    // overridable by the user. 0 means "nothing chosen".
    const [picks, setPicks] = useState<Record<string, number>>({});
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [status, setStatus] = useState<StatusMsg | null>(null);
    const [busy, setBusy] = useState(false);

    const bridge = async (fn: string, ...args: any[]): Promise<any> => {
        const result = await evalTS(fn as any, ...args);
        if (result === undefined) throw new Error("no bridge");
        return result;
    };

    const noBridge = () => setStatus({ text: "No CEP bridge detected. Open this panel inside After Effects to run it.", type: "error" });

    // Fills the code field from the project itself (see suggestOvSwapCode).
    // Silent on failure: an empty field is a perfectly normal outcome and
    // the user can just type the code.
    const suggest = async () => {
        try {
            const suggested = await bridge("suggestOvSwapCode");
            if (typeof suggested === "string" && suggested) setCode(suggested);
            return typeof suggested === "string" ? suggested : "";
        } catch (e) {
            return "";
        }
    };

    // Prefill from the project on mount, so the field shows what a Scan is
    // actually going to use instead of looking like an empty required box.
    useEffect(() => {
        suggest();
    }, []);

    const scan = async () => {
        setBusy(true);
        setStatus(null);
        try {
            // A typed code always wins; anything else is re-derived now (see
            // codeTouched) rather than trusting whatever is sitting in the
            // box from an earlier comp.
            const effective = (codeTouched && code.trim()) || (await suggest());
            if (!effective) {
                setStatus({ text: "Enter the territory code to swap in (e.g. IT) — couldn't work it out from the comp name.", type: "error" });
                return;
            }
            const result = await bridge("scanOvSwap", effective);
            if (!result.success) {
                setRows(null);
                setStatus({ text: result.error || "Could not scan the comp.", type: "error" });
                return;
            }
            const scanned: SwapRow[] = result.rows || [];
            setRows(scanned);
            setCandidates(result.candidates || []);
            setCompName(result.compName || "");
            const nextPicks: Record<string, number> = {};
            const nextChecked: Record<string, boolean> = {};
            for (const r of scanned) {
                nextPicks[rowKey(r)] = r.matchId || 0;
                // Only confident pairings start ticked. A miss or an
                // ambiguity has to be resolved deliberately.
                nextChecked[rowKey(r)] = r.status === "matched";
            }
            setPicks(nextPicks);
            setChecked(nextChecked);
            if (scanned.length === 0) {
                setStatus({ text: `No OV sources left in "${result.compName}" — nothing to swap.`, type: "success" });
            }
        } catch (e) {
            noBridge();
        } finally {
            setBusy(false);
        }
    };

    const apply = async () => {
        if (!rows) return;
        const assignments = rows
            .filter((r) => checked[rowKey(r)] && picks[rowKey(r)])
            .map((r) => ({ compId: r.compId, layerIndex: r.layerIndex, sourceName: r.sourceName, matchId: picks[rowKey(r)] }));
        if (assignments.length === 0) {
            setStatus({ text: "Tick at least one swap first.", type: "error" });
            return;
        }
        setBusy(true);
        setStatus(null);
        try {
            // JSON string, not an array of objects: nested arrays-of-objects
            // lose their values crossing evalTS (CLAUDE.md's bridge rule).
            const result = await bridge("applyOvSwap", JSON.stringify(assignments));
            if (!result.success) {
                setStatus({ text: result.error || "Swap failed.", type: "error" });
                return;
            }
            const skipped: string[] = result.skipped || [];
            setStatus({
                text: `Swapped ${result.swapped} layer${result.swapped === 1 ? "" : "s"}.` + (skipped.length ? ` Skipped: ${skipped.join("; ")}` : ""),
                type: skipped.length ? "error" : "success",
            });
            // Re-scan so the table reflects the project as it now is: a
            // swapped layer no longer carries an OV source, so it correctly
            // drops out, and anything left is genuinely still outstanding.
            await scan();
        } catch (e) {
            noBridge();
        } finally {
            setBusy(false);
        }
    };

    const reset = () => {
        // Reset hands the code back to detection too -- a manual override
        // left standing after a reset is exactly the stale-code trap the
        // codeTouched flag exists to avoid.
        setCode("");
        setCodeTouched(false);
        suggest();
        setRows(null);
        setCandidates([]);
        setPicks({});
        setChecked({});
        setStatus(null);
        setCompName("");
    };

    const optionsFor = (row: SwapRow) =>
        candidates
            .filter((c) => c.isComp === row.sourceIsComp)
            .map((c) => ({ value: String(c.id), label: c.name }));

    const readyCount = rows ? rows.filter((r) => checked[rowKey(r)] && picks[rowKey(r)]).length : 0;

    return (
        <div className="form-tool ov-swap">
            <div className="field-row">
                <label htmlFor="ovs-code">
                    Territory Code
                    {/* Same inline-hint slot .field-optional already uses, so
                        the form's row rhythm is unchanged. */}
                    <Tooltip text={codeTouched ? "Using the code you typed." : "Detected from the active comp's name; re-checked on every scan."} delay={400}>
                        <span className="ovs-code-origin">{codeTouched ? "manual" : "auto"}</span>
                    </Tooltip>
                </label>
                <input
                    id="ovs-code"
                    type="text"
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value.toUpperCase());
                        // Clearing the box hands control back to detection
                        // rather than leaving it stuck on a manual empty.
                        setCodeTouched(e.target.value.trim().length > 0);
                    }}
                    placeholder="Detected from the comp name — type to override"
                />
            </div>

            <div className="button-row">
                <button disabled={busy} onClick={scan}>
                    <ScanSearch size={14} /> Scan Active Comp
                </button>
                <button disabled={busy || readyCount === 0} onClick={apply}>
                    <Repeat size={14} /> Swap {readyCount > 0 ? `${readyCount} ` : ""}Selected
                </button>
                <button disabled={busy} onClick={reset}>
                    <RotateCcw size={14} /> Reset
                </button>
            </div>

            {rows && rows.length > 0 && (
                <>
                    <h3>{compName}</h3>
                    <div className="ovs-rows">
                        {rows.map((r) => {
                            const key = rowKey(r);
                            return (
                                <div key={key} className={`ovs-row ovs-row--${r.status}`}>
                                    <CheckboxToggle
                                        checked={!!checked[key]}
                                        onChange={(v) => setChecked((c) => ({ ...c, [key]: v }))}
                                        title={`Swap the source on layer ${r.layerIndex} (${r.layerName})`}
                                    />
                                    <div className="ovs-row-body">
                                        <div className="ovs-from">
                                            <span className="ovs-badge">{r.sourceIsComp ? "COMP" : "FILE"}</span>
                                            <span className="ovs-name">{r.sourceName}</span>
                                        </div>
                                        <div className="ovs-to">
                                            <Dropdown
                                                value={picks[key] ? String(picks[key]) : ""}
                                                onChange={(v) => {
                                                    setPicks((p) => ({ ...p, [key]: Number(v) }));
                                                    setChecked((c) => ({ ...c, [key]: true }));
                                                }}
                                                options={optionsFor(r)}
                                                placeholder="Pick the replacement…"
                                                emptyMessage={r.sourceIsComp ? "No territory comps imported yet." : "No territory files imported yet."}
                                            />
                                        </div>
                                        <div className="ovs-meta">
                                            <Tooltip text={`${r.compName} — layer ${r.layerIndex}: ${r.layerName}`} delay={400}>
                                                <span className="ovs-where">
                                                    {r.compName} · layer {r.layerIndex}
                                                </span>
                                            </Tooltip>
                                            {r.reason && <span className="ovs-reason">{r.reason}</span>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default OVSwapTool;
