import React, { useEffect, useState } from "react";
import { Save, Pencil, Copy, Trash2, Plus, Search, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Users } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import "../shared.scss";
import "./formTool.scss";

interface ExprEntry {
    id: string;
    name: string;
    tag: string;
    code: string;
    uses: number;
    description: string;
}

const MOCK_ENTRIES: ExprEntry[] = [
    { id: "1", name: "Wiggle Position", tag: "position", code: "wiggle(2, 10)", uses: 5, description: "Adds organic jitter -- 2 wiggles/sec, up to 10px of movement." },
    { id: "2", name: "Loop Out Duration", tag: "loop", code: 'loopOut("cycle", 0);', uses: 3, description: "Repeats the whole keyframed animation forever after the last keyframe." },
    { id: "3", name: "Time Remap Loop", tag: "timeremap", code: 'loopOut("cycle");', uses: 8, description: "Same cycle loop, applied to a layer's Time Remap property instead of a transform." },
    {
        id: "4", name: "Bounce (Overshoot)", tag: "bounce",
        code: 'n = 0;\nif (numKeys > 0) {\n  n = nearestKey(time).index;\n  if (key(n).time > time) n--;\n}\nif (n === 0) {\n  t = 0;\n} else {\n  t = time - key(n).time;\n}\nif (n > 0 && t < 1) {\n  v = velocityAtTime(key(n).time - thisComp.frameDuration/10);\n  amp = 0.05;\n  freq = 4.0;\n  decay = 6.0;\n  value + v*amp*Math.sin(freq*t*2*Math.PI)/Math.exp(decay*t);\n} else value',
        uses: 6,
        description: "Adds a decaying spring overshoot after the nearest keyframe -- classic squash-and-settle motion.",
    },
    {
        id: "5", name: "Random Spin (Z Rotation)", tag: "rotation",
        code: "seedRandom(index, true);\nrandom(0, 360)",
        uses: 2,
        description: "Gives each layer its own fixed random rotation (0-360°), stable per layer index.",
    },
    {
        id: "6", name: "Parent-less Link (Position)", tag: "link",
        code: 'thisComp.layer("Target Layer").transform.position',
        uses: 4,
        description: "Slaves this property to another layer's position without using real parenting.",
    },
    {
        id: "7", name: "Auto Fade In/Out (Opacity)", tag: "opacity",
        code: "fadeInDuration = 0.5;\nfadeOutDuration = 0.5;\nt = time - inPoint;\notDur = outPoint - inPoint;\nif (t < fadeInDuration) {\n  linear(t, 0, fadeInDuration, 0, 100);\n} else if (t > otDur - fadeOutDuration) {\n  linear(t, otDur - fadeOutDuration, otDur, 100, 0);\n} else 100",
        uses: 7,
        description: "Fades a layer in over 0.5s and back out over its last 0.5s -- no keyframes needed.",
    },
    {
        id: "8", name: "Text Counter", tag: "text",
        code: 'start = 0;\nend = 100;\ndur = 2;\nMath.round(linear(time, 0, dur, start, end))',
        uses: 1,
        description: "Counts a text layer from a start to end value over a fixed duration (seconds).",
    },
    {
        id: "9", name: "Scale To Fit Comp", tag: "scale",
        code: "s = thisComp.width / source.width;\n[s, s] * 100",
        uses: 3,
        description: "Scales a precomp layer's source to exactly fill the current comp's width.",
    },
    {
        id: "10", name: "Sample Colour From Layer", tag: "color",
        code: 'thisComp.layer("Colour Ref").sampleImage([0.5, 0.5])',
        uses: 2,
        description: "Reads the pixel colour at the center of a reference layer -- handy for auto-tinting.",
    },
    {
        id: "11", name: "Comp Name to Text", tag: "text",
        code: 'var finalText = "";\nfor (var i = 0; i < thisComp.name.length; i++) {\n  finalText += thisComp.name.charAt(i);\n}\nfinalText',
        uses: 0,
        description: "Rebuilds the comp name character-by-character into Source Text -- trim the loop bounds to slice out just a portion of the name (e.g. everything after a fixed prefix).",
    },
    {
        id: "12", name: "Terminating Loop", tag: "loop",
        code: 't = 2; // seconds -- when the loop should stop\nif (time < t) {\n  loopOut("cycle");\n} else {\n  valueAtTime(t);\n}',
        uses: 0,
        description: "Cycles normally up to a fixed time, then freezes on that frame -- for a loop that needs to visibly stop rather than run for the whole comp.",
    },
    {
        id: "13", name: "World Position From Null", tag: "position",
        code: 'layer = thisComp.layer("Null 1");\nlayer.toComp([0, 0, 0])',
        uses: 0,
        description: "Converts a null's local origin into comp (world) space -- swap in any layer to read its true on-screen position, independent of its own parenting chain.",
    },
    {
        id: "14", name: "Custom Loop (Non-loopOut Properties)", tag: "loop",
        code: 'if (numKeys > 1 && time > key(numKeys).time) {\n  t1 = key(1).time;\n  t2 = key(numKeys).time;\n  span = t2 - t1;\n  delta = time - t2;\n  t = delta % span;\n  valueAtTime(t1 + t);\n} else {\n  value;\n}',
        uses: 0,
        description: "Manual modulo loop for properties that don't support loopOut() -- Mask Path is the classic case. Keyframe one full cycle and this repeats it forever.",
    },
    {
        id: "15", name: "Stop Motion (Hold Each Frame)", tag: "time",
        code: 'm = 2; // hold each frame for m frames\n\nf = timeToFrames();\np = Math.floor((f - 1) / m);\nt = framesToTime(p * m);\nvalueAtTime(t)',
        uses: 0,
        description: "Chunky stop-motion hold -- steps the evaluated time in blocks of m frames instead of interpolating smoothly. Apply to Time Remap or any keyframed property.",
    },
    {
        id: "16", name: "Layer-Enabled Opacity Switch", tag: "opacity",
        code: 'layerSel = thisComp.layer("Target Layer"); // pick-whip a layer instead\nif (layerSel.enabled) {\n  100;\n} else {\n  0;\n}',
        uses: 0,
        description: "Mirrors another layer's Video (eye) toggle into this layer's Opacity -- 100 when the source layer is switched on, 0 when it's off. Handy for driving a group's visibility from one master switch.",
    },
    {
        id: "17", name: "Auto-Fit Scale (Aspect-Preserving)", tag: "scale",
        code: 'var compSize = [thisComp.width, thisComp.height];\nvar rect = sourceRectAtTime(time, false);\nvar layerSize = (rect.width > 0 && rect.height > 0) ? [rect.width, rect.height] : [width, height];\n\nvar scaleFactor = [compSize[0] / layerSize[0], compSize[1] / layerSize[1]];\nvar finalScale = Math.min(scaleFactor[0], scaleFactor[1]);\n\n[finalScale * 100, finalScale * 100]',
        uses: 0,
        description: "Fits a layer inside the comp on whichever axis is tighter, preserving aspect ratio -- unlike a straight width-fill (see Scale To Fit Comp), this never lets the layer overflow top/bottom or crop.",
    },
    {
        id: "18", name: "Scale Relative To Camera Distance", tag: "3d",
        code: 'cam = thisComp.activeCamera;\ndistance = length(sub(transform.position, cam.position));\ns = distance / cam.zoom;\n\nmul(transform.scale, s)',
        uses: 0,
        description: "Compensates a 3D layer's Scale for its distance from the active camera, using AE's built-in vector math (sub/mul). Apply directly to Scale on a 3D layer; requires an active camera in the comp.",
    },
    {
        id: "19", name: "Marker-Reset Time", tag: "marker",
        code: 'var t = time;\nvar marker = thisLayer.marker;\n\nif (marker.numKeys > 0) {\n  var mostRecent = 0;\n  for (var i = 1; i <= marker.numKeys; i++) {\n    var mt = marker.key(i).time;\n    if (mt <= t && mt > mostRecent) mostRecent = mt;\n  }\n  t -= mostRecent;\n}\n\nt',
        uses: 0,
        description: "Resets the effective time to 0 at the most recent layer marker -- feed this into Time Remap (or wrap loopOut around it) to restart a segment/loop each time a marker passes, without re-keying anything.",
    },
    {
        id: "20", name: "Dateline (Today's Date)", tag: "text",
        code: 'var D = new Date(Date(0));\nvar day = D.getDate();\nvar month = D.getMonth() + 1;\nvar year = String(D.getFullYear()).slice(2, 4);\n\nvar dPad = (day >= 10) ? "" : "0";\nvar mPad = (month >= 10) ? "" : "0";\n\ndPad + day + "." + mPad + month + "." + year',
        uses: 0,
        description: "Live DD.MM.YY dateline for an intro/outro card. The Date(Date(0)) double-wrap is deliberate -- it forces AE to re-read the real wall-clock date instead of caching the value from when the expression first evaluated.",
    },
];

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const ExpressionsBank: React.FC = () => {
    const [entries, setEntries] = useState<ExprEntry[]>([]);
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<ExprEntry | null>(null);
    const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [loaded, setLoaded] = useState(false);
    // Which entries have their code block expanded -- collapsed by default,
    // since several of these (Bounce, Auto Fade) are 10+ lines and a list of
    // 10 entries all expanded at once is mostly scrolling past code you're
    // not looking at right now.
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        (async () => {
            try {
                const result = await evalTS("expressionsBankLoad");
                if (result === undefined) throw new Error("no bridge");
                if (result.success) {
                    const parsed = JSON.parse(result.message);
                    setEntries(parsed.length > 0 ? parsed : MOCK_ENTRIES);
                } else {
                    setEntries(MOCK_ENTRIES);
                }
            } catch {
                setEntries(MOCK_ENTRIES);
            }
            setLoaded(true);
        })();
    }, []);

    const persist = async (next: ExprEntry[]) => {
        setEntries(next);
        try {
            await evalTS("expressionsBankSave", JSON.stringify(next));
        } catch { /* browser preview */ }
    };

    const startNew = () => {
        setEditing({ id: genId(), name: "", tag: "", code: "", uses: 0, description: "" });
        setStatus(null);
    };

    const startEdit = (e: ExprEntry) => {
        setEditing({ ...e });
        setStatus(null);
    };

    const toggleExpanded = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const cancelEdit = () => setEditing(null);

    const saveEdit = async () => {
        if (!editing) return;
        if (!editing.name.trim() || !editing.code.trim()) {
            setStatus({ type: "error", text: "Name and code are required." });
            return;
        }
        const existing = entries.findIndex((e) => e.id === editing.id);
        let next: ExprEntry[];
        if (existing >= 0) {
            next = [...entries];
            next[existing] = editing;
        } else {
            next = [...entries, editing];
        }
        await persist(next);
        // Expand the just-saved entry so the save is visibly confirmed by
        // its own code, rather than the row silently collapsing back into
        // the list with no feedback beyond the status line.
        setExpandedIds((prev) => new Set(prev).add(editing.id));
        setEditing(null);
        setStatus({ type: "success", text: "Expression saved." });
    };

    const removeEntry = async (id: string) => {
        await persist(entries.filter((e) => e.id !== id));
        setStatus({ type: "success", text: "Expression removed." });
    };

    // Pushes one expression into the team folder's shared-expressions.json
    // (aeft/team.ts) -- colleagues' panels pull it automatically on open via
    // teamSyncShared, same flow as QuickFX's combo sharing.
    const shareEntry = async (id: string) => {
        try {
            const result = await evalTS("teamShareExpression", id);
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success
                ? { type: "success", text: result.message || "Shared with the team." }
                : { type: "error", text: result.error || "Something went wrong." });
        } catch {
            setStatus({ type: "error", text: "No CEP bridge detected — open this panel inside After Effects." });
        }
    };

    const copyCode = async (code: string) => {
        // CEP panels run inside CEF, which never grants navigator.clipboard
        // to a panel webview (no permission-prompt UI exists in CEP's
        // chrome) -- so the browser API always rejects here. Use the same
        // ExtendScript temp-file + pbcopy/clip bridge TimesheetTracker and
        // ReviewHub already rely on; fall back to the browser API only when
        // there's no CEP bridge at all (browser-preview/mock mode).
        try {
            const result = await evalTS("timesheetCopyToClipboard", code);
            if (result === undefined) throw new Error("no bridge");
            if (result.success) {
                setStatus({ type: "success", text: "Copied to clipboard." });
            } else {
                setStatus({ type: "error", text: "Copy failed: " + (result.error || "unknown error") });
            }
            return;
        } catch {
            // fall through to browser API below
        }
        try {
            await navigator.clipboard.writeText(code);
            setStatus({ type: "success", text: "Copied to clipboard." });
        } catch {
            setStatus({ type: "error", text: "Clipboard not available." });
        }
    };

    const incrementUse = async (id: string) => {
        const next = entries.map((e) => e.id === id ? { ...e, uses: e.uses + 1 } : e);
        await persist(next);
    };

    const filtered = search.trim()
        ? entries.filter((e) => {
            const q = search.toLowerCase();
            return e.name.toLowerCase().indexOf(q) !== -1 ||
                   e.tag.toLowerCase().indexOf(q) !== -1 ||
                   e.code.toLowerCase().indexOf(q) !== -1;
        })
        : entries;

    const sorted = [...filtered].sort((a, b) => b.uses - a.uses);

    return (
        <div className="form-tool eb">

            {!editing && (
                <>
                    <div className="eb-search-row">
                        <div className="eb-search-box">
                            <Search size={12} />
                            <input
                                type="text"
                                placeholder="Search expressions…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        {sorted.length > 0 && (
                            <Tooltip text={expandedIds.size > 0 ? "Collapse all" : "Expand all"}>
                                <button
                                    className="eb-icon-btn"
                                    onClick={() => setExpandedIds(expandedIds.size > 0 ? new Set() : new Set(sorted.map((e) => e.id)))}
                                >
                                    {expandedIds.size > 0 ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                                </button>
                            </Tooltip>
                        )}
                        <button onClick={startNew} className="eb-add-btn">
                            <Plus size={14} /> Add
                        </button>
                    </div>

                    {status && (
                        <div className={`loc-status loc-status-${status.type}`}>
                            <StatusIcon type={status.type} />
                            <span>{status.text}</span>
                        </div>
                    )}

                    <div className="eb-list">
                        {sorted.map((e) => {
                            const expanded = expandedIds.has(e.id);
                            return (
                                <div key={e.id} className="eb-entry">
                                    <div className="eb-entry-header">
                                        <Tooltip text={expanded ? "Collapse" : "Expand"}>
                                            <button className="eb-collapse-btn" onClick={() => toggleExpanded(e.id)}>
                                                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                            </button>
                                        </Tooltip>
                                        <Tooltip text={e.description || "Click to copy"}>
                                            <span className="eb-entry-name" onClick={() => { copyCode(e.code); incrementUse(e.id); }}>
                                                {e.name}
                                            </span>
                                        </Tooltip>
                                        <div className="eb-entry-actions">
                                            {e.tag && <span className="eb-entry-tag">{e.tag}</span>}
                                            <span className="eb-entry-uses" title="Times used">{e.uses}</span>
                                            <Tooltip text="Copy code">
                                                <button className="eb-icon-btn" onClick={() => copyCode(e.code)}><Copy size={12} /></button>
                                            </Tooltip>
                                            <Tooltip text="Share to team library">
                                                <button className="eb-icon-btn" onClick={() => shareEntry(e.id)}><Users size={12} /></button>
                                            </Tooltip>
                                            <Tooltip text="Edit">
                                                <button className="eb-icon-btn" onClick={() => startEdit(e)}><Pencil size={12} /></button>
                                            </Tooltip>
                                            <Tooltip text="Remove">
                                                <button className="eb-icon-btn" onClick={() => removeEntry(e.id)}><Trash2 size={12} /></button>
                                            </Tooltip>
                                        </div>
                                    </div>
                                    {expanded && (
                                        <pre className="eb-entry-code" onClick={() => { copyCode(e.code); incrementUse(e.id); }} title="Click to copy">{e.code}</pre>
                                    )}
                                </div>
                            );
                        })}
                        {sorted.length === 0 && (
                            <p className="hint" style={{ padding: "12px 0" }}>{loaded ? "No expressions found." : "Loading…"}</p>
                        )}
                    </div>
                </>
            )}

            {editing && (
                <div className="eb-editor">
                    <div className="field-row">
                        <label>Name</label>
                        <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Wiggle Position" autoFocus />
                    </div>
                    <div className="field-row">
                        <label>Tag</label>
                        <input type="text" value={editing.tag} onChange={(e) => setEditing({ ...editing, tag: e.target.value })} placeholder="e.g. position, loop, wiggle" />
                    </div>
                    <div className="field-row">
                        <label>Description</label>
                        <input
                            type="text"
                            value={editing.description}
                            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                            placeholder="What this expression does -- shown on hover in the list"
                        />
                    </div>
                    <div className="field-row">
                        <label>Expression Code</label>
                        <textarea
                            value={editing.code}
                            onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                            placeholder="wiggle(2, 10)"
                            rows={6}
                            spellCheck={false}
                        />
                    </div>
                    {status && (
                        <div className={`loc-status loc-status-${status.type}`}>
                            <StatusIcon type={status.type} />
                            <span>{status.text}</span>
                        </div>
                    )}
                    <div className="button-row eb-editor-buttons">
                        <button onClick={saveEdit}><Save size={14} /> Save</button>
                        <button onClick={cancelEdit} className="eb-cancel-btn">Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExpressionsBank;