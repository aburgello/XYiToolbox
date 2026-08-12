// =============================================================================
// src/js/main/tools/ExpressionsBank.tsx
// -----------------------------------------------------------------------------
// A searchable library of expression snippets, SECTIONED BY PROVENANCE:
// what the artist saved themselves, what a colleague shared through the team
// folder, and the built-ins that ship with the panel. One flat list sorted by
// use-count (the original design) made a just-saved expression land at the
// bottom of 21 rows with nothing to distinguish it from the shipped
// templates -- an artist reported "saved it, moved page, couldn't find it
// again", which was partly the storage bug fixed in tools.ts and partly this.
//
// Origin is a stored field, not a guess: the built-ins carry origin
// "builtin", team.ts stamps "team" on anything teamSyncShared pulls, and the
// editor stamps "mine". Legacy rows saved before the field existed are
// inferred once on load (name matches a built-in => builtin, else mine).
// =============================================================================
import React, { useEffect, useState } from "react";
import { Save, Pencil, Copy, Trash2, Plus, Search, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Users, User, BookMarked, Tag } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import SegmentedToggle from "../SegmentedToggle";
import "../shared.scss";
import "./formTool.scss";

type Origin = "builtin" | "mine" | "team";

interface ExprEntry {
    id: string;
    name: string;
    tag: string;
    code: string;
    uses: number;
    description: string;
    origin: Origin;
    /** Member name of whoever shared it, for origin "team". "" if their machine was untagged. */
    author?: string;
}

// Shipped templates. Not mock data -- these are real content the panel
// ships with, merged under the "Built-in" section on every load. They are
// only written into app.settings once something persists (an edit, a use
// count), which is why teamShareExpression takes a full payload rather than
// looking an id up in the store.
const BUILT_IN_ENTRIES: Omit<ExprEntry, "origin">[] = [
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

const BUILT_IN_NAMES: { [lower: string]: boolean } = {};
for (const t of BUILT_IN_ENTRIES) BUILT_IN_NAMES[t.name.toLowerCase()] = true;

const BUILT_INS: ExprEntry[] = BUILT_IN_ENTRIES.map((t) => ({ ...t, origin: "builtin" as Origin }));

// Rows saved before `origin` existed have to be placed somewhere. A stored
// row whose name matches a shipped template is an EDITED built-in (that is
// the only way a template reaches the store); anything else the artist made.
// Team-pulled rows have carried origin since team.ts started stamping them.
const inferOrigin = (e: ExprEntry): Origin => {
    if (e.origin === "builtin" || e.origin === "mine" || e.origin === "team") return e.origin;
    return BUILT_IN_NAMES[(e.name || "").toLowerCase()] ? "builtin" : "mine";
};

interface Section {
    key: string;
    label: string;
    icon: React.ReactNode;
    /** Shown when the section exists but has nothing in it. */
    empty?: string;
    rows: ExprEntry[];
}

const ORIGIN_LABEL: Record<Origin, string> = {
    mine: "Saved by you",
    team: "Shared by the team",
    builtin: "Ships with the panel",
};

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
    // Section keys that are folded away. Held as "collapsed" rather than
    // "expanded" so a section that appears later (the first team pull, a new
    // tag) shows up open instead of hidden.
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
    const [groupBy, setGroupBy] = useState<"source" | "tag">("source");
    // Ringed for a few seconds after a save so the row is findable in a long
    // list without the artist hunting for it.
    const [justSavedId, setJustSavedId] = useState<string | null>(null);

    const normalise = (list: ExprEntry[]): ExprEntry[] =>
        list.map((e) => ({ ...e, origin: inferOrigin(e), uses: e.uses || 0 }));

    useEffect(() => {
        (async () => {
            let stored: ExprEntry[] = [];
            try {
                const result = await evalTS("expressionsBankLoad");
                if (result === undefined) throw new Error("no bridge");
                // `message` isn't on the shared Result interface (shared.ts),
                // hence the cast -- same pattern team.ts uses on this call.
                if (result.success) stored = normalise(JSON.parse((result as { message?: string }).message || "[]") as ExprEntry[]);
                // Migrating off the old pipe/tab store: say so out loud when
                // it held rows that can't be read back, rather than opening a
                // list that is quietly short of what the artist saved.
                const lost = (result as { legacyDropped?: number }).legacyDropped || 0;
                if (lost > 0) {
                    setStatus({
                        type: "error",
                        text: `${lost} expression${lost === 1 ? "" : "s"} saved under the old storage format couldn't be read back — their code contained a tab or a "|". The original text is kept in After Effects' settings under XYiToolbox / ExpressionsBankLegacyRaw if you need to recover one.`,
                    });
                }
            } catch {
                /* browser preview / no bridge -- built-ins only */
            }
            // Merge the built-in templates in (stored entries win by name)
            // instead of the old "stored replaces templates" rule -- team
            // sync (teamSyncShared) can populate an otherwise-empty store in
            // the background, and without this merge one synced entry would
            // make all 20 templates vanish from the list.
            const storedNames = new Set(stored.map((s) => (s.name || "").toLowerCase()));
            const merged = stored.concat(BUILT_INS.filter((t) => !storedNames.has(t.name.toLowerCase())));
            setEntries(merged);
            // Fold the built-ins away when the artist already has a library
            // of their own -- their rows are what they came for. On a fresh
            // machine the templates ARE the content, so leave them open.
            if (merged.some((e) => e.origin !== "builtin")) {
                setCollapsedSections(new Set(["builtin"]));
            }
            setLoaded(true);
        })();
    }, []);

    // Returns false only on a REAL backend failure -- an absent bridge
    // (browser preview) resolves true so the mock UI still behaves.
    const persist = async (next: ExprEntry[]): Promise<boolean> => {
        setEntries(next);
        try {
            const result = await evalTS("expressionsBankSave", JSON.stringify(next));
            if (result === undefined) return true;
            return !!result.success;
        } catch {
            return true; // browser preview
        }
    };

    // Reads the store straight back and confirms the entry survived the
    // round-trip. The old pipe/tab storage format silently DROPPED any
    // expression whose code contained a tab and truncated any containing
    // "||" (see tools.ts), and the panel reported "Expression saved." either
    // way -- the loss only showed up on the next visit to this page. The
    // format is JSON now, but a save that cannot be read back must never
    // again pass for a successful one.
    const verifyStored = async (entry: ExprEntry): Promise<boolean> => {
        try {
            const result = await evalTS("expressionsBankLoad");
            if (result === undefined || !result.success) return true; // no bridge / already reported
            const stored = JSON.parse((result as { message?: string }).message || "[]") as ExprEntry[];
            const found = stored.filter((s) => s.id === entry.id)[0];
            return !!found && found.code === entry.code && found.name === entry.name;
        } catch {
            return true; // browser preview
        }
    };

    const startNew = () => {
        setEditing({ id: genId(), name: "", tag: "", code: "", uses: 0, description: "", origin: "mine" });
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
        const saved = await persist(next);
        if (!saved) {
            setStatus({ type: "error", text: "After Effects refused to save the expression — it is still on screen, so copy the code out before closing the panel." });
            return;
        }
        const verified = await verifyStored(editing);
        // Expand the just-saved entry so the save is visibly confirmed by
        // its own code, rather than the row silently collapsing back into
        // the list with no feedback beyond the status line.
        setExpandedIds((prev) => new Set(prev).add(editing.id));
        // Make sure the section it lands in is open, or "saved" would be a
        // claim about a row the artist cannot see.
        setCollapsedSections((prev) => {
            const nextSet = new Set(prev);
            nextSet.delete(editing.origin);
            nextSet.delete(editing.tag.trim().toLowerCase() || "__untagged");
            return nextSet;
        });
        setJustSavedId(editing.id);
        setEditing(null);
        setStatus(verified
            ? { type: "success", text: `Saved "${editing.name}" to ${editing.origin === "builtin" ? "Built-in" : "My Expressions"}.` }
            : { type: "error", text: "Saved, but reading it back gave something different — copy the code somewhere safe and report this." });
    };

    // Clear the just-saved ring, and scroll the row into view once it has
    // rendered in its section.
    useEffect(() => {
        if (!justSavedId) return;
        const el = document.getElementById("eb-row-" + justSavedId);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
        const t = window.setTimeout(() => setJustSavedId(null), 4000);
        return () => window.clearTimeout(t);
    }, [justSavedId]);

    const removeEntry = async (id: string) => {
        const ok = await persist(entries.filter((e) => e.id !== id));
        setStatus(ok
            ? { type: "success", text: "Expression removed." }
            : { type: "error", text: "Could not write the change to After Effects." });
    };

    // Pushes one expression into the team folder's shared-expressions.json
    // (aeft/team.ts) -- colleagues' panels pull it automatically on open via
    // teamSyncShared, same flow as QuickFX's combo sharing. Passes the FULL
    // entry, not an id: the 20 built-in templates only exist in this file's
    // MOCK_ENTRIES until first edit (never in app.settings), so a backend
    // id-lookup couldn't find them -- the "Expression not found" bug from
    // the first real share attempt.
    const shareEntry = async (entry: ExprEntry) => {
        try {
            const result = await evalTS(
                "teamShareExpression",
                // author is passed through so re-sharing something a colleague
                // shared keeps crediting them; the backend only fills it in
                // from this machine's owner tag when it arrives blank.
                JSON.stringify({ id: entry.id, name: entry.name, tag: entry.tag, code: entry.code, uses: 0, description: entry.description, author: entry.author || "" })
            );
            if (result === undefined) throw new Error("no bridge");
            setStatus(result.success
                ? { type: "success", text: (result as { message?: string }).message || "Shared with the team." }
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

    const searching = search.trim().length > 0;

    const filtered = searching
        ? entries.filter((e) => {
            const q = search.trim().toLowerCase();
            return e.name.toLowerCase().indexOf(q) !== -1 ||
                   e.tag.toLowerCase().indexOf(q) !== -1 ||
                   (e.author || "").toLowerCase().indexOf(q) !== -1 ||
                   e.code.toLowerCase().indexOf(q) !== -1;
        })
        : entries;

    // Most-used first inside a section, then alphabetical -- a stable order
    // so a row doesn't move under the cursor between visits.
    const bySort = (a: ExprEntry, b: ExprEntry) =>
        b.uses - a.uses || a.name.toLowerCase().localeCompare(b.name.toLowerCase());

    const ofOrigin = (o: Origin) => filtered.filter((e) => e.origin === o).sort(bySort);

    const sections: Section[] = [];
    if (groupBy === "source") {
        const mine = ofOrigin("mine");
        const team = ofOrigin("team");
        const builtin = ofOrigin("builtin");
        // "My Expressions" is always rendered, even empty -- it is the
        // section an artist looks in for something they just saved, and an
        // absent section reads as lost data rather than an empty one.
        sections.push({
            key: "mine", label: "My Expressions", icon: <User size={12} />, rows: mine,
            empty: searching ? "Nothing of yours matches." : "Nothing saved yet — hit Add to bank your first one.",
        });
        if (team.length > 0 || !searching) {
            sections.push({
                key: "team", label: "Team Library", icon: <Users size={12} />, rows: team,
                empty: searching ? "Nothing from the team matches." : "Nothing pulled from the team folder yet.",
            });
        }
        if (builtin.length > 0) {
            sections.push({ key: "builtin", label: "Built-in", icon: <BookMarked size={12} />, rows: builtin });
        }
    } else {
        // Group by tag: same rows, cut the other way, for "show me everything
        // to do with loops" rather than "show me mine". Origin stays visible
        // on each row via its accent + badge.
        const buckets: { [key: string]: ExprEntry[] } = {};
        for (const e of filtered) {
            const key = e.tag.trim().toLowerCase() || "__untagged";
            if (!buckets[key]) buckets[key] = [];
            buckets[key].push(e);
        }
        const keys = Object.keys(buckets).filter((k) => k !== "__untagged").sort();
        if (buckets["__untagged"]) keys.push("__untagged"); // untagged always last
        for (const k of keys) {
            sections.push({
                key: k,
                label: k === "__untagged" ? "Untagged" : k,
                icon: <Tag size={12} />,
                rows: buckets[k].sort(bySort),
            });
        }
    }

    // A search should never leave a match hidden behind a folded header.
    const isCollapsed = (key: string) => !searching && collapsedSections.has(key);

    const toggleSection = (key: string) => {
        setCollapsedSections((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const visibleRows = filtered;

    return (
        <div className="form-tool eb">

            {!editing && (
                <>
                    <div className="eb-search-row">
                        <div className="eb-search-box">
                            <Search size={12} />
                            <input
                                type="text"
                                placeholder="Search name, tag, code or author…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        {visibleRows.length > 0 && (
                            <Tooltip text={expandedIds.size > 0 ? "Collapse all code" : "Expand all code"}>
                                <button
                                    className="eb-icon-btn"
                                    onClick={() => setExpandedIds(expandedIds.size > 0 ? new Set() : new Set(visibleRows.map((e) => e.id)))}
                                >
                                    {expandedIds.size > 0 ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                                </button>
                            </Tooltip>
                        )}
                        <button onClick={startNew} className="eb-add-btn">
                            <Plus size={14} /> Add
                        </button>
                    </div>

                    <div className="eb-group-row">
                        <span className="eb-group-label">Group by</span>
                        <SegmentedToggle
                            name="eb-group"
                            value={groupBy}
                            onChange={(v) => setGroupBy(v as "source" | "tag")}
                            options={[{ value: "source", label: "Source" }, { value: "tag", label: "Tag" }]}
                        />
                        <span className="eb-group-count">
                            {searching ? `${visibleRows.length} of ${entries.length}` : `${entries.length} expressions`}
                        </span>
                    </div>

                    {status && (
                        <div className={`loc-status loc-status-${status.type}`}>
                            <StatusIcon type={status.type} />
                            <span>{status.text}</span>
                        </div>
                    )}

                    <div className="eb-list">
                        {/* A search with no hits shows the one hint below, not a
                            column of empty section headers. */}
                        {(!searching || visibleRows.length > 0) && sections.map((section) => {
                            const collapsed = isCollapsed(section.key);
                            return (
                                <div key={section.key} className={`eb-section eb-section-${section.key}`}>
                                    <button
                                        className="eb-section-header"
                                        onClick={() => toggleSection(section.key)}
                                        disabled={searching}
                                    >
                                        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                        <span className="eb-section-icon">{section.icon}</span>
                                        <span className="eb-section-label">{section.label}</span>
                                        <span className="eb-section-count">{section.rows.length}</span>
                                    </button>

                                    {!collapsed && section.rows.length === 0 && section.empty && (
                                        <p className="eb-section-empty">{section.empty}</p>
                                    )}

                                    {!collapsed && section.rows.map((e) => {
                                        const expanded = expandedIds.has(e.id);
                                        return (
                                            <div
                                                key={e.id}
                                                id={"eb-row-" + e.id}
                                                className={`eb-entry eb-origin-${e.origin}${justSavedId === e.id ? " eb-entry-saved" : ""}`}
                                            >
                                                <div className="eb-entry-header">
                                                    <Tooltip text={expanded ? "Collapse" : "Expand"}>
                                                        <button className="eb-collapse-btn" onClick={() => toggleExpanded(e.id)}>
                                                            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                                        </button>
                                                    </Tooltip>
                                                    <Tooltip text={e.description || "Click to copy"} grow>
                                                        <span className="eb-entry-name" onClick={() => { copyCode(e.code); incrementUse(e.id); }}>
                                                            {e.name}
                                                        </span>
                                                    </Tooltip>
                                                    <div className="eb-entry-actions">
                                                        {/* Origin is already carried by the row's left accent; the
                                                            badge only appears where the accent alone is ambiguous --
                                                            i.e. grouped by tag, where sections are mixed, or when a
                                                            team entry has a name to credit. */}
                                                        {e.origin === "team" && e.author && (
                                                            <Tooltip text={`Shared by ${e.author}`}>
                                                                <span className="eb-entry-author">{e.author}</span>
                                                            </Tooltip>
                                                        )}
                                                        {groupBy === "tag" && !(e.origin === "team" && e.author) && (
                                                            <Tooltip text={ORIGIN_LABEL[e.origin]}>
                                                                <span className={`eb-entry-origin eb-origin-dot-${e.origin}`} />
                                                            </Tooltip>
                                                        )}
                                                        {e.tag && groupBy === "source" && <span className="eb-entry-tag">{e.tag}</span>}
                                                        <Tooltip text={`Used ${e.uses} ${e.uses === 1 ? "time" : "times"}`}>
                                                            <span className="eb-entry-uses">{e.uses}</span>
                                                        </Tooltip>
                                                        <Tooltip text="Copy code">
                                                            <button className="eb-icon-btn" onClick={() => copyCode(e.code)}><Copy size={12} /></button>
                                                        </Tooltip>
                                                        <Tooltip text="Share to team library">
                                                            <button className="eb-icon-btn" onClick={() => shareEntry(e)}><Users size={12} /></button>
                                                        </Tooltip>
                                                        <Tooltip text="Edit">
                                                            <button className="eb-icon-btn" onClick={() => startEdit(e)}><Pencil size={12} /></button>
                                                        </Tooltip>
                                                        {/* No Remove on a built-in: the load merge re-adds any
                                                            shipped template missing from the store, so deleting one
                                                            only appeared to work until the next visit. Better no
                                                            button than a button that lies. */}
                                                        {e.origin !== "builtin" && (
                                                            <Tooltip text="Remove">
                                                                <button className="eb-icon-btn" onClick={() => removeEntry(e.id)}><Trash2 size={12} /></button>
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                </div>
                                                {expanded && (
                                                    <pre className="eb-entry-code" onClick={() => { copyCode(e.code); incrementUse(e.id); }} title="Click to copy">{e.code}</pre>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                        {visibleRows.length === 0 && (
                            <p className="hint" style={{ padding: "12px 0" }}>
                                {loaded ? (searching ? "No expressions match that search." : "No expressions found.") : "Loading…"}
                            </p>
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